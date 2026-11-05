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
      links: { reports: [], deadlines: [], cases: [], docs: [] }
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

  /* 自动归集：当前案件激活时，报告存档/日历项/案例导入调用（无当前案件则忽略） */
  function attach(kind, ref) {
    if (!ref) return false;
    var ok = withCurrent(function (c) {
      var arr = c.links[kind];
      if (!arr) return false;
      var dup = arr.some(function (x) { return (ref.id && x.id === ref.id) || (!ref.id && x.name === ref.name && x.date === ref.date); });
      if (dup) return true;
      arr.unshift({ id: ref.id || null, name: String(ref.name || "").slice(0, 60), date: ref.date || null, at: new Date().toISOString() });
      if (arr.length > 50) arr.length = 50;
      return true;
    }) === true;
    if (ok) renderBody();   /* 弹层开着时即时刷新归集区 */
    return ok;
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
  function addDays(dateStr, days) {
    var d = new Date(dateStr.replace(/年|月/g, "-").replace(/日/g, "").trim() + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    d = new Date(d.getTime() + days * DAYS);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  /* 提取全文日期（含上下文短语），按时间排序为「已发生事实时间线」 */
  function extractDates(text) {
    var seen = {}, out = [];
    var re = /([12]\d{3})\s*年\s*(\d{1,2})\s*月(\s*\d{1,2}\s*日)?/g, m;
    while ((m = re.exec(text)) !== null) {
      var y = m[1], mo = ("0" + m[2]).slice(-2), d = m[3] ? ("0" + m[3].replace(/\D/g, "")).slice(-2) : "";
      var iso = y + "-" + mo + (d ? "-" + d : "");
      if (seen[iso]) continue;
      seen[iso] = 1;
      var ctx = text.slice(Math.max(0, m.index - 18), m.index).replace(/\s+/g, " ");
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
    /* 落款日 = 文本中最后一个完整日期（判决书落款在尾部） */
    var allDates = text.match(/[12]\d{3}\s*年\s*\d{1,2}\s*月\s*(?:\d{1,2}\s*日)?/g) || [];
    if (allDates.length) {
      var last = allDates[allDates.length - 1].replace(/\s+/g, "").replace("年", "-").replace("月", "-").replace(/-$/, "");
      r.judgmentDate = last;
    }
    r.past = extractDates(text);
    r.future = futureNodes(r.judgmentDate, type);
    return r;
  }
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
        '<div class="tl-add"><input class="tl-date" type="date" value="' + esc(n.date) + '"><button class="mini-btn tl-cal-add" data-name="' + esc(n.name) + '"><svg class=ico><use href=#i-calendar></use></svg> 加入日历</button></div></div></div>';
    });
    html += '</div><div class="calc-note">期限日期按文书落款日近似推算（法定起算点多为「送达之日」），请按实际送达日调整后再入日历；已加入日历的节点到期前 7 天会提醒。</div>';
    out.innerHTML = html;
    out.querySelectorAll(".tl-cal-add").forEach(function (b) {
      b.addEventListener("click", function () {
        var date = b.closest(".tl-add").querySelector(".tl-date").value;
        if (!date) return;
        var name = b.getAttribute("data-name") + "（" + date + "）";
        if (window.TOOLS && window.TOOLS.calAdd) { window.TOOLS.calAdd(name, date); b.innerHTML = '<svg class=ico><use href=#i-checkc></use></svg> 已加入'; }
        if (window.WORKSPACE) window.WORKSPACE.attach("deadlines", { name: name, date: date });
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
    var html = '<table class="ev-cat-table"><thead><tr><th>序号</th><th>证据名称</th><th>来源</th><th>证明目的</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + r.no + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.src) + '</td><td>' + esc(r.purpose) + '</td></tr>';
      }).join("") + '</tbody></table>' +
      '<div class="calc-note">证明目的为按证据类型的自动建议，可导出后在 Word 中修改；提交时按此目录整理复印件并编页码。</div>';
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
    sel.innerHTML = d.list.length
      ? d.list.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === d.currentId ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("")
      : '<option value="">（尚无案件）</option>';
  }

  function renderBody() {
    var c = current();
    var body = $("ws-body");
    if (!body) return;
    if (!c) { body.innerHTML = '<div class="empty">尚无案件：点上方「＋ 新建案件」创建后，咨询/分析/导入的产出会自动归集到当前案件。</div>'; return; }
    /* 待确认事项 */
    var notes = $("ws-notes");
    notes.innerHTML = c.notes.length
      ? c.notes.map(function (n, i) {
        return '<div class="flk-item" style="padding:6px 10px"><label class="check-line" style="margin:0"><input type="checkbox" data-ws-note="' + i + '"' + (n.done ? " checked" : "") + '> <span style="' + (n.done ? "text-decoration:line-through;opacity:.6" : "") + '">' + esc(n.text) + '</span></label><button class="mini-btn" data-ws-note-del="' + i + '" style="margin-left:auto">删</button></div>';
      }).join("")
      : '<div class="dim" style="font-size:12.5px">暂无待确认事项。</div>';
    /* 自动归集三栏 */
    var lk = c.links;
    var sec = function (title, arr, empty) {
      return '<div><b style="font-size:13px">' + title + '（' + arr.length + '）</b><div style="font-size:12.5px;color:var(--ink-2);margin-top:4px">' +
        (arr.length ? arr.map(function (r) { return "· " + esc(r.name) + (r.date ? "（" + esc(r.date) + "）" : ""); }).join("<br>") : empty) + '</div></div>';
    };
    $("ws-links").innerHTML =
      sec("关联分析报告", lk.reports, "（激活案件后，深度分析「存入报告库」自动归集）") +
      sec("文书草稿", lk.docs || [], "（生成文书后点「存入案件工作区」）") +
      sec("期限与提醒", lk.deadlines, "（激活案件后，合规日历添加自动归集）") +
      sec("关联案例", lk.cases, "（激活案件后，案例粘贴导入自动归集）");
  }

  function renderAll() { renderSelect(); renderBody(); }

  function openModal() {
    var m = $("ws-modal");
    if (!m) return;
    m.classList.remove("hidden");
    renderAll();
  }
  function closeModal() { var m = $("ws-modal"); if (m) m.classList.add("hidden"); }

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

  function init() {
    var open = $("ws-open-btn");
    if (open) open.addEventListener("click", openModal);
    var modal = $("ws-modal");
    if (!modal) return;
    $("ws-close").addEventListener("click", closeModal);
    modal.querySelector(".modal-mask").addEventListener("click", closeModal);
    $("ws-select").addEventListener("change", function () { if (this.value) setCurrent(this.value); renderBody(); });
    $("ws-new").addEventListener("click", function () {
      var name = prompt("案件名称（如：与某公司劳动仲裁）:", "");
      if (name == null) return;
      create(name.trim() || "未命名案件");
      renderAll();
    });
    $("ws-rename").addEventListener("click", function () {
      var c = current();
      if (!c) return;
      var name = prompt("重命名案件：", c.name);
      if (name != null && name.trim()) { rename(c.id, name.trim()); renderAll(); }
    });
    $("ws-del").addEventListener("click", function () {
      var c = current();
      if (!c) return;
      if (!confirm("删除案件「" + c.name + "」？\n仅解除关联，不删除底层报告/日历/案例数据。")) return;
      remove(c.id);
      renderAll();
    });
    $("ws-note-add").addEventListener("click", function () {
      var inp = $("ws-note-input");
      if (inp.value.trim()) { addNote(inp.value.trim()); inp.value = ""; renderBody(); }
    });
    $("ws-notes").addEventListener("change", function (e) {
      var i = e.target.getAttribute("data-ws-note");
      if (i != null) { toggleNote(Number(i)); renderBody(); }
    });
    $("ws-notes").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-ws-note-del]") : null;
      if (b) { removeNote(Number(b.getAttribute("data-ws-note-del"))); renderBody(); }
    });
    $("ws-export").addEventListener("click", downloadMd);
    /* 判决书双时间线 */
    $("ws-judg-parse").addEventListener("click", function () {
      var text = $("ws-judg-input").value;
      if (!text.trim()) { $("ws-judg-out").innerHTML = '<div class="tool-warn">请先粘贴判决书/调解书全文或尾部。</div>'; return; }
      renderJudgmentTL(text, $("ws-judg-type").value);
    });
    /* 证据目录生成 */
    $("ws-ev-gen").addEventListener("click", function () {
      renderCatalog(buildCatalog($("ws-ev-input").value));
    });
    $("ws-ev-word").addEventListener("click", function () {
      if (catalogRows.length) catalogWordDownload(catalogRows);
    });
  }

  return {
    list: list, current: current, currentId: currentId,
    create: create, rename: rename, remove: remove, setCurrent: setCurrent,
    attach: attach, addNote: addNote, toggleNote: toggleNote, removeNote: removeNote,
    toMarkdown: toMarkdown, init: init, openModal: openModal
  };
})();
