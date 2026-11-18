/* =========================================================
 * 应用锁（轻量档）applock.js
 * —— 4-6 位数字 PIN；SHA-256(salt+pin) 本地哈希（SubtleCrypto 原生，零依赖）；
 *    启动即锁 + 切后台超 3 分钟回锁；设置弹层「应用锁」段开关/改 PIN。
 * 诚实边界：PIN 哈希存 localStorage，清应用数据即失效——定位为防窥屏门锁，非保险柜。
 * ========================================================= */
(function () {
  var KEY = "legal-applock";
  var RELOCK_MS = 3 * 60 * 1000; /* 切后台超时回锁：3 分钟 */
  var S = { enabled: false, salt: "", hash: "", len: 4 };
  try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  function save() { localStorage.setItem(KEY, JSON.stringify(S)); }

  function sha(s) {
    if (!(window.crypto && window.crypto.subtle)) return Promise.reject(new Error("当前环境加密能力不可用"));
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
      var a = new Uint8Array(buf), h = "";
      for (var i = 0; i < a.length; i++) h += ("0" + a[i].toString(16)).slice(-2);
      return h;
    });
  }

  var layer = null, dots = null, errEl = null, padEl = null;
  var buf = "", mode = "locked", firstPin = "", hiddenAt = 0;
  var commitTimer = null;

  /* 提交调度：验证类模式（locked/change-old）长度精确、输入即验；
   * 设置类模式（setup/confirm/change-new/change-confirm）支持 4-6 位——
   * 到 4 位后 700ms 无新输入才提交，期间继续按键则累加重置计时 */
  function armCommit() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    var fixed = (mode === "locked" || mode === "change-old");
    var min = fixed ? S.len : 4;
    if (buf.length < min || buf.length > 6) return;
    if (fixed) { tryPin(); return; }
    commitTimer = setTimeout(function () { commitTimer = null; tryPin(); }, 700);
  }
  function disarmCommit() { if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; } }

  function build() {
    if (layer) return;
    layer = document.createElement("div");
    layer.id = "applock";
    layer.innerHTML =
      '<div class="al-card">' +
        '<img class="al-avatar" src="img/xiezhi-avatar.png" alt="">' +
        '<div class="al-title" id="al-title">已锁定</div>' +
        '<div class="al-dots" id="al-dots"></div>' +
        '<div class="al-err" id="al-err"></div>' +
        '<div class="al-pad" id="al-pad"></div>' +
        '<button class="al-cancel hidden" id="al-cancel" type="button">取消</button>' +
      '</div>';
    document.body.appendChild(layer);
    dots = layer.querySelector("#al-dots");
    errEl = layer.querySelector("#al-err");
    padEl = layer.querySelector("#al-pad");
    var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
    keys.forEach(function (k) {
      var b = document.createElement("button");
      b.className = "al-key" + (k === "" ? " wide" : "");
      b.type = "button";
      b.textContent = k === "" ? "" : k;
      b.setAttribute("aria-label", k === "" ? "退格" : k);
      b.addEventListener("click", function () {
        if (k === "") { buf = buf.slice(0, -1); disarmCommit(); }
        else if (buf.length < 6) { buf += k; }
        draw();
        if (k !== "") armCommit();
      });
      padEl.appendChild(b);
    });
    var cancelBtn2 = layer.querySelector("#al-cancel");
    if (cancelBtn2) cancelBtn2.addEventListener("click", function () {
      disarmCommit();
      buf = ""; firstPin = "";
      mode = "locked";
      hide(); syncCheckbox();
    });
  }
  function draw() {
    if (!dots) return;
    var s = "";
    for (var i = 0; i < Math.max(S.len, buf.length); i++) s += i < buf.length ? "●" : "○";
    dots.textContent = s;
  }
  function err(msg) {
    if (!errEl) return;
    errEl.textContent = msg || "";
    if (msg) {
      var card = layer.querySelector(".al-card");
      card.classList.remove("shake");
      void card.offsetWidth;
      card.classList.add("shake");
    }
  }
  function show(m, title) {
    mode = m;
    build();
    disarmCommit();
    buf = "";
    draw();
    err("");
    var cancelBtn = layer.querySelector("#al-cancel");
    if (cancelBtn) cancelBtn.classList.toggle("hidden", m === "locked");
    layer.querySelector("#al-title").textContent = title || (m === "locked" ? "已锁定" : m === "setup" ? "设置 PIN（4-6 位）" : m === "setup-confirm" ? "再次输入确认" : m === "change-old" ? "输入当前 PIN" : "设置新 PIN（4-6 位）");
    layer.classList.remove("hidden");
    draw();
  }
  function hide() { if (layer) layer.classList.add("hidden"); }

  function tryPin() {
    var pin = buf;
    if (mode === "locked") {
      sha(S.salt + pin).then(function (h) {
        if (h === S.hash) { hide(); buf = ""; }
        else { buf = ""; draw(); err("PIN 不正确，请重试"); }
      }).catch(function (e) { err(e.message); });
    } else if (mode === "setup") {
      if (pin.length < 4) { err("PIN 至少 4 位"); buf = ""; draw(); return; }
      firstPin = pin; buf = ""; draw();
      mode = "setup-confirm";
      layer.querySelector("#al-title").textContent = "再次输入确认";
      draw();
    } else if (mode === "setup-confirm") {
      if (pin === firstPin) {
        /* 首次设置生成随机盐（8 字节 hex），防同 PIN 同哈希 */
        if (!S.salt) {
          var r = new Uint8Array(8);
          crypto.getRandomValues(r);
          S.salt = Array.prototype.map.call(r, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
        }
        sha(S.salt + pin).then(function (h) {
          S.hash = h; S.len = firstPin.length; S.enabled = true; save();
          syncCheckbox();
          hide(); buf = "";
          mode = "locked";
          if (window.UIKIT && window.UIKIT.toast) window.UIKIT.toast("应用锁已启用");
        }).catch(function (e) { err(e.message); });
      } else {
        buf = ""; firstPin = ""; mode = "setup"; draw(); err("两次输入不一致，请重新设置");
      }
    } else if (mode === "change-old") {
      sha(S.salt + pin).then(function (h) {
        if (h !== S.hash) { buf = ""; draw(); err("当前 PIN 不正确"); return; }
        buf = ""; firstPin = ""; mode = "change-new";
        layer.querySelector("#al-title").textContent = "设置新 PIN（4-6 位）";
        draw();
      }).catch(function (e) { err(e.message); });
    } else if (mode === "change-new") {
      if (pin.length < 4) { err("PIN 至少 4 位"); buf = ""; draw(); return; }
      firstPin = pin; buf = ""; draw();
      mode = "change-confirm";
      layer.querySelector("#al-title").textContent = "再次输入确认";
      draw();
    } else if (mode === "change-confirm") {
      if (pin === firstPin) {
        /* 改 PIN 同样补盐（老数据迁移自无盐版本）+ 同步新长度 */
        if (!S.salt) {
          var r2 = new Uint8Array(8);
          crypto.getRandomValues(r2);
          S.salt = Array.prototype.map.call(r2, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
        }
        sha(S.salt + firstPin).then(function (h) {
          S.hash = h; S.len = firstPin.length; save();
          hide(); buf = ""; mode = "locked";
          syncCheckbox();
          if (window.UIKIT && window.UIKIT.toast) window.UIKIT.toast("PIN 已修改");
        }).catch(function (e) { err(e.message); });
      } else { buf = ""; draw(); err("两次输入不一致"); }
    }
  }

  /* 设置弹层联动 */
  function syncCheckbox() {
    var cb = document.getElementById("applock-enable");
    if (cb) cb.checked = S.enabled;
    var btn = document.getElementById("applock-change");
    if (btn) btn.classList.toggle("hidden", !S.enabled);
  }

  /* 切后台回锁 */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (S.enabled && hiddenAt && Date.now() - hiddenAt > RELOCK_MS) {
      if (!layer) build();
      show("locked");
    }
  });

  /* 启动即锁（未启用不建 DOM，show() 内部懒构建；check.js stub 环境零 DOM 操作） */
  if (S.enabled) { show("locked"); }

  window.APPLOCK = {
    get enabled() { return S.enabled; },
    setEnabled: function (on) {
      if (on) { show("setup"); }
      else {
        S.enabled = false; save(); hide(); buf = ""; mode = "locked";
        syncCheckbox();
        if (window.UIKIT && window.UIKIT.toast) window.UIKIT.toast("应用锁已关闭");
      }
    },
    changePin: function () { if (S.enabled) show("change-old"); }
  };

  /* 设置弹层控件自绑定（模块自包含；script 置于 body 底部，元素已就绪） */
  var cb = document.getElementById("applock-enable");
  if (cb) cb.addEventListener("change", function () { window.APPLOCK.setEnabled(cb.checked); });
  var chgBtn = document.getElementById("applock-change");
  if (chgBtn) chgBtn.addEventListener("click", function () { window.APPLOCK.changePin(); });
  syncCheckbox(); /* 启动即同步（reload 后修改 PIN 按钮显隐/勾选态归位） */
})();
