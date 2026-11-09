/* =========================================================
 * diag.js —— 本机诊断（v3.5.2 批次 G，零依赖，三端同源）
 * 1) 全局错误 ring buffer：onerror/unhandledrejection → 最近 20 条
 *    （入队前过 AI.redactPII——错误消息可能含案情文本）
 * 2) 设置 → 隐私与数据：「复制诊断信息」= 版本 + UA + 存储占用 + 最近错误
 *    用户报障直接粘贴，四要素齐备；不联网上报，仅本机。
 * ========================================================= */
window.DIAG = (function () {
  var MAX = 20;
  var KEY = "legal-diag-errors";
  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
  }
  function save(list) {
    try { sessionStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { }
  }
  function redact(s) {
    try { if (window.AI && AI.redactPII) return AI.redactPII(String(s)); } catch (e) { }
    return String(s);
  }
  function push(kind, msg, src, line) {
    try {
      var list = load();
      list.push({ t: new Date().toISOString(), kind: kind, msg: redact(String(msg || "")).slice(0, 300), src: String(src || "").split("/").pop() || "", line: line || 0 });
      save(list);
    } catch (e) { }
  }
  function bind() {
    try {
      window.addEventListener("error", function (e) {
        push("error", e.message, e.filename, e.lineno);
      });
      window.addEventListener("unhandledrejection", function (e) {
        var r = e.reason;
        push("rejection", r && r.message ? r.message : String(r), "", 0);
      });
    } catch (e) { }
  }
  function recent(n) {
    return load().slice(-(n || 5));
  }
  /* 诊断文本：四要素（版本/UA/存储/最近错误），一键复制用 */
  function text() {
    var lines = ["== 法律咨询助手 诊断信息 ==", "时间：" + new Date().toLocaleString("zh-CN")];
    try {
      if (window.BRIDGE && BRIDGE.version) lines.push("App 版本：" + BRIDGE.version());
    } catch (e) { }
    lines.push("UA：" + navigator.userAgent);
    try {
      if (window.STORE && STORE.stats) {
        var st = STORE.stats();
        lines.push("数据版本：v" + st.version);
        st.rows.forEach(function (r) { if (r.kb > 0) lines.push("  " + r.name + "：" + r.kb + " KB" + (r.count ? "（" + r.count + " 条）" : "")); });
      }
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (est) {
          if (est && est.usage != null) {
            var extra = "\n存储配额估算：已用 " + Math.round(est.usage / 1024) + " KB / " + Math.round((est.quota || 0) / 1048576) + " MB";
            try { navigator.clipboard.writeText(text() + extra); } catch (e) { }
          }
        });
      }
    } catch (e) { }
    var errs = recent(5);
    lines.push("最近错误（本会话，最多 5 条，已脱敏）：" + (errs.length ? "" : "无"));
    errs.forEach(function (e) { lines.push("  [" + e.kind + "] " + e.msg + (e.src ? "（" + e.src + ":" + e.line + "）" : "") + " " + e.t.slice(11, 19)); });
    return lines.join("\n");
  }
  function copyDiag() {
    var t = text();
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        if (window.UIKIT) UIKIT.toast("诊断信息已复制，粘贴给维护者即可", "ok");
      } catch (e) { }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { if (window.UIKIT) UIKIT.toast("诊断信息已复制，粘贴给维护者即可", "ok"); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }
  function init() {
    bind();
    try {
      document.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("#diag-copy") : null;
        if (b) { copyDiag(); }
      });
    } catch (e) { }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  return { push: push, recent: recent, text: text, copyDiag: copyDiag };
})();
