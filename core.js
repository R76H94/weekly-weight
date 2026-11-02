// Calculations for 週イチ体重. No DOM, no clock, no direct storage access,
// so Node can test it and the page can load it with a plain <script>.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WeeklyCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  const MIN_TENTHS = 200;
  const MAX_TENTHS = 4000;
  const MAX_RECORDS = 5000;
  const MAX_BACKUP_BYTES = 1024 * 1024;
  const CHART_WEEKS = 52;
  const MINUS = "−";

  const STORAGE_KEY = "weekly-weight-v1";
  const LAST_BACKUP_KEY = "weekly-weight-last-backup";

  // ---- dates and weeks (strings are treated as UTC days, so time zones do not matter) ----

  function toUtc(date) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const ms = Date.parse(date + "T00:00:00Z");
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : NaN;
  }

  function fromUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function isRealDate(date) {
    return !Number.isNaN(toUtc(date));
  }

  // The Monday of the date's week, as YYYY-MM-DD.
  function weekOf(date) {
    const ms = toUtc(date);
    const fromMonday = (new Date(ms).getUTCDay() + 6) % 7;
    return fromUtc(ms - fromMonday * DAY_MS);
  }

  function weeksBetween(earlierWeek, laterWeek) {
    return Math.round((toUtc(laterWeek) - toUtc(earlierWeek)) / WEEK_MS);
  }

  function addWeeks(week, count) {
    return fromUtc(toUtc(week) + count * WEEK_MS);
  }

  const toTenths = (kg) => Math.round(kg * 10);

  // ---- input ----

  function normalizeInput(text) {
    return String(text ?? "")
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[．，,]/g, ".")
      .replace(/[－−]/g, "-")
      .replace(/[\s　]/g, "");
  }

  // Order of checks: empty, not a number, two or more decimals, out of range.
  function parseKgInput(text) {
    const value = normalizeInput(text);
    if (value === "") return { ok: false, error: "EMPTY" };
    const match = /^-?\d+(?:\.(\d+))?$/.exec(value);
    if (!match) return { ok: false, error: "NOT_NUMBER" };
    if (match[1] && match[1].length > 1) return { ok: false, error: "DECIMALS" };
    const tenths = toTenths(Number(value));
    if (tenths < MIN_TENTHS || tenths > MAX_TENTHS) return { ok: false, error: "RANGE" };
    return { ok: true, kg: tenths / 10 };
  }

  function checkDate(date, today) {
    if (!date || !isRealDate(date)) return { ok: false, error: "EMPTY" };
    if (date > today) return { ok: false, error: "FUTURE" };
    return { ok: true };
  }

  // ---- records ----

  function findSameWeek(records, date) {
    if (!isRealDate(date)) return null;
    const week = weekOf(date);
    return records.find((record) => weekOf(record.date) === week) ?? null;
  }

  // One record per week. Returns a new array sorted by date; the input is not changed.
  function upsertRecord(records, record) {
    const week = weekOf(record.date);
    return [...records.filter((item) => weekOf(item.date) !== week), { date: record.date, kg: record.kg }].sort(
      (a, b) => a.date.localeCompare(b.date),
    );
  }

  // One row per week, oldest first. Differences are in tenths of a kg.
  function buildRows(records) {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    const startTenths = sorted.length ? toTenths(sorted[0].kg) : 0;
    return sorted.map((record, index) => {
      const week = weekOf(record.date);
      const tenths = toTenths(record.kg);
      const previous = index > 0 ? sorted[index - 1] : null;
      const previousWeek = previous ? weekOf(previous.date) : null;
      return {
        date: record.date,
        week,
        kg: record.kg,
        tenths,
        previous: previous ? { week: previousWeek, kg: previous.kg } : null,
        diffTenths: previous ? tenths - toTenths(previous.kg) : null,
        gapWeeks: previous ? weeksBetween(previousWeek, week) : null,
        startDiffTenths: index > 0 ? tenths - startTenths : null,
      };
    });
  }

  // Weeks in a row ending at the latest record's week. The current week not being
  // entered yet does not break it; a latest record two or more weeks ago gives null.
  function streak(records, today) {
    if (!records.length) return null;
    const weeks = new Set(records.map((record) => weekOf(record.date)));
    const latest = [...weeks].sort().pop();
    if (weeksBetween(latest, weekOf(today)) > 1) return null;
    let count = 0;
    let cursor = latest;
    while (weeks.has(cursor)) {
      count += 1;
      cursor = addWeeks(cursor, -1);
    }
    return count;
  }

  function summarize(records, today) {
    const rows = buildRows(records);
    const latest = rows[rows.length - 1] ?? null;
    return {
      count: rows.length,
      latest,
      start: rows[0] ?? null,
      streak: streak(records, today),
    };
  }

  // ---- formatting ----

  function yearOf(date) {
    return Number(date.slice(0, 4));
  }

  function monthDay(date) {
    return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  }

  // A single date: the year is written when it is not this year.
  function formatDate(date, today) {
    return yearOf(date) === yearOf(today) ? monthDay(date) : `${yearOf(date)}年${monthDay(date)}`;
  }

  // A week is judged by its Monday's year.
  function formatWeekStart(week, today) {
    return formatDate(week, today);
  }

  function formatWeekLabel(week, today) {
    return `${formatWeekStart(week, today)}の週`;
  }

  function formatWeekLabelWithDay(week, today) {
    return `${formatWeekStart(week, today)}（月）の週`;
  }

  // "11月2日〜8日", "10月26日〜11月1日", "2026年12月28日〜2027年1月3日".
  function formatWeekRange(week, today) {
    const sunday = addWeeks(week, 1);
    const end = fromUtc(toUtc(sunday) - DAY_MS);
    const start = formatWeekStart(week, today);
    const withYear = yearOf(week) !== yearOf(today);
    let endText;
    if (withYear && yearOf(end) !== yearOf(week)) endText = `${yearOf(end)}年${monthDay(end)}`;
    else if (end.slice(5, 7) !== week.slice(5, 7)) endText = monthDay(end);
    else endText = `${Number(end.slice(8, 10))}日`;
    return `${start}〜${endText}`;
  }

  function formatKg(kg) {
    return `${(toTenths(kg) / 10).toFixed(1)} kg`;
  }

  function formatDiff(tenths) {
    const abs = (Math.abs(tenths) / 10).toFixed(1);
    if (tenths === 0) return `±${abs}`;
    return `${tenths > 0 ? "+" : MINUS}${abs}`;
  }

  function spokenDiff(label, tenths) {
    const abs = (Math.abs(tenths) / 10).toFixed(1);
    const sign = tenths === 0 ? "プラスマイナス" : tenths > 0 ? "プラス" : "マイナス";
    return `${label} ${sign} ${abs} キログラム`;
  }

  // ---- chart ----

  function chartModel(records, today, size = {}) {
    const width = size.width ?? 320;
    const height = size.height ?? 200;
    const left = size.left ?? 56;
    const right = size.right ?? 12;
    const top = size.top ?? 16;
    const bottom = size.bottom ?? 40;
    const rows = buildRows(records);
    if (!rows.length) return null;

    const latestWeek = rows[rows.length - 1].week;
    const firstAllowed = addWeeks(latestWeek, -(CHART_WEEKS - 1));
    const shown = rows.filter((row) => row.week >= firstAllowed);
    const truncated = shown.length < rows.length;

    const values = shown.map((row) => row.tenths);
    let low = Math.min(...values) - 5;
    let high = Math.max(...values) + 5;
    if (high - low < 20) {
      const missing = 20 - (high - low);
      low -= Math.floor(missing / 2);
      high += missing - Math.floor(missing / 2);
    }

    const firstWeek = shown[0].week;
    const span = weeksBetween(firstWeek, latestWeek);
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const x = (week) => (span === 0 ? left + plotWidth / 2 : left + (weeksBetween(firstWeek, week) / span) * plotWidth);
    const y = (tenths) => top + ((high - tenths) / (high - low)) * plotHeight;
    const points = shown.map((row, index) => ({
      week: row.week,
      kg: row.kg,
      x: round2(x(row.week)),
      y: round2(y(row.tenths)),
      latest: index === shown.length - 1,
    }));

    const first = shown[0];
    const last = shown[shown.length - 1];
    const label =
      shown.length === 1
        ? `体重の推移。${formatWeekLabel(last.week, today)} ${formatKg(last.kg)}、1件の記録`
        : `体重の推移。${formatWeekLabel(first.week, today)} ${formatKg(first.kg)} から、` +
          `${formatWeekLabel(last.week, today)} ${formatKg(last.kg)} まで、${shown.length}件の記録`;

    return {
      width,
      height,
      plot: { left, right: width - right, top, bottom: height - bottom },
      points,
      yTop: (high / 10).toFixed(1),
      yBottom: (low / 10).toFixed(1),
      xFirst: formatWeekStart(first.week, today),
      xLast: formatWeekStart(last.week, today),
      truncated,
      label,
    };
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  // ---- backup and storage ----

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // Local time with the offset, e.g. 2026-11-02T20:15:00+09:00.
  function localTimestamp(now) {
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return (
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
      `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
  }

  function backupFileName(today) {
    return `weekly-weight-${today}.json`;
  }

  function buildBackup(records, now) {
    return JSON.stringify(
      {
        app: "weekly-weight",
        version: 1,
        exportedAt: localTimestamp(now),
        records: records.map((record) => ({ date: record.date, kg: record.kg })),
      },
      null,
      2,
    );
  }

  function byteLength(text) {
    let bytes = 0;
    for (const char of text) {
      const code = char.codePointAt(0);
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
  }

  // latestDate: the last allowed date, or null for no limit (the saved data).
  function isValidRecord(record, latestDate) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
    if (!isRealDate(record.date)) return false;
    if (latestDate !== null && record.date > latestDate) return false;
    const kg = record.kg;
    if (typeof kg !== "number" || !Number.isFinite(kg)) return false;
    if (!/^\d+(\.\d)?$/.test(String(kg))) return false;
    const tenths = toTenths(kg);
    return tenths >= MIN_TENTHS && tenths <= MAX_TENTHS;
  }

  // Checks a list of records the same way for backups and for the saved data.
  // Backups pass today as latestDate; the saved data passes null, so a date that
  // became "future" after the clock went back is still a normal record.
  function checkRecords(list, latestDate) {
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_RECORDS) {
      return { ok: false, error: "WRONG_FORMAT" };
    }
    for (let i = 0; i < list.length; i++) {
      if (!isValidRecord(list[i], latestDate)) return { ok: false, error: "BAD_RECORD", index: i + 1 };
    }
    const weeks = new Set();
    for (const record of list) {
      const week = weekOf(record.date);
      if (weeks.has(week)) return { ok: false, error: "DUPLICATE_WEEK" };
      weeks.add(week);
    }
    const records = list
      .map((record) => ({ date: record.date, kg: record.kg }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, records };
  }

  // Returns { ok: true, records } or { ok: false, error, index? }. Never partial.
  function parseBackup(text, today) {
    if (typeof text !== "string" || byteLength(text) > MAX_BACKUP_BYTES) return { ok: false, error: "UNREADABLE" };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "UNREADABLE" };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "WRONG_FORMAT" };
    if (data.app !== "weekly-weight" || data.version !== 1) return { ok: false, error: "WRONG_FORMAT" };
    // Backups always keep the "today or earlier" check.
    if (!isRealDate(today)) throw new TypeError("parseBackup needs today as YYYY-MM-DD");
    return checkRecords(data.records, today);
  }

  // Returns window.localStorage, or null when even looking it up throws
  // (the browser does not allow this page to store data).
  function openStorage(win) {
    try {
      return win.localStorage ?? null;
    } catch {
      return null;
    }
  }

  // Reads the saved records. Never writes.
  // { state: "empty", records: [] } when the key is missing,
  // { state: "ok", records } when valid,
  // { state: "unavailable" } when the storage cannot be looked up or read,
  // { state: "broken" } when the saved data is there but does not pass the checks.
  // Dates after today are not checked here (see checkRecords).
  function loadRecords(storage) {
    if (!storage) return { state: "unavailable" };
    let text;
    try {
      text = storage.getItem(STORAGE_KEY);
    } catch {
      return { state: "unavailable" };
    }
    if (text === null || text === undefined) return { state: "empty", records: [] };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { state: "broken" };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data) || data.version !== 1) {
      return { state: "broken" };
    }
    const checked = checkRecords(data.records, null);
    return checked.ok ? { state: "ok", records: checked.records } : { state: "broken" };
  }

  // Returns true only when the new content was stored.
  function saveRecords(storage, records) {
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, records: records.map((record) => ({ date: record.date, kg: record.kg })) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function loadLastBackup(storage) {
    try {
      const value = storage.getItem(LAST_BACKUP_KEY);
      return isRealDate(value) ? value : null;
    } catch {
      return null;
    }
  }

  function saveLastBackup(storage, today) {
    try {
      storage.setItem(LAST_BACKUP_KEY, today);
      return true;
    } catch {
      return false;
    }
  }

  // The line under the backup buttons. Returns null (no line) when the storage is
  // "unavailable"; in that state the last-backup key is not read at all.
  function lastBackupText(loadState, storage, today) {
    if (loadState === "unavailable") return null;
    const date = loadLastBackup(storage);
    return date ? `最後にバックアップを作った日：${formatDate(date, today)}` : "バックアップはまだ作っていません。";
  }

  // Whether to show the text saying the records are kept only in this browser.
  // In the "unavailable" state nothing can be kept, so that text is not shown;
  // only the sentences saying nothing is sent out stay.
  function showsStorageExplanation(loadState) {
    return loadState !== "unavailable";
  }

  return {
    STORAGE_KEY,
    LAST_BACKUP_KEY,
    MAX_BACKUP_BYTES,
    lastBackupText,
    showsStorageExplanation,
    weekOf,
    isRealDate,
    parseKgInput,
    checkDate,
    findSameWeek,
    upsertRecord,
    buildRows,
    streak,
    summarize,
    formatDate,
    formatWeekLabel,
    formatWeekLabelWithDay,
    formatWeekRange,
    formatKg,
    formatDiff,
    spokenDiff,
    chartModel,
    buildBackup,
    backupFileName,
    parseBackup,
    openStorage,
    loadRecords,
    saveRecords,
    loadLastBackup,
    saveLastBackup,
  };
});
