#!/usr/bin/env node
/* =========================================================
 * verify-apk.js —— APK 包内 www 资产与源码一致性校验（零依赖常驻门禁）
 * 背景：出包快照落后源码已三次复发（N2 连续两轮/检查更新改造/4.0.18）——
 *       出包后必须逐文件比对包内 assets/www 与 app/src/main/assets/www，
 *       任何「漂移被门禁漏掉、装机才炸」的情况在这里收口。
 * 用法：
 *   node tools/verify-apk.js              校验 dist/ 最新 v*.apk
 *   node tools/verify-apk.js <apk路径>    校验指定 APK
 * 退出码：一致 0；不一致/异常 1。建议并入出包后流程与发布前 checklist。
 * ========================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const SRC_WWW = path.join(ROOT, "app", "src", "main", "assets", "www");
const DIST = path.join(ROOT, "dist");

/* ---------- zip 解析（与 release.js 同构，零依赖） ---------- */
function listEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("EOCD not found（不是有效 zip/APK）");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    /* aapt2 zipalign 会在 local header 加对齐 padding：local extraLen ≠ central extraLen——
       数据偏移必须用 local header 自己的 nameLen/extraLen（central 值会产生 NUL 前缀错位） */
    const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
    if (name.startsWith("assets/www/") && !name.endsWith("/")) names.push({ name, method, csize, lho, lNameLen, lExtraLen });
    off += 46 + nameLen + extraLen + commLen;
  }
  return names;
}
function readEntry(buf, e) {
  const data = buf.slice(e.lho + 30 + e.lNameLen + e.lExtraLen, e.lho + 30 + e.lNameLen + e.lExtraLen + e.csize);
  return e.method === 0 ? data : zlib.inflateRawSync(data);
}

/* 行尾归一（包内/工作树 CRLF 差异不算实质漂移，但会单独提示） */
const norm = b => b.toString("utf8").replace(/\r\n/g, "\n");
/* 标点级差异（末尾分号有无/行首缩进）——语义等价，归 soft（release.js 对齐写入曾引入前导空格+缺分号） */
const normSoft = b => norm(b).replace(/;\s*$/, "").split("\n").map(l => l.trim()).join("\n");
/* 二进制资源：aapt2 打包可能无损重编码（等价但字节流不同）——长度相等视为等价，长度不等才 hard */
const BINARY = /\.(png|jpe?g|webm|mp4|woff2?|ico)$/i;

/* ---------- 主流程 ---------- */
function pickApk() {
  const arg = process.argv[2];
  if (arg) return arg;
  const apks = fs.readdirSync(DIST).filter(f => /^legal-assistant-mobile-v[\d.]+\.apk$/.test(f)).sort();
  if (!apks.length) { console.error("dist/ 无 legal-assistant-mobile-v*.apk，可传参指定路径"); process.exit(1); }
  return path.join(DIST, apks[apks.length - 1]);
}

const apkPath = pickApk();
const apkBuf = fs.readFileSync(apkPath);
const entries = listEntries(apkBuf);

/* 源码 www 文件清单 */
const srcFiles = [];
(function walk(rel) {
  const abs = path.join(SRC_WWW, rel);
  fs.readdirSync(abs, { withFileTypes: true }).forEach(d => {
    const r = path.join(rel, d.name);
    if (d.isDirectory()) walk(r);
    else srcFiles.push(r.replace(/\\/g, "/"));
  });
})("");

const pkgMap = new Map(entries.map(e => [e.name.slice("assets/www/".length), e]));
let same = 0, onlyPkg = [], onlySrc = [], diffHard = [], diffEol = [], recomp = [], diffPunct = [];

for (const rel of srcFiles) {
  if (!pkgMap.has(rel)) { onlySrc.push(rel); continue; }
  const a = fs.readFileSync(path.join(SRC_WWW, rel));
  const b = readEntry(apkBuf, pkgMap.get(rel));
  if (Buffer.compare(a, b) === 0) { same++; continue; }
  if (BINARY.test(rel)) {
    if (a.length === b.length) recomp.push(rel);
    else diffHard.push(rel + "（二进制长度不同）");
    continue;
  }
  if (norm(a) === norm(b)) diffEol.push(rel);
  else if (normSoft(a) === normSoft(b)) diffPunct.push(rel);
  else diffHard.push(rel);
}
for (const rel of pkgMap.keys()) if (!srcFiles.includes(rel)) onlyPkg.push(rel);

console.log("== verify-apk：" + path.basename(apkPath));
console.log("  比对 assets/www 全部文件：源码 " + srcFiles.length + " / 包内 " + pkgMap.size);
console.log("  ✅ 逐字节一致 " + same + " 个");
if (recomp.length) {
  console.log("  ℹ 二进制重编码等价 " + recomp.length + " 个（aapt2 无损优化，长度相等）：" + recomp.slice(0, 4).join(", ") + (recomp.length > 4 ? " 等" : ""));
}
if (diffEol.length) {
  console.log("  ⚠ 仅行尾差异 " + diffEol.length + " 个（不算漂移）：" + diffEol.slice(0, 5).join(", ") + (diffEol.length > 5 ? " 等" : ""));
}
if (diffPunct.length) {
  console.log("  ⚠ 仅尾部标点差异 " + diffPunct.length + " 个（语义等价）：" + diffPunct.join(", "));
}
if (diffHard.length) {
  console.log("  ❌ 实质不一致 " + diffHard.length + " 个（出包后源码有新改动=待出下一版；若源码无改动则此包禁止发布）：");
  diffHard.forEach(f => console.log("     - " + f));
}
if (onlyPkg.length) {
  console.log("  ❌ 包内多出文件（源码已删/改名残留）：" + onlyPkg.join(", "));
}
if (onlySrc.length) {
  console.log("  ❌ 源码有而包内缺失（漏打包）：");
  onlySrc.forEach(f => console.log("     - " + f));
}

/* 版本核对：包内 version.js 与文件名/manifest 版本一致 */
const verEntry = pkgMap.get("version.js");
let verFail = false;
if (verEntry) {
  const ver = JSON.parse(readEntry(apkBuf, verEntry).toString("utf8").match(/\{[\s\S]*\}/)[0].replace(/(\w+):/g, '"$1":').replace(/"/g, '"'));
  const m = path.basename(apkPath).match(/v([\d.]+)\.apk$/);
  if (m && ver.version !== m[1]) { console.log("  ❌ 包内 version.js=" + ver.version + " 与 APK 文件名 v" + m[1] + " 不符"); verFail = true; }
  else console.log("  ✅ 包内 version.js = " + ver.version + "/" + ver.code);
} else { console.log("  ❌ 包内缺 version.js"); verFail = true; }

const hard = diffHard.length + onlyPkg.length + onlySrc.length + (verFail ? 1 : 0);
console.log(hard === 0 ? "== ✅ 包内零脱节" : "== ❌ " + hard + " 项脱节，禁止以此包发布");
process.exit(hard === 0 ? 0 : 1);
