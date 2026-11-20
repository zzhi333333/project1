/* =========================================================
 * 联网模块 online.js
 * 通过本地代理服务（server.js / server.py）访问：
 *   法条：国家法律法规数据库 flk.npc.gov.cn
 *   案例：中国裁判文书网（wenshu.court.gov.cn，经公开搜索引擎定位）
 * 未启动本地服务时自动降级为离线模式并给出提示
 * ========================================================= */
window.ONLINE = (function () {
  var base = null;            /* "" = 同源, "http://127.0.0.1:8080" = 直接打开文件时 */
  var available = false;
  var CANDIDATE_BASES = ["", "http://127.0.0.1:8080"];

  function qs(params) {
    return Object.keys(params).map(function (k) {
      return k + "=" + encodeURIComponent(params[k] == null ? "" : params[k]);
    }).join("&");
  }

  function api(path, params, timeoutMs) {
    var url = base + path + (params ? "?" + qs(params) : "");
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000);
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- 连接探测 ---------- */
  function pingOne(b) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 2500);
    return fetch(b + "/api/ping", { signal: ctrl.signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .finally(function () { clearTimeout(timer); });
  }

  function check() {
    return CANDIDATE_BASES.reduce(function (chain, b) {
      return chain.then(function (res) {
        if (res) return res;
        return pingOne(b).then(function (j) {
          if (j && j.ok) { base = b; available = true; return j; }
          return null;
        });
      });
    }, Promise.resolve(null)).then(function (j) {
      updateBadge();
      return !!j;
    });
  }

  function updateBadge() {
    var badge = document.getElementById("net-badge");
    if (!badge) return;
    if (available) {
      badge.className = "net-badge on";
      badge.innerHTML = '● 联网模式<span class="nb-sub">flk.npc.gov.cn 已连接</span>';
    } else {
      badge.className = "net-badge off";
      badge.innerHTML = '○ 离线模式<span class="nb-sub">启动 server 后可联网检索</span>';
    }
  }

  function ensureOnline(container) {
    if (available) return true;
    if (container) {
      container.innerHTML =
        '<div class="online-off">' +
        '<b>联网检索需要启动本地代理服务</b><br>' +
        '在项目目录运行：<code>node server.js</code>（或 <code>python server.py</code>），<br>' +
        '然后通过 <code>http://127.0.0.1:8080</code> 访问本页，或直接刷新本页即可。<br>' +
        '<span class="dim">代理用于转发国家法律法规数据库 / 裁判文书网的公开检索请求（浏览器直连会被跨域策略拦截）。</span>' +
        '</div>';
    }
    return false;
  }

  /* ---------- 法条检索（flk） ---------- */
  function flkSearch(q, page) {
    return api("/api/flk/search", { q: q, page: page || 1 });
  }
  function flkDetail(id) {
    return api("/api/flk/detail", { id: id });
  }
  function flkText(bbbs) {
    return api("/api/flk/text", { bbbs: bbbs });
  }

  /* ---------- 案例检索（wenshu / 最高法官网，经搜索引擎定位） ---------- */
  function caseSearch(q, site) {
    return api("/api/cases/search", { q: q, site: site || "wenshu" });
  }

  /* ---------- UI 绑定 ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  var STATUS_MAP = { "1": "已废止", "2": "已被修改", "3": "有效", "4": "尚未生效" };

  /* flk 响应统一渲染：上游失败（405/限流/超时/断网）不再吞掉原因——
     明示「官方库暂不可用」并指回本地法条模式，避免用户误以为本地库里没有（降级透明化） */
  function renderFlkResp(resp) {
    var box = document.getElementById("flk-results");
    if (resp && resp.ok === false && resp.msg) {
      box.innerHTML =
        '<div class="tool-warn">⚠️ 官方数据库暂时不可用：' + esc(resp.msg) +
        '<br>可点上方「本地法条」用本地知识库检索，稍后再试官方库。</div>';
      return;
    }
    renderFlkResults(resp && resp.results, resp && resp.total);
  }

  function renderFlkResults(list, total) {
    var box = document.getElementById("flk-results");
    if (!list || !list.length) {
      box.innerHTML = '<div class="empty">国家法律法规数据库未返回匹配结果，可尝试更换关键词（如「劳动合同法」「公司法」「专利法」）。</div>';
      return;
    }
    var html = '<div class="flk-meta">来源：国家法律法规数据库 flk.npc.gov.cn · 共 ' + (total || list.length) + ' 条</div>';
    list.forEach(function (it) {
      html +=
        '<div class="flk-item" data-id="' + esc(it.id) + '">' +
          '<div class="flk-title">' + esc(it.title) + '</div>' +
          '<div class="flk-props">' +
            '<span class="prop">' + esc(it.type || it.level || "") + '</span>' +
            '<span class="prop">' + esc(it.office || "") + '</span>' +
            '<span class="prop">公布：' + esc((it.publish || "").slice(0, 10)) + '</span>' +
            '<span class="prop ' + (it.status === "1" ? "ok" : "warn") + '">' + (STATUS_MAP[it.status] || esc(it.status || "")) + '</span>' +
          '</div>' +
          '<div class="flk-actions">' +
            '<button class="mini-btn primary" data-act="detail">查看官方元数据与文本</button>' +
            '<a class="mini-btn" target="_blank" rel="noopener" href="https://flk.npc.gov.cn/detail?id=' + encodeURIComponent(it.id) + '">数据库原文页</a>' +
          '</div>' +
          '<div class="flk-body"></div>' +
        '</div>';
    });
    box.innerHTML = html;

    box.querySelectorAll(".flk-item").forEach(function (item) {
      item.querySelector('[data-act="detail"]').addEventListener("click", function () {
        var bodyEl = item.querySelector(".flk-body");
        if (bodyEl.dataset.loaded) { bodyEl.classList.toggle("hidden"); return; }
        bodyEl.innerHTML = '<div class="loading">正在从国家法律法规数据库获取…</div>';
        /* 优先使用本地缓存的官方全文（离线可看） */
        var cacheKey = "legal-flk-text:" + item.getAttribute("data-id");
        var cachedText = null;
        try { cachedText = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch (e) {}
        if (cachedText && cachedText.text) {
          bodyEl.innerHTML = renderDetailBody({ ok: true, meta: cachedText.meta, links: cachedText.links || {} }, cachedText.text, true);
          bodyEl.dataset.loaded = "1";
          return;
        }
        flkDetail(item.getAttribute("data-id")).then(function (r) {
          if (!r.ok) { bodyEl.innerHTML = '<div class="tool-warn">' + esc(r.msg || "获取失败，请稍后重试") + '</div>'; return; }
          bodyEl.innerHTML = renderDetailBody(r, null, false);
          bodyEl.dataset.loaded = "1";
          /* 异步提取官方 docx 全文（正文入缓存，离线可查） */
          flkText(item.getAttribute("data-id")).then(function (t) {
            if (t && t.ok && t.text) {
              try { localStorage.setItem(cacheKey, JSON.stringify({ title: t.title, text: t.text, meta: r.meta, links: r.links })); } catch (e) {}
              var doc = bodyEl.querySelector(".flk-doc");
              if (doc) doc.textContent = t.text;
              else {
                var d2 = document.createElement("div");
                d2.className = "flk-doc";
                d2.textContent = t.text;
                bodyEl.insertBefore(d2, bodyEl.querySelector(".flk-actions"));
              }
              var note = bodyEl.querySelector(".flk-textnote");
              if (note) note.remove();
            }
          }).catch(function () { });
        }).catch(function () {
          bodyEl.innerHTML = '<div class="tool-warn">网络请求失败，请确认本地服务与外网连接正常。</div>';
        });
      });
    });
  }

  function renderDetailBody(r, fullText, fromCache) {
    var links = r.links || {};
    var m = r.meta || {};
    var chip = function (t) { return '<span class="prop">' + esc(t) + '</span>'; };
    var okCls = m.status === "3" ? "ok" : "warn";
    var html =
      '<div class="flk-props">' +
        (m.flxz ? chip("性质：" + m.flxz) : "") +
        (m.office ? chip("制定机关：" + m.office) : "") +
        (m.publish ? chip("公布：" + m.publish) : "") +
        (m.expiry ? chip("施行：" + m.expiry) : "") +
        (m.status ? '<span class="prop ' + okCls + '">' + (STATUS_MAP[m.status] || esc(m.status)) + '</span>' : "") +
        (fromCache ? '<span class="prop ok"><svg class=ico><use href=#i-box></use></svg> 本地缓存版本</span>' : "") +
      '</div>' +
      (fullText ? '<div class="flk-doc">' + esc(fullText) + '</div>' : "") +
      '<div class="flk-actions">' +
        (links.preview ? '<a class="mini-btn primary" target="_blank" rel="noopener" href="' + esc(links.preview) + '"><svg class=ico><use href=#i-book-open></use></svg> 官方在线预览</a>' : "") +
        (links.word ? '<a class="mini-btn" target="_blank" rel="noopener" href="' + esc(links.word) + '">下载 Word 正式文本</a>' : "") +
        (links.pdf ? '<a class="mini-btn" target="_blank" rel="noopener" href="' + esc(links.pdf) + '">下载 PDF 正式文本</a>' : "") +
        (links.relatedCount ? '<span class="prop">相关资料 ' + esc(links.relatedCount) + ' 件</span>' : "") +
      '</div>' +
      '<div class="dim flk-textnote" style="margin-top:8px;font-size:12.5px">' +
        (fullText ? "以上为官方 Word 文本提取的正文（已缓存到本机，可离线查看）；以官方发布的正式文本为准。" :
        "正文正在从官方 Word 文本提取（或可点击上方官方预览/下载按钮）；提取后自动缓存到本机，可离线查看。") +
      '</div>';
    return html;
  }

  /* ---------- 官方查询直达（真实官网界面；需登录站点进入官方登录页） ---------- */
  var OFFICIAL_SOURCES = [
    { name: "中国裁判文书网", url: "https://wenshu.court.gov.cn/", icon: "i-cases",
      desc: "全国法院公开裁判文书总量最大来源；2020 年起查看文书全文需登录", login: true },
    { name: "人民法院案例库", url: "https://rmfyalk.court.gov.cn/", icon: "i-shield",
      desc: "最高人民法院建设的权威参考案例库（入库案例经最高法审核）；需注册登录", login: true },
    { name: "多元解纷案例库", url: "https://dyjfalk.court.gov.cn/", icon: "i-link",
      desc: "调解、仲裁等多元解纷典型案例；需登录", login: true },
    { name: "未成年人权益保护案事例库", url: "https://rmfyalk.court.gov.cn/view/list-juvenile.html", icon: "i-star",
      desc: "未成年人权益保护案事例专栏；需登录", login: true }
  ];
  function renderOfficialSources() {
    var box = document.getElementById("official-sources");
    if (!box) return;
    box.innerHTML = OFFICIAL_SOURCES.map(function (s) {
      return '<div class="official-src-card">' +
        '<div class="os-head"><svg class=ico><use href=#' + s.icon + '></use></svg> <b>' + esc(s.name) + '</b>' +
        '<span class="os-login">' + (s.login ? "需登录" : "公开") + '</span></div>' +
        '<div class="os-desc">' + esc(s.desc) + '</div>' +
        '<div class="os-actions"><a class="mini-btn primary" target="_blank" rel="noopener" href="' + esc(s.url) + '">打开官方界面 ↗</a></div>' +
        '</div>';
    }).join("") +
    '<div class="dim" style="font-size:12.5px;margin-top:8px">说明：官方站点（含文书网）均需在官方界面注册/登录后检索，本页无法代为登录；上方"在线检索"为公开网页结果的快速定位，全文请登录官方站点查看。</div>';
  }

  function renderCaseResults(r) {
    var box = document.getElementById("case-results");
    var siteName = r.site === "court" ? "最高人民法院官网（指导性案例·裁判文书）" : "中国裁判文书网";
    if (!r.ok) {
      box.innerHTML = '<div class="tool-warn">' + esc(r.msg || "检索失败") + '</div>';
      return;
    }
    var items = r.results || [];
    /* 登录提示条：wenshu 全文需登录；提供官方真实界面入口 */
    /* 官方站需登录：给出关键词 + 官方真实界面入口，登录后站内检索即见结果 */
    var loginTip = '<div class="login-tip"><svg class=ico><use href=#i-lock></use></svg> <span>官方站需<b>登录</b>后检索全文。为您准备的关键词：<b>「' + esc(r.q) + '」</b>——打开官方界面登录后粘贴检索即可：</span>' +
      (r.site !== "court"
        ? '<a class="mini-btn primary" target="_blank" rel="noopener" href="https://wenshu.court.gov.cn/">裁判文书网 ↗</a>' +
          '<a class="mini-btn" target="_blank" rel="noopener" href="https://rmfyalk.court.gov.cn/">案例库 ↗</a>'
        : '<a class="mini-btn primary" target="_blank" rel="noopener" href="https://www.court.gov.cn/">最高人民法院官网 ↗</a>') +
      '</div>';
    if (!items.length) {
      box.innerHTML = loginTip + '<div class="empty">未通过公开搜索定位到「' + esc(r.q) + '」相关文书。可简化关键词后重试，或点上方官方入口登录后到站内检索。</div>';
      return;
    }
    var html = loginTip +
      '<div class="flk-meta">公开网页定位 · ' + esc(siteName) + ' 相关结果（点击标题打开原文；文书网全文需登录）</div>';
    items.forEach(function (it) {
      html +=
        '<div class="case-web-item">' +
          '<a class="cw-title" target="_blank" rel="noopener" href="' + esc(it.url) + '">' + esc(it.title) + '</a>' +
          '<div class="cw-snippet">' + esc(it.snippet || "") + '</div>' +
          '<div class="cw-url">' + esc((it.url || "").replace(/^https?:\/\//, "").slice(0, 90)) + '</div>' +
        '</div>';
    });
    box.innerHTML = html;
  }

  function renderGuiding(keyword) {
    var box = document.getElementById("guiding-list");
    if (!box) return;
    var kw = (keyword || "").trim();
    var list = window.GUIDING.filter(function (g) {
      if (!kw) return true;
      return (g.title + g.no + g.keywords.join("") + g.gist + g.facts).indexOf(kw) > -1;
    });
    if (!list.length) { box.innerHTML = '<div class="empty">内置指导性案例中没有匹配「' + esc(kw) + '」的条目，可换关键词或在上方在线检索。</div>'; return; }
    box.innerHTML = list.map(function (g) {
      var d = window.DOMAINS[g.domain];
      /* C5 权威溯源：官方原文检索指引（诚实口径——不编造直链，给检索路径） */
      return '<div class="case-card">' +
        '<div class="case-domain" style="background:' + d.color + '1a;color:' + d.color + '">' + g.no + ' · ' + d.name + '</div>' +
        '<div class="case-title">' + esc(g.title) + '</div>' +
        '<div class="case-sec"><b>基本案情</b>' + esc(g.facts) + '</div>' +
        '<div class="case-sec"><b>裁判要点</b>' + esc(g.gist) + '</div>' +
        '<div class="case-lesson"><svg class=ico><use href=#i-d-patent></use></svg> <b>适用解析</b>' + esc(g.analysis) + '</div>' +
        '<div class="cw-url">来源：最高人民法院发布' + esc(g.no) + '——可在 court.gov.cn 检索「' + esc(g.no.replace("指导案例", "指导性案例")) + '」核对官方原文</div>' +
        '</div>';
    }).join("");
  }

  function init() {
    check().then(function () {
      /* 法条页：模式切换 */
      var btnOff = document.getElementById("law-mode-offline");
      var btnOn = document.getElementById("law-mode-online");
      var blockOff = document.getElementById("law-offline-block");
      var blockOn = document.getElementById("law-online-block");
      function pick(on) {
        btnOn.classList.toggle("active", on);
        btnOff.classList.toggle("active", !on);
        blockOn.classList.toggle("hidden", !on);
        blockOff.classList.toggle("hidden", on);
        if (on) ensureOnline(document.getElementById("flk-results"));
      }
      btnOn.addEventListener("click", function () { pick(true); });
      btnOff.addEventListener("click", function () { pick(false); });

      var flkBtn = document.getElementById("flk-btn");
      var flkInput = document.getElementById("flk-input");
      function doFlk() {
        var q = flkInput.value.trim();
        if (!q) return;
        if (!ensureOnline(document.getElementById("flk-results"))) return;
        document.getElementById("flk-results").innerHTML = '<div class="loading">正在检索国家法律法规数据库…</div>';
        flkSearch(q).then(function (resp) { renderFlkResp(resp); }).catch(function () {
          renderFlkResp({ ok: false, msg: "检索请求失败：请确认本地服务已启动、外网可访问 flk.npc.gov.cn。" });
        });
      }
      flkBtn.addEventListener("click", doFlk);
      flkInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doFlk(); });

      /* 案例页 */
      var caseBtn = document.getElementById("case-btn");
      var caseInput = document.getElementById("case-input");
      var site = "wenshu";
      document.querySelectorAll("#case-site-chips .filter-chip").forEach(function (c) {
        c.addEventListener("click", function () {
          document.querySelectorAll("#case-site-chips .filter-chip").forEach(function (x) { x.classList.remove("active"); });
          c.classList.add("active");
          site = c.getAttribute("data-site");
        });
      });
      function doCase() {
        var q = caseInput.value.trim();
        if (!q) { renderGuiding(""); return; }
        renderGuiding(q);
        if (!ensureOnline(document.getElementById("case-results"))) return;
        document.getElementById("case-results").innerHTML = '<div class="loading">正在检索公开案例…</div>';
        caseSearch(q, site).then(renderCaseResults).catch(function () {
          document.getElementById("case-results").innerHTML = '<div class="tool-warn">检索请求失败：请确认本地服务已启动、外网可访问。</div>';
        });
      }
      caseBtn.addEventListener("click", doCase);
      caseInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doCase(); });
      /* C2c：精读页签内的独立搜索框——此前 renderGuiding 只被在线页签的 case-input 触发，
         切到精读页签后输入框随 online 块隐藏，26+ 条精读案例在页签内无法搜索 */
      var gsInput = document.getElementById("guiding-search");
      if (gsInput) gsInput.addEventListener("input", function () { renderGuiding(gsInput.value); });
      renderOfficialSources();
      renderGuiding("");
    });
  }

  return {
    init: init, check: check,
    isAvailable: function () { return available; },
    flkSearch: flkSearch, flkDetail: flkDetail, flkText: flkText, caseSearch: caseSearch,
    renderGuiding: renderGuiding,
    _testFlkResp: renderFlkResp
  };
})();
