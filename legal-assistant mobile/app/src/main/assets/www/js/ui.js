/* =========================================================
 * ui.js —— 全局 UI 小件（v3.4.4 批次三统一）
 *   toast(msg, kind)      轻提示（ok/warn/默认中性）
 *   confirmModal(...)     危险操作统一确认，返回 Promise<boolean>
 *   bindModalBasics()     Esc 关最上层弹窗 + .modal 补 role=dialog/aria-modal
 * 零依赖；加载即接管。样式内联，不依赖两端 css（深底 toast 两端主题均可读）。
 * ========================================================= */
window.UIKIT = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function toast(msg, kind) {
    try {
      var old = document.getElementById("uikit-toast");
      if (old) old.remove();
      var b = document.createElement("div");
      b.id = "uikit-toast";
      b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:26px;z-index:3000;" +
        "padding:9px 16px;border-radius:10px;font-size:13px;max-width:86vw;line-height:1.6;box-shadow:0 6px 24px rgba(0,0,0,.25);" +
        (kind === "warn" ? "background:#2b1c1e;border:1px solid #4a2729;color:#fecaca;"
          : kind === "ok" ? "background:#122620;border:1px solid #2b4a3d;color:#34d399;"
          : "background:#1e2333;border:1px solid #3b4569;color:#e8eaf0;");
      b.textContent = msg;
      document.body.appendChild(b);
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 2400);
    } catch (e) { }
  }

  /* 危险操作确认（此前原生 confirm / 两段武装按钮 / 零确认三种并存，收敛到统一样式） */
  function confirmModal(title, text, okLabel) {
    return new Promise(function (resolve) {
      var m = document.createElement("div");
      m.className = "modal";
      m.style.zIndex = "2500";
      m.innerHTML = '<div class="modal-mask"></div><div class="modal-card" style="width:min(420px,calc(100vw - 40px))">' +
        '<div class="modal-title">' + esc(title || "确认操作") + '</div>' +
        '<div class="modal-body"><div style="font-size:13.5px;line-height:1.8">' + esc(text || "") + '</div></div>' +
        '<div class="modal-foot"><button data-uikit-no>取消</button><button class="primary" data-uikit-yes>' + esc(okLabel || "确认") + '</button></div></div>';
      document.body.appendChild(m);
      function done(v) { m.remove(); resolve(v); }
      m.querySelector(".modal-mask").addEventListener("click", function () { done(false); });
      m.querySelector("[data-uikit-no]").addEventListener("click", function () { done(false); });
      m.querySelector("[data-uikit-yes]").addEventListener("click", function () { done(true); });
    });
  }

  function bindModalBasics() {
    /* 环境守卫：check.js 的 VM 沙箱 document 桩无 querySelectorAll，浏览器全量可用 */
    try {
      /* Esc 关最上层可见弹窗：点其遮罩，复用各弹窗既有关闭逻辑（无遮罩关闭逻辑的弹窗无副作用） */
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        var open = document.querySelectorAll(".modal:not(.hidden)");
        if (!open.length) return;
        var mask = open[open.length - 1].querySelector(".modal-mask");
        if (mask) mask.click();
      });
      /* 可访问性兜底：静态弹窗补 role/aria（此前全项目仅 svgchart 有 aria） */
      document.querySelectorAll(".modal").forEach(function (m) {
        m.setAttribute("role", "dialog");
        m.setAttribute("aria-modal", "true");
      });
    } catch (e) { }
  }

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindModalBasics);
    else bindModalBasics();
  } catch (e) { }

  /* 欢迎引导重现（v4.0.11 用户澄清：要重现的是首次进入的欢迎菜单，不是 splash 动画）——
     清除 first-run 标记并显示 guide-modal；用户点「开始使用」关闭时重新写入标记 */
  function showWelcomeGuide() {
    try { localStorage.removeItem("legal-first-run"); } catch (e) { }
    var gm = document.getElementById("guide-modal");
    if (gm) gm.classList.remove("hidden");
  }
  try {
    var wr = document.getElementById("welcome-replay");
    if (wr) wr.addEventListener("click", showWelcomeGuide);
  } catch (e) { }

  return { toast: toast, confirmModal: confirmModal, bindModalBasics: bindModalBasics, showWelcomeGuide: showWelcomeGuide };
})();
