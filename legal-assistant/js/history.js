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
    try { sessions = JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch (e) { sessions = []; }
    if (!Array.isArray(sessions)) sessions = [];
    sessions.forEach(function (s) { if (typeof s.archived !== "boolean") s.archived = false; });
    try { currentId = localStorage.getItem(CUR) || null; } catch (e) { currentId = null; }
    if (currentId && !find(currentId)) currentId = null;
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions));
      if (currentId) localStorage.setItem(CUR, currentId);
    } catch (e) {
      /* 容量超限等：保留内存态，提示一次 */
      if (!window.__histWarned) {
        window.__histWarned = true;
        console.warn("对话历史保存失败（本地存储容量不足），本次对话不会被持久化");
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
    current: current,
    list: list
  };
})();
