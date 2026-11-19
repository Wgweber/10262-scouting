/* 10262 Scouting — the numbers: points per phase, consistency, reliability,
 * predictions and pick scores. Works for any game definition. Pure logic. */
(function (root) {
  const G = root.ESGame, C = root.ESCombine, T = root.ESTba;
  const mkOf = (r) => (r.data && r.data.mk) || ("qm" + r.match);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  function sd(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  }
  function slope(ys) {
    const n = ys.length;
    if (n < 3) return 0;
    const mx = (n - 1) / 2, my = mean(ys);
    let num = 0, den = 0;
    ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) * (i - mx); });
    return den ? num / den : 0;
  }
  const PTS = ["pre", "auto", "teleop", "endgame", "post", "total", "penalty"];

  /** Everything scouted about each team's matches. Scouts watching the same robot in the
   *  same match are averaged first, so each match counts once. */
  function teamStats(matchReports, game) {
    const fields = G.dataFields(game, "match");
    const counted = C.latestPerScout(matchReports.filter((r) => !r.deleted), (r) => `${r.team}|${mkOf(r)}|${r.scout || r.device}`);
    const byTeam = new Map();
    for (const r of counted) { if (!byTeam.has(r.team)) byTeam.set(r.team, []); byTeam.get(r.team).push(r); }
    const out = new Map();
    for (const [team, reps] of byTeam) {
      const byMatch = new Map();
      for (const r of reps) { const k = mkOf(r); if (!byMatch.has(k)) byMatch.set(k, []); byMatch.get(k).push(r); }
      const matches = [...byMatch].map(([mk, rs]) => {
        const pts = Object.fromEntries(PTS.map((k) => [k, 0]));
        const fieldPts = {};
        for (const r of rs) {
          const p = G.reportPoints(r.data, game);
          for (const k of PTS) pts[k] += p[k] / rs.length;
          for (const f of fields) fieldPts[f.key] = (fieldPts[f.key] || 0) + G.fieldPoints(f, r.data && r.data[f.key]) / rs.length;
        }
        const problems = [...new Set(rs.flatMap((r) => G.reportProblems(r.data, game)))];
        return {
          mk, label: T.label(mk), sort: T.sortValue(mk), reports: rs,
          scouts: [...new Set(rs.map((r) => r.scout).filter(Boolean))],
          pts, fieldPts, combined: C.combineReports(fields, rs), problems
        };
      }).sort((a, b) => a.sort - b.sort);
      const totals = matches.map((m) => m.pts.total);
      const n = matches.length;
      const avg = Object.fromEntries(PTS.map((k) => [k, mean(matches.map((m) => m.pts[k]))]));
      const problemMatches = matches.filter((m) => m.problems.length).length;
      const fstats = {};
      for (const f of fields) {
        const per = matches.map((m) => m.combined[f.key]).filter((c) => c && c.n);
        const s = { n: per.length, avgPts: mean(matches.map((m) => m.fieldPts[f.key] || 0)) };
        if (["counter", "number", "rating"].includes(f.type)) {
          const xs = per.map((c) => c.value).filter((v) => typeof v === "number");
          Object.assign(s, { n: xs.length, avg: mean(xs), max: xs.length ? Math.max(...xs) : null, sd: sd(xs) });
        } else if (f.type === "toggle") {
          s.rate = mean(per.map((c) => c.value));
        } else if (f.type === "choice" || f.type === "multi") {
          const counts = {};
          for (const c of per) for (const [k, v] of Object.entries(c.counts || {})) counts[k] = (counts[k] || 0) + v / (c.n || 1);
          s.counts = counts; // in matches (fractions when scouts disagreed)
        }
        fstats[f.key] = s;
      }
      out.set(team, {
        team, n, reports: reps.length, matches, avg,
        max: n ? Math.max(...totals) : null, min: n ? Math.min(...totals) : null,
        sd: sd(totals), recent: mean(totals.slice(-3)), trend: slope(totals),
        reliability: n ? 1 - problemMatches / n : null, problemMatches, fields: fstats
      });
    }
    return out;
  }

  // ---------------- predictions ----------------
  function erf(x) {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

  /** Expected score of an alliance from each robot's average (or a fallback when unscouted). */
  function allianceEstimate(teams, statsMap, fallback) {
    let total = 0, varSum = 0, penalty = 0, known = 0;
    const parts = teams.filter(Boolean).map((t) => {
      const s = statsMap.get(Number(t));
      if (s && s.n) {
        const m = s.avg.total, d = Math.max(s.n > 1 ? s.sd : m * 0.35, 3);
        total += m; varSum += d * d; penalty += s.avg.penalty || 0; known++;
        return { team: Number(t), mean: m, sd: d, source: "scouted", n: s.n };
      }
      const e = fallback && fallback.byTeam ? fallback.byTeam.get(Number(t)) : null;
      const m = e != null ? e : (fallback && fallback.avg) || 0, d = Math.max(m * 0.4, 5);
      total += m; varSum += d * d;
      return { team: Number(t), mean: m, sd: d, source: e != null ? "EPA" : "event average" };
    });
    return { mean: total, sd: Math.sqrt(varSum), penalty, known, parts };
  }
  /** Predicted scores and win chance. Each alliance also gets the foul points the other side tends to give away. */
  function predictMatch(red, blue, statsMap, fallback) {
    const R = allianceEstimate(red, statsMap, fallback), B = allianceEstimate(blue, statsMap, fallback);
    const redScore = R.mean + B.penalty, blueScore = B.mean + R.penalty;
    const spread = Math.sqrt(R.sd * R.sd + B.sd * B.sd) || 1;
    return { red: R, blue: B, redScore, blueScore, redWin: normCdf((redScore - blueScore) / spread) };
  }

  // ---------------- metrics (columns, pick score, compare) ----------------
  const PHASE_SHORT = { pre: "Pre", auto: "Auto", teleop: "Teleop", endgame: "Endgame", post: "Post" };
  function metrics(model) {
    const g = model.game, list = [];
    const st = (t) => model.stats.get(t.number);
    const add = (id, label, get, o = {}) => list.push(Object.assign({ id, label, get, better: "high", digits: 1, group: "Scouting" }, o));
    const safe = (fn) => (t) => { try { const v = fn(t); return v === undefined || v === null || !isFinite(v) ? null : v; } catch (e) { return null; } };
    add("total", "Avg points", safe((t) => st(t).avg.total), { group: "Points", key: true });
    add("auto", "Avg auto", safe((t) => st(t).avg.auto), { group: "Points", key: true });
    add("teleop", "Avg teleop", safe((t) => st(t).avg.teleop), { group: "Points", key: true });
    add("endgame", "Avg endgame", safe((t) => st(t).avg.endgame), { group: "Points", key: true });
    add("max", "Best match", safe((t) => st(t).max), { group: "Points" });
    add("recent", "Last 3 avg", safe((t) => st(t).recent), { group: "Points" });
    add("sd", "Spread (±)", safe((t) => (st(t).n > 1 ? st(t).sd : null)), { group: "Points", better: "low", help: "How much their score jumps around. Lower = more consistent." });
    add("rel", "Reliability %", safe((t) => st(t).reliability * 100), { group: "Points", digits: 0, key: true, help: "Matches without a reported problem" });
    if (g.match.some((f) => f.penalty)) add("pen", "Foul pts given", safe((t) => st(t).avg.penalty), { group: "Points", better: "low" });
    add("n", "Matches scouted", safe((t) => (st(t) ? st(t).n : 0)), { group: "Points", digits: 0, pick: false });
    for (const f of G.dataFields(g, "match")) {
      const ph = PHASE_SHORT[f.phase] || "";
      const lab = `${ph}: ${f.label}`;
      if (["counter", "number", "rating"].includes(f.type)) add("m." + f.key, lab, safe((t) => st(t).fields[f.key].avg), { group: "Match form", retired: f.retired });
      else if (f.type === "toggle") add("m." + f.key, `${lab} %`, safe((t) => st(t).fields[f.key].rate * 100), { group: "Match form", digits: 0, retired: f.retired, better: f.problem ? "low" : "high" });
      else if ((f.type === "choice" || f.type === "multi") && Object.keys(f.optionPoints || {}).length) add("m." + f.key, `${lab} (avg pts)`, safe((t) => st(t).fields[f.key].avgPts), { group: "Match form", retired: f.retired });
    }
    for (const f of G.dataFields(g, "rating")) if (f.type === "rating" || f.type === "number" || f.type === "counter") add("r." + f.key, f.label, safe((t) => t.rating[f.key].value), { group: "Ratings" });
    for (const f of G.dataFields(g, "pit")) if (f.type === "number" || f.type === "counter" || f.type === "rating") add("p." + f.key, f.label, safe((t) => t.pit[f.key].value), { group: "Pit", pick: false });
    if (model.tba) {
      add("tba.rank", "Event rank", safe((t) => t.tba.rank), { group: "Blue Alliance", digits: 0, better: "low" });
      add("tba.opr", "OPR", safe((t) => t.tba.opr), { group: "Blue Alliance" });
      add("tba.rp", "Avg ranking pts", safe((t) => t.tba.rpAvg), { group: "Blue Alliance", digits: 2 });
    }
    if (model.epa) add("epa", "EPA (Statbotics)", safe((t) => t.epa), { group: "Statbotics" });
    return list;
  }

  /** 0–100 score from weighted metrics, each scaled across the event (best team = 100% of that metric). */
  function pickScores(model, weights) {
    const ms = metrics(model).filter((m) => (weights[m.id] || 0) > 0);
    const res = new Map();
    if (!ms.length) return res;
    const range = {};
    for (const m of ms) {
      const vals = model.teams.map((t) => m.get(t)).filter((v) => v !== null);
      range[m.id] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0];
    }
    for (const t of model.teams) {
      let sum = 0, wsum = 0;
      for (const m of ms) {
        const w = weights[m.id], v = m.get(t);
        wsum += w;
        if (v === null) continue; // no data counts as the bottom of the scale
        const [lo, hi] = range[m.id];
        let x = hi > lo ? (v - lo) / (hi - lo) : 1;
        if (m.better === "low") x = 1 - x;
        sum += w * x;
      }
      res.set(t.number, wsum ? Math.round((sum / wsum) * 1000) / 10 : null);
    }
    return res;
  }

  const fmt = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? "—" : (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d));

  root.ESStats = { teamStats, predictMatch, allianceEstimate, metrics, pickScores, normCdf, mean, sd, slope, fmt, mkOf, PHASE_SHORT };
})(typeof self !== "undefined" ? self : globalThis);
