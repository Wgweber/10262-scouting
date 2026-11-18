/* 10262 Scouting — turns the saved records into the views the app shows
 * (the same tabs your spreadsheet had). Pure logic, testable on its own. */
(function (root) {
  const C = root.ESCombine, F = root.ESFields, T = root.ESTba;

  function build(records, settings) {
    const event = settings.event;
    const game = F.gameFor(event);
    const live = records.filter((r) => r.event === event && !r.deleted);
    const by = (k) => live.filter((r) => r.kind === k);

    const teamRecs = new Map(by("team").map((r) => [r.team, r]));
    const schedule = by("matchdata").sort((a, b) => T.sortValue(a.data.mk) - T.sortValue(b.data.mk));
    const pit = by("pit"), match = by("match"), rating = by("rating");
    const alliance = live.filter((r) => r.kind === "alliance").sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;

    const numbers = new Set();
    for (const r of [...teamRecs.values(), ...pit, ...match, ...rating]) if (r.team) numbers.add(Number(r.team));
    for (const m of schedule) for (const t of [...m.data.red, ...m.data.blue]) if (t) numbers.add(t);

    const group = (list) => {
      const m = new Map();
      for (const r of list) { if (!m.has(r.team)) m.set(r.team, []); m.get(r.team).push(r); }
      return m;
    };
    const pitBy = group(pit), ratingBy = group(rating), matchBy = group(match);
    const summary = C.teamSummary(match, game.match);
    const summaryBy = new Map(summary.map((s) => [s.team, s]));

    const teams = [...numbers].sort((a, b) => a - b).map((n) => {
      const tr = teamRecs.get(n);
      const pitReps = C.latestPerScout(pitBy.get(n) || [], (r) => r.scout || r.device);
      // One rating per scout per match counts (a scout re-saving the same match replaces their earlier one).
      const ratReps = C.latestPerScout(ratingBy.get(n) || [], (r) => `${r.scout || r.device}|${(r.data && r.data.mk) || ""}`);
      return {
        number: n,
        name: (tr && tr.data.name) || "",
        info: (tr && tr.data) || {},
        teamRecord: tr || null,
        pitReports: (pitBy.get(n) || []).sort((a, b) => b.updatedAt - a.updatedAt),
        ratingReports: (ratingBy.get(n) || []).sort((a, b) => b.updatedAt - a.updatedAt),
        matchReports: (matchBy.get(n) || []).sort((a, b) => T.sortValue(mkOf(a)) - T.sortValue(mkOf(b))),
        pit: C.combineReports(game.pit, pitReps),
        rating: C.combineReports(game.rating, ratReps),
        summary: summaryBy.get(n) || null
      };
    });
    const teamMap = new Map(teams.map((t) => [t.number, t]));

    // Which match-scouting reports exist per schedule slot (for "who still needs scouting").
    const scouted = new Set(match.map((r) => `${mkOf(r)}|${r.team}`));

    return { event, game, teams, teamMap, schedule, alliance, summary, scouted, pit, match, rating };
  }

  function mkOf(r) { return (r.data && r.data.mk) || ("qm" + r.match); }

  root.ESModel = { build, mkOf };
})(typeof self !== "undefined" ? self : globalThis);
