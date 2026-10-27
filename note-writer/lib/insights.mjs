// 売上の集計と、次に何をすれば売上が伸びるかの提案
import { listArticles } from "./article.mjs";
import { getSales, getSettings } from "./store.mjs";

export const currentMonth = (d = new Date()) =>
  new Date(d.getTime() + 9 * 36e5).toISOString().slice(0, 7); // 日本時間の YYYY-MM

// タグごとの売上（そのタグが付いた記事の売上の合計）
function tagRevenue(articles, sales) {
  const byName = Object.fromEntries(articles.map((a) => [a.name, a]));
  const score = {};
  for (const s of sales) {
    const a = byName[s.file];
    if (!a) continue;
    for (const tag of a.tags) score[tag] = (score[tag] || 0) + s.sales * a.price;
  }
  return score;
}

// 売れたタグを多く含むテーマを先に書く。売上データがなければネタ帳の順番どおり
export function rankTopics(topics) {
  const score = tagRevenue(listArticles(), getSales());
  return topics
    .map((t, i) => ({ t, i, s: (t.tags || []).reduce((sum, tag) => sum + (score[tag] || 0), 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

export function dashboard(now = new Date()) {
  const settings = getSettings();
  const articles = listArticles();
  const sales = getSales();
  const month = currentMonth(now);
  const priceOf = Object.fromEntries(articles.map((a) => [a.name, a.price]));

  const perArticle = articles.filter((a) => a.status === "published").map((a) => {
    const rows = sales.filter((s) => s.file === a.name);
    const total = rows.reduce((n, r) => n + r.sales, 0);
    const views = rows.reduce((n, r) => n + r.views, 0);
    const thisMonth = rows.find((r) => r.month === month);
    return {
      name: a.name,
      title: a.title,
      price: a.price,
      url: a.url,
      sales: total,
      views,
      revenue: total * a.price,
      monthSales: thisMonth?.sales || 0,
      conversion: views ? total / views : null,
    };
  });

  const monthGross = sales.filter((s) => s.month === month).reduce((n, s) => n + s.sales * (priceOf[s.file] || 0), 0);
  const jst = new Date(now.getTime() + 9 * 36e5);
  const day = jst.getUTCDate();
  const daysInMonth = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 0)).getUTCDate();
  const monthNet = Math.round(monthGross * (1 - settings.feeRate));
  const pace = Math.round((monthNet / day) * daysInMonth);

  const suggestions = [];
  const paid = perArticle.filter((a) => a.price > 0);
  const shortfall = settings.goalMonthly - pace;
  if (shortfall > 0) {
    const avgPrice = paid.length ? paid.reduce((n, a) => n + a.price, 0) / paid.length : 500;
    const need = Math.ceil(shortfall / (avgPrice * (1 - settings.feeRate)));
    suggestions.push(`今のペースだと目標まで月 ${shortfall.toLocaleString()} 円足りません。平均価格であと ${need} 本分の販売が必要です。`);
  }
  for (const a of paid) {
    if (a.views >= 100 && a.conversion !== null && a.conversion >= 0.05) {
      suggestions.push(`「${a.title}」は購入率 ${(a.conversion * 100).toFixed(1)}% と高いです。価格を上げて試す余地があります。`);
    }
    if (a.views >= 200 && a.sales === 0) {
      suggestions.push(`「${a.title}」は読まれているのに売れていません。有料ラインの直前（無料部分の最後）で、有料部分で得られるものをはっきり書き直してください。`);
    }
  }
  if (paid.length >= 5) {
    suggestions.push(`有料記事が ${paid.length} 本あります。まとめてマガジン（割安セット）にすると、1人あたりの購入額を上げられます。`);
  }
  const tags = Object.entries(tagRevenue(articles, sales)).sort((a, b) => b[1] - a[1]);
  if (tags.length) {
    suggestions.push(`一番売れているタグは「${tags[0][0]}」です。このタグのテーマを優先して生成します。`);
  }
  const failed = articles.filter((a) => a.status === "error");
  for (const a of failed) suggestions.unshift(`「${a.title}」の公開に失敗しています（${a.error}）。記事を開いて確認してください。`);
  const upcoming = articles.filter((a) =>
    a.status === "error" || (["draft", "ready"].includes(a.status) && a.publish_at && Date.parse(a.publish_at) > now));
  const drafts = upcoming.filter((a) => a.status === "draft");
  if (drafts.length) suggestions.push(`確認待ちの下書きが ${drafts.length} 本あります。「公開OK」にしないと予約日に公開されません。`);

  return {
    month,
    goal: settings.goalMonthly,
    monthGross,
    monthNet,
    pace,
    perArticle,
    upcoming,
    suggestions,
  };
}
