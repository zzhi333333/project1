/* =========================================================
 * 主逻辑 main.js —— 路由、聊天渲染、案例/FAQ渲染、模块装配
 * ========================================================= */
(function () {
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- 视图切换 ---------- */
  var views = ["consult", "agent", "analysis", "laws", "tools", "cases", "faq"];
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

  /* ---------- 聊天 UI（供 consult.js 调用） ---------- */
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
        '<div class="result-section"><span class="sec-label" style="background:' + d.color + '1a;color:' + d.color + '">📌 结论概要</span>' + esc(r.summary) + '</div>' +
        '<div class="result-section"><span class="sec-label" style="background:' + d.color + '1a;color:' + d.color + '">🔍 具体分析</span>' +
          '<ul>' + r.analysis.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' +
        '<div class="result-section"><span class="sec-label" style="background:' + d.color + '1a;color:' + d.color + '">📚 依据法条</span><div class="chips">' + lawChips(r.laws) + '</div></div>' +
        '<div class="result-section"><span class="sec-label" style="background:' + d.color + '1a;color:' + d.color + '">✅ 行动建议</span>' +
          '<ul>' + r.advice.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' +
        '<div class="result-deadline">⏰ <b>时效提示：</b>' + esc(r.deadline) + '</div>' +
        '<div class="result-ai-row"><button class="mini-btn primary result-ai-btn" data-rid="' + rid + '">🤖 AI 深度解读</button><span class="dim">结合上述结论与法条个性化展开（在右上角「AI 模型」配置后可用）</span></div>' +
        '<div class="result-disclaimer">以上内容基于您选择的事实做出的规则化分析，仅供参考，不构成正式法律意见；可到「法条检索」页联网核对官方原文，重大事项请咨询执业律师。</div>' +
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

  /* ---------- 快捷场景卡片 ---------- */
  var quickBox = document.getElementById("quick-scenarios");
  if (quickBox) {
    window.SCENARIOS.forEach(function (s) {
      var card = document.createElement("button");
      card.className = "quick-card";
      card.innerHTML = '<span class="qc-icon">' + s.icon + '</span><span class="qc-name">' + esc(s.name) + '</span><span class="qc-desc">' + esc(s.desc) + '</span>';
      card.addEventListener("click", function () { window.CONSULT.quickStart(s.id); });
      quickBox.appendChild(card);
    });
    var sugBox = document.getElementById("suggestions");
    [
      "被公司辞退了该怎么维权？",
      "公司拖欠了三个月工资怎么办？",
      "入职两个月一直没签劳动合同",
      "公司注册资本认缴2000万一直没实缴",
      "小股东常年不分红怎么退出",
      "我的实用新型专利被别人抄了",
      "收到专利侵权警告函怎么应对",
      "想申请专利但不知道选什么类型"
    ].forEach(function (t) {
      var b = document.createElement("button");
      b.className = "sug-btn";
      b.textContent = t;
      b.addEventListener("click", function () { window.CONSULT.start(t); });
      sugBox.appendChild(b);
    });
  }

  /* ---------- 案例页：典型情景案例（内置） ---------- */
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

  /* ---------- 欢迎语 ---------- */
  appendBot(
    "您好！我是<b>法律咨询助手</b>，专注于<b>劳动法、公司法、专利法</b>三大领域 🧑‍🏭 🏢 💡<br><br>" +
    "请用一两句话描述您遇到的问题（例如「公司口头把我辞退了，没有赔偿」），我会判断问题类型、询问关键事实，并给出<b>初步分析 + 依据法条 + 行动建议 + 时效提示</b>。<br><br>" +
    "也可以直接点击下方示例问题或左侧「快捷咨询」开始；「法条检索」页支持联网查询<b>国家法律法规数据库</b>官方原文，「案例检索」页可检索<b>裁判文书网</b>与<b>最高法指导性案例</b>。"
  );

  /* ---------- 模块装配 ---------- */
  window.LAWSEARCH.init();
  window.TOOLS.init();
  window.ANALYSIS.init();
  window.ONLINE.init();
  window.AI.init();
  window.AGENT.init();
})();
