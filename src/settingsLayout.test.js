import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("設定首頁以單一最上方入口管理帳本、用戶與同步", () => {
  const menuStart = source.indexOf("const menu = [");
  const menuEnd = source.indexOf("];", menuStart);
  const menuSource = source.slice(menuStart, menuEnd);

  assert.match(menuSource, /key:\s*"account"[\s\S]*label:\s*"帳本、用戶與同步"/);
  assert.doesNotMatch(menuSource, /key:\s*"profile"/);
  assert.doesNotMatch(menuSource, /key:\s*"data"/);
});

test("合併頁面同時保留帳本管理及數據同步內容", () => {
  assert.match(
    source,
    /tab==="account"[\s\S]*<ProfileSettings[\s\S]*<DataSettings/,
  );
});

test("設定首頁只保留一個頁面設定入口", () => {
  const menuStart = source.indexOf("const menu = [");
  const menuEnd = source.indexOf("];", menuStart);
  const menuSource = source.slice(menuStart, menuEnd);

  assert.match(menuSource, /key:\s*"layout"[\s\S]*label:\s*"頁面設定"/);
  assert.doesNotMatch(menuSource, /key:\s*"entry"/);
});

test("頁面設定同時顯示一般佈局及記帳頁面設定", () => {
  assert.match(
    source,
    /tab==="layout"\s*&&\s*<div[^>]*>[\s\S]*?<LayoutSettings[\s\S]*?<EntryLayoutSettings[\s\S]*?<\/div>/,
  );
});
