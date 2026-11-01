/* =========================================================
 * 法条检索 search.js
 * 关键词打分：法名/条号/标题/标签/正文 命中加权，支持高亮
 * ========================================================= */
(function () {
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function highlight(text, kw) {
    if (!kw) return esc(text);
    var safe = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return esc(text).replace(new RegExp(safe, "gi"), function (m) {
      return '<mark>' + m + '</mark>';
    });
  }

  function scoreLaw(law, tokens) {
    var score = 0;
    tokens.forEach(function (t) {
      if (!t) return;
      if (law.lawShort.indexOf(t) > -1) score += 6;
      if (law.law.indexOf(t) > -1) score += 4;
      if (law.article.indexOf(t) > -1) score += 8;
      if (law.title.indexOf(t) > -1) score += 5;
      law.tags.forEach(function (tag) { if (tag.indexOf(t) > -1) score += 4; });
      if (law.text.indexOf(t) > -1) score += 2;
      if (law.note && law.note.indexOf(t) > -1) score += 1;
    });
    return score;
  }

  /* 简单分词：按空格切分 + 对长词做2字滑窗，提升中文命中率 */
  function tokenize(q) {
    var out = [];
    q.split(/\s+/).forEach(function (seg) {
      if (!seg) return;
      if (/^[\u4e00-\u9fa5]{4,}$/.test(seg)) {
        for (var i = 0; i + 2 <= seg.length; i++) out.push(seg.substr(i, 2));
      } else {
        out.push(seg);
      }
    });
    return out;
  }

  function search(query, domain) {
    var tokens = tokenize(query.trim());
    var pool = window.LAWS.filter(function (l) { return !domain || l.domain === domain; });
    if (!query.trim()) return pool;
    var scored = pool.map(function (l) { return { l: l, s: scoreLaw(l, tokens) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; });
    return scored.map(function (x) { return x.l; });
  }

  /* ---------- 法条收藏夹 ---------- */
  var FAV_KEY = "legal-fav-laws";
  function getFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch (e) { return []; }
  }
  function setFavs(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 100))); } catch (e) {}
  }
  function isFav(id) { return getFavs().indexOf(id) > -1; }
  function toggleFav(id) {
    var favs = getFavs();
    var i = favs.indexOf(id);
    if (i > -1) favs.splice(i, 1); else favs.push(id);
    setFavs(favs);
    renderFavBar();
  }
  var _refresh = null;   /* init 时赋值，供收藏栏点击后刷新结果 */

  function renderFavBar() {
    var chipBox = document.getElementById("law-domain-chips");
    var favBar = document.getElementById("fav-bar");
    if (!chipBox) return;
    if (!favBar) {
      favBar = document.createElement("div");
      favBar.id = "fav-bar";
      favBar.className = "fav-bar";
      chipBox.parentNode.insertBefore(favBar, chipBox.nextSibling);
    }
    var favs = getFavs();
    if (!favs.length) { favBar.innerHTML = ""; favBar.classList.add("hidden"); return; }
    favBar.classList.remove("hidden");
    favBar.innerHTML = '<span class="fav-bar-label">★ 我的收藏：</span>';
    favs.forEach(function (id) {
      var l = window.lawById(id);
      if (!l) return;
      var chip = document.createElement("span");
      chip.className = "fav-chip";
      chip.innerHTML = '<b>' + esc(l.lawShort + " " + l.article) + '</b><span class="fx">✕</span>';
      chip.title = l.title + " — 点击查看，✕ 移除收藏";
      chip.addEventListener("click", function (e) {
        if (e.target.classList.contains("fx")) {
          toggleFav(id);
          return;
        }
        var input = document.getElementById("law-search-input");
        input.value = l.title;
        if (_refresh) _refresh();
      });
      favBar.appendChild(chip);
    });
  }

  function renderList(container, query, domain) {
    var results = search(query, domain);
    container.innerHTML = "";
    if (!results.length) {
      container.innerHTML = '<div class="empty">未找到匹配的法条，试试其他关键词，如「经济补偿」「注册资本」「竞业限制」「赔偿」。</div>';
      return;
    }
    var favs = getFavs();
    results.forEach(function (l) {
      var d = window.DOMAINS[l.domain];
      var card = document.createElement("div");
      card.className = "law-card";
      card.innerHTML =
        '<div class="law-head">' +
          '<span class="domain-chip" style="background:' + d.color + '1a;color:' + d.color + '">' + d.icon + " " + d.name + '</span>' +
          '<span class="law-name">' + highlight(l.law, query) + '</span>' +
          '<span class="law-article">' + highlight(l.article, query) + '</span>' +
          '<button class="fav-star" data-favid="' + esc(l.id) + '" title="收藏此法条">' + (favs.indexOf(l.id) > -1 ? "★" : "☆") + '</button>' +
        '</div>' +
        '<div class="law-title">' + highlight(l.title, query) + '</div>' +
        '<div class="law-text">' + highlight(l.text, query) + '</div>' +
        (l.note ? '<div class="law-note">💡 ' + highlight(l.note, query) + '</div>' : '') +
        (l.url ? '<a class="mini-btn" target="_blank" rel="noopener" href="' + esc(l.url) + '" style="margin:8px 6px 0 0">🔗 官方原文（英文）</a>' : '') +
        '<div class="law-tags">' + l.tags.map(function (t) { return '<i>#' + esc(t) + '</i>'; }).join("") + '</div>';
      container.appendChild(card);
    });
    var count = document.getElementById("law-count");
    if (count) count.textContent = "共 " + results.length + " 条结果";
  }

  window.LAWSEARCH = {
    init: function () {
      var input = document.getElementById("law-search-input");
      var btn = document.getElementById("law-search-btn");
      var container = document.getElementById("law-results");
      var chipBox = document.getElementById("law-domain-chips");
      var currentDomain = "";

      /* 领域筛选 chips 由注册表动态生成（只显示有法条数据的领域） */
      if (chipBox) {
        window.DomainRegistry.metas().forEach(function (d) {
          var hasLaws = window.DomainRegistry.collect("laws", d.id).length > 0;
          if (!hasLaws) return;
          var c = document.createElement("button");
          c.className = "filter-chip";
          c.setAttribute("data-domain", d.id);
          c.innerHTML = d.icon + " " + esc(d.name);
          chipBox.appendChild(c);
        });
      }
      var chips = chipBox ? Array.prototype.slice.call(chipBox.querySelectorAll(".filter-chip")) : [];

      function refresh() { renderList(container, input.value, currentDomain); }
      _refresh = refresh;
      function selectChip(active) {
        chips.forEach(function (c) { c.classList.toggle("active", c === active); });
      }
      /* 收藏星标（容器级委托，重渲染后依然有效） */
      container.addEventListener("click", function (e) {
        var star = e.target.closest ? e.target.closest(".fav-star") : null;
        if (!star) return;
        toggleFav(star.getAttribute("data-favid"));
        refresh();
      });
      renderFavBar();
      chips.forEach(function (c) {
        c.addEventListener("click", function () {
          currentDomain = c.getAttribute("data-domain") || "";
          selectChip(c);
          refresh();
        });
      });
      btn.addEventListener("click", refresh);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") refresh(); });
      input.addEventListener("input", function () {
        clearTimeout(input._t);
        input._t = setTimeout(refresh, 200);
      });
      refresh();
    }
  };
})();
