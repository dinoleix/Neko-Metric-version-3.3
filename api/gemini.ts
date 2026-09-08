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
 * One env var, FIREBASE_SERVICE_ACCOUNT, holding the raw service-account JSON
 * verbatim. The original design split this into three separate fields
 * (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) with
 * the private key's embedded newlines re-escaped as literal `\n` for Vercel's
 * single-line UI — that's exactly the kind of hand-transcription a private
 * key is the worst possible value to go through, since one dropped or
 * mismatched character fails silently. Pasting the whole JSON blob once has
 * one place to get wrong instead of three.
 */
function adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  }
  let parsed: { project_id?: string; client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }
  const { project_id: projectId, client_email: clientEmail, private_key: privateKey } = parsed;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email, or private_key');
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
      error: `AI is not set up on the server yet — ${err?.message || 'FIREBASE_SERVICE_ACCOUNT is missing or invalid'} in Vercel.`,
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
