/* Eruption Scout — Excel import/export, JSON backups, QR payloads. */
(function (root) {
  const C = root.ESCombine;

  // ---------- helpers ----------
  const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const teamNum = (v) => { const n = C.parseLooseNumber(v); return n && n > 0 && n < 100000 ? Math.round(n) : null; };
  const rating = (v) => { const n = C.parseLooseNumber(v); return n >= 1 && n <= 5 ? n : ""; };
  function hash(s) { // short stable hash so re-importing never makes duplicates
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function pickOption(v, options) {
    const s = str(v);
    if (!s) return "";
    const hit = options.find((o) => o.toLowerCase() === s.toLowerCase());
    return hit || s;
  }
  function splitMulti(v, options) {
    return str(v).split(/\s*,\s*/).filter(Boolean).map((x) => pickOption(x, options));
  }
  function rowsOf(ws) { return root.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }); }

  // ---------- import your existing workbook ----------
  /** Reads Brunswick_Eruption_Scouting.xlsx-style workbooks. Returns records + a report. */
  function importWorkbook(arrayBuffer, event, game) {
    const wb = root.XLSX.read(arrayBuffer, { type: "array", cellDates: true });
    const out = [], notes = [];
    const ts = Date.UTC(2026, 0, 1); // imported rows are older than anything typed in the app
    const opt = (key) => (game.pit.concat(game.rating).find((f) => f.key === key) || {}).options || [];

    // Main tab → team info + scouter columns J–R
    const ratingByTeam = new Map();
    const main = wb.Sheets["Main"];
    if (main) {
      let n = 0;
      for (const row of rowsOf(main).slice(1)) {
        const t = teamNum(row[0]);
        if (!t) continue;
        n++;
        out.push({
          id: `team:${event}:${t}`, kind: "team", event, team: t, scout: "Spreadsheet import", updatedAt: ts,
          data: { name: str(row[1]), playoffs: str(row[2]), worlds: str(row[3]),
            awards: [row[4], row[5], row[6]].map(str).filter(Boolean).map((a) => pickOption(a, root.ESFields.AWARDS)) }
        });
        const d = {
          autoCons: rating(row[9]), driverSkill: rating(row[10]), defenseRes: rating(row[11]),
          bestRole: pickOption(row[12], opt("bestRole")), reliability: pickOption(row[13], opt("reliability")),
          threat: pickOption(row[14], opt("threat")), counter: str(row[15]), endgameCons: rating(row[16]), notes: str(row[17])
        };
        ratingByTeam.set(t, d);
      }
      notes.push(`${n} teams from Main`);
    }
    const rr = wb.Sheets["Robot Rankings"];
    if (rr) {
      for (const row of rowsOf(rr).slice(1)) {
        const t = teamNum(row[0]);
        if (!t) continue;
        const d = ratingByTeam.get(t) || {};
        d.tier = str(row[3]); d.autoNotes = str(row[5]); d.teleopNotes = str(row[7]);
        ratingByTeam.set(t, d);
      }
    }
    let nr = 0;
    for (const [t, d] of ratingByTeam) {
      const filled = Object.fromEntries(Object.entries(d).filter(([, v]) => !C.isBlank(v)));
      if (!Object.keys(filled).length) continue;
      nr++;
      out.push({ id: `imp-rating:${event}:${t}`, kind: "rating", event, team: t, scout: "Spreadsheet import", updatedAt: ts, data: filled });
    }
    if (nr) notes.push(`${nr} team ratings`);

    // Google Form responses → pit reports
    let np = 0;
    for (const name of wb.SheetNames.filter((n) => /^form responses/i.test(n))) {
      const rows = rowsOf(wb.Sheets[name]);
      const hdr = (rows[0] || []).map((h) => str(h).toLowerCase());
      const col = (re) => hdr.findIndex((h) => re.test(h));
      const c = {
        time: col(/timestamp/), email: col(/email/), team: col(/team number/), drive: col(/drive/),
        weight: col(/weight/), lang: col(/language/), autoDesc: col(/what can your robot do in auto/),
        autoCap: col(/auto capability/), shooter: col(/shooter type/), acc: col(/accuracy/),
        cap: col(/capacity/), perMatch: col(/per match/), ground: col(/ground intake/), hp: col(/human player/),
        src: col(/collect fuel/), climb: col(/climb/), role: col(/preferred role/), bt: col(/bump/)
      };
      for (const row of rows.slice(1)) {
        const t = teamNum(row[c.team]);
        if (!t) continue;
        const g = (k) => (c[k] >= 0 ? row[c[k]] : "");
        const extra = [];
        const numOrNote = (k, label) => {
          const raw = g(k), n = C.parseLooseNumber(raw);
          if (str(raw) && (typeof raw !== "number")) extra.push(`${label}: ${str(raw)}`);
          return n === null ? "" : n;
        };
        const when = g("time") instanceof Date ? g("time").getTime() : ts;
        const email = str(g("email"));
        const scout = email ? email.split("@")[0] : "Form import";
        let climb = str(g("climb")).replace(/low rug\b/i, "Low rung");
        const data = {
          drive: pickOption(g("drive"), opt("drive")), weight: numOrNote("weight", "Weight"),
          language: pickOption(g("lang"), opt("language")), autoDesc: str(g("autoDesc")),
          autoCap: splitMulti(g("autoCap"), opt("autoCap")), shooter: pickOption(g("shooter"), opt("shooter")),
          accuracy: pickOption(g("acc"), opt("accuracy")), capacity: numOrNote("cap", "Capacity"),
          fuelPerMatch: numOrNote("perMatch", "Fuel per match"), groundIntake: pickOption(g("ground"), opt("groundIntake")),
          hpIntake: pickOption(g("hp"), opt("hpIntake")), fuelSource: pickOption(g("src"), opt("fuelSource")),
          climb: pickOption(climb, opt("climb")), role: pickOption(g("role"), opt("role")),
          bumpTrench: splitMulti(g("bt"), opt("bumpTrench"))
        };
        if (extra.length) data.pitNotes = "As typed on the form: " + extra.join("; ");
        out.push({ id: `imp-pit:${event}:${t}:${hash(String(when) + scout)}`, kind: "pit", event, team: t, scout,
          updatedAt: Math.min(when, Date.now()), data, teamNameOnForm: str(row[3]) });
        np++;
      }
    }
    if (np) notes.push(`${np} pit-scouting form responses`);

    // Match Scouting tab (only rows someone typed in)
    const ms = wb.Sheets["Match Scouting"];
    if (ms) {
      let nm = 0;
      for (const row of rowsOf(ms).slice(1)) {
        const m = teamNum(row[0]), t = teamNum(row[1]);
        if (!m || !t) continue;
        const d = { auto: C.parseLooseNumber(row[3]), teleop: C.parseLooseNumber(row[4]), endgame: C.parseLooseNumber(row[5]),
          defense: rating(row[6]), driver: rating(row[7]), notes: str(row[8]) };
        const filled = Object.fromEntries(Object.entries(d).filter(([, v]) => !C.isBlank(v)));
        if (!Object.keys(filled).length) continue;
        filled.mk = "qm" + m;
        filled.alliance = str(row[2]);
        out.push({ id: `imp-match:${event}:${m}:${t}`, kind: "match", event, team: t, match: m, scout: "Spreadsheet import", updatedAt: ts, data: filled });
        nm++;
      }
      if (nm) notes.push(`${nm} match-scouting rows`);
    }

    // Alliance Selection tab
    const as = wb.Sheets["Alliance Selection"];
    if (as) {
      const rows = rowsOf(as);
      const ranking = [];
      for (let i = 3; i < Math.min(rows.length, 40); i++) {
        const t = teamNum(rows[i][1]);
        if (t) ranking.push({ team: t, notes: str(rows[i][2]) });
      }
      const alliances = [];
      for (let i = 3; i < 11; i++) {
        const r = rows[i] || [];
        alliances.push([teamNum(r[5]), teamNum(r[6]), teamNum(r[7])]);
      }
      if (ranking.length || alliances.some((a) => a.some(Boolean))) {
        out.push({ id: `alliance:${event}`, kind: "alliance", event, scout: "Spreadsheet import", updatedAt: ts, data: { ranking, alliances } });
        notes.push("alliance selection board");
      }
    }
    // Teams that only appear on the form still get a name.
    const known = new Set(out.filter((r) => r.kind === "team").map((r) => r.team));
    for (const r of out.filter((x) => x.kind === "pit")) {
      if (!known.has(r.team) && r.teamNameOnForm) {
        known.add(r.team);
        out.push({ id: `team:${event}:${r.team}`, kind: "team", event, team: r.team, scout: "Spreadsheet import", updatedAt: ts, data: { name: r.teamNameOnForm, awards: [] } });
      }
      delete r.teamNameOnForm;
    }
    if (!out.length) notes.push("Nothing recognisable was found in that file.");
    return { records: out, summary: notes.join(", ") };
  }

  // ---------- export ----------
  function fmt(c) { return c && c.n ? (Array.isArray(c.value) ? c.display : c.display) : ""; }

  function exportWorkbook(model, records) {
    const X = root.XLSX, wb = X.utils.book_new(), g = model.game;
    const add = (name, rows, widths) => {
      const ws = X.utils.aoa_to_sheet(rows);
      if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
      ws["!freeze"] = { xSplit: 1, ySplit: 1 };
      X.utils.book_append_sheet(wb, ws, name);
    };
    add("Main", [["Team #", "Team Name", "Playoffs?", "Worlds?", "Award 1", "Award 2", "Award 3", "Blue Alliance Link", "Statbotics Link",
      ...g.rating.map((f) => f.label), "Scouts"]].concat(model.teams.map((t) => [
      t.number, t.name, t.info.playoffs || "", t.info.worlds || "", ...[0, 1, 2].map((i) => (t.info.awards || [])[i] || ""),
      `https://www.thebluealliance.com/team/${t.number}`, `https://www.statbotics.io/team/${t.number}`,
      ...g.rating.map((f) => fmt(t.rating[f.key])), t.rating._scouts.join(", ")])), [8, 24, 9, 12, 16, 16, 16, 30, 30]);
    add("Pit Scouting", [["Team #", "Team Name", ...g.pit.map((f) => f.label), "Reports", "Scouts", "Last Updated"]].concat(
      model.teams.map((t) => [t.number, t.name, ...g.pit.map((f) => fmt(t.pit[f.key])), t.pit._count, t.pit._scouts.join(", "),
        t.pitReports[0] ? new Date(t.pitReports[0].updatedAt).toLocaleString() : ""])), [8, 24]);
    add("Match Data", [["Match", "Red 1", "Red 2", "Red 3", "Blue 1", "Blue 2", "Blue 3", "Red Score", "Blue Score", "Winner", "Match Key"]].concat(
      model.schedule.map((m) => [m.data.label, ...pad3(m.data.red), ...pad3(m.data.blue), m.data.redScore ?? "", m.data.blueScore ?? "", m.data.winner || "", m.data.key || m.data.mk])));
    add("Match Scouting", [["Match", "Team #", "Alliance", ...g.match.map((f) => f.label), "Scout", "Saved"]].concat(
      model.match.slice().sort((a, b) => root.ESTba.sortValue(root.ESModel.mkOf(a)) - root.ESTba.sortValue(root.ESModel.mkOf(b)) || a.team - b.team)
        .map((r) => [root.ESTba.label(root.ESModel.mkOf(r)), r.team, r.data.alliance || "", ...g.match.map((f) => cell(r.data[f.key])), r.scout, new Date(r.updatedAt).toLocaleString()])), [8, 8, 9]);
    add("Team Summary", [["Rank", "Team #", "Team Name", "Avg Auto", "Avg Teleop", "Avg Endgame", "Avg Defense", "Avg Driver Skill", "Matches Scouted", "Reports", "Problem Matches", "Overall Score"]].concat(
      model.summary.map((s) => [s.rank, s.team, (model.teamMap.get(s.team) || {}).name || "", s.avgAuto ?? "", s.avgTeleop ?? "", s.avgEndgame ?? "", s.avgDefense ?? "", s.avgDriver ?? "", s.matches, s.reports, s.problems, s.overall])));
    const al = (model.alliance && model.alliance.data) || { ranking: [], alliances: [] };
    const asRows = [["General Rankings", "", "", "", "Predictions"], [], ["Team Name", "Team #", "Notes", "", "Alliance", "Captain", "Pick 1", "Pick 2"]];
    const len = Math.max(al.ranking.length, 8);
    for (let i = 0; i < len; i++) {
      const r = al.ranking[i], a = (al.alliances || [])[i];
      asRows.push([r ? (model.teamMap.get(r.team) || {}).name || "" : "", r ? r.team : "", r ? r.notes || "" : "", "",
        i < 8 ? i + 1 : "", ...(i < 8 ? [0, 1, 2].map((k) => (a && a[k]) || "") : [])]);
    }
    add("Alliance Selection", asRows, [24, 8, 40, 2, 9, 9, 9, 9]);
    add("All Reports", [["Kind", "Team #", "Match", "Scout", "Saved", "Data (JSON)", "Record ID"]].concat(
      records.filter((r) => r.event === model.event && !r.deleted && ["pit", "match", "rating"].includes(r.kind))
        .map((r) => [r.kind, r.team ?? "", r.kind === "match" ? root.ESTba.label(root.ESModel.mkOf(r)) : "", r.scout, new Date(r.updatedAt).toLocaleString(), JSON.stringify(r.data), r.id])));
    return X.write(wb, { bookType: "xlsx", type: "array" });
  }
  const pad3 = (a) => [0, 1, 2].map((i) => (a && a[i]) || "");
  const cell = (v) => (Array.isArray(v) ? v.join(", ") : v ?? "");

  // ---------- JSON backup ----------
  function backupJSON(records, settings) {
    return JSON.stringify({ app: "Eruption Scout", version: 1, exportedAt: new Date().toISOString(), event: settings.event, records }, null, 1);
  }
  function parseBackup(text) {
    const j = JSON.parse(text);
    const recs = Array.isArray(j) ? j : j.records;
    if (!Array.isArray(recs)) throw new Error("That file isn't an Eruption Scout backup.");
    return recs.filter((r) => r && r.id && r.kind && r.event);
  }

  // ---------- QR payloads ----------
  const ascii = (s) => s.replace(/[\u007f-￿]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
  function packRecords(recs) {
    return ascii(JSON.stringify(recs.map((r) => [r.id, r.kind, r.event, r.team ?? null, r.match ?? null, r.scout || "", r.device || "", r.data || {}, r.updatedAt || 0, r.deleted ? 1 : 0])));
  }
  function unpackRecords(text) {
    return JSON.parse(text).map((a) => ({ id: a[0], kind: a[1], event: a[2], team: a[3] ?? undefined, match: a[4] ?? undefined,
      scout: a[5], device: a[6], data: a[7], updatedAt: a[8], deleted: !!a[9] }));
  }
  /** Split into QR-sized chunks: "ES1|batch|i|n|payload" */
  function qrChunks(recs, size = 650) {
    const payload = packRecords(recs);
    const batch = hash(payload + Date.now());
    const n = Math.max(1, Math.ceil(payload.length / size));
    const out = [];
    for (let i = 0; i < n; i++) out.push(`ES1|${batch}|${i + 1}|${n}|${payload.slice(i * size, (i + 1) * size)}`);
    return out;
  }
  function parseChunk(text) {
    const m = /^ES1\|([a-z0-9]+)\|(\d+)\|(\d+)\|([\s\S]*)$/.exec(text || "");
    return m ? { batch: m[1], i: Number(m[2]), n: Number(m[3]), part: m[4] } : null;
  }

  root.ESIO = { importWorkbook, exportWorkbook, backupJSON, parseBackup, packRecords, unpackRecords, qrChunks, parseChunk, hash };
})(typeof self !== "undefined" ? self : globalThis);
