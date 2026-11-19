#!/usr/bin/env node
/* =========================================================
 * sync-www.js —— 网页版 → 移动版 双端 js 一致性校验/同步（零依赖）
 * 背景：移动版 www 是网页版 js 的分发副本。多数文件应当完全一致；
 *       少数文件含移动特有分支（BRANCH_FILES），允许不同但需人工 diff。
 *       曾因漂移出现：esc 单端漏改报错、minsusong.js 移动端为空文件。
 * 用法：
 *   node sync-www.js          校验：列出漂移文件，不一致则以退出码 1 结束
 *   node sync-www.js --fix    同步：把网页版同源文件覆盖到移动版（仅同源清单）
 * 规则：
 *   - 以网页版为唯一事实源（source of truth），只允许 web → mobile 方向同步
 *   - 分支文件永不自动覆盖；新增 js 默认视为同源文件（防止漏加清单）
 * 可独立运行，也被 check.js 作为模块引入（校验不通过计为失败项）。
 * ========================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const WEB_ROOT = __dirname;
const MOBILE_WWW = path.join(WEB_ROOT, "..", "legal-assistant mobile", "app", "src", "main", "assets", "www");

/* 允许两端不同的文件（含移动特有分支，改动后须人工 diff 两个目录） */
const BRANCH_FILES = {
  "js/ai.js": true,        /* 原生网络桥直连 / 流式差异 */
  "js/analysis.js": true,  /* 移动端导出分支 */
  "js/consult.js": true,   /* 移动端布局分支 */
  "js/main.js": true,      /* 移动端布局/导航分支 */
  "js/online.js": true     /* 传输层整体不同（原生桥 vs 本地代理） */
};

/* 移动专属合法文件（不参与反向孤儿校验与 script 清单比对） */
const MOBILE_ONLY = {
  "js/mobile.js": true,
  "js/bridge.js": true
};

function listWebJs() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(WEB_ROOT, rel);
    fs.readdirSync(abs, { withFileTypes: true }).forEach(function (d) {
      const r = path.join(rel, d.name);
      if (d.isDirectory()) walk(r);
      else if (d.name.endsWith(".js")) out.push(r.replace(/\\/g, "/"));
    });
  };
  walk("js");
  return out.sort();
}

function listMobileJs() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(MOBILE_WWW, rel);
    fs.readdirSync(abs, { withFileTypes: true }).forEach(function (d) {
      const r = path.join(rel, d.name);
      if (d.isDirectory()) walk(r);
      else if (d.name.endsWith(".js")) out.push(r.replace(/\\/g, "/"));
    });
  };
  walk("js");
  return out.sort();
}

/* 两端 index.html 的 <script src> 清单（domains 等子目录一并覆盖） */
function listScriptTags(htmlPath) {
  const s = fs.readFileSync(htmlPath, "utf8");
  const out = [];
  const re = /<script[^>]*\ssrc="([^"]+\.js)"/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

/* 返回 { same:[], drift:[{file,reason}], branch:[] }；reason: missing | empty | diff | extra | script-missing | script-extra */
function checkSync() {
  const res = { same: [], drift: [], branch: [] };
  listWebJs().forEach(function (rel) {
    const webPath = path.join(WEB_ROOT, rel);
    const mobPath = path.join(MOBILE_WWW, rel);
    if (BRANCH_FILES[rel]) { res.branch.push(rel); return; }
    if (!fs.existsSync(mobPath)) { res.drift.push({ file: rel, reason: "missing" }); return; }
    const a = fs.readFileSync(webPath), b = fs.readFileSync(mobPath);
    if (b.length === 0) { res.drift.push({ file: rel, reason: "empty" }); return; }
    if (Buffer.compare(a, b) !== 0) { res.drift.push({ file: rel, reason: "diff" }); return; }
    res.same.push(rel);
  });
  /* 反向孤儿校验：mobile 多出的文件若非移动专属白名单，报 extra——
   * 曾实锤：mobile 同时存在 minusong.js（被 index 加载、不在同源清单永不更新）与 minsusong.js（孤儿），内容静默分叉 */
  listMobileJs().forEach(function (rel) {
    if (MOBILE_ONLY[rel]) return;
    if (BRANCH_FILES[rel]) return; /* 分支文件两端都有，不属孤儿 */
    if (!fs.existsSync(path.join(WEB_ROOT, rel))) res.drift.push({ file: rel, reason: "extra" });
  });
  /* script 清单比对：两端 index.html 挂载差集必须恰为移动专属白名单 */
  const webTags = listScriptTags(path.join(WEB_ROOT, "index.html"));
  const mobTags = listScriptTags(path.join(MOBILE_WWW, "index.html"));
  webTags.forEach(function (t) {
    if (mobTags.indexOf(t) === -1 && !MOBILE_ONLY[t])
      res.drift.push({ file: t, reason: "script-missing" });
  });
  mobTags.forEach(function (t) {
    if (webTags.indexOf(t) === -1 && !MOBILE_ONLY[t])
      res.drift.push({ file: t, reason: "script-extra" });
  });
  return res;
}

function fixSync() {
  const res = checkSync();
  const fixed = [];
  res.drift.forEach(function (d) {
    const src = path.join(WEB_ROOT, d.file), dst = path.join(MOBILE_WWW, d.file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    fixed.push(d.file + "（" + d.reason + "）");
  });
  return fixed;
}

module.exports = { checkSync: checkSync, fixSync: fixSync, BRANCH_FILES: BRANCH_FILES };

if (require.main === module) {
  const res = checkSync();
  console.log("━━ 双端一致性（网页版 → 移动版 www）");
  console.log("  同源一致 " + res.same.length + " 个文件");
  if (res.branch.length) console.log("  分支文件（允许不同，改动请人工 diff）：" + res.branch.join(", "));
  if (res.drift.length) {
    console.log("  ❌ 漂移 " + res.drift.length + " 个文件：");
    res.drift.forEach(function (d) {
      const label = d.reason === "missing" ? "移动版缺失"
        : d.reason === "empty" ? "移动版为空文件"
        : d.reason === "extra" ? "移动端孤儿文件（web 无此文件，永不更新）"
        : d.reason === "script-missing" ? "移动版 index.html 未挂载此脚本"
        : d.reason === "script-extra" ? "移动版 index.html 挂载了 web 没有的脚本"
        : "内容不一致";
      console.log("     - " + d.file + "（" + label + "）");
    });
    if (process.argv.indexOf("--fix") > -1) {
      const fixed = fixSync();
      console.log("  ✅ 已用网页版覆盖 " + fixed.length + " 个文件：\n     " + fixed.join("\n     "));
      console.log("  提醒：移动版如需出包，请重新构建 APK。");
    } else {
      console.log("  运行 node sync-www.js --fix 可用网页版自动覆盖以上文件。");
      process.exit(1);
    }
  } else {
    console.log("  ✅ 双端 js 完全一致（分支文件除外）");
  }
}
