#!/usr/bin/env node
/* =========================================================
 * server.js —— 法律咨询助手 本地服务（零依赖，Node ≥ 12）
 *
 *   用法：  node server.js          （默认端口 8080）
 *          set PORT=3000 && node server.js
 *
 *   功能：
 *     1. 静态托管当前目录（index.html 及全部资源）
 *     2. /api/ping            存活探测
 *     3. /api/flk/search      转发国家法律法规数据库（flk.npc.gov.cn）检索
 *     4. /api/flk/detail      获取法规正文（含 Word/PDF/网页版链接）
 *     5. /api/cases/search    经公开搜索引擎定位 中国裁判文书网 / 最高法官网 案例
 *
 *   说明：浏览器直连上述站点会被跨域策略拦截，故由本服务转发；
 *         仅做只读公开检索，请适度使用，遵守目标网站的访问条款。
 * ========================================================= */
"use strict";
var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");
var urlmod = require("url");

var PORT = parseInt(process.env.PORT || "8080", 10);
var ROOT = __dirname;
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ---------------- 通用 HTTP 请求（支持重定向与 gzip） ---------------- */
function request(opt, body, cb, timeoutMs) {
  var chunks = [];
  var req = (opt.protocol === "http:" ? http : https).request(opt, function (res) {
    /* 手动跟随重定向 */
    if ([301, 302, 303, 307, 308].indexOf(res.statusCode) > -1 && res.headers.location) {
      res.resume();
      var next = new URL(res.headers.location, opt.protocol + "//" + opt.hostname + (opt.port ? ":" + opt.port : "") + opt.path);
      return request({
        protocol: next.protocol, hostname: next.hostname, port: next.port || (next.protocol === "http:" ? 80 : 443),
        method: "GET", path: next.pathname + next.search, headers: { "User-Agent": UA }
      }, null, cb);
    }
    var stream = res;
    var enc = String(res.headers["content-encoding"] || "");
    if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
    else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
    else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
    stream.on("data", function (c) { chunks.push(c); });
    stream.on("end", function () { cb(null, Buffer.concat(chunks), res); });
    stream.on("error", cb);
  });
  req.on("error", cb);
  req.setTimeout(timeoutMs || 20000, function () { req.destroy(new Error("上游请求超时")); });
  if (body) req.write(body);
  req.end();
}

function getJSON(urlStr, headers, cb) {
  var u = new URL(urlStr);
  request({
    protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443),
    method: "GET", path: u.pathname + u.search, headers: Object.assign({ "User-Agent": UA, "Accept": "*/*" }, headers || {})
  }, null, function (err, buf, res) {
    if (err) return cb(err);
    try { cb(null, JSON.parse(buf.toString("utf8")), res); }
    catch (e) { cb(new Error("非JSON响应(" + res.statusCode + "): " + buf.toString("utf8").slice(0, 120))); }
  });
}

/* ---------------- 国家法律法规数据库 flk.npc.gov.cn（2026 新版 SPA 接口） ---------------- */
var FLK_HOST = "flk.npc.gov.cn";
var FLK_HEADERS = function (extra) {
  return Object.assign({
    "User-Agent": UA, "Referer": "https://flk.npc.gov.cn/",
    "Origin": "https://flk.npc.gov.cn", "X-Requested-With": "XMLHttpRequest"
  }, extra || {});
};

/* 内存缓存（A2 修正版：只做缓存不做限流——本机单人代理，缓存降上游压力/提命中率；
 * TTL 24h，上限 200 条 FIFO 淘汰，防无界增长） */
var FLK_CACHE = { map: new Map(), TTL: 24 * 60 * 60 * 1000, MAX: 200, hits: 0, miss: 0 };
function flkCacheGet(k) {
  var v = FLK_CACHE.map.get(k);
  if (!v) { FLK_CACHE.miss++; return null; }
  if (Date.now() - v.t > v.ttl) { FLK_CACHE.map.delete(k); FLK_CACHE.miss++; return null; }
  FLK_CACHE.hits++;
  return v.v;
}
function flkCacheSet(k, v, ttl) {
  if (FLK_CACHE.map.size >= FLK_CACHE.MAX) {
    var first = FLK_CACHE.map.keys().next().value;
    FLK_CACHE.map.delete(first);
  }
  FLK_CACHE.map.set(k, { t: Date.now(), ttl: ttl || FLK_CACHE.TTL, v: v });
}

function flkSearch(q, page, cb) {
  var cacheKey = "s:" + (q || "") + ":" + (page || 1);
  var cached = flkCacheGet(cacheKey);
  if (cached) return cb(null, cached);
  /* POST /law-search/search/list —— 2026 新版接口（旧 POST /api/ 已下线） */
  var payload = JSON.stringify({
    searchContent: q, searchRange: 1, searchType: 2,
    sxx: [], gbrq: [], sxrq: [],
    pageNum: page || 1, pageSize: 10
  });
  request({
    protocol: "https:", hostname: FLK_HOST, path: "/law-search/search/list", method: "POST",
    headers: FLK_HEADERS({
      "Content-Type": "application/json;charset=UTF-8",
      "Content-Length": Buffer.byteLength(payload)
    })
  }, payload, function (err, buf, res) {
    if (err) return cb(err);
    var json;
    try { json = JSON.parse(buf.toString("utf8")); }
    catch (e) { return cb(new Error("flk 返回异常(" + res.statusCode + ")，可能被临时限流，请稍后重试")); }
    if (json.code !== 200) return cb(new Error("flk 检索失败：" + json.msg));
    var rows = json.rows || [];
    var list = rows.map(function (it) {
      return {
        id: it.bbbs,
        title: String(it.title || "").replace(/<[^>]+>/g, ""),   /* 去掉高亮 <em> 标记 */
        office: it.zdjgName,
        publish: it.gbrq || "",
        expiry: it.sxrq || "",
        type: it.flxz,
        status: String(it.sxx)   /* 1=已废止 2=已被修改 3=有效 4=尚未生效 */
      };
    });
    var out = { total: json.total || list.length, list: list };
    flkCacheSet(cacheKey, out);
    cb(null, out);
  });
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function flkDetail(id, cb) {
  /* 缓存优先（正文含签名下载直链——签名直链有时效性，缓存 TTL 降到 1h） */
  var cacheKey = "d:" + id;
  var cached = flkCacheGet(cacheKey);
  if (cached) return cb(null, cached);
  /* GET /law-search/search/flfgDetails?bbbs=... → 元数据 + 官方文件（正文以 Word/PDF 文件提供） */
  var detailPath = "/law-search/search/flfgDetails?bbbs=" + encodeURIComponent(id);
  request({
    protocol: "https:", hostname: FLK_HOST, path: detailPath, method: "GET",
    headers: FLK_HEADERS({})
  }, null, function (err, buf, res) {
    if (err) return cb(err);
    var json;
    try { json = JSON.parse(buf.toString("utf8")); }
    catch (e) { return cb(new Error("flk 详情返回异常(" + res.statusCode + ")")); }
    if (json.code !== 200 || !json.data) return cb(new Error("flk 详情获取失败：" + json.msg));
    var d = json.data;

    /* xgzl = 相关资料列表（修订说明等）；主文本下载无需 fileId */
    var xgzl = d.xgzl || [];

    /* 主文本下载：download/pc 无需 fileId，凭 bbbs+format 即可取签名直链 */
    function signedDownload(format, done) {
      var p = "/law-search/download/pc?format=" + format + "&bbbs=" + encodeURIComponent(id);
      request({ protocol: "https:", hostname: FLK_HOST, path: p, method: "GET", headers: FLK_HEADERS({}) }, null, function (e2, b2) {
        if (e2) return done(null);
        try {
          var j = JSON.parse(b2.toString("utf8"));
          done(j.code === 200 && j.data && j.data.url ? j.data.url : null);
        } catch (e3) { done(null); }
      });
    }
    function signedPreview(done) {
      if (!d.ossFile || !d.ossFile.ossWordPath) return done(null);
      var p = "/law-search/amazonFile/previewLink?filePath=" + encodeURIComponent(d.ossFile.ossWordPath);
      request({ protocol: "https:", hostname: FLK_HOST, path: p, method: "GET", headers: FLK_HEADERS({}) }, null, function (e2, b2) {
        if (e2) return done(null);
        try {
          var j = JSON.parse(b2.toString("utf8"));
          done(j.code === 200 && j.data && j.data.url ? j.data.url : null);
        } catch (e3) { done(null); }
      });
    }

    var links = { relatedCount: xgzl.length };
    var pending = 0, finished = false;
    function tryFinish() {
      if (!finished && pending === 0) {
        finished = true;
        var out = {
          title: d.title, text: "",
          meta: {
            flxz: d.flxz, office: d.zdjgName, publish: d.gbrq,
            expiry: d.sxrq, status: String(d.sxx)
          },
          links: links
        };
        flkCacheSet(cacheKey, out, 60 * 60 * 1000); /* 1h——内含签名下载直链，时效敏感 */
        cb(null, out);
      }
    }
    pending++;
    signedPreview(function (u) { links.preview = u; pending--; tryFinish(); });
    pending++;
    signedDownload("docx", function (u) { links.word = u; pending--; tryFinish(); });
    pending++;
    signedDownload("pdf", function (u) { links.pdf = u; pending--; tryFinish(); });
    tryFinish();
  });
}

/* ---------------- 最小 ZIP 读取器（docx 正文提取用，零依赖） ---------------- */
function zipFindEntry(buf, targetName) {
  /* 从 EOCD 定位中央目录，遍历条目，返回目标条目的本地数据 */
  var i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return null;
  var count = buf.readUInt16LE(i + 10);
  var cdOffset = buf.readUInt32LE(i + 16);
  var p = cdOffset;
  while (count-- > 0) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    var method = buf.readUInt16LE(p + 10);
    var csize = buf.readUInt32LE(p + 20);
    var nameLen = buf.readUInt16LE(p + 28);
    var extraLen = buf.readUInt16LE(p + 30);
    var commentLen = buf.readUInt16LE(p + 32);
    var localOffset = buf.readUInt32LE(p + 42);
    var name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    var norm = name.replace(/\\/g, "/");   /* 兼容个别压缩工具的反斜杠条目名 */
    if (norm === targetName || name === targetName) {
      var lh = localOffset;
      var lNameLen = buf.readUInt16LE(lh + 26);
      var lExtraLen = buf.readUInt16LE(lh + 28);
      var dataStart = lh + 30 + lNameLen + lExtraLen;
      var data = buf.slice(dataStart, dataStart + csize);
      return method === 8 ? zlib.inflateRawSync(data) : (method === 0 ? data : null);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function docxToText(buf) {
  var xmlBuf = zipFindEntry(buf, "word/document.xml");
  if (!xmlBuf) return "";
  var xml = xmlBuf.toString("utf8");
  return xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* 官方正文本地提取：flkDetail 拿签名直链 → 下载 docx → 解压提取文本 */
function flkText(id, cb) {
  flkDetail(id, function (err, d) {
    if (err) return cb(err);
    if (!d.links || !d.links.word) return cb(new Error("官方未提供 Word 文本或链接获取失败"));
    var u;
    try { u = new URL(d.links.word); } catch (e) { return cb(new Error("下载链接无效")); }
    request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === "http:" ? 80 : 443),
      path: u.pathname + u.search, method: "GET",
      headers: { "User-Agent": UA, "Referer": "https://flk.npc.gov.cn/" }
    }, null, function (e2, b2, res2) {
      if (e2) return cb(new Error("官方文本下载超时或失败（网络波动时请重试）：" + e2.message));
      if (res2.statusCode !== 200) return cb(new Error("docx 下载失败（" + res2.statusCode + "）"));
      var text = docxToText(b2);
      if (text.length < 50) return cb(new Error("docx 正文提取失败"));
      cb(null, { title: d.title, text: text, chars: text.length });
    }, 45000);
  });
}

/* ---------------- 案例检索：经必应 site: 定位公开文书 ---------------- */
function bingSearch(query, cb) {
  var u = "https://cn.bing.com/search?q=" + encodeURIComponent(query) + "&count=12&mkt=zh-CN";
  var pu = new URL(u);
  request({ protocol: "https:", hostname: pu.hostname, path: pu.pathname + pu.search, method: "GET", headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } }, null, function (err, buf) {
    if (err) return cb(err);
    var html = buf.toString("utf8");
    var out = [];
    var re = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g, m;
    while ((m = re.exec(html)) && out.length < 10) {
      var block = m[1];
      var tm = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!tm) continue;
      var url0 = tm[1].replace(/&amp;/g, "&");
      var title = htmlToText(tm[2]);
      var sm = block.match(/<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) || block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      var snippet = sm ? htmlToText(sm[1]) : "";
      if (title && url0.indexOf("http") === 0) out.push({ title: title, url: url0, snippet: snippet });
    }
    cb(null, out);
  });
}

function caseSearch(q, site, cb) {
  var isCourt = site === "court";
  /* 必应对无 cookie 请求经常忽略 site: 算符（实测全部返回站外结果），
     因此不用 site:，直接通用检索 + 官方域白名单过滤 */
  var query = isCourt ? q + " 指导性案例 最高人民法院" : q + " 裁判文书 判决书";
  /* 文书网需登录，其公开可见内容主要在最高法公报/官网/chinacourt——同为官方域 */
  var officialOk = isCourt
    ? /(^|\.)court\.gov\.cn$/i
    : /(^|\.)court\.gov\.cn$|(^|\.)chinacourt\.org$/i;
  bingSearch(query, function (err, list) {
    if (err) return cb(err);
    var filtered = (list || []).filter(function (x) {
      var h = (urlmod.parse(x.url).hostname || "").toLowerCase();
      if (isCourt && /(^|\.)wenshu\.court\.gov\.cn$/i.test(h)) return false;  /* court 页签排除文书网子域 */
      return officialOk.test(h);
    });
    cb(null, filtered);
  });
}

/* ---------------- 简易缓存（30 分钟） ---------------- */
var CACHE = {};
function cached(key, fn, cb) {
  var hit = CACHE[key];
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return cb(null, hit.v);
  fn(function (err, v) {
    if (!err && v) CACHE[key] = { t: Date.now(), v: v };
    cb(err, v);
  });
}

/* ---------------- HTTP 服务 ---------------- */
var MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm",
  ".md": "text/markdown; charset=utf-8"
};

function sendJSON(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  var file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found: " + pathname);
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      /* 安全响应头（v3.5.2）：CSP 收紧脚本/连接来源（AI 直连 http/https 已放行）；nosniff 防误解析 */
      "Content-Security-Policy": "default-src 'self'; connect-src 'self' http: https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  });
}

var server = http.createServer(function (req, res) {
  var u = new URL(req.url, "http://127.0.0.1");
  var p = u.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "*"
    });
    return res.end();
  }
  if (p === "/api/ping") return sendJSON(res, 200, { ok: true, name: "legal-assistant-server", ts: Date.now() });

  /* AI 模型转发（OpenAI 兼容 chat/completions，支持 SSE 流式透传） */
  if (p === "/api/ai/chat" && req.method === "POST") {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      var b;
      try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch (e) { return sendJSON(res, 400, { ok: false, msg: "请求体不是合法 JSON" }); }
      var target;
      try { target = new URL(b.baseUrl); } catch (e) { return sendJSON(res, 200, { ok: false, msg: "baseUrl 无效：" + b.baseUrl }); }
      if (target.protocol !== "https:" && target.protocol !== "http:")
        return sendJSON(res, 200, { ok: false, msg: "仅支持 http/https 接口地址" });
      var payload = JSON.stringify({
        model: b.model, messages: b.messages, temperature: b.temperature, stream: !!b.stream
      });
      var mod = target.protocol === "http:" ? http : https;
      var upReq = mod.request({
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: target.pathname + (target.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (b.apiKey || ""),
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": UA
        }
      }, function (upRes) {
        res.writeHead(upRes.statusCode, {
          "Content-Type": upRes.headers["content-type"] || "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        });
        upRes.pipe(res);
      });
      upReq.on("error", function (e) {
        if (!res.headersSent) sendJSON(res, 200, { ok: false, msg: "连接模型服务失败：" + e.message });
        else try { res.end(); } catch (e2) {}
      });
      upReq.setTimeout(120000, function () { upReq.destroy(new Error("模型请求超时（120s）")); });
      upReq.end(payload);
    });
    return;
  }

  if (p === "/api/flk/search") {
    var q = u.searchParams.get("q") || "", page = parseInt(u.searchParams.get("page") || "1", 10);
    if (!q) return sendJSON(res, 200, { ok: false, msg: "缺少参数 q" });
    return cached("flk:" + q + ":" + page, function (done) { flkSearch(q, page, done); }, function (err, v) {
      if (err) return sendJSON(res, 200, { ok: false, msg: err.message });
      sendJSON(res, 200, { ok: true, q: q, total: v.total, results: v.list });
    });
  }

  if (p === "/api/flk/detail") {
    var id = u.searchParams.get("id") || "";
    if (!id) return sendJSON(res, 200, { ok: false, msg: "缺少参数 id" });
    return cached("flkd:" + id, function (done) { flkDetail(id, done); }, function (err, v) {
      if (err) return sendJSON(res, 200, { ok: false, msg: err.message });
      sendJSON(res, 200, { ok: true, title: v.title, text: v.text, links: v.links, meta: v.meta });
    });
  }

  /* 官方正文本地提取（docx → 纯文本），供详情页展示 / AI 资料区 / 离线缓存 */
  if (p === "/api/flk/text") {
    var tid = u.searchParams.get("bbbs") || "";
    if (!tid) return sendJSON(res, 200, { ok: false, msg: "缺少参数 bbbs" });
    return cached("flkt:" + tid, function (done) { flkText(tid, done); }, function (err, v) {
      if (err) return sendJSON(res, 200, { ok: false, msg: err.message });
      sendJSON(res, 200, { ok: true, bbbs: tid, title: v.title, text: v.text, chars: v.chars });
    });
  }

  if (p === "/api/cases/search") {
    var cq = u.searchParams.get("q") || "", csite = u.searchParams.get("site") || "wenshu";
    if (!cq) return sendJSON(res, 200, { ok: false, msg: "缺少参数 q" });
    return cached("case:" + csite + ":" + cq, function (done) { caseSearch(cq, csite, done); }, function (err, v) {
      if (err) return sendJSON(res, 200, { ok: false, msg: err.message });
      sendJSON(res, 200, { ok: true, q: cq, site: csite, results: v });
    });
  }

  serveStatic(req, res, p);
});

server.listen(PORT, "127.0.0.1", function () {
  console.log("=====================================================");
  console.log("  法律咨询助手 已启动");
  console.log("  本地访问:   http://127.0.0.1:" + PORT);
  console.log("  联网检索:   国家法律法规数据库 / 中国裁判文书网");
  console.log("  按 Ctrl+C 停止");
  console.log("=====================================================");
});
