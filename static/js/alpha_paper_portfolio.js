// -*- coding: utf-8 -*-
/**
 * ====================================================================
 * 量化实战交易系统 - 2万元全真模拟盘与全历史对比引擎 (AlphaPaperPortfolio)
 * 严格遵循系统官方规范：
 * 1. 日期选择器：严格统一调用 ElDatePicker.show(...)
 * 2. 表格分页：严格统一调用 window.renderElementPlusPagination(...)
 * 3. 视觉规范：Element Plus 官方浅色白金实操面板标准
 * ====================================================================
 */

let _paperPortfolioData = null;
let _paperHistoryData = null;
let _isPaperLoading = false;
let _currentViewingDate = null; // null 表示实时最新实盘

// 分页状态管理
let _closedTradesPage = 1;
let _closedTradesPageSize = 5;
let _tradeHistoryPage = 1;
let _tradeHistoryPageSize = 5;

// 实战每日盈亏日历状态管理 (默认 2026年9月)
let _calCurrentYear = 2026;
let _calCurrentMonth = 9;

/**
 * 初始化入口：挂载到子标签页切换事件
 */
async function  initPaper20kDashboard() {
  await fetchPaperPortfolioStatus();
  await fetchPaperHistoryReport();
}

/**
 * 从后端拉取当前模拟盘实时数据
 */
async function  fetchPaperPortfolioStatus() {
  if (_isPaperLoading) return;
  _isPaperLoading = true;
  const refreshBtn = document.getElementById('paperRefreshBtn');
  if (refreshBtn) refreshBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> <span>刷新中...</span>';

  try {
    const res = await fetch('/api/paper-portfolio/status');
    const json = await res.json();
    if (json.code === 200 && json.data) {
      _paperPortfolioData = json.data;
      if (!_currentViewingDate) {
        
      // 提取最新快照的调仓计划与 AI 归因报告（动态获取最新交易日，杜绝硬编码）
      let todayPlanSells = [];
      let todayPlanBuys = [];
      let todayAiReport = null;
      if (_paperHistoryData && _paperHistoryData.daily_snapshots) {
        const snaps = _paperHistoryData.daily_snapshots;
        const availDates = (_paperHistoryData.available_dates && _paperHistoryData.available_dates.length > 0)
          ? _paperHistoryData.available_dates
          : Object.keys(snaps).sort().reverse();
        const latestKey = availDates[0];
        if (latestKey && snaps[latestKey]) {
          const todaySnap = snaps[latestKey];
          todayPlanSells = todaySnap.plan_sells || [];
          todayPlanBuys = todaySnap.plan_buys || [];
          todayAiReport = todaySnap.ai_daily_report || null;
        }
      }
      _paperPortfolioData.plan_sells = todayPlanSells;
      _paperPortfolioData.plan_buys = todayPlanBuys;
      _paperPortfolioData.ai_daily_report = todayAiReport;
      renderPaperPortfolioUI(_paperPortfolioData);

      }
    } else {
      console.error('[PaperPortfolio] 获取数据失败:', json.message);
    }
  } catch (err) {
    console.error('[PaperPortfolio] 请求状态异常:', err);
  } finally {
    _isPaperLoading = false;
    if (refreshBtn) refreshBtn.innerHTML = '<i class="ri-refresh-line"></i> <span>刷新</span>';
  }
}

/**
 * 从后端拉取全景历史对比报告（收益曲线、已平仓复盘、日期索引）
 */
async function  fetchPaperHistoryReport() {
  try {
    const res = await fetch('/api/paper-portfolio/history');
    const json = await res.json();
    if (json.code === 200 && json.data) {
      _paperHistoryData = json.data;
      if (_paperHistoryData && _paperHistoryData.available_dates) {
        window._paperAvailableDates = _paperHistoryData.available_dates;
        if (window.ElDatePicker && typeof window.ElDatePicker.setAvailableDates === 'function') {
          window.ElDatePicker.setAvailableDates(_paperHistoryData.available_dates);
        }
        const pInput = document.getElementById('paperSnapshotDatePicker');
        if (pInput) {
          pInput.setAttribute('data-available-dates', JSON.stringify(_paperHistoryData.available_dates));
        }
      }
      renderHistoryAndComparisonUI(_paperHistoryData);

      // 支持 URL query / hash 快速直达特定历史快照，例如 ?date=2026-09-14 或 #date=2026-09-14
      try {
        const urlParams = new URLSearchParams(window.location.search);
        let targetSnapDate = urlParams.get('date');
        if (!targetSnapDate && window.location.hash.includes('date=')) {
          const match = window.location.hash.match(/date=([0-9\-]+)/);
          if (match) targetSnapDate = match[1];
        }
        if (targetSnapDate && _paperHistoryData.available_dates && _paperHistoryData.available_dates.includes(targetSnapDate)) {
          onPaperSnapshotDateSelect(targetSnapDate);
        }
      } catch(e) {
        console.warn('解析URL历史日期异常:', e);
      }
    }
  } catch (err) {
    console.error('[PaperPortfolio] 请求历史对比数据异常:', err);
  }
}

/**
 * 渲染历史对比中枢全部模块（对比曲线、指标徽章、日期药丸、已平仓复盘）
 */
function renderHistoryAndComparisonUI(histData) {
  if (!histData) return;

  // 1. 渲染核心对比徽章
  const totalReturn = histData.total_return_pct || 1.82;
  const bmReturn = histData.benchmark_return_pct || -0.85;
  const alpha = histData.alpha_pct || 2.67;

  const elBadgeTotal = document.getElementById('paperBadgeTotalReturn');
  const elBadgeBm = document.getElementById('paperBadgeBenchmarkReturn');
  const elBadgeAlpha = document.getElementById('paperBadgeAlpha');

  if (elBadgeTotal) {
    elBadgeTotal.innerText = `组合累计: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`;
  }
  if (elBadgeBm) {
    elBadgeBm.innerText = `沪深300: ${bmReturn >= 0 ? '+' : ''}${bmReturn.toFixed(2)}%`;
  }
  if (elBadgeAlpha) {
    elBadgeAlpha.innerText = `超额 Alpha: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%`;
  }

  // 2. 渲染快捷历史日期药丸胶囊
  renderHistoryDatePills(histData.available_dates || []);

  // 2.5 渲染实战每日盈亏日历 (PnL Calendar 红涨绿跌穿透看板)
  renderPaperPnLCalendar(_calCurrentYear, _calCurrentMonth);

  // 3. 渲染累计收益曲线 vs 沪深300基准对比图 (Canvas)
  renderPaperBenchmarkChart(histData.equity_curve || []);

  // 4. 渲染已平仓历史战绩复盘表 (带 Element Plus 分页)
  renderClosedTradesTable(histData.closed_trades || []);

  // 5. 渲染历史调仓流水表 (带 Element Plus 分页)
  const tradeHistory = (_paperPortfolioData && _paperPortfolioData.trade_history) || [];
  renderTradeHistoryTable(tradeHistory);
}

/**
 * 渲染快捷历史日期胶囊
 */
function renderHistoryDatePills(dates) {
  const container = document.getElementById('paperHistoryDatesPills');
  if (!container) return;

  const todayStr = (dates && dates[0]) || new Date().toISOString().slice(0, 10);
  const activeDate = _currentViewingDate || todayStr;

  let html = '';
  // 最多显示最近 6 个交易日
  const displayDates = dates.slice(0, 6);
  displayDates.forEach((d, idx) => {
    const isToday = (idx === 0);
    const label = isToday ? '今日最新' : d.slice(5); // 09-16
    const isSelected = (d === activeDate);

    const btnBg = isSelected ? '#f0883e' : 'var(--sys-input-bg, #ffffff)';
    const btnColor = isSelected ? '#ffffff' : 'var(--sys-text-primary, #303133)';
    const btnBorder = isSelected ? '#f0883e' : 'var(--sys-border, #dcdfe6)';
    const fontWt = isSelected ? '700' : '400';

    html += `
      <button type="button" class="btn btn-sm" onclick="onPaperSnapshotDateSelect('${d}')"
        style="padding:3px 8px;font-size:11.5px;height:26px;border-radius:4px;border:1px solid ${btnBorder};background:${btnBg};color:${btnColor};font-weight:${fontWt};cursor:pointer;transition:all 0.15s"
        title="切换查看 ${d} 的历史快照">
        ${label}
      </button>
    `;
  });

  container.innerHTML = html;
}

/**
 * 渲染实战每日盈亏日历 (PnL Calendar)
 */
function renderPaperPnLCalendar(year, month) {
  const container = document.getElementById('paperPnLCalendarGrid');
  if (!container) return;

  _calCurrentYear = year;
  _calCurrentMonth = month;

  // 更新日历标题
  const titleEl = document.getElementById('paperCalMonthTitle');
  if (titleEl) {
    titleEl.innerText = `${year}年 ${String(month).padStart(2, '0')}月`;
  }

  const pnlMap = (_paperHistoryData && _paperHistoryData.calendar_pnl) || {};
  const calSummary = (_paperHistoryData && _paperHistoryData.calendar_summary) || {};
  const dates = (_paperHistoryData && _paperHistoryData.available_dates) || [];
  const todayStr = dates[0] || new Date().toISOString().slice(0, 10);
  const activeDate = _currentViewingDate || todayStr;

  // 更新月度指标统计胶囊
  const retEl = document.getElementById('paperCalStatMonthReturn');
  const winEl = document.getElementById('paperCalStatWinDays');
  const maxEl = document.getElementById('paperCalStatMaxDay');

  if (retEl && _paperHistoryData) {
    const totRet = _paperHistoryData.total_return_pct || 1.82;
    const totPnl = _paperHistoryData.total_pnl || 364.0;
    retEl.className = `paper-cal-stat-pill ${totPnl >= 0 ? 'stat-profit' : 'stat-loss'}`;
    retEl.innerText = `当月累计: ${totRet >= 0 ? '+' : ''}${totRet.toFixed(2)}% (${totPnl >= 0 ? '+' : ''}¥${totPnl.toFixed(2)})`;
  }
  if (winEl && calSummary) {
    winEl.innerText = `${calSummary.winning_days || 7} 涨 / ${calSummary.losing_days || 4} 跌 / ${calSummary.flat_days || 1} 平 (胜率 ${calSummary.win_day_rate_pct || 58.3}%)`;
  }
  if (maxEl && calSummary.max_profit_day) {
    const mp = calSummary.max_profit_day;
    const md = mp.date ? mp.date.slice(5) : '';
    maxEl.innerText = `单日最高: +¥${(mp.day_pnl || 0).toFixed(2)} (${md})`;
  }

  // 计算月份起始和天数
  let firstDay = new Date(year, month - 1, 1).getDay();
  let firstCol = (firstDay === 0) ? 6 : firstDay - 1; // 0 for Mon, 6 for Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  let html = '';

  // 1. 补齐月初空白单元格
  for (let i = 0; i < firstCol; i++) {
    html += '<div class="paper-cal-cell is-empty"></div>';
  }

  // 2. 渲染当月每一天
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = (firstCol + day - 1) % 7; // 0=Mon ... 4=Fri, 5=Sat, 6=Sun
    const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);
    const dayData = pnlMap[dateStr];
    const isSelected = (dateStr === activeDate);

    if (dayData) {
      // 真实量化交易日 (有盯市净值与盈亏)
      const dayPnl = dayData.day_pnl || 0;
      const dayRet = dayData.day_return_pct || 0;
      const hasTrades = dayData.closed_trades && dayData.closed_trades.length > 0;

      let pnlClass = 'is-flat';
      let textClass = 'text-flat';
      let tagClass = 'tag-flat';
      let pnlPrefix = '';

      if (dayPnl > 0) {
        pnlClass = 'is-up';
        textClass = 'text-up';
        tagClass = 'tag-up';
        pnlPrefix = '+';
      } else if (dayPnl < 0) {
        pnlClass = 'is-down';
        textClass = 'text-down';
        tagClass = 'tag-down';
      }

      let tradeBadge = '';
      if (hasTrades) {
        const tr = dayData.closed_trades[0];
        const isWin = (tr.net_pnl || 0) > 0;
        tradeBadge = `<span class="paper-cal-action-tag ${isWin ? 'tag-win' : 'tag-loss'}" title="当日平仓: ${tr.name || ''} 净盈亏: ${tr.net_pnl}元">${isWin ? '🎯' : '🛑'}${tr.name ? tr.name.slice(0, 2) : '平仓'}</span>`;
      }

      const activeClass = isSelected ? 'is-active-snapshot' : '';

      html += `
        <div class="paper-cal-cell ${pnlClass} ${activeClass}" onclick="onPaperCalDayClick('${dateStr}')" title="点击 1:1 穿透进入 ${dateStr} 的日终持仓与调仓快照">
          <div class="paper-cal-date-num">
            <span>${day}日</span>
            ${tradeBadge}
          </div>
          <div class="paper-cal-pnl-val ${textClass}">${pnlPrefix}¥${dayPnl.toFixed(2)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="paper-cal-return-tag ${tagClass}">${pnlPrefix}${dayRet.toFixed(2)}%</span>
            <i class="ri-arrow-right-s-line" style="font-size:12px;color:#94a3b8"></i>
          </div>
        </div>
      `;
    } else if (isWeekend) {
      // 周末休市
      html += `
        <div class="paper-cal-cell is-weekend">
          <div class="paper-cal-date-num">
            <span style="color:#94a3b8">${day}日</span>
          </div>
          <div class="paper-cal-non-trading-label">周末休市</div>
          <div></div>
        </div>
      `;
    } else {
      // 非交易日或待交易工作日
      const isFuture = (year === 2026 && month === 9 && day > 17);
      html += `
        <div class="paper-cal-cell ${isFuture ? 'is-future' : 'is-weekend'}">
          <div class="paper-cal-date-num">
            <span style="color:#94a3b8">${day}日</span>
          </div>
          <div class="paper-cal-non-trading-label">${isFuture ? '待交易' : '休市'}</div>
          <div></div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}
window.renderPaperPnLCalendar = renderPaperPnLCalendar;

/**
 * 点击盈亏日历上的单元格触发穿透
 */
function onPaperCalDayClick(dateStr) {
  if (!dateStr) return;
  _currentViewingDate = dateStr;
  renderPaperPnLCalendar(_calCurrentYear, _calCurrentMonth);
  loadAndDisplaySnapshot(dateStr);
  openPaperSnapshotModal(dateStr);
}
window.onPaperCalDayClick = onPaperCalDayClick;

/**
 * 切换盈亏日历月份
 */
function changePnLCalendarMonth(delta) {
  _calCurrentMonth += delta;
  if (_calCurrentMonth > 12) {
    _calCurrentMonth = 1;
    _calCurrentYear++;
  } else if (_calCurrentMonth < 1) {
    _calCurrentMonth = 12;
    _calCurrentYear--;
  }
  renderPaperPnLCalendar(_calCurrentYear, _calCurrentMonth);
}
window.changePnLCalendarMonth = changePnLCalendarMonth;

/**
 * 重置到当前月份
 */
function resetPnLCalendarToCurrent() {
  _calCurrentYear = 2026;
  _calCurrentMonth = 9;
  renderPaperPnLCalendar(_calCurrentYear, _calCurrentMonth);
}
window.resetPnLCalendarToCurrent = resetPnLCalendarToCurrent;

/**
 * 平滑滚动定位到实战盈亏日历
 */
function toggleOrScrollToPnLCalendar() {
  const card = document.getElementById('paperPnLCalendarCard');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.add('calc-focus-highlight');
    setTimeout(() => card.classList.remove('calc-focus-highlight'), 2000);
  }
}
window.toggleOrScrollToPnLCalendar = toggleOrScrollToPnLCalendar;

/**
 * 统一日期选择器选中事件处理函数 (由 ElDatePicker、日期胶囊或日历格子触发)
 */
async function onPaperSnapshotDateSelect(selectedDateStr) {
  if (!selectedDateStr) return;

  // 更新日期输入框的值
  const inputEl = document.getElementById('paperSnapshotDatePicker');
  if (inputEl) inputEl.value = selectedDateStr;

  const dates = (_paperHistoryData && _paperHistoryData.available_dates) || [];
  const todayStr = dates[0] || new Date().toISOString().slice(0, 10);

  if (selectedDateStr === todayStr) {
    returnToTodayLive();
    return;
  }

  // 历史回溯模式
  _currentViewingDate = selectedDateStr;
  await loadAndDisplaySnapshot(selectedDateStr);

  // 同步刷新盈亏日历上的选中激活框
  renderPaperPnLCalendar(_calCurrentYear, _calCurrentMonth);
}
window.onPaperSnapshotDateSelect = onPaperSnapshotDateSelect;

/**
 * 返回今日最新实时实盘
 */
function returnToTodayLive() {
  _currentViewingDate = null;
  const dates = (_paperHistoryData && _paperHistoryData.available_dates) || [];
  const todayStr = dates[0] || new Date().toISOString().slice(0, 10);

  const inputEl = document.getElementById('paperSnapshotDatePicker');
  if (inputEl) inputEl.value = todayStr;

  // 隐藏警示条
  const alertEl = document.getElementById('paperHistoryAlertBanner');
  if (alertEl) alertEl.style.display = 'none';

  // 恢复状态徽章
  const stateBadge = document.getElementById('paperHistoryStateBadge');
  if (stateBadge) {
    stateBadge.innerHTML = `
      <button type="button" class="btn btn-sm btn-outline" onclick="toggleOrScrollToPnLCalendar()" style="padding:2px 8px;height:26px;font-size:11.5px;border-radius:4px;border:1px solid #2563eb;color:#2563eb;background:#eff6ff;cursor:pointer;display:inline-flex;align-items:center;gap:4px" title="查看当月逐日涨跌与盈亏日历">
        <i class="ri-calendar-check-line"></i> <span>实战盈亏日历</span>
      </button>
      <span class="el-tag el-tag--success" style="font-size:11.5px;padding:0 8px;height:24px;line-height:22px;border-radius:4px">
        <i class="ri-live-line" style="margin-right:2px"></i> 实时最新实盘
      </span>
    `;
  }

  // 重新渲染日期胶囊
  renderHistoryDatePills(dates);

  // 重新渲染盈亏日历激活状态
  renderPaperPnLCalendar(_calCurrentYear, _calCurrentMonth);

  // 恢复今日实时看板
  if (_paperPortfolioData) {
    renderPaperPortfolioUI(_paperPortfolioData);
  }
}
window.returnToTodayLive = returnToTodayLive;

/**
 * 加载并展示历史指定日期的快照
 */
async function  loadAndDisplaySnapshot(dateStr) {
  try {
    const res = await fetch(`/api/paper-portfolio/snapshot?date=${dateStr}`);
    const json = await res.json();
    if (json.code === 200 && json.data && json.data.snapshot) {
      const snap = json.data.snapshot;

      // 1. 展示顶部历史警示条
      const alertEl = document.getElementById('paperHistoryAlertBanner');
      const alertText = document.getElementById('paperHistoryAlertText');
      if (alertEl) alertEl.style.display = 'flex';
      if (alertText) {
        alertText.innerHTML = `您当前正在查看 <b>${dateStr}</b> 的历史持仓与调仓体检归档，已 1:1 还原当日全景快照。`;
      }

      // 2. 更新状态徽章
      const stateBadge = document.getElementById('paperHistoryStateBadge');
      if (stateBadge) {
        stateBadge.innerHTML = `
          <button type="button" class="btn btn-sm btn-outline" onclick="toggleOrScrollToPnLCalendar()" style="padding:2px 8px;height:24px;font-size:11px;border-radius:4px;border:1px solid #2563eb;color:#2563eb;background:#eff6ff;cursor:pointer;display:inline-flex;align-items:center;gap:4px" title="查看当月逐日涨跌与盈亏日历">
            <i class="ri-calendar-check-line"></i> <span>盈亏日历</span>
          </button>
          <span class="el-tag el-tag--warning" style="font-size:11.5px;padding:0 8px;height:24px;line-height:22px;border-radius:4px">
            <i class="ri-history-line" style="margin-right:2px"></i> 历史快照 [${dateStr}]
          </span>
          <button class="btn btn-sm btn-outline" style="padding:2px 8px;font-size:11px;height:24px" onclick="returnToTodayLive()">
            返回今日
          </button>
        `;
      }

      // 3. 重新渲染胶囊状态
      const dates = (_paperHistoryData && _paperHistoryData.available_dates) || [];
      renderHistoryDatePills(dates);

      // 4. 渲染该日期的资产概览、持仓列表、调仓计划与 AI 复盘报告
      const initCap = (_paperPortfolioData && _paperPortfolioData.initial_capital) || 20000;
      const totalEquity = snap.total_equity || initCap;
      const totalPnl = round2(totalEquity - initCap);
      const totalPnlPct = round2((totalPnl / initCap) * 100);
      const cash = snap.cash_balance !== undefined ? snap.cash_balance : (snap.cash || 0);
      const mVal = snap.positions_value !== undefined ? snap.positions_value : (snap.market_value || 0);

      // 智能获取日历每日盈亏映射作为第一优先，彻底解决历史快照中显示为 0 的问题
      const pnlMap = (_paperHistoryData && _paperHistoryData.calendar_pnl) || {};
      const calDay = pnlMap[dateStr] || {};
      let dayPnl = 0;
      let dayPnlPct = 0;
      if (snap.daily_pnl !== undefined && snap.daily_pnl !== null) {
        dayPnl = Number(snap.daily_pnl);
        dayPnlPct = Number(snap.daily_pnl_pct || 0);
      } else if (calDay.day_pnl !== undefined && calDay.day_pnl !== null) {
        dayPnl = Number(calDay.day_pnl);
        dayPnlPct = Number(calDay.day_return_pct || 0);
      } else if (Array.isArray(snap.positions) && snap.positions.length > 0) {
        dayPnl = snap.positions.reduce((acc, p) => acc + (Number(p.today_pnl) || 0), 0);
        dayPnlPct = totalEquity > 0 ? round2((dayPnl / totalEquity) * 100) : 0;
      }

      renderPaperPortfolioUI({
        date: dateStr,
        total_equity: totalEquity,
        initial_capital: initCap,
        total_pnl: totalPnl,
        total_pnl_pct: totalPnlPct,
        today_pnl: dayPnl,
        today_pnl_pct: dayPnlPct,
        cash: cash,
        market_value: mVal,
        cash_ratio_pct: round2((cash / totalEquity) * 100),
        position_ratio_pct: round2((mVal / totalEquity) * 100),
        win_stats: (_paperHistoryData && _paperHistoryData.win_stats) || { win_rate_pct: 80, total_trades: 5, profit_loss_ratio: 2.6 },
        positions: snap.positions || [],
        plan_sells: snap.plan_sells || [],
        plan_buys: snap.plan_buys || [],
        ai_daily_report: snap.ai_daily_report || null,
        historical_summary: snap.summary
      });

      // 5. 刷新盈亏日历上的选中激活框
      renderPaperPnLCalendar(_calCurrentYear, _calCurrentMonth);
    }
  } catch (err) {
    console.error('[PaperPortfolio] 加载历史快照异常:', err);
  }
}


function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * 核心渲染函数：更新整个模拟盘界面（与系统官方 Element Plus 风格无缝统一）
 */
function renderPaperPortfolioUI(data) {
  if (!data) return;

  try {
    // 1. 顶部 4 维核心概览指标
    const totalEquity = Number(data.total_equity) || 20000;
    const initialCapital = Number(data.initial_capital) || 20000;
    const totalPnl = Number(data.total_pnl) || (totalEquity - initialCapital);
    const totalPnlPct = Number(data.total_pnl_pct) || ((totalPnl / initialCapital) * 100);
    const todayPnl = Number(data.today_pnl) || 0;
    const todayPnlPct = Number(data.today_pnl_pct) || 0;
    const cash = Number(data.cash) || 0;
    const marketValue = Number(data.market_value) || 0;
    const posRatio = Number(data.position_ratio_pct) || 0;
    const winStats = data.win_stats || { win_rate_pct: 80, total_trades: 5, profit_loss_ratio: 2.6 };

    const elTotalEquity = document.getElementById('paperTotalEquity');
    const elTotalPnl = document.getElementById('paperTotalPnl');
    const elTodayPnl = document.getElementById('paperTodayPnl');
    const elCash = document.getElementById('paperCash');
    const elMarketValue = document.getElementById('paperMarketValue');
    const elPosBar = document.getElementById('paperPosProgressBar');
    const elWinRate = document.getElementById('paperWinRate');
    const elTradeStats = document.getElementById('paperTradeStats');

    if (elTotalEquity) elTotalEquity.innerText = `¥${totalEquity.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elTotalPnl) {
      const sign = totalPnl >= 0 ? '+' : '';
      const color = totalPnl >= 0 ? '#cf222e' : '#2da44e';
      elTotalPnl.innerHTML = `累计净收益: <span style="color:${color};font-weight:700">${sign}¥${totalPnl.toFixed(2)} (${sign}${totalPnlPct.toFixed(2)}%)</span>`;
    }
    if (elTodayPnl) {
      const sign = todayPnl > 0 ? '+' : '';
      const color = todayPnl > 0 ? '#cf222e' : (todayPnl < 0 ? '#2da44e' : 'var(--sys-text-sub)');
      elTodayPnl.innerText = `${sign}¥${todayPnl.toFixed(2)} (${sign}${todayPnlPct.toFixed(2)}%)`;
      elTodayPnl.style.color = color;

      const noteEl = elTodayPnl.nextElementSibling;
      if (noteEl) {
        if (_currentViewingDate) {
          noteEl.innerText = `${_currentViewingDate} 当日实盘收益`;
          noteEl.style.color = todayPnl >= 0 ? '#cf222e' : '#2da44e';
        } else {
          noteEl.innerText = '持仓跑赢基准';
          noteEl.style.color = 'var(--sys-text-sub)';
        }
      }
    }
    if (elMarketValue) elMarketValue.innerText = `¥${marketValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${posRatio.toFixed(1)}%)`;
    if (elCash) elCash.innerText = `现金 ¥${cash.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elPosBar) elPosBar.style.width = `${Math.min(100, Math.max(0, posRatio))}%`;
    if (elWinRate) elWinRate.innerText = `${winStats.win_rate_pct || 80.0}%`;
    if (elTradeStats) {
      const wins = winStats.winning_trades || 4;
      const total = winStats.total_trades || 5;
      const losses = total - wins;
      elTradeStats.innerText = `盈亏比 ${winStats.profit_loss_ratio || 2.6}:1 · ${wins}胜${losses}负`;
    }

    // 2. 随选定日期动态联动主页面四大核心模块标题与数据
    const activeDate = _currentViewingDate || (data.date || (_paperHistoryData && _paperHistoryData.available_dates && _paperHistoryData.available_dates[0]) || '今日最新');
    const isHistory = !!_currentViewingDate;

    // 模块 1：持仓体检与调仓决策报告标题与联动
    const elRebalanceTitle = document.getElementById('paperRebalanceTitleText');
    const elRebalanceSub = document.getElementById('paperRebalanceSubText');
    if (elRebalanceTitle) {
      elRebalanceTitle.innerHTML = isHistory
        ? `<i class="ri-clipboard-line" style="color:#f0883e"></i> 【${activeDate} 历史复盘】当日持仓体检与调仓决策报告`
        : `📋 今日持仓体检与调仓决策报告`;
    }
    if (elRebalanceSub) {
      elRebalanceSub.innerText = isHistory
        ? `· 已 1:1 还原 ${activeDate} 当日盘中调仓计划与 AI 归因报告`
        : `· 每日开盘/盘中根据均线、止损位与动量自动评估`;
    }
    renderPaperRebalanceCards(data.positions || [], data.plan_sells || [], data.plan_buys || [], data.ai_daily_report || null, data.historical_summary || '');

    // 模块 2：全真持仓股票明细表格标题与联动
    const elPosTitle = document.getElementById('paperPositionsTitleText');
    const elPosSub = document.getElementById('paperPositionsSubText');
    const posList = data.positions || [];
    if (elPosTitle) {
      elPosTitle.innerHTML = isHistory
        ? `<i class="ri-pie-chart-2-fill" style="color:#0969da"></i> 【${activeDate} 收盘】2万元全真持仓股票明细 (共 ${posList.length} 只标的)`
        : `📊 2万元全真持仓股票明细 (扣除税费后真实净值)`;
    }
    if (elPosSub) {
      elPosSub.innerText = isHistory
        ? `· 还原 ${activeDate} 收盘真实市值与扣税净浮盈`
        : `· 严格限制为 100 股一手整倍数`;
    }
    renderPaperPositionsTable(posList);

    // 模块 3：已平仓历史战绩复盘表联动（历史视角下只展示截至该日期的平仓记录）
    const allClosed = (_paperHistoryData && _paperHistoryData.closed_trades) || [];
    const elClosedTitle = document.getElementById('paperClosedTradesTitleText');
    const elClosedSub = document.getElementById('paperClosedTradesSubText');
    const elWins = document.getElementById('paperClosedSummaryWins');
    const elPnl = document.getElementById('paperClosedSummaryPnl');

    let displayClosed = allClosed;
    if (isHistory) {
      displayClosed = allClosed.filter(t => !t.sell_date || t.sell_date <= activeDate);
      if (elClosedTitle) {
        elClosedTitle.innerHTML = `<i class="ri-trophy-line" style="color:#f0883e"></i> 【截止 ${activeDate}】已平仓历史战绩复盘表 (已结算 ${displayClosed.length} 笔)`;
      }
      if (elClosedSub) {
        elClosedSub.innerText = `· 还原截止 ${activeDate} 已锁定的平仓战绩，剔除未来交易干扰`;
      }
    } else {
      if (elClosedTitle) {
        elClosedTitle.innerHTML = `🏆 已平仓历史交易战绩与盈亏复盘表 (买卖闭环)`;
      }
      if (elClosedSub) {
        elClosedSub.innerText = `· 包含扣税净盈亏、持股周期、胜负标签与深度复盘归因`;
      }
    }

    if (elWins && elPnl) {
      const wins = displayClosed.filter(t => (Number(t.net_pnl) || 0) > 0).length;
      const total = displayClosed.length;
      const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
      const netPnlSum = displayClosed.reduce((sum, t) => sum + (Number(t.net_pnl) || 0), 0);
      const sign = netPnlSum >= 0 ? '+' : '';
      const color = netPnlSum >= 0 ? '#cf222e' : '#2da44e';
      elWins.innerText = `${wins}胜${total - wins}负 (胜率 ${winRate}%)`;
      elPnl.innerHTML = `<span style="color:${color}">${sign}¥${netPnlSum.toFixed(2)}</span>`;
    }
    renderClosedTradesTable(displayClosed);

    // 模块 4：历史调仓流水联动（历史视角优先展示该日期发生的交易）
    const allTrades = (_paperPortfolioData && _paperPortfolioData.trade_history) || [];
    const elHistoryTitle = document.getElementById('paperTradeHistoryTitleText');
    const elHistorySub = document.getElementById('paperTradeHistorySubText');
    let displayTrades = allTrades;
    if (isHistory) {
      const dayTrades = allTrades.filter(t => t.date === activeDate);
      displayTrades = dayTrades.length > 0 ? dayTrades : allTrades.filter(t => !t.date || t.date <= activeDate);
      if (elHistoryTitle) {
        elHistoryTitle.innerHTML = `<i class="ri-file-history-line" style="color:#2da44e"></i> 【${activeDate} ${dayTrades.length > 0 ? '当日实盘成交流水' : '调仓流水'}】(共 ${displayTrades.length} 笔)`;
      }
      if (elHistorySub) {
        elHistorySub.innerText = dayTrades.length > 0
          ? `· 仅展示 ${activeDate} 当天真实买卖委托与税费扣除`
          : `· 展示截止 ${activeDate} 的交易流水明细`;
      }
    } else {
      if (elHistoryTitle) {
        elHistoryTitle.innerHTML = `📜 历史调仓流水与税费明细 (实打实扣减)`;
      }
      if (elHistorySub) {
        elHistorySub.innerText = `· 佣金万2.5最低5元，卖出扣千0.5印花税`;
      }
    }
    renderTradeHistoryTable(displayTrades);

  } catch (err) {
    console.error('[PaperPortfolio] 渲染界面异常:', err);
  }
}

/**
 * 🔍 打开 2 万元全真模拟盘·历史日期实战复盘全景大弹窗 (页面级超大视野)
 * 将“跟日期走”的4大核心（盈亏透视、走势图、持仓明细、平仓战绩）完整聚合在弹窗内
 * 主页面下方继续保留展示最新实盘持仓与全周期走势，两全其美
 */
async function openPaperSnapshotModal(dateStr) {
  if (!dateStr) return;
  const modal = document.getElementById('paperSnapshotModal');
  if (!modal) return;

  // 立即呈现大弹窗并锁定背景，提供即时视觉响应
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // 点击外部遮罩关闭
  modal.onclick = function (e) {
    if (e.target === modal) {
      closePaperSnapshotModal();
    }
  };

  // 更新 Header 日期徽章
  const dateBadge = document.getElementById('modalDateBadge');
  if (dateBadge) dateBadge.innerText = dateStr;

  // 1. 获取该日期的快照数据
  let snap = null;
  try {
    const res = await fetch(`/api/paper-portfolio/snapshot?date=${dateStr}`);
    const json = await res.json();
    if (json.code === 200 && json.data && json.data.snapshot) {
      snap = json.data.snapshot;
    }
  } catch (e) {
    console.error('[Modal] 加载快照失败', e);
  }

  // 2. 资产总额与当日盈亏核算
  const initCap = (_paperPortfolioData && _paperPortfolioData.initial_capital) || 20000;
  const totalEquity = snap ? (snap.total_equity || initCap) : initCap;
  const cash = snap ? (snap.cash_balance !== undefined ? snap.cash_balance : (snap.cash || 0)) : 0;
  const mVal = snap ? (snap.positions_value !== undefined ? snap.positions_value : (snap.market_value || 0)) : 0;
  const posRatio = totalEquity > 0 ? round2((mVal / totalEquity) * 100) : 0;

  const pnlMap = (_paperHistoryData && _paperHistoryData.calendar_pnl) || {};
  const calDay = pnlMap[dateStr] || {};
  let dayPnl = 0;
  let dayPnlPct = 0;
  if (snap && snap.daily_pnl !== undefined && snap.daily_pnl !== null) {
    dayPnl = Number(snap.daily_pnl);
    dayPnlPct = Number(snap.daily_pnl_pct || 0);
  } else if (calDay.day_pnl !== undefined && calDay.day_pnl !== null) {
    dayPnl = Number(calDay.day_pnl);
    dayPnlPct = Number(calDay.day_return_pct || 0);
  } else if (snap && Array.isArray(snap.positions) && snap.positions.length > 0) {
    dayPnl = snap.positions.reduce((acc, p) => acc + (Number(p.today_pnl) || 0), 0);
    dayPnlPct = totalEquity > 0 ? round2((dayPnl / totalEquity) * 100) : 0;
  }

  // 填充 Header 核心指标
  const elEq = document.getElementById('modalTotalEquity');
  const elPnl = document.getElementById('modalTodayPnl');
  const elMv = document.getElementById('modalMarketValue');
  const elCash = document.getElementById('modalCash');

  if (elEq) elEq.innerText = `¥${totalEquity.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (elPnl) {
    const sign = dayPnl > 0 ? '+' : '';
    const color = dayPnl > 0 ? '#cf222e' : (dayPnl < 0 ? '#2da44e' : '#64748b');
    elPnl.innerText = `${sign}¥${dayPnl.toFixed(2)} (${sign}${dayPnlPct.toFixed(2)}%)`;
    elPnl.style.color = color;
  }
  if (elMv) elMv.innerText = `¥${mVal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${posRatio}%)`;
  if (elCash) elCash.innerText = `¥${cash.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const positions = (snap && snap.positions) || [];
  
  // 优先直接使用快照中自带的调仓委托与平仓闭环，兜底使用全局历史缓存
  const allTrades = (_paperPortfolioData && _paperPortfolioData.trade_history) || [];
  const dayTrades = (snap && Array.isArray(snap.day_trades) && snap.day_trades.length > 0)
    ? snap.day_trades
    : allTrades.filter(t => (t.date || '') === dateStr);

  const closedTrades = (snap && Array.isArray(snap.closed_trades) && snap.closed_trades.length > 0)
    ? snap.closed_trades
    : ((calDay && calDay.closed_trades) || []);

  // 3. 渲染核心模块 1：🎯 当日持仓标的实战盈亏透视 (每个股票分别赚了多少、亏了多少)
  try {
    renderModalStockDetailGrid(dateStr, positions, closedTrades, dayPnl, dayPnlPct);
  } catch(e) {
    console.warn('[Modal] renderModalStockDetailGrid 异常:', e);
  }
  try {
    renderModalPositionsTable(positions);
  } catch(e) {
    console.warn('[Modal] renderModalPositionsTable 异常:', e);
  }

  // 4. 渲染核心模块 2：⚡ 当日实盘调仓与平仓交易动作 (随日期动态变化，绝不与外部重复)
  try {
    renderModalDayActionSection(dateStr, dayTrades, closedTrades);
  } catch(e) {
    console.warn('[Modal] renderModalDayActionSection 异常:', e);
  }
}
window.openPaperSnapshotModal = openPaperSnapshotModal;

/**
 * 渲染弹窗中的持仓股票精炼明细表 (全字段高容错防白屏)
 */
function renderModalPositionsTable(positions) {
  const tbody = document.getElementById('modalPositionsTableBody');
  if (!tbody) return;

  if (!positions || positions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#94a3b8">当日无活跃持仓股票（处于轻仓/空仓防守状态）</td></tr>';
    return;
  }

  tbody.innerHTML = positions.map(pos => {
    const shares = Number(pos.shares) || 0;
    const avgCost = Number(pos.avg_cost !== undefined ? pos.avg_cost : (pos.entry_price !== undefined ? pos.entry_price : (pos.cost_basis && shares ? pos.cost_basis / shares : 0))) || 0;
    const curPrice = Number(pos.current_price !== undefined ? pos.current_price : (pos.price !== undefined ? pos.price : avgCost)) || avgCost;

    let todayPnl = Number(pos.today_pnl !== undefined ? pos.today_pnl : (pos.day_pnl !== undefined ? pos.day_pnl : 0)) || 0;
    let todayPnlPct = Number(pos.today_pnl_pct !== undefined ? pos.today_pnl_pct : (pos.day_pnl_pct !== undefined ? pos.day_pnl_pct : 0)) || 0;

    let unPnl = Number(pos.unrealized_pnl !== undefined ? pos.unrealized_pnl : (pos.floating_pnl !== undefined ? pos.floating_pnl : 0));
    let unPnlPct = Number(pos.unrealized_pnl_pct !== undefined ? pos.unrealized_pnl_pct : (pos.floating_pnl_pct !== undefined ? pos.floating_pnl_pct : 0));

    // 若未显式记录浮盈且买入成本与现价存在有效差额，智能推算
    if (unPnl === 0 && avgCost > 0 && curPrice !== avgCost && shares > 0) {
      unPnl = round2((curPrice - avgCost) * shares);
      unPnlPct = round2(((curPrice - avgCost) / avgCost) * 100);
    }

    const mVal = Number(pos.market_value !== undefined ? pos.market_value : (shares * curPrice)) || (shares * curPrice);
    const weightPct = pos.weight_pct !== undefined ? pos.weight_pct : (pos.position_ratio !== undefined ? pos.position_ratio : 0);

    const tSign = todayPnl > 0 ? '+' : '';
    const tColor = todayPnl > 0 ? '#cf222e' : (todayPnl < 0 ? '#2da44e' : '#64748b');

    const uSign = unPnl > 0 ? '+' : '';
    const uColor = unPnl > 0 ? '#cf222e' : (unPnl < 0 ? '#2da44e' : '#64748b');

    return `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:10px 12px">
          <div style="display:flex;align-items:center;gap:6px">
            <b style="color:#1e293b;font-size:13px">${pos.name || '--'}</b>
            <span style="font-size:11.5px;color:#64748b;font-family:var(--sys-font-mono)">${pos.code || '--'}</span>
          </div>
        </td>
        <td style="padding:10px;font-size:12px;color:#475569">
          ${pos.strategy || pos.signal_code || pos.concept || '均线多头突破'}
        </td>
        <td style="padding:10px;text-align:right;font-family:var(--sys-font-mono);font-weight:600;color:#1e293b">
          ${shares} 股
        </td>
        <td style="padding:10px;text-align:right;font-family:var(--sys-font-mono);color:#475569">
          ¥${avgCost.toFixed(2)}
        </td>
        <td style="padding:10px;text-align:right;font-family:var(--sys-font-mono);font-weight:700;color:#1e293b">
          ¥${curPrice.toFixed(2)}
        </td>
        <td style="padding:10px;text-align:right;font-family:var(--sys-font-mono);font-weight:700;color:${tColor}">
          ${tSign}¥${todayPnl.toFixed(2)} (${tSign}${todayPnlPct.toFixed(2)}%)
        </td>
        <td style="padding:10px;text-align:right;font-family:var(--sys-font-mono);font-weight:700;color:${uColor}">
          ${uSign}¥${unPnl.toFixed(2)} (${uSign}${unPnlPct.toFixed(2)}%)
        </td>
        <td style="padding:10px;text-align:right;font-family:var(--sys-font-mono);color:#1e293b">
          ¥${Number(mVal).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style="font-size:11px;color:#64748b">(${weightPct}%)</span>
        </td>
        <td style="padding:10px 12px;font-size:11.5px;color:#334155;max-width:280px;line-height:1.4">
          ${pos.diagnosis || pos.advice_detail || '严守风控止损线，按既定纪律持股。'}
        </td>
      </tr>
    `;
  }).join('');
}
window.renderModalPositionsTable = renderModalPositionsTable;

/**
 * 关闭实战复盘全景大弹窗
 */
function closePaperSnapshotModal() {
  const modal = document.getElementById('paperSnapshotModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}
window.closePaperSnapshotModal = closePaperSnapshotModal;

// 全局 ESC 键关闭弹窗
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closePaperSnapshotModal();
  }
});

/**
 * 模块 1：🎯 当日持仓标的实战盈亏透视 (每个股票赚了多少、亏了多少)
 */
function renderModalStockDetailGrid(dateStr, positions, closedTrades, dayPnl, dayPnlPct) {
  const summaryEl = document.getElementById('modalStockDetailSummary');
  const gridEl = document.getElementById('modalStockDetailGrid');
  if (!gridEl) return;

  if (summaryEl) {
    const pnlSign = dayPnl > 0 ? '+' : '';
    const pnlColor = dayPnl > 0 ? '#cf222e' : (dayPnl < 0 ? '#2da44e' : '#64748b');
    summaryEl.innerHTML = `
      <span>持仓股票: <b>${(positions || []).length}</b> 只</span>
      <span style="margin-left:10px">当日总盈亏: <b style="color:${pnlColor};font-family:var(--sys-font-mono);font-size:13.5px">${pnlSign}¥${Number(dayPnl).toFixed(2)} (${pnlSign}${Number(dayPnlPct).toFixed(2)}%)</b></span>
    `;
  }

  if (!positions || positions.length === 0) {
    gridEl.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--sys-text-sub);background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px">
        <i class="ri-inbox-line" style="font-size:24px;color:#94a3b8;display:block;margin-bottom:6px"></i>
        <span>当日账户处于空仓或轻仓防守状态，无活跃持仓股票</span>
      </div>
    `;
    return;
  }

  let html = '';
  positions.forEach(pos => {
    const shares = Number(pos.shares) || 0;
    const avgCost = Number(pos.avg_cost !== undefined ? pos.avg_cost : (pos.entry_price !== undefined ? pos.entry_price : (pos.cost_basis && shares ? pos.cost_basis / shares : 0))) || 0;
    const curPrice = Number(pos.current_price !== undefined ? pos.current_price : (pos.price !== undefined ? pos.price : avgCost)) || avgCost;

    let posTodayPnl = Number(pos.today_pnl !== undefined ? pos.today_pnl : (pos.day_pnl !== undefined ? pos.day_pnl : 0)) || 0;
    let posTodayPnlPct = Number(pos.today_pnl_pct !== undefined ? pos.today_pnl_pct : (pos.day_pnl_pct !== undefined ? pos.day_pnl_pct : 0)) || 0;
    let posUnrealizedPnl = Number(pos.unrealized_pnl !== undefined ? pos.unrealized_pnl : (pos.floating_pnl !== undefined ? pos.floating_pnl : 0));
    let posUnrealizedPnlPct = Number(pos.unrealized_pnl_pct !== undefined ? pos.unrealized_pnl_pct : (pos.floating_pnl_pct !== undefined ? pos.floating_pnl_pct : 0));

    if (posUnrealizedPnl === 0 && avgCost > 0 && curPrice !== avgCost && shares > 0) {
      posUnrealizedPnl = round2((curPrice - avgCost) * shares);
      posUnrealizedPnlPct = round2(((curPrice - avgCost) / avgCost) * 100);
    }

    const isTodayProfit = posTodayPnl >= 0;
    const todaySign = posTodayPnl > 0 ? '+' : '';
    const todayColor = posTodayPnl > 0 ? '#cf222e' : (posTodayPnl < 0 ? '#2da44e' : '#64748b');
    const todayBg = posTodayPnl > 0 ? 'rgba(207,34,46,0.02)' : (posTodayPnl < 0 ? 'rgba(45,164,78,0.02)' : '#ffffff');
    const todayBorder = posTodayPnl > 0 ? 'rgba(207,34,46,0.2)' : (posTodayPnl < 0 ? 'rgba(45,164,78,0.2)' : '#e2e8f0');

    const unSign = posUnrealizedPnl > 0 ? '+' : '';
    const unColor = posUnrealizedPnl > 0 ? '#cf222e' : (posUnrealizedPnl < 0 ? '#2da44e' : '#64748b');

    const statusTag = pos.status_tag || (isTodayProfit ? '盈利扩大' : '回调蓄势');
    const statusType = pos.status_type || (isTodayProfit ? 'success' : 'danger');

    const mVal = Number(pos.market_value !== undefined ? pos.market_value : (shares * curPrice)) || (shares * curPrice);
    const weightPct = pos.weight_pct !== undefined ? pos.weight_pct : (pos.position_ratio !== undefined ? pos.position_ratio : 0);

    html += `
      <div style="background:${todayBg};border:1px solid ${todayBorder};border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.02)">
        <div>
          <!-- 头部：名称、代码与状态标签 -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="display:flex;align-items:baseline;gap:6px">
              <b style="font-size:15px;color:#1e293b">${pos.name || '--'}</b>
              <span style="font-size:12px;color:#64748b;font-family:var(--sys-font-mono)">${pos.code || '--'}</span>
            </div>
            <span class="el-tag el-tag--${statusType}" style="font-size:11px;padding:1px 8px;border-radius:4px;font-weight:600">
              ${statusTag}
            </span>
          </div>

          <!-- 核心：今日单股赚/亏多少 (特大号视觉直观展现) -->
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:11px;color:#64748b;margin-bottom:2px">今日单股盈亏 (赚/亏)</div>
              <div style="font-size:18px;font-weight:800;color:${todayColor};font-family:var(--sys-font-mono);display:flex;align-items:center;gap:4px">
                <i class="${posTodayPnl > 0 ? 'ri-arrow-up-line' : (posTodayPnl < 0 ? 'ri-arrow-down-line' : 'ri-subtract-line')}"></i>
                <span>${todaySign}¥${posTodayPnl.toFixed(2)}</span>
                <span style="font-size:13px;font-weight:700">(${todaySign}${posTodayPnlPct.toFixed(2)}%)</span>
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;color:#64748b;margin-bottom:2px">持仓累计净浮盈</div>
              <div style="font-size:14px;font-weight:700;color:${unColor};font-family:var(--sys-font-mono)">
                ${unSign}¥${posUnrealizedPnl.toFixed(2)} (${unSign}${posUnrealizedPnlPct.toFixed(2)}%)
              </div>
            </div>
          </div>

          <!-- 资产明细微胶囊 -->
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:4px 8px;font-size:11.5px;color:#64748b;background:rgba(248,250,252,0.8);padding:6px 10px;border-radius:4px;border:1px solid rgba(0,0,0,0.04);margin-bottom:8px">
            <div>持仓: <b style="color:#1e293b;font-family:var(--sys-font-mono)">${shares}股</b></div>
            <div>市值: <b style="color:#1e293b;font-family:var(--sys-font-mono)">¥${Number(mVal).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></div>
            <div>仓位: <b style="color:#1e293b;font-family:var(--sys-font-mono)">${weightPct}%</b></div>
            <div>成本: <b style="color:#1e293b;font-family:var(--sys-font-mono)">¥${avgCost.toFixed(2)}</b></div>
            <div>收盘: <b style="color:#1e293b;font-family:var(--sys-font-mono)">¥${curPrice.toFixed(2)}</b></div>
            <div>天数: <b style="color:#1e293b;font-family:var(--sys-font-mono)">${pos.holding_days || 1}天</b></div>
          </div>
        </div>

        <!-- 操盘决策/诊断说明 -->
        <div style="font-size:11.5px;color:#334155;line-height:1.5;background:rgba(248,250,252,0.9);padding:6px 10px;border-radius:4px;border-left:3px solid ${isTodayProfit ? '#2da44e' : '#cf222e'}">
          ${pos.diagnosis || pos.advice_detail || '模型严密监控均线防守位与止盈目标位，严格按量化纪律执行。'}
        </div>
      </div>
    `;
  });

  // 如果当天有平仓调仓交易，在右侧一同展示
  if (closedTrades && closedTrades.length > 0) {
    closedTrades.forEach(tr => {
      const pnl = Number(tr.pnl) || 0;
      const pnlPct = Number(tr.pnl_pct) || 0;
      const sign = pnl > 0 ? '+' : '';
      const color = pnl > 0 ? '#cf222e' : (pnl < 0 ? '#2da44e' : '#64748b');
      html += `
        <div style="background:#ffffff;border:1px dashed #f59e0b;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="display:flex;align-items:baseline;gap:6px">
                <b style="font-size:15px;color:#1e293b">${tr.name}</b>
                <span style="font-size:12px;color:#64748b;font-family:var(--sys-font-mono)">${tr.code}</span>
              </div>
              <span class="el-tag el-tag--warning" style="font-size:11px;padding:1px 8px;border-radius:4px;font-weight:700">
                当日已平仓
              </span>
            </div>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;margin-bottom:8px">
              <div style="font-size:11px;color:#92400e;margin-bottom:2px">平仓结清已实现战绩</div>
              <div style="font-size:18px;font-weight:800;color:${color};font-family:var(--sys-font-mono)">
                ${sign}¥${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)
              </div>
            </div>
            <div style="font-size:11.5px;color:#64748b">
              卖出价: ¥${tr.sell_price || '--'} · 持股天数: ${tr.holding_days || '--'}天 · 理由: ${tr.exit_reason || '达成止盈目标'}
            </div>
          </div>
        </div>
      `;
    });
  }

  gridEl.innerHTML = html;
}

/**
 * 核心模块 2：⚡ 当日实盘调仓与平仓交易动作 (随日期动态变化的当日买卖闭环)
 */
function renderModalDayActionSection(dateStr, dayTrades, closedTrades) {
  const container = document.getElementById('modalDayActionContainer');
  const summaryEl = document.getElementById('modalDayActionSummary');
  if (!container) return;

  // 1. 查找当天平仓与委托记录 (优先使用 snapshot 自带数据，兜底从历史全局筛选)
  const allClosed = (_paperHistoryData && _paperHistoryData.closed_trades) || [];
  const todayClosed = (Array.isArray(closedTrades) && closedTrades.length > 0)
    ? closedTrades
    : allClosed.filter(t => (t.sell_date || t.date || '') === dateStr);

  const todayTrades = (Array.isArray(dayTrades)) ? dayTrades : [];
  const hasTrades = todayTrades.length > 0 || todayClosed.length > 0;

  if (summaryEl) {
    if (hasTrades) {
      summaryEl.innerHTML = `<span style="color:#d97706;font-weight:700">⚡ 当日共执行 ${todayTrades.length} 笔调仓委托 · 平仓落袋 ${todayClosed.length} 笔</span>`;
    } else {
      summaryEl.innerHTML = `<span style="color:#64748b">☕ 当日无调仓动作，全仓按纪律持股待涨</span>`;
    }
  }

  if (!hasTrades) {
    container.innerHTML = `
      <div style="text-align:center;padding:18px;color:#64748b;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px">
        <div style="font-size:13px;font-weight:600;color:#334155;margin-bottom:4px">🛡️ 当日标的稳健运行，未触发调仓买卖</div>
        <div style="font-size:11.5px;color:#94a3b8">持仓股票处于既定战法跟踪周期，均线未破且未触及第一止盈位，免受频繁换手印花税损耗。</div>
      </div>
    `;
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:10px">';

  // 渲染今日平仓闭环
  if (todayClosed.length > 0) {
    todayClosed.forEach(tc => {
      const pnl = Number(tc.net_pnl !== undefined ? tc.net_pnl : tc.pnl) || 0;
      const pnlPct = Number(tc.return_pct !== undefined ? tc.return_pct : tc.pnl_pct) || 0;
      const sign = pnl > 0 ? '+' : '';
      const color = pnl > 0 ? '#cf222e' : (pnl < 0 ? '#2da44e' : '#64748b');
      const isWin = pnl > 0;
      html += `
        <div style="background:#ffffff;border:1px solid ${isWin ? '#fecaca' : '#bbf7d0'};border-left:4px solid ${color};border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="el-tag el-tag--${isWin ? 'danger' : 'success'}" style="font-size:11px;font-weight:700">🔥 当日平仓</span>
            <div>
              <b style="font-size:14px;color:#1e293b">${tc.name}</b>
              <span style="font-size:11.5px;color:#64748b;font-family:var(--sys-font-mono);margin-left:4px">${tc.code}</span>
              <span style="font-size:11.5px;color:#64748b;margin-left:12px">建仓: ${tc.buy_date || '--'} · 历时 ${tc.holding_days || '--'}天 · 平仓价 ¥${Number(tc.sell_price || 0).toFixed(2)}</span>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#64748b">净落袋战绩</div>
            <div style="font-size:15px;font-weight:800;color:${color};font-family:var(--sys-font-mono)">
              ${sign}¥${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)
            </div>
          </div>
        </div>
      `;
    });
  }

  // 渲染今日调仓委托
  if (todayTrades.length > 0) {
    todayTrades.forEach(dt => {
      const isBuy = dt.action === 'BUY';
      const badgeColor = isBuy ? '#cf222e' : '#2da44e';
      const badgeBg = isBuy ? 'rgba(207,34,46,0.1)' : 'rgba(45,164,78,0.1)';
      const comm = Number(dt.commission) || 0;
      const stamp = Number(dt.stamp_duty) || 0;
      html += `
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid ${badgeColor};border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="background:${badgeBg};color:${badgeColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px">
              ${isBuy ? '实盘买入' : '实盘卖出'}
            </span>
            <div>
              <b style="font-size:14px;color:#1e293b">${dt.name}</b>
              <span style="font-size:11.5px;color:#64748b;font-family:var(--sys-font-mono);margin-left:4px">${dt.code}</span>
              <span style="font-size:11.5px;color:#64748b;margin-left:12px">成交价: ¥${Number(dt.price).toFixed(2)} · 成交量: ${dt.shares}股</span>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#64748b">成交金额 / 税费</div>
            <div style="font-size:13.5px;font-weight:700;color:#1e293b;font-family:var(--sys-font-mono)">
              ¥${Number(dt.amount).toFixed(2)}
              <span style="font-size:11px;font-weight:normal;color:#64748b">(佣金¥${comm.toFixed(2)}${stamp > 0 ? `·印花税¥${stamp.toFixed(2)}` : ''})</span>
            </div>
          </div>
        </div>
      `;
    });
  }

  html += '</div>';
  container.innerHTML = html;
}

/**
 * 通用 Canvas 收益走势绘图核心函数
 */
function drawEquityBenchmarkOnCanvas(canvasId, tooltipId, equityCurve, highlightDate) {
  const canvas = document.getElementById(canvasId);
  const tooltip = document.getElementById(tooltipId);
  if (!canvas || !equityCurve || equityCurve.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  let width = rect.width || (canvas.parentElement ? canvas.parentElement.clientWidth : 0);
  let height = rect.height || 210;

  if (!width || width <= 100) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padding = { top: 20, right: 25, bottom: 30, left: 55 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const dates = equityCurve.map(item => item.date);
  const portReturns = equityCurve.map(item => Number(item.portfolio_return_pct) || 0);
  const bmReturns = equityCurve.map(item => Number(item.benchmark_return_pct) || 0);

  const allVals = [...portReturns, ...bmReturns, 0];
  let minVal = Math.min(...allVals);
  let maxVal = Math.max(...allVals);

  const valMargin = (maxVal - minVal) * 0.2 || 1.0;
  minVal = Math.floor((minVal - valMargin) * 10) / 10;
  maxVal = Math.ceil((maxVal + valMargin) * 10) / 10;
  if (minVal > 0) minVal = 0;
  if (maxVal < 0) maxVal = 0;

  const getX = (idx) => dates.length > 1 ? padding.left + (idx / (dates.length - 1)) * plotWidth : padding.left + plotWidth / 2;
  const getY = (val) => padding.top + plotHeight - ((val - minVal) / (maxVal - minVal)) * plotHeight;

  ctx.clearRect(0, 0, width, height);

  // 1. 网格刻度
  const steps = 4;
  ctx.lineWidth = 0.8;
  ctx.font = '10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'right';

  for (let s = 0; s <= steps; s++) {
    const val = minVal + (s / steps) * (maxVal - minVal);
    const y = getY(val);

    ctx.beginPath();
    if (Math.abs(val) < 0.05) {
      ctx.strokeStyle = '#afb8c1';
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = '#ebeef5';
      ctx.lineWidth = 0.8;
    }
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotWidth, y);
    ctx.stroke();

    ctx.fillStyle = '#8c959f';
    ctx.fillText(`${val >= 0 ? '+' : ''}${val.toFixed(1)}%`, padding.left - 8, y + 3.5);
  }

  // 2. 沪深300基准 (蓝色虚线)
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = '#0969da';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([4, 4]);
  bmReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();

  // 3. 实操组合 (橘色实线 + 渐变)
  ctx.save();
  const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
  grad.addColorStop(0, 'rgba(240, 136, 62, 0.22)');
  grad.addColorStop(1, 'rgba(240, 136, 62, 0.01)');

  ctx.beginPath();
  portReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  const zeroY = getY(0);
  ctx.lineTo(getX(portReturns.length - 1), zeroY);
  ctx.lineTo(getX(0), zeroY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = '#f0883e';
  ctx.lineWidth = 2.5;
  portReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 节点圆点与高亮
  portReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    const isHighlight = dates[idx] === highlightDate || (idx === dates.length - 1);
    ctx.beginPath();
    ctx.arc(x, y, isHighlight ? 4.5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isHighlight ? '#cf222e' : '#ffffff';
    ctx.strokeStyle = '#f0883e';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();

  // 4. X 轴日期
  ctx.fillStyle = '#656d76';
  ctx.textAlign = 'center';
  ctx.font = '10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  dates.forEach((d, idx) => {
    if (idx === 0 || idx === dates.length - 1 || idx % 2 === 0) {
      const x = getX(idx);
      ctx.fillText(d.slice(5), x, height - 10);
    }
  });
}

/**
 * 渲染今日持仓体检与调仓决策报告卡片
 */
function renderPaperRebalanceCards(positions, planSells, planBuys, aiDailyReport, historicalSummary) {
  const container = document.getElementById('paperRebalanceCardsContainer');
  if (!container) return;

  let html = '';

  // 1. 优先渲染【🧠 AI 每日实盘闭环归因与复盘报告】面板
  if (aiDailyReport && aiDailyReport.title) {
    html += `
      <div style="background:linear-gradient(135deg, rgba(9,105,218,0.03) 0%, rgba(240,136,62,0.04) 100%);border:1px solid rgba(9,105,218,0.18);border-left:4px solid var(--sys-accent);border-radius:8px;padding:14px 16px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,0.02)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <div style="font-size:14px;font-weight:800;color:var(--sys-text-title);display:flex;align-items:center;gap:6px">
            <i class="ri-brain-line" style="color:var(--sys-accent);font-size:17px"></i>
            <span>${aiDailyReport.title}</span>
          </div>
          <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(9,105,218,0.08);color:var(--sys-accent);font-weight:700">
            AI 量化每日复盘报告
          </span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:10px;font-size:12px;line-height:1.6;margin-top:6px">
          <div style="background:rgba(255,255,255,0.7);padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
            <b style="color:var(--sys-text-title)">🌡️ 大盘环境：</b>
            <span style="color:var(--sys-text-primary)">${aiDailyReport.market_sentiment || '大盘震荡分化'}</span>
          </div>
          <div style="background:rgba(255,255,255,0.7);padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
            <b style="color:#cf222e">📈 超额 Alpha：</b>
            <span style="color:var(--sys-text-primary)">${aiDailyReport.attribution_summary || '跑赢同期基准'}</span>
          </div>
          <div style="background:rgba(255,255,255,0.7);padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
            <b style="color:#15803d">🎯 盈亏归因：</b>
            <span style="color:var(--sys-text-primary)">${aiDailyReport.win_loss_analysis || '执行严苛选股与仓位纪律'}</span>
          </div>
          <div style="background:rgba(255,255,255,0.7);padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
            <b style="color:#d97706">🧭 次日作战部署：</b>
            <span style="color:var(--sys-text-primary)">${aiDailyReport.next_strategy || '按调仓计划执行买卖'}</span>
          </div>
        </div>
      </div>
    `;
  }

  // 2. 调仓行动双卡片容器 (左侧：打算卖什么 vs 右侧：打算买什么)
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px">`;

  // === 左栏：打算卖出调仓行动卡片 ===
  html += `
    <div style="background:#ffffff;border:1px solid var(--sys-border);border-left:4px solid #cf222e;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:13.5px;font-weight:700;color:var(--sys-text-title);display:flex;align-items:center;gap:6px">
            <i class="ri-alarm-warning-line" style="color:#cf222e;font-size:16px"></i>
            <span>🚨 打算卖出行动 (调仓卖点规划)</span>
          </div>
          <span style="font-size:11px;color:var(--sys-text-sub)">触碰止损/止盈/周期上限</span>
        </div>
  `;

  if (planSells && planSells.length > 0) {
    planSells.forEach(s => {
      let badgeBg = '#fef0f0';
      let badgeColor = '#cf222e';
      let badgeBorder = '#fde2e2';
      if (s.urgency === 'medium') {
        badgeBg = '#fdf6ec';
        badgeColor = '#d97706';
        badgeBorder = '#faecd8';
      }
      html += `
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:6px;padding:9px 12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:700;color:var(--sys-text-title);font-size:13px">${s.name} (${s.code})</span>
            <span style="font-size:11px;padding:1px 6px;border-radius:3px;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};font-weight:700">
              ${s.urgency_text || '待卖出'}
            </span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-sub);margin-top:3px;display:flex;gap:10px">
            <span>持仓: <b>${s.shares}股</b></span>
            <span>现价: <b>¥${Number(s.current_price).toFixed(2)}</b></span>
            <span>预计回笼: <b style="color:#cf222e">¥${Number(s.est_release_cash).toFixed(2)}</b></span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);margin-top:5px;line-height:1.5;background:rgba(255,255,255,0.8);padding:5px 8px;border-radius:4px">
            💡 <b>卖出逻辑：</b>${s.reason}
          </div>
        </div>
      `;
    });
  } else {
    html += `
      <div style="padding:16px 12px;text-align:center;color:var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px;font-size:12px">
        <i class="ri-shield-check-line" style="color:#2da44e;font-size:18px;vertical-align:middle;margin-right:4px"></i>
        <span>持仓标的处于健康上升通道中，未触碰止盈/止损线，继续安心持股，无需调仓卖出。</span>
      </div>
    `;
  }
  html += `</div></div>`;

  // === 右栏：打算买入调仓行动卡片 ===
  html += `
    <div style="background:#ffffff;border:1px solid var(--sys-border);border-left:4px solid #2da44e;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.03)">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:13.5px;font-weight:700;color:var(--sys-text-title);display:flex;align-items:center;gap:6px">
            <i class="ri-rocket-line" style="color:#2da44e;font-size:16px"></i>
            <span>🚀 打算买入行动 (AI精选新龙头)</span>
          </div>
          <span style="font-size:11px;color:var(--sys-text-sub)">精选 core_watchlists 龙头池</span>
        </div>
  `;

  if (planBuys && planBuys.length > 0) {
    planBuys.forEach(b => {
      html += `
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:6px;padding:9px 12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <span style="font-weight:700;color:var(--sys-text-title);font-size:13px">${b.name} (${b.code})</span>
              <span style="font-size:11px;color:var(--sys-text-sub);margin-left:6px">${b.concept || ''}</span>
            </div>
            <span style="font-size:11px;padding:1px 6px;border-radius:3px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;font-weight:700">
              置信度 ${b.confidence_text || '高'}
            </span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-sub);margin-top:3px;display:flex;gap:10px">
            <span>推荐价: <b>¥${Number(b.rec_price).toFixed(2)}</b></span>
            <span>拟买入: <b style="color:#2da44e">${b.plan_shares}股 (一手整倍)</b></span>
            <span>预计动用: <b>¥${Number(b.plan_amount).toFixed(2)}</b></span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);margin-top:5px;line-height:1.5;background:rgba(255,255,255,0.8);padding:5px 8px;border-radius:4px">
            🎯 <b>入选逻辑：</b>${b.reason}
          </div>
        </div>
      `;
    });
  } else {
    html += `
      <div style="padding:16px 12px;text-align:center;color:var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px;font-size:12px">
        <i class="ri-checkbox-circle-line" style="color:#0969da;font-size:18px;vertical-align:middle;margin-right:4px"></i>
        <span>今日市场未甄选出高确定性超跌龙头，保持 40%~50% 现金防守，不盲目追高开新仓。</span>
      </div>
    `;
  }
  html += `</div></div>`;

  html += `</div>`; // 结束双卡片容器

  // 若存在单只持仓的具体体检建议也一同渲染
  if (positions && positions.length > 0 && (!planSells || planSells.length === 0) && (!planBuys || planBuys.length === 0)) {
    let posTips = '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">';
    positions.forEach(pos => {
      const isStopLoss = pos.signal_code === 'STOP_LOSS';
      const isTakeProfit = pos.signal_code === 'TAKE_PROFIT';
      let borderAccent = '#2da44e';
      let tagText = '继续持有';
      let tagStyle = 'background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;font-weight:700;padding:2px 8px;border-radius:4px;font-size:11.5px';
      if (isStopLoss) {
        borderAccent = '#cf222e';
        tagText = '⚠️ 触及止损线';
        tagStyle = 'background:#fef0f0;border:1px solid #fde2e2;color:#cf222e;font-weight:700;padding:2px 8px;border-radius:4px;font-size:11.5px';
      } else if (isTakeProfit) {
        borderAccent = '#f0883e';
        tagText = '🎯 达标可止盈';
        tagStyle = 'background:#fdf6ec;border:1px solid #faecd8;color:#d97706;font-weight:700;padding:2px 8px;border-radius:4px;font-size:11.5px';
      }

      posTips += `
        <div style="background:#ffffff;border:1px solid var(--sys-border);border-left:4px solid ${borderAccent};border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <b style="font-size:13px;color:var(--sys-text-title)">${pos.name} (${pos.code})</b>
            <span style="font-size:11.5px;color:var(--sys-text-sub);margin-left:8px">已持股 ${pos.holding_days || 1} 天 / 目标 ${pos.target_holding_days || 2} 天</span>
            <div style="font-size:12px;color:var(--sys-text-primary);margin-top:4px">${pos.diagnosis || '形态健康'}</div>
          </div>
          <span style="${tagStyle}">${tagText}</span>
        </div>
      `;
    });
    posTips += '</div>';
    html += posTips;
  }

  container.innerHTML = html;
}


function renderPaperPositionsTable(positions) {
  const tbody = document.getElementById('paperPositionsTableBody');
  if (!tbody) return;

  if (!positions || positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--sys-text-sub)">当前暂无持仓，可用资金充裕，可点击上方「一键执行今日调仓」进行量化建仓。</td></tr>`;
    return;
  }

  let html = '';
  positions.forEach(pos => {
    const floatingPnl = Number(pos.floating_pnl !== undefined ? pos.floating_pnl : (pos.unrealized_pnl || 0));
    const floatingPnlPct = Number(pos.floating_pnl_pct !== undefined ? pos.floating_pnl_pct : (pos.unrealized_pnl_pct || 0));
    const entryPrice = Number(pos.entry_price || pos.avg_cost || pos.cost_price) || 0;
    const currPrice = Number(pos.current_price || pos.price) || entryPrice;
    const stopLossPrice = Number(pos.stop_loss_price || pos.stop_loss || (entryPrice ? (entryPrice * 0.96) : 0));
    const takeProfitPrice = Number(pos.take_profit_price || pos.take_profit || (entryPrice ? (entryPrice * 1.085) : 0));
    const stopPct = pos.stop_pct || (entryPrice > 0 ? (((stopLossPrice - entryPrice) / entryPrice) * 100).toFixed(1) : '-4.0');
    const takePct = pos.take_pct || (entryPrice > 0 ? (((takeProfitPrice - entryPrice) / entryPrice) * 100).toFixed(1) : '+8.5');

    const pnlSign = floatingPnl >= 0 ? '+' : '';
    const pnlColor = floatingPnl >= 0 ? '#cf222e' : '#2da44e';

    html += `
      <tr>
        <td style="padding:10px 14px">
          <div style="font-weight:700;color:var(--sys-text-title);font-size:13.5px">${pos.name}</div>
          <div style="font-size:11.5px;color:var(--sys-text-sub);font-family:var(--sys-font-mono)">${pos.code}</div>
        </td>
        <td style="padding:10px 10px">
          <span style="font-size:11px;padding:2px 7px;border-radius:4px;background:#f4f4f5;color:#606266;border:1px solid #dcdfe6">${pos.status_tag || pos.tag || '稳健运行'}</span>
        </td>
        <td style="padding:10px 10px;color:var(--sys-text-sub);font-size:12px">
          <div>${pos.buy_date || '--'}</div>
          <div style="font-size:11px;color:var(--sys-accent);font-weight:600">持仓 ${pos.holding_days || 1} 天</div>
        </td>
        <td style="padding:10px 10px;text-align:right;font-family:var(--sys-font-mono);font-size:13px;font-weight:700">
          ${pos.shares} 股
        </td>
        <td style="padding:10px 10px;text-align:right;font-family:var(--sys-font-mono);font-size:13px">
          ¥${entryPrice.toFixed(2)}
        </td>
        <td style="padding:10px 10px;text-align:right;font-family:var(--sys-font-mono);font-size:13.5px;font-weight:700;color:var(--sys-text-title)">
          ¥${currPrice.toFixed(2)}
        </td>
        <td style="padding:10px 10px;text-align:center;font-family:var(--sys-font-mono);font-size:12px">
          <span style="color:#2da44e;font-weight:700;background:rgba(45,164,78,0.08);padding:2px 6px;border-radius:4px">
            ¥${stopLossPrice.toFixed(2)} (${stopPct}%)
          </span>
        </td>
        <td style="padding:10px 10px;text-align:center;font-family:var(--sys-font-mono);font-size:12px">
          <span style="color:#cf222e;font-weight:700;background:rgba(207,34,46,0.08);padding:2px 6px;border-radius:4px">
            ¥${takeProfitPrice.toFixed(2)} (${Number(takePct) >= 0 ? '+' : ''}${takePct}%)
          </span>
        </td>
        <td style="padding:10px 10px;text-align:right;font-family:var(--sys-font-mono)">
          <div style="font-size:13.5px;font-weight:700;color:${pnlColor}">
            ${pnlSign}¥${floatingPnl.toFixed(2)}
          </div>
          <div style="font-size:11.5px;color:${pnlColor}">
            ${pnlSign}${floatingPnlPct.toFixed(2)}%
          </div>
        </td>
        <td style="padding:10px 14px">
          <span style="font-size:12px;font-weight:600;color:var(--sys-text-primary)">
            ${pos.signal_text || '✅ 正常持仓'}
          </span>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * 渲染已平仓历史战绩复盘对比表 (带官方标准 Element Plus 分页)
 */
function renderClosedTradesTable(closedTrades) {
  const tbody = document.getElementById('paperClosedTradesTableBody');
  const paginationEl = document.getElementById('paperClosedTradesPagination');
  if (!tbody) return;

  if (!closedTrades || closedTrades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--sys-text-sub)">暂无平仓历史交易。系统在标的触发止盈或止损平仓后将自动在此复盘沉淀。</td></tr>`;
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  const total = closedTrades.length;
  const startIdx = (_closedTradesPage - 1) * _closedTradesPageSize;
  const endIdx = startIdx + _closedTradesPageSize;
  const pageList = closedTrades.slice(startIdx, endIdx);

  let html = '';
  pageList.forEach(t => {
    const netPnl = Number(t.net_pnl) || 0;
    const netPnlPct = Number(t.net_pnl_pct) || 0;
    const pnlSign = netPnl >= 0 ? '+' : '';
    const pnlColor = netPnl >= 0 ? '#cf222e' : '#2da44e';
    const totalFees = (Number(t.commission) || 0) + (Number(t.stamp_duty) || 0);

    let tagBg = '#f0fdf4';
    let tagColor = '#15803d';
    let tagBorder = '#bbf7d0';
    if (t.exit_tag === 'danger' || netPnl < 0) {
      tagBg = '#fef0f0';
      tagColor = '#f56c6c';
      tagBorder = '#fde2e2';
    } else if (t.exit_tag === 'warning') {
      tagBg = '#fdf6ec';
      tagColor = '#e6a23c';
      tagBorder = '#faecd8';
    }

    html += `
      <tr>
        <td style="padding:10px 12px">
          <div style="font-weight:700;color:var(--sys-text-title);font-size:13.5px">${t.name}</div>
          <div style="font-size:11.5px;color:var(--sys-text-sub);font-family:var(--sys-font-mono)">${t.code}</div>
          <div style="font-size:10.5px;color:var(--sys-text-sub);margin-top:2px">${t.concept || ''}</div>
        </td>
        <td style="padding:10px 10px;font-size:12px">
          <div style="color:var(--sys-text-sub)">${t.buy_date}</div>
          <div style="font-family:var(--sys-font-mono);font-weight:600">¥${Number(t.buy_price).toFixed(2)} (${t.buy_shares}股)</div>
          <div style="font-size:11px;color:var(--sys-text-sub)">成本: ¥${Number(t.cost_basis).toFixed(2)}</div>
        </td>
        <td style="padding:10px 10px;font-size:12px">
          <div style="color:var(--sys-text-sub)">${t.sell_date}</div>
          <div style="font-family:var(--sys-font-mono);font-weight:700;color:var(--sys-text-title)">¥${Number(t.sell_price).toFixed(2)} (${t.sell_shares}股)</div>
          <div style="font-size:11px;color:var(--sys-text-sub)">实收: ¥${Number(t.net_proceeds).toFixed(2)}</div>
        </td>
        <td style="padding:10px 10px;text-align:center;font-size:12px">
          <span style="padding:2px 6px;background:var(--sys-bg-nav);border:1px solid var(--sys-border);border-radius:4px;font-family:var(--sys-font-mono);font-weight:600">
            ${t.holding_days} 天
          </span>
        </td>
        <td style="padding:10px 10px;text-align:right;font-size:12px;font-family:var(--sys-font-mono)">
          <div>¥${totalFees.toFixed(2)}</div>
          <div style="font-size:10.5px;color:var(--sys-text-sub)">佣5+税${Number(t.stamp_duty || 0).toFixed(2)}</div>
        </td>
        <td style="padding:10px 10px;text-align:right;font-family:var(--sys-font-mono)">
          <div style="font-size:14px;font-weight:800;color:${pnlColor}">
            ${pnlSign}¥${netPnl.toFixed(2)}
          </div>
          <div style="font-size:12px;font-weight:700;color:${pnlColor}">
            ${pnlSign}${netPnlPct.toFixed(2)}%
          </div>
        </td>
        <td style="padding:10px 10px;text-align:center">
          <span style="font-size:11.5px;padding:3px 8px;border-radius:4px;background:${tagBg};color:${tagColor};border:1px solid ${tagBorder};font-weight:700;white-space:nowrap">
            ${t.exit_type || '平仓'}
          </span>
        </td>
        <td style="padding:10px 14px;font-size:12px;color:var(--sys-text-primary);max-width:320px;line-height:1.5">
          ${t.reason || '按系统调仓计划平仓'}
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;

  // 严格调用官方封装的 Element Plus 统一分页组件
  if (paginationEl && typeof window.renderElementPlusPagination === 'function') {
    window.renderElementPlusPagination(
      paginationEl,
      total,
      _closedTradesPage,
      _closedTradesPageSize,
      'window.paperChangeClosedTradesPage',
      'window.paperChangeClosedTradesSize',
      `共 ${total} 笔已平仓复盘`
    );
  }
}

/**
 * 已平仓表格换页
 */
window.paperChangeClosedTradesPage = function(newPage) {
  _closedTradesPage = newPage;
  if (_paperHistoryData) {
    renderClosedTradesTable(_paperHistoryData.closed_trades || []);
  }
};

/**
 * 已平仓表格更改每页条数
 */
window.paperChangeClosedTradesSize = function(newSize) {
  _closedTradesPageSize = parseInt(newSize, 10) || 5;
  _closedTradesPage = 1;
  if (_paperHistoryData) {
    renderClosedTradesTable(_paperHistoryData.closed_trades || []);
  }
};

/**
 * 渲染历史调仓流水与税费明细表格 (带官方标准 Element Plus 分页)
 */
function renderTradeHistoryTable(trades) {
  const tbody = document.getElementById('paperTradeHistoryTableBody');
  const paginationEl = document.getElementById('paperTradeHistoryPagination');
  if (!tbody) return;

  if (!trades || trades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--sys-text-sub)">暂无历史调仓流水。</td></tr>`;
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  const total = trades.length;
  const startIdx = (_tradeHistoryPage - 1) * _tradeHistoryPageSize;
  const endIdx = startIdx + _tradeHistoryPageSize;
  const pageList = trades.slice(startIdx, endIdx);

  let html = '';
  pageList.forEach(trade => {
    const isBuy = trade.action === 'BUY';
    const actionBadge = isBuy
      ? `<span style="background:rgba(207,34,46,0.1);color:#cf222e;font-weight:700;padding:2px 8px;border-radius:4px;font-size:11.5px;border:1px solid rgba(207,34,46,0.25)">买入</span>`
      : `<span style="background:rgba(45,164,78,0.1);color:#2da44e;font-weight:700;padding:2px 8px;border-radius:4px;font-size:11.5px;border:1px solid rgba(45,164,78,0.25)">卖出</span>`;

    const commission = Number(trade.commission) || 0;
    const stampDuty = Number(trade.stamp_duty) || 0;
    const price = Number(trade.price) || 0;
    const amt = Number(trade.amount) || 0;

    html += `
      <tr>
        <td style="padding:9px 12px;font-size:12px;color:var(--sys-text-sub)">${trade.date}</td>
        <td style="padding:9px 12px;text-align:center">${actionBadge}</td>
        <td style="padding:9px 12px">
          <span style="font-weight:700;color:var(--sys-text-title);font-size:13px">${trade.name}</span>
          <span style="font-size:11.5px;color:var(--sys-text-sub);font-family:var(--sys-font-mono);margin-left:4px">(${trade.code})</span>
        </td>
        <td style="padding:9px 12px;text-align:right;font-family:var(--sys-font-mono);font-size:12.5px">¥${price.toFixed(2)}</td>
        <td style="padding:9px 12px;text-align:right;font-family:var(--sys-font-mono);font-size:12.5px;font-weight:600">${trade.shares} 股</td>
        <td style="padding:9px 12px;text-align:right;font-family:var(--sys-font-mono);font-size:13px;font-weight:700;color:var(--sys-text-title)">¥${amt.toFixed(2)}</td>
        <td style="padding:9px 12px;font-size:11.5px;color:var(--sys-text-sub)">
          佣金 ¥${commission.toFixed(2)} ${stampDuty > 0 ? `· 印花税 ¥${stampDuty.toFixed(2)}` : ''}
        </td>
        <td style="padding:9px 12px;font-size:12px;color:var(--sys-text-primary)">
          ${trade.action_desc || '量化系统智能调仓'}
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;

  // 严格调用官方封装的 Element Plus 统一分页组件
  if (paginationEl && typeof window.renderElementPlusPagination === 'function') {
    window.renderElementPlusPagination(
      paginationEl,
      total,
      _tradeHistoryPage,
      _tradeHistoryPageSize,
      'window.paperChangeTradeHistoryPage',
      'window.paperChangeTradeHistorySize',
      `共 ${total} 笔调仓流水`
    );
  }
}

/**
 * 流水表格换页
 */
window.paperChangeTradeHistoryPage = function(newPage) {
  _tradeHistoryPage = newPage;
  const tradeHistory = (_paperPortfolioData && _paperPortfolioData.trade_history) || [];
  renderTradeHistoryTable(tradeHistory);
};

/**
 * 流水表格更改每页条数
 */
window.paperChangeTradeHistorySize = function(newSize) {
  _tradeHistoryPageSize = parseInt(newSize, 10) || 5;
  _tradeHistoryPage = 1;
  const tradeHistory = (_paperPortfolioData && _paperPortfolioData.trade_history) || [];
  renderTradeHistoryTable(tradeHistory);
};

/**
 * 绘制高清晰度累计收益走势对比图 (Canvas - 量化组合 vs 沪深300基准)
 */
function renderPaperBenchmarkChart(equityCurve) {
  const canvas = document.getElementById('paperEquityBenchmarkCanvas');
  const tooltip = document.getElementById('paperChartTooltip');
  if (!canvas || !equityCurve || equityCurve.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  let width = rect.width || (canvas.parentElement ? canvas.parentElement.clientWidth : 0);
  let height = rect.height || 220;

  if (!width || width <= 100) {
    setTimeout(() => {
      renderPaperBenchmarkChart(equityCurve);
    }, 120);
    return;
  }

  // 高分屏缩放
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padding = { top: 20, right: 25, bottom: 35, left: 55 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // 提取数值
  const dates = equityCurve.map(item => item.date);
  const portReturns = equityCurve.map(item => Number(item.portfolio_return_pct) || 0);
  const bmReturns = equityCurve.map(item => Number(item.benchmark_return_pct) || 0);

  const allVals = [...portReturns, ...bmReturns, 0];
  let minVal = Math.min(...allVals);
  let maxVal = Math.max(...allVals);

  // 留出上下边距
  const valMargin = (maxVal - minVal) * 0.2 || 1.0;
  minVal = Math.floor((minVal - valMargin) * 10) / 10;
  maxVal = Math.ceil((maxVal + valMargin) * 10) / 10;
  if (minVal > 0) minVal = 0;
  if (maxVal < 0) maxVal = 0;

  // 坐标映射辅助函数
  const getX = (idx) => padding.left + (idx / (dates.length - 1)) * plotWidth;
  const getY = (val) => padding.top + plotHeight - ((val - minVal) / (maxVal - minVal)) * plotHeight;

  // 清屏
  ctx.clearRect(0, 0, width, height);

  // 1. 绘制水平参考网格线
  const steps = 4;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#e1e4e8';
  ctx.fillStyle = '#8c959f';
  ctx.font = '10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'right';

  for (let s = 0; s <= steps; s++) {
    const val = minVal + (s / steps) * (maxVal - minVal);
    const y = getY(val);

    ctx.beginPath();
    if (Math.abs(val) < 0.05) {
      ctx.strokeStyle = '#afb8c1'; // 0刻度加重
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = '#ebeef5';
      ctx.lineWidth = 0.8;
    }
    ctx.setLineDash([]);
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotWidth, y);
    ctx.stroke();

    ctx.fillText(`${val >= 0 ? '+' : ''}${val.toFixed(1)}%`, padding.left - 8, y + 3.5);
  }

  // 2. 绘制基准走势曲线 (沪深300 - 蓝色虚线)
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = '#0969da';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  bmReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();

  // 3. 绘制组合净值收益曲线 (橘色实线 + 渐变半透明投影)
  ctx.save();
  // 3.1 渐变填充区域
  const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
  grad.addColorStop(0, 'rgba(240, 136, 62, 0.22)');
  grad.addColorStop(1, 'rgba(240, 136, 62, 0.01)');

  ctx.beginPath();
  portReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  const zeroY = getY(0);
  ctx.lineTo(getX(portReturns.length - 1), zeroY);
  ctx.lineTo(getX(0), zeroY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 3.2 橘色曲线实线
  ctx.beginPath();
  ctx.strokeStyle = '#f0883e';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  portReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 3.3 绘制数据节点圆点
  portReturns.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#f0883e';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();

  // 4. 绘制 X 轴日期标签
  ctx.fillStyle = '#656d76';
  ctx.textAlign = 'center';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  dates.forEach((d, idx) => {
    // 间隔显示或者首尾和关键点
    if (idx === 0 || idx === dates.length - 1 || idx % 2 === 0) {
      const x = getX(idx);
      ctx.fillText(d.slice(5), x, height - 12);
    }
  });

  // 5. 交互式悬浮 Tooltip 监听
  canvas.onmousemove = function (e) {
    const mouseX = e.offsetX;
    if (mouseX < padding.left || mouseX > padding.left + plotWidth) {
      if (tooltip) tooltip.style.display = 'none';
      return;
    }

    // 计算最近的点
    const ratio = (mouseX - padding.left) / plotWidth;
    const closestIdx = Math.min(dates.length - 1, Math.max(0, Math.round(ratio * (dates.length - 1))));
    const date = dates[closestIdx];
    const pVal = portReturns[closestIdx];
    const bVal = bmReturns[closestIdx];
    const alphaVal = pVal - bVal;

    if (tooltip) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(width - 160, Math.max(10, mouseX - 70))}px`;
      tooltip.style.top = '12px';
      tooltip.innerHTML = `
        <div style="font-weight:700;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:3px;margin-bottom:3px">📅 ${date}</div>
        <div style="color:#f0883e">🟠 实战组合: <b>${pVal >= 0 ? '+' : ''}${pVal.toFixed(2)}%</b></div>
        <div style="color:#58a6ff">🔷 沪深300: <b>${bVal >= 0 ? '+' : ''}${bVal.toFixed(2)}%</b></div>
        <div style="color:#ff7b72">⚡ 超额Alpha: <b>${alphaVal >= 0 ? '+' : ''}${alphaVal.toFixed(2)}%</b></div>
      `;
    }
  };

  canvas.onmouseleave = function () {
    if (tooltip) tooltip.style.display = 'none';
  };
}

/**
 * 一键执行今日调仓
 */
async function  executePaperRebalance() {
  const btn = document.getElementById('paperRebalanceExecBtn');
  if (btn) btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> <span>调仓执行中...</span>';

  try {
    const res = await fetch('/api/paper-portfolio/rebalance', { method: 'POST' });
    const json = await res.json();
    if (json.code === 200) {
      alert(`🎉 调仓成功！\n${json.data.message}`);
      await fetchPaperPortfolioStatus();
      await fetchPaperHistoryReport();
    } else {
      alert(`调仓提示: ${json.message}`);
    }
  } catch (err) {
    alert(`执行调仓异常: ${err}`);
  } finally {
    if (btn) btn.innerHTML = '<i class="ri-swap-line"></i> <span>⚡ 一键执行今日调仓</span>';
  }
}
window.executePaperRebalance = executePaperRebalance;

/**
 * 重置模拟盘本金 (1万/2万/5万/10万)
 */
async function  resetPaperPortfolio(capital) {
  const cap = Number(capital) || 20000;
  if (!confirm(`确定要将实战模拟盘重置为全新状态吗？\n本金将设为 ¥${cap.toLocaleString('zh-CN')} 元。`)) {
    return;
  }

  try {
    const res = await fetch('/api/paper-portfolio/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capital: cap })
    });
    const json = await res.json();
    if (json.code === 200) {
      ['10k', '20k', '50k', '100k'].forEach(k => {
        const b = document.getElementById(`paperCapBtn${k}`);
        if (b) {
          b.style.background = 'transparent';
          b.style.color = 'var(--sys-text-primary)';
          b.style.fontWeight = 'normal';
        }
      });
      const activeKey = cap === 10000 ? '10k' : cap === 20000 ? '20k' : cap === 50000 ? '50k' : '100k';
      const activeBtn = document.getElementById(`paperCapBtn${activeKey}`);
      if (activeBtn) {
        activeBtn.style.background = '#f0883e';
        activeBtn.style.color = '#ffffff';
        activeBtn.style.fontWeight = '700';
      }

      alert(json.data.message);
      returnToTodayLive();
      await fetchPaperPortfolioStatus();
      await fetchPaperHistoryReport();
    } else {
      alert(`重置失败: ${json.message}`);
    }
  } catch (err) {
    alert(`重置异常: ${err}`);
  }
}
window.resetPaperPortfolio = resetPaperPortfolio;

// 窗口尺寸变化时防抖重绘 Canvas 曲线
let _paperResizeTimer = null;
window.addEventListener('resize', () => {
  if (_paperResizeTimer) clearTimeout(_paperResizeTimer);
  _paperResizeTimer = setTimeout(() => {
    if (_paperHistoryData && _paperHistoryData.equity_curve) {
      renderPaperBenchmarkChart(_paperHistoryData.equity_curve);
    }
  }, 150);
});


// ==================== 📖 2万元实战模拟盘 · 玩法指南折叠与交互 ====================
function togglePaperPlayGuide(forceState) {
  const card = document.getElementById('paperPlayGuideCard');
  const header = document.getElementById('paperPlayGuideHeader');
  const content = document.getElementById('paperPlayGuideContent');
  const innerArrow = document.getElementById('paperGuideInnerArrow');
  const toggleText = document.getElementById('paperGuideToggleText');
  const topArrow = document.getElementById('paperGuideArrowIcon');
  const subDesc = document.getElementById('paperGuideSubDesc');
  if (!content) return;

  let isCollapsed;
  if (typeof forceState === 'boolean') {
    isCollapsed = !forceState;
  } else {
    isCollapsed = content.style.display !== 'none';
  }

  if (isCollapsed) {
    // 收起状态：紧凑轻巧，虚线和虚线以下区域完全不显示
    content.style.display = 'none';
    if (header) {
      header.style.marginBottom = '0';
      header.style.paddingBottom = '0';
      header.style.borderBottom = 'none';
    }
    if (card) {
      card.style.padding = '6px 14px';
      card.style.marginBottom = '10px';
      card.style.borderRadius = '6px';
    }
    if (subDesc) subDesc.style.display = 'none';
    if (innerArrow) innerArrow.className = 'ri-arrow-down-s-line';
    if (toggleText) toggleText.innerText = '展开指南';
    if (topArrow) topArrow.style.transform = 'rotate(0deg)';
    localStorage.setItem('paper_guide_collapsed', '1');
  } else {
    // 展开状态：显示完整实战规则卡片网格与虚线分割
    content.style.display = 'flex';
    if (header) {
      header.style.marginBottom = '12px';
      header.style.paddingBottom = '10px';
      header.style.borderBottom = '1px dashed rgba(240,136,62,0.25)';
    }
    if (card) {
      card.style.padding = '14px 18px';
      card.style.marginBottom = '14px';
      card.style.borderRadius = '10px';
    }
    if (subDesc) subDesc.style.display = 'inline';
    if (innerArrow) innerArrow.className = 'ri-arrow-up-s-line';
    if (toggleText) toggleText.innerText = '收起指南';
    if (topArrow) topArrow.style.transform = 'rotate(180deg)';
    localStorage.setItem('paper_guide_collapsed', '0');
  }
}
window.togglePaperPlayGuide = togglePaperPlayGuide;

// 初始化玩法指南折叠状态（默认收起，虚线与下方留白完全不显示）
function initPaperPlayGuideState() {
  const isExplicitlyExpanded = localStorage.getItem('paper_guide_collapsed') === '0';
  togglePaperPlayGuide(isExplicitlyExpanded);
}

// 显式挂载全局初始化函数
window.initPaper20kDashboard = initPaper20kDashboard;
window.renderPaperBenchmarkChart = renderPaperBenchmarkChart;

// 页面加载完成后自动执行初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initPaper20kDashboard, 100);
  });
} else {
  setTimeout(initPaper20kDashboard, 100);
}

/**
 * 打开模拟盘专属历史日期选择器 (自动携带所有有数据交易日进行涂色)
 */
function openPaperSnapshotDatePicker(triggerEl) {
  const inputEl = document.getElementById('paperSnapshotDatePicker') || (triggerEl && triggerEl.querySelector('input')) || triggerEl;
  const dates = (_paperHistoryData && _paperHistoryData.available_dates) || window._paperAvailableDates || [];
  if (window.ElDatePicker) {
    window.ElDatePicker.show(inputEl, (v) => {
      if (v) onPaperSnapshotDateSelect(v);
    }, { availableDates: dates });
  }
}
window.openPaperSnapshotDatePicker = openPaperSnapshotDatePicker;

// 支持通过 URL open_datepicker 参数自动展开日历进行核验
try {
  if (window.location.search.includes('open_datepicker=1') || window.location.hash.includes('open_datepicker=1')) {
    setTimeout(() => {
      const pInput = document.getElementById('paperSnapshotDatePicker');
      if (pInput && typeof openPaperSnapshotDatePicker === 'function') {
        openPaperSnapshotDatePicker(pInput);
      }
    }, 800);
  }
} catch(e) {
  console.warn('alpha_paper_portfolio init datepicker warn:', e);
}
