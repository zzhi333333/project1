/* =========================================================
 * intake.js —— AI 引导式深度咨询（要素收集 → 结构化报告）
 * 流程：用户描述初步问题 → AI 像律师接案一样逐项追问 →
 *       本地「要素提取器」实时点亮案件要素卡（当事人/时间线/金额/
 *       证据/已采取措施/诉求）→ 要素齐全或用户主动结束 →
 *       汇总结构化案情 → 交「深度分析」生成可核验报告。
 * 要素判定由本地规则驱动（可靠、可离线核验）；AI 负责自然追问。
 * ========================================================= */
window.INTAKE = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  var ELEMENTS = [
    { key: "parties", label: "当事人关系", hint: "对方是谁（公司/个人）、你们之间是什么关系（劳动关系/合同/借贷/婚姻…）" },
    { key: "timeline", label: "时间线", hint: "关键事件发生在什么时候（入职/签约/违约/受伤日期、持续多久）" },
    { key: "amount", label: "金额/标的", hint: "涉及多少钱（工资/借款/赔偿额/标的额）" },
    { key: "evidence", label: "证据持有", hint: "手里有什么证据（合同、聊天记录、转账凭证、录音…）" },
    { key: "measures", label: "已采取措施", hint: "是否已协商/投诉/仲裁/报警，结果如何" },
    { key: "claims", label: "您的诉求", hint: "想达到什么结果（要钱/解除关系/继续履行/道歉…）" }
  ];

  var active = false;
  var state = { found: {}, rounds: 0, firstText: "" };

  /* ---------- 本地要素提取器 ---------- */
  function extract(text) {
    var hit = {};
    if (/(\d+(?:\.\d+)?)\s*(?:万|元|块钱)/.test(text) || /工资|月薪|日薪|借款|本金|利息|赔偿金|标的/.test(text)) hit.amount = true;
    if (/[12]\d{3}\s*年|\d+\s*个?月前|去年|上个月|上月|最近|当时|至今|天前|周前/.test(text)) hit.timeline = true;
    if (/合同|借条|欠条|聊天记录|微信|短信|录音|照片|工资条|打卡|转账|凭证|收据|证人|公证|病历|判决书|裁决书/.test(text)) hit.evidence = true;
    if (/仲裁|起诉|投诉|报警|12333|12345|调解|支付令|立案|申请执行/.test(text)) hit.measures = true;
    if (/公司|单位|老板|雇主|员工|对方|妻子|丈夫|配偶|房东|租客|买家|卖家|甲方|乙方|被告|原告|前夫|前妻|合伙人/.test(text)) hit.parties = true;
    if (/想要|希望|诉求|要求|主张|索赔|退[还回]|赔[偿付]|解除|维权|怎么办/.test(text)) hit.claims = true;
    return hit;
  }

  function missing() {
    return ELEMENTS.filter(function (e) { return !state.found[e.key]; });
  }

  /* ---------- 要素卡渲染（对话流内 sticky 卡片） ---------- */
  function renderCard() {
    var old = document.getElementById("intake-card");
    if (old) old.remove();
    var box = document.getElementById("chat-box");
    if (!box || !active) return;
    var chips = ELEMENTS.map(function (e) {
      var got = !!state.found[e.key];
      return '<span class="intake-el ' + (got ? "got" : "miss") + '" title="' + esc(e.hint) + '">' +
        (got ? "✓ " : "○ ") + esc(e.label) + '</span>';
    }).join("");
    var miss = missing().length;
    var card = document.createElement("div");
    card.id = "intake-card";
    card.className = "msg bot intake-row";
    card.innerHTML =
      '<div class="bubble intake-bubble">' +
        '<div class="intake-head"><svg class=ico><use href=#i-agent></use></svg> <b>深度咨询 · 案件要素卡</b>' +
          '<span class="dim">' + (ELEMENTS.length - miss) + "/" + ELEMENTS.length + '</span>' +
          '<button class="mini-btn" id="intake-min" title="收起到此条下方可再展开">收起</button></div>' +
        '<div class="intake-chips">' + chips + '</div>' +
        '<div class="intake-acts">' +
          '<button class="mini-btn primary" id="intake-gen"><svg class=ico><use href=#i-agent></use></svg> 用这些信息生成可核验分析</button>' +
          '<button class="mini-btn" id="intake-stop">结束引导</button>' +
          '<span class="dim" style="font-size:11.5px">缺项不影响生成——AI 会标注基于现有信息的分析边界</span>' +
        '</div>' +
      '</div>';
    box.appendChild(card);
    box.scrollTop = box.scrollHeight;
    card.querySelector("#intake-min").addEventListener("click", function () {
      card.style.display = "none";
      var restore = document.createElement("div");
      restore.className = "chips";
      restore.style.margin = "0 14px 6px";
      restore.innerHTML = '<button class="mini-btn" id="intake-restore"><svg class=ico><use href=#i-agent></use></svg> 展开要素卡（' + (ELEMENTS.length - miss) + "/" + ELEMENTS.length + '）</button>';
      restore.querySelector("#intake-restore").addEventListener("click", function () {
        restore.remove(); card.style.display = "";
      });
      box.appendChild(restore);
      box.scrollTop = box.scrollHeight;
    });
    card.querySelector("#intake-gen").addEventListener("click", generate);
    card.querySelector("#intake-stop").addEventListener("click", stop);
  }

  /* ---------- 结构化案情 → 交深度分析 ---------- */
  function generate() {
    var lines = ["【深度咨询 · 案件要素汇总】"];
    lines.push("初步描述：" + state.firstText);
    ELEMENTS.forEach(function (e) {
      if (state.found[e.key]) lines.push("· " + e.label + "：" + state.found[e.key]);
    });
    var miss = missing().map(function (e) { return e.label; });
    if (miss.length) lines.push("（未覆盖要素：" + miss.join("、") + "——请 AI 在分析中说明因信息不足产生的分析边界）");
    var text = lines.join("\n");
    stop();
    document.querySelector('.nav-tab[data-view="agent"]').click();
    if (window.AGENT && window.AGENT.runWith) window.AGENT.runWith(text, window.AI && window.AI.isConfigured() ? "ai" : "report");
  }

  function stop() {
    /* 引导结束交接：未确认要素 → 案件工作区待确认事项（当前案件激活时），状态重置前执行 */
    if (active && window.WORKSPACE && window.WORKSPACE.current()) {
      var miss = missing();
      var ws = window.WORKSPACE.current();
      if (miss.length) {
        miss.forEach(function (e) { window.WORKSPACE.addNote("未确认要素：" + e.label + "——" + e.hint); });
        if (window.UI && window.UI.appendBot) {
          window.UI.appendBot("🗂 已把 <b>" + miss.length + "</b> 项未确认要素加入案件工作区「" + esc(ws.name) + "」的待确认事项——补齐后可再次分析。", null);
        }
      }
    }
    active = false;
    state = { found: {}, rounds: 0, firstText: "" };
    var old = document.getElementById("intake-card");
    if (old) old.remove();
    var restore = document.getElementById("intake-restore");
    if (restore && restore.parentNode) restore.parentNode.remove();
  }

  /* ---------- 入口：开始引导（AI 对话模式下） ---------- */
  function start(firstText) {
    active = true;
    state = { found: extract(firstText), rounds: 1, firstText: firstText };
    if (window.AI && window.AI.beginGuided) {
      window.AI.beginGuided(missing(), state.found);
    }
  }

  /* 每轮 AI 回答完成后由 ai.js 调用：用用户最新输入更新要素卡 */
  function onUserMessage(text) {
    if (!active) return;
    var hit = extract(text);
    for (var k in hit) {
      if (!state.found[k]) state.found[k] = text.trim().slice(0, 120);
      else state.found[k] = (state.found[k] + "；" + text.trim().slice(0, 60)).slice(0, 200);
    }
    state.rounds++;
    renderCard();
  }
  function onAssistantDone() {
    if (active) renderCard();
  }

  /* 要素摘要（供 ai.js 注入 system prompt，让 AI 知道该追问什么） */
  function promptBlock() {
    if (!active) return "";
    var miss = missing();
    var lines = ["\n【深度咨询模式 · 引导规则】当前处于引导式要素收集中。"];
    lines.push("已确认要素：" + ELEMENTS.filter(function (e) { return state.found[e.key]; }).map(function (e) { return e.label; }).join("、") || "（尚无）");
    if (miss.length) {
      lines.push("缺失要素：" + miss.map(function (e) { return e.label + "（" + e.hint + "）"; }).join("；"));
      lines.push("要求：本轮只针对最关键的 1–2 个缺失要素自然追问，先简要确认用户上一条信息，不要重复追问已确认要素，不要一次抛出多个问题清单。");
    } else {
      lines.push("六项要素已齐：请确认信息完整性，并提示用户可点击要素卡上的「生成可核验分析」获得完整报告。");
    }
    return lines.join("\n");
  }

  return {
    start: start, stop: stop, onUserMessage: onUserMessage,
    onAssistantDone: onAssistantDone, promptBlock: promptBlock,
    isActive: function () { return active; },
    ELEMENTS: ELEMENTS
  };
})();
