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

var PORT = parseInt(process.env.PORT || "8080", 10);
var ROOT = __dirname;
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ---------------- 通用 HTTP 请求（支持重定向与 gzip） ---------------- */
function request(opt, body, cb) {
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
  req.setTimeout(20000, function () { req.destroy(new Error("上游请求超时")); });
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

/* ---------------- 国家法律法规数据库 flk.npc.gov.cn ---------------- */
function flkSearch(q, page, cb) {
  var payload = JSON.stringify({
    type: "flfg", searchType: "title;vague", sortTr: "f_bbrq_s;desc",
    gbrqStart: "", gbrqEnd: "", sxrqStart: "", sxrqEnd: "",
    sort: true, page: page || 1, size: 10, _: Date.now(), q: [q]
  });
  var u = new URL("https://flk.npc.gov.cn/api/");
  request({
    protocol: "https:", hostname: u.hostname, path: u.pathname, method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "User-Agent": UA, "Referer": "https://flk.npc.gov.cn/", "Origin": "https://flk.npc.gov.cn",
      "Content-Length": Buffer.byteLength(payload)
    }
  }, payload, function (err, buf, res) {
    if (err) return cb(err);
    var json;
    try { json = JSON.parse(buf.toString("utf8")); }
    catch (e) { return cb(new Error("flk 返回异常(" + res.statusCode + ")，可能被临时限流，请稍后重试")); }
    var data = (json.result && json.result.data) || [];
    var list = data.map(function (it) {
      /* 详情 id 兼容多种返回形态：url("../detail2.html?xxx") 或直接给 id */
      var id = it.id || "";
      if (!id && it.url) {
        var m = String(it.url).match(/\?([^./][^#]*)$/);
        if (m) id = m[1];
      }
      return {
        title: it.title, office: it.office, publish: it.publish || it.bbrq || "",
        expiry: it.expiry, type: it.type || it.level, status: it.status, id: decodeURIComponent(id)
      };
    });
    cb(null, { total: (json.result && json.result.totalSizes) || list.length, list: list });
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
  var form = "id=" + encodeURIComponent(id);
  var u = new URL("https://flk.npc.gov.cn/api/detail");
  request({
    protocol: "https:", hostname: u.hostname, path: u.pathname, method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": UA, "Referer": "https://flk.npc.gov.cn/detail2.html?" + encodeURIComponent(id),
      "Content-Length": Buffer.byteLength(form)
    }
  }, form, function (err, buf) {
    if (err) return cb(err);
    var json;
    try { json = JSON.parse(buf.toString("utf8")); }
    catch (e) { return cb(new Error("flk 详情返回异常，请稍后重试")); }
    var r = json.result || {};
    var links = {};
    var text = "";
    (r.body || []).forEach(function (b) {
      var p = b.url ? (String(b.url).indexOf("http") === 0 ? b.url : "https://wb.flk.npc.gov.cn" + b.url) : null;
      if (!p) return;
      if (/html?$/i.test(p)) { links.html = p; }
      else if (/\.docx?$/i.test(p)) { links.word = p; }
      else if (/\.pdf$/i.test(p)) { links.pdf = p; }
      else if (/\.ofd$/i.test(p)) { links.ofd = p; }
    });
    /* 优先抓网页版正文；没有则用接口内的 qwContent 兜底 */
    if (links.html) {
      var hu = new URL(links.html);
      request({ protocol: "https:", hostname: hu.hostname, path: hu.pathname + hu.search, method: "GET", headers: { "User-Agent": UA, "Referer": "https://flk.npc.gov.cn/" } }, null, function (e2, b2) {
        if (!e2 && b2) {
          var t = htmlToText(b2.toString("utf8"));
          if (t.length > 100) text = t;
        }
        cb(null, { title: r.title, status: r.status, publish: r.publish, links: links, text: text });
      });
    } else {
      (r.body || []).forEach(function (b) {
        if (b.qwContent && !text) text = htmlToText(b.qwContent);
      });
      cb(null, { title: r.title, status: r.status, publish: r.publish, links: links, text: text });
    }
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
  var siteFilter = site === "court" ? "site:www.court.gov.cn" : "site:wenshu.court.gov.cn";
  var extra = site === "court" ? "指导案例" : "";
  bingSearch(siteFilter + " " + q + " " + extra, function (err, list) {
    if (err) return cb(err);
    /* 文书网无结果时，用第二策略：去掉 site: 限定补充检索 */
    if (!list.length) {
      bingSearch(q + " 裁判文书 " + (site === "court" ? "指导性案例" : ""), function (e2, l2) {
        cb(null, (l2 || []).filter(function (x) { return /court\.gov\.cn|chinacourt|zhongcai|wenshu/i.test(x.url); }));
      });
      return;
    }
    cb(null, list);
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
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
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
      sendJSON(res, 200, { ok: true, title: v.title, text: v.text, links: v.links });
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
