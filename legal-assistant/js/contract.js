/* =========================================================
 * 合同审查 contract.js
 * 双层审查：
 *   ① 规则引擎（离线）：必备条款清单核对 + 高危语句模式识别
 *   ② AI 审查（需配置）：资深合同审查律师视角，流式输出 + 引用核验
 * ========================================================= */
window.CONTRACT = (function () {

  var CHECKLISTS = {
    labor: {
      name: "劳动合同",
      items: [
        { keys: ["劳动合同期限", "固定期限", "无固定期限", "以完成一定工作任务", "合同期限"], label: "劳动合同期限" },
        { keys: ["工作内容", "工作岗位", "工作职责", "岗位职责", "岗位", "担任"], label: "工作内容" },
        { keys: ["工作地点"], label: "工作地点" },
        { keys: ["工作时间", "休息休假", "工时", "休假"], label: "工作时间和休息休假" },
        { keys: ["劳动报酬", "工资", "月薪", "薪酬"], label: "劳动报酬" },
        { keys: ["社会保险", "五险", "社保"], label: "社会保险" },
        { keys: ["劳动保护", "劳动条件", "职业危害", "防护"], label: "劳动保护与职业危害防护" }
      ],
      risks: [
        { re: /押金|保证金|提供担保/g, warn: "以任何名义向劳动者收取押金/保证金/担保违反《劳动合同法》第9条，条款无效并可处罚。" },
        { re: /自愿放弃(社会保险|社保)|社保补贴代替|社保.{0,6}由.{0,4}自行(缴纳|办理)/g, warn: "「自愿放弃社保」类约定无效——社保是法定强制义务（社会保险法第58条），单位仍需补缴并可能被处罚。" },
        { re: /违约金/g, warn: "违约金仅限服务期（第22条）与竞业限制（第23条）两种情形，其余约定对劳动者无效（第25条）。" },
        { re: /伤亡.{0,6}(自理|概不负责|单位不承担)|工伤.{0,8}(概不负责|自理)/g, warn: "「工伤概不负责」条款无效——工伤保险是法定责任，不能通过约定免除。" },
        { re: /最终解释权|单方(有权)?解释/g, warn: "「单方/最终解释权」条款显失公平，司法实践中不被支持。" },
        { re: /试用期.{0,20}(不低于|等于).{0,10}工资|试用期工资/g, warn: "提示核对试用期工资≥约定工资80%且≥当地最低工资（第20条）。" },
        { re: /服务期|培训费/g, warn: "服务期违约金不得超过实际培训费用且按未履行期分摊（第22条）。" }
      ]
    },
    business: {
      name: "通用商业合同",
      items: [
        { keys: ["标的", "货物", "服务内容", "产品", "项目"], label: "标的条款（标的明确）" },
        { keys: ["价款", "金额", "报酬", "费用", "单价", "总价"], label: "价款与支付方式" },
        { keys: ["履行期限", "交付", "工期", "交货", "履行期"], label: "履行期限与方式" },
        { keys: ["验收", "质量标准", "质量要求"], label: "质量与验收标准" },
        { keys: ["违约责任", "违约金", "赔偿"], label: "违约责任" },
        { keys: ["争议解决", "仲裁", "诉讼", "管辖"], label: "争议解决条款" },
        { keys: ["解除", "终止"], label: "合同解除与终止条件" },
        { keys: ["保密"], label: "保密条款（如涉商业信息）" },
        { keys: ["不可抗力"], label: "不可抗力条款" }
      ],
      risks: [
        { re: /最终解释权|单方(有权)?(解释|修改)/g, warn: "「单方/最终解释权」条款无效或可撤销。" },
        { re: /概不(负责|退款)|一律不退/g, warn: "「概不负责/一律不退」类格式条款可能被认定无效（民法典格式条款规则）。" },
        { re: /先行支付|预付.{0,10}(全部|所有).{0,6}(税款|费用)/g, warn: "提示：预付全部费用的安排风险极高，建议改为分期/验收后付款。" },
        { re: /仲裁.{0,10}(并|和|且).{0,10}(诉讼|法院)/g, warn: "「或裁或审」二选一：仲裁与诉讼约定并存可能导致仲裁条款无效，需二选一。" },
        { re: /(应当|视为).{0,8}放弃(全部|任何)?(权利|诉权|抗辩)/g, warn: "概括性放弃诉权/抗辩权的条款无效力。" },
        { re: /口头(变更|修改|补充).{0,8}(有效|为准)/g, warn: "口头变更优先条款风险极高，建议书面变更为准。" }
      ]
    }
  };

  var currentType = "labor";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function ruleReview(text, type) {
    var cl = CHECKLISTS[type];
    var found = [], missing = [], risks = [];
    cl.items.forEach(function (it) {
      var hit = it.keys.some(function (k) { return text.indexOf(k) > -1; });
      (hit ? found : missing).push(it.label);
    });
    cl.risks.forEach(function (r) {
      var m = text.match(r.re);
      if (m) risks.push({ snippet: m[0], warn: r.warn });
    });
    return { name: cl.name, found: found, missing: missing, risks: risks };
  }

  function renderRule(res) {
    var html = '<div class="report"><div class="report-head" style="background:#0f766e">' +
      '<div class="report-head-title">📋 合同条款核对报告（' + esc(res.name) + ' · 规则引擎 · 离线）</div>' +
      '<div>必备/要素条款：命中 ' + res.found.length + ' 项 · 缺失 ' + res.missing.length + ' 项 · 风险语句 ' + res.risks.length + ' 处</div></div>';
    html += '<div class="report-sec"><div class="report-sec-title">✅ 已包含条款</div><div class="report-facts">' +
      (res.found.length ? res.found.map(function (f) { return '<span class="fact-chip" style="color:#047857">✓ ' + esc(f) + '</span>'; }).join("") : '<span class="fact-chip dim">未识别到（可能因文本片段不全或用语差异）</span>') + '</div></div>';
    html += '<div class="report-sec"><div class="report-sec-title">⚠️ 疑似缺失条款</div><div class="report-facts">' +
      (res.missing.length ? res.missing.map(function (f) { return '<span class="fact-chip" style="color:#b45309">✗ ' + esc(f) + '</span>'; }).join("") : '<span class="fact-chip" style="color:#047857">核心条款齐全</span>') + '</div></div>';
    html += '<div class="report-sec"><div class="report-sec-title">🚨 高危语句识别</div>';
    if (res.risks.length) {
      html += '<ul class="report-list risk">' + res.risks.map(function (r) {
        return '<li>「' + esc(r.snippet) + '」— ' + esc(r.warn) + '</li>';
      }).join("") + '</ul>';
    } else {
      html += '<div class="dim">未命中已知高危模式（不等于无风险，AI 审查可进一步分析）。</div>';
    }
    html += '</div><div class="result-disclaimer" style="padding:8px 20px">规则核对基于关键词与已知模式，仅供参考 · AI 深度审查可获得逐条意见</div></div>';
    return html;
  }

  function aiReview(text, type) {
    if (!(window.AI && window.AI.isConfigured())) {
      document.getElementById("ct-ai-result").innerHTML = '<div class="tool-warn">AI 未配置：请点右上角「AI 模型」设置后使用；「条款核对（离线）」无需 AI 即可用。</div>';
      return;
    }
    var box = document.getElementById("ct-ai-result");
    box.innerHTML = '<div class="msg bot" style="max-width:100%"><div class="bubble ai-stream" style="flex:1"><span class="ai-text"></span><span class="ai-cursor">▍</span></div></div>';
    var span = box.querySelector(".ai-text");
    var rule = ruleReview(text, currentType);
    var ctxText = "【核对结果】已识别条款：" + rule.found.join("、") + "；疑似缺失：" + (rule.missing.join("、") || "无") + "；命中风险语句：" + (rule.risks.map(function (r) { return r.snippet; }).join("、") || "无");
    var prompt =
      "你是资深合同审查律师。请审查以下" + (type === "labor" ? "劳动合同" : "商业合同") + "文本，按四部分输出：" +
      "一、总体评价（2-3句）；二、缺漏条款（对照常规合同要素，说明缺失后果）；" +
      "三、风险与不利条款（逐条引用原文短语并说明风险与修改建议）；四、修改建议清单。" +
      "引用法律须用《法律名》第X条格式，只引用确实存在的常见法律（如劳动合同法、民法典），不确定不要编造条文号。\n\n" +
      ctxText + "\n\n【合同文本】\n" + text.slice(0, 8000);
    var messages = [{ role: "system", content: "你是「法律咨询助手」的合同审查模块，严格遵守：只依据用户提供的合同文本与普遍法律常识作答；引用法条用《法律名》第X条格式且必须是真实存在的常见条文；不确定的明确标注「需核实」；结尾提醒仅供参考。" },
      { role: "user", content: prompt }];
    var full = "";
    window.AI.aiChat(messages, function (d) {
      full += d;
      span.textContent = full;
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).then(function () {
      span.textContent = full || "（模型未返回内容。）";
      var bubble = box.querySelector(".bubble");
      box.querySelector(".ai-cursor") && box.querySelector(".ai-cursor").remove();
      if (window.AGENT && full) window.AGENT.attachVerification(bubble, full, ctxText + (rule.found.join("") || ""));
    }).catch(function (e) {
      box.innerHTML = '<div class="tool-warn">⚠️ ' + (e && e.message || e) + "</div>";
    });
  }

  function init() {
    var input = document.getElementById("ct-input");
    var btnL = document.getElementById("ct-type-labor");
    var btnB = document.getElementById("ct-type-business");
    if (!btnL) return;
    btnL.addEventListener("click", function () { currentType = "labor"; btnL.classList.add("active"); btnB.classList.remove("active"); });
    btnB.addEventListener("click", function () { currentType = "business"; btnB.classList.add("active"); btnL.classList.remove("active"); });
    document.getElementById("ct-rule-run").addEventListener("click", function () {
      var text = (input.value || "").trim();
      var out = document.getElementById("ct-rule-result");
      if (text.length < 20) { out.innerHTML = '<div class="tool-warn">请粘贴合同全文或关键条款（至少20字）。</div>'; return; }
      out.innerHTML = renderRule(ruleReview(text, currentType));
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("ct-ai-run").addEventListener("click", function () {
      var text = (input.value || "").trim();
      if (text.length < 20) { document.getElementById("ct-ai-result").innerHTML = '<div class="tool-warn">请先粘贴合同文本（至少20字）。</div>'; return; }
      aiReview(text, currentType);
      document.getElementById("ct-ai-result").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return { init: init };
})();
