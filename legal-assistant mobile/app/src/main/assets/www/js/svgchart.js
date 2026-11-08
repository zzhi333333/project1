/* =========================================================
 * svgchart.js —— 零依赖图表原语库（两端同源）
 * 提供 ring / stepper / scale / ladder 四个纯字符串构建器，
 * 供计算器与报告插入可视化元素。所有图形仅表达「信息完备度/
 * 程序阶段/法定费率」等客观事实，不表达结果预测（免责红线）。
 * 颜色语义沿用项目惯例：绿 #16a34a / 橙 #d97706 / 红 #dc2626。
 * ========================================================= */
window.SVGCHART = (function () {

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- ring(pct, opts)：圆环进度 ----------
     pct 0–1（自动钳制）；颜色按剩余比例分档（opts.color 可覆盖）；
     opts: { size, stroke, color, label（环心文字，默认百分比） } */
  function ring(pct, opts) {
    opts = opts || {};
    var size = opts.size || 64, stroke = opts.stroke || 7;
    var p = Math.max(0, Math.min(1, isFinite(pct) ? pct : 0));
    var color = opts.color || (p > 0.5 ? "#16a34a" : p > 0.2 ? "#d97706" : "#dc2626");
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    var label = opts.label != null ? opts.label : Math.round(p * 100) + "%";
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="flex:none" role="img" aria-label="' + esc(label) + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--line,#e5e7eb)" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round"' +
      ' stroke-dasharray="' + (c * p).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="' + Math.round(size * 0.22) + '" font-weight="700" fill="currentColor">' + esc(label) + '</text>' +
      '</svg>';
  }

  /* ---------- stepper(items)：横向阶段条（flex，移动端自动换行） ----------
     items: [{ label, color, sub }]；序号圆点 + 连接线 + 名称 + 层级小字 */
  function stepper(items) {
    return '<div class="sc-stepper">' + (items || []).map(function (it, i) {
      return '<div class="sc-step">' +
        (i ? '<span class="sc-line"></span>' : '') +
        '<span class="sc-dot" style="background:' + esc(it.color || "#2563eb") + '">' + (i + 1) + '</span>' +
        '<span class="sc-text"><span class="sc-label">' + esc(it.label || "") + '</span>' +
        (it.sub ? '<span class="sc-sub">' + esc(it.sub) + '</span>' : '') + '</span></div>';
    }).join("") + '</div>';
  }

  /* ---------- scale(rate, cap, opts)：利率标尺 ----------
     绿色合法区 [0, cap]，红/橙超限区 [cap, 上界]；三角形游标标在约定利率处；
     上界 = max(rate, cap)×1.25，cap 为 0 或无效时不渲染 */
  function scale(rate, cap, opts) {
    opts = opts || {};
    if (!(cap > 0)) return "";
    var max = Math.max(rate || 0, cap) * 1.25;
    if (!(max > 0)) return "";
    var capPct = Math.min(100, cap / max * 100);
    var ratePct = Math.max(0, Math.min(100, (rate || 0) / max * 100));
    var over = (rate || 0) > cap;
    return '<div class="sc-scale" role="img" aria-label="利率标尺：司法保护上限 ' + esc(opts.capLabel || "") + '">' +
      '<div class="sc-scale-bar">' +
        '<span class="sc-scale-legal" style="width:' + capPct.toFixed(1) + '%"></span>' +
        '<span class="sc-scale-over" style="width:' + (100 - capPct).toFixed(1) + '%"></span>' +
        '<span class="sc-scale-cap" style="left:' + capPct.toFixed(1) + '%" title="司法保护上限 ' + esc(opts.capLabel || "") + '">' +
          '<span class="sc-scale-cap-t">上限 ' + esc(opts.capLabel || "") + '</span></span>' +
        '<span class="sc-scale-mark' + (over ? ' over' : '') + '" style="left:' + ratePct.toFixed(1) + '%" title="约定利率 ' + esc(opts.rateLabel || "") + '">' +
          '<span class="sc-scale-mark-t">' + esc(opts.rateLabel || "") + '</span></span>' +
      '</div>' +
      '<div class="sc-scale-legend"><span style="color:#16a34a">■ 受保护区间</span><span style="color:#dc2626">■ 超限不受保护</span></div>' +
      '</div>';
  }

  /* ---------- ladder(amount, brackets)：等宽累进阶梯 ----------
     brackets: [{ up, rate, label }]（依次递增，最后一段 up=Infinity）；
     已跨过段=主色填充，当前所在段=深色+描边，未达段=灰；
     只标法定费率，不预测结果 */
  function ladder(amount, brackets) {
    var segs = (brackets || []).map(function (b, i) {
      var lower = i === 0 ? 0 : brackets[i - 1].up;
      var reached = (amount || 0) > lower;
      var active = (amount || 0) > lower && (amount || 0) <= b.up;
      return '<div class="sc-ladder-seg' + (active ? " active" : reached ? " reached" : "") + '" title="' + esc(b.label) + " · " + (b.rateLabel || b.rate) + '">' +
        '<span class="sc-ladder-bar"></span><span class="sc-ladder-t">' + esc(b.label) + '</span><span class="sc-ladder-r">' + esc(b.rateLabel || b.rate) + '</span></div>';
    }).join("");
    return '<div class="sc-ladder">' + segs + '</div>';
  }

  return { ring: ring, stepper: stepper, scale: scale, ladder: ladder };
})();
