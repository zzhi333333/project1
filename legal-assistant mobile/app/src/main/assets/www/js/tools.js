/* =========================================================
 * 实用工具 tools.js —— 经济补偿 / 加班费 / 年休假 / 专利期限
 * ========================================================= */
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  /* 规则版本：内置计算规则的最后复核标记（资料复核机制的一部分，改动规则时同步更新） */
  var RULE_VER = "R2026-11";
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
    /* 节假日顺延（民诉法 85 条：届满日是节假日的顺延至其后第一日；limitation.js 提供官方放假表） */
    var postponedNote = "";
    if (window.LIMITATION && window.LIMITATION.postponeIfRest) {
      var pp = window.LIMITATION.postponeIfRest(deadline);
      if (pp.postponed) {
        deadline = pp.date;
        postponedNote = '<br><span style="color:var(--primary)">⏱ 届满日为法定节假日/休息日，已按《民事诉讼法》第85条顺延至 ' + window.LIMITATION.ymd(deadline) + '（以最新国务院放假通知为准）</span>';
      }
    }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var left = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);
    var status, cls;
    if (left < 0) { status = "已过期 " + (-left) + " 天"; cls = "tool-warn"; }
    else if (left <= 30) { status = "<svg class=ico><use href=#i-warn></use></svg> 紧急：仅剩 " + left + " 天"; cls = "tool-warn"; }
    else { status = "剩余 " + left + " 天"; cls = "calc-head"; }
    /* V8：时效倒计时环——剩余比例着色（>50% 绿 / 20-50% 橙 / ≤20% 红）；
       过期态：满圈灰红（#b06868，与紧急亮红区分）+ 环心「已过期/N天」双行 */
    var ringPct = left < 0 ? 1 : Math.min(1, left / days);
    var ringSvg = window.SVGCHART ? window.SVGCHART.ring(ringPct, left < 0
      ? { size: 56, color: "var(--c-danger-muted)", label: "已过期", sub: (-left) + "天" }
      : { size: 56, label: left + "天" }) : "";
    function fmt(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
    out.innerHTML = '<div class="' + cls + '" style="display:flex;align-items:center;gap:12px;border-radius:8px;padding:10px 13px;font-size:14.5px">' + ringSvg + '<div>⏳ ' + status + '</div></div>' +
      '<div class="calc-detail">起算日：' + fmt(start) + '　→　时效届满：' + fmt(deadline) + '（' + days + ' 天）' + postponedNote + '<br>' +
      '临近届满（30 天内）务必启动相应程序，或留存时效中断证据（书面催告、对方付款或承认等）。</div>' +
      '<div class="calc-note">说明：时效可因主张权利、对方同意履行、起诉等而中断重新起算；部分情形有特殊规则（如劳动报酬在职期间不受 1 年限制）。本工具按通用规则估算，仅供参考。</div>' +
      '<button id="dl-to-cal" class="ghost-btn" style="margin-top:10px"><svg class=ico><use href=#i-calendar></use></svg> 加入合规日历</button>';
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
    /* V3：LPR 四倍利率标尺——绿=受保护区间，红=超限不受保护，游标=约定利率（法定规则可视化，非结果预测） */
    var scaleHtml = window.SVGCHART ? window.SVGCHART.scale(rate, cap, { capLabel: cap.toFixed(2) + "%", rateLabel: rate + "%" }) : "";
    var html = '<div class="calc-head">司法保护利率上限 = ' + lpr + '%(LPR) × 4 = <b>' + cap.toFixed(2) + '%</b></div>' + scaleHtml + '<div class="calc-detail">' +
      '期限内利息（按约定 ' + rate + '%）：' + fmtN(interestAgreed) + '<br>' +
      (over
        ? '<svg class=ico><use href=#i-warn></use></svg> 约定利率超过司法保护上限：法院仅支持按 <b>' + cap.toFixed(2) + '%</b> 计算 → 受保护利息 ' + fmtN(interestCapped) + '，超限部分 ' + fmtN(Math.max(0, interestAgreed - interestCapped)) + ' 不受支持<br>' +
          (paid > 0 ? '已付利息中超出上限的部分（约 ' + fmtN(Math.max(0, paid - interestCapped)) + '）可主张<b>抵扣本金</b>或返还。' : '')
        : '<svg class=ico><use href=#i-checkc></use></svg> 约定利率在司法保护上限之内：期限内利息 ' + fmtN(interestAgreed));
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
    /* V3：诉讼费累进阶梯——等宽段+已跨过段高亮，标法定费率（以《诉讼费用交纳办法》为准） */
    var ladderHtml = window.SVGCHART ? window.SVGCHART.ladder(amount, [
      { up: 10000, rate: "50元", label: "≤1万" },
      { up: 100000, rate: "2.5%", label: "1–10万" },
      { up: 200000, rate: "2%", label: "10–20万" },
      { up: 500000, rate: "1.5%", label: "20–50万" },
      { up: 1000000, rate: "1%", label: "50–100万" },
      { up: 2000000, rate: "0.9%", label: "100–200万" },
      { up: 5000000, rate: "0.8%", label: "200–500万" },
      { up: 10000000, rate: "0.7%", label: "500–1000万" },
      { up: Infinity, rate: "0.6%", label: "1000万+" }
    ]) : "";
    var html = '<div class="calc-head">案件受理费 ≈ <b>' + fmtN(fee) + '</b>' +
      (proc === "simple" ? '（简易/小额程序减半）' : '') + '</div>' + ladderHtml + '<div class="calc-detail">' +
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

  /* ---------- 10. 违约金与定金 ---------- */
  function calcDeposit() {
    var amount = parseFloat($("dj-amount").value);
    var depRaw = parseFloat($("dj-deposit").value);
    var penRaw = parseFloat($("dj-penalty").value);
    var loss = parseFloat($("dj-loss").value);
    var side = $("dj-side").value;
    var out = $("dj-result");
    if (!(amount > 0)) {
      out.innerHTML = '<div class="tool-warn">请填写主合同金额。</div>';
      return;
    }
    var cap = amount * 0.2;
    var html = '<div class="calc-detail">';
    /* 定金上限判定（民法典第 586 条） */
    if (depRaw > 0) {
      var valid = Math.min(depRaw, cap);
      var over = depRaw - valid;
      html += '<b>① 定金上限判定（民法典第 586 条）</b><br>';
      html += '约定定金 ' + fmt(depRaw) + '，法定上限 = 合同金额 × 20% = <b>' + fmt(cap) + '</b><br>';
      html += over > 0
        ? '约定数额<b>超过上限</b>：超出部分 ' + fmt(over) + ' <b>不产生定金效力</b>（不适用定金罚则，可主张返还）；有效定金为 ' + fmt(valid) + '<br>'
        : '约定数额<b>未超上限</b>，全部 ' + fmt(valid) + ' 产生定金效力<br>';
      /* 定金罚则（民法典第 587 条） */
      html += '<b>② 定金罚则（民法典第 587 条）—— 违约方为' + (side === "payer" ? "我方（给付方）" : "对方（收受方）") + '</b><br>';
      html += side === "payer"
        ? '给付方违约：<b>无权请求返还定金</b>，损失 ' + fmt(valid) + '<br>'
        : '收受方违约：<b>双倍返还定金</b> = ' + fmt(valid) + ' × 2 = <b>' + fmt(valid * 2) + '</b>（其中 ' + fmt(valid) + ' 为返还本金 + ' + fmt(valid) + ' 为罚则部分）<br>';
    }
    /* 违约金调整（民法典第 585 条） */
    if (penRaw > 0) {
      html += '<b>③ 违约金调整参考（民法典第 585 条）</b><br>';
      html += '约定违约金 ' + fmt(penRaw);
      if (loss > 0) {
        var upper = loss * 1.3;
        if (penRaw > upper) {
          html += '，实际损失 ' + fmt(loss) + ' → 违约金<b>过分高于损失</b>（超过损失的 30%，即 ' + fmt(upper) + '），违约方可请求法院或仲裁机构<b>适当减少</b><br>';
        } else if (penRaw < loss) {
          html += '，低于实际损失 ' + fmt(loss) + '，守约方可请求<b>予以增加</b><br>';
        } else {
          html += '，处于实际损失 ' + fmt(loss) + ' 至其 130%（' + fmt(upper) + '）区间内，一般<b>不予以调整</b><br>';
        }
      } else {
        html += '（未填实际损失：约定违约金过分高于造成的损失的，可请求适当减少，司法实践一般以「超过损失 30%」为参考基准）<br>';
      }
      if (depRaw > 0) {
        html += '<b>④ 定金与违约金择一（民法典第 588 条）</b><br>既约定定金又约定违约金的，守约方只能<b>择一适用</b>；定金不足以弥补损失的，可以请求赔偿超过定金数额的损失。<br>';
      }
    }
    if (!(depRaw > 0) && !(penRaw > 0)) {
      html += '未填写定金与违约金数额：可对照上方依据自行核算——定金上限为合同金额的 20%；定金与违约金不可并用，择一主张。';
    }
    html += '</div><div class="calc-note">说明：依据《民法典》第 585–588 条及合同编通则司法解释（法释〔2023〕13 号）。违约金是否酌减由法院/仲裁机构综合合同履行情况、当事人过错等因素裁量，30% 为重要参考而非硬性标准。结果仅供参考。</div>';
    out.innerHTML = html;
  }

  /* ---------- 11. 知产侵权赔偿（商标 / 著作权） ---------- */
  function calcIpDamage() {
    var type = $("ip-type").value;
    var basis = $("ip-basis").value;
    var amount = parseFloat($("ip-amount").value);
    var willful = $("ip-willful").checked;
    var times = parseFloat($("ip-times").value);
    var cost = parseFloat($("ip-cost").value);
    var out = $("ip-result");
    var lawName = type === "tm" ? "《商标法》第 63 条" : "《著作权法》第 54 条";
    if (basis !== "statutory" && !(amount > 0)) {
      out.innerHTML = '<div class="tool-warn">请填写对应金额或倍数（法定赔偿模式可不填）。</div>';
      return;
    }
    var basisName = { loss: "权利人实际损失", profit: "侵权人违法所得", license: "许可使用费的合理倍数", statutory: "法定赔偿" }[basis];
    var baseAmount;
    var html = '<div class="calc-detail">';
    html += '计算依据：<b>' + basisName + '</b>（' + lawName + '）<br>';
    if (basis === "statutory") {
      baseAmount = null;
      html += '难以计算实际损失/违法所得/许可费的，适用<b>法定赔偿</b>：区间 <b>¥ 500 – ¥ 5,000,000</b>，由法院根据侵权行为情节判决（法定赔偿数额已包含制止侵权行为的合理开支）。<br>';
    } else if (basis === "license") {
      baseAmount = amount;
      html += '赔偿金额参照该权利的许可使用费的<b>合理倍数</b>确定：填入 ' + fmt(amount) + ' 倍 × 实际许可使用费金额（请结合实际许可合同金额核算）。<br>';
    } else {
      baseAmount = amount;
      html += '按' + basisName + '计算：' + fmt(amount) + '<br>';
    }
    if (willful) {
      if (!(times >= 1 && times <= 5)) {
        out.innerHTML = '<div class="tool-warn">已勾选惩罚性赔偿，请填写 1–5 之间的倍数。</div>';
        return;
      }
      if (basis === "statutory") {
        html += '<b><svg class=ico><use href=#i-warn></use></svg> 惩罚性赔偿提示：</b>惩罚性赔偿的基数是<b>实际损失/违法所得/许可费倍数</b>三者之一，<b>不能以法定赔偿数额为基数</b>。主张惩罚性赔偿需先举证确定基数，并证明「故意 + 情节严重」。<br>';
      } else {
        var multi = baseAmount * times;
        html += '<b>惩罚性赔偿（故意且情节严重）</b>：基数 ' + fmt(baseAmount) + ' × ' + times + ' 倍 = <b>' + fmt(multi) + '</b><br>';
      }
    }
    if (cost > 0) {
      html += '合理维权开支：' + fmt(cost) + '（为制止侵权行为所支付的合理开支，可一并主张）<br>';
    }
    html += '</div><div class="calc-note">说明：' + lawName + '。商标与著作权的法定赔偿上限均为 500 万元、下限 500 元；惩罚性赔偿倍数均为 1–5 倍。具体数额由法院综合权利类型、侵权行为性质与情节等裁量，结果仅供参考。</div>';
    out.innerHTML = html;
  }

  /* =========================================================
   * 工具卡通用能力：分类筛选 / 排序 / 收藏置顶 / 一键复制 / 法条跳转
   * ========================================================= */
  var TOOL_ORDER = ["sv", "ot", "al", "ln", "dj", "fy", "pt", "ip", "cf", "dl", "claims", "sx", "ws", "cal"];
  var FAV_KEY = "legal-fav-tools";

  function getToolFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch (e) { return []; }
  }
  function setToolFavs(a) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (e) { /* 存储不可用时静默 */ }
  }

  /* 排序：收藏的置顶（按收藏先后），其余按分类默认顺序 */
  function applyToolOrder() {
    var grid = document.querySelector("#view-tools .tools-grid");
    if (!grid) return;
    var favs = getToolFavs();
    var cards = {};
    grid.querySelectorAll(".tool-card").forEach(function (c) { cards[c.getAttribute("data-tool")] = c; });
    TOOL_ORDER.slice().sort(function (a, b) {
      var fa = favs.indexOf(a), fb = favs.indexOf(b);
      if (fa > -1 && fb > -1) return fa - fb;
      if (fa > -1) return -1;
      if (fb > -1) return 1;
      return TOOL_ORDER.indexOf(a) - TOOL_ORDER.indexOf(b);
    }).forEach(function (id) { if (cards[id]) grid.appendChild(cards[id]); });
  }

  /* 给每张卡标题注入收藏星标 */
  function setupToolCards() {
    var grid = document.querySelector("#view-tools .tools-grid");
    if (!grid) return;
    grid.querySelectorAll(".tool-card").forEach(function (card) {
      var id = card.getAttribute("data-tool");
      var title = card.querySelector(".tool-title");
      if (!id || !title || title.querySelector(".tool-fav")) return;
      var star = document.createElement("span");
      star.className = "tool-fav" + (getToolFavs().indexOf(id) > -1 ? " on" : "");
      star.setAttribute("data-tool", id);
      star.title = "收藏该工具（收藏后置顶显示）";
      star.textContent = getToolFavs().indexOf(id) > -1 ? "<svg class=ico><use href=#i-star></use></svg>" : "☆";
      title.appendChild(star);
    });
    grid.addEventListener("click", function (e) {
      var s = e.target.closest ? e.target.closest(".tool-fav") : null;
      if (!s) return;
      var id = s.getAttribute("data-tool");
      var favs = getToolFavs();
      var idx = favs.indexOf(id);
      if (idx > -1) { favs.splice(idx, 1); s.textContent = "☆"; s.classList.remove("on"); }
      else { favs.push(id); s.innerHTML = "<svg class=ico><use href=#i-star></use></svg>"; s.classList.add("on"); }
      setToolFavs(favs);
      applyToolOrder();
    });
    applyToolOrder();
  }

  /* 分类筛选 chips */
  function bindToolFilter() {
    var bar = $("tool-filter");
    if (!bar) return;
    bar.addEventListener("click", function (e) {
      var chip = e.target.closest ? e.target.closest(".filter-chip") : null;
      if (!chip) return;
      bar.querySelectorAll(".filter-chip").forEach(function (x) { x.classList.remove("active"); });
      chip.classList.add("active");
      var cat = chip.getAttribute("data-cat");
      document.querySelectorAll("#view-tools .tool-card").forEach(function (card) {
        card.classList.toggle("hidden", cat !== "all" && card.getAttribute("data-cat") !== cat);
      });
      if (cat === "all") applyToolOrder();
    });
  }

  /* 复制：优先 clipboard API，失败 execCommand 兜底（WebView 环境） */
  function copyText(text, btn) {
    function done(okFlag) {
      if (!btn) return;
      var t = btn.textContent;
      btn.textContent = okFlag ? "<svg class=ico><use href=#i-checkc></use></svg> 已复制" : "复制失败，请手动选择文本";
      setTimeout(function () { btn.textContent = t; }, 1500);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* 忽略 */ }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }

  /* =========================================================
   * 场景/领域 → 计算器映射 + 跳转定位（供结果卡 / AI 回答调用）
   * ========================================================= */
  var TOOL_META = {
    sv: { label: "补偿金试算", name: "经济补偿金计算器" },
    ot: { label: "加班费试算", name: "加班费计算器" },
    al: { label: "年休假折算", name: "年休假折算器" },
    dl: { label: "时效倒计时", name: "时效倒计时" },
    claims: { label: "请求试算", name: "一揽子请求与证据" },
    ln: { label: "利息试算", name: "民间借贷利息计算器" },
    dj: { label: "违约金/定金试算", name: "违约金与定金计算器" },
    fy: { label: "抚养费试算", name: "抚养费计算器" },
    ip: { label: "赔偿试算", name: "知产侵权赔偿计算器" },
    cf: { label: "诉讼费试算", name: "诉讼费用计算器" },
    pt: { label: "专利期限计算", name: "专利关键期限计算器" }
  };
  var TOOL_FOR_SCENARIO = {
    "labor-dismiss": "sv", "labor-wage": "sv", "labor-social": "sv",
    "labor-overtime": "ot", "labor-leave": "al", "labor-injury": "dl",
    "mf-loan": "ln", "mf-contract": "dj", "js-fuyangfei": "fy",
    "bq-shangbiao": "ip", "bq-weiquan": "ip",
    "mss-sue": "cf", "mss-baoquan": "cf", "patent-apply": "pt"
  };
  var TOOLS_FOR_DOMAIN = {
    labor: ["sv", "ot", "al", "dl"], minfa: ["ln", "dj"], minsusong: ["cf", "dl"],
    jiashi: ["fy"], biaozhu: ["ip"], patent: ["pt"], company: [], trade: []
  };
  /* 年休假场景：答案枚举值 → 折算器工作年限预填 */
  var TENURE_MAP = { lt1y: 0.5, y1to10: 5, y10to20: 12, gt20y: 21 };

  /* 跳转到指定计算器：切视图 → 全部分类 → 排序 → 滚动 + 高亮 → 可选预填 */
  function jumpTo(toolId, prefill) {
    var tab = document.querySelector('.nav-tab[data-view="tools"]');
    if (tab) tab.click();
    var allChip = document.querySelector('#tool-filter .filter-chip[data-cat="all"]');
    if (allChip && !allChip.classList.contains("active")) allChip.click();
    if (applyToolOrder) applyToolOrder();
    var card = document.querySelector('.tool-card[data-tool="' + toolId + '"]');
    if (!card) return;
    if (prefill) {
      for (var k in prefill) {
        var el = document.getElementById(k);
        if (el) el.value = prefill[k];
      }
    }
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.remove("tool-flash");
    void card.offsetWidth;
    card.classList.add("tool-flash");
    setTimeout(function () { card.classList.remove("tool-flash"); }, 2400);
  }
  /* 场景 → 结果卡按钮 HTML（无映射返回 ""） */
  function toolBtnForScenario(scenarioId, rid) {
    var t = TOOL_FOR_SCENARIO[scenarioId];
    if (!t || !TOOL_META[t]) return "";
    return '<button class="mini-btn tool-jump-btn" data-tool="' + t + '"' + (rid != null ? ' data-rid="' + rid + '"' : "") + '><svg class=ico><use href=#i-tools></use></svg> ' + TOOL_META[t].label + '</button>';
  }
  /* 领域 → AI 回答末尾的相关计算器 chips HTML（无工具领域返回 ""） */
  function toolChipsForDomain(domainId) {
    var ids = TOOLS_FOR_DOMAIN[domainId] || [];
    if (!ids.length) return "";
    return '<div class="chips" style="margin-top:6px">' + ids.map(function (t) {
      return '<button class="rel-link tool-jump-btn" data-tool="' + t + '">' +
        '<svg class=ico><use href=#i-tools></use></svg> ' + (TOOL_META[t] ? TOOL_META[t].label : t) + '</button>';
    }).join("") + '</div>';
  }

  /* =========================================================
   * 计算历史（每工具留 3 条，全局上限 60；本机 localStorage）
   * ========================================================= */
  var HIST_KEY = "legal-calc-history";
  function histLoad() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch (e) { return []; }
  }
  function histSave(list) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 60))); } catch (e) { /* 静默 */ }
  }
  function histRecord(toolId, name, inputs, outText) {
    if (!outText) return;
    var list = histLoad().filter(function (x) { return !(x.tool === toolId && x.inputsJson === JSON.stringify(inputs)); });
    list.unshift({ tool: toolId, name: name, inputs: inputs, inputsJson: JSON.stringify(inputs), out: String(outText).slice(0, 160), time: new Date().toISOString() });
    var perTool = {};
    list = list.filter(function (x) { perTool[x.tool] = (perTool[x.tool] || 0) + 1; return perTool[x.tool] <= 3; });
    histSave(list);
  }
  /* 历史弹窗 */
  function openHistory() {
    var old = document.getElementById("calc-history-modal");
    if (old) { old.remove(); return; }
    var list = histLoad();
    var modal = document.createElement("div");
    modal.id = "calc-history-modal";
    modal.className = "modal";
    var rows = list.length ? list.map(function (x, i) {
      var d = new Date(x.time);
      var ts = (d.getMonth() + 1) + "-" + d.getDate() + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      var inputsText = Object.keys(x.inputs || {}).filter(function (k) { return x.inputs[k] !== "" && x.inputs[k] != null; })
        .map(function (k) { return k + "=" + x.inputs[k]; }).join("  ");
      return '<div class="ci-card hist-row" data-i="' + i + '">' +
        '<div class="case-title">' + esc(x.name) + ' <span class="dim" style="font-size:11.5px;font-weight:400">' + ts + '</span></div>' +
        (inputsText ? '<div class="dim" style="font-size:12px">' + esc(inputsText) + '</div>' : "") +
        '<div class="dim" style="font-size:12px">' + esc(x.out.slice(0, 90)) + '</div>' +
        '<div class="ci-actions">' +
          '<button class="mini-btn primary hist-refill">重新填充</button>' +
          '<button class="mini-btn hist-del" style="color:var(--danger)">删除</button>' +
        '</div></div>';
    }).join("") : '<div class="empty dim">还没有计算记录——每次计算会自动保存最近输入，方便回看与重新填充。</div>';
    modal.innerHTML =
      '<div class="modal-mask"></div>' +
      '<div class="modal-card" style="max-width:620px;width:92%">' +
        '<div class="modal-title"><svg class=ico><use href=#i-calendar></use></svg> 计算历史</div>' +
        '<div class="modal-body" style="max-height:60vh;overflow-y:auto">' + rows + '</div>' +
        '<div class="modal-foot"><button class="mini-btn" id="hist-close">关闭</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.remove(); });
    modal.querySelector("#hist-close").addEventListener("click", function () { modal.remove(); });
    modal.querySelectorAll(".hist-row").forEach(function (row) {
      var item = list[parseInt(row.getAttribute("data-i"), 10)];
      row.querySelector(".hist-refill").addEventListener("click", function () {
        jumpTo(item.tool, item.inputs);
        modal.remove();
      });
      row.querySelector(".hist-del").addEventListener("click", function () {
        histSave(histLoad().filter(function (x) { return x !== item; }));
        modal.remove();
        openHistory();
      });
    });
  }

  /* 结果 HTML 里的法条引用 → 可点击跳转法条检索（如《商标法》第 63 条 / 民法典第 586 条） */
  var LAW_RE = /(《?[\u4e00-\u9fa5]{2,12}法》?|《?民法典》?)\s*(第\s*[0-9]+\s*条)/g;
  function lawLinks(html) {
    return html.replace(LAW_RE, function (m, law, art) {
      var q = law.replace(/[《》\s]/g, "") + " " + art.replace(/\s+/g, "");
      return '<a class="law-link" data-lawq="' + esc(q) + '" title="点击在法条库中检索原文">' + m + '</a>';
    });
  }
  /* 点击委托：跳到法条页并自动检索 */
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest(".law-link") : null;
    if (!a) return;
    var q = a.getAttribute("data-lawq");
    /* switchView 是 main.js 内部函数，走 nav-tab 点击切视图 */
    var tabBtn = document.querySelector('.nav-tab[data-view="laws"]');
    if (tabBtn) tabBtn.click();
    var input = document.getElementById("law-search-input");
    var btn = document.getElementById("law-search-btn");
    if (input && btn) { input.value = q; btn.click(); }
  });

  /* 包装计算按钮：计算 → 历史记录 → 法条链接化 → 注入「复制结果」按钮 */
  function bindCalc(btnId, outId, fn, name) {
    var btn = $(btnId), out = $(outId);
    if (!btn || !out) return;
    var toolId = btnId.replace("-calc", "");
    btn.addEventListener("click", function () {
      fn();
      /* 计算历史：抓该卡片的输入快照（排除空值），成功输出才记录 */
      var card = btn.closest(".tool-card");
      var inputs = {};
      if (card) {
        card.querySelectorAll("input, select").forEach(function (el) {
          if (el.type === "checkbox") return;
          if (el.value !== "" && el.value != null) inputs[el.id] = el.value;
        });
      }
      var oh = out.innerHTML;
      var hasResult = oh.indexOf("calc-head") > -1 || oh.indexOf("calc-detail") > -1;
      var isWarn = oh.indexOf("tool-warn") > -1;
      if (hasResult && !isWarn) {
        histRecord(toolId, name, inputs, out.textContent.replace(/\s+/g, " ").trim());
      }
      var old = out.querySelector(".calc-copy");
      if (old) old.remove();
      out.innerHTML = lawLinks(out.innerHTML);
      /* 可复核审计行：规则版本 + 输入回显 + 适用前提（置于 lawLinks 重写之后，避免被覆盖） */
      if (hasResult && !isWarn) {
        var echo = Object.keys(inputs).map(function (k) {
          return k.replace(/^[a-z]{2}-/, "") + "=" + inputs[k];
        }).join("；");
        out.innerHTML += '<div class="calc-audit dim" style="margin-top:8px;font-size:11.5px;line-height:1.7;border-top:1px dashed var(--line);padding-top:6px">🧾 可复核：规则版本 ' + RULE_VER +
          " ｜ 输入回显：" + (echo ? esc(echo) : "（空）") +
          " ｜ 规则以官方现行法律文本及司法解释为准，输入改变结果随之改变；结果不构成法律意见。</div>";
      }
      var copyBtn = document.createElement("button");
      copyBtn.className = "ghost-btn calc-copy";
      copyBtn.innerHTML = "<svg class=ico><use href=#i-copy></use></svg> 复制结果";
      copyBtn.addEventListener("click", function () {
        var clone = out.cloneNode(true);
        var cb = clone.querySelector(".calc-copy");
        if (cb) cb.remove();
        var text = (name ? name + "\n" : "") +
          clone.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|h\d)>/gi, "\n")
            .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/\n{3,}/g, "\n\n").trim();
        copyText(text, copyBtn);
      });
      out.appendChild(copyBtn);
    });
  }

  /* ---------- 工具分组：同域卡片相邻 + 组头（data-cat 已有，无需改 HTML） ---------- */
  function regroupToolCards() {
    var view = document.getElementById("view-tools");
    var cards = Array.prototype.slice.call((view || document).querySelectorAll(".tool-card[data-cat]"));
    if (!cards.length) return;
    var CAT_LABEL = { labor: "劳动维权", civil: "民事·赔偿", ip: "知产", proc: "程序·期限", util: "案件管理" };
    var order = ["labor", "civil", "ip", "proc", "util"];
    var groups = {};
    cards.forEach(function (c) {
      var cat = c.getAttribute("data-cat");
      (groups[cat] = groups[cat] || []).push(c);
    });
    var parent = cards[0].parentNode;
    var frag = document.createDocumentFragment();
    order.forEach(function (cat) {
      if (!groups[cat] || !groups[cat].length) return;
      var head = document.createElement("div");
      head.className = "tool-group-head";
      head.innerHTML = (CAT_LABEL[cat] || cat) + '<span class="dim">' + groups[cat].length + " 个工具</span>";
      frag.appendChild(head);
      groups[cat].forEach(function (c) { frag.appendChild(c); });
      delete groups[cat];
    });
    Object.keys(groups).forEach(function (cat) {
      var head = document.createElement("div");
      head.className = "tool-group-head";
      head.innerHTML = (CAT_LABEL[cat] || cat) + '<span class="dim">' + groups[cat].length + " 个工具</span>";
      frag.appendChild(head);
      groups[cat].forEach(function (c) { frag.appendChild(c); });
    });
    var last = cards[cards.length - 1];
    if (last.nextSibling) parent.insertBefore(frag, last.nextSibling);
    else parent.appendChild(frag);
  }

  /* ---------- W4 触觉反馈：关键操作成功/警报的轻震动（无 navigator.vibrate 时静默） ---------- */
  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) {}
  }

  /* ---------- 装配 ---------- */
  window.TOOLS = {
    init: function () {
      bindCalc("sv-calc", "sv-result", calcSeverance, "经济补偿金计算器");
      bindCalc("ot-calc", "ot-result", calcOvertime, "加班费计算器");
      bindCalc("al-calc", "al-result", calcLeave, "年休假折算器");
      bindCalc("pt-calc", "pt-result", calcPatent, "专利关键期限计算器");
      bindCalc("dl-calc", "dl-result", calcDeadline, "时效倒计时");
      bindCalc("ln-calc", "ln-result", calcLoan, "民间借贷利息计算器");
      bindCalc("cf-calc", "cf-result", calcCourtFee, "诉讼费用计算器");
      bindCalc("fy-calc", "fy-result", calcFuyangfei, "抚养费计算器");
      bindCalc("dj-calc", "dj-result", calcDeposit, "违约金与定金计算器");
      bindCalc("ip-calc", "ip-result", calcIpDamage, "知产侵权赔偿计算器");
      setupToolCards();
      bindToolFilter();
      regroupToolCards();
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
          if (window.WORKSPACE) window.WORKSPACE.attach("deadlines", { name: name, date: date });   /* 案件工作区归集 */
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

      /* 计算历史入口按钮（工具页分类筛选行） */
      var histBtn = document.getElementById("calc-history-btn");
      if (histBtn) histBtn.addEventListener("click", openHistory);
    },
    /* 供结果卡 / AI 回答调用的跳转与映射 */
    jumpTo: jumpTo,
    toolBtnForScenario: toolBtnForScenario,
    toolChipsForDomain: toolChipsForDomain,
    TOOL_META: TOOL_META,
    TENURE_MAP: TENURE_MAP,
      /* 供案件时间线等外部模块写入合规日历 */
      calAdd: function (name, date) {
        if (!name || !date) return false;
        var list = calLoad();
        list.push({ name: String(name).slice(0, 30), date: date });
        calSave(list);
        if (window.WORKSPACE) window.WORKSPACE.attach("deadlines", { name: String(name).slice(0, 30), date: date });   /* 案件工作区归集 */
        calRender();
        calNotifyCheck();
        haptic(10);
        return true;
      },
      haptic: haptic
  };
})();
