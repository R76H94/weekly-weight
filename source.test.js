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

// Design 2 "保存できないとき": these parts are hidden when storage is unavailable.
function storageExplanationParts(html) {
  return [...html.matchAll(/<(\w+)\b[^>]*\bdata-storage-explanation\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) =>
    m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, ""),
  );
}

test("only the 'kept in this browser' text is marked to hide when storage is unavailable", () => {
  const html = sources["index.html"];
  const parts = storageExplanationParts(html);
  assert.ok(parts.length >= 2, "the record note and the backup text are marked");
  assert.ok(parts[0].startsWith("記録はこの端末のブラウザの中だけに保存されます。"), "record note is marked");
  assert.ok(parts.some((text) => text.startsWith("記録は、この端末のブラウザの中だけに保存")), "backup text is marked");
  for (const text of parts) assert.ok(!text.includes("外部へ送信しません"), "the 'not sent out' text stays");
  // The two "not sent out" sentences and the two backup buttons are not inside a marked part.
  const unmarked = html.replace(/<(\w+)\b[^>]*\bdata-storage-explanation\b[^>]*>[\s\S]*?<\/\1>/g, "");
  assert.ok(unmarked.includes("入力した内容は外部へ送信しません。"));
  assert.ok(unmarked.includes("<p>入力した体重や日付は、外部へ送信しません。</p>"));
  assert.ok(unmarked.includes('id="export"') && unmarked.includes('id="import"'));
  assert.ok(sources["app.js"].includes("[data-storage-explanation]"));
});

test("the backup section says what the plan requires, in plain words", () => {
  const text = sources["index.html"].replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  // Plan: kept only in this browser, when it is lost, a backup is advised, nothing is sent out.
  for (const part of [
    "記録は、この端末のブラウザの中だけに保存されます。",
    "ブラウザのデータを消したとき、端末の故障や買い替え、別のブラウザで開いたときは、記録が消えるか、見られなくなります。",
    "バックアップをしなくても、毎週の記録はできます。",
    "機種変更や別の端末で見るときのために、月に1回ほどバックアップを保存してください。",
    "端末を移すとき：",
    "今の端末で「バックアップを保存」",
    "できたバックアップを、メールなどで新しい端末へ",
    "新しい端末で「バックアップを読み込む」",
    "入力した体重や日付は、外部へ送信しません。",
  ]) {
    assert.ok(text.includes(part), part);
  }
  const start = text.indexOf("バックアップと保存について");
  const end = text.indexOf("バックアップを保存バックアップを読み込む", start);
  assert.ok(start >= 0 && end > start);
  const body = text.slice(start, end);
  for (const word of ["ファイル", "ダウンロード", "json", "JSON"]) assert.ok(!body.includes(word), word);
});

test("the prototype storage key is not used", () => {
  for (const [name, text] of Object.entries(sources)) {
    assert.ok(!/(getItem|setItem|removeItem)\(\s*["']weekly-weight["']/.test(text), `${name} touches the old key`);
  }
  assert.ok(!/\bremoveItem\b|\bclear\(\)/.test(sources["app.js"] + sources["core.js"]), "nothing is deleted from storage");
});
