/* =========================================================
 * 全局搜索 gsearch.js —— 一处搜索 法条 / 讲堂 / 场景 / 案例
 * ========================================================= */
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function open() {
    document.getElementById("gsearch-modal").classList.remove("hidden");
    var inp = document.getElementById("gsearch-input");
    inp.value = "";
    document.getElementById("gsearch-results").innerHTML = '<div class="empty dim">输入关键词，同时搜索法条、讲堂问答、咨询场景与案例。</div>';
    setTimeout(function () { inp.focus(); }, 50);
  }
  function close() { document.getElementById("gsearch-modal").classList.add("hidden"); }

  function hit(text, q) { return String(text || "").indexOf(q) > -1; }

  function search(q) {
    var out = [];
    /* 别名扩展（v3.4.9）：命中别名时，规范词任一命中即计入（如 N+1 → 代通知金） */
    var aliasList = window.LAW_ALIAS ? (LAW_ALIAS[String(q).trim().toLowerCase()] || []) : [];
    var qs = [q].concat(aliasList);
    window.DomainRegistry.collect("laws").forEach(function (l) {
      var hitAny = qs.some(function (qq) {
        return hit(l.title, qq) || hit(l.article, qq) || hit(l.text, qq) || (l.tags || []).some(function (t) { return hit(t, qq); });
      });
      if (hitAny)
        out.push({ g: "法条", label: l.lawShort + " " + l.article + " " + l.title, sub: l.text.slice(0, 80), act: function () {
          window.APP.switchView("laws");
          document.getElementById("law-search-input").value = l.title;
          document.getElementById("law-search-btn").click();
        } });
    });
    window.FAQ.forEach(function (f) {
      if (hit(f.q, q) || hit(f.a, q)) out.push({ g: "讲堂", label: f.q, sub: String(f.a).replace(/<[^>]+>/g, "").slice(0, 80), act: function () {
        window.APP.switchView("faq");
        setTimeout(function () {
          document.querySelectorAll("#faq-list .faq-item").forEach(function (item) {
            if (item.querySelector(".faq-q").textContent.indexOf(f.q) > -1) {
              if (!item.classList.contains("open")) item.querySelector(".faq-q").click();
              item.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          });
        }, 100);
      } });
    });
    window.SCENARIOS.forEach(function (s) {
      if (hit(s.name, q) || hit(s.desc, q) || (s.keywords || []).some(function (k) { return hit(k, q); }))
        out.push({ g: "咨询场景", label: s.name, sub: s.desc, act: function () {
          close();
          window.CONSULT.quickStart(s.id);
        } });
    });
    window.GUIDING.forEach(function (g) {
      if (hit(g.title, q) || hit(g.gist, q)) out.push({ g: "指导性案例", label: g.no + " " + g.title, sub: g.gist.slice(0, 80), act: function () {
        close();
        window.APP.switchView("cases");
        document.getElementById("case-tab-guiding").click();
      } });
    });
    window.CASES.forEach(function (c) {
      if (hit(c.title, q) || hit(c.facts, q)) out.push({ g: "典型案例", label: c.title, sub: c.facts.slice(0, 80), act: function () {
        close();
        window.APP.switchView("cases");
        document.getElementById("case-tab-builtin").click();
      } });
    });
    /* 本机数据：报告存档 + 案例收藏（点击直达对应查看界面） */
    try {
      var reps = JSON.parse(localStorage.getItem("legal-agent-reports") || "[]");
      reps.forEach(function (r) {
        if (hit(r.q, q) || hit(r.text, q)) out.push({ g: "报告存档", label: (r.q || "").slice(0, 50) || "未命名案情", sub: "存档：" + (r.date || "").slice(0, 10) + " · " + String(r.text || "").slice(0, 70), act: function () {
          close();
          window.APP.switchView("agent");
          var arch = document.getElementById("agent-archive");
          if (arch) arch.click();
        } });
      });
      var imps = JSON.parse(localStorage.getItem("legal-case-imports") || "[]");
      imps.forEach(function (c) {
        if (hit(c.title, q) || hit(c.raw, q) || hit(c.caseNo, q)) out.push({ g: "案例收藏", label: c.title, sub: (c.caseNo ? "案号 " + c.caseNo + " · " : "") + String(c.holding || c.raw || "").slice(0, 70), act: function () {
          close();
          window.APP.switchView("cases");
          setTimeout(function () {
            var card = document.querySelector('#case-import-list .ci-card[data-id="' + c.id + '"]');
            if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 150);
        } });
      });
      var calcs = JSON.parse(localStorage.getItem("legal-calc-history") || "[]");
      calcs.forEach(function (x) {
        if (hit(x.name, q) || hit(x.out, q)) out.push({ g: "计算历史", label: x.name, sub: String(x.out || "").slice(0, 70), act: function () {
          close();
          window.APP.switchView("tools");
          var hb = document.getElementById("calc-history-btn");
          if (hb) hb.click();
        } });
      });
    } catch (e) { /* 本机数据读取失败不影响公共搜索 */ }
    return out;
  }

  function render(q) {
    var box = document.getElementById("gsearch-results");
    var results = search(q);
    if (!results.length) {
      box.innerHTML = '<div class="empty">没有找到与「' + esc(q) + '」相关的内容，换个关键词试试。</div>';
      return;
    }
    var html = "";
    var seen = {};
    results.slice(0, 24).forEach(function (r, i) {
      if (!seen[r.g]) { seen[r.g] = true; html += '<div class="gs-group">' + r.g + '</div>'; }
      html += '<button class="gs-item" data-i="' + i + '"><div class="gs-label">' + esc(r.label) + '</div><div class="gs-sub">' + esc(r.sub) + '</div></button>';
    });
    box.innerHTML = html;
    box.querySelectorAll(".gs-item").forEach(function (el) {
      el.addEventListener("click", function () { results[parseInt(el.getAttribute("data-i"), 10)].act(); close(); });
    });
  }

  function init() {
    var btn = document.getElementById("gsearch-btn");
    if (!btn) return;
    btn.addEventListener("click", open);
    document.getElementById("gsearch-close").addEventListener("click", close);
    document.querySelector("#gsearch-modal .modal-mask").addEventListener("click", close);
    var inp = document.getElementById("gsearch-input");
    inp.addEventListener("input", function () {
      var q = inp.value.trim();
      if (q.length < 2) return;
      clearTimeout(inp._t);
      inp._t = setTimeout(function () { render(q); }, 150);
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") render(inp.value.trim()); });
  }

  window.GSEARCH = { init: init };
})();
