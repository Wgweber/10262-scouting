/* 10262 Scouting — turns saved records into what the screens show.
 * Pure logic, testable on its own. */
(function (root) {
  const C = root.ESCombine, G = root.ESGame, T = root.ESTba, St = root.ESStats;
  const mkOf = (r) => (r.data && r.data.mk) || ("qm" + r.match);

  function build(records, settings, globals) {
    const event = settings.event;
    const game = G.resolve(event, globals || []);
    const live = records.filter((r) => r.event === event && !r.deleted);
    const by = (k) => live.filter((r) => r.kind === k);
    const latest = (k) => by(k).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;

    const teamRecs = new Map(by("team").map((r) => [r.team, r]));
    const schedule = by("matchdata").sort((a, b) => T.sortValue(a.data.mk) - T.sortValue(b.data.mk));
    const pit = by("pit"), match = by("match"), rating = by("rating"), photos = by("photo");
    const alliance = latest("alliance"), tbaRec = latest("tbastats"), epaRec = latest("epa"), assign = latest("assign");
    const strategy = new Map(by("strategy").map((r) => [r.data.mk, r]));

    const numbers = new Set();
    for (const r of [...teamRecs.values(), ...pit, ...match, ...rating, ...photos]) if (r.team) numbers.add(Number(r.team));
    for (const m of schedule) for (const t of [...m.data.red, ...m.data.blue]) if (t) numbers.add(t);

    const group = (list) => {
      const m = new Map();
      for (const r of list) { if (!m.has(r.team)) m.set(r.team, []); m.get(r.team).push(r); }
      return m;
    };
    const pitBy = group(pit), ratingBy = group(rating), matchBy = group(match), photoBy = group(photos);
    const stats = St.teamStats(match, game);
    const ranked = [...stats.values()].sort((a, b) => b.avg.total - a.avg.total);
    const rankOf = new Map(ranked.map((s, i) => [s.team, i + 1]));
    const tba = tbaRec ? tbaRec.data : null, epa = epaRec ? epaRec.data : null;

    const teams = [...numbers].sort((a, b) => a - b).map((n) => {
      const tr = teamRecs.get(n);
      const pitReps = C.latestPerScout(pitBy.get(n) || [], (r) => r.scout || r.device);
      // One rating per scout per match counts (a scout re-saving the same match replaces their earlier one).
      const ratReps = C.latestPerScout(ratingBy.get(n) || [], (r) => `${r.scout || r.device}|${(r.data && r.data.mk) || ""}`);
      const tb = tba && tba.teams ? tba.teams[n] || null : null;
      return {
        number: n,
        name: (tr && tr.data.name) || "",
        info: (tr && tr.data) || {},
        teamRecord: tr || null,
        pitReports: (pitBy.get(n) || []).sort((a, b) => b.updatedAt - a.updatedAt),
        ratingReports: (ratingBy.get(n) || []).sort((a, b) => b.updatedAt - a.updatedAt),
        matchReports: (matchBy.get(n) || []).sort((a, b) => T.sortValue(mkOf(a)) - T.sortValue(mkOf(b))),
        photos: (photoBy.get(n) || []).sort((a, b) => b.updatedAt - a.updatedAt),
        pit: C.combineReports(G.dataFields(game, "pit"), pitReps),
        rating: C.combineReports(G.dataFields(game, "rating"), ratReps),
        stats: stats.get(n) || null,
        rank: rankOf.get(n) || null,
        tba: tb || {},
        epa: epa && epa.teams && epa.teams[n] != null ? epa.teams[n] : null
      };
    });
    const teamMap = new Map(teams.map((t) => [t.number, t]));

    // Which match-scouting reports exist per schedule slot (for "who still needs scouting").
    const scouted = new Set(match.map((r) => `${mkOf(r)}|${r.team}`));

    const model = { event, game, teams, teamMap, schedule, alliance, stats, ranked, scouted, pit, match, rating, photos, strategy, assign, tba, epa };
    model.metrics = St.metrics(model);
    model.metricMap = new Map(model.metrics.map((m) => [m.id, m]));
    // Fallback for predictions when a team hasn't been scouted yet: their EPA, else the event average.
    const avgs = ranked.map((s) => s.avg.total);
    model.fallback = { avg: avgs.length ? St.mean(avgs) : 0, byTeam: new Map(teams.filter((t) => t.epa != null).map((t) => [t.number, t.epa])) };
    return model;
  }

  root.ESModel = { build, mkOf };
})(typeof self !== "undefined" ? self : globalThis);
