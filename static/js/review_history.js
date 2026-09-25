/**
 * ====================================================================
 * 📚 review_history.js - 交易复盘工作台：历史复盘档案库弹窗控制与多维检索翻页
 * ====================================================================
 */
// ==================== 📚 历史复盘档案库弹窗控制 (时间倒序 + 多维检索) ====================
var _historyPage = 1;
var _historyPageSize = 10; // 全局统一默认每页 10 条
var _historyTotalPages = 1;
var _historyTotalCount = 0;

function openIntegratedHistoryModal() {
  const backdrop = document.getElementById('rwHistoryBackdrop');
  const modal = document.getElementById('rwHistoryModal');
  if (backdrop) backdrop.style.display = 'block';
  if (modal) modal.style.display = 'flex';

  // 默认填充近 30 天日期范围
  const today = new Date();
  const past30 = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
  const endInput = document.getElementById('historyEndDate');
  const startInput = document.getElementById('historyStartDate');
  if (endInput && !endInput.value) endInput.value = today.toISOString().split('T')[0];
  if (startInput && !startInput.value) startInput.value = past30.toISOString().split('T')[0];

  _historyPage = 1;
  loadIntegratedHistoryReports();
}

function closeIntegratedHistoryModal() {
  const backdrop = document.getElementById('rwHistoryBackdrop');
  const modal = document.getElementById('rwHistoryModal');
  if (backdrop) backdrop.style.display = 'none';
  if (modal) modal.style.display = 'none';
}

function resetHistoryFilters() {
  const startInput = document.getElementById('historyStartDate');
  const endInput = document.getElementById('historyEndDate');
  const kwInput = document.getElementById('historyKeyword');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  if (kwInput) kwInput.value = '';
  _historyPage = 1;
  loadIntegratedHistoryReports();
}

function jumpHistoryPage(p) {
  const target = parseInt(p) || 1;
  if (target < 1 || target > _historyTotalPages || target === _historyPage) return;
  _historyPage = target;
  loadIntegratedHistoryReports();
}
window.jumpHistoryPage = jumpHistoryPage;

function changeHistoryPage(delta) {
  jumpHistoryPage(_historyPage + delta);
}
window.changeHistoryPage = changeHistoryPage;

async function loadIntegratedHistoryReports() {
  const listEl = document.getElementById('rwHistoryReportsList');
  if (listEl) listEl.innerHTML = '<div style="color:var(--sys-text-sub, #64748b);text-align:center;padding:35px"><span class="spinner"></span> 正在检索历史复盘研报...</div>';

  const startVal = (document.getElementById('historyStartDate') || {}).value || '';
  const endVal = (document.getElementById('historyEndDate') || {}).value || '';
  const kwVal = (document.getElementById('historyKeyword') || {}).value || '';

  try {
    const query = new URLSearchParams({
      start_date: startVal,
      end_date: endVal,
      keyword: kwVal.trim(),
      page: _historyPage,
      page_size: _historyPageSize
    });

    const res = await authFetch(`/api/review/history-reports?${query.toString()}`);
    const json = await res.json();
    if (json.code === 200) {
      const reports = json.data || [];
      _historyTotalCount = json.total || 0;
      _historyTotalPages = json.total_pages || 1;
      _historyPage = json.page || 1;

      // 渲染 Element Plus 标准分页器 (尾页与首尾严格禁用)
      if (typeof window.renderElementPlusPagination === 'function') {
        window.renderElementPlusPagination({
          mount: '#historyPaginationContainer',
          total: _historyTotalCount,
          page: _historyPage,
          pageSize: _historyPageSize,
          pageSizes: [10, 20, 50],
          totalTemplate: '共检索到 <b style="color:#58a6ff">{total}</b> 篇历史复盘报告',
          onPageChange: 'jumpHistoryPage',
          onSizeChange: ''
        });
      }

      if (reports.length === 0) {
        listEl.innerHTML = '<div style="color:var(--sys-text-sub, #64748b);text-align:center;padding:35px">暂未检索到符合条件的复盘记录 (可放宽日期或关键词)</div>';
        return;
      }

      listEl.innerHTML = reports.map(r => {
        const isCurrent = r.trade_date === _selectedReviewDate;
        const borderStyle = isCurrent ? 'border:1px solid #58a6ff;background:#ffffff' : 'border:1px solid var(--sys-border, #e2e8f0);background:var(--sys-bg-sub, #f1f5f9)';
        const currentTag = isCurrent ? '<span style="font-size:11px;background:#388bfd;color:#fff;padding:2px 6px;border-radius:4px;margin-left:6px">当前查看中</span>' : '';
        const themesHtml = (r.main_themes_names || []).map(t => `<span style="font-size:11px;background:var(--sys-border, #e2e8f0);color:#58a6ff;padding:2px 6px;border-radius:3px">${t}</span>`).join(' ');
        const medChg = r.median_change_pct || 0;

        return `
          <div style="${borderStyle};padding:14px 18px;border-radius:8px;display:flex;flex-direction:column;gap:8px;transition:all 0.15s" onmouseover="this.style.borderColor='#58a6ff'" onmouseout="this.style.borderColor='${isCurrent?'#58a6ff':'var(--sys-border, #e2e8f0)'}'">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <b style="font-size:16px;color:var(--sys-text-title, #1e293b);font-family:'JetBrains Mono',monospace">📅 ${r.trade_date}</b>
                ${currentTag}
              </div>
              <div style="display:flex;gap:12px;font-size:12px;color:var(--sys-text-sub, #64748b);font-family:'JetBrains Mono',monospace">
                <span>成交: <b style="color:#58a6ff">${(r.total_amount_yi||0).toLocaleString()} 亿</b></span>
                <span>涨跌中位数: <b style="color:${getPnlColor(medChg)}">${medChg >= 0 ? '+' : ''}${medChg}%</b></span>
                <span>空间高标: <b style="color:#bc8cff">${r.highest_ladder_stock||'--'}</b></span>
              </div>
            </div>

            <div style="font-size:12px;color:#c9d1d9;line-height:1.6;background:rgba(255,255,255,0.02);padding:8px 12px;border-radius:4px;border:1px dashed var(--sys-border, #e2e8f0)">
              ${r.sentiment_summary_short}
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;flex-wrap:wrap;gap:8px">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-size:11px;color:var(--sys-text-sub, #64748b)">主线聚焦:</span>
                ${themesHtml || '<span style="font-size:11px;color:var(--sys-text-sub, #64748b)">综合热点</span>'}
              </div>
              <button class="btn btn-blue" style="padding:4px 14px;font-size:11px;font-weight:600" onclick="selectHistoryDateAndLoad('${jsStr(r.trade_date)}')">
                📖 载入该日复盘全景
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">检索历史复盘失败: ${e.message}</div>`;
  }
}

function selectHistoryDateAndLoad(dateStr) {
  closeIntegratedHistoryModal();
  changeIntegratedReviewDate(dateStr);
}


/* ==================== 10. 复盘子功能按钮悬停气泡介绍卡片引擎 ==================== */
var _hoverCardTimer = null;

function showReviewTabHoverCard(targetEl, event) {
  if (!targetEl) return;
  const title = targetEl.getAttribute('data-tooltip-title') || targetEl.innerText.trim();
  const badge = targetEl.getAttribute('data-tooltip-badge') || '核心功能';
  const desc = targetEl.getAttribute('data-tooltip-desc') || '';
  const scene = targetEl.getAttribute('data-tooltip-scene') || '';

  if (!desc) return; // 无说明时不展示

  let card = document.getElementById('reviewSubTabHoverCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'reviewSubTabHoverCard';
    document.body.appendChild(card);
  }

  card.innerHTML = `
    <div class="hover-card-header">
      <div class="hover-card-title">
        <i class="ri-flashlight-fill" style="color:#e3b341"></i>
        <span>${title}</span>
      </div>
      <span class="hover-card-badge">${badge}</span>
    </div>
    <div class="hover-card-desc">${desc}</div>
    ${scene ? `<div class="hover-card-scene">${scene}</div>` : ''}
  `;

  // 计算准确定位 (按钮正下方并居中对齐，支持边界防溢出)
  const rect = targetEl.getBoundingClientRect();
  const cardWidth = 340;
  let left = rect.left + (rect.width / 2) - (cardWidth / 2);
  let top = rect.bottom + 8;

  // 边界保护：防止左侧或右侧溢出视口
  if (left < 10) left = 10;
  if (left + cardWidth > window.innerWidth - 10) {
    left = window.innerWidth - cardWidth - 10;
  }

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;

  clearTimeout(_hoverCardTimer);
  _hoverCardTimer = setTimeout(() => {
    card.classList.add('show');
  }, 60);
}

function hideReviewTabHoverCard() {
  clearTimeout(_hoverCardTimer);
  const card = document.getElementById('reviewSubTabHoverCard');
  if (card) {
    card.classList.remove('show');
  }
}

function openAgentMatrixModal() {
  const m = document.getElementById('agentMatrixModal');
  if (m) {
    m.style.display = 'flex';
  }
}

function closeAgentMatrixModal() {
  const m = document.getElementById('agentMatrixModal');
  if (m) {
    m.style.display = 'none';
  }
}

window.showReviewTabHoverCard = showReviewTabHoverCard;
window.hideReviewTabHoverCard = hideReviewTabHoverCard;
window.openAgentMatrixModal = openAgentMatrixModal;
window.closeAgentMatrixModal = closeAgentMatrixModal;
// 核心调度与全局方法已在 review.js 统一挂载

window.openIntegratedHistoryModal = openIntegratedHistoryModal;
window.closeIntegratedHistoryModal = closeIntegratedHistoryModal;
window.loadIntegratedHistoryReports = loadIntegratedHistoryReports;
window.changeHistoryPage = changeHistoryPage;