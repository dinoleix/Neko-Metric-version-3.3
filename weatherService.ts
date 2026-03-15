
import { WeatherData, WeatherForecast } from './types';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, limit, orderBy } from '@firebase/firestore';
import { db } from './firebase';
import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

export const fetchWeatherSimulated = async (lat: number, lon: number): Promise<Partial<WeatherData>> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Simulate the current weather for coordinates (${lat}, ${lon}). 
      Return JSON with: temp (number in Celsius), condition (string: "Clear", "Clouds", "Rain", "Drizzle", "Thunderstorm", "Snow", "Mist"), 
      humidity (number 0-100), windSpeed (number m/s), precipitation (number mm).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            temp: { type: Type.NUMBER },
            condition: { type: Type.STRING },
            humidity: { type: Type.NUMBER },
            windSpeed: { type: Type.NUMBER },
            precipitation: { type: Type.NUMBER }
          },
          required: ["temp", "condition", "humidity", "windSpeed", "precipitation"]
        }
      }
    });

    const data = JSON.parse(response.text);
    return {
      ...data,
      icon: '01d', // Default sun icon for simulation
      updatedAt: Date.now()
    };
  } catch (err) {
    console.error("Gemini Weather Simulation failed:", err);
    throw err;
  }
};

export const fetchForecastSimulated = async (lat: number, lon: number): Promise<WeatherForecast[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Simulate a 5-day weather forecast for coordinates (${lat}, ${lon}). 
      Return JSON array of 5 objects with: date (YYYY-MM-DD), temp (number), condition (string), icon (string: "01d"), precipitation (number), humidity (number).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              temp: { type: Type.NUMBER },
              condition: { type: Type.STRING },
              icon: { type: Type.STRING },
              precipitation: { type: Type.NUMBER },
              humidity: { type: Type.NUMBER }
            },
            required: ["date", "temp", "condition", "icon", "precipitation", "humidity"]
          }
        }
      }
    });
    return JSON.parse(response.text);
  } catch (err) {
    console.error("Gemini Forecast Simulation failed:", err);
    return [];
  }
};

export const fetchForecastFromAPI = async (lat: number, lon: number): Promise<WeatherForecast[]> => {
  if (!API_KEY) return fetchForecastSimulated(lat, lon);

  try {
    const response = await fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);
    if (!response.ok) return fetchForecastSimulated(lat, lon);

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
    return fetchForecastSimulated(lat, lon);
  }
};

export const fetchWeatherFromAPI = async (lat: number, lon: number): Promise<Partial<WeatherData>> => {
  if (!API_KEY) {
    console.warn("Weather API Key missing. Falling back to Gemini simulation.");
    return fetchWeatherSimulated(lat, lon);
  }

  try {
    const response = await fetch(`${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || response.statusText || 'Unknown error';
      console.error(`Weather API Error (${response.status}): ${errorMessage}`);
      
      if (response.status === 401) {
        console.warn("Invalid OpenWeather API Key. Falling back to Gemini simulation.");
        return fetchWeatherSimulated(lat, lon);
      }
      throw new Error(`WEATHER_API_FAILURE: ${errorMessage}`);
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
    // Final fallback to simulation for any network error
    return fetchWeatherSimulated(lat, lon);
  }
};

export const getLatestWeather = async (outletId: string, userId: string): Promise<WeatherData | null> => {
  try {
    const q = query(
      collection(db, 'weather'),
      where('outletId', '==', outletId),
      where('userId', '==', userId),
      limit(20) // Get a few and sort in memory
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    
    // Sort in memory to find latest
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as WeatherData));
    return docs.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  } catch (err) {
    console.error("Error fetching weather from DB:", err);
    return null;
  }
};

export const saveWeatherToDB = async (weather: Omit<WeatherData, 'id'>) => {
  try {
    await addDoc(collection(db, 'weather'), weather);
  } catch (err) {
    console.error("Error saving weather:", err);
  }
};
