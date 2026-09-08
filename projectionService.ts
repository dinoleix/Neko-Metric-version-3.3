
import { Type } from "@google/genai";
import { ai } from './geminiService';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from './firebase';
import { SalesProjection, SalesMonthlySnapshot, DailySalesLog, Holiday, WeatherForecast, MONTH_NAMES, istDateString } from './types';
import { fetchForecastFromAPI } from './weatherService';

export const generateSalesProjection = async (
  outletId: string, 
  userId: string, 
  lat: number, 
  lon: number
): Promise<SalesProjection> => {
  try {
    // 1. Fetch Context Data (dates in IST — see istDateString in types.ts)
    const startDate = istDateString(0);
    const endDate = istDateString(5);

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

    // Recent till activity (last 30 days). The sales CSV only lands monthly, so
    // sales_snapshots.dailyTrend for the current/still-open month is empty —
    // exactly for the recent days a 5-day forecast needs most. daily_sales_logs
    // is what crew submit every day and is therefore the only live signal
    // (see the same reality documented in ExecDashboard.tsx). It is COUNTER
    // ONLY (cash+card+UPI at the till) — delivery-app revenue isn't in it until
    // the CSV lands — so it's kept separate from, not summed with, the monthly
    // gross figures above; the prompt labels it explicitly so the model doesn't
    // conflate till-only recent days with the till+online monthly totals.
    // Dual-leg (ownerId/userId) because older docs may carry only userId.
    const dailyWindowStart = istDateString(-30);
    const dailyWindowEnd = istDateString(-1); // exclude today: still incomplete
    const tillLegQ = (field: 'ownerId' | 'userId') => query(
      collection(db, 'daily_sales_logs'),
      where(field, '==', userId),
      where('date', '>=', dailyWindowStart),
      where('date', '<=', dailyWindowEnd)
    );

    const [salesSnap, holidaySnap, weatherForecast, tillByOwner, tillByUser] = await Promise.all([
      getDocs(salesSnapQ),
      getDocs(holidayQ),
      fetchForecastFromAPI(lat, lon),
      getDocs(tillLegQ('ownerId')),
      getDocs(tillLegQ('userId'))
    ]);

    const seenTillIds = new Set<string>();
    const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyTillHistory = [...tillByOwner.docs, ...tillByUser.docs]
      .map(d => ({ id: d.id, ...d.data() } as DailySalesLog))
      .filter(l => l.outletId === outletId && !seenTillIds.has(l.id!) && seenTillIds.add(l.id!))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(l => ({
        date: l.date,
        weekday: WEEKDAY_NAMES[new Date(`${l.date}T00:00:00Z`).getUTCDay()],
        counterRevenue: l.totalNet
      }));

    const snapshotsByRecency = salesSnap.docs
      .map(d => d.data() as SalesMonthlySnapshot)
      .sort((a, b) => {
        const yearA = parseInt(a.year);
        const yearB = parseInt(b.year);
        if (yearA !== yearB) return yearB - yearA;
        return MONTH_NAMES.indexOf(b.month) - MONTH_NAMES.indexOf(a.month);
      });

    const historicalData = snapshotsByRecency.slice(0, 3);

    const holidays = holidaySnap.docs
      .map(d => d.data() as Holiday)
      .filter(h => h.date >= startDate && h.date <= endDate);

    // 2. Prepare AI Prompt
    const prompt = `
      Act as a Senior Retail Data Scientist. Generate a 5-day sales projection for outlet ${outletId}.

      CONTEXT:
      - Historical Performance (Last 3 Months, total gross = counter + delivery-app): ${JSON.stringify(historicalData.map(s => ({ month: s.month, year: s.year, gross: (s.posGoodGross || 0) + (s.onlineGoodGross || 0) })))}
      - Recent Counter/Till Revenue (last 30 days, by date with weekday — COUNTER ONLY: cash+card+UPI collected at the till, does NOT include Zomato/Swiggy/delivery-app revenue, which only appears in the monthly figures above once the CSV is uploaded): ${JSON.stringify(dailyTillHistory)}
      - Upcoming Holidays: ${JSON.stringify(holidays.map(h => ({ date: h.date, name: h.name })))}
      - Weather Forecast: ${JSON.stringify(weatherForecast)}
      - Current Date: ${startDate}

      REQUIREMENTS:
      1. Provide daily revenue projections (total: counter + delivery-app) for the next 5 days.
      2. Use the Recent Counter/Till Revenue series to infer day-of-week seasonality (e.g. weekends vs weekdays) and short-term momentum (is the till trending up or down over the last 1-2 weeks) — remember it under-represents true daily total since delivery-app revenue is excluded from it, so scale/blend it against the monthly totals rather than treating it as the full picture.
      3. Consider holiday impact (spikes) and weather impact (rain usually reduces footfall, extreme heat might affect specific categories).
      4. Provide a confidence score (0-1) for each day.
      5. List factors influencing each day's projection.
      6. Provide a brief executive summary (aiInsights).

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
