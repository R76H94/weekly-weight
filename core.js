// Calculations for 週イチ体重. No DOM, so Node can test it and the page can load it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WeeklyCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_KG = 20;
  const MAX_KG = 400;

  function toUtc(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const ms = Date.parse(date + "T00:00:00Z");
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : NaN;
  }

  // The Monday of the date's week, as YYYY-MM-DD.
  function weekOf(date) {
    const ms = toUtc(date);
    const fromMonday = (new Date(ms).getUTCDay() + 6) % 7;
    return new Date(ms - fromMonday * DAY_MS).toISOString().slice(0, 10);
  }

  function isEntry(entry) {
    return (
      entry !== null &&
      typeof entry === "object" &&
      !Number.isNaN(toUtc(entry.date)) &&
      typeof entry.kg === "number" &&
      entry.kg >= MIN_KG &&
      entry.kg <= MAX_KG
    );
  }

  // One entry per week: a new entry replaces the one already in its week.
  function addEntry(entries, entry) {
    if (!isEntry(entry)) throw new Error("日付か体重が正しくありません");
    const week = weekOf(entry.date);
    return [...entries.filter((item) => weekOf(item.date) !== week), entry].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  // Weeks in a row up to now. A week not yet entered does not break the run.
  function streak(entries, today) {
    const weeks = new Set(entries.map((entry) => weekOf(entry.date)));
    let cursor = toUtc(weekOf(today));
    if (!weeks.has(weekOf(today))) cursor -= 7 * DAY_MS;
    let count = 0;
    while (weeks.has(new Date(cursor).toISOString().slice(0, 10))) {
      count += 1;
      cursor -= 7 * DAY_MS;
    }
    return count;
  }

  function bmi(kg, heightCm) {
    const meters = heightCm / 100;
    return kg / (meters * meters);
  }

  function summarize(entries, today, settings) {
    const latest = entries[entries.length - 1] ?? null;
    const previous = entries[entries.length - 2] ?? null;
    const height = settings.heightCm;
    const goal = settings.goalKg;
    return {
      latest,
      isDoneThisWeek: entries.some((entry) => weekOf(entry.date) === weekOf(today)),
      streak: streak(entries, today),
      change: latest && previous ? latest.kg - previous.kg : null,
      totalChange: latest && entries.length > 1 ? latest.kg - entries[0].kg : null,
      bmi: latest && height ? bmi(latest.kg, height) : null,
      toGoal: latest && goal ? latest.kg - goal : null,
    };
  }

  // Parses a backup, keeping nothing unless the whole file is valid.
  function parseBackup(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data.entries) || !data.entries.every(isEntry)) {
      throw new Error("バックアップの形式が正しくありません");
    }
    const entries = data.entries.reduce(addEntry, []);
    const settings = data.settings ?? {};
    return {
      entries,
      settings: {
        heightCm: Number(settings.heightCm) > 0 ? Number(settings.heightCm) : null,
        goalKg: Number(settings.goalKg) > 0 ? Number(settings.goalKg) : null,
      },
    };
  }

  return { addEntry, bmi, parseBackup, streak, summarize, weekOf };
});
