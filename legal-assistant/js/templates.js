/* =========================================================
 * 法律文书模板 templates.js
 * 基于场景问答收集的事实（answers）+ 分析结论（r）生成文书草稿。
 * 未知信息以【】占位，草稿仅供参考，须结合事实修改。
 * ========================================================= */
window.DOCTPL = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
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

  /* ---------- 民事起诉状（民法领域通用） ---------- */
  function genComplaintGeneral(ctx) {
    var a = ctx.answers || {}, r = ctx.result || {};
    var claimsFirst = r.headline ? r.headline.replace(/^[^：]*：/, "") : "判令被告【履行具体义务：返还借款／赔偿损失／停止侵害等】";
    return "民事起诉状\n\n" +
      "原告：【姓名】，【性别】，【年月日】出生，【民族】，住址：【】，身份证号：【】，联系电话：【】。\n" +
      "被告：【姓名/单位全称】，【身份证号/统一社会信用代码】，住址/住所地：【】，联系电话：【】。\n\n" +
      "诉讼请求：\n" +
      "1. 判令被告" + claimsFirst + "；\n" +
      "2. 判令被告支付【资金占用利息／赔偿金：自 × 年 × 月 × 日起按 × 标准计算至实际清偿之日】；\n" +
      "3. 本案诉讼费用由被告承担。\n\n" +
      "事实与理由：\n" +
      "【按时间线简述：双方关系 → 关键事件 → 损失/损害后果 → 协商经过】。\n" +
      (r.summary ? "经初步梳理：" + r.summary + "\n" : "") +
      "原告认为，被告的行为违反《民法典》相关规定（主要依据见所附法条清单），依法应承担【继续履行／损害赔偿／停止侵害】等民事责任。依据《民事诉讼法》第一百二十二条关于起诉条件的规定，特诉至贵院。\n\n" +
      "证据清单：\n" +
      "1.【合同／借条／聊天记录／转账凭证等权利义务证据】；\n" +
      "2.【损失及金额证据：票据、评估、医疗记录等】；\n" +
      "3.【催告与协商记录】。\n\n" +
      "此致\n【被告住所地／经常居住地】人民法院\n\n具状人（签名）：\n" + today() + "\n\n" +
      "※ 管辖提示：一般由被告住所地人民法院管辖；合同纠纷可由合同履行地管辖；不动产物权纠纷专属管辖。立案时提交起诉状副本按被告人数 +1 份、原告身份材料与证据复印件。";
  }

  /* ---------- 财产保全申请书 ---------- */
  function genPreserve(ctx) {
    var r = ctx.result || {};
    return "财产保全申请书\n\n" +
      "申请人：【姓名/单位】，【身份证号/统一社会信用代码】，住址：【】，联系电话：【】。\n" +
      "被申请人：【姓名/单位】，【身份证号/统一社会信用代码】，住址/住所地：【】。\n\n" +
      "请求事项：\n" +
      "1. 请求查封、扣押、冻结被申请人名下财产，价值以人民币【金额】元为限，包括：【银行账户（开户行及账号）／不动产（坐落及产权证号）／车辆（车牌号）／股权等财产线索】；\n" +
      "2. 本案保全费用由被申请人承担。\n\n" +
      "事实与理由：\n" +
      "申请人与被申请人因【案由：民间借贷／买卖合同等】发生争议" +
      (r.summary ? "（" + r.summary + "）" : "") +
      "，申请人已／将向贵院提起诉讼（案号：【】）。被申请人目前有【转移财产／抽逃资金／隐匿财产】之虞，若不及时采取保全措施，将导致判决难以执行或造成申请人其他损害。\n\n" +
      "担保情况：申请人愿意提供【自有财产担保／保险公司诉讼保全责任保险保函】作为担保；如贵院责令提供担保，申请人将按要求及时提供。\n\n" +
      "依据《民事诉讼法》关于财产保全的规定，恳请贵院依法裁定并采取保全措施。\n\n" +
      "此致\n【】人民法院\n\n申请人（签名）：\n" + today() + "\n\n" +
      "※ 提示：①诉中保全由法院责令提供担保时可提供保函；②如为诉前保全，须提供担保，且法院采取措施后 30 日内不依法提起诉讼／申请仲裁的，保全措施解除。";
  }

  /* ---------- 强制执行申请书 ---------- */
  function genEnforce(ctx) {
    return "强制执行申请书\n\n" +
      "申请执行人：【姓名/单位】，【身份证号/统一社会信用代码】，住址：【】，联系电话：【】。\n" +
      "被执行人：【姓名/单位】，【身份证号/统一社会信用代码】，住址/住所地：【】。\n\n" +
      "执行依据：【生效民事判决书／调解书／仲裁裁决书／公证债权文书】，文书编号：【】，生效日期：【】。\n\n" +
      "执行请求：\n" +
      "1. 强制被执行人履行生效法律文书确定的义务，给付人民币【本金】元；\n" +
      "2. 支付迟延履行期间加倍债务利息（自履行期届满之日起算）；\n" +
      "3. 执行费用由被执行人承担。\n\n" +
      "事实与理由：\n" +
      "上述法律文书已发生法律效力，被执行人未在履行期限内履行义务。被执行人可供执行财产线索：【银行账户／房产／车辆／工资收入等】。为维护申请人合法权益，依据《民事诉讼法》关于执行程序的规定，申请强制执行。\n\n" +
      "此致\n【一审法院或被执行财产所在地】人民法院\n\n申请执行人（签名）：\n" + today() + "\n\n" +
      "※ 提示：①申请执行期间为二年（自履行期限最后一日起算，适用时效中止/中断）；②提交生效法律文书副本、身份材料、财产线索清单；③【金额/利息标准以生效文书与官方最新规定为准】。";
  }

  /* ---------- 民事答辩状 ---------- */
  function genDefense(ctx) {
    var r = ctx.result || {};
    return "民事答辩状\n\n" +
      "答辩人（本案被告）：【姓名/单位】，【身份证号/统一社会信用代码】，住址/住所地：【】，联系电话：【】。\n" +
      "被答辩人（本案原告）：【姓名/单位】，【身份证号/统一社会信用代码】，住址/住所地：【】。\n\n" +
      "答辩人因【原告姓名/单位】诉答辩人【案由】一案（案号：【】），现提出答辩如下：\n\n" +
      "一、程序方面：\n" +
      "【可选：本案管辖有误，被告住所地/经常居住地不在贵院辖区，依法提出管辖权异议；或：原告主体不适格／被告与本案无直接利害关系等。】\n\n" +
      "二、实体方面：\n" +
      "1. 对原告所述事实的意见：【逐项否认/承认部分事实，指出原告陈述不实之处】；\n" +
      "2. 对原告各项诉讼请求的意见：【逐项反驳：请求缺乏事实依据／已履行完毕／已过诉讼时效（三年，自知道或应当知道权利受损起算）／金额计算无据】；\n" +
      (r.summary ? "3. 答辩要点：" + r.summary + "\n" : "") +
      "\n证据：\n" +
      "1.【反驳原告主张的证据：付款凭证／聊天记录／验收记录等】；\n" +
      "2.【支持己方主张的其他证据】。\n\n" +
      "综上，原告的诉讼请求缺乏事实与法律依据，恳请贵院依法驳回原告全部诉讼请求。\n\n" +
      "此致\n【】人民法院\n\n答辩人（签名）：\n" + today() + "\n\n" +
      "※ 提示：答辩期为期 15 日（自收到起诉状副本之日起）；答辩期内可提出管辖权异议；逾期不答辩不影响审理，故即便不提交书面答辩状也应做好应诉准备。";
  }

  /* ---------- 人身安全保护令申请书 ---------- */
  function genProtectionOrder(ctx) {
    var r = ctx.result || {};
    return "人身安全保护令申请书\n\n" +
      "申请人：【姓名】，【性别】，【年月日】出生，住址：【】，联系电话：【】。\n" +
      "被申请人：【姓名】，与申请人关系：【配偶／同居关系／家庭成员等】。\n\n" +
      "请求事项：\n" +
      "1. 禁止被申请人对申请人实施家庭暴力；\n" +
      "2. 禁止被申请人骚扰、跟踪、接触申请人及其相关近亲属；\n" +
      "3.（可选）责令被申请人迁出申请人住所；\n" +
      "4.（可选）禁止被申请人在申请人住所、工作单位等经常出入场所的一定范围内活动。\n\n" +
      "事实与理由：\n" +
      "【按时间线写明家暴行为：时间、地点、方式、伤情、报警情况】。\n" +
      (r.summary ? "经初步分析：" + r.summary + "\n" : "") +
      "申请人面临家庭暴力现实危险，符合发出人身安全保护令的法定条件。\n\n" +
      "证据清单：\n" +
      "1.【报警回执／出警记录／告诫书】；\n" +
      "2.【伤情照片／医院诊断证明／伤情鉴定意见】；\n" +
      "3.【施暴方保证书／悔过书／威胁性聊天记录、录音】；\n" +
      "4.【证人证言】。\n\n" +
      "依据《反家庭暴力法》第二十三条至第二十七条之规定，恳请贵院依法作出人身安全保护令。\n\n" +
      "此致\n【申请人或被申请人居住地／家庭暴力发生地】基层人民法院\n\n申请人（签名）：\n" + today() + "\n\n" +
      "※ 提示：①保护令可单独申请，不以提起离婚诉讼为前提；②书面申请确有困难的可口头申请；③法院一般 72 小时内作出裁定，紧急情况下 24 小时内；④保护令有效期不超过 6 个月，到期前可申请延长；⑤违反保护令的可罚款、拘留，构成犯罪的追究刑事责任；⑥遭遇正在发生的暴力请立即拨打 110。";
  }

  /* ---------- 侵权投诉／警告函（商标与著作权） ---------- */
  function genIpComplaint(ctx) {
    var a = ctx.answers || {}, r = ctx.result || {};
    var isBq = ctx.scenario && ctx.scenario.id === "bq-shangbiao";
    var rightDesc = isBq
      ? "贵方在【平台/店铺】销售的【商品】上使用与申请人注册商标相同/近似的标识。申请人对【商标名称】享有注册商标专用权（商标注册证号：【】，核定使用商品/服务类别：第【】类，专用权期限：【】）。"
      : "贵方未经许可，在【平台/渠道】传播/销售/使用申请人享有著作权的作品【作品名称】（创作完成日期：【】，登记证书号：【】）。";
    return "侵权投诉／警告函\n\n" +
      "【被投诉人/店铺名称/平台运营方】：\n\n" +
      "申请人系【权利人名称】。经查，" + rightDesc + "\n\n" +
      (isBq
        ? "上述行为属于《商标法》第五十七条所列侵犯注册商标专用权的行为。\n"
        : "上述行为侵犯申请人的【署名权/复制权/信息网络传播权/获得报酬权】等著作权，违反《著作权法》相关规定。\n") +
      (r.summary ? "经初步分析：" + r.summary + "\n" : "") +
      "\n现要求贵方：\n" +
      "1. 立即停止侵权行为：【下架侵权商品／删除侵权链接／停止使用侵权标识】；\n" +
      "2. 于收到本函之日起【7】日内书面回复处理结果；\n" +
      "3. 就已造成的损失，申请人保留要求赔偿（含合理维权开支）的权利。\n\n" +
      "如平台方收到本函：依据《民法典》第一千一百九十五条（通知—删除规则）及《电子商务法》相关规定，请及时对侵权链接采取删除、屏蔽、断开链接等必要措施，并将本函转送相关经营者。\n\n" +
      "申请人保留通过行政投诉（市场监督管理部门／版权部门）、民事诉讼、惩罚性赔偿主张等途径进一步维权的权利。\n\n" +
      "投诉人（签名/盖章）：\n" + today() + "\n\n" +
      "※ 提示：①发函前固定权属证据（商标注册证/作品登记证书/创作底稿、发表记录）与侵权证据（截图、录屏、公证或时间戳存证）；②平台投诉通常需附权属证明与侵权比对说明；③惩罚性赔偿以「故意 + 情节严重」为前提。";
  }

  function r_line(ctx) {
    return ctx.result && ctx.result.summary ? "经初步分析：" + ctx.result.summary : "";
  }

  /* 劳动仲裁答辩书（被申请人视角，v3.2） */
  function genArbDefense(ctx) {
    return "劳动仲裁答辩书\n\n答辩人（被申请人）：【单位名称】，统一社会信用代码：【】，住所地：【】，联系电话：【】。\n申请人：【姓名】，就其与本答辩人劳动争议仲裁一案（案号：【】），现提出答辩如下：\n\n" +
      "一、事实经过\n【简述用工事实：入职时间、岗位、合同签订与履行情况；解除或争议发生的经过与原因】\n\n" +
      "二、答辩意见（对照申请人请求逐项）\n" +
      "1. 关于【请求一，如违法解除赔偿金】：解除具有事实与制度依据——【法定情形＋制度依据＋程序履行（工会通知/公示签收）】，不存在违法解除情形；\n" +
      "2. 关于【请求二，如加班费】：单位实行加班审批制，申请人主张的加班未经审批/与考勤记录不符，且工资中已包含相应部分；\n" +
      "3. 关于【其他请求】：逐项反驳事实与法律依据。\n\n" +
      "三、证据清单\n1.【规章制度及公示签收记录】——证明处理依据合法有效；\n2.【考勤/工资支付凭证】——证明工资已足额支付；\n3.【其他】。\n\n" +
      "综上，申请人的仲裁请求缺乏事实与法律依据，请求仲裁委依法驳回其全部仲裁请求。\n\n" +
      "此致\n【】劳动人事争议仲裁委员会\n\n答辩人（盖章）：\n" + today() + "\n\n" +
      "※ 提示：答辩期 10 日；对管辖有异议的应在答辩期内提出；举证责任（如解除合法性、工资支付）在单位，务必在答辩同时提交全部证据；本模板为结构参考，建议由律师结合证据定制。";
  }

  /* 劳动争议/民事和解协议书（v3.2，谈判工具配套） */
  function genSettlement(ctx) {
    var partyA = "甲方（劳动者/债权人）：【姓名】，身份证号：【】";
    var partyB = "乙方（用人单位/债务人）：【名称】，统一社会信用代码：【】";
    return "和解协议书\n\n" + partyA + "\n" + partyB + "\n\n" +
      "双方就【争议事由，如劳动争议/借款纠纷】（仲裁/诉讼案号：【如有】）达成如下和解协议：\n\n" +
      "一、乙方于【年月日】前向甲方一次性支付人民币【】元（大写：【】），该款项包括但不限于【工资/经济补偿/赔偿金/本金利息】等全部款项；付款方式：【银行转账，收款账户：】。\n" +
      "二、上述款项付清后，双方就本次争议一次性了结，甲方放弃就同一事实向乙方主张其他任何权利（含撤回仲裁/诉讼申请）。\n" +
      "三、甲方应于收到全部款项后【3】个工作日内，向仲裁委/法院提交撤回申请（如有）。\n" +
      "四、双方对本协议内容互负保密义务。\n" +
      "五、任何一方违反本协议的，守约方有权就未履行部分继续依法主张权利，并要求违约方承担维权合理费用。\n" +
      "六、本协议一式两份，自双方签字（盖章）之日起生效。\n\n" +
      "甲方（签字并按手印）：　　　　乙方（盖章、法定代表人签字）：\n" + today() + "　　" + today() + "\n\n" +
      "※ 提示：①「一次性了结/放弃其他请求」条款影响重大，签署前建议由律师审查；②乙方为公司时务必加盖公章；③建议约定迟延付款的加速条款（未按期支付则和解作废、按原请求主张）。";
  }

  /* ---------- 庭前文书（v3.5.1 批次 F）：由 51 场景争点/抗辩结构化数据生成，全模板化不预测 ---------- */
  function insightOf(ctx) {
    var sid = ctx.scenario && ctx.scenario.id;
    return (window.INSIGHTS && sid) ? window.INSIGHTS.get(sid) : null;
  }
  function genCritique(ctx) {
    var ins = insightOf(ctx);
    var lines = [
      "质证意见（草稿）\n",
      "案件情形：" + (ctx.scenario ? ctx.scenario.name : "【案情简述】") + "\n",
      "一、对方可能提交的证据与我方质证要点（结合实际证据逐项核对取舍）："
    ];
    var ds = ins && ins.defenses ? ins.defenses : [];
    if (ds.length) {
      ds.forEach(function (d, i) {
        lines.push((i + 1) + ". 针对对方主张「" + d.d + "」：");
        lines.push("   （1）真实性：【要求出示原件/原始载体，核验签名盖章——按证据填写】；");
        lines.push("   （2）合法性：【审查取证方式，是否侵害他人合法权益——按证据填写】；");
        lines.push("   （3）关联性：【与本案争点的对应关系——按证据填写】；");
        lines.push("   （4）质疑方向：" + d.counter + "；");
        lines.push("   （5）我方反驳证据（自检）：" + (d.ev || "【补充】") + "。");
      });
    } else {
      lines.push("【尚未录入对方证据清单——对对方提交的每份证据，逐项从真实性/合法性/关联性三性陈述质证意见】");
    }
    lines.push("", "二、质证总体意见：【部分证据认可、部分不予认可——逐项说明依据】。", "",
      "※ 注：本草稿由獬小豸按争议模板生成，质疑方向为程序性检查要点，不构成对证据的评判或法律意见；请结合实际证据修改并请执业律师复核。");
    return lines.join("\n");
  }
  function genOutline(ctx) {
    var ins = insightOf(ctx);
    var lines = [
      "庭审提纲（草稿）\n",
      "案件情形：" + (ctx.scenario ? ctx.scenario.name : "【案情简述】") + "\n",
      "一、陈述要点（按时间线简要陈述己方事实与依据）："
    ];
    var iss = ins && ins.issues ? ins.issues : [];
    if (iss.length) {
      iss.forEach(function (q, i) { lines.push((i + 1) + ". " + q.q + "\n   要点：" + (q.concl || "【补充】")); });
    } else {
      lines.push("【逐项陈述案件时间线、当事人、诉求与依据——补充】");
    }
    lines.push("", "二、发问清单（程序性句式模板，按庭审进度取舍）：");
    var ds = ins && ins.defenses ? ins.defenses : [];
    if (ds.length) {
      ds.forEach(function (d, i) { lines.push((i + 1) + ". 对方主张「" + d.d + "」——请对方说明：该主张依据何种证据，以及如何回应我方质疑（【" + (d.counter || "补充") + "】）。"); });
    } else {
      lines.push("【就关键事实逐项列明程序性发问——补充】");
    }
    lines.push("", "三、庭前自检：证据原件与编页复印件 □｜身份材料 □｜诉求计算依据 □｜时效与期限说明 □。", "",
      "※ 注：本提纲由獬小豸按争议模板生成，发问清单为程序性提示句式，不预测庭审结果、不构成法律意见；请结合实际案情修改并请执业律师复核。");
    return lines.join("\n");
  }
  var ALL_SCEN = (window.INSIGHTS && window.INSIGHTS.SCEN) ? Object.keys(window.INSIGHTS.SCEN) : [];
  reg({ id: "court-critique", name: "质证意见（草稿）", scenarios: ALL_SCEN, gen: genCritique });
  reg({ id: "court-outline", name: "庭审提纲（草稿）", scenarios: ALL_SCEN, gen: genOutline });

  /* 场景 → 可用文书 */
  reg({ id: "arb-labor", name: "劳动仲裁申请书", scenarios: ["labor-dismiss", "labor-wage", "labor-no-contract", "labor-overtime", "labor-probation", "labor-noncompete", "labor-leave", "labor-transfer", "labor-injury", "labor-social"], gen: genArb });
  reg({ id: "forced-resign", name: "被迫解除劳动合同通知书", scenarios: ["labor-dismiss", "labor-wage", "labor-social", "labor-overtime", "labor-transfer"], gen: genForced });
  reg({ id: "demand-letter", name: "催告函（书面主张权利）", scenarios: ["labor-wage", "labor-no-contract", "labor-transfer", "labor-leave", "company-capital", "company-inspection", "company-transfer"], gen: genDemand });
  reg({ id: "complaint-company", name: "民事起诉状（公司纠纷）", scenarios: ["company-capital", "company-transfer", "company-inspection", "company-resolution", "company-minority", "company-mixing", "company-liquidation"], gen: genComplaint });
  reg({ id: "reply-letter", name: "答复函（专利警告应对）", scenarios: ["patent-accused", "patent-infringed"], gen: genReply });
  reg({ id: "complaint-general", name: "民事起诉状（通用）", scenarios: ["mf-divorce", "mf-inherit", "mf-loan", "mf-contract", "mf-tort", "mf-privacy", "mss-sue"], gen: genComplaintGeneral });
  reg({ id: "preserve", name: "财产保全申请书", scenarios: ["mss-baoquan", "mf-loan"], gen: genPreserve });
  reg({ id: "enforce", name: "强制执行申请书", scenarios: ["mss-execute"], gen: genEnforce });
  reg({ id: "defense", name: "民事答辩状", scenarios: ["mss-respond"], gen: genDefense });
  reg({ id: "protection-order", name: "人身安全保护令申请书", scenarios: ["js-protection"], gen: genProtectionOrder });
  reg({ id: "ip-complaint", name: "侵权投诉／警告函（商标与著作权）", scenarios: ["bq-weiquan", "bq-shangbiao"], gen: genIpComplaint });
  reg({ id: "arb-defense", name: "劳动仲裁答辩书（被申请人视角）", scenarios: ["labor-dismiss", "labor-wage", "labor-no-contract", "labor-overtime", "labor-leave", "labor-social"], gen: genArbDefense });
  reg({ id: "settlement-labor", name: "劳动争议和解协议书", scenarios: ["labor-dismiss", "labor-wage", "labor-no-contract", "labor-overtime", "labor-leave", "labor-transfer", "labor-injury"], gen: genSettlement });
  reg({ id: "settlement-civil", name: "和解协议书（通用民事）", scenarios: ["mf-loan", "mf-contract", "mf-tort", "zl-deposit", "zl-early-leave", "zl-rent-owe", "zl-repair"], gen: genSettlement });

  function forScenario(sid) {
    var out = T.filter(function (t) { return t.scenarios.indexOf(sid) > -1; });
    /* 兜底：至少给一份通用仲裁申请书/起诉状 */
    if (!out.length) out = T.filter(function (t) { return t.id === "arb-labor" || t.id === "complaint-company"; });
    /* 技能模板：启用技能的自定义文书始终追加在列表末尾 */
    if (window.SKILLS && window.SKILLS.templatesFor) {
      window.SKILLS.templatesFor().forEach(function (t) { if (out.indexOf(t) === -1) out.push(t); });
    }
    return out;
  }

  return { forScenario: forScenario, esc: esc };
})();
