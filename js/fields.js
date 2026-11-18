/* 10262 Scouting — game and form definitions.
 *
 * Everything the scouts fill in is defined here, so a new game (2027) only
 * needs changes in this file. Field types:
 *   number   – typed number, averaged across scouts
 *   rating   – 1–5 buttons, averaged across scouts
 *   choice   – pick one; combined as "most common answer"
 *   multi    – pick any; combined as "how many scouts picked each"
 *   text     – short text; every scout's answer kept with their name
 *   longtext – notes; every scout's answer kept with their name
 */
(function (root) {
  const GAMES = {
    "2026": {
      name: "2026 REBUILT",
      pit: [
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
      ],
      match: [
        { key: "auto", label: "Auto (pts)", type: "number", unit: "pts" },
        { key: "teleop", label: "Teleop (est. pts)", type: "number", unit: "pts" },
        { key: "endgame", label: "Endgame (pts)", type: "number", unit: "pts" },
        { key: "defense", label: "Defense (1-5)", type: "rating" },
        { key: "driver", label: "Driver skill (1-5)", type: "rating" },
        { key: "problems", label: "Robot problems", type: "choice", options: ["None", "Disabled / stuck part of match", "Broke something", "No show"] },
        { key: "notes", label: "Notes", type: "longtext" }
      ],
      // The "Main" tab's scouter columns plus the "Robot Rankings" tab.
      rating: [
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
      ]
    }
  };

  const AWARDS = ["No Awards", "Autonomous", "Creativity", "Digital Animation", "Engineering Inspiration",
    "Excellence in Engineering", "Finalist", "Leadership", "Impact", "Founder's", "Gracious Professionalism",
    "Imagery", "Industrial Design", "Innovation In Control", "Judges'", "Quality", "Rising All-Star",
    "Rookie All-Star", "Safety Animation Award", "Team Spirit", "Team Sustainability", "Volunteer of the Year",
    "Winner", "Woodie Flowers Finalist"];

  function gameFor(eventCode) {
    const year = String(eventCode || "").slice(0, 4);
    return GAMES[year] || GAMES[Object.keys(GAMES).sort().pop()];
  }

  root.ESFields = { GAMES, AWARDS, gameFor };
})(typeof self !== "undefined" ? self : globalThis);
