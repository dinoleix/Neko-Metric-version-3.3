
import React, { useState, useEffect } from 'react';
import { Cloud, Sun, CloudRain, Wind, Thermometer, Droplets, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { WeatherData, StoreRental, WeatherForecast } from '../types';
import { fetchWeatherFromAPI, getLatestWeather, saveWeatherToDB, fetchForecastFromAPI } from '../weatherService';

interface WeatherWidgetProps {
  outlet: StoreRental;
  userId: string;
}

const WeatherWidget: React.FC<WeatherWidgetProps> = ({ outlet, userId }) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<WeatherForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [showForecast, setShowForecast] = useState(false);

  const loadWeather = async () => {
    if (!outlet.latitude || !outlet.longitude) {
      setError("NO_COORDINATES");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setIsSimulated(false);
    try {
      // 1. Try to get cached weather from DB (valid for 1 hour)
      const cached = await getLatestWeather(outlet.outletId, userId);
      const oneHourAgo = Date.now() - (60 * 60 * 1000);

      if (cached && cached.updatedAt > oneHourAgo) {
        setWeather(cached);
      } else {
        // 2. Fetch fresh from API (or fallback to Gemini)
        const fresh = await fetchWeatherFromAPI(outlet.latitude, outlet.longitude);
        
        // Check if it was a simulation (no icon or specific flag)
        const isSim = !import.meta.env.VITE_OPENWEATHER_API_KEY || fresh.icon === '01d';
        setIsSimulated(isSim);

        const newWeather: Omit<WeatherData, 'id'> = {
          ...fresh as any,
          date: new Date().toISOString().split('T')[0],
          outletId: outlet.outletId,
          userId: userId,
          isForecast: false,
          updatedAt: Date.now()
        };
        await saveWeatherToDB(newWeather);
        setWeather({ ...newWeather, id: 'temp' } as WeatherData);
      }

      // Fetch forecast separately (not cached for simplicity in this version)
      const fData = await fetchForecastFromAPI(outlet.latitude, outlet.longitude);
      setForecast(fData);
    } catch (err: any) {
      setError(err.message || "FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWeather();
  }, [outlet.outletId]);

  if (loading) return (
    <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-2xl border border-slate-100 animate-pulse">
      <Loader2 size={16} className="animate-spin text-slate-400" />
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Syncing Weather...</span>
    </div>
  );

  if (error === "NO_COORDINATES") return (
    <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-2xl border border-slate-100">
      <Sun size={16} className="text-slate-300" />
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-tight">Set Lat/Lng in Hub</span>
    </div>
  );

  if (!weather) return null;

  const getIcon = (condition: string, size = 20) => {
    const c = condition?.toLowerCase() || '';
    if (c.includes('rain')) return <CloudRain size={size} className="text-indigo-500" />;
    if (c.includes('cloud')) return <Cloud size={size} className="text-slate-400" />;
    if (c.includes('wind')) return <Wind size={size} className="text-emerald-500" />;
    return <Sun size={size} className="text-amber-500" />;
  };

  return (
    <div className="relative">
      <div 
        onClick={() => setShowForecast(!showForecast)}
        className="flex items-center gap-6 px-6 py-4 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all group relative cursor-pointer"
      >
        {isSimulated && (
          <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-indigo-600 text-[8px] font-black text-white rounded-full uppercase tracking-widest shadow-lg">
            AI Simulated
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-50 rounded-xl group-hover:bg-indigo-50 transition-colors">
            {getIcon(weather.condition)}
          </div>
          <div>
            <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{weather.condition}</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Current Sky</p>
          </div>
        </div>

        <div className="h-8 w-px bg-slate-100" />

        <div className="flex items-center gap-3">
          <Thermometer size={18} className="text-rose-500" />
          <div>
            <p className="text-xs font-black text-slate-900">{Math.round(weather.temp)}°C</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Temp</p>
          </div>
        </div>

        <div className="h-8 w-px bg-slate-100" />

        <div className="flex items-center gap-3">
          <Droplets size={18} className="text-indigo-400" />
          <div>
            <p className="text-xs font-black text-slate-900">{weather.humidity}%</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Humidity</p>
          </div>
        </div>

        <div className="ml-2 text-slate-300 group-hover:text-indigo-500 transition-colors">
          {showForecast ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {showForecast && forecast.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 p-6 bg-white rounded-[2rem] border border-slate-100 shadow-2xl z-50 animate-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">5-Day Outlook</h4>
            <div className="px-2 py-1 bg-slate-50 rounded-lg text-[8px] font-black text-slate-400 uppercase">Aggregated 3H Data</div>
          </div>
          <div className="grid grid-cols-5 gap-4">
            {forecast.map((f, i) => (
              <div key={i} className="flex flex-col items-center text-center p-3 rounded-2xl hover:bg-slate-50 transition-colors">
                <span className="text-[9px] font-black text-slate-400 uppercase mb-2">
                  {new Date(f.date).toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <div className="mb-2">
                  {getIcon(f.condition, 24)}
                </div>
                <span className="text-xs font-black text-slate-900">{f.temp}°</span>
                <span className="text-[8px] font-bold text-slate-400 uppercase mt-1 truncate w-full">{f.condition}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WeatherWidget;
