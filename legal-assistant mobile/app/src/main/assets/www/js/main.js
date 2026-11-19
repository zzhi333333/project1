/* =========================================================
 * 主逻辑 main.js —— 路由、聊天渲染、对话历史、案例/FAQ渲染、模块装配
 * ========================================================= */
(function () {
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- 视图切换（C5：hash 路由——刷新保持页签） ---------- */
  var views = ["consult", "agent", "contract", "workspace", "laws", "tools", "cases", "faq"];
  function switchView(name) {
    views.forEach(function (v) {
      var el = document.getElementById("view-" + v);
      if (el) {
        el.classList.toggle("active", v === name);
        /* v3.7.1（另一副本 453cf1d）：.view 是独立滚动容器（absolute+overflow-y:auto），切走
           display:none 保留 scrollTop——长页（案件工作区）滚过后切回从旧位置显示，页头被滚出
           只剩说明末行（真机「到当前案件」残留根因）。目标页回顶（consult 除外：聊天记录的
           阅读位置应保留）；window.scrollTo 管不到内部容器。 */
        if (v === name && v !== "consult") el.scrollTop = 0;
      }
    });
    document.querySelectorAll(".nav-tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-view") === name);
    });
    window.scrollTo(0, 0);
    try { if (("#" + name) !== location.hash) history.replaceState(null, "", "#" + name); } catch (e) { }
  }
  window.APP = { switchView: switchView };
  document.querySelectorAll(".nav-tab").forEach(function (t) {
    t.addEventListener("click", function () { switchView(t.getAttribute("data-view")); });
  });
  /* 启动时按 hash 恢复页签（WebView 安全，非法值回退咨询页） */
  (function () {
    var h = (location.hash || "").replace("#", "");
    if (views.indexOf(h) > -1 && h !== "consult") {
      var t = document.querySelector('.nav-tab[data-view="' + h + '"]');
      if (t) t.click();
    }
  })();

  /* ---------- 聊天 UI（供 consult.js / ai.js 调用） ---------- */
  var box = document.getElementById("chat-box");

  function scrollDown() { box.scrollTop = box.scrollHeight; }

  /* 双击消息气泡全选文字，方便复制（按钮/链接等交互元素不受影响） */
  box.addEventListener("dblclick", function (e) {
    var bubble = e.target.closest ? e.target.closest(".bubble") : null;
    if (!bubble || e.target.closest("button, a, input, .q-options")) return;
    var range = document.createRange();
    range.selectNodeContents(bubble);
    var sel = window.getSelection && window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  });

  function recordMsg(entry) {
    if (window.CHATHISTORY) window.CHATHISTORY.record(entry);
  }

  function appendUser(text) {
    var div = document.createElement("div");
    div.className = "msg user";
    div.innerHTML = '<div class="bubble">' + esc(text) + '</div>';
    box.appendChild(div);
    recordMsg({ who: "user", html: esc(text), text: text });
    bindSessionToCase();
    scrollDown();
  }

  /* 方向一补全：咨询会话自动绑定激活案件（工作区「关联会话」回看用）。
     attach() 按 id 去重，重复发送不会产生重复条目；未激活案件时 attach 静默无操作 */
  function bindSessionToCase() {
    try {
      if (!window.WORKSPACE || !window.CHATHISTORY) return;
      var cur = window.CHATHISTORY.current();
      if (!cur || !cur.id) return;
      var firstUser = (cur.messages || []).filter(function (m) { return m.who === "user"; })[0];
      var name = (firstUser && firstUser.text ? String(firstUser.text) : (cur.name || "咨询会话")).replace(/\s+/g, " ").trim().slice(0, 40);
      window.WORKSPACE.attach("sessions", { id: cur.id, name: name || "咨询会话", date: new Date().toISOString().slice(0, 10) });
    } catch (e) { /* 绑定失败不阻断咨询流程 */ }
  }

  /* 助手表情头像：八表情（img/face-1..8.png，用户表情表提取）+ 语义映射（face 随消息存档保持稳定）
     FACE：1 开心 / 2 眨眼 / 3 好奇 / 4 得意 / 5 认真 / 6 惊讶 / 7 睡觉 / 8 害羞 */
  var FACE = { happy: 1, blink: 2, curious: 3, proud: 4, serious: 5, surprise: 6, sleep: 7, shy: 8 };
  function randFace() { return 1 + Math.floor(Math.random() * 8); }
  function faceAvatar(n) { return '<img class="face" src="img/face-' + n + '.png" alt="">'; }

  function appendBot(html, face) {
    var div = document.createElement("div");
    div.className = "msg bot";
    var f = face || randFace();
    div.innerHTML = '<div class="avatar">' + faceAvatar(f) + '</div><div class="bubble">' + html + '</div>';
    box.appendChild(div);
    recordMsg({ who: "bot", face: f, html: html });
    scrollDown();
  }

  function appendQuestion(text, options, onPick) {
    var div = document.createElement("div");
    div.className = "msg bot";
    var inner = '<div class="q-text">' + esc(text) + '</div><div class="q-options">';
    options.forEach(function (op) {
      inner += '<button class="q-btn" data-value="' + esc(op.value) + '">' + esc(op.label) + '</button>';
    });
    inner += '</div>';
    var face = FACE.curious;
    div.innerHTML = '<div class="avatar">' + faceAvatar(face) + '</div><div class="bubble">' + inner + '</div>';
    box.appendChild(div);
    recordMsg({ who: "bot", kind: "question", face: face, html: inner });
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

  function bindLawChip(c) {
    c.addEventListener("click", function () {
      var l = window.lawById(c.getAttribute("data-law"));
      if (!l) return;
      switchView("laws");
      var input = document.getElementById("law-search-input");
      input.value = l.title;
      document.getElementById("law-search-btn").click();
    });
  }

  /* TTS 朗读（v4.0.21）：意见卡系统语音朗读——再点停止；无 TTS 引擎降级提示 */
  function speakCard(div) {
    if (!window.speechSynthesis) {
      if (window.UIKIT && window.UIKIT.toast) window.UIKIT.toast("当前环境不支持语音朗读");
      return;
    }
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    var parts = [];
    var title = div.querySelector(".result-title");
    if (title) parts.push(title.textContent);
    div.querySelectorAll(".result-section").forEach(function (s) { parts.push(s.textContent); });
    var dl = div.querySelector(".result-deadline");
    if (dl) parts.push(dl.textContent);
    var u = new SpeechSynthesisUtterance(parts.join("。").slice(0, 1800));
    u.lang = "zh-CN"; u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  function appendResult(scenario, r, answers, transcript) {
    var d = window.DOMAINS[scenario.domain];
    /* 注册结果供 AI 深度解读 / 文书生成 / 深度核验跳转使用 */
    window.AI_RESULTS = window.AI_RESULTS || [];
    var rid = window.AI_RESULTS.length;
    window.AI_RESULTS.push({ name: scenario.name, domain: scenario.domain, r: r, answers: answers || {}, scenarioId: scenario.id, transcript: transcript || [] });
    var html =
      '<div class="result-card">' +
        '<div class="result-flag" style="border-color:' + d.color + '">' + window.DomainRegistry.iconSvg(scenario.domain) + ' ' + d.name + ' · 初步分析意见</div>' +
        '<div class="result-title">' + esc(r.headline) + '</div>' +
        /* 结论前提：结论所依据的已确认事实逐条回显（可复核） */
        ((transcript || []).length ? '<div class="result-section"><span class="sec-label"><svg class=ico><use href=#i-checkc></use></svg> 结论前提（基于你确认的事实）</span>' +
          '<ul style="margin:4px 0 0;padding-left:18px">' + transcript.map(function (t) {
            return '<li>' + esc(t.q) + ' → <b>' + esc(t.a) + '</b></li>';
          }).join("") + '</ul>' +
          '<div class="dim" style="font-size:11.5px;margin-top:4px">以上事实以你的选择为准；如有出入请重答或改用「深度分析」描述完整案情。</div></div>' : '') +
        '<div class="result-section"><span class="sec-label"><svg class=ico><use href=#i-pin></use></svg> 结论概要</span>' + esc(r.summary) + '</div>' +
        '<div class="result-section"><span class="sec-label"><svg class=ico><use href=#i-search></use></svg> 具体分析</span>' +
          '<ul>' + r.analysis.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' +
        '<div class="result-section"><span class="sec-label"><svg class=ico><use href=#i-book-open></use></svg> 依据法条</span><div class="chips">' + lawChips(r.laws) + '</div></div>' +
        '<div class="result-section"><span class="sec-label"><svg class=ico><use href=#i-checkc></use></svg> 行动建议</span>' +
          '<ul>' + r.advice.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' +
        relatedLinks(scenario) +
        quickFollowUps(rid) +
        '<div class="result-deadline">⏰ <b>时效提示：</b>' + esc(r.deadline) + '</div>' +
        '<div class="result-ai-row">' +
          '<button class="mini-btn primary result-ai-btn" data-rid="' + rid + '"><svg class=ico><use href=#i-ai></use></svg> AI 深度解读</button>' +
          '<button class="mini-btn primary deep-btn" data-deep="' + rid + '"><svg class=ico><use href=#i-agent></use></svg> 转深度核验分析</button>' +
          '<button class="mini-btn doc-btn" data-rid="' + rid + '"><svg class=ico><use href=#i-file></use></svg> 生成文书</button>' +
          '<button class="mini-btn ws-save-btn" data-rid="' + rid + '" title="存入当前案件工作区（无案件时自动新建）">存入案件</button>' +
          '<button class="mini-btn ev-btn" data-rid="' + rid + '"><svg class=ico><use href=#i-contract></use></svg> 证据清单</button>' +
          (window.TOOLS ? window.TOOLS.toolBtnForScenario(scenario.id, rid) : "") +
          '<button class="mini-btn fb-like" data-rid="' + rid + '" title="有帮助"><svg class=ico><use href=#i-tup></use></svg></button>' +
          '<button class="mini-btn fb-bad" data-rid="' + rid + '" title="需改进"><svg class=ico><use href=#i-tdn></use></svg></button>' +
          '<button class="mini-btn tts-btn" data-rid="' + rid + '" title="朗读此分析（再点停止）">朗读</button>' +
          '<button class="mini-btn print-card-btn" data-rid="' + rid + '" title="打印此分析"><svg class=ico><use href=#i-print></use></svg></button>' +
          '<span class="result-disclaimer">仅供参考，不构成法律意见 · 完整声明见页脚</span>' +
        '</div>' +
      '</div>';
    var div = document.createElement("div");
    div.className = "msg bot";
    var face = FACE.proud;
    div.innerHTML = '<div class="avatar">' + faceAvatar(face) + '</div><div class="bubble">' + html + '</div>';
    box.appendChild(div);
    /* 意见卡逐段揭示（v3.8.0 B1）：结论前提→概要→分析 stagger 80ms 登场 */
    div.querySelectorAll(".result-section").forEach(function (s, i) {
      s.style.animationDelay = (i * 80) + "ms";
      s.classList.add("cardrise");
    });
    recordMsg({ who: "bot", kind: "result", face: face, html: html, data: { name: scenario.name, domain: scenario.domain, r: r, answers: answers || {}, scenarioId: scenario.id, transcript: transcript || [] } });

    div.querySelectorAll(".law-chip").forEach(bindLawChip);
    if (window.REPORTFOLD && div.querySelector(".result-section")) window.REPORTFOLD.applyResult(div.querySelector(".bubble"));
    bindRelLinks(div);
    bindFeedback(div, rid);
    scrollDown();
  }

  /* 相关阅读：同领域 FAQ 两条 + 按案情要素相似度匹配的类案两条（指导案例/典型案例） */
  function relatedLinks(scenario) {
    var faqs = window.FAQ.filter(function (f) { return f.domain === scenario.domain; }).slice(0, 2);
    var pool = [];
    window.GUIDING.forEach(function (g) { pool.push({ rel: "case-guiding", label: g.no.replace("指导案例", "指导性案例"), c: g }); });
    window.CASES.forEach(function (c) { pool.push({ rel: "case-builtin", label: c.title, c: c }); });
    var kws = (scenario.keywords || []).slice();
    scenario.name.replace(/[（）()、，,\s]/g, "").split("").forEach(function (_, i, arr) {
      if (i + 2 <= arr.length) kws.push(arr.slice(i, i + 2).join(""));
    });
    pool.forEach(function (p) {
      var score = 0;
      (p.c.keywords || []).forEach(function (k) {
        if (scenario.keywords && scenario.keywords.indexOf(k) > -1) score += k.length;
        if (scenario.name.indexOf(k) > -1) score += k.length;
      });
      kws.forEach(function (k) {
        if (k.length > 1 && (p.c.title + p.c.facts).indexOf(k) > -1) score += 1;
      });
      if (p.c.domain === scenario.domain) score += 1;
      p.score = score;
    });
    pool.sort(function (a, b) { return b.score - a.score; });
    var links = faqs.map(function (f) {
      return '<button class="rel-link" data-rel="faq" data-q="' + esc(f.q) + '"><svg class=ico><use href=#i-book-open></use></svg> ' + esc(f.q) + '</button>';
    });
    pool.slice(0, 2).forEach(function (p) {
      links.push('<button class="rel-link" data-rel="' + p.rel + '">' + esc(p.label.slice(0, 28)) + '</button>');
    });
    if (!links.length) return "";
    return '<div class="result-section"><span class="sec-label"><svg class=ico><use href=#i-link></use></svg> 相关阅读</span><div class="chips">' + links.join("") + '</div></div>';
  }

  /* 继续追问：三个场景化快捷问题，点击后由 AI 带上下文回答 */
  function quickFollowUps(rid) {
    var qs = ["还可能有哪些隐藏风险？", "关键金额/时限怎么计算？", "下一步具体怎么操作？"];
    return '<div class="result-section"><span class="sec-label"><svg class=ico><use href=#i-q></use></svg> 继续追问</span><div class="chips">' +
      qs.map(function (q) {
        return '<button class="rel-link qf-btn" data-rid="' + rid + '" data-q="' + esc(q) + '">' + esc(q) + '</button>';
      }).join("") + '</div></div>';
  }

  /* 场景答案 → 计算器预填参数（answers 为选项枚举值，按场景映射为具体数值） */
  function scenarioPrefill(entry) {
    if (!entry || !window.TOOLS || !window.TOOLS.TENURE_MAP) return null;
    var a = entry.answers || {};
    var pre = {};
    if (entry.scenarioId === "labor-leave" && a.tenure && window.TOOLS.TENURE_MAP[a.tenure] != null) {
      pre["al-years"] = window.TOOLS.TENURE_MAP[a.tenure];
    }
    return Object.keys(pre).length ? pre : null;
  }

  function bindRelLinks(div) {
    div.querySelectorAll(".rel-link").forEach(function (b) {
      if (b.classList.contains("qf-btn")) return;   /* 快捷追问有自己的委托处理，不走相关阅读跳转 */
      b.addEventListener("click", function () {
        var rel = b.getAttribute("data-rel");
        if (rel === "faq") {
          switchView("faq");
          var q = b.getAttribute("data-q");
          setTimeout(function () {
            document.querySelectorAll("#faq-list .faq-item").forEach(function (item) {
              if (item.querySelector(".faq-q").textContent.indexOf(q) > -1) {
                if (!item.classList.contains("open")) item.querySelector(".faq-q").click();
                item.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            });
          }, 100);
        } else {
          switchView("cases");
          document.getElementById(rel === "case-guiding" ? "case-tab-guiding" : "case-tab-builtin").click();
        }
      });
    });
  }

  window.UI = { appendUser: appendUser, appendBot: appendBot, appendQuestion: appendQuestion, appendResult: appendResult };

  /* ---------- 语音提问（浏览器语音识别，Chrome/Edge 可用） ---------- */
  var micBtn = document.getElementById("voice-btn");
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var MIC_SVG = '<svg class="mic-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/>' +
    '<path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z/></svg>' +
    '<span class="mic-label">语音</span>';
  var inApp = !!(window.BRIDGE && window.BRIDGE.available);   /* App 内走原生语音（mobile.js 绑定） */
  if (micBtn && !SR && !inApp) { micBtn.classList.add("hidden"); }
  else if (micBtn && !inApp) {
    micBtn.innerHTML = MIC_SVG;
    micBtn.title = "点击开始语音提问";
    /* 状态机：off ⇄ on。浏览器在静音数秒后会自动结束识别，
       因此以显式状态机管理，而不是依赖识别对象的存活状态 */
    var micState = "off";   /* off | on */
    var rec = null;

    function setMicUI(on) {
      micState = on ? "on" : "off";
      micBtn.classList.toggle("listening", on);
      var label = micBtn.querySelector(".mic-label");
      if (label) label.textContent = on ? "停止" : "语音";
      micBtn.title = on ? "点击停止录音" : "点击开始语音提问";
    }

    function startRec() {
      if (rec) { try { rec.abort(); } catch (e) {} rec = null; }
      try {
        rec = new SR();
        rec.lang = "zh-CN";
        rec.interimResults = true;    /* 中间结果实时上屏 */
        rec.continuous = true;        /* 保持监听，静音不自动结束 */
        rec.maxAlternatives = 1;
        rec.onresult = function (e) {
          var finalText = "", interim = "";
          for (var i = 0; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
            else interim += e.results[i][0].transcript;
          }
          if (finalText) {
            input.value = (input.value + " " + finalText).trim().slice(0, 500);
            input.dataset.base = input.value;
          } else if (interim) {
            var base = input.dataset.base || input.value;
            input.value = (base + " " + interim).trim().slice(0, 500);
          }
        };
        rec.onend = function () {
          /* continuous 模式下只有 stop/abort/出错才会到这里 */
          if (micState === "on") setMicUI(false);
          rec = null;
        };
        rec.onerror = function (e) {
          if (e && e.error === "no-speech") return;   /* 静音忽略，保持监听 */
          setMicUI(false);
          rec = null;
        };
        rec.start();
        setMicUI(true);
      } catch (e) {
        setMicUI(false);
      }
    }

    function stopRec() {
      micState = "off";
      setMicUI(false);
      if (rec) {
        try { rec.stop(); }        /* 优雅结束：把已识别文本冲刷进输入框 */
        catch (e) { try { rec.abort(); } catch (e2) {} }
        rec = null;
      }
    }

    micBtn.addEventListener("click", function () {
      if (micState === "on") { stopRec(); return; }
      startRec();
    });
  }

  /* ---------- 咨询输入框 ---------- */
  var input = document.getElementById("consult-input");
  document.getElementById("consult-send").addEventListener("click", function () {
    window.CONSULT.start(input.value);
    input.value = "";
    delete input.dataset.base;
    input.dispatchEvent(new Event("input"));
  });

  /* ---------- 快捷场景卡片（带领域筛选） ---------- */
  var quickBox = document.getElementById("quick-scenarios");
  if (quickBox) {
    var cards = {};
    window.SCENARIOS.forEach(function (s) {
      var card = document.createElement("button");
      card.className = "quick-card";
      card.setAttribute("data-domain", s.domain);
      card.innerHTML = '<span class="qc-icon">' + window.DomainRegistry.iconSvg(s.domain) + '</span><span class="qc-name">' + esc(s.name) + '</span><span class="qc-desc">' + esc(s.desc) + '</span>';
      card.addEventListener("click", function () { window.CONSULT.quickStart(s.id); });
      quickBox.appendChild(card);
      cards[s.id] = card;
    });
    var filterBox = document.getElementById("scenario-filter");
    if (filterBox) {
      /* 筛选标签由领域注册表动态生成（新领域自动出现） */
      filterBox.innerHTML = "";
      var allChip = document.createElement("button");
      allChip.className = "filter-chip active";
      allChip.setAttribute("data-domain", "");
      allChip.textContent = "全部";
      filterBox.appendChild(allChip);
      window.DomainRegistry.metas().forEach(function (d) {
        var c = document.createElement("button");
        c.className = "filter-chip";
        c.setAttribute("data-domain", d.id);
        c.textContent = d.short || d.name.replace("法", "");
        filterBox.appendChild(c);
      });
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

  /* ---------- 对话历史：渲染与会话列表 ---------- */
  function welcomeHtml() {
    return "您好！我是<b>獬小豸</b>，您的法律咨询助手。<br>" +
      "请描述您的问题，我会澄清关键事实后给出<b>分析 + 法条 + 行动建议</b>；也可点左上角 ☰ 从「快捷咨询」选场景开始，或点顶部 🔍 搜索法条与案例。";
  }

  /* 历史消息还原渲染（结果卡的 AI 解读按钮 / 法条跳转重新绑定） */
  function renderMessage(m) {
    var div = document.createElement("div");
    if (m.who === "user") {
      div.className = "msg user";
      div.innerHTML = '<div class="bubble">' + m.html + '</div>';
    } else {
      var avatar = faceAvatar(m.face || randFace());
      div.className = "msg bot";
      /* 旧会话回放迁移：品牌化前的欢迎语存档升级为獬小豸口径 */
      var html = m.html.indexOf("我是<b>法律咨询助手</b>") === 0 ? m.html.replace("我是<b>法律咨询助手</b>", "我是<b>獬小豸</b>，您的法律咨询助手") : m.html;
      div.innerHTML = '<div class="avatar">' + avatar + '</div><div class="bubble">' + html + '</div>';
    }
    box.appendChild(div);
    if (m.kind === "result" && m.data) {
      window.AI_RESULTS = window.AI_RESULTS || [];
      var rid = window.AI_RESULTS.length;
      window.AI_RESULTS.push({ name: m.data.name, domain: m.data.domain, r: m.data.r, answers: m.data.answers || {}, scenarioId: m.data.scenarioId, transcript: m.data.transcript || [] });
      var btn = div.querySelector(".result-ai-btn");
      var tbtn = div.querySelector(".tool-jump-btn");
      if (tbtn) tbtn.setAttribute("data-rid", rid);
      if (btn) btn.setAttribute("data-rid", rid);
      div.querySelectorAll(".law-chip").forEach(bindLawChip);
    if (window.REPORTFOLD && div.querySelector(".result-section")) window.REPORTFOLD.applyResult(div.querySelector(".bubble"));
      bindRelLinks(div);
      bindFeedback(div, rid);
    }
  }

  function loadCurrentIntoBox() {
    box.innerHTML = "";
    var cur = window.CHATHISTORY.current();
    if (cur && cur.messages.length) {
      cur.messages.forEach(renderMessage);
    } else {
      if (!cur) window.CHATHISTORY.newSession(false);
      appendBot(welcomeHtml(), 1);
      appendEntryCards();
    }
  }

  /* 空态三入口引导卡：让新用户第一眼知道三条路径；对话开始后由 ai.js updQuickVis 统一隐藏 */
  function appendEntryCards() {
    var old = document.getElementById("entry-cards");
    if (old) old.remove();
    var wrap = document.createElement("div");
    wrap.id = "entry-cards";
    wrap.className = "entry-cards";
    wrap.innerHTML =
      '<button class="entry-card" data-act="ask"><b>① 直接描述问题</b><span>在下方输入框描述案情，可多行粘贴</span></button>' +
      '<button class="entry-card" data-act="scene"><b>② 从场景开始</b><span>选一个贴近的场景，引导问答出报告</span></button>' +
      '<button class="entry-card" data-act="agent"><b>③ 深度咨询</b><span>AI 逐项追问补齐要素，一键生成可核验分析</span></button>';
    wrap.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".entry-card") : null;
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "ask") {
        var inp = document.getElementById("consult-input");
        if (inp) inp.focus();
      } else if (act === "scene") {
        var q = document.getElementById("quick-scenarios");
        if (q) {
          q.scrollIntoView({ behavior: "smooth", block: "center" });
          q.classList.add("flash");
          setTimeout(function () { q.classList.remove("flash"); }, 1200);
        }
      } else if (act === "agent") {
        var ib = document.getElementById("intake-btn");
        if (ib) ib.click();
      }
    });
    box.appendChild(wrap);
  }

  var sessionView = "main";   /* "main" = 历史 | "archived" = 归档 */

  var menuOpenerBtn = null;   /* 记录当前浮层菜单的触发按钮，用于 ⋯ 点击的开/关切换 */
  function closeSessionMenus() {
    document.querySelectorAll(".session-menu").forEach(function (m) { m.remove(); });
    menuOpenerBtn = null;
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".session-more")) return;
    closeSessionMenus();
  });
  /* 浮层菜单跟随按钮定位，滚动/缩放时直接收起，避免漂移错位 */
  window.addEventListener("scroll", closeSessionMenus, true);
  window.addEventListener("resize", closeSessionMenus);

  function refreshChatFromCurrent() {
    box.innerHTML = "";
    var cur = window.CHATHISTORY.current();
    if (cur && cur.messages.length) {
      cur.messages.forEach(renderMessage);
      /* 切会话重建 AI 记忆（P2）：此前 resetHistory 让 AI 对刚聊过的案情失忆 */
      if (window.AI && window.AI.restoreFromTranscript) window.AI.restoreFromTranscript(cur.messages);
      else if (window.AI && window.AI.resetHistory) window.AI.resetHistory();
    } else {
      if (!cur) window.CHATHISTORY.newSession(false);
      appendBot(welcomeHtml(), 1);
      appendEntryCards();
      window.AI.resetHistory && window.AI.resetHistory();
    }
  }

  function fmtTime(ts) {
    var d = new Date(ts), now = new Date();
    var hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    if (d.toDateString() === now.toDateString()) return hm;
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + "-" + d.getDate() + " " + hm;
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  /* 会话导出 Markdown（P5）：App 走 BRIDGE.exportFile */
  function exportSessionMd(s) {
    var md = window.CHATHISTORY.toMarkdown ? window.CHATHISTORY.toMarkdown(s.id) : "";
    if (!md) return;
    var fname = "对话记录-" + String(s.title || "会话").slice(0, 20).replace(/[\\/:*?"<>|]/g, "_") + ".md";
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) { window.BRIDGE.exportFile(fname, md); return; }
    try {
      var blob = new Blob(["\ufeff" + md], { type: "text/markdown;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    } catch (e) { }
  }

  function openSessionMenu(moreBtn, s) {
    closeSessionMenus();
    var menu = document.createElement("div");
    menu.className = "session-menu";
    var actions = [];
    if (s.archived) {
      actions.push({ label: "<svg class=ico><use href=#i-uptray></use></svg> 取消归档", act: function () { window.CHATHISTORY.archive(s.id, false); } });
    } else {
      actions.push({ label: "<svg class=ico><use href=#i-downtray></use></svg> 归档", act: function () { window.CHATHISTORY.archive(s.id, true); } });
    }
    actions.push({ label: "<svg class=ico><use href=#i-file></use></svg> 导出 MD", act: function () { exportSessionMd(s); } });
    actions.push({ label: "<svg class=ico><use href=#i-trash></use></svg> 删除", danger: true, act: null });   /* 删除走两段确认 */
    actions.forEach(function (a) {
      var b = document.createElement("button");
      b.innerHTML = a.label;   /* label 为本函数内写死的静态串，含 svg 图标，须走 innerHTML */
      if (a.danger) b.classList.add("danger");
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (!a.danger) {
          a.act();
          closeSessionMenus();
          refreshChatFromCurrent();
          window.renderSessionList();
          return;
        }
        /* 删除：两段确认 */
        if (b.dataset.armed) {
          window.CHATHISTORY.remove(s.id);
          closeSessionMenus();
          refreshChatFromCurrent();
          window.renderSessionList();
        } else {
          b.dataset.armed = "1";
          b.textContent = "确认删除？";
          b.classList.add("armed");
          setTimeout(function () { closeSessionMenus(); }, 3000);
        }
      });
      menu.appendChild(b);
    });
    /* 挂到 body 顶层浮层：脱离 .session-list 滚动容器，避免被裁剪、无需滚动即可见 */
    document.body.appendChild(menu);
    var r = moreBtn.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.min(Math.max(4, r.right - mw), window.innerWidth - mw - 4);
    var top = r.bottom + 4;
    if (top + mh > window.innerHeight - 4) top = Math.max(4, r.top - mh - 4);   /* 下方放不下则上弹 */
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menuOpenerBtn = moreBtn;
  }

  window.renderSessionList = function () {
    var listEl = document.getElementById("session-list");
    if (!listEl) return;
    var cur = window.CHATHISTORY.current();
    var q = (window.__sessionQuery || "").trim().toLowerCase();
    var items = window.CHATHISTORY.list(sessionView === "archived").filter(function (s) {
      return !q || String(s.title || "").toLowerCase().indexOf(q) > -1;
    });
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML = '<div class="session-empty">' + (q ? "无匹配会话" : (sessionView === "archived" ? "暂无归档对话" : "暂无历史对话")) + '</div>';
      return;
    }
    items.forEach(function (s) {
      var div = document.createElement("div");
      div.className = "session-item" + (cur && s.id === cur.id ? " active" : "");
      div.innerHTML =
        '<div class="session-title">' + esc(s.title) + '</div>' +
        '<div class="session-time">' + fmtTime(s.updatedAt) + ' · ' + s.messages.length + ' 条</div>' +
        '<button class="session-more" title="更多操作">⋯</button>';
      div.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest(".session-more")) return;
        if (e.target.closest && e.target.closest(".session-menu")) return;
        window.CHATHISTORY.switchTo(s.id);
        loadCurrentIntoBox();   /* 内部 refreshChatFromCurrent 已按会话消息重建 AI 记忆 */
        window.renderSessionList();
      });
      var more = div.querySelector(".session-more");
      more.addEventListener("click", function (e) {
        e.stopPropagation();
        if (menuOpenerBtn === more) { closeSessionMenus(); return; }   /* 菜单在 body 浮层，按触发按钮判断开关 */
        openSessionMenu(more, s);
      });
      listEl.appendChild(div);
    });
  };

  /* 历史 / 归档 视图切换 */
  var tabMain = document.getElementById("session-tab-main");
  var tabArc = document.getElementById("session-tab-archived");
  function setSessionView(v) {
    sessionView = v;
    if (tabMain) tabMain.classList.toggle("active", v === "main");
    if (tabArc) tabArc.classList.toggle("active", v === "archived");
    closeSessionMenus();
    window.renderSessionList();
  }
  if (tabMain) tabMain.addEventListener("click", function () { setSessionView("main"); });
  if (tabArc) tabArc.addEventListener("click", function () { setSessionView("archived"); });
  /* 会话标题搜索（C2a）：几十个会话不再只能肉眼扫 */
  var sSearch = document.getElementById("session-search");
  if (sSearch) sSearch.addEventListener("input", function () {
    window.__sessionQuery = sSearch.value;
    window.renderSessionList();
  });

  var newChatBtn = document.getElementById("new-chat");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", function () {
      window.CHATHISTORY.newSession();
      box.innerHTML = "";
      window.AI.resetHistory && window.AI.resetHistory();
      appendBot(welcomeHtml(), 1);
      appendEntryCards();
      window.renderSessionList();
      scrollDown();
    });
  }

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
        '<div class="case-lesson"><svg class=ico><use href=#i-d-patent></use></svg> <b>要点</b>' + esc(c.lesson) + '</div>';
      caseBox.appendChild(el);
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

  /* ---------- 知识讲堂 FAQ（C2b：搜索 + 领域 chips + 超长答案展开全文） ---------- */
  var faqBox = document.getElementById("faq-list");
  if (faqBox) {
    var faqQuery = "", faqDomain = "";
    /* 展开态的答案超过 1200px 时被 CSS 静默裁剪——检测后补「展开全文」按钮 */
    function maybeExpand(item) {
      var a = item.querySelector(".faq-a");
      if (!a || a.dataset.expanded || a.scrollHeight <= 1150) return;
      var b = document.createElement("button");
      b.className = "mini-btn";
      b.style.margin = "6px 0 12px";
      b.textContent = "展开全文（答案较长，默认截断显示）";
      b.addEventListener("click", function () {
        a.style.maxHeight = "none";
        a.dataset.expanded = "1";
        b.remove();
      });
      a.appendChild(b);
    }
    function renderFaq() {
      faqBox.innerHTML = "";
      var q = faqQuery.trim().toLowerCase();
      var any = false;
      window.DomainRegistry.ids().forEach(function (dom) {
        if (faqDomain && dom !== faqDomain) return;
        var faqs = window.FAQ.filter(function (f) {
          if (f.domain !== dom) return false;
          if (!q) return true;
          return (String(f.q) + " " + String(f.a) + " " + (f.tags || []).join(" ")).toLowerCase().indexOf(q) > -1;
        });
        if (!faqs.length) return;
        any = true;
        var d = window.DOMAINS[dom];
        var group = document.createElement("div");
        group.className = "faq-group";
        group.innerHTML = '<div class="faq-group-title" style="color:' + d.color + '">' + window.DomainRegistry.iconSvg(d.id) + ' ' + d.name + '</div>';
        faqs.forEach(function (f) {
          var item = document.createElement("div");
          item.className = "faq-item";
          item.innerHTML = '<div class="faq-q">' + esc(f.q) + '<span class="faq-toggle">展开</span></div><div class="faq-a">' + f.a + '</div>';
          item.querySelector(".faq-q").addEventListener("click", function () {
            var open = item.classList.toggle("open");
            item.querySelector(".faq-toggle").textContent = open ? "收起" : "展开";
            if (open) maybeExpand(item);
          });
          group.appendChild(item);
        });
        faqBox.appendChild(group);
      });
      if (!any) faqBox.innerHTML = '<div class="empty">没有匹配的问答——换个关键词，或清除筛选试试。</div>';
    }
    var chipsBox = document.getElementById("faq-chips");
    if (chipsBox) {
      chipsBox.innerHTML = ['<button class="filter-chip active" data-dom="">全部</button>'].concat(
        window.DomainRegistry.ids().map(function (dom) {
          var d = window.DOMAINS[dom];
          return d ? '<button class="filter-chip" data-dom="' + dom + '">' + esc(d.name) + '</button>' : "";
        })
      ).join("");
      chipsBox.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest(".filter-chip") : null;
        if (!b) return;
        chipsBox.querySelectorAll(".filter-chip").forEach(function (x) { x.classList.toggle("active", x === b); });
        faqDomain = b.getAttribute("data-dom") || "";
        renderFaq();
      });
    }
    var fq = document.getElementById("faq-search");
    if (fq) fq.addEventListener("input", function () { faqQuery = fq.value; renderFaq(); });
    renderFaq();
  }

  /* ---------- 启动：恢复当前会话或开新会话 ---------- */
  var cur = window.CHATHISTORY.current();
  if (cur && cur.messages.length) {
    cur.messages.forEach(renderMessage);
    if (window.AI && window.AI.restoreFromTranscript) window.AI.restoreFromTranscript(cur.messages);
  } else {
    if (!cur) window.CHATHISTORY.newSession(false);
    appendBot(welcomeHtml(), 1);
    appendEntryCards();
  }
  window.renderSessionList();

  /* ---------- 打印辅助：标记目标元素 → @media print 仅显示该元素 ---------- */
  window.printEl = function (el) {
    el.classList.add("print-target");
    document.body.classList.add("print-mode");
    var cleanup = function () {
      el.classList.remove("print-target");
      document.body.classList.remove("print-mode");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    /* afterprint 在部分浏览器不触发时的兜底恢复 */
    setTimeout(function () {
      if (document.body.classList.contains("print-mode")) cleanup();
    }, 60000);
  };

  /* ---------- 结果卡反馈 ---------- */
  function saveFeedback(entry, verdict, comment) {
    try {
      var fb = JSON.parse(localStorage.getItem("legal-feedback") || "[]");
      fb.push({
        scene: entry.name, domain: entry.domain, verdict: verdict,
        comment: comment || "", time: new Date().toISOString()
      });
      localStorage.setItem("legal-feedback", JSON.stringify(fb.slice(-200)));
    } catch (e) { /* 存储失败静默 */ }
  }
  function bindFeedback(div, rid) {
    var like = div.querySelector(".fb-like");
    var bad = div.querySelector(".fb-bad");
    if (!like || !bad) return;
    var entry = (window.AI_RESULTS || [])[rid];
    like.addEventListener("click", function () {
      saveFeedback(entry, "up");
      like.innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已感谢";
      like.disabled = true; bad.disabled = true;
    });
    bad.addEventListener("click", function () {
      saveFeedback(entry, "down");
      bad.innerHTML = "<svg class=ico><use href=#i-list></use></svg> 已记录";
      bad.disabled = true; like.disabled = true;
      var input = document.createElement("textarea");
      input.className = "fb-comment";
      input.rows = 2;
      input.placeholder = "哪里不准确或没帮助？（选填，仅存本机）";
      input.addEventListener("change", function () {
        saveFeedback(entry, "down", input.value.slice(0, 300));
      });
      div.querySelector(".result-ai-row").appendChild(input);
    });
  }

  /* ---------- 证据清单文档 ---------- */
  function openEvidenceModal(entry) {
    var evList = (window.ANALYSIS && window.ANALYSIS.EVIDENCE_MAP && window.ANALYSIS.EVIDENCE_MAP[entry.scenarioId]) || [];
    if (!evList.length && entry.r && entry.r.advice) evList = entry.r.advice;
    var text = "证据准备清单（" + entry.name + "）\n生成日期：" + new Date().toLocaleDateString("zh-CN") + "\n\n";
    text += "说明：逐项核对已有证据，勾选状态可自行标注；缺失项即为下一步取证重点。\n\n";
    evList.forEach(function (x, i) {
      text += "☐ " + (i + 1) + ". " + x + "\n";
    });
    text += "\n提示：电子证据保留原始载体，书面证据保留原件或核对无误的复印件；证据清单随起诉/仲裁材料一并提交。";
    /* 证据三性自检（真实性/合法性/关联性）：交互式勾选 + 按证据类型的取证提示 */
    var EV_TIPS = [
      [/聊天|微信|短信|通话记录/, "保留原始载体（手机原件），勿只截图；关键页面录屏并加时间戳"],
      [/录音|录像/, "保留原始音频/视频文件；取得方式须合法（双方对话可录，窃听私密空间不可）"],
      [/转账|流水|工资条|银行/, "银行柜台打印并盖章的版本效力高于手机截图"],
      [/合同|欠条|借条|收据/, "保留原件；复印件须与原件核对无误"],
      [/照片|视频/, "保留原图（含拍摄时间信息）"],
      [/证人/, "证人原则上需要出庭作证"],
      [/裁决书|判决书|仲裁/, "已生效文书可直接作为证据使用"]
    ];
    var checks = {};
    try { checks = JSON.parse(localStorage.getItem("legal-ev-checks") || "{}")[entry.scenarioId] || {}; } catch (e) {}
    var listHtml = evList.map(function (x, i) {
      var tip = "";
      EV_TIPS.forEach(function (t) { if (!tip && t[0].test(x)) tip = t[1]; });
      var st = checks[i] || {};
      return '<div class="ev-check-row" data-i="' + i + '">' +
        '<div class="ev-check-name">' + (i + 1) + ". " + x + '</div>' +
        '<div class="ev-tri">' +
          ["真实性", "合法性", "关联性"].map(function (k) {
            return '<label class="ev-tri-item"><input type="checkbox" data-k="' + k + '" ' + (st[k] ? "checked" : "") + '> ' + k + '</label>';
          }).join("") +
        '</div>' +
        (tip ? '<div class="ev-tip"><svg class=ico><use href=#i-warn></use></svg> ' + tip + '</div>' : "") +
        '</div>';
    }).join("");
    document.getElementById("doc-list").innerHTML =
      '<div class="dim" style="font-size:12px;margin-bottom:8px">逐项自检证据「三性」并勾选——三项不满足的证据需要补强：</div>' + listHtml +
      '<div style="margin:8px 0"><button class="mini-btn" id="ev-save-checks">保存勾选状态</button> <span id="ev-saved-tip" class="dim" style="font-size:11.5px"></span></div>';
    document.getElementById("doc-list").querySelectorAll(".ev-tri input").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var i = cb.closest(".ev-check-row").getAttribute("data-i");
        checks[i] = checks[i] || {};
        checks[i][cb.getAttribute("data-k")] = cb.checked;
      });
    });
    document.getElementById("ev-save-checks").addEventListener("click", function () {
      try {
        var all = JSON.parse(localStorage.getItem("legal-ev-checks") || "{}");
        all[entry.scenarioId] = checks;
        localStorage.setItem("legal-ev-checks", JSON.stringify(all));
        document.getElementById("ev-saved-tip").textContent = "已保存到本机";
      } catch (e) { /* 忽略 */ }
    });
    document.getElementById("doc-text").value = text;
    document.getElementById("doc-modal").classList.remove("hidden");
  }

  /* ---------- 深度核验跳转：问答实录 → 案情文本 → 自动执行 ---------- */
  function buildCaseText(entry) {
    var lines = ["咨询场景：" + entry.name + "。"];
    (entry.transcript || []).forEach(function (t) {
      lines.push(t.q + " 答：" + t.a + "。");
    });
    if (!(entry.transcript || []).length && entry.r && entry.r.summary) {
      lines.push(entry.r.summary);
    }
    return lines.join("\n");
  }

  /* ---------- 文书生成 / 证据清单 / 深度核验 / 打印（事件委托） ---------- */
  box.addEventListener("click", function (e) {
    var qfBtn = e.target.closest ? e.target.closest(".qf-btn") : null;
    if (qfBtn) {
      var qEntry = (window.AI_RESULTS || [])[parseInt(qfBtn.getAttribute("data-rid"), 10)];
      var q = qfBtn.getAttribute("data-q");
      if (qEntry && window.AI && window.AI.isConfigured()) {
        window.AI.aiFollowUp(parseInt(qfBtn.getAttribute("data-rid"), 10), q);
      } else {
        UI.appendBot("继续追问需要先配置 AI 模型：点右上角「AI 模型」设置后即可使用；也可以直接在输入框描述这个问题。", null);
      }
      return;
    }
    /* 结果卡 / AI 回答 → 计算器直达（定位 + 高亮 + 场景化预填） */
    var toolBtn = e.target.closest ? e.target.closest(".tool-jump-btn") : null;
    if (toolBtn) {
      var tId = toolBtn.getAttribute("data-tool");
      var prefill = null;
      var ridAttr = toolBtn.getAttribute("data-rid");
      if (ridAttr != null) {
        var entry = (window.AI_RESULTS || [])[parseInt(ridAttr, 10)];
        if (entry) prefill = scenarioPrefill(entry);
      }
      if (window.TOOLS && window.TOOLS.jumpTo) window.TOOLS.jumpTo(tId, prefill);
      return;
    }
    var deepBtn = e.target.closest ? e.target.closest(".deep-btn") : null;
    if (deepBtn) {
      var dEntry = (window.AI_RESULTS || [])[parseInt(deepBtn.getAttribute("data-deep"), 10)];
      if (dEntry) {
        var mode = window.AI && window.AI.isConfigured() ? "ai" : "report";
        window.APP.switchView("agent");
        window.AGENT.runWith(buildCaseText(dEntry), mode);
        window.scrollTo(0, 0);
      }
      return;
    }
    var evBtn = e.target.closest ? e.target.closest(".ev-btn") : null;
    if (evBtn) {
      var evEntry = (window.AI_RESULTS || [])[parseInt(evBtn.getAttribute("data-rid"), 10)];
      if (evEntry) openEvidenceModal(evEntry);
      return;
    }
    /* TTS 朗读按钮（v4.0.21）：委托到 speakCard（closest 找所在意见卡消息） */
    var ttsBtn = e.target.closest ? e.target.closest(".tts-btn") : null;
    if (ttsBtn) {
      var ttsMsg = ttsBtn.closest(".msg");
      if (ttsMsg) speakCard(ttsMsg);
      return;
    }
    var pBtn = e.target.closest ? e.target.closest(".print-card-btn") : null;
    if (pBtn) {
      var card = pBtn.closest(".result-card");
      if (window.REPORTFOLD) window.REPORTFOLD.openAll(card);
      if (card) window.printEl(card);
      return;
    }
    var fbLike = e.target.closest ? e.target.closest(".fb-like") : null;
    var fbBad = e.target.closest ? e.target.closest(".fb-bad") : null;
    if (fbLike || fbBad) return;   /* 反馈由 bindFeedback 的专属监听处理 */
    /* 存入案件工作区（v4.0.21）：无激活案件时一键建案——意见卡文本归集到 docs 组 */
    var wsSave = e.target.closest ? e.target.closest(".ws-save-btn") : null;
    if (wsSave) {
      var entry0 = (window.AI_RESULTS || [])[parseInt(wsSave.getAttribute("data-rid"), 10)] || {};
      var r0 = entry0.r || {};
      var title0 = (entry0.name || "咨询意见").slice(0, 30);
      var body0 = "【咨询意见】" + title0 + "\n结论：" + (r0.summary || "") + "\n【具体分析】\n" + (r0.analysis || []).map(function (x) { return "· " + x; }).join("\n") + "\n【行动建议】\n" + (r0.advice || []).map(function (x) { return "· " + x; }).join("\n") + "\n【时效提示】" + (r0.deadline || "") + "\n（生成于 " + new Date().toLocaleDateString("zh-CN") + "）";
      var entryWs = { name: "咨询意见：" + title0, date: new Date().toISOString().slice(0, 10), draft: body0.slice(0, 4000) };
      if (!window.WORKSPACE || !window.WORKSPACE.current()) {
        window.WORKSPACE.create(title0);
        window.WORKSPACE.attach("docs", entryWs);
        wsSave.innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已新建案件并存入";
      } else {
        window.WORKSPACE.attach("docs", entryWs);
        wsSave.innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已存入案件工作区";
      }
      wsSave.disabled = true;
      setTimeout(function () { wsSave.disabled = false; wsSave.textContent = "存入案件"; }, 2200);
      return;
    }
    var btn = e.target.closest ? e.target.closest(".doc-btn") : null;
    if (!btn) return;
    var entry = (window.AI_RESULTS || [])[parseInt(btn.getAttribute("data-rid"), 10)];
    if (!entry || !window.DOCTPL) return;
    var docs = window.DOCTPL.forScenario(entry.scenarioId);
    var listEl = document.getElementById("doc-list");
    listEl.innerHTML = "";
    docs.forEach(function (t, i) {
      var b = document.createElement("button");
      b.className = "mini-btn" + (i === 0 ? " primary" : "");
      b.textContent = t.name;
      b.addEventListener("click", function () {
        var text = t.gen({ answers: entry.answers, result: entry.r, scenario: { id: entry.scenarioId, name: entry.name } });
        document.getElementById("doc-text").value = text;
        listEl.querySelectorAll("button").forEach(function (x) { x.classList.toggle("primary", x === b); });
      });
      listEl.appendChild(b);
    });
    if (docs.length) listEl.querySelector("button").click();
    document.getElementById("doc-modal").classList.remove("hidden");
  });
  var docClose = document.getElementById("doc-close");
  if (docClose) docClose.addEventListener("click", function () { document.getElementById("doc-modal").classList.add("hidden"); });
  var docCopy = document.getElementById("doc-copy");
  if (docCopy) docCopy.addEventListener("click", function () {
    var ta = document.getElementById("doc-text");
    ta.select();
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value);
    else document.execCommand("copy");
    var b = this;
    b.innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已复制";
    setTimeout(function () { b.innerHTML = "<svg class=ico><use href=#i-copy></use></svg> 复制全文"; }, 1500);
  });

  /* ---------- 首次使用引导 ---------- */
  if (!localStorage.getItem("legal-first-run")) {
    document.getElementById("guide-modal").classList.remove("hidden");
  }
  var guideClose = document.getElementById("guide-close");
  if (guideClose) guideClose.addEventListener("click", function () {
    localStorage.setItem("legal-first-run", "1");
    document.getElementById("guide-modal").classList.add("hidden");
  });

  /* ---------- 模块装配 ---------- */
  window.LAWSEARCH.init();
  if (window.LIMITATION) window.LIMITATION.init();
  if (window.SKILLS) window.SKILLS.init();
  if (window.CLAIMS) window.CLAIMS.init();
  if (window.WORKSPACE) window.WORKSPACE.init();
  window.TOOLS.init();
  window.ONLINE.init();
  if (window.CASEIMPORT) window.CASEIMPORT.init();
  window.AI.init();
  window.AGENT.init();
  window.CONTRACT.init();
  window.GSEARCH.init();
})();
