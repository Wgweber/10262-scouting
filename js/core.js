/* 10262 Scouting — on-device storage, outbox and cloud sync.
 * Loaded by both the app page and the service worker (no DOM use here). */
(function (root) {
  const DB_NAME = "eruption-scout";
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("records")) {
          const s = db.createObjectStore("records", { keyPath: "id" });
          s.createIndex("event", "event");
        }
        if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(stores, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve().then(() => fn(t)).then((r) => (result = r), (e) => {
        try { t.abort(); } catch (x) { /* already finished */ }
        reject(e);
      });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Storage transaction aborted"));
    }));
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  // ---------- settings ----------
  const DEFAULT_SETTINGS = {
    scoutName: "", event: "2026njbr", ourTeam: "", mode: "scout",
    cloudUrl: "", cloudKey: "", teamCode: "", tbaKey: ""
  };
  async function getMeta(key) {
    return tx(["meta"], "readonly", (t) => reqP(t.objectStore("meta").get(key))).then((r) => (r ? r.value : undefined));
  }
  function setMeta(key, value) {
    return tx(["meta"], "readwrite", (t) => { t.objectStore("meta").put({ key, value }); });
  }
  async function getSettings() {
    const s = (await getMeta("settings")) || {};
    const cfg = root.ES_DEFAULT_CONFIG || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, s);
    // Cloud details baked into config.js are used when the device has none of its own.
    if (!merged.cloudUrl && cfg.cloudUrl) merged.cloudUrl = cfg.cloudUrl;
    if (!merged.cloudKey && cfg.cloudKey) merged.cloudKey = cfg.cloudKey;
    if (!s.event && cfg.event) merged.event = cfg.event;
    if (!s.ourTeam && cfg.ourTeam) merged.ourTeam = cfg.ourTeam;
    return merged;
  }
  async function saveSettings(patch) {
    const cur = (await getMeta("settings")) || {};
    const next = Object.assign({}, cur, patch);
    await setMeta("settings", next);
    return getSettings();
  }
  async function deviceId() {
    let id = await getMeta("deviceId");
    if (!id) { id = "d" + Math.random().toString(36).slice(2, 10); await setMeta("deviceId", id); }
    return id;
  }

  function newId(prefix) {
    const rnd = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() :
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    return (prefix ? prefix + ":" : "") + rnd;
  }

  // ---------- records ----------
  /** Save a record made on this device and queue it for upload. */
  async function saveLocal(rec) {
    const r = Object.assign({}, rec);
    r.updatedAt = Math.max(Date.now(), (r.updatedAt || 0) + 1);
    if (!r.device) r.device = await deviceId();
    if (r.team !== undefined && r.team !== null && r.team !== "") r.team = Number(r.team);
    if (r.match !== undefined && r.match !== null && r.match !== "") r.match = Number(r.match);
    await tx(["records", "outbox"], "readwrite", (t) => {
      t.objectStore("records").put(r);
      t.objectStore("outbox").put({ id: r.id, updatedAt: r.updatedAt });
    });
    return r;
  }

  /** Merge records from elsewhere (cloud, QR, backup file). Newest edit wins.
   *  Returns how many were new or changed. */
  async function mergeRecords(recs, { queue = false } = {}) {
    let changed = 0;
    await tx(["records", "outbox"], "readwrite", async (t) => {
      const store = t.objectStore("records");
      for (const r of recs) {
        if (!r || !r.id) continue;
        const cur = await reqP(store.get(r.id));
        if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) {
          store.put(r);
          changed++;
          if (queue) t.objectStore("outbox").put({ id: r.id, updatedAt: r.updatedAt || 0 });
        }
      }
    });
    return changed;
  }

  function allRecords(event) {
    return tx(["records"], "readonly", (t) => {
      const s = t.objectStore("records");
      return reqP(event ? s.index("event").getAll(event) : s.getAll());
    });
  }
  function getRecord(id) { return tx(["records"], "readonly", (t) => reqP(t.objectStore("records").get(id))); }
  function outboxCount() { return tx(["outbox"], "readonly", (t) => reqP(t.objectStore("outbox").count())); }
  function outboxIds() { return tx(["outbox"], "readonly", (t) => reqP(t.objectStore("outbox").getAll())); }
  async function pendingRecords() {
    const ob = await outboxIds();
    const out = [];
    for (const o of ob) { const r = await getRecord(o.id); if (r) out.push(r); }
    return out;
  }

  // ---------- cloud sync ----------
  function cloudReady(s) { return !!(s.cloudUrl && s.cloudKey && s.teamCode); }
  function headers(s, extra) {
    return Object.assign({ apikey: s.cloudKey, "x-team-code": s.teamCode, "Content-Type": "application/json" }, extra || {});
  }
  function baseUrl(s) { return s.cloudUrl.replace(/\/+$/, "") + "/rest/v1/records"; }
  const toRow = (r) => ({
    id: r.id, event: r.event, kind: r.kind, team: r.team ?? null, match_no: r.match ?? null,
    scout: r.scout || null, device: r.device || null, data: r.data || {}, updated_at: r.updatedAt || 0, deleted: !!r.deleted
  });
  const fromRow = (w) => ({
    id: w.id, event: w.event, kind: w.kind, team: w.team ?? undefined, match: w.match_no ?? undefined,
    scout: w.scout || "", device: w.device || "", data: w.data || {}, updatedAt: Number(w.updated_at) || 0, deleted: !!w.deleted
  });

  async function explain(res) {
    let body = "";
    try { body = await res.text(); } catch (e) { /* ignore */ }
    if (res.status === 401 || res.status === 403 || /row-level security|permission/i.test(body)) {
      return "The cloud refused this device. Check the team code in Settings.";
    }
    if (res.status === 404) return "Cloud table not found. Run the setup SQL in Supabase (see the setup guide).";
    return `Cloud error ${res.status}: ${body.slice(0, 160)}`;
  }

  async function push(s) {
    const pending = await outboxIds();
    if (!pending.length) return 0;
    let sent = 0, i = 0;
    // Batches of up to 200 records or ~1.5 MB (robot photos are ~100 KB each).
    while (i < pending.length) {
      const slice = [], rows = [];
      let bytes = 0;
      while (i < pending.length && slice.length < 200) {
        const o = pending[i];
        const r = await getRecord(o.id);
        const row = r ? JSON.stringify(toRow(r)) : "";
        if (slice.length && bytes + row.length > 1500000) break;
        slice.push(o); if (r) rows.push(row); bytes += row.length; i++;
      }
      if (rows.length) {
        const res = await fetch(baseUrl(s) + "?on_conflict=id", {
          method: "POST",
          headers: headers(s, { Prefer: "resolution=merge-duplicates,return=minimal" }),
          body: "[" + rows.join(",") + "]"
        });
        if (!res.ok) throw new Error(await explain(res));
      }
      // Only clear entries that weren't edited again while uploading.
      await tx(["outbox"], "readwrite", async (t) => {
        const ob = t.objectStore("outbox");
        for (const o of slice) {
          const cur = await reqP(ob.get(o.id));
          if (cur && cur.updatedAt <= o.updatedAt) ob.delete(o.id);
        }
      });
      sent += rows.length;
    }
    return sent;
  }

  /** Download everything changed since the last time, for one slice of the data. */
  async function pullSet(s, name, filter, limit) {
    const ckey = "cursor:" + name;
    let cursor = (await getMeta(ckey)) || "1970-01-01T00:00:00Z";
    let got = 0, changed = 0;
    for (let page = 0; page < 200; page++) {
      // Step back 30 s so rows committed slightly late are never skipped.
      const since = new Date(new Date(cursor).getTime() - 30000).toISOString();
      const url = baseUrl(s) + `?select=*&${filter}&synced_at=gt.${encodeURIComponent(since)}&order=synced_at.asc&limit=${limit}`;
      const res = await fetch(url, { headers: headers(s) });
      if (!res.ok) throw new Error(await explain(res));
      const rows = await res.json();
      got += rows.length;
      changed += await mergeRecords(rows.map(fromRow));
      const before = cursor;
      if (rows.length) {
        const last = rows[rows.length - 1].synced_at;
        if (last && last > cursor) cursor = last;
      }
      await setMeta(ckey, cursor);
      if (rows.length < limit || cursor === before) break;
    }
    return { got, changed };
  }
  /** This event's data plus team-wide data (game forms). Main computers also get robot photos;
   *  scout phones skip them to save data. */
  async function pull(s) {
    const ev = encodeURIComponent(s.event);
    const r = await pullSet(s, s.event, `event=in.(${ev},_global)&kind=neq.photo`, 1000);
    if (s.mode === "main") {
      const p = await pullSet(s, "photos:" + s.event, `event=eq.${ev}&kind=eq.photo`, 15);
      r.got += p.got; r.changed += p.changed;
    }
    return r;
  }

  let running = null;
  async function syncNow({ pullToo = true } = {}) {
    if (running) return running;
    const work = async () => {
      const s = await getSettings();
      const status = { ok: false, pushed: 0, pulled: 0, at: Date.now(), error: "" };
      if (!cloudReady(s)) { status.error = "Cloud sync not set up on this device"; return status; }
      if (typeof navigator !== "undefined" && navigator.onLine === false) { status.error = "No internet - will retry"; return status; }
      try {
        status.pushed = await push(s);
        if (pullToo) status.pulled = (await pull(s)).changed;
        status.ok = true;
        await setMeta("lastSync", status.at);
      } catch (e) {
        status.error = /Failed to fetch|NetworkError|Load failed|network/i.test(String(e.message)) ? "No connection to the cloud - will retry" : e.message;
      }
      await setMeta("lastStatus", status);
      return status;
    };
    const locked = (typeof navigator !== "undefined" && navigator.locks)
      ? () => navigator.locks.request("es-sync", work) : work;
    running = locked().finally(() => { running = null; });
    return running;
  }

  root.ESCore = {
    openDB, getMeta, setMeta, getSettings, saveSettings, deviceId, newId,
    saveLocal, mergeRecords, allRecords, getRecord, outboxCount, pendingRecords,
    cloudReady, syncNow, toRow, fromRow
  };
})(typeof self !== "undefined" ? self : globalThis);
