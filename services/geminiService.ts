import { GoogleGenAI } from "@google/genai";
import { AIModel } from "../types";

// ============================================================================
// CONFIGURATION
// ============================================================================

// ★重要: Cloud Runにデプロイ後、発行されたURLをここに貼り付けてください。
// 例: "https://uspeak-backend-xxxxx-asia-northeast1.a.run.app"
// このURLが空の場合、アプリは「デモモード」としてブラウザから直接APIを叩きます（API KEYが必要）。
const BACKEND_API_URL = ""; 

// Initialize Client-side Gemini (Fallback / Demo Mode)
const clientSideAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generates content using either the Cloud Run Backend (Production) or Client-side SDK (Demo).
 */
export const generateModelResponse = async (
  model: AIModel,
  prompt: string
): Promise<string> => {
  
  // 各モデル用のペルソナ設定を作成
  const isNativeGemini = model.id === 'gemini';
  const systemInstruction = isNativeGemini 
      ? "You are a helpful AI assistant." 
      : `${model.systemPersona} IMPORTANT: You are currently running in a 'Simulation Mode' powered by Google Gemini to demonstrate how this UI works.`;

  try {
    // -----------------------------------------------------------------------
    // MODE A: Backend API Mode (Production)
    // -----------------------------------------------------------------------
    if (BACKEND_API_URL) {
      const response = await fetch(`${BACKEND_API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
          prompt: prompt,
          systemInstruction: systemInstruction 
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || "API_ERROR");
      }

      return data.reply || "No response text generated from backend.";
    }

    // -----------------------------------------------------------------------
    // MODE B: Client-side SDK Mode (Demo / Preview)
    // -----------------------------------------------------------------------
    // バックエンドURLが設定されていない場合は、既存のクライアントサイド処理を行います。
    
    // リトライロジック付きで実行
    return await generateWithRetry(model.name, () => 
      clientSideAi.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      })
    );

  } catch (error) {
    console.error(`Error generating content for ${model.name}:`, error);
    if (error instanceof Error) {
        // API制限のエラーなどをユーザーフレンドリーに表示
        if (error.message.includes("429")) {
          return "混雑のためアクセスが制限されています。少し待ってから再試行してください。";
        }
        return `Error: ${error.message}`;
    }
    return "An unexpected error occurred.";
  }
};

// Helper: Retry logic for client-side calls to handle rate limits
async function generateWithRetry(
    modelName: string, 
    apiCall: () => Promise<any>, 
    retries = 1, 
    delay = 2000
): Promise<string> {
    try {
        const response = await apiCall();
        return response.text || "No response text generated.";
    } catch (error: any) {
        if (retries > 0 && (error.message?.includes("429") || error.message?.includes("503"))) {
            console.warn(`Retrying for ${modelName} in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return generateWithRetry(modelName, apiCall, retries - 1, delay * 2);
        }
        throw error;
    }
}