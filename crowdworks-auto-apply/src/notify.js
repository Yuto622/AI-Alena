/** Slack Incoming Webhook へ通知（未設定なら何もしない） */
export async function notify(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn("[notify] Slack 通知に失敗:", e.message);
  }
}
