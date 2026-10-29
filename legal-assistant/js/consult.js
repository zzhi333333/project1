/* =========================================================
 * 咨询引擎 consult.js
 * 输入自然语言 → 领域分类 → 场景匹配 → 澄清问答 → 结构化意见
 * ========================================================= */
(function () {
  var state = { scenario: null, answers: {}, qIndex: 0, active: false };

  /* ---------- 领域分类：关键词加权投票 ---------- */
  var DOMAIN_KEYWORDS = {
    labor: ["工资","加班","辞退","解雇","开除","裁员","试用期","劳动合同","社保","五险","工伤","年假","年休假","补偿金","赔偿金","竞业限制","离职","入职","调岗","降薪","拖欠","克扣","工时","辞职","单位","员工","老板","上司","入职","转正","医疗期","哺乳期","孕期","劳动仲裁","停工留薪","工龄","最低工资","五险一金","公积金","夜班","值班","考勤","打卡","员工手册","工牌","劳务"],
    company: ["公司","股东","股权","注册资本","认缴","实缴","减资","增资","章程","股东会","董事会","监事","法定代表人","清算","注销","吊销","分红","查账","知情权","决议","转让股权","一人公司","人格否认","连带责任","抽逃出资","出资","董事","高管","董监高","合并","分立","收购","尽调","目标公司","代持","显名","股东代表诉讼","营业期限","营业执照","工商登记","企业信用"],
    patent: ["专利","发明","实用新型","外观设计","权利要求","专利申请","侵权","无效宣告","职务发明","优先权","PCT","知识产权局","专利权","专利号","现有技术","新颖性","创造性","许可费","警告函","FTO","年费","专利代理","技术方案","专利诉讼","国知局","专利检索","署名","专利评价报告","临时保护"]
  };

  function classifyDomain(text) {
    var scores = { labor: 0, company: 0, patent: 0 };
    Object.keys(DOMAIN_KEYWORDS).forEach(function (d) {
      DOMAIN_KEYWORDS[d].forEach(function (kw) {
        if (text.indexOf(kw) > -1) scores[d] += kw.length >= 3 ? 2 : 1;
      });
    });
    var best = null, max = 0, second = 0;
    Object.keys(scores).forEach(function (d) {
      if (scores[d] > max) { second = max; max = scores[d]; best = d; }
      else if (scores[d] > second) { second = scores[d]; }
    });
    return { domain: best, confidence: max === 0 ? 0 : (max - second) / max, scores: scores };
  }

  /* ---------- 场景匹配：命中关键词计分 ---------- */
  function matchScenarios(text, domain) {
    var list = window.SCENARIOS.map(function (s) {
      var score = 0;
      s.keywords.forEach(function (kw) {
        if (text.indexOf(kw) > -1) score += kw.length; // 越长越具体分越高
      });
      if (domain && s.domain === domain) score += 1.5;
      return { s: s, score: score };
    });
    list.sort(function (a, b) { return b.score - a.score; });
    return list.filter(function (x) { return x.score > 1.5; }).map(function (x) { return x.s; });
  }

  /* ---------- 对外接口 ---------- */
  function startConsult(text) {
    text = (text || "").trim();
    if (!text) return;
    UI.appendUser(text);
    var cls = classifyDomain(text);
    var matches = matchScenarios(text, cls.domain);

    if (!matches.length) {
      UI.appendBot([
        "我暂时没能准确判断您的问题类型。我目前擅长以下三个领域：",
        "🧑‍🏭 <b>劳动法</b>——辞退补偿、加班费、社保、工伤、试用期、竞业限制等；",
        "🏢 <b>公司法</b>——注册资本实缴、股权转让、股东查账、决议瑕疵、清算注销等；",
        "💡 <b>专利法</b>——专利申请、被侵权维权、被诉应对、无效宣告、职务发明等。"
      ].join("<br>"), null);
      if (cls.domain) {
        UI.appendBot("不过从您的描述看，可能与<b>" + window.DOMAINS[cls.domain].name + "</b>相关，您可以直接点击左侧「快捷咨询」中的场景开始：", null);
      }
      return;
    }
    beginScenario(matches[0], cls);
  }

  function beginScenario(sc, cls) {
    state = { scenario: sc, answers: {}, qIndex: 0, active: true };
    var d = window.DOMAINS[sc.domain];
    UI.appendBot(
      "已识别问题：<b>" + sc.icon + " " + sc.name + "</b>（" + d.name + "领域）<br>" +
      "下面通过几个问题快速核实关键事实，请选择最接近的选项：", null);
    askNext();
  }

  function askNext() {
    var qs = state.scenario.questions;
    while (state.qIndex < qs.length) {
      var q = qs[state.qIndex];
      var visible = !q.showIf || q.showIf(state.answers);
      if (visible) {
        UI.appendQuestion(q.text, q.options, function (val, label) {
          state.answers[q.id] = val;
          state.qIndex++;
          UI.appendUser(label);
          askNext();
        });
        return;
      }
      state.qIndex++;
    }
    finish();
  }

  function finish() {
    state.active = false;
    var r;
    try {
      r = state.scenario.result(state.answers);
    } catch (e) {
      UI.appendBot("抱歉，分析过程出现了一点问题，请换个说法重新描述。", null);
      return;
    }
    UI.appendResult(state.scenario, r);
  }

  /* 快捷入口（点击场景卡片直接开始） */
  function quickStart(scenarioId) {
    var sc = window.scenarioById(scenarioId);
    if (!sc) return;
    UI.appendUser("我想咨询：" + sc.name);
    beginScenario(sc, null);
  }

  window.CONSULT = { start: startConsult, quickStart: quickStart, state: state, classify: classifyDomain };
})();
