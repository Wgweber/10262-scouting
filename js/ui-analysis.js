/* 10262 Scouting — analysis screens: Teams, Team page, Rankings, Compare, Pit data,
 * Matches and the Match planner. Everything is driven by the active game definition. */
(function () {
  const ES = window.ES;
  const { S, $, $$, esc, view, route, render, go, save, toast, cellOf, sortable, teamLink, ours, G, St, Tba, Model, Comb } = ES;
  const Ch = window.ESCharts;
  const fmt = St.fmt;
  const hasScore = (m) => m && m.data && m.data.redScore != null && m.data.blueScore != null;
  const teamLabel = (t) => `${t.number}${t.name ? " " + t.name : ""}`;
  const shortName = (t, n = 18) => (t.name && t.name.length > n ? t.name.slice(0, n - 1) + "…" : t.name || "");

  // ---------------- TEAMS (directory + notes search) ----------------
  function textFieldsOf(kind) { return G.dataFields(S.model.game, kind).filter((f) => f.type === "longtext" || f.type === "text"); }
  function noteHits(q) {
    const m = S.model, hits = [];
    const needle = q.toLowerCase();
    for (const [kind, list] of [["match", m.match], ["pit", m.pit], ["rating", m.rating]]) {
      const tf = textFieldsOf(kind);
      for (const r of list) for (const f of tf) {
        const v = String((r.data && r.data[f.key]) || "");
        const i = v.toLowerCase().indexOf(needle);
        if (i < 0) continue;
        hits.push({ r, f, kind, snippet: (i > 40 ? "…" : "") + v.slice(Math.max(0, i - 40), i + needle.length + 60) + (v.length > i + needle.length + 60 ? "…" : "") });
      }
    }
    return hits.sort((a, b) => b.r.updatedAt - a.r.updatedAt).slice(0, 60);
  }
  function renderTeams() {
    const m = S.model;
    const ratingChoices = G.dataFields(m.game, "rating").filter((f) => f.type === "choice").slice(0, 2);
    view.innerHTML = `<h1>Teams</h1>
      <div class="row"><input type="search" id="q" placeholder="Search a team number or name — or words from scouting notes, like “tipped”"></div>
      <p class="small muted">${m.teams.length} teams · tap a team for everything about it · <span class="dis"></span> = scouts disagree</p>
      <div class="tablewrap"><table id="tt"></table></div>
      <div id="noteHits"></div>`;
    const cols = [
      { key: "number", label: "Team #", val: (t) => t.number, html: teamLink },
      { key: "name", label: "Name", val: (t) => t.name },
      { key: "rank", label: "Our rank", val: (t) => t.rank, cls: "num", title: "Rank by average points from your match scouting" },
      { key: "total", label: "Avg pts", val: (t) => (t.stats ? t.stats.avg.total : null), html: (t) => fmt(t.stats && t.stats.avg.total), cls: "num", desc: true },
      { key: "n", label: "Matches", val: (t) => (t.stats ? t.stats.n : 0), cls: "num", desc: true },
      { key: "trend", label: "Trend", val: (t) => (t.stats ? t.stats.trend : null), html: (t) => (t.stats ? Ch.sparkline(t.stats.matches.map((x) => x.pts.total)) : ""), desc: true, title: "Points per match, oldest to newest" },
      { key: "rel", label: "Reliable", val: (t) => (t.stats ? t.stats.reliability : null), html: (t) => (t.stats ? fmt(t.stats.reliability * 100, 0) + "%" : "—"), cls: "num", desc: true },
      { key: "pit", label: "Pit", val: (t) => t.pit._count, html: (t) => (t.pit._count ? `✓${t.pit._count > 1 ? " " + t.pit._count : ""}` : `<span class="muted">—</span>`), cls: "num", desc: true },
      { key: "photos", label: "Photos", val: (t) => t.photos.length, html: (t) => (t.photos.length ? `📷 ${t.photos.length}` : ""), cls: "num", desc: true },
      ...ratingChoices.map((f) => ({ key: "r_" + f.key, label: f.label.replace(/\s*\(.*\)$/, ""), val: (t) => t.rating[f.key].value, html: (t) => cellOf(t.rating[f.key]) })),
      ...(m.tba ? [{ key: "tbarank", label: "Event rank", val: (t) => t.tba.rank ?? null, cls: "num" }] : []),
      ...(m.epa ? [{ key: "epa", label: "EPA", val: (t) => t.epa, html: (t) => fmt(t.epa), cls: "num", desc: true }] : []),
      { key: "awards", label: "Awards", val: (t) => (t.info.awards || []).join(", ") }
    ];
    const all = m.teams.map((t) => Object.assign(t, { _cls: ours(t.number) ? "ours" : "" }));
    const draw = () => {
      const q = $("#q").value.trim().toLowerCase();
      const rows = all.filter((t) => !q || String(t.number).includes(q) || t.name.toLowerCase().includes(q));
      sortable("tt", rows, cols, "number");
      const nh = $("#noteHits");
      if (q.length >= 3 && /[a-z]/.test(q)) {
        const hits = noteHits(q);
        nh.innerHTML = `<h2>Notes mentioning “${esc(q)}” <span class="muted small">(${hits.length})</span></h2>` + (hits.length ? hits.map((h) =>
          `<div class="list-item"><div><a href="#/team/${h.r.team}"><b>${h.r.team}</b></a> ${esc(ES.teamName(h.r.team))}
            <span class="muted small">· ${esc(h.f.label)}${h.r.data && h.r.data.mk ? " · " + esc(Tba.label(h.r.data.mk)) : ""} · ${esc(h.r.scout || "")}</span>
            <div>${esc(h.snippet)}</div></div></div>`).join("") : `<p class="muted">No notes contain that.</p>`);
      } else nh.innerHTML = "";
    };
    $("#q").oninput = draw; draw();
  }

  // ---------------- TEAM PAGE ----------------
  function fieldSummary(f, s) {
    if (!s || !s.n) return `<span class="muted">—</span>`;
    if (["counter", "number", "rating"].includes(f.type)) return `avg <b>${fmt(s.avg)}</b>${s.max != null ? ` · best ${fmt(s.max, f.type === "rating" ? 0 : 1)}` : ""}`;
    if (f.type === "toggle") return `<b>${fmt(s.rate * 100, 0)}%</b> of matches`;
    if (f.type === "choice" || f.type === "multi") {
      const parts = Object.entries(s.counts || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)}: <b>${fmt(v, Number.isInteger(v) ? 0 : 1)}</b>`);
      return parts.join(" · ") + (s.avgPts ? ` <span class="muted">(${fmt(s.avgPts)} pts avg)</span>` : "");
    }
    return `${s.n} note${s.n === 1 ? "" : "s"}`;
  }
  function tiles(list) {
    return `<div class="tiles">${list.map((x) => `<div class="tile ${x.hero ? "hero" : ""}" ${x.title ? `title="${esc(x.title)}"` : ""}><div class="tl">${esc(x.label)}</div><div class="tv">${x.value}</div>${x.sub ? `<div class="ts">${x.sub}</div>` : ""}</div>`).join("")}</div>`;
  }
  function notesFeed(t) {
    const out = [];
    const add = (r, kind) => { for (const f of textFieldsOf(kind)) { const v = r.data && r.data[f.key]; if (v && String(v).trim()) out.push({ r, f, v: String(v).trim(), kind }); } };
    t.matchReports.forEach((r) => add(r, "match"));
    t.pitReports.forEach((r) => add(r, "pit"));
    t.ratingReports.forEach((r) => add(r, "rating"));
    return out.sort((a, b) => b.r.updatedAt - a.r.updatedAt);
  }
  function renderTeam(p) {
    const n = Number(p.id), t = S.model.teamMap.get(n), m = S.model, g = m.game, main = S.settings.mode === "main";
    if (!t) { view.innerHTML = `<h1>Team ${esc(p.id)}</h1><p>No information yet.</p><a class="btn primary" href="#/pit?team=${esc(p.id)}">Pit scout this team</a>`; return; }
    const s = t.stats;
    const kvs = (fields, comb) => `<dl class="kv">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${cellOf(comb[f.key])}</dd>`).join("")}</dl>`;
    const perScout = (reps, fields) => reps.map((r) => `<details><summary>${esc(r.scout || "?")}${r.data && r.data.mk ? ` · ${esc(Tba.label(r.data.mk))}` : ""} · ${new Date(r.updatedAt).toLocaleString()}</summary>
      <dl class="kv">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(G.truthy(r.data[f.key]) && f.type === "toggle" ? "Yes" : r.data[f.key] === false ? "No" : [].concat(r.data[f.key] ?? "").join(", "))}</dd>`).join("")}</dl></details>`).join("");
    const pitF = G.dataFields(g, "pit"), ratF = G.dataFields(g, "rating"), matchF = G.dataFields(g, "match").filter((f) => !f.retired || (s && s.fields[f.key] && s.fields[f.key].n));
    const upcoming = m.schedule.filter((x) => !hasScore(x) && [...x.data.red, ...x.data.blue].includes(n));
    const notes = notesFeed(t);
    const anyPen = g.match.some((f) => f.penalty);
    view.innerHTML = `
      <h1>${t.number} ${esc(t.name)} ${ours(t.number) ? `<span class="pill">Us</span>` : ""}</h1>
      <div class="actions">
        <a class="btn primary" href="#/pit?team=${n}">Pit scout</a>
        <a class="btn" href="#/compare?t=${encodeURIComponent([...new Set([...(localStorage.getItem("es-compare") || "").split(",").filter(Boolean).map(Number), n])].slice(-4).join(","))}">Compare</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.thebluealliance.com/team/${n}">Blue Alliance ↗</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.statbotics.io/team/${n}">Statbotics ↗</a>
      </div>
      ${t.photos.length ? `<div class="photos">${t.photos.map((ph) => `<figure><img src="${esc(ph.data.img)}" alt="Robot ${n} photo" loading="lazy"><figcaption>${esc(ph.data.caption || "")} <span class="muted">${esc(ph.scout || "")}</span>${main ? ` <button class="link delPhoto" data-id="${esc(ph.id)}">Delete</button>` : ""}</figcaption></figure>`).join("")}</div>` : ""}
      ${s ? tiles([
        { label: "Avg points", value: fmt(s.avg.total), sub: t.rank ? `#${t.rank} of ${m.ranked.length} scouted` : "", hero: true },
        { label: "Auto", value: fmt(s.avg.auto) }, { label: "Teleop", value: fmt(s.avg.teleop) }, { label: "Endgame", value: fmt(s.avg.endgame) },
        { label: "Reliability", value: fmt(s.reliability * 100, 0) + "%", sub: s.problemMatches ? `⚠ ${s.problemMatches} problem match${s.problemMatches === 1 ? "" : "es"}` : "no problems" },
        { label: "Spread", value: s.n > 1 ? "±" + fmt(s.sd) : "—", title: "How much the score jumps around between matches" },
        { label: "Best match", value: fmt(s.max) }, { label: "Last 3 avg", value: fmt(s.recent), sub: s.n >= 3 ? (s.trend > 1 ? "↗ improving" : s.trend < -1 ? "↘ dropping" : "→ steady") : "" },
        ...(anyPen ? [{ label: "Foul pts given", value: fmt(s.avg.penalty), title: "Average points their fouls hand to the other alliance" }] : []),
        ...(t.tba.rank ? [{ label: "Event rank", value: "#" + t.tba.rank, sub: t.tba.wins != null ? `${t.tba.wins}-${t.tba.losses}-${t.tba.ties}` : "" }] : []),
        ...(t.tba.opr != null ? [{ label: "OPR", value: fmt(t.tba.opr) }] : []),
        ...(t.epa != null ? [{ label: "EPA", value: fmt(t.epa), title: "Statbotics expected points added" }] : [])
      ]) + `<h2>Points per match</h2>${Ch.phaseColumns(s.matches, { avg: s.avg.total, title: `Team ${n} points per match` })}`
        : `<div class="card soft">No match scouting yet.${t.epa != null ? ` Statbotics EPA: <b>${fmt(t.epa)}</b>.` : ""}${t.tba.rank ? ` Event rank #${t.tba.rank}.` : ""}</div>`}
      ${upcoming.length ? `<h2>Upcoming matches</h2><div class="chips">${upcoming.slice(0, 8).map((x) => `<a class="btn" href="#/plan?mk=${x.data.mk}">${esc(x.data.label)} · ${x.data.red.includes(n) ? "Red" : "Blue"}</a>`).join("")}</div>` : ""}
      ${s ? `<h2>Match form averages</h2><div class="tablewrap"><table><thead><tr><th>Phase</th><th>Field</th><th class="wrap">Across ${s.n} match${s.n === 1 ? "" : "es"}</th></tr></thead><tbody>
          ${matchF.filter((f) => f.type !== "longtext" && f.type !== "text").map((f) => `<tr><td>${esc(St.PHASE_SHORT[f.phase] || "")}</td><td>${esc(f.label)}${f.retired ? ' <span class="muted small">(old form)</span>' : ""}</td><td class="wrap">${fieldSummary(f, s.fields[f.key])}</td></tr>`).join("")}
        </tbody></table></div>
        <h2>Match by match</h2><div class="tablewrap"><table><thead><tr><th>Match</th><th>Scouts</th><th class="num">Auto</th><th class="num">Teleop</th><th class="num">Endgame</th><th class="num">Total</th>${anyPen ? '<th class="num">Fouls</th>' : ""}<th>Problems</th><th class="wrap">Notes</th></tr></thead><tbody>
          ${s.matches.map((x) => `<tr class="${x.problems.length ? "warnrow" : ""}"><td><a href="#/plan?mk=${x.mk}">${esc(x.label)}</a></td><td>${esc(x.scouts.join(", "))}</td>
            <td class="num">${fmt(x.pts.auto)}</td><td class="num">${fmt(x.pts.teleop)}</td><td class="num">${fmt(x.pts.endgame)}</td><td class="num"><b>${fmt(x.pts.total)}</b></td>${anyPen ? `<td class="num">${fmt(x.pts.penalty)}</td>` : ""}
            <td>${x.problems.length ? "⚠ " + esc(x.problems.join(", ")) : ""}</td>
            <td class="wrap">${esc(x.reports.flatMap((r) => textFieldsOf("match").map((f) => r.data[f.key]).filter(Boolean).map((v) => (x.reports.length > 1 ? (r.scout || "?") + ": " : "") + v)).join(" | "))}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
      <div id="history"></div>
      <h2>Pit scouting <span class="muted small">(${t.pit._count} report${t.pit._count === 1 ? "" : "s"}${t.pit._scouts.length ? " by " + esc(t.pit._scouts.join(", ")) : ""})</span></h2>
      ${t.pit._count ? kvs(pitF, t.pit) + `<h3>Each scout's report</h3>` + perScout(t.pitReports, pitF) : `<p class="muted">Not pit-scouted yet.</p>`}
      <h2>Ratings <span class="muted small">(${t.rating._count})</span></h2>
      ${t.rating._count ? kvs(ratF, t.rating) + `<h3>Each scout's rating</h3>` + perScout(t.ratingReports, ratF) : `<p class="muted">No ratings yet.</p>`}
      <h2>All notes <span class="muted small">(${notes.length})</span></h2>
      ${notes.length ? notes.map((x) => `<div class="note"><div class="small muted">${esc(x.r.scout || "?")} · ${esc(x.f.label)}${x.r.data && x.r.data.mk ? " · " + esc(Tba.label(x.r.data.mk)) : ""} · ${new Date(x.r.updatedAt).toLocaleDateString()}</div>${esc(x.v)}</div>`).join("") : `<p class="muted">No notes yet.</p>`}
      ${main ? `<h2>Team info</h2><details><summary>Edit team info</summary><form id="tiForm" class="grid2">
        <div><label class="f" for="ti_name">Team name</label><input id="ti_name" name="name" type="text" value="${esc(t.name)}"></div>
        <div><label class="f" for="ti_p">Playoffs?</label><select id="ti_p" name="playoffs">${["", "Yes", "No", "No events"].map((o) => `<option ${o === (t.info.playoffs || "") ? "selected" : ""}>${o}</option>`).join("")}</select></div>
        <div><label class="f" for="ti_w">Worlds?</label><select id="ti_w" name="worlds">${["", "Qualified", "Didn't Qualify", "No events"].map((o) => `<option ${o === (t.info.worlds || "") ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
        ${[0, 1, 2].map((i) => `<div><label class="f" for="ti_a${i}">Award ${i + 1}</label><select id="ti_a${i}" name="a${i}"><option></option>${G.AWARDS.map((a) => `<option ${a === (t.info.awards || [])[i] ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>`).join("")}
        <div style="align-self:end"><button class="dark" type="submit">Save team info</button></div></form></details>
        <p class="small muted">Playoffs: ${esc(t.info.playoffs || "—")} · Worlds: ${esc(t.info.worlds || "—")} · Awards: ${esc((t.info.awards || []).join(", ") || "—")}</p>` : ""}`;
    Ch.wire(view);
    teamHistory(n).then((html) => { const el = $("#history"); if (el && S.route === "team") el.innerHTML = html; }).catch(() => {});
    const f = $("#tiForm");
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const base = t.teamRecord || { id: `team:${S.settings.event}:${n}`, kind: "team", event: S.settings.event, team: n, data: {} };
      const rec = Object.assign({}, base, { scout: S.settings.scoutName || "Main computer" });
      rec.data = Object.assign({}, base.data, { name: f.elements.name.value.trim(), playoffs: f.elements.playoffs.value, worlds: f.elements.worlds.value,
        awards: [0, 1, 2].map((i) => f.elements["a" + i].value).filter(Boolean) });
      await save(rec); toast("Team info saved"); render();
    };
    $$(".delPhoto").forEach((b) => (b.onclick = async () => {
      if (!(await ES.askDeletePassword("Delete this photo for everyone?"))) return;
      const ph = t.photos.find((x) => x.id === b.dataset.id);
      if (ph) { await save(Object.assign({}, ph, { deleted: true })); toast("Photo deleted"); render(); }
    }));
  }

  /** This team at the other events stored on this device (each scored with its own season's form). */
  async function teamHistory(n) {
    const all = await ES.Core.allRecords();
    const byEvent = new Map();
    for (const r of all) {
      if (r.kind !== "match" || r.deleted || r.team !== n || r.event === S.settings.event) continue;
      if (!byEvent.has(r.event)) byEvent.set(r.event, []);
      byEvent.get(r.event).push(r);
    }
    if (!byEvent.size) return "";
    const rows = [...byEvent].map(([ev, recs]) => {
      const g = G.resolve(ev, S.globals);
      const st = St.teamStats(recs, g).get(n);
      return { ev, g, st };
    }).filter((x) => x.st).sort((a, b) => b.ev.localeCompare(a.ev));
    if (!rows.length) return "";
    return `<h2>At other events</h2><div class="tablewrap"><table><thead><tr><th>Event</th><th>Form</th><th class="num">Matches</th><th class="num">Avg points</th><th class="num">Auto</th><th class="num">Teleop</th><th class="num">Endgame</th><th class="num">Reliable</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${esc(x.ev)}</td><td>${esc(x.g.name)}</td><td class="num">${x.st.n}</td><td class="num"><b>${fmt(x.st.avg.total)}</b></td><td class="num">${fmt(x.st.avg.auto)}</td><td class="num">${fmt(x.st.avg.teleop)}</td><td class="num">${fmt(x.st.avg.endgame)}</td><td class="num">${fmt(x.st.reliability * 100, 0)}%</td></tr>`).join("")}
    </tbody></table></div><p class="small muted">Points from different seasons use different games, so compare within a season.</p>`;
  }

  // ---------------- RANKINGS ----------------
  function renderRankings() {
    const m = S.model;
    const metrics = m.metrics.filter((x) => !x.retired);
    const defaults = ["total", "auto", "teleop", "endgame", "max", "sd", "rel", "n", ...(m.tba ? ["tba.rank", "tba.opr"] : []), ...(m.epa ? ["epa"] : [])];
    let chosen;
    try { chosen = JSON.parse(localStorage.getItem("es-rank-cols") || "null"); } catch (e) { chosen = null; }
    chosen = (chosen && chosen.length ? chosen : defaults).filter((id) => m.metricMap.has(id));
    const scouted = m.teams.filter((t) => t.stats).sort((a, b) => a.rank - b.rank);
    view.innerHTML = `<h1>Rankings</h1>
      <p class="small muted">Ranked by average points from your match scouting (${scouted.length} teams scouted). When several scouts watch the same robot in one match, they're averaged first so each match counts once. Tap a column to sort; tap a bar or team for details.</p>
      <div class="actions"><button id="colBtn">Choose columns</button><button id="chartBtn">${localStorage.getItem("es-rank-chart") === "0" ? "Show chart" : "Hide chart"}</button><a class="btn" href="#/picklist">Open picklist ▶</a></div>
      <div id="colPick" class="card soft" hidden></div>
      <div id="rankChart"></div>
      <div class="tablewrap"><table id="rt"></table></div>
      ${m.teams.length > scouted.length ? `<p class="small muted">${m.teams.length - scouted.length} teams have no match scouting yet and appear at the bottom.</p>` : ""}`;
    const draw = () => {
      const showChart = localStorage.getItem("es-rank-chart") !== "0";
      $("#rankChart").innerHTML = showChart && scouted.length ? `<h2>Average points by phase</h2>` + Ch.phaseBars(scouted.slice(0, 40).map((t) => ({
        label: `${t.number} ${shortName(t, 16)}`, href: `#/team/${t.number}`, auto: t.stats.avg.auto, teleop: t.stats.avg.teleop, endgame: t.stats.avg.endgame, total: t.stats.avg.total,
        sub: `${t.stats.n} matches · ${fmt(t.stats.reliability * 100, 0)}% reliable` })), { labelW: 170 }) + (scouted.length > 40 ? `<p class="small muted">Showing the top 40.</p>` : "") : "";
      Ch.wire($("#rankChart"));
      const cols = [
        { key: "rank", label: "#", val: (t) => t.rank, cls: "num" },
        { key: "number", label: "Team", val: (t) => t.number, html: teamLink },
        { key: "name", label: "Name", val: (t) => t.name },
        ...chosen.map((id) => { const mt = m.metricMap.get(id); return { key: id, label: mt.label, title: mt.help || "", val: (t) => mt.get(t), html: (t) => fmt(mt.get(t), mt.digits), cls: "num", desc: mt.better !== "low" }; })
      ];
      sortable("rt", m.teams.map((t) => Object.assign(t, { _cls: ours(t.number) ? "ours" : t.stats ? "" : "gray" })), cols, "rank");
    };
    $("#chartBtn").onclick = () => { localStorage.setItem("es-rank-chart", localStorage.getItem("es-rank-chart") === "0" ? "1" : "0"); $("#chartBtn").textContent = localStorage.getItem("es-rank-chart") === "0" ? "Show chart" : "Hide chart"; draw(); };
    $("#colBtn").onclick = () => {
      const box = $("#colPick");
      box.hidden = !box.hidden;
      const groups = [...new Set(metrics.map((x) => x.group))];
      box.innerHTML = groups.map((gr) => `<h3>${esc(gr)}</h3><div class="chips">${metrics.filter((x) => x.group === gr).map((x) => `<label class="chip"><input type="checkbox" value="${esc(x.id)}" ${chosen.includes(x.id) ? "checked" : ""}><span>${esc(x.label)}</span></label>`).join("")}</div>`).join("") +
        `<div class="actions"><button id="colReset">Reset to default</button></div>`;
      $$("input[type=checkbox]", box).forEach((c) => (c.onchange = () => {
        chosen = $$("input[type=checkbox]:checked", box).map((x) => x.value);
        localStorage.setItem("es-rank-cols", JSON.stringify(chosen)); draw();
      }));
      $("#colReset").onclick = () => { chosen = defaults.filter((id) => m.metricMap.has(id)); localStorage.removeItem("es-rank-cols"); box.hidden = true; draw(); };
    };
    draw();
  }

  // ---------------- COMPARE ----------------
  function renderCompare(p) {
    const m = S.model;
    let picks = (p.t || localStorage.getItem("es-compare") || "").split(",").map(Number).filter((x) => x && m.teamMap.has(x));
    picks = [...new Set(picks)].slice(0, 4);
    localStorage.setItem("es-compare", picks.join(","));
    const teams = picks.map((n) => m.teamMap.get(n));
    const metrics = m.metrics.filter((x) => !x.retired && x.id !== "n");
    const best = (mt) => {
      const vals = teams.map((t) => mt.get(t)).filter((v) => v !== null);
      if (vals.length < 2) return null;
      return mt.better === "low" ? Math.min(...vals) : Math.max(...vals);
    };
    const yMax = Math.max(1, ...teams.filter((t) => t.stats).map((t) => t.stats.max || 0));
    const pitF = G.dataFields(m.game, "pit").filter((f) => f.type !== "longtext"), ratF = G.dataFields(m.game, "rating").filter((f) => f.type !== "longtext");
    view.innerHTML = `<h1>Compare teams</h1>
      <div class="row"><input id="addT" type="number" inputmode="numeric" list="teamlist" placeholder="Add a team number (up to 4)"><button class="dark" id="addBtn">Add</button>${ES.teamOptions()}</div>
      <div class="chips" style="margin:.6rem 0">${teams.map((t) => `<span class="pill big">${esc(teamLabel(t))} <button class="link rm" data-n="${t.number}" aria-label="Remove ${t.number}">✕</button></span>`).join("") || `<span class="muted">Pick two to four teams.</span>`}</div>
      ${teams.length ? `
        ${teams.some((t) => t.stats) ? `<h2>Average points by phase</h2>${Ch.phaseBars(teams.filter((t) => t.stats).map((t) => ({ label: `${t.number} ${shortName(t, 16)}`, href: `#/team/${t.number}`, auto: t.stats.avg.auto, teleop: t.stats.avg.teleop, endgame: t.stats.avg.endgame, total: t.stats.avg.total })), { labelW: 170 })}` : ""}
        <h2>Side by side</h2>
        <div class="tablewrap"><table class="cmp"><thead><tr><th>Metric</th>${teams.map((t) => `<th>${teamLink(t)} ${esc(shortName(t, 14))}</th>`).join("")}</tr></thead><tbody>
          ${metrics.map((mt) => { const b = best(mt); return `<tr><td>${esc(mt.label)}</td>${teams.map((t) => { const v = mt.get(t); return `<td class="num ${b !== null && v === b ? "best" : ""}">${fmt(v, mt.digits)}</td>`; }).join("")}</tr>`; }).join("")}
          ${pitF.map((f) => `<tr><td>Pit: ${esc(f.label)}</td>${teams.map((t) => `<td>${cellOf(t.pit[f.key])}</td>`).join("")}</tr>`).join("")}
          ${ratF.map((f) => `<tr><td>Rating: ${esc(f.label)}</td>${teams.map((t) => `<td>${cellOf(t.rating[f.key])}</td>`).join("")}</tr>`).join("")}
        </tbody></table></div>
        <p class="small muted"><b>Bold</b> = best of these teams (lower is better for spread, fouls and event rank).</p>
        <h2>Match by match</h2>
        <div class="multiples">${teams.map((t) => `<div><h3>${teamLink(t)} ${esc(shortName(t, 22))}</h3>${t.stats ? Ch.phaseColumns(t.stats.matches, { avg: t.stats.avg.total, yMax, height: 180, width: 420 }) : `<p class="muted">No match scouting yet.</p>`}</div>`).join("")}</div>` : ""}`;
    Ch.wire(view);
    const setPicks = (list) => go(`#/compare?t=${list.join(",")}`);
    $("#addBtn").onclick = () => { const v = Number($("#addT").value); if (!v) return; if (!m.teamMap.has(v)) { toast("That team isn't in this event's data"); return; } setPicks([...picks.filter((x) => x !== v), v].slice(-4)); };
    $("#addT").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#addBtn").click(); } };
    $$(".rm").forEach((b) => (b.onclick = () => setPicks(picks.filter((x) => x !== Number(b.dataset.n)))));
  }

  // ---------------- PIT DATA ----------------
  function renderPitData() {
    const m = S.model, pitF = G.dataFields(m.game, "pit");
    const done = m.teams.filter((t) => t.pit._count).length;
    view.innerHTML = `<h1>Pit data</h1><p class="muted small">${done} of ${m.teams.length} teams pit-scouted. Gray rows still need a visit. When several scouts report, numbers are averaged and choices show how many picked each. <span class="dis"></span> = scouts disagree.</p>
      <div class="actions"><label class="chip"><input type="checkbox" id="onlyMissing"><span>Only teams still to scout</span></label></div>
      <div class="tablewrap"><table id="pt"></table></div>`;
    const cols = [{ key: "number", label: "Team #", val: (t) => t.number, html: teamLink }, { key: "name", label: "Name", val: (t) => t.name },
      { key: "n", label: "Reports", val: (t) => t.pit._count, cls: "num", desc: true },
      { key: "ph", label: "Photos", val: (t) => t.photos.length, html: (t) => (t.photos.length ? "📷 " + t.photos.length : ""), cls: "num", desc: true }]
      .concat(pitF.map((f) => ({ key: f.key, label: f.label, cls: f.type === "longtext" ? "wrap" : "", val: (t) => { const c = t.pit[f.key]; return c.n ? (typeof c.value === "number" ? c.value : c.display) : ""; }, html: (t) => cellOf(t.pit[f.key]), desc: f.type === "number" })));
    const draw = () => {
      const only = $("#onlyMissing").checked;
      sortable("pt", m.teams.filter((t) => !only || !t.pit._count).map((t) => Object.assign(t, { _cls: t.pit._count ? (ours(t.number) ? "ours" : "") : "gray" })), cols, "number");
    };
    $("#onlyMissing").onchange = draw; draw();
  }

  // ---------------- MATCHES (schedule + standings) ----------------
  function renderMatches() {
    const m = S.model, s = S.settings;
    const teamCell = (n, mk) => { const done = m.scouted.has(`${mk}|${n}`); return `<a href="#/team/${n}" class="${ours(n) ? "team-ours" : ""}">${n}</a>${done ? " ✓" : ""}`; };
    view.innerHTML = `<h1>Matches</h1>
      <div class="actions">
        <button class="dark" id="tbaBtn">Refresh from The Blue Alliance</button>
        <button id="epaBtn">Load Statbotics EPA</button>
        <span class="small muted" id="tbaMsg">${s.tbaKey ? "Refreshes automatically every 5 minutes while the app is open on this computer." : `Add your Blue Alliance API key in <a href="#/settings">Settings</a> to load the schedule and standings.`}</span>
      </div>
      ${m.schedule.length ? `<p class="small muted">✓ = scouted. Unplayed matches show the predicted winner from your scouting. ${s.ourTeam ? `Our team (${esc(s.ourTeam)}) is highlighted.` : ""}</p>
      <div class="tablewrap"><table><thead><tr><th>Match</th><th>Red 1</th><th>Red 2</th><th>Red 3</th><th>Blue 1</th><th>Blue 2</th><th>Blue 3</th><th class="num">Red</th><th class="num">Blue</th><th>Result / prediction</th><th class="num">Scouted</th><th></th></tr></thead><tbody>
      ${m.schedule.map((x) => {
        const d = x.data, all = [...d.red, ...d.blue];
        const sc = all.filter((n) => m.scouted.has(`${d.mk}|${n}`)).length;
        let res;
        if (hasScore(x)) res = d.winner === "red" ? `<span class="pill red">Red won</span>` : d.winner === "blue" ? `<span class="pill blue">Blue won</span>` : esc(d.winner || "Tie");
        else { const pr = St.predictMatch(d.red, d.blue, m.stats, m.fallback); const r = Math.round(pr.redWin * 100); res = `<span class="muted">${r >= 50 ? `Red ${r}%` : `Blue ${100 - r}%`} · ${fmt(pr.redScore, 0)}–${fmt(pr.blueScore, 0)}</span>`; }
        return `<tr class="${all.some(ours) ? "ours" : ""}"><td><a href="#/match?mk=${d.mk}">${esc(d.label)}</a></td>${[0, 1, 2].map((i) => `<td>${d.red[i] ? teamCell(d.red[i], d.mk) : ""}</td>`).join("")}${[0, 1, 2].map((i) => `<td>${d.blue[i] ? teamCell(d.blue[i], d.mk) : ""}</td>`).join("")}
        <td class="num">${d.redScore ?? ""}</td><td class="num">${d.blueScore ?? ""}</td><td>${res}</td><td class="num">${sc}/6</td><td><a class="btn small" href="#/plan?mk=${d.mk}">Plan</a></td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="muted">No schedule yet. It appears once the event posts it on The Blue Alliance and you refresh. Scouts can still enter match numbers by hand.</p>`}
      ${m.tba ? `<h2>Event standings</h2><p class="small muted">From The Blue Alliance${m.tba.fetchedAt ? `, ${new Date(m.tba.fetchedAt).toLocaleString()}` : ""}.</p><div class="tablewrap"><table id="standings"></table></div>` : ""}`;
    $("#tbaBtn").onclick = () => ES.tbaRefresh(true);
    $("#epaBtn").onclick = () => ES.epaRefresh(true);
    if (m.tba) sortable("standings", m.teams.filter((t) => t.tba.rank || t.tba.opr != null), [
      { key: "rank", label: "Rank", val: (t) => t.tba.rank ?? null, cls: "num" },
      { key: "number", label: "Team", val: (t) => t.number, html: teamLink },
      { key: "name", label: "Name", val: (t) => t.name },
      { key: "rec", label: "W-L-T", val: (t) => (t.tba.wins != null ? t.tba.wins : null), html: (t) => (t.tba.wins != null ? `${t.tba.wins}-${t.tba.losses}-${t.tba.ties}` : "") },
      { key: "rp", label: "Avg RP", val: (t) => t.tba.rpAvg ?? null, html: (t) => fmt(t.tba.rpAvg, 2), cls: "num", desc: true },
      { key: "opr", label: "OPR", val: (t) => t.tba.opr ?? null, html: (t) => fmt(t.tba.opr), cls: "num", desc: true },
      { key: "dpr", label: "DPR", val: (t) => t.tba.dpr ?? null, html: (t) => fmt(t.tba.dpr), cls: "num" },
      { key: "ccwm", label: "CCWM", val: (t) => t.tba.ccwm ?? null, html: (t) => fmt(t.tba.ccwm), cls: "num", desc: true },
      { key: "ours", label: "Our avg pts", val: (t) => (t.stats ? t.stats.avg.total : null), html: (t) => fmt(t.stats && t.stats.avg.total), cls: "num", desc: true },
      ...(m.epa ? [{ key: "epa", label: "EPA", val: (t) => t.epa, html: (t) => fmt(t.epa), cls: "num", desc: true }] : [])
    ], "rank");
  }

  // ---------------- MATCH PLANNER ----------------
  function ourNextMatches() {
    const m = S.model;
    return m.schedule.filter((x) => !hasScore(x) && [...x.data.red, ...x.data.blue].some(ours));
  }
  function renderPlan(p) {
    const m = S.model, g = m.game, sched = m.schedule;
    const custom = p.mk === "custom" || (!sched.length && !p.mk);
    const next = ourNextMatches();
    const defMk = p.mk || (next[0] && next[0].data.mk) || ((sched.find((x) => !hasScore(x)) || sched[0] || { data: {} }).data.mk) || "custom";
    const mk = custom ? "custom" : defMk;
    const sm = sched.find((x) => x.data.mk === mk);
    const parseList = (v) => (v || "").split(",").map(Number).filter(Boolean).slice(0, 4);
    const red = sm ? sm.data.red : parseList(p.r), blue = sm ? sm.data.blue : parseList(p.b);
    const pr = St.predictMatch(red, blue, m.stats, m.fallback);
    const endF = G.dataFields(g, "match").filter((f) => !f.retired && f.phase === "endgame" && f.type === "choice")[0];
    const ratChoice = G.dataFields(g, "rating").filter((f) => f.type === "choice").slice(0, 2);
    const pitDrive = G.dataFields(g, "pit").filter((f) => f.type === "choice")[0];
    const stratKey = mk === "custom" ? `custom-${red.join("-")}-vs-${blue.join("-")}` : mk;
    const strat = m.strategy.get(stratKey);
    const robotRow = (n, part) => {
      const t = m.teamMap.get(n) || { number: n, name: "", stats: null, rating: {}, pit: {}, tba: {} };
      const s = t.stats;
      const endTop = s && endF && s.fields[endF.key] && s.fields[endF.key].counts ? Object.entries(s.fields[endF.key].counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${fmt(v, 0)}`).slice(0, 3).join(" · ") : "";
      const lastNote = t.matchReports ? t.matchReports.slice().reverse().map((r) => textFieldsOf("match").map((f) => r.data[f.key]).filter(Boolean).join(" ")).find(Boolean) : "";
      return `<tr class="${ours(n) ? "ours" : ""}"><td>${teamLink(t)}<div class="small muted">${esc(shortName(t, 22))}</div></td>
        <td class="num">${s ? s.n : `<span class="muted">${part ? part.source : "—"}</span>`}</td>
        <td class="num">${fmt(s && s.avg.auto)}</td><td class="num">${fmt(s && s.avg.teleop)}</td><td class="num">${fmt(s && s.avg.endgame)}</td>
        <td class="num"><b>${fmt(s ? s.avg.total : part && part.mean)}</b></td>
        <td class="num">${s ? fmt(s.reliability * 100, 0) + "%" : "—"}</td>
        ${endF ? `<td>${endTop || "—"}</td>` : ""}
        ${ratChoice.map((f) => `<td>${t.rating[f.key] ? cellOf(t.rating[f.key]) : "—"}</td>`).join("")}
        ${pitDrive ? `<td>${t.pit[pitDrive.key] ? cellOf(t.pit[pitDrive.key]) : "—"}</td>` : ""}
        <td class="wrap small">${esc((lastNote || "").slice(0, 140))}</td></tr>`;
    };
    const allianceTable = (cls, teams, est) => `<div class="tablewrap"><table class="plan ${cls}"><thead><tr><th>${cls === "red" ? "Red" : "Blue"} robot</th><th class="num">Matches</th><th class="num">Auto</th><th class="num">Teleop</th><th class="num">Endgame</th><th class="num">Avg</th><th class="num">Reliable</th>${endF ? `<th>${esc(endF.label)}</th>` : ""}${ratChoice.map((f) => `<th>${esc(f.label.replace(/\s*\(.*\)$/, ""))}</th>`).join("")}${pitDrive ? `<th>${esc(pitDrive.label)}</th>` : ""}<th class="wrap">Latest note</th></tr></thead>
      <tbody>${teams.map((n, i) => robotRow(n, est.parts[i])).join("")}</tbody></table></div>`;
    const ourSide = red.some(ours) ? "red" : blue.some(ours) ? "blue" : "";
    view.innerHTML = `<h1>Match planner</h1>
      <div class="row">
        <select id="planMk" style="flex:1 1 20rem">${sched.map((x) => `<option value="${x.data.mk}" ${x.data.mk === mk ? "selected" : ""}>${esc(x.data.label)} — R ${x.data.red.join(" ")} · B ${x.data.blue.join(" ")}${hasScore(x) ? " (played)" : ""}</option>`).join("")}<option value="custom" ${mk === "custom" ? "selected" : ""}>Custom alliances (playoffs / what-if)…</option></select>
        <button id="printBtn" style="flex:0 0 auto">Print briefing</button>
      </div>
      ${next.length ? `<div class="chips" style="margin:.5rem 0">Our next: ${next.slice(0, 6).map((x) => `<a class="btn small ${x.data.mk === mk ? "dark" : ""}" href="#/plan?mk=${x.data.mk}">${esc(x.data.label)}</a>`).join("")}</div>` : ""}
      ${mk === "custom" ? `<form id="customForm" class="grid2 card soft">
        <div><label class="f">Red alliance</label><div class="row">${[0, 1, 2, 3].map((i) => `<input class="ct" data-side="r" type="number" inputmode="numeric" list="teamlist" placeholder="${i < 3 ? "Team" : "4th (optional)"}" value="${red[i] || ""}">`).join("")}</div></div>
        <div><label class="f">Blue alliance</label><div class="row">${[0, 1, 2, 3].map((i) => `<input class="ct" data-side="b" type="number" inputmode="numeric" list="teamlist" placeholder="${i < 3 ? "Team" : "4th (optional)"}" value="${blue[i] || ""}">`).join("")}</div></div>
        <div><button class="dark" type="submit">Predict</button></div>${ES.teamOptions()}</form>` : ""}
      ${red.length || blue.length ? `
        <h2>${sm ? esc(sm.data.label) : "Custom match"}${ourSide ? ` · we're <span class="pill ${ourSide}">${ourSide === "red" ? "Red" : "Blue"}</span>` : ""}${sm && sm.data.time ? ` <span class="muted small">${new Date(sm.data.time * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>` : ""}</h2>
        ${hasScore(sm) ? `<div class="card soft">Final: <b>Red ${sm.data.redScore}</b> – <b>Blue ${sm.data.blueScore}</b> · our prediction was ${fmt(pr.redScore, 0)}–${fmt(pr.blueScore, 0)}</div>` : ""}
        <div class="predict">
          <div class="pscore red"><div class="tl">Red predicted</div><div class="tv">${fmt(pr.redScore, 0)}</div><div class="ts">±${fmt(pr.red.sd, 0)}</div></div>
          <div class="pwin">${Ch.winBar(pr.redWin)}</div>
          <div class="pscore blue"><div class="tl">Blue predicted</div><div class="tv">${fmt(pr.blueScore, 0)}</div><div class="ts">±${fmt(pr.blue.sd, 0)}</div></div>
        </div>
        <p class="small muted">Prediction = each robot's average points from your scouting${m.epa ? " (Statbotics EPA, or the event average, for robots you haven't scouted)" : " (the event average for robots you haven't scouted)"}, plus the foul points the other side usually gives away. ${pr.red.known + pr.blue.known} of ${red.length + blue.length} robots scouted.</p>
        ${allianceTable("red", red, pr.red)}
        ${allianceTable("blue", blue, pr.blue)}
        <h2>Strategy notes</h2>
        <textarea id="stratNotes" class="strat" placeholder="Who plays defense, who scores where, who climbs, what to watch out for…">${esc(strat ? strat.data.notes || "" : "")}</textarea>
        <div class="small muted" id="stratMeta">${strat ? `Shared with all main computers · last edited by ${esc(strat.scout || "?")} ${new Date(strat.updatedAt).toLocaleString()}` : "Shared with all main computers once you type."}</div>` : `<p class="muted">Pick a match, or enter custom alliances.</p>`}`;
    Ch.wire(view);
    $("#planMk").onchange = (e) => go(`#/plan?mk=${e.target.value}`);
    $("#printBtn").onclick = () => window.print();
    const cf = $("#customForm");
    if (cf) cf.onsubmit = (e) => {
      e.preventDefault();
      const side = (sd) => $$(`.ct[data-side="${sd}"]`).map((i) => Number(i.value)).filter(Boolean).join(",");
      go(`#/plan?mk=custom&r=${side("r")}&b=${side("b")}`);
    };
    const ta = $("#stratNotes");
    if (ta) {
      let tmr = null;
      ta.oninput = () => {
        S.formDirty = "soft";
        clearTimeout(tmr);
        tmr = setTimeout(async () => {
          const base = strat || { id: `strategy:${S.settings.event}:${stratKey}`, kind: "strategy", event: S.settings.event, data: {} };
          await ES.Core.saveLocal(Object.assign({}, base, { scout: S.settings.scoutName || "Main computer", data: Object.assign({}, base.data, { mk: stratKey, notes: ta.value }) }));
          await ES.reload(); ES.kickSync();
          S.formDirty = false;
          const meta = $("#stratMeta"); if (meta) meta.textContent = "Saved " + new Date().toLocaleTimeString();
        }, 700);
      };
    }
  }

  route("matches", { title: "Matches", render: renderMatches, group: "event", main: true, order: 1 });
  route("plan", { title: "Match Planner", short: "Planner", render: renderPlan, group: "event", main: true, order: 2 });
  route("teams", { title: "Teams", render: renderTeams, group: "analyze", main: true, order: 1 });
  route("team", { title: "Team", render: renderTeam, hidden: true, navAs: "teams" });
  route("rankings", { title: "Rankings", render: renderRankings, group: "analyze", main: true, order: 2 });
  route("compare", { title: "Compare", render: renderCompare, group: "analyze", main: true, order: 3 });
  route("pitdata", { title: "Pit Data", render: renderPitData, group: "analyze", main: true, order: 4 });
  // Old links (#/summary) still work.
  route("summary", { title: "Rankings", render: renderRankings, hidden: true, navAs: "rankings" });

  Object.assign(ES, { ourNextMatches, hasScore, noteHits });
})();
