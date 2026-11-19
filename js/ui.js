/* 10262 Scouting — screens. */
(function () {
  const Core = window.ESCore, Model = window.ESModel, IO = window.ESIO, Tba = window.ESTba, QR = window.ESQR, Comb = window.ESCombine;
  const G = window.ESGame, St = window.ESStats;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const view = $("#view");

  const S = { settings: null, records: [], model: null, route: "", params: {}, formDirty: false, stopScan: null, qrTimer: null, installPrompt: null, lastStatus: null };

  // ---------------- data ----------------
  async function reload() {
    S.settings = await Core.getSettings();
    S.records = await Core.allRecords(S.settings.event);
    S.globals = await Core.allRecords("_global");
    S.model = Model.build(S.records, S.settings, S.globals);
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
  // Screens register themselves here (this file and ui-*.js). group = where it sits in the menu.
  const ROUTES = {};
  const GROUPS = ["scout", "event", "analyze", "manage"];
  function route(id, def) { ROUTES[id] = Object.assign({ group: "manage" }, def); }
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
    const cur = (ROUTES[S.route] && ROUTES[S.route].navAs) || S.route;
    let html = "";
    for (const grp of GROUPS) {
      const keys = Object.keys(ROUTES).filter((k) => ROUTES[k].group === grp && !ROUTES[k].hidden && (main || !ROUTES[k].main))
        .sort((a, b) => (ROUTES[a].order || 0) - (ROUTES[b].order || 0));
      if (!keys.length) continue;
      if (html) html += `<span class="navsep" aria-hidden="true"></span>`;
      html += keys.map((k) => `<a href="#/${k}" class="${cur === k ? "on" : ""}">${(main && ROUTES[k].short) || ROUTES[k].title}</a>`).join("");
    }
    $("#nav").innerHTML = html;
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
    view.className = "view" + (ROUTES[route].narrow ? " narrow" : "");
    ROUTES[route].render(params);
    updateBadge();
  }

  // ---------------- form building ----------------
  function fieldHTML(f, value) {
    const id = "f_" + f.key;
    const help = f.help ? ` <span class="help">${esc(f.help)}</span>` : "";
    const unit = f.unit ? ` <span class="help">(${esc(f.unit)})</span>` : "";
    const pts = f.points ? ` <span class="ptshint">${f.points > 0 ? "+" : ""}${f.points} ${f.type === "toggle" ? "pts" : "each"}</span>` : "";
    const lab = `<label class="f" for="${id}">${esc(f.label)}${unit}${pts}${help}</label>`;
    const v = value;
    switch (f.type) {
      case "header":
        return `<h3 class="fhead">${esc(f.label)}</h3>${f.help ? `<p class="small muted">${esc(f.help)}</p>` : ""}`;
      case "counter": {
        const n = Number(v) || 0;
        return `<div class="fieldrow">${lab}<div class="counter">
          <button type="button" class="cbtn minus" data-c="-1" data-k="${f.key}" aria-label="${esc(f.label)} minus one">−</button>
          <input id="${id}" class="cval" name="${f.key}" type="number" inputmode="numeric" min="0" step="1" value="${n}">
          <button type="button" class="cbtn plus" data-c="1" data-k="${f.key}" aria-label="${esc(f.label)} plus one">+1</button>
          ${f.bigStep ? `<button type="button" class="cbtn plus" data-c="${f.bigStep}" data-k="${f.key}" aria-label="${esc(f.label)} plus ${f.bigStep}">+${f.bigStep}</button>` : ""}
        </div></div>`;
      }
      case "toggle":
        return `<label class="tog" for="${id}"><input id="${id}" type="checkbox" name="${f.key}" ${G.truthy(v) ? "checked" : ""}><span>${esc(f.label)}${pts}</span></label>${f.help ? `<div class="small muted togHelp">${esc(f.help)}</div>` : ""}`;
      case "number":
        return lab + `<input id="${id}" name="${f.key}" type="number" inputmode="decimal" step="any" value="${esc(v ?? "")}">`;
      case "rating":
        return `<div class="f-wrap">${lab.replace(`for="${id}"`, "")}<div class="chips rating" role="radiogroup" aria-label="${esc(f.label)}">` +
          [1, 2, 3, 4, 5].map((n) => `<label class="chip"><input type="radio" name="${f.key}" value="${n}" ${Number(v) === n ? "checked" : ""}><span>${n}</span></label>`).join("") + `</div></div>`;
      case "choice":
        return `<div>${lab.replace(`for="${id}"`, "")}<div class="chips" role="radiogroup" aria-label="${esc(f.label)}">` +
          f.options.map((o) => `<label class="chip"><input type="radio" name="${f.key}" value="${esc(o)}" ${v === o ? "checked" : ""}><span>${esc(o)}${f.optionPoints && f.optionPoints[o] ? ` <small class="ptshint">(${f.optionPoints[o] > 0 ? "+" : ""}${f.optionPoints[o]})</small>` : ""}</span></label>`).join("") +
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
      if (f.type === "header") continue;
      if (f.type === "toggle") { const el = form.elements[f.key]; d[f.key] = !!(el && el.checked); continue; }
      if (f.type === "counter") { const el = form.elements[f.key]; const n = el ? Number(el.value) : 0; d[f.key] = isFinite(n) && n > 0 ? Math.round(n) : 0; continue; }
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
    // −/+ counter buttons
    form.addEventListener("click", (e) => {
      const b = e.target.closest(".cbtn");
      if (!b) return;
      const inp = form.elements[b.dataset.k];
      if (!inp) return;
      inp.value = Math.max(0, (Number(inp.value) || 0) + Number(b.dataset.c));
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (x) { /* ignore */ }
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
    const s = S.settings, m = S.model, g = m.game;
    const main = s.mode === "main";
    const pitDone = m.teams.filter((t) => t.pit._count).length;
    const played = m.schedule.filter((x) => x.data.redScore != null);
    const slots = played.length * 6, filled = played.reduce((a, x) => a + [...x.data.red, ...x.data.blue].filter((t) => m.scouted.has(`${x.data.mk}|${t}`)).length, 0);
    const formLabel = g.source === "published" ? `version ${g.version}` : g.source === "builtin" ? "built-in" : `${g.fallbackFor} form not made yet`;
    // A scout's next assigned robot (from the Scouts page)
    let mine = null;
    if (s.scoutName) for (const x of m.schedule) {
      if (x.data.redScore != null) continue;
      const a = assignmentFor(x.data.mk);
      if (a) { mine = { x, station: a.station, team: teamAt(x.data.mk, a.station) }; break; }
    }
    const next = main && window.ES.ourNextMatches ? window.ES.ourNextMatches()[0] : null;
    let nextCard = "";
    if (next) {
      const d = next.data, side = d.red.some((t) => String(t) === String(s.ourTeam)) ? "red" : "blue";
      const pr = St.predictMatch(d.red, d.blue, m.stats, m.fallback);
      const win = side === "red" ? pr.redWin : 1 - pr.redWin;
      const partners = d[side].filter((t) => String(t) !== String(s.ourTeam)), opp = d[side === "red" ? "blue" : "red"];
      const before = m.schedule.filter((x) => x.data.redScore == null && St.mkOf({ data: x.data }) !== d.mk && Tba.sortValue(x.data.mk) < Tba.sortValue(d.mk)).length;
      nextCard = `<a class="card homecard" href="#/plan?mk=${d.mk}"><div class="small muted">Our next match${before ? ` — ${before} match${before === 1 ? "" : "es"} away` : " — up next"}</div>
        <div class="big">${esc(d.label)} · <span class="pill ${side}">${side === "red" ? "Red" : "Blue"}</span>${d.time ? ` <span class="small muted">${new Date(d.time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>` : ""}</div>
        <div class="small">With ${partners.join(", ")} · against ${opp.join(", ")} · predicted <b>${Math.round(win * 100)}%</b> to win</div><div class="small">Open the match planner ▶</div></a>`;
    }
    const bar = (n, d) => `<div class="progress"><div style="width:${d ? Math.round((n / d) * 100) : 0}%"></div></div>`;
    view.innerHTML = `
      <h1>${s.scoutName ? `Hi, ${esc(s.scoutName)}` : "Welcome"}</h1>
      <p class="muted">Event <b>${esc(s.event)}</b> · ${esc(g.name)} form (${esc(formLabel)}) · ${main ? "Main computer" : "Scout device"}</p>
      ${needName()}
      ${gameNotice()}
      ${mine ? `<a class="card homecard" href="#/match?mk=${mine.x.data.mk}&station=${encodeURIComponent(mine.station)}"><div class="small muted">Your next robot</div>
        <div class="big">${esc(mine.x.data.label)} · ${esc(mine.station)} · ${esc(mine.team || "")}</div><div class="small">${esc(teamName(mine.team) || "")} — tap to scout it ▶</div></a>` : ""}
      <div class="actions" style="flex-direction:column">
        <a class="btn primary" style="min-height:3.4rem;font-size:1.1rem" href="#/match">Scout a match</a>
        <a class="btn" style="min-height:3.4rem" href="#/pit">Pit scout a team</a>
        <a class="btn" style="min-height:3.4rem" href="#/rate">Rate teams in a match</a>
      </div>
      ${nextCard}
      ${main ? `<div class="card soft">
        <div class="row"><span>Pit scouting: <b>${pitDone}</b> of ${m.teams.length} teams</span>${m.teams.length > pitDone ? `<a href="#/pitdata">see who's left ▶</a>` : ""}</div>${bar(pitDone, m.teams.length)}
        ${played.length ? `<div class="row" style="margin-top:.6rem"><span>Match coverage: <b>${filled}</b> of ${slots} robots in ${played.length} played matches</span>${slots > filled ? `<a href="#/scouts">missing reports ▶</a>` : ""}</div>${bar(filled, slots)}` : ""}
      </div>` : ""}
      <div class="card soft">
        <div><b>${m.teams.length}</b> teams · <b>${m.pit.length}</b> pit reports · <b>${m.match.length}</b> match reports · <b>${m.rating.length}</b> ratings · <b>${m.schedule.length}</b> matches scheduled</div>
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
      ${gameNotice()}
      <div id="upStatus"></div>
      <form id="pitForm" autocomplete="off">
        <label class="f" for="team">Team number</label>
        <input id="team" name="team" type="number" inputmode="numeric" list="teamlist" required value="${esc(team)}">
        <div class="teamname" id="teamName"></div>
        ${teamOptions()}
        <p class="small muted">Only the team number is required. Fill in whatever you can.</p>
        ${G.formFields(g, "pit").map((f) => fieldHTML(f, editing ? editing.data[f.key] : undefined)).join("")}
        <label class="f">Robot photos <span class="help">(optional — saved small; they upload over the internet, not by QR)</span></label>
        <div class="photoin"><label class="btn">📷 Take or add photo<input type="file" accept="image/*" id="photoIn" multiple hidden></label><div id="photoPrev" class="thumbs"></div></div>
        <button class="primary big" type="submit">${editing ? "Save changes" : "Submit pit report"}</button>
        ${editing ? `<div class="actions"><a class="btn" href="#/pit">Cancel</a><button type="button" id="del">Delete this report</button></div>` : ""}
      </form>
      ${editing ? "" : myRecent("pit")}`;
    wireName();
    const form = $("#pitForm");
    wireForm(form); wireTeamInput($("#team"), $("#teamName"));
    const photos = [];
    const drawThumbs = () => {
      $("#photoPrev").innerHTML = photos.map((ph, i) => `<span class="thumb"><img src="${ph.img}" alt="Photo ${i + 1}"><button type="button" data-rmph="${i}" aria-label="Remove photo">✕</button></span>`).join("");
      $$("[data-rmph]").forEach((b) => (b.onclick = () => { photos.splice(Number(b.dataset.rmph), 1); drawThumbs(); }));
    };
    $("#photoIn").onchange = async (e) => {
      for (const file of [...e.target.files].slice(0, 4)) {
        try { photos.push(await shrinkPhoto(file)); } catch (err) { toast("Couldn't read that photo"); }
      }
      e.target.value = "";
      S.formDirty = true;
      drawThumbs();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!S.settings.scoutName) { toast("Add your name first (top of the form)"); return; }
      const t = Number(form.elements.team.value);
      if (!t) { toast("Enter a team number"); return; }
      for (const ph of photos) await Core.saveLocal({ id: Core.newId("photo"), kind: "photo", event: S.settings.event, team: t, scout: S.settings.scoutName, data: ph });
      const rec = editing ? Object.assign({}, editing) : { id: Core.newId("pit"), kind: "pit", event: S.settings.event, scout: S.settings.scoutName };
      rec.team = t; rec.data = Object.assign({}, editing ? editing.data : {}, readFields(form, G.formFields(g, "pit")), { _g: G.stamp(g) });
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

  /** Shrink a camera photo to at most 1024 px and JPEG quality 0.6 (about 100 KB). */
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ img: c.toDataURL("image/jpeg", 0.6), w: c.width, h: c.height, caption: "" });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
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
    const fields = G.formFields(g, "match");
    const editing = p.edit ? S.records.find((r) => r.id === p.edit) : null;
    const lastStation = localStorage.getItem("es-station") || "";
    const mk = editing ? Model.mkOf(editing) : (p.mk || "");
    const station = editing ? (editing.data.station || "") : (p.station || assignedStation(mk) || lastStation);
    const opts = sched.map((m) => `<option value="${m.data.mk}" ${m.data.mk === mk ? "selected" : ""}>${esc(m.data.label)} — R ${m.data.red.join(" ")} · B ${m.data.blue.join(" ")}</option>`).join("");
    const qualNum = /^qm(\d+)$/.exec(mk);
    const phases = G.PHASES.filter((ph) => fields.some((f) => f.phase === ph.id));
    // A "No show" button appears when the form has a problem option that means the robot never came.
    const noShowField = fields.find((f) => f.type === "choice" && (f.problemOptions || []).some((o) => /no.?show/i.test(o)));
    const noShowOpt = noShowField ? noShowField.problemOptions.find((o) => /no.?show/i.test(o)) : null;
    view.innerHTML = `
      <h1>${editing ? "Edit match report" : "Match scouting"}</h1>
      ${needName()}
      ${gameNotice()}
      <div id="upStatus"></div>
      <form id="mForm" autocomplete="off">
        ${sched.length ? `<label class="f" for="mk">Match</label><select id="mk" name="mk"><option value="">Choose a match…</option>${opts}<option value="_other" ${mk && !sched.some((m) => m.data.mk === mk) ? "selected" : ""}>Not in the list…</option></select>` : ""}
        <div id="otherMatch" ${sched.length && !(mk && !sched.some((m) => m.data.mk === mk)) ? "hidden" : ""}>
          <label class="f" for="qual">Qualification match number</label>
          <input id="qual" name="qual" type="number" inputmode="numeric" value="${qualNum ? qualNum[1] : ""}">
        </div>
        <label class="f">Robot you're watching</label>
        <div class="chips stations" role="radiogroup">${STATIONS.map((s) => `<label class="chip ${s.startsWith("Red") ? "red" : "blue"}"><input type="radio" name="station" value="${s}" ${s === station ? "checked" : ""}><span>${s}</span></label>`).join("")}</div>
        <label class="f" for="team">Team number</label>
        <input id="team" name="team" type="number" inputmode="numeric" list="teamlist" required value="${esc(editing ? editing.team : "")}">
        <div class="teamname" id="teamName"></div>
        <div id="assignNote" class="small"></div>
        ${teamOptions()}
        <p class="small muted">Only the match and team number are required. Skip anything you didn't see.</p>
        <div class="ptsbar" id="ptsBar" aria-live="polite"></div>
        <div class="phasejump">${phases.map((ph) => `<button type="button" data-jump="${ph.id}">${esc(St.PHASE_SHORT[ph.id] || ph.label)}</button>`).join("")}</div>
        ${phases.map((ph) => `<section class="phase ph-${ph.id}" id="ph-${ph.id}"><h2>${esc(ph.label)}</h2>
          ${fields.filter((f) => f.phase === ph.id).map((f) => fieldHTML(f, editing ? editing.data[f.key] : undefined)).join("")}</section>`).join("")}
        ${noShowOpt && !editing ? `<button type="button" id="noShow" class="ghostbtn">Robot didn't show up — submit as "${esc(noShowOpt)}"</button>` : ""}
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
      const a = assignmentFor(curMk());
      $("#assignNote").innerHTML = a ? `Your assignment: <b>${esc(a.station)}</b>${st && st.value !== a.station ? ` — <button type="button" class="link" id="useAssign">switch to it</button>` : " ✓"}` : "";
      const ua = $("#useAssign");
      if (ua) ua.onclick = () => { const r = $(`input[name=station][value="${a.station}"]`, form); if (r) { r.checked = true; autofill(); } };
    };
    const drawPts = () => {
      const pts = G.reportPoints(readFields(form, fields), g);
      const parts = ["auto", "teleop", "endgame"].filter((ph) => phases.some((x) => x.id === ph)).map((ph) => `<span>${St.PHASE_SHORT[ph]} <b>${St.fmt(pts[ph], 0)}</b></span>`);
      $("#ptsBar").innerHTML = `${parts.join("")}<span class="tot">Total <b>${St.fmt(pts.total, 0)}</b></span>${pts.penalty ? `<span class="pen">Fouls −${St.fmt(pts.penalty, 0)}</span>` : ""}`;
    };
    form.addEventListener("input", drawPts);
    form.addEventListener("change", drawPts);
    drawPts();
    $$("[data-jump]", form).forEach((b) => (b.onclick = () => { const el = $("#ph-" + b.dataset.jump); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" }); }));
    if (form.elements.mk) form.elements.mk.onchange = () => {
      $("#otherMatch").hidden = form.elements.mk.value !== "_other";
      autofill();
    };
    form.elements.qual.addEventListener("change", autofill);
    $$("input[name=station]", form).forEach((i) => i.addEventListener("change", autofill));
    if (!editing) autofill();
    const submit = async (overrides) => {
      if (!S.settings.scoutName) { toast("Add your name first"); return; }
      const k = curMk(), t = Number(teamIn.value);
      if (!k) { toast("Choose the match"); return; }
      if (!t) { toast("Enter the team number"); return; }
      const st = $("input[name=station]:checked", form);
      const sm = S.model.schedule.find((m) => m.data.mk === k);
      const rec = editing ? Object.assign({}, editing) : { id: Core.newId("match"), kind: "match", event: S.settings.event, scout: S.settings.scoutName };
      rec.team = t;
      rec.match = sm ? (sm.match || Number((/(\d+)$/.exec(k) || [])[1]) || 0) : Number(k.slice(2));
      rec.data = Object.assign({}, editing ? editing.data : {}, readFields(form, fields), overrides || {},
        { mk: k, station: st ? st.value : "", alliance: st ? st.value.split(" ")[0] : "", _g: G.stamp(g) });
      if (st) localStorage.setItem("es-station", st.value);
      await save(rec);
      S.formDirty = false;
      if (editing) { go("#/match"); return; }
      // Jump to the next match at the same station.
      const i = S.model.schedule.findIndex((m) => m.data.mk === k);
      const next = i >= 0 ? S.model.schedule[i + 1] : null;
      if (next) go(`#/match?mk=${next.data.mk}&t=${Date.now()}`); else { render(); window.scrollTo(0, 0); }
      trackUpload([rec.id], `${Tba.label(k)} · ${t}`);
    };
    form.onsubmit = (e) => { e.preventDefault(); submit(); };
    const ns = $("#noShow");
    if (ns) ns.onclick = () => { if (confirm(`Submit this robot as "${noShowOpt}"?`)) submit({ [noShowField.key]: noShowOpt }); };
    const del = $("#del");
    if (del) del.onclick = async () => {
      if (!(await askDeletePassword("Delete this match report for everyone?"))) return;
      await save(Object.assign({}, editing, { deleted: true }));
      S.formDirty = false; toast("Deleted"); go("#/match");
    };
  }

  // ---------------- scout assignments (made on the Scouts page) ----------------
  function assignmentFor(mk) {
    const a = S.model.assign;
    const me = (S.settings.scoutName || "").trim().toLowerCase();
    if (!a || !me || !a.data || !Array.isArray(a.data.shifts)) return null;
    // Shifts cover qualification match numbers; playoff matches use a shift with no end.
    const q = /^qm(\d+)$/.exec(mk || "");
    const n = q ? Number(q[1]) : null;
    for (const sh of a.data.shifts) {
      const from = Number(sh.from) || 0, to = Number(sh.to) || 0;
      const inRange = n === null ? !to : (!from || n >= from) && (!to || n <= to);
      if (!inRange) continue;
      for (const [station, who] of Object.entries(sh.map || {})) if (String(who || "").trim().toLowerCase() === me) return { station, shift: sh };
    }
    return null;
  }
  function assignedStation(mk) { const a = assignmentFor(mk); return a ? a.station : ""; }

  /** Warn when this year's form hasn't been made yet (falls back to an older game). */
  function gameNotice() {
    const g = S.model.game;
    if (g.source !== "fallback") return "";
    return `<div class="card warn small">No ${esc(g.fallbackFor)} game form has been published yet, so this uses the <b>${esc(g.name)}</b> form.${S.settings.mode === "main" ? ` Make the ${esc(g.fallbackFor)} form in <a href="#/builder">Game Builder</a>.` : " Ask your scouting lead to publish the new form."}</div>`;
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
    const RF = G.formFields(g, "rating").filter((f) => f.type !== "header");
    const filled = (d) => RF.some((f) => !Comb.isBlank(d && d[f.key]));
    const sig = (sl) => JSON.stringify([mk || "", Number(sl.team) || "", RF.map((f) => sl.data[f.key] ?? "")]);
    const isSaved = (sl) => !!sl.id && sl.saved === sig(sl);
    const isPending = (sl) => !!sl.team && filled(sl.data) && !isSaved(sl);
    if (editRec) slots[0].saved = sig(slots[0]);

    // Fill team numbers from the schedule and load anything this scout already saved for that match.
    const fillFromMatch = () => {
      if (editRec) return;
      for (const sl of slots) {
        const t = teamAt(mk, sl.station);
        if (t) sl.team = t;
        const prev = sl.team && mine(Number(sl.team), mk);
        if (prev && !filled(sl.data)) { sl.data = Object.assign({}, prev.data); sl.id = prev.id; sl.saved = sig(sl); }
        else if (!prev) { sl.id = null; sl.saved = null; }
      }
    };
    fillFromMatch();

    const color = (sl) => (sl.station.startsWith("Red") ? "red" : sl.station.startsWith("Blue") ? "blue" : "");
    const ctrl = (f, i) => {
      const lab = `${esc(f.label)} — ${esc(slots[i].station)}`;
      if (f.type === "longtext" || f.type === "text") return `<textarea data-i="${i}" data-k="${f.key}" aria-label="${lab}" placeholder="…"></textarea>`;
      if (f.type === "number" || f.type === "counter") return `<input type="number" inputmode="decimal" data-i="${i}" data-k="${f.key}" aria-label="${lab}" placeholder="–">`;
      const opts = f.type === "rating" ? ["1", "2", "3", "4", "5"] : f.type === "toggle" ? ["Yes", "No"] : f.options;
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
          ${RF.map((f) => `<div class="rl">${esc(f.label)}${f.help ? ` <span class="help">${esc(f.help)}</span>` : ""}</div>` +
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
      for (const f of RF) ctl(i, f.key).value = f.type === "toggle" ? (sl.data[f.key] === true ? "Yes" : sl.data[f.key] === false ? "No" : "") : sl.data[f.key] ?? "";
    });
    const readAll = () => slots.forEach((sl, i) => {
      sl.team = Number(teamIn(i).value) || "";
      for (const f of RF) {
        const v = ctl(i, f.key).value;
        sl.data[f.key] = f.type === "toggle" ? (v === "Yes" ? true : v === "No" ? false : "")
          : ["rating", "number", "counter"].includes(f.type) ? (v !== "" && isFinite(Number(v)) ? Number(v) : "")
          : f.type === "longtext" || f.type === "text" ? v.trim() : v;
      }
    });
    const update = () => {
      slots.forEach((sl, i) => {
        grid.querySelector(`[data-tn="${i}"]`).textContent = sl.team ? (teamName(sl.team) || "new team") : "";
        for (const f of RF) ctl(i, f.key).classList.toggle("set", !Comb.isBlank(sl.data[f.key]));
        const ss = grid.querySelector(`[data-ss="${i}"]`);
        ss.innerHTML = isSaved(sl) ? `sent ✓<br><span class="uptag" data-up="${esc(sl.id)}"></span>` : isPending(sl) ? `<span class="status-wait">not sent</span>` : "";
        const sb = grid.querySelector(`[data-sub="${i}"]`);
        if (sb) { sb.disabled = !isPending(sl); sb.textContent = isSaved(sl) ? "Sent" : "Submit"; }
      });
      const pending = slots.filter(isPending).length;
      // true = unsaved ratings (warn before leaving); "soft" = scout is mid-way (don't refresh the page under them)
      S.formDirty = pending > 0 ? true : touched && slots.some((sl) => !isSaved(sl) && (sl.team || filled(sl.data))) ? "soft" : false;
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
      const missingTeam = list.find((sl) => !sl.team && filled(sl.data));
      if (missingTeam) { toast(`${missingTeam.station} has ratings but no team number`); return false; }
      const todo = list.filter((sl) => sl.team && filled(sl.data) && (editRec || !isSaved(sl)));
      if (!todo.length) { toast(list.length === 1 ? "Rate something for this robot first" : "Nothing to save yet: rate at least one robot"); return false; }
      for (const sl of todo) {
        const t = Number(sl.team);
        const prev = (sl.id && S.records.find((r) => r.id === sl.id && r.team === t)) || mine(t, mk);
        const rec = prev ? Object.assign({}, prev) : { id: Core.newId("rating"), kind: "rating", event: S.settings.event, scout: S.settings.scoutName };
        rec.team = t;
        rec.match = mk ? matchNumberOf(mk) : undefined;
        const data = {};
        for (const f of RF) data[f.key] = sl.data[f.key] ?? "";
        rec.data = Object.assign({}, prev ? prev.data : {}, data, { mk: mk || "", station: STATIONS.includes(sl.station) ? sl.station : (prev && prev.data.station) || "", _g: G.stamp(g) });
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

  // ---------------- shared table + team helpers ----------------
  function cellOf(c) {
    if (!c || !c.n) return `<span class="muted">—</span>`;
    return esc(c.display).replace(/\n/g, "<br>") + (c.disagree ? `<span class="dis" title="Scouts disagree"></span>` : "");
  }
  /** Sortable table. cols: [{key,label,val(row),html?(row),cls?,desc?,title?}] */
  function sortable(tableId, rows, cols, defaultKey, defaultDir) {
    let key = defaultKey, dir = defaultDir || 1;
    const draw = () => {
      const col = cols.find((c) => c.key === key) || cols[0];
      const sorted = rows.slice().sort((a, b) => {
        const x = col.val(a), y = col.val(b);
        if (x === y) return 0;
        if (x === null || x === undefined || x === "") return 1;
        if (y === null || y === undefined || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
      const el = $("#" + tableId);
      if (!el) return;
      el.innerHTML = `<thead><tr>${cols.map((c) => `<th class="sort ${c.cls || ""}" data-k="${c.key}" ${c.title ? `title="${esc(c.title)}"` : ""}>${esc(c.label)}${c.key === key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
        <tbody>${sorted.map((r) => `<tr class="${r._cls || ""}">${cols.map((c) => `<td class="${c.cls || ""}">${c.html ? c.html(r) : esc(c.val(r) ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
      $$(`#${tableId} th`).forEach((th) => (th.onclick = () => { if (key === th.dataset.k) dir = -dir; else { key = th.dataset.k; dir = cols.find((c) => c.key === key).desc ? -1 : 1; } draw(); }));
    };
    draw();
    return { redraw: draw };
  }
  const teamLink = (t) => `<a href="#/team/${t.number}">${t.number}</a>`;
  const ours = (n) => !!S.settings.ourTeam && String(n) === String(S.settings.ourTeam);

  // ---------------- The Blue Alliance ----------------
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
      // Standings and OPR (shared with every device as one record)
      try {
        const es = await Tba.fetchEventStats(s.event, s.tbaKey);
        if (es.hasRankings || es.hasOprs) {
          const id = `tbastats:${s.event}`, cur = S.records.find((r) => r.id === id);
          const data = { teams: es.teams, fetchedAt: Date.now() };
          if (!cur || JSON.stringify(cur.data.teams) !== JSON.stringify(es.teams)) changed.push({ id, kind: "tbastats", event: s.event, scout: "The Blue Alliance", data });
        }
      } catch (e) { /* standings are optional */ }
      for (const r of changed) await Core.saveLocal(r);
      tbaLast = Date.now();
      await reload(); kickSync();
      epaRefresh(false);
      if (loud) toast(`Blue Alliance: ${matches.length} matches, ${teams.length} teams (${changed.length} updates)`);
      if (S.route === "matches") render();
    } catch (e) {
      if (loud) toast(navigator.onLine ? e.message : "No internet — can't reach The Blue Alliance", 5000);
      if (msg) msg.textContent = navigator.onLine ? e.message : "Offline — showing the last schedule saved on this device.";
    }
  }
  /** Statbotics EPA for this event's teams (no key needed; quietly skipped if unreachable). */
  let epaLast = 0;
  async function epaRefresh(loud) {
    if (!loud && Date.now() - epaLast < 15 * 60 * 1000) return;
    epaLast = Date.now();
    const s = S.settings;
    try {
      const { teams, count } = await Tba.fetchEpa(s.event);
      if (!count) { if (loud) toast("Statbotics has no EPA for this event yet"); return; }
      const id = `epa:${s.event}`, cur = S.records.find((r) => r.id === id);
      if (!cur || JSON.stringify(cur.data.teams) !== JSON.stringify(teams)) {
        await Core.saveLocal({ id, kind: "epa", event: s.event, scout: "Statbotics", data: { teams, fetchedAt: Date.now() } });
        await reload(); kickSync();
      }
      if (loud) toast(`Statbotics: EPA for ${count} teams`);
    } catch (e) { if (loud) toast(navigator.onLine ? "Couldn't reach Statbotics" : "No internet — can't reach Statbotics", 4000); }
  }
  function startTbaLoop() {
    clearInterval(tbaTimer);
    tbaTimer = setInterval(() => {
      if (S.settings.mode === "main" && S.settings.tbaKey && navigator.onLine && document.visibilityState === "visible" && Date.now() - tbaLast > 290000) tbaRefresh(false);
    }, 30000);
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
          ${main ? `<button id="qrGame">Show QR: this season's game form</button>` : ""}
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
    $("#qrPending").onclick = async () => showQR((await Core.pendingRecords()).filter((r) => r.kind !== "photo"));
    $("#qrAll").onclick = async () => { const dev = await Core.deviceId(); showQR(S.records.filter((r) => r.device === dev && ["pit", "match", "rating"].includes(r.kind))); };
    const qg = $("#qrGame");
    if (qg) qg.onclick = () => { const gr = (S.globals || []).filter((r) => r.kind === "game" && !r.deleted && String(r.data.year) === String(S.settings.event).slice(0, 4)); if (!gr.length) { toast("No published form for this season yet (Game Builder)"); return; } showQR(gr); };
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

  // ---------------- screens in this file (others live in ui-*.js) ----------------
  route("home", { title: "Home", render: renderHome, group: "scout", narrow: true, order: 0 });
  route("pit", { title: "Pit Scout", short: "Pit", render: renderPit, group: "scout", narrow: true, order: 1 });
  route("match", { title: "Match Scout", short: "Match", render: renderMatch, group: "scout", narrow: true, order: 2 });
  route("rate", { title: "Rate Teams", short: "Rate", render: renderRate, group: "scout", order: 3 });
  route("sync", { title: "Sync & Files", short: "Sync", render: renderSync, group: "manage", narrow: true, order: 8 });
  route("settings", { title: "Settings", render: renderSettings, group: "manage", narrow: true, order: 9 });

  async function start() {
    try {
      await reload();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      render();
      registerSW();
      startSyncLoop();
      startTbaLoop();
      kickSync();
    } catch (e) {
      console.error(e);
      view.innerHTML = `<h1>Something went wrong</h1><p>${esc(e.message)}</p><p class="small muted">If this is a private/incognito window, open the app in a normal window — private mode can't save data.</p>`;
    }
  }

  // Shared with the other screen files.
  window.ES = { S, $, $$, esc, view, route, render, go, reload, save, kickSync, toast, updateBadge,
    fieldHTML, readFields, wireForm, teamOptions, teamName, wireTeamInput, needName, wireName, cellOf, sortable, teamLink, ours,
    askDeletePassword, trackUpload, drawUpload, myRecent, STATIONS, teamAt, matchNumberOf, matchPickerHTML, readMk,
    tbaRefresh, epaRefresh, download, stamp, needXLSX, gameNotice, assignmentFor, showQR, scanQR, start,
    Core, Model, IO, Tba, QR, Comb, G, St };
  window.ESApp = window.ES;
})();
