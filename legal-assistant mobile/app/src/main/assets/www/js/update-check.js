/* 检查更新 = 跳转发布页（2026-11-19 改造：原「本地双值比较」两值同包必等、永报已是最新且不通网，
 * 属名不副实的假检查——现改为诚实口径：点击直接打开发布页，用户自行核对下载） */
(function () {
  /* 发布页地址（改这里即可换发布位置） */
  var RELEASE_URL = "https://github.com/zzhi333333/project1/releases";

  function localVer() {
    var el = document.getElementById("app-ver");
    return el ? el.textContent.trim() : "";
  }
  function showResult(msg) {
    var el = document.getElementById("update-result");
    if (el) el.textContent = msg;
    if (window.UIKIT && window.UIKIT.toast) window.UIKIT.toast(msg);
  }
  function openReleasePage() {
    /* 移动端优先原生桥（mobile.js GitHub 链接同款机制）→ 系统浏览器；
     * 桥不可用时降级主框架导航（MainActivity shouldOverrideUrlLoading 拦截 http(s) 转系统浏览器）；
     * 网页版新标签打开，不导走当前页。window.open 在 WebView 默认被丢弃，故移动端不走该分支 */
    try {
      if (window.BRIDGE && window.BRIDGE.openUrl) { window.BRIDGE.openUrl(RELEASE_URL); return; }
    } catch (e) {}
    if (location.protocol === "file:" || /wv\)/.test(navigator.userAgent)) {
      location.href = RELEASE_URL;
    } else {
      try { window.open(RELEASE_URL, "_blank"); } catch (e) { location.href = RELEASE_URL; }
    }
  }
  function check() {
    /* 版本号仅展示参考；是否有新版由用户在发布页自行核对（本应用不做联网检查） */
    showResult("当前版本 " + localVer() + "，正在打开发布页…");
    openReleasePage();
  }
  window.UPDATE_CHECK = { check: check, openReleasePage: openReleasePage, RELEASE_URL: RELEASE_URL };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      var btn = document.getElementById("check-update");
      if (btn) btn.addEventListener("click", function () { check(); });
    });
  } else {
    var btn = document.getElementById("check-update");
    if (btn) btn.addEventListener("click", function () { check(); });
  }
})();
