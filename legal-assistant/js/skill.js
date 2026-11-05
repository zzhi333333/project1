/* =========================================================
 * skill.js —— AI 技能包（用户自定义扩展，零依赖）
 * 格式：Markdown 为主（YAML 风格 frontmatter + 约定小节），导入兼容 JSON，导出 .md
 * 红线：技能是「声明式知识包」——只提供分析框架/清单/模板/术语，不提供法律结论；
 *       不执行任何代码；无法越过核验管线与免责声明（注入点位于硬约束之后、
 *       免责声明由代码级追加）；导入时扫描注入攻击模式并拒绝。
 * frontmatter 仅支持扁平 key: value 与 [a, b] 简单数组（不引入 YAML 解析器）。
 * ========================================================= */
window.SKILLS = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  var STORE_KEY = "legal-skills";
  var MAX_BYTES = 100 * 1024;
  var BAN = [
    { re: /忽略(以上|之前|上面|上述|先前|之前)?(所有|全部)?(指令|提示|规则|约束)/, why: "试图覆盖既有指令" },
    { re: /无视(以上|上述|之前)?(所有|全部)?(指令|提示|规则|约束)/, why: "试图覆盖既有指令" },
    { re: /ignore\s+(all\s+)?(previous|prior|above|earlier)/i, why: "试图覆盖既有指令" },
    { re: /(跳过|关闭|解除|禁用|取消).{0,8}(核验|验证|校验)/, why: "试图绕过核验管线" },
    { re: /(删除|去掉|移除|省略|不要).{0,10}免责声明/, why: "试图移除免责声明" },
    { re: /免责声明.{0,10}(删除|去掉|移除|省略)/, why: "试图移除免责声明" },
    { re: /disregard\s+(all\s+)?(previous|prior|above)/i, why: "试图覆盖既有指令" }
  ];
  var ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

  /* ---------------- 内置示例技能（同时是格式示范） ---------------- */
  var BUILTIN_MD = [
    "---\n" +
    "id: skill-jiangong\n" +
    "name: 建设工程纠纷专项\n" +
    "version: 1.0\n" +
    "author: 内置示例\n" +
    "domains: []\n" +
    "keywords: [工程款, 签证, 竣工结算, 工期索赔, 建设工程施工合同, 实际施工人]\n" +
    "---\n" +
    "\n## 分析框架\n" +
    "本案属建设工程施工合同纠纷，请按以下框架展开分析（在既有核验规则内作答）：\n" +
    "1. 合同效力：发包/转包/违法分包/挂靠情形下的合同效力与后果（阴阳合同以中标备案合同为结算依据的规则）；\n" +
    "2. 工程量与计价：签证单、会议纪要、施工日志、监理资料的证据链是否完整；结算依据（约定计价标准、定额、信息价）；\n" +
    "3. 工期与索赔：开工日期认定、工期顺延事由（设计变更、天气、发包方原因）、索赔程序与期限；\n" +
    "4. 价款支付：进度款/结算款/质保金的节点与利息起算；\n" +
    "5. 优先受偿权：建设工程价款优先受偿权的行使期限与范围（不得对抗已付大部分款项的商品房消费者）；\n" +
    "6. 实际施工人：突破合同相对性向发包人主张的责任范围（发包人欠付工程款范围内）。\n" +
    "输出时先给结论，再按上述争点逐项展开；数字与期限断言仍须来自资料区或用户案情。\n" +
    "\n## 证据清单：建设工程案件\n" +
    "- 建设工程施工合同及补充协议、中标通知书\n" +
    "- 施工许可证、资质证书复印件\n" +
    "- 签证单、工程洽商记录、会议纪要（原件）\n" +
    "- 施工日志、监理日志、隐蔽工程验收记录\n" +
    "- 工程款支付凭证、对账单、发票\n" +
    "- 竣工验收报告/结算书/审计报告\n" +
    "- 往来函件（催款函、复工申请、停工通知）及送达凭证\n" +
    "\n## 文书模板：工程款支付催告函\n" +
    "致：{发包方名称}\n" +
    "我方依据双方于{合同签订日期}签订的《建设工程施工合同》（下称“合同”）承建{工程名称}。截至本函发出之日，贵方尚欠付工程款人民币{欠付金额}元（其中进度款{进度款金额}元、结算款{结算款金额}元），已逾合同约定支付节点{逾期天数}日。\n" +
    "现催告贵方于收函后{宽限天数}日内支付上述款项；逾期未付，我方将依法主张利息，并就工程折价或拍卖价款行使优先受偿权，届时产生的一切费用与后果由贵方承担。\n" +
    "此致\n{催告方名称}\n{日期}\n" +
    "\n## 术语\n" +
    "- 签证 (Site Instruction)：施工中双方就设计变更、工程量增减等达成的书面确认文件，是结算与索赔的核心证据。\n" +
    "- 实际施工人 (Actual Constructor)：无效合同（转包/挂靠/违法分包）下实际投入施工的主体，可在发包人欠付范围内突破合同相对性主张。\n" +
    "- 优先受偿权 (Priority Right of Compensation)：承包人就工程价款对工程折价/拍卖价款的法定优先受偿权利，须在法定期限内行使。",

    "---\n" +
    "id: skill-kuajing\n" +
    "name: 跨境电商合规专项\n" +
    "version: 1.0\n" +
    "author: 内置示例\n" +
    "domains: [trade]\n" +
    "keywords: [跨境电商, 出口退税, 9610, 9710, 1210, 海关查验, 目的国合规, CE认证]\n" +
    "---\n" +
    "\n## 分析框架\n" +
    "本案属跨境电商经营合规问题，请按以下框架展开（在既有核验规则内作答）：\n" +
    "1. 监管通道：出口模式归类（9610 集货直邮 / 9710 B2B 直出口 / 1210 保税备货 / 9810 海外仓）及其差异；\n" +
    "2. 主体资质：经营主体海关注册登记、收结汇与退税主体一致性；\n" +
    "3. 目的国准入：产品认证（如欧盟 CE/英国 UKCA/美国 FCC）、标签与语言要求、平台合规政策；\n" +
    "4. 税务：出口退税条件、目的国 VAT/销售税义务与低值免税线；\n" +
    "5. 数据与知产：GDPR 等数据规则、Listing 侵权风险与 TRO 应对预案；\n" +
    "6. 出口管制筛查：商品 HS 编码是否落入两用物项/实体清单限制（引用资料区时仍须逐条核验）。\n" +
    "输出时区分「中国侧合规」与「目的国侧合规」两栏；具体税率/认证目录提示以官方最新公布为准。\n" +
    "\n## 证据清单：跨境电商合规自查\n" +
    "- 营业执照、海关注册登记（报关单位备案）证明\n" +
    "- 出口订单、物流单据（运单/提单）、收款流水\n" +
    "- 产品认证证书（CE/UKCA/FCC 等）与检测报告\n" +
    "- 目的国税务登记（如欧盟 VAT 号）与申报记录\n" +
    "- 平台店铺政策通知、下架/冻结通知及申诉记录\n" +
    "- 供货合同、采购发票（用于溯源与退税）\n" +
    "\n## 术语\n" +
    "- 9610 (Cross-border e-commerce B2C export)：跨境电商零售直邮出口监管代码，清单核放、汇总申报。\n" +
    "- 1210 (Bonded warehouse model)：保税跨境贸易电子商务（备货进口/出口海外仓），先将货物存入保税仓。\n" +
    "- TRO (Temporary Restraining Order)：美国法院临时禁令，常用于知产侵权批量维权，收到后应评估应诉/和解并冻结应对。"
  ];

  /* ---------------- MD 解析 ---------------- */
  function parseFrontmatter(text) {
    var m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { meta: {}, body: text };
    var meta = {}, body = text.slice(m[0].length);
    m[1].split(/\r?\n/).forEach(function (line) {
      var kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if (!kv) return;
      var k = kv[1], v = kv[2].trim();
      if (v.charAt(0) === "[" && v.charAt(v.length - 1) === "]") {
        v = v.slice(1, -1).split(",").map(function (x) { return x.trim().replace(/^["']|["']$/g, ""); }).filter(Boolean);
      } else {
        v = v.replace(/^["']|["']$/g, "");
      }
      meta[k] = v;
    });
    return { meta: meta, body: body };
  }

  function parseListItems(content) {
    return content.split(/\r?\n/).map(function (l) {
      return l.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, "").trim();
    }).filter(function (l) { return l.length > 0 && !/^#{1,6}\s/.test(l); });
  }

  /* 解析术语行：- 术语 (English)：解释 */
  function parseTerms(content) {
    var out = [];
    parseListItems(content).forEach(function (l) {
      var m = l.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*[:：]\s*(.+)$/);
      if (m) out.push({ t: m[1].trim(), en: m[2].trim(), p: m[3].trim() });
      else {
        var m2 = l.match(/^(.+?)\s*[:：]\s*(.+)$/);
        if (m2) out.push({ t: m2[1].trim(), en: "", p: m2[2].trim() });
      }
    });
    return out;
  }

  function compile(text, source) {
    if (typeof text !== "string" || !text.trim()) return { error: "内容为空" };
    if (text.length > MAX_BYTES) return { error: "内容超过 100KB 上限" };
    var fm = parseFrontmatter(text);
    var meta = fm.meta, body = fm.body;
    var id = String(meta.id || "").trim();
    var name = String(meta.name || "").trim();
    if (!ID_RE.test(id)) return { error: "frontmatter 缺少合法 id（小写字母/数字/连字符，2–40 位）" };
    if (!name) return { error: "frontmatter 缺少 name" };
    var skill = {
      id: id, name: name,
      version: String(meta.version || "1.0"),
      author: String(meta.author || "未署名"),
      domains: Array.isArray(meta.domains) ? meta.domains : [],
      keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
      prompt: "", checklists: [], templates: [], terms: [],
      source: source || "import", importedAt: new Date().toISOString()
    };
    /* 按约定小节拆分正文 */
    var sections = body.split(/^\s*##\s+/m).filter(function (s) { return s.trim(); });
    var promptParts = [];
    if (sections.length) {
      sections.forEach(function (sec) {
        var nl = sec.indexOf("\n");
        var title = (nl === -1 ? sec : sec.slice(0, nl)).trim();
        var content = nl === -1 ? "" : sec.slice(nl + 1).replace(/^\r?\n+/, "").replace(/\s+$/, "");
        if (/^证据清单/.test(title)) {
          var clName = title.replace(/^证据清单\s*[:：]\s*/, "").trim() || "补充清单";
          var items = parseListItems(content);
          if (items.length) skill.checklists.push({ name: clName, items: items });
        } else if (/^文书模板/.test(title)) {
          var tpName = title.replace(/^文书模板\s*[:：]\s*/, "").trim() || "自定义模板";
          if (content.trim()) skill.templates.push({ name: tpName, body: content });
        } else if (/^术语/.test(title)) {
          skill.terms = skill.terms.concat(parseTerms(content));
        } else {
          /* 未知小节并入分析框架（含「分析框架」本身），信息不丢失 */
          if (content.trim()) promptParts.push(title === "分析框架" ? content : "【" + title + "】\n" + content);
        }
      });
    } else if (body.trim()) {
      promptParts.push(body.trim());
    }
    skill.prompt = promptParts.join("\n\n");
    if (!skill.prompt && !skill.checklists.length && !skill.templates.length && !skill.terms.length)
      return { error: "未解析到任何有效内容（分析框架/证据清单/文书模板/术语均缺失）" };
    /* 注入攻击扫描 */
    var scan = [skill.prompt].concat(
      skill.checklists.map(function (c) { return c.items.join("\n"); }),
      skill.templates.map(function (t) { return t.body; })
    ).join("\n");
    for (var i = 0; i < BAN.length; i++) {
      if (BAN[i].re.test(scan)) return { error: "包含被禁止的内容（" + BAN[i].why + "）：本工具的核验管线与免责声明不可被技能覆盖" };
    }
    return { skill: skill };
  }

  function fromJSON(obj) {
    if (!obj || typeof obj !== "object") return { error: "JSON 结构无效" };
    var md = "---\n" +
      "id: " + String(obj.id || "") + "\nname: " + String(obj.name || "") + "\n" +
      "version: " + String(obj.version || "1.0") + "\nauthor: " + String(obj.author || "未署名") + "\n" +
      "domains: [" + (Array.isArray(obj.domains) ? obj.domains.join(", ") : "") + "]\n" +
      "keywords: [" + (Array.isArray(obj.keywords) ? obj.keywords.join(", ") : "") + "]\n" +
      "---\n\n## 分析框架\n" + String(obj.prompt || "") +
      (obj.checklists || []).map(function (c) { return "\n\n## 证据清单：" + (c.name || "补充清单") + "\n" + (c.items || []).map(function (x) { return "- " + x; }).join("\n"); }).join("") +
      (obj.templates || []).map(function (t) { return "\n\n## 文书模板：" + (t.name || "自定义模板") + "\n" + String(t.body || ""); }).join("") +
      ((obj.terms || []).length ? "\n\n## 术语\n" + (obj.terms || []).map(function (x) { return "- " + x.t + (x.en ? " (" + x.en + ")" : "") + "：" + x.p; }).join("\n") : "");
    return compile(md, "import");
  }

  /* ---------------- 存储 ---------------- */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 静默 */ } }
  function builtinList() {
    return BUILTIN_MD.map(function (md) { return compile(md, "builtin").skill; }).filter(Boolean);
  }
  function all() {
    var s = loadStore();
    return builtinList().concat(s.list || []);
  }
  function isEnabled(id) {
    var s = loadStore();
    return s.enabled ? !!s.enabled[id] : false;
  }
  function setEnabled(id, on) {
    var s = loadStore();
    s.enabled = s.enabled || {};
    if (on) s.enabled[id] = true; else delete s.enabled[id];
    saveStore(s);
  }
  function upsert(skill) {
    var s = loadStore();
    s.list = s.list || [];
    s.list = s.list.filter(function (x) { return x.id !== skill.id; });
    s.list.push(skill);
    saveStore(s);
  }
  function remove(id) {
    var s = loadStore();
    s.list = (s.list || []).filter(function (x) { return x.id !== id; });
    saveStore(s);
  }
  function importText(text) {
    var r;
    var t = String(text || "").trim();
    if (t.charAt(0) === "{") {
      try { r = fromJSON(JSON.parse(t)); }
      catch (e) { return { ok: false, msg: "JSON 解析失败：" + e.message }; }
    } else {
      r = compile(t, "import");
    }
    if (r.error) return { ok: false, msg: r.error };
    var b = builtinList().some(function (x) { return x.id === r.skill.id; });
    if (b) return { ok: false, msg: "id 与内置技能冲突，请修改 frontmatter 的 id" };
    upsert(r.skill);
    return { ok: true, skill: r.skill };
  }

  /* ---------------- 集成接口（供 ai/agent/analysis/templates/glossary 调用） ---------------- */
  function enabledSkills() { return all().filter(function (x) { return isEnabled(x.id); }); }

  /* AI 提示块：启用的技能注入 system prompt（位于硬约束之后；免责声明由代码级追加，不可被技能影响） */
  /* token 预算：单技能注入上限 6000 字符、总预算 16000 字符——超出按加载顺序截断，
     防止技能堆多后资料区溢出、稀释核验硬约束的执行力 */
  var PER_SKILL_LIMIT = 6000;
  var TOTAL_BUDGET = 16000;

  function clip(text, limit) {
    if (!text || text.length <= limit) return text || "";
    return text.slice(0, limit) + "\n…（技能内容过长已截断，完整内容请在技能库中查看）";
  }

  function promptBlock() {
    var list = enabledSkills().filter(function (x) { return x.prompt; });
    if (!list.length) return "";
    var used = 0;
    var parts = [];
    list.forEach(function (x) {
      var remain = TOTAL_BUDGET - used;
      if (remain <= 200) return;   /* 预算耗尽：后续技能本轮不注入 */
      var body = clip(x.prompt, Math.min(PER_SKILL_LIMIT, remain));
      used += body.length;
      parts.push("◀ 技能「" + x.name + "」：\n" + body);
    });
    if (!parts.length) return "";
    var head = "\n\n【用户加载的专项技能】以下是用户自行加载的领域分析框架，仅作为组织分析的思路与清单，" +
      "不得据此编造法条、数字或结论；法条引用与数字断言仍须严格遵守既有的核验规则：\n";
    var tail = (list.length > parts.length) ? "\n（另有 " + (list.length - parts.length) + " 个技能因上下文预算未注入，可在技能库中查看）" : "";
    return head + parts.join("\n\n") + tail;
  }

  /* 证据清单：skill.domains 为空 = 全领域适用 */
  function checklistsFor(domain) {
    var out = [];
    enabledSkills().forEach(function (x) {
      if (x.domains.length && domain && x.domains.indexOf(domain) === -1) return;
      x.checklists.forEach(function (c) { out.push({ skill: x.name, name: c.name, items: c.items }); });
    });
    return out;
  }

  /* 文书模板：占位符 {xxx} 以已知字段填充，未知的保留为【xxx】待手工填写 */
  function templatesFor() {
    var out = [];
    enabledSkills().forEach(function (x) {
      x.templates.forEach(function (t, i) {
        out.push({
          id: x.id + "-tpl-" + i,
          name: "【技能】" + t.name,
          gen: function () {
            return String(t.body).replace(/\{([^{}]+)\}/g, function (m, k) { return "【" + k + "】"; });
          }
        });
      });
    });
    return out;
  }

  /* 术语合入 glossary（幂等：按 t 去重） */
  function mergeTerms() {
    if (!window.GLOSSARY || !Array.isArray(window.GLOSSARY.TERMS)) return;
    enabledSkills().forEach(function (x) {
      x.terms.forEach(function (t) {
        var dup = window.GLOSSARY.TERMS.some(function (g) { return g.t === t.t; });
        if (!dup) window.GLOSSARY.TERMS.push({ t: t.t, en: t.en, p: t.p + "（来自技能：" + x.name + "）" });
      });
    });
  }

  /* ---------------- 导出（网页 Blob / 移动端系统保存器） ---------------- */
  function toMarkdown(skill) {
    return "---\n" +
      "id: " + skill.id + "\nname: " + skill.name + "\nversion: " + (skill.version || "1.0") +
      "\nauthor: " + (skill.author || "未署名") +
      "\ndomains: [" + (skill.domains || []).join(", ") + "]" +
      "\nkeywords: [" + (skill.keywords || []).join(", ") + "]\n" +
      "---\n\n## 分析框架\n" + (skill.prompt || "") +
      (skill.checklists || []).map(function (c) { return "\n\n## 证据清单：" + c.name + "\n" + c.items.map(function (x) { return "- " + x; }).join("\n"); }).join("") +
      (skill.templates || []).map(function (t) { return "\n\n## 文书模板：" + t.name + "\n" + t.body; }).join("") +
      ((skill.terms || []).length ? "\n\n## 术语\n" + skill.terms.map(function (x) { return "- " + x.t + (x.en ? " (" + x.en + ")" : "") + "：" + x.p; }).join("\n") : "");
  }
  function exportSkill(id) {
    var sk = all().filter(function (x) { return x.id === id; })[0];
    if (!sk) return;
    var md = toMarkdown(sk), fname = sk.id + ".md";
    if (window.BRIDGE && window.BRIDGE.available && window.BRIDGE.exportFile) {
      window.BRIDGE.exportFile(fname, md);
      return;
    }
    try {
      var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- UI ---------------- */
  /* 复核标记是否过期（>6 个月视为较旧，提示核对） */
  function isStale(ym) {
    var m = String(ym || "").match(/^(\d{4})-(\d{1,2})/);
    if (!m) return false;
    var d = new Date();
    return (d.getFullYear() - Number(m[1])) * 12 + (d.getMonth() + 1 - Number(m[2])) > 6;
  }
  function rowHtml(sk) {
    var on = isEnabled(sk.id);
    var isB = sk.source === "builtin";
    return '<div class="flk-item" data-skill-id="' + esc(sk.id) + '">' +
      '<div class="flk-title">' + esc(sk.name) + '<span class="prop" style="margin-left:8px">v' + esc(sk.version || "1.0") + '</span>' +
      (isB ? '<span class="prop ok" style="margin-left:6px">内置</span>' : "") + '</div>' +
      '<div class="flk-props">' +
      (sk.keywords && sk.keywords.length ? '<span class="prop">触发词：' + esc(sk.keywords.join(" / ")) + '</span>' : "") +
      '<span class="prop">作者：' + esc(sk.author || "未署名") + '</span>' +
      (sk.reviewedAt ? '<span class="prop ' + (isStale(sk.reviewedAt) ? "warn" : "") + '">资料复核：' + esc(sk.reviewedAt) + (isStale(sk.reviewedAt) ? "（较旧，请核对最新法规）" : "") + '</span>' : "") +
      (sk.prompt ? "" : '<span class="prop warn">无分析框架（仅清单/模板/术语）</span>') +
      '</div>' +
      '<div class="flk-actions">' +
      '<button class="mini-btn' + (on ? " primary" : "") + '" data-act="toggle">' + (on ? "已启用（点击停用）" : "已停用（点击启用）") + '</button>' +
      '<button class="mini-btn" data-act="export"><svg class=ico><use href=#i-save></use></svg> 导出 .md</button>' +
      (isB ? "" : '<button class="mini-btn danger" data-act="del">删除</button>') +
      '</div></div>';
  }

  function renderList() {
    var box = document.getElementById("skill-list");
    if (!box) return;
    var list = all();
    var on = list.filter(function (x) { return isEnabled(x.id); }).length;
    var counter = document.getElementById("skill-count");
    if (counter) counter.textContent = "共 " + list.length + " 个技能，" + on + " 个已启用";
    var counterInline = document.getElementById("skill-count-inline");
    if (counterInline) counterInline.textContent = on + " 个已启用 / 共 " + list.length + " 个";
    box.innerHTML = list.length ? list.map(rowHtml).join("") : '<div class="empty">暂无技能，可在下方粘贴 .md 技能文本导入。</div>';
    box.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.closest("[data-skill-id]").getAttribute("data-skill-id");
        var act = b.getAttribute("data-act");
        if (act === "toggle") { setEnabled(id, !isEnabled(id)); mergeTerms(); renderList(); }
        else if (act === "export") exportSkill(id);
        else if (act === "del") { remove(id); setEnabled(id, false); renderList(); }
      });
    });
  }

  function openModal() {
    var m = document.getElementById("skill-modal");
    if (!m) return;
    m.classList.remove("hidden");
    renderList();
  }
  function closeModal() {
    var m = document.getElementById("skill-modal");
    if (m) m.classList.add("hidden");
  }

  function init() {
    var manage = document.getElementById("skill-manage-btn");
    if (manage) manage.addEventListener("click", openModal);
    var modal = document.getElementById("skill-modal");
    if (!modal) return;
    var close = document.getElementById("skill-close");
    if (close) close.addEventListener("click", closeModal);
    modal.querySelector(".modal-mask").addEventListener("click", closeModal);
    var impBtn = document.getElementById("skill-import");
    if (impBtn) impBtn.addEventListener("click", function () {
      var ta = document.getElementById("skill-import-text");
      var r = importText(ta.value);
      var tip = document.getElementById("skill-import-tip");
      if (tip) {
        tip.textContent = r.ok ? "✅ 已导入技能：" + r.skill.name : "❌ 导入失败：" + r.msg;
        tip.style.color = r.ok ? "var(--ok, #16a34a)" : "var(--danger, #dc2626)";
      }
      if (r.ok) { ta.value = ""; renderList(); }
    });
    var file = document.getElementById("skill-file");
    if (file) file.addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        document.getElementById("skill-import-text").value = String(reader.result || "");
        e.target.value = "";
      };
      reader.readAsText(f, "utf-8");
    });
    /* WebView 无文件选择器时隐藏文件入口（移动端走粘贴导入） */
    if (window.BRIDGE && window.BRIDGE.available) {
      var fw = document.getElementById("skill-file-wrap");
      if (fw) fw.classList.add("hidden");
    }
    mergeTerms();
  }

  return {
    init: init, openModal: openModal, closeModal: closeModal,
    parse: compile, fromJSON: fromJSON, importText: importText, toMarkdown: toMarkdown, exportSkill: exportSkill,
    all: all, isEnabled: isEnabled, setEnabled: setEnabled, remove: remove,
    promptBlock: promptBlock, checklistsFor: checklistsFor, templatesFor: templatesFor, mergeTerms: mergeTerms
  };
})();
