#!/usr/bin/env node
/* =========================================================
 * new-domain.js —— 领域脚手架（C-2 内容工业化）
 * 用法：node tools/new-domain.js <域名拼音> <显示名> <短名> <emoji>
 * 例： node tools/new-domain.js xiaofei 消费维权 消费 🛒
 * 生成：
 *   ① js/domains/<域名>.js 骨架（3 法条 + 2 场景 + 1 FAQ + 1 案例，占位内容按模板填写）
 *   ② 两端 index.html 自动插入 <script>（锚：gig.js 行后）
 *   ③ registry.js DOMAIN_SVG 自动映射（默认 i-d-minfa，可改）
 *   ④ main.js HOPLINE 求助渠道占位（双端）
 * 之后人工填内容 → node check.js && node test.js 全绿后提交。
 * ========================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MOB_WWW = path.join(ROOT, "..", "legal-assistant mobile", "app", "src", "main", "assets", "www");

const [, , id, name, short, icon] = process.argv;
if (!id || !name || !short || !icon) {
  console.error("用法：node tools/new-domain.js <域名拼音> <显示名> <短名> <emoji>");
  console.error("例：node tools/new-domain.js xiaofei 消费维权 消费 🛒");
  process.exit(1);
}
if (!/^[a-z][a-z0-9]{1,11}$/.test(id)) { console.error("域名须为 2-12 位小写字母/数字"); process.exit(1); }

const webDomain = path.join(ROOT, "js", "domains", id + ".js");
const mobDomain = path.join(MOB_WWW, "js", "domains", id + ".js");
for (const p of [webDomain, mobDomain]) {
  if (fs.existsSync(p)) { console.error("已存在：" + p); process.exit(1); }
}

const template = `/* =========================================================
 * 领域：${name}（${id}）
 * —— 内容为要点式整理，具体条文措辞以国家法律法规数据库正式文本为准。
 * 由 tools/new-domain.js 脚手架生成，占位内容须逐条核实后替换。
 * ========================================================= */
window.DomainRegistry.registerDomain({
  id: "${id}",
  name: "${name}",
  short: "${short}",
  icon: "${icon}",
  color: "#92701e",
  keywords: ["TODO-关键词1", "TODO-关键词2", "TODO-关键词3"],

  /* ================= 法条库（3 条起，逐条核实现行文本） ================= */
  laws: [
    { id: "${id.slice(0, 4)}-1", domain: "${id}",
      law: "《TODO 法律全名》（版本标注）", lawShort: "TODO 简称",
      article: "第X条", title: "TODO 条目主题",
      tags: ["TODO 标签"],
      text: "TODO 要点式整理条文内容。",
      note: "TODO 适用提示/实务要点。" },
    { id: "${id.slice(0, 4)}-2", domain: "${id}",
      law: "《TODO 法律全名》", lawShort: "TODO 简称",
      article: "第Y条", title: "TODO 条目主题",
      tags: ["TODO 标签"],
      text: "TODO 要点式整理。",
      note: "TODO。" },
    { id: "${id.slice(0, 4)}-3", domain: "${id}",
      law: "《TODO 法律全名》", lawShort: "TODO 简称",
      article: "第Z条", title: "TODO 条目主题",
      tags: ["TODO 标签"],
      text: "TODO 要点式整理。",
      note: "TODO。" }
  ],

  /* ================= 咨询场景（2 个起，result 四字段：headline/summary/analysis/laws/advice/deadline） ================= */
  scenarios: [
    { id: "${id.slice(0, 4)}-s1", domain: "${id}", icon: "📋",
      name: "TODO 场景名（一句话痛点）",
      keywords: ["TODO 触发词"],
      desc: "TODO 场景描述",
      questions: [
        { id: "q1", text: "TODO 澄清问题 1？", options: [
          { value: "optA", label: "TODO 选项 A" },
          { value: "optB", label: "TODO 选项 B" }
        ]}
      ],
      result: function (a) {
        var out = { headline: "TODO 结论标题", summary: "", analysis: [], laws: ["${id.slice(0, 4)}-1"], advice: [], deadline: "TODO 时效提示" };
        /* 每个 option 分支都要覆盖（test.js 776 组合枚举会验证 result 不抛错且四字段齐） */
        if (a.q1 === "optA") {
          out.summary = "TODO 分支 A 结论。";
          out.analysis.push("TODO 分析。");
          out.advice.push("TODO 行动建议。");
        } else {
          out.summary = "TODO 分支 B 结论。";
          out.analysis.push("TODO 分析。");
          out.advice.push("TODO 行动建议。");
        }
        return out;
      }
    }
  ],

  /* ================= 讲堂 FAQ ================= */
  faq: [
    { domain: "${id}", tags: ["TODO"],
      q: "TODO 高频问题？",
      a: "TODO 答案（要点式，与现有 FAQ 不重复——test.js 有跨域重复检测）。" }
  ],

  /* ================= 典型案例 ================= */
  cases: [
    { domain: "${id}", title: "TODO 案例标题",
      tags: ["TODO"],
      facts: "TODO 基本案情。",
      ruling: "TODO 裁判要点。",
      lesson: "TODO 实务启示。" }
  ]
});
`;

fs.writeFileSync(webDomain, template);
fs.writeFileSync(mobDomain, template);
console.log("① 骨架：js/domains/" + id + ".js（双端）");

/* ② index.html script 插入（锚 gig.js 行后，两端） */
for (const f of [path.join(ROOT, "index.html"), path.join(MOB_WWW, "index.html")]) {
  let s = fs.readFileSync(f, "utf8");
  if (s.indexOf("domains/" + id + ".js") !== -1) continue;
  const anchor = '<script src="js/domains/gig.js"></script>';
  if (s.indexOf(anchor) === -1) { console.error("② ANCHOR MISS " + f); process.exit(1); }
  s = s.replace(anchor, anchor + '\n<script src="js/domains/' + id + '.js"></script>');
  fs.writeFileSync(f, s);
}
console.log("② index.html script（双端）");

/* ③ DOMAIN_SVG 映射（默认 i-d-minfa） */
for (const f of [path.join(ROOT, "js", "registry.js"), path.join(MOB_WWW, "js", "registry.js")]) {
  let s = fs.readFileSync(f, "utf8");
  if (s.indexOf(id + ': "i-d-') !== -1) continue;
  const anchor = 'xiaofei: "i-d-minfa"';
  if (s.indexOf(anchor) === -1) { console.error("③ SVG ANCHOR MISS " + f); process.exit(1); }
  s = s.replace(anchor, anchor + ',\n    ' + id + ': "i-d-minfa"');
  fs.writeFileSync(f, s);
}
console.log("③ DOMAIN_SVG（默认 i-d-minfa，可改）");

/* ④ HOPLINE 占位（双端 main.js，分支文件分别插） */
for (const f of [path.join(ROOT, "js", "main.js"), path.join(MOB_WWW, "js", "main.js")]) {
  let s = fs.readFileSync(f, "utf8");
  if (s.indexOf(id + ': "TODO') !== -1) continue;
  const anchor = '    biaozhu: "12315（知识产权/消费投诉）",';
  if (s.indexOf(anchor) === -1) { console.error("④ HOPLINE ANCHOR MISS " + f); process.exit(1); }
  s = s.replace(anchor, anchor + '\n    ' + id + ': "TODO-热线（12348 兜底已有）",');
  fs.writeFileSync(f, s);
}
console.log("④ HOPLINE 占位（双端）");

console.log("\n✅ 脚手架完成。下一步：");
console.log("  1. 填写 " + id + ".js 占位内容（法条逐条核对现行文本）");
console.log("  2. node check.js && node test.js 全绿");
console.log("  3. 双端 diff " + id + ".js 应 IDENTICAL");
console.log("  4. 在 LEGAL_CHANGELOG.md 登记本批内容变更");
