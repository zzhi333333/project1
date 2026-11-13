/* =========================================================
 * 法律咨询 Agent agent.js
 * —— 可核验的三层防线架构：
 *   ①生成前：仅基于「资料区」（本地法条库/案例库 + flk 官方全文）作答，
 *            硬约束提示词禁止引用资料区外法条、禁止编造数字/期限/机关
 *   ②生成后：引用核验（每条《法名》第X条 对照本地库+flk全文逐条核实）
 *            + 数字断言核验（期限/比例/金额须在资料区有依据）
 *   ③展示层：引用内联 ✓/<svg class=ico><use href=#i-warn></use></svg> 徽标 + 引用核验报告 + 严格模式重新生成
 * —— 工作流透明化：领域识别→场景→法条→联网全文→生成→核验
 * ========================================================= */
window.AGENT = (function () {

  /* ============ 工具：中文数字互转 ============ */
  var CN_D = "零一二三四五六七八九";
  function num2cn(n) {
    n = Math.floor(n);
    if (n <= 10) return ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][n];
    if (n < 20) return "十" + (n % 10 ? CN_D[n % 10] : "");
    if (n < 100) {
      var s = CN_D[Math.floor(n / 10)] + "十";
      if (n % 10) s += CN_D[n % 10];
      return s;
    }
    var b = Math.floor(n / 100), r = n % 100, out = CN_D[b] + "百";
    if (r === 0) return out;
    if (r < 10) return out + "零" + CN_D[r];
    if (r < 20) return out + "一十" + (r % 10 ? CN_D[r % 10] : "");
    return out + CN_D[Math.floor(r / 10)] + "十" + (r % 10 ? CN_D[r % 10] : "");
  }
  function cn2num(str) {
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    var total = 0, section = 0, num = 0;
    var D = { "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
    var U = { "十": 10, "百": 100, "千": 1000 };
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (D[ch] != null) num = D[ch];
      else if (U[ch]) { section += (num || 1) * U[ch]; num = 0; }
    }
    return total + section + num;
  }
  function normLaw(name) {
    return String(name || "").replace(/[《》\s]/g, "").replace(/中华人民共和国/g, "");
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ============ flk 全文缓存（会话级） ============ */
  var LAW_TEXT_CACHE = {};
  function fetchLawFullText(name) {
    var key = normLaw(name);
    if (LAW_TEXT_CACHE[key] !== undefined) return Promise.resolve(LAW_TEXT_CACHE[key]);
    if (!window.ONLINE || !window.ONLINE.isAvailable()) return Promise.resolve(null);
    /* 检索定位 bbbs → 官方 docx 正文提取（服务端解压）→ 全文入资料区 */
    var p = window.ONLINE.flkSearch(name, 1).then(function (r) {
      if (!r || !r.ok || !r.results || !r.results.length) return null;
      var hit = r.results[0];
      return window.ONLINE.flkText(hit.id).then(function (t) {
        return (t && t.ok && t.text) ? { title: (hit.title || t.title || "").replace(/<[^>]+>/g, ""), text: t.text } : null;
      });
    }).catch(function () { return null; });
    /* 8 秒兜底，避免拖慢工作流 */
    LAW_TEXT_CACHE[key] = Promise.race([p, new Promise(function (res) { setTimeout(function () { res(null); }, 8000); })]);
    return LAW_TEXT_CACHE[key];
  }

  /* ============ 核验引擎 ============ */
  /* citations: [{raw, law, articleNum, lawOnly}] */
  function parseCitations(text) {
    var out = [];
    var re = /《([^》]{2,25})》(?:\s*(?:之)?第\s*([一二三四五六七八九十百零两\d]{1,6})\s*条)?/g, m;
    var seen = {};
    while ((m = re.exec(text))) {
      var k = m[1] + "#" + (m[2] || "");
      if (seen[k]) continue;
      seen[k] = 1;
      out.push({ raw: m[0], law: m[1], articleRaw: m[2] || "", articleNum: m[2] ? cn2num(m[2]) : null });
    }
    return out;
  }

  /* 本地库核验（全量：legacy 全局 + 6 个注册域，经 DomainRegistry.collect 聚合） */
  var ALL_LAWS_CACHE = null;
  function allLaws() {
    if (!ALL_LAWS_CACHE) {
      ALL_LAWS_CACHE = (window.DomainRegistry && window.DomainRegistry.collect)
        ? window.DomainRegistry.collect("laws")
        : (window.LAWS || []);
    }
    return ALL_LAWS_CACHE;
  }
  function verifyLocal(cit) {
    var norm = normLaw(cit.law);
    var matches = allLaws().filter(function (l) {
      var ls = normLaw(l.lawShort), lf = normLaw(l.law);
      return ls.indexOf(norm) > -1 || norm.indexOf(ls) > -1 || lf.indexOf(norm) > -1 || norm.indexOf(lf) > -1;
    });
    if (!matches.length) return null;
    if (cit.articleNum == null) return { status: "ok", source: "本地知识库", law: matches[0].law, text: "" };
    for (var i = 0; i < matches.length; i++) {
      var l = matches[i];
      var an = cn2num(l.article.replace(/[^0-9一二三四五六七八九十百零两]/g, ""));
      if (an === cit.articleNum) return { status: "ok", source: "本地知识库", law: l.law, entry: l, text: l.text };
    }
    return { status: "law-only", source: "本地知识库", law: matches[0].law, text: "" };
  }

  /* 联网全文核验（flk） */
  function verifyOnline(cit, fullTexts) {
    var norm = normLaw(cit.law);
    for (var key in fullTexts) {
      var t = fullTexts[key];
      if (!t || !t.text) continue;
      if (key.indexOf(norm) > -1 || norm.indexOf(key) > -1) {
        if (cit.articleNum == null) return { status: "ok", source: "国家法律法规数据库", law: t.title, text: "", tier: 2, textChecked: true, officialTitle: t.title };
        var hitAr = t.text.indexOf("第" + cit.articleNum + "条") > -1;
        var hitCn = t.text.indexOf("第" + num2cn(cit.articleNum) + "条") > -1;
        if (hitAr || hitCn) return { status: "ok", source: "国家法律法规数据库", law: t.title, text: "", tier: 2, textChecked: true, officialTitle: t.title };
      }
    }
    return null;
  }

  /* 二级核验：本地命中的条文与「flk 官方全文本机缓存」做文本比对（联网取过原文即有缓存） */
  function checkOfficialText(entry) {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf("legal-flk-text:") !== 0) continue;
        var c = JSON.parse(localStorage.getItem(k) || "null");
        if (!c || !c.title || !c.text) continue;
        var nt = normLaw(c.title), nl = normLaw(entry.law);
        if (nt.indexOf(nl) === -1 && nl.indexOf(nt) === -1) continue;
        /* 官方全文里找该条条文文本（取本地摘要的前 24 字做锚点，规范化空白后比对） */
        var anchor = entry.text.replace(/\s+/g, "").slice(0, 24);
        if (anchor && c.text.replace(/\s+/g, "").indexOf(anchor) > -1)
          return { tier: 2, textChecked: true, officialTitle: c.title };
        return { tier: 1, textChecked: false, officialTitle: c.title, note: "已获官方全文但未匹配到该条摘要文本（可能为摘要改写），建议点开原文比对" };
      }
    } catch (e) { /* localStorage 不可用时按一级处理 */ }
    return { tier: 1, textChecked: false };
  }

  /* 数字断言核验：期限/比例/倍数/金额须在资料区有依据 */
  function parseNumberClaims(text) {
    var out = [];
    var patterns = [
      /(\d+(?:\.\d+)?)\s*(%|％)/g,
      /(\d+(?:\.\d+)?)\s*倍/g,
      /(\d+)\s*个?月(?!薪|工资)/g,
      /(\d+)\s*(?:日|天)/g,
      /(\d+)\s*年(?!限$|龄)/g,
      /(\d+(?:\.\d+)?)\s*万元/g,
      /(\d+)\s*元/g
    ];
    var seen = {};
    patterns.forEach(function (re) {
      var m;
      while ((m = re.exec(text))) {
        var full = m[0], n = m[1];
        /* 排除编号性数字：第X步/X. 之类（前一个字符是'第'或'.'） */
        var idx = m.index;
        var prev = idx > 0 ? text[idx - 1] : "";
        if (prev === "第" || prev === "." || prev === "、") continue;
        var k = full + "@" + idx;
        if (seen[k]) continue;
        seen[k] = 1;
        out.push({ raw: full, num: n, snippet: text.slice(Math.max(0, idx - 12), idx + full.length + 12).trim() });
      }
    });
    return out;
  }
  function verifyNumberClaim(claim, ctxText) {
    var n = claim.num, forms = [];
    var ar = String(claim.raw);
    var num = parseFloat(n);
    var cn = num2cn(num);
    forms.push(ar, cn + ar.replace(/^[\d.]+/, ""));
    if (/%|％/.test(ar)) { forms.push("百分之" + cn); }
    if (/个?月/.test(ar)) { forms.push(cn + "个月", cn + "月"); }
    if (/日|天/.test(ar)) { forms.push(cn + "日", cn + "天"); }
    if (/年/.test(ar)) { forms.push(cn + "年"); }
    if (/万元/.test(ar)) { forms.push(cn + "万", num + "万"); }
    for (var i = 0; i < forms.length; i++) {
      if (forms[i] && ctxText.indexOf(forms[i]) > -1) return true;
    }
    return false;
  }

  /* 综合核验：三级制 —— ①来源可定位(tier1) ②原文已核对(tier2) ③结论支持（数字断言） */
  function verifyText(answerText, ctxText, fullTexts) {
    var cits = parseCitations(answerText);
    var citResults = cits.map(function (c) {
      var v = verifyLocal(c);
      if ((!v || v.status !== "ok") && fullTexts) {
        var o = verifyOnline(c, fullTexts);
        if (o) v = o;
      }
      var res = {
        cit: c,
        status: v ? v.status : "fail",
        source: v ? v.source : null,
        lawDisplay: v ? v.law : c.law,
        lawId: v && v.entry ? v.entry.id : null,
        text: v ? v.text : "",
        tier: 0, textChecked: false, articleLocated: true
      };
      if (res.status === "ok") {
        if (v.tier) { res.tier = v.tier; res.textChecked = !!v.textChecked; res.officialTitle = v.officialTitle || ""; }
        else if (v.entry) {
          /* 本地命中：尝试与官方全文本机缓存做文本比对升二级 */
          var t2 = checkOfficialText(v.entry);
          res.tier = t2.tier; res.textChecked = t2.textChecked; res.officialTitle = t2.officialTitle || ""; res.tierNote = t2.note || "";
        } else { res.tier = 1; }
      } else if (res.status === "law-only") {
        res.tier = 1; res.articleLocated = false;
      }
      return res;
    });
    var nums = parseNumberClaims(answerText).map(function (c) {
      return { claim: c, ok: verifyNumberClaim(c, ctxText) };
    });
    var verified = citResults.filter(function (x) { return x.status === "ok"; }).length;
    var tier2 = citResults.filter(function (x) { return x.tier === 2; }).length;
    return {
      citations: citResults,
      numbers: nums,
      verifiedCount: verified,
      tier2Count: tier2,
      totalCitations: citResults.length,
      flaggedNumbers: nums.filter(function (x) { return !x.ok; }).length,
      allOk: verified === citResults.length && nums.every(function (x) { return x.ok; })
    };
  }

  /* 答案内联标注：三级徽标 —— ✓✓ 原文已核对 / ✓ 来源已定位 / ⚠ 未核实 */
  function annotate(answerText, verification) {
    var html = esc(answerText);
    verification.citations.forEach(function (r) {
      var badge, cls, tip;
      if (r.status === "ok" && r.tier === 2) {
        badge = " ✓✓"; cls = "cite-ok2";
        tip = "原文已核对：该条文文本与官方全文（" + esc(r.officialTitle || r.lawDisplay) + "）比对一致";
      } else if (r.status === "ok") {
        badge = " ✓"; cls = "cite-ok";
        tip = "来源已定位：" + esc(r.lawDisplay) + (r.cit.articleNum ? " 第" + r.cit.articleNum + "条" : "") + "（" + esc(r.source) + "）；联网获取官方全文后可升级为「原文已核对」";
      } else if (r.status === "law-only") {
        badge = " <svg class=ico><use href=#i-warn></use></svg>"; cls = "cite-warn";
        tip = "仅定位到该法律，未能定位到该条文号——请核对条文号是否准确";
      } else {
        badge = " <svg class=ico><use href=#i-warn></use></svg>"; cls = "cite-warn";
        tip = "未能核实该引用，请到法条检索页人工确认";
      }
      var safeRaw = esc(r.cit.raw).replace(/"/g, "&quot;");
      /* V9：可定位引用带 data-law-id（点击就地展开条文原文卡）；未定位的带 data-law-name（卡片引导检索） */
      var lawAttr = r.lawId ? ' data-law-id="' + esc(r.lawId) + '"' : ' data-law-name="' + safeRaw + '"';
      html = html.split(esc(r.cit.raw)).join('<span class="' + cls + '" title="' + tip + '"' + lawAttr + ' style="cursor:pointer">' + safeRaw + badge + "</span>");
    });
    /* 未核实数字断言高亮 */
    verification.numbers.forEach(function (x) {
      if (x.ok) return;
      var safeRaw = esc(x.claim.raw).replace(/"/g, "&quot;");
      var tip = "数字断言待核实：「" + esc(x.claim.raw) + "」未在资料区找到依据，请人工确认";
      html = html.split(esc(x.claim.raw)).join('<span class="num-warn" title="' + tip + '">' + safeRaw + "<svg class=ico><use href=#i-warn></use></svg></span>");
    });
    return html;
  }

  /* ============ V9 引用条文原文卡（就地展开，对标引用溯源体验） ============ */
  function openLawCard(lawId, fallbackName) {
    var l = lawId && window.DomainRegistry ? window.DomainRegistry.lawById(lawId) : null;
    var old = document.getElementById("law-card-modal");
    if (old) old.remove();
    var w = document.createElement("div");
    w.className = "modal";
    w.id = "law-card-modal";
    var body;
    if (l) {
      body = '<div class="lawcard-title">' + esc(l.law + " " + l.article) + '</div>' +
        (l.title ? '<div class="lawcard-head dim" style="font-size:12px">' + esc(l.title) + '</div>' : "") +
        '<div class="lawcard-text">' + esc(l.text || "（本地库未收录条文正文）") + '</div>' +
        (l.note ? '<div class="lawcard-note"><svg class=ico><use href=#i-d-patent></use></svg> ' + esc(l.note) + '</div>' : "") +
        (l.url ? '<a class="mini-btn" target="_blank" rel="noopener" href="' + esc(l.url) + '" style="margin-top:10px"><svg class=ico><use href=#i-link></use></svg> 官方原文</a>' : "");
    } else {
      body = '<div class="lawcard-title">' + esc(fallbackName || "引用条文") + '</div>' +
        '<div class="tool-warn">本地知识库未收录该条文的原文——请到「法条」页检索核实（联网模式可查国家法律法规数据库）。</div>';
    }
    w.innerHTML = '<div class="modal-mask"></div><div class="modal-card" style="max-width:600px;width:94%">' +
      '<div class="modal-title"><svg class=ico><use href=#i-laws></use></svg> 引用条文原文</div>' +
      '<div class="modal-body" style="max-height:60vh;overflow-y:auto">' + body + '</div>' +
      '<div class="modal-foot"><button class="primary" id="lawcard-go"><svg class=ico><use href=#i-search></use></svg> 到法条页检索</button><button id="lawcard-close">关闭</button></div>' +
      '<div class="modal-note" style="padding:0 18px 12px;font-size:11px">条文原文仅供阅读核对，以官方公布文本为准。</div></div>';
    document.body.appendChild(w);
    w.querySelector(".modal-mask").addEventListener("click", function () { w.remove(); });
    w.querySelector("#lawcard-close").addEventListener("click", function () { w.remove(); });
    w.querySelector("#lawcard-go").addEventListener("click", function () {
      var q = l ? (l.law + " " + l.article) : (fallbackName || "");
      w.remove();
      var tab = document.querySelector('.nav-tab[data-view="laws"]');
      if (tab) tab.click();
      var inp = document.getElementById("law-search-input");
      if (inp) { inp.value = q; inp.dispatchEvent(new Event("input", { bubbles: true })); }
      var sb = document.getElementById("law-search-btn");
      if (sb) sb.click();
    });
  }
  /* 事件委托：报告/AI 回答中带 data-law-id / data-law-name 的引用徽标 → 条文卡（绑定一次全局生效） */
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-law-id],[data-law-name]") : null;
    if (!el) return;
    if (el.hasAttribute("data-law-id")) openLawCard(el.getAttribute("data-law-id"), el.getAttribute("data-law-name") || "");
    else openLawCard(null, el.getAttribute("data-law-name") || "");
  });

  /* ============ V10 事实高亮：报告正文的日期/金额自动着色 ============ */
  var FACT_SKIP = { SCRIPT: 1, STYLE: 1, BUTTON: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, SVG: 1 };
  var FACT_RE = /(?:[12]\d{3}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|[12]\d{3}-\d{1,2}-\d{1,2})|\d[\d,]{2,}(?:\.\d+)?\s*元|[¥￥]\s?\d[\d,]*/g;
  function factSkip(node) {
    var p = node.parentNode;
    if (!p || FACT_SKIP[p.nodeName]) return true;
    if (p.classList && p.classList.contains) {
      if (p.classList.contains("fact-hl") || p.classList.contains("gl-hl") ||
          p.classList.contains("cite-ok") || p.classList.contains("cite-ok2") ||
          p.classList.contains("cite-warn") || p.classList.contains("num-warn")) return true;
    }
    return false;
  }
  function highlightFacts(root) {
    if (!root || !document.createTreeWalker) return 0;
    var walker = document.createTreeWalker(root, 4, null, false);   /* 4 = SHOW_TEXT */
    var nodes = [], n = walker.nextNode();
    while (n) { nodes.push(n); n = walker.nextNode(); }
    var count = 0;
    nodes.forEach(function (node) {
      var cur = node, guard = 0;
      while (cur && count < 80 && guard < 40) {
        guard++;
        if (factSkip(cur)) break;
        FACT_RE.lastIndex = 0;
        var m = FACT_RE.exec(cur.nodeValue || "");
        if (!m) break;
        var a = cur.splitText(m.index);
        var b = a.splitText(m[0].length);
        var span = document.createElement("span");
        span.className = "fact-hl";
        span.textContent = a.nodeValue;
        a.parentNode.replaceChild(span, a);
        cur = b;
        count++;
      }
    });
    return count;
  }

  /* ============ 硬约束提示词 ============ */
  function agentDomainText() {
    return window.DomainRegistry.metas().map(function (d) { return d.name; }).join("、") +
      "，以及美国/欧盟经贸合规要点（涉外内容为要点指引，涉具体合规决策须提示咨询专业律师并以官方最新文本为准）";
  }
  var AGENT_PROMPT =
    "你是「法律咨询Agent」，服务领域：" + agentDomainText() + "。你必须严格遵守以下「可核验性」规则：\n" +
    "1. 只能依据【资料区】提供的法条原文、案例要点和用户案情作答；【资料区】未涵盖的问题，明确回答「本工具资料未涵盖该问题，建议查询国家法律法规数据库或官方来源并咨询执业律师」，不得凭训练记忆猜测。\n" +
    "2. 引用法条必须使用《法律名》第X条的完整格式，且该法条必须出现在【资料区】中；严禁引用【资料区】之外的任何法条、司法解释、条例。\n" +
    "3. 涉及期限（多少日/月/年）、比例（百分之X）、金额、机关名称的表述，只能来自【资料区】或用户案情原文；资料区没有的数字一律不得出现，也不得换算编造。\n" +
    "4. 严禁编造案例名称、案号、政策文件名、统计数据。\n" +
    "5. 对不确定的事实，明确标注「需核实」。\n" +
    "6. 回答结构（律师意见书式）：\n" +
    "  ① 假设与限制：说明本分析基于用户陈述的事实为真；列出尚未核实、可能影响结论的事项清单。\n" +
    "  ② 结论（先给直接结论）。\n" +
    "  ③ 争点式分析：将案件拆解为 2–4 个关键法律争点，每个争点按「争点问题 → 法律规则（引用资料区法条）→ 适用到本案事实 → 小结」展开。\n" +
    "  ④ 对方抗辩预案：给出对方可能的 2–3 个抗辩及我方应对与所需反驳证据（若用户为被主张方则给出我方抗辩思路）。\n" +
    "  ⑤ 行动建议 → 时效提醒 → 末尾注明「以上仅供参考，不构成法律意见」。\n" +
    "你的回答将被程序逐条核验引用与数字，未核实内容会被标注并要求重新生成，请确保每一句法律断言都有资料区依据。";

  function buildContextBlock(q, c) {
    var s = "\n\n【用户案情/问题】\n" + q;
    s += "\n\n【资料区·匹配场景】" + c.scenarios.map(function (x) { return x.name; }).join("、");
    s += "\n【资料区·法条（仅可引用以下条文）】\n" + c.laws.map(function (l) {
      return "· 《" + l.lawShort + "》第" + l.article.replace("第", "").replace("条", "") + "条（" + l.title + "）：" + l.text;
    }).join("\n");
    s += "\n【资料区·参考案例】\n" + c.cases.map(function (x) {
      return "· " + (x.no ? x.no + "：" : "") + x.title + "｜要点：" + (x.gist || x.ruling || "");
    }).join("\n");
    return s;
  }

  /* 复制辅助：把报告对象转为纯文本 */
  function reportToText(rep) {
    var L = [];
    L.push("【案件分析参考报告】");
    L.push("识别领域：" + rep.domainName + (rep.confidence ? "（置信度 " + rep.confidence + "%）" : ""));
    if (rep.focus && rep.focus.length) L.push("争议焦点：" + rep.focus.join("、"));
    if (rep.facts) {
      var f = [];
      if (rep.facts.amounts && rep.facts.amounts.length) f.push("涉案金额：" + rep.facts.amounts.map(function (a) { return a.raw; }).join("、"));
      if (rep.facts.dates && rep.facts.dates.length) f.push("时间线索：" + rep.facts.dates.join("、"));
      if (rep.facts.durations && rep.facts.durations.length) f.push("年限线索：" + rep.facts.durations.join("、"));
      if (f.length) L.push(f.join("；"));
    }
    if (rep.scenarios && rep.scenarios.length) L.push("初步定性：" + rep.scenarios.map(function (s) { return s.name + "——" + s.desc; }).join("\n"));
    if (rep.laws && rep.laws.length) L.push("\n【相关法条】\n" + rep.laws.map(function (l) { return "《" + l.lawShort + "》" + l.article + "（" + l.title + "）：" + l.text; }).join("\n"));
    if (rep.procedure) L.push("\n【程序建议】\n" + rep.procedure.map(function (p) { return p.stage + "\n" + p.detail.map(function (x) { return " - " + x; }).join("\n"); }).join("\n"));
    if (rep.claims && rep.claims.length) L.push("\n【请求事项参考】\n" + rep.claims.map(function (c, i) { return (i + 1) + ". " + c; }).join("\n"));
    if (rep.evidence && rep.evidence.length) L.push("\n【证据清单】\n" + rep.evidence.map(function (x) { return " - " + x; }).join("\n"));
    if (rep.risks && rep.risks.length) L.push("\n【风险提示】\n" + rep.risks.map(function (x) { return " - " + x; }).join("\n"));
    L.push("\n以上仅供参考，不构成法律意见。");
    return L.join("\n");
  }
  function appendCopyButton(container, text, vstats) {
    var cp = document.createElement("button");
    cp.className = "mini-btn";
    cp.style.margin = "10px 14px";
    cp.innerHTML = "<svg class=ico><use href=#i-copy></use></svg> 复制报告全文";
    cp.addEventListener("click", function () {
      var done = function () { cp.innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已复制"; setTimeout(function () { cp.textContent = "<svg class=ico><use href=#i-copy></use></svg> 复制报告全文"; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
      else {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      }
    });
    container.appendChild(cp);
    /* 存入报告库（本机 localStorage，可回顾/再次导出） */
    var saveBtn = document.createElement("button");
    saveBtn.className = "mini-btn";
    saveBtn.style.margin = "10px 4px";
    saveBtn.innerHTML = "<svg class=ico><use href=#i-save></use></svg> 存入报告库";
    saveBtn.addEventListener("click", function () {
      var saved = saveReport({
        q: els.input ? els.input.value.trim().slice(0, 300) : "",
        mode: mode === "ai" ? "AI 可核验分析" : "规则引擎报告",
        html: container.querySelector(".bubble, .report-card") ? (container.querySelector(".bubble") || container).innerHTML : container.innerHTML,
        text: text.slice(0, 8000),
        verify: els.panel ? (els.panel.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : "",
        vstats: vstats || null
      });
      saveBtn.innerHTML = saved === "trimmed"
        ? "<svg class=ico><use href=#i-warn></use></svg> 已存入；空间不足已清理最旧报告"
        : saved
          ? "<svg class=ico><use href=#i-checkc></use></svg> 已存入报告库"
          : "<svg class=ico><use href=#i-warn></use></svg> 存储空间不足";
      if (saved && window.TOOLS && window.TOOLS.haptic) window.TOOLS.haptic(12);
      setTimeout(function () { saveBtn.innerHTML = "<svg class=ico><use href=#i-save></use></svg> 存入报告库"; }, 1800);
    });
    container.appendChild(saveBtn);
  }

  /* ============ 报告存档（本机 localStorage，上限 30 份） ============ */
  var REPORT_KEY = "legal-agent-reports";
  function loadReports() {
    try { return JSON.parse(localStorage.getItem(REPORT_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveReports(list) {
    /* 超 30 份与配额溢出两种截断都会静默丢最旧报告——被砍掉的同步解除工作区关联，避免悬空引用 */
    var trimmed = list.slice(30);
    try {
      localStorage.setItem(REPORT_KEY, JSON.stringify(list.slice(0, 30)));
      if (trimmed.length && window.WORKSPACE && WORKSPACE.purgeReports) {
        try { WORKSPACE.purgeReports(trimmed.map(function (r) { return r.id; })); } catch (e3) { }
      }
      return trimmed.length ? "trimmed" : true;
    } catch (e) { /* 配额溢出：砍到 10 份再试一次 */
      var quotaTrimmed = list.slice(10);
      if (quotaTrimmed.length && window.WORKSPACE && WORKSPACE.purgeReports) {
        try { WORKSPACE.purgeReports(quotaTrimmed.map(function (r) { return r.id; })); } catch (e3) { }
      }
      try { localStorage.setItem(REPORT_KEY, JSON.stringify(list.slice(0, 10))); return quotaTrimmed.length ? "trimmed" : true; } catch (e2) { return false; }
    }
  }
  function saveReport(entry) {
    var list = loadReports();
    var sid = "";
    try {
      var mc = window.ANALYSIS.matchContext(entry.q || "");
      if (mc && mc.scenarios && mc.scenarios[0]) sid = mc.scenarios[0].id;
    } catch (e) { }
    var rec = { id: "r-" + Date.now(), date: new Date().toISOString(), q: entry.q, mode: entry.mode, html: entry.html, text: entry.text, verify: entry.verify, vstats: entry.vstats || null, scenarioId: sid };
    list.unshift(rec);
    var ok = saveReports(list);
    /* 案件工作区自动归集（当前案件激活时） */
    if (ok && window.WORKSPACE) window.WORKSPACE.attach("reports", { id: rec.id, name: String(rec.q || "").slice(0, 60), date: rec.date.slice(0, 10) });
    return ok;
  }
  function openReportArchive() {
    var old = document.getElementById("report-archive-modal");
    if (old) { old.remove(); return; }
    var list = loadReports();
    var modal = document.createElement("div");
    modal.id = "report-archive-modal";
    modal.className = "modal";
    var rows = list.length ? list.map(function (r, i) {
      var d = new Date(r.date);
      var ts = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      /* 核验概览：tier 分布一行看全（旧记录无 vstats 则回退 200 字摘要） */
      var vline = "";
      if (r.vstats && r.vstats.totalCitations) {
        var s = r.vstats;
        vline = '<div style="font-size:11.5px;margin-top:3px">核验：<span style="color:#16a34a">✓✓ ' + s.tier2Count + "/" + s.totalCitations + "</span>" +
          " · ✓ " + Math.max(0, s.verifiedCount - s.tier2Count) +
          (s.totalCitations - s.verifiedCount > 0 ? ' · <span style="color:var(--danger)">⚠ ' + (s.totalCitations - s.verifiedCount) + "</span>" : "") +
          (s.numbers ? " · 数字 " + (s.numbers - s.flagged) + "/" + s.numbers : "") + "</div>";
      }
      return '<div class="ci-card" data-i="' + i + '">' +
        '<div class="case-title">' + esc(r.q.slice(0, 60) || "未命名案情") + '</div>' +
        '<div class="dim" style="font-size:11.5px">' + ts + " · " + esc(r.mode) + (r.verify && !r.vstats ? " · " + esc(r.verify.slice(0, 60)) : "") + '</div>' + vline +
        '<div class="ci-actions">' +
          '<button class="mini-btn primary rep-view">查看</button>' +
          '<button class="mini-btn rep-export">导出 Word</button>' +
          '<button class="mini-btn rep-del" style="color:var(--danger)">删除</button>' +
        '</div>' +
        '</div>';
    }).join("") : '<div class="empty dim">还没有存档的报告——分析完成后点「存入报告库」保存到本机。</div>';
    modal.innerHTML =
      '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:640px;width:92%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-save></use></svg> 报告存档（本机）</div>' +
        '<div class="modal-body" style="max-height:64vh;overflow-y:auto" id="rep-list">' + rows + '</div>' +
        '<div class="modal-foot"><button class="mini-btn" id="rep-close">关闭</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#rep-close").addEventListener("click", function () { modal.remove(); });
    modal.querySelectorAll(".ci-card").forEach(function (card) {
      var r = list[parseInt(card.getAttribute("data-i"), 10)];
      card.querySelector(".rep-view").addEventListener("click", function () {
        var body = modal.querySelector("#rep-list");
        body.innerHTML =
          '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
            '<button class="mini-btn" id="rep-back">← 返回列表</button>' +
            '<button class="mini-btn primary" id="rep-export2">导出 Word</button>' +
          '</div>' +
          '<div class="dim" style="font-size:12px;margin-bottom:8px">' + esc(r.q.slice(0, 100)) + '</div>' +
          '<div class="bubble" style="flex:1">' + r.html + '</div>';
        body.querySelector("#rep-back").addEventListener("click", function () { modal.remove(); openReportArchive(); });
        body.querySelector("#rep-export2").addEventListener("click", function () { exportReportHtml(r); });
      });
      card.querySelector(".rep-export").addEventListener("click", function () { exportReportHtml(r); });
      card.querySelector(".rep-del").addEventListener("click", function () {
        var doDel = function () {
          saveReports(loadReports().filter(function (x) { return x.id !== r.id; }));
          if (window.WORKSPACE && WORKSPACE.purgeReports) WORKSPACE.purgeReports([r.id]);   /* 删除同步解除工作区关联 */
          modal.remove();
          openReportArchive();
        };
        if (window.UIKIT && UIKIT.confirmModal) UIKIT.confirmModal("删除报告存档", "删除后不可恢复（不影响案件工作区中的关联条目，仅标记失效）。", "删除").then(function (ok) { if (ok) doDel(); });
        else doDel();
      });
    });
  }
  /* 存档报告 → Word 文档下载（与 exportDoc 同格式，来源为存档内容） */
  function exportReportHtml(r) {
    var t = new Date(r.date);
    var pad = function (n) { return ("0" + n).slice(-2); };
    var dateStr = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    var html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="zh-CN"><head><meta charset="utf-8"><title>案件分析参考意见书</title>' +
      '<style>body{font-family:"Microsoft YaHei","PingFang SC",SimSun,sans-serif;font-size:12pt;line-height:1.8;color:#111;margin:24pt}' +
      'h2{font-size:16pt;text-align:center;margin:6pt 0 2pt}' +
      '.doc-meta{text-align:center;color:#555;font-size:10pt;border-bottom:1pt solid #999;padding-bottom:6pt;margin-bottom:10pt}' +
      '.doc-foot{margin-top:16pt;border-top:1pt solid #999;padding-top:6pt;color:#777;font-size:9.5pt}' +
      '.verify-panel{border:1pt solid #999;padding:8pt;font-size:10.5pt}' +
      '</style></head><body>' +
      '<h2>案件分析参考意见书</h2>' +
      '<div class="doc-meta">法律咨询助手 · ' + dateStr + " · " + esc(r.mode) + '</div>' +
      '<div style="border-left:3pt solid #4f46e5;padding:6pt 10pt;margin:10pt 0"><b>案情摘述：</b>' + esc(r.q) + '</div>' +
      (r.html || "") +
      (r.verify ? '<div class="verify-panel">' + esc(r.verify) + '</div>' : "") +
      '<div class="doc-foot">免责声明：本报告由「法律咨询助手」基于公开法律信息生成，仅供参考，不构成法律意见或代理服务；具体案件请咨询执业律师。</div>' +
      '</body></html>';
    var fname = "法律分析意见书-" + dateStr + "-" + pad(t.getHours()) + pad(t.getMinutes()) + ".doc";
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) {
      window.BRIDGE.exportFile(fname, html).then(function () { if (window.BRIDGE.toast) window.BRIDGE.toast("已导出 " + fname); }, function () {});
      return;
    }
    var blob = new Blob(["\ufeff" + html], { type: "application/msword" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ============ 案件评估矩阵（信息完备度 · 定性版，非胜诉率） ============ */
  function buildAssessment(rep) {
    var items = [];
    var amounts = (rep.facts && rep.facts.amounts) ? rep.facts.amounts.length : 0;
    var dates = (rep.facts && rep.facts.dates) ? rep.facts.dates.length : 0;
    items.push({ k: "事实线索", v: (amounts > 0 ? "金额线索 " + amounts + " 项" : "未识别到金额") + "；" + (dates > 0 ? "时间线索 " + dates + " 项" : "未识别到时间"), level: (amounts + dates) >= 2 ? "较充分" : (amounts + dates === 1 ? "偏少" : "不足") });
    /* 证据三性自检（如做过） */
    var checks = null;
    try { checks = JSON.parse(localStorage.getItem("legal-ev-checks") || "{}")[rep.scenarios && rep.scenarios[0] ? rep.scenarios[0].id : ""] || null; } catch (e) {}
    if (checks) {
      var total = 0, ok = 0;
      for (var k in checks) { total++; if (checks[k]["真实性"]) ok++; }
      items.push({ k: "证据自检", v: "已确认真实性 " + ok + "/" + total + " 项", level: total === 0 ? "未开始" : (ok === total && total > 0 ? "较充分" : "有断点") });
    } else {
      items.push({ k: "证据自检", v: "尚未做证据三性自检——建议在咨询结果卡的「证据清单」中完成", level: "未开始" });
    }
    if (rep.deadline) items.push({ k: "时效提示", v: rep.deadline, level: /尽快|立即|1年|15日|60日|30日/.test(rep.deadline) ? "注意期限" : "常规" });
    return items.map(function (x) {
      var color = x.level === "较充分" ? "var(--ok)" : (x.level === "不足" || x.level === "注意期限" ? "var(--warn)" : "var(--ink-2)");
      return '<div class="assess-item"><div class="assess-k">' + esc(x.k) + '</div><div class="assess-v">' + esc(x.v) + '</div><div class="assess-l" style="color:' + color + '">' + esc(x.level) + '</div></div>';
    }).join("");
  }

  /* ============ 劳动仲裁请求清单生成器（数字组合器） ============ */
  /* 请求项模板：id/名称/参数说明/计算函数/法条依据。金额均保留 2 位小数，标注以官方最新口径为准 */
  var ARBITRATION_ITEMS = [
    { id: "severance2n", name: "违法解除劳动合同赔偿金（2N）", params: [
        { k: "salary", label: "离职前12个月平均月工资（元）" }, { k: "years", label: "工作年限（年，半年以上按1年、不足半年按0.5）" }
      ], law: "《劳动合同法》第87条、第47条",
      calc: function (p) { return round2((parseFloat(p.salary) || 0) * (parseFloat(p.years) || 0) * 2); },
      formula: function (p) { return fmt(p.salary) + " 元/月 × " + p.years + " 年 × 2"; } },
    { id: "severanceN", name: "经济补偿金（N）", params: [
        { k: "salary", label: "离职前12个月平均月工资（元）" }, { k: "years", label: "工作年限（年）" }
      ], law: "《劳动合同法》第46条、第47条",
      calc: function (p) { return round2((parseFloat(p.salary) || 0) * (parseFloat(p.years) || 0)); },
      formula: function (p) { return fmt(p.salary) + " 元/月 × " + p.years + " 年"; } },
    { id: "doublewage", name: "未签书面劳动合同二倍工资差额", params: [
        { k: "salary", label: "月工资（元）" }, { k: "months", label: "未签合同的月数（最长 11）" }
      ], law: "《劳动合同法》第82条",
      calc: function (p) { var m = Math.min(parseFloat(p.months) || 0, 11); return round2((parseFloat(p.salary) || 0) * m); },
      formula: function (p) { return fmt(p.salary) + " 元/月 × " + Math.min(parseFloat(p.months) || 0, 11) + " 个月（上限 11 个月）"; } },
    { id: "overtime", name: "加班费", params: [
        { k: "salary", label: "月工资（元）" }, { k: "wd", label: "工作日延时加班（小时）" },
        { k: "we", label: "休息日加班（小时）" }, { k: "hd", label: "法定节假日加班（小时）" }
      ], law: "《劳动法》第44条",
      calc: function (p) {
        var h = (parseFloat(p.salary) || 0) / 21.75 / 8;
        return round2(h * (parseFloat(p.wd) || 0) * 1.5 + h * (parseFloat(p.we) || 0) * 2 + h * (parseFloat(p.hd) || 0) * 3);
      },
      formula: function (p) { return "时薪 " + fmt(parseFloat(p.salary) || 0) + " ÷ 21.75 ÷ 8 = " + fmt((parseFloat(p.salary) || 0) / 21.75 / 8) + " 元；延时 " + p.wd + "h×150% + 休息日 " + p.we + "h×200% + 节假日 " + p.hd + "h×300%"; } },
    { id: "annual", name: "未休年休假工资折算（另付 200% 部分）", params: [
        { k: "salary", label: "月工资（元）" }, { k: "days", label: "未休年休假天数" }
      ], law: "《职工带薪年休假条例》第5条、《企业职工带薪年休假实施办法》第10条",
      calc: function (p) { return round2((parseFloat(p.salary) || 0) / 21.75 * (parseFloat(p.days) || 0) * 2); },
      formula: function (p) { return fmt(p.salary) + " ÷ 21.75 × " + p.days + " 天 × 200%（含正常工资的 300% 中，另行支付 200%）"; } },
    { id: "arrears", name: "拖欠工资", params: [
        { k: "amount", label: "拖欠金额合计（元）" }
      ], law: "《劳动合同法》第30条",
      calc: function (p) { return round2(parseFloat(p.amount) || 0); },
      formula: function (p) { return "直接主张 " + fmt(p.amount); } }
  ];
  function round2(n) { return Math.round(n * 100) / 100; }
  function fmt(n) { var v = parseFloat(n); return isFinite(v) ? v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "0"; }

  function openArbitrationList() {
    var old = document.getElementById("arb-list-modal");
    if (old) { old.remove(); return; }
    var modal = document.createElement("div");
    modal.id = "arb-list-modal";
    modal.className = "modal";
    var body = ARBITRATION_ITEMS.map(function (it, i) {
      return '<div class="arb-item" data-i="' + i + '">' +
        '<label class="arb-check"><input type="checkbox" checked> <b>' + esc(it.name) + '</b><span class="arb-law">' + esc(it.law) + '</span></label>' +
        '<div class="arb-params">' + it.params.map(function (p) {
          return '<label>' + esc(p.label) + '<input class="arb-in" data-k="' + p.k + '" type="number" min="0" inputmode="decimal" placeholder="0"></label>';
        }).join("") + '</div>' +
        '<div class="arb-sum dim" style="font-size:12px"></div>' +
        '</div>';
    }).join("");
    modal.innerHTML =
      '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:600px;width:94%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-list></use></svg> 劳动仲裁请求清单生成器</div>' +
        '<div class="modal-body" style="max-height:56vh;overflow-y:auto">' + body +
          '<div class="calc-note">金额为规则化试算，具体以仲裁委/法院认定与官方最新口径为准；经济补偿/赔偿金有「当地社平工资 3 倍封顶」等特殊规则的请人工复核。</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="mini-btn" id="arb-close">关闭</button>' +
          '<button class="mini-btn primary" id="arb-copy"><svg class=ico><use href=#i-copy></use></svg> 复制请求清单</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#arb-close").addEventListener("click", function () { modal.remove(); });

    function collect() {
      var rows = [];
      var total = 0;
      modal.querySelectorAll(".arb-item").forEach(function (item) {
        var idx = parseInt(item.getAttribute("data-i"), 10);
        var it = ARBITRATION_ITEMS[idx];
        var on = item.querySelector("input[type=checkbox]").checked;
        var params = {};
        item.querySelectorAll(".arb-in").forEach(function (inp) { params[inp.getAttribute("data-k")] = inp.value; });
        var filled = Object.keys(params).some(function (k) { return parseFloat(params[k]) > 0; });
        if (!on || !filled) return;
        var amt = it.calc(params);
        total += amt;
        rows.push({ name: it.name, amount: amt, formula: it.formula(params), law: it.law });
      });
      return { rows: rows, total: round2(total) };
    }
    function refresh() {
      var c = collect();
      modal.querySelectorAll(".arb-item").forEach(function (item) {
        var idx = parseInt(item.getAttribute("data-i"), 10);
        var it = ARBITRATION_ITEMS[idx];
        var on = item.querySelector("input[type=checkbox]").checked;
        var params = {};
        item.querySelectorAll(".arb-in").forEach(function (inp) { params[inp.getAttribute("data-k")] = inp.value; });
        var filled = Object.keys(params).some(function (k) { return parseFloat(params[k]) > 0; });
        item.querySelector(".arb-sum").textContent = on && filled ? "小计：" + fmt(it.calc(params)) + " 元　｜　计算式：" + it.formula(params) : "";
      });
      return c;
    }
    modal.addEventListener("input", refresh);
    modal.addEventListener("change", refresh);
    refresh();

    modal.querySelector("#arb-copy").addEventListener("click", function () {
      var c = collect();
      var text = "劳动仲裁请求清单\n生成日期：" + new Date().toLocaleDateString("zh-CN") + "\n";
      c.rows.forEach(function (r, i) {
        text += "\n" + (i + 1) + ". " + r.name + "\n   金额：" + fmt(r.amount) + " 元\n   计算式：" + r.formula + "\n   依据：" + r.law + "\n";
      });
      text += "\n合计请求金额：人民币 " + fmt(c.total) + " 元\n\n说明：以上为规则化试算（以官方最新口径为准），具体金额以仲裁委/法院认定为准；另有社平工资 3 倍封顶等特殊规则请人工复核。";
      modal.querySelector("#arb-copy").innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已复制";
      setTimeout(function () { var b = document.getElementById("arb-copy"); if (b) b.innerHTML = "<svg class=ico><use href=#i-copy></use></svg> 复制请求清单"; }, 1600);
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      else {
        var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {} ta.remove();
      }
    });
  }

  /* ============ 维权材料包（zip，仅网页端；移动端请逐项导出） ============ */
  function openPack() {
    var repHtml = (els.answer && els.answer.textContent.trim()) ? els.answer.innerHTML : "";
    var repText = (els.answer && els.answer.textContent.trim()) ? els.answer.textContent.trim() : "";
    if (!repText) { els.answer.innerHTML = '<div class="tool-warn">还没有可打包的分析结果——请先「开始分析」。</div>'; return; }
    var old = document.getElementById("pack-modal");
    if (old) { old.remove(); return; }
    var modal = document.createElement("div");
    modal.id = "pack-modal";
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:460px;width:92%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-box></use></svg> 维权材料包</div>' +
        '<div class="modal-body">' +
          '<div class="modal-note">将以下材料打包为一个 zip 文件（本机生成，不上传）：</div>' +
          '<div class="arb-check"><input type="checkbox" id="pk-report" checked> <b>分析意见书</b>（Word 文档）</div>' +
          '<div class="arb-check"><input type="checkbox" id="pk-evidence" checked> <b>证据准备清单</b>（文本）</div>' +
          '<div class="arb-check"><input type="checkbox" id="pk-timeline" checked> <b>案件时间线</b>（文本）</div>' +
          '<div class="dim" style="font-size:12px;margin-top:6px">提示：zip 内的 Word 文档可用 Word/WPS 打开，执行打印或另存为 PDF。</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="mini-btn" id="pk-cancel">取消</button>' +
          '<button class="mini-btn primary" id="pk-go"><svg class=ico><use href=#i-downtray></use></svg> 打包下载</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#pk-cancel").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#pk-go").addEventListener("click", function () {
      var files = [];
      var t = new Date();
      var pad = function (n) { return ("0" + n).slice(-2); };
      var ds = t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate());
      if (modal.querySelector("#pk-report").checked) {
        var clean = els.answer.cloneNode(true);
        clean.querySelectorAll("button, svg, .ai-cursor").forEach(function (x) { x.remove(); });
        files.push({ name: "分析意见书-" + ds + ".doc", content: buildDocHtml(clean.innerHTML, repText) });
      }
      if (modal.querySelector("#pk-evidence").checked) files.push({ name: "证据准备清单-" + ds + ".txt", content: evidenceText() });
      if (modal.querySelector("#pk-timeline").checked) files.push({ name: "案件时间线-" + ds + ".txt", content: timelineText() });
      modal.remove();
      if (window.PACK && window.PACK.download) window.PACK.download("维权材料包-" + ds + ".zip", files);
    });
  }
  function buildDocHtml(repHtml, repText) {
    var t = new Date();
    var pad = function (n) { return ("0" + n).slice(-2); };
    var dateStr = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="zh-CN"><head><meta charset="utf-8"><title>案件分析参考意见书</title>' +
      '<style>body{font-family:"Microsoft YaHei",SimSun,sans-serif;font-size:12pt;line-height:1.8;color:#111;margin:24pt}h2{font-size:16pt;text-align:center}.doc-meta{text-align:center;color:#555;font-size:10pt;border-bottom:1pt solid #999;padding-bottom:6pt}.doc-foot{margin-top:16pt;border-top:1pt solid #999;padding-top:6pt;color:#777;font-size:9.5pt}</style></head><body>' +
      '<h2>案件分析参考意见书</h2><div class="doc-meta">法律咨询助手 · ' + dateStr + " · " + (mode === "ai" ? "AI 可核验分析" : "规则引擎报告") + '</div>' +
      repHtml +
      '<div class="doc-foot">免责声明：本报告由「法律咨询助手」生成，仅供参考，不构成法律意见；具体案件请咨询执业律师。</div></body></html>';
  }
  function evidenceText() {
    var lines = ["证据准备清单", "生成日期：" + new Date().toLocaleDateString("zh-CN"), ""];
    var rep = lastReport && lastReport.evidence ? lastReport.evidence : (window.ANALYSIS && lastRun ? [] : []);
    (rep || []).forEach(function (x, i) { lines.push("☐ " + (i + 1) + ". " + x); });
    lines.push("", "提示：电子证据保留原始载体；重要证据建议公证或可信时间戳存证。");
    return lines.join("\n");
  }
  function timelineText() {
    var lines = ["案件时间线", "生成日期：" + new Date().toLocaleDateString("zh-CN"), ""];
    var rep = lastReport && lastReport.procedure ? lastReport.procedure : (lastRunReportProcedure || []);
    (rep || []).forEach(function (p) {
      lines.push("◆ " + p.stage);
      (p.detail || []).forEach(function (x) { lines.push("   - " + x); });
      lines.push("");
    });
    return lines.join("\n");
  }

  /* ============ Agent 视图工作流 ============ */
  var els = {};
  var mode = "report";  /* "report" = 规则引擎报告（离线） | "ai" = AI 可核验分析 */
  var lastRun = null;   /* {q, ctxText, fullTexts, messages, domain} 供严格模式重生成与多轮沿用 */
  var runToken = 0;     /* 运行令牌：停止/新运行使其失效，旧异步链全部静默退出 */
  var lastReport = null; /* 最近一次规则报告 {evidence, procedure} 供材料包使用 */
  /* ---- 深度分析多轮记忆（方案 A + 4.3 状态机，用户确认批次）----
     agentHistory 只放案情问答轮次（裸问题 + 回答摘要截 2000 字），资料区只在当前轮
     user 消息注入（不进历史，防 token 爆炸）；「继续」沿用上轮资料区，同域短追问
     沿用历史，长文本（贴新案情）重置——防跨案件串题。内存态，刷新即失。 */
  var agentHistory = [];
  var AGENT_HIST_MAX = 6;   /* 最多 3 组问答 */
  function isContinueMsg(q) {
    var s = String(q || "").trim();
    return /^(请)?(继续|接着|然后|后面|再(说说|分析|讲|展开)|展开(说说|讲)?)/.test(s) || /^(继续|接着)[^。]{0,12}$/.test(s);
  }
  function decideTurn(q, hasHist) {
    if (!hasHist) return "fresh";
    if (isContinueMsg(q)) return "continue";
    /* 短文本默认视为追问（保上下文优先）——域精确相等判据太脆：通用追问（流程/证据/时效）
       常被 classify 打到错误域（如「无效宣告」命中专利反超商标），等于每次都断记忆；
       跨域串题风险由「清空上下文」显式出口 + 长文本新案情重置兜底 */
    if (String(q || "").length <= 40) return "followup";
    return "fresh";
  }

  /* 停止按钮显隐 */
  function setStopBtn(on) {
    var b = document.getElementById("agent-stop");
    if (b) b.classList.toggle("hidden", !on);
  }
  /* 停止当前分析：令牌失效（中断后续阶段）+ 中断正在进行的 AI 生成 */
  function stopAgent() {
    runToken++;
    if (window.AI && window.AI.stopCurrent) window.AI.stopCurrent();
    var b = document.getElementById("agent-stop");
    if (b) b.classList.add("hidden");
    /* 把仍在运行中的步骤标记为已停止（abort 后 catch 里不会再走常规错误展示） */
    if (els.steps) {
      els.steps.querySelectorAll(".agent-step.run").forEach(function (el) {
        el.className = "agent-step warn";
        var n = el.querySelector(".st-note");
        if (n) n.textContent = "已停止";
      });
    }
    if (els.answer && !els.answer.querySelector(".tool-warn")) {
      els.answer.innerHTML += '<div class="tool-warn">已按您的要求停止本次分析。</div>';
    }
  }

  function setMode(m) {
    mode = m;
    var btnR = document.getElementById("agent-mode-report");
    var btnA = document.getElementById("agent-mode-ai");
    if (btnR) btnR.classList.toggle("active", m === "report");
    if (btnA) btnA.classList.toggle("active", m === "ai");
  }

  function stepEl(i) { return document.querySelector('#agent-steps .agent-step[data-i="' + i + '"]'); }
  function stepState(i, state, note) {
    var el = stepEl(i);
    if (!el) return;
    el.className = "agent-step " + state;
    var noteEl = el.querySelector(".st-note");
    if (noteEl && note != null) noteEl.textContent = note;
  }

  function runAgent() {
    var q = els.input.value.trim();
    if (q.length < 10) {
      els.answer.innerHTML = '<div class="tool-warn">请输入完整的案情或问题（至少10个字），需要足够事实才能可靠分析。</div>';
      return;
    }
    els.answer.innerHTML = "";
    els.panel.innerHTML = "";
    els.steps.classList.remove("hidden");
    [0, 1, 2].forEach(function (i) { stepState(i, "run", ""); });
    var myToken = ++runToken;
    setStopBtn(true);

    /* ── 模式一：规则引擎报告（离线、确定性、天然可核验） ── */
    if (mode === "report") {
      var rep = window.ANALYSIS.run(q);
      lastReport = { evidence: rep.evidence, procedure: rep.procedure, domain: rep.domain };
      stepState(0, "done", rep.domainName + " · " + (rep.focus.length ? rep.focus.map(function (s) { return s.replace(/^\S+\s/, ""); }).join("、") : "综合咨询") + " · " + rep.laws.length + " 条法条 + " + rep.cases.length + " 个案例");
      stepState(1, "done", "结构化报告已生成（要素提取/定性/法条/案例/程序建议/证据清单）");
      stepState(2, "skip", "规则报告内容全部来自内置知识库，天然可核验");
      els.answer.innerHTML = "";
      window.ANALYSIS.render(rep, els.answer);
      /* 律师实务深度层：争点分析（IRAC）+ 对方抗辩预案 + 行动路径对比（有数据的领域） */
      var sid = (rep.scenarios && rep.scenarios[0]) ? rep.scenarios[0].id : null;
      var ins = (window.INSIGHTS && sid) ? window.INSIGHTS.get(sid) : null;
      if (ins) {
        var insDiv = document.createElement("div");
        var ih = '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-agent></use></svg> 争点分析（律师思路）</div>';
        ins.issues.forEach(function (it, i) {
          ih += '<div class="irac-block"><div class="irac-q">' + (i + 1) + ". " + esc(it.q) + '</div>' +
            '<div class="irac-line"><b>规则</b>' + esc(it.rule) + '</div>' +
            '<div class="irac-line"><b>适用</b>' + esc(it.apply) + '</div>' +
            '<div class="irac-line irac-concl"><b>小结</b>' + esc(it.concl) + '</div></div>';
        });
        ih += '<div class="calc-note">争点为该类案件的常见分析框架，具体结论取决于在案证据与事实。</div></div>';
        ih += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-shield></use></svg> 对方抗辩预案（Red Team）</div>';
        /* V11 反制链：左轴贯穿 + 序号节点，抗辩→应对→所需证据成链可视 */
        ih += '<div class="defense-chain">';
        ins.defenses.forEach(function (df, di) {
          ih += '<div class="defense-node-wrap"><span class="defense-node">' + (di + 1) + '</span><div class="defense-block"><div class="irac-q"><svg class=ico><use href=#i-warn></use></svg> 对方可能主张：' + esc(df.d) + '</div>' +
            '<div class="irac-line"><b>应对</b>' + esc(df.counter) + '</div>' +
            '<div class="irac-line irac-concl"><b>需准备的证据</b>' + esc(df.ev) + '</div></div></div>';
        });
        ih += '</div>';
        ih += '<div class="calc-note">预判对方抗辩并提前固定反驳证据，是庭审攻防的核心功课。</div></div>';
        insDiv.innerHTML = ih;
        els.answer.appendChild(insDiv);
      }
      /* 行动路径对比（有数据的领域） */
      var paths = (window.INSIGHTS && window.INSIGHTS.pathsFor) ? window.INSIGHTS.pathsFor(rep.domain) : null;
      if (paths) {
        var pDiv = document.createElement("div");
        var ph = '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-list></use></svg> 行动路径对比（怎么选）</div>';
        ph += '<div class="path-table"><div class="path-tr path-th"><div>路径</div><div>成本</div><div>周期</div><div>门槛</div><div>优势</div><div>短板</div><div>适合</div></div>';
        paths.forEach(function (p) {
          ph += '<div class="path-tr"><div><b>' + esc(p.name) + '</b></div><div>' + esc(p.cost) + '</div><div>' + esc(p.time) + '</div><div>' + esc(p.gate) + '</div><div>' + esc(p.pros) + '</div><div>' + esc(p.cons) + '</div><div>' + esc(p.fit) + '</div></div>';
        });
        ph += '</div><div class="calc-note">路径可以组合使用（如先投诉施压再仲裁）；对比为一般情形概括，个案请结合证据与预算判断。</div>';
        /* V4：路径泳道示意条——周期长度与成本颜色按文本描述归档（示意非精确刻度） */
        if (window.SVGCHART) {
          var clsLen = function (t) { t = String(t || ""); return /数天/.test(t) ? 0.25 : /周|日/.test(t) ? 0.55 : 0.85; };
          var clsColor = function (t) { t = String(t || ""); return /免费|0 元/.test(t) ? "var(--ok)" : /很低|低/.test(t) ? "var(--c-info)" : "var(--warn)"; };
          ph += window.SVGCHART.lanes(paths.map(function (p) { return { label: p.name, sub: p.time + " · " + p.cost, len: clsLen(p.time), color: clsColor(p.cost) }; }));
          ph += '<div class="calc-note">泳道为周期/成本的示意排序（按描述归档），以各路径详表为准。</div>';
        }
        ph += '</div>';
        pDiv.innerHTML = ph;
        els.answer.appendChild(pDiv);
      }
      /* 案件评估矩阵（信息完备度定性版，非胜诉率） */
      /* 时效提示补全：ANALYSIS.run 的 rep 原无 deadline 字段——评估矩阵第三行「时效提示」
         从未显示过（隐性缺陷）。从首个命中场景的 result({}) 取回，矩阵与雷达第三轴共用 */
      if (!rep.deadline && rep.scenarios && rep.scenarios[0] && rep.scenarios[0].result) {
        try { var rr0 = rep.scenarios[0].result({}); if (rr0 && rr0.deadline) rep.deadline = rr0.deadline; } catch (eD) {}
      }
      var assess = buildAssessment(rep);
      if (assess) {
        /* V6：信息完备度雷达——评估矩阵三维度可视化（口径不变：完备度画像非胜诉率） */
        var radarHtml = "";
        if (window.SVGCHART) {
          var SCORE_MAP = { "较充分": 1, "偏少": 0.5, "有断点": 0.5, "未开始": 0.15, "不足": 0.15, "常规": 0.85, "注意期限": 0.25 };
          try {
            var items = [];
            var amounts = (rep.facts && rep.facts.amounts) ? rep.facts.amounts.length : 0;
            var dates = (rep.facts && rep.facts.dates) ? rep.facts.dates.length : 0;
            items.push({ label: "事实线索", score: (amounts + dates) >= 2 ? 1 : (amounts + dates === 1 ? 0.5 : 0.15), note: "金额/时间线索 " + (amounts + dates) + " 项" });
            var checks2 = null;
            try { checks2 = JSON.parse(localStorage.getItem("legal-ev-checks") || "{}")[rep.scenarios && rep.scenarios[0] ? rep.scenarios[0].id : ""] || null; } catch (e2) {}
            if (checks2) {
              var tt = 0, ok2 = 0;
              for (var kk in checks2) { tt++; if (checks2[kk]["真实性"]) ok2++; }
              items.push({ label: "证据自检", score: tt === 0 ? 0.15 : (ok2 === tt ? 1 : 0.5), note: "已确认真实性 " + ok2 + "/" + tt + " 项" });
            } else items.push({ label: "证据自检", score: 0.15, note: "尚未做证据三性自检" });
            if (rep.deadline) items.push({ label: "时效充裕", score: /尽快|立即|1年|15日|60日|30日/.test(rep.deadline) ? 0.25 : 0.85, note: rep.deadline });
            if (items.length >= 3) radarHtml = window.SVGCHART.radar(items, { aria: "信息完备度雷达" });
          } catch (eR) { /* 雷达失败不阻断报告 */ }
        }
        var aDiv = document.createElement("div");
        aDiv.innerHTML = '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-checkc></use></svg> 案件评估（信息完备度 · 定性参考）</div>' +
          (radarHtml ? radarHtml + '<div class="calc-note" style="text-align:center">▲ 雷达为上方三项评估的可视化：越外圈越充分（信息完备度画像，非胜诉率）</div>' : "") +
          '<div class="assess-grid">' + assess + '</div>' +
          '<div class="calc-note">本评估仅反映「信息与证据的完备程度」，不代表案件结果；任何结果预测均不可靠，请以执业律师意见为准。</div></div>';
        els.answer.appendChild(aDiv);
      }
      if (window.REPORTFOLD) window.REPORTFOLD.apply(els.answer);
      /* 白话术语卡入口 */
      if (window.GLOSSARY) {
        var gWrap = document.createElement("div");
        gWrap.style.margin = "6px 4px 12px";
        gWrap.innerHTML = window.GLOSSARY.btnHtml() + '<span class="dim" style="font-size:11.5px;margin-left:8px">报告中的 N / 2N / 除斥期间 / 一裁终局……点开可查白话解释</span>';
        els.answer.appendChild(gWrap);
        window.GLOSSARY.bind(els.answer);
        if (window.GLOSSARY.highlight) window.GLOSSARY.highlight(els.answer);
        highlightFacts(els.answer);
      }
      appendCopyButton(els.answer, reportToText(rep));
      /* 劳动领域：追加仲裁请求清单生成器入口 */
      if (rep.domain === "labor") {
        var arbBtn = document.createElement("button");
        arbBtn.className = "mini-btn primary";
        arbBtn.style.margin = "10px 4px";
        arbBtn.innerHTML = "<svg class=ico><use href=#i-list></use></svg> 生成仲裁请求清单";
        arbBtn.addEventListener("click", openArbitrationList);
        els.answer.appendChild(arbBtn);
      }
      setStopBtn(false);
      return;
    }

    /* ── 模式二：AI 可核验分析 ── */
    if (!(window.AI && window.AI.isConfigured())) {
      stepState(0, "warn", "AI 未配置（右上角「AI 模型」设置），自动转为规则报告");
      setMode("report");
      runAgent();
      return;
    }
    /* 图片附件预步骤：AI 读图描述并入案情后重新进入（描述自带「未经核验」标注；规则模式忽略图片） */
    if (agentImages.length) {
      var imgs = agentImages.slice();
      var token0 = runToken;
      Promise.all(imgs.map(function (im) {
        stepState(0, "run", "AI 读图中：" + im.name);
        return window.AI.describeImage(im.dataUrl, im.name).then(function (desc) {
          return "【图片：" + im.name + "（AI 读图描述，未经核验）】\n" + String(desc || "").trim();
        }).catch(function (e) {
          stepState(0, "warn", "读图失败：" + im.name + "（" + (e && e.message || e) + "）——已跳过该图");
          return "";
        });
      })).then(function (parts) {
        if (runToken !== token0) return;
        agentImages.length = 0;
        renderAgentImages();
        var ok = parts.filter(Boolean).join("\n\n");
        if (ok && els.input) els.input.value = (els.input.value || "") + "\n\n" + ok;
        runAgent();
      });
      return;
    }
    var useOnline = els.online.checked;

    /* 步骤①：资料检索（领域/场景/法条/案例 + 联网官方全文） */
    var cls = window.CONSULT.classify(q);
    var c = window.ANALYSIS.matchContext(q);
    var fullTexts = {};
    var onlinePromise;
    if (useOnline && window.ONLINE && window.ONLINE.isAvailable()) {
      var lawsToFetch = [];
      c.laws.forEach(function (l) {
        var name = normLaw(l.law);
        if (lawsToFetch.indexOf(name) === -1 && lawsToFetch.length < 2) lawsToFetch.push(name);
      });
      onlinePromise = Promise.all(lawsToFetch.map(function (name) {
        return fetchLawFullText(name).then(function (t) {
          if (t && t.text) fullTexts[name] = t;
        });
      })).then(function () {
        stepState(0, "done", window.DOMAINS[c.domain].name + " · " + c.laws.length + " 条法条 + " + c.cases.length + " 个案例 + " + Object.keys(fullTexts).length + " 部官方全文");
      });
    } else {
      onlinePromise = Promise.resolve().then(function () {
        stepState(0, "done", window.DOMAINS[c.domain].name + " · " + c.laws.length + " 条法条 + " + c.cases.length + " 个案例" + (useOnline ? "（代理未启动，未取官方全文）" : ""));
      });
    }

    /* 步骤②：约束生成 */
    var ctxText = buildContextBlock(q, c);
    onlinePromise.then(function () {
      if (myToken !== runToken) return null;   /* 已被停止/新运行取代 */
      /* 多轮记忆决策（4.3 状态机）：fresh 重置 / continue 显式继续 / followup 同域短追问 */
      var turn = decideTurn(q, agentHistory.length > 0);
      if (turn === "fresh") agentHistory = [];
      var histMsgs = agentHistory.slice(-AGENT_HIST_MAX);
      /* continue 沿用上轮资料区（本轮 q 无增量信息，matchContext 会 fallback 漂移）；其余按本轮检索 */
      var effCtxText = (turn === "continue" && lastRun) ? lastRun.ctxText : ctxText;
      var effFullTexts = (turn === "continue" && lastRun) ? lastRun.fullTexts : fullTexts;
      var histNote = histMsgs.length ? '<div class="calc-note" style="margin-bottom:8px">🧠 已继承本会话前 ' + (histMsgs.length / 2) + ' 轮对话上下文（深度分析多轮记忆）；<b>清空上下文</b>按钮可重新开始。</div>' : "";
      els.answer.innerHTML = histNote + '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream" style="flex:1"><span class="ai-text"></span><span class="ai-cursor">▍</span></div></div>';
      var span = els.answer.querySelector(".ai-text");
      var ctxForGen = effCtxText;
      Object.keys(effFullTexts).forEach(function (k) {
        ctxForGen += "\n【资料区·官方全文摘录：《" + effFullTexts[k].title + "》（可引用其中条文）】\n" + String(effFullTexts[k].text).slice(0, 6000);
      });
      var userContent = turn === "continue"
        ? "请继续上述分析。\n用户补充：" + (q.length > 6 ? q : "（无补充，请接着展开）") + "\n\n【资料区（沿用上一轮检索结果，可继续引用）】\n" + ctxForGen
        : "请依据资料区分析以下问题：\n" + ctxForGen;
      var messages = [
        { role: "system", content: AGENT_PROMPT + (window.SKILLS && window.SKILLS.promptBlock ? window.SKILLS.promptBlock() : "") + (window.AI && window.AI.langPrompt ? window.AI.langPrompt() : "") }
      ].concat(histMsgs).concat([{ role: "user", content: userContent }]);
      lastRun = {
        q: q,
        ctxText: effCtxText + Object.keys(effFullTexts).map(function (k) { return effFullTexts[k].text; }).join(""),
        fullTexts: effFullTexts, messages: messages,
        domain: (turn === "continue" && lastRun) ? lastRun.domain : c.domain
      };
      var full = "";
      stepState(1, "run", histMsgs.length ? "AI 生成中（已注入 " + (histMsgs.length / 2) + " 轮历史上下文）…" : "AI 生成中（仅可依据资料区作答）…");
      return window.AI.aiChat(messages, function (d) {
        full += d;
        span.textContent = full;
        els.answer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }).then(function () {
        if (myToken !== runToken) return null;
        stepState(1, "done", "生成完毕");
        /* 多轮写回：问答对入历史（user 截 800/assistant 截 2000 防长案情撑爆预算），供后续轮延续 */
        agentHistory.push({ role: "user", content: String(q).slice(0, 800) });
        agentHistory.push({ role: "assistant", content: String(full || "").slice(0, 2000) });
        if (agentHistory.length > AGENT_HIST_MAX) agentHistory = agentHistory.slice(-AGENT_HIST_MAX);
        return { text: full || "（模型未返回内容）", note: histNote };
      });
    }).then(function (gen) {
      if (myToken !== runToken) return;   /* 已被停止/新运行取代 */
      /* 步骤③：核验 */
      if (!gen || !gen.text) {
        stepState(2, "skip", "无内容可核验");
        setStopBtn(false);
        return;
      }
      stepState(2, "run", "正在逐条核验引用与数字断言…");
      var v = verifyText(gen.text, lastRun.ctxText, lastRun.fullTexts);
      stepState(2, v.allOk ? "done" : "warn",
        v.totalCitations + " 条引用核实 " + v.verifiedCount + " 条" + (v.flaggedNumbers ? "；" + v.flaggedNumbers + " 项数字待核实" : ""));
      /* 用标注版替换纯文本（多轮引用可见性随渲染保留：3.2 半采纳项） */
      var html = annotate(gen.text, v);
      els.answer.innerHTML = (gen.note || "") + '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream verified" style="flex:1">' + html + "</div></div>";
      if (window.GLOSSARY && window.GLOSSARY.highlight) window.GLOSSARY.highlight(els.answer);
      highlightFacts(els.answer);
      renderPanel(v, gen.text);
      appendCopyButton(els.answer, gen.text, { verifiedCount: v.verifiedCount, tier2Count: v.tier2Count, totalCitations: v.totalCitations, numbers: v.numbers.length, flagged: v.flaggedNumbers });
      setStopBtn(false);
    }).catch(function (e) {
      if (myToken !== runToken) return;   /* 停止触发的 abort 不当错误展示 */
      if (/abort/i.test(String(e && e.message || e))) {
        stepState(1, "warn", "已停止生成");
        stepState(2, "skip", "");
        els.answer.innerHTML += '<div class="tool-warn">已按您的要求停止本次分析。</div>';
        setStopBtn(false);
        return;
      }
      els.answer.innerHTML += '<div class="tool-warn"><svg class=ico><use href=#i-warn></use></svg> ' + esc(e && e.message || e) + "</div>";
      setStopBtn(false);
    });
  }

  /* 核验报告面板：三级制（①来源可定位 ②原文已核对 ③结论支持） */
  function renderPanel(v, answerText) {
    var html = '<div class="verify-panel"><div class="vp-title"><svg class=ico><use href=#i-shield></use></svg> 引用核验报告（三级）</div>';
    if (!v.totalCitations && !v.numbers.length) {
      html += '<div class="vp-line dim">回答中未出现法条引用与数字断言。</div>';
    } else {
      html += '<div class="vp-line"><b>① 来源可定位：</b>' + v.verifiedCount + " / " + v.totalCitations + " 条引用已在本地知识库或官方来源定位</div>";
      html += '<div class="vp-line"><b>② 原文已核对：</b>' + v.tier2Count + " / " + v.totalCitations + " 条已与官方全文文本比对" +
        (v.tier2Count < v.verifiedCount ? "（其余为本地库定位——联网获取官方全文后可升级）" : "") + "</div>";
      html += '<div class="vp-line"><b>③ 结论支持：</b>数字断言 ' + (v.numbers.length - v.flaggedNumbers) + " / " + v.numbers.length + " 项在资料区有依据" +
        (v.flaggedNumbers ? "，<b>未核实的数字不得作为决策依据</b>" : "") + "</div>";
      html += '<div class="vp-line dim" style="margin-top:4px">分级说明：✓✓=原文已核对（与官方全文文本比对）；✓=来源可定位（本地/联网定位到出处，未逐字比对）；⚠=未能核实。结论的语义正确性不在程序核验范围内，请结合案情自行判断。</div>';
    }
    v.citations.forEach(function (r) {
      var icon, desc;
      if (r.status === "ok" && r.tier === 2) {
        icon = "<svg class=ico><use href=#i-checkc></use></svg>";
        desc = "✓✓ 原文已核对（" + esc(r.officialTitle || r.source) + "）——条文文本与官方全文比对一致";
      } else if (r.status === "ok") {
        icon = "<svg class=ico><use href=#i-checkc></use></svg>";
        desc = "✓ 来源已定位（" + r.source + "）" + (r.tierNote ? "；" + esc(r.tierNote) : "；原文未比对");
      } else if (r.status === "law-only") {
        icon = "<svg class=ico><use href=#i-warn></use></svg>";
        desc = "⚠ 仅定位到该法律，未定位到条文号「第" + r.cit.articleNum + "条」——请核对条文号";
      } else {
        icon = "<svg class=ico><use href=#i-warn></use></svg>";
        desc = "⚠ 未能核实——本地知识库与联网检索均未找到该条文，请到「法条检索」页人工确认";
      }
      html += '<div class="vp-line ' + (r.status === "ok" && r.tier === 2 ? "" : r.status === "ok" ? "" : "bad") + '">' + icon + " 《" + esc(r.cit.law) + "》" +
        (r.cit.articleNum != null ? "第" + r.cit.articleNum + "条" : "") + " — " + desc + "</div>";
    });
    v.numbers.forEach(function (x) {
      if (x.ok) return;
      html += '<div class="vp-line bad"><svg class=ico><use href=#i-warn></use></svg> 数字断言待核实：「' + esc(x.claim.raw) + "」（上下文：…" + esc(x.claim.snippet) + "…）未在资料区找到依据</div>";
    });
    var level = v.allOk && v.tier2Count === v.totalCitations && v.totalCitations > 0
      ? "高（全部引用已核对官方原文，数字断言有依据）"
      : v.allOk
        ? "中高（引用均定位到来源，其中 " + v.tier2Count + " 条已核对原文；" + v.flaggedNumbers + " 项数字待确认）"
        : (v.verifiedCount === v.totalCitations ? "中（引用可定位，" + v.flaggedNumbers + " 项数字待人工确认）" : "中低（" + (v.totalCitations - v.verifiedCount) + " 条引用未核实，请谨慎采纳）");
    html += '<div class="vp-summary">整体可信度：<b>' + level + "</b></div>";
    if (!v.allOk) {
      html += '<button class="mini-btn primary" id="agent-regen"><svg class=ico><use href=#i-wrench></use></svg> 严格模式重新生成（仅使用已核实资料）</button>';
    }
    html += "</div>";
    els.panel.innerHTML = html;
    var regen = document.getElementById("agent-regen");
    if (regen) regen.addEventListener("click", strictRegenerate);
  }

  function strictRegenerate() {
    if (!lastRun) return;
    var v = verifyText(els.answer.innerText, lastRun.ctxText, lastRun.fullTexts);
    var badList = v.citations.filter(function (x) { return x.status !== "ok"; }).map(function (x) { return "《" + x.cit.law + "》" + (x.cit.articleNum != null ? "第" + x.cit.articleNum + "条" : ""); });
    var badNums = v.numbers.filter(function (x) { return !x.ok; }).map(function (x) { return x.claim.raw; });
    var warn = "你上一次回答中以下内容未能通过程序核验：引用 " + (badList.join("、") || "无") + "；数字断言 " + (badNums.join("、") || "无") +
      "。请仅使用【资料区】中已列出的法条与数字重新作答；资料区没有的内容用「建议查询官方数据库核实」替代，不得再次出现上述未核实内容。";
    var messages = lastRun.messages.concat([
      { role: "assistant", content: els.answer.innerText.slice(0, 2000) },
      { role: "user", content: warn }
    ]);
    els.answer.innerHTML = '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream" style="flex:1"><span class="ai-text"></span><span class="ai-cursor">▍</span></div></div>';
    var span = els.answer.querySelector(".ai-text");
    var myToken = ++runToken;
    setStopBtn(true);
    stepState(1, "run", "严格模式重新生成…");
    stepState(2, "run", "");
    var full = "";
    window.AI.aiChat(messages, function (d) { full += d; span.textContent = full; })
      .then(function () {
        if (myToken !== runToken) return;
        stepState(1, "done", "严格模式生成完毕");
        var v2 = verifyText(full, lastRun.ctxText, lastRun.fullTexts);
        stepState(2, v2.allOk ? "done" : "warn", v2.totalCitations + " 条引用核实 " + v2.verifiedCount + " 条" + (v2.flaggedNumbers ? "；" + v2.flaggedNumbers + " 项数字待核实" : ""));
        /* 方案 A 一致性收口（外部审核发现）：严格模式是对同一问题的修正——
           替换 agentHistory 最后一组 assistant（避免同一问题残留两份矛盾回答），
           同步 lastRun.messages 使二次严格重生成可链式拼接；后续「继续」读到修正版 */
        if (agentHistory.length >= 2) {
          agentHistory[agentHistory.length - 1] = { role: "assistant", content: String(full || "").slice(0, 2000) };
          lastRun = Object.assign({}, lastRun, { messages: messages });
        }
        els.answer.innerHTML = '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream verified" style="flex:1">' + annotate(full, v2) + "</div></div>";
        if (window.GLOSSARY && window.GLOSSARY.highlight) window.GLOSSARY.highlight(els.answer);
        highlightFacts(els.answer);
        renderPanel(v2, full);
        appendCopyButton(els.answer, full, { verifiedCount: v2.verifiedCount, tier2Count: v2.tier2Count, totalCitations: v2.totalCitations, numbers: v2.numbers.length, flagged: v2.flaggedNumbers });
        setStopBtn(false);
      })
      .catch(function (e) {
        if (myToken !== runToken) return;
        if (/abort/i.test(String(e && e.message || e))) {
          stepState(1, "warn", "已停止生成"); stepState(2, "skip", "");
          els.answer.innerHTML += '<div class="tool-warn">已按您的要求停止本次分析。</div>';
          setStopBtn(false);
          return;
        }
        els.answer.innerHTML += '<div class="tool-warn"><svg class=ico><use href=#i-warn></use></svg> ' + esc(e && e.message || e) + "</div>";
        setStopBtn(false);
      });
  }

  /* 供外部跳转：预填案情 + 指定模式 + 立即执行 */
  function runWith(text, m) {
    setMode(m === "ai" ? "ai" : "report");
    els.input.value = text;
    runAgent();
  }

  /* ============ 导出 Word 意见书（.doc · HTML 格式，Word/WPS 直接打开） ============ */
  function exportDoc() {
    if (!els.answer || !els.answer.textContent.trim()) {
      els.answer.innerHTML = '<div class="tool-warn">还没有可导出的分析结果——请先「开始分析」。</div>';
      return;
    }
    var clone = els.answer.cloneNode(true);
    clone.querySelectorAll("button, .ai-cursor, .ai-stop, svg").forEach(function (x) { x.remove(); });
    var panelHtml = "";
    if (els.panel && els.panel.textContent.trim()) {
      var pc = els.panel.cloneNode(true);
      pc.querySelectorAll("button, svg").forEach(function (x) { x.remove(); });
      panelHtml = pc.innerHTML;
    }
    var t = new Date();
    var pad = function (n) { return ("0" + n).slice(-2); };
    var dateStr = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    var title = "案件分析参考意见书";
    var html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="zh-CN"><head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>' +
      'body{font-family:"Microsoft YaHei","PingFang SC",SimSun,sans-serif;font-size:12pt;line-height:1.8;color:#111;margin:24pt}' +
      'h2{font-size:16pt;text-align:center;margin:6pt 0 2pt}' +
      '.doc-meta{text-align:center;color:#555;font-size:10pt;border-bottom:1pt solid #999;padding-bottom:6pt;margin-bottom:10pt}' +
      '.doc-q{background:#f2f4f8;border-left:3pt solid #4f46e5;padding:6pt 10pt;margin:10pt 0;font-size:11pt}' +
      '.report-sec{margin:10pt 0}.report-sec-title{font-weight:bold;font-size:13pt;border-left:3pt solid #4f46e5;padding-left:6pt;margin:14pt 0 6pt}' +
      '.fact-chip{border:1pt solid #bbb;padding:1pt 6pt;margin:2pt;font-size:10.5pt}' +
      '.verify-panel{border:1pt solid #999;padding:8pt;margin-top:12pt;font-size:10.5pt}' +
      '.vp-line{margin:3pt 0}.law-note{color:#555;font-size:10.5pt;margin:2pt 0}' +
      '.doc-foot{margin-top:16pt;border-top:1pt solid #999;padding-top:6pt;color:#777;font-size:9.5pt}' +
      'mark{background:#fff3c7}' +
      '</style></head><body>' +
      '<h2>' + title + '</h2>' +
      '<div class="doc-meta">法律咨询助手 · ' + dateStr + ' · ' + (mode === "ai" ? "AI 可核验分析（引用经程序核验）" : "规则引擎报告（内置知识库）") + '</div>' +
      '<div class="doc-q"><b>案情摘述：</b>' + esc(els.input.value.trim().slice(0, 500)) + '</div>' +
      clone.innerHTML +
      panelHtml +
      '<div class="doc-foot">免责声明：本报告由「法律咨询助手」基于公开法律信息生成，仅供参考，不构成法律意见或代理服务；具体案件请咨询执业律师。</div>' +
      '</body></html>';
    var fname = "法律分析意见书-" + dateStr + ".doc";
    /* 移动版：走原生 exportFile（系统保存选择器）；网页版：Blob 下载 */
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) {
      window.BRIDGE.exportFile(fname, html).then(
        function () { if (window.BRIDGE.toast) window.BRIDGE.toast("已导出 " + fname); },
        function (e) {
          var m = String(e && e.error || e || "");
          if (/cancel/i.test(m)) return;   /* 用户取消，不打扰 */
          els.answer.innerHTML += '<div class="tool-warn"><svg class=ico><use href=#i-warn></use></svg> 导出失败：' + esc(m) + '</div>';
        }
      );
      return;
    }
    var blob = new Blob(["\ufeff" + html], { type: "application/msword" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ============ 导出格式选择：Word（直接下载）/ PDF（干净排版经系统打印「另存为 PDF」） ============ */
  function exportChoose() {
    if (!els.answer || !els.answer.textContent.trim()) {
      els.answer.innerHTML = '<div class="tool-warn">还没有可导出的分析结果——请先「开始分析」。</div>';
      return;
    }
    var old = document.getElementById("export-choose-modal");
    if (old) { old.remove(); return; }
    var modal = document.createElement("div");
    modal.id = "export-choose-modal";
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:480px;width:92%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-file></use></svg> 导出分析结果</div>' +
        '<div class="modal-body">' +
          '<button class="exp-opt" id="exp-word"><b>Word 文档（.doc）</b><span>可编辑；在 Word/WPS 中打开后可直接打印或「另存为 PDF」</span></button>' +
          '<button class="exp-opt" id="exp-pdf"><b>PDF（经系统打印对话框）</b><span>正文已裁剪为意见书版式；在打印机一栏选择「另存为 PDF / Microsoft Print to PDF」即可得到 PDF 文件</span></button>' +
          (window.PACK && window.PACK.download ? '<button class="exp-opt" id="exp-pack"><b>维权材料包（zip）</b><span>意见书 + 证据准备清单 + 案件时间线打包为一个 zip 文件（本机生成，不上传）</span></button>' : "") +
        '</div>' +
        '<div class="modal-foot"><button class="mini-btn" id="exp-cancel">取消</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#exp-cancel").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#exp-word").addEventListener("click", function () { modal.remove(); exportDoc(); });
    modal.querySelector("#exp-pdf").addEventListener("click", function () { modal.remove(); printAgentReport(); });
    var packOpt = modal.querySelector("#exp-pack");
    if (packOpt) packOpt.addEventListener("click", function () { modal.remove(); openPack(); });
  }

  /* PDF：干净排版（print-mode 仅显示意见书正文与核验报告）经系统打印——用户选「另存为 PDF」得到真 PDF 文件 */
  function printAgentReport() {
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.printDoc) {
      window.BRIDGE.printDoc("法律咨询意见书");   /* 原生 PrintManager（可存 PDF） */
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "print-target";
    if (window.REPORTFOLD) window.REPORTFOLD.openAll(els.answer);
    var cloneA = els.answer.cloneNode(true);
    cloneA.querySelectorAll("button, .ai-cursor").forEach(function (x) { x.remove(); });
    wrap.appendChild(cloneA);
    if (els.panel && els.panel.textContent.trim()) wrap.appendChild(els.panel.cloneNode(true));
    document.body.appendChild(wrap);
    if (window.printEl) window.printEl(wrap);
    else window.print();
    setTimeout(function () { wrap.remove(); }, 2000);
  }

  /* ============ 供 ai.js 挂载的轻量核验 ============ */
  function attachVerification(bubbleDiv, answerText, ctxText) {
    if (!answerText) return;
    var v = verifyText(answerText, ctxText || "", null);
    if (!v.totalCitations && !v.flaggedNumbers) return;   /* 没有可核验内容则不打扰 */
    var html = '<div class="verify-mini' + (v.allOk ? "" : " warn") + '">' +
      "<svg class=ico><use href=#i-shield></use></svg> 核验：定位 " + v.verifiedCount + "/" + v.totalCitations +
      " · 核对原文 " + v.tier2Count + "/" + v.totalCitations +
      (v.flaggedNumbers ? "；<svg class=ico><use href=#i-warn></use></svg> " + v.flaggedNumbers + " 项数字待核实" : "") +
      (v.allOk ? "" : "（未核实内容请谨慎采纳，可到「深度分析」页获得完整核验报告）") + "</div>";
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    bubbleDiv.appendChild(wrap.firstChild);
  }

  /* ============ 初始化 ============ */
  /* 图片附件队列（AI 分析时读图并入案情；登记证据目录在加入时即完成） */
  var agentImages = [];
  function renderAgentImages() {
    var row = document.getElementById("agent-img-row");
    if (!row) return;
    row.innerHTML = agentImages.map(function (im, i) {
      return '<span style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:9px;padding:3px 6px;font-size:11.5px">' +
        '<img src="' + im.dataUrl + '" alt="" style="width:30px;height:30px;object-fit:cover;border-radius:5px">' +
        esc(im.name.slice(0, 16)) +
        '<button type="button" data-agent-img-del="' + i + '" style="border:none;background:none;cursor:pointer;color:var(--ink-2);font-size:12px">✕</button></span>';
    }).join("");
    row.classList.toggle("hidden", !agentImages.length);
  }
  function init() {
    els = {
      input: document.getElementById("agent-input"),
      run: document.getElementById("agent-run"),
      online: document.getElementById("agent-online"),
      steps: document.getElementById("agent-steps"),
      answer: document.getElementById("agent-answer"),
      panel: document.getElementById("agent-panel")
    };
    if (!els.run) return;
    els.run.addEventListener("click", runAgent);
    var stopBtn = document.getElementById("agent-stop");
    if (stopBtn) stopBtn.addEventListener("click", stopAgent);
    var docBtn = document.getElementById("agent-doc");
    if (docBtn) docBtn.addEventListener("click", exportDoc);
    var archBtn = document.getElementById("agent-archive");
    if (archBtn) archBtn.addEventListener("click", openReportArchive);
    /* 清空上下文（3.1）：显式重置多轮记忆，让「重新开始」成为可见动作 */
    var clearHistBtn = document.getElementById("agent-clear-hist");
    if (clearHistBtn) clearHistBtn.addEventListener("click", function () {
      agentHistory = []; lastRun = null;
      els.answer.innerHTML = '<div class="tool-warn">🧹 已清空多轮对话上下文——下一次分析将作为全新案件开始。</div>';
      if (window.TOOLS && TOOLS.haptic) TOOLS.haptic(10);
    });
    els.input.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runAgent();
    });
    /* 附件上传（v3.6.0）：＋菜单整合——文档提取后追加进案情；图片进待读队列（AI 分析时读图并入） */
    function pickAgentDoc() {
      if (!(window.ATTACH && ATTACH.pick)) return;
      ATTACH.pick(".docx,.xlsx,.csv,.txt,.md,.doc,.xls").then(function (f) {
        if (!f) return null;
        return ATTACH.extractFile(f).then(function (res) {
          if (!res || res.error) { if (window.UIKIT) UIKIT.toast((res && res.error) || "提取失败", "warn"); return null; }
          ATTACH.appendCaseText(els.input, res);
          if (window.UIKIT) UIKIT.toast("附件已并入案情：" + res.name + (res.truncated ? "（已截断 2 万字）" : ""), "ok");
          return null;
        });
      }).catch(function () { });
    }
    function pickAgentImg() {
      if (!(window.ATTACH && ATTACH.pick)) return;
      ATTACH.pick("image/*").then(function (f) {
        if (!f) return null;
        return ATTACH.extractFile(f).then(function (res) {
          if (!res || res.error) { if (window.UIKIT) UIKIT.toast((res && res.error) || "图片读取失败", "warn"); return null; }
          if (agentImages.length >= 3) { if (window.UIKIT) UIKIT.toast("最多 3 张图片", "warn"); return null; }
          agentImages.push({ name: res.name, dataUrl: res.dataUrl });
          renderAgentImages();
          /* 同步登记进工作区证据目录（每行一条，证明目的人工补充） */
          var ev = document.getElementById("ws-ev-input");
          if (ev) ev.value += (ev.value ? "\n" : "") + "图片证据-" + res.name + "（本地上传，证明目的待补充）";
          if (window.UIKIT) UIKIT.toast("图片已加入（AI 分析时自动读图，并已登记证据目录）", "ok");
          return null;
        });
      }).catch(function () { });
    }
    var addBtn = document.getElementById("agent-add-btn");
    if (addBtn) {
      var aMenu = null;
      function closeAMenu() { if (aMenu) { aMenu.remove(); aMenu = null; document.removeEventListener("click", onADoc, true); } }
      function onADoc(e) { if (aMenu && !aMenu.contains(e.target) && !addBtn.contains(e.target)) closeAMenu(); }
      addBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!(window.ATTACH && ATTACH.pick)) return;
        if (aMenu) { closeAMenu(); return; }
        aMenu = document.createElement("div");
        aMenu.style.cssText = "position:fixed;z-index:1300;display:flex;flex-direction:column;min-width:250px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px rgba(15,23,42,.16);overflow:hidden";
        aMenu.innerHTML =
          '<button type="button" data-att-kind="doc" style="text-align:left;padding:11px 14px;border:none;background:var(--card);font-size:13.5px;color:var(--ink);cursor:pointer">📄 文档　<span style="color:var(--ink-2);font-size:11.5px">Word/表格/文本 → 追加进案情</span></button>' +
          '<button type="button" data-att-kind="image" style="text-align:left;padding:11px 14px;border:none;background:var(--card);font-size:13.5px;color:var(--ink);cursor:pointer;border-top:1px solid var(--line)">🖼 图片　<span style="color:var(--ink-2);font-size:11.5px">AI 分析时自动读图（≤3 张）</span></button>';
        document.body.appendChild(aMenu);
        var r = addBtn.getBoundingClientRect();
        var left = Math.min(r.left, window.innerWidth - 266);
        var top = r.top - 100;
        if (top < 8) top = r.bottom + 8;
        aMenu.style.left = Math.max(8, left) + "px";
        aMenu.style.top = Math.max(8, top) + "px";
        setTimeout(function () { document.addEventListener("click", onADoc, true); }, 0);
        aMenu.querySelectorAll("[data-att-kind]").forEach(function (b) {
          b.addEventListener("click", function () {
            var kind = b.getAttribute("data-att-kind");
            closeAMenu();
            if (kind === "doc") pickAgentDoc(); else pickAgentImg();
          });
        });
      });
      document.addEventListener("click", function (e) {
        var d = e.target.closest ? e.target.closest("[data-agent-img-del]") : null;
        if (d) { agentImages.splice(parseInt(d.getAttribute("data-agent-img-del"), 10), 1); renderAgentImages(); }
      });
    }
    var btnR = document.getElementById("agent-mode-report");
    var btnA = document.getElementById("agent-mode-ai");
    if (btnR) btnR.addEventListener("click", function () { setMode("report"); });
    if (btnA) btnA.addEventListener("click", function () { setMode("ai"); });
    var exportBtn = document.getElementById("agent-export");
    if (exportBtn) exportBtn.addEventListener("click", exportChoose);
    var ex = document.getElementById("agent-examples");
    [
      "公司口头把我辞退了没有赔偿，我能主张2N吗？程序怎么走？",
      "作为小股东，公司连续五年盈利却从不分红，我有什么退出和救济途径？",
      "我的实用新型专利被同行仿冒销售，该怎么取证、维权、算赔偿？",
      "一人公司股东用个人卡收公司货款，债权人该怎么追责？"
    ].forEach(function (t) {
      var b = document.createElement("button");
      b.className = "sug-btn";
      b.textContent = t.slice(0, 20) + "…";
      b.title = t;
      b.addEventListener("click", function () { els.input.value = t; });
      ex.appendChild(b);
    });
    /* 联网开关状态提示 */
    window.ONLINE && window.ONLINE.check().then(function () { });
  }

  return {
    init: init,
    verifyText: verifyText,
    annotate: annotate,
    attachVerification: attachVerification,
    runAgent: runAgent,
    runWith: runWith,
    /* 深度分析多轮记忆（方案 A）：测试钩子与清空入口 */
    _test: {
      isContinueMsg: isContinueMsg,
      decideTurn: decideTurn,
      historyLen: function () { return agentHistory.length; },
      clearHistory: function () { agentHistory = []; lastRun = null; },
      agentHistoryView: function () { return agentHistory.slice(); }
    }
  };
})();
