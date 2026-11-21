#!/usr/bin/env node
/* =========================================================
 * release.js —— 移动端出包流水线（零依赖，Node ≥16）
 * 用法：
 *   node release.js <版本号> [提交说明]        完整出包：版本对齐 → check/test → 构建 → 包内验证 → 提交推送
 *   node release.js <版本号> --dry             只构建与验证（不改版本号、不提交）
 * 版本号自动递增：versionCode 取 manifest 现值 +1，无需手动传。
 * ---------------------------------------------------------
 * 背景（dea1d35 血泪教训）：v3.2.5 出包人工改版本号，漏改 APK 内
 * app-ver 致自报旧版本。本脚本把「版本对齐 6 处 + check/test +
 * ASCII 构建环境 + aapt/包内资产双验证 + 推送重试」固化为一步，
 * 消除人工步骤。构建步骤与 build.bat 等价（纯英文日志、无 chcp，
 * 管道/CI 环境安全；argfile 路径写正斜杠防反斜杠被吞）。
 * 双击场景仍可用 build.bat（两者互不干扰，产物同名）。
 * ========================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const SIGN_PASS = process.env.LA_SIGN_PASS || "legal123";  /* 口令环境变量化（明文不入 git 的硬编码兜底仍兼容旧 keystore） */
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const zlib = require("zlib");

const MOB_ROOT = __dirname;
const WEB_ROOT = path.join(MOB_ROOT, "..", "legal-assistant");
const APP = path.join(MOB_ROOT, "app", "src", "main");
const OUT = path.join(MOB_ROOT, "build");
const DIST = path.join(MOB_ROOT, "dist");
const KS = path.join(MOB_ROOT, "tools", "debug.keystore");

const args = process.argv.slice(2);
const DRY = args.indexOf("--dry") > -1;
const versionName = (args[0] && !args[0].startsWith("--")) ? args[0] : null;
const commitMsg = args[1] && !args[1].startsWith("--") ? args[1] : null;
if (!versionName || !/^\d+\.\d+\.\d+$/.test(versionName)) {
  console.error("用法：node release.js <版本号 x.y.z> [提交说明] [--dry]");
  process.exit(1);
}

const step = t => console.log("\n━━ " + t);
function die(msg) { console.error("\n❌ " + msg); process.exit(1); }
function run(cmd, cmdArgs, opts) {
  const r = spawnSync(cmd, cmdArgs, Object.assign({ stdio: "inherit" }, opts || {}));
  if (r.status !== 0) die("命令失败（exit " + r.status + "）：" + cmd + " " + cmdArgs.join(" "));
  return r;
}
/* .bat 需经 cmd.exe 调起（Node 不直接执行 .bat） */
function runBat(bat, cmdArgs) { run("cmd.exe", ["/c", bat].concat(cmdArgs)); }

/* ---------- 0. 环境发现（同 build.bat 默认路径） ---------- */
step("0. 环境发现");
function discover() {
  let jdk = process.env.JAVA_HOME;
  if (!jdk) {
    const cands = fs.readdirSync("C:\\Users\\zz333\\android").filter(d => d.startsWith("jdk-")).sort();
    if (cands.length) jdk = path.join("C:\\Users\\zz333\\android", cands[cands.length - 1]);
  }
  if (!jdk || !fs.existsSync(jdk)) die("未找到 JDK（设 JAVA_HOME 或安装到 C:\\Users\\zz333\\android\\jdk-*）");
  const sdk = process.env.ANDROID_SDK || "C:\\Users\\zz333\\android\\sdk";
  const btDir = fs.readdirSync(path.join(sdk, "build-tools")).filter(d => /^\d/.test(d)).sort().pop();
  const platDir = fs.readdirSync(path.join(sdk, "platforms")).filter(d => d.startsWith("android-")).sort().pop();
  if (!btDir || !platDir) die("build-tools/platforms 未找到：" + sdk);
  const env = {
    jdk: jdk,
    bt: path.join(sdk, "build-tools", btDir),
    plat: path.join(sdk, "platforms", platDir)
  };
  console.log("  JDK: " + env.jdk);
  console.log("  build-tools: " + env.bt);
  console.log("  platform: " + env.plat);
  if (!fs.existsSync(KS)) die("签名密钥缺失：" + KS + "（先双击 build.bat 生成一次，密钥已 gitignore 勿提交）");
  /* d8.bat/apksigner.bat 内部需 java 可用——注入本进程环境，子 cmd 继承 */
  process.env.JAVA_HOME = env.jdk;
  process.env.PATH = path.join(env.jdk, "bin") + path.delimiter + (process.env.PATH || "");
  return env;
}
const env = discover();

/* ---------- 1. 版本对齐（6 处，机器改，杜绝漏改） ---------- */
step("1. 版本对齐");
const manifestPath = path.join(APP, "AndroidManifest.xml");
const manifest = fs.readFileSync(manifestPath, "utf8");
const mCode = /android:versionCode="(\d+)"/.exec(manifest);
const mName = /android:versionName="([\d.]+)"/.exec(manifest);
if (!mCode || !mName) die("manifest 版本解析失败");
const oldCode = mCode[1], oldName = mName[1];
const newCode = String(parseInt(oldCode, 10) + 1);
/* dry 模式不落盘改版 → 构建/验证用当前值；正式模式用新值 */
const effName = DRY ? oldName : versionName;
const effCode = DRY ? oldCode : newCode;
/* 构建日期（更多弹层 app-build）随每次出包自动刷新——曾因不在对齐清单漏改 4 个版本 */
const now = new Date();
const today = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);
console.log("  " + oldName + "(code " + oldCode + ") → " + versionName + "(code " + newCode + ")" + (DRY ? "（dry：不改文件）" : ""));

const targets = [
  { file: manifestPath, re: /android:versionCode="\d+"/, to: 'android:versionCode="' + newCode + '"', tag: "manifest versionCode" },
  { file: manifestPath, re: /android:versionName="[\d.]+"/, to: 'android:versionName="' + versionName + '"', tag: "manifest versionName" },
  { file: path.join(MOB_ROOT, "build.bat"), re: /set "VERSION_NAME=[\d.]+"/, to: 'set "VERSION_NAME=' + versionName + '"', tag: "build.bat VERSION_NAME" },
  { file: path.join(APP, "assets", "www", "index.html"), re: /id="app-ver">[\d.]+</, to: 'id="app-ver">' + versionName + "<", tag: "更多弹层 app-ver" },
  { file: path.join(APP, "assets", "www", "index.html"), re: /id="app-build">[\d-]+</, to: 'id="app-build">' + today + "<", tag: "更多弹层构建日期" },
  { file: path.join(MOB_ROOT, "README.md"), re: /版本 `[\d.]+`（versionCode \d+）/, to: "版本 `" + versionName + "`（versionCode " + newCode + "）", tag: "移动 README 版本行" },
  { file: path.join(MOB_ROOT, "README.md"), re: /legal-assistant-mobile-v[\d.]+\.apk/, to: "legal-assistant-mobile-v" + versionName + ".apk", tag: "移动 README 产物名" },
  { file: path.join(WEB_ROOT, "FEATURES.md"), re: /> 版本：v[\d.]+（/, to: "> 版本：v" + versionName + "（", tag: "FEATURES 版本头" },
  { file: path.join(MOB_ROOT, "MANUAL.md"), re: /> 版本：v[\d.]+（versionCode \d+）/, to: "> 版本：v" + versionName + "（versionCode " + newCode + "）", tag: "MANUAL 版本头" },
  /* v4.0.17：web 顶栏 app-ver（关于段）——check 九处对齐成员，漏改复发检查更新假提示 */
  { file: path.join(WEB_ROOT, "index.html"), re: /id="app-ver">[\d.]+</, to: 'id="app-ver">' + versionName + "<", tag: "web 顶栏 app-ver" },
  /* v4.0.17：检查更新版本信息（update-check.js 数据源）——漏改会复发「检查更新假提示」 */
  { file: path.join(WEB_ROOT, "version.js"), re: /"version": "[\d.]+"/, to: '"version": "' + versionName + '"', tag: "web version.js version" },
  { file: path.join(WEB_ROOT, "version.js"), re: /"code": \d+/, to: '"code": ' + newCode, tag: "web version.js code" },
  { file: path.join(APP, "assets", "www", "version.js"), re: /"version": "[\d.]+"/, to: '"version": "' + versionName + '"', tag: "mobile version.js version" },
  { file: path.join(APP, "assets", "www", "version.js"), re: /"code": \d+/, to: '"code": ' + newCode, tag: "mobile version.js code" }
];
targets.forEach(function (t) {
  const src = fs.readFileSync(t.file, "utf8");
  if (!t.re.test(src)) die("版本锚点未命中（格式变动？）：" + t.tag);
  if (DRY) { console.log("  [dry] 将改 " + t.tag + " → " + t.to); return; }
  fs.writeFileSync(t.file, src.replace(t.re, t.to));
  console.log("  ✅ " + t.tag + " → " + t.to);
});
if (DRY) console.log("  [dry] 跳过其余文件改动");

/* ---------- 2. check + test（任一失败即中止出包） ---------- */
step("2. 质量门（check.js / test.js）");
run(process.execPath, ["check.js"], { cwd: WEB_ROOT });
run(process.execPath, ["test.js"], { cwd: WEB_ROOT });

/* ---------- 3. 构建 APK（build.bat 等价步骤，管道安全） ---------- */
step("3. 构建 APK");
fs.rmSync(OUT, { recursive: true, force: true });
["gen", "obj", "dex"].forEach(d => fs.mkdirSync(path.join(OUT, d), { recursive: true }));
fs.mkdirSync(DIST, { recursive: true });
const aapt = path.join(env.bt, "aapt.exe");
run(aapt, ["package", "-f", "-m", "-J", path.join(OUT, "gen"), "-M", path.join(APP, "AndroidManifest.xml"),
  "-S", path.join(APP, "res"), "-A", path.join(APP, "assets"), "-I", path.join(env.plat, "android.jar"),
  "-F", path.join(OUT, "unsigned.apk")]);

/* 收集源码（argfile 引号内正斜杠，防反斜杠被吞——build.bat 已验证的修法） */
const srcs = [];
(function walk(p) {
  fs.readdirSync(p, { withFileTypes: true }).forEach(d => {
    const r = path.join(p, d.name);
    if (d.isDirectory()) walk(r);
    else if (d.name.endsWith(".java")) srcs.push(r);
  });
})(path.join(APP, "java"));
(function walk(p) {
  fs.readdirSync(p, { withFileTypes: true }).forEach(d => {
    const r = path.join(p, d.name);
    if (d.isDirectory()) walk(r);
    else if (d.name.endsWith(".java")) srcs.push(r);
  });
})(path.join(OUT, "gen"));
fs.writeFileSync(path.join(OUT, "sources.txt"), srcs.map(p => '"' + p.replace(/\\/g, "/") + '"').join("\r\n") + "\r\n");
run(path.join(env.jdk, "bin", "javac.exe"), ["--release", "8", "-encoding", "UTF-8", "-nowarn",
  "-classpath", path.join(env.plat, "android.jar"), "-d", path.join(OUT, "obj"),
  "@" + path.join(OUT, "sources.txt")]);
run(path.join(env.jdk, "bin", "jar.exe"), ["cf", path.join(OUT, "classes.jar"), "-C", path.join(OUT, "obj"), "."]);
runBat(path.join(env.bt, "d8.bat"), ["--release", "--lib", path.join(env.plat, "android.jar"),
  "--output", path.join(OUT, "dex"), path.join(OUT, "classes.jar")]);
run(aapt, ["add", path.join(OUT, "unsigned.apk"), "classes.dex"], { cwd: path.join(OUT, "dex") });
run(path.join(env.bt, "zipalign.exe"), ["-f", "4", path.join(OUT, "unsigned.apk"), path.join(OUT, "aligned.apk")]);
const apkPath = path.join(DIST, "legal-assistant-mobile-v" + effName + ".apk");
runBat(path.join(env.bt, "apksigner.bat"), ["sign", "--ks", KS, "--ks-pass", "pass:" + SIGN_PASS,
  "--key-pass", "pass:" + SIGN_PASS, "--out", apkPath, path.join(OUT, "aligned.apk")]);
runBat(path.join(env.bt, "apksigner.bat"), ["verify", apkPath]);
/* 清理 dist 内旧版本包与签名 sidecar（.idsig；验证通过后执行；dry 模式不动工作区） */
if (!DRY) fs.readdirSync(DIST).filter(f => (f.endsWith(".apk") || f.endsWith(".apk.idsig")) && f !== path.basename(apkPath) && f !== path.basename(apkPath) + ".idsig").forEach(f => {
  fs.rmSync(path.join(DIST, f));
  console.log("  🧹 已清理旧包：" + f);
});
console.log("  ✅ 构建：" + apkPath);

/* ---------- 4. 包内验证（aapt 版本 + 资产 grep，双确认） ---------- */
step("4. 包内验证");
const badging = spawnSync(aapt, ["dump", "badging", apkPath], { encoding: "utf8" }).stdout;
const gotCode = (/versionCode='(\d+)'/.exec(badging) || [])[1];
const gotName = (/versionName='([\d.]+)'/.exec(badging) || [])[1];
if (gotCode !== effCode || gotName !== effName) die("APK 版本不符：got " + gotName + "(" + gotCode + ")，期望 " + effName + "(" + effCode + ")");
console.log("  ✅ badging: versionName=" + gotName + " versionCode=" + gotCode);

/* 零依赖 zip 条目读取（store/deflate），校验包内资产真的含新版本与最新修复 */
function zipReadEntry(buf, entryName) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("EOCD not found");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    if (name === entryName) {
      const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
      const data = buf.slice(lho + 30 + lNameLen + lExtraLen, lho + 30 + lNameLen + lExtraLen + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    off += 46 + nameLen + extraLen + commLen;
  }
  return null;
}
const apkBuf = fs.readFileSync(apkPath);
const idxHtml = zipReadEntry(apkBuf, "assets/www/index.html");
if (!idxHtml || idxHtml.indexOf('id="app-ver">' + effName + "<") === -1) die("包内 index.html app-ver 不是 " + effName + "（版本漏改防线触发）");
console.log("  ✅ 包内 app-ver = " + effName);
const idxVer = zipReadEntry(apkBuf, "assets/www/version.js");
if (!idxVer || idxVer.indexOf('"' + effName + '"') === -1 || idxVer.indexOf(String(newCode)) === -1) die("包内 version.js 不是 " + effName + "/" + newCode + "（检查更新漏改防线触发）");
console.log("  ✅ 包内 version.js = " + effName + " / " + newCode);
const idxAi = zipReadEntry(apkBuf, "assets/www/js/ai.js");
if (!idxAi || idxAi.indexOf("updQuickVis") === -1) die("包内 ai.js 异常（updQuickVis 缺失）");
const idxWs = zipReadEntry(apkBuf, "assets/www/js/workspace.js");
if (!idxWs || idxWs.indexOf("normCnDates") === -1) die("包内 workspace.js 缺 normCnDates（最新修复未入包）");
console.log("  ✅ 包内 ai.js / workspace.js 含最新修复特征");
const md5 = crypto.createHash("md5").update(apkBuf).digest("hex");
const kb = Math.round(apkBuf.length / 1024);
console.log("  ✅ MD5 " + md5 + " · " + kb + "KB");

/* ---------- 5. 提交推送（重试 + 机器验证；拒绝强推） ---------- */
if (DRY) { console.log("\n[dry] 跳过提交推送。dry 全流程通过。"); process.exit(0); }
step("5. 提交推送");
const git = (gitArgs, allowFail) => {
  const r = spawnSync("git", gitArgs, { encoding: "utf8", cwd: WEB_ROOT });
  if (r.status !== 0 && !allowFail) die("git " + gitArgs.join(" ") + " 失败：" + (r.stderr || r.stdout));
  return r;
};
/* 显式暂存（对侧审核 P1：git add -A 不受 cwd 限制，仓库根未跟踪文件/密钥会被误提交
 * ——实测 cd 子目录下 -A 等价于 :/ 仓库根作用域。只暂存发布链明确文件+暂存区白名单硬门禁 */
git(["add", "--", "version.js", "app/build.gradle", "app/src/main/AndroidManifest.xml",
  "app/src/main/assets/www", "dist/legal-assistant-mobile-v" + versionName + ".apk",
  "LEGAL_CHANGELOG.md", "FEATURES.md", "MANUAL.md", "README.md"]);
const staged = spawnSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8", cwd: WEB_ROOT }).stdout.split("\n").filter(Boolean);
const ALLOWED_STAGE = /^(version\.js|app\/build\.gradle|app\/src\/main\/(AndroidManifest\.xml|assets\/www\/)|dist\/legal-assistant-mobile-v|LEGAL_CHANGELOG\.md|FEATURES\.md|MANUAL\.md|README\.md)/;
const illegalStaged = staged.filter(f => !ALLOWED_STAGE.test(f));
if (illegalStaged.length) die("暂存区含非发布文件，已中止（git add -A 曾致仓库根文件误提交）：\n  " + illegalStaged.join("\n  "));
/* commit 附 APK 哈希（对侧审核建议）：审核方可用哈希核对「对侧出的是不是这个包」——恢复 dist 迁 Releases 后的可验证性 */
const msg = commitMsg || ("移动端 v" + versionName + "（versionCode " + newCode + "）出包：release.js 流水线 · APK MD5 " + md5 + " · 真机回归后 verify-apk 收口");
git(["commit", "-m", msg]);
const pushed = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim();
let ok = false, lastErr = "";
for (let i = 1; i <= 8 && !ok; i++) {
  const r = spawnSync("git", ["push", "origin", pushed], { encoding: "utf8", cwd: WEB_ROOT });
  const out = (r.stdout || "") + (r.stderr || "");
  if (out.indexOf("fetch first") > -1 || out.indexOf("rejected") > -1) {
    die("推送被拒（远端有新提交）——请先 fetch/merge 后重跑。按项目纪律不做 force push。");
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: WEB_ROOT }).stdout.trim();
  const remote = spawnSync("git", ["rev-parse", "origin/" + pushed], { encoding: "utf8", cwd: WEB_ROOT }).stdout.trim();
  if (r.status === 0 && head === remote) { ok = true; console.log("  ✅ 已推送并验证 origin/" + pushed + " = " + head.slice(0, 7)); break; }
  lastErr = out.trim().split("\n").pop();
  console.log("  推送重试 " + i + "/8（" + lastErr + "）");
  /* 同步睡眠 30s：不用 Windows timeout.exe——execSync 下 stdin 重定向会让其报错退出 125 并抛异常 */
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
}
if (!ok) die("推送 8 次未达（" + lastErr + "）——提交已在本地，网络恢复后手动 git push origin main 即可");
console.log("\n✅ 出包完成：v" + versionName + "（versionCode " + newCode + "）· " + kb + "KB · MD5 " + md5);
