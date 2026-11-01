/* =========================================================
 * 领域注册表 registry.js —— 领域配置化的核心
 * 新增法律领域 = 新建一个 js/domains/<id>.js 调用 registerDomain({...})，
 * 无需改动任何业务逻辑（咨询/检索/分析/推荐自动识别新领域）。
 *
 * 字段说明：
 *   id / name / icon / color     领域标识与视觉
 *   keywords[]                   领域自动分类关键词（智能咨询/深度分析用）
 *   laws[]                       法条库：{id,domain,law,lawShort,article,title,tags,text,note}
 *   scenarios[]                  咨询场景：{id,domain,icon,name,keywords,desc,questions,result}
 *   faq[]                        讲堂：{domain,q,a,tags}
 *   cases[]                      典型案例：{domain,title,tags,facts,ruling,lesson}
 *   guiding[]                    指导性案例精读：{no,domain,title,keywords,facts,gist,analysis}
 * ========================================================= */
window.DomainRegistry = (function () {
  var domains = [];   /* 自注册领域（新机制） */
  var LEGACY_STORE = {};  /* 旧数据文件经 shim setter 存入的全局数组 */

  /* 既有数据文件（js/data/*.js）中的三大领域：元数据在此登记，
     内容从其全局数组按 domain 字段过滤派生——保持向后兼容 */
  var LEGACY_META = {
    labor:   { name: "劳动法", icon: "🧑‍🏭", color: "#2563eb", keywords: ["工资","加班","辞退","解雇","开除","裁员","试用期","劳动合同","社保","五险","工伤","年假","年休假","补偿金","赔偿金","竞业限制","离职","入职","调岗","降薪","拖欠","克扣","工时","辞职","单位","员工","老板","上司","转正","医疗期","哺乳期","孕期","劳动仲裁","停工留薪","工龄","最低工资","五险一金","公积金","夜班","值班","考勤","打卡","员工手册","工牌","劳务"] },
    company: { name: "公司法", icon: "🏢", color: "#0d9488", keywords: ["公司","股东","股权","注册资本","认缴","实缴","减资","增资","章程","股东会","董事会","监事","法定代表人","清算","注销","吊销","分红","查账","知情权","决议","转让股权","一人公司","人格否认","连带责任","抽逃出资","出资","董事","高管","董监高","合并","分立","收购","尽调","目标公司","代持","显名","股东代表诉讼","营业期限","营业执照","工商登记","企业信用"] },
    patent:  { name: "专利法", icon: "💡", color: "#9333ea", keywords: ["专利","发明","实用新型","外观设计","权利要求","专利申请","侵权","无效宣告","职务发明","优先权","PCT","知识产权局","专利权","专利号","现有技术","新颖性","创造性","许可费","警告函","FTO","年费","专利代理","技术方案","专利诉讼","国知局","专利检索","署名","专利评价报告","临时保护"] }
  };
  var LEGACY_FIELD = { laws: "LAWS", scenarios: "SCENARIOS", faq: "FAQ", cases: "CASES", guiding: "GUIDING" };

  function registerDomain(meta) {
    if (!meta || !meta.id) throw new Error("领域注册缺少 id");
    for (var i = 0; i < domains.length; i++) {
      if (domains[i].id === meta.id) { domains[i] = meta; return meta; }
    }
    domains.push(meta);
    return meta;
  }

  function get(id) {
    for (var i = 0; i < domains.length; i++) if (domains[i].id === id) return domains[i];
    return null;
  }

  function ids() {
    var out = [];
    Object.keys(LEGACY_META).forEach(function (k) { out.push(k); });
    domains.forEach(function (d) { if (out.indexOf(d.id) === -1) out.push(d.id); });
    return out;
  }

  /* 领域元信息：window.DOMAINS[id] = {id,name,icon,color,short?} */
  function metaOf(id) {
    var d = get(id);
    if (d) return { id: d.id, name: d.name, icon: d.icon, color: d.color, short: d.short || d.name.replace("法", "") };
    if (LEGACY_META[id]) {
      var m = LEGACY_META[id];
      return { id: id, name: m.name, icon: m.icon, color: m.color, short: m.short || m.name.replace("法", "") };
    }
    return { id: id, name: id, icon: "📁", color: "#6b7280" };
  }
  function metas() { return ids().map(metaOf); }

  function collect(field, domainId) {
    var out = [];
    /* 自注册领域 */
    domains.forEach(function (d) {
      if (domainId && d.id !== domainId) return;
      (d[field] || []).forEach(function (x) { out.push(x); });
    });
    /* 旧数据文件经 shim setter 存入的内容（未指定领域时全量并入，条目自带 domain 字段） */
    if (!domainId || LEGACY_META[domainId]) {
      var g = LEGACY_STORE[field] || [];
      g.forEach(function (x) {
        if (domainId && x.domain !== domainId) return;
        out.push(x);
      });
    }
    return out;
  }

  function lawById(id) {
    var all = collect("laws");
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function scenarioById(id) {
    var all = collect("scenarios");
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function allKeywords() {
    var m = {};
    ids().forEach(function (id) {
      var d = get(id);
      if (d && d.keywords) { m[id] = d.keywords; return; }
      m[id] = LEGACY_META[id] && LEGACY_META[id].keywords ? LEGACY_META[id].keywords : [];
    });
    return m;
  }

  /* 增量补充某领域的关键词（分类用），保留原有词表 */
  function extendKeywords(id, extra) {
    if (LEGACY_META[id]) {
      LEGACY_META[id].keywords = (LEGACY_META[id].keywords || []).concat(extra || []);
      return;
    }
    var d = get(id);
    if (d) d.keywords = (d.keywords || []).concat(extra || []);
  }

  return {
    registerDomain: registerDomain,
    get: get, ids: ids, metas: metas, metaOf: metaOf,
    collect: collect, lawById: lawById, scenarioById: scenarioById,
    allKeywords: allKeywords, extendKeywords: extendKeywords,
    __setLegacy: function (field, arr) { LEGACY_STORE[field] = arr || []; }
  };
})();

/* 兼容层：既有代码继续使用 window.LAWS / window.SCENARIOS / window.FAQ /
   window.CASES / window.GUIDING / window.DOMAINS / window.lawById /
   window.scenarioById（惰性求值，总是反映注册表最新内容） */
["laws:LAWS", "scenarios:SCENARIOS", "faq:FAQ", "cases:CASES", "guiding:GUIDING"].forEach(function (pair) {
  var field = pair.split(":")[0], name = pair.split(":")[1];
  Object.defineProperty(window, name, {
    get: function () { return window.DomainRegistry.collect(field); },
    set: function (v) { window.DomainRegistry.__setLegacy(field, v); },
    configurable: true
  });
});
Object.defineProperty(window, "DOMAINS", {
  get: function () {
    var m = {};
    window.DomainRegistry.metas().forEach(function (d) { m[d.id] = d; });
    return m;
  },
  configurable: true
});
window.lawById = function (id) { return window.DomainRegistry.lawById(id); };
window.scenarioById = function (id) { return window.DomainRegistry.scenarioById(id); };
