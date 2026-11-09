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

  var DEFAULTS = { provider: "glm", baseUrl: PROVIDERS.glm.baseUrl, model: PROVIDERS.glm.model, apiKey: "", temperature: 0.5, lang: "auto", redact: true, preview: false };
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
  /* ---------------- 隐私：PII 脱敏 + 发送前预览 ---------------- */
  function redactPII(t) {
    var s = String(t == null ? "" : t);
    /* 身份证（18 位，含校验位 X） */
    s = s.replace(/\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, "【身份证号已脱敏】");
    /* 手机号（前后非数字，兼容旧 WebView 不用 lookbehind） */
    s = s.replace(/(^|[^0-9])(1[3-9]\d{9})(?=[^0-9]|$)/g, "$1【手机号已脱敏】");
    /* 银行卡号 13-19 位（前后非数字；身份证已先行替换不会误伤） */
    s = s.replace(/(^|[^0-9])(\d{13,19})(?=[^0-9]|$)/g, "$1【银行卡号已脱敏】");
    /* 电子邮箱 */
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "【邮箱已脱敏】");
    return s;
  }
  function maybePreview(messages) {
    if (!S.preview) return Promise.resolve(messages);
    var skip = false;
    try { skip = sessionStorage.getItem("legal-preview-skip") === "1"; } catch (e) {}
    if (skip) return Promise.resolve(messages);
    return new Promise(function (resolve, reject) {
      var modal = document.getElementById("send-preview-modal");
      var ta = document.getElementById("send-preview-text");
      var btnSend = document.getElementById("sp-send");
      var btnCancel = document.getElementById("sp-cancel");
      var cbSkip = document.getElementById("sp-skip");
      if (!modal || !ta || !btnSend || !btnCancel) return resolve(messages);
      ta.value = messages.map(function (m) {
        var tag = m.role === "system" ? "系统提示（核验约束规则，不含案情）" : m.role === "user" ? "发送内容（含案情/资料）" : "AI 历史回复";
        return "──── " + tag + " ────\n" + String(m.content || "").slice(0, 4000);
      }).join("\n\n");
      if (cbSkip) cbSkip.checked = false;
      modal.classList.remove("hidden");
      function cleanup() {
        modal.classList.add("hidden");
        btnSend.removeEventListener("click", onSend);
        btnCancel.removeEventListener("click", onCancel);
      }
      function onSend() {
        if (cbSkip && cbSkip.checked) { try { sessionStorage.setItem("legal-preview-skip", "1"); } catch (e) {} }
        cleanup();
        resolve(messages);
      }
      function onCancel() {
        cleanup();
        reject(new Error("已取消发送（用户在「发送前预览」中取消）。如不再需要预览，可在 AI 设置 → 隐私中关闭。"));
      }
      btnSend.addEventListener("click", onSend);
      btnCancel.addEventListener("click", onCancel);
    });
  }

  function aiChat(messages, onDelta, opts) {
    var cfg = Object.assign({}, S, opts || {});
    if (!cfg.baseUrl) return Promise.reject(new Error("未配置接口地址（Base URL），请点击右上角「AI 模型」设置。"));
    if (!cfg.apiKey && cfg.provider !== "ollama") return Promise.reject(new Error("未配置 API Key，请点击右上角「AI 模型」设置。"));
    var temp = parseFloat(cfg.temperature);
    if (isNaN(temp)) temp = 0.5;
    /* 隐私：发送前脱敏（默认开）+ 发送前预览（默认关，可在设置开启） */
    messages = messages.map(function (m) {
      return m.role === "user" && cfg.redact ? Object.assign({}, m, { content: redactPII(m.content) }) : m;
    });
    var proceed = maybePreview(messages);
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
    /* 预览确认 → 探测代理 → 发送；取消预览时整个调用拒绝 */
    return proceed.then(function (finalMessages) {
      body.messages = finalMessages;
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
    });

    /* ---- 请求健康度（C1）：连接/流式 90 秒无进展自动中断（此前直连挂死永久转圈）----
       AbortController 与停止按钮共享；超时置 timedOut 标志，catch 里翻译成人话 */
    var timedOut = false, toId = null;
    function armTimeout() {
      clearTimeout(toId);
      toId = setTimeout(function () { timedOut = true; try { ctrl.abort(); } catch (e) { } }, 90000);
    }
    function disarm() { clearTimeout(toId); }
    function statusHint(status, body) {
      if (status === 401 || status === 403) return "API Key 无效或无权限——请点右上角「AI 模型」核对密钥（注意首尾空格）。";
      if (status === 402) return "账户余额不足——请到服务商控制台充值，或改用免费模型（如智谱 glm-4-flash）。";
      if (status === 404) return "模型名或接口地址不存在——请核对模型名称拼写与 Base URL。";
      if (status === 429) return "请求过于频繁（限流）——稍等十几秒再点重试，或检查服务商并发限制。";
      if (status === 400) {
        if (/context|token|length|maximum/i.test(body || "")) return "本次内容超出模型上下文长度——新开会话、减少粘贴篇幅，或换更大上下文的模型。";
        return "请求被拒绝（400）——多为模型名错误或参数不支持，请核对设置。";
      }
      if (status >= 500) return "模型服务端暂时故障（" + status + "）——稍后重试即可。";
      return "";
    }
    function post(url, b) {
      armTimeout();
      return fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b), signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok) { disarm(); return r.text().then(function (t) {
          var hint = statusHint(r.status, t);
          throw new Error(hint || ("上游返回 " + r.status + "：" + t.slice(0, 300)));
        }); }
        return readStream(r, function (d) { armTimeout(); emit(d); }).then(disarm, function (e) { disarm(); throw e; });
      }, function (e) { disarm(); throw e; });
    }
    function postDirect(cfg, b) {
      armTimeout();
      return fetch(cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model, messages: b.messages, temperature: b.temperature, stream: true }),
        signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok) { disarm(); return r.text().then(function (t) {
          var hint = statusHint(r.status, t);
          throw new Error(hint || ("直连返回 " + r.status + "：" + t.slice(0, 300)));
        }); }
        return readStream(r, function (d) { armTimeout(); emit(d); }).then(disarm, function (e) { disarm(); throw e; });
      }, function (e) { disarm(); throw e; });
    }
    function friendly(e1, e2) {
      var a = String(e1 && e1.message || e1), b2 = String(e2 && e2.message || e2);
      if (timedOut) return "连接超时：模型 90 秒无响应或传输中断——请检查网络后重试。";
      if (/Failed to fetch|NetworkError|TypeError/i.test(b2)) {
        return "无法连接模型接口：本地代理未启动且浏览器直连被跨域策略拦截。\n解决：①在项目目录运行 node server.js（或 python server.py）后重试；或 ②改用支持浏览器直连的服务商（如智谱 GLM）。\n（代理诊断：" + a + "）";
      }
      return e2 && e2.message ? b2 : a;
    }
  }

  /* ---------------- 轻量 Markdown 渲染（C4）----------------
     AI 回答完成时渲染：**粗体** / 行内代码 / # 小标题 / - 列表 / 1. 有序列表 / > 引用。
     esc-then-transform：先整体转义再按白名单结构重建，绝不引入原生 HTML；流式阶段保持纯文本性能。 */
  function mdLite(src) {
    var lines = String(src == null ? "" : src).split(/\r?\n/);
    var out = [], inUl = false, inOl = false;
    function inline(s) {
      s = esc(s);
      s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
      return s;
    }
    function closeLists() {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (inOl) { out.push("</ol>"); inOl = false; }
    }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (!t) { closeLists(); return; }
      var hm = t.match(/^#{1,4}\s+(.*)$/);
      if (hm) { closeLists(); out.push("<div style=\"font-weight:700;margin:10px 0 4px\">" + inline(hm[1]) + "</div>"); return; }
      if (/^[-*]\s+/.test(t)) {
        if (inOl) { out.push("</ol>"); inOl = false; }
        if (!inUl) { out.push("<ul>"); inUl = true; }
        out.push("<li>" + inline(t.replace(/^[-*]\s+/, "")) + "</li>");
        return;
      }
      var om = t.match(/^\d{1,3}[.、]\s+(.*)$/);
      if (om) {
        closeLists();
        if (!inOl) { out.push("<ol>"); inOl = true; }
        out.push("<li>" + inline(om[1]) + "</li>");
        return;
      }
      if (/^>\s?/.test(t)) {
        closeLists();
        out.push("<div style=\"border-left:3px solid var(--primary-border);padding-left:10px;color:var(--ink-2);margin:6px 0\">" + inline(t.replace(/^>\s?/, "")) + "</div>");
        return;
      }
      closeLists();
      out.push("<div style=\"margin:4px 0\">" + inline(t) + "</div>");
    });
    closeLists();
    return out.join("");
  }
  /* 完成时的 Markdown 版 finishBubble：先走原 finishBubble（光标/停止按钮清理），再替换为渲染 HTML */
  function finishMd(div, full) {
    finishBubble(div, full);
    var b = div.querySelector(".bubble");
    if (b) b.innerHTML = mdLite(full);
  }

  /* ---------------- 统一失败呈现（C1）----------------
     保留已流出的半截内容（标注未核验）+ 人话错误条 + 一键重试——此前仅 aiConsult 有重试，
     其余入口失败要重走整个入口操作；流中断时半截内容被错误条整体覆盖丢弃。 */
  function keepPartialOnError(div, full, msg, retryFn) {
    var bubble = div.querySelector(".bubble");
    if (full && bubble) {
      finishBubble(div, full + "\n\n—— 以上为中断前已生成内容（未经核验）");
      bubble = div.querySelector(".bubble");
    } else {
      finishBubble(div, "<svg class=ico><use href=#i-warn></use></svg> " + esc(msg));
    }
    if (!bubble) return;
    var err = document.createElement("div");
    err.className = "tool-warn";
    err.style.marginTop = "8px";
    err.innerHTML = "<svg class=ico><use href=#i-warn></use></svg> " + esc(msg);
    bubble.appendChild(err);
    var rbtn = document.createElement("button");
    rbtn.className = "mini-btn";
    rbtn.style.margin = "8px 8px 0 0";
    rbtn.textContent = "🔄 重试";
    rbtn.addEventListener("click", function () { div.remove(); retryFn(); });
    bubble.appendChild(rbtn);
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
    "⑤关键事实缺失时的追问与拒答：若案件时间、所在地区、双方身份关系、合同性质、金额等关键事实缺失且直接影响结论，先合并追问（最多两个问题），不要直接给出确定性结论；" +
    "⑥同一问题存在多种解释或法律路径时，用条件分支表述——「若 A 情形则…；若 B 情形则…」，不要擅自替用户选定事实；" +
    "⑦回答正文之后，另起一行输出推荐追问（严格格式，不要加其他文字）：「【推荐追问】问题1｜问题2｜问题3」——3 个针对本次回答内容的具体追问，必须贴合用户当前问题与回答（如工伤咨询就追问工伤认定/待遇/停工留薪期，不要给无关领域的通用问题）；" +
    "⑧结尾提醒：以上分析仅供参考，不构成正式法律意见。" +
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
    /* 用户技能：启用的技能追加专项分析框架（位于核验约束之后，免责声明由代码级追加） */
    if (window.SKILLS && window.SKILLS.promptBlock) s += window.SKILLS.promptBlock();
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

  /* 解析 AI 回答末尾的「【推荐追问】问题1｜问题2」行：返回 {questions, cleaned}；无该行返回 null（回退静态推荐） */
  function parseAiFollowupLine(text) {
    var s = String(text || "");
    var m = s.match(/【推荐追问】\s*([^\n]+)/);
    if (!m) return null;
    var qs = m[1].split(/｜|\|/).map(function (q) { return q.replace(/^[0-9]+[.、\s]*/, "").trim(); })
      .filter(function (q) { return q.length > 3 && q.length < 40; }).slice(0, 3);
    if (!qs.length) return null;
    return { questions: qs, cleaned: s.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim() };
  }

  /* 计算器 chips 按回答文本过滤：label 关键词在文本中出现才保留；「时效」类几乎总相关；无匹配返回 "" */
  function filterChipsByText(chipsHtml, text) {
    if (!chipsHtml) return "";
    var t = String(text || "");
    if (!t) return chipsHtml;
    var tmp = document.createElement("div");
    tmp.innerHTML = chipsHtml;
    var KEYS = { "补偿金": ["补偿", "赔偿", "辞退", "解除", "2N", "N+"], "加班费": ["加班", "延时"], "年休假": ["年假", "年休假"], "利息": ["利息", "借款", "LPR", "借"], "抚养费": ["抚养", "孩子"], "诉讼费": ["诉讼费", "起诉", "立案", "费用"], "专利": ["专利"], "赔偿": ["赔偿", "侵权", "商标", "著作权"], "时效": ["时效", "仲裁", "起诉", "期限", "过期", "工伤"] };
    var KEPT_ANY = ["时效"];
    var kept = [];
    tmp.querySelectorAll(".tool-jump-btn").forEach(function (b) {
      var label = (b.textContent || "").trim();
      var hit = false;
      Object.keys(KEYS).forEach(function (k) {
        if (hit) return;
        if (label.indexOf(k) > -1) {
          if (KEYS[k].some(function (kw) { return t.indexOf(kw) > -1; })) hit = true;
        }
      });
      if (hit || KEPT_ANY.some(function (k) { return label.indexOf(k) > -1; })) kept.push(b);
    });
    if (!kept.length) return "";
    tmp.innerHTML = "";
    kept.forEach(function (b) { tmp.appendChild(b); });
    return tmp.innerHTML;
  }

  function appendFollowUps(div, domainId, aiQuestions, answerText) {
    /* 优先使用 AI 生成的贴合追问；无则回退领域静态推荐 */
    var qs = (aiQuestions && aiQuestions.length) ? aiQuestions.slice(0, 3)
      : (DOMAIN_FOLLOWS[domainId] || []).slice(0, 2).concat(GENERIC_FOLLOWS).slice(0, 4);
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
    /* 相关计算器：按回答文本过滤（只保留与本次回答内容相关的计算器，避免无关推荐） */
    if (window.TOOLS && window.TOOLS.toolChipsForDomain && domainId) {
      var toolChips = filterChipsByText(window.TOOLS.toolChipsForDomain(domainId), answerText || "");
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
    /* 滚动跟随（C5）：仅当用户本来就在底部附近才拽底——上翻查看历史不再被反复拉回 */
    var box = document.getElementById("chat-box");
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
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
    /* 含 SVG（错误/停止图标）的文本走 innerHTML；纯文本流走 textContent */
    if (text.indexOf("<svg") > -1) div.querySelector(".ai-text").innerHTML = text;
    else setText(div, text);
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
      /* 解析 AI 推荐追问行：从正文剥离，问题贴合本次回答 */
      var fl = parseAiFollowupLine(full);
      if (fl) full = fl.cleaned;
      finishMd(div, full);
      if (window.AGENT) window.AGENT.attachVerification(div.querySelector(".bubble"), full, ctx);
      if (window.CHATHISTORY) window.CHATHISTORY.record({ who: "ai", html: div.querySelector(".bubble").innerHTML, text: full });
      addCopyButton(div, full);
      aiHistory.push({ role: "user", content: text }, { role: "assistant", content: full });
      if (aiHistory.length > 10) aiHistory = aiHistory.slice(-10);
      if (window.INTAKE && window.INTAKE.isActive()) window.INTAKE.onAssistantDone(); else appendFollowUps(div, dId, fl ? fl.questions : null, full);
    }).catch(function (e) {
      var msg = (e && e.message || String(e));
      if (/abort/i.test(msg)) {
        /* 手动停止：保留半截内容并标注未核验（此前整条丢弃） */
        finishBubble(div, full ? full + "\n\n⏹ 以上为停止前的未核验内容" : "（已停止生成）");
        return;
      }
      keepPartialOnError(div, full, msg, function () { aiConsult(text); });
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
        if (full) finishMd(div, full); else finishBubble(div, "（模型未返回内容。）");
        if (window.AGENT) window.AGENT.attachVerification(div.querySelector(".bubble"), full, content);
        if (window.CHATHISTORY) window.CHATHISTORY.record({ who: "ai", html: div.querySelector(".bubble").innerHTML, text: full });
      })
      .catch(function (e) {
        var msg = (e && e.message || String(e));
        if (/abort/i.test(msg)) { finishBubble(div, full ? full + "\n\n⏹ 以上为停止前的未核验内容" : "（已停止生成）"); return; }
        keepPartialOnError(div, full, msg, function () { aiDeepResult(rid); });
      });
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
        if (full) finishMd(div, full); else finishBubble(div, "（模型未返回内容。）");
        if (window.AGENT) window.AGENT.attachVerification(div.querySelector(".bubble"), full, ctx);
        if (window.CHATHISTORY) window.CHATHISTORY.record({ who: "ai", html: div.querySelector(".bubble").innerHTML, text: full });
        addCopyButton(div, full);
        aiHistory.push({ role: "user", content: question }, { role: "assistant", content: full });
        if (aiHistory.length > 10) aiHistory = aiHistory.slice(-10);
      })
      .catch(function (e) {
        var msg = (e && e.message || String(e));
        if (/abort/i.test(msg)) { finishBubble(div, full ? full + "\n\n⏹ 以上为停止前的未核验内容" : "（已停止生成）"); return; }
        keepPartialOnError(div, full, msg, function () { aiFollowUp(rid, question); });
      });
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
    el.innerHTML = t;   /* 含 SVG 图标的调用方需要 innerHTML */
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
    /* 快捷咨询场景卡：用户开始对话后隐藏（与当前咨询无关的引导卡不再占屏），新对话/清空后恢复 */
    (function () {
      var quickList = document.getElementById("quick-scenarios");
      var quickTitle = document.getElementById("quick-title");
      var chatB = document.getElementById("chat-box");
      if (!quickList || !chatB) return;
      var updQuickVis = function () {
        var hasUser = chatB.querySelectorAll(".msg.user").length > 0;
        quickList.classList.toggle("hidden", hasUser);
        if (quickTitle) quickTitle.classList.toggle("hidden", hasUser);
        var sug = document.getElementById("suggestions");
        if (sug) sug.classList.toggle("hidden", hasUser);
        var ec = document.getElementById("entry-cards");
        if (ec) ec.classList.toggle("hidden", hasUser);
      };
      new MutationObserver(updQuickVis).observe(chatB, { childList: true });
      updQuickVis();
    })();
    /* 深度咨询入口：引导式要素收集（需已配置 AI） */
    var intakeBtn = document.getElementById("intake-btn");
    /* 深度咨询入口在有对话内容后隐藏——避免用户在已有咨询流程中误触 */
    if (intakeBtn) {
      var chatBoxForIntake = document.getElementById("chat-box");
      if (chatBoxForIntake) {
        var updIntakeVis = function () {
          intakeBtn.classList.toggle("hidden", chatBoxForIntake.querySelectorAll(".msg.user").length > 0);   /* 只统计用户消息：欢迎语不算对话内容 */
        };
        new MutationObserver(updIntakeVis).observe(chatBoxForIntake, { childList: true });
        updIntakeVis();
      }
    }
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
    /* 反馈清单导出（维护者评测闭环：差评案例人工筛选后进 test.js 金问题） */
    var fbBtn = document.getElementById("fb-export");
    if (fbBtn) fbBtn.addEventListener("click", exportFeedback);

    /* ---------------- 隐私与数据：开关 + 分项清除 ---------------- */
    var cbRedact = document.getElementById("ai-privacy-redact");
    if (cbRedact) {
      cbRedact.checked = S.redact !== false;
      cbRedact.addEventListener("change", function () { S.redact = cbRedact.checked; save(); });
    }
    var cbPreview = document.getElementById("ai-privacy-preview");
    if (cbPreview) {
      cbPreview.checked = !!S.preview;
      cbPreview.addEventListener("change", function () {
        S.preview = cbPreview.checked; save();
        try { sessionStorage.removeItem("legal-preview-skip"); } catch (e) {}
      });
    }
    var CLEAR_GROUPS = { "sessions": 1, "reports": 1, "cases": 1, "evhist": 1 };
    document.querySelectorAll("[data-clear]").forEach(function (b) {
      b.addEventListener("click", function () {
        var which = b.getAttribute("data-clear");
        if (b.dataset.armed !== "1") {
          b.dataset.armed = "1";
          b.textContent = "确认清除？";
          b.classList.add("danger");
          setTimeout(function () { b.dataset.armed = ""; b.textContent = b.getAttribute("data-label") || b.textContent; b.classList.remove("danger"); }, 4000);
          return;
        }
        if (window.STORE) {
          if (which === "all") STORE.clearCaseData(); else STORE.clearGroup(which);
        } else {
          /* 兜底：store.js 未加载时按旧清单清除 */
          var LEGACY = {
            sessions: ["legal-chat-sessions", "legal-chat-current"],
            reports: ["legal-agent-reports"],
            cases: ["legal-case-imports"],
            evhist: ["legal-ev-checks", "legal-calc-history", "legal-deadlines"]
          };
          (which === "all" ? [].concat(LEGACY.sessions, LEGACY.reports, LEGACY.cases, LEGACY.evhist) : LEGACY[which] || [])
            .forEach(function (k) { localStorage.removeItem(k); });
        }
        setStatus("<svg class=ico><use href=#i-checkc></use></svg> 已清除，页面即将刷新", "ok");
        setTimeout(function () { location.reload(); }, 700);
      });
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

  /* ---------------- 数据备份：导出 / 导入 ----------------
     v3：按 store.js 键注册表导出全部 backup:true 的键（对话/工作区/报告/案例/日历等）；
     aiSettings 始终排除 API Key。restoreBackup 兼容 v1/v2 旧格式。 */
  function buildBackup() {
    var payload = {
      app: "legal-assistant", version: 3, exportedAt: new Date().toISOString(),
      aiSettings: Object.assign({}, S, { apiKey: "" }),   /* 隐私：备份默认排除 API Key */
      entries: {}
    };
    if (window.STORE) {
      STORE.REGISTRY.forEach(function (r) {
        if (!r.backup) return;
        var v = localStorage.getItem(r.key);
        if (v == null) return;
        try { payload.entries[r.key] = JSON.parse(v); } catch (e) { payload.entries[r.key] = v; }
      });
    } else {
      /* 兜底：store.js 未加载时保留 v2 行为 */
      payload.version = 2;
      payload.chatSessions = JSON.parse(localStorage.getItem("legal-chat-sessions") || "[]");
      payload.chatCurrent = localStorage.getItem("legal-chat-current");
      payload.deadlines = JSON.parse(localStorage.getItem("legal-deadlines") || "[]");
      payload.feedback = JSON.parse(localStorage.getItem("legal-feedback") || "[]");
    }
    return payload;
  }
  function exportData() {
    var payload = buildBackup();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "legal-assistant-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("<svg class=ico><use href=#i-checkc></use></svg> 备份已导出（不含 API Key，换设备需重新填写；文件含明文案情，请妥善保管）", "ok");
  }
  /* 反馈清单导出（维护者评测闭环）：记录结构 {scene, domain, verdict: like|bad, comment, time}；差评优先，md 便于筛选进金问题 */
  function exportFeedback() {
    var fb = [];
    try { fb = JSON.parse(localStorage.getItem("legal-feedback") || "[]"); } catch (e) { }
    if (!fb.length) { setStatus("暂无反馈记录", ""); return; }
    var bad = fb.filter(function (x) { return x.verdict === "bad"; });
    var lines = ["# 用户反馈清单（维护者评测用）", "", "导出时间：" + new Date().toISOString().slice(0, 10),
      "总数 " + fb.length + " 条，其中差评 " + bad.length + " 条——请人工筛选后加入 test.js 评测集金问题", "",
      "## 差评（优先）"];
    bad.forEach(function (x) {
      lines.push("- [" + (x.domain || "?") + "] " + x.scene + (x.comment ? "｜备注：" + x.comment : "") + "｜" + (x.time || "").slice(0, 10));
    });
    lines.push("", "## 全部反馈");
    fb.slice().reverse().forEach(function (x) {
      lines.push("- [" + (x.verdict || "?") + "][" + (x.domain || "?") + "] " + x.scene + (x.comment ? "｜" + x.comment : "") + "｜" + (x.time || "").slice(0, 10));
    });
    lines.push("", "（本清单由本机生成；加入评测集时请匿名化处理案情信息。）");
    var blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "feedback-" + new Date().toISOString().slice(0, 10) + ".md";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("<svg class=ico><use href=#i-checkc></use></svg> 反馈清单已导出", "ok");
  }

  /* 恢复：v3（entries 键注册表）与 v1/v2（旧字段）双兼容；返回恢复的键数 */
  function restoreBackup(d) {
    var n = 0;
    if (d.version >= 3 && d.entries) {
      Object.keys(d.entries).forEach(function (k) {
        var v = d.entries[k];
        if (v === undefined) return;
        try {
          localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
          n++;
        } catch (e) { /* 单键失败不阻断 */ }
      });
    } else {
      if (d.chatSessions) { localStorage.setItem("legal-chat-sessions", JSON.stringify(d.chatSessions)); n++; }
      if (d.chatCurrent) { localStorage.setItem("legal-chat-current", d.chatCurrent); n++; }
      if (d.deadlines) { localStorage.setItem("legal-deadlines", JSON.stringify(d.deadlines)); n++; }
      if (d.feedback) { localStorage.setItem("legal-feedback", JSON.stringify(d.feedback)); n++; }
    }
    if (d.aiSettings) {
      var keepKey = S.apiKey;   /* 备份不含密钥：导入时保留本机已存的 Key */
      S = Object.assign({}, DEFAULTS, d.aiSettings);
      if (!S.apiKey) S.apiKey = keepKey;
      save();
    }
    return n;
  }
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(reader.result);
        if (!d || d.app !== "legal-assistant") throw new Error("不是本工具的备份文件");
        if (!confirm("导入将覆盖当前的对话历史、案件工作区、报告存档、案例收藏、日历与 AI 设置，是否继续？")) return;
        var n = restoreBackup(d);
        setStatus("<svg class=ico><use href=#i-checkc></use></svg> 导入成功（" + n + " 项数据），页面即将刷新", "ok");
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
    exportData: exportData, importData: importData, buildBackup: buildBackup, restoreBackup: restoreBackup, redactPII: redactPII,
    systemPromptText: function () { return SYSTEM_PROMPT; },
    parseFollowupLine: parseAiFollowupLine,   /* 评测集只读访问 */
    mdLite: mdLite,                           /* 评测集只读访问（C4 白名单渲染回归） */
    settings: function () { return S; },
    isConfigured: function () { return !!S.apiKey || S.provider === "ollama"; }
  };
})();
