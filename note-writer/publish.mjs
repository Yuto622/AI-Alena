// note に記事を投稿する（コマンドライン版。管理画面からも同じ処理を使う）
//
//   node note-writer/publish.mjs --check                 ログインできるかだけ確認
//   node note-writer/publish.mjs articles/xxx.md --draft 下書き保存まで
//   node note-writer/publish.mjs articles/xxx.md         公開まで
//   ... --account uspeak                                  U-Speak Lab のアカウントで実行
//
// 必要な環境変数: NOTE_EMAIL, NOTE_PASSWORD（--account uspeak なら NOTE_USPEAK_EMAIL, NOTE_USPEAK_PASSWORD）
import path from "path";
import { loadArticle, updateArticleMeta } from "./lib/article.mjs";
import { runNote } from "./lib/publisher.mjs";

const args = process.argv.slice(2);
const accountIdx = args.indexOf("--account");
const accountArg = accountIdx >= 0 ? args.splice(accountIdx, 2)[1] : null;
const mode = args.includes("--check") ? "check" : args.includes("--draft") ? "draft" : "publish";
const force = args.includes("--force");
const file = args.find((a) => !a.startsWith("--"));

async function main() {
  if (mode !== "check" && !file) {
    console.error("使い方: node note-writer/publish.mjs <記事.md> [--draft] | --check");
    process.exit(1);
  }
  const article = file ? loadArticle(file) : null;
  const account = accountArg || article?.account || "default";
  const result = await runNote({ account, article, mode, force });
  if (mode === "publish") updateArticleMeta(path.basename(file), { status: "published", url: result.url });
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
