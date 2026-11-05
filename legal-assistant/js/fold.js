/* =========================================================
 * fold.js —— 报告渐进式披露（渐进披露 + 目录导航 + 打印兼容）
 * 对深度分析报告（.report-sec）与咨询结果卡（.result-section）
 * 做 DOM 级折叠处理：重内容默认折叠、标题可点、报告顶部目录导航。
 * 打印/导出前调 openAll(root) 强制展开，保证内容完整。
 * ========================================================= */
window.REPORTFOLD = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* 重内容区块（按标题文本匹配折叠）；轻量区（要素/定性/风险/争点/抗辩）保持展开 */
  var FOLD_BY_TITLE = [
    "相关法条", "参考案例", "请求事项参考", "程序建议", "案件时间线",
    "证据准备清单", "行动路径对比", "案件评估"
  ];
  var RESULT_FOLD = ["具体分析", "依据法条", "行动建议"];

  var delegated = false;
  function ensureDelegate() {
    if (delegated) return;
    delegated = true;
    document.addEventListener("click", function (e) {
      /* 区块标题点击：展开/折叠 */
      var t = e.target.closest ? e.target.closest(".sec-toggle") : null;
      if (t) {
        var sec = t.closest(".sec-fold");
        if (sec) sec.classList.toggle("sec-open");
        var arrow = t.querySelector(".sec-arrow");
        if (arrow) arrow.textContent = sec.classList.contains("sec-open") ? "▴ 收起" : "▾ 展开";
        return;
      }
      /* 目录按钮：滚动到区块并展开 */
      var toc = e.target.closest ? e.target.closest(".toc-btn") : null;
      if (toc) {
        var target = document.getElementById(toc.getAttribute("data-target"));
        if (target) {
          target.classList.add("sec-open");
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  }

  /* 把 .report-sec 中标题之后的所有兄弟节点包进 .sec-fold-body */
  function wrapBody(sec) {
    if (sec.querySelector(".sec-fold-body")) return;
    var title = sec.querySelector(".report-sec-title");
    if (!title) return;
    var body = document.createElement("div");
    body.className = "sec-fold-body";
    while (title.nextSibling) body.appendChild(title.nextSibling);
    sec.appendChild(body);
  }

  /* 深度分析报告：折叠重区块 + 顶部目录 */
  function apply(root) {
    if (!root) return;
    ensureDelegate();
    var secs = root.querySelectorAll(".report-sec");
    var tocItems = [];
    var seq = 0;
    secs.forEach(function (sec) {
      var titleEl = sec.querySelector(".report-sec-title");
      if (!titleEl) return;
      var titleText = (titleEl.textContent || "").trim();
      var secId = "repsec-" + (++seq);
      sec.setAttribute("id", secId);
      var shouldFold = FOLD_BY_TITLE.some(function (k) { return titleText.indexOf(k) > -1; });
      if (shouldFold) {
        wrapBody(sec);
        sec.classList.add("sec-fold");
        if (!titleEl.querySelector(".sec-arrow")) {
          var arrow = document.createElement("span");
          arrow.className = "sec-arrow";
          arrow.textContent = "▾ 展开";
          titleEl.appendChild(arrow);
        }
        titleEl.classList.add("sec-toggle");
      }
      tocItems.push({ id: secId, title: titleText, folded: shouldFold });
    });
    /* 顶部目录（有 2 个以上区块才生成） */
    if (tocItems.length >= 2 && !root.querySelector(".report-toc")) {
      var toc = document.createElement("div");
      toc.className = "report-toc";
      toc.innerHTML = '<div class="toc-title"><svg class=ico><use href=#i-list></use></svg> 报告目录</div><div class="toc-chips">' +
        tocItems.map(function (x) {
          return '<button class="mini-btn toc-btn" data-target="' + esc(x.id) + '">' + esc(x.title) + '</button>';
        }).join("") + '</div>';
      root.insertBefore(toc, root.firstChild);
    }
  }

  /* 咨询结果卡：具体分析/依据法条/行动建议 折叠为「展开分析详情」 */
  function applyResult(cardEl) {
    if (!cardEl) return;
    ensureDelegate();
    if (cardEl.querySelector(".result-fold-body")) return;   /* 已处理（历史恢复防重） */
    var sections = cardEl.querySelectorAll(".result-section");
    var heavy = [];
    sections.forEach(function (s) {
      var label = s.querySelector(".sec-label");
      var lt = label ? label.textContent.trim() : "";
      if (RESULT_FOLD.some(function (k) { return lt.indexOf(k) > -1; })) heavy.push(s);
    });
    if (heavy.length < 2) return;
    var body = document.createElement("div");
    body.className = "result-fold-body";
    var first = heavy[0];
    first.parentNode.insertBefore(body, first);
    heavy.forEach(function (s) { body.appendChild(s); });
    var toggle = document.createElement("button");
    toggle.className = "mini-btn result-fold-toggle";
    toggle.textContent = "▾ 展开分析详情";
    toggle.addEventListener("click", function () {
      var open = body.classList.toggle("result-open");
      toggle.textContent = open ? "▴ 收起分析详情" : "▾ 展开分析详情";
    });
    first.parentNode.insertBefore(toggle, first);
  }

  /* 打印/导出前：强制展开所有折叠（保证内容完整） */
  function openAll(root) {
    (root || document).querySelectorAll(".sec-fold").forEach(function (s) { s.classList.add("sec-open"); });
    (root || document).querySelectorAll(".result-fold-body").forEach(function (b) { b.classList.add("result-open"); });
  }

  return { apply: apply, applyResult: applyResult, openAll: openAll };
})();
