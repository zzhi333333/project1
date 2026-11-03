#!/usr/bin/env node
/* =========================================================
 * test.js —— 计算器断言测试（零依赖，Node ≥12）
 * 用法：node test.js
 * 作用：用最小 DOM 桩在 Node 中执行 tools.js，对 10 个计算器
 *       逐个喂入用例并断言渲染结果中的关键金额/天数/日期。
 *       计算器是法律软件里最不容出错的纯规则部分（2N 封顶、
 *       LPR 四倍、诉讼费累进、定金 20% 等），发布前必跑。
 * 说明：不改产品代码——通过 bindCalc 绑定在按钮桩上的 click
 *       处理器触发计算，对输出 innerHTML 做包含断言。
 * ========================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
let pass = 0, fail = 0;

/* ---------------- 最小 DOM 桩 ---------------- */
function makeEl(id) {
  const el = {
    id: id,
    value: "",
    checked: false,
    innerHTML: "",
    textContent: "",
    style: {},
    dataset: {},
    maxLength: 524288,
    _handlers: {},
    selectedOptions: [{ textContent: "" }],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) { const has = this._set.has(c); const want = force === undefined ? !has : !!force; if (want) this._set.add(c); else this._set.delete(c); return want; },
      contains(c) { return this._set.has(c); }
    },
    addEventListener(type, fn) { (el._handlers[type] = el._handlers[type] || []).push(fn); },
    removeEventListener() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    remove() {},
    setAttribute(k, v) { el["attr_" + k] = v; },
    getAttribute(k) { return el["attr_" + k] || null; },
    scrollIntoView() {},
    focus() {},
    click() { (el._handlers.click || []).forEach(function (fn) { fn.call(el, { target: el, preventDefault() {}, stopPropagation() {} }); }); }
  };
  return el;
}

const els = {};   /* id -> 元素桩（首次访问自动创建） */
const store = {}; /* localStorage 内存替身 */

const sandbox = {
  console: console,
  setTimeout: function () {},        /* 屏蔽日历提醒定时器，避免挂起进程 */
  clearTimeout: function () {},
  document: {
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { const e = makeEl("__anon__"); e.tagName = tag; return e; },
    body: makeEl("body")
  },
  navigator: {},
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  }
};
sandbox.window = sandbox;
sandbox.window.Notification = undefined;
vm.createContext(sandbox);

/* ---------------- 载入 tools.js ---------------- */
const toolsPath = path.join(root, "js", "tools.js");
vm.runInContext(fs.readFileSync(toolsPath, "utf8"), sandbox, { filename: "js/tools.js" });
const TOOLS = sandbox.window.TOOLS;
if (!TOOLS || !TOOLS.init) { console.error("❌ tools.js 未暴露 window.TOOLS，无法测试"); process.exit(1); }
TOOLS.init();

/* 触发某计算器：点击 bindCalc 绑定的按钮桩 */
function runCalc(btnId) {
  const btn = els[btnId];
  if (!btn || !btn._handlers.click) throw new Error("按钮未绑定：" + btnId);
  btn._handlers.click.forEach(function (fn) { fn.call(btn); });
}

/* 读某输出容器内容 */
function out(id) { return els[id] ? els[id].innerHTML : ""; }

/* 断言工具 */
function T(name, fn) {
  try { fn(); pass++; console.log("  ✅ " + name); }
  catch (e) { fail++; console.log("  ❌ " + name + "\n      " + e.message); }
}
function expectContains(html, needle, label) {
  if (html.indexOf(needle) === -1) throw new Error((label || "断言失败") + "：输出中未找到「" + needle + "」\n      实际输出：" + html.slice(0, 220).replace(/\n/g, " "));
}
function expectWarn(html, label) {
  if (html.indexOf("tool-warn") === -1) throw new Error((label || "应出现输入校验提示") + "：输出不是 tool-warn\n      实际输出：" + html.slice(0, 160));
}
/* 输入快捷方式：{ "sv-from": "2020-01-01", ... }；键含 -comp/-willful 视为 checkbox */
function feed(map) {
  Object.keys(map).forEach(function (id) {
    if (!els[id]) els[id] = makeEl(id);
    if (/-comp$|-willful$/.test(id)) els[id].checked = !!map[id];
    else els[id].value = String(map[id]);
  });
}

console.log("━━ 计算器断言测试（js/tools.js）");

/* ---------- 1. 经济补偿金 ---------- */
T("经济补偿金：4年6个月 / 月薪1万 / 2N → ¥100,000", function () {
  feed({ "sv-from": "2020-01-01", "sv-to": "2024-07-01", "sv-salary": "10000", "sv-avg": "", "sv-type": "2N" });
  runCalc("sv-calc");
  const h = out("sv-result");
  expectContains(h, "折算 <b>5</b> 个月");            // 54个月 → 4年+余6个月(≥6按1年)
  expectContains(h, "¥ 100,000");                     // 10000×5×2
});
T("经济补偿金：整2年 N=2（每满一年一个月）→ N+1 = 8000×2+8000 = ¥24,000", function () {
  feed({ "sv-from": "2022-01-01", "sv-to": "2024-01-01", "sv-salary": "8000", "sv-avg": "", "sv-type": "N+1" });
  runCalc("sv-calc");
  const h = out("sv-result");
  expectContains(h, "折算 <b>2</b> 个月");
  expectContains(h, "¥ 24,000");
});
T("经济补偿金：社平3倍封顶（工资3.5万/社平1万，19年6个月→n=20，年限按12封顶）→ 30000×12×2 = ¥720,000", function () {
  feed({ "sv-from": "2005-01-01", "sv-to": "2024-07-01", "sv-salary": "35000", "sv-avg": "10000", "sv-type": "2N" });
  runCalc("sv-calc");
  const h = out("sv-result");
  expectContains(h, "3倍封顶");
  expectContains(h, "年限按 12 个月计");
  expectContains(h, "¥ 720,000");
});
T("经济补偿金：空输入 → 校验提示", function () {
  feed({ "sv-from": "", "sv-to": "", "sv-salary": "" });
  runCalc("sv-calc");
  expectWarn(out("sv-result"));
});

/* ---------- 2. 加班费 ---------- */
T("加班费：时薪50 × (2×150% + 4×200% + 1×300%) → ¥700", function () {
  feed({ "ot-salary": "8700", "ot-weekday": "2", "ot-weekend": "4", "ot-weekend-comp": false, "ot-holiday": "1" });
  runCalc("ot-calc");
  expectContains(out("ot-result"), "¥ 700");
});
T("加班费：休息日已补休 → 该项计 0", function () {
  feed({ "ot-salary": "8700", "ot-weekday": "0", "ot-weekend": "8", "ot-weekend-comp": true, "ot-holiday": "0" });
  runCalc("ot-calc");
  expectContains(out("ot-result"), "已勾选补休，本项计 0");
  expectContains(out("ot-result"), "¥ 0");
});

/* ---------- 3. 年休假 ---------- */
T("年休假：工龄12年 → 10 天", function () {
  feed({ "al-years": "12", "al-join": "" });
  runCalc("al-calc");
  expectContains(out("al-result"), "10 天");
});
T("年休假：工龄 3 年 → 5 天；不满 1 年 → 0 天", function () {
  feed({ "al-years": "3", "al-join": "" });
  runCalc("al-calc");
  expectContains(out("al-result"), "5 天");
  feed({ "al-years": "0.5", "al-join": "" });
  runCalc("al-calc");
  expectContains(out("al-result"), "不满1年");
});

/* ---------- 4. 专利期限 ---------- */
T("专利期限：发明 2020-06-15 申请 → 保护期至 2040年6月15日", function () {
  feed({ "pt-type": "invention", "pt-date": "2020-06-15" });
  runCalc("pt-calc");
  const h = out("pt-result");
  expectContains(h, "2040年6月15日");
  expectContains(h, "实质审查请求截止");              // 发明特有节点
  expectContains(h, "2023年6月15日");                 // 3年实审截止
});

/* ---------- 5. 时效倒计时 ---------- */
T("时效倒计时：2026-01-01 + 365 天 → 届满 2027-01-01", function () {
  feed({ "dl-date": "2026-01-01", "dl-type": "365" });
  runCalc("dl-calc");
  expectContains(out("dl-result"), "2027-01-01");
});
T("时效倒计时：自定义天数缺失 → 校验提示", function () {
  feed({ "dl-date": "2026-01-01", "dl-type": "custom", "dl-days": "" });
  runCalc("dl-calc");
  expectWarn(out("dl-result"));
});

/* ---------- 6. 民间借贷利息 ---------- */
T("借贷利息：LPR 3.0 → 司法上限 12%；约定 20% 超限 → 仅保护 12%", function () {
  feed({ "ln-principal": "100000", "ln-rate": "20", "ln-months": "12", "ln-lpr": "3", "ln-paid": "0" });
  runCalc("ln-calc");
  const h = out("ln-result");
  expectContains(h, "12.00%");
  expectContains(h, "¥ 12,000");                      // 100000×12%×1年
  expectContains(h, "不受支持");                      // 超限 8000
});

/* ---------- 7. 诉讼费用 ---------- */
T("诉讼费：标的 10 万 → 全额 ¥2,300；保全 20 万 → ¥1,500", function () {
  feed({ "cf-amount": "100000", "cf-proc": "normal", "cf-baoquan": "200000" });
  runCalc("cf-calc");
  const h = out("cf-result");
  expectContains(h, "¥ 2,300");                       // 50 + 90000×2.5%
  expectContains(h, "¥ 1,500");                       // 1000 + 100000×0.5%
});
T("诉讼费：简易程序减半 → ¥1,150", function () {
  feed({ "cf-amount": "100000", "cf-proc": "simple", "cf-baoquan": "0" });
  runCalc("cf-calc");
  expectContains(out("cf-result"), "¥ 1,150");
});

/* ---------- 8. 抚养费 ---------- */
T("抚养费：月入1万 / 1 子 → 20%–30% 即 ¥2,000–¥3,000", function () {
  feed({ "fy-income": "10000", "fy-kids": "1", "fy-fixed": "yes" });
  runCalc("fy-calc");
  expectContains(out("fy-result"), "¥ 2,000 – ¥ 3,000");
});
T("抚养费：3 子 → 30%–50%", function () {
  feed({ "fy-income": "10000", "fy-kids": "3", "fy-fixed": "yes" });
  runCalc("fy-calc");
  expectContains(out("fy-result"), "¥ 3,000 – ¥ 5,000");
});

/* ---------- 9. 违约金与定金 ---------- */
T("定金：合同10万约定3万 → 超上限，有效定金2万；收受方违约双倍返还4万", function () {
  feed({ "dj-amount": "100000", "dj-deposit": "30000", "dj-penalty": "0", "dj-loss": "0", "dj-side": "receiver" });
  runCalc("dj-calc");
  const h = out("dj-result");
  expectContains(h, "超过上限");
  expectContains(h, "¥ 20,000");                      // 有效定金 = 10万×20%
  expectContains(h, "¥ 40,000");                      // 双倍返还
});
T("违约金：约定5万 / 实际损失3万 → 超过130%（3.9万）可请求酌减", function () {
  feed({ "dj-amount": "100000", "dj-deposit": "0", "dj-penalty": "50000", "dj-loss": "30000", "dj-side": "payer" });
  runCalc("dj-calc");
  expectContains(out("dj-result"), "适当减少");
});
T("违约金：约定3万 / 损失3万 → 区间内不调整", function () {
  feed({ "dj-amount": "100000", "dj-deposit": "0", "dj-penalty": "30000", "dj-loss": "30000", "dj-side": "payer" });
  runCalc("dj-calc");
  expectContains(out("dj-result"), "不予以调整");
});

/* ---------- 10. 知产侵权赔偿 ---------- */
T("知产赔偿：商标/实际损失10万/惩罚2倍 → ¥200,000", function () {
  feed({ "ip-type": "tm", "ip-basis": "loss", "ip-amount": "100000", "ip-willful": true, "ip-times": "2", "ip-cost": "0" });
  runCalc("ip-calc");
  expectContains(out("ip-result"), "¥ 200,000");
});
T("知产赔偿：法定赔偿 + 惩罚性勾选 → 提示不得以法定赔偿为基数", function () {
  feed({ "ip-type": "cr", "ip-basis": "statutory", "ip-amount": "", "ip-willful": true, "ip-times": "3", "ip-cost": "0" });
  runCalc("ip-calc");
  expectContains(out("ip-result"), "不能以法定赔偿数额为基数");
});
T("知产赔偿：惩罚倍数 8（超出1–5）→ 校验提示", function () {
  feed({ "ip-type": "tm", "ip-basis": "loss", "ip-amount": "10000", "ip-willful": true, "ip-times": "8", "ip-cost": "0" });
  runCalc("ip-calc");
  expectWarn(out("ip-result"));
});

/* ---------- 结果 ---------- */
console.log("\n────────────────────────");
console.log(fail === 0
  ? "✅ 计算器测试通过：" + pass + " 项断言"
  : "❌ 计算器测试未通过：" + fail + " 项失败 / 共 " + (pass + fail) + " 项");
process.exit(fail === 0 ? 0 : 1);
