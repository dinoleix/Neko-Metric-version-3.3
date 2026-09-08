import { auth } from './firebase';

/**
 * Compatibility shim: same `ai.models.generateContent` shape every caller in
 * this codebase already uses, but routed through the /api/gemini serverless
 * proxy instead of the browser SDK — the Gemini key now lives server-side
 * only (GEMINI_API_KEY, no VITE_ prefix) and never reaches the client bundle.
 *
 * Every call attaches the signed-in user's Firebase ID token. The proxy used
 * to check nothing about who was calling it — anyone who found the URL could
 * spend the Gemini budget with a bare POST. The server now verifies this
 * token before doing anything else.
 */
export const ai = {
  get models() {
    return {
      generateContent: async (params: { model?: string; contents: string | any[]; config?: any }) => {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          throw new Error('You must be signed in to use AI features.');
        }

        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            model: params.model,
            contents: params.contents,
            config: params.config,
          }),
        });

        // /api/gemini is a Vercel serverless function. `vite dev` does not run
        // those and there is no proxy, so it 404s on localhost — which otherwise
        // surfaces as a bare "request failed (404)" and reads like a broken
        // feature rather than an environment that cannot host it.
        if (res.status === 404) {
          throw new Error(
            'AI is not available on the local dev server: /api/gemini is a Vercel function ' +
            'that vite dev does not run. Use the deployed site, or run `vercel dev` locally.'
          );
        }

        // No hardcoded 401 message here on purpose — the server now
        // distinguishes "your token didn't verify" (401, sign in again) from
        // "the server's own Firebase Admin credentials are missing" (500, a
        // Vercel setup problem) and puts the real reason in the body. A fixed
        // client-side string for any 401 previously overwrote that distinction
        // and told everyone to sign in again even when the fault was ours.
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Gemini request failed (${res.status})`);
        }

        return await res.json();
      }
    };
  }
};
