/* 10262 Scouting — combining several scouts' reports into one answer.
 * Pure functions, no browser APIs, so they can be tested on their own. */
(function (root) {
  const isBlank = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

  function round(n, d = 1) {
    const p = Math.pow(10, d);
    return Math.round(n * p) / p;
  }

  /** "~115 lbs" → 115, "50-60" → 55, "Don't know" → null */
  function parseLooseNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (isBlank(v)) return null;
    const s = String(v).replace(/,/g, " ");
    const range = s.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
    if (range) return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
    const one = s.match(/\d+(?:\.\d+)?/);
    return one ? parseFloat(one[0]) : null;
  }

  /** A scout who submits twice for the same thing counts once (their newest). */
  function latestPerScout(reports, keyFn) {
    const best = new Map();
    for (const r of reports) {
      if (r.deleted) continue;
      const k = keyFn(r);
      const cur = best.get(k);
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) best.set(k, r);
    }
    return [...best.values()];
  }

  function combineField(field, entries) {
    // entries: [{scout, v}] with blanks already removed
    const n = entries.length;
    if (!n) return { n: 0, value: null, display: "" };
    const t = field.type;
    if (t === "toggle") {
      const yes = entries.filter((e) => e.v === true || e.v === 1 || e.v === "true" || e.v === "Yes").length;
      const rate = yes / n;
      const display = n === 1 ? (yes ? "Yes" : "No") : yes === n ? `Yes (${n}/${n})` : yes === 0 ? `No (0/${n})` : `Yes ${yes}/${n}`;
      return { n, value: rate, display, yes, disagree: yes > 0 && yes < n };
    }
    if (t === "number" || t === "rating" || t === "counter") {
      const nums = entries.map((e) => parseLooseNumber(e.v)).filter((x) => x !== null);
      if (!nums.length) return { n: 0, value: null, display: "" };
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      const min = Math.min(...nums), max = Math.max(...nums);
      const spread = nums.length > 1 && max !== min ? ` (${round(min)}–${round(max)})` : "";
      return { n: nums.length, value: round(avg, 2), display: `${round(avg)}${spread}`, values: nums, disagree: nums.length > 1 && max - min >= (t === "rating" ? 2 : Math.max(10, avg * 0.4)) };
    }
    if (t === "choice") {
      const counts = {};
      for (const e of entries) counts[e.v] = (counts[e.v] || 0) + 1;
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const [top, c] = sorted[0];
      const tie = sorted.length > 1 && sorted[1][1] === c;
      const display = sorted.length === 1 ? top : sorted.map(([k, v]) => `${k} (${v})`).join(", ");
      return { n, value: tie ? null : top, display, counts, disagree: sorted.length > 1 };
    }
    if (t === "multi") {
      const counts = {};
      for (const e of entries) for (const o of [].concat(e.v)) counts[o] = (counts[o] || 0) + 1;
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const display = sorted.map(([k, v]) => (n > 1 ? `${k} (${v}/${n})` : k)).join(", ");
      // "value" = options chosen by at least half the scouts
      return { n, value: sorted.filter(([, v]) => v * 2 >= n).map(([k]) => k), display, counts };
    }
    // text / longtext: keep everyone's words
    const parts = entries.map((e) => (n > 1 ? `${e.scout || "?"}: ${e.v}` : String(e.v)));
    return { n, value: parts.join(" | "), display: parts.join("\n"), parts: entries };
  }

  function combineReports(fields, reports) {
    const out = {};
    for (const f of fields) {
      if (f.type === "header") continue;
      const entries = [];
      for (const r of reports) {
        const v = r.data ? r.data[f.key] : undefined;
        if (!isBlank(v)) entries.push({ scout: r.scout, v });
      }
      out[f.key] = combineField(f, entries);
    }
    out._count = reports.length;
    out._scouts = [...new Set(reports.map((r) => r.scout).filter(Boolean))];
    return out;
  }

  /** Team Summary tab: averages from match scouting, overall score, rank. */
  function teamSummary(matchReports, matchFields) {
    const mk = (r) => (r.data && r.data.mk) || ("qm" + r.match);
    const counted = latestPerScout(matchReports, (r) => `${r.team}|${mk(r)}|${r.scout}`);
    const byTeam = new Map();
    for (const r of counted) {
      if (!byTeam.has(r.team)) byTeam.set(r.team, []);
      byTeam.get(r.team).push(r);
    }
    const rows = [];
    for (const [team, reps] of byTeam) {
      // First average the scouts within each match, then average across matches,
      // so a match watched by 3 scouts doesn't count 3 times.
      const byMatch = new Map();
      for (const r of reps) {
        if (!byMatch.has(mk(r))) byMatch.set(mk(r), []);
        byMatch.get(mk(r)).push(r);
      }
      const perMatch = [...byMatch.values()].map((rs) => combineReports(matchFields, rs));
      const avgOf = (key) => {
        const vals = perMatch.map((c) => c[key] && c[key].value).filter((v) => typeof v === "number");
        return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null;
      };
      const row = {
        team,
        avgAuto: avgOf("auto"),
        avgTeleop: avgOf("teleop"),
        avgEndgame: avgOf("endgame"),
        avgDefense: avgOf("defense"),
        avgDriver: avgOf("driver"),
        matches: byMatch.size,
        reports: reps.length,
        problems: reps.filter((r) => r.data && r.data.problems && r.data.problems !== "None").length
      };
      row.overall = round((row.avgAuto || 0) + (row.avgTeleop || 0) + (row.avgEndgame || 0), 2);
      rows.push(row);
    }
    rows.sort((a, b) => b.overall - a.overall);
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }

  root.ESCombine = { parseLooseNumber, latestPerScout, combineField, combineReports, teamSummary, isBlank, round };
})(typeof self !== "undefined" ? self : globalThis);
