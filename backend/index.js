import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
const port = process.env.PORT || 8080;

// ★ 必ず Cloud Run の env に設定する
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY が設定されていません");
  // 開発環境での事故防止のため、ここでは落ちないようにするがエラーログを出す
}

const genAI = new GoogleGenerativeAI(apiKey || "");

app.use(cors());
app.use(express.json());

/**
 * POST /api/chat
 * body: { prompt: string, systemInstruction?: string }
 * res : { reply: string }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { prompt, systemInstruction } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    if (!apiKey) {
      return res.status(500).json({ error: "Server misconfiguration: API Key missing" });
    }

    // SystemInstructionがある場合はモデル取得時に設定
    // 速度とコスト重視で gemini-1.5-flash を使用（proより高速）
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction ? {
        parts: [{ text: systemInstruction }],
        role: "model"
      } : undefined
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    res.json({ reply: text });
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: "AI_ERROR", details: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});