const test = require("node:test");
const assert = require("node:assert/strict");
const { addEntry, bmi, parseBackup, streak, summarize, weekOf } = require("./core.js");

// All values in this file are made up for testing.

test("a week starts on Monday", () => {
  assert.equal(weekOf("2026-11-01"), "2026-10-26"); // Sunday
  assert.equal(weekOf("2026-11-02"), "2026-11-02"); // Monday
});

test("a second entry in a week replaces the first", () => {
  let entries = addEntry([], { date: "2026-11-02", kg: 62.4 });
  entries = addEntry(entries, { date: "2026-11-08", kg: 62.1 });
  entries = addEntry(entries, { date: "2026-10-26", kg: 62.8 });
  assert.deepEqual(entries, [
    { date: "2026-10-26", kg: 62.8 },
    { date: "2026-11-08", kg: 62.1 },
  ]);
});

test("impossible values are refused", () => {
  assert.throws(() => addEntry([], { date: "2026-13-01", kg: 62 }));
  assert.throws(() => addEntry([], { date: "2026-02-30", kg: 62 }));
  assert.throws(() => addEntry([], { date: "2026-11-01", kg: 5 }));
  assert.throws(() => addEntry([], { date: "2026-11-01", kg: Number.NaN }));
});

test("the streak survives an unentered current week and stops at a gap", () => {
  const entries = [
    { date: "2026-10-05", kg: 63.0 },
    { date: "2026-10-19", kg: 62.6 },
    { date: "2026-10-26", kg: 62.5 },
  ];
  assert.equal(streak(entries, "2026-11-01"), 2);
  assert.equal(streak(entries, "2026-11-03"), 2);
  assert.equal(streak(entries, "2026-11-10"), 0);
  assert.equal(streak([], "2026-11-01"), 0);
});

test("the summary reports progress", () => {
  const entries = [
    { date: "2026-10-26", kg: 62.5 },
    { date: "2026-11-08", kg: 62.0 },
  ];
  const summary = summarize(entries, "2026-11-08", { heightCm: 165, goalKg: 60 });
  assert.equal(summary.isDoneThisWeek, true);
  assert.ok(Math.abs(summary.change + 0.5) < 1e-9);
  assert.equal(summary.toGoal, 2);
  assert.ok(Math.abs(bmi(62.5, 165) - 22.96) < 0.01);
  assert.equal(summarize([], "2026-11-08", {}).latest, null);
});

test("a bad backup is refused as a whole", () => {
  assert.throws(() => parseBackup('{"entries":[{"date":"2026-11-01","kg":"重い"}]}'));
  assert.throws(() => parseBackup("not json"));
  const good = parseBackup('{"entries":[{"date":"2026-11-01","kg":62}],"settings":{"heightCm":160}}');
  assert.equal(good.entries.length, 1);
  assert.equal(good.settings.heightCm, 160);
  assert.equal(good.settings.goalKg, null);
});
