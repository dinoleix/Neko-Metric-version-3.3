import { ai } from './geminiService';

export interface LeakagePillarSnapshot {
  label: string;
  leakage: number;
  actual: number;
  theoretical: number;
  variance: number;
}

export interface LeakageInsightInput {
  scopeLabel: string;
  period: string;
  prevPeriod: string;
  totalRevenue: number;
  totalWastage: number;
  current: LeakagePillarSnapshot[];
  previous: LeakagePillarSnapshot[] | null;
  topItems: { name: string; category: string; theoreticalCost: number; revenue: number }[];
}

export const generateLeakageInsight = async (input: LeakageInsightInput): Promise<string> => {
  const prompt = `
    Act as a restaurant operations cost controller analyzing material leakage
    (leakage % = how much actual COGS spend exceeds theoretical recipe-cost burn)
    for ${input.scopeLabel}, period ${input.period}.

    CURRENT PERIOD — PILLAR BREAKDOWN:
    ${JSON.stringify(input.current.map(p => ({
      pillar: p.label,
      leakagePct: Number(p.leakage.toFixed(1)),
      actualSpendRs: Math.round(p.actual),
      theoreticalSpendRs: Math.round(p.theoretical),
      varianceRs: Math.round(p.variance),
    })))}

    ${input.previous
      ? `PREVIOUS PERIOD (${input.prevPeriod}) FOR COMPARISON:
    ${JSON.stringify(input.previous.map(p => ({
        pillar: p.label,
        leakagePct: Number(p.leakage.toFixed(1)),
        varianceRs: Math.round(p.variance),
      })))}`
      : 'No previous period data available for comparison.'}

    TOTAL REVENUE THIS PERIOD: ₹${Math.round(input.totalRevenue)}
    TOTAL WASTE (₹) THIS PERIOD: ₹${Math.round(input.totalWastage)}

    HIGHEST-VOLUME MENU ITEMS THIS PERIOD, BY THEORETICAL COST (context only — leakage
    itself is only measurable at the pillar level, not per SKU, so do not claim a specific
    item caused the leakage; use this list only to ground hypotheses):
    ${JSON.stringify(input.topItems)}

    TASK: Write a concise analyst note (120-180 words, plain text, no markdown headers) covering:
    1. Which pillar(s) have the highest leakage and how that compares to the previous period
       (up/down, by how much — say clearly if no prior data exists).
    2. Plausible operational causes worth investigating (e.g. portioning, spoilage, theft,
       receiving errors, packaging over-use) — framed as hypotheses to check, not facts.
    3. One concrete next action, prioritized by rupee impact.

    Do not invent numbers that are not present in the data above.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
  });

  return response.text || '';
};
