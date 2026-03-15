import { GoogleGenAI } from "@google/genai";

// Always initialize the client using the named parameter apiKey from process.env.API_KEY.
export const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
