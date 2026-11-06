/* =========================================================
 * claims.js —— 一揽子请求与证据（v3.2 深化四批次，同源）
 * 批次一：多请求组合试算（勾选→逐项计算式→合计）
 * 批次二：证据链矩阵（每请求项→所需证据→已有/缺失勾选→缺口清单）
 * 批次三：程序流程地图（劳动仲裁/民诉一审全流程节点模板→铺时间线→入日历/工作区）
 * 批次四：和解谈判参考（锚点/自设区间/风险因素定性——明示非结果预测）
 * 红线：金额均为规则化试算以官方口径为准；和解区间为谈判结构化参考，不构成结果预测。
 * ========================================================= */
window.CLAIMS = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function fmt(n) { var v = parseFloat(n); return isFinite(v) ? v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "0"; }
  function $(id) { return document.getElementById(id); }

  /* ---------------- 批次一+二：请求项（计算式 + 所需证据） ---------------- */
  var ITEMS = [
    { id: "severance2n", name: "违法解除赔偿金（2N）", law: "《劳动合同法》第87条、第47条",
      params: [{ k: "salary", label: "离职前12个月平均月工资（元）" }, { k: "years", label: "工作年限（年，≥6个月按1年、不足6个月按0.5）" }],
      calc: function (p) { return round2((parseFloat(p.salary) || 0) * (parseFloat(p.years) || 0) * 2); },
      formula: function (p) { return fmt(p.salary) + " × " + p.years + " 年 × 2"; },
      evidence: ["辞退通知/解除证明（或载明解除的聊天记录、录音）", "劳动关系证明（合同/工牌/入职记录）", "离职前12个月工资流水（含奖金津贴）", "当地社平工资数据（工资超3倍封顶时用）"] },
    { id: "severanceN", name: "经济补偿金（N）", law: "《劳动合同法》第46条、第47条",
      params: [{ k: "salary", label: "离职前12个月平均月工资（元）" }, { k: "years", label: "工作年限（年）" }],
      calc: function (p) { return round2((parseFloat(p.salary) || 0) * (parseFloat(p.years) || 0)); },
      formula: function (p) { return fmt(p.salary) + " × " + p.years + " 年"; },
      evidence: ["解除情形证明（协商一致协议/裁员通知/到期不续签证明）", "劳动关系证明", "离职前12个月工资流水"] },
    { id: "notice", name: "代通知金（1个月工资）", law: "《劳动合同法》第40条",
      params: [{ k: "salary", label: "上月工资（元）" }],
      calc: function (p) { return round2(parseFloat(p.salary) || 0); },
      formula: function (p) { return fmt(p.salary) + "（未提前30日书面通知时另付1个月）"; },
      evidence: ["解除通知及送达记录（证明未提前30日）", "上月工资凭证"] },
    { id: "doublewage", name: "未签书面合同二倍工资差额", law: "《劳动合同法》第82条",
      params: [{ k: "salary", label: "月工资（元）" }, { k: "months", label: "未签合同月数（上限11）" }],
      calc: function (p) { return round2((parseFloat(p.salary) || 0) * Math.min(parseFloat(p.months) || 0, 11)); },
      formula: function (p) { return fmt(p.salary) + " × " + Math.min(parseFloat(p.months) || 0, 11) + " 个月（上限11）"; },
      evidence: ["工资流水与入职时间证明（确定未签期间）", "催签合同沟通记录（证明未签原因在单位）"] },
    { id: "arrears", name: "拖欠工资", law: "《劳动合同法》第30条",
      params: [{ k: "amount", label: "拖欠合计（元）" }],
      calc: function (p) { return round2(parseFloat(p.amount) || 0); },
      formula: function (p) { return "欠付合计 " + fmt(p.amount); },
      evidence: ["工资条/银行流水对比（应发与实发）", "欠薪沟通记录或欠条"] },
    { id: "overtime", name: "加班费", law: "《劳动法》第44条",
      params: [{ k: "salary", label: "月工资（元）" }, { k: "wd", label: "工作日延时（小时）" }, { k: "we", label: "休息日（小时，未补休）" }, { k: "hd", label: "法定节假日（小时）" }],
      calc: function (p) {
        var h = (parseFloat(p.salary) || 0) / 21.75 / 8;
        return round2(h * ((parseFloat(p.wd) || 0) * 1.5 + (parseFloat(p.we) || 0) * 2 + (parseFloat(p.hd) || 0) * 3));
      },
      formula: function (p) { return "时薪 " + fmt((parseFloat(p.salary) || 0) / 21.75 / 8) + "；" + (p.wd || 0) + "h×150% + " + (p.we || 0) + "h×200% + " + (p.hd || 0) + "h×300%"; },
      evidence: ["考勤记录/打卡数据", "加班审批或工作沟通记录（证明加班事实）", "工资单（证明未足额支付）"] },
    { id: "annual", name: "未休年假工资（另付200%）", law: "《职工带薪年休假条例》第5条",
      params: [{ k: "salary", label: "月工资（元）" }, { k: "days", label: "未休天数" }],
      calc: function (p) { return round2((parseFloat(p.salary) || 0) / 21.75 * (parseFloat(p.days) || 0) * 2); },
      formula: function (p) { return fmt(p.salary) + " ÷ 21.75 × " + (p.days || 0) + " 天 × 200%"; },
      evidence: ["累计工龄证明（社保记录，定档5/10/15天）", "考勤与年假申请记录（证明未休且非本人放弃）"] },
    { id: "social", name: "未缴/漏缴社保（补缴请求）", law: "《社会保险法》第63条",
      params: [{ k: "salary", label: "月平均工资（元）" }, { k: "months", label: "未缴月数" }],
      calc: function (p) { return round2((parseFloat(p.salary) || 0) * 0.3 * (parseFloat(p.months) || 0)); },
      formula: function (p) { return "单位承担部分约 30% × " + fmt(p.salary) + " × " + (p.months || 0) + " 个月（补缴以社保核定为准，此处仅供规模估算）"; },
      evidence: ["社保缴费记录查询截图（显示断缴/漏缴期间）", "劳动关系与工资证明（核定基数）"] }
  ];

  /* ---------------- 批次三：程序流程节点模板 ----------------
   * stage: 起点之后依次铺开；dur: 标准期限（日）供参考；act: 该节点要办的事 */
  var FLOWS = {
    arb: { name: "劳动仲裁全流程", start: "尚未申请仲裁", nodes: [
      { n: "提交仲裁申请书", dur: 0, act: "准备申请书（可用本工具生成）+ 身份/劳动关系证据复印件，向用人单位所在地或劳动合同履行地仲裁委提交" },
      { n: "受理决定", dur: 5, act: "仲裁委收到申请后 5 日内决定是否受理；不予受理的可就该事项直接起诉" },
      { n: "答辩与举证", dur: 10, act: "被申请人收到申请副本后 10 日内提交答辩书和证据；申请人可在此阶段补充证据" },
      { n: "开庭审理", dur: 45, act: "仲裁委应在受理后 45 日内审结（案情复杂可延长 15 日）；庭前整理证据原件、备好计算明细" },
      { n: "领取裁决", dur: 0, act: "裁决书送达双方；一裁终局案件（小额/标准明确）单位仅能申请撤裁，劳动者仍可起诉" },
      { n: "不服起诉（15日）", dur: 15, act: "任何一方不服的，收到裁决书 15 日内向法院起诉；期满不起诉则裁决生效" },
      { n: "申请强制执行（2年）", dur: 730, act: "生效后对方不履行：向法院申请强制执行（网络查控/限高/失信）" }
    ] },
    lit1: { name: "民事诉讼一审流程", start: "准备起诉", nodes: [
      { n: "立案（起诉状+证据）", dur: 0, act: "向有管辖权法院递交起诉状与证据副本；符合条件的 7 日内立案并通知交费" },
      { n: "答辩期", dur: 15, act: "被告收到起诉状副本 15 日内答辩；可同时提出管辖异议" },
      { n: "举证期限", dur: 30, act: "法院指定举证期限（普通程序通常不少于15日）；期限内提交全部证据原件" },
      { n: "开庭审理", dur: 90, act: "普通程序 6 个月内审结（简易程序 3 个月）；庭审焦点：事实调查→举证质证→辩论" },
      { n: "领取判决", dur: 0, act: "判决书送达；当庭宣判的 5 日内发送判决书" },
      { n: "上诉期（15日）", dur: 15, act: "不服判决的，送达之日起 15 日内上诉（裁定 10 日）" },
      { n: "申请强制执行（2年）", dur: 730, act: "生效后 2 年内向第一审法院申请执行" }
    ] }
  };

  /* ---------------- 弹层 UI（三标签） ---------------- */
  var tab = "calc";

  function renderCalc() {
    var items = ITEMS.map(function (it, i) {
      return '<div class="arb-item" data-i="' + i + '" style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px">' +
        '<label class="arb-check" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox"> <span><b>' + esc(it.name) + '</b><br><span class="arb-law dim" style="font-size:11.5px">' + esc(it.law) + '</span></span></label>' +
        '<div class="arb-params" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0 0">' + it.params.map(function (p) {
          return '<label style="font-size:12.5px;display:flex;flex-direction:column;gap:2px">' + esc(p.label) + '<input class="cl-in" data-k="' + p.k + '" type="number" min="0" inputmode="decimal" placeholder="0" style="padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)"></label>';
        }).join("") + '</div>' +
        '<div class="cl-sum" style="font-size:12px;color:var(--primary);margin-top:6px"></div>' +
        /* 批次二：证据矩阵（勾选请求项后显示） */
        '<div class="cl-ev" style="display:none;margin-top:8px;border-top:1px dashed var(--line);padding-top:8px">' +
          '<b style="font-size:12px">该请求所需证据（勾选已持有的）：</b>' +
          it.evidence.map(function (e, j) {
            return '<label style="display:flex;gap:6px;align-items:flex-start;font-size:12px;margin:4px 0"><input type="checkbox" class="cl-ev-has" data-j="' + j + '"> <span>' + esc(e) + '</span></label>';
          }).join("") +
          '<div class="cl-gap" style="font-size:11.5px;color:var(--warn,#b45309);margin-top:4px"></div>' +
        '</div>' +
      '</div>';
    }).join("");
    return '<div class="cl-tab-body" data-tab="calc">' + items +
      '<div class="cl-total" id="cl-total" style="position:sticky;bottom:0;background:var(--card);border-top:2px solid var(--primary);padding:10px;font-weight:600"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
        '<button class="mini-btn primary" id="cl-copy"><svg class=ico><use href=#i-copy></use></svg> 复制清单</button>' +
        '<button class="mini-btn" id="cl-to-ws"><svg class=ico><use href=#i-box></use></svg> 存入案件工作区</button>' +
        '<button class="mini-btn" id="cl-to-settle"><svg class=ico><use href=#i-chart></use></svg> 生成和解参考</button>' +
      '</div>' +
      '<div class="calc-note">金额为规则化试算，以仲裁委/法院认定与官方最新口径为准；社平3倍封顶等特殊规则请人工复核。</div></div>';
  }

  function renderFlow() {
    var flows = Object.keys(FLOWS).map(function (k) {
      var f = FLOWS[k];
      return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px">' +
        '<b>' + esc(f.name) + '</b><span class="dim" style="font-size:12px">（从「' + esc(f.start) + '」起）</span>' +
        '<div style="margin:8px 0 4px;font-size:12.5px">已进行到第几步：<select class="fl-from" data-k="' + k + '"><option value="0">尚未开始</option>' +
          f.nodes.map(function (n, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + ". " + esc(n.n) + '（已完成）</option>'; }).join("") + '</select></div>' +
        '<div class="fl-nodes" style="font-size:12.5px;color:var(--ink-2)"></div>' +
        '<button class="mini-btn fl-add" data-k="' + k + '" style="margin-top:8px"><svg class=ico><use href=#i-calendar></use></svg> 全部节点加入合规日历</button>' +
      '</div>';
    }).join("");
    return '<div class="cl-tab-body" data-tab="flow">' + flows +
      '<div class="calc-note">期限为法定/常见标准的天数参考（多数自送达日起算，遇节假日顺延）；具体时限以受理机构通知为准，加入日历后可按实际日期调整。</div></div>';
  }

  function renderSettle() {
    return '<div class="cl-tab-body" data-tab="settle">' +
      '<div style="font-size:13px;line-height:1.8;border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px">' +
        '<b>和解谈判参考生成器</b><br>基于请求试算合计，结构化你的谈判方案。<span style="color:var(--warn,#b45309)">⚠ 本工具仅做谈判要素的结构化整理，不预测案件结果。</span></div>' +
      '<label style="font-size:12.5px;display:block;margin-bottom:6px">请求合计（可从「请求试算」带入）<input id="st-total" type="number" min="0" inputmode="decimal" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)" placeholder="如 98300"></label>' +
      '<label style="font-size:12.5px;display:block;margin-bottom:6px">心理底线（可接受的最少金额）<input id="st-floor" type="number" min="0" inputmode="decimal" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)" placeholder="如 60000"></label>' +
      '<div style="font-size:12.5px;margin:8px 0">让步考量因素（勾选适用项）：</div>' +
      [["时效或证据有缺口，败诉风险较高"], ["希望快速回款，避免漫长程序"], ["仍需该单位出具离职证明/背景调查配合"], ["诉讼成本（受理费/时间/精力）不小"], ["对方一次性付款能力有限"]].map(function (f, i) {
        return '<label style="display:flex;gap:6px;font-size:12.5px;margin:4px 0"><input type="checkbox" class="st-f" value="' + i + '"> ' + f[0] + '</label>';
      }).join("") +
      '<button class="mini-btn primary" id="st-gen" style="margin-top:10px">生成和解参考卡</button>' +
      '<div id="st-out" style="margin-top:10px"></div>' +
      '<div style="margin-top:12px"><b style="font-size:13px">配套文书</b>' +
        '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">' +
          '<button class="mini-btn" id="st-agreement"><svg class=ico><use href=#i-file></use></svg> 和解协议书模板</button>' +
          '<button class="mini-btn" id="st-defense"><svg class=ico><use href=#i-file></use></svg> 劳动仲裁答辩书（被申请人视角）</button>' +
        '</div></div>' +
      '<div class="calc-note">和解金额由双方协商确定；签署前建议咨询执业律师审查条款（尤其「放弃其他请求」的范围）。</div></div>';
  }

  function openModal() {
    var old = $("claims-modal"); if (old) { old.remove(); return; }
    var modal = document.createElement("div");
    modal.id = "claims-modal";
    modal.className = "modal";
    modal.innerHTML = '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:680px;width:94%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-list></use></svg> 一揽子请求与证据</div>' +
        '<div class="modal-body" style="max-height:60vh;overflow-y:auto">' +
          '<div class="chips" style="margin-bottom:10px">' +
            '<button class="filter-chip cl-tab-btn active" data-t="calc">请求试算 + 证据矩阵</button>' +
            '<button class="filter-chip cl-tab-btn" data-t="flow">程序流程地图</button>' +
            '<button class="filter-chip cl-tab-btn" data-t="settle">和解参考</button>' +
          '</div>' +
          '<div id="cl-panel"></div>' +
        '</div>' +
        '<div class="modal-foot"><button id="cl-close">关闭</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    $("cl-close").addEventListener("click", function () { modal.remove(); });
    modal.querySelectorAll(".cl-tab-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        tab = b.getAttribute("data-t");
        modal.querySelectorAll(".cl-tab-btn").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        mount();
      });
    });
    mount();
  }

  function mount() {
    var panel = $("cl-panel");
    if (!panel) return;
    panel.innerHTML = tab === "calc" ? renderCalc() : tab === "flow" ? renderFlow() : renderSettle();
    if (tab === "calc") bindCalc();
    else if (tab === "flow") bindFlow();
    else bindSettle();
  }

  /* ---------- 批次一+二：试算与证据矩阵 ---------- */
  function collect() {
    var rows = [], total = 0;
    var panel = $("cl-panel");
    panel.querySelectorAll(".arb-item").forEach(function (item) {
      var it = ITEMS[parseInt(item.getAttribute("data-i"), 10)];
      var on = item.querySelector("input[type=checkbox]").checked;
      var params = {};
      item.querySelectorAll(".cl-in").forEach(function (inp) { params[inp.getAttribute("data-k")] = inp.value; });
      var filled = it.params.some(function (p) { return parseFloat(params[p.k]) > 0; });
      var evBox = item.querySelector(".cl-ev");
      evBox.style.display = on ? "" : "none";
      var has = [];
      if (on) evBox.querySelectorAll(".cl-ev-has").forEach(function (c) { if (c.checked) has.push(parseInt(c.getAttribute("data-j"), 10)); });
      var gaps = on ? it.evidence.map(function (e, j) { return has.indexOf(j) === -1 ? e : null; }).filter(Boolean) : [];
      var gapEl = evBox.querySelector(".cl-gap");
      gapEl.textContent = gaps.length ? "⚠ 还缺 " + gaps.length + " 项：" + gaps.join("；") : "✓ 证据齐备（记得开庭带原件）";
      item.querySelector(".cl-sum").textContent = on && filled ? "小计：" + fmt(it.calc(params)) + " 元　｜　" + it.formula(params) : "";
      if (on && filled) {
        var amt = it.calc(params);
        total += amt;
        rows.push({ name: it.name, amount: amt, formula: it.formula(params), law: it.law, gaps: gaps });
      }
    });
    var gapsAll = rows.reduce(function (a, r) { return a.concat(r.gaps); }, []);
    var uniqGaps = gapsAll.filter(function (g, i) { return gapsAll.indexOf(g) === i; });
    $("cl-total").innerHTML = "合计请求金额：<b>¥ " + fmt(total) + "</b>" +
      (rows.length ? "（" + rows.length + " 项" + (uniqGaps.length ? "，证据缺口 " + uniqGaps.length + " 项" : "，证据齐备") + "）" : "（勾选请求项并填写参数）");
    return { rows: rows, total: round2(total), gaps: uniqGaps };
  }
  function bindCalc() {
    var panel = $("cl-panel");
    panel.addEventListener("input", collect);
    panel.addEventListener("change", collect);
    collect();
    $("cl-copy").addEventListener("click", function () {
      var c = collect();
      var text = "劳动仲裁请求清单\n生成日期：" + new Date().toLocaleDateString("zh-CN") + "\n";
      c.rows.forEach(function (r, i) {
        text += "\n" + (i + 1) + ". " + r.name + "：" + fmt(r.amount) + " 元\n   计算式：" + r.formula + "\n   依据：" + r.law + "\n";
      });
      text += "\n合计：人民币 " + fmt(c.total) + " 元";
      if (c.gaps.length) text += "\n\n证据缺口（开庭前补齐）：\n" + c.gaps.map(function (g) { return "- " + g; }).join("\n");
      text += "\n\n说明：规则化试算，以官方最新口径与仲裁认定为准。";
      copy(text);
      var b = $("cl-copy"); b.innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已复制";
      setTimeout(function () { if ($("cl-copy")) $("cl-copy").innerHTML = "<svg class=ico><use href=#i-copy></use></svg> 复制清单"; }, 1600);
    });
    $("cl-to-ws").addEventListener("click", function () {
      var c = collect();
      if (!window.WORKSPACE || !window.WORKSPACE.current()) { hint($("cl-to-ws"), "先在工具页激活案件"); return; }
      if (!c.rows.length) { hint($("cl-to-ws"), "请先勾选并填写请求项"); return; }
      window.WORKSPACE.attach("docs", { name: "仲裁请求清单（" + fmt(c.total) + " 元）", date: new Date().toISOString().slice(0, 10), draft: c.rows.map(function (r, i) { return (i + 1) + ". " + r.name + "：" + fmt(r.amount); }).join("；") });
      c.gaps.forEach(function (g) { window.WORKSPACE.addNote("补证据：" + g); });
      hint($("cl-to-ws"), "已存入（清单+缺口待办）");
    });
    $("cl-to-settle").addEventListener("click", function () {
      var c = collect();
      tab = "settle";
      var modal = $("claims-modal");
      modal.querySelectorAll(".cl-tab-btn").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-t") === "settle"); });
      mount();
      var t = $("st-total"); if (t && c.total) t.value = c.total;
    });
  }

  /* ---------- 批次三：流程地图 ---------- */
  function bindFlow() {
    var panel = $("cl-panel");
    function refresh() {
      panel.querySelectorAll(".fl-nodes").forEach(function (box) {
        var key = box.parentElement.querySelector(".fl-from").getAttribute("data-k");
        var from = parseInt(box.parentElement.querySelector(".fl-from").value, 10) || 0;
        box.innerHTML = FLOWS[key].nodes.map(function (n, i) {
          var done = i < from;
          var next = i === from;
          return '<div style="margin:6px 0;padding-left:10px;border-left:2px solid ' + (done ? "var(--line)" : next ? "var(--primary)" : "var(--line)") + '">' +
            (done ? "✓ " : next ? "▶ " : "· ") + "<b>" + esc(n.n) + "</b>" + (n.dur ? '<span class="dim">（' + n.dur + " 日参考）</span>" : "") +
            '<div style="font-size:12px">' + esc(n.act) + '</div></div>';
        }).join("");
      });
    }
    panel.addEventListener("change", refresh);
    refresh();
    panel.querySelectorAll(".fl-add").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-k");
        var wrap = b.parentElement;
        var from = parseInt(wrap.querySelector(".fl-from").value, 10) || 0;
        var base = new Date(); var added = 0;
        FLOWS[key].nodes.forEach(function (n, i) {
          if (i < from || !window.TOOLS || !window.TOOLS.calAdd) return;
          base.setDate(base.getDate() + (n.dur || 1));
          window.TOOLS.calAdd(FLOWS[key].name + "：" + n.n, base.toISOString().slice(0, 10));
          added++;
        });
        if (!added) { hint(b, "请选择当前进度后再加入"); return; }
        hint(b, "已加入 " + added + " 个节点（日历可按实际日期调整）");
      });
    });
  }

  /* ---------- 批次四：和解参考 ---------- */
  function bindSettle() {
    $("st-gen").addEventListener("click", function () {
      var total = parseFloat($("st-total").value) || 0;
      var floor = parseFloat($("st-floor").value) || 0;
      if (!total) { $("st-out").innerHTML = '<div class="tool-warn">请填写请求合计。</div>'; return; }
      if (floor > total) { $("st-out").innerHTML = '<div class="tool-warn">底线不应高于请求合计。</div>'; return; }
      var fs = [];
      document.querySelectorAll("#claims-modal .st-f:checked").forEach(function (c) { fs.push(parseInt(c.value, 10)); });
      var FACT = ["时效/证据缺口", "快速回款诉求", "离职证明等后续配合", "诉讼成本", "对方付款能力"];
      var mid = round2((total + floor) / 2);
      $("st-out").innerHTML = '<div style="border:1px solid var(--primary);border-radius:10px;padding:12px;font-size:13px;line-height:1.9">' +
        "<b>谈判参考卡</b><br>" +
        "锚点（首次报价）：¥ " + fmt(total) + "<br>" +
        "参考中间值：¥ " + fmt(mid) + "<br>" +
        "你的底线：¥ " + fmt(floor) + "<br>" +
        (fs.length ? "让步考量：" + fs.map(function (i) { return FACT[i]; }).join("、") + "——这些因素支持在锚点与底线间分步让步<br>" : "") +
        '<span class="dim" style="font-size:11.5px">让步节奏建议：每次小幅让步并换取对应条件（如缩短付款期、出具离职证明）；「一次性了结」条款须明确放弃请求的范围。</span></div>';
    });
    $("st-agreement").addEventListener("click", function () { docWin("和解协议书（模板）", AGREEMENT); });
    $("st-defense").addEventListener("click", function () { docWin("劳动仲裁答辩书（模板·被申请人）", DEFENSE); });
  }

  var AGREEMENT =
    "和解协议书\n\n甲方（劳动者）：【姓名】　身份证号：【】\n乙方（用人单位）：【名称】　统一社会信用代码：【】\n\n双方就劳动争议事宜（仲裁/诉讼案号：【如有】），经平等协商达成如下协议：\n\n一、乙方于【年月日】前向甲方一次性支付人民币【】元（大写：【】），包含但不限于工资、经济补偿/赔偿、未休年假工资等全部款项；付款方式：【银行转账，账号：】。\n二、本协议第一条款项支付完毕后，双方劳动争议一次性了结，甲方放弃就本次争议向乙方主张其他任何权利（含撤销仲裁/诉讼申请）。\n三、甲方在收到全部款项后【3】个工作日内向【仲裁委/法院】提交撤回申请。\n四、任何一方违反本协议的，守约方有权就未履行部分继续依法主张权利。\n五、本协议一式两份，自双方签字（盖章）之日起生效。\n\n甲方（签字）：　　　　　　乙方（盖章）：\n日期：　　　　　　　　　　日期：\n\n※ 提示：①金额与付款期限务必具体；②「放弃其他请求」的范围影响重大，签署前建议律师审查；③乙方为公司时建议加盖公章而非部门章。";
  var DEFENSE =
    "劳动仲裁答辩书\n\n答辩人（被申请人）：【单位名称】\n申请人：【姓名】，就其与我单位劳动争议仲裁一案（案号：【】），答辩如下：\n\n一、答辩人对【解除劳动合同/工资支付】的合法性/数额有异议：\n【事实与理由：简述用工情况、解除或欠付的事实经过、依据的制度与程序】\n二、程序方面：解除前已履行【工会通知/民主程序制度公示】程序（证据：【】）。\n三、法律依据：依据《劳动合同法》第【39/40】条…【对应情形】。\n四、综上，申请人仲裁请求缺乏事实与法律依据，请求仲裁委依法驳回或依法核减。\n\n此致\n【】劳动人事争议仲裁委员会\n\n答辩人（盖章）：\n日期：\n\n附：证据清单及证据材料【】份\n\n※ 提示：答辩期仅 10 日；对管辖有异议的应在答辩期内提出；本模板为结构参考，建议由律师结合证据定制。";

  /* ---------- 小工具 ---------- */
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    else {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {} ta.remove();
    }
  }
  function hint(btn, msg) {
    var old = btn.innerHTML;
    btn.textContent = msg;
    setTimeout(function () { btn.innerHTML = old; }, 2200);
  }
  function docWin(title, text) {
    var w = document.createElement("div");
    w.className = "modal";
    w.innerHTML = '<div class="modal-mask"></div><div class="modal-card" style="max-width:720px;width:94%"><div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-body" style="max-height:56vh;overflow-y:auto"><textarea readonly style="width:100%;min-height:40vh;font-size:13px;line-height:1.8;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);box-sizing:border-box">' + esc(text) + '</textarea></div>' +
      '<div class="modal-foot"><button class="primary dw-copy">复制全文</button><button class="dw-close">关闭</button></div></div>';
    document.body.appendChild(w);
    w.querySelector(".modal-mask").addEventListener("click", function () { w.remove(); });
    w.querySelector(".dw-close").addEventListener("click", function () { w.remove(); });
    w.querySelector(".dw-copy").addEventListener("click", function () {
      copy(text);
      var b = w.querySelector(".dw-copy"); b.textContent = "已复制";
      setTimeout(function () { b.textContent = "复制全文"; }, 1500);
    });
    if (window.WORKSPACE && window.WORKSPACE.current()) {
      window.WORKSPACE.attach("docs", { name: title, date: new Date().toISOString().slice(0, 10), draft: text.slice(0, 4000) });
    }
  }

  function init() {
    var btn = $("claims-open-btn");
    if (btn) btn.addEventListener("click", openModal);
  }

  return { init: init, openModal: openModal, ITEMS: ITEMS, FLOWS: FLOWS, collectForTest: function (vals) {
    /* 供 test.js：vals = { itemId: {param:value}, checked:[ids] } → {rows,total} */
    var rows = [], total = 0;
    ITEMS.forEach(function (it) {
      if (!vals.checked || vals.checked.indexOf(it.id) === -1) return;
      var p = vals[it.id] || {};
      if (!it.params.some(function (q) { return parseFloat(p[q.k]) > 0; })) return;
      var amt = it.calc(p);
      total += amt;
      rows.push({ id: it.id, name: it.name, amount: amt, law: it.law, evidence: it.evidence });
    });
    return { rows: rows, total: round2(total) };
  } };
})();
