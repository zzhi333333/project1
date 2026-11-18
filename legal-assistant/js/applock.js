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
        if (k === "") { buf = buf.slice(0, -1); }
        else if (buf.length < 6) { buf += k; }
        draw();
        if (mode !== "setup-confirm" && buf.length >= S.len && buf.length <= 6 && k !== "") tryPin();
      });
      padEl.appendChild(b);
    });
    var cancelBtn2 = layer.querySelector("#al-cancel");
    if (cancelBtn2) cancelBtn2.addEventListener("click", function () {
      buf = ""; firstPin = "";
      mode = S.enabled ? "locked" : "locked";
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
        sha(S.salt + firstPin).then(function (h) {
          S.hash = h; save();
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

  /* 启动即锁 */
  if (S.enabled) { show("locked"); } else { build(); }

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
})();
