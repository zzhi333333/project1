/* =========================================================
 * 实用工具 tools.js —— 经济补偿 / 加班费 / 年休假 / 专利期限
 * ========================================================= */
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmt(n) {
    if (!isFinite(n)) return "—";
    return "¥ " + n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  function monthsBetween(from, to) {
    var d1 = new Date(from), d2 = new Date(to);
    if (isNaN(d1) || isNaN(d2) || d2 < d1) return null;
    var m = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    if (d2.getDate() < d1.getDate()) m -= 1;
    return m; // 总月数
  }

  /* ---------- 1. 经济补偿金 ---------- */
  function calcSeverance() {
    var from = $("sv-from").value, to = $("sv-to").value;
    var salary = parseFloat($("sv-salary").value);
    var avgRaw = parseFloat($("sv-avg").value); // 当地上年度职工月平均工资（选填）
    var type = $("sv-type").value;
    var out = $("sv-result");
    if (!from || !to || isNaN(salary) || salary <= 0) {
      out.innerHTML = '<div class="tool-warn">请填写入职日期、离职日期和离职前12个月平均月工资。</div>';
      return;
    }
    var months = monthsBetween(from, to);
    if (months === null) {
      out.innerHTML = '<div class="tool-warn">离职日期需晚于入职日期。</div>';
      return;
    }
    var years = Math.floor(months / 12);
    var rem = months % 12;
    var n = years + (rem >= 6 ? 1 : rem > 0 ? 0.5 : 0);
    var base = salary, capped = false, capYears = n;
    if (!isNaN(avgRaw) && avgRaw > 0 && salary > avgRaw * 3) {
      base = avgRaw * 3; capped = true; capYears = Math.min(n, 12);
    }
    var nAmount = base * capYears;
    var total = type === "2N" ? nAmount * 2 : type === "N+1" ? nAmount + salary : nAmount;
    var typeName = { "N": "经济补偿 N", "N+1": "N + 代通知金", "2N": "违法解除赔偿金 2N" }[type];
    var html = '<div class="calc-head">' + typeName + ' ≈ <b>' + fmt(total) + '</b></div><div class="calc-detail">';
    html += '工作年限：' + months + ' 个月 → 折算 <b>' + n + '</b> 个月（' + years + '年' + (rem > 0 ? ' + 余' + rem + '个月' + (rem >= 6 ? '（≥6个月按1年计）' : '（<6个月按半个月计）') : '') + '）<br>';
    html += '计算基数：' + fmt(base) + (capped
      ? '（您的月工资高于当地社平工资3倍，已按3倍封顶，且年限按 ' + capYears + ' 个月计）'
      : '（离职前12个月平均工资）') + '<br>';
    html += '公式：' + fmt(base) + ' × ' + capYears + (type === "2N" ? " × 2" : type === "N+1" ? " ＋ " + fmt(salary) + "（代通知金）" : "") + ' = <b>' + fmt(total) + '</b>';
    html += '</div><div class="calc-note">说明：代通知金按上月工资计，此处以平均工资近似；「月工资」含奖金、津贴等货币性收入。结果仅供参考。</div>';
    out.innerHTML = html;
  }

  /* ---------- 2. 加班费 ---------- */
  function calcOvertime() {
    var salary = parseFloat($("ot-salary").value);
    var wd = parseFloat($("ot-weekday").value) || 0;
    var we = parseFloat($("ot-weekend").value) || 0;
    var weComp = $("ot-weekend-comp").checked;
    var hd = parseFloat($("ot-holiday").value) || 0;
    var out = $("ot-result");
    if (isNaN(salary) || salary <= 0) {
      out.innerHTML = '<div class="tool-warn">请填写月工资。</div>';
      return;
    }
    var hour = salary / 21.75 / 8;
    var wdPay = hour * wd * 1.5;
    var wePay = weComp ? 0 : hour * we * 2;
    var hdPay = hour * hd * 3;
    var total = wdPay + wePay + hdPay;
    if (wd + we + hd === 0) {
      out.innerHTML = '<div class="tool-warn">请填写各类加班的小时数。</div>';
      return;
    }
    var html = '<div class="calc-head">应得加班费 ≈ <b>' + fmt(total) + '</b></div><div class="calc-detail">';
    html += '时薪 = ' + fmt(salary) + ' ÷ 21.75 ÷ 8 = ' + fmt(hour) + '<br>';
    if (wd > 0) html += '工作日延时 ' + wd + ' 小时 × 150% = ' + fmt(wdPay) + '<br>';
    if (we > 0) html += '休息日 ' + we + ' 小时 × 200%' + (weComp ? '（已勾选补休，本项计 0）' : '') + ' = ' + fmt(wePay) + '<br>';
    if (hd > 0) html += '法定节假日 ' + hd + ' 小时 × 300%（不可用补休替代）= ' + fmt(hdPay) + '<br>';
    html += '</div><div class="calc-note">说明：法定节假日加班当天工资照发，300%为额外支付部分（部分地区口径为当天100%＋300%合计，以当地裁审口径为准）。</div>';
    out.innerHTML = html;
  }

  /* ---------- 3. 年休假 ---------- */
  function calcLeave() {
    var years = parseFloat($("al-years").value);
    var joinDate = $("al-join").value;
    var out = $("al-result");
    if (isNaN(years) || years < 0) {
      out.innerHTML = '<div class="tool-warn">请填写累计工作年限。</div>';
      return;
    }
    var days = years >= 20 ? 15 : years >= 10 ? 10 : years >= 1 ? 5 : 0;
    var html = '<div class="calc-head">每年应休年假：<b>' + days + ' 天</b></div><div class="calc-detail">';
    if (days === 0) {
      html += '累计工龄不满1年暂不享受法定带薪年休假（用人单位福利年假除外）。</div>';
    } else {
      html += '依据《职工带薪年休假条例》第3条：累计满1年不满10年→5天；满10年不满20年→10天；满20年→15天。<br>';
      if (joinDate) {
        var d = new Date(joinDate);
        if (!isNaN(d)) {
          var year = new Date().getFullYear();
          var start = d.getFullYear() === year ? d : new Date(year, 0, 1);
          var end = new Date(year, 11, 31);
          var passed = Math.floor((end - start) / 86400000) + 1;
          var prorated = Math.floor(passed / 365 * days);
          html += '入职当年（' + year + '年）折算：当年度在本单位已过/将过 ' + passed + ' 天 ÷ 365 × ' + days + ' 天 → <b>' + prorated + ' 天</b>（不足1整天舍去）。<br>';
          html += '未休部分单位应按日工资 300% 支付（含正常工资，额外 200%）。</div>';
          html += '<div class="calc-note">说明：累计工龄=全部单位工作年限合并；跨年度安排以单位统筹并履行程序为前提。</div>';
          out.innerHTML = html;
          return;
        }
      }
      html += '未休的按日工资 300% 支付报酬（含正常工作期间工资，即额外 200%）。</div>';
      html += '<div class="calc-note">说明：累计工龄=全部单位工作年限合并计算，社保缴费记录可作为证明。</div>';
    }
    out.innerHTML = html;
  }

  /* ---------- 4. 专利期限 ---------- */
  function calcPatent() {
    var type = $("pt-type").value;
    var date = $("pt-date").value;
    var out = $("pt-result");
    if (!date) {
      out.innerHTML = '<div class="tool-warn">请填写专利申请日。</div>';
      return;
    }
    var d = new Date(date);
    if (isNaN(d)) {
      out.innerHTML = '<div class="tool-warn">日期格式有误。</div>';
      return;
    }
    function addYears(base, y) { var r = new Date(base); r.setFullYear(r.getFullYear() + y); return r; }
    function addMonths(base, m) { var r = new Date(base); r.setMonth(r.getMonth() + m); return r; }
    function fmtDate(x) { return x.getFullYear() + "年" + (x.getMonth() + 1) + "月" + x.getDate() + "日"; }
    var years = { invention: 20, utility: 10, design: 15 }[type];
    var typeName = { invention: "发明专利", utility: "实用新型", design: "外观设计" }[type];
    var html = '<div class="calc-head">' + typeName + '保护期至：<b>' + fmtDate(addYears(d, years)) + '</b>（自申请日起' + years + '年）</div><div class="calc-detail">';
    if (type === "invention") {
      html += '申请日：' + fmtDate(d) + '<br>公布日：申请日起满18个月 → 约 <b>' + fmtDate(addMonths(d, 18)) + '</b>（可请求提前公布）<br>';
      html += '实质审查请求截止：申请日起3年内 → <b>' + fmtDate(addYears(d, 3)) + '</b>（逾期视为撤回）<br>';
      html += '全程通常2–4年授权，须缴年费维持。';
    } else {
      html += '申请日：' + fmtDate(d) + '<br>初审制（无实质审查），通常6个月–1年授权，须缴年费维持。';
    }
    if (type === "invention" || type === "utility") {
      html += '<br>优先权期限：首次申请日起12个月内 → <b>' + fmtDate(addYears(d, 1)) + '</b>前可主张。';
    } else {
      html += '<br>优先权期限：首次申请日起6个月内 → <b>' + fmtDate(addMonths(d, 6)) + '</b>前可主张。';
    }
    html += '</div><div class="calc-note">说明：保护期自实际申请日起算；未按期缴费或放弃会导致权利提前终止。</div>';
    out.innerHTML = html;
  }

  /* ---------- 5. 时效倒计时 ---------- */
  function calcDeadline() {
    var date = $("dl-date").value;
    var type = $("dl-type").value;
    var days = type === "custom" ? parseFloat($("dl-days").value) : parseFloat(type);
    var out = $("dl-result");
    if (!date || !days || days <= 0) {
      out.innerHTML = '<div class="tool-warn">请填写事件日期并选择时效类型（自定义需填写天数）。</div>';
      return;
    }
    var start = new Date(date + "T00:00:00");
    if (isNaN(start)) { out.innerHTML = '<div class="tool-warn">日期格式有误。</div>'; return; }
    var deadline = new Date(start.getTime() + days * 86400000);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var left = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);
    var status, cls;
    if (left < 0) { status = "已过期 " + (-left) + " 天"; cls = "tool-warn"; }
    else if (left <= 30) { status = "⚠️ 紧急：仅剩 " + left + " 天"; cls = "tool-warn"; }
    else { status = "剩余 " + left + " 天"; cls = "calc-head"; }
    function fmt(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
    out.innerHTML = '<div class="' + cls + '" style="border-radius:8px;padding:10px 13px;font-size:14.5px">⏳ ' + status + '</div>' +
      '<div class="calc-detail">起算日：' + fmt(start) + '　→　时效届满：' + fmt(deadline) + '（' + days + ' 天）<br>' +
      '临近届满（30 天内）务必启动相应程序，或留存时效中断证据（书面催告、对方付款或承认等）。</div>' +
      '<div class="calc-note">说明：时效可因主张权利、对方同意履行、起诉等而中断重新起算；部分情形有特殊规则（如劳动报酬在职期间不受 1 年限制）。本工具按通用规则估算，仅供参考。</div>' +
      '<button id="dl-to-cal" class="ghost-btn" style="margin-top:10px">📅 加入合规日历</button>';
    var toCal = $("dl-to-cal");
    if (toCal) toCal.addEventListener("click", function () {
      var opt = $("dl-type").selectedOptions[0];
      $("cal-name").value = "时效届满：" + (opt ? opt.textContent.split("——")[0].trim() : "关键日期");
      $("cal-date").value = fmt(deadline);
      $("cal-name").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  /* ---------- 6. 合规日历 ---------- */
  var CAL_KEY = "legal-deadlines";
  function calLoad() {
    try { return JSON.parse(localStorage.getItem(CAL_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function calSave(list) {
    try { localStorage.setItem(CAL_KEY, JSON.stringify(list.slice(0, 100))); } catch (e) {}
  }
  function calRender() {
    var box = $("cal-list");
    if (!box) return;
    var list = calLoad().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (!list.length) {
      box.innerHTML = '<div class="dim" style="font-size:12.5px;padding:6px 2px">暂无事项——从时效倒计时结果一键加入，或手动添加关键日期。</div>';
      return;
    }
    box.innerHTML = list.map(function (it, i) {
      var left = Math.ceil((new Date(it.date + "T00:00:00").getTime() - today.getTime()) / 86400000);
      var status = left < 0 ? '<span style="color:var(--danger)">已过期 ' + (-left) + ' 天</span>'
        : left <= 7 ? '<span style="color:var(--danger)">仅剩 ' + left + ' 天</span>'
        : left <= 30 ? '<span style="color:#b45309">' + left + ' 天</span>'
        : '<span>' + left + ' 天</span>';
      return '<div class="cal-item"><div class="cal-name">' + esc(it.name) + '</div>' +
        '<div class="cal-meta">' + it.date + ' · ' + status + '</div>' +
        '<button class="cal-del" data-i="' + i + '" title="删除">✕</button></div>';
    }).join("");
    box.querySelectorAll(".cal-del").forEach(function (b) {
      b.addEventListener("click", function () {
        var list2 = calLoad();
        list2.splice(parseInt(b.getAttribute("data-i"), 10), 1);
        calSave(list2);
        calRender();
      });
    });
  }
  function calNotifyCheck() {
    var list = calLoad();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    list.forEach(function (it) {
      var left = Math.ceil((new Date(it.date + "T00:00:00").getTime() - today.getTime()) / 86400000);
      if (left >= 0 && left <= 7 && window.Notification && Notification.permission === "granted") {
        try {
          if (!window.__calNotified) window.__calNotified = {};
          if (window.__calNotified[it.name + it.date]) return;
          window.__calNotified[it.name + it.date] = 1;
          new Notification("合规日历提醒", { body: "「" + it.name + "」仅剩 " + left + " 天（" + it.date + "）" });
        } catch (e) { /* 通知失败静默 */ }
      }
    });
  }

  /* ---------- 装配 ---------- */
  window.TOOLS = {
    init: function () {
      $("sv-calc").addEventListener("click", calcSeverance);
      $("ot-calc").addEventListener("click", calcOvertime);
      $("al-calc").addEventListener("click", calcLeave);
      $("pt-calc").addEventListener("click", calcPatent);
      $("dl-calc").addEventListener("click", calcDeadline);
      var sel = $("dl-type");
      if (sel) sel.addEventListener("change", function () {
        $("dl-custom-wrap").classList.toggle("hidden", sel.value !== "custom");
      });

      /* 合规日历 */
      var calAdd = $("cal-add");
      if (calAdd) {
        calAdd.addEventListener("click", function () {
          var name = $("cal-name").value.trim();
          var date = $("cal-date").value;
          if (!name || !date) {
            $("cal-list").innerHTML = '<div class="tool-warn">请填写事项名称与日期。</div>';
            return;
          }
          var list = calLoad();
          list.push({ name: name, date: date });
          calSave(list);
          $("cal-name").value = "";
          calRender();
          calNotifyCheck();
        });
      }
      var calNotifyBtn = $("cal-notify");
      if (calNotifyBtn) {
        var stateEl = $("cal-notify-state");
        if (window.Notification && Notification.permission === "granted") {
          stateEl.textContent = "已开启";
        }
        calNotifyBtn.addEventListener("click", function () {
          if (!window.Notification) { stateEl.textContent = "当前浏览器不支持通知"; return; }
          if (Notification.permission === "granted") { stateEl.textContent = "已开启（浏览器授权）"; return; }
          Notification.requestPermission().then(function (p) {
            stateEl.textContent = p === "granted" ? "已开启：7 天内到期事项将提醒" : "未授权，可稍后再试";
            if (p === "granted") calNotifyCheck();
          });
        });
      }
      calRender();
      calNotifyCheck();
      setTimeout(calNotifyCheck, 3000);   /* 页面加载稳定后再查一次 */
    }
  };
})();
