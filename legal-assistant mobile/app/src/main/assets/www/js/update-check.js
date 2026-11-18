/* 检查更新：读 www/version.js（构建/发布时生成）与本地 app-ver 对比，静默失败不打扰 */
(function () {
  function localVer() {
    var el = document.getElementById("app-ver");
    return el ? el.textContent.trim() : "";
  }
  function showResult(msg) {
    var el = document.getElementById("update-result");
    if (el) el.textContent = msg;
    if (window.UIKIT && window.UIKIT.toast) window.UIKIT.toast(msg);
  }
  function compare(a, b) {
    var pa = String(a).split("."), pb = String(b).split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = parseInt(pa[i] || "0", 10), nb = parseInt(pb[i] || "0", 10);
      if (na !== nb) return na - nb;
    }
    return 0;
  }
  function check(silent) {
    var info = window.APP_VERSION_INFO;
    if (!info || !info.version) { if (!silent) showResult("未获取到版本信息（稍后再试）"); return; }
    var local = localVer();
    if (compare(info.version, local) > 0) {
      showResult("新版本 " + info.version + " 可用" + (info.url ? "，下载地址见发布页" : "") + "（当前 " + local + "）");
    } else if (!silent) {
      showResult("已是最新版本 " + local);
    }
  }
  function buildBanner(remote) {
    var b = document.createElement("div");
    b.id = "update-banner";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2500;background:var(--primary-fill,#d8b57a);color:#1a1206;padding:10px 14px;font-size:13.5px;font-weight:600;text-align:center";
    b.textContent = "新版本 " + remote + " 可用——设置 → 关于助手 → 检查更新 查看详情";
    document.body.appendChild(b);
  }
  function autoCheck() {
    var info = window.APP_VERSION_INFO;
    if (!info || !info.version) return;
    var local = localVer();
    if (compare(info.version, local) > 0) {
      /* 横幅只在本会话提示一次（sessionStorage 防重复打扰） */
      try { if (sessionStorage.getItem("update-banner-shown") === info.version) return; sessionStorage.setItem("update-banner-shown", info.version); } catch (e) {}
      buildBanner(info.version);
    }
  }
  window.UPDATE_CHECK = { check: check };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      var btn = document.getElementById("check-update");
      if (btn) btn.addEventListener("click", function () { check(false); });
      try { autoCheck(); } catch (e) {}
    });
  } else {
    var btn = document.getElementById("check-update");
    if (btn) btn.addEventListener("click", function () { check(false); });
    try { autoCheck(); } catch (e) {}
  }
})();
