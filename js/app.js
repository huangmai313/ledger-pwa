// ============ 预算管家 - 主应用 ============
import {
  getMonthKey, formatMonthLabel, shiftMonth, fmtMoney,
  getIncomesByMonth, getBudgetsByIncome, getReconcilesByBudget,
  getBudgetById, getReconcileById, loadAll,
  getMonthSummary,
  addIncome, updateIncome, deleteIncome,
  addBudget, updateBudget, deleteBudget,
  addReconcile, updateReconcile, deleteReconcile,
  loadSettings, saveSettings,
  getCategories, addCategory, deleteCategory, autoAddCategory
} from './data.js';
import { sync, createGist, isConfigured, syncStatus } from './gist.js';
import { renderCharts, renderBudgetProgress } from './chart.js';

// ============ 全局状态 ============
let currentMonth = getMonthKey();
let expandedIncome = null; // 当前展开的收入 ID
let expandedBudget = null; // 当前展开的预算 ID

// ============ 启动 ============
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  bindEvents();
  renderAll();
});

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('SW 注册失败', e);
    }
  }
}

// ============ 事件绑定 ============
function bindEvents() {
  // 月份切换
  document.getElementById('prevMonth').onclick = () => {
    currentMonth = shiftMonth(currentMonth, -1);
    expandedIncome = null; expandedBudget = null;
    renderAll();
  };
  document.getElementById('nextMonth').onclick = () => {
    currentMonth = shiftMonth(currentMonth, 1);
    expandedIncome = null; expandedBudget = null;
    renderAll();
  };
  document.getElementById('goToday').onclick = () => {
    currentMonth = getMonthKey();
    expandedIncome = null; expandedBudget = null;
    renderAll();
  };

  // Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('itemsPage').classList.toggle('active', page === 'items');
      document.getElementById('analysisPage').classList.toggle('active', page === 'analysis');
      if (page === 'analysis') renderAnalysis();
    };
  });

  // 浮动添加按钮 → 优先添加核销，其次预算，最后收入
  document.getElementById('fabAdd').onclick = () => {
    openAddMenu();
  };

  // 同步按钮
  document.getElementById('btnSync').onclick = async () => {
    if (!isConfigured()) {
      toast('请先在设置中配置同步');
      openSettings();
      return;
    }
    const btn = document.getElementById('btnSync');
    btn.classList.add('syncing');
    try {
      await sync();
      toast('同步成功 ✓');
    } catch (e) {
      toast('同步失败: ' + e.message);
    } finally {
      btn.classList.remove('syncing');
    }
  };

  // 设置按钮
  document.getElementById('btnSettings').onclick = () => openSettings();

  // 同步状态监听
  document.addEventListener('sync-status', (e) => {
    const btn = document.getElementById('btnSync');
    if (e.detail.status === 'syncing') btn.classList.add('syncing');
    else btn.classList.remove('syncing');
  });
}

// ============ 主渲染 ============
function renderAll() {
  renderMonthLabel();
  renderSummary();
  renderItems();
}

function renderMonthLabel() {
  document.getElementById('monthLabel').textContent = formatMonthLabel(currentMonth);
}

function renderSummary() {
  const s = getMonthSummary(currentMonth);
  document.getElementById('sumIncome').textContent = fmtMoney(s.totalIncome);
  document.getElementById('sumBudget').textContent = fmtMoney(s.totalBudget);
  document.getElementById('sumReconciled').textContent = fmtMoney(s.totalReconciled);
  document.getElementById('sumRemaining').textContent = fmtMoney(s.remaining);
}

// ============ 条目页渲染（三级结构） ============
function renderItems() {
  const container = document.getElementById('hierarchyList');
  const incomes = getIncomesByMonth(currentMonth);

  if (incomes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        <p>本月还没有任何记录</p>
        <p style="margin-top:6px;font-size:12px;">点击右下角 + 按钮开始</p>
      </div>`;
    return;
  }

  container.innerHTML = incomes.map(inc => renderIncomeCard(inc)).join('');

  // 绑定事件
  container.querySelectorAll('.level-income > .item-header').forEach(header => {
    header.onclick = (e) => {
      // 如果点击的是操作按钮，不触发展开
      if (e.target.closest('.item-actions')) return;
      expandedIncome = expandedIncome === header.dataset.id ? null : header.dataset.id;
      expandedBudget = null;
      renderItems();
    };
  });

  container.querySelectorAll('.action-edit').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const [level, id] = btn.dataset.target.split(':');
      if (level === 'income') openEditIncome(id);
      else if (level === 'budget') openEditBudget(id);
      else if (level === 'reconcile') openEditReconcile(id);
    };
  });

  container.querySelectorAll('.action-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const [level, id] = btn.dataset.target.split(':');
      if (level === 'income') confirmDeleteIncome(id);
      else if (level === 'budget') confirmDeleteBudget(id);
      else if (level === 'reconcile') confirmDeleteReconcile(id);
    };
  });

  container.querySelectorAll('.add-budget').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openAddBudget(btn.dataset.incomeId);
    };
  });

  container.querySelectorAll('.level-budget > .budget-header').forEach(header => {
    header.onclick = (e) => {
      if (e.target.closest('.item-actions')) return;
      expandedBudget = expandedBudget === header.dataset.id ? null : header.dataset.id;
      renderItems();
    };
  });

  container.querySelectorAll('.add-reconcile').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openAddReconcile(btn.dataset.budgetId);
    };
  });
}

function renderIncomeCard(inc) {
  const isExpanded = expandedIncome === inc.id;
  const budgets = getBudgetsByIncome(inc.id);
  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);

  let subHtml = '';
  if (isExpanded) {
    subHtml = `
      <div class="action-row">
        <button class="add-btn add-budget" data-income-id="${inc.id}">＋ 添加预算</button>
      </div>
      ${budgets.map(b => renderBudgetCard(b)).join('') || '<div style="padding:12px 16px;color:#9CA3AF;font-size:13px;">暂无预算，点击上方按钮添加</div>'}
    `;
  }

  return `
    <div class="level-income">
      <div class="item-header" data-id="${inc.id}">
        <div class="item-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div class="item-title">${escapeHtml(inc.name)}</div>
          <div class="item-meta">${inc.date || ''}${inc.note ? ' · ' + escapeHtml(inc.note) : ''}${budgetTotal > 0 ? ' · 已建预算 ' + fmtMoney(budgetTotal) : ''}</div>
        </div>
        <div>
          <div class="item-amount">+${fmtMoney(inc.amount)}</div>
          <div class="item-actions" style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px;">
            <button class="action-edit" data-target="income:${inc.id}" style="font-size:11px;color:#4F46E5;">修改</button>
            <button class="action-delete" data-target="income:${inc.id}" style="font-size:11px;color:#DC2626;">删除</button>
          </div>
        </div>
      </div>
      ${subHtml}
    </div>
  `;
}

function renderBudgetCard(b) {
  const isExpanded = expandedBudget === b.id;
  const reconciles = getReconcilesByBudget(b.id);
  const used = reconciles.reduce((s, r) => s + r.amount, 0);
  const progress = b.amount > 0 ? Math.min(100, (used / b.amount) * 100) : 0;

  let subHtml = '';
  if (isExpanded) {
    subHtml = `
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="progress-text"><span>已核销 ${fmtMoney(used)}</span><span>剩余 ${fmtMoney(b.amount - used)}</span></div>
      </div>
      <div style="padding:0 14px;">
        ${reconciles.map(r => renderReconcileRow(r)).join('') || '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">暂无核销记录</div>'}
      </div>
      <div class="action-row">
        <button class="add-btn add-reconcile" data-budget-id="${b.id}">＋ 添加核销</button>
      </div>
    `;
  }

  return `
    <div class="level-budget" style="position:relative;margin-top:10px;">
      <div class="budget-header" data-id="${b.id}">
        <div class="item-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.2"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div class="item-title">${escapeHtml(b.name)}</div>
        </div>
        <div style="text-align:right;">
          <div class="item-amount">${fmtMoney(b.amount)}</div>
          <div class="item-actions" style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px;">
            <button class="action-edit" data-target="budget:${b.id}" style="font-size:11px;color:#4F46E5;">修改</button>
            <button class="action-delete" data-target="budget:${b.id}" style="font-size:11px;color:#DC2626;">删除</button>
          </div>
        </div>
      </div>
      ${subHtml}
    </div>
  `;
}

function renderReconcileRow(r) {
  return `
    <div class="level-reconcile" style="margin-left:0;">
      <div class="reconcile-dot"></div>
      <div class="reconcile-info">
        <div class="reconcile-title">${escapeHtml(r.note || '(无备注)')}</div>
        <div class="reconcile-date">${r.date || ''}</div>
      </div>
      <div class="reconcile-amount">-${fmtMoney(r.amount)}</div>
      <div style="display:flex;gap:6px;flex-direction:column;margin-left:4px;">
        <button class="action-edit" data-target="reconcile:${r.id}" style="font-size:10px;color:#4F46E5;padding:0;">改</button>
        <button class="action-delete" data-target="reconcile:${r.id}" style="font-size:10px;color:#DC2626;padding:0;">删</button>
      </div>
    </div>
  `;
}

// ============ 分析页渲染 ============
function renderAnalysis() {
  const s = getMonthSummary(currentMonth);
  document.getElementById('statIncome').textContent = fmtMoney(s.totalIncome);
  document.getElementById('statExpense').textContent = fmtMoney(s.totalReconciled);
  document.getElementById('statBudget').textContent = s.budgetCount;
  document.getElementById('statSavings').textContent = fmtMoney(s.savings);

  renderCharts(s);
  renderBudgetProgress(s.budgetProgress);
}

// ============ 通用弹窗系统 ============
function openModal({ title, body, onClose, actions }) {
  const root = document.getElementById('modalRoot');
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" aria-label="关闭">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${actions ? `<div class="form-actions modal-actions">${actions}</div>` : ''}
    </div>
  `;
  root.appendChild(modal);

  const close = () => {
    modal.remove();
    if (onClose) onClose();
  };

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector('.modal-close').onclick = close;

  return { modal, close };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ============ 添加菜单（浮动按钮） ============
function openAddMenu() {
  const incomes = getIncomesByMonth(currentMonth);
  let body = '';

  if (incomes.length === 0) {
    body = `
      <p style="color:#6B7280;font-size:13px;margin-bottom:16px;">本月还没有收入，请先添加收入，然后才能建立预算和核销。</p>
      <button class="btn btn-primary" id="addIncomeBtn">添加收入</button>
    `;
  } else {
    const options = incomes.map(inc => {
      const budgets = getBudgetsByIncome(inc.id);
      return `
        <div style="margin-bottom:16px;">
          <div style="font-size:12px;color:#6B7280;margin-bottom:8px;">收入: ${escapeHtml(inc.name)}</div>
          ${budgets.length === 0 ? `
            <button class="btn btn-secondary addBudgetForIncome" data-id="${inc.id}" style="margin-bottom:8px;margin-top:4px;">+ 为此收入添加预算</button>
          ` : `
            ${budgets.map(b => `
              <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;">
                <div style="flex:1;font-size:13px;color:#374151;">▸ ${escapeHtml(b.name)} <span style="color:#9CA3AF;">(${fmtMoney(b.amount)})</span></div>
                <button class="btn btn-secondary addReconcileForBudget" data-id="${b.id}" style="padding:6px 10px;font-size:12px;">核销</button>
                <button class="btn btn-secondary addBudgetForIncome" data-id="${inc.id}" style="padding:6px 10px;font-size:12px;">加预算</button>
              </div>
            `).join('')}
          `}
        </div>
      `;
    }).join('');

    body = `
      <div style="margin-bottom:16px;">
        <button class="btn btn-primary" id="addIncomeBtn" style="width:auto;display:inline-block;padding:10px 16px;">＋ 新增收入</button>
      </div>
      ${options}
    `;
  }

  const { modal, close } = openModal({ title: '添加', body });

  modal.querySelector('#addIncomeBtn')?.addEventListener('click', () => {
    close(); openAddIncome();
  });
  modal.querySelectorAll('.addBudgetForIncome').forEach(btn => {
    btn.onclick = () => { close(); openAddBudget(btn.dataset.id); };
  });
  modal.querySelectorAll('.addReconcileForBudget').forEach(btn => {
    btn.onclick = () => { close(); openAddReconcile(btn.dataset.id); };
  });
}

// ============ 收入：新增 / 编辑 / 删除 ============
function openAddIncome() {
  openIncomeForm(null);
}
function openEditIncome(id) {
  const inc = getIncomesByMonth(currentMonth).find(x => x.id === id) || null;
  if (!inc) return;
  openIncomeForm(inc);
}
function openIncomeForm(data) {
  const isEdit = !!data;
  const d = data || { name: '', amount: '', date: new Date().toISOString().slice(0, 10), note: '' };

  const incomeCats = getCategories('income');
  const datalistId = 'dl_income';

  const body = `
    <div class="form-group">
      <label class="form-label">收入类别</label>
      <input class="form-input" id="f_name" list="${datalistId}" value="${escapeHtml(d.name)}" placeholder="选择或输入新类别" autocomplete="off">
      <datalist id="${datalistId}">${incomeCats.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
    </div>
    <div class="form-group">
      <label class="form-label">金额</label>
      <input class="form-input" id="f_amount" type="number" step="0.01" value="${d.amount}" placeholder="0.00">
    </div>
    <div class="form-group">
      <label class="form-label">日期</label>
      <input class="form-input" id="f_date" type="date" value="${d.date}">
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <textarea class="form-input form-textarea" id="f_note" placeholder="可选">${escapeHtml(d.note)}</textarea>
    </div>
  `;

  const actions = `
    <button class="btn btn-secondary" id="cancelBtn">取消</button>
    <button class="btn btn-primary" id="saveBtn">${isEdit ? '保存' : '添加'}</button>
  `;

  const { modal, close } = openModal({ title: isEdit ? '修改收入' : '新增收入', body, actions });

  modal.querySelector('#cancelBtn').onclick = close;
  modal.querySelector('#saveBtn').onclick = () => {
    const name = modal.querySelector('#f_name').value.trim();
    const amount = parseFloat(modal.querySelector('#f_amount').value);
    if (!name) return toast('请输入类别');
    if (!amount || amount <= 0) return toast('请输入有效金额');

    if (isEdit) {
      updateIncome(data.id, { name, amount, date: modal.querySelector('#f_date').value, note: modal.querySelector('#f_note').value.trim() });
    } else {
      addIncome({ name, amount, month: currentMonth, date: modal.querySelector('#f_date').value, note: modal.querySelector('#f_note').value.trim() });
    }
    autoAddCategory('income', name);
    toast(isEdit ? '已保存' : '已添加');
    close();
    renderAll();
  };
}

function confirmDeleteIncome(id) {
  openModal({
    title: '删除收入',
    body: `<p style="font-size:14px;color:#374151;">确定删除这条收入吗？<br><span style="color:#DC2626;font-size:12px;">该收入下的所有预算和核销也会一并删除。</span></p>`,
    actions: `
      <button class="btn btn-secondary" id="cancelBtn">取消</button>
      <button class="btn btn-danger" id="confirmBtn">删除</button>
    `
  });
  const modal = document.getElementById('modalRoot').lastElementChild;
  modal.querySelector('#cancelBtn').onclick = () => modal.remove();
  modal.querySelector('#confirmBtn').onclick = () => {
    deleteIncome(id);
    modal.remove();
    toast('已删除');
    renderAll();
  };
}

// ============ 预算：新增 / 编辑 / 删除 ============
function openAddBudget(incomeId) {
  openBudgetForm(null, incomeId);
}
function openEditBudget(id) {
  openBudgetForm(id);
}
function openBudgetForm(idOrData, incomeId) {
  // idOrData: 编辑时是 id (string)，新增时传 null；incomeId 是新增时用的父收入 id
  let data, parentIncomeId;

  if (typeof idOrData === 'string') {
    // 编辑模式
    data = getBudgetById(idOrData);
    if (!data) return;
    parentIncomeId = data.incomeId;
  } else {
    // 新增模式
    data = { name: '', amount: '', note: '' };
    parentIncomeId = incomeId;
  }

  const isEdit = !!data.id;
  const allIncomes = getIncomesByMonth(data.month || currentMonth);
  const budgetCats = getCategories('budget');
  const datalistId = 'dl_budget';

  const body = `
    <div class="form-group">
      <label class="form-label">归属收入</label>
      <select class="form-input form-select" id="f_income">
        ${allIncomes.map(i => `<option value="${i.id}" ${i.id === parentIncomeId ? 'selected' : ''}>${escapeHtml(i.name)} (${fmtMoney(i.amount)})</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">预算类别</label>
      <input class="form-input" id="f_name" list="${datalistId}" value="${escapeHtml(data.name)}" placeholder="选择或输入新类别" autocomplete="off">
      <datalist id="${datalistId}">${budgetCats.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
    </div>
    <div class="form-group">
      <label class="form-label">预算金额</label>
      <input class="form-input" id="f_amount" type="number" step="0.01" value="${data.amount || ''}" placeholder="0.00">
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <textarea class="form-input form-textarea" id="f_note" placeholder="可选">${escapeHtml(data.note)}</textarea>
    </div>
  `;

  const actions = `
    <button class="btn btn-secondary" id="cancelBtn">取消</button>
    <button class="btn btn-primary" id="saveBtn">${isEdit ? '保存' : '添加'}</button>
  `;

  const { modal, close } = openModal({ title: isEdit ? '修改预算' : '新增预算', body, actions });

  modal.querySelector('#cancelBtn').onclick = close;
  modal.querySelector('#saveBtn').onclick = () => {
    const name = modal.querySelector('#f_name').value.trim();
    const amount = parseFloat(modal.querySelector('#f_amount').value);
    const selectedIncomeId = modal.querySelector('#f_income').value;
    if (!name) return toast('请输入类别');
    if (!amount || amount <= 0) return toast('请输入有效金额');

    if (isEdit) {
      updateBudget(data.id, { name, amount, incomeId: selectedIncomeId, note: modal.querySelector('#f_note').value.trim() });
    } else {
      addBudget({ name, amount, incomeId: selectedIncomeId, month: currentMonth, note: modal.querySelector('#f_note').value.trim() });
    }
    autoAddCategory('budget', name);
    toast(isEdit ? '已保存' : '已添加');
    close();
    renderAll();
  };
}

function confirmDeleteBudget(id) {
  openModal({
    title: '删除预算',
    body: `<p style="font-size:14px;color:#374151;">确定删除这条预算吗？<br><span style="color:#DC2626;font-size:12px;">该预算下的所有核销也会一并删除。</span></p>`,
    actions: `
      <button class="btn btn-secondary" id="cancelBtn">取消</button>
      <button class="btn btn-danger" id="confirmBtn">删除</button>
    `
  });
  const modal = document.getElementById('modalRoot').lastElementChild;
  modal.querySelector('#cancelBtn').onclick = () => modal.remove();
  modal.querySelector('#confirmBtn').onclick = () => {
    deleteBudget(id);
    modal.remove();
    toast('已删除');
    renderAll();
  };
}

// ============ 核销：新增 / 编辑 / 删除 ============
function openAddReconcile(budgetId) {
  openReconcileForm(null, budgetId);
}
function openEditReconcile(id) {
  openReconcileForm(id);
}
function openReconcileForm(idOrData, budgetId) {
  let data, parentBudgetId;

  if (typeof idOrData === 'string') {
    data = getReconcileById(idOrData);
    if (!data) return;
    parentBudgetId = data.budgetId;
  } else {
    data = { amount: '', note: '', date: new Date().toISOString().slice(0, 10) };
    parentBudgetId = budgetId;
  }

  const isEdit = !!data.id;

  // 获取当前月所有预算（带收入名称）
  const all = loadAll();
  const budgets = (all.budgets || []).filter(b => b.month === (data.month || currentMonth));
  const incomes = all.incomes || [];

  const body = `
    <div class="form-group">
      <label class="form-label">归属预算</label>
      <select class="form-input form-select" id="f_budget">
        ${budgets.map(b => {
          const inc = incomes.find(i => i.id === b.incomeId);
          return `<option value="${b.id}" ${b.id === parentBudgetId ? 'selected' : ''}>${escapeHtml(b.name)} (${inc ? escapeHtml(inc.name) + ' - ' : ''}${fmtMoney(b.amount)})</option>`;
        }).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">核销金额</label>
      <input class="form-input" id="f_amount" type="number" step="0.01" value="${data.amount || ''}" placeholder="0.00">
    </div>
    <div class="form-group">
      <label class="form-label">日期</label>
      <input class="form-input" id="f_date" type="date" value="${data.date}">
    </div>
    <div class="form-group">
      <label class="form-label">备注 / 说明</label>
      <textarea class="form-input form-textarea" id="f_note" placeholder="例如：午餐、打车">${escapeHtml(data.note)}</textarea>
    </div>
  `;

  const actions = `
    <button class="btn btn-secondary" id="cancelBtn">取消</button>
    <button class="btn btn-primary" id="saveBtn">${isEdit ? '保存' : '添加'}</button>
  `;

  const { modal, close } = openModal({ title: isEdit ? '修改核销' : '新增核销', body, actions });

  modal.querySelector('#cancelBtn').onclick = close;
  modal.querySelector('#saveBtn').onclick = () => {
    const amount = parseFloat(modal.querySelector('#f_amount').value);
    const selectedBudgetId = modal.querySelector('#f_budget').value;
    if (!amount || amount <= 0) return toast('请输入有效金额');

    if (isEdit) {
      updateReconcile(data.id, {
        budgetId: selectedBudgetId,
        amount,
        date: modal.querySelector('#f_date').value,
        note: modal.querySelector('#f_note').value.trim()
      });
      toast('已保存');
    } else {
      addReconcile({
        budgetId: selectedBudgetId,
        amount,
        date: modal.querySelector('#f_date').value,
        note: modal.querySelector('#f_note').value.trim()
      });
      toast('已添加');
    }
    close();
    renderAll();
  };
}

function confirmDeleteReconcile(id) {
  openModal({
    title: '删除核销',
    body: `<p style="font-size:14px;color:#374151;">确定删除这条核销吗？</p>`,
    actions: `
      <button class="btn btn-secondary" id="cancelBtn">取消</button>
      <button class="btn btn-danger" id="confirmBtn">删除</button>
    `
  });
  const modal = document.getElementById('modalRoot').lastElementChild;
  modal.querySelector('#cancelBtn').onclick = () => modal.remove();
  modal.querySelector('#confirmBtn').onclick = () => {
    deleteReconcile(id);
    modal.remove();
    toast('已删除');
    renderAll();
  };
}

// ============ 设置 ============
function openSettings() {
  const s = loadSettings();
  const configured = isConfigured();

  const incomeCats = getCategories('income');
  const budgetCats = getCategories('budget');

  const categorySectionHtml = (title, type, cats) => `
    <div style="margin-bottom:14px;">
      <div style="font-size:13px;font-weight:500;color:#374151;margin-bottom:8px;">${title}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;" data-cat-type="${type}">
        ${cats.map(c => `
          <span class="cat-chip" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#EEF2FF;color:#4F46E5;border-radius:14px;font-size:12px;">
            ${escapeHtml(c)}
            <button class="cat-del" data-type="${type}" data-name="${escapeHtml(c)}" style="font-size:14px;line-height:1;color:#9CA3AF;padding:0 2px;">×</button>
          </span>
        `).join('')}
      </div>
      <div style="display:flex;gap:6px;">
        <input class="form-input cat-input" data-type="${type}" placeholder="添加新类别..." style="flex:1;padding:8px 12px;font-size:13px;">
        <button class="btn btn-primary cat-add" data-type="${type}" style="padding:8px 14px;font-size:13px;flex:none;">+</button>
      </div>
    </div>
  `;

  const body = `
    <div class="settings-section">
      <h3>类别管理</h3>
      <div class="settings-card">
        ${categorySectionHtml('收入类别', 'income', incomeCats)}
        ${categorySectionHtml('预算类别', 'budget', budgetCats)}
      </div>
    </div>

    <div class="settings-section">
      <h3>云同步（GitHub Gist）</h3>
      <div class="settings-card">
        <div class="settings-item">
          <span class="settings-label">同步状态</span>
          <span class="settings-status ${configured ? 'online' : 'offline'}">${configured ? '已配置' : '未配置'}</span>
        </div>
        <div class="settings-item" style="flex-direction:column;align-items:stretch;gap:6px;">
          <label class="form-label" style="margin-bottom:0;">GitHub Token</label>
          <input class="form-input" id="s_token" type="password" value="${escapeHtml(s.githubToken)}" placeholder="ghp_xxx...">
        </div>
        <div class="settings-item" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:12px;">
          <label class="form-label" style="margin-bottom:0;">Gist ID</label>
          <input class="form-input" id="s_gist" value="${escapeHtml(s.gistId)}" placeholder="留空则自动创建">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-secondary" id="s_create" style="flex:1;">创建新 Gist</button>
          <button class="btn btn-primary" id="s_save" style="flex:1;">保存并同步</button>
        </div>
        <div style="margin-top:10px;font-size:11px;color:#9CA3AF;line-height:1.5;">
          👉 <a href="https://github.com/settings/tokens/new?scopes=gist&description=Ledger-PWA" target="_blank">点此创建 Token</a>，只需勾选 gist 权限即可。
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>数据</h3>
      <div class="settings-card">
        <div class="settings-item">
          <span class="settings-label">导出数据</span>
          <button class="btn btn-secondary" id="s_export" style="padding:6px 12px;font-size:12px;">导出 JSON</button>
        </div>
        <div class="settings-item">
          <span class="settings-label">导入数据</span>
          <button class="btn btn-secondary" id="s_import" style="padding:6px 12px;font-size:12px;">导入 JSON</button>
          <input type="file" id="s_import_file" accept="application/json" style="display:none;">
        </div>
        <div class="settings-item">
          <span class="settings-label" style="color:#DC2626;">清空本地数据</span>
          <button class="btn btn-danger" id="s_clear" style="padding:6px 12px;font-size:12px;">清空</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>关于</h3>
      <div class="settings-card">
        <div class="settings-item"><span class="settings-label">版本</span><span class="settings-value">v1.0.0</span></div>
        <div class="settings-item"><span class="settings-label">层级结构</span><span class="settings-value">收入 → 预算 → 核销</span></div>
      </div>
    </div>
  `;

  const { modal, close } = openModal({ title: '设置', body });

  // 类别管理事件
  modal.querySelectorAll('.cat-del').forEach(btn => {
    btn.onclick = () => {
      deleteCategory(btn.dataset.type, btn.dataset.name);
      // 重新渲染类别区域
      const type = btn.dataset.type;
      const container = modal.querySelector(`[data-cat-type="${type}"]`);
      const cats = getCategories(type);
      container.innerHTML = cats.map(c => `
        <span class="cat-chip" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#EEF2FF;color:#4F46E5;border-radius:14px;font-size:12px;">
          ${escapeHtml(c)}
          <button class="cat-del" data-type="${type}" data-name="${escapeHtml(c)}" style="font-size:14px;line-height:1;color:#9CA3AF;padding:0 2px;">×</button>
        </span>
      `).join('');
      // 重新绑定删除按钮
      modal.querySelectorAll('.cat-del').forEach(b => {
        b.onclick = () => { deleteCategory(b.dataset.type, b.dataset.name); openSettings(); modal.remove(); };
      });
    };
  });

  const bindAddCategory = (input, btn) => {
    const type = btn.dataset.type;
    const doAdd = () => {
      const val = input.value.trim();
      if (!val) return;
      addCategory(type, val);
      input.value = '';
      // 重新打开设置
      modal.remove();
      openSettings();
    };
    btn.onclick = doAdd;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  };
  modal.querySelectorAll('.cat-add').forEach(btn => {
    const input = modal.querySelector(`.cat-input[data-type="${btn.dataset.type}"]`);
    bindAddCategory(input, btn);
  });

  modal.querySelector('#s_save').onclick = async () => {
    const token = modal.querySelector('#s_token').value.trim();
    const gistId = modal.querySelector('#s_gist').value.trim();
    saveSettings({ githubToken: token, gistId });
    toast('设置已保存');
    if (token && gistId) {
      try {
        await sync();
        toast('同步成功 ✓');
      } catch (e) {
        toast('同步失败: ' + e.message);
      }
    }
  };

  modal.querySelector('#s_create').onclick = async () => {
    const token = modal.querySelector('#s_token').value.trim();
    if (!token) return toast('请先填写 GitHub Token');
    saveSettings({ githubToken: token, gistId: '' });
    try {
      const id = await createGist();
      modal.querySelector('#s_gist').value = id;
      toast('Gist 创建成功 ✓');
    } catch (e) {
      toast('创建失败: ' + e.message);
    }
  };

  modal.querySelector('#s_export').onclick = () => {
    const data = JSON.parse(localStorage.getItem('ledger-pwa-data') || '{}');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  modal.querySelector('#s_import').onclick = () => modal.querySelector('#s_import_file').click();
  modal.querySelector('#s_import_file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        localStorage.setItem('ledger-pwa-data', JSON.stringify(obj));
        toast('导入成功 ✓');
        close();
        renderAll();
      } catch { toast('文件格式错误'); }
    };
    reader.readAsText(file);
  };

  modal.querySelector('#s_clear').onclick = () => {
    openModal({
      title: '清空数据',
      body: '<p style="color:#DC2626;font-size:14px;">⚠️ 确定要清空所有本地数据吗？此操作不可恢复！</p>',
      actions: `<button class="btn btn-secondary" id="c_cancel">取消</button><button class="btn btn-danger" id="c_ok">确定清空</button>`
    });
    const confirmModal = document.getElementById('modalRoot').lastElementChild;
    confirmModal.querySelector('#c_cancel').onclick = () => confirmModal.remove();
    confirmModal.querySelector('#c_ok').onclick = () => {
      localStorage.removeItem('ledger-pwa-data');
      confirmModal.remove();
      close();
      toast('已清空');
      renderAll();
    };
  };
}

// ============ Toast ============
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}
