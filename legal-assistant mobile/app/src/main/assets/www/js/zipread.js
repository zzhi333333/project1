/* =========================================================
 * zipread.js —— 零依赖 ZIP 读取器 + 纯 JS inflate（附件升级核心件）
 * 用途：浏览器端直接解析 docx（word/document.xml）与 xlsx（sharedStrings+sheet），
 *       离线双击 / 本地代理 / 移动 WebView 三端通用——不依赖 server.js 的 Node zlib。
 * 红线：零依赖（不引入任何库）；文件仅在本机内存解析，不上传。
 * 结构：
 *   inflateRaw(u8)            RFC1951 raw DEFLATE 解压（puff 风格：stored/fixed/dynamic）
 *   unzip(u8, name)           按中央目录取条目（method 0=stored / 8=deflate）
 *   docxToText(u8)            word/document.xml → 纯文本（段落/表格行，与 server.js 同规则+换行增强）
 *   xlsxToTsv(u8)             sharedStrings + 第一个 sheet → TSV
 *   utf8Decode(u8)            TextDecoder 优先，缺省时手写 UTF-8 解码（旧 WebView 兜底）
 * ========================================================= */
window.ZIPREAD = (function () {
  /* ---------------- UTF-8 解码 ---------------- */
  function utf8Decode(u8) {
    try {
      if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(u8);
    } catch (e) { }
    /* 手写 UTF-8（旧 WebView 兜底）：非法序列按 U+FFFD */
    var out = "", i = 0;
    while (i < u8.length) {
      var b = u8[i];
      if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
      else if (b < 0xE0) { out += String.fromCharCode(((b & 0x1F) << 6) | (u8[i + 1] & 0x3F)); i += 2; }
      else if (b < 0xF0) {
        out += String.fromCharCode(((b & 0x0F) << 12) | ((u8[i + 1] & 0x3F) << 6) | (u8[i + 2] & 0x3F)); i += 3;
      } else {
        var cp = ((b & 0x07) << 18) | ((u8[i + 1] & 0x3F) << 12) | ((u8[i + 2] & 0x3F) << 6) | (u8[i + 3] & 0x3F);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        i += 4;
      }
    }
    return out;
  }

  /* ---------------- 纯 JS inflate（RFC1951）----------------
     puff 风格：Huffman 表构建 + 逐符号解码。仅用于可信的本机文档，不做恶意流加固。 */
  function inflateRaw(u8) {
    var pos = 0;                      /* 位读取游标（bit） */
    function bits(need) {
      var val = 0;
      for (var i = 0; i < need; i++) {
        var byte = u8[pos >> 3];
        if (byte === undefined) throw new Error("inflate: 输入提前结束");
        val |= ((byte >> (pos & 7)) & 1) << i;
        pos++;
      }
      return val;
    }
    /* 由码长表构建 Huffman 解码表：counts[长度] 与按长度排序的符号 */
    function buildTable(lengths) {
      var counts = [], i;
      for (i = 0; i <= 15; i++) counts[i] = 0;
      for (i = 0; i < lengths.length; i++) counts[lengths[i]]++;
      counts[0] = 0;
      var offs = [0];
      for (i = 1; i <= 15; i++) offs[i] = offs[i - 1] + counts[i - 1];
      var symbols = new Array(lengths.length);
      for (i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
      return { counts: counts, symbols: symbols };
    }
    function decode(h) {
      var code = 0, first = 0, index = 0, len;
      for (len = 1; len <= 15; len++) {
        code |= bits(1);
        var count = h.counts[len];
        if (code - count < first) return h.symbols[index + (code - first)];
        index += count;
        first += count;
        first <<= 1;
        code <<= 1;
      }
      throw new Error("inflate: 非法 Huffman 码");
    }
    var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var out = [];
    var fixedLit = null, fixedDist = null;
    function block(hlit, hdist, litH, distH) {
      for (;;) {
        var sym = decode(litH);
        if (sym < 256) out.push(sym);
        else if (sym === 256) return;
        else {
          sym -= 257;
          if (sym >= 29) throw new Error("inflate: 非法长度符号");
          var length = LBASE[sym] + (LEXT[sym] ? bits(LEXT[sym]) : 0);
          var dsym = decode(distH);
          if (dsym >= 30) throw new Error("inflate: 非法距离符号");
          var dist = DBASE[dsym] + (DEXT[dsym] ? bits(DEXT[dsym]) : 0);
          var from = out.length - dist;
          if (from < 0) throw new Error("inflate: 距离越界");
          for (var k = 0; k < length; k++) out.push(out[from + k]);
        }
      }
    }
    for (;;) {
      var last = bits(1);
      var type = bits(2);
      if (type === 0) {
        /* stored：跳到字节边界，读 LEN/NLEN，原样拷贝 */
        if (pos & 7) pos += 8 - (pos & 7);
        var p = pos >> 3;
        var len = u8[p] | (u8[p + 1] << 8);
        if (p + 4 + len > u8.length) throw new Error("inflate: stored 长度越界");
        for (var s = 0; s < len; s++) out.push(u8[p + 4 + s]);
        pos = (p + 4 + len) << 3;
      } else if (type === 1) {
        /* fixed */
        if (!fixedLit) {
          var fl = new Array(288), fd = new Array(30), i;
          for (i = 0; i < 144; i++) fl[i] = 8;
          for (i = 144; i < 256; i++) fl[i] = 9;
          for (i = 256; i < 280; i++) fl[i] = 7;
          for (i = 280; i < 288; i++) fl[i] = 8;
          for (i = 0; i < 30; i++) fd[i] = 5;
          fixedLit = buildTable(fl); fixedDist = buildTable(fd);
        }
        block(288, 30, fixedLit, fixedDist);
      } else if (type === 2) {
        /* dynamic */
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        var clens = new Array(19);
        for (var c = 0; c < 19; c++) clens[c] = 0;
        for (var c2 = 0; c2 < hclen; c2++) clens[ORDER[c2]] = bits(3);
        var clH = buildTable(clens);
        var lens = [];
        while (lens.length < hlit + hdist) {
          var sym2 = decode(clH);
          if (sym2 < 16) lens.push(sym2);
          else if (sym2 === 16) {
            if (!lens.length) throw new Error("inflate: 重复无前值");
            var prev = lens[lens.length - 1], rep = 3 + bits(2);
            while (rep--) lens.push(prev);
          } else if (sym2 === 17) { var z1 = 3 + bits(3); while (z1--) lens.push(0); }
          else { var z2 = 11 + bits(7); while (z2--) lens.push(0); }
        }
        if (lens.length > hlit + hdist) lens.length = hlit + hdist;
        var litLens = lens.slice(0, hlit), distLens = lens.slice(hlit);
        if (distLens.every(function (v) { return v === 0; })) distLens[0] = 1;   /* 无匹配块兼容 */
        block(hlit, hdist, buildTable(litLens), buildTable(distLens));
      } else throw new Error("inflate: 非法块类型");
      if (last) break;
    }
    return new Uint8Array(out);
  }

  /* ---------------- ZIP 读取（中央目录）---------------- */
  function u16(v, o) { return v[o] | (v[o + 1] << 8); }
  function u32(v, o) { return (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0; }

  function listEntries(u8) {
    /* 从尾部扫描 EOCD（0x06054b50），容忍最多 64KB 注释 */
    var i = u8.length - 22, eocd = -1;
    for (; i >= 0 && i > u8.length - 22 - 65557; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("zip: 未找到目录（EOCD）——文件可能损坏或非 zip 容器");
    var count = u16(u8, eocd + 10);
    var cdOff = u32(u8, eocd + 16);
    var entries = [], p = cdOff;
    for (var n = 0; n < count; n++) {
      if (u32(u8, p) !== 0x02014b50) throw new Error("zip: 中央目录损坏");
      var method = u16(u8, p + 10);
      var csize = u32(u8, p + 20);
      var nameLen = u16(u8, p + 28);
      var extraLen = u16(u8, p + 30);
      var cmtLen = u16(u8, p + 32);
      var lho = u32(u8, p + 42);
      var name = utf8Decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name: name, method: method, csize: csize, lho: lho });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  /* 取指定条目（目录项按前缀匹配，忽略大小写） */
  function unzip(u8, targetName) {
    var t = String(targetName).toLowerCase();
    var entries = listEntries(u8);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name.toLowerCase() !== t) continue;
      /* 本地头：跳过 30 字节固定段 + 名称 + extra */
      var ln = u16(u8, e.lho + 26), le = u16(u8, e.lho + 28);
      var dataStart = e.lho + 30 + ln + le;
      var data = u8.subarray(dataStart, dataStart + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data);
      throw new Error("zip: 不支持的压缩方法 " + e.method);
    }
    return null;
  }

  /* ---------------- docx → 纯文本（与 server.js 同规则 + w:br/w:cr 换行增强） ---------------- */
  function xmlToText(xml) {
    return xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br\s*\/>/g, "\n").replace(/<w:cr\s*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      /* 单元格收尾段落不再换行——保证一行单元格转一个制表位（docx 表格单元格必含 w:p） */
      .replace(/\n<\/w:tc>/g, "</w:tc>")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  function docxToText(u8) {
    var xmlBuf = unzip(u8, "word/document.xml");
    if (!xmlBuf) return "";
    return xmlToText(utf8Decode(xmlBuf));
  }

  /* ---------------- xlsx → TSV（sharedStrings + 第一个 sheet） ---------------- */
  function xlsxToTsv(u8) {
    var shared = [];
    var ssBuf = unzip(u8, "xl/sharedStrings.xml");
    if (ssBuf) {
      var ssXml = utf8Decode(ssBuf);
      var siRe = /<si>([\s\S]*?)<\/si>/g, m;
      while ((m = siRe.exec(ssXml)) !== null) {
        var ts = [], tRe = /<t[^>]*>([\s\S]*?)<\/t>/g, t2;
        while ((t2 = tRe.exec(m[1])) !== null) ts.push(t2[1]);
        shared.push(ts.join(""));
      }
    }
    /* 第一个工作表：优先 sheet1.xml，否则任一 xl/worksheets/*.xml */
    var sheet = unzip(u8, "xl/worksheets/sheet1.xml");
    if (!sheet) {
      var names = listEntries(u8).map(function (e) { return e.name; }).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n.toLowerCase()); }).sort();
      sheet = names.length ? unzip(u8, names[0]) : null;
    }
    if (!sheet) return "";
    var xml = utf8Decode(sheet);
    var rows = [], rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g, rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      var cells = [], cRe = /<c([^>]*)>([\s\S]*?)<\/c>/g, cm, lastCol = -1;
      while ((cm = cRe.exec(rm[1])) !== null) {
        var attrs = cm[1], body = cm[2];
        var ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1] || "";
        var col = 0;
        for (var k = 0; k < ref.length; k++) col = col * 26 + (ref.charCodeAt(k) - 64);
        col = Math.max(col - 1, lastCol + 1);
        while (cells.length < col) cells.push("");
        var type = (attrs.match(/t="([^"]+)"/) || [])[1] || "";
        var v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || "";
        var is = (body.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "";
        var val = type === "s" ? (shared[parseInt(v, 10)] || "") : (type === "inlineStr" ? is : v);
        cells.push(String(val).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\t/g, " "));
        lastCol = col;
      }
      if (cells.some(function (x) { return x !== ""; })) rows.push(cells.join("\t"));
    }
    return rows.join("\n").trim();
  }

  /* ---------------- 按扩展名分发提取（attach.js 调用） ---------------- */
  function extract(name, u8) {
    var n = String(name || "").toLowerCase();
    if (/\.docx$/.test(n)) return { kind: "docx", text: docxToText(u8) };
    if (/\.xlsx$|\.xlsm$/.test(n)) return { kind: "xlsx", text: xlsxToTsv(u8) };
    if (/\.doc$/.test(n) || /\.xls$/.test(n)) throw new Error("旧版 .doc/.xls 二进制格式不支持——请另存为 .docx/.xlsx，或直接复制文本粘贴。");
    /* 其余按文本处理（txt/md/csv/log） */
    return { kind: "text", text: utf8Decode(u8) };
  }

  return {
    inflateRaw: inflateRaw, unzip: unzip, listEntries: listEntries,
    docxToText: docxToText, xlsxToTsv: xlsxToTsv, extract: extract, utf8Decode: utf8Decode
  };
})();
