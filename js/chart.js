// ============ 分析图表模块 ============
// 封装 Chart.js 的调用，提供概览图、对比图

let chartOverview = null;
let chartCompare = null;

const COLORS = {
  income: '#10B981',
  budget: '#4F46E5',
  reconciled: '#06B6D4',
  remaining: '#D97706'
};

export function renderCharts(summary) {
  renderOverviewChart(summary);
  renderCompareChart(summary);
}

// 预算使用概览（环形图）
function renderOverviewChart(summary) {
  const canvas = document.getElementById('chartOverview');
  if (!canvas || !window.Chart) return;

  if (chartOverview) chartOverview.destroy();

  const ctx = canvas.getContext('2d');
  chartOverview = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['已核销', '待核销'],
      datasets: [{
        data: [summary.totalReconciled, Math.max(0, summary.remaining)],
        backgroundColor: [COLORS.reconciled, COLORS.remaining],
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, usePointStyle: true, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ¥${ctx.parsed.toFixed(2)}`
          }
        }
      }
    }
  });
}

// 收入 / 核销对比（柱状图）
function renderCompareChart(summary) {
  const canvas = document.getElementById('chartCompare');
  if (!canvas || !window.Chart) return;

  if (chartCompare) chartCompare.destroy();

  const ctx = canvas.getContext('2d');
  chartCompare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['金额'],
      datasets: [
        {
          label: '收入',
          data: [summary.totalIncome],
          backgroundColor: COLORS.income,
          borderRadius: 6
        },
        {
          label: '核销',
          data: [summary.totalReconciled],
          backgroundColor: COLORS.reconciled,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, usePointStyle: true, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ¥${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => '¥' + v
          },
          grid: { color: '#F3F4F6' }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

// 渲染预算进度条列表
export function renderBudgetProgress(budgetProgress) {
  const container = document.getElementById('budgetProgress');
  if (!container) return;

  if (!budgetProgress || budgetProgress.length === 0) {
    container.innerHTML = '<div style="color:#9CA3AF;font-size:13px;text-align:center;padding:20px;">本月暂无预算</div>';
    return;
  }

  container.innerHTML = budgetProgress.map(b => `
    <div class="budget-progress-item">
      <div class="bp-header">
        <span class="bp-name">${escapeHtml(b.name)}</span>
        <span class="bp-nums">¥${b.used.toFixed(2)} / ¥${b.amount.toFixed(2)} (${b.progress.toFixed(0)}%)</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${b.progress}%"></div>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
