// ============ GitHub Gist 同步 ============
// 使用 GitHub Gist API 作为云端备份，实现多端同步
// 用户需要提供：GitHub Personal Access Token 和 Gist ID
//
// 首次使用时，点击"创建新 Gist"按钮自动创建一个空 gist 并保存 ID
// 之后所有设备填入相同的 Gist ID + Token 即可实现同步

import { loadAll, saveAll, loadSettings, saveSettings } from './data.js';

const API_BASE = 'https://api.github.com';
const FILENAME = 'ledger-data.json';

// ============ 状态 ============
export let syncStatus = 'idle'; // idle | syncing | success | error
export let syncLastTime = null;

function setStatus(status) {
  syncStatus = status;
  document.dispatchEvent(new CustomEvent('sync-status', { detail: { status, time: syncLastTime } }));
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
      [FILENAME]: {
        content: JSON.stringify(loadAll(), null, 2)
      }
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
  saveSettings(settings);
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
        [FILENAME]: {
          content: JSON.stringify(loadAll(), null, 2)
        }
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

// ============ 下载（Pull） ============
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
      // Gist 文件为空，跳过
      setStatus('success');
      return false;
    }

    const remoteData = JSON.parse(file.content);
    // 简单的同步策略：remote 覆盖 local（因为 gist 已经包含完整数据）
    saveAll(remoteData);

    syncLastTime = new Date();
    setStatus('success');
    return true;
  } catch (err) {
    setStatus('error');
    throw err;
  }
}

// ============ 双向同步（先拉后推） ============
export async function sync() {
  try {
    await pullFromGist();
    await pushToGist();
    return true;
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
