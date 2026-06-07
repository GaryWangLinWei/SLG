const API_BASE = '';
const PAGE_SIZE = 10;
let adminKey = localStorage.getItem('adminKey');
let codesPage = 1;
let devicesPage = 1;

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const adminKeyInput = document.getElementById('adminKey');
const loginError = document.getElementById('loginError');

function formatDate(timestamp) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN');
}

function renderPagination(containerId, currentPage, totalItems, loadFn) {
  const container = document.getElementById(containerId);
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  html += `<button ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">上一页</button>`;

  // 显示页码：总是显示第 1 页、最后一页，当前页附近 ±2
  const pages = new Set();
  pages.add(1);
  pages.add(totalPages);
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
    pages.add(i);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);

  let last = 0;
  for (const p of sorted) {
    if (p - last > 1) {
      html += '<span class="page-info">…</span>';
    }
    html += `<button class="${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    last = p;
  }

  html += `<button ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">下一页</button>`;
  html += `<span class="page-info">共 ${totalItems} 条</span>`;

  container.innerHTML = html;
  container.querySelectorAll('button[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      loadFn(page);
    });
  });
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Key': adminKey,
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }

  return data;
}

async function loadStats() {
  try {
    const data = await apiRequest('/api/admin/stats');
    document.getElementById('totalCodes').textContent = data.stats.total;
    document.getElementById('unusedCodes').textContent = data.stats.unused;
    document.getElementById('usedCodes').textContent = data.stats.used;
    document.getElementById('revokedCodes').textContent = data.stats.revoked;
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

function renderStatus(status) {
  const map = { unused: '未使用', used: '已使用', revoked: '已吊销', exported: '已导出' };
  return map[status] || status;
}

async function loadCodes(page = 1) {
  try {
    codesPage = page;
    const offset = (page - 1) * PAGE_SIZE;
    const data = await apiRequest(`/api/admin/codes?limit=${PAGE_SIZE}&offset=${offset}`);
    const tbody = document.getElementById('codesTable');
    tbody.innerHTML = data.codes.map(code => `
      <tr>
        <td>${code.status === 'unused' ? `<input type="checkbox" class="code-checkbox" data-id="${code.id}" data-code="${code.code}">` : ''}</td>
        <td><code>${code.code}</code></td>
        <td>${code.duration_days}天</td>
        <td><span class="status status-${code.status}">${renderStatus(code.status)}</span></td>
        <td>${formatDate(code.created_at)}</td>
        <td>
          ${code.status !== 'revoked' ? `<button class="btn btn-danger revoke-btn" data-id="${code.id}">吊销</button>` : '-'}
        </td>
      </tr>
    `).join('');

    // Keep the existing revoke-btn event listener code below this line unchanged
    document.querySelectorAll('.revoke-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        if (confirm('确定要吊销此激活码吗？')) {
          try {
            await apiRequest(`/api/admin/codes/${id}/revoke`, { method: 'POST' });
            loadCodes(codesPage);
            loadStats();
          } catch (err) {
            alert('吊销失败: ' + err.message);
          }
        }
      });
    });

    renderPagination('codesPagination', page, data.total, loadCodes);
  } catch (e) {
    console.error('Failed to load codes:', e);
  }
}

async function loadDevices(page = 1) {
  try {
    devicesPage = page;
    const offset = (page - 1) * PAGE_SIZE;
    const data = await apiRequest(`/api/admin/devices?limit=${PAGE_SIZE}&offset=${offset}`);
    const tbody = document.getElementById('devicesTable');
    tbody.innerHTML = data.devices.map((device, idx) => {
      const detailId = 'dev-detail-' + idx;
      const codeCount = device.codes.length;
      return `
        <tr class="device-row" data-detail="${detailId}">
          <td><code>${device.device_fingerprint}</code></td>
          <td>${formatDate(device.last_heartbeat_at)}</td>
          <td>${formatDate(device.expires_at)}</td>
          <td>
            <span class="code-count-link" data-detail="${detailId}" style="cursor:pointer;color:#6366f1;text-decoration:underline;">
              ${codeCount} 条 ▶
            </span>
          </td>
          <td>
            <button class="btn btn-danger delete-device-btn" data-fingerprint="${device.device_fingerprint}" title="删除设备" style="padding:2px 8px;font-size:16px;line-height:1;">✕</button>
          </td>
        </tr>
        <tr id="${detailId}" class="device-detail" style="display:none;">
          <td colspan="5" style="padding:8px 12px;background:rgba(15,23,42,0.6);color:#cbd5e1;">
            <table style="width:100%;margin:0;border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="padding:4px 8px;font-size:11px;text-align:left;color:#64748b;border-bottom:1px solid rgba(100,116,139,0.2);">激活码</th>
                  <th style="padding:4px 8px;font-size:11px;text-align:left;color:#64748b;border-bottom:1px solid rgba(100,116,139,0.2);">绑定时间</th>
                </tr>
              </thead>
              <tbody>
                ${device.codes.map(c => `
                  <tr>
                    <td style="padding:3px 8px;font-size:12px;border-bottom:1px solid rgba(100,116,139,0.1);"><code style="color:#93c5fd;">${c.code}</code></td>
                    <td style="padding:3px 8px;font-size:12px;border-bottom:1px solid rgba(100,116,139,0.1);">${formatDate(c.bound_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </td>
        </tr>
      `;
    }).join('');

    // 展开/收起
    tbody.querySelectorAll('.code-count-link').forEach(link => {
      link.addEventListener('click', () => {
        const detailRow = document.getElementById(link.dataset.detail);
        if (detailRow) {
          const open = detailRow.style.display !== 'none';
          detailRow.style.display = open ? 'none' : 'table-row';
          const count = link.textContent.match(/\d+/)?.[0] || '';
          link.textContent = open ? `${count} 条 ▶` : `${count} 条 ▼`;
        }
      });
    });

    // 删除设备
    tbody.querySelectorAll('.delete-device-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fp = btn.dataset.fingerprint;
        if (!confirm(`确定要删除设备 ${fp.slice(0,16)}... 的所有绑定记录吗？此操作不可撤销。`)) return;
        try {
          const res = await apiRequest(`/api/admin/devices/${encodeURIComponent(fp)}`, { method: 'DELETE' });
          alert(res.message);
          loadDevices(devicesPage);
        } catch (err) {
          alert('删除失败: ' + err.message);
        }
      });
    });

    renderPagination('devicesPagination', page, data.total, loadDevices);
  } catch (e) {
    console.error('Failed to load devices:', e);
  }
}

async function generateCodes(count, durationDays) {
  try {
    const data = await apiRequest('/api/admin/codes/generate', {
      method: 'POST',
      body: JSON.stringify({ count, durationDays })
    });

    const codesText = data.codes.map(c => c.code).join('\n');
    document.getElementById('newCodesText').value = codesText;
    document.getElementById('generatedCodes').style.display = 'block';

    loadCodes();
    loadStats();
  } catch (e) {
    alert('生成失败: ' + e.message);
  }
}

function login(key) {
  adminKey = key;
  localStorage.setItem('adminKey', key);
  loginScreen.style.display = 'none';
  dashboard.style.display = 'block';
  loadStats();
  loadCodes();
}

function logout() {
  adminKey = null;
  localStorage.removeItem('adminKey');
  loginScreen.style.display = 'flex';
  dashboard.style.display = 'none';
  adminKeyInput.value = '';
}

// Event Listeners
loginBtn.addEventListener('click', async () => {
  const key = adminKeyInput.value.trim();
  if (!key) {
    loginError.textContent = '请输入管理员密钥';
    loginError.style.display = 'block';
    return;
  }

  // Test the key
  try {
    const testKey = key;
    const response = await fetch(`${API_BASE}/api/admin/stats`, {
      headers: { 'X-Admin-Key': testKey }
    });

    if (response.ok) {
      login(key);
      loginError.style.display = 'none';
    } else {
      loginError.textContent = '无效的管理员密钥';
      loginError.style.display = 'block';
    }
  } catch (e) {
    loginError.textContent = '连接服务器失败';
    loginError.style.display = 'block';
  }
});

logoutBtn.addEventListener('click', logout);

document.getElementById('generateBtn').addEventListener('click', () => {
  const count = parseInt(document.getElementById('generateCount').value);
  const duration = parseInt(document.getElementById('generateDuration').value);
  generateCodes(count, duration);
});

document.getElementById('copyBtn').addEventListener('click', () => {
  const textarea = document.getElementById('newCodesText');
  textarea.select();
  document.execCommand('copy');
  alert('已复制到剪贴板');
});

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.remove('active');
      c.style.display = 'none';
    });
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab + 'Tab');
    target.classList.add('active');
    target.style.display = 'block';

    if (btn.dataset.tab === 'devices') {
      loadDevices();
    }
  });
});

// Enter key in login
adminKeyInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    loginBtn.click();
  }
});

// 全选 checkbox
document.getElementById('selectAllCheckbox').addEventListener('change', function () {
  document.querySelectorAll('.code-checkbox').forEach(cb => { cb.checked = this.checked; });
});

document.getElementById('selectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.code-checkbox').forEach(cb => { cb.checked = true; });
  document.getElementById('selectAllCheckbox').checked = true;
});

document.getElementById('deselectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.code-checkbox').forEach(cb => { cb.checked = false; });
  document.getElementById('selectAllCheckbox').checked = false;
});

// 导出 TXT
document.getElementById('exportBtn').addEventListener('click', async () => {
  const checked = document.querySelectorAll('.code-checkbox:checked');
  const ids = Array.from(checked).map(cb => parseInt(cb.dataset.id));

  try {
    const response = await fetch(`/api/admin/codes/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(ids.length > 0 ? { ids } : {})
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '导出失败');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'activation-codes.txt';
    a.click();
    URL.revokeObjectURL(url);

    loadCodes();
    loadStats();
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
});

// Auto login if key exists
if (adminKey) {
  fetch(`${API_BASE}/api/admin/stats`, {
    headers: { 'X-Admin-Key': adminKey }
  }).then(res => {
    if (res.ok) {
      login(adminKey);
    }
  }).catch(() => {});
}
