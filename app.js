const { addEntry, parseBackup, summarize } = WeeklyCore;
const KEY = "weekly-weight";
const $ = (id) => document.getElementById(id);

let isStorageOk = true;
let state = load();

function load() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return parseBackup(saved);
  } catch {
    isStorageOk = false;
  }
  return { entries: [], settings: { heightCm: null, goalKg: null } };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    isStorageOk = true;
  } catch {
    isStorageOk = false;
  }
}

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function signed(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function statusText(summary) {
  if (!summary.latest) return "最初の体重を入れましょう";
  if (!summary.isDoneThisWeek) return "今週の体重を入れましょう";
  return summary.streak > 1 ? `今週も記録できました。${summary.streak}週連続です` : "今週の記録は完了です。また来週";
}

function renderStats(summary) {
  const items = [
    ["最新", summary.latest ? `${summary.latest.kg.toFixed(1)}kg` : "-"],
    ["前回から", summary.change === null ? "-" : `${signed(summary.change)}kg`],
    ["開始から", summary.totalChange === null ? "-" : `${signed(summary.totalChange)}kg`],
    ["連続", `${summary.streak}週`],
    ["BMI", summary.bmi === null ? "-" : summary.bmi.toFixed(1)],
    ["目標まで", summary.toGoal === null ? "-" : `${Math.max(summary.toGoal, 0).toFixed(1)}kg`],
  ];
  $("stats").replaceChildren(
    ...items.map(([label, value]) => {
      const box = document.createElement("div");
      box.className = "stat";
      const number = document.createElement("b");
      number.textContent = value;
      const caption = document.createElement("span");
      caption.textContent = label;
      box.append(number, caption);
      return box;
    }),
  );
}

function svgElement(name, attributes, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderChart(entries, goal) {
  if (entries.length < 2) {
    $("chart").textContent = "2回記録するとグラフが出ます。";
    return;
  }
  const width = 520;
  const height = 200;
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 26;
  const values = entries.map((entry) => entry.kg);
  if (goal) values.push(goal);
  const low = Math.floor(Math.min(...values) - 1);
  const high = Math.ceil(Math.max(...values) + 1);
  const times = entries.map((entry) => Date.parse(entry.date));
  const first = times[0];
  const span = times[times.length - 1] - first || 1;
  const x = (time) => left + ((time - first) / span) * (width - left - right);
  const y = (kg) => top + ((high - kg) / (high - low)) * (height - top - bottom);

  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "体重の推移" });
  for (const kg of [low, high]) {
    svg.append(
      svgElement("line", { x1: left, x2: width - right, y1: y(kg), y2: y(kg), stroke: "var(--line)" }),
      svgElement("text", { x: left - 6, y: y(kg) + 4, "text-anchor": "end" }, String(kg)),
    );
  }
  if (goal) {
    svg.append(
      svgElement("line", { x1: left, x2: width - right, y1: y(goal), y2: y(goal), stroke: "var(--warn)", "stroke-dasharray": "5 5" }),
      svgElement("text", { x: width - right, y: y(goal) - 5, "text-anchor": "end" }, `目標 ${goal}kg`),
    );
  }
  const points = entries.map((entry, index) => `${x(times[index])},${y(entry.kg)}`).join(" ");
  svg.append(svgElement("polyline", { points, fill: "none", stroke: "var(--accent)", "stroke-width": 2.5 }));
  entries.forEach((entry, index) => {
    svg.append(svgElement("circle", { cx: x(times[index]), cy: y(entry.kg), r: 3.5, fill: "var(--accent)" }));
  });
  const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  svg.append(
    svgElement("text", { x: left, y: height - 6 }, shortDate(entries[0].date)),
    svgElement("text", { x: width - right, y: height - 6, "text-anchor": "end" }, shortDate(entries[entries.length - 1].date)),
  );
  $("chart").replaceChildren(svg);
}

function renderHistory(entries) {
  $("history").replaceChildren(
    ...[...entries].reverse().map((entry) => {
      const row = document.createElement("li");
      const date = document.createElement("span");
      date.textContent = entry.date;
      const kg = document.createElement("span");
      kg.textContent = `${entry.kg.toFixed(1)}kg`;
      row.append(date, kg);
      return row;
    }),
  );
}

function render() {
  const summary = summarize(state.entries, today(), state.settings);
  $("status").textContent = statusText(summary);
  renderStats(summary);
  renderChart(state.entries, state.settings.goalKg);
  renderHistory(state.entries);
  $("height").value = state.settings.heightCm ?? "";
  $("goal").value = state.settings.goalKg ?? "";
  if (!isStorageOk) $("message").textContent = "このブラウザでは保存できません。閉じると記録が消えます。";
}

$("entry-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    state.entries = addEntry(state.entries, { date: $("date").value, kg: Number($("kg").value) });
    save();
    $("kg").value = "";
    $("message").textContent = "";
    render();
  } catch (error) {
    $("message").textContent = error.message;
  }
});

$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.settings = {
    heightCm: Number($("height").value) || null,
    goalKg: Number($("goal").value) || null,
  };
  save();
  render();
});

$("export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `weekly-weight-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

$("import").addEventListener("click", () => $("import-file").click());

$("import-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    const restored = parseBackup(await file.text());
    if (!confirm(`今の記録を、バックアップの${restored.entries.length}件に置き換えます。よろしいですか？`)) return;
    state = restored;
    save();
    $("message").textContent = "";
    render();
  } catch {
    $("message").textContent = "バックアップを読み込めませんでした。";
  }
});

$("date").value = today();
render();
