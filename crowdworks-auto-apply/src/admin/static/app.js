// 確認ダイアログ（危険な操作）
document.addEventListener("submit", (e) => {
  const msg = e.target.getAttribute("data-confirm");
  if (msg && !window.confirm(msg)) e.preventDefault();
});
// ダッシュボードは 30 秒ごとに自動更新（入力中は更新しない）
if (location.pathname === "/") {
  setInterval(() => {
    const a = document.activeElement;
    if (!a || !["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName)) location.replace("/");
  }, 30000);
}
