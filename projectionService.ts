
import { Type } from "@google/genai";
import { ai } from './geminiService';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { SalesProjection, SalesMonthlySnapshot, Holiday, WeatherForecast, MONTH_NAMES } from './types';
import { fetchForecastFromAPI } from './weatherService';

export const generateSalesProjection = async (
  outletId: string, 
  userId: string, 
  lat: number, 
  lon: number
): Promise<SalesProjection> => {
  try {
    // 1. Fetch Context Data
    const now = new Date();
    const startDate = now.toISOString().split('T')[0];
    const endDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Historical Sales (Last 3 months)
    // BUG-14 fix: increased limit from 24 to 60 (5 years) so in-memory sort always catches the most recent months
    const salesSnapQ = query(
      collection(db, 'sales_snapshots'),
      where('outletId', '==', outletId),
      where('userId', '==', userId),
      limit(60)
    );
    
    // Upcoming Holidays
    const holidayQ = query(
      collection(db, 'holidays'),
      where('userId', '==', userId)
    );

    const [salesSnap, holidaySnap, weatherForecast] = await Promise.all([
      getDocs(salesSnapQ),
      getDocs(holidayQ),
      fetchForecastFromAPI(lat, lon)
    ]);

    const historicalData = salesSnap.docs
      .map(d => d.data() as SalesMonthlySnapshot)
      .sort((a, b) => {
        const yearA = parseInt(a.year);
        const yearB = parseInt(b.year);
        if (yearA !== yearB) return yearB - yearA;
        return MONTH_NAMES.indexOf(b.month) - MONTH_NAMES.indexOf(a.month);
      })
      .slice(0, 3);
      
    const holidays = holidaySnap.docs
      .map(d => d.data() as Holiday)
      .filter(h => h.date >= startDate && h.date <= endDate);

    // 2. Prepare AI Prompt
    const prompt = `
      Act as a Senior Retail Data Scientist. Generate a 5-day sales projection for outlet ${outletId}.
      
      CONTEXT:
      - Historical Performance (Last 3 Months): ${JSON.stringify(historicalData.map(s => ({ month: s.month, year: s.year, gross: (s.posGoodGross || 0) + (s.onlineGoodGross || 0) })))}
      - Upcoming Holidays: ${JSON.stringify(holidays.map(h => ({ date: h.date, name: h.name })))}
      - Weather Forecast: ${JSON.stringify(weatherForecast)}
      - Current Date: ${startDate}

      REQUIREMENTS:
      1. Provide daily revenue projections for the next 5 days.
      2. Consider holiday impact (spikes) and weather impact (rain usually reduces footfall, extreme heat might affect specific categories).
      3. Provide a confidence score (0-1) for each day.
      4. List factors influencing each day's projection.
      5. Provide a brief executive summary (aiInsights).

      Return JSON matching the SalesProjection interface.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            dailyProjections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  projectedRevenue: { type: Type.NUMBER },
                  confidence: { type: Type.NUMBER },
                  factors: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["date", "projectedRevenue", "confidence", "factors"]
              }
            },
            totalProjectedRevenue: { type: Type.NUMBER },
            aiInsights: { type: Type.STRING }
          },
          required: ["dailyProjections", "totalProjectedRevenue", "aiInsights"]
        }
      }
    });

    const result = JSON.parse(response.text);
    return {
      ...result,
      outletId,
      userId,
      generatedAt: Date.now(),
      startDate,
      endDate
    };
  } catch (err) {
    console.error("Failed to generate projection:", err);
    throw err;
  }
};
