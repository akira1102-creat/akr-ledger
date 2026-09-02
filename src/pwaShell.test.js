import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const stylesCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("iOS PWA status bar follows the app theme", () => {
  assert.match(appHtml, /name="apple-mobile-web-app-capable"\s+content="yes"/i);
  assert.match(appHtml, /name="apple-mobile-web-app-status-bar-style"\s+content="default"/i);
  assert.match(appHtml, /black-translucent/);
});

test("PWA safe-area root background matches light and dark shells", () => {
  assert.match(stylesCss, /html\s*\{[^}]*background:\s*#F8F9FA/i);
  assert.match(stylesCss, /html\.dark\s*\{[^}]*background:\s*#111827/i);
});
