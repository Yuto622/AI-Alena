// データの置き場所。ローカルでは note-writer/ そのもの、Cloud Run では DATA_DIR（Cloud Storage をマウント）
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.DATA_DIR || APP_DIR;

export const paths = {
  articles: path.join(DATA_DIR, "articles"),
  auth: path.join(DATA_DIR, ".auth"),
  out: path.join(DATA_DIR, "out"),
  published: path.join(DATA_DIR, "published.json"),
  sales: path.join(DATA_DIR, "sales.json"),
  settings: path.join(DATA_DIR, "settings.json"),
  topics: path.join(DATA_DIR, "topics.json"),
  profile: path.join(DATA_DIR, "profile.md"),
  cta: path.join(DATA_DIR, "cta"),
};

// 初回起動時、空のデータ置き場に同梱の記事・CTA をコピーする
export function seedDataDir() {
  if (DATA_DIR === APP_DIR) return;
  for (const dir of ["articles", "cta"]) {
    const dest = path.join(DATA_DIR, dir);
    if (fs.existsSync(dest)) continue;
    fs.cpSync(path.join(APP_DIR, dir), dest, { recursive: true });
  }
  for (const file of ["topics.json", "profile.md"]) {
    const dest = path.join(DATA_DIR, file);
    if (!fs.existsSync(dest) && fs.existsSync(path.join(APP_DIR, file))) {
      fs.copyFileSync(path.join(APP_DIR, file), dest);
    }
  }
}
