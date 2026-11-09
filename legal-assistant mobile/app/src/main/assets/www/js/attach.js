/* =========================================================
 * attach.js —— 附件上传（v3.4.5，零依赖，三端同源）
 * 职责：文件选择 → 类型分发提取（zipread.js）→ 大小/字数上限 → 统一结果对象
 *   ATTACH.pick(accept, multiple)        打开系统文件选择（移动端走既有 onShowFileChooser 原生桥）
 *   ATTACH.extractFile(file)             Promise<{name, kind, text|dataUrl, truncated, error}>
 *   ATTACH.appendCaseText(inputEl, res)  把提取文本以【附件：名称】定界追加进案情输入框
 * 红线：文件仅本机内存解析，不上传；文本超过 2 万字截断并明示；图片不落 localStorage。
 * 上限：文件 8MB（docx/xlsx/文本），图片 10MB（dataURL 供 vision/预览）。
 * ========================================================= */
window.ATTACH = (function () {
  var MAX_FILE = 8 * 1024 * 1024;
  var MAX_IMG = 10 * 1024 * 1024;
  var MAX_TEXT = 20000;
  var IMG_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

  function isImage(name) { return IMG_RE.test(String(name || "")); }

  function pick(accept) {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      if (accept) input.accept = accept;
      input.style.display = "none";
      document.body.appendChild(input);
      var done = false;
      input.addEventListener("change", function () {
        done = true;
        var f = input.files && input.files[0] ? input.files[0] : null;
        input.remove();
        resolve(f);
      });
      /* 取消选择：change 不触发——焦点回归即清理（延迟给原生选择器留时间） */
      setTimeout(function () {
        window.addEventListener("focus", function once() {
          window.removeEventListener("focus", once);
          setTimeout(function () {
            if (!done && input.parentNode) { input.remove(); resolve(null); }
          }, 800);
        }, { once: true });
      }, 200);
      input.click();
    });
  }

  function readBytes(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(new Error("文件读取失败")); };
      fr.readAsArrayBuffer(file);
    });
  }
  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error("文件读取失败")); };
      fr.readAsDataURL(file);
    });
  }

  function extractFile(file) {
    if (!file) return Promise.resolve(null);
    if (isImage(file.name)) {
      if (file.size > MAX_IMG) return Promise.resolve({ name: file.name, kind: "image", error: "图片超过 10MB，请压缩后再试。" });
      return readDataUrl(file).then(function (dataUrl) {
        return { name: file.name, kind: "image", size: file.size, dataUrl: dataUrl, truncated: false };
      });
    }
    if (file.size > MAX_FILE) return Promise.resolve({ name: file.name, kind: "file", error: "文件超过 8MB——请拆分或仅粘贴关键部分。" });
    return readBytes(file).then(function (u8) {
      var r = window.ZIPREAD.extract(file.name, u8);
      var text = String(r.text || "").trim();
      var truncated = false;
      if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); truncated = true; }
      if (!text) return { name: file.name, kind: r.kind, error: "未提取到文本——可能是不含正文层的文件，请直接复制粘贴。" };
      return { name: file.name, kind: r.kind, text: text, truncated: truncated, size: file.size };
    }).catch(function (e) {
      return { name: file.name, kind: "file", error: (e && e.message || e) };
    });
  }

  /* 提取文本追加进案情输入框（带定界头，随粘贴文本走同一条脱敏/核验管线） */
  function appendCaseText(inputEl, res) {
    if (!inputEl || !res || !res.text) return;
    var head = "\n\n【附件：" + res.name + "（" + (res.kind === "xlsx" ? "表格" : res.kind === "docx" ? "Word 文档" : "文本文档") + "）】\n";
    inputEl.value += (inputEl.value ? "\n" : "") + head + res.text + (res.truncated ? "\n（附件过长已截断至 2 万字）" : "");
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return {
    pick: pick, extractFile: extractFile, appendCaseText: appendCaseText,
    isImage: isImage, MAX_TEXT: MAX_TEXT
  };
})();
