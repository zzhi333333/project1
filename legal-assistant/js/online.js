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
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var STATUS_MAP = { "1": "已废止", "2": "已被修改", "3": "有效", "4": "尚未生效" };

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
        (fromCache ? '<span class="prop ok">📦 本地缓存版本</span>' : "") +
      '</div>' +
      (fullText ? '<div class="flk-doc">' + esc(fullText) + '</div>' : "") +
      '<div class="flk-actions">' +
        (links.preview ? '<a class="mini-btn primary" target="_blank" rel="noopener" href="' + esc(links.preview) + '">📖 官方在线预览</a>' : "") +
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

  function renderCaseResults(r) {
    var box = document.getElementById("case-results");
    var siteName = r.site === "court" ? "最高人民法院官网（指导性案例·裁判文书）" : "中国裁判文书网";
    if (!r.ok) {
      box.innerHTML = '<div class="tool-warn">' + esc(r.msg || "检索失败") + '</div>';
      return;
    }
    var items = r.results || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty">未通过公开搜索定位到「' + esc(r.q) + '」相关文书。可简化关键词后重试，或直接到 <a href="https://wenshu.court.gov.cn" target="_blank" rel="noopener">中国裁判文书网</a> 检索（部分文书需登录）。</div>';
      return;
    }
    var html = '<div class="flk-meta">经公开搜索引擎定位 · ' + esc(siteName) + ' 相关结果（点击标题打开原文）</div>';
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
      return '<div class="case-card">' +
        '<div class="case-domain" style="background:' + d.color + '1a;color:' + d.color + '">' + g.no + ' · ' + d.name + '</div>' +
        '<div class="case-title">' + esc(g.title) + '</div>' +
        '<div class="case-sec"><b>基本案情</b>' + esc(g.facts) + '</div>' +
        '<div class="case-sec"><b>裁判要点</b>' + esc(g.gist) + '</div>' +
        '<div class="case-lesson">💡 <b>适用解析</b>' + esc(g.analysis) + '</div>' +
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
        flkSearch(q).then(function (resp) { renderFlkResults(resp.results, resp.total); }).catch(function () {
          document.getElementById("flk-results").innerHTML = '<div class="tool-warn">检索请求失败：请确认本地服务已启动、外网可访问 flk.npc.gov.cn。</div>';
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
      renderGuiding("");
    });
  }

  return {
    init: init, check: check,
    isAvailable: function () { return available; },
    flkSearch: flkSearch, flkDetail: flkDetail, flkText: flkText, caseSearch: caseSearch,
    renderGuiding: renderGuiding
  };
})();
