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
      links: { reports: [], deadlines: [], cases: [], docs: [], sessions: [] }
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
    lastJudg = j;   /* 供执行申请书自动填充 */
    out.innerHTML = html;
    out.querySelectorAll(".ws-tl-cal-add").forEach(function (b) {
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
    /* 结构保持式刷新：只切换空态/内容态显隐并刷新动态子区，
       绝不重写 #ws-body（否则会抹掉判决书/证据目录等静态 UI） */
    var c = current();
    var body = $("ws-body");
    if (!body) return;
    var empty = $("ws-empty"), content = $("ws-content");
    if (empty) empty.classList.toggle("hidden", !!c);
    if (content) content.classList.toggle("hidden", !c);
    if (!c) return;
    /* 待确认事项 */
    var notes = $("ws-notes");
    if (notes) notes.innerHTML = c.notes.length
      ? c.notes.map(function (n, i) {
        return '<div class="flk-item" style="padding:6px 10px"><label class="check-line" style="margin:0"><input type="checkbox" data-ws-note="' + i + '"' + (n.done ? " checked" : "") + '> <span style="' + (n.done ? "text-decoration:line-through;opacity:.6" : "") + '">' + esc(n.text) + '</span></label><button class="mini-btn" data-ws-note-del="' + i + '" style="margin-left:auto">删</button></div>';
      }).join("")
      : '<div class="dim" style="font-size:12.5px">暂无待确认事项。</div>';
    /* 自动归集三栏 */
    var links = $("ws-links");
    if (!links) return;
    var lk = c.links;
    var sec = function (title, arr, empty) {
      return '<div><b style="font-size:13px">' + title + '（' + arr.length + '）</b><div style="font-size:12.5px;color:var(--ink-2);margin-top:4px">' +
        (arr.length ? arr.map(function (r) { return "· " + esc(r.name) + (r.date ? "（" + esc(r.date) + "）" : ""); }).join("<br>") : empty) + '</div></div>';
    };
    links.innerHTML =
      sec("关联分析报告", lk.reports, "（激活案件后，深度分析「存入报告库」自动归集）") +
      sec("文书草稿", lk.docs || [], "（生成文书后点「存入案件工作区」）") +
      sec("期限与提醒", lk.deadlines, "（激活案件后，合规日历添加自动归集）") +
      sec("关联案例", lk.cases, "（激活案件后，案例粘贴导入自动归集）") +
      sec("关联会话", lk.sessions || [], "（激活案件后，咨询会话自动绑定，点击下方回看）");
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

  function docWinModal(title, text) {
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
    /* 执行阶段工具（方向二）：基于最近一次判决书解析生成文书/清单 */
    var execEnforce = $("ws-exec-enforce");
    if (execEnforce) execEnforce.addEventListener("click", function () {
      if (!lastJudg) {
        var out = $("ws-exec-out");
        if (out) out.innerHTML = '<div class="tool-warn">请先在上方粘贴判决书并解析生成双时间线。</div>';
        return;
      }
      docWinModal("执行申请书（自动填充）", buildEnforce(lastJudg));
    });
    var execList = $("ws-exec-list");
    if (execList) execList.addEventListener("click", function () {
      docWinModal("财产线索清单（执行阶段自查）", PROPERTY_LIST);
    });
    var printBtn = $("ws-onepager");
    if (printBtn) printBtn.addEventListener("click", printOnePager);
  }

  return {
    list: list, current: current, currentId: currentId,
    create: create, rename: rename, remove: remove, setCurrent: setCurrent,
    attach: attach, addNote: addNote, toggleNote: toggleNote, removeNote: removeNote,
    toMarkdown: toMarkdown, init: init, openModal: openModal,
    buildEnforce: buildEnforce, PROPERTY_LIST: PROPERTY_LIST,   /* 评测与验证用 */
    /* 测试钩子（不进 UI，无副作用）：test.js 日期管线回归用（同 claims.collectForTest 先例） */
    _test: { addDays: addDays, extractDates: extractDates, futureNodes: futureNodes, parseJudgment: parseJudgment, buildCatalog: buildCatalog, normCnDates: normCnDates, buildEnforce: buildEnforce }
  };
})();
