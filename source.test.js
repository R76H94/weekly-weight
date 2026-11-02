const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FILES = ["index.html", "app.js", "core.js"];
const sources = Object.fromEntries(FILES.map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")]));

// Words that must not appear anywhere on the screen (design section 6).
const BANNED_WORDS = [
  "BMI",
  "標準",
  "適正",
  "肥満",
  "やせ",
  "太った",
  "痩せた",
  "増えた",
  "減った",
  "目標",
  "ダイエット",
  "減量",
  "健康",
  "医師",
  "おすすめ",
  "頑張",
  "順調",
  "リバウンド",
  "通知",
];

test("no banned words in the page or scripts", () => {
  for (const [name, text] of Object.entries(sources)) {
    for (const word of BANNED_WORDS) {
      assert.ok(!text.includes(word), `${name} contains ${word}`);
    }
  }
});

test("no way to send data out", () => {
  for (const [name, text] of Object.entries(sources)) {
    for (const api of ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"]) {
      assert.ok(!new RegExp(`\\b${api}\\b`).test(text), `${name} uses ${api}`);
    }
    const urls = text.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`)<>]*/gi) ?? [];
    assert.deepEqual(
      urls.filter((url) => url !== "http://www.w3.org/2000/svg"),
      [],
      `${name} has a URL other than the SVG namespace`,
    );
  }
});

test("no browser confirm dialog and no external scripts", () => {
  for (const [name, text] of Object.entries(sources)) {
    assert.ok(!/(^|[^\w$])confirm\s*\(/.test(text), `${name} calls confirm()`);
  }
  const scripts = [...sources["index.html"].matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]);
  assert.deepEqual(scripts, ["core.js", "app.js"]);
  assert.ok(!/<link\b[^>]*\bhref\s*=\s*["']?(https?:)?\/\//i.test(sources["index.html"]), "external stylesheet");
});

test("the prototype storage key is not used", () => {
  for (const [name, text] of Object.entries(sources)) {
    assert.ok(!/(getItem|setItem|removeItem)\(\s*["']weekly-weight["']/.test(text), `${name} touches the old key`);
  }
  assert.ok(!/\bremoveItem\b|\bclear\(\)/.test(sources["app.js"] + sources["core.js"]), "nothing is deleted from storage");
});
