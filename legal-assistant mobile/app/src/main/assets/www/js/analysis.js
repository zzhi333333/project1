/* =========================================================
 * 案情深度分析 analysis.js
 * 用户输入完整案情 →
 *   ①案情要素提取（金额/时间/年限/关键词）
 *   ②领域判断 + 争议场景匹配
 *   ③相关法条匹配（本地知识库打分 Top6）
 *   ④参考案例匹配（指导性案例 + 典型案例）
 *   ⑤程序建议（阶段化路径：时效/管辖/费用/前置程序）
 *   ⑥请求事项参考（仲裁/诉讼请求怎么列）
 *   ⑦证据清单 + 风险提示
 * 联网模式可用时提供 flk 原文核对与类案在线检索入口
 * ========================================================= */
window.ANALYSIS = (function () {

  /* ---------------- 文本工具 ---------------- */
  function tokenize(q) {
    var out = [];
    q.split(/\s+/).forEach(function (seg) {
      if (!seg) return;
      if (/^[\u4e00-\u9fa5]{4,}$/.test(seg)) {
        for (var i = 0; i + 2 <= seg.length; i++) out.push(seg.substr(i, 2));
      } else out.push(seg);
    });
    return out;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------------- 案情要素提取 ---------------- */
  function extractFacts(text) {
    var facts = { amounts: [], dates: [], durations: [], keywords: [] };

    /* 金额：10000元 / 8万 / 1.5万元 / 3,000块 */
    var reAmt = /(\d[\d,，]*(?:\.\d+)?)\s*(万元|千元|元|块)/g, m;
    while ((m = reAmt.exec(text))) {
      var n = parseFloat(m[1].replace(/[,,]/g, ""));
      var unit = m[2];
      var val = unit === "万元" ? n * 10000 : unit === "千元" ? n * 1000 : n;
      facts.amounts.push({ raw: m[0], value: val });
    }

    /* 日期：2024年3月 / 2024-03-15 / 2024.3.15 */
    var reDate = /(\d{4})\s*[年\-\/.]\s*(\d{1,2})(?:\s*[月\-\/.]\s*(?:\d{1,2})?)?(?:\s*日|[日号])?/g;
    while ((m = reDate.exec(text))) facts.dates.push(m[0]);

    /* 年限：工作3年 / 工龄5年2个月 */
    var reDur = /(\d+)\s*年(?:\s*(\d+)\s*个?月)?/g;
    while ((m = reDur.exec(text))) facts.durations.push(m[0]);

    return facts;
  }

  /* ---------------- 场景匹配（复用 SCENARIOS 关键词） ---------------- */
  function topScenarios(text, domain, n) {
    var scored = window.SCENARIOS.map(function (s) {
      var score = 0;
      s.keywords.forEach(function (kw) { if (text.indexOf(kw) > -1) score += kw.length; });
      if (s.domain === domain) score += 1.5;
      return { s: s, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
    /* 领域命中即纳入最贴近场景；不足 n 个时补充同域高分场景 */
    var picked = scored.filter(function (x) { return x.score > 1.5; }).slice(0, n || 2);
    if (!picked.length && scored.length) picked = [scored[0]];
    return picked.map(function (x) { return x.s; });
  }

  /* ---------------- 法条匹配 ---------------- */
  function scoreLaw(law, tokens, text) {
    var score = 0;
    tokens.forEach(function (t) {
      if (!t) return;
      if (law.title.indexOf(t) > -1) score += 5;
      law.tags.forEach(function (tag) { if (tag.indexOf(t) > -1) score += 4; });
      if (law.text.indexOf(t) > -1) score += 2;
      if (law.note && law.note.indexOf(t) > -1) score += 1;
    });
    /* 场景引用加成：被命中场景引用的法条更相关 */
    return score;
  }
  /* 场景引用的法条：从各场景 result 函数源码中提取法条 id（ht-40 等），
     避免在场景定义里维护重复的 laws 列表 */
  var _scenarioLaws = null;
  function scenarioLaws() {
    if (_scenarioLaws) return _scenarioLaws;
    _scenarioLaws = {};
    window.SCENARIOS.forEach(function (s) {
      var ids = {}, src = "";
      try { src = s.result.toString(); } catch (e) {}
      (src.match(/["']([a-z]{2,4}-\d+)["']/g) || []).forEach(function (m) {
        ids[m.replace(/["']/g, "")] = true;
      });
      _scenarioLaws[s.id] = Object.keys(ids);
    });
    return _scenarioLaws;
  }

  function topLaws(text, tokens, scenarios, domain, n) {
    var pool = window.LAWS.filter(function (l) { return l.domain === domain; });
    var sLaws = scenarioLaws();
    var scored = pool.map(function (l, i) {
      var s = scoreLaw(l, tokens, text);
      scenarios.forEach(function (sc) {
        if ((sLaws[sc.id] || []).indexOf(l.id) > -1) s += 6;
      });
      /* 保底分：保证领域内至少能按序取到法条（排名仍按相关度） */
      s += (pool.length - i) * 0.01;
      return { l: l, s: s };
    }).sort(function (a, b) { return b.s - a.s; })
      .slice(0, n || 6);
    return scored.map(function (x) { return x.l; });
  }

  /* ---------------- 案例匹配 ----------------
     两层打分：①关键词直接命中（权重高）②分词滑窗与案例全文重叠（软匹配兜底），
     保证口语化案情也能拿到领域相关的参考案例 */
  function topCases(text, domain, n) {
    var tokens = tokenize(text);
    var all = [];
    window.GUIDING.forEach(function (g) { all.push({ kind: "guiding", d: g }); });
    window.CASES.forEach(function (c) { all.push({ kind: "builtin", d: c }); });

    function fullText(d) {
      return [d.title || "", (d.keywords || []).join(""), d.facts || "", d.gist || "", d.ruling || "", d.lesson || "", d.analysis || ""].join(" ");
    }
    var scored = all.map(function (item) {
      var d = item.d, score = 0;
      (d.keywords || []).forEach(function (kw) { if (text.indexOf(kw) > -1) score += kw.length + 3; });
      (d.title || "").split(/[（）()、，,\s]/).forEach(function (seg) {
        if (seg.length >= 3 && text.indexOf(seg) > -1) score += 3;
      });
      var ft = fullText(d);
      tokens.forEach(function (t) { if (t && ft.indexOf(t) > -1) score += 1; });
      if (d.domain === domain) score += 1.5;
      return { item: item, score: score };
    }).sort(function (a, b) { return b.score - a.score; });

    var picked = scored.slice(0, n || 3);
    /* 兜底：不足时用同领域案例补齐 */
    if (picked.length < (n || 3)) {
      scored.forEach(function (x) {
        if (picked.length >= (n || 3)) return;
        if (picked.indexOf(x) === -1 && x.item.d.domain === domain) picked.push(x);
      });
    }
    /* 拍平为案例数据对象（含 kind 标记来源），供 renderCase 直接使用 */
    return picked.map(function (x) {
      var out = {};
      for (var k in x.item.d) out[k] = x.item.d[k];
      out.kind = x.kind;
      return out;
    });
  }

  /* ---------------- 请求事项参考（按场景） ---------------- */
  var CLAIMS = {
    "labor-dismiss": ["违法解除劳动合同赔偿金（2N）或继续履行劳动合同并补发争议期间工资", "出具解除/终止劳动合同证明，办理档案和社会保险关系转移手续", "未结工资、未休年假折算（300%）、加班费（如适用）"],
    "labor-wage": ["拖欠/克扣的工资（含提成、奖金）及利息损失", "如已以第38条被迫解除：经济补偿金（N）", "（投诉渠道）责令限期支付，逾期加付50%–100%赔偿金"],
    "labor-no-contract": ["未签订书面劳动合同的二倍工资差额（最多11个月）", "确认劳动关系（如单位否认用工关系）", "补缴在职期间社会保险（行政投诉途径）"],
    "labor-overtime": ["工作日延时加班费（150%）、休息日加班费（200%，未补休）、法定节假日加班费（300%）", "（可一并）以未及时足额支付劳动报酬为由的补偿金"],
    "labor-probation": ["违法约定试用期已经履行的赔偿金（按转正工资标准）", "低于法定标准的试用期工资差额", "试用期违法解除的赔偿金（2N）或继续履行"],
    "labor-noncompete": ["请求解除竞业限制约定（单位3个月未支付补偿时）", "补足已履行期间的竞业限制经济补偿（按30%口径）", "驳回单位违约金请求（如被反诉）"],
    "labor-injury": ["工伤保险待遇（医疗费、停工留薪期工资、一次性伤残补助金等）", "未参保情形下由单位承担全部待遇", "劳动能力鉴定（伤残等级）"],
    "labor-social": ["责令单位补缴社会保险（社保稽核行政途径）", "（如以此被迫解除）经济补偿金N", "赔偿因未参保导致的损失（如医疗费不能报销部分）"],
    "labor-leave": ["未休年休假工资报酬（日工资的300%，额外200%）", "（如被迫解除）经济补偿金"],
    "labor-transfer": ["按原劳动合同约定继续履行（恢复原岗位原薪）", "如被迫解除：经济补偿金N", "补发降薪期间的工资差额"],
    "company-capital": ["未届期股东提前缴纳出资（加速到期，gf-54）", "瑕疵出资股东在未出资本息范围内对公司债务承担补充赔偿责任", "设立时其他股东的连带出资责任（gf-50）"],
    "company-transfer": ["继续履行股权转让协议、办理变更登记", "逾期付款违约金/利息", "（受让方）出让方对出资瑕疵的补足与违约责任"],
    "company-inspection": ["判令公司提供查阅：会计账簿、会计凭证（可委托会计师/律师）", "复制：章程、股东名册、三会记录、财务会计报告", "由公司承担本案诉讼费用"],
    "company-resolution": ["撤销该股东会/董事会决议（60日内起诉）或确认决议无效（内容违法时）", "（决议执行造成的损失）相应赔偿"],
    "company-minority": ["请求公司以合理价格回购股权（gf-89，含控股股东压榨情形）", "公司利润分配（以存在可分配利润与决议/违法截留证据为前提）", "滥用股东权利的股东赔偿损失（gf-21）"],
    "company-mixing": ["股东对公司债务承担连带清偿责任（gf-23）", "关联公司横向连带（利用多个公司混同逃债时）", "（起诉时同步申请）财产保全"],
    "company-liquidation": ["清算义务人（董事）未及时清算的赔偿责任", "未经清算即注销/简易注销承诺不实：股东对债务承担责任", "怠于清算致账册灭失：对公司债务承担连带清偿责任"],
    "patent-infringed": ["停止侵权行为（生产、销售、许诺销售）", "赔偿经济损失（损失/获利/许可费倍数/法定赔偿≤500万，故意侵权可主张1–5倍惩罚性赔偿）", "赔偿维权合理开支（律师费、公证费）", "（视情况）销毁侵权模具/专用设备"],
    "patent-accused": ["确认不侵犯专利权或驳回原告全部诉讼请求", "（对方恶意发函打压）主张商业诋毁或不正当竞争赔偿", "（反制）对涉案专利提起无效宣告请求"],
    "patent-apply": ["（非诉）确定申请类型与布局：发明/实用新型/外观/同日申请", "授权前保密管理，评估现有技术与FTO", "海外布局：12个月优先权期内PCT/巴黎公约途径"],
    "patent-service": ["确认发明人资格与署名权", "职务发明奖励（授权后，无约定按法定标准）", "职务发明报酬（实施后按利润/许可费比例）"],
    "patent-invalid": ["宣告涉案专利权无效（全部或部分）", "（作为被请求方）1个月内提交意见陈述与权利要求修改"]
  };

  /* ---------------- 证据清单（按场景） ---------------- */
  var EVIDENCE = {
    "labor-dismiss": ["劳动合同、工牌、考勤记录", "工资流水（12个月）", "辞退通知/谈话录音/催告短信", "规章制度签收记录（单位举证要点）"],
    "labor-wage": ["劳动合同与工资条", "银行流水", "提成制度/绩效结算单", "催讨记录（微信/邮件）"],
    "labor-no-contract": ["入职通知/offer", "工牌、门禁、考勤", "工作沟通记录", "社保或个税代缴记录"],
    "labor-overtime": ["打卡/考勤导出记录", "加班审批单、排班表", "深夜工作邮件/群通知", "工资条（核对加班费列支）"],
    "labor-probation": ["劳动合同（试用期条款）", "offer 与录用条件确认", "考核记录", "工资条"],
    "labor-noncompete": ["竞业限制协议/含竞业条款的合同", "补偿金支付到账记录", "新单位入职信息（应诉时）", "解除竞业限制的书面通知"],
    "labor-injury": ["病历、诊断证明（载明受伤时间地点原因）", "事故责任认定书（交通事故）", "劳动合同与考勤", "证人证言"],
    "labor-social": ["社保缴费记录（人社APP打印）", "工资流水（证明基数）", "劳动合同", "「自愿放弃」协议（无效但需固定）"],
    "labor-leave": ["社保记录（证明累计工龄）", "考勤/年假申请与审批记录", "工资条", "离职结算单（如有）"],
    "labor-transfer": ["原劳动合同（岗位、薪资条款）", "调岗/降薪通知（书面/聊天记录）", "书面表示不同意的邮件/OA记录", "原岗位出勤证据"],
    "company-capital": ["企业信用信息公示报告（实缴情况）", "公司章程（出资期限）", "债权凭证（合同、对账单、判决）", "验资/银行流水（主张瑕疵出资时）"],
    "company-transfer": ["股权转让协议", "付款凭证", "书面通知其他股东的EMS底单", "工商内档（章程、股东名册）"],
    "company-inspection": ["股东身份证明（股东名册/章程/出资证明）", "书面查阅请求及EMS签收底单", "公司15日答复（或拒绝答复）", "不正当目的抗辩的反证"],
    "company-resolution": ["决议文本", "会议通知记录（或缺失证明）", "签名笔迹比对材料", "工商备案内档"],
    "company-minority": ["连续盈利的财务资料（年报、纳税记录）", "股东会决议与反对票记录", "关联交易往来凭证", "查账发现的问题清单"],
    "company-mixing": ["公司账户与个人账户流水", "审计报告（一人公司年度审计）", "关联公司人员/业务/财务混同证据", "债权凭证"],
    "company-liquidation": ["注销登记全套内档（清算报告、股东承诺书）", "债权凭证", "账册灭失证据", "清算组通知债权人的记录（或缺失）"],
    "patent-infringed": ["专利证书、年费缴纳凭证", "公证购买侵权产品（实物+票据）", "侵权页面时间戳/网站快照", "侵权规模证据（销量、宣传页）", "（实用新型/外观）专利权评价报告"],
    "patent-accused": ["涉案专利登记簿副本（法律状态）", "权利要求特征对比表", "在先使用证据：图纸/订单/发票（先用权）", "申请日前公开的现有技术证据"],
    "patent-apply": ["技术交底书", "现有技术检索报告", "保密管理记录"],
    "patent-service": ["研发过程记录（实验记录、邮件）", "专利证书发明人栏", "单位奖酬制度/无制度证明", "专利实施收益证据"],
    "patent-invalid": ["无效宣告请求书与证据组合", "公知性证据（专利文献/论文/在售产品公证）", "口头审理记录"]
  };

  /* ---------------- 程序建议（分领域阶段化） ---------------- */
  function buildProcedure(domain, scenarios, text) {
    var steps = [];
    var ids = scenarios.map(function (s) { return s.id; });
    if (domain === "labor") {
      steps.push({ stage: "第0步 · 证据固定（立即做）", detail: [
        "系统归集：劳动合同、工资流水、考勤、沟通记录（原始载体保存，勿只截图）、涉及谈话的录音。",
        "对电子证据做可信存证（时间戳/公证），防止删除后无法复原。"
      ], tip: "证据决定成败：多数败诉不是因为没理，而是因为没有证据。" });
      steps.push({ stage: "第1步 · 内部主张（1–2周）", detail: [
        "用可留痕方式（EMS/邮件/OA）向单位书面主张：要求支付/说明理由/继续履行，限期回复。",
        "拟离职维权的，先咨询再决定是否发出《被迫解除劳动合同通知书》——措辞直接决定能否拿到N。"
      ], tip: "书面留痕既是协商筹码，也是后续仲裁的证据。" });
      steps.push({ stage: "第2步 · 行政/快速渠道（可选）", detail: [
        "拖欠工资、未缴社保：拨打12333或向劳动保障监察部门投诉（免费、较快）。",
        "拖欠劳动报酬：可向法院申请支付令（ht-30，对方书面异议即失效，可转仲裁）。"
      ], tip: "监察投诉与仲裁不冲突，欠薪类问题投诉常更快见效。" });
      steps.push({ stage: "第3步 · 劳动仲裁（前置必经）", detail: [
        "向用人单位所在地或劳动合同履行地的劳动人事争议仲裁委员会提交《仲裁申请书》（免费）。",
        "时效：知道权利被侵害之日起1年；追索劳动报酬在职期间不受限，离职后1年内必须提出（zc-27）。",
        "材料：仲裁申请书（按被申请人人数+1份）、身份证复印件、证据清单及证据复印件。",
        "追索劳动报酬/工伤医疗费/经济补偿不超过当地月最低工资标准12个月金额的，一裁终局。"
      ], tip: "请求金额要写清计算方式：基数 × 月数，方便裁决且显专业。" });
      steps.push({ stage: "第4步 · 诉讼与执行（如不服裁决）", detail: [
        "收到裁决书15日内向法院起诉（终局裁决用人单位不能起诉）。",
        "一审→二审→生效后申请强制执行；执行阶段可申请查封账户、纳入失信名单。"
      ], tip: "小额争议多数在仲裁阶段就能解决，诉前测算好合理金额更利于调解。" });
    } else if (domain === "company") {
      steps.push({ stage: "第0步 · 权利体检与取证", detail: [
        "调取工商内档（章程、股东名册、历次决议、备案信息）——市场监督局凭立案/身份可查。",
        "先书面行使知情权（gf-57）：EMS提出查阅请求+说明目的，公司15日内须书面答复——这是查账与后续诉讼的证据地基。"
      ], tip: "公司诉讼普遍「先知情、后动手」，账目资料决定策略。" });
      steps.push({ stage: "第1步 · 内部程序（部分诉讼的前置条件）", detail: [
        "股东会决议投反对票并留记录（回购请求权的前提，gf-89）。",
        "股东代表诉讼：先书面请求监事会/董事会起诉，30日未起诉或情况紧急方可自行起诉（gf-189）。",
        "（如适用）失权、催缴出资：先发书面催缴书，宽限期不少于60日（gf-52）。"
      ], tip: "前置程序缺失是公司诉讼常见败诉原因，顺序别搞反。" });
      steps.push({ stage: "第2步 · 诉讼（注意除斥期间）", detail: [
        "管辖：公司诉讼一般由公司住所地法院管辖。",
        "关键期限：决议撤销60日（未获通知者自知悉起60日、决议作出起1年）；回购协商不成90日内起诉；知情权诉讼时效3年。",
        "同步申请财产保全，防止转移资产。"
      ], tip: "除斥期间是不变期间，逾期失权，宁可先起诉后补证。" });
      steps.push({ stage: "第3步 · 执行与后续追责", detail: [
        "胜诉后申请执行；公司无财产的，核查股东出资情况，依法追加/另诉股东（加速到期 gf-54、人格否认 gf-23）。",
        "董监高履职损害的，另循代表诉讼追究赔偿。"
      ], tip: "对公司执行不能 ≠ 终局，穿透到股东是常见翻盘点。" });
    } else {
      steps.push({ stage: "第0步 · 权利与证据准备", detail: [
        "核对专利法律状态：登记簿副本、年费缴纳、是否在保护期内。",
        "固定侵权证据：公证购买（实物+发票+包装）、网页时间戳、宣传物料；规模证据（销量、评价数）。",
        "实用新型/外观：建议先请求国务院专利行政部门出具《专利权评价报告》，再决定出手。"
      ], tip: "先取证后发函，防止对方销毁证据；评价报告负面要慎重起诉。" });
      steps.push({ stage: "第1步 · 路径选择（三条路）", detail: [
        "协商/律师函：成本低，适合收许可费或快速下架。",
        "行政途径：请求地方知识产权局处理，快、可责令停止侵权（zl-65），但赔偿需另循途径。",
        "司法途径：向知识产权法院/有管辖权的中级法院起诉，可申请行为保全（禁令）+财产保全+证据保全。"
      ], tip: "看商业目标选路径：要钱→诉讼；要停→行政/禁令；要合作→许可谈判。" });
      steps.push({ stage: "第2步 · 程序攻防", detail: [
        "被告通常反制无效宣告（zl-45）：起诉前先自查稳定性，答辩期内被诉方可提无效并申请中止。",
        "赔偿举证按顺序：实际损失→侵权获利→许可费倍数→法定赔偿（3万–500万）；故意且情节严重可主张1–5倍惩罚性赔偿（zl-71）。",
        "维权合理开支（律师费、公证费）一并主张。"
      ], tip: "时效应对：侵权诉讼时效3年（zl-74），发现侵权尽早行动。" });
      steps.push({ stage: "第3步 · 履行与执行", detail: [
        "判决/决定生效后监督履行，逾期申请强制执行。",
        "平台内的侵权链接，凭生效裁判向电商平台投诉下架。"
      ], tip: "胜诉不是终点，禁令+下架+赔偿执行组合才算闭环。" });
    }
    return steps;
  }

  /* ---------------- 风险提示 ---------------- */
  function buildRisks(domain, scenarios, facts) {
    var risks = [];
    if (domain === "labor") {
      risks.push("时效风险：仲裁时效1年，二倍工资等按月起算，拖延是最大败因。");
      risks.push("举证风险：辞退理由、加班事实、工资标准的举证责任分配不同，注意按清单归集证据。");
      if (facts.amounts.length) risks.push("高收入封顶：月工资超当地社平工资3倍的，补偿基数按3倍封顶且年限≤12年（ht-47）。");
    } else if (domain === "company") {
      risks.push("除斥期间风险：决议撤销60日、回购诉讼90日，逾期权利消灭。");
      risks.push("前置程序风险：代表诉讼、催缴失权等未走完内部程序会被驳回。");
      risks.push("败诉成本：滥用诉权可能被要求提供担保或赔偿公司损失。");
    } else {
      risks.push("稳定性风险：实用新型/外观未经实审，被无效概率较高，起诉前务必评估。");
      risks.push("时效与赔偿范围：诉讼时效3年，损害赔偿一般仅支持起诉前3年内部分。");
      risks.push("反制风险：大概率遭遇无效宣告+管辖权异议，预算与周期要留足。");
    }
    if (ids_has(scenarios, ["company-resolution"])) risks.push("决议撤销的60日自「决议作出之日」起算，未获通知才自「知道之日」起算，勿混用。");
    if (ids_has(scenarios, ["labor-dismiss"])) risks.push("不要签署「个人原因/协商一致离职」类文件，签字后推翻举证极难。");
    return risks;
  }
  function ids_has(scenarios, ids) {
    return scenarios.some(function (s) { return ids.indexOf(s.id) > -1; });
  }

  /* ---------------- 报告生成 ---------------- */
  function run(text) {
    text = (text || "").trim();
    if (text.length < 10) return { error: "案情描述太短，请补充关键事实（时间、人物、发生了什么、您的诉求）。" };

    var cls = window.CONSULT.classify(text);
    var domain = cls.domain || "labor";
    var tokens = tokenize(text);
    var facts = extractFacts(text);
    var scenarios = topScenarios(text, domain, 2);
    var laws = topLaws(text, tokens, scenarios, domain, 6);
    var cases = topCases(text, domain, 3);

    return {
      domain: domain,
      domainName: window.DOMAINS[domain].name,
      confidence: Math.round(cls.confidence * 100),
      secondary: null,
      focus: scenarios.map(function (s) { return s.name; }),
      facts: facts,
      scenarios: scenarios,
      laws: laws,
      cases: cases,
      procedure: buildProcedure(domain, scenarios, text),
      claims: scenarios.reduce(function (acc, s) { return acc.concat(CLAIMS[s.id] || []); }, []).slice(0, 6),
      evidence: scenarios.reduce(function (acc, s) { return acc.concat(EVIDENCE[s.id] || []); }, []).slice(0, 8),
      risks: buildRisks(domain, scenarios, facts)
    };
  }

  /* ---------------- 渲染 ---------------- */
  function renderCase(item, box) {
    var d = window.DOMAINS[item.domain];
    var h = "";
    if (item.kind === "guiding") {
      h += '<div class="case-domain" style="background:' + d.color + '1a;color:' + d.color + '"><svg class=ico><use href=#i-star></use></svg> ' + esc(item.no) + ' · ' + d.name + '</div>';
      h += '<div class="case-title">' + esc(item.title) + '</div>';
      h += '<div class="case-sec"><b>案情</b>' + esc(item.facts) + '</div>';
      h += '<div class="case-sec"><b>裁判要点</b>' + esc(item.gist) + '</div>';
      h += '<div class="case-lesson"><svg class=ico><use href=#i-d-patent></use></svg> <b>对本案的参考</b>' + esc(item.analysis) + '</div>';
    } else {
      h += '<div class="case-domain" style="background:' + d.color + '1a;color:' + d.color + '">' + d.name + '·典型情景案例</div>';
      h += '<div class="case-title">' + esc(item.title) + '</div>';
      h += '<div class="case-sec"><b>案情</b>' + esc(item.facts) + '</div>';
      h += '<div class="case-sec"><b>结果</b>' + esc(item.ruling) + '</div>';
      h += '<div class="case-lesson"><svg class=ico><use href=#i-d-patent></use></svg> <b>要点</b>' + esc(item.lesson) + '</div>';
    }
    var el = document.createElement("div");
    el.className = "case-card";
    el.innerHTML = h;
    box.appendChild(el);
  }

  function render(r, container) {
    if (r.error) {
      container.innerHTML = '<div class="tool-warn">' + esc(r.error) + '</div>';
      return;
    }
    var d = window.DOMAINS[r.domain];
    var html = '<div class="report">';

    /* 报告头 */
    html += '<div class="report-head" style="background:' + d.color + '">' +
      '<div class="report-head-title"><svg class=ico><use href=#i-copy></use></svg> 案件分析参考报告</div>' +
      '<div>识别领域：<b>' + d.name + '</b>' + (r.confidence ? '（置信度 ' + r.confidence + '%）' : '') +
      ' · 争议焦点：' + (r.focus.length ? r.focus.map(esc).join("、") : "综合咨询") + '</div></div>';

    /* 案情要素 */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-layers></use></svg> 案情要素提取</div><div class="report-facts">';
    if (r.facts.amounts.length) html += '<span class="fact-chip"><svg class=ico><use href=#i-coins></use></svg> 涉案金额：' + r.facts.amounts.map(function (a) { return esc(a.raw); }).join("、") + '</span>';
    if (r.facts.dates.length) html += '<span class="fact-chip"><svg class=ico><use href=#i-calendar></use></svg> 时间线索：' + r.facts.dates.slice(0, 4).map(esc).join("、") + '</span>';
    if (r.facts.durations.length) html += '<span class="fact-chip">⏳ 年限线索：' + r.facts.durations.slice(0, 3).map(esc).join("、") + '</span>';
    if (!r.facts.amounts.length && !r.facts.dates.length && !r.facts.durations.length)
      html += '<span class="fact-chip dim">未识别到明确金额/时间要素，补充后分析会更精准</span>';
    html += '</div></div>';

    /* 定性意见 */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-pin></use></svg> 初步定性</div><div class="report-focus">';
    r.scenarios.forEach(function (s) {
      html += '<div class="report-focus-item"><b>' + window.DomainRegistry.iconSvg(s.domain) + " " + esc(s.name) + '</b>' + esc(s.desc) + '</div>';
    });
    html += '</div></div>';

    /* 相关法条 */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-book-open></use></svg> 相关法条（结合案情匹配）</div>';
    r.laws.forEach(function (l) {
      html += '<div class="rep-law"><div class="rep-law-head"><b>' + esc(l.lawShort + " " + l.article) + '</b><span>' + esc(l.title) + '</span></div>' +
        '<div class="rep-law-text">' + esc(l.text) + '</div>' +
        (l.note ? '<div class="law-note"><svg class=ico><use href=#i-d-patent></use></svg> ' + esc(l.note) + '</div>' : '') + '</div>';
    });
    html += '<div class="report-online-row">' +
      '<button class="mini-btn primary" data-act="verify-laws"><svg class=ico><use href=#i-globe></use></svg> 去 flk.npc.gov.cn 核对原文</button>' +
      '<span class="dim">（联网模式可用，需手机联网）</span></div></div>';

    /* 参考案例 */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-laws></use></svg> 参考案例（与案情匹配）</div>';
    if (r.cases.length) {
      html += '<div class="report-cases" id="report-cases"></div>';
    } else {
      html += '<div class="dim">未匹配到高度相关的内置案例，可到「案例检索」页在线检索更多公开文书。</div>';
    }
    html += '<div class="report-online-row">' +
      '<button class="mini-btn primary" data-act="search-cases"><svg class=ico><use href=#i-search></use></svg> 在线检索类案（裁判文书网/最高法）</button></div></div>';

    /* 咨询参考（请求事项） */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-list></use></svg> 咨询参考 · 仲裁/诉讼请求事项参考</div><ol class="report-list">';
    r.claims.forEach(function (c) { html += '<li>' + esc(c) + '</li>'; });
    html += '</ol><div class="calc-note">请求金额需按您的事实具体化；以上为常见请求方向，最终以代理律师意见为准。</div></div>';

    /* 程序建议 */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-agent></use></svg> 程序建议（阶段化路径）</div>';
    r.procedure.forEach(function (p) {
      html += '<div class="proc-step"><div class="proc-stage">' + esc(p.stage) + '</div><ul>' +
        p.detail.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") +
        '</ul><div class="proc-tip"><svg class=ico><use href=#i-d-patent></use></svg> ' + esc(p.tip) + '</div></div>';
    });
    html += '</div>';

    /* 证据清单 */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-box></use></svg> 证据准备清单</div><ul class="report-list">';
    r.evidence.forEach(function (c) { html += '<li>' + esc(c) + '</li>'; });
    html += '</ul></div>';

    /* 风险提示 */
    html += '<div class="report-sec"><div class="report-sec-title"><svg class=ico><use href=#i-warn></use></svg> 风险提示</div><ul class="report-list risk">';
    r.risks.forEach(function (c) { html += '<li>' + esc(c) + '</li>'; });
    html += '</ul></div>';

    html += '<div class="result-disclaimer" style="padding:0 2px 4px">规则引擎自动生成，仅供参考，不构成法律意见 · 完整声明见页脚</div>';
    html += '</div>';
    container.innerHTML = html;

    /* 渲染案例卡 */
    var caseBox = container.querySelector("#report-cases");
    if (caseBox) r.cases.forEach(function (c) { renderCase(c, caseBox); });

    /* 联网跳转按钮 */
    container.querySelector('[data-act="verify-laws"]').addEventListener("click", function () {
      window.APP.switchView("laws");
      document.getElementById("law-mode-online").click();
      var flkInput = document.getElementById("flk-input");
      flkInput.value = r.laws.length ? r.laws[0].law.replace(/（.*?）/g, "") : window.DOMAINS[r.domain].name;
      document.getElementById("flk-btn").click();
    });
    container.querySelector('[data-act="search-cases"]').addEventListener("click", function () {
      window.APP.switchView("cases");
      var kw = r.focus.length ? r.focus[0].replace(/^\S+\s/, "") : r.domainName;
      document.getElementById("case-input").value = kw;
      document.getElementById("case-btn").click();
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    var input = document.getElementById("analysis-input");
    var btn = document.getElementById("analysis-run");
    var container = document.getElementById("analysis-report");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var r = run(input.value);
      render(r, container);
      if (!r.error) container.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    input.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") btn.click();
    });
    var exBox = document.getElementById("analysis-examples");
    [
      "我2021年3月入职一家科技公司，签了3年合同，月薪15000元。上周HR口头通知我明天不用来了，说我绩效不行，但没给我任何书面通知和赔偿。我平时经常周末加班也没有加班费，公司社保按最低基数交。",
      "我朋友开了个一人有限公司，注册资本认缴500万，公司欠我货款80万还不上，钱都走他个人卡收的，我该怎么追债？",
      "我的发明专利2022年申请2024年授权，最近发现同行在卖一模一样的产品，月销量很大，我想让他们停止侵权并赔偿。"
    ].forEach(function (t) {
      var b = document.createElement("button");
      b.className = "sug-btn";
      b.textContent = t.slice(0, 24) + "…";
      b.title = t;
      b.addEventListener("click", function () { input.value = t; input.focus(); });
      exBox.appendChild(b);
    });
  }

  /* 供 AI 模块构建上下文：领域 + 场景 + 法条 + 案例 */
  function matchContext(text) {
    text = (text || "").trim();
    var cls = window.CONSULT.classify(text);
    var domain = cls.domain || "labor";
    var tokens = tokenize(text);
    var scenarios = topScenarios(text, domain, 2);
    var laws = topLaws(text, tokens, scenarios, domain, 5);
    var cases = topCases(text, domain, 2);
    return { domain: domain, domainName: window.DOMAINS[domain].name, scenarios: scenarios, laws: laws, cases: cases };
  }

  return { run: run, render: render, init: init, matchContext: matchContext, EVIDENCE_MAP: EVIDENCE };
})();
