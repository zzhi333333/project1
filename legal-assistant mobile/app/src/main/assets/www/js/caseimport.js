/* =========================================================
 * caseimport.js —— 官方站检索结果粘贴导入
 * 流程：官方站（需登录）检索 → 用户复制文书文本 → 粘贴到本弹窗
 *       → 自动解析案号/法院/当事人/裁判要旨 → 存本地案例收藏
 *       → 可查看全文 / 一键送「深度分析」/ 删除
 * 纯本地（localStorage），不采集、不上传。
 * ========================================================= */
window.CASEIMPORT = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var KEY = "legal-case-imports";

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 存储不可用时静默 */ }
  }

  /* ---------- 解析 ---------- */
  function parse(text) {
    var t = String(text || "").trim();
    var lines = t.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var r = { title: "", caseNo: "", court: "", date: "", parties: [], holding: "", raw: t };
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!r.title && /判\s*决\s*书|裁\s*定\s*书|决\s*定\s*书|调\s*解\s*书/.test(L)) r.title = L.slice(0, 60);
      if (!r.caseNo) {
        var m = L.match(/[（(]\s*[12]\d{3}\s*[）)]\s*[^号（）()]{1,20}?\s*[字]?\s*第?\s*\d+\s*号/) || L.match(/[12]\d{3}[-—][^\s，。]{1,12}?[-—]?\d{1,6}\s*号/);
        if (m) r.caseNo = m[0].replace(/\s+/g, "");
      }
      if (!r.court && /人民法院$/.test(L.replace(/[（(].*?[)）]/g, ""))) r.court = L.slice(0, 30);
      if (/^(上诉人|被上诉人|原告|被告|申请人|被申请人|公诉机关|抗诉机关|再审申请人|执行人|异议人)[:：\s]/.test(L) && r.parties.length < 6) {
        r.parties.push(L.slice(0, 80));
      }
      if (!r.date) {
        var dm = L.match(/[12]\d{3}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g);
        if (dm) r.date = dm[dm.length - 1];
      }
    }
    var hStart = t.indexOf("本院认为");
    if (hStart > -1) {
      var hEnd = -1;
      ["判决如下", "裁定如下", "决定如下", "调解协议"].forEach(function (k) {
        var idx = t.indexOf(k, hStart);
        if (idx > -1 && (hEnd === -1 || idx < hEnd)) hEnd = idx;
      });
      r.holding = t.slice(hStart, hEnd > -1 ? hEnd : Math.min(hStart + 500)).replace(/\n{3,}/g, "\n\n").slice(0, 600);
    }
    if (!r.title) r.title = (lines[0] || "未命名导入").slice(0, 40);
    return r;
  }

  /* ---------- 收藏列表渲染（注入案例页） ---------- */
  function renderList() {
    var box = document.getElementById("case-import-list");
    if (!box) return;
    var list = load();
    if (!list.length) {
      box.innerHTML = '<div class="empty dim">还没有导入的文书——在官方站检索后复制文书文本，点上方「导入官方检索结果」粘贴保存。</div>';
      return;
    }
    box.innerHTML = list.map(function (it) {
      return '<div class="case-card ci-card" data-id="' + esc(it.id) + '">' +
        '<div class="case-title">' + esc(it.title) + '</div>' +
        (it.caseNo ? '<div class="case-sec"><b>案号</b>' + esc(it.caseNo) + '</div>' : "") +
        (it.court ? '<div class="case-sec"><b>法院</b>' + esc(it.court) + '</div>' : "") +
        (it.date ? '<div class="case-sec"><b>日期</b>' + esc(it.date) + '</div>' : "") +
        (it.holding ? '<div class="case-sec"><b>本院认为</b>' + esc(it.holding.slice(0, 160)) + (it.holding.length > 160 ? "…" : "") + '</div>' : "") +
        '<div class="ci-actions">' +
          '<button class="mini-btn ci-view">查看全文</button>' +
          '<button class="mini-btn primary ci-analyze">送深度分析</button>' +
          '<button class="mini-btn ci-del" style="color:var(--danger)">删除</button>' +
        '</div>' +
        '<pre class="ci-raw hidden">' + esc(it.raw) + '</pre>' +
        '</div>';
    }).join("");
    box.querySelectorAll(".ci-card").forEach(function (card) {
      var id = card.getAttribute("data-id");
      card.querySelector(".ci-view").addEventListener("click", function () {
        card.querySelector(".ci-raw").classList.toggle("hidden");
      });
      card.querySelector(".ci-del").addEventListener("click", function () {
        save(load().filter(function (x) { return x.id !== id; }));
        renderList();
      });
      card.querySelector(".ci-analyze").addEventListener("click", function () {
        var it2 = load().filter(function (x) { return x.id === id; })[0];
        if (!it2) return;
        var tab = document.querySelector('.nav-tab[data-view="agent"]');
        if (tab) tab.click();
        if (window.AGENT && window.AGENT.runWith) window.AGENT.runWith(it2.raw.slice(0, 4000), "report");
      });
    });
  }

  /* ---------- 弹窗（动态构建，复用 .modal 体系） ---------- */
  var modalEl = null;
  function open() {
    if (modalEl) { modalEl.classList.remove("hidden"); return; }
    modalEl = document.createElement("div");
    modalEl.className = "modal";
    modalEl.innerHTML =
      '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:640px;width:92%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-file></use></svg> 导入官方检索结果</div>' +
        '<div class="modal-body">' +
          '<div class="modal-note">在官方站（裁判文书网/案例库，需登录）检索并打开文书 → <b>全选复制文书文本</b> → 粘贴到下方。系统自动识别案号、法院、当事人与裁判要旨，保存为本地案例收藏（不上传）。</div>' +
          '<textarea id="ci-paste" rows="9" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-family:inherit;font-size:13.5px;background:var(--card);color:var(--ink);resize:vertical" placeholder="粘贴文书全文或要点…"></textarea>' +
          '<div id="ci-parse-preview" class="ci-preview"></div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="mini-btn" id="ci-cancel">取消</button>' +
          '<button class="mini-btn primary" id="ci-save">解析并保存</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modalEl);
    modalEl.querySelector(".modal-mask").addEventListener("click", close);
    modalEl.querySelector("#ci-cancel").addEventListener("click", close);
    modalEl.querySelector("#ci-save").addEventListener("click", function () {
      var text = modalEl.querySelector("#ci-paste").value;
      if (!text.trim()) return;
      var r = parse(text);
      var list = load();
      var rec = { id: "ci-" + Date.now(), savedAt: new Date().toISOString(), title: r.title, caseNo: r.caseNo, court: r.court, date: r.date, parties: r.parties, holding: r.holding, raw: r.raw };
      list.unshift(rec);
      save(list.slice(0, 50));
      if (window.WORKSPACE) window.WORKSPACE.attach("cases", { id: rec.id, name: (rec.title || rec.caseNo || "导入案例").slice(0, 60) });   /* 案件工作区归集 */
      close();
      renderList();
      var box = document.getElementById("case-import-list");
      if (box) box.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function close() { if (modalEl) modalEl.classList.add("hidden"); }

  /* ---------- 初始化（注入案例页按钮 + 收藏区） ---------- */
  function init() {
    var anchor = document.getElementById("official-sources");
    if (!anchor || document.getElementById("case-import-btn")) return;
    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap";
    bar.innerHTML = '<button id="case-import-btn" class="ghost-btn"><svg class=ico><use href=#i-copy></use></svg> 导入官方检索结果</button>' +
      '<span class="dim" style="font-size:12.5px">从官方站复制文书文本粘贴保存到本机（不上传）</span>';
    anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    var listWrap = document.createElement("div");
    listWrap.innerHTML = '<div class="section-sub" style="margin-top:20px">我的案例收藏（本机导入）</div><div id="case-import-list" class="case-results"></div>';
    anchor.parentNode.insertBefore(listWrap, bar.nextSibling);
    document.getElementById("case-import-btn").addEventListener("click", open);
    renderList();
  }

  return { init: init, open: open, parse: parse, renderList: renderList };
})();
