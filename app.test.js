const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("./core.js");

// Runs app.js against a very small fake page, to check what the screen code
// writes. All weights and dates in this file are made up for testing.

const APP = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const TODAY = "2026-11-04";
// Elements start hidden as they are in index.html.
const HIDDEN_AT_START = new Set(
  [...fs.readFileSync(path.join(__dirname, "index.html"), "utf8").matchAll(/<[^>]*\sid="([^"]+)"[^>]*>/g)]
    .filter((match) => /\shidden[\s>]/.test(match[0]))
    .map((match) => match[1]),
);

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.max = "";
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.ownText = "";
    this.textWrites = 0;
  }
  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }
  set textContent(text) {
    this.textWrites += 1;
    this.children = [];
    this.ownText = String(text);
  }
  // Enough of a table for the history rows.
  get tHead() {
    return this.children[0];
  }
  get tBodies() {
    return this.children.slice(1);
  }
  get childElementCount() {
    return this.children.length;
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(typeof node === "string" ? Object.assign(new FakeElement(), { ownText: node }) : node);
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.ownText = "";
    this.append(...nodes);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }
  fire(type) {
    for (const handler of this.listeners[type] ?? []) handler({ type, target: this, preventDefault() {} });
  }
  focus() {}
  click() {
    this.fire("click");
  }
  remove() {}
}

class FixedDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(`${TODAY}T03:00:00Z`);
    else super(...args);
  }
  getTimezoneOffset() {
    return 0;
  }
  static now() {
    return new FixedDate().getTime();
  }
}

function openPage(saved = {}) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) {
      const node = new FakeElement(id);
      node.hidden = HIDDEN_AT_START.has(id);
      elements.set(id, node);
    }
    return elements.get(id);
  };
  const data = { ...saved };
  const localStorage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
  const document = {
    body: new FakeElement("body"),
    getElementById: byId,
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
    querySelectorAll: () => [],
  };
  const window = { localStorage };
  const context = vm.createContext({
    WeeklyCore: core,
    document,
    window,
    Date: FixedDate,
    Blob: class {},
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(APP, context);
  const $ = byId;
  return {
    $,
    typeKg(text) {
      // One input event per character, like typing on a keyboard.
      for (let i = 1; i <= text.length; i += 1) {
        $("kg").value = text.slice(0, i);
        $("kg").fire("input");
      }
    },
    setDate(value) {
      $("date").value = value;
      $("date").fire("input");
      $("date").fire("change");
    },
    submit() {
      $("entry-form").fire("submit");
    },
  };
}

const withThisWeek = () => ({
  [core.STORAGE_KEY]: JSON.stringify({ version: 1, records: [{ date: "2026-11-02", kg: 62.7 }] }),
});

test("the fake page opens with this week's overwrite notice (checks the test page itself)", () => {
  assert.ok(["overwrite", "week-notice", "date-error", "kg-error"].every((id) => HIDDEN_AT_START.has(id)));
  const page = openPage(withThisWeek());
  assert.equal(page.$("date-error").hidden, true);
  assert.equal(page.$("overwrite").hidden, false);
  assert.match(page.$("overwrite").textContent, /62\.7 kg の記録があります/);
  assert.equal(page.$("week-notice").hidden, false);
});

test("typing the weight does not write the same overwrite notice again for each key", () => {
  const page = openPage(withThisWeek());
  const box = page.$("overwrite");
  const text = box.textContent;
  const writes = box.textWrites;
  page.typeKg("62.5");
  assert.equal(box.textWrites, writes, "the live region was rewritten while its text stayed the same");
  assert.equal(box.textContent, text);
  assert.equal(box.hidden, false);
  page.$("kg").fire("blur");
  assert.equal(box.textWrites, writes);
});

test("stepping the date inside the same week does not write the overwrite notice again", () => {
  const page = openPage(withThisWeek());
  const box = page.$("overwrite");
  const writes = box.textWrites;
  for (const day of ["2026-11-03", "2026-11-02", "2026-11-03", "2026-11-04"]) page.setDate(day);
  assert.equal(box.textWrites, writes);
  assert.equal(box.hidden, false);
  // Moving to a week without a record hides it; coming back writes it once.
  page.setDate("2026-10-30");
  assert.equal(box.hidden, true);
  page.setDate("2026-11-02");
  assert.equal(box.hidden, false);
  assert.equal(box.textWrites, writes + 2);
});

test("the overwrite notice still comes back after recording, at the first key", () => {
  const page = openPage(withThisWeek());
  page.typeKg("62.5");
  page.submit();
  assert.equal(page.$("overwrite").hidden, true);
  assert.match(page.$("done").textContent, /62\.7 kg から 62\.5 kg に置き換えました。/);
  page.typeKg("6");
  assert.equal(page.$("done").childElementCount, 0);
  assert.equal(page.$("overwrite").hidden, false);
  assert.match(page.$("overwrite").textContent, /62\.5 kg の記録があります/);
});

test("the week line is not rewritten when the date moves within the same week", () => {
  const page = openPage(withThisWeek());
  const box = page.$("week-notice");
  const writes = box.textWrites;
  page.setDate("2026-11-03");
  page.setDate("2026-11-02");
  assert.equal(box.textWrites, writes);
  page.setDate("2026-10-30");
  assert.equal(box.textWrites, writes + 1);
  assert.equal(box.textContent, "この日付は10月26日（月）〜11月1日（日）の週の記録になります。");
});

test("the date's aria-describedby is not set again with the same value", () => {
  const page = openPage(withThisWeek());
  const date = page.$("date");
  assert.equal(date.getAttribute("aria-describedby"), "week-notice overwrite");
  let sets = 0;
  const original = date.setAttribute.bind(date);
  date.setAttribute = (name, value) => {
    if (name === "aria-describedby") sets += 1;
    original(name, value);
  };
  page.typeKg("62.5");
  page.setDate("2026-11-03");
  assert.equal(sets, 0);
});

test("changing the date clears the future-date error, and the week line stands alone", () => {
  const page = openPage();
  page.typeKg("62.0");
  page.setDate("2026-11-10");
  page.submit();
  assert.equal(page.$("date-error").hidden, false);
  assert.equal(page.$("date-error").textContent, "今日までの日付を選んでください。");
  assert.equal(page.$("date").getAttribute("aria-invalid"), "true");
  assert.equal(page.$("week-notice").hidden, true);

  page.setDate("2026-10-30");
  assert.equal(page.$("date-error").hidden, true);
  assert.equal(page.$("date-error").textContent, "");
  assert.equal(page.$("date").getAttribute("aria-invalid"), null);
  assert.equal(page.$("week-notice").hidden, false);
  assert.equal(page.$("week-notice").textContent, "この日付は10月26日（月）〜11月1日（日）の週の記録になります。");
  assert.equal(page.$("date").getAttribute("aria-describedby"), "week-notice");
  // The weight typed before is kept.
  assert.equal(page.$("kg").value, "62.0");
});

test("a wrong date still gets its error on the next 記録する", () => {
  const page = openPage();
  page.typeKg("62.0");
  page.setDate("2026-11-10");
  page.submit();
  page.setDate("2026-11-12");
  assert.equal(page.$("date-error").hidden, true);
  page.submit();
  assert.equal(page.$("date-error").hidden, false);
  assert.equal(page.$("date-error").textContent, "今日までの日付を選んでください。");
  page.setDate("");
  page.submit();
  assert.equal(page.$("date-error").textContent, "日付を選んでください。");
  assert.equal(page.$("date").getAttribute("aria-describedby"), "date-error");
});

test("changing the date also clears the empty-date error", () => {
  const page = openPage();
  page.typeKg("62.0");
  page.setDate("");
  page.submit();
  assert.equal(page.$("date-error").textContent, "日付を選んでください。");
  page.setDate("2026-11-04");
  assert.equal(page.$("date-error").hidden, true);
  page.submit();
  assert.equal(page.$("date-error").hidden, true);
  assert.match(page.$("done").textContent, /記録しました。/);
});
