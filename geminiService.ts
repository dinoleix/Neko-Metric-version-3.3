/**
 * Compatibility shim: same `ai.models.generateContent` shape every caller in
 * this codebase already uses, but routed through the /api/gemini serverless
 * proxy instead of the browser SDK — the Gemini key now lives server-side
 * only (GEMINI_API_KEY, no VITE_ prefix) and never reaches the client bundle.
 */
export const ai = {
  get models() {
    return {
      generateContent: async (params: { model?: string; contents: string | any[]; config?: any }) => {
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: params.model,
            contents: params.contents,
            config: params.config,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Gemini request failed (${res.status})`);
        }

        return await res.json();
      }
    };
  }
};
