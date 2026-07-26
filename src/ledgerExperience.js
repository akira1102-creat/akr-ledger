export const PAYMENT_METHODS = [
  { id: "octopus", label: "八達通", icon: "🐙" },
  { id: "payme", label: "PayMe", icon: "🅿️" },
  { id: "fps", label: "轉數快", icon: "⚡" },
  { id: "cash", label: "現金", icon: "💵" },
  { id: "credit_card", label: "信用卡", icon: "💳" },
];

const FALLBACK_TEMPLATES = [
  { type: "expense", category: "breakfast", amount: 32, paymentMethod: "octopus", memo: "早餐" },
  { type: "expense", category: "transit", amount: 6, paymentMethod: "octopus", memo: "交通" },
  { type: "expense", category: "drink", amount: 28, paymentMethod: "cash", memo: "飲品" },
];

export function buildQuickTemplates(entries = [], categories = [], baseCurrency = "MOP") {
  const categoryIds = new Set(categories.map(category => category.id));
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
    templates.push({ ...fallback, currency: baseCurrency });
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
