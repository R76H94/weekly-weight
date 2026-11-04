// Screen for 週イチ体重. All calculations and checks are in core.js.
(function () {
  "use strict";

  const C = WeeklyCore;
  const $ = (id) => document.getElementById(id);
  const PAGE = 12;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const KG_MESSAGES = {
    EMPTY: "体重を入れてください。",
    NOT_NUMBER: "数字で入れてください。例：62.4",
    RANGE: "20.0〜400.0 kg の範囲で入れてください。",
    DECIMALS: "小数は第1位までで入れてください。例：62.4",
  };
  const DATE_MESSAGES = {
    EMPTY: "日付を選んでください。",
    FUTURE: "今日までの日付を選んでください。",
  };
  const SAVE_FAILED =
    "保存できませんでした。ブラウザの保存領域がいっぱいか、保存が許可されていない可能性があります。バックアップを保存してから、もう一度お試しください。";
  const IMPORT_MESSAGES = {
    UNREADABLE: "このファイルは読み込めませんでした。週イチ体重で保存したファイルを選んでください。記録は変わっていません。",
    WRONG_FORMAT: "このファイルは週イチ体重のバックアップではないか、対応していない版です。記録は変わっていません。",
    DUPLICATE_WEEK: "ファイルの中に、同じ週の記録が重なっています。記録は変わっていません。",
  };

  // Looking up localStorage itself can throw when the browser blocks it.
  const storage = C.openStorage(window);

  // Local date as YYYY-MM-DD. Read fresh each time, the page may stay open past midnight.
  function today() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  // "broken" means the saved data exists but could not be read. Nothing is written
  // to the saved key in that state until the user confirms replacing it from a file.
  // "unavailable" means the storage cannot be read at all. Nothing is written, and
  // recording, saving and loading a backup are all stopped until the page is reopened.
  const loaded = C.loadRecords(storage);
  const unavailable = loaded.state === "unavailable";
  let broken = loaded.state === "broken";
  let records = loaded.state === "ok" || loaded.state === "empty" ? loaded.records : [];
  let shownRows = PAGE;
  let pending = null;

  const kgInput = $("kg");
  const dateInput = $("date");

  // ---- small helpers ----

  function el(tag, attributes = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attributes = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(node, text) {
    node.textContent = text;
    node.hidden = false;
  }

  function hide(node) {
    node.textContent = "";
    node.hidden = true;
  }

  // The date field is described by the week line, the overwrite notice and the
  // error, in that order, each only while it is shown (design 8-A).
  function updateDateDescribedBy() {
    const ids = C.dateDescribedBy({
      week: !$("week-notice").hidden,
      overwrite: !$("overwrite").hidden,
      error: !$("date-error").hidden,
    });
    if (!ids) dateInput.removeAttribute("aria-describedby");
    else if (dateInput.getAttribute("aria-describedby") !== ids) dateInput.setAttribute("aria-describedby", ids);
  }

  // For the lines updated on every keystroke or every day stepped through: the
  // node is written only when its text really changes, so a live region is read
  // once and not again for each key (design 8-B).
  function showOrHide(node, text) {
    if (text === null) {
      if (!node.hidden) hide(node);
    } else if (node.hidden || node.textContent !== text) {
      show(node, text);
    }
  }

  function setFieldError(input, box, message) {
    show(box, message);
    input.setAttribute("aria-invalid", "true");
    if (input === dateInput) updateDateDescribedBy();
    else input.setAttribute("aria-describedby", box.id);
  }

  function clearFieldError(input, box) {
    hide(box);
    input.removeAttribute("aria-invalid");
    if (input === dateInput) updateDateDescribedBy();
    else input.removeAttribute("aria-describedby");
  }

  function clearFormMessages() {
    clearFieldError(kgInput, $("kg-error"));
    clearFieldError(dateInput, $("date-error"));
    hide($("save-error"));
    $("done").replaceChildren();
  }

  // ---- rendering ----

  function renderBroken() {
    const stopped = broken || unavailable;
    $("broken").hidden = !broken;
    $("unavailable").hidden = !unavailable;
    for (const id of ["kg", "date", "submit", "export"]) $(id).disabled = stopped;
    $("import").disabled = unavailable;
    // The way to start over without a backup exists only while the saved data is broken.
    $("discard").hidden = !broken;
    if (!broken) $("discard-panel").hidden = true;
    // While the saved data cannot be read, no zero-record text is shown.
    for (const id of ["numbers-section", "chart-section", "history-section"]) $(id).hidden = stopped;
    // While nothing can be kept, the "kept only in this browser" text is not shown.
    const explain = C.showsStorageExplanation(loaded.state);
    for (const node of document.querySelectorAll("[data-storage-explanation]")) node.hidden = !explain;
    if (stopped) hide($("overwrite"));
  }

  function card(label, value, sub, spoken) {
    const box = el("div", { class: "card" });
    const valueNode = el("p", { class: "value" }, value);
    if (spoken) valueNode.setAttribute("aria-label", spoken);
    box.append(el("p", { class: "label" }, label), valueNode, el("p", { class: "sub" }, sub));
    return box;
  }

  function renderNumbers(t) {
    const summary = C.summarize(records, t);
    const target = $("numbers");
    if (!summary.count) {
      target.replaceChildren(el("p", {}, "まだ記録がありません。最初の1件を入れると、ここに数字が出ます。"));
      return;
    }
    const latest = summary.latest;
    const cards = [card("最新の体重", C.formatKg(latest.kg), C.formatWeekLabelWithDay(latest.week, t))];

    if (latest.diffTenths === null) {
      cards.push(card("前回との差", "—", C.ONE_RECORD_NOTE));
    } else {
      const label = C.previousDiffLabel(latest);
      cards.push(
        card(
          label,
          `${C.formatDiff(latest.diffTenths)} kg`,
          `前回 ${C.formatWeekLabel(latest.previous.week, t)} ${C.formatKg(latest.previous.kg)} と比べた差`,
          C.spokenDiff(label, latest.diffTenths),
        ),
      );
    }

    if (latest.startDiffTenths === null) {
      cards.push(card("開始からの差", "—", C.ONE_RECORD_NOTE));
    } else {
      cards.push(
        card(
          "開始からの差",
          `${C.formatDiff(latest.startDiffTenths)} kg`,
          `開始 ${C.formatWeekLabel(summary.start.week, t)} ${C.formatKg(summary.start.kg)} と比べた差`,
          C.spokenDiff("開始からの差", latest.startDiffTenths),
        ),
      );
    }

    if (summary.streak === null) cards.push(card("連続週数", "—", "今週の記録から、また数えます"));
    else cards.push(card("連続週数", `${summary.streak} 週`, "記録した週が続いている数"));

    const grid = el("div", { class: "cards" });
    grid.append(...cards);
    target.replaceChildren(grid, el("p", { class: "next" }, C.nextRecordText(records, t)));
  }

  function renderChart(t) {
    const target = $("chart");
    const note = $("chart-note");
    const model = C.chartModel(records, t);
    if (!model) {
      target.replaceChildren(el("p", {}, "記録が入ると、ここにグラフが出ます。"));
      hide(note);
      return;
    }
    const { plot, points } = model;
    const root = svg("svg", { viewBox: `0 0 ${model.width} ${model.height}`, role: "img", "aria-label": model.label });
    root.append(
      svg("rect", {
        x: plot.left,
        y: plot.top,
        width: plot.right - plot.left,
        height: plot.bottom - plot.top,
        fill: "none",
        stroke: "var(--line)",
        "stroke-width": 1,
      }),
      svg("text", { x: plot.left - 8, y: plot.top + 5, "text-anchor": "end" }, model.yTop),
      svg("text", { x: plot.left - 8, y: plot.bottom + 5, "text-anchor": "end" }, model.yBottom),
    );
    const labelY = model.height - 8;
    if (points.length === 1) {
      root.append(svg("text", { x: points[0].x, y: labelY, "text-anchor": "middle" }, model.xFirst));
    } else {
      root.append(
        svg("text", { x: 2, y: labelY, "text-anchor": "start" }, model.xFirst),
        svg("text", { x: model.width - 2, y: labelY, "text-anchor": "end" }, model.xLast),
      );
      root.append(
        svg("polyline", {
          points: points.map((p) => `${p.x},${p.y}`).join(" "),
          fill: "none",
          stroke: "var(--accent)",
          "stroke-width": 2,
        }),
      );
    }
    for (const p of points) {
      root.append(svg("circle", { cx: p.x, cy: p.y, r: p.latest ? 6 : 4, fill: "var(--accent)" }));
    }
    target.replaceChildren(root);

    if (points.length === 1) show(note, "2件目の記録からグラフになります");
    else if (model.truncated) show(note, "直近52週を表示しています。");
    else hide(note);
  }

  function renderHistory(t) {
    const target = $("history");
    const more = $("more");
    const rows = C.historyRows(records, t);
    if (!rows.length) {
      target.replaceChildren(el("p", {}, "まだ記録がありません。"));
      hide($("history-hint"));
      more.hidden = true;
      return;
    }
    // How to fix a week, above the table (design 8-C).
    show($("history-hint"), C.HISTORY_HINT);
    const table = el("table", { "aria-describedby": "history-hint" });
    const head = el("tr");
    // The unit is in the header, so a number never wraps away from "kg" (design 3-6).
    for (const [name, unit] of [["週", ""], ["体重", "（kg）"], ["前回との差", "（kg）"]]) {
      const th = el("th", { scope: "col" }, name);
      if (unit) th.append(el("span", { class: "num" }, unit));
      head.append(th);
    }
    table.append(el("thead"), el("tbody"));
    table.tHead.append(head);
    for (const row of rows.slice(0, shownRows)) {
      const diff = el("td");
      if (row.diffTenths === null) diff.textContent = "—";
      else {
        diff.append(el("span", { class: "num" }, C.formatDiff(row.diffTenths)));
        if (row.diffNote) diff.append(row.diffNote);
      }
      const tr = el("tr");
      tr.append(
        el("td", {}, C.formatWeekRange(row.week, t)),
        el("td", { class: "num" }, C.formatKgNumber(row.kg)),
        diff,
      );
      table.tBodies[0].append(tr);
      // The weeks without a record get their own row, so a skipped week is seen
      // without reading the note (design 3-6). Only record rows count for "さらに表示".
      if (row.gapBelow) {
        const gap = el("tr", { class: "gap" });
        gap.append(el("td", { colspan: "3" }, row.gapBelow));
        table.tBodies[0].append(gap);
      }
    }
    target.replaceChildren(table);
    more.hidden = rows.length <= shownRows;
  }

  function renderLastBackup(t) {
    // While the storage is unavailable, no line is shown and the key is not read.
    const text = C.lastBackupText(loaded.state, storage, t);
    if (text === null) hide($("last-backup"));
    else show($("last-backup"), text);
  }

  function render() {
    const t = today();
    dateInput.max = t;
    renderBroken();
    if (!broken && !unavailable) {
      renderNumbers(t);
      renderChart(t);
      renderHistory(t);
    }
    renderLastBackup(t);
    updateWeekNotice();
    updateOverwriteNotice();
  }

  // ---- recording ----

  // Design 8-A: which week the date belongs to, under the date field.
  function updateWeekNotice() {
    const box = $("week-notice");
    const text = broken || unavailable ? null : C.weekNoticeText(dateInput.value, today());
    showOrHide(box, text);
    updateDateDescribedBy();
  }

  // Design 8-B: shown whenever the date's week has a record, except while the
  // confirmation after recording is shown (that one already says what happened).
  function updateOverwriteNotice() {
    const box = $("overwrite");
    const done = $("done").childElementCount > 0;
    const text = broken || unavailable || done ? null : C.overwriteNoticeText(records, dateInput.value, today());
    showOrHide(box, text);
    updateDateDescribedBy();
  }

  $("entry-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (broken || unavailable) return;
    clearFormMessages();
    const t = today();
    const typed = kgInput.value;
    const kg = C.parseKgInput(typed);
    const date = dateInput.value;
    const dateCheck = C.checkDate(date, t);
    if (!kg.ok) setFieldError(kgInput, $("kg-error"), KG_MESSAGES[kg.error]);
    if (!dateCheck.ok) setFieldError(dateInput, $("date-error"), DATE_MESSAGES[dateCheck.error]);
    if (!kg.ok) return kgInput.focus();
    if (!dateCheck.ok) return dateInput.focus();

    const existing = C.findSameWeek(records, date);
    const next = C.upsertRecord(records, { date, kg: kg.kg });
    // The screen changes only after the new records are stored.
    if (!C.saveRecords(storage, next)) {
      show($("save-error"), SAVE_FAILED);
      return;
    }
    records = next;
    kgInput.value = "";
    dateInput.value = t;

    const lines = [];
    // The old value comes from the record that was replaced (design 8-B).
    if (existing) lines.push(C.overwriteDoneText(date, existing.kg, kg.kg, t));
    const count = C.streak(records, t);
    lines.push(count === null ? "記録しました。" : `記録しました。連続 ${count} 週です。`);
    lines.push(`${C.formatKg(kg.kg)}（${C.formatDate(date, t)}）`);
    const nodes = lines.map((line) => el("p", {}, line));
    // Says quietly that "62,9" or full-width digits were read as 62.9 (design 3-3).
    const fixed = C.inputCorrectionText(typed, kg.kg);
    if (fixed) nodes.push(el("p", { class: "fixed" }, fixed));
    $("done").replaceChildren(...nodes);
    // After the date went back to today: the week line follows it, and the
    // overwrite notice stays hidden while the confirmation is shown.
    render();
  });

  // The first keystroke clears the confirmation, so the overwrite notice can come
  // back before Enter is pressed (design 8-B).
  kgInput.addEventListener("input", () => {
    $("done").replaceChildren();
    updateOverwriteNotice();
  });
  // Like the date: an error from the last try is about the weight that was there
  // then. No new error while typing; it comes back on the next "記録する" if still wrong.
  for (const type of ["input", "change"]) {
    kgInput.addEventListener(type, () => clearFieldError(kgInput, $("kg-error")));
  }
  for (const type of ["input", "change"]) {
    dateInput.addEventListener(type, () => {
      if (type === "input") $("done").replaceChildren();
      // An error from the last try (a future or empty date) is about the date
      // that was there then; it comes back on the next "記録する" if still wrong.
      clearFieldError(dateInput, $("date-error"));
      updateWeekNotice();
      updateOverwriteNotice();
    });
  }
  kgInput.addEventListener("blur", updateOverwriteNotice);

  $("more").addEventListener("click", () => {
    shownRows += PAGE;
    renderHistory(today());
  });

  // ---- starting over from broken saved data (no backup) ----

  function closeDiscardPanel() {
    $("discard-panel").hidden = true;
  }

  $("discard").addEventListener("click", () => {
    if (!broken) return;
    closePanel();
    clearFormMessages();
    $("discard-panel").hidden = false;
    $("discard-no").focus();
  });

  $("discard-no").addEventListener("click", () => {
    closeDiscardPanel();
    $("done").replaceChildren(el("p", {}, "消すのをやめました。記録は変更していません。"));
    $("discard").focus();
  });

  $("discard-yes").addEventListener("click", () => {
    // The only removal of saved data: broken data, after the user confirmed it.
    if (!broken || unavailable) return;
    closeDiscardPanel();
    clearFormMessages();
    if (!C.discardSavedData(storage)) {
      show($("save-error"), "保存データを消せませんでした。記録は変更していません。");
      $("discard").focus();
      return;
    }
    records = [];
    broken = false;
    shownRows = PAGE;
    render();
    $("done").replaceChildren(el("p", {}, "保存データを消しました。記録0件から始めます。"));
    kgInput.focus();
  });

  // ---- backup ----

  function backupStatus(text) {
    $("backup-status").textContent = text;
  }

  $("export").addEventListener("click", () => {
    if (broken || unavailable) return;
    const t = today();
    if (!records.length) {
      backupStatus("保存する記録がまだありません。");
      return;
    }
    const name = C.backupFileName(t);
    const url = URL.createObjectURL(new Blob([C.buildBackup(records, new Date())], { type: "application/json" }));
    const link = el("a", { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // A failure to remember the date does not make the backup fail.
    if (C.saveLastBackup(storage, t)) renderLastBackup(t);
    backupStatus(C.backupDoneText(name));
  });

  $("import").addEventListener("click", () => {
    if (unavailable) return;
    $("import-file").click();
  });

  function closePanel() {
    pending = null;
    $("replace-panel").hidden = true;
  }

  $("import-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file || unavailable) return;
    closePanel();
    let text;
    if (file.size > C.MAX_BACKUP_BYTES) {
      backupStatus(IMPORT_MESSAGES.UNREADABLE);
      return;
    }
    try {
      text = await file.text();
    } catch {
      backupStatus(IMPORT_MESSAGES.UNREADABLE);
      return;
    }
    const result = C.parseBackup(text, today());
    if (!result.ok) {
      backupStatus(
        result.error === "BAD_RECORD"
          ? `ファイルの中に、読み込めない記録があります（${result.index} 件目）。記録は変わっていません。`
          : IMPORT_MESSAGES[result.error],
      );
      return;
    }
    pending = result.records;
    closeDiscardPanel();
    backupStatus("");
    $("replace-text").textContent = broken
      ? `読み込めなかった保存データを、ファイルの記録 ${pending.length} 件に置き換えます。置き換えると、元の保存データは戻せません。`
      : `いまの記録 ${records.length} 件を、ファイルの記録 ${pending.length} 件に置き換えます。置き換えると、いまの記録は戻せません。`;
    $("replace-panel").hidden = false;
    $("replace-no").focus();
  });

  $("replace-no").addEventListener("click", () => {
    closePanel();
    backupStatus("読み込みをやめました。記録は変わっていません。");
    $("import").focus();
  });

  $("replace-yes").addEventListener("click", () => {
    if (!pending || unavailable) return;
    const next = pending;
    // The only place that writes over saved data that could not be read.
    if (!C.saveRecords(storage, next)) {
      closePanel();
      backupStatus("記録を保存できませんでした。記録は変わっていません。");
      $("import").focus();
      return;
    }
    records = next;
    broken = false;
    shownRows = PAGE;
    closePanel();
    clearFormMessages();
    render();
    backupStatus(`${next.length} 件の記録を読み込みました。`);
    $("import").focus();
  });

  dateInput.value = today();
  render();
})();
