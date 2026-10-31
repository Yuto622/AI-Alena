// スライド画像とナレーションから、縦長のショート動画（1080×1920・MP4）を作る。
// - ナレーションは Google Cloud の音声合成（Text-to-Speech）。月100万文字まで無料なので、1日1本なら0円
//   Cloud Run 上では、サービスの実行アカウントでそのまま呼べる（キー不要）
// - 動画にするのは ffmpeg（npm の ffmpeg-static。サーバーに別途入れる必要なし）
// 音声合成に失敗したら、ナレーションなし（無音・1枚4秒）で作る
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { createRequire } from "module";
import { getSettings } from "./store.mjs";

const require = createRequire(import.meta.url);
const TTS = process.env.TTS_API_BASE || "https://texttospeech.googleapis.com";

function run(args) {
  const ffmpeg = require("ffmpeg-static");
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !/Duration:/.test(stderr)) return reject(new Error(`ffmpeg: ${String(stderr).split("\n").slice(-4).join(" ")}`));
      resolve(String(stderr));
    });
  });
}

// 音声ファイルの長さ（秒）
async function duration(file) {
  const out = await run(["-hide_banner", "-i", file]);
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// Cloud Run の実行アカウントのアクセストークン（ローカルでは GOOGLE_ACCESS_TOKEN）
async function googleToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) throw new Error("Google のアクセストークンを取れません（Cloud Run の外では音声合成を使えません）");
  return (await res.json()).access_token;
}

export async function synthesize(text, file) {
  const voice = getSettings().ttsVoice || "ja-JP-Neural2-B";
  const res = await fetch(`${TTS}/v1/text:synthesize`, {
    method: "POST",
    headers: { authorization: `Bearer ${await googleToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "ja-JP", name: voice },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.1 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`音声合成 ${res.status}: ${json.error?.message || JSON.stringify(json).slice(0, 200)}`);
  fs.writeFileSync(file, Buffer.from(json.audioContent, "base64"));
}

// images：スライドの JPEG（1080×1920）、narration：スライドごとの読み上げ文。dir に video.mp4 を作る
export async function makeVideo(dir, images, narration = []) {
  const clips = [];
  let voiced = true;
  for (const [i, img] of images.entries()) {
    let audio = null;
    let seconds = 4;
    if (voiced && narration[i]) {
      try {
        audio = path.join(dir, `${i + 1}.mp3`);
        await synthesize(narration[i], audio);
        seconds = (await duration(audio)) + 0.5;
      } catch (e) {
        console.error(`ナレーションなしで作ります：${e.message}`);
        voiced = false;
        audio = null;
        seconds = 4;
      }
    }
    clips.push({ img: path.join(dir, img), audio, seconds: Math.min(Math.max(seconds, 2.5), 30) });
  }
  // 途中で音声合成に失敗したら、全部ナレーションなしにそろえる
  if (!voiced) for (const c of clips) Object.assign(c, { audio: null, seconds: 4 });

  const args = ["-hide_banner", "-y"];
  // 画像は1枚ずつ渡し、zoompan で必要なフレーム数に伸ばす（-loop にすると zoompan がフレームを増やしすぎる）
  for (const c of clips) args.push("-i", c.img);
  for (const c of clips) {
    if (c.audio) args.push("-i", c.audio);
    else args.push("-f", "lavfi", "-t", c.seconds.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
  }
  const n = clips.length;
  const filters = [];
  clips.forEach((c, i) => {
    // 画像は少しずつ寄る（静止画だけより見やすい）。音声は長さをそろえる
    filters.push(`[${i}:v]scale=1080:1920,setsar=1,zoompan=z='min(zoom+0.0006,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(c.seconds * 30)}:s=1080x1920:fps=30,format=yuv420p[v${i}]`);
    filters.push(`[${n + i}:a]aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=${c.seconds.toFixed(2)},atrim=duration=${c.seconds.toFixed(2)}[a${i}]`);
  });
  filters.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[v][a]`);
  const out = path.join(dir, "video.mp4");
  args.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out);
  await run(args);
  if (!fs.existsSync(out) || fs.statSync(out).size < 10000) throw new Error("動画を作れませんでした");
  return { file: out, seconds: clips.reduce((t, c) => t + c.seconds, 0), voiced };
}
