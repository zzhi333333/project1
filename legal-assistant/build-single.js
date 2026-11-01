/* =========================================================
 * build-single.js —— 单文件离线版构建（零依赖，Node 直接运行）
 * 把 index.html 引用的 css/style.css 与全部 <script src> 内联，
 * 生成 dist/legal-assistant-single.html —— 双击即可使用的单文件。
 *
 * 用法：node build-single.js   （或双击 构建单文件.bat）
 * 注意：源文件更新后需重新运行本脚本。
 * ========================================================= */
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}

let html = read("index.html");
const before = html.length;

/* 1. 内联样式表 */
const css = read(path.join("css", "style.css"));
const linkTag = '<link rel="stylesheet" href="css/style.css">';
if (!html.includes(linkTag)) {
  console.error("❌ 未找到样式表引用：" + linkTag);
  process.exit(1);
}
html = html.replace(linkTag, "<style>\n" + css + "\n</style>");

/* 2. 内联全部脚本（保持原顺序）；防止 JS 内的 </script> 提前闭合标签 */
const srcRe = /<script src="([^"]+)"><\/script>/g;
let count = 0, missing = [];
html = html.replace(srcRe, function (m, src) {
  count++;
  let p = src;
  if (!fs.existsSync(path.join(ROOT, p))) { missing.push(src); return m; }
  let js = read(p).replace(/<\/script>/gi, "<\\/script>");
  return "<script>\n/* ==== 内联自 " + src + " ==== */\n" + js + "\n</script>";
});
if (missing.length) {
  console.error("❌ 以下脚本文件缺失：\n" + missing.join("\n"));
  process.exit(1);
}

/* 3. 标识与说明 */
html = html.replace(
  "<head>",
  "<head>\n<!-- 单文件离线版：由 build-single.js 自动生成，请勿手工编辑；源码见 legal-assistant/ 项目目录 -->"
);

/* 4. 输出 */
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
const out = path.join(ROOT, "dist", "legal-assistant-single.html");
fs.writeFileSync(out, html, "utf8");

console.log("✅ 单文件版已生成：dist/legal-assistant-single.html");
console.log("   大小：" + Math.round(html.length / 1024) + " KB（源 " + Math.round(before / 1024) + " KB + 内联 " + count + " 个脚本）");
console.log("   双击此文件即可离线使用全部本地功能；联网检索/AI 需另跑 server.js。");
