import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuickTemplates,
  getWeeklyInsight,
  normalizeEntrySectionOrder,
  PAYMENT_METHODS,
  reorderEntrySections,
} from "./ledgerExperience.js";

const categories = [{ id: "breakfast" }, { id: "transit" }, { id: "drink" }];

test("近期記錄優先成為快速範本，並保留付款方式", () => {
  const templates = buildQuickTemplates([
    { type: "expense", category: "drink", amount: 42, currency: "HKD", paymentMethod: "payme", memo: "凍飲", date: "2026-07-25" },
  ], categories, "MOP");
  assert.equal(templates[0].amount, 42);
  assert.equal(templates[0].currency, "HKD");
  assert.equal(templates[0].paymentMethod, "payme");
  assert.equal(templates.length, 3);
});

test("無記錄時提供可直接使用的香港快速範本", () => {
  const templates = buildQuickTemplates([], categories, "MOP");
  assert.deepEqual(templates.map(item => item.paymentMethod), ["octopus", "octopus", "cash"]);
});

test("自訂付款方式移除預設方式後，快速範本不會引用失效方式", () => {
  const templates = buildQuickTemplates([], categories, "MOP", [
    { id: "cash", label: "現金", icon: "💵" },
  ]);
  assert.deepEqual(templates.map(item => item.paymentMethod), ["", "", "cash"]);
});

test("自訂快速範本會固定順序，不會被最新記帳取代", () => {
  const entries = [
    { type: "expense", category: "drink", amount: 99, paymentMethod: "cash", memo: "最新記錄", date: "2026-08-03" },
    { type: "expense", category: "breakfast", amount: 32, paymentMethod: "octopus", memo: "早餐", date: "2026-08-02" },
  ];
  const custom = [
    { category: "breakfast", amount: 45, paymentMethod: "payme", memo: "固定早餐" },
    { category: "drink", amount: 18, paymentMethod: "cash", memo: "固定飲品" },
  ];
  const templates = buildQuickTemplates(entries, categories, "MOP", PAYMENT_METHODS, custom);
  assert.deepEqual(templates.map(item => item.memo), ["固定早餐", "固定飲品"]);
  assert.deepEqual(templates.map(item => item.amount), [45, 18]);
});

test("自訂快速範本資料無效時會安全回到自動範本", () => {
  const templates = buildQuickTemplates([], categories, "MOP", PAYMENT_METHODS, [
    { category: "missing", amount: 0, paymentMethod: "unknown", memo: "無效" },
  ]);
  assert.equal(templates[0].category, "breakfast");
});

test("每週洞察正確比較今週與上週", () => {
  const insight = getWeeklyInsight([
    { type: "expense", date: "2026-07-20", amount: 80 },
    { type: "expense", date: "2026-07-13", amount: 100 },
  ], { today: new Date(2026, 6, 22), weekStart: "mon" });
  assert.equal(insight.tone, "positive");
  assert.equal(insight.percent, 20);
});

test("空資料仍可產生安全提示", () => {
  const insight = getWeeklyInsight([], { today: new Date(2026, 6, 22) });
  assert.equal(insight.tone, "neutral");
  assert.match(insight.text, /第一筆/);
});

test("舊帳本會補回完整記帳區塊順序", () => {
  assert.deepEqual(normalizeEntrySectionOrder(["details"]), ["date", "note", "payment", "category"]);
  assert.deepEqual(normalizeEntrySectionOrder(["payment", "unknown", "payment"]), ["payment", "category", "date", "note"]);
});

test("記帳區塊可按拖放結果重新排序", () => {
  assert.deepEqual(
    reorderEntrySections(["payment", "category", "date", "note"], 3, 0),
    ["note", "payment", "category", "date"],
  );
});
