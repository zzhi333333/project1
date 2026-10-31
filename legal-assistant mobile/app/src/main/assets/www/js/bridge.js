/* =========================================================
 * bridge.js —— 原生桥接层（仅 App 内有效）
 * 安卓壳通过 addJavascriptInterface 注入 window.AndroidBridge：
 *   http(method, url, headersJson, body, cbId)   一次性请求
 *   stream(method, url, headersJson, body, cbId) SSE 流式请求
 *   openUrl(url) / toast(msg) / version()
 * 本模块把它们包装成 Promise：window.BRIDGE.http / stream
 * 回调约定：原生调用 window.__brChunk / window.__brResolve
 * 在桌面浏览器打开本页面时 window.AndroidBridge 不存在 → available=false，
 * ai.js / online.js 会自动回退到原桌面逻辑（本地代理）。
 * ========================================================= */
window.BRIDGE = (function () {
  var native = window.AndroidBridge;
  if (!native) return { available: false };

  var seq = 0;
  var pending = {};

  window.__brResolve = function (cbId, ok, payload) {
    var p = pending[cbId];
    if (!p) return;
    delete pending[cbId];
    payload = payload || {};
    if (ok) p.resolve(payload);
    else p.reject(new Error(payload.msg || ("请求失败（status=" + payload.status + "）")));
  };

  window.__brChunk = function (cbId, text) {
    var p = pending[cbId];
    if (p && p.onChunk && text) p.onChunk(String(text));
  };

  function call(fnName, args, onChunk) {
    return new Promise(function (resolve, reject) {
      var id = "cb" + (++seq) + "_" + Date.now();
      pending[id] = { resolve: resolve, reject: reject, onChunk: onChunk || null };
      try {
        native[fnName].apply(native, args.concat([id]));
      } catch (e) {
        delete pending[id];
        reject(e);
      }
      /* 兜底：桥无响应时避免 Promise 悬挂（原生侧有超时，此处再加一层） */
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          reject(new Error("原生网络请求超时（无响应）"));
        }
      }, 200000);
    });
  }

  return {
    available: true,
    /* http("GET"/"POST", url, headers, body) → Promise<{status, text}> */
    http: function (method, url, headers, body) {
      return call("http", [method, url, JSON.stringify(headers || {}), body || ""]);
    },
    /* stream("POST", url, headers, body, onChunk) → Promise<{status, text}>，onChunk 收到原始文本块 */
    stream: function (method, url, headers, body, onChunk) {
      return call("stream", [method, url, JSON.stringify(headers || {}), body || ""], onChunk);
    },
    openUrl: function (url) { try { native.openUrl(url); } catch (e) {} },
    toast: function (msg) { try { native.toast(msg); } catch (e) {} },
    version: function () { try { return native.version(); } catch (e) { return "?"; } }
  };
})();
