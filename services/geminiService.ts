import { GoogleGenAI } from "@google/genai";
import { AIModel } from "../types";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generates content using Gemini.
 * NOTE: Since we cannot securely hold client-side keys for 8 different providers in this demo environment,
 * we use Gemini to *simulate* the responses of other models by using system instructions (Personas).
 * In a real backend production app, you would route these to their respective official SDKs.
 */
export const generateModelResponse = async (
  model: AIModel,
  prompt: string
): Promise<string> => {
  try {
    const isNativeGemini = model.id === 'gemini';
    
    // For the native Gemini card, we use the standard setup.
    // For others, we inject a system persona to simulate the style/tone.
    const systemInstruction = isNativeGemini 
      ? "You are a helpful AI assistant." 
      : `${model.systemPersona} IMPORTANT: You are currently running in a 'Simulation Mode' powered by Google Gemini to demonstrate how this UI works.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash', // Using Flash for speed and efficiency in parallel requests
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      }
    });

    return response.text || "No response text generated.";

  } catch (error) {
    console.error(`Error generating content for ${model.name}:`, error);
    if (error instanceof Error) {
        return `Error: ${error.message}`;
    }
    return "An unexpected error occurred.";
  }
};