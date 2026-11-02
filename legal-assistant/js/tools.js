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

  /* ---------- 7. 民间借贷利息 ---------- */
  function calcLoan() {
    var principal = parseFloat($("ln-principal").value);
    var rate = parseFloat($("ln-rate").value);
    var months = parseFloat($("ln-months").value);
    var lpr = parseFloat($("ln-lpr").value);
    var paid = parseFloat($("ln-paid").value);
    var out = $("ln-result");
    if (!(principal > 0) || !(rate >= 0) || !(months > 0) || !(lpr > 0)) {
      out.innerHTML = '<div class="tool-warn">请填写本金、约定年利率、期限与 LPR（已付利息选填）。</div>';
      return;
    }
    var cap = lpr * 4;
    var over = rate > cap;
    var legalRate = Math.min(rate, cap);
    var interestAgreed = principal * rate / 100 * months / 12;
    var interestCapped = principal * legalRate / 100 * months / 12;
    var fmtN = function (v) { return "¥ " + v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }); };
    var html = '<div class="calc-head">司法保护利率上限 = ' + lpr + '%(LPR) × 4 = <b>' + cap.toFixed(2) + '%</b></div><div class="calc-detail">' +
      '期限内利息（按约定 ' + rate + '%）：' + fmtN(interestAgreed) + '<br>' +
      (over
        ? '⚠️ 约定利率超过司法保护上限：法院仅支持按 <b>' + cap.toFixed(2) + '%</b> 计算 → 受保护利息 ' + fmtN(interestCapped) + '，超限部分 ' + fmtN(Math.max(0, interestAgreed - interestCapped)) + ' 不受支持<br>' +
          (paid > 0 ? '已付利息中超出上限的部分（约 ' + fmtN(Math.max(0, paid - interestCapped)) + '）可主张<b>抵扣本金</b>或返还。' : '')
        : '✅ 约定利率在司法保护上限之内：期限内利息 ' + fmtN(interestAgreed));
    html += '</div><div class="calc-note">说明：①利率上限=合同成立时一年期 LPR 的四倍（以全国银行间同业拆借中心公布为准）；②「砍头息」按实际到手金额算本金；③已付超限利息可主张抵扣本金（不得要求返还已自愿支付的合法利息）。仅供参考。</div>';
    out.innerHTML = html;
  }

  /* ---------- 8. 诉讼费用 ---------- */
  function courtFee(amount) {
    if (amount <= 10000) return 50;
    var fee = 50;
    var brackets = [
      [100000, 0.025], [200000, 0.02], [500000, 0.015], [1000000, 0.01],
      [2000000, 0.009], [5000000, 0.008], [10000000, 0.007], [Infinity, 0.006]
    ];
    var prev = 10000;
    for (var i = 0; i < brackets.length; i++) {
      var upper = brackets[i][0], rate = brackets[i][1];
      if (amount > prev) {
        var portion = Math.min(amount, upper) - prev;
        fee += portion * rate;
        prev = upper;
        if (amount <= upper) break;
      }
    }
    return Math.round(fee);
  }
  function baoquanFee(amount) {
    if (!(amount > 0)) return 0;
    var fee = amount <= 1000 ? 30 : (amount <= 100000 ? amount * 0.01 : 1000 + (amount - 100000) * 0.005);
    return Math.min(5000, Math.round(fee));
  }
  function calcCourtFee() {
    var amount = parseFloat($("cf-amount").value);
    var proc = $("cf-proc").value;
    var bq = parseFloat($("cf-baoquan").value);
    var out = $("cf-result");
    if (!(amount > 0)) {
      out.innerHTML = '<div class="tool-warn">请填写诉讼标的额。</div>';
      return;
    }
    var full = courtFee(amount);
    var fee = proc === "simple" ? Math.round(full / 2) : full;
    var fmtN = function (v) { return "¥ " + v.toLocaleString("zh-CN"); };
    var html = '<div class="calc-head">案件受理费 ≈ <b>' + fmtN(fee) + '</b>' +
      (proc === "simple" ? '（简易/小额程序减半）' : '') + '</div><div class="calc-detail">' +
      '全额受理费：' + fmtN(full) + '　|　预交方：原告（判决后由败诉方负担，部分胜诉按比例）<br>';
    if (bq > 0) {
      var bf = baoquanFee(bq);
      html += '财产保全费：' + fmtN(bf) + '（保全金额 ' + fmtN(bq) + '，上限 5000 元）<br>';
    }
    html += '</div><div class="calc-note">说明：①劳动争议案件每件 10 元；②调解结案/撤诉的减半；③小额诉讼程序减半交纳；④不含律师费、鉴定费、公告费等。以《诉讼费用交纳办法》与受诉法院核定为准。</div>';
    out.innerHTML = html;
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

  /* ---------- 9. 抚养费计算器 ---------- */
  function calcFuyangfei() {
    var income = parseFloat($("fy-income").value);
    var kids = parseInt($("fy-kids").value, 10);
    var fixed = $("fy-fixed").value;
    var out = $("fy-result");
    if (!(income > 0)) {
      out.innerHTML = '<div class="tool-warn">请填写不直接抚养方的月总收入。</div>';
      return;
    }
    var lo, hi;
    if (kids >= 3) {
      lo = income * 0.3; hi = income * 0.5;
    } else if (kids === 2) {
      lo = income * 0.25; hi = income * 0.5;
    } else {
      lo = income * 0.2; hi = income * 0.3;
    }
    var fmtN = function (v) { return "¥ " + v.toLocaleString("zh-CN", { maximumFractionDigits: 0 }); };
    var html = '<div class="calc-head">月抚养费参考区间：<b>' + fmtN(lo) + ' – ' + fmtN(hi) + '</b></div><div class="calc-detail">' +
      '计算口径：月总收入 ' + fmtN(income) + ' × ' + (kids === 1 ? '20%–30%' : kids === 2 ? '25%–50%（两子女一般不超 50%）' : '30%–50%（三子女以上一般不超 50%）') + '<br>' +
      (fixed === "no" ? '无固定收入：参照当年总收入或同行业平均收入按同比例确定。<br>' : '') +
      '教育费、医疗费大额开支可凭票据另行主张分担；给付至子女 18 周岁。</div>' +
      '<div class="calc-note">说明：具体数额由法院综合子女实际需要、父母负担能力与当地生活水平确定——收入特别高或特别低的会酌情突破比例。协议约定高于法定比例的从约定。仅供参考。</div>';
    out.innerHTML = html;
  }

  /* ---------- 装配 ---------- */
  window.TOOLS = {
    init: function () {
      $("sv-calc").addEventListener("click", calcSeverance);
      $("ot-calc").addEventListener("click", calcOvertime);
      $("al-calc").addEventListener("click", calcLeave);
      $("pt-calc").addEventListener("click", calcPatent);
      $("dl-calc").addEventListener("click", calcDeadline);
      $("ln-calc").addEventListener("click", calcLoan);
      $("cf-calc").addEventListener("click", calcCourtFee);
      $("fy-calc").addEventListener("click", calcFuyangfei);
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
