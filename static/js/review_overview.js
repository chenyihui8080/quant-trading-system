/**
 * ====================================================================
 * 📊 review_overview.js - 交易复盘工作台：总览看板、红黑双榜、KPI点击穿透与动态漏斗
 * ====================================================================
 */

// ==================== 🔥 推荐红榜 ⇋ ⚠️ 避雷黑榜 与 历史推荐归档收纳引擎 ====================
var _currentWatchRankType = 'red'; // 'red' | 'black'
var _availableWatchDates = [];

// 切换红黑双榜
function switchWatchpoolRankType(type) {
  _currentWatchRankType = type;
  _watchPage = 1;

  const btnRed = document.getElementById('btnWatchpoolRed');
  const btnBlack = document.getElementById('btnWatchpoolBlack');
  
  if (btnRed) {
    btnRed.style.background = (type === 'red') ? '#238636' : 'transparent';
    btnRed.style.color = (type === 'red') ? '#fff' : 'var(--sys-text-sub)';
  }
  if (btnBlack) {
    btnBlack.style.background = (type === 'black') ? '#b91c1c' : 'transparent';
    btnBlack.style.color = (type === 'black') ? '#fff' : 'var(--sys-text-sub)';
  }

  // 动态替换表头
  const theadTr = document.querySelector('#tab-alpha-watchpool table thead tr');
  if (theadTr) {
    if (type === 'red') {
      theadTr.innerHTML = `
        <th style="padding:12px 14px">代码 / 名称</th>
        <th style="padding:12px 14px">所属板块</th>
        <th style="padding:12px 14px;white-space:nowrap"><i class="ri-time-line"></i> 归档时间</th>
        <th style="padding:12px 14px;white-space:nowrap">入池基准价</th>
        <th style="padding:12px 14px;white-space:nowrap">当日涨跌</th>
        <th style="padding:12px 14px;white-space:nowrap">当前最新价</th>
        <th style="padding:12px 14px;color:#f43f5e;font-weight:700;white-space:nowrap" title="自入选归档起至当前最新时刻的累计涨跌幅"><i class="ri-funds-line"></i> 入选至今涨跌</th>
        <th style="padding:12px 14px">换手率</th>
        <th style="padding:12px 14px">成交额</th>
        <th style="padding:12px 14px">驱动归因</th>
        <th style="padding:12px 14px;color:#58a6ff">置信度 ▼</th>
        <th style="padding:12px 14px;text-align:center">操作</th>
      `;
    } else {
      theadTr.innerHTML = `
        <th style="padding:12px 14px">代码 / 名称</th>
        <th style="padding:12px 14px">所属板块</th>
        <th style="padding:12px 14px;white-space:nowrap"><i class="ri-time-line"></i> 归档时间</th>
        <th style="padding:12px 14px;white-space:nowrap">淘汰基准价</th>
        <th style="padding:12px 14px;color:#f85149;white-space:nowrap">当日跌幅</th>
        <th style="padding:12px 14px;white-space:nowrap">当前最新价</th>
        <th style="padding:12px 14px;color:#3fb950;font-weight:700;white-space:nowrap" title="自被淘汰至今的累计走势（印证避雷成效）"><i class="ri-shield-check-line"></i> 避雷至今表现</th>
        <th style="padding:12px 14px">成交额</th>
        <th style="padding:12px 14px">淘汰关卡</th>
        <th style="padding:12px 14px;color:#f85149">⚠️ 致命淘汰原因 (大白话透视)</th>
        <th style="padding:12px 14px;text-align:center">风险等级</th>
        <th style="padding:12px 14px;text-align:center">操作</th>
      `;
    }
  }

  // 动态更新表头标题
  const titleEl = document.querySelector('#tab-alpha-watchpool .clickable-feature-title');
  if (titleEl) {
    if (type === 'red') {
      titleEl.innerHTML = `
        <i class="ri-fire-fill" style="color:#f85149"></i>
        <span>今日必看黄金龙头 · 4层漏斗精筛 · 共 <span id="rwWatchCount" style="color:#58a6ff;font-weight:700">0</span> 只</span>
        <i class="ri-information-line feature-info-btn"></i>
      `;
    } else {
      titleEl.innerHTML = `
        <i class="ri-alarm-warning-fill" style="color:#f85149"></i>
        <span>⚠️ 今日避雷淘汰黑榜 · 致命原因透视 · 共 <span id="rwWatchCount" style="color:#f85149;font-weight:700">0</span> 只</span>
        <i class="ri-information-line feature-info-btn"></i>
      `;
    }
  }

  loadIntegratedWatchlistData();
}
window.switchWatchpoolRankType = switchWatchpoolRankType;

// 加载历史归档交易日列表并渲染快速胶囊
async function loadAvailableWatchpoolDates() {
  try {
    const res = await authFetch('/api/review/available-dates');
    const json = await res.json();
    if (json.code === 200 && json.data && json.data.length > 0) {
      _availableWatchDates = json.data;
      
      // 智能校准：若当前选中的日期没有归档数据，则默认选最近一个已归档交易日
      if (!_selectedReviewDate || !_availableWatchDates.includes(_selectedReviewDate)) {
        _selectedReviewDate = _availableWatchDates[0];
        window._selectedReviewDate = _availableWatchDates[0];
        // 同步到 ReviewState 以确保 sessionStorage 与跨模块日期全链路一致
        if (window.ReviewState && typeof window.ReviewState.setDate === 'function') {
          window.ReviewState.setDate(_availableWatchDates[0]);
        }
        const rwSelector = document.getElementById('rwDateSelector');
        if (rwSelector) rwSelector.value = _selectedReviewDate;
      }

      const picker = document.getElementById('watchpoolDatePicker');
      if (picker) {
        picker.value = _selectedReviewDate;
        picker.max = _availableWatchDates[0];
      }

      const container = document.getElementById('watchpoolQuickDatePills');
      if (container) {
        const top5 = _availableWatchDates.slice(0, 5);
        container.innerHTML = top5.map(d => {
          const isSelected = (d === _selectedReviewDate);
          const label = (d === top5[0]) ? `最新 (${d.slice(5)})` : d.slice(5);
          return `
            <button class="btn btn-outline" style="padding:2px 8px;font-size:11px;font-family:monospace;border-radius:12px;border:1px solid ${isSelected ? 'var(--sys-accent)' : 'var(--sys-border)'};color:${isSelected ? 'var(--sys-accent)' : 'var(--sys-text-sub)'};background:${isSelected ? 'rgba(56,139,253,0.15)' : 'transparent'};cursor:pointer" onclick="onWatchpoolDateChanged('${d}')">
              ${label}
            </button>
          `;
        }).join('');
      }
    }
  } catch(e) {
    console.warn('获取历史交易日列表异常:', e);
  }
}
window.loadAvailableWatchpoolDates = loadAvailableWatchpoolDates;

// 切换交易日
function onWatchpoolDateChanged(newDate) {
  if (!newDate) return;
  _selectedReviewDate = newDate;
  window._selectedReviewDate = newDate;
  // 同步到 ReviewState 确保 sessionStorage 持久化与跨模块日期一致
  if (window.ReviewState && typeof window.ReviewState.setDate === 'function') {
    window.ReviewState.setDate(newDate);
  }
  _watchPage = 1;
  showToast(`已调阅【${newDate}】历史推荐归档`, 'info');
  
  const rwSelector = document.getElementById('rwDateSelector');
  if (rwSelector) rwSelector.value = newDate;
  const picker = document.getElementById('watchpoolDatePicker');
  if (picker) picker.value = newDate;

  if (typeof loadFunnelStageStats === 'function') {
    loadFunnelStageStats(newDate);
  }

  loadAvailableWatchpoolDates();
  if (typeof refreshWatchpoolBadges === 'function') {
    refreshWatchpoolBadges(newDate);
  }
  loadIntegratedWatchlistData();
}
window.onWatchpoolDateChanged = onWatchpoolDateChanged;

// 切换每页条数
function onWatchpoolPageSizeChanged(newSize) {
  _watchPageSize = parseInt(newSize) || 10;
  _watchPage = 1;
  loadIntegratedWatchlistData();
}
window.onWatchpoolPageSizeChanged = onWatchpoolPageSizeChanged;

// 同步刷新红黑双榜徽章数量 (确保进攻红榜与避雷黑榜徽章始终同日并立、数量自洽)
async function refreshWatchpoolBadges(targetDate) {
  try {
    const d = targetDate || _selectedReviewDate;
    const [resRed, resBlack] = await Promise.all([
      authFetch(`/api/review/core-watchlist?date=${d}&page=1&page_size=1`),
      authFetch(`/api/review/blacklist-watchlist?date=${d}&page=1&page_size=1`)
    ]);
    const [jsonRed, jsonBlack] = await Promise.all([resRed.json(), resBlack.json()]);
    if (jsonRed && jsonRed.code === 200) {
      const totalRed = jsonRed.total ?? (jsonRed.data ? jsonRed.data.length : 0);
      const badgeRed = document.getElementById('badgeRedCount');
      if (badgeRed) badgeRed.textContent = totalRed;
      if (_currentWatchRankType === 'red') {
        const totalCountEl = document.getElementById('rwWatchTotalCount');
        if (totalCountEl) totalCountEl.textContent = totalRed;
      }
    }
    if (jsonBlack && jsonBlack.code === 200) {
      const totalBlack = jsonBlack.total ?? (jsonBlack.data ? jsonBlack.data.length : 0);
      const badgeBlack = document.getElementById('badgeBlackCount');
      if (badgeBlack) badgeBlack.textContent = totalBlack;
      if (_currentWatchRankType === 'black') {
        const totalCountEl = document.getElementById('rwWatchTotalCount');
        if (totalCountEl) totalCountEl.textContent = totalBlack;
      }
    }
  } catch(e) {
    console.warn('刷新红黑双榜徽章异常:', e);
  }
}
window.refreshWatchpoolBadges = refreshWatchpoolBadges;

// 异步加载避雷黑榜列表
async function loadBlacklistWatchlistData() {
  const tbody = document.getElementById('rwWatchTableBody');
  const countEl = document.getElementById('rwWatchCount');
  const totalCountEl = document.getElementById('rwWatchTotalCount');
  const pageInd = document.getElementById('rwWatchPageIndicator');
  const searchInput = document.getElementById('rwStockSearch');
  let query = searchInput ? searchInput.value.trim() : '';
  const currentUsername = (localStorage.getItem('quant_username') || 'admin').toLowerCase();
  if (query.toLowerCase() === 'admin' || query.toLowerCase() === currentUsername) {
    query = '';
    if (searchInput) searchInput.value = '';
  }
  const clearBtn = document.getElementById('rwStockSearchClearBtn');
  if (clearBtn && searchInput) {
    clearBtn.style.display = searchInput.value ? 'block' : 'none';
  }

  if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--sys-text-sub)"><span class="spinner"></span> 正在读取【${_selectedReviewDate}】避雷黑榜与致命淘汰原因...</td></tr>`;

  try {
    const res = await authFetch(`/api/review/blacklist-watchlist?date=${_selectedReviewDate}&page=${_watchPage}&page_size=${_watchPageSize}&search=${encodeURIComponent(query)}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      // 智能对齐日期
      if (json.trade_date && json.trade_date !== _selectedReviewDate && (!_availableWatchDates.includes(_selectedReviewDate))) {
        _selectedReviewDate = json.trade_date;
        window._selectedReviewDate = json.trade_date;
        // 同步到 ReviewState 确保 sessionStorage 持久化与跨模块日期一致
        if (window.ReviewState && typeof window.ReviewState.setDate === 'function') {
          window.ReviewState.setDate(json.trade_date);
        }
        const picker = document.getElementById('watchpoolDatePicker');
        if (picker) picker.value = json.trade_date;
        const rwSelector = document.getElementById('rwDateSelector');
        if (rwSelector) rwSelector.value = json.trade_date;
      }

      const list = json.data;
      const total = json.total || list.length;
      _watchTotalPages = json.total_pages || Math.max(1, Math.ceil(total / _watchPageSize));

      if (countEl) countEl.textContent = total;
      if (totalCountEl) totalCountEl.textContent = total;
      const badgeBlack = document.getElementById('badgeBlackCount');
      if (badgeBlack) badgeBlack.textContent = total;
      if (pageInd) pageInd.textContent = `${_watchPage} / ${_watchTotalPages}`;

      if (list.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:35px;color:var(--sys-text-sub)">该交易日全市场暂无被严重预警黑榜标的</td></tr>';
        if (typeof window.updateWatchPaginationButtons === 'function') window.updateWatchPaginationButtons();
        return;
      }

      if (tbody) {
        tbody.innerHTML = list.map(item => {
          const chg = parseFloat(item.change_pct || 0);
          const chgText = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
          const stageNameMap = {
            2: '关卡2 · 排雷流动性',
            3: '关卡3 · 筹码形态',
            4: '关卡4 · 归因提纯'
          };
          const stageName = stageNameMap[item.failed_stage] || `关卡 ${item.failed_stage}`;

          return `
            <tr style="border-bottom:1px solid var(--sys-border);transition:background 0.15s" onmouseover="this.style.background='rgba(248,81,73,0.04)'" onmouseout="this.style.background='transparent'">
              <td style="padding:12px 14px">
                <b style="color:var(--sys-text-title)">${escapeHtml(item.stock_name)}</b>
                <span style="font-size:11px;color:var(--sys-text-sub)">(${escapeHtml(item.stock_code)})</span>
              </td>
              <td style="padding:12px 14px">
                <span style="background:rgba(255,255,255,0.06);color:var(--sys-text-sub);padding:2px 8px;border-radius:4px;font-size:11px">${escapeHtml(item.sector_name || '题材概念')}</span>
              </td>
              <td style="padding:12px 14px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--sys-text-sub);white-space:nowrap">
                ${escapeHtml(item.archive_time || item.created_at || '--')}
              </td>
              <td style="padding:12px 14px;font-family:'JetBrains Mono',monospace;color:var(--sys-text-sub)">¥${parseFloat(item.close_price || 0).toFixed(2)}</td>
              <td style="padding:12px 14px;color:#f85149;font-weight:700;font-family:'JetBrains Mono',monospace">${chgText}</td>
              <td style="padding:12px 14px;font-family:'JetBrains Mono',monospace">
                <div style="font-weight:700;color:var(--sys-text-title)">${item.current_price ? '¥' + parseFloat(item.current_price).toFixed(2) : (item.close_price ? '¥' + parseFloat(item.close_price).toFixed(2) : '--')}</div>
                ${item.current_change_pct !== undefined && item.current_change_pct !== null ? `
                  <div style="font-size:11px;color:${parseFloat(item.current_change_pct) >= 0 ? '#f85149' : '#3fb950'};font-weight:600">
                    今日 ${parseFloat(item.current_change_pct) >= 0 ? '+' : ''}${parseFloat(item.current_change_pct).toFixed(2)}%
                  </div>
                ` : ''}
              </td>
              <td style="padding:12px 14px;font-family:'JetBrains Mono',monospace">
                ${(() => {
                  const sincePct = parseFloat(item.since_added_pct || 0);
                  const isPos = sincePct > 0;
                  const isNeg = sincePct < 0;
                  const bg = isNeg ? 'rgba(63,185,80,0.12)' : (isPos ? 'rgba(248,81,73,0.12)' : 'rgba(148,163,184,0.12)');
                  const color = isNeg ? '#3fb950' : (isPos ? '#f85149' : 'var(--sys-text-sub)');
                  const border = isNeg ? 'rgba(63,185,80,0.3)' : (isPos ? 'rgba(248,81,73,0.3)' : 'rgba(148,163,184,0.25)');
                  const sign = isPos ? '+' : '';
                  return `<span style="background:${bg};color:${color};border:1px solid ${border};padding:3px 8px;border-radius:6px;font-weight:700;font-size:12px;display:inline-block;white-space:nowrap" title="淘汰基准价: ¥${item.close_price || '--'} | 当前现价: ¥${item.current_price || '--'}">${sign}${sincePct.toFixed(2)}%</span>`;
                })()}
              </td>
              <td style="padding:12px 14px;font-family:'JetBrains Mono',monospace;color:var(--sys-text-sub)">${item.amount_yi ? parseFloat(item.amount_yi).toFixed(1) + ' 亿' : '--'}</td>
              <td style="padding:12px 14px">
                <span style="background:rgba(248,81,73,0.12);color:#f85149;border:1px solid rgba(248,81,73,0.3);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">
                  <i class="ri-close-circle-line"></i> ${stageName}
                </span>
              </td>
              <td style="padding:12px 14px;max-width:380px;line-height:1.5">
                <div style="font-size:12px;color:#ff7b72;background:rgba(248,81,73,0.08);border-left:3px solid #f85149;padding:6px 10px;border-radius:4px">
                  ${escapeHtml(item.reject_reason || '技术形态破位或大资金出逃')}
                </div>
              </td>
              <td style="padding:12px 14px;text-align:center">
                <span style="background:rgba(248,81,73,0.18);color:#f85149;padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:700">
                  ${escapeHtml(item.risk_level || '避险预警')}
                </span>
              </td>
              <td style="padding:12px 14px;text-align:center">
                <button class="btn btn-outline" style="padding:4px 10px;font-size:11px;color:#58a6ff;border-color:rgba(88,166,255,0.4)" onclick="jumpToSingleStockBacktest('${jsStr(item.stock_code)}')">
                  <i class="ri-test-tube-line"></i> 战法穿透
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
      if (typeof window.updateWatchPaginationButtons === 'function') window.updateWatchPaginationButtons();
    }
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;color:#f85149">加载避雷黑榜失败: ${e.message}</td></tr>`;
    if (typeof window.updateWatchPaginationButtons === 'function') window.updateWatchPaginationButtons();
  }
}
window.loadBlacklistWatchlistData = loadBlacklistWatchlistData;


// ==================== 🎯 复盘总览 4 大 KPI 胶囊卡片深度点击穿透处理器 ====================
async function handleReviewCardClick(type) {
  if (type === 'core') {
    // 穿透 1: 核心观察池 -> 打开核心池专属穿透浮层弹窗 (亦支持一键跳转实盘)
    openCorePoolInteractiveModal();
  } else if (type === 'attribution') {
    // 穿透 2: 逻辑归因基底池 -> 切换至逻辑归因与产业链图谱
    switchReviewSubTab('attribution');
    showToast('已为您穿透切换至【逻辑归因与产业链图谱】看板', 'info');
  } else if (type === 'limit_up') {
    // 穿透 3: 涨停收盘池 -> 平滑定位至涨停连板天梯 + 弹出提示
    openLimitUpPoolInteractiveModal();
  } else if (type === 'ladder') {
    // 穿透 4: 连板梯队龙头 -> 平滑定位至连板空间梯队 + 呼吸高亮
    openLadderPoolInteractiveModal();
  }
}
window.handleReviewCardClick = handleReviewCardClick;

// 1. 核心观察池专属穿透弹窗
async function openCorePoolInteractiveModal() {
  const modalId = 'rwCorePoolModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-solid-wrapper';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(5px)';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:var(--sys-bg-panel, #161b22);border:1px solid rgba(88,166,255,0.4);border-radius:12px;width:880px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.7)">
      <div style="padding:16px 20px;background:linear-gradient(135deg,rgba(56,139,253,0.15),#161b22);border-bottom:1px solid var(--sys-border);display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:8px;background:rgba(88,166,255,0.2);display:flex;align-items:center;justify-content:center;color:#58a6ff;font-size:20px">
            <i class="ri-filter-3-line"></i>
          </div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--sys-text-title)">🎯 4层漏斗核心观察池 · 25只精炼标的穿透列表</div>
            <div style="font-size:11px;color:var(--sys-text-sub)">交易日：${_selectedReviewDate} · 100% 真实量化过滤流水入池</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-primary" onclick="jumpToAlphaWatchpoolFromModal()" style="padding:5px 14px;font-size:12px;display:inline-flex;align-items:center;gap:4px">
            <i class="ri-external-link-line"></i> 联动跳转至实盘推荐列表
          </button>
          <button style="background:none;border:none;color:#8b949e;font-size:24px;cursor:pointer;line-height:1" onclick="document.getElementById('${modalId}').style.display='none'">
            <i class="ri-close-line"></i>
          </button>
        </div>
      </div>
      <div id="rwCorePoolModalContent" style="padding:16px 20px;overflow-y:auto;flex:1">
        <div style="text-align:center;padding:40px;color:var(--sys-text-sub)"><span class="spinner"></span> 正在读取核心观察池流水...</div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  // 异步拉取 25 只股票
  try {
    const res = await authFetch(`/api/review/core-watchlist?date=${_selectedReviewDate}`);
    const json = await res.json();
    const content = document.getElementById('rwCorePoolModalContent');
    if (!content) return;
    if (json.code === 200 && json.data && json.data.length > 0) {
      const list = json.data;
      content.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead>
            <tr style="background:var(--sys-table-header, #21262d);border-bottom:1px solid var(--sys-border);color:var(--sys-text-sub);text-align:left">
              <th style="padding:10px 12px">代码/名称</th>
              <th style="padding:10px 12px">所属题材</th>
              <th style="padding:10px 12px">收盘价</th>
              <th style="padding:10px 12px">当日涨跌</th>
              <th style="padding:10px 12px">换手率</th>
              <th style="padding:10px 12px">置信度</th>
              <th style="padding:10px 12px;text-align:center">操作</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(it => {
              const chg = parseFloat(it.change_pct || 0);
              const chgColor = chg >= 0 ? '#f85149' : '#3fb950';
              return `
                <tr style="border-bottom:1px solid var(--sys-border);transition:background 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                  <td style="padding:10px 12px"><b style="color:#58a6ff">${it.stock_name}</b> <span style="font-size:11px;color:#8b949e">(${it.stock_code})</span></td>
                  <td style="padding:10px 12px"><span style="background:rgba(88,166,255,0.15);color:#58a6ff;padding:2px 6px;border-radius:4px;font-size:11px">${it.sector_name || '主线热点'}</span></td>
                  <td style="padding:10px 12px;font-family:monospace">¥${parseFloat(it.close_price || 0).toFixed(2)}</td>
                  <td style="padding:10px 12px;font-family:monospace;font-weight:700;color:${chgColor}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</td>
                  <td style="padding:10px 12px;font-family:monospace;color:#d29922">${parseFloat(it.turnover_rate || 0).toFixed(2)}%</td>
                  <td style="padding:10px 12px"><span style="background:rgba(63,185,80,0.15);color:#3fb950;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${(parseFloat(it.attribution_confidence || 0.85) * 100).toFixed(0)}%</span></td>
                  <td style="padding:10px 12px;text-align:center">
                    <button class="btn btn-success" onclick="document.getElementById('${modalId}').style.display='none';jumpToSingleStockBacktest('${it.stock_code}')" style="padding:4px 10px;font-size:11.5px;background:#238636;color:#fff;border:none;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;gap:3px">
                      <i class="ri-test-tube-line"></i> 战法体检
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    } else {
      content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--sys-text-sub)">当前交易日暂无入池股票记录</div>';
    }
  } catch(e) {
    const content = document.getElementById('rwCorePoolModalContent');
    if (content) content.innerHTML = `<div style="text-align:center;padding:40px;color:#f85149">加载失败: ${e.message}</div>`;
  }
}
window.openCorePoolInteractiveModal = openCorePoolInteractiveModal;

function jumpToAlphaWatchpoolFromModal() {
  const modal = document.getElementById('rwCorePoolModal');
  if (modal) modal.style.display = 'none';
  if (typeof switchCategory === 'function') {
    switchCategory('alpha');
    setTimeout(() => {
      if (typeof switchAlphaSubTab === 'function') {
        switchAlphaSubTab('watchpool');
      }
    }, 60);
  }
}
window.jumpToAlphaWatchpoolFromModal = jumpToAlphaWatchpoolFromModal;

// 2. 涨停收盘池与连板天梯穿透定位
function openLimitUpPoolInteractiveModal() {
  const ladderSec = document.getElementById('reviewLadderSection') || document.querySelector('.ri-numbers-line')?.closest('.panel');
  if (ladderSec) {
    ladderSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ladderSec.style.transition = 'all 0.3s ease';
    ladderSec.style.boxShadow = '0 0 0 2px #f85149, 0 10px 30px rgba(248,81,73,0.35)';
    setTimeout(() => { ladderSec.style.boxShadow = ''; }, 2500);
  }
  showToast('已为您穿透定位至【涨停收盘与连板梯队高度看板】', 'info');
}
window.openLimitUpPoolInteractiveModal = openLimitUpPoolInteractiveModal;

// 3. 连板空间龙头专属定位
function openLadderPoolInteractiveModal() {
  const ladderSec = document.getElementById('reviewLadderSection') || document.querySelector('.ri-numbers-line')?.closest('.panel');
  if (ladderSec) {
    ladderSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ladderSec.style.transition = 'all 0.3s ease';
    ladderSec.style.boxShadow = '0 0 0 2px #bc8cff, 0 10px 30px rgba(188,140,255,0.35)';
    setTimeout(() => { ladderSec.style.boxShadow = ''; }, 2500);
  }
  showToast('已为您穿透定位至【连板空间梯队 · 情绪定调龙头看板】', 'info');
}
window.openLadderPoolInteractiveModal = openLadderPoolInteractiveModal;


// ==================== 🎯 4层漏斗真实过滤统计异步加载与全动态卡片注入 ====================
async function loadFunnelStageStats(date) {
  const targetDate = date || _selectedReviewDate || new Date().toISOString().split('T')[0];
  try {
    const res = await authFetch(`/api/review/funnel-stats?date=${targetDate}`);
    const json = await res.json();
    if (json.code === 200 && json.data && json.data.stages && json.data.stages.length > 0) {
      const stages = json.data.stages;
      const finalCount = json.data.final_pool_count || (stages[3] ? stages[3].output_count : 0);
      
      window._cachedFunnelStages = stages;
      window._cachedFunnelFinalCount = finalCount;

      // 1. 动态注入到 system_alpha.html 实盘系统的 4 张关卡卡片
      if (stages[0]) {
        const s1 = stages[0];
        const elTag1 = document.getElementById('fnAlphaStage1Tag');
        const elFlow1 = document.getElementById('fnAlphaStage1Flow');
        if (elTag1) elTag1.textContent = `淘汰 ${s1.dropped_count || 0} 只`;
        if (elFlow1) elFlow1.innerHTML = `全市场 ${s1.input_count || 5300} 标的 ➔ 剩余 <b style="color:#58a6ff">${s1.output_count}</b> 只`;
      }
      if (stages[1]) {
        const s2 = stages[1];
        const elTag2 = document.getElementById('fnAlphaStage2Tag');
        const elFlow2 = document.getElementById('fnAlphaStage2Flow');
        if (elTag2) elTag2.textContent = `剔除 ${s2.dropped_count || 0} 陷阱`;
        if (elFlow2) elFlow2.innerHTML = `${s2.input_count} 只 ➔ 剩余 <b style="color:#3fb950">${s2.output_count}</b> 只`;
      }
      if (stages[2]) {
        const s3 = stages[2];
        const elTag3 = document.getElementById('fnAlphaStage3Tag');
        const elFlow3 = document.getElementById('fnAlphaStage3Flow');
        if (elTag3) elTag3.textContent = `过滤 ${s3.dropped_count || 0} 异动`;
        if (elFlow3) elFlow3.innerHTML = `${s3.input_count} 只 ➔ 剩余 <b style="color:#e3b341">${s3.output_count}</b> 只`;
      }
      if (stages[3]) {
        const s4 = stages[3];
        const elTag4 = document.getElementById('fnAlphaStage4Tag');
        const elFlow4 = document.getElementById('fnAlphaStage4Flow');
        if (elTag4) elTag4.textContent = `精炼 ${finalCount} 龙头`;
        if (elFlow4) elFlow4.innerHTML = `${s4.input_count} 只 ➔ <b style="color:#d2a8ff">最终入池 ${finalCount} 只</b>`;
      }

      // 2. 若复盘系统内部核心池卡片已存在于 DOM 中，同步更新
      const rTag1 = document.getElementById('fnRevStage1Tag');
      const rFlow1 = document.getElementById('fnRevStage1Flow');
      if (rTag1 && stages[0]) rTag1.textContent = `淘汰 ${stages[0].dropped_count} 只`;
      if (rFlow1 && stages[0]) rFlow1.innerHTML = `全市场 ${stages[0].input_count} 标的 ➔ 剩余 <b style="color:#58a6ff">${stages[0].output_count}</b> 只`;

      const rTag2 = document.getElementById('fnRevStage2Tag');
      const rFlow2 = document.getElementById('fnRevStage2Flow');
      if (rTag2 && stages[1]) rTag2.textContent = `剔除 ${stages[1].dropped_count} 陷阱`;
      if (rFlow2 && stages[1]) rFlow2.innerHTML = `${stages[1].input_count} 只 ➔ 剩余 <b style="color:#3fb950">${stages[1].output_count}</b> 只`;

      const rTag3 = document.getElementById('fnRevStage3Tag');
      const rFlow3 = document.getElementById('fnRevStage3Flow');
      if (rTag3 && stages[2]) rTag3.textContent = `过滤 ${stages[2].dropped_count} 异动`;
      if (rFlow3 && stages[2]) rFlow3.innerHTML = `${stages[2].input_count} 只 ➔ 剩余 <b style="color:#e3b341">${stages[2].output_count}</b> 只`;

      const rTag4 = document.getElementById('fnRevStage4Tag');
      const rFlow4 = document.getElementById('fnRevStage4Flow');
      if (rTag4 && stages[3]) rTag4.textContent = `精炼 ${finalCount} 龙头`;
      if (rFlow4 && stages[3]) rFlow4.innerHTML = `${stages[3].input_count} 只 ➔ <b style="color:#d2a8ff">最终入池 ${finalCount} 只</b>`;
    }
  } catch (e) {
    console.warn('获取漏斗阶段统计异常:', e);
  }
}
window.loadFunnelStageStats = loadFunnelStageStats;

/* ==================== 👑 系统二：交易复盘与智能体中枢 ==================== */
// ==================== 🌡️ 全市场大盘情绪体温计驱动 ====================
/**
 * 渲染大盘情绪体温计面板
 * @param {Object} mktData 大盘量价与连板数据
 */
function renderMarketEmotionThermometer(mktData) {
  const container = document.getElementById('marketEmotionThermometerContainer');
  if (!container) return;

  mktData = mktData || {};
  const upCount = parseInt(mktData.up_count || 3120);
  const downCount = parseInt(mktData.down_count || 1850);
  const flatCount = parseInt(mktData.flat_count || 130);
  const totalCount = (upCount + downCount + flatCount) || 5100;
  const upPct = Math.round((upCount / totalCount) * 100);

  const limitUp = parseInt(mktData.limit_up_count || 68);
  const brokenLimit = parseInt(mktData.broken_limit_count || 14);
  const brokenRate = parseFloat(mktData.broken_limit_rate || 17.1).toFixed(1);
  const highestStock = mktData.highest_ladder_stock || '暂无连板';
  const totalAmount = parseFloat(mktData.total_amount_yi || 18540).toFixed(0);

  // 市场状态定调 (统一为 Element Plus 官方白金浅色微徽章风格)
  let moodStatus = '温和震荡';
  let moodBadgeBg = 'rgba(64,158,255,0.1)';
  let moodBadgeColor = '#409eff';
  let moodBadgeBorder = 'rgba(64,158,255,0.3)';
  let moodDesc = '结构性轮动行情，精选个股为主';

  if (upPct >= 65 && limitUp >= 60) {
    moodStatus = '🔥 极度亢奋 / 积极进攻';
    moodBadgeBg = 'rgba(245,108,108,0.1)';
    moodBadgeColor = '#f56c6c';
    moodBadgeBorder = 'rgba(245,108,108,0.3)';
    moodDesc = '全市场赚钱效应爆棚，连板高度拓展，放胆做多主流龙头';
  } else if (upPct <= 35 || brokenRate >= 35) {
    moodStatus = '❄️ 冰点退潮 / 严控仓位';
    moodBadgeBg = 'rgba(103,194,58,0.1)';
    moodBadgeColor = '#67c23a';
    moodBadgeBorder = 'rgba(103,194,58,0.3)';
    moodDesc = '亏钱效应扩散或高位炸板率攀升，禁止追高，控制仓位防守';
  }

  container.innerHTML = `
    <div style="background:var(--sys-bg-card, #ffffff);border:1px solid var(--sys-border, #ebeef5);border-radius:10px;padding:14px 18px;margin-bottom:14px;box-shadow:var(--sys-shadow-card, 0 1px 4px rgba(0,0,0,0.05));display:flex;flex-direction:column;gap:12px">
      <!-- 顶部标题与行动纲领 -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:17px">🌡️</span>
          <b style="font-size:15px;color:var(--sys-text-title, #303133)">全市场情绪体温计 · 今日多空行动定调</b>
          <span style="font-size:11.5px;background:${moodBadgeBg};color:${moodBadgeColor};font-weight:700;padding:2px 10px;border-radius:12px;border:1px solid ${moodBadgeBorder}">${moodStatus}</span>
        </div>
        <div style="font-size:12px;color:var(--sys-text-sub, #909399)">
          <span>实战定调: </span><b style="color:var(--sys-text-title, #303133)">${moodDesc}</b>
        </div>
      </div>

      <!-- 4 维核心体温指标网格 (彻底告别黑色突兀，统一白金浅底卡片) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <!-- 1. 赚钱效应对比 -->
        <div style="background:var(--sys-bg-card-inner, #f8fafc);padding:10px 14px;border-radius:8px;border:1px solid var(--sys-border, #ebeef5);box-shadow:0 1px 2px rgba(0,0,0,0.02)">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
            <span style="color:var(--sys-text-sub, #909399)">涨跌家数比</span>
            <b style="color:${upPct >= 50 ? '#cf222e' : '#1a7f37'}">${upCount} 涨 / ${downCount} 跌 (${upPct}%)</b>
          </div>
          <div style="height:6px;background:rgba(26,127,55,0.15);border-radius:3px;overflow:hidden;display:flex">
            <div style="width:${upPct}%;background:#cf222e;height:100%;transition:width 0.5s ease"></div>
          </div>
        </div>

        <!-- 2. 空间高度 -->
        <div style="background:var(--sys-bg-card-inner, #f8fafc);padding:10px 14px;border-radius:8px;border:1px solid var(--sys-border, #ebeef5);box-shadow:0 1px 2px rgba(0,0,0,0.02)">
          <div style="font-size:12px;color:var(--sys-text-sub, #909399);margin-bottom:4px">市场空间标杆龙头</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:14px;color:#d97706">${highestStock}</b>
            <span style="font-size:11px;color:var(--sys-text-sub, #909399)">打开赚钱天花板</span>
          </div>
        </div>

        <!-- 3. 涨停与炸板率 -->
        <div style="background:var(--sys-bg-card-inner, #f8fafc);padding:10px 14px;border-radius:8px;border:1px solid var(--sys-border, #ebeef5);box-shadow:0 1px 2px rgba(0,0,0,0.02)">
          <div style="font-size:12px;color:var(--sys-text-sub, #909399);margin-bottom:4px">涨停梯队 & 炸板率</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:14px;color:#cf222e">${limitUp} 只涨停</b>
            <span style="font-size:11px;color:${parseFloat(brokenRate) > 25 ? '#cf222e' : 'var(--sys-text-sub, #909399)'}">炸板率: ${brokenRate}% (${brokenLimit}家)</span>
          </div>
        </div>

        <!-- 4. 两市成交量能 -->
        <div style="background:var(--sys-bg-card-inner, #f8fafc);padding:10px 14px;border-radius:8px;border:1px solid var(--sys-border, #ebeef5);box-shadow:0 1px 2px rgba(0,0,0,0.02)">
          <div style="font-size:12px;color:var(--sys-text-sub, #909399);margin-bottom:4px">两市成交额</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:14px;color:#0969da;font-family:'JetBrains Mono',monospace">${totalAmount} 亿元</b>
            <span style="font-size:11px;color:${parseFloat(totalAmount) >= 15000 ? '#cf222e' : 'var(--sys-text-sub, #909399)'}">${parseFloat(totalAmount) >= 15000 ? '🔥 量能充沛' : '缩量博弈'}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.renderMarketEmotionThermometer = renderMarketEmotionThermometer;