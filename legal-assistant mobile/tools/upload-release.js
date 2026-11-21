#!/usr/bin/env node
/* =========================================================
 * upload-release.js —— APK 上传 GitHub Releases（分发链路空档补齐）
 * 背景：dist 迁 Releases（仓库 -7MB）后，release.js 只实现了「移出 git」
 * 没实现「上传」——APK 分发链路空档：本地 dist 有文件、GitHub 没有。
 * 用法：
 *   node tools/upload-release.js <apk路径>          （版本号从文件名 v4.0.28 提取）
 * 前置：环境变量 LA_GH_TOKEN（GitHub PAT，repo 权限；缺省给生成指引）
 * 行为：算 SHA256 → 查/建 tag 对应 Release → 同名 asset 已存在则跳过 → 上传 → 打印 URL
 * 零依赖（node https 原生）。
 * ========================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const REPO = "zzhi333333/project1";
const TOKEN = process.env.LA_GH_TOKEN || "";
if (!TOKEN) {
  console.error("❌ 缺环境变量 LA_GH_TOKEN（GitHub Personal Access Token，repo 权限）");
  console.error("   生成：GitHub → Settings → Developer settings → Personal access tokens →");
  console.error("   Generate new token (classic) → 勾选 repo → 设置环境变量后重跑本脚本。");
  process.exit(1);
}

const apkPath = process.argv[2] || "";
if (!apkPath || !fs.existsSync(apkPath)) { console.error("❌ APK 路径无效：" + apkPath); process.exit(1); }
const base = path.basename(apkPath);
const verM = base.match(/v([\d.]+)\.apk$/);
if (!verM) { console.error("❌ 文件名须为 legal-assistant-mobile-v<版本>.apk"); process.exit(1); }
const tag = "v" + verM[1];

const buf = fs.readFileSync(apkPath);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
console.log("== upload-release：" + base + "（" + Math.round(buf.length / 1024) + "KB）SHA256 " + sha256.slice(0, 16) + "…");

function gh(method, host, apiPath, body, contentType) {
  return new Promise(function (resolve) {
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) : null;
    const req = https.request({
      hostname: host, path: apiPath, method: method,
      headers: Object.assign({
        "Authorization": "token " + TOKEN,
        "User-Agent": "xiezhi-release",
        "Accept": "application/vnd.github+json"
      }, data ? { "Content-Type": contentType || "application/json", "Content-Length": data.length } : {})
    }, function (res) {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", e => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

(async function () {
  /* 1. 查 tag 对应 Release（有则复用，无则创建） */
  let rel = null;
  const q = await gh("GET", "api.github.com", "/repos/" + REPO + "/releases/tags/" + tag);
  if (q.status === 200) { rel = JSON.parse(q.body); console.log("复用已有 Release：" + tag); }
  else {
    const c = await gh("POST", "api.github.com", "/repos/" + REPO + "/releases",
      { tag_name: tag, name: "獬小豸移动版 v" + verM[1], body: "APK SHA256: " + sha256 + "\n安装：下载 APK 直接安装（允许未知来源）。" });
    if (c.status !== 201) { console.error("❌ 创建 Release 失败(" + c.status + ")：" + c.body.slice(0, 200)); process.exit(1); }
    rel = JSON.parse(c.body);
    console.log("已创建 Release：" + tag);
  }

  /* 2. 同名 asset 已存在则跳过（幂等） */
  const existing = (rel.assets || []).find(a => a.name === base);
  if (existing) {
    console.log("⚠ " + base + " 已在 Release 上（" + existing.size + "B）——如需覆盖请先到 GitHub 删除该 asset 后重跑。");
    console.log("   下载页：" + rel.html_url || ("https://github.com/" + REPO + "/releases/tag/" + tag));
    return;
  }

  /* 3. 上传（uploads.github.com，二进制 octet-stream） */
  const upHost = "uploads.github.com";
  const upPath = rel.upload_url.replace(/^https:\/\/uploads\.github\.com/, "").split("{")[0] +
    "?name=" + encodeURIComponent(base) + "&label=Android%20APK";
  const up = await gh("POST", upHost, upPath, buf, "application/octet-stream");
  if (up.status !== 201) { console.error("❌ 上传失败(" + up.status + ")：" + up.body.slice(0, 200)); process.exit(1); }
  const asset = JSON.parse(up.body);
  console.log("✅ 上传完成：" + asset.browser_download_url);
  console.log("✅ SHA256（核对锚）：" + sha256);
})().catch(e => { console.error("❌ " + (e && e.message || e)); process.exit(1); });
