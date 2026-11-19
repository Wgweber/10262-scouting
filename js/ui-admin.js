/* 10262 Scouting — Game Builder (design next season's forms) and Scouts (who scouted what,
 * how accurate it was, what's missing, and who scouts which robot). */
(function () {
  const ES = window.ES;
  const { S, $, $$, esc, view, route, render, go, toast, teamLink, sortable, G, St, Tba, Core } = ES;
  const fmt = St.fmt;

  // ======================= GAME BUILDER =======================
  const B = { year: null, draft: null, tab: "match", open: null, saveT: null };
  const KINDS = [["match", "Match form"], ["pit", "Pit form"], ["rating", "Rating form"]];

  async function loadDraft(year) {
    const saved = await Core.getMeta("gameDraft:" + year);
    if (saved) return G.normalize(saved);
    const g = G.resolve(year + "xxxx", S.globals);
    if (g.source === "fallback") return G.starterTemplate(year);
    const d = G.normalize(g);
    return d;
  }
  function saveDraft() {
    clearTimeout(B.saveT);
    B.saveT = setTimeout(() => Core.setMeta("gameDraft:" + B.year, B.draft), 250);
  }
  function published(year) {
    return (S.globals || []).filter((r) => r.kind === "game" && !r.deleted && r.data && String(r.data.year) === String(year)).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  }
  const strip = (cfg) => { const c = G.normalize(cfg); delete c.version; delete c.source; delete c.publishedAt; delete c.publishedBy; delete c.fallbackFor; return JSON.stringify(c); };
  function usageCount(key, kind) {
    // Only this season's reports use this season's form.
    if (String(B.year) !== String(S.settings.event).slice(0, 4)) return 0;
    return S.records.filter((r) => r.kind === kind && !r.deleted && r.data && !ES.Comb.isBlank(r.data[key])).length;
  }

  async function renderBuilder(p) {
    if (S.settings.mode !== "main") { view.innerHTML = `<h1>Game Builder</h1><p>Switch this device to <a href="#/settings">Main computer</a> to design forms.</p>`; return; }
    const evYear = String(S.settings.event).slice(0, 4);
    const year = String(p.year || B.year || evYear);
    if (B.year !== year || !B.draft) { B.year = year; B.draft = await loadDraft(year); B.open = null; }
    if (p.tab && KINDS.some(([k]) => k === p.tab)) B.tab = p.tab;
    drawBuilder();
  }

  function drawBuilder() {
    const d = B.draft, year = B.year, pub = published(year);
    const builtin = G.BUILTIN[year];
    const base = pub ? pub.data : builtin ? Object.assign({}, builtin, { year }) : null;
    const changed = base ? strip(base) !== strip(d) : true;
    const errs = G.validate(d), warns = G.warnings(d);
    const using = pub ? `Published version <b>${pub.data.version || 1}</b> by ${esc(pub.scout || "?")} on ${new Date(pub.updatedAt).toLocaleString()}`
      : builtin ? `The built-in <b>${esc(builtin.name)}</b> form` : `<b>No ${esc(year)} form yet</b> — devices use the newest built-in form until you publish one`;
    const fields = d[B.tab];
    view.innerHTML = `<h1>Game Builder</h1>
      <p class="small muted">Design what scouts fill in for a season and what each answer is worth. Every number in the app — points, rankings, predictions, pick scores — comes from this. Nothing changes for scouts until you press <b>Publish</b>.</p>
      <div class="card">
        <div class="row" style="align-items:end">
          <div style="flex:0 0 7rem"><label class="f" for="bYear" style="margin-top:0">Season</label><input id="bYear" type="number" value="${esc(year)}"></div>
          <div style="flex:1 1 14rem"><label class="f" for="bName" style="margin-top:0">Game name</label><input id="bName" type="text" value="${esc(d.name)}"></div>
        </div>
        <p class="small" style="margin-bottom:0">Devices use for ${esc(year)}: ${using}.<br>This draft: ${changed ? `<span class="status-wait">unpublished changes</span>` : `<span class="status-ok">same as ${pub ? "published" : "the built-in form"} ✓</span>`}</p>
      </div>
      <div class="actions">
        <button class="primary" id="bPublish" ${errs.length ? "disabled" : ""}>Publish to all devices…</button>
        <button id="bExport">Download form (.json)</button>
        <label class="btn">Load a form file<input type="file" id="bImport" accept=".json,application/json" hidden></label>
        <details class="inline"><summary class="btn">Start over from…</summary><div class="menu">
          ${Object.keys(G.BUILTIN).map((y) => `<button data-start="builtin:${y}">${esc(G.BUILTIN[y].name)} (built-in)</button>`).join("")}
          <button data-start="starter">Blank starter form for ${esc(year)}</button>
          ${pub ? `<button data-start="published">The published ${esc(year)} form (undo my changes)</button>` : ""}
        </div></details>
      </div>
      ${errs.length ? `<div class="card warn"><b>Fix before publishing:</b><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
      ${warns.length ? `<div class="card soft small">${warns.map((w) => `⚠ ${esc(w)}`).join("<br>")}</div>` : ""}
      <label class="f" for="bAbout">Notes about this form <span class="help">(shown in the builder only)</span></label>
      <textarea id="bAbout" rows="2">${esc(d.about || "")}</textarea>
      <div class="tabs" style="margin-top:1rem">${KINDS.map(([k, l]) => `<a href="#/builder?tab=${k}" class="${B.tab === k ? "on" : ""}">${l} <span class="muted">(${d[k].filter((f) => !f.retired).length})</span></a>`).join("")}</div>
      <div class="builder">
        <section class="bfields">
          ${fields.length ? fields.map((f, i) => fieldCard(f, i)).join("") : `<p class="muted">No fields yet.</p>`}
          <div class="card soft addfield">
            <b>Add a field</b>
            <div class="row">
              <select id="newType">${Object.entries(G.TYPES).map(([k, t]) => `<option value="${k}" ${k === (B.tab === "match" ? "counter" : "choice") ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>
              ${B.tab === "match" ? `<select id="newPhase">${G.PHASES.map((ph) => `<option value="${ph.id}" ${ph.id === "teleop" ? "selected" : ""}>${esc(ph.label)}</option>`).join("")}</select>` : ""}
              <input id="newLabel" type="text" placeholder="Label, e.g. Coral scored on L4">
              <button class="dark" id="addField">Add</button>
            </div>
          </div>
        </section>
        <aside class="bpreview">
          <h3>Phone preview <span class="muted small">— try it: points add up like the real form</span></h3>
          <div class="phone"><form id="pvForm" autocomplete="off">${previewHTML()}</form></div>
        </aside>
      </div>`;
    wireBuilder();
  }

  function pointsSummary(f) {
    const bits = [];
    if (f.points) bits.push(`${f.points > 0 ? "+" : ""}${f.points} ${f.type === "toggle" ? "pts" : "each"}`);
    if (f.optionPoints && Object.keys(f.optionPoints).length) bits.push(Object.entries(f.optionPoints).map(([o, v]) => `${o} ${v}`).join(", "));
    if (f.penalty) bits.push(`foul ${f.penalty} to opponent`);
    if (f.problem || (f.problemOptions && f.problemOptions.length)) bits.push("⚠ problem");
    return bits.join(" · ");
  }
  function fieldCard(f, i) {
    const t = G.TYPES[f.type], open = B.open === i;
    const used = usageCount(f.key, B.tab);
    const phaseSel = B.tab === "match" ? `<label class="f">Phase</label><select data-prop="phase">${G.PHASES.map((ph) => `<option value="${ph.id}" ${f.phase === ph.id ? "selected" : ""}>${esc(ph.label)}</option>`).join("")}</select>` : "";
    const numeric = ["counter", "number", "toggle"].includes(f.type);
    return `<div class="fcard ${f.retired ? "retired" : ""} ${open ? "open" : ""}" data-i="${i}">
      <div class="fsum">
        ${B.tab === "match" ? `<span class="phasebadge ph-${f.phase}">${esc(St.PHASE_SHORT[f.phase])}</span>` : ""}
        <button type="button" class="link ftitle" data-toggle="${i}">${esc(f.type === "header" ? "▸ " + f.label : f.label)}</button>
        <span class="small muted">${esc(t.label)}${pointsSummary(f) ? " · " + esc(pointsSummary(f)) : ""}${f.retired ? " · retired" : ""}${used ? ` · ${used} report${used === 1 ? "" : "s"} use it` : ""}</span>
        <span class="fbtns"><button type="button" data-mv="-1" aria-label="Move up">↑</button><button type="button" data-mv="1" aria-label="Move down">↓</button><button type="button" data-dup aria-label="Duplicate">⧉</button><button type="button" data-del aria-label="Delete">✕</button></span>
      </div>
      ${open ? `<div class="fedit grid2">
        <div><label class="f">Label</label><input type="text" data-prop="label" value="${esc(f.label)}"></div>
        <div><label class="f">Type</label><select data-prop="type">${Object.entries(G.TYPES).map(([k, tt]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${esc(tt.label)}</option>`).join("")}</select>
          ${used ? `<div class="small status-wait">${used} saved report${used === 1 ? " has" : "s have"} answers here — changing the type can make them unreadable.</div>` : ""}</div>
        ${phaseSel ? `<div>${phaseSel}</div>` : ""}
        <div><label class="f">Help text <span class="help">(optional)</span></label><input type="text" data-prop="help" value="${esc(f.help || "")}"></div>
        ${f.type === "number" ? `<div><label class="f">Unit <span class="help">(optional)</span></label><input type="text" data-prop="unit" value="${esc(f.unit || "")}"></div>` : ""}
        ${numeric && B.tab === "match" ? `<div><label class="f">${esc(t.points)}</label><input type="number" step="any" data-prop="points" value="${f.points ?? ""}" placeholder="0"></div>
          <div><label class="f">Foul points to the other alliance <span class="help">(${f.type === "toggle" ? "when yes" : "each"})</span></label><input type="number" step="any" data-prop="penalty" value="${f.penalty ?? ""}" placeholder="0"></div>` : ""}
        ${f.type === "counter" ? `<div><label class="f">Extra fast button</label><select data-prop="bigStep">${[["", "None"], ["2", "+2"], ["3", "+3"], ["5", "+5"], ["10", "+10"]].map(([v, l]) => `<option value="${v}" ${String(f.bigStep || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : ""}
        ${f.type === "toggle" && B.tab === "match" ? `<div><label class="chip" style="margin-top:2rem"><input type="checkbox" data-prop="problem" ${f.problem ? "checked" : ""}><span>"Yes" means the robot had a problem</span></label></div>` : ""}
        ${t.options ? `<div class="span2"><label class="f">Options</label>
          <div class="opts">${f.options.map((o, oi) => `<div class="optrow"><input type="text" data-opt="${oi}" value="${esc(o)}" aria-label="Option ${oi + 1}">
            ${B.tab === "match" ? `<input type="number" step="any" data-optpts="${oi}" value="${f.optionPoints && f.optionPoints[o] != null ? f.optionPoints[o] : ""}" placeholder="pts" aria-label="Points for ${esc(o)}">` : ""}
            ${B.tab === "match" && f.type === "choice" ? `<label class="chip mini"><input type="checkbox" data-optprob="${oi}" ${(f.problemOptions || []).includes(o) ? "checked" : ""}><span>problem</span></label>` : ""}
            <button type="button" data-optdel="${oi}" aria-label="Remove option">✕</button></div>`).join("")}</div>
          <button type="button" data-optadd>+ Add option</button></div>` : ""}
        <div class="span2"><label class="chip"><input type="checkbox" data-prop="retired" ${f.retired ? "checked" : ""}><span>Retired — hide from the form but keep counting old answers</span></label>
          <span class="small muted"> · data key: <code>${esc(f.key)}</code></span></div>
      </div>` : ""}
    </div>`;
  }

  function previewHTML() {
    const d = B.draft, kind = B.tab;
    const fields = G.formFields(d, kind);
    if (kind !== "match") return fields.map((f) => ES.fieldHTML(f)).join("") || `<p class="muted">Empty form</p>`;
    const phases = G.PHASES.filter((ph) => fields.some((f) => f.phase === ph.id));
    return `<div class="ptsbar" id="pvPts"></div>` + phases.map((ph) => `<section class="phase ph-${ph.id}"><h2>${esc(ph.label)}</h2>${fields.filter((f) => f.phase === ph.id).map((f) => ES.fieldHTML(f)).join("")}</section>`).join("");
  }
  function drawPreviewPoints() {
    const el = $("#pvPts");
    if (!el) return;
    const d = B.draft, fields = G.formFields(d, "match");
    const pts = G.reportPoints(ES.readFields($("#pvForm"), fields), d);
    el.innerHTML = ["auto", "teleop", "endgame"].map((k) => `<span>${St.PHASE_SHORT[k]} <b>${fmt(pts[k], 0)}</b></span>`).join("") + `<span class="tot">Total <b>${fmt(pts.total, 0)}</b></span>${pts.penalty ? `<span class="pen">Fouls −${fmt(pts.penalty, 0)}</span>` : ""}`;
  }

  function wireBuilder() {
    const d = B.draft, list = () => d[B.tab];
    const change = () => { B.draft = G.normalize(d); saveDraft(); drawBuilder(); };
    $("#bYear").onchange = (e) => { const y = String(e.target.value).trim(); if (/^\d{4}$/.test(y)) go(`#/builder?year=${y}`); };
    $("#bName").oninput = (e) => { d.name = e.target.value; saveDraft(); };
    $("#bAbout").oninput = (e) => { d.about = e.target.value; saveDraft(); };
    $$("[data-toggle]").forEach((b) => (b.onclick = () => { B.open = B.open === Number(b.dataset.toggle) ? null : Number(b.dataset.toggle); drawBuilder(); }));
    $$(".fcard").forEach((card) => {
      const i = Number(card.dataset.i), f = list()[i];
      const q = (sel) => card.querySelector(sel);
      q("[data-mv='-1']").onclick = () => { if (i > 0) { list().splice(i - 1, 0, list().splice(i, 1)[0]); if (B.open === i) B.open = i - 1; change(); } };
      q("[data-mv='1']").onclick = () => { if (i < list().length - 1) { list().splice(i + 1, 0, list().splice(i, 1)[0]); if (B.open === i) B.open = i + 1; change(); } };
      q("[data-dup]").onclick = () => { const c = JSON.parse(JSON.stringify(f)); c.label = f.label + " (copy)"; delete c.key; list().splice(i + 1, 0, c); B.open = i + 1; change(); };
      q("[data-del]").onclick = () => {
        const used = usageCount(f.key, B.tab);
        if (used && !f.retired) {
          if (confirm(`${used} saved report${used === 1 ? " has" : "s have"} answers for “${f.label}”.\n\nRetire it instead? (Hidden from the form, old answers still count.)\n\nOK = retire · Cancel = more options`)) { f.retired = true; change(); return; }
          if (!confirm(`Delete “${f.label}” completely? Old answers will no longer be counted or exported.`)) return;
        } else if (!confirm(`Delete “${f.label}”?`)) return;
        list().splice(i, 1); B.open = null; change();
      };
      $$("[data-prop]", card).forEach((el) => {
        const ev = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "change";
        el.addEventListener(ev, () => {
          const prop = el.dataset.prop;
          let v = el.type === "checkbox" ? el.checked : el.value;
          if (["points", "penalty", "bigStep"].includes(prop)) v = v === "" ? undefined : Number(v);
          if (v === undefined || v === "") delete f[prop]; else f[prop] = v;
          if (prop === "type" && G.TYPES[v].options && !(f.options && f.options.length)) f.options = ["Option 1", "Option 2"];
          change();
        });
        if (el.type === "text") el.addEventListener("input", () => { f[el.dataset.prop] = el.value; saveDraft(); });
      });
      $$("[data-opt]", card).forEach((el) => el.addEventListener("change", () => {
        const oi = Number(el.dataset.opt), old = f.options[oi], nv = el.value.trim();
        if (!nv) return;
        f.options[oi] = nv;
        if (f.optionPoints && old in f.optionPoints) { f.optionPoints[nv] = f.optionPoints[old]; delete f.optionPoints[old]; }
        if (f.problemOptions) f.problemOptions = f.problemOptions.map((x) => (x === old ? nv : x));
        change();
      }));
      $$("[data-optpts]", card).forEach((el) => el.addEventListener("change", () => {
        const o = f.options[Number(el.dataset.optpts)];
        f.optionPoints = f.optionPoints || {};
        if (el.value === "") delete f.optionPoints[o]; else f.optionPoints[o] = Number(el.value);
        change();
      }));
      $$("[data-optprob]", card).forEach((el) => el.addEventListener("change", () => {
        const o = f.options[Number(el.dataset.optprob)];
        f.problemOptions = (f.problemOptions || []).filter((x) => x !== o);
        if (el.checked) f.problemOptions.push(o);
        change();
      }));
      $$("[data-optdel]", card).forEach((el) => (el.onclick = () => { f.options.splice(Number(el.dataset.optdel), 1); change(); }));
      const oa = q("[data-optadd]");
      if (oa) oa.onclick = () => { f.options.push(`Option ${f.options.length + 1}`); change(); };
    });
    $("#addField").onclick = () => {
      const label = $("#newLabel").value.trim();
      if (!label) { toast("Type a label for the new field"); $("#newLabel").focus(); return; }
      const type = $("#newType").value;
      const f = { label, type };
      if (B.tab === "match") f.phase = $("#newPhase").value;
      if (G.TYPES[type].options) f.options = ["Option 1", "Option 2"];
      // Put it after the last field of the same phase so the list reads in match order.
      let at = list().length;
      if (B.tab === "match") {
        const order = G.PHASES.map((ph) => ph.id), want = order.indexOf(f.phase);
        const live = list().map((x, i) => ({ x, i })).filter(({ x }) => !x.retired);
        const same = live.filter(({ x }) => x.phase === f.phase);
        if (same.length) at = same[same.length - 1].i + 1;
        else { const after = live.find(({ x }) => order.indexOf(x.phase) > want); at = after ? after.i : list().length; }
      }
      list().splice(at, 0, f); B.open = at; change();
    };
    $("#newLabel").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#addField").click(); } };
    // preview behaves like the real form
    const pv = $("#pvForm");
    ES.wireForm(pv);
    S.formDirty = false; // the preview isn't real data
    pv.addEventListener("input", () => { drawPreviewPoints(); S.formDirty = false; });
    pv.addEventListener("change", () => { drawPreviewPoints(); S.formDirty = false; });
    pv.onsubmit = (e) => e.preventDefault();
    drawPreviewPoints();
    // start-over menu
    $$("[data-start]").forEach((b) => (b.onclick = async () => {
      const what = b.dataset.start;
      if (!confirm("Replace the draft with this? Your unpublished changes will be lost.")) return;
      let nd;
      if (what === "starter") nd = G.starterTemplate(B.year);
      else if (what === "published") nd = G.normalize(published(B.year).data);
      else nd = G.normalize(Object.assign({}, G.BUILTIN[what.split(":")[1]], { year: B.year, name: B.year === what.split(":")[1] ? G.BUILTIN[what.split(":")[1]].name : `${B.year} game` }));
      B.draft = nd; B.open = null; saveDraft(); drawBuilder();
    }));
    $("#bExport").onclick = () => ES.download(new Blob([JSON.stringify(Object.assign({ app: "10262 Scouting game form" }, G.normalize(B.draft)), null, 2)], { type: "application/json" }), `game-form-${B.year}.json`);
    $("#bImport").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const j = JSON.parse(await file.text());
        const nd = G.normalize(j);
        if (!nd.match.length && !nd.pit.length) throw new Error("That file doesn't contain a game form.");
        if (nd.year !== B.year && !confirm(`That form is for ${nd.year || "an unknown year"}. Load it as the ${B.year} form?`)) return;
        nd.year = B.year;
        B.draft = nd; B.open = null; saveDraft(); drawBuilder();
        toast("Form loaded — check it, then publish");
      } catch (err) { toast("Couldn't read that file: " + err.message, 5000); }
    };
    $("#bPublish").onclick = async () => {
      const errs = G.validate(B.draft);
      if (errs.length) { toast(errs[0], 5000); return; }
      const pub = published(B.year);
      const warns = G.warnings(B.draft);
      if (!(await ES.askDeletePassword(`Publish the ${B.year} form${warns.length ? " (" + warns[0] + ")" : ""}? Every device switches to it the next time it syncs.`))) return;
      const data = Object.assign(G.normalize(B.draft), { version: ((pub && pub.data.version) || 0) + 1 });
      delete data.source; delete data.fallbackFor;
      await Core.saveLocal({ id: `game:${B.year}`, kind: "game", event: "_global", scout: S.settings.scoutName || "Main computer", data });
      await Core.setMeta("gameDraft:" + B.year, data);
      await ES.reload();
      const st = await ES.kickSync({ pullToo: false });
      toast(st.ok ? `Published version ${data.version} ✓ — devices update when they sync` : `Saved version ${data.version}. It uploads when this computer is online.`, 5000);
      drawBuilder();
    };
  }

  // ======================= SCOUTS =======================
  function scoutTable(m) {
    const rows = new Map();
    const row = (name) => { if (!rows.has(name)) rows.set(name, { name, pit: 0, match: 0, rating: 0, last: 0, errs: [] }); return rows.get(name); };
    for (const [kind, list] of [["pit", m.pit], ["match", m.match], ["rating", m.rating]]) for (const r of list) {
      const x = row(r.scout || "(no name)"); x[kind]++; x.last = Math.max(x.last, r.updatedAt || 0);
    }
    return rows;
  }
  /** Compare what scouts recorded for a whole alliance with the official score. */
  function accuracy(m) {
    const out = [];
    const anyPoints = !G.warnings(m.game).length;
    if (!anyPoints) return out;
    for (const x of m.schedule) {
      if (x.data.redScore == null || x.data.blueScore == null) continue;
      for (const side of ["red", "blue"]) {
        const teams = x.data[side], other = x.data[side === "red" ? "blue" : "red"];
        const per = teams.map((t) => { const s = m.stats.get(t); return s && s.matches.find((mm) => mm.mk === x.data.mk); });
        if (per.some((v) => !v)) continue; // need all three robots scouted
        const otherPer = other.map((t) => { const s = m.stats.get(t); return s && s.matches.find((mm) => mm.mk === x.data.mk); });
        const fouls = otherPer.reduce((a, v) => a + (v ? v.pts.penalty : 0), 0);
        const scouted = per.reduce((a, v) => a + v.pts.total, 0) + fouls;
        const official = x.data[side + "Score"];
        out.push({ mk: x.data.mk, label: x.data.label, side, scouted, official, err: scouted - official, scouts: [...new Set(per.flatMap((v) => v.scouts))] });
      }
    }
    return out;
  }
  function missing(m) {
    const out = [];
    for (const x of m.schedule) {
      if (x.data.redScore == null) continue; // only matches that have been played
      ["red", "blue"].forEach((side) => x.data[side].forEach((t, i) => { if (!m.scouted.has(`${x.data.mk}|${t}`)) out.push({ mk: x.data.mk, label: x.data.label, station: `${side === "red" ? "Red" : "Blue"} ${i + 1}`, team: t }); }));
    }
    return out;
  }

  function renderScouts() {
    const m = S.model;
    const rows = scoutTable(m);
    const acc = accuracy(m);
    for (const a of acc) for (const sc of a.scouts) if (rows.has(sc)) rows.get(sc).errs.push(Math.abs(a.err) / Math.max(1, a.official));
    const miss = missing(m);
    const a = m.assign ? JSON.parse(JSON.stringify(m.assign.data || {})) : {};
    a.shifts = Array.isArray(a.shifts) && a.shifts.length ? a.shifts : [{ from: 1, to: "", map: {} }];
    const known = [...new Set([...rows.keys(), ...a.shifts.flatMap((s) => Object.values(s.map || {}))].filter(Boolean))].sort();
    view.innerHTML = `<h1>Scouts</h1>
      <h2>Who scouted what</h2>
      <div class="tablewrap"><table id="scTable"></table></div>
      ${acc.length ? `<p class="small muted">Accuracy compares each fully scouted alliance (all three robots) with the official score from The Blue Alliance, after adding the foul points the other alliance gave away. Lower is better; under 15% is very good for live scouting.</p>`
        : `<p class="small muted">Accuracy appears once played matches have official scores (refresh on the Matches page) and all three robots of an alliance were scouted${G.warnings(m.game).length ? ", and the game form has point values" : ""}.</p>`}
      ${acc.length ? `<details><summary>Alliance-by-alliance check (${acc.length})</summary><div class="tablewrap"><table><thead><tr><th>Match</th><th>Alliance</th><th class="num">Scouted</th><th class="num">Official</th><th class="num">Off by</th><th>Scouts</th></tr></thead><tbody>
        ${acc.map((x) => `<tr class="${Math.abs(x.err) / Math.max(1, x.official) > 0.25 ? "warnrow" : ""}"><td><a href="#/plan?mk=${x.mk}">${esc(x.label)}</a></td><td><span class="pill ${x.side}">${x.side === "red" ? "Red" : "Blue"}</span></td><td class="num">${fmt(x.scouted, 0)}</td><td class="num">${x.official}</td><td class="num">${x.err > 0 ? "+" : ""}${fmt(x.err, 0)}</td><td>${esc(x.scouts.join(", "))}</td></tr>`).join("")}
      </tbody></table></div></details>` : ""}
      <h2>Missing match reports <span class="muted small">(${miss.length})</span></h2>
      ${miss.length ? `<p class="small muted">Played matches where nobody scouted a robot. Tap one to fill it in from memory or video.</p><div class="chips">${miss.slice(0, 80).map((x) => `<a class="btn small" href="#/match?mk=${x.mk}&station=${encodeURIComponent(x.station)}">${esc(x.label)} ${esc(x.station)} · ${x.team}</a>`).join("")}</div>${miss.length > 80 ? `<p class="small muted">…and ${miss.length - 80} more.</p>` : ""}`
        : `<p class="muted">${m.schedule.some((x) => x.data.redScore != null) ? "Every robot in every played match has a report ✓" : "Nothing yet — this fills in as matches are played."}</p>`}
      <h2>Assignments</h2>
      <p class="small muted">Who watches which robot. A scout's phone picks their station automatically (by the name in their Settings). Leave “to” empty for “until the end”; playoff matches use the last shift without an end.</p>
      <form id="asForm">
        <div class="tablewrap"><table class="assign"><thead><tr><th>From Q</th><th>To Q</th>${ES.STATIONS.map((s) => `<th class="${s.startsWith("Red") ? "red" : "blue"}">${s}</th>`).join("")}<th></th></tr></thead><tbody>
          ${a.shifts.map((sh, i) => `<tr><td><input type="number" data-sh="${i}" data-f="from" value="${esc(sh.from || "")}" min="1"></td><td><input type="number" data-sh="${i}" data-f="to" value="${esc(sh.to || "")}" min="1"></td>
            ${ES.STATIONS.map((st) => `<td><input type="text" list="scoutNames" data-sh="${i}" data-st="${esc(st)}" value="${esc((sh.map || {})[st] || "")}"></td>`).join("")}
            <td><button type="button" data-rmsh="${i}" aria-label="Remove shift">✕</button></td></tr>`).join("")}
        </tbody></table></div>
        <datalist id="scoutNames">${known.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <div class="actions"><button type="button" id="addShift">+ Add shift</button><button class="dark" type="submit">Save assignments</button><button type="button" id="printAs">Print</button></div>
        <div class="small muted" id="asMeta">${m.assign ? `Last saved by ${esc(m.assign.scout || "?")} ${new Date(m.assign.updatedAt).toLocaleString()}` : ""}</div>
      </form>`;
    sortable("scTable", [...rows.values()], [
      { key: "name", label: "Scout", val: (r) => r.name },
      { key: "match", label: "Match reports", val: (r) => r.match, cls: "num", desc: true },
      { key: "rating", label: "Ratings", val: (r) => r.rating, cls: "num", desc: true },
      { key: "pit", label: "Pit reports", val: (r) => r.pit, cls: "num", desc: true },
      { key: "total", label: "Total", val: (r) => r.pit + r.match + r.rating, cls: "num", desc: true },
      { key: "acc", label: "Accuracy (avg off by)", val: (r) => (r.errs.length ? St.mean(r.errs) : null), html: (r) => (r.errs.length ? `${fmt(St.mean(r.errs) * 100, 0)}% <span class="muted small">(${r.errs.length})</span>` : "—"), cls: "num" },
      { key: "last", label: "Last report", val: (r) => r.last, html: (r) => (r.last ? new Date(r.last).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""), desc: true }
    ], "total", -1);
    const form = $("#asForm");
    const read = () => {
      const shifts = a.shifts.map((sh, i) => {
        const g = (f) => (form.querySelector(`[data-sh="${i}"][data-f="${f}"]`) || {}).value;
        const map = {};
        ES.STATIONS.forEach((st) => { const v = (form.querySelector(`[data-sh="${i}"][data-st="${st}"]`) || {}).value; if (v && v.trim()) map[st] = v.trim(); });
        return { from: Number(g("from")) || "", to: Number(g("to")) || "", map };
      });
      return shifts;
    };
    $("#addShift").onclick = () => { a.shifts = read(); const last = a.shifts[a.shifts.length - 1]; a.shifts.push({ from: last && last.to ? Number(last.to) + 1 : "", to: "", map: {} }); renderScoutsKeep(a); };
    $$("[data-rmsh]").forEach((b) => (b.onclick = () => { a.shifts = read(); a.shifts.splice(Number(b.dataset.rmsh), 1); renderScoutsKeep(a); }));
    form.addEventListener("input", () => (S.formDirty = "soft"));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const base = m.assign || { id: `assign:${S.settings.event}`, kind: "assign", event: S.settings.event };
      await Core.saveLocal(Object.assign({}, base, { scout: S.settings.scoutName || "Main computer", data: { shifts: read() } }));
      S.formDirty = false;
      await ES.reload(); ES.kickSync();
      toast("Assignments saved — phones pick them up when they sync");
      render();
    };
    $("#printAs").onclick = () => window.print();
  }
  // Re-draw the assignment table with unsaved rows (adding/removing shifts before saving).
  function renderScoutsKeep(a) {
    const saved = S.model.assign;
    S.model.assign = Object.assign({}, saved || { id: `assign:${S.settings.event}`, kind: "assign", event: S.settings.event }, { data: a });
    renderScouts();
    S.model.assign = saved;
    S.formDirty = "soft";
  }

  // ======================= HELP =======================
  function renderHelp() {
    const main = S.settings.mode === "main";
    view.innerHTML = `<h1>How to use 10262 Scouting</h1>
      <details open><summary><h2 style="display:inline">For scouts</h2></summary>
        <ol>
          <li><b>Install once:</b> iPhone — open the link in Safari → Share → <i>Add to Home Screen</i>. Android — Chrome → <i>Install app</i>. Always open it from the icon.</li>
          <li><b>Set up once:</b> Settings → type your name → <i>Scan setup code from the main computer</i>.</li>
          <li><b>Match scouting:</b> pick the match and your station (your assignment is picked for you if the lead made one). Tap the big <b>+1 / +5</b> buttons as pieces score; tap a yes/no box to tick it. The bar at the top shows the points so far. If the robot never shows up, use <i>Robot didn't show up</i>.</li>
          <li><b>Rate teams:</b> all six robots side by side. Rate only what you saw; submit each robot or all at once.</li>
          <li><b>Pit scouting:</b> type the team number and fill in what you learn. Add robot photos with the camera button.</li>
          <li><b>No internet?</b> Keep scouting — everything saves on your phone and the top badge counts what's waiting. It uploads by itself later. In a hurry, Sync &amp; Files → <i>Show QR</i> and let the main computer scan it.</li>
          <li>Made a mistake? Your recent reports are under each form — tap <i>Edit</i>.</li>
        </ol>
      </details>
      <details ${main ? "open" : ""}><summary><h2 style="display:inline">For the scouting lead (main computer)</h2></summary>
        <h3>Before the event</h3>
        <ol>
          <li>Open the app with internet a few days early — free Supabase projects pause after a week of no use (resume them at supabase.com).</li>
          <li>Settings: set the <b>event code</b> (from the event's Blue Alliance link, e.g. 2027paca) and our team number. Have scouts re-scan the setup code so everyone is on the same event.</li>
          <li>Check the <b>Game Builder</b> shows the right season's form (see below).</li>
          <li>Matches → <i>Refresh from The Blue Alliance</i> once the schedule is out; <i>Load Statbotics EPA</i> for a head start before you've scouted anyone.</li>
          <li>Scouts → <b>Assignments</b>: who watches which station, in shifts. Phones pick it up automatically.</li>
          <li>Practise with an event code like <code>2027test</code> — its data stays separate.</li>
        </ol>
        <h3>During qualifications</h3>
        <ul>
          <li><b>Home</b> shows our next match, how far away it is, and scouting coverage.</li>
          <li><b>Match Planner</b>: predicted score and win chance for any match, each robot's averages, and shared strategy notes. <i>Print briefing</i> for the drive team.</li>
          <li><b>Scouts</b>: who's scouting, <i>missing reports</i> (tap one to fill it in), and an accuracy check against official scores.</li>
          <li><b>Rankings</b> and <b>Teams</b>: everything sortable; search notes by keyword (e.g. “tipped”). <b>Compare</b> up to four teams.</li>
        </ul>
        <h3>Alliance selection</h3>
        <ul>
          <li><b>Picklist</b>: set the pick-score formula (what matters to us), press <i>Sort by pick score</i>, then drag or use the arrows to fine-tune. Mark 1st pick / 2nd pick / do-not-pick and add notes.</li>
          <li><b>Alliance selection (live)</b>: fill in picks as they happen; picked and declined teams are crossed off and <i>Best available</i> updates.</li>
        </ul>
        <h3>After the event</h3>
        <ul><li>Sync &amp; Files → download the <b>Excel workbook</b> and a <b>backup</b>.</li></ul>
        <h3>A new season (Kickoff)</h3>
        <ol>
          <li>Game Builder → set the season (e.g. 2027) → <i>Start over from…</i> the blank starter (or last year's form).</li>
          <li>Rename fields to the real game pieces, set each field's <b>phase</b> and <b>points</b> (counters: points each; yes/no: points when yes; pick-one: points per option). Mark which answers mean “the robot had a problem”, and foul points for fouls.</li>
          <li>Try it in the phone preview — the points bar should add up like the real scoreboard.</li>
          <li><i>Publish</i> (needs the delete password). Every device switches when it syncs; a phone with no internet can scan Sync &amp; Files → <i>Show QR: this season's game form</i>.</li>
          <li>Changing the form mid-season? <b>Retire</b> fields instead of deleting them so old answers still count.</li>
        </ol>
      </details>
      <p class="small muted">10262 Scouting v2 · your data stays on each device and in your team's own cloud.</p>`;
  }

  route("help", { title: "Help", render: renderHelp, group: "manage", narrow: true, order: 10 });
  route("scouts", { title: "Scouts", render: renderScouts, group: "manage", main: true, order: 1 });
  route("builder", { title: "Game Builder", short: "Builder", render: renderBuilder, group: "manage", main: true, order: 2 });
  Object.assign(ES, { accuracy, missing });
})();
