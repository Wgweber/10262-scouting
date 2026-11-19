/* 10262 Scouting — game definitions ("what do scouts fill in, and what is it worth?").
 *
 * Every form and every calculation in the app comes from a game definition, so a
 * new season only needs a new definition. Definitions are made in the Game Builder
 * (main computer) and published to every device through the cloud; the ones below
 * are built in.
 *
 * Field types:
 *   counter  – big −/+ buttons (game pieces scored…). points = per count
 *   number   – typed number. points = per unit
 *   toggle   – yes / no (left the zone, climbed…). points = when yes
 *   choice   – pick one (climb level…). optionPoints = points per option
 *   multi    – pick any. optionPoints = points per option
 *   rating   – 1 to 5
 *   text, longtext – words
 *   header   – a heading that groups fields (pit and rating forms)
 * Extra settings:
 *   phase          – match fields only: pre, auto, teleop, endgame, post
 *   penalty        – points handed to the OTHER alliance per count / when yes (fouls)
 *   problem        – toggle: "yes" means the robot had a problem this match
 *   problemOptions – choice: which options mean the robot had a problem
 *   bigStep        – counter: adds a "+N" button for fast counting
 *   retired        – hidden from forms but old data still counts and exports
 */
(function (root) {
  const PHASES = [
    { id: "pre", label: "Before the match" },
    { id: "auto", label: "Autonomous" },
    { id: "teleop", label: "Teleop" },
    { id: "endgame", label: "Endgame" },
    { id: "post", label: "After the match" }
  ];
  const SCORING = ["auto", "teleop", "endgame"];
  const TYPES = {
    counter: { label: "Counter (− / + buttons)", numeric: true, points: "Points per count" },
    number: { label: "Number (typed in)", numeric: true, points: "Points per unit" },
    toggle: { label: "Yes / No", points: "Points when yes" },
    choice: { label: "Pick one", options: true },
    multi: { label: "Pick any", options: true },
    rating: { label: "Rating 1 – 5", numeric: true },
    text: { label: "Short text" },
    longtext: { label: "Notes (long text)" },
    header: { label: "Section heading" }
  };

  const AWARDS = ["No Awards", "Autonomous", "Creativity", "Digital Animation", "Engineering Inspiration",
    "Excellence in Engineering", "Finalist", "Leadership", "Impact", "Founder's", "Gracious Professionalism",
    "Imagery", "Industrial Design", "Innovation In Control", "Judges'", "Quality", "Rising All-Star",
    "Rookie All-Star", "Safety Animation Award", "Team Spirit", "Team Sustainability", "Volunteer of the Year",
    "Winner", "Woodie Flowers Finalist"];

  // ---------------- built-in definitions ----------------
  const PIT_2026 = [
    { key: "drive", label: "Drive type", type: "choice", options: ["Swerve", "Tank", "Mecanum", "Other"] },
    { key: "weight", label: "Robot weight", type: "number", unit: "lbs", help: "Leave blank if they don't know" },
    { key: "language", label: "Programming language", type: "choice", options: ["Java", "C++", "Python", "LabVIEW", "Other"] },
    { key: "autoDesc", label: "What can the robot do in AUTO?", type: "longtext" },
    { key: "autoCap", label: "Auto capability", type: "multi", options: ["None", "Mobility only", "Scores fuel (low)", "Scores fuel (high)"] },
    { key: "shooter", label: "Shooter type", type: "choice", options: ["Fixed", "Turret", "None"] },
    { key: "accuracy", label: "Shooting accuracy (self-reported)", type: "choice", options: ["High", "Medium", "Low"] },
    { key: "capacity", label: "Max fuel capacity (approx.)", type: "number", unit: "fuel" },
    { key: "fuelPerMatch", label: "Fuel scored per match (approx.)", type: "number", unit: "fuel" },
    { key: "groundIntake", label: "Ground intake?", type: "choice", options: ["Yes", "No"] },
    { key: "hpIntake", label: "Can intake from the human player?", type: "choice", options: ["Yes", "No"] },
    { key: "fuelSource", label: "Where do they mostly collect fuel?", type: "choice", options: ["Alliance Zone", "Neutral Zone", "Both"] },
    { key: "climb", label: "Can they climb?", type: "choice", options: ["No", "Yes - Low rung", "Yes - Mid rung", "Yes - High rung"] },
    { key: "role", label: "Preferred role", type: "choice", options: ["Shooter", "Defender", "Support", "Flexible"] },
    { key: "bumpTrench", label: "Bump / Trench", type: "multi", options: ["Bump", "Trench"] },
    { key: "pitNotes", label: "Other notes", type: "longtext" }
  ];
  const RATING_STD = [
    { key: "autoCons", label: "Auto consistency (1-5)", type: "rating" },
    { key: "driverSkill", label: "Driver skill (1-5)", type: "rating" },
    { key: "defenseRes", label: "Defense resistance (1-5)", type: "rating" },
    { key: "endgameCons", label: "Endgame consistency (1-5)", type: "rating" },
    { key: "bestRole", label: "Best role", type: "choice", options: ["Primary Scorer", "Secondary Scorer", "Defender", "Support"] },
    { key: "reliability", label: "Reliability", type: "choice", options: ["Safe", "Risky"] },
    { key: "threat", label: "Threat level", type: "choice", options: ["High", "Medium", "Low"] },
    { key: "tier", label: "Tier", type: "choice", options: ["1", "2", "3", "4"], help: "1 = best" },
    { key: "counter", label: "Counter strategy", type: "longtext" },
    { key: "autoNotes", label: "Notes on auto", type: "longtext" },
    { key: "teleopNotes", label: "Teleop notes", type: "longtext" },
    { key: "notes", label: "Notes", type: "longtext" }
  ];
  const PROBLEMS = ["None", "Disabled / stuck part of match", "Broke something", "Tipped over", "No show"];
  const POST_STD = [
    { key: "defense", label: "Defense played (1-5)", type: "rating", phase: "post", help: "Blank if they didn't play defense" },
    { key: "driver", label: "Driver skill (1-5)", type: "rating", phase: "post" },
    { key: "problems", label: "Robot problems", type: "choice", phase: "post", options: PROBLEMS, problemOptions: PROBLEMS.slice(1) },
    { key: "notes", label: "Notes", type: "longtext", phase: "post" }
  ];

  const BUILTIN = {
    "2026": {
      schema: 2, year: "2026", name: "2026 REBUILT",
      about: "Official 2026 point values: fuel in an active hub 1 pt (auto and teleop), Level 1 climb in auto 15 pts, teleop climbs 10 / 20 / 30, minor foul 5 and major foul 15 to the other alliance.",
      match: [
        { key: "startPos", label: "Starting position", type: "choice", phase: "pre", options: ["Left", "Center", "Right"], help: "As seen from your driver station" },
        { key: "autoFuel", label: "Fuel scored", type: "counter", phase: "auto", points: 1, bigStep: 5 },
        { key: "autoMissed", label: "Fuel missed", type: "counter", phase: "auto", bigStep: 5 },
        { key: "autoClimb", label: "Climbed Level 1 in auto", type: "toggle", phase: "auto", points: 15 },
        { key: "autoMoved", label: "Moved during auto", type: "toggle", phase: "auto" },
        { key: "teleFuel", label: "Fuel scored (active hub)", type: "counter", phase: "teleop", points: 1, bigStep: 5 },
        { key: "teleMissed", label: "Fuel missed", type: "counter", phase: "teleop", bigStep: 5 },
        { key: "telePassed", label: "Fuel passed / fed to the alliance zone", type: "counter", phase: "teleop", bigStep: 5 },
        { key: "playedDefense", label: "Played defense", type: "toggle", phase: "teleop" },
        { key: "climbLevel", label: "Tower climb", type: "choice", phase: "endgame", options: ["None", "Level 1", "Level 2", "Level 3"], optionPoints: { "Level 1": 10, "Level 2": 20, "Level 3": 30 } },
        { key: "climbFailed", label: "Tried to climb but failed", type: "toggle", phase: "endgame" },
        { key: "minorFouls", label: "Minor fouls", type: "counter", phase: "post", penalty: 5, help: "5 pts each to the other alliance" },
        { key: "majorFouls", label: "Major fouls", type: "counter", phase: "post", penalty: 15, help: "15 pts each to the other alliance" },
        ...POST_STD,
        // The first version of the app had scouts type points per phase; old reports still count.
        { key: "auto", label: "Auto points (typed, old form)", type: "number", phase: "auto", points: 1, retired: true },
        { key: "teleop", label: "Teleop points (typed, old form)", type: "number", phase: "teleop", points: 1, retired: true },
        { key: "endgame", label: "Endgame points (typed, old form)", type: "number", phase: "endgame", points: 1, retired: true }
      ],
      pit: PIT_2026,
      rating: RATING_STD
    }
  };

  /** A sensible starting point for a brand-new game, before its point values are known. */
  function starterTemplate(year) {
    return normalize({
      schema: 2, year: String(year), name: `${year} game`,
      about: "Starter form. After Kickoff: rename the fields to the real game pieces and set the point values.",
      match: [
        { key: "startPos", label: "Starting position", type: "choice", phase: "pre", options: ["Left", "Center", "Right"] },
        { key: "autoLeave", label: "Left the starting zone", type: "toggle", phase: "auto", points: 0 },
        { key: "autoScoredA", label: "Game piece A scored", type: "counter", phase: "auto", points: 0 },
        { key: "autoScoredB", label: "Game piece B scored", type: "counter", phase: "auto", points: 0 },
        { key: "teleScoredA", label: "Game piece A scored", type: "counter", phase: "teleop", points: 0, bigStep: 5 },
        { key: "teleScoredB", label: "Game piece B scored", type: "counter", phase: "teleop", points: 0, bigStep: 5 },
        { key: "teleMissed", label: "Missed shots / drops", type: "counter", phase: "teleop" },
        { key: "playedDefense", label: "Played defense", type: "toggle", phase: "teleop" },
        { key: "endgame", label: "Endgame result", type: "choice", phase: "endgame", options: ["None", "Parked", "Low", "Mid", "High"], optionPoints: {} },
        { key: "minorFouls", label: "Minor fouls", type: "counter", phase: "post", penalty: 0 },
        { key: "majorFouls", label: "Major fouls", type: "counter", phase: "post", penalty: 0 },
        ...POST_STD
      ],
      pit: [
        { key: "drive", label: "Drive type", type: "choice", options: ["Swerve", "Tank", "Mecanum", "Other"] },
        { key: "weight", label: "Robot weight", type: "number", unit: "lbs" },
        { key: "language", label: "Programming language", type: "choice", options: ["Java", "C++", "Python", "LabVIEW", "Other"] },
        { key: "autoDesc", label: "What can the robot do in AUTO?", type: "longtext" },
        { key: "scoresWhere", label: "Where can it score?", type: "multi", options: ["Low", "Mid", "High"] },
        { key: "endgameCan", label: "Endgame ability", type: "choice", options: ["None", "Parked", "Low", "Mid", "High"] },
        { key: "role", label: "Preferred role", type: "choice", options: ["Scorer", "Defender", "Support", "Flexible"] },
        { key: "pitNotes", label: "Other notes", type: "longtext" }
      ],
      rating: RATING_STD
    });
  }

  // ---------------- helpers ----------------
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function keyFromLabel(label, taken) {
    const words = String(label || "field").normalize("NFKD").replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
    let key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("") || "field";
    if (/^\d/.test(key)) key = "f" + key;
    let k = key, n = 2;
    while (taken.has(k)) k = key + n++;
    return k;
  }

  /** Fill in defaults and tidy a definition so the rest of the app can trust it. */
  function normalize(cfg) {
    const g = clone(cfg || {});
    g.schema = 2;
    g.year = String(g.year || "");
    g.name = g.name || (g.year ? `${g.year} game` : "Game");
    for (const kind of ["match", "pit", "rating"]) {
      const taken = new Set();
      g[kind] = (Array.isArray(g[kind]) ? g[kind] : []).filter((f) => f && typeof f === "object").map((f) => {
        const o = Object.assign({}, f);
        o.type = TYPES[o.type] ? o.type : "text";
        o.label = String(o.label || "").trim() || "Untitled";
        if (!o.key || taken.has(o.key)) o.key = keyFromLabel(o.label, taken);
        taken.add(o.key);
        if (kind === "match") o.phase = PHASES.some((p) => p.id === o.phase) ? o.phase : "post";
        else delete o.phase;
        if (TYPES[o.type].options) {
          o.options = (Array.isArray(o.options) ? o.options : []).map((x) => String(x).trim()).filter(Boolean);
          o.options = [...new Set(o.options)];
          const op = {};
          for (const [k, v] of Object.entries(o.optionPoints || {})) if (o.options.includes(k) && Number(v)) op[k] = Number(v);
          o.optionPoints = op;
          o.problemOptions = (o.problemOptions || []).filter((x) => o.options.includes(x));
        } else { delete o.options; delete o.optionPoints; delete o.problemOptions; }
        for (const k of ["points", "penalty", "bigStep"]) {
          if (o[k] === undefined || o[k] === "" || o[k] === null) delete o[k];
          else o[k] = Number(o[k]) || 0;
        }
        if (o.type !== "counter") delete o.bigStep;
        if (!["counter", "number", "toggle"].includes(o.type)) { delete o.points; delete o.penalty; }
        if (o.type !== "toggle") delete o.problem;
        o.retired = !!o.retired; if (!o.retired) delete o.retired;
        return o;
      });
    }
    return g;
  }

  /** Problems a definition has that would confuse scouts or the maths. */
  function validate(cfg) {
    const errs = [];
    if (!/^\d{4}$/.test(String(cfg.year || ""))) errs.push("The season year should be four digits, like 2027.");
    for (const kind of ["match", "pit", "rating"]) {
      const labels = new Map();
      for (const f of cfg[kind] || []) {
        if (f.type === "header" || f.retired) continue;
        const k = `${f.phase || ""}|${f.label.toLowerCase()}`;
        if (labels.has(k)) errs.push(`${title(kind)} form: "${f.label}" appears twice${f.phase ? " in " + phaseLabel(f.phase) : ""}.`);
        labels.set(k, 1);
        if (TYPES[f.type].options && f.options.length < 2) errs.push(`${title(kind)} form: "${f.label}" needs at least two options.`);
      }
    }
    if (!(cfg.match || []).some((f) => !f.retired && f.type !== "header")) errs.push("The match form has no fields.");
    return errs;
  }
  function warnings(cfg) {
    const w = [];
    const scoring = (cfg.match || []).filter((f) => !f.retired && SCORING.includes(f.phase));
    const anyPoints = scoring.some((f) => f.points || Object.keys(f.optionPoints || {}).length);
    if (!anyPoints) w.push("No point values are set yet, so point totals and predictions will show 0. Set them once you know the game.");
    return w;
  }
  const title = (k) => ({ match: "Match", pit: "Pit", rating: "Rating" }[k]);
  const phaseLabel = (id) => (PHASES.find((p) => p.id === id) || { label: id }).label;

  /** The definition that applies to an event: published > built-in > newest built-in. */
  function resolve(event, globals) {
    const year = String(event || "").slice(0, 4);
    const pub = (globals || []).filter((r) => r && r.kind === "game" && !r.deleted && r.data && String(r.data.year) === year)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (pub) return Object.assign(normalize(pub.data), { source: "published", version: pub.data.version || 1, publishedBy: pub.scout || "", publishedAt: pub.updatedAt });
    if (BUILTIN[year]) return Object.assign(normalize(BUILTIN[year]), { source: "builtin", version: 0 });
    const latest = Object.keys(BUILTIN).sort().pop();
    return Object.assign(normalize(BUILTIN[latest]), { source: "fallback", version: 0, fallbackFor: year });
  }

  // ---------------- scoring ----------------
  const truthy = (v) => v === true || v === 1 || v === "true" || v === "Yes" || v === "yes";
  function fieldPoints(f, v) {
    if (v === undefined || v === null || v === "") return 0;
    switch (f.type) {
      case "counter": case "number": { const n = Number(v); return isFinite(n) ? n * (f.points || 0) : 0; }
      case "toggle": return truthy(v) ? (f.points || 0) : 0;
      case "choice": return (f.optionPoints && f.optionPoints[v]) || 0;
      case "multi": return [].concat(v).reduce((a, o) => a + ((f.optionPoints && f.optionPoints[o]) || 0), 0);
      default: return 0;
    }
  }
  function fieldPenalty(f, v) {
    if (!f.penalty || v === undefined || v === null || v === "") return 0;
    if (f.type === "toggle") return truthy(v) ? f.penalty : 0;
    const n = Number(v); return isFinite(n) ? n * f.penalty : 0;
  }
  /** Points one report says the robot scored, by phase. */
  function reportPoints(data, game) {
    const out = { pre: 0, auto: 0, teleop: 0, endgame: 0, post: 0, total: 0, penalty: 0 };
    for (const f of game.match) {
      if (f.type === "header") continue;
      const v = data ? data[f.key] : undefined;
      const p = fieldPoints(f, v);
      out[f.phase] += p; out.total += p;
      out.penalty += fieldPenalty(f, v);
    }
    return out;
  }
  /** What went wrong for this robot according to one report (empty list = nothing). */
  function reportProblems(data, game) {
    const out = [];
    for (const f of game.match) {
      const v = data ? data[f.key] : undefined;
      if (f.type === "toggle" && f.problem && truthy(v)) out.push(f.label);
      if (f.type === "choice" && (f.problemOptions || []).includes(v)) out.push(v);
    }
    return out;
  }
  const formFields = (game, kind) => (game[kind] || []).filter((f) => !f.retired);
  const dataFields = (game, kind) => (game[kind] || []).filter((f) => f.type !== "header");
  const stamp = (game) => `${game.year}${game.source === "published" ? "@" + game.version : game.source === "builtin" ? "@builtin" : "@fallback"}`;

  root.ESGame = { PHASES, SCORING, TYPES, AWARDS, BUILTIN, starterTemplate, normalize, validate, warnings, resolve, keyFromLabel,
    fieldPoints, fieldPenalty, reportPoints, reportProblems, formFields, dataFields, phaseLabel, truthy, stamp, clone };
  // Older modules ask ESFields for these.
  root.ESFields = { AWARDS, GAMES: BUILTIN, gameFor: (event) => resolve(event, []) };
})(typeof self !== "undefined" ? self : globalThis);
