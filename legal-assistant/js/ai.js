/* =========================================================
 * AI 模型接入 ai.js
 * —— 用户可选服务商（智谱/DeepSeek/Kimi/通义/百度千帆/OpenAI/Ollama/自定义），
 *    OpenAI 兼容协议；密钥仅存本机 localStorage；
 *    优先经本地代理 /api/ai/chat 转发（解决跨域），不可用时尝试直连。
 * —— 三个集成点：
 *    ①智能咨询「AI 对话」开关：自由提问由 AI 结合法条/案例上下文流式回答
 *    ②咨询结果卡「AI 深度解读」：对规则引擎结论做个性化展开
 *    ③案情分析「AI 深度分析」：结合报告上下文生成深度意见
 * ========================================================= */
window.AI = (function () {

  /* ---------------- 服务商预设 ---------------- */
  var PROVIDERS = {
    glm:      { name: "智谱 GLM（含免费模型）", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    deepseek: { name: "DeepSeek 深度求索", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    kimi:     { name: "月之暗面 Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
    qwen:     { name: "阿里通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
    qianfan:  { name: "百度千帆（通用 OpenAI 兼容 v2）", baseUrl: "https://qianfan.baidubce.com/v2", model: "ernie-4.5-turbo-128k" },
    qianfanTP:{ name: "百度千帆 Token计划个人版", baseUrl: "https://qianfan.baidubce.com/v2/tokenplan/personal", model: "glm-5.3-flash" },
    openai:   { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    ollama:   { name: "本地 Ollama（无需密钥）", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
    custom:   { name: "自定义（OpenAI 兼容接口）", baseUrl: "", model: "" }
  };

  var DEFAULTS = { provider: "glm", baseUrl: PROVIDERS.glm.baseUrl, model: PROVIDERS.glm.model, apiKey: "", temperature: 0.5, lang: "auto" };
  var S = load();
  var aiHistory = [];          /* 多轮对话记忆（最近若干轮） */
  var _proxyBase = null;       /* null=未探测, false=不可用, ""=同源, "http://127.0.0.1:8080" */

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("legal-ai") || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save() { localStorage.setItem("legal-ai", JSON.stringify(S)); }

  /* ---------------- 本地代理探测 ---------------- */
  function detectProxy() {
    if (_proxyBase !== null) return Promise.resolve(_proxyBase);
    var candidates = ["", "http://127.0.0.1:8080"];
    return candidates.reduce(function (chain, b) {
      return chain.then(function (hit) {
        if (hit !== null) return hit;
        var ctrl = new AbortController();
        var t = setTimeout(function () { ctrl.abort(); }, 2000);
        return fetch(b + "/api/ping", { signal: ctrl.signal })
          .then(function (r) { return r.ok ? b : null; })
          .catch(function () { return null; })
          .then(function (x) { clearTimeout(t); return x; });
      });
    }, Promise.resolve(null)).then(function (hit) {
      _proxyBase = (hit === null || hit === undefined) ? false : hit;
      return _proxyBase;
    });
  }

  /* ---------------- 流式读取 SSE ---------------- */
  function readStream(resp, onDelta) {
    if (!resp.body || !resp.body.getReader) {
      /* 非流式兜底 */
      return resp.json().then(function (j) {
        var c = j.choices && j.choices[0] && (j.choices[0].message ? j.choices[0].message.content : (j.choices[0].delta && j.choices[0].delta.content)) || "";
        if (c) onDelta(c);
        return c;
      });
    }
    var reader = resp.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buffer = "";
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return null;
        buffer += decoder.decode(r.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf("data:") !== 0) continue;
          var data = line.slice(5).trim();
          if (data === "[DONE]") return null;
          try {
            var j = JSON.parse(data);
            var ch = j.choices && j.choices[0];
            var piece = ch && ((ch.delta && ch.delta.content) || (ch.message && ch.message.content)) || "";
            if (piece) onDelta(piece);
          } catch (e) { /* 忽略无法解析的行 */ }
        }
        return pump();
      });
    }
    return pump();
  }

  /* ---------------- 对话主入口 ----------------
     opts 可覆盖当前设置（测试连接时使用，避免污染已保存配置） */
  var activeCtrl = null;
  function aiChat(messages, onDelta, opts) {
    var cfg = Object.assign({}, S, opts || {});
    if (!cfg.baseUrl) return Promise.reject(new Error("未配置接口地址（Base URL），请点击右上角「AI 模型」设置。"));
    if (!cfg.apiKey && cfg.provider !== "ollama") return Promise.reject(new Error("未配置 API Key，请点击右上角「AI 模型」设置。"));
    var temp = parseFloat(cfg.temperature);
    if (isNaN(temp)) temp = 0.5;
    var ctrl = new AbortController();
    activeCtrl = ctrl;
    var body = {
      /* 走代理时需给完整 chat/completions 端点（代理按原样转发到该 URL） */
      baseUrl: cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions",
      apiKey: cfg.apiKey, model: cfg.model,
      temperature: temp, stream: true, messages: messages
    };
    var acc = "";                       /* 累计全文，随 Promise 返回 */
    function emit(d) {
      if (!d) return;
      acc += String(d);
      if (onDelta) onDelta(d);
    }
    return detectProxy().then(function (pb) {
      var viaProxy = pb !== false;
      var p;
      if (viaProxy) {
        p = post(pb + "/api/ai/chat", body).catch(function (e1) {
          return postDirect(cfg, body).catch(function (e2) {
            throw new Error(friendly(e1, e2));
          });
        });
      } else {
        p = postDirect(cfg, body).catch(function (e2) {
          throw new Error("无法连接模型接口（直连）：" + (e2 && e2.message || e2) +
            "。若为浏览器跨域限制，请运行 node server.js / python server.py 后重试。");
        });
      }
      return p.then(function () { return acc; });
    });

    function post(url, b) {
      return fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b), signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) {
          throw new Error("上游返回 " + r.status + "：" + t.slice(0, 300));
        });
        return readStream(r, emit);
      });
    }
    function postDirect(cfg, b) {
      return fetch(cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model, messages: b.messages, temperature: b.temperature, stream: true }),
        signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) {
          throw new Error("直连返回 " + r.status + "：" + t.slice(0, 300));
        });
        return readStream(r, emit);
      });
    }
    function friendly(e1, e2) {
      var a = String(e1 && e1.message || e1), b2 = String(e2 && e2.message || e2);
      if (/Failed to fetch|NetworkError|TypeError/i.test(b2)) {
        return "无法连接模型接口：本地代理未启动且浏览器直连被跨域策略拦截。\n解决：①在项目目录运行 node server.js（或 python server.py）后重试；或 ②改用支持浏览器直连的服务商（如智谱 GLM）。\n（代理诊断：" + a + "）";
      }
      return e2 && e2.message ? b2 : a;
    }
  }

  /* ---------------- 系统提示词与上下文 ---------------- */
  function domainListText() {
    var names = window.DomainRegistry.metas().map(function (d) { return d.name; }).join("、");
    return "覆盖领域：" + names + "；另含美国/欧盟经贸合规要点指引（政策变动频繁，涉外合规决策须提示咨询专业律师）。";
  }
  var SYSTEM_PROMPT =
    "你是「法律咨询助手」的 AI 法律顾问。" + domainListText() + " 回答规则：" +
    "①先给直接结论，再分析；较复杂的问题按争点展开（每个争点：问题→规则→适用到本案→小结），并在结尾给出对方可能的抗辩及应对；" +
    "②引用法条写明法律名称与条文号（如《劳动合同法》第47条），优先依据下方提供的匹配资料；" +
    "③给出可执行建议：如何固定证据、走什么程序、注意什么时效；" +
    "④存在地方裁审口径差异或事实不足时明确说明，不要编造；" +
    "⑤结尾提醒：以上分析仅供参考，不构成正式法律意见。" +
    "使用简体中文，条理清晰，适度使用小标题与列表。";

  function buildContext(text) {
    var c = window.ANALYSIS.matchContext(text);
    var s = "\n\n【系统预匹配资料】（识别领域：" + c.domainName + "）";
    if (c.scenarios.length) s += "\n· 匹配场景：" + c.scenarios.map(function (x) { return x.name; }).join("、");
    if (c.laws.length) s += "\n【相关法条】\n" + c.laws.map(function (l) {
      return "· " + l.lawShort + l.article + "（" + l.title + "）：" + l.text;
    }).join("\n");
    if (c.cases.length) s += "\n【参考案例】\n" + c.cases.map(function (x) {
      return "· " + (x.no ? x.no + " " : "") + x.title + "：" + (x.gist || x.ruling || "");
    }).join("\n");
    return s;
  }

  /* ---------------- 推荐追问（AI 回答完成后追加，帮不知道下一步问什么的用户） ---------------- */
  var DOMAIN_FOLLOWS = {
    labor: ["我的经济补偿 N/N+1/2N 具体怎么算？", "劳动仲裁的流程、时效和费用是怎样的？"],
    company: ["作为股东我该怎么维权、要准备哪些证据？", "这种情况可以去市场监管局投诉吗？"],
    patent: ["我该怎么固定对方侵权的证据？", "专利维权的大概周期和费用是多少？"],
    trade: ["我们该怎么自查是否触碰清单红线？", "遇到调查/制裁第一时间该做什么？"],
    jiashi: ["这种情况我该怎么收集证据、保护自己？", "走诉讼的话大概多久、抚养费/财产怎么分？"],
    biaozhu: ["侵权证据该怎么固定（公证/时间戳）？", "向平台投诉或起诉的具体流程？"],
    minfa: ["诉讼时效还剩多久、怎么中断？", "我需要准备哪些证据、去哪个法院起诉？"],
    minsusong: ["立案需要哪些材料、费用多少？", "败诉方不履行判决该怎么办？"]
  };
  var GENERIC_FOLLOWS = ["我还需要准备哪些证据？", "走法律程序的时间和费用大概多少？"];

  function appendFollowUps(div, domainId) {
    var qs = (DOMAIN_FOLLOWS[domainId] || []).slice(0, 2).concat(GENERIC_FOLLOWS).slice(0, 4);
    var wrap = document.createElement("div");
    wrap.className = "msg bot followup-row";
    wrap.innerHTML = '<div class="bubble followup-bubble"><div class="fu-title"><svg class=ico><use href=#i-q></use></svg> 可以继续问我</div>' +
      '<div class="chips">' + qs.map(function (q) {
        return '<button class="rel-link fu-btn" data-q="' + esc(q) + '">' + esc(q) + '</button>';
      }).join("") + '</div></div>';
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".fu-btn") : null;
      if (!b) return;
      wrap.remove();
      aiConsult(b.getAttribute("data-q"));
    });
    /* 领域相关计算器直达（与结果卡共用映射） */
    if (window.TOOLS && window.TOOLS.toolChipsForDomain && domainId) {
      var toolChips = window.TOOLS.toolChipsForDomain(domainId);
      if (toolChips) {
        var trow = document.createElement("div");
        trow.className = "msg bot followup-row";
        trow.innerHTML = '<div class="bubble followup-bubble"><div class="fu-title"><svg class=ico><use href=#i-tools></use></svg> 相关计算器</div>' + toolChips + '</div>';
        trow.addEventListener("click", function (e) {
          var tb = e.target.closest ? e.target.closest(".tool-jump-btn") : null;
          if (!tb) return;
          trow.remove();
          if (window.TOOLS.jumpTo) window.TOOLS.jumpTo(tb.getAttribute("data-tool"));
        });
        (function waitForBox() {
          var cb = document.getElementById("chat-box");
          if (cb) { cb.appendChild(trow); cb.scrollTop = cb.scrollHeight; }
        })();
      }
    }
    var chatBox = document.getElementById("chat-box");
    if (chatBox) { chatBox.appendChild(wrap); chatBox.scrollTop = chatBox.scrollHeight; }
  }

  /* ---------------- 集成①：AI 对话模式 ---------------- */
  function streamBubble(box) {
    var div = document.createElement("div");
    div.className = "msg bot";
    div.innerHTML = '<div class="avatar"><svg class=ico><use href=#i-ai></use></svg></div><div class="bubble ai-stream"><span class="ai-text"></span><span class="ai-cursor">▍</span></div>';
    var stop = document.createElement("button");
    stop.className = "ai-stop";
    stop.textContent = "⏹ 停止";
    stop.addEventListener("click", function () { window.AI.stopCurrent(); });
    div.appendChild(stop);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }
  function setText(div, text) {
    div.querySelector(".ai-text").textContent = text;
    var box = document.getElementById("chat-box");
    box.scrollTop = box.scrollHeight;
  }
  /* 输出语言指令（设置：auto 跟随提问 / zh / en / bi 中英对照） */
  function langPrompt() {
    var lang = (S && S.lang) || "auto";
    if (lang === "zh") return "\n【输出语言】用简体中文回答。";
    if (lang === "en") return "\n【Output language】Respond in English. Keep Chinese statute names in Chinese with an English gloss on first mention, e.g. 《劳动合同法》第47条 (Labor Contract Law, Art. 47); cite Chinese law only from the provided context.";
    if (lang === "bi") return "\n【Output language】Bilingual output: each section first in 简体中文, then an English translation under a line beginning with 'EN:'. Keep statute names in Chinese with an English gloss on first mention.";
    return "\n【输出语言】与用户提问相同的语言回答：用户用英文提问则用英文回答（中国法条名保留中文原名并括注英译，引用仅限所给资料）；用户用中文则用中文。";
  }

  function finishBubble(div, text) {
    var cursor = div.querySelector(".ai-cursor");
    if (cursor) cursor.remove();
    div.querySelectorAll(".ai-stop").forEach(function (x) { x.remove(); });
    setText(div, text);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function copyText(t) {
    if (navigator.clipboard) return navigator.clipboard.writeText(t);
    var ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  function addCopyButton(div, getText) {
    var cp = document.createElement("button");
    cp.className = "mini-btn";
    cp.style.marginTop = "6px";
    cp.innerHTML = "<svg class=ico><use href=#i-copy></use></svg> 复制全文";
    cp.addEventListener("click", function () {
      copyText(typeof getText === "function" ? getText() : getText);
      cp.innerHTML = "<svg class=ico><use href=#i-checkc></use></svg> 已复制";
      setTimeout(function () { cp.innerHTML = "<svg class=ico><use href=#i-copy></use></svg> 复制全文"; }, 1500);
    });
    div.querySelector(".bubble").appendChild(cp);
  }

  function aiConsult(text) {
    var box = document.getElementById("chat-box");
    window.UI.appendUser(text);
    var div = streamBubble(box);
    var ctx = buildContext(text);
    var messages = [{ role: "system", content: SYSTEM_PROMPT + ctx +
      (window.INTAKE && window.INTAKE.isActive() ? window.INTAKE.promptBlock() : "") +
      (window.INTAKE && window.INTAKE.isActive() ? "" : langPrompt()) +
      "\n【追问规则】若用户描述的关键事实明显不足（未说明时间、金额、合同状态、双方关系等核心要素），" +
      "请先合并提出最多两个关键追问，等用户补充后再给完整分析；若信息已足够，直接分析，不要为追问而追问。" }]
      .concat(aiHistory)
      .concat([{ role: "user", content: text }]);
    var full = "";
    if (window.INTAKE && window.INTAKE.isActive()) window.INTAKE.onUserMessage(text);
    var dId = (window.ANALYSIS.matchContext(text) || {}).domain;
    aiChat(messages, function (delta) {
      full += delta;
      setText(div, full);
    }).then(function () {
      if (!full) full = "（模型未返回内容，请检查模型名称与服务商设置。）";
      finishBubble(div, full);
      if (window.AGENT) window.AGENT.attachVerification(div.querySelector(".bubble"), full, ctx);
      if (window.CHATHISTORY) window.CHATHISTORY.record({ who: "ai", html: div.querySelector(".bubble").innerHTML, text: full });
      addCopyButton(div, full);
      aiHistory.push({ role: "user", content: text }, { role: "assistant", content: full });
      if (aiHistory.length > 10) aiHistory = aiHistory.slice(-10);
      if (window.INTAKE && window.INTAKE.isActive()) window.INTAKE.onAssistantDone(); else appendFollowUps(div, dId);
    }).catch(function (e) {
      var msg = (e && e.message || String(e));
      if (/abort/i.test(msg)) { finishBubble(div, "（已停止生成）"); return; }
      finishBubble(div, "<svg class=ico><use href=#i-warn></use></svg> " + msg);
      var rbtn = document.createElement("button");
      rbtn.className = "mini-btn";
      rbtn.style.marginTop = "8px";
      rbtn.textContent = "🔄 重试";
      rbtn.addEventListener("click", function () { div.remove(); aiConsult(text); });
      div.querySelector(".bubble").appendChild(rbtn);
    });
  }

  /* ---------------- 集成②：结果卡 AI 深度解读 ---------------- */
  function aiDeepResult(rid) {
    var item = (window.AI_RESULTS || [])[rid];
    if (!item) return;
    var box = document.getElementById("chat-box");
    var div = streamBubble(box);
    var lawText = (item.r.laws || []).map(function (id) {
      var l = window.lawById(id);
      return l ? "· " + l.lawShort + l.article + "（" + l.title + "）：" + l.text : "";
    }).filter(Boolean).join("\n");
    var content =
      "【规则引擎结论】" + item.r.headline + "\n" + item.r.summary + "\n" +
      "【要点】\n" + item.r.analysis.map(function (x) { return "- " + x; }).join("\n") +
      (lawText ? "\n【依据法条】\n" + lawText : "") +
      "\n【用户场景】" + item.name;
    var messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "请针对以下初步分析结论，结合用户实际处境做个性化深度解读：展开关键风险、给出更具体的行动步骤（含话术要点）、指出结论中依赖的前提事实是否需要进一步确认。不要重复罗列原文。\n\n" + content }
    ];
    var full = "";
    aiChat(messages, function (delta) { full += delta; setText(div, full); })
      .then(function () {
        finishBubble(div, full || "（模型未返回内容。）");
        if (window.AGENT) window.AGENT.attachVerification(div.querySelector(".bubble"), full, content);
        if (window.CHATHISTORY) window.CHATHISTORY.record({ who: "ai", html: div.querySelector(".bubble").innerHTML, text: full });
      })
      .catch(function (e) { finishBubble(div, "<svg class=ico><use href=#i-warn></use></svg> " + (e && e.message || e)); });
  }
  /* 集成③（案情分析 AI 深度分析）已并入「深度分析」页 AI 模式，见 agent.js */

  /* ---------------- 集成②：结果卡快捷追问（带案情上下文） ---------------- */
  function aiFollowUp(rid, question) {
    var item = (window.AI_RESULTS || [])[rid];
    if (!item) return;
    var box = document.getElementById("chat-box");
    window.UI.appendUser(question);
    var div = streamBubble(box);
    var brief = "咨询场景：" + item.name + "。" +
      (item.transcript || []).map(function (t) { return t.q + " 答：" + t.a + "。"; }).join("") +
      "初步结论：" + (item.r.headline || "") + " " + (item.r.summary || "");
    var ctx = buildContext(brief);
    var messages = [
      { role: "system", content: SYSTEM_PROMPT + ctx },
      { role: "user", content: "针对上述咨询案情，用户继续追问：" + question + "\n请结合已有分析直接回答，不要重复此前内容。" }
    ];
    var full = "";
    aiChat(messages, function (d) { full += d; setText(div, full); })
      .then(function () {
        finishBubble(div, full || "（模型未返回内容。）");
        if (window.AGENT) window.AGENT.attachVerification(div.querySelector(".bubble"), full, ctx);
        if (window.CHATHISTORY) window.CHATHISTORY.record({ who: "ai", html: div.querySelector(".bubble").innerHTML, text: full });
        addCopyButton(div, full);
        aiHistory.push({ role: "user", content: question }, { role: "assistant", content: full });
        if (aiHistory.length > 10) aiHistory = aiHistory.slice(-10);
      })
      .catch(function (e) { finishBubble(div, "<svg class=ico><use href=#i-warn></use></svg> " + (e && e.message || e)); });
  }

  /* ---------------- 设置弹窗 ---------------- */
  function openModal() {
    document.getElementById("ai-modal").classList.remove("hidden");
    fillForm();
  }
  function fillForm() {
    document.getElementById("ai-provider").value = S.provider;
    document.getElementById("ai-baseurl").value = S.baseUrl;
    document.getElementById("ai-model").value = S.model;
    document.getElementById("ai-key").value = S.apiKey;
    document.getElementById("ai-temp").value = S.temperature;
    document.getElementById("ai-temp-val").textContent = S.temperature;
    setStatus(S.apiKey || S.provider === "ollama" ? "已配置：" + S.provider + " / " + S.model : "尚未配置 API Key");
  }
  function setStatus(t, cls) {
    var el = document.getElementById("ai-status");
    el.textContent = t;
    el.className = "ai-status " + (cls || "");
  }
  function applyProviderPreset(v) {
    var p = PROVIDERS[v];
    if (p && p.baseUrl) {
      document.getElementById("ai-baseurl").value = p.baseUrl;
      document.getElementById("ai-model").value = p.model;
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    /* 设置按钮与弹窗 */
    var gear = document.getElementById("ai-gear");
    if (gear) gear.addEventListener("click", openModal);
    var modal = document.getElementById("ai-modal");
    if (!modal) return;
    modal.querySelector(".modal-mask").addEventListener("click", function () { modal.classList.add("hidden"); });
    document.getElementById("ai-close").addEventListener("click", function () { modal.classList.add("hidden"); });
    document.getElementById("ai-provider").addEventListener("change", function (e) { applyProviderPreset(e.target.value); });
    document.getElementById("ai-temp").addEventListener("input", function (e) {
      document.getElementById("ai-temp-val").textContent = e.target.value;
    });
    document.getElementById("ai-save").addEventListener("click", function () {
      S.provider = document.getElementById("ai-provider").value;
      S.baseUrl = document.getElementById("ai-baseurl").value.trim();
      S.model = document.getElementById("ai-model").value.trim();
      S.apiKey = document.getElementById("ai-key").value.trim();
      S.temperature = document.getElementById("ai-temp").value;
      save();
      setStatus("<svg class=ico><use href=#i-checkc></use></svg> 已保存：" + S.provider + " / " + S.model, "ok");
      syncToggleLabel();
    });
    document.getElementById("ai-test").addEventListener("click", function () {
      /* 用表单当前值构造临时配置测试，不改动已保存设置 */
      var opts = {
        provider: document.getElementById("ai-provider").value,
        baseUrl: document.getElementById("ai-baseurl").value.trim(),
        model: document.getElementById("ai-model").value.trim(),
        apiKey: document.getElementById("ai-key").value.trim(),
        temperature: document.getElementById("ai-temp").value
      };
      setStatus("⏳ 正在测试连接…");
      aiChat([{ role: "user", content: "请只回复两个字：正常" }], function () {}, opts)
        .then(function (full) {
          setStatus(full ? "<svg class=ico><use href=#i-checkc></use></svg> 连接成功，模型已响应：" + String(full).slice(0, 40) : "<svg class=ico><use href=#i-warn></use></svg> 连接成功但未收到内容", "ok");
        })
        .catch(function (e) {
          setStatus("❌ " + (e && e.message || e));
        });
    });

    /* 咨询页：AI 对话开关（「新对话」按钮已由 main.js/history.js 接管） */
    /* 深度咨询入口：引导式要素收集（需已配置 AI） */
    var intakeBtn = document.getElementById("intake-btn");
    if (intakeBtn) intakeBtn.addEventListener("click", function () {
      if (!(window.AI && window.AI.isConfigured())) {
        var box = document.getElementById("chat-box");
        if (box) { var d = document.createElement("div"); d.className = "msg bot"; d.innerHTML = '<div class="bubble">深度咨询需要先配置 AI 模型：点右上角「AI 模型」设置后即可使用。</div>'; box.appendChild(d); }
        return;
      }
      var modeCb2 = document.getElementById("ai-mode");
      if (modeCb2 && !modeCb2.checked) modeCb2.click();   /* 自动开启 AI 对话模式 */
      var t = (document.getElementById("consult-input") || {}).value || "";
      t = t.trim() || "您好，我需要法律帮助，请引导我梳理案情。";
      if (window.INTAKE) window.INTAKE.start(t);
      var inp = document.getElementById("consult-input");
      if (inp) inp.value = "";
      aiConsult(t);
    });

    var langSel = document.getElementById("ai-lang");
    if (langSel) {
      langSel.value = S.lang || "auto";
      langSel.addEventListener("change", function () { S.lang = langSel.value; save(); });
    }
    var modeCb = document.getElementById("ai-mode");
    if (modeCb) {
      modeCb.addEventListener("change", syncToggleLabel);
      var origStart = window.CONSULT.start;
      window.CONSULT.start = function (text) {
        if (modeCb.checked && (text || "").trim()) { aiConsult(text); return; }
        origStart(text);
      };
    }

    /* 结果卡：AI 深度解读按钮（事件委托） */
    var chatBox = document.getElementById("chat-box");
    chatBox.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".result-ai-btn") : null;
      if (btn) aiDeepResult(btn.getAttribute("data-rid"));
    });

    /* 数据备份：导出 / 导入 */
    var expBtn = document.getElementById("data-export");
    if (expBtn) expBtn.addEventListener("click", exportData);
    var impBtn = document.getElementById("data-import");
    if (impBtn) impBtn.addEventListener("click", function () { document.getElementById("data-import-file").click(); });
    var impFile = document.getElementById("data-import-file");
    if (impFile) impFile.addEventListener("change", function (e) {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });

    syncToggleLabel();
  }

  function syncToggleLabel() {
    var cb = document.getElementById("ai-mode");
    if (!cb) return;
    var ok = !!S.apiKey || S.provider === "ollama";
    cb.parentElement.title = ok
      ? "开启后，输入的问题由 " + S.model + " 结合法条与案例回答"
      : "AI 未配置：点击右上角「AI 模型」设置后使用";
  }

  function resetHistory() { aiHistory = []; }
  function stopCurrent() { if (activeCtrl) activeCtrl.abort(); }

  /* ---------------- 数据备份：导出 / 导入 ---------------- */
  function exportData() {
    var payload = {
      app: "legal-assistant", version: 1, exportedAt: new Date().toISOString(),
      chatSessions: JSON.parse(localStorage.getItem("legal-chat-sessions") || "[]"),
      chatCurrent: localStorage.getItem("legal-chat-current"),
      deadlines: JSON.parse(localStorage.getItem("legal-deadlines") || "[]"),
      feedback: JSON.parse(localStorage.getItem("legal-feedback") || "[]"),
      aiSettings: S
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "legal-assistant-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("<svg class=ico><use href=#i-checkc></use></svg> 备份已导出到下载目录", "ok");
  }
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(reader.result);
        if (!d || d.app !== "legal-assistant") throw new Error("不是本工具的备份文件");
        if (!confirm("导入将覆盖当前的对话历史、日历与 AI 设置，是否继续？")) return;
        if (d.chatSessions) localStorage.setItem("legal-chat-sessions", JSON.stringify(d.chatSessions));
        if (d.chatCurrent) localStorage.setItem("legal-chat-current", d.chatCurrent);
        if (d.deadlines) localStorage.setItem("legal-deadlines", JSON.stringify(d.deadlines));
        if (d.feedback) localStorage.setItem("legal-feedback", JSON.stringify(d.feedback));
        if (d.aiSettings) { S = Object.assign({}, DEFAULTS, d.aiSettings); save(); }
        setStatus("<svg class=ico><use href=#i-checkc></use></svg> 导入成功，页面即将刷新", "ok");
        setTimeout(function () { location.reload(); }, 800);
      } catch (e) {
        setStatus("❌ 导入失败：" + (e && e.message || e));
      }
    };
    reader.readAsText(file);
  }

  return {
    init: init, aiChat: aiChat, openModal: openModal,
    resetHistory: resetHistory, stopCurrent: stopCurrent, langPrompt: langPrompt,
    aiFollowUp: aiFollowUp,
    exportData: exportData, importData: importData,
    settings: function () { return S; },
    isConfigured: function () { return !!S.apiKey || S.provider === "ollama"; }
  };
})();
