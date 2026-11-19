/* 10262 Scouting — picklist (with a weighted pick score) and the live alliance-selection board.
 * Both live in one shared record per event, so every main computer sees the same list. */
(function () {
  const ES = window.ES;
  const { S, $, $$, esc, view, route, render, go, toast, teamLink, ours, St } = ES;
  const Ch = window.ESCharts;
  const fmt = St.fmt;
  const TIERS = [["", "—"], ["1", "1st pick"], ["2", "2nd pick"], ["3", "Maybe"], ["dnp", "Do not pick"]];
  const DEFAULT_WEIGHTS = { total: 10, rel: 6, endgame: 3, auto: 3 };

  // Working copy shown on screen; saved in the background, re-read from the data when nothing is pending.
  let D = null, pending = false;
  function state() {
    if (D) return D;
    const a = S.model.alliance;
    const d = a ? JSON.parse(JSON.stringify(a.data || {})) : {};
    d.ranking = (d.ranking || []).filter((r) => r && r.team).map((r) => ({ team: Number(r.team), notes: r.notes || "", tier: r.tier || "" }));
    d.alliances = Array.from({ length: 8 }, (_, i) => { const x = (d.alliances || [])[i] || []; return [0, 1, 2, 3].map((k) => (x[k] ? Number(x[k]) : null)); });
    d.declined = (d.declined || []).map(Number).filter(Boolean);
    d.weights = d.weights && Object.keys(d.weights).length ? d.weights : Object.assign({}, DEFAULT_WEIGHTS);
    D = d;
    return d;
  }
  let saveTimer = null;
  function persist(d, after) {
    D = d; pending = true;
    if (!S.formDirty) S.formDirty = "soft"; // don't let a background sync redraw the page mid-save
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const base = S.model.alliance || { id: `alliance:${S.settings.event}`, kind: "alliance", event: S.settings.event };
      await ES.Core.saveLocal(Object.assign({}, base, { scout: S.settings.scoutName || "Main computer", data: JSON.parse(JSON.stringify(d)) }));
      pending = false;
      if (S.formDirty === "soft") S.formDirty = false;
      await ES.reload(); ES.kickSync();
      const el = $("#plSaved"); if (el) el.textContent = "Saved " + new Date().toLocaleTimeString();
      if (after) after();
    }, 350);
  }
  const pickedBy = (d) => { const m = new Map(); d.alliances.forEach((a, i) => a.forEach((t, k) => { if (t) m.set(t, { alliance: i + 1, slot: k }); })); return m; };

  function renderPicklist(p) {
    if (!pending) D = null; // fresh from the shared record (another computer may have changed it)
    const tab = p.tab === "live" ? "live" : "list";
    view.innerHTML = `<h1>Picklist & alliance selection</h1>
      <div class="tabs"><a href="#/picklist" class="${tab === "list" ? "on" : ""}">Picklist</a><a href="#/picklist?tab=live" class="${tab === "live" ? "on" : ""}">Alliance selection (live)</a></div>
      <p class="small muted">Shared with every main computer · last saved by ${esc((S.model.alliance && S.model.alliance.scout) || "—")} <span id="plSaved"></span></p>
      <div id="plBody"></div>`;
    if (tab === "live") drawLive(); else drawList();
  }

  // ---------------- the picklist ----------------
  function drawList() {
    const m = S.model, d = state();
    const scores = St.pickScores(m, d.weights);
    const picked = pickedBy(d);
    const metricOpts = m.metrics.filter((x) => x.pick !== false && !x.retired);
    const inList = new Set(d.ranking.map((r) => r.team));
    const body = $("#plBody");
    body.innerHTML = `
      <details class="card soft" id="wbox"><summary><b>Pick score formula</b> <span class="muted small">— ${Object.entries(d.weights).filter(([, w]) => w > 0).map(([id, w]) => `${esc((m.metricMap.get(id) || { label: id }).label)} ×${w}`).join(", ") || "nothing weighted"}</span></summary>
        <p class="small muted">Each metric is scaled across the event (best team = full marks), multiplied by its weight and added up, giving a 0–100 score. Teams with no data for a metric get no marks for it.</p>
        <div class="weights">${[...new Set(metricOpts.map((x) => x.group))].map((gr) => `<h3>${esc(gr)}</h3>` + metricOpts.filter((x) => x.group === gr).map((x) =>
          `<label class="wrow"><span>${esc(x.label)}${x.better === "low" ? ' <span class="muted small">(lower is better)</span>' : ""}</span><input type="range" min="0" max="10" step="1" value="${d.weights[x.id] || 0}" data-w="${esc(x.id)}"><b data-wv="${esc(x.id)}">${d.weights[x.id] || 0}</b></label>`).join("")).join("")}</div>
        <div class="actions"><button id="wReset">Reset formula</button></div>
      </details>
      <div class="actions">
        <button class="dark" id="sortScore">Sort by pick score</button>
        <button id="addAll">Add every team</button>
        <input id="addT" type="number" inputmode="numeric" list="teamlist" placeholder="Add team #" style="max-width:9rem"><button id="addBtn">Add</button>${ES.teamOptions()}
        <label class="chip"><input type="checkbox" id="hidePicked" ${localStorage.getItem("es-hidepicked") === "1" ? "checked" : ""}><span>Hide picked</span></label>
      </div>
      ${d.ranking.length ? "" : `<p class="muted">The list is empty. "Sort by pick score" adds every scouted team in score order; then drag (or use the arrows) to adjust and set each team's group.</p>`}
      <ol class="plist" id="plist">${d.ranking.map((r, i) => {
        const t = m.teamMap.get(r.team) || { number: r.team, name: "", stats: null };
        const s = t.stats, pb = picked.get(r.team), dec = d.declined.includes(r.team);
        if (pb && localStorage.getItem("es-hidepicked") === "1") return "";
        return `<li class="prow ${r.tier === "dnp" ? "dnp" : ""} ${pb || dec ? "taken" : ""} ${ours(r.team) ? "ours" : ""}" draggable="true" data-i="${i}">
          <span class="grip" aria-hidden="true">⋮⋮</span><b class="pos">${i + 1}</b>
          <span class="who">${teamLink(t)} <span class="small">${esc(t.name || "")}</span>${pb ? ` <span class="pill">Alliance ${pb.alliance}</span>` : ""}${dec ? ` <span class="pill">Declined</span>` : ""}</span>
          <span class="score" title="Pick score">${fmt(scores.get(r.team), 0)}</span>
          <span class="mini small">${s ? `${fmt(s.avg.total)} pts · A ${fmt(s.avg.auto)} · E ${fmt(s.avg.endgame)} · ${fmt(s.reliability * 100, 0)}% rel · ${s.n} m` : "<span class='muted'>not scouted</span>"}</span>
          <select data-tier="${i}" aria-label="Group for ${r.team}">${TIERS.map(([v, l]) => `<option value="${v}" ${r.tier === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          <input class="pnote" data-note="${i}" value="${esc(r.notes)}" placeholder="Notes">
          <span class="pbtns"><button data-top="${i}" title="Move to top">⤒</button><button data-mvup="${i}" aria-label="Move up">↑</button><button data-mvdown="${i}" aria-label="Move down">↓</button><button data-rm="${i}" aria-label="Remove">✕</button></span></li>`;
      }).join("")}</ol>`;
    const redraw = () => drawList();
    const commit = (fn, now) => { fn(); persist(d); if (now !== false) redraw(); };
    $$("input[type=range]", body).forEach((r) => (r.oninput = () => {
      d.weights[r.dataset.w] = Number(r.value);
      $(`[data-wv="${r.dataset.w}"]`).textContent = r.value;
      persist(d, () => { const open = $("#wbox").open; drawList(); $("#wbox").open = open; });
    }));
    $("#wReset").onclick = () => commit(() => { d.weights = Object.assign({}, DEFAULT_WEIGHTS); });
    $("#sortScore").onclick = () => commit(() => {
      for (const t of m.teams) if (t.stats && !inList.has(t.number)) d.ranking.push({ team: t.number, notes: "", tier: "" });
      const sc = St.pickScores(m, d.weights);
      d.ranking.sort((a, b) => (a.tier === "dnp") - (b.tier === "dnp") || (sc.get(b.team) ?? -1) - (sc.get(a.team) ?? -1));
    });
    $("#addAll").onclick = () => commit(() => { for (const t of m.teams) if (!inList.has(t.number)) d.ranking.push({ team: t.number, notes: "", tier: "" }); });
    $("#addBtn").onclick = () => { const v = Number($("#addT").value); if (v && !inList.has(v)) commit(() => d.ranking.push({ team: v, notes: "", tier: "" })); };
    $("#hidePicked").onchange = (e) => { localStorage.setItem("es-hidepicked", e.target.checked ? "1" : "0"); redraw(); };
    $$("[data-tier]", body).forEach((el) => (el.onchange = () => commit(() => {
      const i = Number(el.dataset.tier); d.ranking[i].tier = el.value;
      if (el.value === "dnp") d.ranking.push(d.ranking.splice(i, 1)[0]); // do-not-pick sinks to the bottom
    })));
    $$("[data-note]", body).forEach((el) => (el.oninput = () => { d.ranking[Number(el.dataset.note)].notes = el.value; persist(d); }));
    const move = (from, to) => { if (to < 0 || to >= d.ranking.length || from === to) return; const [x] = d.ranking.splice(from, 1); d.ranking.splice(to, 0, x); };
    $$("[data-top]", body).forEach((b) => (b.onclick = () => commit(() => move(Number(b.dataset.top), 0))));
    $$("[data-mvup]", body).forEach((b) => (b.onclick = () => commit(() => move(Number(b.dataset.mvup), Number(b.dataset.mvup) - 1))));
    $$("[data-mvdown]", body).forEach((b) => (b.onclick = () => commit(() => move(Number(b.dataset.mvdown), Number(b.dataset.mvdown) + 1))));
    $$("[data-rm]", body).forEach((b) => (b.onclick = () => commit(() => d.ranking.splice(Number(b.dataset.rm), 1))));
    // drag and drop (mouse); touch screens use the arrow buttons
    let dragFrom = null;
    $$(".prow", body).forEach((li) => {
      li.addEventListener("dragstart", (e) => { dragFrom = Number(li.dataset.i); li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragFrom)); });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
      li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("over"); });
      li.addEventListener("dragleave", () => li.classList.remove("over"));
      li.addEventListener("drop", (e) => { e.preventDefault(); const to = Number(li.dataset.i); if (dragFrom !== null) commit(() => move(dragFrom, to)); dragFrom = null; });
    });
  }

  // ---------------- live alliance selection ----------------
  function drawLive() {
    const m = S.model, d = state();
    const picked = pickedBy(d);
    const counts = {};
    d.alliances.flat().filter(Boolean).forEach((n) => (counts[n] = (counts[n] || 0) + 1));
    const available = d.ranking.filter((r) => r.tier !== "dnp" && !picked.has(r.team) && !d.declined.includes(r.team) && !ours(r.team));
    const scores = St.pickScores(m, d.weights);
    const opts = (sel) => `<option value=""></option>` + m.teams.map((t) => `<option value="${t.number}" ${Number(sel) === t.number ? "selected" : ""}>${t.number} ${esc(t.name)}${picked.has(t.number) && Number(sel) !== t.number ? " (taken)" : ""}</option>`).join("");
    const body = $("#plBody");
    body.innerHTML = `
      <div class="board">
        <section>
          <h2>Alliances</h2>
          <div class="alli small muted"><span></span><span>Captain</span><span>1st pick</span><span>2nd pick</span><span>Backup</span></div>
          ${d.alliances.map((a, i) => `<div class="alli"><b>${i + 1}</b>${[0, 1, 2, 3].map((k) => `<select data-a="${i}" data-k="${k}" class="${a[k] && counts[a[k]] > 1 ? "dup" : ""} ${a[k] && ours(a[k]) ? "oursel" : ""}" aria-label="Alliance ${i + 1} ${["captain", "first pick", "second pick", "backup"][k]}">${opts(a[k])}</select>`).join("")}</div>`).join("")}
          <div class="actions">${m.tba ? `<button id="fillCaps">Fill captains from event rankings</button>` : ""}<button id="clearBoard">Clear board</button></div>
          <p class="small muted">Red box = a team placed twice. Picked teams are crossed off the picklist automatically.</p>
          <h3>Declined an invitation</h3>
          <div class="row"><input id="decT" type="number" inputmode="numeric" list="teamlist" placeholder="Team #" style="max-width:9rem"><button id="decBtn">Add</button>${ES.teamOptions()}</div>
          <div class="chips">${d.declined.map((n) => `<span class="pill big">${n} <button class="link" data-undec="${n}" aria-label="Remove ${n}">✕</button></span>`).join("") || `<span class="muted small">None</span>`}</div>
        </section>
        <section>
          <h2>Best available</h2>
          ${available.length ? `<ol class="avail">${available.slice(0, 12).map((r) => { const t = m.teamMap.get(r.team) || { number: r.team, name: "" }; const s = t.stats;
            return `<li>${teamLink(t)} ${esc(t.name || "")} <span class="pill">${esc((TIERS.find(([v]) => v === r.tier) || ["", ""])[1] || "")}</span>
              <div class="small muted">score ${fmt(scores.get(r.team), 0)}${s ? ` · ${fmt(s.avg.total)} pts · ${fmt(s.reliability * 100, 0)}% rel` : ""}${r.notes ? " · " + esc(r.notes) : ""}</div></li>`; }).join("")}</ol>`
            : `<p class="muted">Build the picklist first (Picklist tab) — this shows its top teams that haven't been picked, declined or marked do-not-pick.</p>`}
        </section>
      </div>`;
    $$("[data-a]", body).forEach((el) => (el.onchange = () => { d.alliances[Number(el.dataset.a)][Number(el.dataset.k)] = el.value ? Number(el.value) : null; persist(d); drawLive(); }));
    const fc = $("#fillCaps");
    if (fc) fc.onclick = () => {
      const top = m.teams.filter((t) => t.tba.rank).sort((a, b) => a.tba.rank - b.tba.rank).slice(0, 8);
      top.forEach((t, i) => (d.alliances[i][0] = t.number));
      persist(d); drawLive();
    };
    $("#clearBoard").onclick = async () => {
      if (!confirm("Clear all eight alliances and the declined list?")) return;
      d.alliances = d.alliances.map(() => [null, null, null, null]); d.declined = [];
      persist(d); drawLive();
    };
    $("#decBtn").onclick = () => { const v = Number($("#decT").value); if (v && !d.declined.includes(v)) { d.declined.push(v); persist(d); drawLive(); } };
    $$("[data-undec]", body).forEach((b) => (b.onclick = () => { d.declined = d.declined.filter((x) => x !== Number(b.dataset.undec)); persist(d); drawLive(); }));
  }

  route("picklist", { title: "Picklist", render: renderPicklist, group: "event", main: true, order: 3 });
  route("alliance", { title: "Picklist", render: (p) => renderPicklist(Object.assign({}, p, { tab: "live" })), hidden: true, navAs: "picklist" });
})();
