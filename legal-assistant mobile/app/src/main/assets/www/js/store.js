/* =========================================================
 * store.js —— 统一本机数据层（零依赖，批次三地基）
 * 职责：
 *   1) 键注册表：本机 localStorage 全部 legal-* 键的单一事实源
 *      （名称/分组），分项清除、备份、诊断都从这里取，不再散落硬编码
 *   2) 版本键 + 迁移钩子：legal-store-ver 记录数据结构版本，
 *      后续 schema 变更在此挂迁移函数
 *   3) 配额管理：写入溢出时按 LRU 先清「法条官方全文缓存」
 *      （legal-flk-text:* 最大宗且可再生）再重试
 * 用法：STORE.get/set/remove 直接代理 localStorage；
 *       STORE.groups() 供清除 UI；STORE.stats() 供诊断/备份提示。
 * 既有键名一律不改（老用户数据零迁移成本），只是纳入管理。
 * ========================================================= */
window.STORE = (function () {
  var VER_KEY = "legal-store-ver";
  var VER = 3;   /* v1=散键时代 v2=备份排除密钥 v3=键注册表+工作区 */

  /* 键注册表：group 对应「分项清除」分组；backup=是否进入完整备份 */
  var REGISTRY = [
    { key: "legal-chat-sessions", name: "对话历史", group: "sessions", backup: true },
    { key: "legal-chat-current",  name: "当前会话", group: "sessions", backup: true },
    { key: "legal-agent-reports", name: "报告存档", group: "reports",  backup: true },
    { key: "legal-workspaces",    name: "案件工作区", group: "workspace", backup: true },
    { key: "legal-case-imports",  name: "案例收藏", group: "cases",    backup: true },
    { key: "legal-ev-checks",     name: "证据三性勾选", group: "evhist", backup: false },
    { key: "legal-calc-history",  name: "计算历史", group: "evhist",   backup: false },
    { key: "legal-deadlines",     name: "合规日历", group: "evhist",   backup: true },
    { key: "legal-fav-laws",      name: "法条收藏", group: "prefs",    backup: true },
    { key: "legal-fav-tools",     name: "工具收藏", group: "prefs",    backup: true },
    { key: "legal-skills",        name: "技能库（不含启用态）", group: "skills", backup: false },
    { key: "legal-ai",            name: "AI 设置（含密钥）", group: "settings", backup: false },
    { key: "legal-first-run",     name: "引导标记", group: "settings", backup: false },
    { key: "legal-feedback",      name: "反馈记录", group: "settings", backup: true }
  ];
  var CACHE_PREFIX = "legal-flk-text:";   /* 再生缓存：配额溢出时 LRU 清理 */

  function raw() { return localStorage; }

  function get(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function set(key, val) {
    var s = JSON.stringify(val);
    try { localStorage.setItem(key, s); return true; }
    catch (e) { return evictAndRetry(key, s); }
  }
  function remove(key) { try { localStorage.removeItem(key); } catch (e) { } }

  /* 配额溢出：LRU 清理 flk 全文缓存（按写入序近似——localStorage 无时间戳，用迭代序=插入序近似 FIFO/LRU） */
  function evictAndRetry(key, s) {
    var victims = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(CACHE_PREFIX) === 0) victims.push(k);
    }
    if (!victims.length) return false;
    try { localStorage.removeItem(victims[0]); } catch (e) { return false; }
    try { localStorage.setItem(key, s); return true; }
    catch (e) { return victims.length > 1 ? evictAndRetry(key, s) : false; }
  }

  function groups() {
    var m = {};
    REGISTRY.forEach(function (r) { (m[r.group] = m[r.group] || []).push(r); });
    return m;
  }
  function clearGroup(group) {
    REGISTRY.forEach(function (r) { if (r.group === group) remove(r.key); });
  }
  function clearCaseData() {
    /* workspace 与 cases 分组独立：清案例收藏不再连带删光案件工作区（曾为同组数据丢失缺陷） */
    ["sessions", "reports", "cases", "workspace", "evhist"].forEach(clearGroup);
  }

  /* 诊断：各键占用估算（KB）与版本 */
  function stats() {
    var rows = REGISTRY.map(function (r) {
      var v = localStorage.getItem(r.key);
      return { key: r.key, name: r.name, group: r.group, kb: v ? Math.round(v.length / 1024 * 10) / 10 : 0 };
    });
    var cacheCount = 0, cacheKb = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(CACHE_PREFIX) === 0) {
        cacheCount++;
        cacheKb += (localStorage.getItem(k) || "").length / 1024;
      }
    }
    rows.push({ key: CACHE_PREFIX + "*", name: "法条全文缓存（可再生）", group: "cache", kb: Math.round(cacheKb * 10) / 10, count: cacheCount });
    var ver = parseInt(localStorage.getItem(VER_KEY) || "1", 10);
    if (ver < VER) { try { localStorage.setItem(VER_KEY, String(VER)); } catch (e) { } }
    return { version: Math.max(ver, VER), rows: rows };
  }

  return {
    get: get, set: set, remove: remove,
    groups: groups, clearGroup: clearGroup, clearCaseData: clearCaseData,
    stats: stats, REGISTRY: REGISTRY, VERSION: VER
  };
})();
