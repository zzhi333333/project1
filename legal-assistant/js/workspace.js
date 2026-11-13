/* =========================================================
 * workspace.js —— 案件工作区（批次三）
 * 同一案件统一聚合：待确认事项 / 关联报告 / 期限（合规日历项）/
 * 案例收藏，减少重复输入；咨询/分析/导入在「当前案件」激活时自动归集。
 * 数据：STORE.set("legal-workspaces", { list, currentId })
 * 红线：案件数据仅存本机；删除案件不删底层报告/日历（只解除关联）。
 * ========================================================= */
window.WORKSPACE = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  var KEY = "legal-workspaces";
  function load() {
    var d = window.STORE ? STORE.get(KEY, {}) : {};
    if (!Array.isArray(d.list)) d.list = [];
    /* 老数据归一化（P3）：links 缺键/notes 缺失/stage·ledger·result 缺省——
       渲染与写入路径彻底免疫（缺字段数据在归集区 arr.length 抛 TypeError 的防御补齐） */
    d.list.forEach(function (c) {
      if (!c.links || typeof c.links !== "object") c.links = {};
      ["reports", "deadlines", "cases", "docs", "sessions"].forEach(function (k) {
        if (!Array.isArray(c.links[k])) c.links[k] = [];
      });
      if (!Array.isArray(c.notes)) c.notes = [];
      /* C1 阶段迁移：旧数字索引→新字符串键（读时归一，下次 save 自愈落盘） */
      c.stage = normStage(c.stage);
      if (!c.ledger || typeof c.ledger !== "object") c.ledger = { claimTotal: null, spent: [], resultAmount: null };
      if (!Array.isArray(c.ledger.spent)) c.ledger.spent = [];
      if (c.result === undefined) c.result = null;
      /* C3 履行跟踪台账（归一化默认） */
      if (!Array.isArray(c.performance)) c.performance = [];
      c.performance.forEach(function (p) {
        if (!p || typeof p !== "object") return;
        p.item = String(p.item || "").slice(0, 80);
        if (p.status !== "done" && p.status !== "overdue" && p.status !== "pending") p.status = "pending";
      });
      /* C4 结案归档（archived 默认 false；活跃列表=未归档） */
      if (c.archived !== true) c.archived = false;
      /* ④C2 期限节点（判决解析产物）与 ③取证打卡 默认 */
      if (!Array.isArray(c.deadlineNodes)) c.deadlineNodes = [];
      if (!c.evTaken || typeof c.evTaken !== "object") c.evTaken = {};
    });
    return d;
  }
  function save(d) {
    if (window.STORE) STORE.set(KEY, d);
    else { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { } }
  }

  function list() { return load().list; }
  function currentId() { return load().currentId || null; }
  function current() {
    var d = load();
    return d.list.filter(function (c) { return c.id === d.currentId; })[0] || null;
  }
  function create(name) {
    var d = load();
    var c = {
      id: "ws-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      name: String(name || "未命名案件").slice(0, 40),
      createdAt: new Date().toISOString(),
      notes: [],           /* 待确认事项 [{text, done, at}] */
      links: { reports: [], deadlines: [], cases: [], docs: [], sessions: [] },
      stage: 0,            /* 生命周期阶段（STAGES 下标，用户自报；老数据缺省按 0=准备） */
      stageAt: new Date().toISOString(),
      ledger: { claimTotal: null, spent: [], resultAmount: null },   /* 金额三线台账（纯记账） */
      result: null         /* 判决书解析落盘（案号/法院/落款日/金额，执行申请书跨会话复用） */
    };
    d.list.unshift(c);
    d.currentId = c.id;
    save(d);
    return c;
  }
  function rename(id, name) {
    var d = load();
    d.list.forEach(function (c) { if (c.id === id) c.name = String(name || c.name).slice(0, 40); });
    save(d);
  }
  function remove(id) {
    var d = load();
    d.list = d.list.filter(function (c) { return c.id !== id; });
    if (d.currentId === id) d.currentId = d.list.length ? d.list[0].id : null;
    save(d);
  }
  function setCurrent(id) { var d = load(); d.currentId = id; save(d); }

  /* 在同一次读-改-写内操作当前案件（load 返回的是新解析对象，必须回存同一对象） */
  function withCurrent(fn) {
    var d = load();
    var c = d.list.filter(function (x) { return x.id === d.currentId; })[0] || null;
    if (!c) return null;
    var r = fn(c);
    save(d);
    return r === undefined ? true : r;
  }

  /* ---------------- 案件生命周期阶段（B1，C1 深化：八档字符串键） ----------------
     阶段为用户自报的客观进程标记（取证→协商→立案→仲裁→一审→二审→执行→已结案），
     不做任何程序进度承诺或结果预测（红线）。仲裁/一审为互斥双轨：劳动案主走仲裁，
     民事案直接一审——节点全显示，用户按自己的程序自报即可（错位一档点选即修正）。
     旧数字索引迁移见 load()：{0:取证,1:立案,2:仲裁,3:一审,4:执行,5:已结案}。 */
  var STAGE_KEYS = ["取证", "协商", "立案", "仲裁", "一审", "二审", "执行", "已结案"];
  var LEGACY_STAGE_MAP = { 0: "取证", 1: "立案", 2: "仲裁", 3: "一审", 4: "执行", 5: "已结案" };
  function normStage(v) {
    if (typeof v === "number" && LEGACY_STAGE_MAP[v]) return LEGACY_STAGE_MAP[v];
    if (typeof v === "string" && STAGE_KEYS.indexOf(v) > -1) return v;
    return "取证";
  }
  function getStage(c) { return normStage(c && c.stage); }
  function setStage(key) {
    var k = normStage(key);
    return withCurrent(function (c) {
      c.stage = k;
      c.stageAt = new Date().toISOString();
    }) === true;
  }
  /* C1 要点清单：切阶段自动带出该阶段常见行动要点与现有工具入口（纯参考不代改） */
  var STAGE_CHECKLIST = {
    "取证": ["按证据清单逐项归集（聊天记录/转账凭证/合同/考勤），原始载体保留", "关键证据做公证或时间戳固定（如需）", "点「生成证据目录表」建立编号目录"],
    "协商": ["明确底线与让步阶梯（参考和解谈判卡）", "协商记录留痕（书面/录音），承诺期限写进协议", "注意仲裁/诉讼时效：劳动 1 年、民事 3 年（时效规则中心可查）"],
    "立案": ["备齐申请书/起诉状+证据目录+当事人主体材料", "劳动争议先仲裁前置（仲裁申请书模板已内置）", "点「解析生成双时间线」核对手续期限"],
    "仲裁": ["庭前按庭审提纲组织陈述与质证要点", "对方证据逐项三性质证（质证意见草稿可生成）", "裁决作出后注意 15 日起诉期（不服裁决转诉讼）"],
    "一审": ["按庭审提纲走举证/质证/辩论三段", "新增证据注意举证期限", "不服判决 15 日内上诉（期限节点已入日历可跟踪）"],
    "二审": ["上诉状聚焦一审法律适用与事实认定错误点", "新证据说明逾期理由", "二审判决为终审，生效后进入履行/执行"],
    "执行": ["履行期内先催告留痕", "查财产线索：银行/房车/工资/股权（财产线索清单可生成）", "逾期未履行：点「执行申请书（自动填充）」申请强制执行"],
    "已结案": ["核对款项全部到账（履行台账勾齐）", "文书归档：导出案件档案 + 律师交接包", "生成结案回顾留档复盘"]
  };

  /* ---------------- 判决结果落盘（B2） ----------------
     parseJudgment 结果此前只存内存 lastJudg，刷新即丢，执行申请书被锁死在
     「同一会话先解析」——落盘进 case.result 后跨会话可复用。 */
  function setCaseResult(j, docType) {
    if (!j) return false;
    var r = {
      caseNo: String(j.caseNo || "").slice(0, 40),
      court: String(j.court || "").slice(0, 30),
      judgmentDate: j.judgmentDate || "",
      amount: String(j.amount || ""),
      plaintiff: String(j.plaintiff || "").slice(0, 25),
      defendant: String(j.defendant || "").slice(0, 25),
      docType: String(docType || j.docType || ""),
      at: new Date().toISOString()
    };
    var ok = withCurrent(function (c) {
      c.result = r;
      c.ledger = c.ledger || { claimTotal: null, spent: [], resultAmount: null };
      if (r.amount) c.ledger.resultAmount = r.amount;   /* 判得金额自动入台账（可被后续解析覆盖） */
      /* C3：判决落盘自动预建履行跟踪项——due 近似上诉期届满（落款+15，与双时间线同口径），
         实际履行期限以判决指定为准（不合适可删除后按实际期限重建） */
      if (r.amount && Array.isArray(c.performance) && !c.performance.length) {
        var dueApprox = "";
        try { if (r.judgmentDate) dueApprox = addDays(r.judgmentDate, 15); } catch (e) { }
        c.performance.unshift({ item: "被申请人履行义务（支付 " + fmt(parseFloat(r.amount)) + " 元）", amount: parseFloat(r.amount), due: dueApprox, status: "pending", at: new Date().toISOString() });
      }
      /* ④C2 警报源扩展：程序期限节点落盘（未入日历的也进警报聚合；点「入日历」即标 addedToCal） */
      if (r.judgmentDate) {
        try {
          c.deadlineNodes = futureNodes(r.judgmentDate, r.docType || "first").map(function (n) {
            return { name: n.name, date: n.date, basis: n.basis, addedToCal: false };
          });
        } catch (e) { }
      }
    }) === true;
    if (ok) renderBody();   /* 判决卡即时刷新（P2）：与 attach 同惯例——弹层开着时不等重开才显已保存 */
    return ok;
  }
  function getCaseResult() { var c = current(); return c && c.result ? c.result : null; }
  function clearCaseResult() {
    return withCurrent(function (c) { c.result = null; if (c.ledger) c.ledger.resultAmount = null; }) === true;
  }

  /* ---------------- 金额三线台账（B4，纯记账不预测） ---------------- */
  function setClaimTotal(n) {
    var v = parseFloat(n);
    return withCurrent(function (c) {
      c.ledger = c.ledger || { claimTotal: null, spent: [], resultAmount: null };
      c.ledger.claimTotal = isFinite(v) && v > 0 ? v : null;
    }) === true;
  }
  function addSpent(name, amount, opts) {
    var v = parseFloat(amount);
    if (!isFinite(v) || v <= 0) return null;
    var o = opts || {};
    var e = { name: String(name || "支出").slice(0, 30), amount: v, at: new Date().toISOString() };
    /* 票据深化（v3.6.1）：类型/发生日期/凭证号（旧数据缺字段渲染回退） */
    if (o.type) e.type = String(o.type).slice(0, 12);
    if (o.date) e.date = String(o.date).slice(0, 10);
    if (o.voucherNo) e.voucherNo = String(o.voucherNo).slice(0, 30);
    return withCurrent(function (c) {
      c.ledger = c.ledger || { claimTotal: null, spent: [], resultAmount: null };
      c.ledger.spent = c.ledger.spent || [];
      c.ledger.spent.unshift(e);
      if (c.ledger.spent.length > 50) c.ledger.spent.length = 50;
    }) === true ? e : null;
  }
  function removeSpent(i) { withCurrent(function (c) { if (c.ledger && c.ledger.spent) c.ledger.spent.splice(i, 1); }); }

  /* ---------------- C3 履行跟踪台账（判决生效后对方履行情况，纯记录） ----------------
     performance: [{item, amount, due, status: pending|done|overdue, doneAt}]
     逾期=有 due 且 date(due)<今天 且仍 pending（渲染时判定）；勾选已履行累计
     ledger.recovered（已回收第四线）。不预测能否执行到位（红线）。 */
  function addPerf(item, amount, due) {
    if (!item || !String(item).trim()) return null;
    var e = { item: String(item).trim().slice(0, 80), status: "pending", at: new Date().toISOString() };
    var v = parseFloat(amount);
    if (isFinite(v) && v > 0) e.amount = v;
    if (due && /^\d{4}-\d{2}-\d{2}$/.test(String(due))) e.due = String(due);
    var created = withCurrent(function (c) {
      c.performance = c.performance || [];
      c.performance.unshift(e);
      if (c.performance.length > 50) c.performance.length = 50;
    }) === true;
    if (created) renderBody();
    return created ? e : null;
  }
  function togglePerf(i) {
    withCurrent(function (c) {
      c.performance = c.performance || [];
      var p = c.performance[i];
      if (!p) return;
      if (p.status === "done") {
        p.status = "pending"; p.doneAt = null;
        if (p.amount && c.ledger) {
          c.ledger.recovered = Math.max(0, (parseFloat(c.ledger.recovered) || 0) - p.amount);
        }
      } else {
        p.status = "done"; p.doneAt = new Date().toISOString();
        if (p.amount && c.ledger) {
          c.ledger.recovered = (parseFloat(c.ledger.recovered) || 0) + p.amount;
        }
      }
    });
    renderBody();
  }
  function removePerf(i) {
    withCurrent(function (c) {
      c.performance = c.performance || [];
      var p = c.performance[i];
      if (p && p.status === "done" && p.amount && c.ledger) {
        c.ledger.recovered = Math.max(0, (parseFloat(c.ledger.recovered) || 0) - p.amount);
      }
      c.performance.splice(i, 1);
    });
    renderBody();
  }
  function perfOverdue(p, todayStr) {
    if (!p || p.status !== "pending" || !p.due) return false;
    var d = String(p.due);
    return d < (todayStr || new Date().toISOString().slice(0, 10));
  }

  /* ---------------- C4 结案归档 + 结案回顾（并入 C5 投入产出对比） ----------------
     archived=true 移出活跃列表（选择器分组可找回，不删数据）；结案回顾聚合
     全程时间线/文书清单/台账投入产出，纯事实汇总不预测。 */
  function setArchived(id, v) {
    var d = load();
    var c2 = d.list.filter(function (x) { return x.id === id; })[0];
    if (!c2) return false;
    c2.archived = v === true;
    if (v === true) c2.stage = "已结案";
    save(d);
    return true;
  }
  function buildClosureReport(c) {
    var lines = ["# 结案回顾 · " + (c.name || "未命名案件"), "", "生成：" + new Date().toISOString().slice(0, 10) + "　阶段轨迹自报，非程序承诺。", ""];
    /* 时间线：聚合各处 at/date 字段（创建/阶段/事项/判决/支出/履行/期限） */
    var tl = [];
    if (c.createdAt) tl.push({ d: c.createdAt.slice(0, 10), t: "案件创建" });
    if (c.stageAt) tl.push({ d: c.stageAt.slice(0, 10), t: "阶段标记：已结案（最后更新）" });
    (c.result && c.result.at) ? tl.push({ d: c.result.at.slice(0, 10), t: "判决/调解解析落盘（" + (c.result.caseNo || "案号见判决卡") + "）" }) : null;
    (c.notes || []).forEach(function (n) { if (n.at) tl.push({ d: n.at.slice(0, 10), t: "待办" + (n.done ? "完成" : "") + "：" + n.text }); });
    ((c.ledger || {}).spent || []).forEach(function (e) { tl.push({ d: (e.date || (e.at || "").slice(0, 10)), t: "支出：" + e.name + "（" + fmt(e.amount) + " 元）" }); });
    (c.performance || []).forEach(function (p) { tl.push({ d: (p.doneAt || "").slice(0, 10), t: (p.status === "done" ? "已履行" : "未履行") + "：" + p.item + (p.amount ? "（" + fmt(p.amount) + " 元）" : "") }); });
    tl = tl.filter(function (x) { return x.d; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    lines.push("## 全程时间线");
    lines.push(tl.length ? tl.map(function (x) { return "- " + x.d + "　" + x.t; }).join("\n") : "（暂无可聚合的时间点）");
    /* 文书清单 */
    lines.push("", "## 文书与归集清单");
    var docs = (c.links.docs || []).map(function (r) { return "- " + (r.date || "?") + "　文书：" + r.name; });
    var reps = (c.links.reports || []).map(function (r) { return "- " + (r.date || "?") + "　报告：" + r.name; });
    lines.push((docs.length ? docs.join("\n") : "（无文书草稿）") + "\n" + (reps.length ? reps.join("\n") : "（无关联报告）"));
    /* 投入产出对比（C5）：请求 vs 判得 vs 已回收 vs 已支出 */
    var lg = c.ledger || {};
    var spentAll = (lg.spent || []).reduce(function (s, e) { return s + (parseFloat(e.amount) || 0); }, 0);
    lines.push("", "## 台账对比（纯记录，非收益承诺）");
    lines.push("| 项目 | 金额 |", "|---|---|");
    lines.push("| 请求合计 | " + (lg.claimTotal != null ? fmt(lg.claimTotal) + " 元" : "—") + " |");
    lines.push("| 判决/调解确定 | " + (lg.resultAmount ? fmt(parseFloat(lg.resultAmount)) + " 元" : "—") + " |");
    lines.push("| 已回收（履行勾记） | " + ((parseFloat(lg.recovered) || 0) > 0 ? fmt(lg.recovered) + " 元" : "—") + " |");
    lines.push("| 已投入（费用支出） | " + (spentAll > 0 ? fmt(spentAll) + " 元" : "—") + " |");
    lines.push("", "---", "本回顾由本机数据自动聚合生成，仅供个人复盘留档，不构成法律意见。");
    return lines.join("\n");
  }
  function closureReportCurrent() {
    var c = current();
    if (!c) return null;
    var md = buildClosureReport(c);
    wsDocWin("结案回顾（自动聚合）", md);
    return md;
  }

  /* ---------------- C2 期限警报栏（跨案件聚合） + D7 续办卡 ----------------
     首页顶部一条警报栏：聚合所有活跃案件的未完成期限（含合规日历全局条目），
     红=已过期或 ≤3 天、橙=≤7 天；点击直达案件工作区（全局条目直达合规日历）。
     续办卡=最近活跃案件一跳续办。纯聚合展示，不做任何提醒承诺（提醒见合规日历）。 */
  function alertBarData(todayStr) {
    var today = todayStr || new Date().toISOString().slice(0, 10);
    var dAll = load();
    var dlAll = [];
    try { dlAll = JSON.parse(localStorage.getItem("legal-deadlines") || "[]"); } catch (e) { }
    var items = [];
    dAll.list.forEach(function (c) {
      if (c.archived) return;
      (c.links.deadlines || []).forEach(function (ld) {
        if (!ld.date) return;
        var it = dlAll.filter(function (x) { return x.name === ld.name && x.date === ld.date; })[0];
        if (it && it.done) return;
        items.push({ date: ld.date, name: ld.name, caseId: c.id, caseName: c.name, stage: getStage(c) });
      });
    });
    dlAll.forEach(function (it) {
      if (!it.date || it.done) return;
      var owned = items.some(function (x) { return x.date === it.date && x.name === it.name; });
      if (!owned) items.push({ date: it.date, name: it.name, caseId: null, caseName: null, stage: null });
    });
    /* ④C2 警报源扩展：判决解析的程序期限节点（未入日历的也提醒，标注来源） */
    dAll.list.forEach(function (c) {
      if (c.archived) return;
      (c.deadlineNodes || []).forEach(function (n) {
        if (!n.date || n.addedToCal) return;
        var dup = items.some(function (x) { return x.caseId === c.id && (x.name.indexOf(n.name.slice(0, 6)) > -1 || n.name.indexOf(x.name.slice(0, 6)) > -1); });
        if (dup) return;
        items.push({ date: n.date, name: n.name, caseId: c.id, caseName: c.name, stage: getStage(c), node: true });
      });
    });
    items.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return items.filter(function (x) {
      var diff = Math.round((new Date(x.date + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
      return diff <= 7;   /* 未来 7 天内 + 已过期未标记 */
    }).map(function (x) {
      var diff = Math.round((new Date(x.date + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
      x.level = diff < 0 ? "red" : diff <= 3 ? "red" : "orange";
      x.diff = diff;
      return x;
    });
  }
  /* ③ C2 闭合环：案件 tab 红点——红级（逾期/≤3 天）才点，橙级不打扰；数据同警报栏 */
  function renderTabDot() {
    var red = alertBarData().some(function (x) { return x.level === "red"; });
    document.querySelectorAll(".tab-dot[data-for='workspace']").forEach(function (d) {
      d.classList.toggle("hidden", !red);
    });
  }
  function renderAlertBar() {
    var view = document.getElementById("view-consult");
    if (!view) return;
    var host = document.getElementById("ws-alert-bar");
    if (!host) {
      host = document.createElement("div");
      host.id = "ws-alert-bar";
      view.insertBefore(host, view.firstChild);
    }
    var items = alertBarData();
    var dAll = load();
    var active = dAll.list.filter(function (c) { return !c.archived; });
    var last = active.slice().sort(function (a, b) { return (b.stageAt || "") < (a.stageAt || "") ? -1 : 1; })[0];
    var html = "";
    /* D7 续办卡 */
    if (last) {
      var dlAll2 = [];
      try { dlAll2 = JSON.parse(localStorage.getItem("legal-deadlines") || "[]"); } catch (e) { }
      var next = null;
      (last.links.deadlines || []).forEach(function (ld) {
        var it = dlAll2.filter(function (x) { return x.name === ld.name && x.date === ld.date; })[0];
        if (it && it.done) return;
        if (!next || (ld.date && ld.date < next)) next = ld.date;
      });
      html += '<div class="flk-item ws-resume-card" data-ws-resume="' + esc(last.id) + '" style="padding:9px 12px;margin-bottom:8px;cursor:pointer;display:flex;gap:8px;align-items:center">' +
        '<svg class=ico><use href=#i-box></use></svg>' +
        '<div style="flex:1;min-width:0"><b style="font-size:12.5px">继续办理：' + esc(last.name) + '</b>' +
        '<div style="font-size:11px;color:var(--ink-2)">当前阶段：' + esc(getStage(last)) +
        (next ? '　·　最近期限：' + esc(next) : '') + '</div></div>' +
        '<span class="dim" style="font-size:11px">进入 ›</span></div>';
    }
    /* C2 警报栏 */
    if (items.length) {
      var shown = items.filter(function (x) { return x.level === "red"; })
        .concat(items.filter(function (x) { return x.level === "orange"; }).slice(0, 3));
      var more = items.length - shown.length;
      html += '<div class="flk-item" style="padding:8px 12px;margin-bottom:8px;border-left:3px solid ' + (items.some(function (x) { return x.level === "red"; }) ? "var(--danger)" : "var(--warn)") + '">' +
        '<b style="font-size:12px;color:var(--danger)">⏰ 期限警报（' + items.length + ' 条）</b>' +
        shown.map(function (x) {
          return '<div data-ws-alert="' + esc(x.caseId || "") + '" data-ws-alert-date="' + esc(x.date) + '" style="font-size:12px;margin-top:4px;cursor:pointer;color:' + (x.level === "red" ? "var(--danger)" : "var(--warn)") + '">' +
            (x.diff < 0 ? '已过 ' + (-x.diff) + ' 天' : x.diff === 0 ? '今天' : '剩 ' + x.diff + ' 天') + ' · ' + esc(x.date) + '　' + esc(x.name) +
            (x.caseName ? '<span class="dim">　（' + esc(x.caseName) + '）</span>' : '<span class="dim">　（通用日历）</span>') + '</div>';
        }).join("") +
        (more > 0 ? '<div class="dim" style="font-size:11px;margin-top:4px">另有 ' + more + ' 条较宽松期限，见合规日历</div>' : '') +
        '<div class="dim" style="font-size:11px;margin-top:5px">点击条目直达对应案件工作区（通用条目直达合规日历）</div></div>';
    }
    host.innerHTML = html;
    if (!html) host.style.display = "none"; else host.style.display = "";
    /* ③ 同步案件 tab 红点（与警报栏同一数据、同一刷新节奏） */
    renderTabDot();
  }

  /* 自动归集：当前案件激活时，报告存档/日历项/案例导入调用（无当前案件则忽略） */
  function attach(kind, ref) {
    if (!ref) return false;
    var ok = withCurrent(function (c) {
      var arr = c.links[kind];
      if (!arr) return false;
      var dup = arr.some(function (x) { return (ref.id && x.id === ref.id) || (!ref.id && x.name === ref.name && x.date === ref.date); });
      if (dup) return true;
      var item = { id: ref.id || null, name: String(ref.name || "").slice(0, 60), date: ref.date || null, at: new Date().toISOString() };
      /* 文书草稿正文（claims/main.js/contract 传入；此前被丢弃导致草稿只有标题无内容） */
      if (ref.draft) item.draft = String(ref.draft).slice(0, 4000);
      arr.unshift(item);
      if (arr.length > 50) arr.length = 50;
      return true;
    }) === true;
    if (ok) renderBody();   /* 弹层开着时即时刷新归集区 */
    return ok;
  }

  /* 反向清理：报告被删除/超上限截断时，解除所有案件 links.reports 中的悬空引用 */
  function purgeReports(ids) {
    if (!ids || !ids.length) return false;
    var set = {};
    ids.forEach(function (id) { if (id) set[id] = 1; });
    var d = load();
    var touched = false;
    d.list.forEach(function (c) {
      if (!c.links || !c.links.reports) return;
      var before = c.links.reports.length;
      c.links.reports = c.links.reports.filter(function (x) { return !x.id || !set[x.id]; });
      if (c.links.reports.length !== before) touched = true;
    });
    if (touched) { save(d); renderBody(); }
    return touched;
  }

  /* 待确认事项 */
  function addNote(text) {
    if (!text) return null;
    var n = { text: String(text).slice(0, 120), done: false, at: new Date().toISOString() };
    return withCurrent(function (c) { c.notes.unshift(n); }) ? n : null;
  }
  function toggleNote(i) {
    withCurrent(function (c) { if (c.notes[i]) c.notes[i].done = !c.notes[i].done; });
  }
  function removeNote(i) {
    withCurrent(function (c) { c.notes.splice(i, 1); });
  }

  /* 案件档案导出（.md 文本返回，下载由调用端处理） */
  function toMarkdown(c) {
    var s = "# 案件档案：" + c.name + "\n\n创建：" + c.createdAt.slice(0, 10) + "　导出：" + new Date().toISOString().slice(0, 10) + "\n";
    s += "\n## 待确认事项\n" + (c.notes.length
      ? c.notes.map(function (n) { return "- [" + (n.done ? "x" : " ") + "] " + n.text; }).join("\n")
      : "（暂无）");
    s += "\n\n## 关联分析报告\n" + (c.links.reports.length
      ? c.links.reports.map(function (r) { return "- " + (r.date || "").slice(0, 10) + "：" + r.name }).join("\n")
      : "（暂无）");
    s += "\n\n## 期限与提醒\n" + (c.links.deadlines.length
      ? c.links.deadlines.map(function (r) { return "- " + (r.date || "?") + "：" + r.name }).join("\n")
      : "（暂无）");
    s += "\n\n## 文书草稿\n" + ((c.links.docs || []).length
      ? c.links.docs.map(function (r) { return "- " + (r.date || "") + "：" + r.name }).join("\n")
      : "（暂无）");
    s += "\n\n## 关联案例\n" + (c.links.cases.length
      ? c.links.cases.map(function (r) { return "- " + r.name }).join("\n")
      : "（暂无）");
    s += "\n\n---\n本档案由法律咨询助手在本机生成，仅供参考，不构成法律意见。\n";
    return s;
  }

  /* ---------------- 判决书双时间线（已发生事实 + 程序期限节点） ---------------- */
  var DAYS = 86400000;
  function fmt(n) { var v = parseFloat(n); return isFinite(v) ? v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "0"; }
  /* 中文数字日期 → 阿拉伯数字（判决书落款法定格式为「二〇二三年十一月二十日」，
     不转换则落款日会被误取为正文中最后一个阿拉伯日期，上诉期等期限推算整体错位） */
  var CN_DIG = { "〇": "0", "零": "0", "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9" };
  function cnYearToAr(s) {
    return String(s).split("").map(function (ch) { return CN_DIG[ch] !== undefined ? CN_DIG[ch] : ch; }).join("");
  }
  function cnSmallToAr(s) {
    if (!s) return "";
    if (s.indexOf("三十") === 0) return "3" + (s.length > 2 ? (CN_DIG[s.charAt(2)] || "0") : "0");
    if (s.indexOf("二十") === 0) return "2" + (s.length > 2 ? (CN_DIG[s.charAt(2)] || "0") : "0");
    if (s.charAt(0) === "十") return "1" + (s.length > 1 ? (CN_DIG[s.charAt(1)] || "0") : "0");
    return CN_DIG[s] !== undefined ? CN_DIG[s] : "";
  }
  function normCnDates(text) {
    return String(text).replace(/([一二三四五六七八九〇零]{4})年\s*([一二三四五六七八九十]{1,3})月(?:\s*([一二三四五六七八九十]{1,3})日)?/g,
      function (_, y, mo, d) {
        return cnYearToAr(y) + "年" + cnSmallToAr(mo) + "月" + (d ? cnSmallToAr(d) + "日" : "");
      });
  }
  function addDays(dateStr, days) {
    /* 手工拆年月日（不依赖 Date 字符串解析——"2024-8-15" 未补零的 ISO 串在 V8 严格解析下会失败） */
    var m = String(dateStr).match(/([12]\d{3})[-/年](\d{1,2})(?:[-/月](\d{1,2}))?/);
    if (!m) return null;
    var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3] || "1", 10));
    if (isNaN(d.getTime())) return null;
    d = new Date(d.getTime() + days * DAYS);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  /* 提取全文日期（含上下文短语），按时间排序为「已发生事实时间线」 */
  function extractDates(text) {
    var src = normCnDates(text);
    var seen = {}, out = [];
    var re = /([12]\d{3})\s*年\s*(\d{1,2})\s*月(\s*\d{1,2}\s*日)?/g, m;
    while ((m = re.exec(src)) !== null) {
      var y = m[1], mo = ("0" + m[2]).slice(-2), d = m[3] ? ("0" + m[3].replace(/\D/g, "")).slice(-2) : "";
      var iso = y + "-" + mo + (d ? "-" + d : "");
      if (seen[iso]) continue;
      seen[iso] = 1;
      var ctx = src.slice(Math.max(0, m.index - 18), m.index).replace(/\s+/g, " ");
      out.push({ date: iso, label: (ctx.slice(-14) || "发生") });
    }
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }
  /* 程序期限节点（依文书类型；起算日以文书落款日近似，提示按实际送达日调整） */
  function futureNodes(judgDate, type) {
    var nodes = [];
    if (type === "first") {
      nodes.push({ name: "上诉期届满（一审判决，15 日）", date: addDays(judgDate, 15), basis: "《民事诉讼法》第171条：自判决送达之日起 15 日内上诉——起算日已按落款日近似，请按实际送达日调整后入日历" });
      nodes.push({ name: "申请强制执行（2 年，如对方未履行）", date: addDays(judgDate, 15 + 2 * 365), basis: "《民事诉讼法》第246条：申请执行期间 2 年，自履行期限届满日起算（如判决指定 10 日履行期，此处近似按上诉期届满起算）" });
    } else if (type === "second") {
      nodes.push({ name: "申请强制执行（2 年，二审判决作出即生效）", date: addDays(judgDate, 2 * 365), basis: "二审判决送达即生效；2 年内可申请执行" });
    } else {
      nodes.push({ name: "调解书履行核查", date: addDays(judgDate, 30), basis: "调解书经双方签收即生效；按调解协议约定的履行期限逐项核查" });
    }
    return nodes.filter(function (n) { return n.date; });
  }
  function parseJudgment(text, type) {
    var r = { caseNo: "", court: "", judgmentDate: "", past: [], future: [] };
    var caseNo = text.match(/[（(]\s*[12]\d{3}\s*[）)][^号（）()]{1,20}?号/);
    if (caseNo) r.caseNo = caseNo[0].replace(/\s+/g, "");
    var courtM = text.match(/[^\n。，；]{4,20}人民法院/);
    if (courtM) r.court = courtM[0].trim().slice(0, 30);
    /* 落款日 = 文本中最后一个完整日期（判决书落款在尾部；中文数字落款先归一化，统一补零为 ISO） */
    var allDates = normCnDates(text).match(/[12]\d{3}\s*年\s*\d{1,2}\s*月\s*(?:\d{1,2}\s*日)?/g) || [];
    if (allDates.length) {
      var lm = allDates[allDates.length - 1].replace(/\s+/g, "").match(/([12]\d{3})年(\d{1,2})月(?:(\d{1,2})日)?/);
      if (lm) r.judgmentDate = lm[1] + "-" + ("0" + lm[2]).slice(-2) + (lm[3] ? "-" + ("0" + lm[3]).slice(-2) : "");
    }
    r.past = extractDates(text);
    r.future = futureNodes(r.judgmentDate, type);
    /* 当事人与履行金额（执行申请书自动填充用） */
    var ap = text.match(/原告[：:]\s*([^\n，。；]{2,25})/);
    var de = text.match(/被告[：:]\s*([^\n，。；]{2,25})/);
    r.plaintiff = ap ? ap[1].trim() : "";
    r.defendant = de ? de[1].trim() : "";
    var amt = normCnDates(text).match(/(?:返还|支付|赔偿|给付)[^0-9\n]{0,12}([0-9][0-9,]{0,11}(?:\.[0-9]{1,2})?)\s*元/);
    r.amount = amt ? amt[1].replace(/,/g, "") : "";
    return r;
  }
  var lastJudg = null;   /* 最近一次判决书解析结果（执行申请书自动填充用） */
  function renderJudgmentTL(text, type) {
    var out = $("ws-judg-out");
    var j = parseJudgment(text, type);
    if (!j.past.length && !j.future.length) { out.innerHTML = '<div class="tool-warn">未提取到日期——请确认粘贴内容包含判决日期与时间线。</div>'; return; }
    var html = '<div class="tl-meta">案号：' + esc(j.caseNo || "未提取到") + ' · 法院：' + esc(j.court || "未提取到") + ' · 落款日：' + esc(j.judgmentDate || "?") + '</div>';
    html += '<div style="font-weight:600;font-size:12.5px;margin:8px 0 4px;color:var(--primary)">已发生事实时间线</div><div class="case-timeline">';
    j.past.forEach(function (p) { html += '<div class="tl-node"><div class="tl-dot"></div><div class="tl-body"><div class="tl-stage">' + esc(p.date) + '</div><div class="tl-sum">' + esc(p.label) + '</div></div></div>'; });
    html += '</div><div style="font-weight:600;font-size:12.5px;margin:10px 0 4px;color:var(--primary)">程序期限节点（可加入合规日历）</div><div class="case-timeline">';
    j.future.forEach(function (n) {
      html += '<div class="tl-node"><div class="tl-dot" style="background:var(--danger)"></div><div class="tl-body"><div class="tl-stage">' + esc(n.name) + '</div>' +
        '<div class="tl-sum">' + esc(n.basis) + '</div>' +
        /* 独立类名 ws-tl-cal-add：analysis.js 对 .tl-cal-add 有文档级委托，
           复用同类名会让工作区按钮触发 analysis 的 stage=null 垃圾归集 */
        '<div class="tl-add"><input class="tl-date" type="date" value="' + esc(n.date) + '"><button class="mini-btn ws-tl-cal-add" data-name="' + esc(n.name) + '"><svg class=ico><use href=#i-calendar></use></svg> 加入日历</button></div></div></div>';
    });
    html += '</div><div class="calc-note">期限日期按文书落款日近似推算（法定起算点多为「送达之日」），请按实际送达日调整后再入日历；已加入日历的节点到期前 7 天会提醒。</div>';
    lastJudg = j;   /* 供执行申请书自动填充（本会话） */
    setCaseResult(j, type);   /* 落盘进当前案件：刷新/换会话后执行申请书仍可复用（B2） */
    out.innerHTML = html;
    out.querySelectorAll(".ws-tl-cal-add").forEach(function (b) {
      b.addEventListener("click", function () {
        var date = b.closest(".tl-add").querySelector(".tl-date").value;
        if (!date) return;
        var name = b.getAttribute("data-name") + "（" + date + "）";
        if (window.TOOLS && window.TOOLS.calAdd) { window.TOOLS.calAdd(name, date); b.innerHTML = '<svg class=ico><use href=#i-checkc></use></svg> 已加入'; }
        if (window.WORKSPACE) window.WORKSPACE.attach("deadlines", { name: name, date: date });
        /* ④C2：入日历后标记期限节点 addedToCal（警报栏不再重复聚合） */
        withCurrent(function (cc) {
          (cc.deadlineNodes || []).forEach(function (n) { if (n.name === b.getAttribute("data-name")) n.addedToCal = true; });
        });
      });
    });
  }

  /* ---------------- 证据目录生成（Word 表格） ---------------- */
  var EV_PURPOSE = [
    [/劳动合同|劳务/, "证明双方存在劳动关系及权利义务约定"],
    [/工资|流水|银行|转账|支付/, "证明工资标准与支付事实"],
    [/考勤|打卡|排班/, "证明出勤及工作时间事实"],
    [/聊天|微信|短信|邮件|记录/, "证明双方沟通与涉案事实经过"],
    [/借条|欠条|借据/, "证明借贷合意与债权债务关系"],
    [/录音|录像|视频/, "证明涉案行为与过程事实"],
    [/病历|医院|诊断|鉴定/, "证明损害后果及治疗事实"],
    [/票据|发票|收据|凭证/, "证明费用支出与损失金额"],
    [/照片|图片/, "证明现场与损害状况"],
    [/合同|协议|订单/, "证明合同关系与约定内容"],
    [/裁决|判决|调解书|公证/, "证明经法定程序确认的事实"],
    [/营业执照|工商|登记/, "证明主体身份与经营信息"]
  ];
  function evPurpose(line) {
    for (var i = 0; i < EV_PURPOSE.length; i++) if (EV_PURPOSE[i][0].test(line)) return EV_PURPOSE[i][1];
    return "证明涉案相关事实";
  }
  var catalogRows = [];
  function buildCatalog(text) {
    var rows = String(text || "").split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (line, i) {
      var m = line.match(/^(?:证据)?\s*\d+[.、：:]?\s*(.+)$/);
      var name = m ? m[1] : line;
      var purpose = evPurpose(name);
      var src = "当事人提供";
      if (/银行|流水/.test(name)) src = "银行打印（盖章）";
      else if (/工商|登记/.test(name)) src = "市场监督管理局调取";
      else if (/裁决|判决|调解/.test(name)) src = "法院/仲裁委";
      return { no: i + 1, name: name.slice(0, 60), src: src, purpose: purpose };
    });
    catalogRows = rows;
    return rows;
  }
  function renderCatalog(rows) {
    var out = $("ws-ev-out");
    if (!rows.length) { out.innerHTML = '<div class="tool-warn">未识别到证据条目——每行填写一条。</div>'; return; }
    /* ③U3 取证打卡：勾记取证状态与日期（存当前案件 evTaken，按证据名匹配），进度 N/M */
    var c = current();
    var evTaken = (c && c.evTaken) || {};
    var taken = rows.filter(function (r) { return evTaken[r.name]; }).length;
    var html = '<div class="dim" style="font-size:11.5px;margin-bottom:4px">取证进度：' + taken + '/' + rows.length + ' 已取' + (taken === rows.length ? ' ✓' : '') + '</div>' +
      '<table class="ev-cat-table"><thead><tr><th>序号</th><th>证据名称</th><th>来源</th><th>证明目的</th><th>取证</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var tk = evTaken[r.name];
        return '<tr><td>' + r.no + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.src) + '</td><td>' + esc(r.purpose) + '</td>' +
          '<td style="white-space:nowrap"><input type="checkbox" data-ev-take="' + esc(r.name) + '"' + (tk ? " checked" : "") + ' title="标记已取证">' + (tk ? '<span class="dim" style="font-size:10.5px">' + esc(tk) + '</span>' : '') + '</td></tr>';
      }).join("") + '</tbody></table>' +
      '<div class="calc-note">证明目的为按证据类型的自动建议，可导出后在 Word 中修改；提交时按此目录整理复印件并编页码。勾记「取证」记录取证进度（存当前案件）。</div>';
    out.innerHTML = html;
    var wb = $("ws-ev-word");
    if (wb) wb.classList.remove("hidden");
  }
  function catalogWord(rows, caseName) {
    var t = new Date();
    var pad = function (n) { return ("0" + n).slice(-2); };
    var dateStr = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    var tr = rows.map(function (r) {
      return '<tr><td>' + r.no + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.src) + '</td><td>' + esc(r.purpose) + '</td></tr>';
    }).join("");
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="zh-CN"><head><meta charset="utf-8"><title>证据目录</title>' +
      '<style>body{font-family:"Microsoft YaHei",SimSun,sans-serif;font-size:12pt;line-height:1.7;margin:24pt}h2{font-size:15pt;text-align:center}table{border-collapse:collapse;width:100%}th,td{border:1pt solid #333;padding:5pt 7pt;font-size:10.5pt}th{background:#eee;text-align:center}.doc-foot{margin-top:14pt;color:#777;font-size:9.5pt}</style></head><body>' +
      '<h2>证 据 目 录</h2>' +
      (caseName ? '<p style="text-align:center">案件：' + esc(caseName) + '</p>' : '') +
      '<table><thead><tr><th>序号</th><th>证据名称</th><th>来源</th><th>证明目的</th></tr></thead><tbody>' + tr + '</tbody></table>' +
      '<div class="doc-foot">说明：本目录由法律咨询助手自动生成，证明目的为建议表述，请结合案情调整；证据原件请单独装订编页。</div></body></html>';
  }
  function catalogWordDownload(rows) {
    var fname = "证据目录-" + (current() ? current().name : "案件") + ".doc";
    var html = catalogWord(rows, current() ? current().name : "");
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) { window.BRIDGE.exportFile(fname, html); return; }
    var blob = new Blob(["\ufeff" + html], { type: "application/msword" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------- UI：工作区弹层 ---------------- */
  function $(id) { return document.getElementById(id); }

  function renderSelect() {
    var sel = $("ws-select");
    if (!sel) return;
    var d = load();
    /* C4：活跃/已归档分组（归档不移出选择器，可随时找回） */
    if (!d.list.length) { sel.innerHTML = '<option value="">（尚无案件）</option>'; return; }
    var act = d.list.filter(function (c) { return !c.archived; });
    var arc = d.list.filter(function (c) { return c.archived; });
    var opt = function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === d.currentId ? " selected" : "") + '>' + esc(c.name) + '</option>'; };
    sel.innerHTML =
      (act.length ? '<optgroup label="活跃案件">' + act.map(opt).join("") + '</optgroup>' : "") +
      (arc.length ? '<optgroup label="已归档">' + arc.map(opt).join("") + '</optgroup>' : "");
  }

  function renderBody() {
    /* 结构保持式刷新：只切换空态/内容态显隐并刷新动态子区，
       绝不重写 #ws-body（否则会抹掉判决书/证据目录等静态 UI） */
    var c = current();
    var body = $("ws-body");
    if (!body) return;
    var empty = $("ws-empty"), content = $("ws-content");
    if (empty) empty.classList.toggle("hidden", !!c);
    if (content) content.classList.toggle("hidden", !c);
    if (!c) return;
    var dlAll = [];
    try { dlAll = JSON.parse(localStorage.getItem("legal-deadlines") || "[]"); } catch (e) { }
    /* 多案件仪表盘（F1）：各案一卡=名称+阶段+三线台账摘要+最近未完成期限，点击切换 */
    var ovBox = $("ws-overview");
    if (ovBox) {
      var dAll = load();
      /* C4：仪表盘只显示活跃案件（归档案在选择器「已归档」分组找回） */
      var cards = dAll.list.filter(function (cc) { return !cc.archived || cc.id === dAll.currentId; })
        .sort(function (a, b) { return (b.id === dAll.currentId ? 1 : 0) - (a.id === dAll.currentId ? 1 : 0); });
      ovBox.innerHTML = '<b style="font-size:13px">案件概览（' + cards.length + '）</b><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:6px 0 10px">' +
        cards.map(function (cc) {
          var sk2 = getStage(cc);
          var lg2 = cc.ledger || {};
          var spent2 = (lg2.spent || []).reduce(function (s2, e2) { return s2 + (parseFloat(e2.amount) || 0); }, 0);
          var next = null;
          (cc.links.deadlines || []).forEach(function (ld) {
            var it = dlAll.filter(function (x) { return x.name === ld.name && x.date === ld.date; })[0];
            if (it && it.done) return;
            if (!next || (ld.date && ld.date < next.date)) next = { date: ld.date, name: ld.name };
          });
          return '<div class="ws-ov-card' + (cc.id === dAll.currentId ? " on" : "") + '" data-ws-ov="' + esc(cc.id) + '">' +
            '<b style="font-size:12.5px">' + esc(cc.name) + (cc.id === dAll.currentId ? "（当前）" : "") + '</b>' +
            '<div style="font-size:11px;color:var(--ink-2);margin-top:2px">阶段：' + esc(sk2) +
            '｜请求：' + (lg2.claimTotal != null ? fmt(lg2.claimTotal) + " 元" : "—") +
            '｜支出：' + (spent2 ? fmt(spent2) + " 元" : "—") +
            '｜判得：' + (lg2.resultAmount ? fmt(lg2.resultAmount) + " 元" : "—") + '</div>' +
            (next ? '<div style="font-size:11px;color:var(--warn);margin-top:2px">最近期限：' + esc(next.date || "?") + " " + esc(next.name || "") + '</div>' : '') +
            '</div>';
        }).join("") + '</div>';
    }
    /* 案件阶段 stepper（B1，C1 八档键）：用户自报进度，节点色=已过绿/当前主色/未来灰；
       顶部阶段建议横幅（只建议不代改）+ 切阶段要点清单（STAGE_CHECKLIST 静态要点+既有工具入口） */
    var stageBox = $("ws-stage");
    var sug = "";
    if (stageBox) {
      var sk = getStage(c);
      var ki = STAGE_KEYS.indexOf(sk);
      if (c.result && ki < STAGE_KEYS.indexOf("执行")) {
        sug = '<div class="ws-sug">📄 已解析判决书——如文书已生效，建议推进阶段到「执行」：<button class="mini-btn ws-sug-go" data-stage="执行">一键推进</button><span class="dim" style="font-size:11px">（阶段始终由你自报，履行情况请到履行台账逐项勾记）</span></div>';
      } else if (ki < STAGE_KEYS.indexOf("已结案") && (c.links.deadlines || []).length) {
        var allDone = c.links.deadlines.every(function (ld) {
          var it = dlAll.filter(function (x) { return x.name === ld.name && x.date === ld.date; })[0];
          return it && it.done;
        });
        if (allDone) {
          sug = '<div class="ws-sug">✅ 本案期限已全部标记完成——如案件已了结：<button class="mini-btn ws-sug-go" data-stage="已结案">推进阶段到「已结案」</button><span class="dim" style="font-size:11px">（结案后可生成结案回顾并归档）</span></div>';
        }
      }
      var stItems = STAGE_KEYS.map(function (s, i) {
        return { label: s, sub: s === sk ? "当前" : (i < ki ? "已过" : ""), color: i < ki ? "var(--ok)" : s === sk ? "var(--primary)" : "var(--line-2)" };
      });
      var checklist = (STAGE_CHECKLIST[sk] || []).map(function (t) { return '<li style="margin:3px 0">' + esc(t) + '</li>'; }).join("");
      stageBox.innerHTML = sug + (window.SVGCHART && SVGCHART.stepper ? SVGCHART.stepper(stItems) : "") +
        '<div class="ws-stage-btns">' + STAGE_KEYS.map(function (s) {
          return '<button class="filter-chip ws-stage-set' + (s === sk ? " active" : "") + '" data-stage="' + esc(s) + '">' + s + '</button>';
        }).join("") +
        '<span class="dim" style="font-size:11px;align-self:center">阶段为自行标记，非程序进度承诺</span></div>' +
        '<div class="calc-detail" style="margin-top:8px"><b style="font-size:12px">「' + esc(sk) + '」阶段常见要点</b><ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;line-height:1.7">' + checklist + '</ul><div class="dim" style="font-size:11px;margin-top:5px">要点为常见参考，具体以你的案件与代理律师意见为准。</div>' +
        (sk === "已结案" ? '<button class="mini-btn primary" id="ws-closure-btn" style="margin-top:8px">生成结案回顾（时间线+文书+台账对比）</button>' : '') + '</div>';
    }
    /* 待确认事项 */
    var notes = $("ws-notes");
    if (notes) notes.innerHTML = c.notes.length
      ? c.notes.map(function (n, i) {
        return '<div class="flk-item" style="padding:6px 10px"><label class="check-line" style="margin:0"><input type="checkbox" data-ws-note="' + i + '"' + (n.done ? " checked" : "") + '> <span style="' + (n.done ? "text-decoration:line-through;opacity:.6" : "") + '">' + esc(n.text) + '</span></label><button class="mini-btn" data-ws-note-del="' + i + '" style="margin-left:auto">删</button></div>';
      }).join("")
      : '<div class="dim" style="font-size:12.5px">暂无待确认事项。</div>';
    /* 金额三线台账（B4，纯记账） */
    var lgBox = $("ws-ledger");
    if (lgBox) {
      var lg = c.ledger || {};
      var spentSum = (lg.spent || []).reduce(function (s, e) { return s + (parseFloat(e.amount) || 0); }, 0);
      var rows = [
        ["请求合计（诉请/仲裁请求）", lg.claimTotal],
        ["已支出（诉讼费/保全费等）", spentSum > 0 ? spentSum : null],
        ["判决/调解确定金额", lg.resultAmount ? parseFloat(lg.resultAmount) : null],
        ["已回收（履行台账勾记）", (parseFloat(lg.recovered) || 0) > 0 ? parseFloat(lg.recovered) : null]
      ];
      lgBox.innerHTML = '<div class="ws-ledger-grid">' + rows.map(function (r2) {
        return '<div class="flk-item" style="padding:7px 11px"><div style="font-size:11.5px;color:var(--ink-2)">' + r2[0] + '</div><b style="font-size:15px;color:var(--ink)">' + (r2[1] == null ? "—" : fmt(r2[1]) + " 元") + '</b></div>';
      }).join("") + '</div>' +
        ((lg.spent || []).length ? '<div style="margin-top:6px">' + lg.spent.map(function (e, i3) {
          var meta = [e.date, e.type, e.voucherNo ? "凭证 " + e.voucherNo : ""].filter(Boolean).join(" · ");
          return '<div style="font-size:12.5px;display:flex;gap:6px;align-items:center;padding:2px 0"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">· ' + esc(e.name) + '（' + fmt(e.amount) + ' 元）' + (meta ? '<span style="color:var(--ink-2)">　' + esc(meta) + '</span>' : '') + '</span><button class="mini-btn" data-ws-spent-del="' + i3 + '">删</button></div>';
        }).join("") + '</div>' : "") +
        '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><input id="ws-spent-name" maxlength="30" placeholder="费用名（如 诉讼费）" style="border:1px solid var(--line);border-radius:7px;padding:5px 9px;font-size:12.5px;flex:1;min-width:110px;background:var(--bg);color:var(--ink)"><input id="ws-spent-amt" type="number" min="0" placeholder="金额" style="border:1px solid var(--line);border-radius:7px;padding:5px 9px;font-size:12.5px;width:80px;background:var(--bg);color:var(--ink)"><select id="ws-spent-type" style="border:1px solid var(--line);border-radius:7px;padding:5px 6px;font-size:12.5px;background:var(--bg);color:var(--ink)"><option>诉讼费</option><option>保全费</option><option>公证费</option><option>鉴定费</option><option>律师费</option><option>差旅</option><option>其他</option></select><input id="ws-spent-date" type="date" style="border:1px solid var(--line);border-radius:7px;padding:4px 6px;font-size:12.5px;background:var(--bg);color:var(--ink)"><input id="ws-spent-vno" maxlength="30" placeholder="凭证号(可选)" style="border:1px solid var(--line);border-radius:7px;padding:5px 9px;font-size:12.5px;width:100px;background:var(--bg);color:var(--ink)"><button class="mini-btn" id="ws-spent-add">记一笔</button><button class="mini-btn" id="ws-ledger-word">导出台账</button></div>' +
        '<div class="calc-note">纯记账：只汇总你录入与判决解析出的数字，不预测结果、不推算「能拿回多少」。</div>';
    }
    /* 判决信息卡（B2）+ C3 履行跟踪台账（判决生效后对方履行情况记录） */
    var resBox = $("ws-result");
    if (resBox) {
      var rj = c.result;
      var todayStr = new Date().toISOString().slice(0, 10);
      var perfList = (c.performance || []).map(function (p, pi) {
        var od = perfOverdue(p, todayStr);
        var done = p.status === "done";
        /* ②迟延履行利息估算（民诉法 260 条：加倍部分日万分之 1.75）——纯法定费率算术，估算参考 */
        var lateInt = "";
        if (od && p.amount) {
          var days = Math.round((new Date(todayStr + "T00:00:00") - new Date(p.due + "T00:00:00")) / 86400000);
          var est = Math.round(p.amount * days * 0.000175);
          if (est > 0) lateInt = '<span style="color:var(--ink-2)">　预估迟延履行利息 ≈ ' + fmt(est) + ' 元（' + days + ' 天）</span>';
        }
        return '<div style="font-size:12.5px;display:flex;gap:6px;align-items:center;padding:3px 0">' +
          '<input type="checkbox" data-ws-perf="' + pi + '"' + (done ? " checked" : "") + ' title="标记已履行"> ' +
          '<span style="flex:1;min-width:0;' + (done ? "text-decoration:line-through;opacity:.55" : od ? "color:var(--danger);font-weight:600" : "") + '">· ' + esc(p.item) +
          (p.amount ? '（' + fmt(p.amount) + ' 元）' : '') +
          (p.due ? '<span style="color:var(--ink-2)">　期限 ' + esc(p.due) + '</span>' : '') +
          (od ? '<span style="color:var(--danger)">　⚠ 已逾期</span>' : '') + lateInt +
          (done && p.doneAt ? '<span style="color:var(--ok)">　✓ ' + p.doneAt.slice(0, 10) + ' 勾记</span>' : '') +
          '</span>' +
          '<button class="mini-btn" data-ws-perf-del="' + pi + '">删</button></div>';
      }).join("");
      var overdueCount = (c.performance || []).filter(function (p) { return perfOverdue(p, todayStr); }).length;
      resBox.innerHTML = (rj
        ? '<div class="flk-item" style="padding:8px 12px"><div style="font-size:12.5px;color:var(--ink)">案号：' + esc(rj.caseNo || "—") + ' · 法院：' + esc(rj.court || "—") + '</div>' +
          '<div style="font-size:12.5px;color:var(--ink-2);margin-top:3px">落款日：' + esc(rj.judgmentDate || "—") + (rj.amount ? ' · 履行金额：' + esc(rj.amount) + ' 元' : '') + '（' + esc(rj.docType === "second" ? "二审" : rj.docType === "mediation" ? "调解书" : "一审") + '，' + (rj.at || "").slice(0, 10) + ' 保存）</div>' +
          '<button class="mini-btn" data-ws-result-clear style="margin-top:6px">清除判决信息</button></div>'
        : '<div class="dim" style="font-size:12.5px">（尚未保存——在下方解析判决书后自动保存，执行申请书跨会话可复用）</div>') +
        '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)"><b style="font-size:12.5px">履行跟踪台账</b><span class="dim" style="font-size:11px">（判决/调解生效后对方履行情况，逐项勾记自动累计「已回收」）</span>' +
        (overdueCount ? '<div class="tool-warn" style="margin-top:6px">⚠ 有 ' + overdueCount + ' 项履行已逾期——可一键生成执行申请书申请强制执行：<button class="mini-btn" data-ws-enforce-run>执行申请书（自动填充）</button></div>' : '') +
        ((c.performance || []).length
          ? '<div style="margin-top:6px">' + perfList + '</div>'
          : '<div class="dim" style="font-size:12px;margin-top:6px">暂无履行项——判决/调解落盘后自动带出金额项，也可手动添加。</div>') +
        '<div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap"><input id="ws-perf-item" maxlength="80" placeholder="履行项（如 支付二倍工资差额）" style="border:1px solid var(--line);border-radius:7px;padding:5px 9px;font-size:12.5px;flex:1;min-width:130px;background:var(--bg);color:var(--ink)"><input id="ws-perf-amt" type="number" min="0" placeholder="金额" style="border:1px solid var(--line);border-radius:7px;padding:5px 9px;font-size:12.5px;width:88px;background:var(--bg);color:var(--ink)"><input id="ws-perf-due" type="date" style="border:1px solid var(--line);border-radius:7px;padding:4px 6px;font-size:12.5px;background:var(--bg);color:var(--ink)"><button class="mini-btn" id="ws-perf-add">记一笔履行项</button></div>' +
        '<div class="calc-note">履行台账只记录勾记事实，不预测对方是否会履行；利息为法定费率（日万分之 1.75 加倍部分）估算参考，以执行法院核算为准。逾期请自行评估并咨询律师。</div></div>';
    }
    /* 自动归集区（B5：渲染时校验源数据存在性，悬空引用明示；+ 关联已有 支持逆向绑定） */
    var links = $("ws-links");
    if (!links) return;
    var lk = c.links;
    var idSets = {
      reports: (function () { try { var m = {}; (JSON.parse(localStorage.getItem("legal-agent-reports") || "[]")).forEach(function (x) { m[x.id] = 1; }); return m; } catch (e) { return {}; } })(),
      sessions: (function () { try { var m2 = {}; if (window.CHATHISTORY) CHATHISTORY.list(false).concat(CHATHISTORY.list(true)).forEach(function (s2) { m2[s2.id] = 1; }); return m2; } catch (e) { return {}; } })(),
      cases: (function () { try { var m3 = {}; (JSON.parse(localStorage.getItem("legal-case-imports") || "[]")).forEach(function (x) { m3[x.id] = 1; }); return m3; } catch (e) { return {}; } })()
    };
    var sec = function (title, arr, empty, kind) {
      var addBtn = (kind && (kind === "reports" || kind === "cases" || kind === "sessions" || kind === "deadlines"))
        ? ' <button class="mini-btn ws-link-add" data-kind="' + kind + '" style="font-size:11px;padding:2px 9px;vertical-align:1px">＋ 关联已有</button>' : "";
      return '<div><b style="font-size:13px">' + title + '（' + arr.length + '）</b>' + addBtn +
        '<div style="font-size:12.5px;color:var(--ink-2);margin-top:4px">' +
        (arr.length ? arr.map(function (r) {
          var dead = kind && idSets[kind] && r.id && !idSets[kind][r.id];
          return "· " + esc(r.name) + (r.date ? "（" + esc(r.date) + "）" : "") + (dead ? ' <span style="color:var(--warn)">已失效——源数据已删除/被清理</span>' : "");
        }).join("<br>") : empty) + '</div></div>';
    };
    links.innerHTML =
      sec("关联分析报告", lk.reports, "（激活案件后，深度分析「存入报告库」自动归集）", "reports") +
      sec("文书草稿", lk.docs || [], "（生成文书后点「存入案件工作区」）") +
      sec("期限与提醒", lk.deadlines, "（激活案件后，合规日历添加自动归集）", "deadlines") +
      sec("关联案例", lk.cases, "（激活案件后，案例粘贴导入自动归集）", "cases") +
      sec("关联会话", lk.sessions || [], "（激活案件后，咨询会话自动绑定，点击下方回看）", "sessions");
  }

  /* ---------------- 庭前文书（v3.6.1）：按最近关联报告的场景生成质证/提纲 ---------------- */
  function latestReportScenario() {
    var c = current();
    if (!c || !(c.links.reports || []).length) return "";
    var ids = {};
    try {
      (JSON.parse(localStorage.getItem("legal-agent-reports") || "[]")).forEach(function (r) { ids[r.id] = r.scenarioId || ""; });
    } catch (e) { return ""; }
    for (var i = 0; i < c.links.reports.length; i++) {
      var sid = ids[c.links.reports[i].id];
      if (sid) return sid;
    }
    return "";
  }
  function wsDocWin(title, text) {
    var old = document.getElementById("ws-doc-win");
    if (old) old.remove();
    var m = document.createElement("div");
    m.id = "ws-doc-win";
    m.className = "modal";
    m.innerHTML = '<div class="modal-mask"></div><div class="modal-card" style="width:min(680px,calc(100vw - 32px))">' +
      '<div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-body"><textarea class="doc-textarea" rows="16" style="width:100%;box-sizing:border-box">' + esc(text) + '</textarea></div>' +
      '<div class="modal-foot"><button id="ws-doc-copy">复制全文</button><button id="ws-doc-dl">下载 .txt</button><button id="ws-doc-close">关闭</button></div></div>';
    document.body.appendChild(m);
    m.querySelector(".modal-mask").addEventListener("click", function () { m.remove(); });
    m.querySelector("#ws-doc-close").addEventListener("click", function () { m.remove(); });
    m.querySelector("#ws-doc-copy").addEventListener("click", function () {
      try { navigator.clipboard.writeText(text).then(function () { }, function () { }); } catch (e) { }
      this.textContent = "已复制";
      var b = this;
      setTimeout(function () { b.textContent = "复制全文"; }, 1500);
    });
    m.querySelector("#ws-doc-dl").addEventListener("click", function () {
      var fname = title.replace(/[\\/:*?"<>|]/g, "_") + ".txt";
      if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) { window.BRIDGE.exportFile(fname, text); return; }
      var blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    });
  }
  /* 票据台账 Word 导出（v3.6.1）：复用证据目录表格模式 */
  function ledgerWord() {
    var c = current();
    if (!c) return;
    var lg = c.ledger || {};
    var spent = lg.spent || [];
    if (!spent.length) {
      var o = $("ws-court-out");
      if (o) o.innerHTML = '<div class="tool-warn">暂无支出记录——先在台账记一笔。</div>';
      return;
    }
    var sum = spent.reduce(function (s, e) { return s + (parseFloat(e.amount) || 0); }, 0);
    var tr = spent.map(function (e, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.type || "—") + '</td><td>' + esc(e.date || "—") + '</td><td style="text-align:right">' + fmt(e.amount) + '</td><td>' + esc(e.voucherNo || "—") + '</td></tr>';
    }).join("");
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="zh-CN"><head><meta charset="utf-8"><title>费用台账</title>' +
      '<style>body{font-family:"Microsoft YaHei",SimSun,sans-serif;font-size:12pt;margin:24pt}h2{font-size:15pt;text-align:center}table{border-collapse:collapse;width:100%}th,td{border:1pt solid #333;padding:5pt 7pt;font-size:10.5pt}th{background:#eee;text-align:center}.doc-foot{margin-top:14pt;color:#777;font-size:9.5pt}</style></head><body>' +
      '<h2>费 用 台 账</h2><p style="text-align:center">案件：' + esc(c.name) + '</p>' +
      '<table><thead><tr><th>序号</th><th>费用名</th><th>类型</th><th>发生日期</th><th>金额(元)</th><th>凭证号</th></tr></thead><tbody>' + tr +
      '</tbody></table><p style="text-align:right">合计：' + fmt(sum) + ' 元</p>' +
      '<div class="doc-foot">说明：本台账由法律咨询助手在本机生成，纯记账用途，请以票据原件为准；不构成法律意见。</div></body></html>';
    var fname = "费用台账-" + c.name + ".doc";
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) { window.BRIDGE.exportFile(fname, html); return; }
    var blob = new Blob(["\ufeff" + html], { type: "application/msword" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------- 逆向关联选择器（B5）：把存量报告/案例/会话/日历事后绑进当前案件 ---------------- */
  function linkPicker(kind) {
    var c = current();
    if (!c) return;
    var src = [];
    if (kind === "reports") {
      try { (JSON.parse(localStorage.getItem("legal-agent-reports") || "[]")).forEach(function (r) { src.push({ id: r.id, name: String(r.q || "（无题报告）").slice(0, 60), date: String(r.date || "").slice(0, 10) }); }); } catch (e) { }
    } else if (kind === "cases") {
      try { (JSON.parse(localStorage.getItem("legal-case-imports") || "[]")).forEach(function (r) { src.push({ id: r.id, name: r.title || "（无题案例）", date: "" }); }); } catch (e) { }
    } else if (kind === "sessions") {
      if (window.CHATHISTORY) CHATHISTORY.list(false).concat(CHATHISTORY.list(true)).forEach(function (s) { src.push({ id: s.id, name: s.title || "（无题会话）", date: "" }); });
    } else if (kind === "deadlines") {
      try { (JSON.parse(localStorage.getItem("legal-deadlines") || "[]")).forEach(function (r) { src.push({ id: null, name: r.name, date: r.date }); }); } catch (e) { }
    }
    var linked = c.links[kind === "deadlines" ? "deadlines" : kind] || [];
    var fresh = src.filter(function (s) {
      return !linked.some(function (x) { return s.id ? x.id === s.id : (x.name === s.name && x.date === s.date); });
    });
    var old = document.getElementById("ws-link-picker");
    if (old) old.remove();
    var modal = document.createElement("div");
    modal.id = "ws-link-picker";
    modal.className = "modal";
    modal.innerHTML = '<div class="modal-mask"></div><div class="modal-card" style="width:min(520px,calc(100vw - 32px));max-height:80vh;overflow-y:auto">' +
      '<div class="modal-title">关联已有' + (kind === "reports" ? "报告" : kind === "cases" ? "案例" : kind === "sessions" ? "会话" : "日历事项") + '</div>' +
      '<div class="modal-body" id="ws-lp-body">' +
      (fresh.length ? fresh.map(function (s, i) {
        return '<button class="exp-opt ws-link-pick" data-i="' + i + '"><b>' + esc(s.name) + '</b><span>' + esc(s.date || "") + '</span></button>';
      }).join("") : '<div class="empty" style="font-size:13px">没有可关联的项——都已关联或源数据为空。</div>') +
      '</div><div class="modal-foot"><button id="ws-lp-close">关闭</button></div></div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#ws-lp-close").addEventListener("click", function () { modal.remove(); });
    modal.querySelectorAll(".ws-link-pick").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = fresh[parseInt(b.getAttribute("data-i"), 10)];
        if (s) attach(kind, s);
        modal.remove();
      });
    });
  }

  function renderAll() { renderSelect(); renderBody(); }

  function openModal() {
    /* v3.6.0：工作区独立成页——切页并刷新；旧弹层结构仅作兼容兜底 */
    renderAll();
    if (window.APP && APP.switchView && document.getElementById("view-workspace")) {
      APP.switchView("workspace");
      return;
    }
    var m = $("ws-modal");
    if (m) m.classList.remove("hidden");
  }
  function closeModal() {
    var m = $("ws-modal");
    if (m) m.classList.add("hidden");
  }

  function downloadMd() {
    var c = current();
    if (!c) return;
    var md = toMarkdown(c), fname = "案件档案-" + c.name + ".md";
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) { window.BRIDGE.exportFile(fname, md); return; }
    try {
      var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    } catch (e) { }
  }

  /* ---------------- 方向二：执行阶段工具包 ---------------- */
  var PROPERTY_LIST =
    "财产线索清单（执行阶段自查，提供给法院执行局）\n\n" +
    "一、银行存款：列出对方可能开户的全部银行（工资行/房贷行/常用行），可申请网络查控（法院一键查询全国银行账户）\n" +
    "二、微信/支付宝：财付通、支付宝余额与流水（法院可冻结划扣；注意零钱通/理财）\n" +
    "三、不动产：房产（本人/配偶/未成年子女名下）、土地、车位——可查不动产登记中心，请求查封\n" +
    "四、车辆：机动车登记信息（车牌号尽量提供），可查封并扣押\n" +
    "五、股权与证券：公司股权（工商登记可查）、股票基金账户\n" +
    "六、应收账款与债权：对方对第三人的到期债权（工资、工程款、租金），可申请冻结代扣\n\n" +
    "线索提供越具体越有效：账号/车牌/产权坐落尽量写全。\n" +
    "对方转移财产的：可主张撤销转让（民法典538/539条），并留意拒不执行判决裁定罪（刑法313条）的追责可能。";

  function buildEnforce(j) {
    function fb(v, ph) { return v && v.trim() ? v.trim() : "【" + ph + "】"; }
    var amt = j.amount || "";
    return "强制执行申请书\n\n" +
      "申请人（申请执行人）：" + fb(j.plaintiff, "原告姓名——请核对判决书首部") + "\n" +
      "被申请人（被执行人）：" + fb(j.defendant, "被告姓名/名称——请核对判决书首部") + "\n\n" +
      "申请人依据" + fb(j.court, "执行法院") + "作出的（案号：" + fb(j.caseNo, "案号") + "）民事判决书，被申请人未在履行期限内履行义务。现该判决已发生法律效力，被申请人拒不履行，特申请强制执行。\n\n" +
      "执行请求：\n" +
      "一、请求强制被申请人履行判决确定的义务" + (amt ? "（含返还/支付人民币 " + fmt(amt) + " 元及迟延履行利息）" : "") + "；\n" +
      "二、执行费用由被申请人承担。\n\n" +
      "事实与理由：\n判决生效后，被申请人经催告仍拒不履行（可附催告记录）。为维护申请人合法权益，依据《民事诉讼法》第二百四十六条（申请执行期间二年）之规定，特提出本申请。\n\n" +
      "附：1. 生效判决书/调解书原件；2. 申请人身份证明；3. 财产线索清单（见另附）。\n\n" +
      "此致\n" + fb(j.court, "执行法院") + "\n\n申请人（签名）：\n" + (j.judgmentDate ? "判决落款日：" + j.judgmentDate + "\n" : "") + "申请日期：【填写】\n\n" +
      "※ 提示：申请执行期间为 2 年（自履行期限届满日起算）；执行局可网络查控银行/微信/支付宝/车辆——建议同时提交《财产线索清单》。\n" +
      "※ 本文书由本机自动填充，【】内容与当事人信息请核对判决书原件后填写。";
  }

  function printOnePager(c) {
    var dl = (c.links.deadlines || []).slice(0, 4);
    var docs = (c.links.docs || []).slice(0, 5);
    var wrap = document.createElement("div");
    wrap.className = "print-target";
    wrap.style.cssText = "font-family:sans-serif;color:#111;font-size:13px;line-height:1.9;padding:8px 4px";
    wrap.innerHTML = '<h2 style="margin:0 0 6px;font-size:19px">案件摘要 · ' + esc(c.name) + '</h2>' +
      '<div style="color:#555;font-size:11px;margin-bottom:10px">生成于本机 · ' + new Date().toISOString().slice(0, 10) + ' · 不构成法律意见</div>' +
      '<h3 style="font-size:14px;margin:10px 0 4px">待确认事项</h3>' +
      (c.notes.length ? '<ul style="margin:0;padding-left:18px">' + c.notes.map(function (n) { return '<li style="' + (n.done ? "text-decoration:line-through;color:#888" : "") + '">' + esc(n.text) + '</li>'; }).join("") + '</ul>' : '<div>（无）</div>') +
      '<h3 style="font-size:14px;margin:10px 0 4px">关键期限</h3>' +
      (dl.length ? '<ul style="margin:0;padding-left:18px">' + dl.map(function (r) { return '<li>' + esc(r.date || "") + "　" + esc(r.name) + '</li>'; }).join("") + '</ul>' : '<div>（暂无）</div>') +
      '<h3 style="font-size:14px;margin:10px 0 4px">已准备文书与材料</h3>' +
      (docs.length ? '<ul style="margin:0;padding-left:18px">' + docs.map(function (r) { return '<li>' + esc(r.name) + '</li>'; }).join("") + '</ul>' : '<div>（暂无）</div>') +
      '<div style="margin-top:14px;font-size:11px;color:#777">以上内容由法律咨询助手按用户录入信息生成，仅供个人整理使用，不构成法律意见。</div>';
    document.body.appendChild(wrap);
    document.body.classList.add("print-mode");
    var done = function () { document.body.classList.remove("print-mode"); wrap.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
    setTimeout(done, 3000);
  }

  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    else {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {} ta.remove();
    }
  }

  /* ①文书统一落盘：docWinModal 全出口（质证/庭审提纲/执行申请书/财产线索/结案回顾）
     自带「存入案件工作区」——文书生成即归档，不再刷新即丢 */
  function docWinModal(title, text) {
    var w = document.createElement("div");
    w.className = "modal";
    var has = !!current();
    w.innerHTML = '<div class="modal-mask"></div><div class="modal-card" style="max-width:720px;width:94%"><div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-body" style="max-height:56vh;overflow-y:auto"><textarea readonly style="width:100%;min-height:40vh;font-size:13px;line-height:1.8;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);box-sizing:border-box">' + esc(text) + '</textarea></div>' +
      '<div class="modal-foot"><button class="primary dw-copy">复制全文</button><button class="mini-btn dw-ws-save" data-wsdoc-title="' + esc(title).replace(/"/g, "&quot;") + '"' + (has ? "" : " disabled title=\"未激活案件：先新建/选择案件后可存\"") + '><svg class=ico><use href=#i-save></use></svg> 存入案件工作区</button><button class="dw-close">关闭</button></div></div>';
    document.body.appendChild(w);
    w.querySelector(".modal-mask").addEventListener("click", function () { w.remove(); });
    w.querySelector(".dw-close").addEventListener("click", function () { w.remove(); });
    w.querySelector(".dw-copy").addEventListener("click", function () {
      copy(text);
      var b = w.querySelector(".dw-copy"); b.textContent = "已复制";
      setTimeout(function () { b.textContent = "复制全文"; }, 1500);
    });
    w.querySelector(".dw-ws-save").addEventListener("click", function () {
      var b = this;
      var ok = attach("docs", { name: String(title).slice(0, 60), date: new Date().toISOString().slice(0, 10), draft: String(text).slice(0, 4000) });
      if (ok && window.TOOLS && TOOLS.haptic) TOOLS.haptic(12);
      b.innerHTML = ok ? "✓ 已存入案件工作区" : "未激活案件，未存入";
      setTimeout(function () { b.innerHTML = '<svg class=ico><use href=#i-save></use></svg> 存入案件工作区'; }, 1800);
    });
  }

  /* 轻量输入弹层（v3.6.1）：替代原生 prompt——App 内 WebView 无 onJsPrompt 桥，
     prompt 静默返回 null 使「新建/重命名案件」失效；本弹层双端一致。 */
  function wsPrompt(title, def, cb) {
    var old = document.getElementById("ws-prompt");
    if (old) old.remove();
    var m = document.createElement("div");
    m.id = "ws-prompt";
    m.className = "modal";
    m.innerHTML = '<div class="modal-mask"></div><div class="modal-card" style="width:min(420px,calc(100vw - 40px))">' +
      '<div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-body"><input id="ws-prompt-input" maxlength="40" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:14px;background:var(--bg);color:var(--ink)" value="' + esc(def || "") + '"></div>' +
      '<div class="modal-foot"><button id="ws-prompt-cancel">取消</button><button id="ws-prompt-ok" class="primary">确定</button></div></div>';
    document.body.appendChild(m);
    var inp = m.querySelector("#ws-prompt-input");
    setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) { } }, 60);
    m.querySelector(".modal-mask").addEventListener("click", function () { m.remove(); });
    m.querySelector("#ws-prompt-cancel").addEventListener("click", function () { m.remove(); });
    m.querySelector("#ws-prompt-ok").addEventListener("click", function () {
      var v = inp.value.trim();
      m.remove();
      cb(v);
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { var v = inp.value.trim(); m.remove(); cb(v); } });
  }

  /* 绑定守卫：元素存在才挂监听（v3.6.1——页面化后 ws-modal 消失曾使 init 提前 return、全部委托失效） */
  function on(id, ev, fn) {
    var el = $(id);
    if (el) el.addEventListener(ev, fn);
  }

  function init() {
    var open = $("ws-open-btn");
    if (open) open.addEventListener("click", openModal);
    var modal = $("ws-modal");
    if (modal) {   /* 旧弹层结构兼容（页面化后此块不存在） */
      var wsCloseBtn = $("ws-close");
      if (wsCloseBtn) wsCloseBtn.addEventListener("click", closeModal);
      var maskEl = modal.querySelector(".modal-mask");
      if (maskEl) maskEl.addEventListener("click", closeModal);
    }
    on("ws-select", "change", function () { if (this.value) setCurrent(this.value); renderBody(); });
    on("ws-new", "click", function () {
      wsPrompt("新建案件（如：与某公司劳动仲裁）", "", function (name) {
        create(name || "未命名案件");
        renderAll();
      });
    });
    on("ws-rename", "click", function () {
      var c = current();
      if (!c) return;
      wsPrompt("重命名案件：", c.name, function (name) {
        if (name) { rename(c.id, name); renderAll(); }
      });
    });
    on("ws-del", "click", function () {
      var c = current();
      if (!c) return;
      if (!confirm("删除案件「" + c.name + "」？\n仅解除关联，不删除底层报告/日历/案例数据。")) return;
      remove(c.id);
      renderAll();
    });
    on("ws-note-add", "click", function () {
      var inp = $("ws-note-input");
      if (inp.value.trim()) { addNote(inp.value.trim()); inp.value = ""; renderBody(); }
    });
    on("ws-notes", "change", function (e) {
      var i = e.target.getAttribute("data-ws-note");
      if (i != null) { toggleNote(Number(i)); renderBody(); }
    });
    on("ws-notes", "click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-ws-note-del]") : null;
      if (b) { removeNote(Number(b.getAttribute("data-ws-note-del"))); renderBody(); }
    });
    on("ws-export", "click", downloadMd);
    /* 判决书双时间线 */
    $("ws-judg-parse").addEventListener("click", function () {
      var text = $("ws-judg-input").value;
      if (!text.trim()) { $("ws-judg-out").innerHTML = '<div class="tool-warn">请先粘贴判决书/调解书全文或尾部。</div>'; return; }
      renderJudgmentTL(text, $("ws-judg-type").value);
    });
    /* 判决书 docx 直传（v3.4.5）：裁判文书网下载的判决书免复制粘贴，提取后自动解析并落盘 */
    var judgDocx = $("ws-judg-docx");
    if (judgDocx) judgDocx.addEventListener("click", function () {
      if (!(window.ATTACH && ATTACH.pick)) return;
      ATTACH.pick(".docx").then(function (f) {
        if (!f) return null;
        return ATTACH.extractFile(f).then(function (res) {
          if (!res || res.error) { $("ws-judg-out").innerHTML = '<div class="tool-warn">' + ((res && res.error) || "提取失败") + "</div>"; return null; }
          $("ws-judg-input").value = res.text + (res.truncated ? "\n（附件过长已截断至 2 万字）" : "");
          renderJudgmentTL($("ws-judg-input").value, $("ws-judg-type").value);
          return null;
        });
      }).catch(function (e) {
        var out = $("ws-judg-out");
        if (out) out.innerHTML = '<div class="tool-warn">' + (e && e.message || e) + "</div>";
      });
    });
    /* 证据目录生成 */
    $("ws-ev-gen").addEventListener("click", function () {
      renderCatalog(buildCatalog($("ws-ev-input").value));
    });
    $("ws-ev-word").addEventListener("click", function () {
      if (catalogRows.length) catalogWordDownload(catalogRows);
    });
    /* 关联会话回看（点击切回对应会话并跳到咨询视图） */
    var linksBox = $("ws-links");
    if (linksBox) linksBox.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".ws-sess-open") : null;
      if (!b) return;
      var sid = b.getAttribute("data-sid");
      if (window.CHATHISTORY && window.CHATHISTORY.switchTo) window.CHATHISTORY.switchTo(sid);
      var tab = document.querySelector('.nav-tab[data-view="consult"]');
      if (tab) tab.click();
      closeModal();
    });
    /* 执行阶段工具（方向二）：优先本会话解析结果，其次案件落盘的判决信息（B2 解耦同会话依赖） */
    var execEnforce = $("ws-exec-enforce");
    if (execEnforce) execEnforce.addEventListener("click", function () {
      var j = lastJudg, fromSaved = false;
      if (!j) { j = getCaseResult(); fromSaved = !!j; }
      if (!j) {
        var out = $("ws-exec-out");
        if (out) out.innerHTML = '<div class="tool-warn">请先在上方粘贴判决书并解析生成双时间线；解析结果会自动保存到案件，下次打开无需重新粘贴。</div>';
        return;
      }
      docWinModal("执行申请书（自动填充" + (fromSaved ? "·已保存判决信息" : "") + "）", buildEnforce(j));
    });
    var execList = $("ws-exec-list");
    if (execList) execList.addEventListener("click", function () {
      docWinModal("财产线索清单（执行阶段自查）", PROPERTY_LIST);
    });
    var printBtn = $("ws-onepager");
    if (printBtn) printBtn.addEventListener("click", printOnePager);
    /* 律师交接包（F2）：复用 pack.js 零依赖 zip 写入器，结构化给律师快速了解案情 */
    var hvBtn = $("ws-handover");
    if (hvBtn) hvBtn.addEventListener("click", function () {
      var c = current();
      if (!c) return;
      if (!(window.PACK && PACK.download)) return;
      var lg3 = c.ledger || {};
      var spent3 = (lg3.spent || []).reduce(function (s3, e3) { return s3 + (parseFloat(e3.amount) || 0); }, 0);
      var evEl = $("ws-ev-input");
      var evText = evEl && evEl.value.trim() ? evEl.value.trim() : "（未录入）";
      var files = [
        { name: "00-交接说明.txt", content: "案件交接包（律师版）\n\n生成：法律咨询助手（本机），时间 " + new Date().toLocaleString("zh-CN") + "\n用途：供律师/法律援助快速了解案情；内容均为用户录入或程序从用户材料提取的客观数据。\n\n免责：本包内容仅供参考，不构成法律意见；材料真实性以原件为准，请由执业律师核验。" },
        { name: "01-案件概要.md", content: "# 案件概要：" + c.name + "\n\n- 阶段：" + getStage(c) + "（自报）\n- 创建：" + c.createdAt.slice(0, 10) + "\n\n## 金额四线\n- 请求合计：" + (lg3.claimTotal != null ? fmt(lg3.claimTotal) + " 元" : "未记录") + "\n- 已支出：" + (spent3 ? fmt(spent3) + " 元" : "未记录") + "\n- 判决/调解确定：" + (lg3.resultAmount ? fmt(lg3.resultAmount) + " 元" : "未记录") + "\n- 已回收：" + ((parseFloat(lg3.recovered) || 0) > 0 ? fmt(lg3.recovered) + " 元" : "未记录") + "\n\n## 判决信息\n" + (c.result ? "- 案号：" + c.result.caseNo + "\n- 法院：" + c.result.court + "\n- 落款日：" + c.result.judgmentDate + "\n- 履行金额：" + c.result.amount + " 元" : "（未保存）") + "\n\n## 待确认事项\n" + (c.notes.length ? c.notes.map(function (n) { return "- [" + (n.done ? "x" : " ") + "] " + n.text; }).join("\n") : "（无）") + "\n" },
        { name: "02-期限与文书.txt", content: "## 期限\n" + ((c.links.deadlines || []).map(function (r) { return "- " + (r.date || "?") + " " + r.name; }).join("\n") || "（无）") + "\n\n## 文书草稿\n" + ((c.links.docs || []).map(function (r) { return "- " + (r.date || "") + " " + r.name; }).join("\n") || "（无）") + "\n\n## 关联分析报告\n" + ((c.links.reports || []).map(function (r) { return "- " + (r.date || "") + " " + r.name; }).join("\n") || "（无）") + "\n\n## 关联案例\n" + ((c.links.cases || []).map(function (r) { return "- " + r.name; }).join("\n") || "（无）") + "\n" },
        { name: "03-证据目录.txt", content: evText + "\n" },
        /* ⑤结案收尾：结案回顾并入交接包第五文件（律师一次拿到完整复盘） */
        { name: "05-结案回顾.md", content: buildClosureReport(c) }
      ];
      PACK.download("案件交接-" + c.name + ".zip", files);
      if (window.TOOLS && TOOLS.haptic) TOOLS.haptic(12);
    });
    /* ---- B1/B2/B4/B5 控件：事件委托挂 #ws-body，renderBody 重建 DOM 后仍生效 ---- */
    var wsBodyEl = $("ws-body");
    if (wsBodyEl) wsBodyEl.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;
      var ovCard = e.target.closest("[data-ws-ov]");
      if (ovCard) { setCurrent(ovCard.getAttribute("data-ws-ov")); renderAll(); return; }
      var sugGo = e.target.closest(".ws-sug-go");
      if (sugGo) { setStage(sugGo.getAttribute("data-stage")); renderBody(); return; }
      var stageBtn = e.target.closest(".ws-stage-set");
      if (stageBtn) {
        var sk = stageBtn.getAttribute("data-stage");
        setStage(sk);
        /* C4：推进到「已结案」时询问是否归档（移出活跃列表，不删数据可找回）；
           ⑤如实提示未完成日历提醒数量（不自动删，用户自行决定保留跟踪） */
        if (sk === "已结案") {
          var cur2 = current();
          if (cur2 && !cur2.archived) {
            var dlAll3 = [];
            try { dlAll3 = JSON.parse(localStorage.getItem("legal-deadlines") || "[]"); } catch (e) { }
            var openDl = (cur2.links.deadlines || []).filter(function (ld) {
              var it = dlAll3.filter(function (x) { return x.name === ld.name && x.date === ld.date; })[0];
              return !it || !it.done;
            }).length;
            if (confirm("是否同时归档本案？" + (openDl ? "\n\n注意：本案还有 " + openDl + " 条未标记完成的日历提醒——归档不移出合规日历，将按原样继续保留跟踪。" : "") + "\n\n归档后移出活跃列表与仪表盘（选择器「已归档」分组可随时找回，不删除任何数据）。")) {
              setArchived(cur2.id, true);
              renderAll();
              return;
            }
          }
        }
        renderBody();
        return;
      }
      if (e.target.closest("#ws-closure-btn")) { closureReportCurrent(); return; }
      var spentDel = e.target.closest("[data-ws-spent-del]");
      if (spentDel) { removeSpent(parseInt(spentDel.getAttribute("data-ws-spent-del"), 10)); renderBody(); return; }
      /* ③U3 取证打卡：勾记存当前案件 evTaken（名→取证日期），重渲染目录更新进度 */
      var evTake = e.target.closest("[data-ev-take]");
      if (evTake) {
        var evName = evTake.getAttribute("data-ev-take");
        withCurrent(function (cc) {
          cc.evTaken = cc.evTaken || {};
          if (evTake.checked) cc.evTaken[evName] = new Date().toISOString().slice(0, 10);
          else delete cc.evTaken[evName];
        });
        renderCatalog(catalogRows);
        return;
      }
      /* C3 履行台账：勾选/删除/添加/逾期一键执行申请书 */
      var perfChk = e.target.closest("[data-ws-perf]");
      if (perfChk) { togglePerf(parseInt(perfChk.getAttribute("data-ws-perf"), 10)); return; }
      var perfDel = e.target.closest("[data-ws-perf-del]");
      if (perfDel) { removePerf(parseInt(perfDel.getAttribute("data-ws-perf-del"), 10)); return; }
      if (e.target.closest("#ws-perf-add")) {
        var pi = $("ws-perf-item"), pa = $("ws-perf-amt"), pd = $("ws-perf-due");
        var createdP = pi && pi.value.trim() ? addPerf(pi.value, pa ? pa.value : "", pd ? pd.value : "") : null;
        if (createdP && window.TOOLS && TOOLS.haptic) TOOLS.haptic(10);
        return;
      }
      if (e.target.closest("[data-ws-enforce-run]")) {
        var execBtn = $("ws-exec-enforce");
        if (execBtn) { execBtn.scrollIntoView({ block: "center" }); execBtn.classList.add("armed"); setTimeout(function () { execBtn.classList.remove("armed"); }, 1800); }
        return;
      }
      if (e.target.closest("[data-ws-result-clear]")) { clearCaseResult(); renderBody(); return; }
      var linkAdd = e.target.closest(".ws-link-add");
      if (linkAdd) { linkPicker(linkAdd.getAttribute("data-kind")); return; }
      if (e.target.closest("#ws-court-critique") || e.target.closest("#ws-court-outline")) {
        var kind = e.target.closest("#ws-court-critique") ? "court-critique" : "court-outline";
        var sid = latestReportScenario();
        if (!sid || !(window.DOCTPL)) {
          var o1 = $("ws-court-out");
          if (o1) o1.innerHTML = '<div class="tool-warn">尚未找到可用的场景数据——请先在「深度分析」生成一次报告并存入报告库。</div>';
          return;
        }
        var t = DOCTPL.forScenario(sid).filter(function (x) { return x.id === kind; })[0];
        var sc = window.INSIGHTS && INSIGHTS.get(sid);
        var text = t.gen({ scenario: { id: sid, name: sc && sc.name ? sc.name : "【案情简述】" }, answers: {}, result: {} });
        wsDocWin(kind === "court-critique" ? "质证意见（草稿）" : "庭审提纲（草稿）", text);
        return;
      }
      if (e.target.closest("#ws-ledger-word")) { ledgerWord(); return; }
      if (e.target.closest("#ws-spent-add")) {
        var nameEl = $("ws-spent-name"), amtEl = $("ws-spent-amt");
        var v = amtEl ? parseFloat(amtEl.value) : NaN;
        if (!nameEl || !nameEl.value.trim() || !isFinite(v) || v <= 0) return;
        addSpent(nameEl.value.trim(), v, {
          type: $("ws-spent-type") ? $("ws-spent-type").value : "",
          date: $("ws-spent-date") ? $("ws-spent-date").value : "",
          voucherNo: $("ws-spent-vno") ? $("ws-spent-vno").value.trim() : ""
        });
        renderBody();
        if (window.TOOLS && TOOLS.haptic) TOOLS.haptic(10);
      }
    });
    /* 页面化首帧渲染（v3.6.1 IA 回归修复）：switchView 只切页签 class 不触发渲染，
       启动后首次点「案件」页签时 ws-empty/ws-content 均保持初始 hidden 成空白正文。
       此处补一次启动渲染出首帧；页内后续变更均由委托回调内的 renderAll/renderBody 刷新 */
    renderAll();
    /* C2/D7：首页警报栏+续办卡——启动渲染一次；回首页/工作区变更时刷新；
       条目点击直达挂 document（警报栏在 view-consult 顶部，冒泡不到 #ws-body） */
    renderAlertBar();
    document.addEventListener("click", function (e) {
      var tab = e.target.closest ? e.target.closest(".nav-tab") : null;
      if (tab && (tab.getAttribute("data-view") === "consult" || tab.getAttribute("data-view") === "workspace")) { renderAlertBar(); return; }
      var resume = e.target.closest ? e.target.closest("[data-ws-resume]") : null;
      if (resume) {
        setCurrent(resume.getAttribute("data-ws-resume"));
        renderAll();   /* 直达后必须重渲染：此前页面可能是空态或另一案的内容 */
        if (window.APP && APP.switchView) APP.switchView("workspace");
        return;
      }
      var alertIt = e.target.closest ? e.target.closest("[data-ws-alert]") : null;
      if (alertIt) {
        var cid = alertIt.getAttribute("data-ws-alert");
        if (cid && window.APP && APP.switchView) { setCurrent(cid); renderAll(); APP.switchView("workspace"); }
        else if (window.APP && APP.switchView) APP.switchView("tools");
        return;
      }
    });
  }

  return {
    list: list, current: current, currentId: currentId,
    create: create, rename: rename, remove: remove, setCurrent: setCurrent,
    attach: attach, purgeReports: purgeReports, addNote: addNote, toggleNote: toggleNote, removeNote: removeNote,
    /* B1/B2/B4：阶段/判决落盘/台账 */
    setStage: setStage, STAGE_KEYS: STAGE_KEYS, STAGE_CHECKLIST: STAGE_CHECKLIST, setCaseResult: setCaseResult, getCaseResult: getCaseResult, clearCaseResult: clearCaseResult,
    setClaimTotal: setClaimTotal, addSpent: addSpent, removeSpent: removeSpent,
    /* C3 履行台账 / C4 结案归档与回顾 / C2 警报栏 / D7 续办卡 */
    addPerf: addPerf, togglePerf: togglePerf, removePerf: removePerf, perfOverdue: perfOverdue,
    setArchived: setArchived, buildClosureReport: buildClosureReport, renderAlertBar: renderAlertBar, alertBarData: alertBarData,
    toMarkdown: toMarkdown, init: init, openModal: openModal,
    buildEnforce: buildEnforce, PROPERTY_LIST: PROPERTY_LIST,   /* 评测与验证用 */
    /* 测试钩子（不进 UI，无副作用）：test.js 日期管线回归用（同 claims.collectForTest 先例） */
    _test: { addDays: addDays, extractDates: extractDates, futureNodes: futureNodes, parseJudgment: parseJudgment, buildCatalog: buildCatalog, normCnDates: normCnDates, buildEnforce: buildEnforce, getStage: getStage, normStage: normStage, LEGACY_STAGE_MAP: LEGACY_STAGE_MAP }
  };
})();
