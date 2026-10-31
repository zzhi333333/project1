/* =========================================================
 * mobile.js —— 移动端专属交互（在 main.js 之后加载）
 *  ① 侧滑抽屉开关（对话记录 + 快捷咨询）
 *  ② 切换视图后重置该视图滚动位置（原 window.scrollTo 对每视图自滚动无效）
 *  ③ 外链交给系统浏览器/下载器（App 内 WebView 只承载本地页面）
 *  ④ 输入框聚焦时滚动到底（配合 adjustResize 兜底）
 * ========================================================= */
(function () {

  /* ---------- ① 抽屉 ---------- */
  var drawer = document.getElementById("drawer");
  var mask = document.getElementById("drawer-mask");
  var toggle = document.getElementById("drawer-toggle");

  function openDrawer() { drawer.classList.add("open"); mask.classList.remove("hidden"); }
  function closeDrawer() { drawer.classList.remove("open"); mask.classList.add("hidden"); }

  toggle.addEventListener("click", function () {
    drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  mask.addEventListener("click", closeDrawer);

  /* 在抽屉里点了会话/场景后自动收起（等点击处理完成） */
  drawer.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    if (e.target.closest(".quick-card") || e.target.closest(".session-item")) {
      setTimeout(closeDrawer, 140);
    }
  });

  /* ---------- ② 视图滚动重置 ---------- */
  var origSwitch = window.APP.switchView;
  window.APP.switchView = function (name) {
    origSwitch(name);
    var v = document.getElementById("view-" + name);
    if (v) v.scrollTop = 0;
    closeDrawer();
  };

  /* ---------- ③ 外链接管 ---------- */
  if (window.BRIDGE && window.BRIDGE.available) {
    document.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      var a = e.target.closest('a[target="_blank"]');
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("http") !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      window.BRIDGE.openUrl(href);
    }, true);
  }

  /* ---------- ④ 键盘弹出兜底 ---------- */
  var input = document.getElementById("consult-input");
  if (input) {
    input.addEventListener("focus", function () {
      setTimeout(function () {
        var box = document.getElementById("chat-box");
        if (box) box.scrollTop = box.scrollHeight;
      }, 320);
    });
  }

  /* ---------- ⑤ 通知：App 环境提示（一次性） ---------- */
  window.addEventListener("load", function () {
    if (window.BRIDGE && window.BRIDGE.available) {
      console.log("[mobile] 原生桥已连接，App 版本 " + window.BRIDGE.version());
    }
  });
})();
