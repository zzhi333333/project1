/* =========================================================
 * limitation.js —— 时效规则中心（零依赖）
 * 集中管理常用法律时效/期间规则：搜索、分类筛选、一键按该时效
 * 填入「时效倒计时」计算器；内含时效中断/中止自查与节假日顺延说明。
 * 红线：时效规则只写稳定制度框架，特殊情形以现行法律与司法解释为准；
 *       节假日表仅收录已公布的官方安排，最新安排以国务院通知为准。
 * ========================================================= */
window.LIMITATION = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------------- 时效规则库 ----------------
   * days: 常用天数（倒计时预填用；null = 天数因案而异/需人工判断）
   * start: 起算点；interrupt: 中断/特殊；law: 主要依据 */
  var RULES = [
    /* 民事 */
    { id: "minshi-3y", cat: "civil", name: "民事诉讼普通时效", days: 1095, period: "3 年",
      start: "自权利人知道或应当知道权利受到损害以及义务人之日起算",
      interrupt: "权利人向对方主张权利、对方同意履行、提起诉讼或仲裁 → 中断，重新起算 3 年；自权利受损之日起超 20 年的不予保护（特殊情况可申请延长）",
      law: "《民法典》第188条" },
    { id: "jiejian", cat: "civil", name: "撤销婚姻 / 胁迫结婚", days: 365, period: "1 年",
      start: "自胁迫行为终止之日起", interrupt: "因胁迫结婚的，应当自胁迫行为终止之日起一年内提出；被非法限制人身自由的，自恢复人身自由之日起一年内", law: "《民法典》第1052条" },
    { id: "quegxq", cat: "civil", name: "债权人撤销权", days: null, period: "1 年 / 5 年",
      start: "自知道或应当知道撤销事由之日起 1 年内行使；自债务人行为发生之日起 5 年内没有行使的，撤销权消灭",
      interrupt: "除斥期间，不适用中止、中断", law: "《民法典》第541条" },
    { id: "yizhu", cat: "civil", name: "遗嘱继承 / 受遗赠表示", days: 60, period: "60 日",
      start: "受遗赠人应当在知道受遗赠后 60 日内作出接受的意思表示；到期没有表示的，视为放弃受遗赠",
      interrupt: "除斥期间", law: "《民法典》第1124条" },
    /* 劳动 */
    { id: "laodong-1y", cat: "labor", name: "劳动争议仲裁时效", days: 365, period: "1 年",
      start: "自当事人知道或者应当知道其权利被侵害之日起",
      interrupt: "向对方主张权利／请求救济／对方同意履行 → 中断重新起算；不可抗力等 → 中止；劳动关系存续期间因拖欠劳动报酬发生争议的，不受 1 年限制，劳动关系终止的应自终止之日起 1 年内提出",
      law: "《劳动争议调解仲裁法》第27条" },
    { id: "laodong-fuyi", cat: "labor", name: "劳动仲裁不服起诉", days: 15, period: "15 日",
      start: "收到仲裁裁决书之日起 15 日内向人民法院提起诉讼；期满不起诉的，裁决发生法律效力",
      interrupt: "除斥期间", law: "《劳动争议调解仲裁法》第50条" },
    { id: "gongshang", cat: "labor", name: "工伤认定申请（单位/个人）", days: null, period: "30 日 / 1 年",
      start: "单位自事故伤害发生或诊断鉴定为职业病之日起 30 日内申请；单位未申请的，职工或其近亲属、工会在 1 年内可直接申请",
      interrupt: "单位未按时申请的，期间发生的费用由单位负担", law: "《工伤保险条例》第17条" },
    /* 民诉程序 */
    { id: "shangsu-pj", cat: "proc", name: "判决上诉期", days: 15, period: "15 日",
      start: "自判决书送达之日起", interrupt: "不可延展；逾期未上诉即生效。上诉状可通过原审法院提出", law: "《民事诉讼法》第171条" },
    { id: "shangsu-cd", cat: "proc", name: "裁定上诉期", days: 10, period: "10 日",
      start: "自裁定书送达之日起", interrupt: "不可延展", law: "《民事诉讼法》第171条" },
    { id: "zhixing-2y", cat: "proc", name: "申请强制执行", days: 730, period: "2 年",
      start: "自法律文书规定履行期间的最后一日起算；分期履行的自最后一期履行期限届满之日起算；未规定履行期间的，自法律文书生效之日起算",
      interrupt: "适用诉讼时效中止、中断的规定（申请执行、对方承诺履行等可中断）", law: "《民事诉讼法》第250条" },
    { id: "zaishen", cat: "proc", name: "申请再审（民事）", days: null, period: "6 个月",
      start: "一般应在判决/裁定/调解书生效后提出；有新证据等法定情形的，自知道或应当知道之日起 6 个月内提出",
      interrupt: "除斥期间", law: "《民事诉讼法》第212条" },
    { id: "zhifu-15", cat: "proc", name: "支付令异议", days: 15, period: "15 日",
      start: "自收到支付令之日起", interrupt: "书面异议成立 → 支付令失效转诉讼或驳回；逾期不异议又不履行 → 债权人可申请执行", law: "《民事诉讼法》第222条" },
    { id: "baoquan", cat: "proc", name: "诉前保全后起诉", days: 30, period: "30 日",
      start: "采取诉前保全措施后 30 日内不依法提起诉讼或申请仲裁的，解除保全",
      interrupt: "除斥期间", law: "《民事诉讼法》第104条" },
    /* 行政 */
    { id: "xingzheng-fy", cat: "admin", name: "行政复议", days: 60, period: "60 日",
      start: "自知道具体行政行为之日起（法律规定超过 60 日的除外）",
      interrupt: "不可抗力等耽误期限的可申请延长期限", law: "《行政复议法》第20条" },
    { id: "xingzheng-ss", cat: "admin", name: "行政诉讼（直接起诉）", days: 180, period: "6 个月",
      start: "自知道或应当知道作出行政行为之日起；经复议后起诉的为收到复议决定书之日起 15 日",
      interrupt: "因不动产提起的案件超过 20 年、其他案件超过 5 年起诉的，法院不予受理", law: "《行政诉讼法》第46条" },
    /* 知产 */
    { id: "shangbiao-yz", cat: "ip", name: "商标异议", days: null, period: "公告期内",
      start: "自初步审定公告之日起 3 个月公告期内提出",
      interrupt: "期满未异议即核准注册", law: "《商标法》第33条" },
    { id: "shangbiao-5y", cat: "ip", name: "注册商标无效宣告（相对理由）", days: null, period: "5 年",
      start: "自商标注册之日起 5 年内可请求宣告无效；恶意抢注驰名商标的不受 5 年限制",
      interrupt: "除斥期间", law: "《商标法》第45条" },
    { id: "zhuanli-fuxi", cat: "ip", name: "专利复审请求", days: 90, period: "3 个月",
      start: "自收到驳回决定之日起 3 个月内向国家知识产权局请求复审；对复审决定不服的，3 个月内起诉",
      interrupt: "期限届满前可办理手续恢复（因不可抗力等正当理由）", law: "《专利法》第41条" },
    { id: "zhuanli-6m", cat: "ip", name: "专利权期限补偿 / 年费滞纳", days: null, period: "6 个月",
      start: "年费应当在上一年度期满前缴纳；期满未缴或未缴足的，有 6 个月滞纳期（逐月递增滞纳金）",
      interrupt: "滞纳期满仍未缴纳的，专利权自上一年度期满之日起终止", law: "《专利法实施细则》" },
    /* 公司 */
    { id: "gongsi-hg", cat: "company", name: "异议股东回购请求（有限公司）", days: 90, period: "90 日",
      start: "自股东会决议通过之日起 60 日内协商收购；协商不成的，90 日内提起诉讼",
      interrupt: "除斥期间", law: "《公司法》（2023修订）第89条" },
    { id: "gongsi-che", cat: "company", name: "公司决议撤销", days: 60, period: "60 日",
      start: "自决议作出之日起 60 日内请求撤销（未被通知参会的自知道或应当知道之日起）",
      interrupt: "除斥期间；决议作出之日起 1 年内没有起诉的，法院不予受理（2023 新公司法配套规定）", law: "《公司法》（2023修订）第26条" }
  ];

  var CATS = { all: "全部", civil: "民事", labor: "劳动", proc: "民诉程序", admin: "行政", ip: "知产", company: "公司" };

  /* ---------------- 节假日顺延（民诉法 85 条：期间届满日是节假日的，顺延至节假日后的第一日） ----------------
   * 仅收录已公布的国务院放假安排（含调休换休），未公布的年份只按周末判断。
   * HOLIDAY: 放假日期；WORKDAY: 调休补班日（周六日照常上班，属工作日） */
  var HOLIDAY = {
    "2024": ["2024-01-01", "2024-02-10", "2024-02-11", "2024-02-12", "2024-02-13", "2024-02-14", "2024-02-15", "2024-02-16", "2024-02-17", "2024-04-04", "2024-04-05", "2024-04-06", "2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04", "2024-05-05", "2024-06-08", "2024-06-09", "2024-06-10", "2024-09-15", "2024-09-16", "2024-09-17", "2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04", "2024-10-05", "2024-10-06", "2024-10-07"],
    "2025": ["2025-01-01", "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31", "2025-02-01", "2025-02-02", "2025-02-03", "2025-02-04", "2025-04-04", "2025-04-05", "2025-04-06", "2025-05-01", "2025-05-02", "2025-05-03", "2025-05-04", "2025-05-05", "2025-05-31", "2025-06-01", "2025-06-02", "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04", "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08"],
    "2026": ["2026-01-01", "2026-01-02", "2026-01-03", "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23", "2026-04-04", "2026-04-05", "2026-04-06", "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-06-19", "2026-06-20", "2026-06-21", "2026-09-25", "2026-09-26", "2026-09-27", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]
  };
  var WORKDAY = {
    "2024": ["2024-02-04", "2024-02-18", "2024-04-07", "2024-04-28", "2024-05-11", "2024-09-14", "2024-09-29", "2024-10-12"],
    "2025": ["2025-01-26", "2025-02-08", "2025-04-27", "2025-09-28", "2025-10-11"],
    "2026": ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"]
  };
  function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  /* 是否休假日：周末（且非调休上班日）或官方放假表内；未知年份只按周末 */
  function isRestDay(d) {
    var y = String(d.getFullYear());
    var s = ymd(d);
    if (WORKDAY[y] && WORKDAY[y].indexOf(s) > -1) return false;
    if (HOLIDAY[y] && HOLIDAY[y].indexOf(s) > -1) return true;
    return d.getDay() === 0 || d.getDay() === 6;
  }
  /* 届满顺延：返回 { date, postponed } */
  /* 某年份是否有官方放假表（供 UI 提示「未收录年份顺延仅按周末近似」） */
  function yearCovered(y) { return !!HOLIDAY[String(y)]; }

  function postponeIfRest(d) {
    var r = new Date(d.getTime());
    var moved = false;
    while (isRestDay(r)) { r.setDate(r.getDate() + 1); moved = true; }
    return { date: r, postponed: moved };
  }

  /* ---------------- UI：规则中心弹层 ---------------- */
  var curCat = "all";

  function ruleHtml(r) {
    var daysChip = r.days != null
      ? '<button class="mini-btn primary" data-sx-days="' + r.days + '" data-sx-name="' + esc(r.name) + '"><svg class=ico><use href=#i-calendar></use></svg> 按此时效倒计时</button>'
      : '<span class="prop warn">天数因案而异，请对照上述起算点判断</span>';
    return '<div class="flk-item sx-rule" data-sx-cat="' + r.cat + '">' +
      '<div class="flk-title">' + esc(r.name) + '<span class="prop" style="margin-left:8px">' + esc(r.period) + '</span></div>' +
      '<div class="flk-props"><span class="prop">起算：' + esc(r.start) + '</span></div>' +
      (r.interrupt ? '<div class="flk-props"><span class="prop">中断 / 特殊：' + esc(r.interrupt) + '</span></div>' : "") +
      '<div class="flk-actions">' + daysChip + '<span class="prop">' + esc(r.law) + '</span></div>' +
      '</div>';
  }

  function renderList() {
    var box = document.getElementById("sx-list");
    var kw = (document.getElementById("sx-search").value || "").trim().toLowerCase();
    var list = RULES.filter(function (r) {
      if (curCat !== "all" && r.cat !== curCat) return false;
      if (!kw) return true;
      return (r.name + r.period + r.start + r.interrupt + r.law).toLowerCase().indexOf(kw) > -1;
    });
    if (!list.length) { box.innerHTML = '<div class="empty">没有匹配的时效规则，可换个关键词或分类。</div>'; return; }
    box.innerHTML = list.map(ruleHtml).join("");
    box.querySelectorAll("[data-sx-days]").forEach(function (b) {
      b.addEventListener("click", function () {
        var days = b.getAttribute("data-sx-days");
        if (window.TOOLS && window.TOOLS.jumpTo) {
          window.TOOLS.jumpTo("dl", { "dl-type": "custom", "dl-days": days });
          closeCenter();
        }
      });
    });
  }

  function openCenter() {
    var modal = document.getElementById("sx-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    renderList();
  }
  function closeCenter() {
    var modal = document.getElementById("sx-modal");
    if (modal) modal.classList.add("hidden");
  }

  function init() {
    var btn = document.getElementById("sx-center-btn");
    if (btn) btn.addEventListener("click", openCenter);
    var modal = document.getElementById("sx-modal");
    if (!modal) return;
    var close = document.getElementById("sx-close");
    if (close) close.addEventListener("click", closeCenter);
    modal.querySelector(".modal-mask").addEventListener("click", closeCenter);
    var search = document.getElementById("sx-search");
    if (search) search.addEventListener("input", renderList);
    modal.querySelectorAll("#sx-cats .filter-chip").forEach(function (c) {
      c.addEventListener("click", function () {
        modal.querySelectorAll("#sx-cats .filter-chip").forEach(function (x) { x.classList.remove("active"); });
        c.classList.add("active");
        curCat = c.getAttribute("data-cat");
        renderList();
      });
    });
  }

  return {
    init: init, openCenter: openCenter, closeCenter: closeCenter,
    rules: RULES,
    /* 供「时效倒计时」计算器调用：届满日节假日顺延 */
    postponeIfRest: postponeIfRest, isRestDay: isRestDay, ymd: ymd, yearCovered: yearCovered
  };
})();
