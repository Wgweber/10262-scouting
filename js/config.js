/* Eruption Scout — team-wide defaults.
 * Fill in cloudUrl and cloudKey once (from Supabase > Project Settings > API)
 * so every device that installs the app is already pointed at your cloud.
 * Scouts then only type their name and the team code.
 * These two values are safe to publish; the team code is what protects your data. */
self.ES_DEFAULT_CONFIG = {
  cloudUrl: "",      // e.g. "https://abcdefgh.supabase.co"
  cloudKey: "",      // the "anon" / "publishable" key
  event: "2026njbr", // Blue Alliance event code
  ourTeam: ""        // your team number, highlighted in schedules
};
