/* =========================================================
 * svgchart.js —— 零依赖图表原语库（两端同源）
 * 提供 ring / stepper / scale / ladder / radar / lanes 六个纯字符串构建器，
 * 供计算器与报告插入可视化元素。所有图形仅表达「信息完备度/
 * 程序阶段/法定费率」等客观事实，不表达结果预测（免责红线）。
 * 颜色全部引用 CSS 语义令牌（--ok/--warn/--danger/--c-*，D1 收敛），
 * 暗色模式自动适配；SVG 呈现属性一律走 style 形式（attr 不支持 var()）。
 * 入场动效（D2）经 .sc-* 类驱动，prefers-reduced-motion 下自动关闭。
 * ========================================================= */
window.SVGCHART = (function () {

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- ring(pct, opts)：圆环进度 ----------
     pct 0–1（自动钳制）；颜色按剩余比例分档（opts.color 可覆盖，过期态用灰红满圈区分紧急亮红）；
     opts: { size, stroke, color, label（环心主文字，默认百分比）, sub（环心第二行小字） } */
  function ring(pct, opts) {
    opts = opts || {};
    var size = opts.size || 64, stroke = opts.stroke || 7;
    var p = Math.max(0, Math.min(1, isFinite(pct) ? pct : 0));
    var color = opts.color || (p > 0.5 ? "var(--ok)" : p > 0.2 ? "var(--warn)" : "var(--danger)");
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    var label = opts.label != null ? opts.label : Math.round(p * 100) + "%";
    var fs = Math.round(size * (opts.sub ? 0.19 : 0.22));
    var mainY = opts.sub ? 40 : 52;
    var subSvg = opts.sub
      ? '<text x="50%" y="' + (mainY + 16) + '" dominant-baseline="middle" text-anchor="middle" font-size="' + Math.round(size * 0.16) + '" font-weight="600" fill="currentColor">' + esc(opts.sub) + "</text>"
      : "";
    return '<span class="sc-ring-box"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="flex:none" role="img" aria-label="' + esc(label + (opts.sub ? " " + opts.sub : "")) + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" style="stroke:var(--line)" stroke-width="' + stroke + '"/>' +
      '<circle class="sc-arc" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" style="stroke:' + color + ';--sc-c:' + c.toFixed(2) + '" stroke-width="' + stroke + '" stroke-linecap="round"' +
      ' stroke-dasharray="' + (c * p).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="50%" y="' + mainY + '%" dominant-baseline="middle" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="currentColor">' + esc(label) + "</text>" +
      subSvg +
      "</svg></span>";
  }

  /* ---------- stepper(items)：横向阶段条（flex，移动端自动换行） ----------
     items: [{ label, color, sub }]；序号圆点（依次点亮）+ 连接线 + 名称 + 层级小字 */
  function stepper(items) {
    return '<div class="sc-stepper">' + (items || []).map(function (it, i) {
      return '<div class="sc-step">' +
        (i ? '<span class="sc-line"></span>' : '') +
        '<span class="sc-dot" style="background:' + esc(it.color || "var(--c-info)") + ';animation-delay:' + (i * 70) + 'ms">' + (i + 1) + '</span>' +
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
        '<span class="sc-scale-legal sc-growx" style="width:' + capPct.toFixed(1) + '%"></span>' +
        '<span class="sc-scale-over sc-growx" style="width:' + (100 - capPct).toFixed(1) + '%;animation-delay:.15s"></span>' +
        '<span class="sc-scale-cap" style="left:' + capPct.toFixed(1) + '%" title="司法保护上限 ' + esc(opts.capLabel || "") + '">' +
          '<span class="sc-scale-cap-t">上限 ' + esc(opts.capLabel || "") + '</span></span>' +
        '<span class="sc-scale-mark' + (over ? ' over' : '') + ' sc-pop" style="left:' + ratePct.toFixed(1) + '%;animation-delay:.3s" title="约定利率 ' + esc(opts.rateLabel || "") + '">' +
          '<span class="sc-scale-mark-t">' + esc(opts.rateLabel || "") + '</span></span>' +
      '</div>' +
      '<div class="sc-scale-legend"><span style="color:var(--ok)">■ 受保护区间</span><span style="color:var(--danger)">■ 超限不受保护</span></div>' +
      '</div>';
  }

  /* ---------- ladder(amount, brackets)：等宽累进阶梯 ----------
     brackets: [{ up, rate, rateLabel?, label }]（依次递增，最后一段 up=Infinity）；
     已跨过段=主色填充，当前所在段=深色+描边，未达段=灰；
     只标法定费率，不预测结果 */
  function ladder(amount, brackets) {
    var segs = (brackets || []).map(function (b, i) {
      var lower = i === 0 ? 0 : brackets[i - 1].up;
      var reached = (amount || 0) > lower;
      var active = (amount || 0) > lower && (amount || 0) <= b.up;
      return '<div class="sc-ladder-seg' + (active ? " active" : reached ? " reached" : "") + '" title="' + esc(b.label) + " · " + esc(b.rateLabel || b.rate) + '">' +
        '<span class="sc-ladder-bar" style="animation-delay:' + (i * 40) + 'ms"></span><span class="sc-ladder-t">' + esc(b.label) + '</span><span class="sc-ladder-r">' + esc(b.rateLabel || b.rate) + '</span></div>';
    }).join("");
    return '<div class="sc-ladder">' + segs + '</div>';
  }

  /* ---------- radar(dims)：信息完备度雷达（N 轴通用，评估矩阵为 3 轴三角） ----------
     dims: [{ label, score 0–1, note? }]；网格 3 圈 + 数据多边形 + 顶点标签；
     只表达信息/证据完备程度（免责口径：非胜诉率） */
  function radar(dims, opts) {
    opts = opts || {};
    var size = opts.size || 210, cx = size / 2, cy = size / 2 + 4, R = size * 0.34;
    var ds = (dims || []).filter(function (d) { return d && isFinite(d.score); });
    if (ds.length < 3) return "";
    var pt = function (i, ratio) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / ds.length;
      return [cx + Math.cos(ang) * R * ratio, cy + Math.sin(ang) * R * ratio];
    };
    var grid = [1 / 3, 2 / 3, 1].map(function (ratio) {
      var pts = ds.map(function (d, i) { var p = pt(i, ratio); return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
      return '<polygon points="' + pts + '" fill="none" style="stroke:var(--line)" stroke-width="1"/>';
    }).join("");
    var axes = ds.map(function (d, i) {
      var p = pt(i, 1);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" style="stroke:var(--line)" stroke-width="1"/>';
    }).join("");
    var dataPts = ds.map(function (d, i) { var p = pt(i, Math.max(0.04, Math.min(1, d.score))); return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    var dots = ds.map(function (d, i) {
      var p = pt(i, Math.max(0.04, Math.min(1, d.score)));
      var c = '<circle class="sc-pop" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" style="fill:var(--c-info);animation-delay:' + (i * 80) + 'ms">';
      if (d.note) c += '<title>' + esc(d.note) + '</title>';
      return c + '</circle>';
    }).join("");
    var labels = ds.map(function (d, i) {
      var p = pt(i, 1.22);
      var anchor = Math.abs(p[0] - cx) < 12 ? "middle" : (p[0] > cx ? "start" : "end");
      return '<text x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" text-anchor="' + anchor + '" dominant-baseline="middle" font-size="10.5" font-weight="600" fill="currentColor">' + esc(d.label) + "</text>";
    }).join("");
    return '<svg width="' + size + '" height="' + (size + 6) + '" viewBox="0 0 ' + size + ' ' + (size + 6) + '" style="display:block;margin:0 auto" role="img" aria-label="' + esc(opts.aria || "信息完备度雷达") + '">' +
      grid + axes +
      '<polygon class="sc-fade" points="' + dataPts + '" style="fill:var(--c-info);fill-opacity:.22;stroke:var(--c-info)" stroke-width="1.8"/>' +
      dots + labels + "</svg>";
  }

  /* ---------- lanes(rows)：路径泳道示意条 ----------
     rows: [{ label, sub, len 0–1, color }]；len/color 为按文本描述归档的示意刻度（非精确数值） */
  function lanes(rows) {
    return '<div class="sc-lanes">' + (rows || []).map(function (r, i) {
      var len = Math.max(12, Math.min(100, (isFinite(r.len) ? r.len : 0.5) * 100));
      return '<div class="sc-lane"><span class="sc-lane-name">' + esc(r.label || "") + '</span>' +
        '<span class="sc-lane-track"><span class="sc-lane-fill sc-growx" style="width:' + len.toFixed(0) + "%;background:" + esc(r.color || "var(--c-info)") + ';animation-delay:' + (i * 80) + 'ms"></span>' +
        '<span class="sc-lane-sub">' + esc(r.sub || "") + '</span></span></div>';
    }).join("") + '</div>';
  }

  return { ring: ring, stepper: stepper, scale: scale, ladder: ladder, radar: radar, lanes: lanes };
})();
