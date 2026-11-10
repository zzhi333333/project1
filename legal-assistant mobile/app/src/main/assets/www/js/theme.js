/* =========================================================
 * theme.js —— 主题切换（v3.6.2 自 index.html 内联脚本外部化）
 * 外部化原因：批次 G 的 CSP「default-src 'self'」无 script-src 指令，
 * 内联 <script> 被浏览器拒绝执行——主题切换自 v3.5.2 起在
 * node server.js 部署的 web 场景静默失效（P0-②）。
 * 默认跟随系统，手动选择存 localStorage（legal-theme）覆盖；
 * 移动端无 #theme-toggle 按钮时仅应用已存主题（安全早退）。
 * ========================================================= */
(function () {
  var btn = document.getElementById("theme-toggle");
  var KEY = "legal-theme";
  function apply(t) {
    var de = document.documentElement;
    if (!de) return;   /* check.js VM 沙箱 document 桩无 documentElement（同 ui.js 守卫先例） */
    if (t) de.setAttribute("data-theme", t);
    else de.removeAttribute("data-theme");
    if (!btn) return;
    var use = btn.querySelector("use");
    if (use) use.setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
    btn.title = t === "dark" ? "切换到浅色模式" : "切换到深色模式";
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
  apply(saved === "dark" || saved === "light" ? saved : null);
  if (!btn) return;
  btn.addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    var sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var next = cur === "dark" ? "light" : cur === "light" ? "dark" : (sysDark ? "light" : "dark");
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    apply(next);
  });
})();
