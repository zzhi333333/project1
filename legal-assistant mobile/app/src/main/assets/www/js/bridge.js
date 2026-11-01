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
  var activeStreamId = null;   /* 当前进行中的流式请求（配合 AI「⏹ 停止」） */

  window.__brResolve = function (cbId, ok, payload) {
    var p = pending[cbId];
    if (!p) return;
    delete pending[cbId];
    if (cbId === activeStreamId) activeStreamId = null;
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
          if (id === activeStreamId) activeStreamId = null;
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
    /* httpB64(...) → Promise<{status, b64}>：二进制下载（docx 等），b64 为响应体 base64 */
    httpB64: function (method, url, headers, body) {
      return call("httpB64", [method, url, JSON.stringify(headers || {}), body || ""]);
    },
    /* stream("POST", url, headers, body, onChunk) → Promise<{status, text}>，onChunk 收到原始文本块 */
    stream: function (method, url, headers, body, onChunk) {
      var pr = call("stream", [method, url, JSON.stringify(headers || {}), body || ""], onChunk);
      /* 记录活动流 id：stream 的 args 末位即 cbId，由 call 内部分配 —— 这里通过 pending 的最后键获取 */
      var ids = Object.keys(pending);
      activeStreamId = ids[ids.length - 1];
      return pr;
    },
    /* AI「⏹ 停止」：断开当前流式连接；错误信息含 abort，ai.js 会显示「（已停止生成）」 */
    cancelActive: function () {
      var id = activeStreamId;
      if (!id) return;
      activeStreamId = null;
      var p = pending[id];
      if (p) { delete pending[id]; p.reject(new Error("Request aborted (abort)")); }
      try { native.cancel(id); } catch (e) {}
    },
    /* 数据备份导出：原生「另存为」选择器 → Promise<void>，用户取消时 reject({cancelled:true}) */
    exportFile: function (filename, content) {
      return call("exportFile", [filename, content]);
    },
    /* 意见书打印/PDF：调用系统打印服务（打印内容由 @media print 样式裁剪） */
    printDoc: function (jobName) { try { native.printDoc(jobName); } catch (e) {} },
    /* 语音识别（原生 SpeechRecognizer）：识别中间/最终结果回调 __brSpeech，
       结束（完成/出错）回调 __brSpeechEnd(err?, msg?)，详情见 mobile.js */
    speechStart: function () { try { native.speechStart(); } catch (e) {} },
    speechStop: function () { try { native.speechStop(); } catch (e) {} },
    openUrl: function (url) { try { native.openUrl(url); } catch (e) {} },
    toast: function (msg) { try { native.toast(msg); } catch (e) {} },
    version: function () { try { return native.version(); } catch (e) { return "?"; } }
  };
})();
