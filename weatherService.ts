
import { WeatherData, WeatherForecast } from './types';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

// One cached weather doc per user+outlet. A deterministic ID means the cache is
// always 1 read to check and 1 write to refresh, and the collection never grows.
const weatherDocRef = (userId: string, outletId: string) =>
  doc(db, 'weather', `${userId}_${outletId}`);

export type CachedWeather = WeatherData & { forecast?: WeatherForecast[] };

export const fetchForecastFromAPI = async (lat: number, lon: number): Promise<WeatherForecast[]> => {
  if (!API_KEY) return [];

  try {
    const response = await fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);
    if (!response.ok) return [];

    const data = await response.json();
    const dailyData: Record<string, any[]> = {};

    // Group by date
    data.list.forEach((item: any) => {
      const date = item.dt_txt.split(' ')[0];
      if (!dailyData[date]) dailyData[date] = [];
      dailyData[date].push(item);
    });

    // Aggregate
    return Object.entries(dailyData).slice(0, 5).map(([date, items]) => {
      const avgTemp = items.reduce((acc, i) => acc + i.main.temp, 0) / items.length;
      const avgHum = items.reduce((acc, i) => acc + i.main.humidity, 0) / items.length;
      const totalRain = items.reduce((acc, i) => acc + (i.rain ? i.rain['3h'] || 0 : 0), 0);

      // Find most frequent condition
      const conditions = items.map(i => i.weather[0].main);
      const mostFrequent = conditions.sort((a, b) =>
        conditions.filter(v => v === a).length - conditions.filter(v => v === b).length
      ).pop();

      return {
        date,
        temp: Math.round(avgTemp),
        condition: mostFrequent,
        icon: items[Math.floor(items.length / 2)].weather[0].icon,
        precipitation: totalRain,
        humidity: Math.round(avgHum)
      };
    });
  } catch (err) {
    console.error("Error fetching forecast from OpenWeather:", err);
    return [];
  }
};

export const fetchWeatherFromAPI = async (lat: number, lon: number): Promise<Partial<WeatherData> | null> => {
  if (!API_KEY) {
    console.warn("Weather API Key missing — weather unavailable.");
    return null;
  }

  try {
    const response = await fetch(`${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || response.statusText || 'Unknown error';
      console.error(`Weather API Error (${response.status}): ${errorMessage}`);
      return null;
    }

    const data = await response.json();
    return {
      temp: data.main.temp,
      condition: data.weather[0].main,
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      precipitation: data.rain ? data.rain['1h'] || 0 : 0,
      icon: data.weather[0].icon,
      updatedAt: Date.now()
    };
  } catch (err) {
    console.error("Error fetching from OpenWeather:", err);
    return null;
  }
};

export const getLatestWeather = async (outletId: string, userId: string): Promise<CachedWeather | null> => {
  try {
    const snap = await getDoc(weatherDocRef(userId, outletId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as CachedWeather;
  } catch (err) {
    console.error("Error fetching weather from DB:", err);
    return null;
  }
};

export const saveWeatherToDB = async (weather: Omit<CachedWeather, 'id'>) => {
  try {
    await setDoc(weatherDocRef(weather.userId, weather.outletId), weather, { merge: true });
  } catch (err) {
    console.error("Error saving weather:", err);
  }
};
