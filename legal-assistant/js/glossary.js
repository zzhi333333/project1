/* =========================================================
 * glossary.js —— 白话术语卡（30 个高频法律术语）
 * 弹窗可搜索；供深度分析报告与咨询结果卡一键打开。
 * 解释为通俗化表述，不构成法律定义，以权威解释为准。
 * ========================================================= */
window.GLOSSARY = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var TERMS = [
    { t: "N", en: "Severance pay: one month's wage per full year of service", p: "经济补偿金的俗称：工作每满 1 年给 1 个月工资，半年以上不满 1 年算 1 年、不满半年算半个月。" },
    { t: "N+1", en: "Severance plus payment in lieu of notice (PILON)", p: "N 之外再多给 1 个月工资（代通知金）——适用于单位无过失辞退但没有提前 30 天书面通知的情形。" },
    { t: "2N", en: "Double severance damages for unlawful termination", p: "违法解除赔偿金：单位没有合法理由辞退员工时，按 N 的 2 倍支付，不再另付代通知金。" },
    { t: "代通知金", en: "Payment in lieu of notice (PILON)", p: "单位按《劳动合同法》第 40 条解除时，没提前 30 天书面通知，就多付 1 个月工资作为代替。" },
    { t: "经济补偿", en: "Statutory severance on lawful termination/expiry", p: "合法解除/终止合同时给劳动者的补偿（即 N），法定情形才支付。" },
    { t: "赔偿金", en: "Damages for unlawful acts (e.g. double severance); distinct from statutory severance", p: "违法行为的赔偿，如违法解除的 2N，与经济补偿（N）性质不同、不可同时主张。" },
    { t: "二倍工资", en: "Double wage penalty for no written contract (capped at 11 months)", p: "用工超过 1 个月没签书面合同，单位要按月支付双倍工资（最多 11 个月）。" },
    { t: "社平工资", en: "Local average social wage (severance capped at 3x, max 12 years)", p: "当地上年度职工月平均工资。经济补偿超过其 3 倍的部分封顶（按 3 倍算、年限最多 12 年）。" },
    { t: "仲裁时效", en: "Arbitration limitation period: 1 year for labor disputes (wage claims exempt while employed)", p: "申请劳动仲裁的期限：1 年，从知道权利被侵害时起算；拖欠工资在职期间不受限。" },
    { t: "诉讼时效", en: "Limitation period for civil claims: 3 years, subject to suspension/interruption", p: "向法院起诉的普通期限：3 年，从知道或应当知道权利受损及义务人时起算，可中止中断。" },
    { t: "除斥期间", en: "Peremptory period - a fixed statutory window that cannot be suspended or interrupted (right extinguishes on expiry)", p: "法律规定的『固定不变』期限（如撤销权 1 年），过了权利直接消灭，不像时效可以中断。" },
    { t: "一裁终局", en: "Final and binding arbitral award (employer cannot sue; employee may)", p: "小额劳动争议（不超过当地月最低工资 12 个月金额）仲裁裁决对单位是终局的，不能起诉；劳动者仍可起诉。" },
    { t: "举证责任", en: "Burden of proof - he who asserts must prove; reversed in some cases (e.g. employer proves legality of dismissal)", p: "『谁主张谁举证』；特殊情形倒置，如单位辞退员工的合法性由单位举证。" },
    { t: "劳动关系", en: "Employment relationship (established by actual work under management, regardless of contract)", p: "员工接受单位管理、干单位安排的有报酬的劳动所形成的关系——不以签没签合同为准。" },
    { t: "事实劳动关系", en: "De facto employment relationship (no written contract)", p: "没签书面合同但实际存在用工管理的事实状态，同样受劳动法保护。" },
    { t: "无固定期限合同", en: "Open-ended (indefinite-term) labor contract", p: "没有约定截止日期的劳动合同；连续工作满 10 年或连签两次固定合同后续签的，员工提出即应签订。" },
    { t: "竞业限制", en: "Non-compete restriction (max 2 years post-termination)", p: "离职后一定期限内（≤2年）不得到竞争对手从事同业；单位须按月给补偿，否则员工可解除。" },
    { t: "竞业限制经济补偿", en: "Non-compete consideration: paid monthly after termination; default 30% of prior 12-month average wage, floor at minimum wage", p: "竞业限制期间单位按月支付给离职员工的补偿；未约定标准的按离职前 12 个月平均工资的 30% 且不低于最低工资。" },
    { t: "工伤认定", en: "Work-related injury determination (30 days by employer / 1 year by individual)", p: "社保部门对受伤是否属于工伤的行政确认；单位 30 日内、个人 1 年内申请。" },
    { t: "劳动能力鉴定", en: "Disability grade assessment (levels 1-10) determining benefits", p: "评伤残等级（1–10 级）的鉴定，等级直接决定赔偿项目与数额。" },
    { t: "停工留薪期", en: "Paid treatment period - wages and benefits unchanged (generally max 12 months)", p: "工伤治疗期间原工资福利待遇不变（一般不超过 12 个月）。" },
    { t: "财产保全", en: "Property preservation - court freeze/seizure of assets, usually with a bond", p: "起诉前或诉讼中请求法院查封/冻结对方财产，防止赢了官司拿不到钱；通常需提供担保。" },
    { t: "先予执行", en: "Advance enforcement before final judgment (wages, support, medical)", p: "案件还没审完，对追索劳动报酬、赡养费、医疗费等情形先裁定给付一部分。" },
    { t: "支付令", en: "Payment order - enforceable if debtor neither objects nor pays within 15 days", p: "债权人申请法院向债务人发出的限期还款命令；对方 15 日内不异议不履行即可申请强制执行。" },
    { t: "诉讼保全责任险", en: "Preservation bond - insurer guarantee replacing cash/property security", p: "用保险公司保函代替现金/房产做保全担保，费用约为保全金额的千分之一到三。" },
    { t: "举证期限", en: "Time limit for producing evidence; late evidence may be rejected", p: "法院指定的提交证据的截止时间，逾期举证可能不被采纳或被训诫罚款。" },
    { t: "本诉/反诉", en: "Claim / Counterclaim (tried together)", p: "被告在同一案件里反过来告原告，就是反诉；反诉与本诉一并审理。" },
    { t: "调解协议司法确认", en: "Judicial confirmation of mediation agreement - free, makes it enforceable", p: "人民调解达成的协议去法院『盖章确认』后，具有强制执行力（免费）。" },
    { t: "小额诉讼", en: "Small claims procedure - first instance final (no appeal)", p: "标的额较小的民事案件实行一审终审（不能上诉），审理更快捷。" },
    { t: "共同被告", en: "Joint defendants (e.g. company and its shareholders) sued together", p: "把多个责任方（如公司与其股东）列为同一案被告，便于一并追责。" }
  ];

  function open(keyword) {
    var old = document.getElementById("glossary-modal");
    if (old) old.remove();
    var modal = document.createElement("div");
    modal.id = "glossary-modal";
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:560px;width:94%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-book-open></use></svg> 白话术语卡</div>' +
        '<div class="modal-body" style="max-height:64vh;overflow-y:auto">' +
          '<input id="gl-search" type="text" placeholder="搜索术语…" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:8px 11px;margin-bottom:10px;background:var(--card);color:var(--ink);font-family:inherit">' +
          '<div id="gl-list"></div>' +
        '</div>' +
        '<div class="modal-foot"><button class="mini-btn" id="gl-close">关闭</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    var render = function (kw) {
      var list = TERMS.filter(function (x) {
        return !kw || x.t.indexOf(kw) > -1 || x.p.indexOf(kw) > -1;
      });
      document.getElementById("gl-list").innerHTML = list.length ? list.map(function (x) {
        return '<div class="gl-row"><b>' + esc(x.t) + (x.en ? ' <span class="gl-en">' + esc(x.en) + '</span>' : '') + '</b><span>' + esc(x.p) + '</span></div>';
      }).join("") : '<div class="empty dim">没有匹配「' + esc(kw) + '」的术语。</div>';
    };
    render(keyword || "");
    modal.querySelector("#gl-search").addEventListener("input", function () { render(this.value.trim()); });
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#gl-close").addEventListener("click", function () { modal.remove(); });
  }

  /* 术语卡入口按钮 HTML（报告/结果卡复用） */
  function btnHtml() {
    return '<button class="mini-btn glossary-btn"><svg class=ico><use href=#i-book-open></use></svg> 白话术语卡</button>';
  }
  function bind(container) {
    if (!container) return;
    var b = container.querySelector(".glossary-btn");
    if (b && !b.getAttribute("data-bound")) {
      b.setAttribute("data-bound", "1");
      b.addEventListener("click", function () { open(); });
    }
  }

  /* 报告正文术语高亮：命中白话卡术语的文本包一层可点标记，点击弹卡（随读随解）。
     单容器上限 60 处；跳过按钮/输入框/已高亮元素；纯 ASCII 术语（N/2N/LPR）按词边界匹配；
     长术语优先（避免 N+1 里的 N 被单独命中） */
  var HL_SKIP = { SCRIPT: 1, STYLE: 1, BUTTON: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, SVG: 1 };
  var HL_MAX = 60;
  function tEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function hlAccept(node) {
    var p = node.parentNode;
    if (!p || HL_SKIP[p.nodeName]) return false;
    return !(p.classList && p.classList.contains && (p.classList.contains("gl-hl") || p.classList.contains("glossary-btn")));
  }
  function highlight(root) {
    if (!root || !TERMS.length || !document.createTreeWalker) return 0;
    var res = [];
    TERMS.forEach(function (x) {
      if (!x.t) return;
      if (/^[A-Za-z0-9%]+$/.test(x.t)) res.push({ t: x.t, re: new RegExp("(^|[^A-Za-z0-9])(" + tEsc(x.t) + ")(?=[^A-Za-z0-9]|$)", "g") });
      else if (x.t.length >= 2) res.push({ t: x.t, re: new RegExp("(" + tEsc(x.t) + ")", "g") });
    });
    if (!res.length) return 0;
    var walker = document.createTreeWalker(root, 4, null, false);   /* 4 = SHOW_TEXT */
    var nodes = [], n = walker.nextNode();
    while (n) { nodes.push(n); n = walker.nextNode(); }
    var count = 0;
    nodes.forEach(function (node) {
      var cur = node;
      while (cur && count < HL_MAX && hlAccept(cur)) {
        var hit = null;
        for (var i = 0; i < res.length; i++) {
          var m = res[i].re.exec(cur.nodeValue);
          res[i].re.lastIndex = 0;
          if (!m) continue;
          /* ascii 带前导边界组：m[1]=前导字符，m[2]=术语本体；中文只有 m[1]=术语本体 */
          var start = m[2] ? m.index + m[1].length : m.index;
          if (!hit || start < hit.start) hit = { start: start, t: res[i].t };
        }
        if (!hit) break;
        var a = cur.splitText(hit.start);       /* a = 命中及之后 */
        var b = a.splitText(hit.t.length);      /* a = 命中本体，b = 其后剩余 */
        var span = document.createElement("span");
        span.className = "gl-hl";
        span.setAttribute("data-gl", hit.t);
        span.title = "点击查看白话解释";
        span.textContent = a.nodeValue;
        a.parentNode.replaceChild(span, a);
        cur = b;
        count++;
      }
    });
    return count;
  }
  /* 事件委托：任意容器内 .gl-hl 点击 → 弹术语卡（绑定一次，全局生效） */
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest(".gl-hl") : null;
    if (el) open(el.getAttribute("data-gl") || "");
  });

  return { open: open, TERMS: TERMS, btnHtml: btnHtml, bind: bind, highlight: highlight };
})();
