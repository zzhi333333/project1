/* =========================================================
 * 法律文书模板 templates.js
 * 基于场景问答收集的事实（answers）+ 分析结论（r）生成文书草稿。
 * 未知信息以【】占位，草稿仅供参考，须结合事实修改。
 * ========================================================= */
window.DOCTPL = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var T = [];

  function reg(t) { T.push(t); }

  /* ---------- 通用生成器 ---------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
  }
  function compensationDesc(a, r) {
    if (a.type === "2N") return "违法解除劳动合同赔偿金（按工作年限每满一年二个月工资标准，即 2N）";
    if (a.type === "N+1") return "解除劳动合同经济补偿（N）及未提前三十日书面通知的一个月工资（代通知金）";
    return "解除劳动合同经济补偿金（按工作年限每满一年一个月工资标准，即 N）";
  }

  /* ---------- 劳动仲裁申请书（劳动争议通用） ---------- */
  function genArb(ctx) {
    var a = ctx.answers || {}, r = ctx.result || {};
    var claims = (r.advice && r.advice[0]) ? "1. " + r.headline.replace(/^[^：]*：/, "") + "；" : "";
    return "劳动争议仲裁申请书\n" +
      "\n申请人：【姓名】，男/女，【年月日】出生，身份证号：【】，住址：【】，联系电话：【】。\n" +
      "被申请人：【用人单位全称】，统一社会信用代码：【】，住所地：【】，法定代表人：【】。\n" +
      "\n仲裁请求：\n" +
      "1. 裁决被申请人支付" + (a.type ? compensationDesc(a, r) : "申请人主张的款项") + "人民币【金额】元；\n" +
      "2. 裁决被申请人出具解除/终止劳动合同证明，并办理档案和社会保险关系转移手续；\n" +
      "3. （如有其他请求：未签书面合同二倍工资差额／加班费／未休年假折算等，逐项列明并附金额计算方式）。\n" +
      "\n事实与理由：\n" +
      "申请人于【入职日期】入职被申请人处，担任【岗位】，月工资【金额】元。" +
      (ctx.scenario ? "本次争议情形：" + ctx.scenario.name + "。" : "") +
      "被申请人的上述行为违反了《劳动合同法》等相关规定，损害了申请人的合法权益。依据《劳动争议调解仲裁法》第二条、第二十七条等规定，特提出如上仲裁请求。\n" +
      "\n证据清单：\n" +
      (r.advice || []).map(function (x, i) { return (i + 2) + ". " + x.replace(/^/, "") + "（转化为证据说明）"; }).slice(0, 3).join("\n") +
      "\n\n此致\n【】市/区劳动人事争议仲裁委员会\n\n申请人（签名）：\n" + today() + "\n\n附：1. 仲裁申请书副本按被申请人人数提交；2. 申请人身份证复印件；3. 证据清单及证据材料。";
  }

  /* ---------- 被迫解除劳动合同通知书 ---------- */
  function genForced(ctx) {
    var a = ctx.answers || {};
    var reasons = [];
    if (ctx.scenario && ctx.scenario.id === "labor-wage") reasons.push("未及时足额支付劳动报酬");
    if (ctx.scenario && ctx.scenario.id === "labor-social") reasons.push("未依法为劳动者缴纳社会保险费");
    if (ctx.scenario && ctx.scenario.id === "labor-overtime") reasons.push("安排加班且不支付加班费");
    if (!reasons.length) reasons.push("未按照劳动合同约定提供劳动保护或者劳动条件（或：未及时足额支付劳动报酬／未依法缴纳社会保险费，按实际情形保留）");
    return "被迫解除劳动合同通知书\n\n" +
      "【用人单位全称】：\n\n" +
      "本人【姓名】（身份证号：【】），于【入职日期】入职贵单位，担任【岗位】。因贵单位存在以下情形：" +
      reasons.map(function (x, i) { return (i + 1) + "）" + x; }).join("；") +
      "，已严重违反《劳动合同法》第三十八条之规定，损害本人合法权益。\n\n" +
      "现本人依据《劳动合同法》第三十八条第一款之规定，通知贵单位：自本通知送达之日起，解除双方劳动合同。\n\n" +
      "同时，依据《劳动合同法》第四十六条第（一）项、第四十七条之规定，要求贵单位：\n" +
      "1. 支付经济补偿金（工作年限每满一年一个月工资）；\n" +
      "2. 结清全部工资至解除之日；\n" +
      "3. 依法出具解除劳动合同证明并办理档案和社会保险关系转移手续。\n\n" +
      "如贵单位拒不履行，本人将依法向劳动人事争议仲裁委员会申请仲裁，由此产生的全部法律后果由贵单位承担。\n\n" +
      "通知人（签名）：【姓名】\n" + today() + "\n\n" +
      "※ 送达提示：建议以 EMS 邮寄至单位注册地址（快递单注明\"被迫解除劳动合同通知书\"）并保留底单，同时留存电子副本。";
  }

  /* ---------- 催告函 ---------- */
  function genDemand(ctx) {
    var a = ctx.answers || {};
    var demand = (ctx.scenario && ctx.scenario.id === "labor-wage") ? "支付拖欠的工资人民币【金额】元" :
      (ctx.scenario && ctx.scenario.id === "company-capital") ? "依法履行出资义务，缴足认缴出资" :
      (ctx.scenario && ctx.scenario.id === "company-inspection") ? "依法提供查阅会计账簿、会计凭证" :
      "履行下述义务";
    return "催告函\n\n" +
      "【对方名称/单位全称】：\n\n" +
      "本人/本公司【名称】（【身份证号/统一社会信用代码】），与贵方存在【劳动关系/出资关系/股东关系】。" +
      "现郑重催告贵方于收到本函之日起【7】日内：" + demand + "。" +
      "\n\n事实与理由：\n" + (r_line(ctx)) +
      "\n\n如逾期未履行，本人/本公司将依法采取包括但不限于劳动监察投诉、申请劳动仲裁／提起诉讼、申请财产保全等法律措施，由此产生的一切后果由贵方承担。\n\n" +
      "函告人：【名称/签名】\n" + today() + "\n\n" +
      "※ 送达提示：EMS 邮寄并保留底单（快递单注明文件名称），同时邮件/OA 发送电子副本留痕。";
  }

  /* ---------- 民事起诉状（公司纠纷通用） ---------- */
  function genComplaint(ctx) {
    var a = ctx.answers || {}, r = ctx.result || {};
    return "民事起诉状\n\n" +
      "原告：【姓名/公司名称】，【身份证号/统一社会信用代码】，住所地：【】，联系电话：【】。\n" +
      "被告一：【公司全称】，统一社会信用代码：【】，住所地：【公司住所地】。\n" +
      "被告二：（如追股东个人/其他股东，列明其身份信息）。\n\n" +
      "诉讼请求：\n" +
      "1. " + (r.claims && r.claims[0] ? r.claims[0] + "；" : "判令被告履行【具体义务】；") + "\n" +
      (r.claims || []).slice(1, 4).map(function (c, i) { return (i + 2) + ". " + c + "；"; }).join("\n") +
      "\n3. 本案诉讼费用由被告承担。\n\n" +
      "事实与理由：\n" +
      "原告系被告一【持股比例】%的股东／与被告存在【法律关系】。" +
      (r.headline ? "本案核心问题：" + r.headline + "。" : "") +
      "被告的行为违反了《公司法》及相关法律规定（详见下述法条依据），给原告造成损失。\n" +
      "依据《民事诉讼法》第一百二十二条及《公司法》相关规定，特诉至贵院，请求依法裁判。\n\n" +
      "证据清单：\n" + (r.evidence || []).map(function (x, i) { return (i + 1) + ". " + x; }).join("\n") +
      "\n\n此致\n【公司住所地】人民法院\n\n具状人（签名）：\n" + today();
  }

  /* ---------- 警告函答复函（专利被诉） ---------- */
  function genReply(ctx) {
    return "关于贵方专利侵权警告函的答复函\n\n" +
      "【发函方/其代理机构】：\n\n" +
      "贵方【日期】所发关于专利（专利号：【】）的警告函收悉。经审慎核查，现答复如下：\n\n" +
      "1. 我方产品/方法【未落入】贵方专利权利要求的保护范围：我方采用的技术方案与涉案专利权利要求记载的技术特征存在如下区别：【逐项技术特征对比】。\n" +
      "2. 我方保留对涉案专利提起无效宣告请求的权利：我方已检索到可能影响涉案专利新颖性/创造性的在先公开线索，将依法向国家知识产权局提出无效宣告请求。\n" +
      (r_line(ctx) ? "3. 其他事实与理由：" + r_line(ctx) + "\n" : "") +
      "\n请贵方审慎评估上述事实，在合理期限内撤回警告／停止投诉，否则我方将依法提起确认不侵权之诉，并保留就恶意发函造成的损失（含商誉损害与合理维权开支）追究法律责任的权利。\n\n" +
      "此复\n\n【公司名称】\n" + today() + "\n\n※ 提示：发出本函前建议先固定己方在先使用/现有技术证据，并委托专利代理师做正式比对分析。";
  }

  function r_line(ctx) {
    return ctx.result && ctx.result.summary ? "经初步分析：" + ctx.result.summary : "";
  }

  /* 场景 → 可用文书 */
  reg({ id: "arb-labor", name: "劳动仲裁申请书", scenarios: ["labor-dismiss", "labor-wage", "labor-no-contract", "labor-overtime", "labor-probation", "labor-noncompete", "labor-leave", "labor-transfer", "labor-injury", "labor-social"], gen: genArb });
  reg({ id: "forced-resign", name: "被迫解除劳动合同通知书", scenarios: ["labor-dismiss", "labor-wage", "labor-social", "labor-overtime", "labor-transfer"], gen: genForced });
  reg({ id: "demand-letter", name: "催告函（书面主张权利）", scenarios: ["labor-wage", "labor-no-contract", "labor-transfer", "labor-leave", "company-capital", "company-inspection", "company-transfer"], gen: genDemand });
  reg({ id: "complaint-company", name: "民事起诉状（公司纠纷）", scenarios: ["company-capital", "company-transfer", "company-inspection", "company-resolution", "company-minority", "company-mixing", "company-liquidation"], gen: genComplaint });
  reg({ id: "reply-letter", name: "答复函（专利警告应对）", scenarios: ["patent-accused", "patent-infringed"], gen: genReply });

  function forScenario(sid) {
    var out = T.filter(function (t) { return t.scenarios.indexOf(sid) > -1; });
    /* 兜底：至少给一份通用仲裁申请书/起诉状 */
    if (!out.length) out = T.filter(function (t) { return t.id === "arb-labor" || t.id === "complaint-company"; });
    return out;
  }

  return { forScenario: forScenario, esc: esc };
})();
