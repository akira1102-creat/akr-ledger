export const PAYMENT_METHODS = [
  { id: "octopus", label: "八達通", icon: "🐙" },
  { id: "payme", label: "PayMe", icon: "🅿️" },
  { id: "fps", label: "轉數快", icon: "⚡" },
  { id: "cash", label: "現金", icon: "💵" },
  { id: "credit_card", label: "信用卡", icon: "💳" },
];

export const MAX_QUICK_TEMPLATES = 20;
export const HOME_QUICK_TEMPLATE_LIMIT = 5;

export function getQuickTemplateGridClass(templateCount, expanded = false) {
  const count = Number(templateCount);
  if (expanded || !Number.isFinite(count) || count <= 3) return "";
  return count === 4 ? "quick-template-grid-compact-4" : "quick-template-grid-compact-5";
}

export const DEFAULT_ENTRY_SECTION_ORDER = ["payment", "category", "date", "note"];

export const ENTRY_SECTION_IDS = [...DEFAULT_ENTRY_SECTION_ORDER];
export const DEFAULT_ENTRY_SECTION_VISIBILITY = Object.fromEntries(
  ENTRY_SECTION_IDS.map(id => [id, true]),
);

export function normalizeEntrySectionVisibility(visibility) {
  return ENTRY_SECTION_IDS.reduce((result, id) => {
    result[id] = typeof visibility?.[id] === "boolean"
      ? visibility[id]
      : DEFAULT_ENTRY_SECTION_VISIBILITY[id];
    return result;
  }, {});
}

export function incrementCategoryUsage(usage, categoryId) {
  if (!categoryId) return { ...(usage || {}) };
  const current = Number(usage?.[categoryId]);
  return {
    ...(usage || {}),
    [categoryId]: Number.isFinite(current) && current >= 0 ? current + 1 : 1,
  };
}

export function buildCategoryUsageFromEntries(entries = []) {
  return entries.reduce((usage, entry) => {
    if (!entry?.category || !["expense", "income"].includes(entry.type)) return usage;
    return {
      ...usage,
      [entry.type]: incrementCategoryUsage(usage[entry.type], entry.category),
    };
  }, { expense: {}, income: {} });
}

export function getMostUsedCategories(categories = [], usage = {}, limit = 10) {
  const parentIds = new Set(
    categories.filter(category => category?.parentId).map(category => category.parentId),
  );
  const candidates = categories.filter(
    category => category && (category.parentId || !parentIds.has(category.id)),
  );
  const max = Math.max(0, Math.trunc(Number(limit) || 0));
  return candidates
    .map((category, index) => ({
      category,
      index,
      count: Number.isFinite(Number(usage?.[category.id])) ? Number(usage[category.id]) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, max)
    .map(item => item.category);
}

export function normalizeEntrySectionOrder(order) {
  const expanded = Array.isArray(order)
    ? order.flatMap(id => id === "details" ? ["date", "note"] : [id])
    : [];
  const valid = expanded.filter(
    (id, index) => DEFAULT_ENTRY_SECTION_ORDER.includes(id) && expanded.indexOf(id) === index,
  );
  return [...valid, ...DEFAULT_ENTRY_SECTION_ORDER.filter(id => !valid.includes(id))];
}

export function reorderEntrySections(order, from, to) {
  const normalized = normalizeEntrySectionOrder(order);
  if (from === to || from < 0 || to < 0 || from >= normalized.length || to >= normalized.length) return normalized;
  const next = [...normalized];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const FALLBACK_TEMPLATES = [
  { type: "expense", category: "breakfast", amount: 32, paymentMethod: "octopus", memo: "早餐" },
  { type: "expense", category: "transit", amount: 6, paymentMethod: "octopus", memo: "交通" },
  { type: "expense", category: "drink", amount: 28, paymentMethod: "cash", memo: "飲品" },
];

export function buildQuickTemplates(entries = [], categories = [], baseCurrency = "MOP", paymentMethods = PAYMENT_METHODS, customTemplates = null) {
  const categoryIds = new Set(categories.map(category => category.id));
  const paymentMethodIds = new Set(paymentMethods.map(method => method.id));

  if (Array.isArray(customTemplates) && customTemplates.length > 0) {
    const custom = customTemplates
      .slice(0, MAX_QUICK_TEMPLATES)
      .map(template => {
        const amount = Number(template?.amount);
        if (!template || !categoryIds.has(template.category) || !Number.isFinite(amount) || amount <= 0) return null;
        return {
          type: "expense",
          category: template.category,
          amount,
          currency: template.currency || baseCurrency,
          paymentMethod: paymentMethodIds.has(template.paymentMethod) ? template.paymentMethod : "",
          memo: String(template.memo || "").trim(),
        };
      })
      .filter(Boolean);
    if (custom.length > 0) return custom;
  }

  const seen = new Set();
  const templates = [];
  const candidates = [...entries]
    .filter(entry => entry?.type === "expense" && Number(entry.amount) > 0 && categoryIds.has(entry.category))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  for (const entry of candidates) {
    const key = `${entry.category}|${entry.paymentMethod || ""}|${entry.memo || ""}|${entry.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    templates.push({
      type: "expense",
      category: entry.category,
      amount: Number(entry.amount),
      currency: entry.currency || baseCurrency,
      paymentMethod: entry.paymentMethod || "",
      memo: entry.memo || "",
    });
    if (templates.length === 3) return templates;
  }

  for (const fallback of FALLBACK_TEMPLATES) {
    if (!categoryIds.has(fallback.category)) continue;
    const key = `${fallback.category}|${fallback.paymentMethod}|${fallback.memo}|${fallback.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    templates.push({
      ...fallback,
      currency: baseCurrency,
      paymentMethod: paymentMethodIds.has(fallback.paymentMethod) ? fallback.paymentMethod : "",
    });
    if (templates.length === 3) break;
  }
  return templates;
}

const startOfWeek = (date, weekStart) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay();
  result.setDate(result.getDate() - (weekStart === "sun" ? day : (day + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
};

const entryDate = value => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
};

export function getWeeklyInsight(entries = [], {
  today = new Date(),
  weekStart = "mon",
  toBase = entry => Number(entry.amount) || 0,
} = {}) {
  const currentStart = startOfWeek(today, weekStart);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - 7);
  const nextStart = new Date(currentStart);
  nextStart.setDate(nextStart.getDate() + 7);

  let current = 0;
  let previous = 0;
  for (const entry of entries) {
    if (entry?.type !== "expense") continue;
    const date = entryDate(entry.date);
    if (!date) continue;
    const amount = toBase(entry);
    if (date >= currentStart && date < nextStart) current += amount;
    else if (date >= previousStart && date < currentStart) previous += amount;
  }

  if (current === 0 && previous === 0) {
    return { tone: "neutral", current, previous, text: "記低第一筆，就可以開始睇每週變化" };
  }
  if (previous === 0) {
    return { tone: "neutral", current, previous, text: "今週已開始建立你嘅消費節奏" };
  }

  const percent = Math.round(Math.abs(current - previous) / previous * 100);
  if (percent < 5) {
    return { tone: "neutral", current, previous, percent, text: "今週開支同上週大致相若" };
  }
  if (current < previous) {
    return { tone: "positive", current, previous, percent, text: `今週比上週少用 ${percent}%` };
  }
  return { tone: "warning", current, previous, percent, text: `今週比上週多用 ${percent}%` };
}
