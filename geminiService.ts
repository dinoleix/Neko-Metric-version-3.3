import { GoogleGenAI } from "@google/genai";

let aiInstance: any = null;

export function getGeminiAI(): any {
  if (!aiInstance) {
    let apiKey = "";
    try {
      apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
      if (!apiKey && typeof process !== 'undefined' && process.env) {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
      }
    } catch (e) {
      // Ignore errors from environment variable access
    }

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in your environment settings.");
    }
    try {
      aiInstance = new GoogleGenAI({ apiKey });
    } catch (err: any) {
      console.error("Failed to initialize GoogleGenAI:", err);
      // If "Illegal constructor" happens, it might be due to some environment issue
      throw err;
    }
  }
  return aiInstance;
}

/**
 * Compatibility shim for older code that expects an 'ai.models.generateContent' interface.
 */
export const ai = {
  get models() {
    return {
      generateContent: async (params: { model?: string; contents: string | any[]; config?: any }) => {
        const client = getGeminiAI();
        const modelName = params.model || "gemini-1.5-flash";
        
        // The new SDK uses client.models.generateContent
        const result = await client.models.generateContent({
          model: modelName,
          contents: Array.isArray(params.contents) ? params.contents : [{ role: 'user', parts: [{ text: params.contents }] }],
          generationConfig: params.config
        });
        
        // Ensure we return an object that satisfies GenerateContentResponse expected by Uploader.tsx
        return {
          text: result.text || "",
          data: (result as any).data,
          functionCalls: (result as any).functionCalls,
          executableCode: (result as any).executableCode,
          codeExecutionResult: (result as any).codeExecutionResult,
          response: result
        };
      }
    };
  }
};
