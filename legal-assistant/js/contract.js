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
    },
    rent: {
      name: "房屋租赁合同",
      items: [
        { keys: ["租赁期限", "租期", "自.*起至"], label: "租赁期限" },
        { keys: ["租金", "每月", "月租"], label: "租金数额与支付方式" },
        { keys: ["押金", "保证金"], label: "押金（金额与退还条件）" },
        { keys: ["维修", "修缮", "修理"], label: "维修责任划分" },
        { keys: ["转租", "分租"], label: "转租约定" },
        { keys: ["解除", "退租", "提前"], label: "解除与提前退租条件" },
        { keys: ["水电", "物业", "燃气"], label: "水电物业费用承担" },
        { keys: ["交付", "验收", "交房"], label: "房屋交付与验收" },
        { keys: ["违约责任", "违约金"], label: "违约责任" },
        { keys: ["身份证", "身份信息", "产权", "房产证"], label: "主体与产权信息" }
      ],
      risks: [
        { re: /押金.{0,12}(概不退还|不予退还|不退)/g, warn: "「押金概不退还」显失公平：押金在扣除违约金/实际损失后余额应退还，此类条款无效风险高。" },
        { re: /单方(有权)?(调整|上涨|提高|上浮).{0,8}租金/g, warn: "租期内单方调租对承租人没有约束力——租金变更须协商一致（民法典第509条全面履行原则）。" },
        { re: /租赁期限.{0,16}二十年|租期.{0,12}(超过|超出).{0,8}二十年/g, warn: "租赁期限法定上限 20 年（民法典第705条），超出部分无效。" },
        { re: /承租人.{0,14}(放弃|不得主张).{0,10}(优先购买|优先承租)/g, warn: "优先购买/优先承租是法定权利（民法典第726/734条），概括性放弃条款效力存疑，需特别提示。" },
        { re: /转租.{0,14}(无需|不必|无须).{0,8}(同意|通知)/g, warn: "转租须经出租人同意（民法典第716条），未经同意转租出租人可解除合同。" },
        { re: /税费.{0,14}(全部由(承租|乙方|租客))/g, warn: "房屋租赁法定纳税义务人是出租人；税费转嫁条款需明示且不得对抗税务征管。" }
      ]
    },
    loan: {
      name: "借款合同",
      items: [
        { keys: ["借款金额", "人民币", "借款本金", "金额"], label: "借款金额（大小写一致）" },
        { keys: ["利息", "利率", "月息", "年息"], label: "利息与利率约定" },
        { keys: ["借款用途", "用途"], label: "借款用途" },
        { keys: ["还款期限", "还款日期", "分期", "于.*前归还"], label: "还款期限与方式" },
        { keys: ["逾期", "违约金", "逾期利息", "罚息"], label: "逾期责任" },
        { keys: ["担保", "保证", "抵押", "质押"], label: "担保条款（如有）" },
        { keys: ["转账", "银行", "支付方式", "交付"], label: "交付方式（转账留痕）" },
        { keys: ["身份证", "身份号码", "身份证号"], label: "双方身份信息" }
      ],
      risks: [
        { re: /砍头息|预扣.{0,8}利息|先扣.{0,6}利息|扣除利息后(交付|支付)/g, warn: "预先扣除利息（砍头息）的，借款本金按实际出借金额认定（民法典第670条）。" },
        { re: /利滚利|复利|利息.{0,8}(计入|转为).{0,6}本金|滚入本金/g, warn: "复利结算计入本金的受严格限制，超出法定上限部分不受保护。" },
        { re: /月(息|利率)\s*\d/g, warn: "提示换算：月利率×12=年化；年利率超过合同成立时 LPR 四倍的部分不受法律保护。" },
        { re: /年(息|利率)\s*([2-9]\d|[1-9]\d\.)/g, warn: "年利率明显偏高（≥20%）：核对是否超过 LPR 四倍上限，超出部分无效。" },
        { re: /现金.{0,10}(交付|支付|出借)/g, warn: "大额现金交付举证困难，建议银行转账并备注「借款」，保留凭证。" },
        { re: /逾期.{0,20}(且|并).{0,12}(支付|承担).{0,8}(利息|违约金)/g, warn: "逾期利息与违约金一并主张的，合计超过 LPR 四倍部分法院不予支持。" }
      ]
    },
    nda: {
      name: "保密协议",
      items: [
        { keys: ["保密信息", "商业秘密", "保密范围"], label: "保密信息范围定义" },
        { keys: ["保密期限", "保密期", "保密义务.{0,10}年"], label: "保密期限" },
        { keys: ["例外", "已公开", "已进入公有领域", "独立获得"], label: "保密义务例外情形" },
        { keys: ["竞业限制", "竞业禁止"], label: "竞业限制条款（对象与期限）" },
        { keys: ["补偿", "经济补偿", "按月支付"], label: "竞业限制经济补偿" },
        { keys: ["违约金", "赔偿责任", "赔偿损失"], label: "违约责任" },
        { keys: ["返还", "销毁", "删除"], label: "资料返还与销毁义务" },
        { keys: ["争议解决", "仲裁", "诉讼", "管辖"], label: "争议解决条款" }
      ],
      risks: [
        { re: /竞业限制.{0,40}(无.{0,4}补偿|不支付.{0,8}补偿|不给予.{0,6}补偿)/g, warn: "竞业限制以按月支付经济补偿为对价；未约定标准的，劳动者可主张离职前 12 个月平均工资的 30% 且不低于最低工资；三个月未支付劳动者可解除竞业限制。" },
        { re: /竞业限制.{0,20}(终身|永久|长期|无限期)/g, warn: "竞业限制期限法定上限 2 年（劳动合同法第24条），超出部分无效。" },
        { re: /全体(员工|人员|职工).{0,12}(均|都|一律).{0,8}(适用|签署|签订)/g, warn: "竞业限制仅适用于高管、高级技术人员及其他负有保密义务的人员（第24条），全员绑定存在无效风险。" },
        { re: /保密期限.{0,16}(永久|终身|无限期)/g, warn: "提示区分：商业秘密以秘密存续为限受保护；一般保密信息建议约定合理期限，无限期义务易被认定过苛。" },
        { re: /不得(入职|从事).{0,10}(任何|所有|同行业.{0,6}及).{0,10}(企业|行业|单位)/g, warn: "限制范围覆盖全部行业/企业的过宽约定，司法实践可能被酌减或认定部分无效，建议限定具体竞争业务与地域。" },
        { re: /违约金.{0,24}(工资.{0,8}倍|百万元|高额)/g, warn: "竞业违约金畸高的，法院可按实际损失为基础酌减（民法典第585条）。" }
      ]
    }
  };

  var currentType = "labor";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------------- 存入案件工作区（文书草稿） ----------------
     此前审查结果只能页内看、刷新即丢（FEATURES 曾宣称自动归集但未实现）。
     草稿正文存 wsDrafts 按下标引用，避免长文塞进 DOM 属性。 */
  var wsDrafts = [];
  function ruleToText(res) {
    return "合同审查报告（" + res.name + " · 规则引擎 · 离线）\n生成：" + new Date().toLocaleString("zh-CN") +
      "\n\n【已包含条款】\n" + (res.found.join("、") || "未识别到") +
      "\n\n【疑似缺失条款】\n" + (res.missing.join("、") || "无") +
      "\n\n【高危语句】\n" + (res.risks.map(function (r) { return "「" + r.snippet + "」— " + r.warn; }).join("\n") || "未命中已知模式") +
      "\n\n—— 规则核对基于关键词与已知模式，仅供参考，不构成法律意见。";
  }
  function wsSaveBtnHtml(name, draft) {
    var has = !!(window.WORKSPACE && WORKSPACE.current && WORKSPACE.current());
    var key = String(wsDrafts.length);
    wsDrafts.push({ name: String(name).slice(0, 60), draft: String(draft || "").slice(0, 4000) });
    return '<button class="mini-btn ws-save-btn" data-ws-key="' + key + '"' + (has ? "" : " disabled title=\"未激活案件：工具页 → 案件工作区 新建/选择案件后可存\"") + '>' +
      '<svg class=ico><use href=#i-save></use></svg> 存入案件工作区</button>';
  }

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
    var html = '<div class="report"><div class="report-head" style="background:var(--primary)">' +
      '<div class="report-head-title"><svg class=ico><use href=#i-copy></use></svg> 合同条款核对报告（' + esc(res.name) + ' · 规则引擎 · 离线）</div>' +
      '<div>必备/要素条款：命中 ' + res.found.length + ' 项 · 缺失 ' + res.missing.length + ' 项 · 风险语句 ' + res.risks.length + ' 处</div></div>';
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-checkc></use></svg> 已包含条款</div><div class="report-facts">' +
      (res.found.length ? res.found.map(function (f) { return '<span class="fact-chip" style="color:var(--ok)">✓ ' + esc(f) + '</span>'; }).join("") : '<span class="fact-chip dim">未识别到（可能因文本片段不全或用语差异）</span>') + '</div></div>';
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-warn></use></svg> 疑似缺失条款</div><div class="report-facts">' +
      (res.missing.length ? res.missing.map(function (f) { return '<span class="fact-chip" style="color:var(--warn)">✗ ' + esc(f) + '</span>'; }).join("") : '<span class="fact-chip" style="color:var(--ok)">核心条款齐全</span>') + '</div></div>';
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-warn></use></svg> 高危语句识别</div>';
    if (res.risks.length) {
      /* A-3 风险分级：warn 含「极高/显失公平/无效」判高危（红），其余为提示（橙）——零人工分类 */
      html += '<ul class="report-list risk">' + res.risks.map(function (r) {
        var level = /极高|显失公平|无效|一律/.test(r.warn) ? "🔴 高危" : "🟠 提示";
        return '<li>[' + level + '] 「' + esc(r.snippet) + '」— ' + esc(r.warn) + '</li>';
      }).join("") + '</ul>';
    } else {
      html += '<div class="dim">未命中已知高危模式（不等于无风险，AI 审查可进一步分析）。</div>';
    }
    html += '</div><div class="result-disclaimer" style="padding:8px 20px">规则核对基于关键词与已知模式，仅供参考 · AI 深度审查可获得逐条意见</div>' +
      '<div style="padding:0 20px 14px">' + wsSaveBtnHtml("合同审查：" + res.name + " " + new Date().toISOString().slice(0, 10), ruleToText(res)) + '</div></div>';
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
      "你是资深合同审查律师。请审查以下" + (CHECKLISTS[type] || CHECKLISTS.business).name + "文本，按四部分输出：" +
      "一、总体评价（2-3句）；二、缺漏条款（对照常规合同要素，说明缺失后果）；" +
      "三、风险与不利条款（逐条引用原文短语并说明风险与修改建议）；四、修改建议清单。" +
      "引用法律须用《法律名》第X条格式，只引用确实存在的常见法律（如劳动合同法、民法典），不确定不要编造条文号。\n\n" +
      ctxText + "\n\n【合同文本】\n" + text.slice(0, 8000);
    var messages = [{ role: "system", content: "你是 AI 法律助手「獬小豸」（产品名「法律咨询助手」）的合同审查模块，用户问名字时答「我是獬小豸」。严格遵守：只依据用户提供的合同文本与普遍法律常识作答；引用法条用《法律名》第X条格式且必须是真实存在的常见条文；不确定的明确标注「需核实」；结尾提醒仅供参考。" },
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
      if (full) {
        var row = document.createElement("div");
        row.style.marginTop = "8px";
        row.innerHTML = wsSaveBtnHtml("合同审查（AI）：" + (CHECKLISTS[type] || CHECKLISTS.business).name + " " + new Date().toISOString().slice(0, 10), full);
        box.appendChild(row);
      }
    }).catch(function (e) {
      var msg = (e && e.message || String(e));
      if (/abort/i.test(msg)) { box.innerHTML = '<div class="tool-warn">已停止生成。</div>'; return; }
      box.innerHTML = '<div class="tool-warn"><svg class=ico><use href=#i-warn></use></svg> ' + msg + '</div>';
      var rbtn = document.createElement("button");
      rbtn.className = "mini-btn";
      rbtn.style.marginTop = "8px";
      rbtn.textContent = "🔄 重试";
      rbtn.addEventListener("click", function () { aiReview(text, type); });
      box.appendChild(rbtn);
    });
  }

  function init() {
    var input = document.getElementById("ct-input");
    var btnL = document.getElementById("ct-type-labor");
    if (!btnL) return;
    var CT_TYPES = ["labor", "business", "rent", "loan", "nda"];
    CT_TYPES.forEach(function (t) {
      var b = document.getElementById("ct-type-" + t);
      if (!b) return;
      b.addEventListener("click", function () {
        currentType = t;
        CT_TYPES.forEach(function (x) {
          var bx = document.getElementById("ct-type-" + x);
          if (bx) bx.classList.toggle("active", x === t);
        });
      });
    });
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
    /* 合同 docx/txt 直传（v3.4.5）：提取后载入输入框，走既有五类核对/AI 审查 */
    var ctAttach = document.getElementById("ct-attach");
    if (ctAttach) ctAttach.addEventListener("click", function () {
      if (!(window.ATTACH && ATTACH.pick)) return;
      ATTACH.pick(".docx,.txt,.md").then(function (f) {
        if (!f) return null;
        return ATTACH.extractFile(f).then(function (res) {
          if (!res || res.error) { if (window.UIKIT) UIKIT.toast((res && res.error) || "提取失败", "warn"); return null; }
          input.value = res.text + (res.truncated ? "\n（附件过长已截断至 2 万字）" : "");
          if (window.UIKIT) UIKIT.toast("合同已载入：" + res.name + (res.truncated ? "（已截断 2 万字）" : ""), "ok");
          return null;
        });
      }).catch(function () { });
    });
    /* 存入案件工作区（事件委托：规则/AI 两处结果共用） */
    document.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".ws-save-btn") : null;
      if (!b || b.disabled) return;
      var d = wsDrafts[parseInt(b.getAttribute("data-ws-key"), 10)];
      if (!d || !window.WORKSPACE || !WORKSPACE.attach) return;
      var ok = WORKSPACE.attach("docs", { name: d.name, date: new Date().toISOString().slice(0, 10), draft: d.draft });
      if (ok && window.TOOLS && window.TOOLS.haptic) window.TOOLS.haptic(12);
      b.innerHTML = ok ? "✓ 已存入案件工作区" : "未激活案件，未存入";
      setTimeout(function () { b.innerHTML = '<svg class=ico><use href=#i-save></use></svg> 存入案件工作区'; }, 1800);
    });
  }

  return { init: init, _testScan: function (text, type) { return ruleReview(text, type); } };
})();
