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
    /* App 内：路由到原生桥直连实现（逻辑与 server.js 同源） */
    if (base === "bridge") {
      if (path === "/api/flk/search") return flkBridgeSearch(params.q, params.page || 1);
      if (path === "/api/flk/detail") return flkBridgeDetail(params.id);
      if (path === "/api/cases/search") return caseBridgeSearch(params.q, params.site || "wenshu");
      return Promise.resolve({ ok: false, msg: "未知接口：" + path });
    }
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
    /* ── App 内：原生桥直连官方公开接口，无需本地代理 ── */
    if (window.BRIDGE && window.BRIDGE.available) {
      base = "bridge";
      available = true;
      updateBadge();
      return Promise.resolve(true);
    }
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
      var sub = base === "bridge" ? "App 内置直连 flk 官方库" : "flk.npc.gov.cn 已连接";
      badge.className = "net-badge on";
      badge.innerHTML = '● 联网模式<span class="nb-sub">' + sub + '</span>';
    } else {
      badge.className = "net-badge off";
      badge.innerHTML = '○ 离线模式<span class="nb-sub">联网检索暂不可用</span>';
    }
  }

  function ensureOnline(container) {
    if (available) return true;
    if (container) {
      container.innerHTML =
        '<div class="online-off">' +
        '<b>联网检索暂不可用</b><br>' +
        '请检查手机网络连接后重试；离线功能（本地法条、计算器、内置案例）不受影响。<br>' +
        '<span class="dim">联网模式由 App 内置网络通道直连国家法律法规数据库 / 裁判文书网的公开检索接口。</span>' +
        '</div>';
    }
    return false;
  }

  /* ---------- App 内置直连实现（原生桥，逻辑与 server.js 同源） ---------- */
  var FLK = "https://flk.npc.gov.cn";
  var FLK_HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Referer": "https://flk.npc.gov.cn/",
    "Origin": "https://flk.npc.gov.cn",
    "X-Requested-With": "XMLHttpRequest"
  };
  var FLK_GET_HEADERS = { "Referer": "https://flk.npc.gov.cn/", "Origin": "https://flk.npc.gov.cn", "X-Requested-With": "XMLHttpRequest" };

  function htmlToText(html) {
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim();
  }

  function flkBridgeSearch(q, page) {
    var payload = JSON.stringify({
      searchContent: q, searchRange: 1, searchType: 2,
      sxx: [], gbrq: [], sxrq: [],
      pageNum: page || 1, pageSize: 10
    });
    return window.BRIDGE.http("POST", FLK + "/law-search/search/list", FLK_HEADERS, payload).then(function (r) {
      if (r.status >= 400) return { ok: false, msg: "flk 返回 " + r.status + "，可能被临时限流，请稍后重试" };
      var json;
      try { json = JSON.parse(r.text); }
      catch (e) { return { ok: false, msg: "flk 返回异常，可能被临时限流，请稍后重试" }; }
      if (json.code !== 200) return { ok: false, msg: "flk 检索失败：" + json.msg };
      var list = (json.rows || []).map(function (it) {
        return {
          id: it.bbbs,
          title: String(it.title || "").replace(/<[^>]+>/g, ""),
          office: it.zdjgName,
          publish: it.gbrq || "",
          expiry: it.sxrq || "",
          type: it.flxz,
          status: String(it.sxx)   /* 1=已废止 2=已被修改 3=有效 4=尚未生效 */
        };
      });
      return { ok: true, q: q, total: json.total || list.length, results: list };
    });
  }

  function flkBridgeDetail(id) {
    var metaUrl = FLK + "/law-search/search/flfgDetails?bbbs=" + encodeURIComponent(id);
    return window.BRIDGE.http("GET", metaUrl, FLK_GET_HEADERS, "").then(function (r) {
      if (r.status >= 400) return { ok: false, msg: "flk 详情返回 " + r.status };
      var json;
      try { json = JSON.parse(r.text); }
      catch (e) { return { ok: false, msg: "flk 详情返回异常" }; }
      if (json.code !== 200 || !json.data) return { ok: false, msg: "flk 详情获取失败：" + json.msg };
      var d = json.data;
      function signed(path) {
        return window.BRIDGE.http("GET", FLK + path, FLK_GET_HEADERS, "").then(function (r2) {
          try {
            var j = JSON.parse(r2.text || "{}");
            return j.code === 200 && j.data && j.data.url ? j.data.url : null;
          } catch (e) { return null; }
        }).catch(function () { return null; });
      }
      var previewPath = (d.ossFile && d.ossFile.ossWordPath)
        ? "/law-search/amazonFile/previewLink?filePath=" + encodeURIComponent(d.ossFile.ossWordPath) : null;
      return Promise.all([
        previewPath ? signed(previewPath) : Promise.resolve(null),
        signed("/law-search/download/pc?format=docx&bbbs=" + encodeURIComponent(id)),
        signed("/law-search/download/pc?format=pdf&bbbs=" + encodeURIComponent(id))
      ]).then(function (arr) {
        return {
          ok: true, title: d.title, text: "",
          meta: { flxz: d.flxz, office: d.zdjgName, publish: d.gbrq, expiry: d.sxrq, status: String(d.sxx) },
          links: { preview: arr[0], word: arr[1], pdf: arr[2], relatedCount: (d.xgzl || []).length }
        };
      });
    });
  }

  function bingBridgeSearch(query) {
    var u = "https://cn.bing.com/search?q=" + encodeURIComponent(query) + "&count=12&mkt=zh-CN";
    return window.BRIDGE.http("GET", u, { "Accept-Language": "zh-CN,zh;q=0.9" }, "").then(function (r) {
      if (r.status >= 400) throw new Error("搜索引擎返回 " + r.status);
      var html = String(r.text || "");
      var out = [];
      var re = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g, m;
      while ((m = re.exec(html)) && out.length < 10) {
        var block = m[1];
        var tm = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!tm) continue;
        var url0 = tm[1].replace(/&amp;/g, "&");
        var title = htmlToText(tm[2]);
        var sm = block.match(/<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) || block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        var snippet = sm ? htmlToText(sm[1]) : "";
        if (title && url0.indexOf("http") === 0) out.push({ title: title, url: url0, snippet: snippet });
      }
      return out;
    });
  }

  function caseBridgeSearch(q, site) {
    var siteFilter = site === "court" ? "site:www.court.gov.cn" : "site:wenshu.court.gov.cn";
    var extra = site === "court" ? "指导案例" : "";
    return bingBridgeSearch(siteFilter + " " + q + " " + extra).then(function (list) {
      if (list.length) return { ok: true, q: q, site: site, results: list };
      /* 文书网无结果时，用第二策略：去掉 site: 限定补充检索 */
      return bingBridgeSearch(q + " 裁判文书 " + (site === "court" ? "指导性案例" : "")).then(function (l2) {
        return { ok: true, q: q, site: site, results: (l2 || []).filter(function (x) { return /court\.gov\.cn|chinacourt|zhongcai|wenshu/i.test(x.url); }) };
      });
    });
  }

  /* ---------- 法条检索（flk） ---------- */
  function flkSearch(q, page) {
    return api("/api/flk/search", { q: q, page: page || 1 });
  }
  function flkDetail(id) {
    return api("/api/flk/detail", { id: id });
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
        flkDetail(item.getAttribute("data-id")).then(function (r) {
          if (!r.ok) { bodyEl.innerHTML = '<div class="tool-warn">' + esc(r.msg || "获取失败，请稍后重试") + '</div>'; return; }
          var links = r.links || {};
          var m = r.meta || {};
          var chip = function (t) { return '<span class="prop">' + esc(t) + '</span>'; };
          var okCls = m.status === "3" ? "ok" : "warn";
          bodyEl.innerHTML =
            '<div class="flk-props">' +
              (m.flxz ? chip("性质：" + m.flxz) : "") +
              (m.office ? chip("制定机关：" + m.office) : "") +
              (m.publish ? chip("公布：" + m.publish) : "") +
              (m.expiry ? chip("施行：" + m.expiry) : "") +
              (m.status ? '<span class="prop ' + okCls + '">' + (STATUS_MAP[m.status] || esc(m.status)) + '</span>' : "") +
            '</div>' +
            '<div class="flk-actions">' +
              (links.preview ? '<a class="mini-btn primary" target="_blank" rel="noopener" href="' + esc(links.preview) + '">📖 官方在线预览</a>' : "") +
              (links.word ? '<a class="mini-btn" target="_blank" rel="noopener" href="' + esc(links.word) + '">下载 Word 正式文本</a>' : "") +
              (links.pdf ? '<a class="mini-btn" target="_blank" rel="noopener" href="' + esc(links.pdf) + '">下载 PDF 正式文本</a>' : "") +
              (links.relatedCount ? '<span class="prop">相关资料 ' + esc(links.relatedCount) + ' 件</span>' : "") +
            '</div>' +
            '<div class="dim" style="margin-top:8px;font-size:12.5px">正文由数据库以 Word/PDF 正式文本提供（官方签名直链，约1小时内有效）；「在线预览」为官方阅读器页面。</div>';
          bodyEl.dataset.loaded = "1";
        }).catch(function () {
          bodyEl.innerHTML = '<div class="tool-warn">网络请求失败，请检查手机网络后重试。</div>';
        });
      });
    });
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
          document.getElementById("flk-results").innerHTML = '<div class="tool-warn">检索请求失败：请检查手机网络后重试。</div>';
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
          document.getElementById("case-results").innerHTML = '<div class="tool-warn">检索请求失败：请检查手机网络后重试。</div>';
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
    flkSearch: flkSearch, flkDetail: flkDetail, caseSearch: caseSearch,
    renderGuiding: renderGuiding
  };
})();
