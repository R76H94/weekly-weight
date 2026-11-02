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

  function setFieldError(input, box, message) {
    show(box, message);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", box.id);
  }

  function clearFieldError(input, box) {
    hide(box);
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
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
      cards.push(card("前回との差", "—", "比べる記録がまだありません"));
    } else {
      const label = latest.gapWeeks > 1 ? `前回との差（${latest.gapWeeks}週前）` : "前回との差";
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
      cards.push(card("開始からの差", "—", "次の週から表示します"));
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
    target.replaceChildren(grid);
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
    const rows = C.buildRows(records).reverse();
    if (!rows.length) {
      target.replaceChildren(el("p", {}, "まだ記録がありません。"));
      more.hidden = true;
      return;
    }
    const table = el("table");
    const head = el("tr");
    for (const name of ["週", "体重", "前回との差"]) head.append(el("th", { scope: "col" }, name));
    table.append(el("thead"), el("tbody"));
    table.tHead.append(head);
    for (const row of rows.slice(0, shownRows)) {
      let diff = "—";
      if (row.diffTenths !== null) {
        diff = `${C.formatDiff(row.diffTenths)} kg`;
        if (row.gapWeeks > 1) diff += `（${row.gapWeeks}週前との差）`;
      }
      const tr = el("tr");
      tr.append(el("td", {}, C.formatWeekLabel(row.week, t)), el("td", { class: "kg" }, C.formatKg(row.kg)), el("td", {}, diff));
      table.tBodies[0].append(tr);
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
  }

  // ---- recording ----

  function updateOverwriteNotice() {
    const box = $("overwrite");
    if (broken || unavailable) return hide(box);
    const existing = C.findSameWeek(records, dateInput.value);
    if (!existing) return hide(box);
    const range = C.formatWeekRange(C.weekOf(existing.date), today());
    show(box, `この週（${range}）には ${C.formatKg(existing.kg)} の記録があります。記録すると上書きします。`);
  }

  $("entry-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (broken || unavailable) return;
    clearFormMessages();
    const t = today();
    const kg = C.parseKgInput(kgInput.value);
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
    hide($("overwrite"));
    render();

    const lines = [];
    if (existing) lines.push(`${C.formatWeekRange(C.weekOf(date), t)}の週の記録を上書きしました。`);
    const count = C.streak(records, t);
    lines.push(count === null ? "記録しました。" : `記録しました。連続 ${count} 週です。`);
    lines.push(`${C.formatKg(kg.kg)}（${C.formatDate(date, t)}）`);
    $("done").replaceChildren(...lines.map((line) => el("p", {}, line)));
  });

  for (const input of [kgInput, dateInput]) {
    input.addEventListener("input", () => $("done").replaceChildren());
  }
  dateInput.addEventListener("change", updateOverwriteNotice);
  kgInput.addEventListener("blur", updateOverwriteNotice);

  $("more").addEventListener("click", () => {
    shownRows += PAGE;
    renderHistory(today());
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
    backupStatus(`バックアップのファイルを作りました。ファイル名：${name}。ダウンロード先にあることを確認してください。`);
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
