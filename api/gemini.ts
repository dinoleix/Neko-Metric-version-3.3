import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Server-side proxy so the Gemini key never reaches the browser bundle.
// GEMINI_API_KEY (no VITE_ prefix) must be set in Vercel project env vars —
// unprefixed vars are never inlined into client code by Vite.

/**
 * Lazy singleton: a warm Vercel function instance can serve several
 * invocations, and calling initializeApp() a second time throws.
 *
 * FIREBASE_PRIVATE_KEY needs the \n un-escaped — Vercel's env var UI stores a
 * single line, so the real PEM's newlines have to be entered as literal `\n`
 * and restored here, or the key fails to parse.
 */
function adminApp() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin credentials are not configured on the server');
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Require a real, verified Firebase sign-in. Previously nothing checked who
  // — or whether anyone — was calling this: any POST with a body reached the
  // Gemini API on this project's key. A bare fetch to the URL with no header
  // now gets rejected before it costs anything.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  // Two failure modes were previously collapsed into the same 401 "Sign in
  // required", which made a server misconfiguration look identical to a real
  // expired session — adminApp() throwing on missing/malformed Vercel env vars
  // landed in the same catch as a genuinely bad token, so every caller got told
  // to sign in again regardless of which one it actually was.
  let app;
  try {
    app = adminApp();
  } catch (err: any) {
    console.error('Gemini proxy: admin credentials not configured:', err);
    res.status(500).json({
      error: 'AI is not set up on the server yet — Firebase Admin credentials are missing ' +
        'or invalid in Vercel (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).',
    });
    return;
  }

  try {
    await getAuth(app).verifyIdToken(token);
  } catch (err) {
    console.error('Gemini proxy: token verification failed:', err);
    res.status(401).json({ error: 'Sign in required' });
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
