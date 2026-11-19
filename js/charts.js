/* 10262 Scouting — small SVG charts (no library). Colours come from CSS variables
 * (--c-auto, --c-teleop, --c-endgame…), validated for colour-blind safety; every
 * chart also has hover/keyboard tooltips and a table of the same numbers on its page. */
(function (root) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PHASE_SERIES = [
    { id: "auto", label: "Auto", color: "var(--c-auto)" },
    { id: "teleop", label: "Teleop", color: "var(--c-teleop)" },
    { id: "endgame", label: "Endgame", color: "var(--c-endgame)" },
    { id: "other", label: "Other", color: "var(--c-other)" }
  ];

  function niceMax(v) {
    if (!(v > 0)) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  const fmt = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? "—" : Number(v).toFixed(d).replace(/\.0+$/, ""));
  const tick = (v) => (v >= 10000 ? Math.round(v / 1000) + "K" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));

  /** Rectangle with rounded top corners (data end), square at the baseline. */
  function topRounded(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h, w / 2));
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  /** Rectangle with rounded right corners (data end of a horizontal bar). */
  function rightRounded(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w, h / 2));
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  const legend = (series) => `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`;

  /** Points per match, stacked by phase. matches: [{label, pts:{auto,teleop,endgame,pre,post,total}, problems:[]}] */
  function phaseColumns(matches, opts = {}) {
    const H = opts.height || 220, W = Math.max(320, opts.width || 640);
    const padL = 40, padR = 56, padT = 12, padB = 40;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const vals = matches.map((m) => ({ auto: m.pts.auto, teleop: m.pts.teleop, endgame: m.pts.endgame, other: (m.pts.pre || 0) + (m.pts.post || 0) }));
    const max = niceMax(Math.max(opts.yMax || 0, ...matches.map((m) => m.pts.total), opts.avg || 0));
    const used = PHASE_SERIES.filter((s) => vals.some((v) => v[s.id] > 0) || s.id !== "other");
    const y = (v) => padT + plotH - (v / max) * plotH;
    const band = plotW / Math.max(1, matches.length);
    const bw = Math.min(24, Math.max(6, band * 0.6));
    const every = Math.ceil(30 / band);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chartsvg" role="img" aria-label="${esc(opts.title || "Points per match")}">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="${i ? "grid" : "axis"}"/><text x="${padL - 6}" y="${yy + 4}" class="tick" text-anchor="end">${tick(v)}</text>`;
    }
    matches.forEach((m, i) => {
      const cx = padL + band * i + band / 2, x = cx - bw / 2;
      let base = 0;
      const segs = used.map((s) => ({ s, v: Math.max(0, vals[i][s.id] || 0) })).filter((p) => p.v > 0);
      segs.forEach((p, j) => {
        const top = y(base + p.v), bot = y(base);
        const gap = j > 0 ? 2 : 0;           // 2px surface gap between stacked segments
        const h = Math.max(0, bot - top - gap);
        const d = j === segs.length - 1 ? topRounded(x, top, bw, h, 4) : `M${x},${top}h${bw}v${h}h${-bw}Z`;
        if (h > 0.5) svg += `<path d="${d}" fill="${p.s.color}"/>`;
        base += p.v;
      });
      const tip = [`${fmt(m.pts.total, 1)} pts`, m.label, ...used.map((s) => `${s.label}: ${fmt(vals[i][s.id], 1)}`), ...(m.problems && m.problems.length ? [`⚠ ${m.problems.join(", ")}`] : [])].join("|");
      svg += `<rect x="${cx - band / 2}" y="${padT}" width="${band}" height="${plotH + padB}" fill="transparent" class="hit" tabindex="0" data-tip="${esc(tip)}"/>`;
      if (i % every === 0) svg += `<text x="${cx}" y="${H - padB + 16}" class="tick" text-anchor="middle">${esc(m.label)}</text>`;
      if (m.problems && m.problems.length) svg += `<text x="${cx}" y="${H - padB + 32}" class="warnmark" text-anchor="middle">⚠</text>`;
    });
    if (opts.avg != null && isFinite(opts.avg) && matches.length) {
      const ya = y(opts.avg);
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${ya}" y2="${ya}" class="refline"/><text x="${W - padR + 4}" y="${ya + 4}" class="reflabel">avg ${fmt(opts.avg, 1)}</text>`;
    }
    svg += `</svg>`;
    return `<div class="chart">${legend(used)}${svg}<div class="tip" hidden></div></div>`;
  }

  /** One horizontal bar per team, stacked by phase average, total at the end. rows: [{label, href, auto, teleop, endgame, total, sub}] */
  function phaseBars(rows, opts = {}) {
    const rowH = 30, bh = 16, padL = opts.labelW || 150, padR = 56, W = Math.max(360, opts.width || 760);
    const plotW = W - padL - padR, H = rows.length * rowH + 30;
    const max = niceMax(Math.max(...rows.map((r) => r.total || 0), 1));
    const x = (v) => padL + (v / max) * plotW;
    const series = PHASE_SERIES.slice(0, 3);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chartsvg" role="img" aria-label="${esc(opts.title || "Average points by phase")}">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, xx = x(v);
      svg += `<line x1="${xx}" x2="${xx}" y1="4" y2="${H - 22}" class="${i ? "grid" : "axis"}"/><text x="${xx}" y="${H - 6}" class="tick" text-anchor="middle">${tick(v)}</text>`;
    }
    rows.forEach((r, i) => {
      const yy = 6 + i * rowH, by = yy + (rowH - bh) / 2 - 3;
      svg += `<text x="${padL - 8}" y="${by + bh - 3}" class="rowlabel" text-anchor="end">${esc(r.label)}</text>`;
      let base = 0;
      const segs = series.map((s) => ({ s, v: Math.max(0, r[s.id] || 0) })).filter((p) => p.v > 0);
      segs.forEach((p, j) => {
        const x0 = x(base) + (j > 0 ? 2 : 0), w = Math.max(0, x(base + p.v) - x(base) - (j > 0 ? 2 : 0));
        const d = j === segs.length - 1 ? rightRounded(x0, by, w, bh, 4) : `M${x0},${by}h${w}v${bh}h${-w}Z`;
        if (w > 0.5) svg += `<path d="${d}" fill="${p.s.color}"/>`;
        base += p.v;
      });
      svg += `<text x="${x(base) + 6}" y="${by + bh - 3}" class="vallabel">${fmt(r.total, 1)}</text>`;
      const tip = [`${fmt(r.total, 1)} pts avg`, r.label, ...series.map((s) => `${s.label}: ${fmt(r[s.id], 1)}`), ...(r.sub ? [r.sub] : [])].join("|");
      svg += `<rect x="0" y="${yy - 2}" width="${W}" height="${rowH}" fill="transparent" class="hit" tabindex="0" data-tip="${esc(tip)}" ${r.href ? `data-href="${esc(r.href)}"` : ""}/>`;
    });
    svg += `</svg>`;
    return `<div class="chart">${legend(series)}${svg}<div class="tip" hidden></div></div>`;
  }

  /** Win chance as one bar split red / blue. */
  function winBar(redP) {
    const r = Math.round(redP * 100), b = 100 - r;
    const seg = (cls, p, name) => `<div class="seg ${cls}" style="flex:${Math.max(p, 0.001)}" tabindex="0" data-tip="${p}% chance|${name} alliance wins">${p >= 12 ? p + "%" : ""}</div>`;
    return `<div class="chart"><div class="segbar">${seg("red", r, "Red")}${seg("blue", b, "Blue")}</div>
      <div class="legend"><span><i style="background:var(--c-red)"></i>Red ${r}%</span><span><i style="background:var(--c-blue)"></i>Blue ${b}%</span></div><div class="tip" hidden></div></div>`;
  }

  /** Tiny trend line for table cells: muted line, last point in the accent. */
  function sparkline(values, w = 64, h = 18) {
    const v = values.filter((x) => isFinite(x));
    if (v.length < 2) return "";
    const max = Math.max(...v, 1), min = Math.min(...v, 0);
    const px = (i) => 2 + (i / (v.length - 1)) * (w - 4), py = (x) => h - 2 - ((x - min) / (max - min || 1)) * (h - 4);
    const pts = v.map((x, i) => `${px(i).toFixed(1)},${py(x).toFixed(1)}`).join(" ");
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--muted-ink)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${px(v.length - 1)}" cy="${py(v[v.length - 1])}" r="2.5" fill="var(--c-auto)"/></svg>`;
  }

  /** Hover / keyboard-focus tooltips for every chart inside `container`. Lines come from data-tip="a|b|c". */
  function wire(container) {
    container.querySelectorAll(".chart").forEach((chart) => {
      const tipEl = chart.querySelector(".tip");
      if (!tipEl) return;
      const show = (target, clientX, clientY) => {
        const parts = (target.getAttribute("data-tip") || "").split("|");
        tipEl.textContent = "";
        parts.forEach((p, i) => { const d = document.createElement(i === 0 ? "b" : "div"); d.textContent = p; tipEl.appendChild(d); });
        tipEl.hidden = false;
        const cr = chart.getBoundingClientRect(), tr = target.getBoundingClientRect();
        const x = (clientX ?? tr.left + tr.width / 2) - cr.left, yv = (clientY ?? tr.top) - cr.top;
        const w = tipEl.offsetWidth;
        tipEl.style.left = Math.min(Math.max(4, x + 12), cr.width - w - 4) + "px";
        tipEl.style.top = Math.max(4, yv - tipEl.offsetHeight - 10) + "px";
      };
      const hide = () => { tipEl.hidden = true; };
      chart.querySelectorAll("[data-tip]").forEach((el) => {
        el.addEventListener("pointermove", (e) => show(el, e.clientX, e.clientY));
        el.addEventListener("pointerleave", hide);
        el.addEventListener("focus", () => show(el));
        el.addEventListener("blur", hide);
        if (el.dataset.href) el.addEventListener("click", () => { location.hash = el.dataset.href; });
      });
    });
  }

  root.ESCharts = { phaseColumns, phaseBars, winBar, sparkline, wire, niceMax, PHASE_SERIES };
})(typeof self !== "undefined" ? self : globalThis);
