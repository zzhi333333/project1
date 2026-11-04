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
  }

  return {
    list: list, current: current, currentId: currentId,
    create: create, rename: rename, remove: remove, setCurrent: setCurrent,
    attach: attach, addNote: addNote, toggleNote: toggleNote, removeNote: removeNote,
    toMarkdown: toMarkdown, init: init, openModal: openModal
  };
})();
