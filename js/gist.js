// ============ GitHub Gist 同步 ============
// 使用 GitHub Gist API 作为云端备份，实现多端同步
// 同步策略：pull 时按 ID 双向合并（同 ID 取 updatedAt 更大者），绝不直接覆盖

import { loadAll, saveAll, loadSettings, normalizeData } from './data.js';

const API_BASE = 'https://api.github.com';
const FILENAME = 'ledger-data.json';

// ============ 状态 ============
export let syncStatus = 'idle';
export let syncLastTime = null;

function setStatus(status) {
  syncStatus = status;
  document.dispatchEvent(new CustomEvent('sync-status', { detail: { status, time: syncLastTime } }));
}

// ============ 合并函数 ============
// 双向合并：数组按 id 去重；类别用墓碑机制防止已删类别复活
function mergeData(local, remote) {
  const merged = {};
  merged.incomes = mergeArray(local.incomes || [], remote.incomes || []);
  merged.budgets = mergeArray(local.budgets || [], remote.budgets || []);
  merged.reconciles = mergeArray(local.reconciles || [], remote.reconciles || []);
  // 先合并墓碑（双方的删除记录都要保留，避免被重新加回来）
  merged.deletedCategories = mergeTombstones(
    local.deletedCategories || { income: [], budget: [] },
    remote.deletedCategories || { income: [], budget: [] }
  );
  // categories：先并集，再用墓碑过滤掉已删的类别
  merged.categories = mergeCategoriesWithTombstone(
    local.categories, remote.categories, merged.deletedCategories
  );
  return merged;
}

function mergeArray(localArr, remoteArr) {
  const map = new Map();
  for (const item of localArr) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of remoteArr) {
    if (!item || !item.id) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      const localTime = existing.updatedAt || existing.createdAt || 0;
      const remoteTime = item.updatedAt || item.createdAt || 0;
      if (remoteTime >= localTime) map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

// 合并墓碑：同名墓碑取 deletedAt 更近者
function mergeTombstones(local, remote) {
  const out = {};
  for (const type of ['income', 'budget']) {
    const map = new Map();
    for (const t of (local?.[type] || [])) {
      if (!t || !t.name) continue;
      map.set(t.name, t);
    }
    for (const t of (remote?.[type] || [])) {
      if (!t || !t.name) continue;
      const existing = map.get(t.name);
      if (!existing || (t.deletedAt || 0) > (existing.deletedAt || 0)) {
        map.set(t.name, t);
      }
    }
    out[type] = Array.from(map.values());
  }
  return out;
}

// 并集 → 用墓碑过滤
function mergeCategoriesWithTombstone(localCats, remoteCats, tombstones) {
  const out = {};
  for (const type of ['income', 'budget']) {
    const set = new Set();
    (localCats?.[type] || []).forEach(c => set.add(c));
    (remoteCats?.[type] || []).forEach(c => set.add(c));
    // 用墓碑过滤：墓碑里有的类别 = 被删了
    const deletedNames = new Set((tombstones?.[type] || []).map(t => t.name));
    out[type] = Array.from(set).filter(c => !deletedNames.has(c));
  }
  return out;
}

// ============ 创建新 Gist ============
export async function createGist(description = '预算管家数据同步') {
  const settings = loadSettings();
  if (!settings.githubToken) {
    throw new Error('请先在设置中填写 GitHub Token');
  }

  const body = {
    description,
    public: false,
    files: {
      [FILENAME]: { content: JSON.stringify(loadAll(), null, 2) }
    }
  };

  const res = await fetch(`${API_BASE}/gists`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${settings.githubToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`创建 Gist 失败: ${err.message || res.status}`);
  }

  const gist = await res.json();
  settings.gistId = gist.id;
  // 注意：此处不能直接 import saveSettings，会循环引用 —— 用 localStorage
  localStorage.setItem('ledger-pwa-settings', JSON.stringify(settings));
  return gist.id;
}

// ============ 上传（Push） ============
export async function pushToGist() {
  const settings = loadSettings();
  if (!settings.gistId || !settings.githubToken) {
    throw new Error('请先配置 Gist ID 和 GitHub Token');
  }

  setStatus('syncing');
  try {
    const body = {
      files: {
        [FILENAME]: { content: JSON.stringify(loadAll(), null, 2) }
      }
    };

    const res = await fetch(`${API_BASE}/gists/${settings.gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${settings.githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`上传失败: ${err.message || res.status}`);
    }

    syncLastTime = new Date();
    setStatus('success');
    return true;
  } catch (err) {
    setStatus('error');
    throw err;
  }
}

// ============ 下载并合并（Pull + Merge） ============
export async function pullFromGist() {
  const settings = loadSettings();
  if (!settings.gistId || !settings.githubToken) {
    throw new Error('请先配置 Gist ID 和 GitHub Token');
  }

  setStatus('syncing');
  try {
    const res = await fetch(`${API_BASE}/gists/${settings.gistId}`, {
      headers: {
        'Authorization': `token ${settings.githubToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`下载失败: ${err.message || res.status}`);
    }

    const gist = await res.json();
    const file = gist.files[FILENAME];

    if (!file || !file.content) {
      // Gist 文件为空，跳过下载，本地数据保留不动
      setStatus('success');
      return false;
    }

    let remoteData;
    try {
      remoteData = JSON.parse(file.content);
    } catch {
      // 远程数据格式错误，跳过
      setStatus('success');
      return false;
    }

    // 规范化远程数据（补齐缺失字段如 categories，避免合并时漏字段）
    remoteData = normalizeData(remoteData);

    // 关键修复：按 ID 合并，而不是直接覆盖！
    const localData = loadAll();
    const merged = mergeData(localData, remoteData);
    saveAll(merged);

    syncLastTime = new Date();
    setStatus('success');
    return true;
  } catch (err) {
    setStatus('error');
    throw err;
  }
}

// ============ 双向同步 ============
// 流程：pull+merge → push 合并结果
export async function sync() {
  try {
    // ===== 关键：先 push 再 pull =====
    // 原因：如果本地删了一条，必须先把"不含这条的完整数据"推到远程，
    // 这样后续 pull 就不会把远程那条 merge 回来（复活 bug）
    await pushToGist();
    // 再 pull 远程可能有的他人新增，按 ID 合并
    const pulled = await pullFromGist();
    // pull 过程中 saveAll 了 merge 后的本地数据，再 push 一次确保远程最终一致
    await pushToGist();
    return pulled;
  } catch (err) {
    console.error('同步失败:', err);
    throw err;
  }
}

// ============ 检查配置 ============
export function isConfigured() {
  const s = loadSettings();
  return !!(s.gistId && s.githubToken);
}
