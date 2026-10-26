// ============ 数据模型 & 本地存储 ============
// 三级数据结构：
// Income（收入）→ Budget（预算）→ Reconcile（核销）
// 每条记录都带 month 字段（格式 YYYY-MM），便于按月查询

const STORAGE_KEY = 'ledger-pwa-data';
const SETTINGS_KEY = 'ledger-pwa-settings';

// ============ ID 生成 ============
export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ============ 月份工具 ============
export function getMonthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
export function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  return `${y} 年 ${parseInt(m)} 月`;
}
export function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return getMonthKey(d);
}

// ============ 数据读取 ============
function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveRaw(obj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

// 默认类别
const DEFAULT_INCOME_CATS = ['工资', '奖金', '兼职', '投资收益', '红包', '其他'];
const DEFAULT_BUDGET_CATS = ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '通讯', '日常', '其他'];

function ensureStructure(raw) {
  if (!raw) raw = {};
  if (!raw.incomes) raw.incomes = [];
  if (!raw.budgets) raw.budgets = [];
  if (!raw.reconciles) raw.reconciles = [];
  if (!raw.categories) raw.categories = { income: [...DEFAULT_INCOME_CATS], budget: [...DEFAULT_BUDGET_CATS] };
  else {
    if (!raw.categories.income) raw.categories.income = [...DEFAULT_INCOME_CATS];
    if (!raw.categories.budget) raw.categories.budget = [...DEFAULT_BUDGET_CATS];
  }
  return raw;
}

export function loadAll() {
  return ensureStructure(loadRaw());
}
export function saveAll(data) {
  saveRaw(data);
}

// ============ 设置 ============
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { gistId: '', githubToken: '' };
  } catch { return { gistId: '', githubToken: '' }; }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ============ 收入（一级） ============
export function addIncome({ name, amount, month, note = '', date = new Date().toISOString().slice(0, 10) }) {
  const data = loadAll();
  const item = {
    id: genId(),
    name,
    amount: parseFloat(amount) || 0,
    month,
    note,
    date,
    createdAt: Date.now()
  };
  data.incomes.push(item);
  saveAll(data);
  return item;
}
export function updateIncome(id, patch) {
  const data = loadAll();
  const i = data.incomes.findIndex(x => x.id === id);
  if (i >= 0) {
    data.incomes[i] = { ...data.incomes[i], ...patch };
    saveAll(data);
    return data.incomes[i];
  }
  return null;
}
export function deleteIncome(id) {
  const data = loadAll();
  data.incomes = data.incomes.filter(x => x.id !== id);
  // 级联删除子项
  data.budgets = data.budgets.filter(b => b.incomeId !== id);
  const budgetIds = data.budgets.map(b => b.id);
  data.reconciles = data.reconciles.filter(r => !budgetIds.includes(r.budgetId));
  saveAll(data);
}
export function getIncomesByMonth(month) {
  return loadAll().incomes.filter(x => x.month === month).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
export function getIncomeById(id) {
  return loadAll().incomes.find(x => x.id === id);
}

// ============ 预算（二级，归属收入） ============
export function addBudget({ name, amount, incomeId, month, note = '' }) {
  const data = loadAll();
  const item = {
    id: genId(),
    name,
    amount: parseFloat(amount) || 0,
    incomeId,
    month,
    note,
    createdAt: Date.now()
  };
  data.budgets.push(item);
  saveAll(data);
  return item;
}
export function updateBudget(id, patch) {
  const data = loadAll();
  const i = data.budgets.findIndex(x => x.id === id);
  if (i >= 0) {
    data.budgets[i] = { ...data.budgets[i], ...patch };
    saveAll(data);
    return data.budgets[i];
  }
  return null;
}
export function deleteBudget(id) {
  const data = loadAll();
  data.budgets = data.budgets.filter(x => x.id !== id);
  data.reconciles = data.reconciles.filter(r => r.budgetId !== id);
  saveAll(data);
}
export function getBudgetsByIncome(incomeId) {
  return loadAll().budgets.filter(x => x.incomeId === incomeId);
}
export function getBudgetById(id) {
  return loadAll().budgets.find(x => x.id === id);
}

// ============ 核销（三级，归属预算） ============
export function addReconcile({ budgetId, amount, note = '', date = new Date().toISOString().slice(0, 10) }) {
  const data = loadAll();
  const budget = data.budgets.find(b => b.id === budgetId);
  const item = {
    id: genId(),
    budgetId,
    amount: parseFloat(amount) || 0,
    note,
    date,
    month: budget ? budget.month : getMonthKey(),
    createdAt: Date.now()
  };
  data.reconciles.push(item);
  saveAll(data);
  return item;
}
export function updateReconcile(id, patch) {
  const data = loadAll();
  const i = data.reconciles.findIndex(x => x.id === id);
  if (i >= 0) {
    data.reconciles[i] = { ...data.reconciles[i], ...patch };
    saveAll(data);
    return data.reconciles[i];
  }
  return null;
}
export function deleteReconcile(id) {
  const data = loadAll();
  data.reconciles = data.reconciles.filter(x => x.id !== id);
  saveAll(data);
}
export function getReconcilesByBudget(budgetId) {
  return loadAll().reconciles.filter(x => x.budgetId === budgetId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
export function getReconcileById(id) {
  return loadAll().reconciles.find(x => x.id === id);
}

// ============ 月度汇总 ============
export function getMonthSummary(month) {
  const data = loadAll();
  const incomes = data.incomes.filter(x => x.month === month);
  const budgets = data.budgets.filter(x => x.month === month);
  const reconciles = data.reconciles.filter(x => x.month === month);

  const totalIncome = incomes.reduce((s, x) => s + x.amount, 0);
  const totalBudget = budgets.reduce((s, x) => s + x.amount, 0);
  const totalReconciled = reconciles.reduce((s, x) => s + x.amount, 0);
  const remaining = totalBudget - totalReconciled;

  // 每个预算的核销进度
  const budgetProgress = budgets.map(b => {
    const recs = reconciles.filter(r => r.budgetId === b.id);
    const used = recs.reduce((s, r) => s + r.amount, 0);
    return { ...b, used, progress: b.amount > 0 ? Math.min(100, (used / b.amount) * 100) : 0, reconcileCount: recs.length };
  });

  return {
    totalIncome,
    totalBudget,
    totalReconciled,
    remaining,
    savings: totalIncome - totalReconciled,
    incomeCount: incomes.length,
    budgetCount: budgets.length,
    reconcileCount: reconciles.length,
    budgetProgress
  };
}

// ============ 格式化 ============
export function fmtMoney(n) {
  const v = Number(n) || 0;
  return '¥' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ============ 类别管理 ============
// type: 'income' | 'budget'
export function getCategories(type) {
  return loadAll().categories[type] || [];
}
export function isInCategory(type, name) {
  const cats = getCategories(type);
  return cats.includes(name);
}
export function addCategory(type, name) {
  name = name.trim();
  if (!name) return false;
  const data = loadAll();
  if (!data.categories[type].includes(name)) {
    data.categories[type].push(name);
    saveAll(data);
  }
  return true;
}
export function deleteCategory(type, name) {
  const data = loadAll();
  data.categories[type] = data.categories[type].filter(c => c !== name);
  saveAll(data);
}
// 自动把新类别加入 categories（保存时调用）
export function autoAddCategory(type, name) {
  const cats = getCategories(type);
  if (name && !cats.includes(name)) {
    addCategory(type, name);
  }
}
