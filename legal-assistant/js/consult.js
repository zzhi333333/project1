/* =========================================================
 * 咨询引擎 consult.js
 * 输入自然语言 → 领域分类 → 场景匹配 → 澄清问答 → 结构化意见
 * ========================================================= */
(function () {
  var state = { scenario: null, answers: {}, qIndex: 0, active: false };

  /* ---------- 领域分类：关键词加权投票（关键词来自领域注册表） ---------- */
  function classifyDomain(text) {
    var KW = window.DomainRegistry.allKeywords();
    var scores = {};
    Object.keys(KW).forEach(function (d) { scores[d] = 0; });
    Object.keys(KW).forEach(function (d) {
      KW[d].forEach(function (kw) {
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
    return list.filter(function (x) { return x.score >= 1.5; }).map(function (x) { return x.s; });
  }

  /* ---------- 身份/问候意图识别（非 AI 模式的社交应答）：只处理「问名字/问身份」窄场景，不做通用闲聊 ----------
   * 不进 DomainRegistry 关键词表——关键词参与领域加权投票，塞「名字」会污染法律领域分数
   * （「公司名字能随便起吗」会被误判成身份询问）。前置拦截 + 直接 return 是唯一干净做法。 */
  function isIdentityQuestion(t) {
    var s = (t || "").replace(/[\s，。？！、,.?!~]/g, "");
    if (/你(是谁|叫什么|叫啥|是哪位)|您(是谁|叫什么|叫啥|是哪位)/.test(s)) return true;
    /* 「你的名字」单独短句才算身份询问——法律语境（「公司让你的名字出现在合同里」）会被整句误吃 */
    if (s.length <= 12 && /你(的)?名字|您(的)?名字/.test(s)) return true;
    if (/介绍一下(你|您)自己|自我介绍/.test(s)) return true;
    if (/你是(什么|啥)(AI|ai|机器人|助手|程序|软件|模型)/.test(s)) return true;
    if (/你是(AI|ai|机器人|真人|人类|模型|ChatGPT|chatgpt|GPT|gpt)/.test(s)) return true;
    return false;
  }

  /* ---------- 对外接口 ---------- */
  function startConsult(text) {
    text = (text || "").trim();
    if (!text) return;
    UI.appendUser(text);
    /* 身份意图前置拦截（非 AI 模式也能自报「獬小豸」） */
    if (isIdentityQuestion(text)) {
      UI.appendBot(
        "我是<b>獬小豸</b>，您的法律咨询助手。<br>" +
        "我可以帮您梳理劳动争议、公司法、专利等法律问题，给出分析 + 法条 + 行动建议。<br>" +
        "请描述您遇到的情况，从左侧「快捷咨询」的场景开始也可以。",
        null
      );
      return;
    }
    var cls = classifyDomain(text);
    var matches = matchScenarios(text, cls.domain);

    if (!matches.length) {
      var lines = ["我暂时没能准确判断您的问题类型。我目前擅长以下领域："];
      window.DomainRegistry.metas().forEach(function (d) {
        lines.push(window.DomainRegistry.iconSvg(d.id) + " <b>" + d.name + "</b>——请点击左侧「快捷咨询」查看该领域的具体场景。");
      });
      lines.push("也可以使用右上角「搜索」查找法条与内容，或到「深度分析」页获得完整报告。");
      UI.appendBot(lines.join("<br>"), null);
      if (cls.domain) {
        UI.appendBot("不过从您的描述看，可能与<b>" + window.DOMAINS[cls.domain].name + "</b>相关，您可以直接点击左侧「快捷咨询」中的场景开始：", null);
      }
      return;
    }
    beginScenario(matches[0], cls);
  }

  function beginScenario(sc, cls) {
    state = { scenario: sc, answers: {}, qIndex: 0, active: true, transcript: [] };
    var d = window.DOMAINS[sc.domain];
    UI.appendBot(
      "已识别问题：<b>" + window.DomainRegistry.iconSvg(sc.domain) + " " + sc.name + "</b>（" + d.name + "领域）<br>" +
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
          state.transcript.push({ q: q.text, a: label });   /* 问答实录：供深度核验页还原案情 */
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
    UI.appendResult(state.scenario, r, state.answers, state.transcript);
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
