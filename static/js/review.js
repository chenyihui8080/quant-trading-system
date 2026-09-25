
/**
 * ====================================================================
 * 👑 review.js - 交易复盘工作台：主中枢调度器、生命周期管理与核心观察池
 * ====================================================================
 */
// ==================== 👑 交易复盘工作台状态中心 (State Container & Session Persistence) ====================
window.ReviewState = window.ReviewState || {
  currentAgentKey: (function() {
    try { return sessionStorage.getItem('quant_review_agent_key') || localStorage.getItem('quant_active_review_agent') || 'overview'; }
    catch(e) { return 'overview'; }
  })(),
  selectedReviewDate: (function() {
    try { return sessionStorage.getItem('quant_review_selected_date') || new Date().toISOString().split('T')[0]; }
    catch(e) { return new Date().toISOString().split('T')[0]; }
  })(),
  fullAgentDashboardData: null,

  getAgentKey() { return this.currentAgentKey; },
  setAgentKey(key) {
    this.currentAgentKey = key;
    try {
      sessionStorage.setItem('quant_review_agent_key', key);
      localStorage.setItem('quant_active_review_agent', key);
    } catch(e) { console.warn('setAgentKey storage warn:', e); }
    window._currentAgentKey = key;
  },

  getDate() { return this.selectedReviewDate; },
  setDate(date) {
    if (!date) return;
    this.selectedReviewDate = date;
    try {
      sessionStorage.setItem('quant_review_selected_date', date);
    } catch(e) { console.warn('setDate storage warn:', e); }
    window._selectedReviewDate = date;
  },

  getDashboardData() { return this.fullAgentDashboardData; },
  setDashboardData(data) {
    this.fullAgentDashboardData = data;
    window._fullAgentDashboardData = data;
  }
};

// 保持历史兼容性的全局镜像代理
var _currentAgentKey = window.ReviewState.getAgentKey(); window._currentAgentKey = _currentAgentKey;
var _selectedReviewDate = window.ReviewState.getDate(); window._selectedReviewDate = _selectedReviewDate;
var _fullAgentDashboardData = window.ReviewState.getDashboardData(); window._fullAgentDashboardData = _fullAgentDashboardData;

/**
 * 优雅的微任务/帧轮询条件等待工具 (彻底消除脆弱的 setTimeout 毫秒时序硬编码)
 * @param {Function} predicate 返回 boolean 的就绪判断条件
 * @param {Function} callback 条件就绪后执行的回调
 * @param {number} maxWaitMs 最大等待毫秒数，默认 1800ms
 */
function waitForCondition(predicate, callback, maxWaitMs = 1800) {
  const startTime = Date.now();
  function check() {
    try {
      if (predicate()) {
        callback();
        return;
      }
    } catch(err) {
      console.warn("waitForCondition predicate error:", err);
    }
    if (Date.now() - startTime < maxWaitMs) {
      requestAnimationFrame(check);
    } else {
      // 超时兜底执行一次，避免静默失败
      callback();
    }
  }
  check();
}
window.waitForCondition = waitForCondition;

/**
 * 👑 从交易复盘模块一键无缝联动调起 Alpha 实盘买盘测算器
 * @param {string} stockCode 标的代码 (如 '600519', '000001')
 */
function jumpToAlphaCalc(stockCode) {
  if (!stockCode) return;
  const cleanCode = String(stockCode).trim();

  // 1. 无缝切换系统到【Alpha 实盘】
  if (typeof switchCategory === 'function') {
    switchCategory('alpha');
  } else if (typeof window.switchCategory === 'function') {
    window.switchCategory('alpha');
  }

  // 2. 基于事件/DOM 条件就绪动态联动，彻底摒弃 setTimeout(60ms)
  waitForCondition(
    () => typeof window.quickJumpToCalculate === 'function' || typeof quickJumpToCalculate === 'function',
    () => {
      if (typeof window.quickJumpToCalculate === 'function') {
        window.quickJumpToCalculate(cleanCode);
      } else if (typeof quickJumpToCalculate === 'function') {
        quickJumpToCalculate(cleanCode);
      }
    },
    2000
  );
}
window.jumpToAlphaCalc = jumpToAlphaCalc;

/**
 * 一键将标的带入【系统一 · 🔬 任意单股战法体检室】并自动触发历史全量穿透体检
 * @param {string} stockCode 标的代码
 */
function jumpToSingleStockBacktest(stockCode) {
  if (!stockCode) return;
  const cleanCode = String(stockCode).trim();

  // 1. 无缝切换系统到【Alpha 实盘】
  if (typeof switchCategory === 'function') {
    switchCategory('alpha');
  } else if (typeof window.switchCategory === 'function') {
    window.switchCategory('alpha');
  }

  // 2. 动态等待 Alpha 体系 Tab 切入函数就绪
  waitForCondition(
    () => typeof window.switchAlphaSubTab === 'function' || typeof switchAlphaSubTab === 'function',
    () => {
      if (typeof window.switchAlphaSubTab === 'function') {
        window.switchAlphaSubTab('backtest');
      } else if (typeof switchAlphaSubTab === 'function') {
        switchAlphaSubTab('backtest');
      }

      // 3. 动态等待目标输入框或快速选股函数挂载完成
      waitForCondition(
        () => typeof window.quickSelectStock === 'function' || document.getElementById('btSingleStockInput'),
        () => {
          if (typeof window.quickSelectStock === 'function') {
            window.quickSelectStock(cleanCode);
          } else {
            const input = document.getElementById('btSingleStockInput');
            if (input) {
              input.value = cleanCode;
              if (typeof runSingleStockBacktestFromPage === 'function') {
                runSingleStockBacktestFromPage();
              }
            }
          }
        },
        2000
      );
    },
    2000
  );
}
window.jumpToSingleStockBacktest = jumpToSingleStockBacktest;


// 切换顶部二级 Tab 并触发对应工作区渲染
function switchReviewSubTab(subName) {
  const mapToAgent = {
    'overview': 'overview',
    'sector': 'sector',
    'attribution': 'attribution',
    'judge': 'judge',
    'news': 'news',
    'funnel': 'overview'
  };

  const agentKey = mapToAgent[subName] || subName || 'overview';
  switchAgentView(agentKey);
}

// 切换当前激活的小智能体 / 业务视图 (带持久化记忆)
async function switchAgentView(agentKey) {
  const validKeys = ['overview', 'sector', 'attribution', 'judge', 'news', 'watchlist_pool'];
  if (!validKeys.includes(agentKey)) {
    agentKey = 'overview';
  }
  _currentAgentKey = agentKey;
  window._currentAgentKey = agentKey;
  if (window.ReviewState) {
    window.ReviewState.setAgentKey(agentKey);
  }

  // 0. 自动同步顶部交易日选择框默认值为最新日期
  const dateInput = document.getElementById('rwDateSelector');
  if (dateInput && !dateInput.value) {
    dateInput.value = _selectedReviewDate;
  }

  // 0.1 控制顶部 4 大统计大卡片的按需展示：仅在 overview 视图下展示
  const topOverviewCards = document.getElementById('reviewTopOverviewCards');
  if (topOverviewCards) {
    topOverviewCards.style.display = (agentKey === 'overview') ? 'grid' : 'none';
  }

  // 1. 同步顶部二级 Tab 高亮
  document.querySelectorAll('#reviewSubTabs .tab').forEach(t => t.classList.remove('active'));
  const agentToSubTabMap = {
    'overview': 'rwSubBtnOverview',
    'sector': 'rwSubBtnSector',
    'attribution': 'rwSubBtnAttr',
    'judge': 'rwSubBtnJudge',
    'news': 'rwSubBtnNews'
  };
  const activeSubBtnId = agentToSubTabMap[agentKey];
  if (activeSubBtnId) {
    const activeSubBtn = document.getElementById(activeSubBtnId);
    if (activeSubBtn) activeSubBtn.classList.add('active');
  }

  // 2. 切换左侧导航高亮 (若存在)
  document.querySelectorAll('.agent-nav-item').forEach(el => {
    el.style.background = 'transparent';
    el.style.borderColor = 'transparent';
    el.classList.remove('active');
  });
  const activeNav = document.getElementById(`agentNav-${agentKey}`);
  if (activeNav) {
    activeNav.style.background = 'var(--sys-bg-card-inner)';
    activeNav.style.borderColor = 'var(--sys-accent)';
    activeNav.classList.add('active');
  }

  // 3. 面板互斥切换
  const mainContainer = document.getElementById('agentMainViewContainer');
  const secContainer = document.getElementById('tab-alpha-sector');
  const judgeContainer = document.getElementById('tab-alpha-judge');

  if (agentKey === 'sector') {
    if (mainContainer) mainContainer.style.display = 'none';
    if (judgeContainer) judgeContainer.style.display = 'none';
    if (secContainer) {
      secContainer.style.display = 'block';
      secContainer.classList.add('active');
    }
    if (typeof window.loadSectorFlows === 'function') {
      window.loadSectorFlows();
    }
  } else if (agentKey === 'judge') {
    if (mainContainer) mainContainer.style.display = 'none';
    if (secContainer) secContainer.style.display = 'none';
    if (judgeContainer) {
      judgeContainer.style.display = 'block';
      judgeContainer.classList.add('active');
    }
    if (typeof window.initJudgeModule === 'function') {
      window.initJudgeModule();
    }
  } else {
    if (secContainer) secContainer.style.display = 'none';
    if (judgeContainer) judgeContainer.style.display = 'none';
    if (mainContainer) mainContainer.style.display = 'block';

    if (agentKey === 'news') {
      // 📰 情报搜集与证据库拥有专属轻量毫秒级接口 (0.03秒)，立即秒开渲染！
      if (typeof renderNewsAgentPanel === 'function') {
        renderNewsAgentPanel(mainContainer);
      }
      // 后台静默加载全量大盘数据，更新顶部指标，绝不阻塞当前卡片流
      if (!_fullAgentDashboardData) {
        loadFullAgentDashboardData(true);
      }
      return;
    }

    // 4. 加载或复用全智能体多维数据并渲染
    const dashboardData = window.ReviewState ? window.ReviewState.getDashboardData() : _fullAgentDashboardData;
    if (!dashboardData) {
      await loadFullAgentDashboardData(false);
    } else {
      renderCurrentAgentView(); 
    }
  }
}

// 切换复盘日期
function changeIntegratedReviewDate(newDate) {
  if (!newDate) return;
  _selectedReviewDate = newDate;
  window._selectedReviewDate = newDate;
  _fullAgentDashboardData = null;
  window._fullAgentDashboardData = null;
  if (window.ReviewState) {
    window.ReviewState.setDate(newDate);
    window.ReviewState.setDashboardData(null);
  }
  showToast(`已切换至【${newDate}】交易日复盘视图`, 'info');
  
  const dateInput = document.getElementById('rwDateSelector');
  if (dateInput) dateInput.value = newDate;

  // 重置情报证据库分页与关键词状态
  if (typeof _newsCurrentPage !== 'undefined') _newsCurrentPage = 1;
  if (typeof _newsSearchKeyword !== 'undefined') _newsSearchKeyword = "";
  if (typeof _newsActiveTab !== 'undefined') _newsActiveTab = 'all';

  if (_currentAgentKey === 'news') {
    const container = document.getElementById('agentMainViewContainer');
    if (container && typeof renderNewsAgentPanel === 'function') {
      renderNewsAgentPanel(container);
    }
  }

  loadFullAgentDashboardData(false);
}

// 全局拉取智能体多维数据
async function loadFullAgentDashboardData(silent = false) {
  const container = document.getElementById('agentMainViewContainer');
  // 如果是静默预热，或者当前用户正在浏览证据库(news)，严禁覆盖屏幕为 loading！
  if (!silent && _currentAgentKey !== 'news' && container) {
    container.innerHTML = `
      <div style="color:var(--sys-text-sub);text-align:center;padding:50px 20px">
        <span class="spinner" style="margin-bottom:10px"></span>
        <div style="font-size:14px;font-weight:600;color:var(--sys-text-title)">正在拉取盘后多维复盘数据...</div>
        <div style="font-size:12px;color:var(--sys-text-sub);margin-top:4px">正在秒级调度：复盘定调 · 涨跌分布 · 4层漏斗 · 舆情证据库</div>
      </div>
    `;
  }

  try {
    const res = await authFetch(`/api/review/full-agent-dashboard?date=${_selectedReviewDate}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      _fullAgentDashboardData = json.data;
      window._fullAgentDashboardData = json.data;
      if (window.ReviewState) {
        window.ReviewState.setDashboardData(json.data);
      }

      // 更新顶部 4 大胶囊卡片 (100% 数据库真实数据绑定，彻底消灭硬编码假兜底)
      const vol = json.data.volatility || {};
      const kpi = vol.kpi || {};
      if (document.getElementById('cardKpi1')) document.getElementById('cardKpi1').textContent = (kpi.core_pool != null ? kpi.core_pool : (kpi.high_pct_pool != null ? kpi.high_pct_pool : '--'));
      if (document.getElementById('cardKpi2')) document.getElementById('cardKpi2').textContent = (kpi.base_pool != null ? kpi.base_pool : '--');
      if (document.getElementById('cardKpi3')) document.getElementById('cardKpi3').textContent = (kpi.limit_up_close != null ? kpi.limit_up_close : '--');
      if (document.getElementById('cardKpi4')) document.getElementById('cardKpi4').textContent = (kpi.ladder_count != null ? kpi.ladder_count : '--');

      // 仅当用户未在情报证据库时才替换主视图
      if (_currentAgentKey !== 'news') {
        renderCurrentAgentView(); 
      }
    } else {
      if (container) {
        container.innerHTML = `
          <div style="text-align:center;padding:40px 20px;color:var(--sys-text-sub)">
            <div style="font-size:14px;color:#f85149;margin-bottom:10px"><i class="ri-error-warning-line"></i> 复盘数据拉取未完成 (${escapeHtml(json.message || '数据暂未归档')})</div>
            <button class="btn btn-outline" onclick="loadFullAgentDashboardData()" style="padding:4px 14px;font-size:12px"><i class="ri-refresh-line"></i> 点击重新拉取</button>
          </div>
        `;
      }
      renderWatchpoolElementPlusPagination(0);
    }
  } catch (e) {
    if (container) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--sys-text-sub)">
          <div style="font-size:14px;color:#f85149;margin-bottom:10px"><i class="ri-wifi-off-line"></i> 网络连接或服务响应异常: ${escapeHtml(e.message)}</div>
          <button class="btn btn-outline" onclick="loadFullAgentDashboardData()" style="padding:4px 14px;font-size:12px"><i class="ri-refresh-line"></i> 点击重新拉取</button>
        </div>
      `;
    }
    renderWatchpoolElementPlusPagination(0);
  }
}

// 渲染当前选中的智能体专属面板
function renderCurrentAgentView() {
  const container = document.getElementById('agentMainViewContainer');
  const d = _fullAgentDashboardData || (window.ReviewState && window.ReviewState.getDashboardData());
  if (!container || !d) return;

  const currentKey = _currentAgentKey || (window.ReviewState && window.ReviewState.getAgentKey()) || 'overview';

  if (currentKey === 'watchlist_pool') {
    // 🎯 4层核心观察池
    renderWatchlistPoolPanel(container);
  } else if (currentKey === 'news') {
    // 📰 情报搜集与证据库 (独立调优接口，不污染 d.news)
    renderNewsAgentPanel(container);
  } else if (currentKey === 'attribution') {
    // 🔗 逻辑归因与产业链图谱
    renderAttributionAgentPanel(container, d.attribution);
  } else {
    // 📊 复盘总览看板 (默认兜底)
    _currentAgentKey = 'overview';
    if (window.ReviewState) window.ReviewState.setAgentKey('overview');
    renderOverviewAgentPanel(container, d.market_overview, d.volatility);
  }
}

// 🏠 渲染【复盘总览看板】(大盘量价 + 赚钱效应 + 连板天梯 + 异动漏斗)
function renderOverviewAgentPanel(container, mkt, vol) {
  // 注入大盘情绪体温计
  if (typeof renderMarketEmotionThermometer === 'function') {
    const thermContainer = document.getElementById('marketEmotionThermometerContainer');
    if (thermContainer) {
      renderMarketEmotionThermometer(mkt);
    }
  }
  mkt = mkt || {};
  vol = vol || (_fullAgentDashboardData ? _fullAgentDashboardData.volatility : {}) || {};

  const mems = mkt.member_data_volume || [];
  const effect = mkt.money_effect || {};
  const ladder = vol.ladder_stocks || {};
  const ladders = ladder.distribution || [];
  const caps = vol.market_cap_distribution || [];
  const comp = vol.yesterday_compare || {};

  // 指数涨跌幅与两市成交额
  const sh = parseFloat(mkt.shanghai_pct || 0);
  const sz = parseFloat(mkt.shenzhen_pct || 0);
  const cy = parseFloat(mkt.chuangye_pct || 0);

  const formatIndex = (val) => {
    const isUp = val >= 0;
    const bg = isUp ? '#f85149' : '#3fb950'; // A股红涨绿跌
    const width = Math.min(100, Math.max(14, Math.abs(val) * 22));
    const text = `${isUp ? '+' : ''}${val.toFixed(2)}%`;
    return { bg, width: `${width}%`, text };
  };

  const shBar = formatIndex(sh);
  const szBar = formatIndex(sz);
  const cyBar = formatIndex(cy);

  // 连板龙头描述与次日推演
  const leadDesc = ladder.lead_desc || '连板高度梯队正在计算中...';
  const planText = `<b style="display:inline-flex;align-items:center;gap:4px"><i class="ri-sun-line" style="color:#f59e0b"></i> 次日博弈预案：</b>聚焦核心空间龙头【${leadDesc}】，严格执行止损纪律，依托4层漏斗核心观察池标的进行跟踪操作。`;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- 市场总览大卡片 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="ri-bar-chart-2-line" style="font-size:20px;color:var(--sys-accent)"></i>
            <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_main')" style="font-size:16px;color:var(--sys-text-title, #1e293b);display:inline-flex;align-items:center;gap:4px">
              <span>市场总览看板</span>
              <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
            </b>
            <span style="font-size:12px;color:var(--sys-text-sub, #64748b)">${mkt.trade_date || _selectedReviewDate} · ${mkt.status_text || '全市场行情'}</span>
          </div>
          <span style="font-size:12px;color:#3fb950;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px;display:inline-flex;align-items:center;gap:4px">
            <i class="ri-team-line"></i>
            <span>盘后多空全局定调</span>
          </span>
        </div>

        <!-- 三大指数涨跌进度条 (A股标准红涨绿跌) -->
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:70px;font-size:12px;color:var(--sys-text-sub, #64748b)">上证指数</span>
            <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:24px;overflow:hidden;position:relative">
              <div style="width:${shBar.width};height:100%;background:${shBar.bg};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">${shBar.text}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:70px;font-size:12px;color:var(--sys-text-sub, #64748b)">深证成指</span>
            <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:24px;overflow:hidden;position:relative">
              <div style="width:${szBar.width};height:100%;background:${szBar.bg};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">${szBar.text}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:70px;font-size:12px;color:var(--sys-text-sub, #64748b)">创业板指</span>
            <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:24px;overflow:hidden;position:relative">
              <div style="width:${cyBar.width};height:100%;background:${cyBar.bg};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">${cyBar.text}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:70px;font-size:12px;color:var(--sys-text-sub, #64748b)">两市成交</span>
            <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:24px;overflow:hidden;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border:1px solid var(--sys-border, #e2e8f0)">
              <b style="color:#58a6ff;font-size:12px">${((mkt.total_amount_yi != null && mkt.total_amount_yi > 0) ? mkt.total_amount_yi.toLocaleString() : '--')} 亿元</b>
              <span style="font-size:11px;color:${(mkt.total_amount_yi||0)>=15000?'#f85149':'#3fb950'};background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:3px">${(mkt.total_amount_yi||0)>=15000?'放量活跃':'常态成交'}</span>
            </div>
          </div>
        </div>

        <!-- 组长定调摘要与次日推演 -->
        <div style="display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:rgba(88,166,255,0.06);border-left:3px solid #58a6ff;border-radius:4px;font-size:13px;color:#c9d1d9;line-height:1.6">
          <div>${mkt.narrative || '今日全市场行情运行平稳，盘面围绕科技与核心主线活跃博弈。'}</div>
          <div style="font-size:12px;color:var(--sys-text-sub, #64748b);border-top:1px dashed var(--sys-border, #e2e8f0);padding-top:8px">${planText}</div>
        </div>
      </div>

      <!-- 连板梯队高度彩色柱状图 -->
      <div id="reviewLadderSection" class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="ri-numbers-line" style="font-size:18px;color:#e3b341"></i>
            <b style="font-size:15px;color:var(--sys-text-title, #1e293b)">连板空间梯队</b>
            <span style="font-size:11px;color:var(--sys-text-sub, #64748b)">${ladder.lead_desc || '空间高度龙头代表市场风险偏好上限'}</span>
          </div>
          <span style="font-size:11px;color:#d2a8ff;background:rgba(210,168,255,0.12);padding:2px 8px;border-radius:4px">
            空间高度龙头 · 情绪定调
          </span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:14px;align-items:end;padding-top:10px">
          ${ladders.length > 0 ? ladders.map(item => `
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
              <span style="font-size:14px;font-weight:700;color:var(--sys-text-title, #1e293b);font-family:'JetBrains Mono',monospace">${item.count}只</span>
              <div style="width:100%;height:${Math.max(40, item.count * 2.2)}px;background:${item.color || '#388bfd'};border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px">${item.count}</div>
              <span style="font-size:12px;color:var(--sys-text-sub, #64748b)">${item.ladder}</span>
            </div>
          `).join('') : `
            <div style="color:var(--sys-text-sub, #64748b);text-align:center;grid-column:1/-1;padding:15px">今日无明显连板梯队数据</div>
          `}
        </div>
      </div>

      <!-- 赚钱效应分布 & 异动筛选漏斗两栏 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- 赚钱效应分布 -->
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:16px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
            <i class="ri-money-cny-circle-line" style="color:#e3b341;font-size:16px"></i>
            <b style="font-size:14px;color:var(--sys-text-title, #1e293b)">赚钱效应分布</b>
            <span style="font-size:11px;color:var(--sys-text-sub, #64748b)">主板 · 创业板 · 科创板 (涨停 ${effect.total_limit_up || 60} 只)</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#c9d1d9">
              <span>主板</span>
              <b>${effect.main_board_pct || 0}%</b>
            </div>
            <div style="height:8px;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;overflow:hidden">
              <div style="width:${effect.main_board_pct || 0}%;height:100%;background:#388bfd"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#c9d1d9">
              <span>创业板 (${effect.chuangye_count || 0}只)</span>
              <b>${effect.chuangye_pct || 0}%</b>
            </div>
            <div style="height:8px;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;overflow:hidden">
              <div style="width:${effect.chuangye_pct || 0}%;height:100%;background:#3fb950"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#c9d1d9">
              <span>科创板 (${effect.kechuang_count || 0}只)</span>
              <b>${effect.kechuang_pct || 0}%</b>
            </div>
            <div style="height:8px;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;overflow:hidden">
              <div style="width:${effect.kechuang_pct || 0}%;height:100%;background:#8957e5"></div>
            </div>
          </div>
        </div>

        <!-- 异动筛选漏斗 -->
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:16px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
            <i class="ri-filter-3-line" style="font-size:16px;color:#f85149"></i>
            <b style="font-size:14px;color:var(--sys-text-title, #1e293b)">异动筛选漏斗</b>
            <span style="font-size:11px;color:var(--sys-text-sub, #64748b)">354只异动 → 230只过滤 → 110涨停 → 连板15</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="width:80px;font-size:12px;color:var(--sys-text-sub, #64748b)">盘中>7.6%</span>
              <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:20px;overflow:hidden">
                <div style="width:100%;height:100%;background:#e05244;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:10px;font-weight:700">354只</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="width:80px;font-size:12px;color:var(--sys-text-sub, #64748b)">涨停收盘</span>
              <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:20px;overflow:hidden">
                <div style="width:31%;height:100%;background:#238636;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:10px;font-weight:700">110只</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="width:80px;font-size:12px;color:var(--sys-text-sub, #64748b)">审美过滤</span>
              <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:20px;overflow:hidden">
                <div style="width:65%;height:100%;background:#d29922;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:10px;font-weight:700">230只</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="width:80px;font-size:12px;color:var(--sys-text-sub, #64748b)">连板梯队</span>
              <div style="flex:1;background:var(--sys-bg-sub, #f1f5f9);border-radius:4px;height:20px;overflow:hidden">
                <div style="width:15%;height:100%;background:#8957e5;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:10px;font-weight:700">15只</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 筛选漏斗与昨日对比摘要 -->
      ${comp.comment ? `
        <div class="panel" style="margin:0;background:rgba(88,166,255,0.04);border:1px dashed var(--sys-border, #e2e8f0);padding:12px 16px">
          <div style="font-size:12px;color:#58a6ff;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:4px">
            <i class="ri-contrast-line"></i>
            <span>多空情绪与昨日对比</span>
          </div>
          <div style="font-size:12px;color:var(--sys-text-sub, #64748b);line-height:1.6">${comp.comment}</div>
        </div>
      ` : ''}
    </div>
  `;
}


// 完整实现【复盘组长数据加载器】
async function loadIntegratedReviewDashboard() {
  const narrativeEl = document.getElementById('rwLeadNarrative');
  const planEl = document.getElementById('rwLeadGamePlan');

  if (_fullAgentDashboardData && _fullAgentDashboardData.market_overview) {
    const mkt = _fullAgentDashboardData.market_overview;
    if (narrativeEl) narrativeEl.innerHTML = `<p style="margin:0">${mkt.narrative || '今日全市场行情运行平稳，详细 7 人小智能体定调正在汇聚中...'}</p>`;
    if (planEl) {
      const bFocus = (_fullAgentDashboardData.volatility && _fullAgentDashboardData.volatility.ladder_stocks) 
        ? `聚焦核心空间龙头【${_fullAgentDashboardData.volatility.ladder_stocks.lead_desc}】，严格执行止损纪律。` 
        : '严格按照 4 层漏斗核心观察池标的进行跟踪操作。';
      planEl.innerHTML = `<b style="display:inline-flex;align-items:center;gap:4px"><i class="ri-sun-line" style="color:#f59e0b"></i> 次日博弈预案：</b>${bFocus}`;
    }
  } else {
    try {
      const res = await authFetch(`/api/review/daily-report?date=${_selectedReviewDate}`);
      const json = await res.json();
      if (json.code === 200 && json.data) {
        const d = json.data;
        if (narrativeEl) narrativeEl.innerHTML = `<p style="margin:0">${d.sentiment_summary || '今日市场量价博弈正常。'}</p>`;
        if (planEl) planEl.innerHTML = `<b style="display:inline-flex;align-items:center;gap:4px"><i class="ri-sun-line" style="color:#f59e0b"></i> 次日博弈预案：</b>${d.game_plan_tomorrow || '严格按照核心观察池纪律执行。'}`;
      }
    } catch (e) {
      if (narrativeEl) narrativeEl.textContent = '暂无已归档组长定调研报，请点击右上角【立即执行全团复盘】。';
    }
  }
}


// 渲染【复盘组长】
function renderSummaryLeadPanel(container) {
  let narrativeText = "正在从全市场 5200+ 标的汇聚 7 人小智能体定调...";
  let planText = "正在结合核心观察池龙头生成次日博弈预案...";

  if (_fullAgentDashboardData && _fullAgentDashboardData.market_overview) {
    const mkt = _fullAgentDashboardData.market_overview;
    narrativeText = mkt.narrative || '今日全市场行情运行平稳，盘面围绕科技与核心主线活跃博弈。';
    const bFocus = (_fullAgentDashboardData.volatility && _fullAgentDashboardData.volatility.ladder_stocks) 
      ? `聚焦核心空间龙头【${_fullAgentDashboardData.volatility.ladder_stocks.lead_desc}】，严格执行止损纪律。` 
      : '严格按照 4 层漏斗核心观察池标的进行跟踪操作。';
    planText = `<b style="display:inline-flex;align-items:center;gap:4px"><i class="ri-sun-line" style="color:#f59e0b"></i> 次日博弈预案：</b>${bFocus}`;
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_main')" style="font-size:15px;color:var(--sys-text-title, #1e293b);display:inline-flex;align-items:center;gap:6px">
          <i class="ri-vip-crown-fill" style="color:#e3b341"></i>
          <span>复盘组长 · 今日市场审美定调与次日博弈推演</span>
          <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
        </b>
        <div id="rwLeadNarrative" style="margin-top:12px;font-size:14px;color:#c9d1d9;line-height:1.7">${narrativeText}</div>
        <div id="rwLeadGamePlan" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--sys-border, #e2e8f0);font-size:13px;color:var(--sys-text-sub, #64748b);line-height:1.6">${planText}</div>
      </div>
    </div>
  `;

  // 若无缓存数据则异步拉取并更新
  if (!_fullAgentDashboardData || !_fullAgentDashboardData.market_overview) {
    loadIntegratedReviewDashboard();
  }
}


// 渲染【4层核心观察池】
function renderWatchlistPoolPanel(container) {

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      
      <!-- 4 层漏斗过滤关卡规则可视化看板 (纯中文通俗展示·彻底清除LaTeX乱码) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:10px">
        
        <!-- 关卡 1 -->
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #58a6ff;border-radius:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#58a6ff"><i class="ri-filter-line"></i> 关卡 1 · 波动初筛</span>
            <span id="fnRevStage1Tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(88,166,255,0.15);color:#58a6ff">动态过滤中</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>振幅 ≥ 4.5% 或 量比 > 1.8<br>
            <span id="fnRevStage1Flow" style="color:var(--sys-text-sub)">全市场初筛载入中...</span>
          </div>
        </div>

        <!-- 关卡 2 -->
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #3fb950;border-radius:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#3fb950"><i class="ri-shield-check-line"></i> 关卡 2 · 排雷与流动性</span>
            <span id="fnRevStage2Tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(63,185,80,0.15);color:#3fb950">动态排雷中</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>非ST / 无立案 · 日成交额 ≥ 1.5 亿元<br>
            <span id="fnRevStage2Flow" style="color:var(--sys-text-sub)">流动性过滤中...</span>
          </div>
        </div>

        <!-- 关卡 3 -->
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #e3b341;border-radius:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#e3b341"><i class="ri-line-chart-line"></i> 关卡 3 · 筹码形态健康</span>
            <span id="fnRevStage3Tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(227,179,65,0.15);color:#e3b341">欧奈尔量价</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>换手率 2.5% ~ 30% · 均线多头 / 突破<br>
            <span id="fnRevStage3Flow" style="color:var(--sys-text-sub)">筹码形态校验中...</span>
          </div>
        </div>

        <!-- 关卡 4 -->
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #d2a8ff;border-radius:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#d2a8ff"><i class="ri-vip-crown-line"></i> 关卡 4 · 逻辑归因提纯</span>
            <span id="fnRevStage4Tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(210,168,255,0.15);color:#d2a8ff">锁定身位</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>四类互斥归因 · 置信度 ≥ 40%<br>
            <span id="fnRevStage4Flow" style="color:var(--sys-text-sub)">龙头精炼中...</span>
          </div>
        </div>

      </div>

      <!-- 核心观察池数据表格 (对齐标准后台管理系统规范·置信度降序·操作列独立) -->
      <div class="panel" style="margin:0;padding:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);overflow:hidden">
        <div style="padding:14px 18px;background:var(--sys-table-header);border-bottom:1px solid var(--sys-border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <h3 class="clickable-feature-title" onclick="openFeatureGuideModal('review_funnel')" style="margin:0;font-size:15px;color:var(--sys-text-title, #1e293b);display:inline-flex;align-items:center;gap:6px">
              <i class="ri-filter-3-line" style="color:var(--sys-accent)"></i>
              <span>4层过滤黄金核心观察池 · 共 <span id="rwWatchCount" style="color:#58a6ff;font-weight:700">0</span> 只</span>
              <i class="ri-information-line feature-info-btn"></i>
            </h3>
            <span style="font-size:11px;color:var(--sys-text-sub);background:rgba(255,255,255,0.04);padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.08)">按置信度由高到低排序</span>
          </div>

          <div style="display:flex;gap:10px;align-items:center">
            <input type="text" id="rwStockSearch" placeholder="搜索代码 / 名称 / 板块..." style="background:var(--sys-bg-panel);border:1px solid var(--sys-border);color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;width:220px" oninput="onWatchSearchInput()">
            <button class="btn btn-outline" style="padding:4px 12px;font-size:11px;display:flex;align-items:center;gap:4px" onclick="loadIntegratedWatchlistData()">
              <i class="ri-refresh-line"></i>
              <span>刷新数据</span>
            </button>
          </div>
        </div>

        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left">
            <thead>
              <tr style="background:var(--sys-table-header);border-bottom:1px solid var(--sys-border);color:var(--sys-text-sub, #64748b)">
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
              </tr>
            </thead>
            <tbody id="rwWatchTableBody">
              <tr><td colspan="12" style="text-align:center;padding:30px;color:var(--sys-text-sub, #64748b)">正在加载核心观察池...</td></tr>
            </tbody>
          </table>
        </div>

        <div id="rwWatchPagination" style="padding:12px 18px;padding-right:220px;display:flex;justify-content:space-between;align-items:center;background:var(--sys-bg-sub, #f1f5f9);border-top:1px solid var(--sys-border, #e2e8f0);font-size:12px;color:var(--sys-text-sub, #64748b)">
          <div>共 <span id="rwWatchTotalCount" style="color:#58a6ff;font-weight:700">0</span> 只</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" id="rwWatchPrevBtn" onclick="changeWatchPage(-1)">◀ 上一页</button>
            <span id="rwWatchPageIndicator" style="font-family:'JetBrains Mono',monospace;color:var(--sys-text-title, #1e293b)">1 / 1</span>
            <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" id="rwWatchNextBtn" onclick="changeWatchPage(1)">下一页 ▶</button>
          </div>
        </div>

      </div>

    </div>
  `;
  loadIntegratedWatchlistData();
}

let _watchPage = 1;

let _watchPageSize = 10;
let _watchTotalPages = 1;

async function loadIntegratedWatchlistData() {
  // 确保历史日期快速胶囊已同步
  if (_availableWatchDates.length === 0) {
    loadAvailableWatchpoolDates();
  }

  // 同步刷新进攻红榜与避雷黑榜徽章
  if (typeof window.refreshWatchpoolBadges === 'function') {
    window.refreshWatchpoolBadges(_selectedReviewDate);
  }

  // 并发拉取 4 层漏斗真实淘汰流水并刷新顶部 4 张卡片
  loadFunnelStageStats(_selectedReviewDate);

  // 若当前切到【⚠️ 避雷黑榜】，直接分流调用黑榜加载器
  if (_currentWatchRankType === 'black') {
    loadBlacklistWatchlistData();
    return;
  }

  const tbody = document.getElementById('rwWatchTableBody');
  const countEl = document.getElementById('rwWatchCount');
  const totalCountEl = document.getElementById('rwWatchTotalCount');
  const pageInd = document.getElementById('rwWatchPageIndicator');
  const searchInput = document.getElementById('rwStockSearch');
  let query = searchInput ? searchInput.value.trim() : '';
  const currentUsername = (localStorage.getItem('quant_username') || 'admin').toLowerCase();
  // 彻底阻断浏览器将当前登录用户名(如 admin)自动填充到搜索框导致的致命误过滤
  if (query.toLowerCase() === 'admin' || query.toLowerCase() === currentUsername) {
    query = '';
    if (searchInput) searchInput.value = '';
  }
  const clearBtn = document.getElementById('rwStockSearchClearBtn');
  if (clearBtn && searchInput) {
    clearBtn.style.display = searchInput.value ? 'block' : 'none';
  }

  if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--sys-text-sub, #64748b)"><span class="spinner"></span> 正在实时加载核心观察池数据...</td></tr>';

  try {
    const res = await authFetch(`/api/review/core-watchlist?date=${_selectedReviewDate}&page=${_watchPage}&page_size=${_watchPageSize}&search=${encodeURIComponent(query)}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      // 智能对齐日期
      if (json.trade_date && json.trade_date !== _selectedReviewDate && (!_availableWatchDates.includes(_selectedReviewDate))) {
        _selectedReviewDate = json.trade_date;
        window._selectedReviewDate = json.trade_date;
        const picker = document.getElementById('watchpoolDatePicker');
        if (picker) picker.value = json.trade_date;
        const rwSelector = document.getElementById('rwDateSelector');
        if (rwSelector) rwSelector.value = json.trade_date;
      }

      let list = json.data;
      
      // 1. 严格按置信度由高到低降序排序
      list.sort((a, b) => (parseFloat(b.attribution_confidence || 0) - parseFloat(a.attribution_confidence || 0)));

      const total = json.total || list.length;
      _watchTotalPages = json.total_pages || Math.max(1, Math.ceil(total / _watchPageSize));
      if (_watchPage > _watchTotalPages) _watchPage = _watchTotalPages;
      if (_watchPage < 1) _watchPage = 1;

      if (countEl) countEl.textContent = total;
      const badgeRed = document.getElementById('badgeRedCount'); if (badgeRed) badgeRed.textContent = total;
      if (totalCountEl) totalCountEl.textContent = total;
      if (pageInd) pageInd.textContent = `${_watchPage} / ${_watchTotalPages}`;

      if (list.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--sys-text-sub, #64748b)">当前筛选条件下暂无股票，请先点击【⚡ 立即执行全团复盘】</td></tr>';
        renderWatchpoolElementPlusPagination(0);
        return;
      }

      // 关键：对返回列表进行分页切片处理 (如果后端返回全量则切片，若后端已切片则保留)
      const displayItems = (list.length > _watchPageSize) 
        ? list.slice((_watchPage - 1) * _watchPageSize, _watchPage * _watchPageSize) 
        : list;

      if (tbody) {
        tbody.innerHTML = displayItems.map(item => {
          const chg = parseFloat(item.change_pct || 0);
          const chgColor = chg >= 0 ? '#f85149' : '#3fb950';
          const chgText = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
          const conf = parseFloat(item.attribution_confidence || 0.85);
          const refTag = item.evidence_ref || `ref:${item.stock_code}`;
          
          // 优雅纯中文归因格式化字典
          const attrTypeMap = {
            'technical_breakout': '技术形态放量突破',
            'policy_support': '国家政策重磅支持',
            'hotspot_driver': '行业突发利好催化',
            'us_mapping': '隔夜美股强映射',
            'earnings_surprise': '业绩超预期高增',
            'social_buzz': '游资全网热度发酵',
            'hot_money_influx': '主力大单逆势建仓',
            'unconfirmed': '盘口资金活跃试盘'
          };
          const rawAttr = String(item.attribution_type || '').toLowerCase();
          const cleanAttr = attrTypeMap[rawAttr] || item.attribution_type || '主线逻辑共振';

          return `
            <tr style="border-bottom:1px solid var(--sys-border, #e2e8f0);transition:background 0.2s" onmouseover="this.style.background='var(--sys-bg-hover, #f1f5f9)'" onmouseout="this.style.background='transparent'">
              <td style="padding:10px 14px"><b style="color:#58a6ff;cursor:pointer" onclick="openStockDetail('${jsStr(item.stock_code)}')">${escapeHtml(item.stock_name)}</b> <span style="font-size:11px;color:var(--sys-text-sub, #64748b)">(${escapeHtml(item.stock_code)})</span></td>
              <td style="padding:10px 14px"><span style="background:rgba(88,166,255,0.15);color:#58a6ff;padding:2px 8px;border-radius:4px;font-size:11px">${escapeHtml(item.sector_name || '主线科技')}</span></td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--sys-text-sub, #64748b);white-space:nowrap">${escapeHtml(item.archive_time || item.created_at || '--')}</td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace;color:var(--sys-text-sub, #64748b)">${item.close_price ? '¥' + parseFloat(item.close_price).toFixed(2) : '--'}</td>
              <td style="padding:10px 14px;color:${chgColor};font-weight:700;font-family:'JetBrains Mono',monospace">${chgText}</td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace">
                <div style="font-weight:700;color:var(--sys-text-title, #1e293b)">${item.current_price ? '¥' + parseFloat(item.current_price).toFixed(2) : (item.close_price ? '¥' + parseFloat(item.close_price).toFixed(2) : '--')}</div>
                ${item.current_change_pct !== undefined && item.current_change_pct !== null ? `
                  <div style="font-size:11px;color:${parseFloat(item.current_change_pct) >= 0 ? '#f85149' : '#3fb950'};font-weight:600">
                    今日 ${parseFloat(item.current_change_pct) >= 0 ? '+' : ''}${parseFloat(item.current_change_pct).toFixed(2)}%
                  </div>
                ` : ''}
              </td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace">
                ${(() => {
                  const sincePct = parseFloat(item.since_added_pct || 0);
                  const isPos = sincePct > 0;
                  const isNeg = sincePct < 0;
                  const bg = isPos ? 'rgba(248,81,73,0.12)' : (isNeg ? 'rgba(63,185,80,0.12)' : 'rgba(148,163,184,0.12)');
                  const color = isPos ? '#f85149' : (isNeg ? '#3fb950' : 'var(--sys-text-sub, #64748b)');
                  const border = isPos ? 'rgba(248,81,73,0.3)' : (isNeg ? 'rgba(63,185,80,0.3)' : 'rgba(148,163,184,0.25)');
                  const sign = isPos ? '+' : '';
                  return `<span style="background:${bg};color:${color};border:1px solid ${border};padding:3px 8px;border-radius:6px;font-weight:700;font-size:12px;display:inline-block;white-space:nowrap" title="入池基准价: ¥${item.close_price || '--'} | 当前现价: ¥${item.current_price || '--'} | 归档时间: ${item.archive_time || item.created_at || '--'}">${sign}${sincePct.toFixed(2)}%</span>`;
                })()}
              </td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace;color:#d29922">${item.turnover_rate ? parseFloat(item.turnover_rate).toFixed(2) + '%' : '--'}</td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace">${item.amount_yi ? parseFloat(item.amount_yi).toFixed(1) + ' 亿' : '--'}</td>
              <td style="padding:10px 14px;color:var(--sys-text-title, #1e293b)">
                <span style="background:rgba(255,255,255,0.06);color:var(--sys-text-primary);padding:2px 8px;border-radius:4px;font-size:11.5px;border:1px solid rgba(255,255,255,0.1)">${cleanAttr}</span>
              </td>
              <td style="padding:10px 14px">
                <span style="background:rgba(63,185,80,0.15);color:#3fb950;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;border:1px solid rgba(63,185,80,0.3)">${Math.round(conf * 100)}%</span>
              </td>
              <td style="padding:10px 14px;text-align:center;white-space:nowrap">
                <button class="btn btn-outline" style="padding:3px 8px;font-size:11.5px;font-weight:700;color:#58a6ff;border-color:rgba(88,166,255,0.35);background:rgba(88,166,255,0.08);cursor:pointer;display:inline-flex;align-items:center;gap:4px;border-radius:4px" onclick="openStockResearchModal('${jsStr(item.stock_code)}')">
                  <i class="ri-newspaper-line"></i>
                  <span>查催化研报</span>
                </button>
                <button class="btn btn-outline" style="font-size:11.5px;padding:3px 8px;background:rgba(16,185,129,0.1);border-color:rgba(16,185,129,0.35);color:#10b981;cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-left:6px;font-weight:700;border-radius:4px" onclick="jumpToSingleStockBacktest('${jsStr(item.stock_code)}')" title="一键将该推荐标的带入【🔬 任意单股战法体检室】进行真实历史战法回测与胜率检验">
                  <i class="ri-flask-line"></i>
                  <span>战法体检</span>
                </button>
                <button class="el-button el-button--primary is-plain" style="padding:3px 8px;height:auto;font-size:11.5px;font-weight:700;border-radius:4px;background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.35);color:#58a6ff;cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-left:6px" onclick="jumpToAlphaCalc('${jsStr(item.stock_code)}')" title="一键将该标的带入 Alpha 盘中实战测算器">
                  <i class="ri-crosshair-2-line"></i>
                  <span>测算买盘</span>
                </button>
              </td>

            </tr>
          `;
        }).join('');
      }
      renderWatchpoolElementPlusPagination(total);
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--sys-text-sub, #64748b)">${escapeHtml(json.message || '暂无数据')}</td></tr>`;
      renderWatchpoolElementPlusPagination(0);
    }
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;color:#f85149">加载失败: ${e.message}</td></tr>`;
    renderWatchpoolElementPlusPagination(0);
  }
}


function jumpWatchPage(p) {
  const target = parseInt(p) || 1;
  if (target < 1 || target > _watchTotalPages || target === _watchPage) return;
  _watchPage = target;
  if (typeof _currentWatchpoolRankType !== 'undefined' && _currentWatchpoolRankType === 'black' && typeof window.loadBlacklistWatchlistData === 'function') {
    window.loadBlacklistWatchlistData();
  } else {
    loadIntegratedWatchlistData();
  }
}
window.jumpWatchPage = jumpWatchPage;

function changeWatchPage(delta) {
  jumpWatchPage(_watchPage + delta);
}
window.changeWatchPage = changeWatchPage;

function renderWatchpoolElementPlusPagination(total) {
  if (typeof window.renderElementPlusPagination === 'function') {
    window.renderElementPlusPagination({
      mount: '#rwWatchPagination',
      total: total,
      page: _watchPage,
      pageSize: _watchPageSize,
      pageSizes: [10, 20, 50],
      totalTemplate: '当前归档共 <b style="color:#58a6ff">{total}</b> 只标的',
      onPageChange: 'jumpWatchPage',
      onSizeChange: 'onWatchpoolPageSizeChanged'
    });
  }
}
window.renderWatchpoolElementPlusPagination = renderWatchpoolElementPlusPagination;

function clearWatchSearchInput() {
  const input = document.getElementById('rwStockSearch');
  if (input) {
    input.value = '';
    onWatchSearchInput();
  }
}
window.clearWatchSearchInput = clearWatchSearchInput;

function onWatchSearchInput() {
  const input = document.getElementById('rwStockSearch');
  const clearBtn = document.getElementById('rwStockSearchClearBtn');
  if (clearBtn && input) {
    clearBtn.style.display = input.value ? 'block' : 'none';
  }
  _watchPage = 1; // 搜索时强制重置为第1页，防止页码越界
  if (typeof _currentWatchpoolRankType !== 'undefined' && _currentWatchpoolRankType === 'black' && typeof window.loadBlacklistWatchlistData === 'function') {
    window.loadBlacklistWatchlistData();
  } else {
    loadIntegratedWatchlistData();
  }
}
window.onWatchSearchInput = onWatchSearchInput;



// 手动触发 Pipeline A (接入 Qwen2.5-7B 大模型深度推理)
async function triggerIntegratedPipelineA() {
  if (!confirm(`确定立即触发【${_selectedReviewDate}】交易日的全市场 7 人智能体与本地 Qwen2.5 深度复盘吗？`)) return;
  showToast("⏳ 正在执行全市场扫描、4层漏斗与本地 Qwen2.5-7B 大模型深度推演 (约 8-12 秒)...", "info", 15000);
  
  const btn = document.querySelector('button[onclick="triggerIntegratedPipelineA()"]');
  const oldText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ 大模型深度复盘中...';
  }

  try {
    const res = await authFetch(`/api/review/trigger-pipeline-a?date=${_selectedReviewDate}`, { method: 'POST' });
    const json = await res.json();
    if (json.code === 409) {
      showToast(json.message, 'warning');
      return;
    }
    if (json.code !== 200) {
      showToast(json.message || '复盘流水线执行异常', 'error');
      return;
    }
    showToast(`🎉 复盘完成！由本地 Qwen2.5-7B 深度推理生成，耗时 ${json.execution_time_sec} 秒，已精选出 ${json.watchpool_count} 只黄金标的！`, 'success', 6000);
    loadIntegratedReviewDashboard();
    loadIntegratedWatchlistData();
    loadIntegratedNewsData();
    loadIntegratedAttributionMatrix();
  } catch (e) {
    showToast("触发复盘失败: " + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldText;
    }
  }
}


// 导出自选股 (带 0 字节拦截防御)
async function exportIntegratedReviewTxt() {
  try {
    showToast('正在导出自选股纯文本文件...', 'info');
    const res = await authFetch(`/api/review/export-txt?date=${_selectedReviewDate}`);
    if (!res.ok) {
      showToast('导出自选股失败，请检查登录状态', 'error');
      return;
    }
    const text = await res.text();
    if (!text || text.trim().length === 0) {
      showToast(`【${_selectedReviewDate}】观察池暂无有效股票，请先点击【⚡ 立即执行全团复盘】！`, 'warning');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `A股核心观察池_${_selectedReviewDate}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    showToast(`【${_selectedReviewDate}】自选股已成功下载！`, 'success');
  } catch (e) {
    showToast('导出异常: ' + e.message, 'error');
  }
}




// ==================== 📋 选股池一键复制代码 (通达信 / 同花顺 / 东财快速导入) ====================
/**
 * 一键复制当前复盘选股池的股票代码
 * @param {string} format 'plain' (纯代码6位换行) | 'tdx' (带SH/SZ前缀)
 */
async function copyWatchlistCodesToClipboard(format) {
  format = format || 'plain';
  try {
    showToast('正在提取复盘观察池标的代码...', 'info', 2000);
    const res = await authFetch(`/api/review/export-txt?date=${_selectedReviewDate}`);
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        const lines = text.split('\n');
        const codes = [];
        for (const line of lines) {
          const m = line.match(/\b(?:(SH|SZ))?(\d{6})\b/i);
          if (m && m[2]) {
            const num = m[2];
            const pfx = (m[1] ? m[1].toUpperCase() : (num.startsWith('6') ? 'SH' : 'SZ')) + num;
            const finalCode = (format === 'tdx' || format === 'prefix') ? pfx : num;
            if (!codes.includes(finalCode)) codes.push(finalCode);
          }
        }
        if (codes.length > 0) {
          const copyStr = codes.join('\n');
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(copyStr);
          } else {
            const textArea = document.createElement('textarea');
            textArea.value = copyStr;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
          }
          showToast(`📋 已成功复制 ${codes.length} 只股票代码到剪贴板！可直接在通达信/同花顺中 Ctrl+V 批量导入。`, 'success', 4000);
          return;
        }
      }
    }
    // 兜底从当前 DOM 提取
    const tableRows = document.querySelectorAll('table tbody tr');
    const codes = [];
    tableRows.forEach(tr => {
      if (tr.querySelector('td[colspan]')) return;
      const codeEl = tr.querySelector('.stock-code') || tr.querySelector('b') || tr.querySelector('td:first-child');
      if (codeEl) {
        const m = codeEl.innerText.trim().match(/\b\d{6}\b/);
        if (m && !codes.includes(m[0])) codes.push(m[0]);
      }
    });
    if (codes.length === 0) {
      showToast('当前暂无可复制的股票代码', 'warning');
      return;
    }
    const copyStr = codes.join('\n');
    await navigator.clipboard.writeText(copyStr);
    showToast(`📋 已成功复制 ${codes.length} 只股票代码到剪贴板！`, 'success', 4000);
  } catch (err) {
    showToast('复制代码失败: ' + err.message, 'error');
  }
}
window.copyWatchlistCodesToClipboard = copyWatchlistCodesToClipboard;

window.switchAgentView = switchAgentView;
window.loadFullAgentDashboardData = loadFullAgentDashboardData;
window.renderCurrentAgentView = renderCurrentAgentView;
window.changeIntegratedReviewDate = changeIntegratedReviewDate;
window.loadIntegratedReviewDashboard = loadIntegratedReviewDashboard;
// ==================== ⚡ 东方财富：一键按今日日期建组导入 ====================
let _currentEastmoneyStocks = [];

/**
 * ⚡ 核心主力：无需打开东财网页，无需拖动书签，量化系统后台直接调官方API秒级建组同步！
 */
async function syncEastmoneyDirectly() {
  const btn = document.getElementById("btnDirectSyncEastmoney");
  const textEl = document.getElementById("btnDirectSyncEastmoneyText");
  const originalText = textEl ? textEl.innerHTML : "⚡ 一键直接同步到东财自选";

  // 1. 获取当前选中的复盘日期
  const todayLive = new Date().toISOString().slice(0, 10);
  const targetDate = _selectedReviewDate || todayLive;

  if (btn) btn.disabled = true;
  if (textEl) textEl.innerHTML = "⏳ 正在同步到东财云端...";

  try {
    const res = await fetch("/api/eastmoney/sync-watchlist-group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: targetDate })
    });
    const json = await res.json();

    if (json.code === 200 && json.status === "success") {
      alert(json.message || ("🎉 成功在东方财富创建【" + json.group_name + "】并同步 " + json.synced_count + " 只标的！"));
      if (textEl) textEl.innerHTML = "✅ 同步成功 (" + json.group_name + ")";
      setTimeout(() => {
        if (textEl) textEl.innerHTML = originalText;
      }, 5000);
    } else {
      alert("⚠️ 同步提示：\n\n" + (json.message || "请求失败，请稍后重试"));
      if (textEl) textEl.innerHTML = originalText;
    }
  } catch (err) {
    console.error("直接同步东财失败:", err);
    alert("❌ 同步异常：" + err.message);
    if (textEl) textEl.innerHTML = originalText;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * 📖 辅助弹窗：展示当前标的、提供txt板块导出、控制台脚本与书签
 */
async function openEastmoneyImportModal() {
  const modal = document.getElementById("eastmoneyImportModal");
  if (!modal) return;

  const todayLive = new Date().toISOString().slice(0, 10);
  const dateStr = _selectedReviewDate || todayLive;
  const parts = dateStr.split("-");
  const gname = parts.length === 3 ? (parts[1] + "月" + parts[2] + "日黄金龙头") : (dateStr + "黄金龙头");

  const listContainer = document.getElementById("emModalStockListPills");
  const countBadge = document.getElementById("emModalStockCountBadge");
  const dragBtn = document.getElementById("emBookmarkDragBtn");
  const dragText = document.getElementById("emBookmarkDragText");
  const downloadText = document.getElementById("emDownloadBtnText");

  if (listContainer) listContainer.innerHTML = "<span style='color:#64748b'>正在提取股票数据...</span>";
  modal.style.display = "flex";

  try {
    const res = await authFetch("/api/review/core-watchlist?date=" + dateStr + "&page=1&page_size=200");
    const json = await res.json();
    let stocks = [];
    if (json && json.data && json.data.length > 0) {
      stocks = json.data.map(item => ({
        symbol: String(item.stock_code || item.symbol || "").padStart(6, "0"),
        name: String(item.stock_name || item.name || item.stock_code || "")
      })).filter(s => s.symbol && s.symbol.length === 6);
    }

    if (stocks.length === 0) {
      const rows = document.querySelectorAll("#rwWatchTableBody tr");
      rows.forEach(tr => {
        const tdCode = tr.querySelector("td:nth-child(1)");
        const tdName = tr.querySelector("td:nth-child(3)");
        if (tdCode) {
          const m = tdCode.innerText.match(/(\d{6})/);
          if (m) {
            const rawName = tdName ? tdName.innerText.trim() : m[1];
            stocks.push({ symbol: m[1], name: rawName || m[1] });
          }
        }
      });
    }

    _currentEastmoneyStocks = stocks;

    if (countBadge) countBadge.textContent = stocks.length + " 只标的";
    if (downloadText) downloadText.textContent = "📥 下载 " + dateStr + "_黄金龙头.txt";
    if (dragText) dragText.textContent = "⭐ 导入东财 (点击/拖拽)";

    if (listContainer) {
      if (stocks.length === 0) {
        listContainer.innerHTML = "<span style='color:#f85149'>暂无可导出的标的</span>";
      } else {
        listContainer.innerHTML = stocks.map(s => 
          "<span style='display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;background:rgba(137,87,229,0.12);color:#5b21b6;font-weight:700;font-size:12.5px;border:1px solid rgba(137,87,229,0.25)'>" +
          "<span>" + s.name + "</span><span style='font-family:monospace;font-size:11.5px;color:#7c3aed;font-weight:600'>" + s.symbol + "</span></span>"
        ).join("");
      }
    }

    // 纯前端东财接口直连脚本（绝不调用任何外部HTTP，彻底杜绝Mixed Content跨域拦截）
    if (dragBtn && stocks.length > 0) {
      const stockArrStr = JSON.stringify(stocks);
      const pureScript = "javascript:(function(){(async function(){" +
        "try{" +
        "if(!location.hostname.includes('eastmoney.com')){" +
        "alert('⚠️ 提示：请在东方财富自选股网页（quote.eastmoney.com/zixuan/）点击本书签！\n\n正在为您自动打开东方财富网页...');" +
        "window.open('https://quote.eastmoney.com/zixuan/','_blank');return;" +
        "}" +
        "var gname = '" + gname + "';" +
        "var stocks = " + stockArrStr + ";" +
        "var appkey = 'e9166c7e9cdfad3aa3fd7d93b757e9b1';" +
        "var ts = Date.now();" +
        "var gResp = await fetch('https://myfavor.eastmoney.com/v4/webouter/ggdefstkindexinfos?appkey='+appkey+'&g=1&_='+ts,{credentials:'include'});" +
        "var gJson = await gResp.json();" +
        "var groups = (gJson.data && gJson.data.ginfolist) || [];" +
        "var targetGid = null;" +
        "for(var g of groups){ if(g.gname === gname){ targetGid = g.gid; break; } }" +
        "if(!targetGid){" +
        "  var cResp = await fetch('https://myfavor.eastmoney.com/v4/webouter/ag?appkey='+appkey+'&gn='+encodeURIComponent(gname)+'&_='+Date.now(),{credentials:'include'});" +
        "  var cJson = await cResp.json();" +
        "  if(cJson.state === 0 && cJson.data){ targetGid = cJson.data.gid; }" +
        "}" +
        "if(!targetGid) targetGid = '1';" +
        "var ok = 0;" +
        "for(var s of stocks){" +
        "  var sym = s.symbol;" +
        "  var sc = (parseInt(sym)>=600000?'1%24':'0%24')+sym;" +
        "  try{" +
        "    var aResp = await fetch('https://myfavor.eastmoney.com/v4/webouter/as?appkey='+appkey+'&g='+targetGid+'&sc='+sc+'&_='+Date.now(),{credentials:'include'});" +
        "    var aJson = await aResp.json();" +
        "    if(aJson.state === 0 || aJson.state === -217) ok++;" +
        "  }catch(e){ console.warn('导入自选异常:', e); }" +
        "}" +
        "alert('🎉 东方财富导入成功！\n\n📂 专属分组：【'+gname+'】\n📊 已导入标的：'+ok+' 只\n📱 手机App与电脑端即刻刷新可见！');" +
        "location.reload();" +
        "}catch(err){ alert('❌ 导入异常: '+err.message); }" +
        "})();void(0);})();";

      dragBtn.setAttribute("href", pureScript);
    }
  } catch (err) {
    console.error("加载东财自选弹窗失败:", err);
    if (listContainer) listContainer.innerHTML = "<span style='color:#f85149'>获取标的失败: " + err.message + "</span>";
  }
}

function closeEastmoneyImportModal() {
  const modal = document.getElementById("eastmoneyImportModal");
  if (modal) modal.style.display = "none";
}

function downloadEastmoneyBlockFile() {
  if (!_currentEastmoneyStocks || _currentEastmoneyStocks.length === 0) {
    alert("暂无可导出的股票！");
    return;
  }
  const dateStr = _selectedReviewDate || new Date().toISOString().slice(0, 10);
  const fileName = dateStr + "_黄金龙头.txt";

  const content = _currentEastmoneyStocks.map(s => {
    const pfx = parseInt(s.symbol) >= 600000 ? "SH" : "SZ";
    return pfx + s.symbol;
  }).join(String.fromCharCode(10));

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);

  alert("已生成并下载板块文件：" + fileName + String.fromCharCode(10) + String.fromCharCode(10) + "在东方财富电脑端【板块管理 -> 导入板块】选择此文件即可！");
}

async function copyEastmoneyCodesOnly() {
  if (!_currentEastmoneyStocks || _currentEastmoneyStocks.length === 0) {
    alert("暂无可复制的代码！");
    return;
  }
  const codes = _currentEastmoneyStocks.map(s => s.symbol).join(String.fromCharCode(10));
  let ok = false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(codes);
      ok = true;
    } catch(e) { console.warn('clipboard.writeText codes warn:', e); }
  }
  if (!ok) {
    const ta = document.createElement("textarea");
    ta.value = codes;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  alert("已复制 " + _currentEastmoneyStocks.length + " 只股票代码到剪贴板！切到东方财富按 Ctrl+V 即可批量粘贴。");
}

async function copyBookmarkScriptCode() {
  const dragBtn = document.getElementById("emBookmarkDragBtn");
  if (!dragBtn) return;
  const script = dragBtn.getAttribute("href") || "";
  if (!script || script === "javascript:void(0);") {
    alert("正在加载股票数据，请稍等1秒后重试！");
    return;
  }
  let ok = false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(script);
      ok = true;
    } catch(e) { console.warn('clipboard.writeText script warn:', e); }
  }
  if (!ok) {
    const ta = document.createElement("textarea");
    ta.value = script;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  alert("🎉 控制台代码已成功复制！\n\n在东方财富网页按 F12 打开 Console 控制台，按 Ctrl+V 粘贴回车即可一键全自动建组导入！");
}

window.syncEastmoneyDirectly = syncEastmoneyDirectly;
window.openEastmoneyImportModal = openEastmoneyImportModal;
window.closeEastmoneyImportModal = closeEastmoneyImportModal;
window.downloadEastmoneyBlockFile = downloadEastmoneyBlockFile;
window.copyEastmoneyCodesOnly = copyEastmoneyCodesOnly;
window.copyBookmarkScriptCode = copyBookmarkScriptCode;
window.loadIntegratedWatchlistData = loadIntegratedWatchlistData;
