/* =========================================================
 * 法律咨询 Agent agent.js
 * —— 可核验的三层防线架构：
 *   ①生成前：仅基于「资料区」（本地法条库/案例库 + flk 官方全文）作答，
 *            硬约束提示词禁止引用资料区外法条、禁止编造数字/期限/机关
 *   ②生成后：引用核验（每条《法名》第X条 对照本地库+flk全文逐条核实）
 *            + 数字断言核验（期限/比例/金额须在资料区有依据）
 *   ③展示层：引用内联 ✓/⚠️ 徽标 + 引用核验报告 + 严格模式重新生成
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
  function fetchLawFullText(lawName) {
    var key = normLaw(lawName);
    if (LAW_TEXT_CACHE[key] !== undefined) return Promise.resolve(LAW_TEXT_CACHE[key]);
    if (!window.ONLINE || !window.ONLINE.isAvailable()) return Promise.resolve(null);
    var p = window.ONLINE.flkSearch(lawName, 1).then(function (r) {
      if (!r || !r.ok || !r.results || !r.results.length) return null;
      var hit = r.results[0];
      return window.ONLINE.flkDetail(hit.id).then(function (d) {
        return d && d.ok ? { title: hit.title, text: d.text || "", links: d.links || {} } : null;
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

  /* 本地库核验 */
  function verifyLocal(cit) {
    var norm = normLaw(cit.law);
    var matches = window.LAWS.filter(function (l) {
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
        if (cit.articleNum == null) return { status: "ok", source: "国家法律法规数据库", law: t.title, text: "" };
        var hitAr = t.text.indexOf("第" + cit.articleNum + "条") > -1;
        var hitCn = t.text.indexOf("第" + num2cn(cit.articleNum) + "条") > -1;
        if (hitAr || hitCn) return { status: "ok", source: "国家法律法规数据库", law: t.title, text: "" };
      }
    }
    return null;
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

  /* 综合核验：返回 {citations, numbers, allOk, verifiedCount} */
  function verifyText(answerText, ctxText, fullTexts) {
    var cits = parseCitations(answerText);
    var citResults = cits.map(function (c) {
      var v = verifyLocal(c);
      if ((!v || v.status !== "ok") && fullTexts) {
        var o = verifyOnline(c, fullTexts);
        if (o) v = o;
      }
      return {
        cit: c,
        status: v ? v.status : "fail",
        source: v ? v.source : null,
        lawDisplay: v ? v.law : c.law,
        text: v ? v.text : ""
      };
    });
    var nums = parseNumberClaims(answerText).map(function (c) {
      return { claim: c, ok: verifyNumberClaim(c, ctxText) };
    });
    var verified = citResults.filter(function (x) { return x.status === "ok"; }).length;
    return {
      citations: citResults,
      numbers: nums,
      verifiedCount: verified,
      totalCitations: citResults.length,
      flaggedNumbers: nums.filter(function (x) { return !x.ok; }).length,
      allOk: verified === citResults.length && nums.every(function (x) { return x.ok; })
    };
  }

  /* 答案内联标注：给引用打 ✓/⚠️ 徽标 */
  function annotate(answerText, verification) {
    var html = esc(answerText);
    verification.citations.forEach(function (r) {
      var badge = r.status === "ok" ? " ✓" : " ⚠️";
      var cls = r.status === "ok" ? "cite-ok" : "cite-warn";
      var tip = r.status === "ok"
        ? "已核实：" + esc(r.lawDisplay) + (r.cit.articleNum ? " 第" + r.cit.articleNum + "条" : "") + "（" + esc(r.source) + "）"
        : "未能核实该引用，请到法条检索页人工确认";
      var safeRaw = esc(r.cit.raw).replace(/"/g, "&quot;");
      html = html.split(esc(r.cit.raw)).join('<span class="' + cls + '" title="' + tip + '">' + safeRaw + badge + "</span>");
    });
    /* 未核实数字断言高亮 */
    verification.numbers.forEach(function (x) {
      if (x.ok) return;
      var safeRaw = esc(x.claim.raw).replace(/"/g, "&quot;");
      var tip = "数字断言待核实：「" + esc(x.claim.raw) + "」未在资料区找到依据，请人工确认";
      html = html.split(esc(x.claim.raw)).join('<span class="num-warn" title="' + tip + '">' + safeRaw + "⚠️</span>");
    });
    return html;
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
    "6. 回答结构：结论 → 分析（引用法条）→ 行动建议 → 时效提醒 → 末尾注明「以上仅供参考，不构成法律意见」。\n" +
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

  /* ============ Agent 视图工作流 ============ */
  var els = {};
  var mode = "report";  /* "report" = 规则引擎报告（离线） | "ai" = AI 可核验分析 */
  var lastRun = null;   /* {q, ctxText, fullTexts, messages} 供严格模式重生成 */

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

    /* ── 模式一：规则引擎报告（离线、确定性、天然可核验） ── */
    if (mode === "report") {
      var rep = window.ANALYSIS.run(q);
      stepState(0, "done", rep.domainName + " · " + (rep.focus.length ? rep.focus.map(function (s) { return s.replace(/^\S+\s/, ""); }).join("、") : "综合咨询") + " · " + rep.laws.length + " 条法条 + " + rep.cases.length + " 个案例");
      stepState(1, "done", "结构化报告已生成（要素提取/定性/法条/案例/程序建议/证据清单）");
      stepState(2, "skip", "规则报告内容全部来自内置知识库，天然可核验");
      els.answer.innerHTML = "";
      window.ANALYSIS.render(rep, els.answer);
      return;
    }

    /* ── 模式二：AI 可核验分析 ── */
    if (!(window.AI && window.AI.isConfigured())) {
      stepState(0, "warn", "AI 未配置（右上角「AI 模型」设置），自动转为规则报告");
      setMode("report");
      runAgent();
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
      els.answer.innerHTML = '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream" style="flex:1"><span class="ai-text"></span><span class="ai-cursor">▍</span></div></div>';
      var span = els.answer.querySelector(".ai-text");
      var ctxForGen = ctxText;
      Object.keys(fullTexts).forEach(function (k) {
        ctxForGen += "\n【资料区·官方全文摘录：《" + fullTexts[k].title + "》（可引用其中条文）】\n" + String(fullTexts[k].text).slice(0, 6000);
      });
      var messages = [
        { role: "system", content: AGENT_PROMPT },
        { role: "user", content: "请依据资料区分析以下问题：\n" + ctxForGen }
      ];
      lastRun = { q: q, ctxText: ctxText + Object.keys(fullTexts).map(function (k) { return fullTexts[k].text; }).join(""), fullTexts: fullTexts, messages: messages };
      var full = "";
      stepState(1, "run", "AI 生成中（仅可依据资料区作答）…");
      return window.AI.aiChat(messages, function (d) {
        full += d;
        span.textContent = full;
        els.answer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }).then(function () {
        stepState(1, "done", "生成完毕");
        return { text: full || "（模型未返回内容）" };
      });
    }).then(function (gen) {
      /* 步骤③：核验 */
      if (!gen || !gen.text) {
        stepState(2, "skip", "无内容可核验");
        return;
      }
      stepState(2, "run", "正在逐条核验引用与数字断言…");
      var v = verifyText(gen.text, lastRun.ctxText, lastRun.fullTexts);
      stepState(2, v.allOk ? "done" : "warn",
        v.totalCitations + " 条引用核实 " + v.verifiedCount + " 条" + (v.flaggedNumbers ? "；" + v.flaggedNumbers + " 项数字待核实" : ""));
      /* 用标注版替换纯文本 */
      var html = annotate(gen.text, v);
      els.answer.innerHTML = '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream verified" style="flex:1">' + html + "</div></div>";
      renderPanel(v, gen.text);
    }).catch(function (e) {
      els.answer.innerHTML += '<div class="tool-warn">⚠️ ' + esc(e && e.message || e) + "</div>";
    });
  }

  /* 核验报告面板 */
  function renderPanel(v, answerText) {
    var html = '<div class="verify-panel"><div class="vp-title">🛡️ 引用核验报告</div>';
    if (!v.totalCitations && !v.numbers.length) {
      html += '<div class="vp-line dim">回答中未出现法条引用与数字断言。</div>';
    }
    v.citations.forEach(function (r) {
      var icon = r.status === "ok" ? "✅" : "⚠️";
      var desc = r.status === "ok"
        ? "已核实（" + r.source + "）"
        : "未能核实——本地知识库与联网检索均未找到该条文，请到「法条检索」页人工确认";
      html += '<div class="vp-line ' + (r.status === "ok" ? "" : "bad") + '">' + icon + " 《" + esc(r.cit.law) + "》" +
        (r.cit.articleNum != null ? "第" + r.cit.articleNum + "条" : "") + " — " + desc + "</div>";
    });
    v.numbers.forEach(function (x) {
      if (x.ok) return;
      html += '<div class="vp-line bad">⚠️ 数字断言待核实：「' + esc(x.claim.raw) + "」（上下文：…" + esc(x.claim.snippet) + "…）未在资料区找到依据</div>";
    });
    var level = v.allOk ? "高（全部引用已核实）" : (v.verifiedCount === v.totalCitations ? "中（引用已核实，" + v.flaggedNumbers + " 项数字待人工确认）" : "中低（" + (v.totalCitations - v.verifiedCount) + " 条引用未核实，请谨慎采纳）");
    html += '<div class="vp-summary">整体可信度：<b>' + level + "</b></div>";
    if (!v.allOk) {
      html += '<button class="mini-btn primary" id="agent-regen">🔧 严格模式重新生成（仅使用已核实资料）</button>';
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
    stepState(1, "run", "严格模式重新生成…");
    stepState(2, "run", "");
    var full = "";
    window.AI.aiChat(messages, function (d) { full += d; span.textContent = full; })
      .then(function () {
        stepState(1, "done", "严格模式生成完毕");
        var v2 = verifyText(full, lastRun.ctxText, lastRun.fullTexts);
        stepState(2, v2.allOk ? "done" : "warn", v2.totalCitations + " 条引用核实 " + v2.verifiedCount + " 条" + (v2.flaggedNumbers ? "；" + v2.flaggedNumbers + " 项数字待核实" : ""));
        els.answer.innerHTML = '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream verified" style="flex:1">' + annotate(full, v2) + "</div></div>";
        renderPanel(v2, full);
      })
      .catch(function (e) {
        els.answer.innerHTML += '<div class="tool-warn">⚠️ ' + esc(e && e.message || e) + "</div>";
      });
  }

  /* ============ 供 ai.js 挂载的轻量核验 ============ */
  function attachVerification(bubbleDiv, answerText, ctxText) {
    if (!answerText) return;
    var v = verifyText(answerText, ctxText || "", null);
    if (!v.totalCitations && !v.flaggedNumbers) return;   /* 没有可核验内容则不打扰 */
    var html = '<div class="verify-mini' + (v.allOk ? "" : " warn") + '">' +
      "🛡️ 核验：" + v.verifiedCount + "/" + v.totalCitations + " 条引用已核实" +
      (v.flaggedNumbers ? "；⚠️ " + v.flaggedNumbers + " 项数字待核实" : "") +
      (v.allOk ? "" : "（未核实内容请谨慎采纳，可到「深度分析」页获得完整核验报告）") + "</div>";
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    bubbleDiv.appendChild(wrap.firstChild);
  }

  /* ============ 初始化 ============ */
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
    els.input.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runAgent();
    });
    var btnR = document.getElementById("agent-mode-report");
    var btnA = document.getElementById("agent-mode-ai");
    if (btnR) btnR.addEventListener("click", function () { setMode("report"); });
    if (btnA) btnA.addEventListener("click", function () { setMode("ai"); });
    var printBtn = document.getElementById("agent-print");
    if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
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
    runAgent: runAgent
  };
})();
