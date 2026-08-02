import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuickTemplates,
  getMostUsedCategories,
  getWeeklyInsight,
  incrementCategoryUsage,
  normalizeEntrySectionOrder,
  normalizeEntrySectionVisibility,
  PAYMENT_METHODS,
  reorderEntrySections,
} from "./ledgerExperience.js";

test("分類快速卡按本機使用次數穩定取出最多十個可選分類", () => {
  const categories = [
    { id: "parent", name: "父分類" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `cat${index + 1}`, parentId: "parent" })),
    { id: "empty-parent", name: "沒有子分類" },
  ];
  const usage = { cat12: 2, cat3: 7, cat1: 7, cat11: 1, parent: 99 };

  assert.deepEqual(
    getMostUsedCategories(categories, usage, 10).map(category => category.id),
    ["cat1", "cat3", "cat12", "cat11", "cat2", "cat4", "cat5", "cat6", "cat7", "cat8"],
  );
});

test("分類使用次數只在本機資料模型中遞增", () => {
  assert.deepEqual(incrementCategoryUsage({ breakfast: 2 }, "breakfast"), { breakfast: 3 });
  assert.deepEqual(incrementCategoryUsage({}, "drink"), { drink: 1 });
  assert.deepEqual(incrementCategoryUsage({ breakfast: 2 }, ""), { breakfast: 2 });
});

test("記帳卡片隱藏設定缺漏時保留四張卡並接受布林值", () => {
  assert.deepEqual(normalizeEntrySectionVisibility({ category: false, note: true }), {
    payment: true,
    category: false,
    date: true,
    note: true,
  });
  assert.deepEqual(normalizeEntrySectionVisibility({ payment: "no", unknown: false }), {
    payment: true,
    category: true,
    date: true,
    note: true,
  });
});

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

test("自訂快速範本最多保留20個", () => {
  const custom = Array.from({length: 25}, (_, index) => ({
    category: "breakfast",
    amount: index + 1,
    memo: `模板${index + 1}`,
  }));
  const templates = buildQuickTemplates([], categories, "MOP", PAYMENT_METHODS, custom);
  assert.equal(templates.length, 20);
  assert.equal(templates[19].memo, "模板20");
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
