import test from "node:test";
import assert from "node:assert/strict";
import { buildQuickTemplates, getWeeklyInsight } from "./ledgerExperience.js";

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
