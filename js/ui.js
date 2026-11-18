/* 10262 Scouting — screens. */
(function () {
  const Core = window.ESCore, Model = window.ESModel, IO = window.ESIO, Tba = window.ESTba, QR = window.ESQR, Comb = window.ESCombine;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const view = $("#view");

  const S = { settings: null, records: [], model: null, route: "", params: {}, formDirty: false, stopScan: null, qrTimer: null, installPrompt: null, lastStatus: null };

  // ---------------- data ----------------
  async function reload() {
    S.settings = await Core.getSettings();
    S.records = await Core.allRecords(S.settings.event);
    S.model = Model.build(S.records, S.settings);
  }
  async function save(rec) {
    const r = await Core.saveLocal(rec);
    await reload();
    kickSync();
    return r;
  }

  // ---------------- sync loop ----------------
  let syncTimer = null;
  async function kickSync(opts) {
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.sync) reg.sync.register("es-push").catch(() => {});
    } catch (e) { /* background sync not supported (iPhone) — the loop below covers it */ }
    const st = await Core.syncNow(opts);
    S.lastStatus = st;
    if (st.ok && st.pulled) {
      await reload();
      if (!S.formDirty && !S.stopScan) render(); // never wipe a half-filled form
    }
    await updateBadge();
    return st;
  }
  function startSyncLoop() {
    clearInterval(syncTimer);
    syncTimer = setInterval(() => { if (document.visibilityState === "visible") kickSync(); }, 15000);
    window.addEventListener("online", () => kickSync());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kickSync(); });
  }
  async function updateBadge() {
    drawUpload().catch(() => {});
    const b = $("#syncBadge");
    const n = await Core.outboxCount();
    const s = S.settings;
    if (!Core.cloudReady(s)) { b.className = "badge off"; b.textContent = n ? `${n} saved on device` : "Offline mode"; return; }
    if (n) { b.className = "badge wait"; b.textContent = `${n} waiting to upload`; return; }
    const st = S.lastStatus;
    if (st && !st.ok) { b.className = "badge wait"; b.textContent = navigator.onLine ? "Can't reach cloud" : "Offline"; return; }
    b.className = "badge ok"; b.textContent = "All sent ✓";
  }

  // ---------------- toast ----------------
  let toastT;
  function toast(msg, ms = 3200) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ---------------- routing ----------------
  const ROUTES = {
    home: { title: "Home", render: renderHome },
    pit: { title: "Pit Scout", render: renderPit },
    match: { title: "Match Scout", render: renderMatch },
    rate: { title: "Rate Teams", render: renderRate },
    teams: { title: "Teams", render: renderTeams, main: true },
    team: { title: "Team", render: renderTeam, hidden: true },
    pitdata: { title: "Pit Data", render: renderPitData, main: true },
    matches: { title: "Matches", render: renderMatches, main: true },
    summary: { title: "Summary", render: renderSummary, main: true },
    alliance: { title: "Alliance", render: renderAlliance, main: true },
    sync: { title: "Sync & Files", render: renderSync },
    settings: { title: "Settings", render: renderSettings }
  };
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "") || "home";
    const [path, qs] = h.split("?");
    const parts = path.split("/");
    const params = Object.fromEntries(new URLSearchParams(qs || ""));
    if (parts[1]) params.id = decodeURIComponent(parts[1]);
    return { route: ROUTES[parts[0]] ? parts[0] : "home", params };
  }
  function go(hash) { location.hash = hash; }
  window.addEventListener("hashchange", () => {
    if (S.formDirty === true && !confirm("You have an unsaved form. Leave it?")) { history.back(); return; }
    S.formDirty = false;
    render();
    window.scrollTo(0, 0);
  });

  function renderNav() {
    const main = S.settings.mode === "main";
    const keys = Object.keys(ROUTES).filter((k) => !ROUTES[k].hidden && (main || !ROUTES[k].main));
    $("#nav").innerHTML = keys.map((k) => `<a href="#/${k}" class="${S.route === k || (S.route === "team" && k === "teams") ? "on" : ""}">${ROUTES[k].title}</a>`).join("");
    const on = $("#nav a.on"); if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function cleanup() {
    if (S.stopScan) { S.stopScan(); S.stopScan = null; }
    clearInterval(S.qrTimer); S.qrTimer = null;
  }
  function render() {
    cleanup();
    const { route, params } = parseHash();
    S.route = route; S.params = params;
    renderNav();
    const narrow = ["home", "pit", "match", "settings", "sync"].includes(route);
    view.className = "view" + (narrow ? " narrow" : "");
    ROUTES[route].render(params);
    updateBadge();
  }

  // ---------------- form building ----------------
  function fieldHTML(f, value) {
    const id = "f_" + f.key;
    const help = f.help ? ` <span class="help">${esc(f.help)}</span>` : "";
    const unit = f.unit ? ` <span class="help">(${esc(f.unit)})</span>` : "";
    const lab = `<label class="f" for="${id}">${esc(f.label)}${unit}${help}</label>`;
    const v = value;
    switch (f.type) {
      case "number":
        return lab + `<input id="${id}" name="${f.key}" type="number" inputmode="decimal" step="any" value="${esc(v ?? "")}">`;
      case "rating":
        return `<div class="f-wrap">${lab.replace(`for="${id}"`, "")}<div class="chips rating" role="radiogroup" aria-label="${esc(f.label)}">` +
          [1, 2, 3, 4, 5].map((n) => `<label class="chip"><input type="radio" name="${f.key}" value="${n}" ${Number(v) === n ? "checked" : ""}><span>${n}</span></label>`).join("") + `</div></div>`;
      case "choice":
        return `<div>${lab.replace(`for="${id}"`, "")}<div class="chips" role="radiogroup" aria-label="${esc(f.label)}">` +
          f.options.map((o) => `<label class="chip"><input type="radio" name="${f.key}" value="${esc(o)}" ${v === o ? "checked" : ""}><span>${esc(o)}</span></label>`).join("") +
          (v && !f.options.includes(v) ? `<label class="chip"><input type="radio" name="${f.key}" value="${esc(v)}" checked><span>${esc(v)}</span></label>` : "") + `</div></div>`;
      case "multi": {
        const set = new Set([].concat(v || []));
        return `<div>${lab.replace(`for="${id}"`, "")}<div class="chips">` +
          f.options.map((o) => `<label class="chip"><input type="checkbox" name="${f.key}" value="${esc(o)}" ${set.has(o) ? "checked" : ""}><span>${esc(o)}</span></label>`).join("") + `</div></div>`;
      }
      case "longtext":
        return lab + `<textarea id="${id}" name="${f.key}">${esc(v ?? "")}</textarea>`;
      default:
        return lab + `<input id="${id}" name="${f.key}" type="text" value="${esc(v ?? "")}">`;
    }
  }
  function readFields(form, fields) {
    const d = {};
    for (const f of fields) {
      if (f.type === "multi") d[f.key] = $$(`input[name="${f.key}"]:checked`, form).map((i) => i.value);
      else if (f.type === "rating" || f.type === "choice") {
        const c = $(`input[name="${f.key}"]:checked`, form);
        d[f.key] = c ? (f.type === "rating" ? Number(c.value) : c.value) : "";
      } else if (f.type === "number") {
        const raw = form.elements[f.key].value.trim();
        d[f.key] = raw === "" ? "" : Number(raw);
      } else d[f.key] = form.elements[f.key].value.trim();
    }
    return d;
  }
  /** Tap a selected chip again to clear it; mark the form as being edited. */
  function wireForm(form) {
    form.addEventListener("input", () => (S.formDirty = true));
    form.addEventListener("click", (e) => {
      const inp = e.target.closest(".chip") && e.target.closest(".chip").querySelector("input[type=radio]");
      if (!inp) return;
      if (inp.dataset.was === "1") { inp.checked = false; inp.dataset.was = "0"; e.preventDefault(); S.formDirty = true; }
      else { $$(`input[name="${inp.name}"]`, form).forEach((o) => (o.dataset.was = "0")); setTimeout(() => (inp.dataset.was = inp.checked ? "1" : "0")); }
    });
    $$("input[type=radio]:checked", form).forEach((i) => (i.dataset.was = "1"));
  }
  function teamOptions() {
    return `<datalist id="teamlist">${S.model.teams.map((t) => `<option value="${t.number}">${esc(t.name)}</option>`).join("")}</datalist>`;
  }
  function teamName(n) { const t = S.model.teamMap.get(Number(n)); return t ? t.name : ""; }
  function wireTeamInput(input, out) {
    const upd = () => { const n = Number(input.value); out.textContent = n ? (teamName(n) || "New team — not on the list yet") : ""; };
    input.addEventListener("input", upd); upd();
  }
  function needName() {
    if (S.settings.scoutName) return "";
    return `<div class="card warn"><label class="f" for="scoutNameQuick" style="margin-top:0">Your name (so your reports are labelled)</label>
      <div class="row"><input id="scoutNameQuick" type="text" autocomplete="name"><button type="button" class="dark" id="saveNameQuick">Save</button></div></div>`;
  }
  function wireName() {
    const b = $("#saveNameQuick");
    if (b) b.onclick = async () => {
      const v = $("#scoutNameQuick").value.trim();
      if (!v) return;
      S.settings = await Core.saveSettings({ scoutName: v });
      toast(`Hi ${v}!`); render();
    };
  }
  async function afterSubmit(what) {
    toast(`${what} saved on this device ✓`);
    const st = await kickSync({ pullToo: false });
    if (st.ok) toast(`${what} saved and uploaded ✓`);
    else if (Core.cloudReady(S.settings)) toast(`${what} saved ✓ — will upload when there's internet`, 4500);
  }
  // ---- upload progress bar (form pages) ----
  async function trackUpload(ids, what) {
    S.tracking = { route: S.route, ids, what, phase: "saving" };
    await drawUpload();
    toast(`${what} saved on this device ✓`);
    S.tracking.phase = "uploading"; await drawUpload();
    await kickSync({ pullToo: false });
    if (S.tracking) S.tracking.phase = "tried";
    await drawUpload();
  }
  async function drawUpload() {
    const waiting = new Set((await Core.pendingRecords()).map((r) => r.id));
    $$("[data-up]").forEach((x) => {
      const w = waiting.has(x.dataset.up);
      x.textContent = w ? "waiting to upload" : "uploaded ✓";
      x.className = "uptag " + (w ? "wait" : "ok");
    });
    const el = $("#upStatus");
    if (!el) return;
    const t = S.tracking;
    if (!t || t.route !== S.route) { el.innerHTML = ""; return; }
    const left = t.ids.filter((id) => waiting.has(id)).length;
    let pct, msg, cls = "";
    if (t.phase === "saving") { pct = 25; msg = "Saving on this device…"; }
    else if (!left) { pct = 100; msg = "Uploaded ✓"; cls = "ok"; }
    else if (t.phase === "uploading") { pct = 70; msg = "Uploading…"; }
    else if (!Core.cloudReady(S.settings)) { pct = 50; msg = "Saved on this device. Cloud sync isn't set up here, so send it by QR code (Sync & Files)."; cls = "wait"; }
    else if (!navigator.onLine) { pct = 50; msg = "Saved on this device. No internet: it uploads by itself when you're back online."; cls = "wait"; }
    else { pct = 50; msg = "Saved on this device. Can't reach the cloud yet; still trying."; cls = "wait"; }
    const partial = t.ids.length > 1 && left && left < t.ids.length ? ` (${t.ids.length - left} of ${t.ids.length})` : "";
    el.innerHTML = `<div class="upcard ${cls}" role="status"><div class="uprow"><span><b>${esc(t.what)}</b> · ${esc(msg)}${partial}</span><b>${pct}%</b></div><div class="progress"><div style="width:${pct}%"></div></div></div>`;
  }

  // ---- delete password ----
  const DELETE_HASH = "40372f02d049d2db1d273ab0c17a80a253edb6f380fd9f0e533b449e802d84f3"; // only the fingerprint is stored, not the password
  async function sha256(t) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  function askDeletePassword(message) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.className = "pwdlg";
      d.innerHTML = `<form method="dialog"><h2 style="margin-top:0">Delete password needed</h2><p>${esc(message)}</p>
        <label class="f" for="pwIn">Password</label><input id="pwIn" type="password" autocomplete="off">
        <div class="small status-bad" id="pwErr" style="min-height:1.2em;margin-top:.3rem"></div>
        <div class="actions"><button type="button" id="pwCancel">Cancel</button><button type="submit" class="primary" id="pwOk">Delete</button></div></form>`;
      document.body.appendChild(d);
      const done = (ok) => { d.close(); d.remove(); resolve(ok); };
      d.querySelector("#pwCancel").onclick = () => done(false);
      d.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
      d.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        const ok = (await sha256(d.querySelector("#pwIn").value)) === DELETE_HASH;
        if (ok) done(true);
        else { d.querySelector("#pwErr").textContent = "Wrong password. Nothing was deleted."; d.querySelector("#pwIn").select(); }
      };
      d.showModal();
      setTimeout(() => d.querySelector("#pwIn").focus(), 50);
    });
  }

  function myRecent(kind, limit = 8) {
    const dev = S.records.filter((r) => r.kind === kind && !r.deleted && r.scout === S.settings.scoutName)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    if (!dev.length) return "";
    return `<h2>Your recent ${kind === "pit" ? "pit reports" : kind === "match" ? "match reports" : "ratings"}</h2>` +
      dev.map((r) => `<div class="list-item"><div><b>${r.team}</b> ${esc(teamName(r.team))}${kind === "match" || (kind === "rating" && r.data.mk) ? ` · ${esc(Tba.label(Model.mkOf(r)))}` : ""}
        <div class="small muted">${new Date(r.updatedAt).toLocaleString()} · <span data-up="${esc(r.id)}" class="uptag"></span></div></div>
        <a class="btn" href="#/${kind === "rating" ? "rate" : kind}?edit=${encodeURIComponent(r.id)}">Edit</a></div>`).join("");
  }

  // ---------------- HOME ----------------
  function renderHome() {
    const s = S.settings, m = S.model;
    const main = s.mode === "main";
    const pitDone = m.teams.filter((t) => t.pit._count).length;
    view.innerHTML = `
      <h1>${s.scoutName ? `Hi, ${esc(s.scoutName)}` : "Welcome"}</h1>
      <p class="muted">Event <b>${esc(s.event)}</b> · ${esc(m.game.name)} · ${main ? "Main computer" : "Scout device"}</p>
      ${needName()}
      <div class="actions" style="flex-direction:column">
        <a class="btn primary" style="min-height:3.4rem;font-size:1.1rem" href="#/pit">Pit scout a team</a>
        <a class="btn" style="min-height:3.4rem" href="#/match">Scout a match</a>
        <a class="btn" style="min-height:3.4rem" href="#/rate">Rate teams in a match</a>
      </div>
      <div class="card soft">
        <div><b>${m.teams.length}</b> teams · <b>${pitDone}</b> pit-scouted · <b>${m.match.length}</b> match reports · <b>${m.schedule.length}</b> matches scheduled</div>
        <div id="offlineState" class="small muted" style="margin-top:.4rem">Checking offline readiness…</div>
      </div>
      ${main ? "" : `<p class="small muted">Need the dashboard on this device? Switch to <a href="#/settings">Main computer</a> in Settings.</p>`}`;
    wireName();
    offlineCheck().then((t) => { const el = $("#offlineState"); if (el) el.innerHTML = t; });
  }
  async function offlineCheck() {
    if (!("serviceWorker" in navigator)) return `<span class="status-bad">This browser can't work offline.</span>`;
    const reg = await navigator.serviceWorker.getRegistration();
    const ready = reg && reg.active && (await caches.keys()).some((k) => k.startsWith("es-shell"));
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    return (ready ? `<span class="status-ok">Ready to work offline ✓</span>` : `<span class="status-wait">Not ready offline yet — keep it open a moment with internet.</span>`) +
      (standalone ? " · Installed app" : ` · <a href="#/settings">Install on this device</a>`);
  }

  // ---------------- PIT ----------------
  function renderPit(p) {
    const g = S.model.game;
    const editing = p.edit ? S.records.find((r) => r.id === p.edit) : null;
    const team = editing ? editing.team : (p.team || "");
    view.innerHTML = `
      <h1>${editing ? "Edit pit report" : "Pit scouting"}</h1>
      ${needName()}
      <div id="upStatus"></div>
      <form id="pitForm" autocomplete="off">
        <label class="f" for="team">Team number</label>
        <input id="team" name="team" type="number" inputmode="numeric" list="teamlist" required value="${esc(team)}">
        <div class="teamname" id="teamName"></div>
        ${teamOptions()}
        <p class="small muted">Only the team number is required. Fill in whatever you can.</p>
        ${g.pit.map((f) => fieldHTML(f, editing ? editing.data[f.key] : undefined)).join("")}
        <button class="primary big" type="submit">${editing ? "Save changes" : "Submit pit report"}</button>
        ${editing ? `<div class="actions"><a class="btn" href="#/pit">Cancel</a><button type="button" id="del">Delete this report</button></div>` : ""}
      </form>
      ${editing ? "" : myRecent("pit")}`;
    wireName();
    const form = $("#pitForm");
    wireForm(form); wireTeamInput($("#team"), $("#teamName"));
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!S.settings.scoutName) { toast("Add your name first (top of the form)"); return; }
      const t = Number(form.elements.team.value);
      if (!t) { toast("Enter a team number"); return; }
      const rec = editing ? Object.assign({}, editing) : { id: Core.newId("pit"), kind: "pit", event: S.settings.event, scout: S.settings.scoutName };
      rec.team = t; rec.data = readFields(form, g.pit);
      await save(rec);
      S.formDirty = false;
      if (editing) go("#/pit"); else { render(); window.scrollTo(0, 0); }
      trackUpload([rec.id], `Pit report · ${t}`);
    };
    const del = $("#del");
    if (del) del.onclick = async () => {
      if (!(await askDeletePassword("Delete this pit report for everyone?"))) return;
      await save(Object.assign({}, editing, { deleted: true }));
      S.formDirty = false; toast("Deleted"); go("#/pit");
    };
  }

  // ---------------- MATCH ----------------
  const STATIONS = ["Red 1", "Red 2", "Red 3", "Blue 1", "Blue 2", "Blue 3"];
  function teamAt(mk, station) {
    const m = S.model.schedule.find((x) => x.data.mk === mk);
    if (!m || !station) return "";
    const [color, n] = station.split(" ");
    return (color === "Red" ? m.data.red : m.data.blue)[Number(n) - 1] || "";
  }
  function renderMatch(p) {
    const g = S.model.game, sched = S.model.schedule;
    const editing = p.edit ? S.records.find((r) => r.id === p.edit) : null;
    const lastStation = localStorage.getItem("es-station") || "";
    const mk = editing ? Model.mkOf(editing) : (p.mk || "");
    const station = editing ? (editing.data.station || "") : lastStation;
    const opts = sched.map((m) => `<option value="${m.data.mk}" ${m.data.mk === mk ? "selected" : ""}>${esc(m.data.label)} — R ${m.data.red.join(" ")} · B ${m.data.blue.join(" ")}</option>`).join("");
    const qualNum = /^qm(\d+)$/.exec(mk);
    view.innerHTML = `
      <h1>${editing ? "Edit match report" : "Match scouting"}</h1>
      ${needName()}
      <div id="upStatus"></div>
      <form id="mForm" autocomplete="off">
        ${sched.length ? `<label class="f" for="mk">Match</label><select id="mk" name="mk"><option value="">Choose a match…</option>${opts}<option value="_other" ${mk && !sched.some((m) => m.data.mk === mk) ? "selected" : ""}>Not in the list…</option></select>` : ""}
        <div id="otherMatch" ${sched.length && !(mk && !sched.some((m) => m.data.mk === mk)) ? "hidden" : ""}>
          <label class="f" for="qual">Qualification match number</label>
          <input id="qual" name="qual" type="number" inputmode="numeric" value="${qualNum ? qualNum[1] : ""}">
        </div>
        <label class="f">Robot you're watching</label>
        <div class="chips" role="radiogroup">${STATIONS.map((s) => `<label class="chip"><input type="radio" name="station" value="${s}" ${s === station ? "checked" : ""}><span>${s}</span></label>`).join("")}</div>
        <label class="f" for="team">Team number</label>
        <input id="team" name="team" type="number" inputmode="numeric" list="teamlist" required value="${esc(editing ? editing.team : "")}">
        <div class="teamname" id="teamName"></div>
        ${teamOptions()}
        <p class="small muted">Only the match and team number are required. Skip anything you didn't see.</p>
        ${g.match.map((f) => fieldHTML(f, editing ? editing.data[f.key] : undefined)).join("")}
        <button class="primary big" type="submit">${editing ? "Save changes" : "Submit match report"}</button>
        ${editing ? `<div class="actions"><a class="btn" href="#/match">Cancel</a><button type="button" id="del">Delete this report</button></div>` : ""}
      </form>
      ${editing ? "" : myRecent("match")}`;
    wireName();
    const form = $("#mForm");
    wireForm(form);
    const teamIn = $("#team");
    wireTeamInput(teamIn, $("#teamName"));
    const curMk = () => {
      const sel = form.elements.mk;
      if (sel && sel.value && sel.value !== "_other") return sel.value;
      const q = Number(form.elements.qual.value);
      return q ? "qm" + q : "";
    };
    const autofill = () => {
      const st = $("input[name=station]:checked", form);
      const t = teamAt(curMk(), st && st.value);
      if (t) { teamIn.value = t; teamIn.dispatchEvent(new Event("input")); }
    };
    if (form.elements.mk) form.elements.mk.onchange = () => {
      $("#otherMatch").hidden = form.elements.mk.value !== "_other";
      autofill();
    };
    $$("input[name=station]", form).forEach((i) => i.addEventListener("change", autofill));
    if (!editing) autofill();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!S.settings.scoutName) { toast("Add your name first"); return; }
      const k = curMk(), t = Number(teamIn.value);
      if (!k) { toast("Choose the match"); return; }
      if (!t) { toast("Enter the team number"); return; }
      const st = $("input[name=station]:checked", form);
      const sm = S.model.schedule.find((m) => m.data.mk === k);
      const rec = editing ? Object.assign({}, editing) : { id: Core.newId("match"), kind: "match", event: S.settings.event, scout: S.settings.scoutName };
      rec.team = t;
      rec.match = sm ? (sm.match || Number((/(\d+)$/.exec(k) || [])[1]) || 0) : Number(k.slice(2));
      rec.data = Object.assign(readFields(form, g.match), { mk: k, station: st ? st.value : "", alliance: st ? st.value.split(" ")[0] : "" });
      if (st) localStorage.setItem("es-station", st.value);
      await save(rec);
      S.formDirty = false;
      if (editing) { go("#/match"); return; }
      trackUpload([rec.id], `${Tba.label(k)} · ${t}`);
      // Jump to the next match at the same station.
      const i = S.model.schedule.findIndex((m) => m.data.mk === k);
      const next = i >= 0 ? S.model.schedule[i + 1] : null;
      if (next) go(`#/match?mk=${next.data.mk}&t=${Date.now()}`); else { render(); window.scrollTo(0, 0); }
    };
    const del = $("#del");
    if (del) del.onclick = async () => {
      if (!(await askDeletePassword("Delete this match report for everyone?"))) return;
      await save(Object.assign({}, editing, { deleted: true }));
      S.formDirty = false; toast("Deleted"); go("#/match");
    };
  }

  // ---------------- RATE (up to 6 robots per match) ----------------
  const hasData = (d) => Object.values(d || {}).some((v) => !Comb.isBlank(v));
  function matchPickerHTML(mk, allowNone) {
    const sched = S.model.schedule;
    const inList = sched.some((m) => m.data.mk === mk);
    const qualNum = /^qm(\d+)$/.exec(mk || "");
    const opts = sched.map((m) => `<option value="${m.data.mk}" ${m.data.mk === mk ? "selected" : ""}>${esc(m.data.label)} — R ${m.data.red.join(" ")} · B ${m.data.blue.join(" ")}</option>`).join("");
    return (sched.length ? `<label class="f" for="mk">Match</label><select id="mk" name="mk">
        <option value="">${allowNone ? "No specific match" : "Choose a match…"}</option>${opts}
        <option value="_other" ${mk && !inList ? "selected" : ""}>Not in the list…</option></select>` : "") +
      `<div id="otherMatch" ${sched.length && !(mk && !inList) ? "hidden" : ""}>
        <label class="f" for="qual">Qualification match number ${allowNone ? `<span class="help">(optional)</span>` : ""}</label>
        <input id="qual" name="qual" type="number" inputmode="numeric" value="${qualNum ? qualNum[1] : ""}"></div>`;
  }
  function readMk(form) {
    const sel = form.elements.mk;
    if (sel && sel.value && sel.value !== "_other") return sel.value;
    if (sel && !sel.value) return "";
    const q = Number(form.elements.qual.value);
    return q ? "qm" + q : "";
  }
  function matchNumberOf(mk) {
    const sm = S.model.schedule.find((m) => m.data.mk === mk);
    if (sm && sm.match) return sm.match;
    const n = /(\d+)$/.exec(mk || "");
    return n ? Number(n[1]) : undefined;
  }

  function renderRate(p) {
    const g = S.model.game;
    const me = S.settings.scoutName;
    const editRec = p.edit ? S.records.find((r) => r.id === p.edit) : null;
    const mine = (t, mk) => S.records.filter((r) => r.kind === "rating" && !r.deleted && r.team === t && r.scout === me && ((r.data && r.data.mk) || "") === (mk || ""))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    let mk = editRec ? ((editRec.data && editRec.data.mk) || "") : (p.mk || "");
    const slots = editRec
      ? [{ station: editRec.data.station || "Team", team: editRec.team, data: Object.assign({}, editRec.data), id: editRec.id }]
      : STATIONS.map((st) => ({ station: st, team: "", data: {}, id: null }));
    const N = slots.length;
    const sig = (sl) => JSON.stringify([mk || "", Number(sl.team) || "", g.rating.map((f) => sl.data[f.key] ?? "")]);
    const isSaved = (sl) => !!sl.id && sl.saved === sig(sl);
    const isPending = (sl) => !!sl.team && hasData(sl.data) && !isSaved(sl);
    if (editRec) slots[0].saved = sig(slots[0]);

    // Fill team numbers from the schedule and load anything this scout already saved for that match.
    const fillFromMatch = () => {
      if (editRec) return;
      for (const sl of slots) {
        const t = teamAt(mk, sl.station);
        if (t) sl.team = t;
        const prev = sl.team && mine(Number(sl.team), mk);
        if (prev && !hasData(sl.data)) { sl.data = Object.assign({}, prev.data); sl.id = prev.id; sl.saved = sig(sl); }
        else if (!prev) { sl.id = null; sl.saved = null; }
      }
    };
    fillFromMatch();

    const color = (sl) => (sl.station.startsWith("Red") ? "red" : sl.station.startsWith("Blue") ? "blue" : "");
    const ctrl = (f, i) => {
      const lab = `${esc(f.label)} — ${esc(slots[i].station)}`;
      if (f.type === "longtext" || f.type === "text") return `<textarea data-i="${i}" data-k="${f.key}" aria-label="${lab}" placeholder="…"></textarea>`;
      const opts = f.type === "rating" ? ["1", "2", "3", "4", "5"] : f.options;
      return `<select data-i="${i}" data-k="${f.key}" aria-label="${lab}"><option value="">–</option>${opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
    };
    view.innerHTML = `
      <h1>${editRec ? "Edit rating" : "Rate teams in a match"}</h1>
      <p class="muted small">${editRec ? "" : "Pick the match. All six robots are side by side: tap any box to rate. Submit a robot with the button under its column, or all rated robots at the bottom. "}Everything is optional: rate only what you saw. Blank robots aren't saved.</p>
      ${needName()}
      <div id="upStatus"></div>
      <form id="rForm" autocomplete="off">
        ${editRec ? "" : matchPickerHTML(mk, true)}
        ${teamOptions()}
        <div class="rgrid" id="rgrid" style="--cols:${N}">
          <div class="corner"></div>
          ${slots.map((sl, i) => `<div class="rh ${color(sl)}"><div class="st">${esc(sl.station)}</div>
            <input class="rteam" data-i="${i}" type="number" inputmode="numeric" list="teamlist" placeholder="Team #" aria-label="${esc(sl.station)} team number">
            <div class="tn" data-tn="${i}"></div></div>`).join("")}
          ${g.rating.map((f) => `<div class="rl">${esc(f.label)}${f.help ? ` <span class="help">${esc(f.help)}</span>` : ""}</div>` +
            slots.map((sl, i) => `<div class="rc ${i >= N / 2 ? "right" : ""}">${ctrl(f, i)}</div>`).join("")).join("")}
          <div class="corner"></div>
          ${slots.map((sl, i) => `<div class="rf">${editRec ? "" : `<button type="button" class="dark" data-sub="${i}">Submit</button>`}<div class="ss" data-ss="${i}"></div></div>`).join("")}
        </div>
        <button class="primary big" type="submit" id="rSubmit">Submit ratings</button>
        ${editRec ? `<div class="actions"><a class="btn" href="#/rate">Cancel</a><button type="button" id="del">Delete this rating</button></div>` : ""}
      </form>
      ${editRec ? "" : myRecent("rating")}`;
    wireName();
    const form = $("#rForm"), grid = $("#rgrid");
    // On phones a notes box grows to the full width of the grid while you type in it.
    grid.addEventListener("focusin", (e) => {
      const ta = e.target.closest("textarea");
      if (!ta || matchMedia("(min-width: 760px)").matches) return;
      const gr = grid.getBoundingClientRect(), cr = ta.parentElement.getBoundingClientRect();
      ta.style.left = `${gr.left - cr.left}px`; ta.style.width = `${gr.width}px`;
    });
    grid.addEventListener("focusout", (e) => { const ta = e.target.closest("textarea"); if (ta) { ta.style.left = ""; ta.style.width = ""; } });
    const ctl = (i, k) => grid.querySelector(`[data-i="${i}"][data-k="${k}"]`);
    const teamIn = (i) => grid.querySelector(`.rteam[data-i="${i}"]`);

    const fillValues = () => slots.forEach((sl, i) => {
      teamIn(i).value = sl.team || "";
      for (const f of g.rating) ctl(i, f.key).value = sl.data[f.key] ?? "";
    });
    const readAll = () => slots.forEach((sl, i) => {
      sl.team = Number(teamIn(i).value) || "";
      for (const f of g.rating) {
        const v = ctl(i, f.key).value;
        sl.data[f.key] = f.type === "rating" ? (v ? Number(v) : "") : f.type === "longtext" || f.type === "text" ? v.trim() : v;
      }
    });
    const update = () => {
      slots.forEach((sl, i) => {
        grid.querySelector(`[data-tn="${i}"]`).textContent = sl.team ? (teamName(sl.team) || "new team") : "";
        for (const f of g.rating) ctl(i, f.key).classList.toggle("set", !Comb.isBlank(sl.data[f.key]));
        const ss = grid.querySelector(`[data-ss="${i}"]`);
        ss.innerHTML = isSaved(sl) ? `sent ✓<br><span class="uptag" data-up="${esc(sl.id)}"></span>` : isPending(sl) ? `<span class="status-wait">not sent</span>` : "";
        const sb = grid.querySelector(`[data-sub="${i}"]`);
        if (sb) { sb.disabled = !isPending(sl); sb.textContent = isSaved(sl) ? "Sent" : "Submit"; }
      });
      const pending = slots.filter(isPending).length;
      // true = unsaved ratings (warn before leaving); "soft" = scout is mid-way (don't refresh the page under them)
      S.formDirty = pending > 0 ? true : touched && slots.some((sl) => !isSaved(sl) && (sl.team || hasData(sl.data))) ? "soft" : false;
      $("#rSubmit").textContent = editRec ? "Save changes" : pending ? `Submit all rated robots (${pending})` : slots.some(isSaved) ? "Done with this match ▶" : "Submit ratings";
      drawUpload().catch(() => {});
    };
    let touched = false;
    fillValues(); update();
    form.addEventListener("input", () => { touched = true; readAll(); update(); });
    form.addEventListener("change", () => { touched = true; readAll(); update(); });
    grid.addEventListener("click", (e) => { const b = e.target.closest("[data-sub]"); if (b) submitSlots([slots[Number(b.dataset.sub)]]); });

    const onMatch = () => {
      const newMk = readMk(form);
      if (form.elements.mk) $("#otherMatch").hidden = form.elements.mk.value !== "_other";
      if (newMk === mk) return;
      readAll();
      mk = newMk;
      fillFromMatch();
      fillValues(); update(); // values change in place, so a tap into the grid is never lost
    };
    if (form.elements.mk) form.elements.mk.onchange = onMatch;
    if (form.elements.qual) form.elements.qual.onchange = onMatch;

    async function submitSlots(list) {
      if (!S.settings.scoutName) { toast("Add your name first (top of the page)"); return false; }
      readAll();
      if (!editRec) mk = readMk(form);
      const missingTeam = list.find((sl) => !sl.team && hasData(sl.data));
      if (missingTeam) { toast(`${missingTeam.station} has ratings but no team number`); return false; }
      const todo = list.filter((sl) => sl.team && hasData(sl.data) && (editRec || !isSaved(sl)));
      if (!todo.length) { toast(list.length === 1 ? "Rate something for this robot first" : "Nothing to save yet: rate at least one robot"); return false; }
      for (const sl of todo) {
        const t = Number(sl.team);
        const prev = (sl.id && S.records.find((r) => r.id === sl.id && r.team === t)) || mine(t, mk);
        const rec = prev ? Object.assign({}, prev) : { id: Core.newId("rating"), kind: "rating", event: S.settings.event, scout: S.settings.scoutName };
        rec.team = t;
        rec.match = mk ? matchNumberOf(mk) : undefined;
        const data = {};
        for (const f of g.rating) data[f.key] = sl.data[f.key] ?? "";
        rec.data = Object.assign(data, { mk: mk || "", station: STATIONS.includes(sl.station) ? sl.station : (prev && prev.data.station) || "" });
        const saved = await Core.saveLocal(rec);
        sl.id = saved.id; sl.saved = sig(sl);
      }
      await reload();
      update();
      const what = todo.length === 1 ? `${STATIONS.includes(todo[0].station) ? todo[0].station : "Rating"} · ${todo[0].team}` : `Ratings for ${todo.map((sl) => sl.team).join(", ")}`;
      trackUpload(todo.map((sl) => sl.id), what);
      return true;
    }
    const nextMatch = () => {
      S.formDirty = false;
      if (editRec) { go("#/rate"); return; }
      const i = S.model.schedule.findIndex((m) => m.data.mk === mk);
      const next = i >= 0 ? S.model.schedule[i + 1] : null;
      go(next ? `#/rate?mk=${next.data.mk}&t=${Date.now()}` : `#/rate?t=${Date.now()}`);
      window.scrollTo(0, 0);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      readAll();
      if (!editRec && !slots.some(isPending) && slots.some(isSaved)) { nextMatch(); return; } // "Done with this match"
      if (await submitSlots(slots)) nextMatch();
    };
    const del = $("#del");
    if (del) del.onclick = async () => {
      if (!(await askDeletePassword("Delete this rating for everyone?"))) return;
      await save(Object.assign({}, editRec, { deleted: true }));
      S.formDirty = false; toast("Deleted"); go("#/rate");
    };
  }

  // ---------------- TEAMS ----------------
  function cellOf(c) {
    if (!c || !c.n) return `<span class="muted">—</span>`;
    return esc(c.display).replace(/\n/g, "<br>") + (c.disagree ? `<span class="dis" title="Scouts disagree"></span>` : "");
  }
  function sortable(tableId, rows, cols, defaultKey) {
    let key = defaultKey, dir = 1;
    const draw = () => {
      const sorted = rows.slice().sort((a, b) => {
        const x = cols.find((c) => c.key === key).val(a), y = cols.find((c) => c.key === key).val(b);
        if (x === y) return 0;
        if (x === null || x === undefined || x === "") return 1;
        if (y === null || y === undefined || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
      $("#" + tableId).innerHTML = `<thead><tr>${cols.map((c) => `<th class="sort ${c.cls || ""}" data-k="${c.key}">${esc(c.label)}${c.key === key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
        <tbody>${sorted.map((r) => `<tr class="${r._cls || ""}">${cols.map((c) => `<td class="${c.cls || ""}">${c.html ? c.html(r) : esc(c.val(r) ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
      $$(`#${tableId} th`).forEach((th) => (th.onclick = () => { if (key === th.dataset.k) dir = -dir; else { key = th.dataset.k; dir = cols.find((c) => c.key === key).desc ? -1 : 1; } draw(); }));
    };
    draw();
  }
  const teamLink = (t) => `<a href="#/team/${t.number}">${t.number}</a>`;
  const ours = (n) => String(n) === String(S.settings.ourTeam);

  function renderTeams() {
    const m = S.model;
    view.innerHTML = `<h1>Teams</h1>
      <div class="row"><input type="search" id="q" placeholder="Search number or name"></div>
      <p class="small muted">Tap a team for everything scouts entered. <span class="dis"></span> = scouts disagree.</p>
      <div class="tablewrap"><table id="tt"></table></div>`;
    const cols = [
      { key: "number", label: "Team #", val: (t) => t.number, html: teamLink },
      { key: "name", label: "Name", val: (t) => t.name },
      { key: "rank", label: "Rank", val: (t) => t.summary && t.summary.rank, cls: "num" },
      { key: "overall", label: "Overall", val: (t) => t.summary && t.summary.overall, cls: "num", desc: true },
      { key: "matches", label: "Matches", val: (t) => (t.summary ? t.summary.matches : 0), cls: "num", desc: true },
      { key: "pit", label: "Pit reports", val: (t) => t.pit._count, cls: "num", desc: true },
      { key: "tier", label: "Tier", val: (t) => t.rating.tier.value, html: (t) => cellOf(t.rating.tier) },
      { key: "threat", label: "Threat", val: (t) => t.rating.threat.value, html: (t) => cellOf(t.rating.threat) },
      { key: "rel", label: "Reliability", val: (t) => t.rating.reliability.value, html: (t) => cellOf(t.rating.reliability) },
      { key: "role", label: "Best role", val: (t) => t.rating.bestRole.value, html: (t) => cellOf(t.rating.bestRole) },
      { key: "drive", label: "Drive", val: (t) => t.pit.drive.value, html: (t) => cellOf(t.pit.drive) },
      { key: "awards", label: "Awards", val: (t) => (t.info.awards || []).join(", ") }
    ];
    const all = m.teams.map((t) => Object.assign(t, { _cls: ours(t.number) ? "ours" : "" }));
    const draw = () => {
      const q = $("#q").value.trim().toLowerCase();
      sortable("tt", all.filter((t) => !q || String(t.number).includes(q) || t.name.toLowerCase().includes(q)), cols, "number");
    };
    $("#q").oninput = draw; draw();
  }

  function renderTeam(p) {
    const n = Number(p.id), t = S.model.teamMap.get(n), g = S.model.game, main = S.settings.mode === "main";
    if (!t) { view.innerHTML = `<h1>Team ${esc(p.id)}</h1><p>No information yet.</p><a class="btn primary" href="#/pit?team=${esc(p.id)}">Pit scout this team</a>`; return; }
    const kvs = (fields, comb) => `<dl class="kv">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${cellOf(comb[f.key])}</dd>`).join("")}</dl>`;
    const perScout = (reps, fields) => reps.map((r) => `<details><summary>${esc(r.scout || "?")}${r.data && r.data.mk ? ` · ${esc(Tba.label(r.data.mk))}` : ""} · ${new Date(r.updatedAt).toLocaleString()}</summary>
      <dl class="kv">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc([].concat(r.data[f.key] ?? "").join(", "))}</dd>`).join("")}</dl></details>`).join("");
    const s = t.summary;
    view.innerHTML = `
      <h1>${t.number} ${esc(t.name)} ${ours(t.number) ? `<span class="pill">Us</span>` : ""}</h1>
      <div class="actions">
        <a class="btn primary" href="#/pit?team=${n}">Pit scout</a>
        
        <a class="btn" target="_blank" rel="noopener" href="https://www.thebluealliance.com/team/${n}">Blue Alliance ↗</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.statbotics.io/team/${n}">Statbotics ↗</a>
      </div>
      <div class="card soft">
        ${s ? `<b>Rank ${s.rank}</b> · Overall ${s.overall} · Auto ${s.avgAuto ?? "—"} · Teleop ${s.avgTeleop ?? "—"} · Endgame ${s.avgEndgame ?? "—"} · Defense ${s.avgDefense ?? "—"} · Driver ${s.avgDriver ?? "—"} · ${s.matches} matches${s.problems ? ` · <span class="status-bad">${s.problems} with problems</span>` : ""}` : "No match scouting yet."}
        <div class="small" style="margin-top:.4rem">Playoffs: ${esc(t.info.playoffs || "—")} · Worlds: ${esc(t.info.worlds || "—")} · Awards: ${esc((t.info.awards || []).join(", ") || "—")}</div>
      </div>
      ${main ? `<details><summary>Edit team info</summary><form id="tiForm" class="grid2">
        <div><label class="f" for="ti_name">Team name</label><input id="ti_name" name="name" type="text" value="${esc(t.name)}"></div>
        <div><label class="f" for="ti_p">Playoffs?</label><select id="ti_p" name="playoffs">${["", "Yes", "No", "No events"].map((o) => `<option ${o === (t.info.playoffs || "") ? "selected" : ""}>${o}</option>`).join("")}</select></div>
        <div><label class="f" for="ti_w">Worlds?</label><select id="ti_w" name="worlds">${["", "Qualified", "Didn't Qualify", "No events"].map((o) => `<option ${o === (t.info.worlds || "") ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
        ${[0, 1, 2].map((i) => `<div><label class="f" for="ti_a${i}">Award ${i + 1}</label><select id="ti_a${i}" name="a${i}"><option></option>${window.ESFields.AWARDS.map((a) => `<option ${a === (t.info.awards || [])[i] ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>`).join("")}
        <div style="align-self:end"><button class="dark" type="submit">Save team info</button></div></form></details>` : ""}
      <h2>Pit scouting <span class="muted small">(${t.pit._count} report${t.pit._count === 1 ? "" : "s"}${t.pit._scouts.length ? " by " + esc(t.pit._scouts.join(", ")) : ""})</span></h2>
      ${t.pit._count ? kvs(g.pit, t.pit) + `<h3>Each scout's report</h3>` + perScout(t.pitReports, g.pit) : `<p class="muted">Not pit-scouted yet.</p>`}
      <h2>Ratings <span class="muted small">(${t.rating._count})</span></h2>
      ${t.rating._count ? kvs(g.rating, t.rating) + `<h3>Each scout's rating</h3>` + perScout(t.ratingReports, g.rating) : `<p class="muted">No ratings yet.</p>`}
      <h2>Match reports <span class="muted small">(${t.matchReports.length})</span></h2>
      ${t.matchReports.length ? `<div class="tablewrap"><table><thead><tr><th>Match</th><th>Scout</th>${g.match.map((f) => `<th class="${f.type === "longtext" ? "wrap" : ""}">${esc(f.label)}</th>`).join("")}</tr></thead><tbody>
        ${t.matchReports.map((r) => `<tr><td>${esc(Tba.label(Model.mkOf(r)))}</td><td>${esc(r.scout)}</td>${g.match.map((f) => `<td class="${f.type === "longtext" ? "wrap" : "num"}">${esc([].concat(r.data[f.key] ?? "").join(", "))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">None yet.</p>`}`;
    const f = $("#tiForm");
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const base = t.teamRecord || { id: `team:${S.settings.event}:${n}`, kind: "team", event: S.settings.event, team: n, data: {} };
      const rec = Object.assign({}, base, { scout: S.settings.scoutName || "Main computer" });
      rec.data = Object.assign({}, base.data, { name: f.elements.name.value.trim(), playoffs: f.elements.playoffs.value, worlds: f.elements.worlds.value,
        awards: [0, 1, 2].map((i) => f.elements["a" + i].value).filter(Boolean) });
      await save(rec); toast("Team info saved"); render();
    };
  }

  // ---------------- PIT DATA ----------------
  function renderPitData() {
    const m = S.model, g = m.game;
    const done = m.teams.filter((t) => t.pit._count).length;
    view.innerHTML = `<h1>Pit data</h1><p class="muted small">${done} of ${m.teams.length} teams pit-scouted. Gray rows still need a visit. When several scouts report, numbers are averaged and choices show how many picked each. <span class="dis"></span> = scouts disagree.</p>
      <div class="actions"><label class="chip"><input type="checkbox" id="onlyMissing"><span>Only teams still to scout</span></label></div>
      <div class="tablewrap"><table id="pt"></table></div>`;
    const cols = [{ key: "number", label: "Team #", val: (t) => t.number, html: teamLink }, { key: "name", label: "Name", val: (t) => t.name },
      { key: "n", label: "Reports", val: (t) => t.pit._count, cls: "num", desc: true }]
      .concat(g.pit.map((f) => ({ key: f.key, label: f.label, cls: f.type === "longtext" ? "wrap" : "", val: (t) => { const c = t.pit[f.key]; return c.n ? (typeof c.value === "number" ? c.value : c.display) : ""; }, html: (t) => cellOf(t.pit[f.key]), desc: f.type === "number" })));
    const draw = () => {
      const only = $("#onlyMissing").checked;
      sortable("pt", m.teams.filter((t) => !only || !t.pit._count).map((t) => Object.assign(t, { _cls: t.pit._count ? (ours(t.number) ? "ours" : "") : "gray" })), cols, "number");
    };
    $("#onlyMissing").onchange = draw; draw();
  }

  // ---------------- MATCHES ----------------
  function renderMatches() {
    const m = S.model, s = S.settings;
    const teamCell = (n, mk) => { const done = m.scouted.has(`${mk}|${n}`); return `<a href="#/team/${n}" class="${ours(n) ? "team-ours" : ""}">${n}</a>${done ? " ✓" : ""}`; };
    view.innerHTML = `<h1>Matches</h1>
      <div class="actions">
        <button class="dark" id="tbaBtn">Refresh from The Blue Alliance</button>
        <span class="small muted" id="tbaMsg">${s.tbaKey ? "Refreshes automatically every 5 minutes while this page is open with internet." : `Add your Blue Alliance API key in <a href="#/settings">Settings</a> to load the schedule.`}</span>
      </div>
      ${m.schedule.length ? `<p class="small muted">✓ = at least one scout submitted a report for that robot. ${s.ourTeam ? `Our team (${esc(s.ourTeam)}) is highlighted.` : ""}</p>
      <div class="tablewrap"><table><thead><tr><th>Match</th><th>Red 1</th><th>Red 2</th><th>Red 3</th><th>Blue 1</th><th>Blue 2</th><th>Blue 3</th><th>Red</th><th>Blue</th><th>Winner</th><th>Scouted</th></tr></thead><tbody>
      ${m.schedule.map((x) => { const d = x.data, all = [...d.red, ...d.blue]; const sc = all.filter((n) => m.scouted.has(`${d.mk}|${n}`)).length;
        return `<tr class="${all.some(ours) ? "ours" : ""}"><td><a href="#/match?mk=${d.mk}">${esc(d.label)}</a></td>${[0, 1, 2].map((i) => `<td>${d.red[i] ? teamCell(d.red[i], d.mk) : ""}</td>`).join("")}${[0, 1, 2].map((i) => `<td>${d.blue[i] ? teamCell(d.blue[i], d.mk) : ""}</td>`).join("")}
        <td class="num">${d.redScore ?? ""}</td><td class="num">${d.blueScore ?? ""}</td><td>${d.winner === "red" ? `<span class="pill red">Red</span>` : d.winner === "blue" ? `<span class="pill blue">Blue</span>` : esc(d.winner || "")}</td><td class="num">${sc}/6</td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="muted">No schedule yet. It appears once the event posts it on The Blue Alliance and you refresh. Scouts can still enter match numbers by hand.</p>`}`;
    $("#tbaBtn").onclick = () => tbaRefresh(true);
  }
  let tbaTimer = null, tbaLast = 0;
  async function tbaRefresh(loud) {
    const s = S.settings;
    if (!s.tbaKey) { if (loud) toast("Add your Blue Alliance key in Settings first"); return; }
    const msg = $("#tbaMsg");
    try {
      if (msg && loud) msg.textContent = "Loading…";
      const { matches, teams } = await Tba.fetchEvent(s.event, s.tbaKey);
      // Only save matches that changed, so the cloud isn't flooded.
      const changed = [];
      for (const md of matches) {
        const cur = S.records.find((r) => r.id === md.id);
        if (!cur || JSON.stringify(cur.data) !== JSON.stringify(md.data) || cur.deleted) changed.push(md);
      }
      for (const t of teams) {
        const id = `team:${s.event}:${t.number}`;
        const cur = S.records.find((r) => r.id === id);
        if (!cur) changed.push({ id, kind: "team", event: s.event, team: t.number, scout: "The Blue Alliance", data: { name: t.name, awards: [] } });
        else if (!cur.data.name && t.name) changed.push(Object.assign({}, cur, { data: Object.assign({}, cur.data, { name: t.name }) }));
      }
      for (const r of changed) await Core.saveLocal(r);
      tbaLast = Date.now();
      await reload(); kickSync();
      if (loud) toast(`Blue Alliance: ${matches.length} matches, ${teams.length} teams (${changed.length} updates)`);
      if (S.route === "matches") render();
    } catch (e) {
      if (loud) toast(navigator.onLine ? e.message : "No internet — can't reach The Blue Alliance", 5000);
      if (msg) msg.textContent = navigator.onLine ? e.message : "Offline — showing the last schedule saved on this device.";
    }
  }
  function startTbaLoop() {
    clearInterval(tbaTimer);
    tbaTimer = setInterval(() => {
      if (S.settings.mode === "main" && S.settings.tbaKey && navigator.onLine && document.visibilityState === "visible" && Date.now() - tbaLast > 290000) tbaRefresh(false);
    }, 30000);
  }

  // ---------------- SUMMARY ----------------
  function renderSummary() {
    const m = S.model;
    view.innerHTML = `<h1>Team summary</h1>
      <p class="small muted">Built from match scouting. When several scouts watch the same robot in the same match, they're averaged first, so that match only counts once. Overall = Avg Auto + Avg Teleop + Avg Endgame.</p>
      ${m.summary.length ? `<div class="tablewrap"><table id="st"></table></div>` : `<p class="muted">No match reports yet.</p>`}`;
    if (!m.summary.length) return;
    const rows = m.summary.map((s) => Object.assign({}, s, { name: (m.teamMap.get(s.team) || {}).name || "", _cls: ours(s.team) ? "ours" : "" }));
    sortable("st", rows, [
      { key: "rank", label: "Rank", val: (r) => r.rank, cls: "num" },
      { key: "team", label: "Team #", val: (r) => r.team, html: (r) => `<a href="#/team/${r.team}">${r.team}</a>` },
      { key: "name", label: "Name", val: (r) => r.name },
      { key: "avgAuto", label: "Avg Auto", val: (r) => r.avgAuto, cls: "num", desc: true },
      { key: "avgTeleop", label: "Avg Teleop", val: (r) => r.avgTeleop, cls: "num", desc: true },
      { key: "avgEndgame", label: "Avg Endgame", val: (r) => r.avgEndgame, cls: "num", desc: true },
      { key: "avgDefense", label: "Avg Defense", val: (r) => r.avgDefense, cls: "num", desc: true },
      { key: "avgDriver", label: "Avg Driver", val: (r) => r.avgDriver, cls: "num", desc: true },
      { key: "matches", label: "Matches", val: (r) => r.matches, cls: "num", desc: true },
      { key: "problems", label: "Problem matches", val: (r) => r.problems, cls: "num", desc: true },
      { key: "overall", label: "Overall", val: (r) => r.overall, cls: "num", desc: true }
    ], "rank");
  }

  // ---------------- ALLIANCE ----------------
  function renderAlliance() {
    const m = S.model;
    const cur = m.alliance ? JSON.parse(JSON.stringify(m.alliance.data)) : { ranking: [], alliances: [] };
    cur.ranking = cur.ranking || []; cur.alliances = cur.alliances || [];
    for (let i = 0; i < 8; i++) cur.alliances[i] = cur.alliances[i] || [null, null, null];
    let saveT = null;
    const persist = () => {
      clearTimeout(saveT);
      saveT = setTimeout(async () => {
        const base = m.alliance || { id: `alliance:${S.settings.event}`, kind: "alliance", event: S.settings.event };
        await save(Object.assign({}, base, { scout: S.settings.scoutName || "Main computer", data: cur }));
        const el = $("#alSaved"); if (el) el.textContent = "Saved " + new Date().toLocaleTimeString();
      }, 400);
    };
    const opts = (sel) => `<option value=""></option>` + m.teams.map((t) => `<option value="${t.number}" ${Number(sel) === t.number ? "selected" : ""}>${t.number} ${esc(t.name)}</option>`).join("");
    const draw = () => {
      const picked = cur.alliances.flat().filter(Boolean).map(Number);
      const counts = {}; picked.forEach((n) => (counts[n] = (counts[n] || 0) + 1));
      view.innerHTML = `<h1>Alliance selection</h1>
        <p class="small muted">Shared with every main computer. Last saved by ${esc((m.alliance && m.alliance.scout) || "—")} <span id="alSaved"></span></p>
        <div class="board">
          <section><h2>General rankings</h2>
            <div class="row"><select id="addTeam">${opts()}</select><button class="dark" id="addBtn">Add</button><button id="fillBtn" title="Add every team in Summary order">Fill from Summary</button></div>
            <div id="rankList">${cur.ranking.map((r, i) => `<div class="rankrow ${picked.includes(Number(r.team)) ? "picked" : ""}">
              <b>${i + 1}</b><a href="#/team/${r.team}">${r.team}</a>
              <input type="text" data-note="${i}" value="${esc(r.notes || "")}" placeholder="${esc(teamName(r.team))}">
              <span><button data-up="${i}" aria-label="Move up">↑</button><button data-down="${i}" aria-label="Move down">↓</button><button data-rm="${i}" aria-label="Remove">✕</button></span></div>`).join("") || `<p class="muted">Add teams in the order you'd pick them.</p>`}</div>
          </section>
          <section><h2>Predictions</h2>
            <div class="alli small muted"><span></span><span>Captain</span><span>Pick 1</span><span>Pick 2</span></div>
            ${cur.alliances.map((a, i) => `<div class="alli"><b>${i + 1}</b>${[0, 1, 2].map((k) => `<select data-a="${i}" data-k="${k}" class="${a[k] && counts[a[k]] > 1 ? "dup" : ""}">${opts(a[k])}</select>`).join("")}</div>`).join("")}
            <p class="small muted">Red = team picked twice. Picked teams fade on the left.</p>
          </section></div>`;
      $("#addBtn").onclick = () => { const v = Number($("#addTeam").value); if (v && !cur.ranking.some((r) => Number(r.team) === v)) { cur.ranking.push({ team: v, notes: "" }); persist(); draw(); } };
      $("#fillBtn").onclick = () => { const have = new Set(cur.ranking.map((r) => Number(r.team))); m.summary.forEach((s) => { if (!have.has(s.team)) cur.ranking.push({ team: s.team, notes: "" }); }); persist(); draw(); };
      $$("[data-note]").forEach((el) => (el.oninput = () => { cur.ranking[el.dataset.note].notes = el.value; persist(); }));
      $$("[data-up]").forEach((b) => (b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [cur.ranking[i - 1], cur.ranking[i]] = [cur.ranking[i], cur.ranking[i - 1]]; persist(); draw(); } }));
      $$("[data-down]").forEach((b) => (b.onclick = () => { const i = +b.dataset.down; if (i < cur.ranking.length - 1) { [cur.ranking[i + 1], cur.ranking[i]] = [cur.ranking[i], cur.ranking[i + 1]]; persist(); draw(); } }));
      $$("[data-rm]").forEach((b) => (b.onclick = () => { cur.ranking.splice(+b.dataset.rm, 1); persist(); draw(); }));
      $$("[data-a]").forEach((el) => (el.onchange = () => { cur.alliances[el.dataset.a][el.dataset.k] = el.value ? Number(el.value) : null; persist(); draw(); }));
    };
    draw();
  }

  // ---------------- SYNC & FILES ----------------
  async function renderSync() {
    const s = S.settings, main = s.mode === "main";
    const n = await Core.outboxCount();
    const st = (await Core.getMeta("lastStatus")) || null;
    const last = await Core.getMeta("lastSync");
    view.innerHTML = `<h1>Sync & files</h1>
      <div class="card">
        <div><b>${n}</b> report${n === 1 ? "" : "s"} waiting to upload from this device.</div>
        <div class="small muted">Cloud: ${Core.cloudReady(s) ? "set up" : `<span class="status-wait">not set up</span> — see <a href="#/settings">Settings</a>`} · Last successful sync: ${last ? new Date(last).toLocaleString() : "never"}</div>
        ${st && !st.ok && st.error ? `<div class="small status-wait">${esc(st.error)}</div>` : ""}
        <div class="actions"><button class="dark" id="syncBtn">Sync now</button></div>
        <p class="small muted">Everything is saved on this device first. Uploads retry automatically whenever there's internet${"SyncManager" in window ? ", even after the app is closed" : " while the app is open — open it once when you get signal"}.</p>
      </div>
      <h2>No internet? Use QR codes</h2>
      <div class="card soft">
        <p class="small">On the <b>scout's phone</b>: show codes. On the <b>main computer</b>: scan them. Nothing is lost if a report gets scanned twice.</p>
        <div class="actions">
          <button id="qrPending">Show QR: my ${n} waiting report${n === 1 ? "" : "s"}</button>
          <button id="qrAll">Show QR: everything from this device</button>
          <button class="dark" id="qrScan">Scan QR codes</button>
        </div>
        <div id="qrArea"></div>
      </div>
      <h2>Files</h2>
      <div class="card soft">
        <div class="actions">
          <button id="xlsxBtn">Download Excel workbook</button>
          <button id="jsonBtn">Download backup (.json)</button>
          <label class="btn">Restore / merge a backup<input type="file" id="jsonIn" accept=".json,application/json" hidden></label>
          ${main ? `<label class="btn">Import old spreadsheet (.xlsx)<input type="file" id="xlsxIn" accept=".xlsx" hidden></label>` : ""}
        </div>
        <p class="small muted">Backups and imports merge with what's here — the newest version of each report wins, nothing is doubled. A backup file on a USB stick also moves data between computers with no internet.</p>
        <div id="fileMsg" class="small"></div>
      </div>
      <h2>Clear scouting reports</h2>
      <div class="card warn">
        <p class="small">Removes reports for event <b>${esc(s.event)}</b> from every device and the cloud. Needs the delete password. Teams, the schedule and the alliance board are kept.</p>
        <div class="chips">${[["pit", "Pit reports"], ["match", "Match reports"], ["rating", "Ratings"]].map(([k, l]) => `<label class="chip"><input type="checkbox" class="clrKind" value="${k}" checked><span>${l}</span></label>`).join("")}</div>
        <div class="grid2">
          <div><label class="f" for="clrTeam">Only this team <span class="help">(optional)</span></label><input id="clrTeam" type="number" inputmode="numeric" list="teamlist" placeholder="All teams">${teamOptions()}</div>
          <div><label class="f" for="clrScout">Only this scout <span class="help">(optional)</span></label><select id="clrScout"><option value="">Everyone</option>${[...new Set(S.records.filter((r) => ["pit", "match", "rating"].includes(r.kind) && !r.deleted).map((r) => r.scout).filter(Boolean))].sort().map((n) => `<option>${esc(n)}</option>`).join("")}</select></div>
        </div>
        <div style="margin-top:.8rem"><label class="chip"><input type="checkbox" id="clrBackup" checked><span>Download a backup first</span></label></div>
        <div class="actions"><button class="dark" id="clrBtn">Clear reports…</button><button id="undoBtn" hidden>Undo last clear</button></div>
        <div id="clrMsg" class="small"></div>
      </div>`;
    $("#syncBtn").onclick = async () => {
      const r = await kickSync();
      toast(r.ok ? `Synced ✓ (${r.pushed} sent, ${r.pulled} received)` : r.error, 4500);
      renderSync();
    };
    // clear reports
    const clrList = () => {
      const kinds = $$(".clrKind:checked").map((c) => c.value);
      const team = Number($("#clrTeam").value) || null;
      const scout = $("#clrScout").value;
      return S.records.filter((r) => !r.deleted && kinds.includes(r.kind) && (!team || r.team === team) && (!scout || r.scout === scout));
    };
    const clrCount = () => { const n2 = clrList().length; $("#clrBtn").textContent = `Clear ${n2} report${n2 === 1 ? "" : "s"}…`; $("#clrBtn").disabled = !n2; };
    $$(".clrKind").forEach((c) => (c.onchange = clrCount));
    $("#clrTeam").oninput = clrCount; $("#clrScout").onchange = clrCount;
    clrCount();
    Core.getMeta("lastClear").then((lc) => { if (lc && lc.ids && lc.ids.length) { const u = $("#undoBtn"); if (u) { u.hidden = false; u.textContent = `Undo last clear (${lc.ids.length})`; } } });
    $("#clrBtn").onclick = async () => {
      const list = clrList();
      if (!list.length) return;
      if (!(await askDeletePassword(`Delete ${list.length} report${list.length === 1 ? "" : "s"} for everyone? You can undo this from this device.`))) return;
      if ($("#clrBackup").checked) download(new Blob([IO.backupJSON(await Core.allRecords(), s)], { type: "application/json" }), `10262Scouting_before-clear_${stamp()}.json`);
      for (const r of list) await Core.saveLocal(Object.assign({}, r, { deleted: true }));
      await Core.setMeta("lastClear", { ids: list.map((r) => r.id), at: Date.now() });
      await reload(); kickSync();
      toast(`Cleared ${list.length} reports`);
      renderSync();
    };
    $("#undoBtn").onclick = async () => {
      const lc = await Core.getMeta("lastClear");
      if (!lc || !lc.ids) return;
      let n2 = 0;
      for (const id of lc.ids) { const r = await Core.getRecord(id); if (r && r.deleted) { await Core.saveLocal(Object.assign({}, r, { deleted: false })); n2++; } }
      await Core.setMeta("lastClear", null);
      await reload(); kickSync();
      toast(`Restored ${n2} reports`);
      renderSync();
    };
    $("#qrPending").onclick = async () => showQR(await Core.pendingRecords());
    $("#qrAll").onclick = async () => { const dev = await Core.deviceId(); showQR(S.records.filter((r) => r.device === dev && ["pit", "match", "rating"].includes(r.kind))); };
    $("#qrScan").onclick = () => scanQR();
    $("#xlsxBtn").onclick = async () => {
      await needXLSX();
      const all = S.records;
      download(new Blob([IO.exportWorkbook(S.model, all)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `10262Scouting_${s.event}_${stamp()}.xlsx`);
    };
    $("#jsonBtn").onclick = async () => {
      const all = await Core.allRecords();
      download(new Blob([IO.backupJSON(all, s)], { type: "application/json" }), `10262Scouting_backup_${stamp()}.json`);
    };
    $("#jsonIn").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const recs = IO.parseBackup(await f.text());
        const ch = await Core.mergeRecords(recs, { queue: true });
        await reload(); kickSync();
        $("#fileMsg").innerHTML = `<span class="status-ok">Merged ${recs.length} records (${ch} new or newer).</span>`;
      } catch (err) { $("#fileMsg").innerHTML = `<span class="status-bad">${esc(err.message)}</span>`; }
    };
    const xi = $("#xlsxIn");
    if (xi) xi.onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        await needXLSX();
        const { records, summary } = IO.importWorkbook(await f.arrayBuffer(), s.event, S.model.game);
        const ch = await Core.mergeRecords(records, { queue: true });
        await reload(); kickSync();
        $("#fileMsg").innerHTML = `<span class="status-ok">Imported into event ${esc(s.event)}: ${esc(summary)}. ${ch} new or updated records.</span>`;
      } catch (err) { $("#fileMsg").innerHTML = `<span class="status-bad">Couldn't read that file: ${esc(err.message)}</span>`; }
    };
  }
  let xlsxP = null;
  function needXLSX() { // the Excel library is big, so it's only loaded when someone imports/exports
    if (window.XLSX) return Promise.resolve();
    return xlsxP || (xlsxP = new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = "vendor/xlsx.full.min.js"; sc.onload = res; sc.onerror = () => { xlsxP = null; rej(new Error("Couldn't load the Excel tool")); };
      document.head.appendChild(sc);
    }));
  }
  function stamp() { const d = new Date(); return d.toISOString().slice(0, 16).replace(/[:T]/g, "-"); }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function showQR(recs) {
    cleanup();
    const area = $("#qrArea");
    if (!recs.length) { area.innerHTML = `<p class="muted">Nothing to send.</p>`; return; }
    const chunks = IO.qrChunks(recs);
    let i = 0, paused = false;
    const draw = () => {
      area.innerHTML = `<div class="qrbox">${QR.svg(chunks[i])}<p><b>Code ${i + 1} of ${chunks.length}</b> · ${recs.length} report${recs.length === 1 ? "" : "s"}</p>
        <div class="actions" style="justify-content:center"><button id="qPrev">◀</button><button id="qPause">${paused ? "Play" : "Pause"}</button><button id="qNext">▶</button></div>
        <p class="small muted">${chunks.length > 1 ? "Codes change every 1.5 seconds — hold the phone steady in front of the computer's camera until it says complete." : "Hold this in front of the computer's camera."}</p></div>`;
      $("#qPrev").onclick = () => { i = (i - 1 + chunks.length) % chunks.length; draw(); };
      $("#qNext").onclick = () => { i = (i + 1) % chunks.length; draw(); };
      $("#qPause").onclick = () => { paused = !paused; draw(); };
    };
    draw();
    if (chunks.length > 1) S.qrTimer = setInterval(() => { if (!paused) { i = (i + 1) % chunks.length; draw(); } }, 1500);
  }
  async function scanQR() {
    cleanup();
    const area = $("#qrArea");
    area.innerHTML = `<video class="scan" id="scanVid" muted></video><div class="progress" style="margin-top:.6rem"><div id="scanBar" style="width:0"></div></div>
      <p id="scanMsg" class="small">Point the camera at the scout's QR code.</p><div class="actions"><button id="scanStop">Stop camera</button></div>`;
    const batches = new Map();
    $("#scanStop").onclick = () => { cleanup(); area.innerHTML = ""; };
    S.stopScan = await QR.startScanner($("#scanVid"), async (text) => {
      const setup = parseSetup(text);
      if (setup) { $("#scanMsg").textContent = "That's a setup code — scan it from Settings on the scout's phone instead."; return; }
      const c = IO.parseChunk(text);
      if (!c) { $("#scanMsg").textContent = "That QR code isn't from 10262 Scouting."; return; }
      if (!batches.has(c.batch)) batches.set(c.batch, { n: c.n, parts: {} });
      const b = batches.get(c.batch);
      b.parts[c.i] = c.part;
      const have = Object.keys(b.parts).length;
      $("#scanBar").style.width = `${Math.round((have / b.n) * 100)}%`;
      $("#scanMsg").textContent = `Got code ${have} of ${b.n}…`;
      if (have === b.n) {
        try {
          const recs = IO.unpackRecords(Array.from({ length: b.n }, (_, k) => b.parts[k + 1]).join(""));
          const ch = await Core.mergeRecords(recs, { queue: true });
          batches.delete(c.batch);
          await reload(); kickSync();
          $("#scanMsg").innerHTML = `<span class="status-ok">Complete ✓ ${recs.length} reports received (${ch} new). Ready for the next phone.</span>`;
          toast(`Received ${recs.length} reports by QR`);
        } catch (e) { $("#scanMsg").textContent = "Couldn't read that set of codes — try showing them again."; batches.delete(c.batch); }
      }
    }, (err) => { $("#scanMsg").innerHTML = `<span class="status-bad">${esc(err)}</span>`; });
  }

  // ---------------- SETTINGS ----------------
  function setupPayload() {
    const s = S.settings;
    return "ESSETUP|" + btoa(unescape(encodeURIComponent(JSON.stringify({ u: s.cloudUrl, k: s.cloudKey, c: s.teamCode, e: s.event, t: s.ourTeam }))));
  }
  function parseSetup(text) {
    if (!/^ESSETUP\|/.test(text || "")) return null;
    try { const j = JSON.parse(decodeURIComponent(escape(atob(text.slice(8))))); return { cloudUrl: j.u || "", cloudKey: j.k || "", teamCode: j.c || "", event: j.e || "", ourTeam: j.t || "" }; } catch (e) { return null; }
  }
  function renderSettings() {
    const s = S.settings;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    view.innerHTML = `<h1>Settings</h1>
      <form id="sForm" autocomplete="off">
        <label class="f" for="scoutName">Your name</label><input id="scoutName" name="scoutName" type="text" value="${esc(s.scoutName)}">
        <label class="f">This device is a…</label>
        <div class="chips">${[["scout", "Scout device (forms only)"], ["main", "Main computer (dashboard too)"]].map(([v, l]) => `<label class="chip"><input type="radio" name="mode" value="${v}" ${s.mode === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
        <div class="grid2">
          <div><label class="f" for="event">Event code <span class="help">from the event's Blue Alliance link, e.g. 2026njbr</span></label><input id="event" name="event" type="text" value="${esc(s.event)}"></div>
          <div><label class="f" for="ourTeam">Our team number</label><input id="ourTeam" name="ourTeam" type="number" value="${esc(s.ourTeam)}"></div>
        </div>
        <h2>Cloud sync</h2>
        <button type="button" id="scanSetup" class="dark">Scan setup code from the main computer</button>
        <details ${s.cloudUrl ? "" : "open"}><summary>Type the details instead</summary>
          <label class="f" for="cloudUrl">Supabase project URL</label><input id="cloudUrl" name="cloudUrl" type="text" placeholder="https://xxxx.supabase.co" value="${esc(s.cloudUrl)}">
          <label class="f" for="cloudKey">Supabase anon / publishable key</label><input id="cloudKey" name="cloudKey" type="text" value="${esc(s.cloudKey)}">
        </details>
        <label class="f" for="teamCode">Team code</label><input id="teamCode" name="teamCode" type="password" value="${esc(s.teamCode)}" autocomplete="off">
        <div id="setupScan"></div>
        ${s.mode === "main" ? `<h2>The Blue Alliance</h2>
          <label class="f" for="tbaKey">Read API key <span class="help">thebluealliance.com → Account → Read API Keys. Stays on this computer only.</span></label>
          <input id="tbaKey" name="tbaKey" type="password" value="${esc(s.tbaKey)}">` : ""}
        <button class="primary big" type="submit">Save settings</button>
      </form>
      <div class="actions"><button id="testCloud">Test cloud connection</button></div>
      ${s.mode === "main" && Core.cloudReady(s) ? `<h2>Set up scout phones</h2><div class="card soft"><p class="small">On each phone: install the app, open <b>Settings → Scan setup code</b>, and point it at this code. It fills in the cloud details and team code.</p>
        <div class="qrbox" style="max-width:300px">${QR.svg(setupPayload())}</div><p class="small muted">Only show this to your own team — it contains the team code.</p></div>` : ""}
      <h2>Install on this device</h2>
      <div class="card soft">
        ${standalone ? `<span class="status-ok">Installed ✓</span>` : ios ? `<p><b>iPhone / iPad:</b> open this page in <b>Safari</b>, tap the <b>Share</b> button (square with arrow), then <b>Add to Home Screen</b>. Open it from the new icon from now on — reports saved in Safari stay in Safari.</p>` :
          `<p>Use the <b>Install</b> button below, or your browser menu (⋮) → <b>Install app</b> / <b>Add to Home screen</b>.</p><button id="installBtn" class="dark" ${S.installPrompt ? "" : "hidden"}>Install app</button>`}
        <div id="offlineState2" class="small" style="margin-top:.5rem"></div>
        <div id="storageState" class="small muted"></div>
      </div>
      <p class="small muted">10262 Scouting · data stays on this device unless cloud sync is set up. Device ID: <span id="devId"></span></p>`;
    Core.deviceId().then((d) => ($("#devId").textContent = d));
    offlineCheck().then((t) => { const el = $("#offlineState2"); if (el) el.innerHTML = t; });
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then((p) => { const el = $("#storageState"); if (el) el.textContent = p ? "Storage: protected from automatic clean-up ✓" : "Storage: the browser may clear data if the device runs very low on space — install the app to protect it."; });
    const form = $("#sForm");
    wireForm(form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const prevEvent = S.settings.event;
      const patch = {
        scoutName: form.elements.scoutName.value.trim(),
        mode: ($("input[name=mode]:checked", form) || {}).value || "scout",
        event: form.elements.event.value.trim().toLowerCase(),
        ourTeam: form.elements.ourTeam.value.trim(),
        cloudUrl: form.elements.cloudUrl.value.trim(), cloudKey: form.elements.cloudKey.value.trim(),
        teamCode: form.elements.teamCode.value.trim()
      };
      if (form.elements.tbaKey) patch.tbaKey = form.elements.tbaKey.value.trim();
      if (!/^\d{4}[a-z0-9]+$/.test(patch.event)) { toast("Event code looks wrong — it should look like 2026njbr"); return; }
      S.settings = await Core.saveSettings(patch);
      S.formDirty = false;
      await reload();
      toast(prevEvent !== patch.event ? `Switched to event ${patch.event}` : "Settings saved");
      kickSync(); render();
    };
    $("#testCloud").onclick = async () => {
      const r = await kickSync();
      toast(r.ok ? "Cloud connection works ✓" : (r.error || "Couldn't connect"), 5000);
    };
    $("#scanSetup").onclick = async () => {
      cleanup();
      const box = $("#setupScan");
      box.innerHTML = `<video class="scan" id="setVid" muted></video><p id="setMsg" class="small">Point the camera at the setup code on the main computer.</p><button type="button" id="setStop">Cancel</button>`;
      $("#setStop").onclick = () => { cleanup(); box.innerHTML = ""; };
      S.stopScan = await QR.startScanner($("#setVid"), async (text) => {
        const cfg = parseSetup(text);
        if (!cfg) { $("#setMsg").textContent = "That isn't a setup code."; return; }
        cleanup();
        const patch = { cloudUrl: cfg.cloudUrl, cloudKey: cfg.cloudKey, teamCode: cfg.teamCode };
        if (cfg.event) patch.event = cfg.event;
        if (cfg.ourTeam) patch.ourTeam = cfg.ourTeam;
        S.settings = await Core.saveSettings(patch);
        await reload();
        toast("Set up ✓ — testing the connection…");
        const r = await kickSync();
        toast(r.ok ? "Connected to the team cloud ✓" : "Saved. " + (r.error || ""), 5000);
        render();
      }, (err) => { $("#setMsg").innerHTML = `<span class="status-bad">${esc(err)}</span>`; });
    };
    const ib = $("#installBtn");
    if (ib) ib.onclick = async () => { if (!S.installPrompt) return; S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; render(); };
  }

  // ---------------- start ----------------
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installPrompt = e; const b = $("#installBtn"); if (b) b.hidden = false; });
  window.addEventListener("beforeunload", (e) => { if (S.formDirty === true) { e.preventDefault(); e.returnValue = ""; } });

  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const offerUpdate = (w) => {
        $("#banner").innerHTML = `<div class="card warn row"><span>A new version of the app is ready.</span><button class="primary" id="updBtn">Update now</button></div>`;
        $("#updBtn").onclick = () => { if (S.formDirty && !confirm("Your unsaved form will be cleared. Update anyway?")) return; S.formDirty = false; w.postMessage("skipWaiting"); };
      };
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w); });
      });
      // Reload only when an UPDATE takes over — not the first time offline mode switches on.
      let reloaded = false, hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController && !reloaded && !S.formDirty) { reloaded = true; location.reload(); }
        hadController = true;
      });
      navigator.serviceWorker.addEventListener("message", async (e) => { if (e.data === "synced") { await reload(); updateBadge(); } });
    } catch (e) { console.warn("Service worker failed", e); }
  }

  (async function start() {
    try {
      await reload();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      render();
      registerSW();
      startSyncLoop();
      startTbaLoop();
      kickSync();
    } catch (e) {
      view.innerHTML = `<h1>Something went wrong</h1><p>${esc(e.message)}</p><p class="small muted">If this is a private/incognito window, open the app in a normal window — private mode can't save data.</p>`;
    }
  })();

  window.ESApp = { S, reload, render, kickSync };
})();
