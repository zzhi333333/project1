/* =========================================================
 * 对话历史管理 history.js
 * —— 多会话 + localStorage 持久化
 *   数据结构：sessions[{ id, title, createdAt, updatedAt,
 *     messages: [{ who: "user"|"bot"|"ai", kind?, html, text?, data? }] }]
 * —— main.js 负责渲染（renderMessage/renderSessionList），本模块只管存取
 * ========================================================= */
window.CHATHISTORY = (function () {
  var KEY = "legal-chat-sessions";
  var CUR = "legal-chat-current";
  var MAX = 50;
  var sessions = [];
  var currentId = null;

  function load() {
    try {
      if (window.STORE) sessions = STORE.get(KEY, []);
      else sessions = JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch (e) { sessions = []; }
    if (!Array.isArray(sessions)) sessions = [];
    sessions.forEach(function (s) { if (typeof s.archived !== "boolean") s.archived = false; });
    try { currentId = localStorage.getItem(CUR) || null; } catch (e) { currentId = null; }
    if (currentId && !find(currentId)) currentId = null;
  }

  function persist() {
    /* 经 STORE 门面写入（v3.4.9）：配额溢出时 LRU 先清可再生的法条全文缓存再重试——
       此前直连 localStorage 使最大宗的会话键游离于配额回收之外。load 同理走门面。 */
    var ok = false;
    try {
      if (window.STORE) ok = STORE.set(KEY, sessions);
      else { localStorage.setItem(KEY, JSON.stringify(sessions)); ok = true; }
      if (ok && currentId) { try { localStorage.setItem(CUR, currentId); } catch (e2) { } }
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      /* 容量超限等：保留内存态，页面级提示一次（此前仅 console.warn，用户以为已保存实则丢失） */
      if (!window.__histWarned) {
        window.__histWarned = true;
        try {
          var b = document.createElement("div");
          b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:10px;z-index:2000;" +
            "background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:8px 14px;border-radius:8px;" +
            "font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:86vw;line-height:1.6";
          b.textContent = "⚠ 本机存储空间不足：新对话将不会被持久化。请在 设置 → 隐私与数据 中清理旧数据或导出备份";
          document.body.appendChild(b);
          setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 8000);
        } catch (e2) { }
      }
    }
  }

  function find(id) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === id) return sessions[i];
    return null;
  }

  function trim() { if (sessions.length > MAX) sessions = sessions.slice(0, MAX); }

  /* 确保存在当前会话；空会话复用，避免累积 */
  function ensureCurrent() {
    load();
    var s = currentId ? find(currentId) : null;
    if (!s) { s = newSession(false); }
    return s;
  }

  /* 新对话：当前会话尚无用户消息时复用它（不新建），防止空会话堆积 */
  function newSession(rerender) {
    load();
    var cur = currentId ? find(currentId) : null;
    if (cur && cur.messages.length <= 1) {
      cur.messages = [];
      cur.title = "新对话";
      cur.archived = false;
      cur.updatedAt = Date.now();
      currentId = cur.id;
      persist();
      return cur;
    }
    var s = {
      id: "s" + Date.now() + Math.random().toString(36).slice(2, 6),
      title: "新对话", createdAt: Date.now(), updatedAt: Date.now(),
      messages: [], archived: false
    };
    sessions.unshift(s);
    trim();
    currentId = s.id;
    persist();
    if (rerender !== false && window.renderSessionList) window.renderSessionList();
    return s;
  }

  function record(entry) {
    var s = ensureCurrent();
    entry.time = Date.now();
    s.messages.push(entry);
    s.updatedAt = Date.now();
    if (s.archived) s.archived = false;   /* 归档会话有新消息即自动移回历史 */
    if (entry.who === "user" && entry.text) {
      var text = String(entry.text).replace(/<[^>]+>/g, "");
      if (text && (s.title === "新对话" || !s.title)) s.title = text.slice(0, 18);
    }
    persist();
    if (window.renderSessionList) window.renderSessionList();
  }

  function remove(id) {
    load();
    sessions = sessions.filter(function (s) { return s.id !== id; });
    if (currentId === id) currentId = null;
    persist();
  }

  /* 归档 / 取消归档；归档当前会话时自动把当前指针移到最近的未归档会话 */
  function archive(id, flag) {
    load();
    var s = find(id);
    if (!s) return;
    s.archived = !!flag;
    if (s.archived && currentId === id) {
      currentId = null;
      for (var i = 0; i < sessions.length; i++) {
        if (!sessions[i].archived) { currentId = sessions[i].id; break; }
      }
    }
    persist();
  }

  function switchTo(id) {
    load();
    var s = find(id);
    if (!s) return null;
    currentId = id;
    persist();
    return s;
  }

  /* 删除当前会话中最后一条指定角色的消息（「重新生成」用：重问前移除旧 AI 回答，防历史重复） */
  function removeLastOf(who) {
    load();
    var s = currentId ? find(currentId) : null;
    if (!s) return;
    for (var i = s.messages.length - 1; i >= 0; i--) {
      if (s.messages[i].who === who) { s.messages.splice(i, 1); break; }
    }
    persist();
  }

  /* 会话导出 Markdown（v3.5.0）：text 优先，bot 无 text 时回退去标签 */
  function toMarkdown(id) {
    load();
    var s = find(id) || (currentId ? find(currentId) : null);
    if (!s) return "";
    var lines = ["# " + (s.title || "对话记录"), "",
      "导出：" + new Date().toISOString().slice(0, 10) + "｜消息 " + s.messages.length + " 条", "",
      "> 导出自獬小豸。AI 回答仅供参考，不构成法律意见；引用条文以官方现行文本为准。", ""];
    s.messages.forEach(function (m) {
      var who = m.who === "user" ? "🧑 我" : m.who === "ai" ? "🤖 AI 助手" : "📋 助手";
      var body = m.text || String(m.html || "").replace(/<[^>]+>/g, " ").replace(/[ \t]+\n/g, "\n").trim();
      if (!body) return;
      var t = m.time ? new Date(m.time).toLocaleString("zh-CN") : "";
      lines.push("**" + who + "**" + (t ? "（" + t + "）" : ""), "", body, "");
    });
    return lines.join("\n");
  }

  function current() {
    load();
    return currentId ? find(currentId) : null;
  }

  /* list(true) = 归档视图；list() = 历史视图（未归档） */
  function list(archived) {
    load();
    return sessions.filter(function (s) { return !!s.archived === !!archived; });
  }

  load();

  return {
    ensureCurrent: ensureCurrent,
    newSession: newSession,
    record: record,
    remove: remove,
    archive: archive,
    switchTo: switchTo,
    removeLastOf: removeLastOf,   /* 重新生成：移除末条 AI 回答 */
    toMarkdown: toMarkdown,       /* 会话导出 Markdown */
    current: current,
    list: list
  };
})();
