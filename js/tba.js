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

  root.ESTba = { fetchEvent, label, sortValue };
})(typeof self !== "undefined" ? self : globalThis);
