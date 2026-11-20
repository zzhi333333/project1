/* =========================================================
 * mobile.js —— 移动端专属交互（在 main.js 之后加载）
 *  ① 侧滑抽屉开关（对话记录 + 快捷咨询）
 *  ② 切换视图后重置该视图滚动位置（原 window.scrollTo 对每视图自滚动无效）
 *  ③ 外链交给系统浏览器/下载器（App 内 WebView 只承载本地页面）
 *  ④ 输入框聚焦时滚动到底（配合 adjustResize 兜底）
 * ========================================================= */
(function () {

  /* ---------- ① 抽屉 ---------- */
  var drawer = document.getElementById("drawer");
  var mask = document.getElementById("drawer-mask");
  var toggle = document.getElementById("drawer-toggle");

  function openDrawer() { drawer.classList.add("open"); mask.classList.remove("hidden"); }
  function closeDrawer() { drawer.classList.remove("open"); mask.classList.add("hidden"); }

  toggle.addEventListener("click", function () {
    drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  mask.addEventListener("click", closeDrawer);

  /* 在抽屉里点了会话/场景后自动收起（等点击处理完成） */
  drawer.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    if (e.target.closest(".quick-card") || e.target.closest(".session-item")) {
      setTimeout(closeDrawer, 140);
    }
  });

  /* ---------- ② 视图滚动重置 ---------- */
  var origSwitch = window.APP.switchView;
  window.APP.switchView = function (name) {
    origSwitch(name);
    var v = document.getElementById("view-" + name);
    if (v) v.scrollTop = 0;
    closeDrawer();
  };

  /* ---------- ②b 「更多」弹层（收纳低频视图：合同/案例/讲堂/全局搜索） ---------- */
  var moreTab = document.getElementById("more-tab");
  var moreSheet = document.getElementById("more-sheet");
  var moreMask = document.getElementById("more-sheet-mask");
  if (moreTab && moreSheet && moreMask) {
    function openSheet() { moreSheet.classList.add("open"); moreMask.classList.remove("hidden"); }
    function closeSheet() { moreSheet.classList.remove("open"); moreMask.classList.add("hidden"); }
    moreTab.addEventListener("click", function () {
      moreSheet.classList.contains("open") ? closeSheet() : openSheet();
    });
    moreMask.addEventListener("click", closeSheet);
    var moreClose = document.getElementById("more-close");
    if (moreClose) moreClose.addEventListener("click", closeSheet);
    moreSheet.addEventListener("click", function (e) {
      var item = e.target.closest ? e.target.closest(".more-item") : null;
      if (!item) return;
      var v = item.getAttribute("data-view");
      closeSheet();
      if (item.id === "more-settings") {
        var sm = document.getElementById("settings-modal");
        if (sm) sm.classList.remove("hidden");
        return;
      }
      if (v === "gsearch") {
        var g = document.getElementById("gsearch-btn");
        if (g) g.click();
        return;
      }
      window.APP.switchView(v);
      /* 被收纳的视图在 tabbar 无对应 tab——active 高亮到「更多」上 */
      document.querySelectorAll(".tabbar .nav-tab").forEach(function (t) { t.classList.remove("active"); });
      moreTab.classList.add("active");
    });
    /* 选中 5 个主 tab 时恢复其自身高亮（switchView 已处理），并确保更多态清除 */
    document.querySelectorAll(".tabbar .nav-tab[data-view]:not([data-view='more'])").forEach(function (t) {
      t.addEventListener("click", function () { closeSheet(); });
    });
  }

  /* ---------- ③ 外链接管 ---------- */
  if (window.BRIDGE && window.BRIDGE.available) {
    document.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      var a = e.target.closest('a[target="_blank"]');
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("http") !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      window.BRIDGE.openUrl(href);
    }, true);
  }

  /* ---------- ④ 键盘弹出兜底 ---------- */
  var input = document.getElementById("consult-input");
  if (input) {
    /* auto-grow：随内容自动长高（CSS 上限约 6 行），清空/发送后重置；
       微信式发送按钮：有内容才出现，清空后隐藏；
       dataset.stop（AI 生成中停止同位互换）守卫：停止键不因输入框为空被藏起 */
    var sendBtn = document.getElementById("consult-send");
    var grow = function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 132) + "px";
      if (sendBtn) sendBtn.classList.toggle("hidden", input.value.length === 0 && sendBtn.dataset.stop !== "1");
    };
    input.addEventListener("input", grow);
    input.addEventListener("input", function () { input.dataset.base = input.value; });
    window.addEventListener("resize", grow);
    grow();
  }
  if (input) {
    input.addEventListener("focus", function () {
      setTimeout(function () {
        var box = document.getElementById("chat-box");
        if (box) box.scrollTop = box.scrollHeight;
      }, 320);
    });
  }

  /* ---------- ⑤ 历史消息里的死按钮 ----------
     场景问答的状态只存在内存中，刷新后恢复的历史问题按钮没有事件
     处理器，保持可点会误导用户——统一禁用（新出现的问题不受影响） */
  (function disableRestoredQuestionButtons() {
    var box = document.getElementById("chat-box");
    if (!box) return;
    box.querySelectorAll(".q-btn").forEach(function (b) {
      b.disabled = true;
      b.classList.add("dim");
    });
  })();

  /* ---------- ⑦ 引导场景数动态化（领域扩充后数字自动更新） ---------- */
  var sceneSpan = document.getElementById("guide-scene-count");
  if (sceneSpan && window.SCENARIOS) {
    sceneSpan.textContent = "在「智能咨询」直接提问，或点左上角 ☰ 从 " +
      window.SCENARIOS.length + " 个场景开始，系统会澄清关键事实后给出分析。";
  }

  /* ---------- ⑧ 意见书打印/PDF：走系统打印服务 ----------
     桌面的打印入口（意见书按钮 / 结果卡打印）最终都调 window.print()，
     WebView 中无效——这里整体替换为原生 PrintManager；
     打印内容由 @media print 样式（body.print-mode + .print-target）裁剪，
     原生打印对话框弹出后延时恢复页面元素（WebView 无 afterprint 事件） */
  if (window.BRIDGE && window.BRIDGE.available) {
    window.print = function () {
      window.BRIDGE.printDoc("法律咨询意见书");
      setTimeout(function () {
        var el = document.querySelector(".print-target");
        if (el) el.classList.remove("print-target");
        document.body.classList.remove("print-mode");
      }, 1500);
    };
    var printBtn = document.getElementById("agent-print");
    if (printBtn) {
      printBtn.addEventListener("click", function () {
        window.BRIDGE.printDoc("法律咨询意见书");
      }, true);
    }
  }

  /* ---------- ⑧ 通知：App 环境提示（一次性） ---------- */
  window.addEventListener("load", function () {
    if (window.BRIDGE && window.BRIDGE.available) {
      console.log("[mobile] 原生桥已连接，App 版本 " + window.BRIDGE.version());
    }
  });

  /* ---------- ⑨ 系统分享接收 + 返回键关弹层（v3.5.2 批次 G，原生经 jsCall 调用） ---------- */
  /* __brShare：微信/浏览器「分享到」文本 → 咨询输入框（清洗链接行与空行，不自动发送） */
  window.__brShare = function (text) {
    try {
      if (window.APP && APP.switchView) APP.switchView("consult");
      var input = document.getElementById("consult-input");
      if (!input) return;
      var t = String(text || "").split("\n")
        .filter(function (l) { return l.trim() && !/^https?:\/\//i.test(l.trim()); })
        .join("\n").trim();
      input.value = t.slice(0, 1800);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      if (window.UIKIT) UIKIT.toast("已带入分享内容——请补充案情后发送", "ok");
    } catch (e) { }
  };
  /* __brCloseTopOverlay：返回键触发——关最上层浮层（modal > 更多弹层 > 抽屉） */
  window.__brCloseTopOverlay = function () {
    var open = document.querySelectorAll(".modal:not(.hidden)");
    if (open.length) {
      var m = open[open.length - 1].querySelector(".modal-mask");
      if (m) { m.click(); return; }
    }
    if (moreSheet && moreSheet.classList.contains("open")) {
      moreSheet.classList.remove("open");
      if (moreMask) moreMask.classList.add("hidden");
      return;
    }
    if (drawer && drawer.classList.contains("open")) closeDrawer();
  };
  /* 浮层数量推送：原生返回键据此决定「先关层」还是「双击退出」 */
  function pushOverlayCount() {
    var n = document.querySelectorAll(".modal:not(.hidden)").length;
    if (moreSheet && moreSheet.classList.contains("open")) n++;
    if (drawer && drawer.classList.contains("open")) n++;
    try { if (window.AndroidBridge && AndroidBridge.overlayCount) AndroidBridge.overlayCount(n); } catch (e) { }
  }
  try {
    new MutationObserver(pushOverlayCount).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class"]
    });
  } catch (e) { }
  setTimeout(pushOverlayCount, 1500);

  /* ---------- ⑩ 设置弹层（v3.6.0 IA）：开关 / AI 入口 / GitHub ---------- */
  try {
    var openSettings = function () {
      var sm = document.getElementById("settings-modal");
      if (sm) sm.classList.remove("hidden");
      pushOverlayCount();
    };
    var msBtn = document.getElementById("more-settings");
    if (msBtn) msBtn.addEventListener("click", openSettings);
    var sClose = document.getElementById("settings-close");
    if (sClose) sClose.addEventListener("click", function () {
      var sm = document.getElementById("settings-modal");
      if (sm) sm.classList.add("hidden");
      pushOverlayCount();
    });
    var sMask = document.querySelector("#settings-modal .modal-mask");
    if (sMask) sMask.addEventListener("click", function () {
      var sm = document.getElementById("settings-modal");
      if (sm) sm.classList.add("hidden");
      pushOverlayCount();
    });
    var oai = document.getElementById("open-ai-settings");
    if (oai) oai.addEventListener("click", function () {
      var sm = document.getElementById("settings-modal");
      if (sm) sm.classList.add("hidden");
      var am = document.getElementById("ai-modal");
      if (am) am.classList.remove("hidden");
      pushOverlayCount();
    });
    var gh = document.getElementById("about-github");
    if (gh) gh.addEventListener("click", function () {
      try {
        /* 仅链接移动版子目录（用户指定）：web 端不在此页展示范围 */
        if (window.BRIDGE && BRIDGE.openUrl) BRIDGE.openUrl("https://github.com/zzhi333333/project1/tree/main/legal-assistant%20mobile");
        else window.open("https://github.com/zzhi333333/project1/tree/main/legal-assistant%20mobile", "_blank");
      } catch (e) { }
    });
  } catch (e) { }
})();
