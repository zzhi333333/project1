/* =========================================================
 * theme.js —— 主题/外观（v3.8.0 扩展：暖纸第三主题 + 大字模式 + 设置分段）
 * 历史：v3.6.2 自 index.html 内联脚本外部化（批次 G CSP 无 script-src 拦内联）。
 * 主题四态：""（跟随系统）/ light / dark / warm（暖纸，固定浅暖——卷宗气质）。
 * 字号：html[data-fontscale="large"]（zoom 1.15 全局等比）。
 * 设置弹层分段：[data-themesel] / [data-fontsel] 点击即存即用；启动时恢复。
 * 移动端无 #theme-toggle 按钮时仅应用已存偏好（安全早退）。
 * ========================================================= */
(function () {
  var btn = document.getElementById("theme-toggle");
  var KEY = "legal-theme";
  var FKEY = "legal-fontscale";
  var THEMES = ["", "light", "dark", "warm"];

  function apply(t) {
    var de = document.documentElement;
    if (!de) return;   /* check.js VM 沙箱 document 桩无 documentElement（同 ui.js 守卫先例） */
    if (t) de.setAttribute("data-theme", t);
    else de.removeAttribute("data-theme");
    if (!btn) return;
    var use = btn.querySelector("use");
    if (use) use.setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
    btn.title = "选择主题（跟随系统/浅色/深色/暖纸）";
  }
  function applyFont(fs) {
    var de = document.documentElement;
    if (!de) return;
    if (fs) de.setAttribute("data-fontscale", fs);   /* v4.0.21：任意档位（large=1.15 / large2=1.3 特大） */
    else de.removeAttribute("data-fontscale");
  }
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  /* 启动清理：data-theme=""（空串属性，历史代码/调试残留）等效未设置——
     空串会使 html:not([data-theme]) 等主题令牌块全部不命中（P0-② 同款坑） */
  try { if (document.documentElement.getAttribute("data-theme") === "") document.documentElement.removeAttribute("data-theme"); } catch (e) { }
  apply(get(KEY, null));
  applyFont(get(FKEY, ""));

  /* 顶栏主题按钮（web）：四主题时代「循环」是反模式——每次点击都先套用中间态
     （要到暖纸得连按三次、路过不想要的深/浅）。改为打开设置弹层并定位外观分段
     （四选分段 v3.8.0 已存在，零新组件）；无设置弹层的页面兜底维持旧循环 */
  if (btn) {
    btn.title = "选择主题（跟随系统/浅色/深色/暖纸）";
    btn.addEventListener("click", function () {
      var gear = document.getElementById("settings-gear-btn");
      if (gear) {
        gear.click();
        var seg = document.getElementById("seg-theme");
        if (seg && seg.scrollIntoView) seg.scrollIntoView({ block: "center" });
        return;
      }
      var cur = document.documentElement.getAttribute("data-theme") || "";
      var idx = THEMES.indexOf(cur);
      var next = THEMES[(idx + 1) % THEMES.length];
      set(KEY, next);
      apply(next);
    });
  }

  /* 设置弹层外观分段（v3.8.0）：主题四选 / 字号两选，点击即存即用。
     try/catch 守卫：check.js VM 沙箱 document 桩无 querySelector（同 ui.js 先例） */
  function bindSeg(sel, attr, key, applyFn) {
    try {
      var box = document.querySelector(sel);
      if (!box) return;
      var btns = box.querySelectorAll("[" + attr + "]");
      function sync() {
        btns.forEach(function (b) { b.classList.toggle("on", b.getAttribute(attr) === get(key, "")); });
      }
      btns.forEach(function (b) {
        b.addEventListener("click", function () {
          set(key, b.getAttribute(attr));
          applyFn(b.getAttribute(attr));
          sync();
        });
      });
      sync();
    } catch (e) { }
  }
  bindSeg("#seg-theme", "data-themesel", KEY, apply);
  bindSeg("#seg-font", "data-fontsel", FKEY, applyFont);
})();
