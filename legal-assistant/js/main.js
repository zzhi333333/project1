/* =========================================================
 * 主逻辑 main.js —— 路由、聊天渲染、案例/FAQ渲染、模块装配
 * ========================================================= */
(function () {
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- 视图切换 ---------- */
  var views = ["consult", "agent", "laws", "tools", "cases", "faq"];
  function switchView(name) {
    views.forEach(function (v) {
      var el = document.getElementById("view-" + v);
      if (el) el.classList.toggle("active", v === name);
    });
    document.querySelectorAll(".nav-tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-view") === name);
    });
    window.scrollTo(0, 0);
  }
  window.APP = { switchView: switchView };
  document.querySelectorAll(".nav-tab").forEach(function (t) {
    t.addEventListener("click", function () { switchView(t.getAttribute("data-view")); });
  });

  /* ---------- 聊天 UI（供 consult.js / ai.js 调用） ---------- */
  var box = document.getElementById("chat-box");

  function scrollDown() { box.scrollTop = box.scrollHeight; }

  function appendUser(text) {
    var div = document.createElement("div");
    div.className = "msg user";
    div.innerHTML = '<div class="bubble">' + esc(text) + '</div>';
    box.appendChild(div);
    scrollDown();
  }

  function appendBot(html) {
    var div = document.createElement("div");
    div.className = "msg bot";
    div.innerHTML = '<div class="avatar">⚖️</div><div class="bubble">' + html + '</div>';
    box.appendChild(div);
    scrollDown();
  }

  function appendQuestion(text, options, onPick) {
    var div = document.createElement("div");
    div.className = "msg bot";
    var inner = '<div class="avatar">⚖️</div><div class="bubble"><div class="q-text">' + esc(text) + '</div><div class="q-options">';
    options.forEach(function (op) {
      inner += '<button class="q-btn" data-value="' + esc(op.value) + '">' + esc(op.label) + '</button>';
    });
    inner += '</div></div>';
    div.innerHTML = inner;
    box.appendChild(div);
    div.querySelectorAll(".q-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        /* 选中后禁用整组，防止重复作答 */
        div.querySelectorAll(".q-btn").forEach(function (x) {
          x.disabled = true;
          if (x !== b) x.classList.add("dim");
          else x.classList.add("picked");
        });
        onPick(b.getAttribute("data-value"), b.textContent);
      });
    });
    scrollDown();
  }

  function lawChips(lawIds) {
    return (lawIds || []).map(function (id) {
      var l = window.lawById(id);
      if (!l) return "";
      return '<button class="law-chip" data-law="' + id + '">' + esc(l.lawShort + " " + l.article) + '</button>';
    }).join("");
  }

  function appendResult(scenario, r) {
    var d = window.DOMAINS[scenario.domain];
    /* 注册结果供 AI 深度解读使用 */
    window.AI_RESULTS = window.AI_RESULTS || [];
    var rid = window.AI_RESULTS.length;
    window.AI_RESULTS.push({ name: scenario.name, domain: scenario.domain, r: r });
    var html =
      '<div class="result-card">' +
        '<div class="result-flag" style="border-color:' + d.color + '">' + scenario.icon + ' ' + d.name + ' · 初步分析意见</div>' +
        '<div class="result-title">' + esc(r.headline) + '</div>' +
        '<div class="result-section"><span class="sec-label">📌 结论概要</span>' + esc(r.summary) + '</div>' +
        '<div class="result-section"><span class="sec-label">🔍 具体分析</span>' +
          '<ul>' + r.analysis.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' +
        '<div class="result-section"><span class="sec-label">📚 依据法条</span><div class="chips">' + lawChips(r.laws) + '</div></div>' +
        '<div class="result-section"><span class="sec-label">✅ 行动建议</span>' +
          '<ul>' + r.advice.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' +
        '<div class="result-deadline">⏰ <b>时效提示：</b>' + esc(r.deadline) + '</div>' +
        '<div class="result-ai-row"><button class="mini-btn primary result-ai-btn" data-rid="' + rid + '">🤖 AI 深度解读</button><span class="result-disclaimer">仅供参考，不构成法律意见 · 完整声明见页脚</span></div>' +
      '</div>';
    var div = document.createElement("div");
    div.className = "msg bot";
    div.innerHTML = '<div class="avatar">⚖️</div><div class="bubble">' + html + '</div>';
    box.appendChild(div);

    /* 法条引用 → 跳转检索页定位 */
    div.querySelectorAll(".law-chip").forEach(function (c) {
      c.addEventListener("click", function () {
        var l = window.lawById(c.getAttribute("data-law"));
        if (!l) return;
        switchView("laws");
        var input = document.getElementById("law-search-input");
        input.value = l.title;
        document.getElementById("law-search-btn").click();
      });
    });
    scrollDown();
  }

  window.UI = { appendUser: appendUser, appendBot: appendBot, appendQuestion: appendQuestion, appendResult: appendResult };

  /* ---------- 咨询输入框 ---------- */
  var input = document.getElementById("consult-input");
  document.getElementById("consult-send").addEventListener("click", function () {
    window.CONSULT.start(input.value);
    input.value = "";
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      window.CONSULT.start(input.value);
      input.value = "";
    }
  });

  /* ---------- 快捷场景卡片（带领域筛选） ---------- */
  var quickBox = document.getElementById("quick-scenarios");
  if (quickBox) {
    var cards = {};
    window.SCENARIOS.forEach(function (s) {
      var card = document.createElement("button");
      card.className = "quick-card";
      card.setAttribute("data-domain", s.domain);
      card.innerHTML = '<span class="qc-icon">' + s.icon + '</span><span class="qc-name">' + esc(s.name) + '</span><span class="qc-desc">' + esc(s.desc) + '</span>';
      card.addEventListener("click", function () { window.CONSULT.quickStart(s.id); });
      quickBox.appendChild(card);
      cards[s.id] = card;
    });
    /* 领域筛选 */
    var filterBox = document.getElementById("scenario-filter");
    if (filterBox) {
      filterBox.addEventListener("click", function (e) {
        var chip = e.target.closest ? e.target.closest(".filter-chip") : null;
        if (!chip) return;
        filterBox.querySelectorAll(".filter-chip").forEach(function (x) { x.classList.toggle("active", x === chip); });
        var dom = chip.getAttribute("data-domain") || "";
        Object.keys(cards).forEach(function (id) {
          cards[id].style.display = (!dom || cards[id].getAttribute("data-domain") === dom) ? "" : "none";
        });
      });
    }
    /* 跨领域示例（4 个，与场景卡互补） */
    var sugBox = document.getElementById("suggestions");
    [
      "被公司辞退了该怎么维权？",
      "公司注册资本认缴2000万一直没实缴",
      "我的实用新型专利被别人抄了",
      "收到专利侵权警告函怎么应对"
    ].forEach(function (t) {
      var b = document.createElement("button");
      b.className = "sug-btn";
      b.textContent = t;
      b.addEventListener("click", function () { window.CONSULT.start(t); });
      sugBox.appendChild(b);
    });
  }

  /* ---------- 案例页：页内标签 ---------- */
  var caseTabs = [
    { btn: "case-tab-online", block: "case-block-online" },
    { btn: "case-tab-guiding", block: "case-block-guiding" },
    { btn: "case-tab-builtin", block: "case-block-builtin" }
  ];
  caseTabs.forEach(function (t) {
    var btn = document.getElementById(t.btn);
    if (!btn) return;
    btn.addEventListener("click", function () {
      caseTabs.forEach(function (x) {
        document.getElementById(x.btn).classList.toggle("active", x.btn === t.btn);
        document.getElementById(x.block).classList.toggle("hidden", x.block !== t.block);
      });
    });
  });

  /* ---------- 典型情景案例（内置） ---------- */
  var caseBox = document.getElementById("case-list");
  if (caseBox) {
    window.CASES.forEach(function (c) {
      var d = window.DOMAINS[c.domain];
      var el = document.createElement("div");
      el.className = "case-card";
      el.innerHTML =
        '<div class="case-domain" style="background:' + d.color + '1a;color:' + d.color + '">' + d.name + '案例</div>' +
        '<div class="case-title">' + esc(c.title) + '</div>' +
        '<div class="case-sec"><b>案情</b>' + esc(c.facts) + '</div>' +
        '<div class="case-sec"><b>结果</b>' + esc(c.ruling) + '</div>' +
        '<div class="case-lesson">💡 <b>要点</b>' + esc(c.lesson) + '</div>';
      caseBox.appendChild(el);
    });
  }

  /* ---------- 知识讲堂 FAQ ---------- */
  var faqBox = document.getElementById("faq-list");
  if (faqBox) {
    ["labor", "company", "patent"].forEach(function (dom) {
      var d = window.DOMAINS[dom];
      var group = document.createElement("div");
      group.className = "faq-group";
      group.innerHTML = '<div class="faq-group-title" style="color:' + d.color + '">' + d.icon + ' ' + d.name + '</div>';
      window.FAQ.filter(function (f) { return f.domain === dom; }).forEach(function (f) {
        var item = document.createElement("div");
        item.className = "faq-item";
        item.innerHTML = '<div class="faq-q">' + esc(f.q) + '<span class="faq-toggle">展开</span></div><div class="faq-a">' + f.a + '</div>';
        item.querySelector(".faq-q").addEventListener("click", function () {
          var open = item.classList.toggle("open");
          item.querySelector(".faq-toggle").textContent = open ? "收起" : "展开";
        });
        group.appendChild(item);
      });
      faqBox.appendChild(group);
    });
  }

  /* ---------- 欢迎语（精简） ---------- */
  appendBot(
    "您好！我是<b>法律咨询助手</b>，专注<b>劳动法 · 公司法 · 专利法</b>。<br>" +
    "请描述您的问题，我会澄清关键事实后给出<b>分析 + 法条 + 行动建议</b>；也可从左侧场景直接开始。"
  );

  /* ---------- 模块装配 ---------- */
  window.LAWSEARCH.init();
  window.TOOLS.init();
  window.ONLINE.init();
  window.AI.init();
  window.AGENT.init();
})();
