/* =========================================================
 * 主逻辑 main.js —— 路由、聊天渲染、对话历史、案例/FAQ渲染、模块装配
 * ========================================================= */
(function () {
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- 视图切换 ---------- */
  var views = ["consult", "agent", "contract", "laws", "tools", "cases", "faq"];
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
    scrollDown();
  }

  function appendBot(html) {
    var div = document.createElement("div");
    div.className = "msg bot";
    div.innerHTML = '<div class="avatar"><svg class=ico><use href=#i-laws></use></svg></div><div class="bubble">' + html + '</div>';
    box.appendChild(div);
    recordMsg({ who: "bot", html: html });
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
    div.innerHTML = '<div class="avatar"><svg class=ico><use href=#i-laws></use></svg></div><div class="bubble">' + inner + '</div>';
    box.appendChild(div);
    recordMsg({ who: "bot", kind: "question", html: inner });
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
          '<button class="mini-btn ev-btn" data-rid="' + rid + '"><svg class=ico><use href=#i-contract></use></svg> 证据清单</button>' +
          '<button class="mini-btn fb-like" data-rid="' + rid + '" title="有帮助"><svg class=ico><use href=#i-tup></use></svg></button>' +
          '<button class="mini-btn fb-bad" data-rid="' + rid + '" title="需改进"><svg class=ico><use href=#i-tdn></use></svg></button>' +
          '<button class="mini-btn print-card-btn" data-rid="' + rid + '" title="打印此分析"><svg class=ico><use href=#i-print></use></svg></button>' +
          '<span class="result-disclaimer">仅供参考，不构成法律意见 · 完整声明见页脚</span>' +
        '</div>' +
      '</div>';
    var div = document.createElement("div");
    div.className = "msg bot";
    div.innerHTML = '<div class="avatar"><svg class=ico><use href=#i-laws></use></svg></div><div class="bubble">' + html + '</div>';
    box.appendChild(div);
    recordMsg({ who: "bot", kind: "result", html: html, data: { name: scenario.name, domain: scenario.domain, r: r, answers: answers || {}, scenarioId: scenario.id, transcript: transcript || [] } });

    div.querySelectorAll(".law-chip").forEach(bindLawChip);
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

  function bindRelLinks(div) {
    div.querySelectorAll(".rel-link").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.classList.contains("qf-btn")) return;   /* 快捷追问由全局委托处理（data-rel 为空会误跳案例页） */
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
  if (micBtn && !SR) { micBtn.classList.add("hidden"); }
  else if (micBtn) {
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
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      window.CONSULT.start(input.value);
      input.value = "";
      delete input.dataset.base;
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
    return "您好！我是<b>法律咨询助手</b>。<br>" +
      "请描述您遇到的问题，我会澄清关键事实后给出<b>分析 + 法条 + 行动建议</b>；也可从左侧场景直接开始。";
  }

  /* 历史消息还原渲染（结果卡的 AI 解读按钮 / 法条跳转重新绑定） */
  function renderMessage(m) {
    var div = document.createElement("div");
    if (m.who === "user") {
      div.className = "msg user";
      div.innerHTML = '<div class="bubble">' + m.html + '</div>';
    } else {
      var avatar = m.who === "ai" ? "<svg class=ico><use href=#i-ai></use></svg>" : "<svg class=ico><use href=#i-laws></use></svg>";
      div.className = "msg bot";
      div.innerHTML = '<div class="avatar">' + avatar + '</div><div class="bubble">' + m.html + '</div>';
    }
    box.appendChild(div);
    if (m.kind === "result" && m.data) {
      window.AI_RESULTS = window.AI_RESULTS || [];
      var rid = window.AI_RESULTS.length;
      window.AI_RESULTS.push({ name: m.data.name, domain: m.data.domain, r: m.data.r, answers: m.data.answers || {}, scenarioId: m.data.scenarioId, transcript: m.data.transcript || [] });
      var btn = div.querySelector(".result-ai-btn");
      if (btn) btn.setAttribute("data-rid", rid);
      div.querySelectorAll(".law-chip").forEach(bindLawChip);
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
      appendBot(welcomeHtml());
    }
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
    if (cur && cur.messages.length) cur.messages.forEach(renderMessage);
    else {
      if (!cur) window.CHATHISTORY.newSession(false);
      appendBot(welcomeHtml());
    }
    window.AI.resetHistory && window.AI.resetHistory();
  }

  function fmtTime(ts) {
    var d = new Date(ts), now = new Date();
    var hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    if (d.toDateString() === now.toDateString()) return hm;
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + "-" + d.getDate() + " " + hm;
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
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
    var items = window.CHATHISTORY.list(sessionView === "archived");
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML = '<div class="session-empty">' + (sessionView === "archived" ? "暂无归档对话" : "暂无历史对话") + '</div>';
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
        loadCurrentIntoBox();
        window.AI.resetHistory && window.AI.resetHistory();
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

  var newChatBtn = document.getElementById("new-chat");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", function () {
      window.CHATHISTORY.newSession();
      box.innerHTML = "";
      window.AI.resetHistory && window.AI.resetHistory();
      appendBot(welcomeHtml());
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

  /* ---------- 知识讲堂 FAQ ---------- */
  var faqBox = document.getElementById("faq-list");
  if (faqBox) {
    window.DomainRegistry.ids().forEach(function (dom) {
      var faqs = window.FAQ.filter(function (f) { return f.domain === dom; });
      if (!faqs.length) return;
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
        });
        group.appendChild(item);
      });
      faqBox.appendChild(group);
    });
  }

  /* ---------- 启动：恢复当前会话或开新会话 ---------- */
  var cur = window.CHATHISTORY.current();
  if (cur && cur.messages.length) {
    cur.messages.forEach(renderMessage);
  } else {
    if (!cur) window.CHATHISTORY.newSession(false);
    appendBot(welcomeHtml());
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
    document.getElementById("doc-list").innerHTML = "";
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
    var pBtn = e.target.closest ? e.target.closest(".print-card-btn") : null;
    if (pBtn) {
      var card = pBtn.closest(".result-card");
      if (card) window.printEl(card);
      return;
    }
    var fbLike = e.target.closest ? e.target.closest(".fb-like") : null;
    var fbBad = e.target.closest ? e.target.closest(".fb-bad") : null;
    if (fbLike || fbBad) return;   /* 反馈由 bindFeedback 的专属监听处理 */
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
  window.TOOLS.init();
  window.ONLINE.init();
  window.AI.init();
  window.AGENT.init();
  window.CONTRACT.init();
  window.GSEARCH.init();
})();
