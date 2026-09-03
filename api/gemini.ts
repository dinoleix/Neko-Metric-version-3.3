import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

// Server-side proxy so the Gemini key never reaches the browser bundle.
// GEMINI_API_KEY (no VITE_ prefix) must be set in Vercel project env vars —
// unprefixed vars are never inlined into client code by Vite.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    return;
  }

  try {
    const { model, contents, config } = req.body ?? {};
    if (!contents) {
      res.status(400).json({ error: 'contents is required' });
      return;
    }

    const client = new GoogleGenAI({ apiKey });
    const result = await client.models.generateContent({
      model: model || 'gemini-1.5-flash',
      contents: Array.isArray(contents) ? contents : [{ role: 'user', parts: [{ text: contents }] }],
      // @google/genai v1 names this `config`. It was previously sent as
      // `generationConfig` (the old SDK's name), which the client silently
      // ignored — so responseMimeType: 'application/json' never took effect
      // and every caller got markdown-fenced JSON back.
      config,
    } as any);

    res.status(200).json({
      text: (result as any).text || '',
      data: (result as any).data,
    });
  } catch (err: any) {
    console.error('Gemini proxy error:', err);
    res.status(500).json({ error: err?.message || 'Gemini request failed' });
  }
}
