/* 10262 Scouting — The Blue Alliance import (schedule, scores, team list).
 * Needs internet and a TBA "Read API Key". The key stays on this device only. */
(function (root) {
  const API = "https://www.thebluealliance.com/api/v3";
  const LEVEL = { qm: "Q", ef: "EF", qf: "QF", sf: "SF", f: "F" };
  const ORDER = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

  function shortKey(m) {
    return m.comp_level === "qm" ? `qm${m.match_number}` : `${m.comp_level}${m.set_number}m${m.match_number}`;
  }
  function label(mk) {
    const q = /^qm(\d+)$/.exec(mk);
    if (q) return `Q${q[1]}`;
    const p = /^([a-z]+)(\d+)m(\d+)$/.exec(mk || "");
    return p ? `${LEVEL[p[1]] || p[1].toUpperCase()}${p[2]}-${p[3]}` : String(mk || "");
  }
  function sortValue(mk) {
    const q = /^qm(\d+)$/.exec(mk);
    if (q) return Number(q[1]);
    const p = /^([a-z]+)(\d+)m(\d+)$/.exec(mk || "");
    return p ? 10000 + (ORDER[p[1]] || 9) * 1000 + Number(p[2]) * 10 + Number(p[3]) : 99999;
  }
  const num = (k) => Number(String(k).replace("frc", ""));

  async function get(path, key) {
    const res = await fetch(API + path, { headers: { "X-TBA-Auth-Key": key } });
    if (res.status === 401) throw new Error("The Blue Alliance rejected the API key. Check it in Settings.");
    if (res.status === 404) throw new Error("Event not found on The Blue Alliance. Check the event code (e.g. 2026njbr).");
    if (!res.ok) throw new Error(`The Blue Alliance error ${res.status}`);
    return res.json();
  }

  /** Returns records ready to save: matchdata + team records. */
  async function fetchEvent(event, key) {
    if (!key) throw new Error("Add your Blue Alliance API key in Settings first.");
    const [matches, teams] = await Promise.all([
      get(`/event/${event}/matches/simple`, key),
      get(`/event/${event}/teams/simple`, key).catch(() => [])
    ]);
    const md = matches.map((m) => {
      const mk = shortKey(m);
      const red = m.alliances.red, blue = m.alliances.blue;
      return {
        id: `md:${event}:${mk}`, kind: "matchdata", event, match: m.comp_level === "qm" ? m.match_number : undefined,
        scout: "The Blue Alliance",
        data: {
          mk, label: label(mk), key: m.key, time: m.predicted_time || m.time || null,
          red: red.team_keys.map(num), blue: blue.team_keys.map(num),
          redScore: red.score >= 0 ? red.score : null, blueScore: blue.score >= 0 ? blue.score : null,
          winner: m.winning_alliance || (red.score >= 0 && red.score === blue.score ? "tie" : "")
        }
      };
    });
    return { matches: md, teams: teams.map((t) => ({ number: t.team_number, name: t.nickname || t.name || "" })) };
  }

  /** Event standings (rank, record, avg ranking points) and OPR / DPR / CCWM, keyed by team number.
   *  Either part can be missing early in an event; whatever is available is returned. */
  async function fetchEventStats(event, key) {
    if (!key) throw new Error("Add your Blue Alliance API key in Settings first.");
    const [rk, op] = await Promise.all([get(`/event/${event}/rankings`, key).catch(() => null), get(`/event/${event}/oprs`, key).catch(() => null)]);
    const teams = {};
    const t = (n) => (teams[n] = teams[n] || {});
    if (rk && Array.isArray(rk.rankings)) {
      const info = (rk.sort_order_info || []).map((x) => (x && x.name) || "");
      for (const r of rk.rankings) {
        const o = t(num(r.team_key));
        o.rank = r.rank;
        if (r.record) { o.wins = r.record.wins; o.losses = r.record.losses; o.ties = r.record.ties; }
        o.played = r.matches_played;
        if (Array.isArray(r.sort_orders) && r.sort_orders.length) { o.rpAvg = r.sort_orders[0]; o.rankingScoreName = info[0] || "Ranking score"; }
      }
    }
    if (op && op.oprs) for (const [k, v] of Object.entries(op.oprs)) {
      const o = t(num(k)); o.opr = v;
      if (op.dprs) o.dpr = op.dprs[k];
      if (op.ccwms) o.ccwm = op.ccwms[k];
    }
    return { teams, hasRankings: !!(rk && rk.rankings && rk.rankings.length), hasOprs: !!(op && op.oprs && Object.keys(op.oprs).length) };
  }

  /** Statbotics EPA (expected points added) for every team at an event. No key needed.
   *  Read defensively: only the overall EPA number is used. */
  async function fetchEpa(event) {
    const res = await fetch(`https://api.statbotics.io/v3/team_events?event=${encodeURIComponent(event)}&limit=200`);
    if (!res.ok) throw new Error(`Statbotics error ${res.status}`);
    const rows = await res.json();
    const teams = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      const e = r && r.epa;
      const v = e && (e.total_points && typeof e.total_points.mean === "number" ? e.total_points.mean
        : e.breakdown && typeof e.breakdown.total_points === "number" ? e.breakdown.total_points
        : typeof e.mean === "number" ? e.mean : typeof e.current === "number" ? e.current : null);
      if (r && r.team != null && v != null) teams[Number(r.team)] = Math.round(v * 10) / 10;
    }
    return { teams, count: Object.keys(teams).length };
  }

  root.ESTba = { fetchEvent, fetchEventStats, fetchEpa, label, sortValue };
})(typeof self !== "undefined" ? self : globalThis);
