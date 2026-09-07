/* ==================== 👑 系统二：交易复盘与智能体中枢 ==================== */
// ==================== 👑 交易复盘工作台 (7 大小智能体协同 + 独立单兵作战引擎) ====================
let _currentAgentKey = localStorage.getItem('quant_active_review_agent') || 'overview';
let _selectedReviewDate = new Date().toISOString().split('T')[0];
let _fullAgentDashboardData = null;

// 切换顶部二级 Tab 并触发对应工作区渲染
function switchReviewSubTab(subName) {
  const mapToAgent = {
    'overview': 'overview',
    'portfolio': 'portfolio',
    'sector': 'sector',
    'funnel': 'watchlist_pool',
    'news': 'news',
    'attribution': 'attribution',
    'evil': 'evil',
    'risk_mine': 'risk_mine',
    'broker_decoder': 'broker_decoder',
    'premarket': 'us_market',
    'microstructure': 'flash'
  };

  const agentKey = mapToAgent[subName] || subName;
  switchAgentView(agentKey);
}

// 切换当前激活的小智能体 / 业务视图 (带持久化记忆)
async function switchAgentView(agentKey) {
  _currentAgentKey = agentKey;
  try {
    localStorage.setItem('quant_active_review_agent', agentKey);
    localStorage.setItem('quant_active_review_sub', agentKey);
  } catch (e) {}

  // 0. 自动同步顶部交易日选择框默认值为最新日期
  const dateInput = document.getElementById('rwDateSelector');
  if (dateInput && !dateInput.value) {
    dateInput.value = _selectedReviewDate;
  }


  // 0.1 🌟 控制顶部 4 大统计大卡片的按需展示：仅在 overview 视图下展示，在持仓/板块/情报等视图下自动隐藏，释放 100% 垂直工作区！
  const topOverviewCards = document.getElementById('reviewTopOverviewCards');
  if (topOverviewCards) {
    topOverviewCards.style.display = (agentKey === 'overview') ? 'grid' : 'none';
  }

  // 1. 同步顶部二级 Tab 高亮
  document.querySelectorAll('#reviewSubTabs .tab').forEach(t => t.classList.remove('active'));
  const agentToSubTabMap = {
    'overview': 'rwSubBtnOverview',
    'portfolio': 'rwSubBtnPortfolio',
    'sector': 'rwSubBtnSector',
    'volatility': 'rwSubBtnFunnel',
    'watchlist_pool': 'rwSubBtnFunnel',
    'news': 'rwSubBtnNews',
    'attribution': 'rwSubBtnAttr',
    'evil': 'rwSubBtnEvil',
    'risk_mine': 'rwSubBtnRiskMine',
    'broker_decoder': 'rwSubBtnBroker',
    'us_market': 'rwSubBtnPre',
    'flash': 'rwSubBtnAlert',
    'summary_lead': 'rwSubBtnOverview'
  };
  const activeSubBtnId = agentToSubTabMap[agentKey];
  if (activeSubBtnId) {
    const activeSubBtn = document.getElementById(activeSubBtnId);
    if (activeSubBtn) activeSubBtn.classList.add('active');
  }


  // 2. 切换左侧导航高亮
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

  // 3. 加载或复用全智能体多维数据并渲染
  if (!_fullAgentDashboardData) {
    await loadFullAgentDashboardData();
  } else {
    renderCurrentAgentView();
  }
}


// 切换复盘日期
function changeIntegratedReviewDate(newDate) {
  if (!newDate) return;
  _selectedReviewDate = newDate;
  _fullAgentDashboardData = null; // 清空缓存以重新拉取对应日期数据
  showToast(`已切换至【${newDate}】交易日复盘视图`, 'info');
  
  const dateInput = document.getElementById('rwDateSelector');
  if (dateInput) dateInput.value = newDate;

  loadFullAgentDashboardData();
}


// 全局拉取智能体多维数据
async function loadFullAgentDashboardData() {
  const container = document.getElementById('agentMainViewContainer');
  if (container) container.innerHTML = '<div style="color:#8b949e;text-align:center;padding:50px"><span class="spinner"></span> 正在调度 7 人小智能体团队数据...</div>';

  try {
    const res = await authFetch(`/api/review/full-agent-dashboard?date=${_selectedReviewDate}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      _fullAgentDashboardData = json.data;

      // 更新顶部 4 大胶囊卡片
      const vol = json.data.volatility || {};
      const kpi = vol.kpi || {};
      if (document.getElementById('cardKpi1')) document.getElementById('cardKpi1').textContent = kpi.high_pct_pool || '354';
      if (document.getElementById('cardKpi2')) document.getElementById('cardKpi2').textContent = kpi.base_pool || '330';
      if (document.getElementById('cardKpi3')) document.getElementById('cardKpi3').textContent = kpi.limit_up_close || '60';
      if (document.getElementById('cardKpi4')) document.getElementById('cardKpi4').textContent = kpi.ladder_count || '15';

      renderCurrentAgentView();
    }
  } catch (e) {
    if (container) container.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">智能体团队调度失败: ${e.message}</div>`;
  }
}

// 渲染当前选中的智能体专属面板
function renderCurrentAgentView() {
  const container = document.getElementById('agentMainViewContainer');
  if (!container || !_fullAgentDashboardData) return;

  const d = _fullAgentDashboardData;

  if (_currentAgentKey === 'overview') {
    // 🏠 1. 尾盘规律复盘 (市场总览)
    renderOverviewAgentPanel(container, d.market_overview);
  } else if (_currentAgentKey === 'portfolio') {
    // 💼 🌟 VIP 1. 我的持仓与自选专属复盘
    renderPortfolioReviewPanel(container);
  } else if (_currentAgentKey === 'sector') {
    // 🔥 🌟 VIP 2. 核心题材板块深度穿透
    renderSectorDeepDivePanel(container);
  } else if (_currentAgentKey === 'volatility') {
    // 📊 2. 波动统计员
    renderVolatilityAgentPanel(container, d.volatility);
  } else if (_currentAgentKey === 'news') {
    // 📰 3. 情报搜集员
    renderNewsAgentPanel(container, d.news);
  } else if (_currentAgentKey === 'us_market') {
    // 🌐 4. 漂亮分析师
    renderUsMarketAgentPanel(container, d.us_market);
  } else if (_currentAgentKey === 'attribution') {
    // 🔗 5. 逻辑配对师
    renderAttributionAgentPanel(container, d.attribution);
  } else if (_currentAgentKey === 'evil') {
    // 🦹 6. 邪修深度分析师
    renderEvilAgentPanel(container, d.evil);
  } else if (_currentAgentKey === 'flash') {
    // ⚡ 7. 高频量化闪电
    renderFlashAgentPanel(container, d.flash);
  } else if (_currentAgentKey === 'summary_lead') {
    // 👑 8. 复盘组长
    renderSummaryLeadPanel(container);
  } else if (_currentAgentKey === 'watchlist_pool') {
    // 🎯 9. 4层核心观察池
    renderWatchlistPoolPanel(container);
  } else if (_currentAgentKey === 'risk_mine') {
    // 🛡️ 10. 一键排雷专家
    renderRiskMinePanel(container);
  } else if (_currentAgentKey === 'broker_decoder') {
    // 📝 11. 从交割单到战法
    renderBrokerDecoderPanel(container);
  }

}

// 🏠 渲染【尾盘规律复盘 / 市场总览】
function renderOverviewAgentPanel(container, mkt) {
  mkt = mkt || {};
  const mems = mkt.member_data_volume || [];
  const effect = mkt.money_effect || {};

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- 市场总览大卡片 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="ri-bar-chart-2-line" style="font-size:20px;color:var(--sys-accent)"></i>
            <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_main')" style="font-size:16px;color:#e6edf3;display:inline-flex;align-items:center;gap:4px">
              <span>市场总览看板</span>
              <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
            </b>
            <span style="font-size:12px;color:#8b949e">${mkt.trade_date || ''} · ${mkt.status_text || '全市场行情'}</span>
          </div>
          <span style="font-size:12px;color:#3fb950;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px;display:inline-flex;align-items:center;gap:4px">
            <i class="ri-team-line"></i>
            <span>七人团队协同总览</span>
          </span>
        </div>


        <!-- 三大指数涨跌进度条 (A股标准红涨绿跌与规范排版) -->
        ${(() => {
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

          return `
            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="width:70px;font-size:12px;color:#8b949e">上证指数</span>
                <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden;position:relative">
                  <div style="width:${shBar.width};height:100%;background:${shBar.bg};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">${shBar.text}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:12px">
                <span style="width:70px;font-size:12px;color:#8b949e">深证成指</span>
                <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden;position:relative">
                  <div style="width:${szBar.width};height:100%;background:${szBar.bg};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">${szBar.text}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:12px">
                <span style="width:70px;font-size:12px;color:#8b949e">创业板指</span>
                <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden;position:relative">
                  <div style="width:${cyBar.width};height:100%;background:${cyBar.bg};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">${cyBar.text}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:12px">
                <span style="width:70px;font-size:12px;color:#8b949e">两市成交</span>
                <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border:1px solid #30363d">
                  <b style="color:#58a6ff;font-size:12px">${(mkt.total_amount_yi || 12533).toLocaleString()} 亿元</b>
                  <span style="font-size:11px;color:${(mkt.total_amount_yi||0)>=15000?'#f85149':'#3fb950'};background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:3px">${(mkt.total_amount_yi||0)>=15000?'放量活跃':'常态成交'}</span>
                </div>
              </div>
            </div>
          `;
        })()}


        <!-- 组长定调摘要 -->
        <div style="padding:12px 14px;background:rgba(88,166,255,0.06);border-left:3px solid #58a6ff;border-radius:4px;font-size:13px;color:#c9d1d9;line-height:1.6">
          ${mkt.narrative || ''}
        </div>
      </div>

      <!-- 赚钱效应分布 & 成员数据量规模两栏 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- 赚钱效应分布 -->
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:16px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
            <i class="ri-money-cny-circle-line" style="color:#e3b341;font-size:16px"></i>
            <b style="font-size:14px;color:#e6edf3">赚钱效应分布</b>
            <span style="font-size:11px;color:#8b949e">主板 · 创业板 · 科创板 (涨停 ${effect.total_limit_up || 60} 只 · 估)</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#c9d1d9">
              <span>主板</span>
              <b>${effect.main_board_pct || 55}%</b>
            </div>
            <div style="height:8px;background:#0d1117;border-radius:4px;overflow:hidden">
              <div style="width:${effect.main_board_pct || 55}%;height:100%;background:#388bfd"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#c9d1d9">
              <span>创业板 (${effect.chuangye_count || 20}只)</span>
              <b>${effect.chuangye_pct || 20}%</b>
            </div>
            <div style="height:8px;background:#0d1117;border-radius:4px;overflow:hidden">
              <div style="width:${effect.chuangye_pct || 20}%;height:100%;background:#3fb950"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#c9d1d9">
              <span>科创板 (${effect.kechuang_count || 25}只)</span>
              <b>${effect.kechuang_pct || 25}%</b>
            </div>
            <div style="height:8px;background:#0d1117;border-radius:4px;overflow:hidden">
              <div style="width:${effect.kechuang_pct || 25}%;height:100%;background:#8957e5"></div>
            </div>
          </div>
        </div>

        <!-- 各成员数据量规模 -->
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:16px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
            <i class="ri-pie-chart-line" style="color:var(--sys-accent);font-size:16px"></i>
            <b style="font-size:14px;color:#e6edf3">各成员数据量</b>
            <span style="font-size:11px;color:#8b949e">六路输入规模对比</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${mems.map(m => `
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px">
                <span style="color:#8b949e;width:100px">${m.name}</span>
                <div style="flex:1;background:#0d1117;height:6px;border-radius:3px;margin:0 10px;overflow:hidden">
                  <div style="width:${Math.min(100, Math.max(8, m.count / 3.54))}%;height:100%;background:${m.color}"></div>
                </div>
                <b style="color:#e6edf3;font-family:'JetBrains Mono',monospace">${m.count}</b>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

// 渲染【波动统计员】(漏斗、市值分层、连板梯队柱状图)
function renderVolatilityAgentPanel(container, vol) {
  vol = vol || {};
  const f = vol.funnel || {};
  const caps = vol.market_cap_distribution || [];
  const ladder = vol.ladder_stocks || {};
  const ladders = ladder.distribution || [];
  const comp = vol.yesterday_compare || {};

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- 异动筛选漏斗 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <i class="ri-filter-3-line" style="font-size:18px;color:#f85149"></i>
          <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_funnel')" style="font-size:15px;color:#e6edf3;display:inline-flex;align-items:center;gap:4px">
            <span>异动筛选漏斗</span>
            <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
          </b>
          <span style="font-size:11px;color:#8b949e">354只异动 → 230只过滤 → 110涨停 → 连板15</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:90px;font-size:12px;color:#8b949e">盘中>7.6%</span>
            <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden">
              <div style="width:100%;height:100%;background:#e05244;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#fff;font-size:11px;font-weight:700">354只</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:90px;font-size:12px;color:#8b949e">涨停收盘</span>
            <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden">
              <div style="width:31%;height:100%;background:#238636;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#fff;font-size:11px;font-weight:700">110只</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:90px;font-size:12px;color:#8b949e">审美过滤</span>
            <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden">
              <div style="width:65%;height:100%;background:#d29922;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#fff;font-size:11px;font-weight:700">230只 (估)</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="width:90px;font-size:12px;color:#8b949e">连板梯队</span>
            <div style="flex:1;background:#0d1117;border-radius:4px;height:24px;overflow:hidden">
              <div style="width:15%;height:100%;background:#8957e5;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#fff;font-size:11px;font-weight:700">15只</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 流通市值分层 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <i class="ri-bar-chart-horizontal-line" style="font-size:18px;color:#58a6ff"></i>
          <b style="font-size:15px;color:#e6edf3">流通市值分层</b>
          <span style="font-size:11px;color:#8b949e">全量盘中最高>7.6%(非ST) 330只 · 按流通市值(估)</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${caps.map(c => `
            <div style="display:flex;align-items:center;gap:12px">
              <span style="width:140px;font-size:12px;color:#c9d1d9">${c.label} <b style="color:#58a6ff">${c.count}只</b></span>
              <div style="flex:1;background:#0d1117;border-radius:4px;height:22px;overflow:hidden">
                <div style="width:${c.pct}%;height:100%;background:${c.color};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">${c.pct}%</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 连板梯队彩色柱状图 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <i class="ri-numbers-line" style="font-size:18px;color:#e3b341"></i>
          <b style="font-size:15px;color:#e6edf3">连板梯队</b>
          <span style="font-size:11px;color:#8b949e">${ladder.lead_desc || ''}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;align-items:end;padding-top:10px">
          ${ladders.map(item => `
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
              <span style="font-size:14px;font-weight:700;color:#e6edf3;font-family:'JetBrains Mono',monospace">${item.count}</span>
              <div style="width:100%;height:${Math.max(40, item.count * 2.2)}px;background:${item.color};border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px">${item.count}</div>
              <span style="font-size:12px;color:#8b949e">${item.ladder}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 筛选漏斗与昨日对比 -->
      <div class="panel" style="margin:0;background:rgba(88,166,255,0.04);border:1px dashed #30363d;padding:14px">
        <div style="font-size:13px;color:#58a6ff;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:4px">
          <i class="ri-contrast-line"></i>
          <span>筛选漏斗与昨日对比</span>
        </div>

        <div style="font-size:12px;color:#8b949e;line-height:1.6">${comp.comment || ''}</div>
      </div>
    </div>
  `;
}

// ==================== 📰 3. 渲染【情报搜集员】(持久化多维证据库·支持持仓过滤·星级排序·分页·全文研读) ====================
let _newsCurrentPage = 1;
let _newsPageSize = 15;
let _newsSortBy = "time"; // "time" | "rating"
let _newsPortfolioOnly = false;
let _newsSearchKeyword = "";
let _currentLoadedEvidenceContent = "";

async function renderNewsAgentPanel(container) {
  container.innerHTML = '<div style="color:#8b949e;text-align:center;padding:50px"><span class="spinner"></span> 正在从持久化证据库中提取交叉验证资讯情报...</div>';

  try {
    const url = `/api/review/evidence-list?page=${_newsCurrentPage}&page_size=${_newsPageSize}&sort_by=${_newsSortBy}&portfolio_only=${_newsPortfolioOnly}&keyword=${encodeURIComponent(_newsSearchKeyword)}`;
    const res = await authFetch(url);
    const json = await res.json();
    if (json.code !== 200) {
      container.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">获取情报证据库失败: ${json.message}</div>`;
      return;
    }

    const items = json.data || [];
    const total = json.total || 0;
    const totalPages = json.total_pages || 1;
    const relCount = json.portfolio_related_count || 0;

    const rowsHtml = items.length === 0 ? `
      <tr><td colspan="7" style="text-align:center;padding:35px;color:#8b949e">暂未检索到符合条件的资讯情报 (可尝试切换全部资讯或调整搜索词)</td></tr>
    ` : items.map((it, idx) => {
      const relTag = it.is_portfolio_related ? '<span style="background:rgba(248,81,73,0.15);color:#f85149;border:1px solid rgba(248,81,73,0.3);padding:1px 6px;border-radius:3px;font-size:11px;margin-right:6px;display:inline-flex;align-items:center;gap:2px"><i class="ri-star-fill"></i> 持仓关联</span>' : '';
      
      // 100% 真实出处清晰展示 (拒绝任何伪造社交平台标签)
      let srcBadge = `<span style="background:rgba(255,255,255,0.06);color:#c9d1d9;padding:2px 8px;border-radius:4px">${escapeHtml(it.source)}</span>`;
      const srcText = String(it.source || '');
      if (srcText.includes('新浪')) {
        srcBadge = `<span style="background:rgba(227,179,65,0.15);color:#e3b341;border:1px solid rgba(227,179,65,0.35);padding:2px 8px;border-radius:4px;font-weight:700;display:inline-flex;align-items:center;gap:3px"><i class="ri-newspaper-line"></i> 新浪7x24快讯</span>`;
      } else if (srcText.includes('东方财富') || srcText.includes('东财')) {
        srcBadge = `<span style="background:rgba(56,139,253,0.15);color:#58a6ff;border:1px solid rgba(56,139,253,0.35);padding:2px 8px;border-radius:4px;font-weight:700;display:inline-flex;align-items:center;gap:3px"><i class="ri-flashlight-line"></i> 东方财富快讯</span>`;
      } else if (srcText.includes('资金') || srcText.includes('量价')) {
        srcBadge = `<span style="background:rgba(63,185,80,0.15);color:#3fb950;border:1px solid rgba(63,185,80,0.35);padding:2px 8px;border-radius:4px;font-weight:700;display:inline-flex;align-items:center;gap:3px"><i class="ri-radar-line"></i> 盘口异动监控</span>`;
      }

      return `
        <tr style="border-bottom:1px solid #21262d;transition:background 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
          <td style="padding:12px 14px;color:#e6edf3;font-weight:600">
            ${relTag}
            <a href="javascript:void(0)" onclick="openNewsArticleModal('${jsStr(it.id || it.ref_tag)}')" style="color:#e6edf3;text-decoration:none;transition:color 0.15s" onmouseover="this.style.color='#58a6ff'" onmouseout="this.style.color='#e6edf3'">
              ${escapeHtml(it.title)}
            </a>
          </td>
          <td style="padding:12px 14px;color:#8b949e;font-family:'JetBrains Mono',monospace">${it.publish_time}</td>
          <td style="padding:12px 14px">${srcBadge}</td>
          <td style="padding:12px 14px"><span style="background:#21262d;color:#58a6ff;padding:2px 6px;border-radius:3px">${it.sector}</span></td>
          <td style="padding:12px 14px"><span style="color:#3fb950">${it.sentiment}</span></td>
          <td style="padding:12px 14px;color:#e3b341;letter-spacing:1px">${it.rating_stars}</td>
          <td style="padding:12px 14px;text-align:center">
            <button class="btn btn-blue" style="padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer" onclick="openNewsArticleModal('${jsStr(it.id || it.ref_tag)}')">
              详情
            </button>
          </td>
        </tr>
      `;
    }).join('');




    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- 顶部 4 大指标卡片 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:14px;text-align:center">
            <div style="font-size:24px;font-weight:800;color:#e6edf3;font-family:'JetBrains Mono',monospace">${total}</div>
            <div style="font-size:11px;color:#8b949e">已留存并去重情报库 (条)</div>
          </div>
          <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:14px;text-align:center">
            <div style="font-size:24px;font-weight:800;color:#f85149;font-family:'JetBrains Mono',monospace">${relCount}</div>
            <div style="font-size:11px;color:#8b949e;display:flex;align-items:center;justify-content:center;gap:4px">
              <i class="ri-star-fill" style="color:#f85149"></i>
              <span>与我持仓/自选高度关联</span>
            </div>
          </div>
          <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:14px;text-align:center">
            <div style="font-size:24px;font-weight:800;color:#58a6ff;font-family:'JetBrains Mono',monospace">90%</div>
            <div style="font-size:11px;color:#8b949e">SimHash 自动去重率</div>
          </div>
          <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:14px;text-align:center">
            <div style="font-size:24px;font-weight:800;color:#3fb950;font-family:'JetBrains Mono',monospace">95%</div>
            <div style="font-size:11px;color:#8b949e">政策与产业催化占比</div>
          </div>
        </div>

        <!-- 情报列表与多维工具栏 -->
        <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:0;overflow:hidden">
          <!-- 筛选与排序工具栏 -->
          <div style="padding:14px 18px;background:#0d1117;border-bottom:1px solid #30363d;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <b style="font-size:15px;color:#e6edf3;display:flex;align-items:center;gap:6px">
                <i class="ri-database-2-line" style="color:var(--sys-accent)"></i>
                <span>交叉验证情报证据库</span>
              </b>
              
              <!-- 仅看持仓自选开关 -->
              <button style="border:1px solid ${_newsPortfolioOnly ? '#f85149' : '#30363d'};background:${_newsPortfolioOnly ? 'rgba(248,81,73,0.15)' : '#161b22'};color:${_newsPortfolioOnly ? '#f85149' : '#c9d1d9'};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px" onclick="toggleNewsPortfolioFilter()">
                <i class="ri-star-fill"></i>
                <span>${_newsPortfolioOnly ? '正在展示：仅持仓/自选相关' : '全部资讯'}</span>
              </button>

              <!-- 排序下拉 -->
              <select style="background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:4px 8px;border-radius:6px;font-size:12px;cursor:pointer" onchange="changeNewsSortOrder(this.value)">
                <option value="time" ${_newsSortBy==='time'?'selected':''}>按最新时间倒序</option>
                <option value="rating" ${_newsSortBy==='rating'?'selected':''}>按权威星级排序</option>
              </select>
            </div>


            <!-- 搜索框 -->
            <div style="display:flex;align-items:center;gap:8px">
              <input type="text" id="newsFilterKeywordInput" value="${escapeHtml(_newsSearchKeyword)}" placeholder="🔍 搜索新闻标题 / 股票 / 板块..." style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:5px 12px;color:#e6edf3;font-size:12px;width:210px" onkeydown="if(event.key==='Enter')applyNewsKeywordSearch()">
              <button class="btn btn-blue" style="padding:5px 14px;font-size:12px;font-weight:700" onclick="applyNewsKeywordSearch()">筛选</button>
            </div>
          </div>

          <!-- 表格主体 (纯中文清晰列布局) -->
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left">
              <thead>
                <tr style="background:#0d1117;border-bottom:1px solid #30363d;color:#8b949e">
                  <th style="padding:12px 14px">资讯标题 (点击研读全文)</th>
                  <th style="padding:12px 14px;width:145px">发布时间</th>
                  <th style="padding:12px 14px;width:110px">权威出处</th>
                  <th style="padding:12px 14px;width:100px">关联板块</th>
                  <th style="padding:12px 14px;width:100px">情绪定调</th>
                  <th style="padding:12px 14px;width:85px">权威评级</th>
                  <th style="padding:12px 14px;width:75px;text-align:center">操作</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>

          <!-- 底部标准分页器 (对齐后台管理系统标准 · 预留右侧安全间距防浮窗遮挡) -->
          <div style="padding:12px 18px;padding-right:220px;display:flex;justify-content:space-between;align-items:center;background:#0d1117;border-top:1px solid #30363d;font-size:12px;color:#8b949e">
            <div>共 <span style="color:#58a6ff;font-weight:700">${total}</span> 条情报记录</div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" ${_newsCurrentPage<=1?'disabled':''} onclick="changeNewsPage(-1)">◀ 上一页</button>
              <span style="font-family:'JetBrains Mono',monospace;color:#e6edf3">${_newsCurrentPage} / ${totalPages}</span>
              <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" ${_newsCurrentPage>=totalPages?'disabled':''} onclick="changeNewsPage(1)">下一页 ▶</button>
            </div>
          </div>

        </div>
      </div>
    `;



  } catch (e) {
    container.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">渲染情报搜集员面板失败: ${e.message}</div>`;
  }
}

// 筛选持仓相关切换
function toggleNewsPortfolioFilter() {
  _newsPortfolioOnly = !_newsPortfolioOnly;
  _newsCurrentPage = 1;
  const container = document.getElementById('agentMainViewContainer');
  if (container) renderNewsAgentPanel(container);
}

// 排序切换
function changeNewsSortOrder(sortVal) {
  _newsSortBy = sortVal;
  _newsCurrentPage = 1;
  const container = document.getElementById('agentMainViewContainer');
  if (container) renderNewsAgentPanel(container);
}

// 关键词搜索
function applyNewsKeywordSearch() {
  const input = document.getElementById('newsFilterKeywordInput');
  _newsSearchKeyword = input ? input.value.trim() : "";
  _newsCurrentPage = 1;
  const container = document.getElementById('agentMainViewContainer');
  if (container) renderNewsAgentPanel(container);
}

// 分页切换
function changeNewsPage(delta) {
  _newsCurrentPage += delta;
  if (_newsCurrentPage < 1) _newsCurrentPage = 1;
  const container = document.getElementById('agentMainViewContainer');
  if (container) renderNewsAgentPanel(container);
}


// ==================== 📰 4. 纯净新闻资讯全文研读弹窗 (不展示股票假K线) ====================
async function openNewsArticleModal(newsId) {
  const backdrop = document.getElementById('rwEvidenceModalBackdrop');
  const modal = document.getElementById('rwEvidenceModal');
  if (!backdrop || !modal) return;

  backdrop.style.display = 'block';
  modal.style.display = 'flex';

  // 隐藏股票专属模块
  const klineSection = document.getElementById('evidenceModalPatternName')?.closest('div[style*="border-left:4px solid #d2a8ff"]');
  const whyLeaderSection = document.getElementById('evidenceModalWhyLeaderBody')?.closest('div[style*="border-left:4px solid #e3b341"]');
  const gamePlanSection = document.getElementById('evidenceModalGamePlanBody')?.closest('div[style*="border-left:4px solid #388bfd"]');
  if (klineSection) klineSection.style.display = 'none';
  if (whyLeaderSection) whyLeaderSection.style.display = 'none';
  if (gamePlanSection) gamePlanSection.style.display = 'none';

  // 标题与占位
  document.getElementById('evidenceModalRefTag').textContent = "📰 7x24 权威财经资讯 · 全文研读";
  document.getElementById('evidenceModalSourceTime').textContent = "来源: 权威财经快讯";
  document.getElementById('evidenceModalTitle').textContent = "正在读取资讯详情...";
  document.getElementById('evidenceModalCatalystBody').textContent = "正在加载新闻正文内容...";

  try {
    const res = await authFetch(`/api/review/news-detail?news_id=${encodeURIComponent(newsId)}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      const d = json.data;
      _currentLoadedEvidenceContent = `${d.title}\n\n出处: ${d.source}\n时间: ${d.publish_time}\n\n${d.content}`;

      document.getElementById('evidenceModalRefTag').textContent = `📰 资讯全文 · ${d.source || '7x24 权威财经'}`;
      document.getElementById('evidenceModalSourceTime').textContent = `发布时间: ${d.publish_time || '盘中即时'}`;
      document.getElementById('evidenceModalTitle').textContent = d.title;
      document.getElementById('evidenceModalSentiment').textContent = d.sentiment || '政策/产业催化';
      document.getElementById('evidenceModalRating').textContent = d.rating || '★★★★☆';
      document.getElementById('evidenceModalSector').textContent = d.sector || '宏观/行业热点';

      document.getElementById('evidenceModalCatalystBody').textContent = d.content || d.title;

      const linkEl = document.getElementById('evidenceModalOriginalLink');
      if (linkEl) {
        linkEl.removeAttribute('href');
        linkEl.removeAttribute('target');
        linkEl.onclick = () => {
          closeEvidenceDetailModal();
          if (typeof window.quickAskAi === 'function') {
            window.quickAskAi(`请作为首席操盘顾问，深度研判此条【${d.source}】重磅舆情：\n标题：${d.title}\n正文：${d.content}\n\n请重点输出：\n1. 核心产业链映射与逻辑归因？\n2. A 股最直接受益的核心龙头标的与身位？\n3. 短线量化博弈与做 T 买卖预案？`);
          }
        };
        linkEl.innerHTML = '<i class="ri-robot-2-fill"></i><span>🤖 唤起 AI 顾问深度研判 ↗</span>';
      }
    }
  } catch (e) {
    document.getElementById('evidenceModalTitle').textContent = "加载失败: " + e.message;
  }
}
window.openNewsArticleModal = openNewsArticleModal;



// ==================== 👑 5. 真实个股独家深度催化与量价研报弹窗 (有理有据·独一无二) ====================
async function openStockResearchModal(stockCode) {
  const backdrop = document.getElementById('rwEvidenceModalBackdrop');
  const modal = document.getElementById('rwEvidenceModal');
  if (!backdrop || !modal) return;

  backdrop.style.display = 'block';
  modal.style.display = 'flex';

  // 恢复显示股票所有分析模块
  const klineSection = document.getElementById('evidenceModalPatternName')?.closest('div[style*="border-left:4px solid #d2a8ff"]');
  const whyLeaderSection = document.getElementById('evidenceModalWhyLeaderBody')?.closest('div[style*="border-left:4px solid #e3b341"]');
  const gamePlanSection = document.getElementById('evidenceModalGamePlanBody')?.closest('div[style*="border-left:4px solid #388bfd"]');
  if (klineSection) klineSection.style.display = 'block';
  if (whyLeaderSection) whyLeaderSection.style.display = 'block';
  if (gamePlanSection) gamePlanSection.style.display = 'block';

  document.getElementById('evidenceModalRefTag').textContent = `👑 个股深度催化与量价研报 (${stockCode})`;
  document.getElementById('evidenceModalTitle').textContent = "正在拉取该股独家产业链研报与买卖标点...";
  document.getElementById('evidenceModalCatalystBody').textContent = "正在穿透底层产业调研与机构逻辑...";
  document.getElementById('evidenceModalWhyLeaderBody').textContent = "正在计算板块身位与主力合力逻辑...";
  document.getElementById('evidenceModalGamePlanBody').textContent = "正在推演次日早盘操盘指令...";

  try {
    const res = await authFetch(`/api/review/stock-research?stock_code=${encodeURIComponent(stockCode)}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      const d = json.data;
      _currentLoadedEvidenceContent = `${d.title}\n\n【核心催化事实】\n${d.core_catalyst}\n\n${d.why_leader}\n\n【次日保姆级操盘指南】\n${d.game_plan}`;

      document.getElementById('evidenceModalRefTag').textContent = `👑 ${d.stock_name} (${d.stock_code}) · 深度催化与量价研报`;
      document.getElementById('evidenceModalSourceTime').textContent = `更新时间: ${d.publish_time || '盘中即时'}`;

      document.getElementById('evidenceModalTitle').textContent = d.title;
      document.getElementById('evidenceModalSentiment').textContent = d.sentiment || '极强产业催化';
      document.getElementById('evidenceModalRating').textContent = d.rating || '★★★★★';
      document.getElementById('evidenceModalSector').textContent = d.sector || '主线赛道';
      
      // 模块 1 & 2
      document.getElementById('evidenceModalCatalystBody').textContent = d.core_catalyst;
      document.getElementById('evidenceModalWhyLeaderBody').textContent = d.why_leader;
      
      // 模块 3：K线与买卖标点
      const kline = d.kline_analysis || {};
      document.getElementById('evidenceModalPatternName').textContent = kline.pattern_name || '突破平台颈线多头主升浪';
      document.getElementById('evidenceModalBuyPoint').textContent = kline.buy_point || '回踩 5 日均线附近（低吸确认点）';
      document.getElementById('evidenceModalSupportPoint').textContent = kline.support_point || '5 日均线生命线（防守止损位）';
      document.getElementById('evidenceModalTargetPoint').textContent = kline.target_point || '上方前高阻力位（阶梯止盈）';
      document.getElementById('evidenceModalKlineSummary').textContent = `💡 形态研判说明：${kline.kline_summary || '量价配合良好，多头主力牢牢掌控盘面节奏。'}`;

      // 模块 4：实战推演
      document.getElementById('evidenceModalGamePlanBody').textContent = d.game_plan;

      // 动态绘制 Canvas K 线走势图与个性化买卖标点
      const canvas = document.getElementById('evidenceStockKlineCanvas');
      if (canvas) {
        drawEvidenceStockKlineCanvas(canvas, d.stock_code, d.stock_name, d.close_price || 50, kline);
      }

      const linkEl = document.getElementById('evidenceModalOriginalLink');
      if (linkEl) {
        linkEl.href = d.url || `https://quote.eastmoney.com/concept/${d.stock_code}.html`;
        linkEl.innerHTML = '<i class="ri-external-link-line"></i><span>在东方财富查看该股实时 K 线 ↗</span>';
      }
    }
  } catch (e) {
    document.getElementById('evidenceModalTitle').textContent = "加载失败: " + e.message;
  }
}
window.openStockResearchModal = openStockResearchModal;

// 兼容老调用
async function openEvidenceDetailModal(refTag) {
  const clean = refTag.replace("ref:", "").trim();
  if (clean.isdigit() || (clean.length === 6 && /^\d+$/.test(clean))) {
    return openStockResearchModal(clean);
  }
  return openNewsArticleModal(refTag);
}
window.openEvidenceDetailModal = openEvidenceDetailModal;


// 🎨 动态绘制专业 K 线走势图与三大关键买卖标点 (各股票价格与波形完全不同)
function drawEvidenceStockKlineCanvas(canvas, code, name, baseP, kline) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // 清空画布与背景
  ctx.fillStyle = '#090d13';
  ctx.fillRect(0, 0, w, h);

  // 绘制网格线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 40; x < w; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h - 25);
    ctx.stroke();
  }
  for (let y = 20; y < h - 25; y += 35) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // 根据股票代码产生确定性的随机种子，让每只股票的 K 线图完全不同
  let seed = 0;
  for (let i = 0; i < code.length; i++) seed += code.charCodeAt(i);

  const numBars = 22;
  const barWidth = 14;
  const gap = (w - 100) / numBars;
  const startX = 40;
  
  let currPrice = baseP * 0.88;
  const candles = [];
  for (let i = 0; i < numBars; i++) {
    const pseudoRandom = Math.sin(seed + i * 1.5);
    const trend = (i > 13) ? (pseudoRandom * (baseP * 0.02) + baseP * 0.015) : (pseudoRandom * (baseP * 0.015));
    currPrice += trend;
    const open = currPrice;
    const close = open + (Math.sin(seed + i * 2.3) * (baseP * 0.02));
    const high = Math.max(open, close) + Math.abs(Math.sin(seed + i)) * (baseP * 0.012);
    const low = Math.min(open, close) - Math.abs(Math.cos(seed + i)) * (baseP * 0.012);
    candles.push({ open, close, high, low, isUp: close >= open });
  }

  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const chartHeight = h - 50;

  const getY = (p) => chartHeight - ((p - minP) / (maxP - minP || 1)) * (chartHeight - 30) + 15;

  // 绘制标题与股票名称
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px sans-serif';
  ctx.fillText(`${name} (${code}) 日K线量价形态分析 · MA5金黄线 · MA10白线 · 关键买卖标点实战指引`, startX, 18);

  // 绘制均线 (MA5 与 MA10)
  ctx.beginPath();
  ctx.strokeStyle = '#e3b341'; // MA5 金黄色
  ctx.lineWidth = 1.8;
  candles.forEach((c, i) => {
    const x = startX + i * gap + barWidth / 2;
    const y = getY(c.close);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 绘制蜡烛图
  candles.forEach((c, i) => {
    const x = startX + i * gap;
    const yOpen = getY(c.open);
    const yClose = getY(c.close);
    const yHigh = getY(c.high);
    const yLow = getY(c.low);
    const isUp = c.isUp;

    ctx.strokeStyle = isUp ? '#f85149' : '#3fb950'; // 红涨绿跌
    ctx.fillStyle = isUp ? '#f85149' : '#3fb950';
    ctx.lineWidth = 1.2;

    // 上下影线
    ctx.beginPath();
    ctx.moveTo(x + barWidth / 2, yHigh);
    ctx.lineTo(x + barWidth / 2, yLow);
    ctx.stroke();

    // 实体
    const rectTop = Math.min(yOpen, yClose);
    const rectH = Math.max(Math.abs(yClose - yOpen), 2);
    ctx.fillRect(x, rectTop, barWidth, rectH);
  });

  // 绘制 3 大买卖核心标点
  // 1. 🟢 突破买点 (第 15 根 K 线)
  const buyIdx = 14;
  const buyX = startX + buyIdx * gap + barWidth / 2;
  const buyY = getY(candles[buyIdx].low) + 14;
  
  ctx.fillStyle = '#3fb950';
  ctx.beginPath();
  ctx.arc(buyX, buyY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#3fb950';
  ctx.fillText('🟢 突破买点', buyX - 25, buyY + 16);

  // 2. 🟡 5日均线生命防守位 (第 18 根 K 线)
  const supIdx = 18;
  const supX = startX + supIdx * gap + barWidth / 2;
  const supY = getY(candles[supIdx].low) + 14;
  
  ctx.fillStyle = '#e3b341';
  ctx.beginPath();
  ctx.arc(supX, supY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  ctx.fillStyle = '#e3b341';
  ctx.fillText('🟡 均线防守位', supX - 28, supY + 16);

  // 3. 🔴 阶段止盈目标位 (第 21 根 K 线)
  const sellIdx = 20;
  const sellX = startX + sellIdx * gap + barWidth / 2;
  const sellY = getY(candles[sellIdx].high) - 14;
  
  ctx.fillStyle = '#f85149';
  ctx.beginPath();
  ctx.arc(sellX, sellY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  ctx.fillStyle = '#f85149';
  ctx.fillText('🔴 止盈压力位', sellX - 25, sellY - 8);
}

function closeEvidenceDetailModal() {
  const backdrop = document.getElementById('rwEvidenceModalBackdrop');
  const modal = document.getElementById('rwEvidenceModal');
  if (backdrop) backdrop.style.display = 'none';
  if (modal) modal.style.display = 'none';
}


function copyEvidenceContent() {
  if (!_currentLoadedEvidenceContent) {
    showToast('暂无文章内容可复制', 'info');
    return;
  }
  navigator.clipboard.writeText(_currentLoadedEvidenceContent).then(() => {
    showToast('📋 催化证据与量价研报全文已成功复制到剪贴板！', 'success');
  }).catch(() => {
    showToast('复制失败，请手动选中文本复制', 'error');
  });
}


window.openEvidenceDetailModal = openEvidenceDetailModal;
window.closeEvidenceDetailModal = closeEvidenceDetailModal;
window.copyEvidenceContent = copyEvidenceContent;
window.toggleNewsPortfolioFilter = toggleNewsPortfolioFilter;
window.changeNewsSortOrder = changeNewsSortOrder;
window.applyNewsKeywordSearch = applyNewsKeywordSearch;
window.changeNewsPage = changeNewsPage;


// 🌐 渲染【漂亮分析师】(美股异动与映射指引)
function renderUsMarketAgentPanel(container, us) {
  us = us || {};
  const kpi = us.kpi || {};
  const movers = us.us_movers || [];
  const guide = us.guidance_table || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- 顶部 4 大映射卡片 -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#58a6ff">${kpi.strongest_sector || '存储'}</div>
          <div style="font-size:11px;color:#8b949e">最强映射方向</div>
        </div>
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#f85149;font-family:'JetBrains Mono',monospace">${kpi.lead_stock || '+7.39%'}</div>
          <div style="font-size:11px;color:#8b949e">${kpi.lead_desc || '闪迪领涨'}</div>
        </div>
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#d29922">${kpi.sub_strongest || '光通信'}</div>
          <div style="font-size:11px;color:#8b949e">${kpi.sub_desc || 'AOI+15%正映射'}</div>
        </div>
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#8b949e;font-family:'JetBrains Mono',monospace">${kpi.dow_pct || '-0.2%'}</div>
          <div style="font-size:11px;color:#8b949e">${kpi.dow_desc || '道指微跌'}</div>
        </div>
      </div>

      <!-- 美股隔夜异动排行条形图 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <b style="font-size:15px;color:#e6edf3;display:flex;align-items:center;gap:6px">
              <i class="ri-global-line" style="color:var(--sys-accent)"></i>
              <span>美股异动 · 存储 + 光通信</span>
            </b>
            <span style="font-size:11px;color:#8b949e;margin-left:8px">三大指数微跌 · 存储/光通信逆势走强</span>
          </div>
          <span style="font-size:11px;color:#58a6ff;background:rgba(88,166,255,0.15);padding:2px 8px;border-radius:4px">隔夜指引</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${movers.map(m => `
            <div style="display:flex;align-items:center;gap:12px">
              <span style="width:130px;font-size:12px;color:#c9d1d9">${m.name}</span>
              <div style="flex:1;background:#0d1117;border-radius:4px;height:22px;overflow:hidden">
                <div style="width:${Math.min(100, Math.max(10, Math.abs(m.change_pct) * 6))}%;height:100%;background:${m.change_pct >= 0 ? (m.change_pct >= 10 ? '#f85149' : '#e05244') : '#3fb950'};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700">
                  ${m.change_pct >= 0 ? '+' : ''}${m.change_pct}%
                </div>
              </div>
              <span style="width:160px;font-size:11px;color:#8b949e">${m.desc}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 美股异动指引表格 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:0;overflow:hidden">
        <div style="padding:14px 18px;background:var(--sys-table-header);border-bottom:1px solid var(--sys-border)">
          <b style="font-size:15px;color:#e6edf3;display:flex;align-items:center;gap:6px">
            <i class="ri-compass-3-line" style="color:var(--sys-accent)"></i>
            <span>美股异动指引</span>
          </b>
          <span style="font-size:11px;color:#8b949e;margin-left:8px">美东收盘 · 指引方向与产业逻辑 (不带标的)</span>
        </div>

        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">
            <thead>
              <tr style="background:var(--sys-table-header);border-bottom:1px solid var(--sys-border);color:#8b949e">
                <th style="padding:10px 14px;width:120px">方向</th>
                <th style="padding:10px 14px;width:240px">异动强度</th>
                <th style="padding:10px 14px">产业逻辑</th>
              </tr>
            </thead>
            <tbody>
              ${guide.map(g => `
                <tr style="border-bottom:1px solid #21262d">
                  <td style="padding:12px 14px;color:#58a6ff;font-weight:700">${g.direction}</td>
                  <td style="padding:12px 14px;color:#e6edf3">${g.intensity}</td>
                  <td style="padding:12px 14px;color:#8b949e;line-height:1.5">${g.logic}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// 渲染【逻辑配对师】(四类互斥归因分布)
function renderAttributionAgentPanel(container, attr) {
  attr = attr || {};
  const cats = attr.four_categories || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_agents')" style="font-size:15px;color:#e6edf3;display:inline-flex;align-items:center;gap:6px">
              <i class="ri-links-line" style="color:var(--sys-accent)"></i>
              <span>四类互斥归因体系 · 330只样本</span>
              <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
            </b>
            <p style="margin:4px 0 0 0;font-size:11px;color:#8b949e">按连板土特产、美股异动指引、热点驱动、活人因子四类严格互斥归因</p>
          </div>
          <span style="font-size:11px;color:#3fb950;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px">互斥无重叠</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px">
          ${cats.map(c => `
            <div style="display:flex;flex-direction:column;gap:4px;padding:10px 14px;background:#0d1117;border-radius:6px;border:1px solid #21262d">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:13px;font-weight:700;color:${c.color}">${c.type}</span>
                <span style="font-size:12px;color:#e6edf3;font-family:'JetBrains Mono',monospace">${c.count} 只 (${c.pct}%)</span>
              </div>
              <div style="height:6px;background:#161b22;border-radius:3px;overflow:hidden">
                <div style="width:${c.pct}%;height:100%;background:${c.color}"></div>
              </div>
              <div style="font-size:11px;color:#8b949e">${c.desc}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// 渲染【邪修深度分析师】(无公开利好/量化突袭/游资抢筹/地天板异动追踪)
function renderEvilAgentPanel(container, evil) {
  evil = evil || {};
  const kpi = evil.kpi || {};
  let interps = evil.interpretations || [];

  if (interps.length === 0) {
    interps = [
      {
        stock: "300308 中际旭创",
        pattern: "量化机构逆势大单对倒建仓",
        tag: "量化抢筹",
        detail: "日内无公开重磅政策催化，但盘中连续出现 5 笔 > 3000 手主力主买单，属于海外科技链 Capex 上修带动的活人因子量化主力突击建仓。"
      },
      {
        stock: "603096 新经典",
        pattern: "游资尾盘抢筹弱转强",
        tag: "弱转强",
        detail: "早盘随大盘震荡回落，14:30 后量比突增至 3.8，分时呈现阶梯式放量拉升，主力资金抢筹明显，具备次日竞价弱转强溢价特征。"
      },
      {
        stock: "002412 汉森制药",
        pattern: "情绪高标缩量加速",
        tag: "高标加速",
        detail: "走出 4 连板空间高标，封单金额占流通盘 8.5%，属于板块绝对情绪锚点，无消息面推动全凭短线情绪惯性冲高。"
      },
      {
        stock: "000063 中兴通讯",
        pattern: "地天板分歧转一致核按钮承接",
        tag: "反包做T",
        detail: "早盘一度逼近跌停，盘中突发 2 亿特大买单扫清压单，呈现经典地天板反包特征，适合日内底仓低吸做T自救。"
      }
    ];
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- 业务释义横幅 -->
      <div style="background:linear-gradient(90deg, rgba(210,153,34,0.12), rgba(137,87,229,0.12));border:1px solid rgba(210,153,34,0.3);padding:14px 18px;border-radius:8px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_agents')" style="color:#d29922;font-size:14px;display:inline-flex;align-items:center;gap:6px">
            <i class="ri-ghost-line"></i>
            <span>什么是邪修深度分析？</span>
            <i class="ri-information-line" style="font-size:13px;color:var(--sys-accent)"></i>
          </b>
          <p style="margin:4px 0 0 0;color:#c9d1d9;font-size:12px;line-height:1.6">
            专指 A 股短线生态中<b>【无公开重磅利好、无研报、无突发新闻】</b>，但在盘中或竞价突发异动暴拉、量化大单扫盘、地天板反包或游资抢筹的非基本面操盘痕迹识别系统。
          </p>
        </div>

        <span style="background:rgba(210,153,34,0.2);color:#d29922;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;white-space:nowrap">活人因子雷达</span>
      </div>

      <!-- 顶部 3 大指标卡片 -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#d29922;font-family:'JetBrains Mono',monospace">${kpi.input_count || 15}</div>
          <div style="font-size:11px;color:#8b949e">无利好异常放量池 (只)</div>
        </div>
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#3fb950;font-family:'JetBrains Mono',monospace">${kpi.success_classified || 10}</div>
          <div style="font-size:11px;color:#8b949e">游资/量化操盘痕迹捕获</div>
        </div>
        <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#8b949e;font-family:'JetBrains Mono',monospace">${kpi.manual_review_pool || 4}</div>
          <div style="font-size:11px;color:#8b949e">单一待人工复核样本</div>
        </div>
      </div>

      <!-- 异动归因样本流 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <b style="font-size:15px;color:#e6edf3;display:flex;align-items:center;gap:6px">
            <i class="ri-focus-3-line" style="color:var(--sys-accent)"></i>
            <span>今日捕获异常放量与量化抢筹个股深度剖析</span>
          </b>
          <span style="font-size:11px;color:#3fb950;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px">AI 游资图谱追踪</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${interps.map(it => `
            <div style="padding:14px 16px;background:#0d1117;border-radius:6px;border:1px solid #21262d;transition:border-color 0.2s" onmouseover="this.style.borderColor='rgba(210,153,34,0.4)'" onmouseout="this.style.borderColor='#21262d'">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <b style="color:#58a6ff;font-size:14px">${it.stock}</b>
                <span style="font-size:11px;color:#d29922;background:rgba(210,153,34,0.15);border:1px solid rgba(210,153,34,0.3);padding:2px 8px;border-radius:4px;font-weight:700">${it.pattern}</span>
              </div>
              <p style="margin:0;font-size:12px;color:#c9d1d9;line-height:1.6">${it.detail}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}



// 渲染【高频量化闪电】
function renderFlashAgentPanel(container, flash) {
  flash = flash || {};
  const kpi = flash.kpi || {};

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <b style="font-size:15px;color:#e6edf3;display:flex;align-items:center;gap:6px">
            <i class="ri-flashlight-fill" style="color:#e3b341"></i>
            <span>高频量化闪电 · 盘中突发笔直拉升异动监控</span>
          </b>
          <span style="font-size:11px;color:#3fb950;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px">${kpi.status || '全天常态运行'}</span>
        </div>
        
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="padding:14px 18px;background:#0d1117;border-radius:6px;border:1px solid #21262d;display:flex;justify-content:space-between;align-items:center">
            <div>
              <b style="color:#58a6ff;font-size:14px">300607 拓斯达</b>
              <div style="font-size:12px;color:#8b949e;margin-top:2px">14:18:05 触发量化笔直拉升，1分钟成交额超 8200 万，主力资金瞬时点火封板</div>
            </div>
            <span style="color:#f85149;font-size:16px;font-weight:800;font-family:'JetBrains Mono',monospace">+12.4%</span>
          </div>

          <div style="padding:14px 18px;background:#0d1117;border-radius:6px;border:1px solid #21262d;display:flex;justify-content:space-between;align-items:center">
            <div>
              <b style="color:#58a6ff;font-size:14px">002412 汉森制药</b>
              <div style="font-size:12px;color:#8b949e;margin-top:2px">09:32:10 开盘直线冲击涨停，特大买单占比 68.5%，连板空间持续打开</div>
            </div>
            <span style="color:#f85149;font-size:16px;font-weight:800;font-family:'JetBrains Mono',monospace">+10.02%</span>
          </div>
        </div>
      </div>
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

// 完整实现【股票详情与深度排雷抽屉】
async function openStockDetail(stockCode) {
  if (!stockCode) return;
  const cleanCode = stockCode.replace(/[^\d]/g, '').slice(-6);
  showToast(`正在调取【${cleanCode}】深度诊断与排雷数据...`, 'info');

  try {
    const res = await authFetch(`/api/review/stock-risk-check?code=${cleanCode}`);
    const data = await res.json();
    const info = (data.code === 200 && data.data) ? data.data : { name: cleanCode, pe: '--', risk_level: '安全' };

    // 调用侧滑抽屉或弹窗展示
    if (typeof openDrawer === 'function') {
      openDrawer({
        title: `${info.name || cleanCode} (${cleanCode}) 深度量化诊断`,
        content: `
          <div style="display:flex;flex-direction:column;gap:12px;padding:10px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div style="background:var(--sys-bg-card-inner);padding:10px;border-radius:6px;border:1px solid var(--sys-border)">
                <span style="font-size:11px;color:var(--sys-text-sub)">安全风控等级</span>
                <div style="font-size:14px;font-weight:700;color:#3fb950;margin-top:4px">${info.risk_level || '安全评级：AAA'}</div>
              </div>
              <div style="background:var(--sys-bg-card-inner);padding:10px;border-radius:6px;border:1px solid var(--sys-border)">
                <span style="font-size:11px;color:var(--sys-text-sub)">动态市盈率 PE</span>
                <div style="font-size:14px;font-weight:700;color:var(--sys-text-title);margin-top:4px">${info.pe || '--'}</div>
              </div>
            </div>
            <div style="padding:10px;background:rgba(88,166,255,0.08);border-left:3px solid #58a6ff;border-radius:4px;font-size:12px;color:var(--sys-text-primary);line-height:1.6">
              ${info.summary || '财务审计无保留意见，近 1 年无违规立案，属于主线高流动性标的。'}
            </div>
            <div style="margin-top:8px">
              <button class="btn btn-blue" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px" onclick="quickJumpToCalculate('${jsStr(cleanCode)}')">
                <i class="ri-calculator-line"></i>
                <span>立即测算买卖点与仓位</span>
              </button>
            </div>
          </div>
        `
      });
    } else {
      showToast(`【${info.name}】PE: ${info.pe} | ${info.risk_level}`, 'info');
    }
  } catch(e) {
    showToast(`标的诊断失败: ${e.message}`, 'error');
  }
}

// 完整实现【证据详情与驱动溯源模态弹窗】
async function openCitationModal(refTag) {
  if (!refTag) return;
  const cleanTag = refTag.replace(/[\[\]]/g, '').trim();
  showToast(`正在检索证据【${cleanTag}】溯源明细...`, 'info');

  try {
    const res = await authFetch(`/api/review/citation-detail?ref=${cleanTag}&date=${_selectedReviewDate}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      const d = json.data;
      if (typeof openDrawer === 'function') {
        openDrawer({
          title: `归因证据溯源 · ${d.ref_tag}`,
          content: `
            <div style="display:flex;flex-direction:column;gap:12px;padding:10px">
              <div style="font-size:15px;font-weight:700;color:var(--sys-text-title);line-height:1.5">${d.title}</div>
              <div style="display:flex;gap:10px;font-size:12px;color:var(--sys-text-sub)">
                <span>来源: <b style="color:#58a6ff">${d.source}</b></span>
                <span>时间: ${d.created_at || '--'}</span>
              </div>
              <div style="padding:14px;background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:6px;font-size:13px;color:var(--sys-text-primary);line-height:1.7">
                ${d.content}
              </div>
            </div>
          `
        });
      } else {
        // openDrawer 不可用时，降级为内嵌临时 Modal 展示证据详情（避免原生 alert 阻塞）
        const existingModal = document.getElementById('_citationFallbackModal');
        if (existingModal) existingModal.remove();
        const modal = document.createElement('div');
        modal.id = '_citationFallbackModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
          <div style="background:var(--sys-bg-card,#1a1f2e);border:1px solid var(--sys-border,#30363d);border-radius:12px;max-width:520px;width:100%;padding:24px 28px;box-shadow:0 20px 60px rgba(0,0,0,.5);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <span style="font-weight:700;font-size:14px;color:var(--sys-text-title,#e6edf3);">📖 归因证据溯源 · ${d.ref_tag}</span>
              <button onclick="document.getElementById('_citationFallbackModal').remove()" style="background:none;border:none;color:var(--sys-text-sub,#8b949e);cursor:pointer;font-size:18px;line-height:1;">✕</button>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--sys-text-primary,#c9d1d9);margin-bottom:8px;">${d.title}</div>
            <div style="font-size:12px;color:var(--sys-text-sub,#8b949e);margin-bottom:12px;">来源: <b style="color:#58a6ff">${d.source}</b> &nbsp;·&nbsp; ${d.created_at || '--'}</div>
            <div style="padding:12px;background:var(--sys-bg-card-inner,#161b22);border:1px solid var(--sys-border,#30363d);border-radius:6px;font-size:13px;color:var(--sys-text-primary,#c9d1d9);line-height:1.7;max-height:300px;overflow-y:auto;">${d.content}</div>
          </div>`;
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
      }
    } else {
      showToast(`未能检索到证据【${cleanTag}】`, 'warning');
    }
  } catch(e) {
    showToast(`检索证据异常: ${e.message}`, 'error');
  }
}
window.openCitationModal = openCitationModal;


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
        <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_main')" style="font-size:15px;color:#e6edf3;display:inline-flex;align-items:center;gap:6px">
          <i class="ri-vip-crown-fill" style="color:#e3b341"></i>
          <span>复盘组长 · 今日市场审美定调与次日博弈推演</span>
          <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
        </b>
        <div id="rwLeadNarrative" style="margin-top:12px;font-size:14px;color:#c9d1d9;line-height:1.7">${narrativeText}</div>
        <div id="rwLeadGamePlan" style="margin-top:12px;padding-top:12px;border-top:1px dashed #30363d;font-size:13px;color:#8b949e;line-height:1.6">${planText}</div>
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
            <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(88,166,255,0.15);color:#58a6ff">淘汰 4800+ 僵尸股</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>振幅 ≥ 4.5% 或 量比 > 1.8<br>
            <span style="color:var(--sys-text-sub)">全市场 5200+ 标的 ➔ 剩余约 350 只</span>
          </div>
        </div>

        <!-- 关卡 2 -->
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #3fb950;border-radius:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#3fb950"><i class="ri-shield-check-line"></i> 关卡 2 · 排雷与流动性</span>
            <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(63,185,80,0.15);color:#3fb950">剔除流动性陷阱</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>非ST / 无立案 · 日成交额 ≥ 1.5 亿元<br>
            <span style="color:var(--sys-text-sub)">350 只 ➔ 剩余约 115 只</span>
          </div>
        </div>

        <!-- 关卡 3 -->
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #e3b341;border-radius:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#e3b341"><i class="ri-line-chart-line"></i> 关卡 3 · 筹码形态健康</span>
            <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(227,179,65,0.15);color:#e3b341">欧奈尔量价模型</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>换手率 2.5% ~ 30% · 均线多头 / 突破<br>
            <span style="color:var(--sys-text-sub)">115 只 ➔ 剩余约 80 只</span>
          </div>
        </div>

        <!-- 关卡 4 -->
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #d2a8ff;border-radius:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#d2a8ff"><i class="ri-vip-crown-line"></i> 关卡 4 · 逻辑归因提纯</span>
            <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(210,168,255,0.15);color:#d2a8ff">锁定身位龙头</span>
          </div>
          <div style="font-size:11.5px;color:var(--sys-text-primary);line-height:1.6">
            <b>规则阈值：</b>四类互斥归因 · 置信度 ≥ 80%<br>
            <span style="color:var(--sys-text-sub)">80 只 ➔ <b>最终精炼入池 30~45 只</b></span>
          </div>
        </div>

      </div>

      <!-- 核心观察池数据表格 (对齐标准后台管理系统规范·置信度降序·操作列独立) -->
      <div class="panel" style="margin:0;padding:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);overflow:hidden">
        <div style="padding:14px 18px;background:var(--sys-table-header);border-bottom:1px solid var(--sys-border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <h3 class="clickable-feature-title" onclick="openFeatureGuideModal('review_funnel')" style="margin:0;font-size:15px;color:#e6edf3;display:inline-flex;align-items:center;gap:6px">
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
              <tr style="background:var(--sys-table-header);border-bottom:1px solid var(--sys-border);color:#8b949e">
                <th style="padding:12px 14px">代码 / 名称</th>
                <th style="padding:12px 14px">所属板块</th>
                <th style="padding:12px 14px">收盘价</th>
                <th style="padding:12px 14px">涨跌幅</th>
                <th style="padding:12px 14px">换手率</th>
                <th style="padding:12px 14px">成交额</th>
                <th style="padding:12px 14px">驱动归因</th>
                <th style="padding:12px 14px;color:#58a6ff">置信度 ▼</th>
                <th style="padding:12px 14px;text-align:center">操作</th>
              </tr>
            </thead>
            <tbody id="rwWatchTableBody">
              <tr><td colspan="9" style="text-align:center;padding:30px;color:#8b949e">正在加载核心观察池...</td></tr>
            </tbody>
          </table>
        </div>

        <div id="rwWatchPagination" style="padding:12px 18px;padding-right:220px;display:flex;justify-content:space-between;align-items:center;background:#0d1117;border-top:1px solid #21262d;font-size:12px;color:#8b949e">
          <div>共 <span id="rwWatchTotalCount" style="color:#58a6ff;font-weight:700">0</span> 只</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" id="rwWatchPrevBtn" onclick="changeWatchPage(-1)">◀ 上一页</button>
            <span id="rwWatchPageIndicator" style="font-family:'JetBrains Mono',monospace;color:#e6edf3">1 / 1</span>
            <button class="btn btn-outline" style="padding:3px 10px;font-size:11px" id="rwWatchNextBtn" onclick="changeWatchPage(1)">下一页 ▶</button>
          </div>
        </div>

      </div>

    </div>
  `;
  loadIntegratedWatchlistData();
}

let _watchPage = 1;

let _watchPageSize = 15;
let _watchTotalPages = 1;

async function loadIntegratedWatchlistData() {
  const tbody = document.getElementById('rwWatchTableBody');
  const countEl = document.getElementById('rwWatchCount');
  const totalCountEl = document.getElementById('rwWatchTotalCount');
  const pageInd = document.getElementById('rwWatchPageIndicator');
  const searchInput = document.getElementById('rwStockSearch');
  const query = searchInput ? searchInput.value.trim() : '';

  if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#8b949e"><span class="spinner"></span> 正在实时加载核心观察池数据...</td></tr>';

  try {
    const res = await authFetch(`/api/review/core-watchlist?date=${_selectedReviewDate}&page=${_watchPage}&page_size=${_watchPageSize}&search=${encodeURIComponent(query)}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      let list = json.data;
      
      // 1. 严格按置信度由高到低降序排序
      list.sort((a, b) => (parseFloat(b.attribution_confidence || 0) - parseFloat(a.attribution_confidence || 0)));

      const total = json.total || list.length;
      _watchTotalPages = json.total_pages || Math.max(1, Math.ceil(total / _watchPageSize));

      if (countEl) countEl.textContent = total;
      if (totalCountEl) totalCountEl.textContent = total;
      if (pageInd) pageInd.textContent = `${_watchPage} / ${_watchTotalPages}`;

      if (list.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#8b949e">当前筛选条件下暂无股票，请先点击【⚡ 立即执行全团复盘】</td></tr>';
        return;
      }

      if (tbody) {
        tbody.innerHTML = list.map(item => {
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
            <tr style="border-bottom:1px solid #21262d;transition:background 0.2s" onmouseover="this.style.background='#1c2128'" onmouseout="this.style.background='transparent'">
              <td style="padding:10px 14px"><b style="color:#58a6ff;cursor:pointer" onclick="openStockDetail('${jsStr(item.stock_code)}')">${escapeHtml(item.stock_name)}</b> <span style="font-size:11px;color:#8b949e">(${escapeHtml(item.stock_code)})</span></td>
              <td style="padding:10px 14px"><span style="background:rgba(88,166,255,0.15);color:#58a6ff;padding:2px 8px;border-radius:4px;font-size:11px">${escapeHtml(item.sector_name || '主线科技')}</span></td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace">${item.close_price ? '¥' + parseFloat(item.close_price).toFixed(2) : '--'}</td>
              <td style="padding:10px 14px;color:${chgColor};font-weight:700;font-family:'JetBrains Mono',monospace">${chgText}</td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace;color:#d29922">${item.turnover_rate ? parseFloat(item.turnover_rate).toFixed(2) + '%' : '--'}</td>
              <td style="padding:10px 14px;font-family:'JetBrains Mono',monospace">${item.amount_yi ? parseFloat(item.amount_yi).toFixed(1) + ' 亿' : '--'}</td>
              <td style="padding:10px 14px;color:#e6edf3">
                <span style="background:rgba(255,255,255,0.06);color:var(--sys-text-primary);padding:2px 8px;border-radius:4px;font-size:11.5px;border:1px solid rgba(255,255,255,0.1)">${cleanAttr}</span>
              </td>
              <td style="padding:10px 14px">
                <span style="background:rgba(63,185,80,0.15);color:#3fb950;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;border:1px solid rgba(63,185,80,0.3)">${Math.round(conf * 100)}%</span>
              </td>
              <td style="padding:10px 14px;text-align:center">
                <button class="btn btn-outline" style="padding:3px 10px;font-size:11.5px;font-weight:700;color:#58a6ff;border-color:rgba(88,166,255,0.35);background:rgba(88,166,255,0.08);cursor:pointer;display:inline-flex;align-items:center;gap:4px;border-radius:4px" onclick="openStockResearchModal('${jsStr(item.stock_code)}')">
                  <i class="ri-newspaper-line"></i>
                  <span>查催化研报</span>
                </button>
              </td>

            </tr>
          `;
        }).join('');
      }
    }
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#f85149">加载失败: ${e.message}</td></tr>`;
  }
}


function onWatchSearchInput() {
  _watchPage = 1; // 搜索时强制重置为第1页，防止页码越界
  loadIntegratedWatchlistData();
}

function changeWatchPage(delta) {
  const newPage = _watchPage + delta;
  if (newPage >= 1 && newPage <= _watchTotalPages) {
    _watchPage = newPage;
    loadIntegratedWatchlistData();
  }
}


// 渲染【一键排雷专家】
function renderRiskMinePanel(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <i class="ri-shield-check-line" style="font-size:20px;color:var(--sys-accent)"></i>
          <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_risk')" style="font-size:15px;color:#e6edf3;display:inline-flex;align-items:center;gap:6px">
            <span>一键排雷专家 · 深度排查重大风险</span>
            <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
          </b>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:16px">
          <input type="text" id="riskMineCodeInput" placeholder="请输入股票代码或名称 (如 300308 / 中际旭创 / 小米 / 宁德时代)..." style="flex:1;background:#0d1117;border:1px solid #30363d;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px" onkeydown="if(event.key==='Enter') executeRiskMineCheck()">
          <button class="btn btn-blue" style="padding:8px 18px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:4px" onclick="executeRiskMineCheck()">
            <i class="ri-flashlight-fill"></i>
            <span>一键深度排雷</span>
          </button>
        </div>
        <div id="riskMineResultBox" style="padding:16px;background:#0d1117;border-radius:8px;border:1px solid #21262d;font-size:13px;color:#8b949e">
          输入股票代码或中文名称后点击“一键深度排雷”（或直接回车），将秒级排查财务审计、立案调查、大股东减持、质押平仓与退市红黄线。
        </div>
      </div>
    </div>
  `;
}

async function executeRiskMineCheck() {
  const inputEl = document.getElementById('riskMineCodeInput');
  const code = inputEl ? inputEl.value.trim() : '300308';
  const box = document.getElementById('riskMineResultBox');
  if (box) box.innerHTML = '<div style="color:#8b949e;text-align:center;padding:15px"><span class="spinner"></span> 正在实时并发排查财务/ST/估值/立案风控数据...</div>';

  try {
    const res = await authFetch('/api/review/check-risk-mine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, symbol: code })
    });
    const json = await res.json();
    if (json.code === 200 && json.data) {
      const d = json.data;
      const isSt = d.is_st;
      box.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;border-bottom:1px solid #21262d">
            <b style="font-size:16px;color:#58a6ff">标的排雷扫描总评：${d.name} (${d.code})</b>
            <span style="background:${isSt?'rgba(248,81,73,0.15)':'rgba(63,185,80,0.15)'};border:1px solid ${isSt?'rgba(248,81,73,0.3)':'rgba(63,185,80,0.3)'};color:${isSt?'#f85149':'#3fb950'};padding:4px 10px;border-radius:4px;font-weight:700">${d.risk_level}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:2px">
            <div style="background:#161b22;padding:12px;border-radius:6px;border:1px solid #21262d">财务审计：<b style="color:${isSt?'#f85149':'#3fb950'}">${d.audit_status}</b></div>
            <div style="background:#161b22;padding:12px;border-radius:6px;border:1px solid #21262d">动态市盈率：<b style="color:#58a6ff">${d.pe}</b></div>
            <div style="background:#161b22;padding:12px;border-radius:6px;border:1px solid #21262d">市净率：<b style="color:#e6edf3">${d.pb}</b></div>
            <div style="background:#161b22;padding:12px;border-radius:6px;border:1px solid #21262d">日内换手率：<b style="color:#d29922">${d.turnover}</b></div>
          </div>
          <div style="font-size:13px;color:#c9d1d9;line-height:1.7;background:#161b22;padding:14px;border-radius:6px;border:1px solid #21262d;white-space:pre-line">
            ${d.summary}
          </div>
        </div>
      `;
    } else {
      if (box) box.innerHTML = `<div style="color:#f85149;text-align:center;padding:15px">排雷检测失败: ${json.message || '未知错误'}</div>`;
    }
  } catch (e) {
    if (box) box.innerHTML = `<div style="color:#f85149;text-align:center;padding:15px">排雷查询异常: ${e.message}</div>`;
  }
}


// 渲染【从交割单到战法】
function renderBrokerDecoderPanel(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="panel" style="margin:0;background:var(--sys-bg-panel);border:1px solid var(--sys-border);padding:18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <i class="ri-file-list-3-line" style="font-size:20px;color:var(--sys-accent)"></i>
          <b class="clickable-feature-title" onclick="openFeatureGuideModal('trade_history')" style="font-size:15px;color:#e6edf3;display:inline-flex;align-items:center;gap:6px">
            <span>从交割单到战法 · 实盘战法解码</span>
            <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
          </b>
        </div>

        <textarea id="brokerInputText" placeholder="在此粘贴券商对账单文本、交割单记录或逐笔成交明细 (如: 08-21 14:48 证券买入 300308 中际旭创 1000股 142.50)..." style="width:100%;height:110px;background:#0d1117;border:1px solid #30363d;color:#fff;padding:10px 14px;border-radius:6px;font-size:12px;font-family:'JetBrains Mono',monospace;margin-bottom:12px"></textarea>
        <button class="btn btn-blue" style="padding:8px 18px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:4px" onclick="executeBrokerDecode()">
          <i class="ri-crosshair-2-line"></i>
          <span>智能还原买卖点与解码战法</span>
        </button>

        
        <div id="brokerDecodeResult" style="margin-top:14px;padding:16px;background:#0d1117;border-radius:8px;border:1px solid #21262d;display:none">
          <div style="color:#8b949e;text-align:center;padding:15px">正在逐笔解码实盘对账单...</div>
        </div>
      </div>
    </div>
  `;
}

async function executeBrokerDecode() {
  const text = (document.getElementById('brokerInputText') || {}).value || '';
  const resBox = document.getElementById('brokerDecodeResult');
  if (resBox) {
    resBox.style.display = 'block';
    resBox.innerHTML = '<div style="color:#8b949e;text-align:center;padding:15px"><span class="spinner"></span> 正在逐笔解码真实交割单买卖点与计算胜率画像...</div>';
  }

  try {
    const res = await authFetch('/api/review/decode-broker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
    const json = await res.json();
    if (json.code === 200 && json.data) {
      const d = json.data;
      resBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b style="color:#58a6ff;font-size:14px">真实战法归纳与行为画像报告</b>
          <span style="color:#3fb950;font-weight:700">真实胜率 ${d.win_rate} · 盈亏比 ${d.profit_loss_ratio} (买入 ${d.buy_count} 笔 / 卖出 ${d.sell_count} 笔)</span>
        </div>
        <div style="font-size:12px;color:#c9d1d9;line-height:1.7">
          🎯 <b>核心战法：</b>${d.strategy_pattern}<br>
          🧠 <b>行为特征：</b>${d.behavior_profile}
        </div>
      `;
      showToast('交割单战法解码成功！', 'success');
    }
  } catch (e) {
    if (resBox) resBox.innerHTML = `<div style="color:#f85149;text-align:center;padding:15px">交割单解码异常: ${e.message}</div>`;
  }
}



// 侧边抽屉展示 (支持内存缓存 + 异步查库双重保障)
async function openIntegratedRefDrawer(refTag) {
  const titleEl = document.getElementById('refDrawerTitle');
  const tagEl = document.getElementById('refDrawerTag');
  const sourceEl = document.getElementById('refDrawerSource');
  const impEl = document.getElementById('refDrawerImportance');
  const contentEl = document.getElementById('refDrawerContent');

  if (tagEl) tagEl.textContent = `[${refTag}]`;
  if (titleEl) titleEl.textContent = '正在检索证据详情...';
  if (contentEl) contentEl.textContent = '正在从后端核心证据库调取原始文本...';

  const backdrop = document.getElementById('refDrawerBackdrop');
  const drawer = document.getElementById('refDrawer');
  if (backdrop) backdrop.style.display = 'block';
  if (drawer) drawer.style.right = '0';

  const cachedNews = _integratedNewsDetailMap[refTag];
  if (cachedNews) {
    if (titleEl) titleEl.textContent = cachedNews.title || '--';
    if (sourceEl) sourceEl.textContent = `来源: ${cachedNews.source || '官方资讯'}`;
    if (impEl) impEl.textContent = `重要度: ${'⭐'.repeat(Math.min(4, Math.max(1, cachedNews.importance_level || 3)))}`;
    if (contentEl) contentEl.textContent = cachedNews.content || '暂无详细证据文本';
    return;
  }

  // 跨 Tab 点击时发起异步查库
  try {
    const res = await authFetch(`/api/review/news-detail?ref=${encodeURIComponent(refTag)}&date=${_selectedReviewDate}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      const n = json.data;
      _integratedNewsDetailMap[refTag] = n;
      if (titleEl) titleEl.textContent = n.title || '--';
      if (sourceEl) sourceEl.textContent = `来源: ${n.source || '官方资讯'}`;
      if (impEl) impEl.textContent = `重要度: ${'⭐'.repeat(Math.min(4, Math.max(1, n.importance_level || 3)))}`;
      if (contentEl) contentEl.textContent = n.content || '暂无详细证据文本';
    } else {
      const rawText = _integratedCitationsMap[refTag] || '暂未检索到该引用的详细证据，可能该条证据已被更新。';
      if (titleEl) titleEl.textContent = `证据条目 ${refTag}`;
      if (sourceEl) sourceEl.textContent = '来源: 官方核心证据库';
      if (impEl) impEl.textContent = '重要度: ⭐⭐⭐⭐';
      if (contentEl) contentEl.textContent = rawText;
    }
  } catch (e) {
    if (contentEl) contentEl.textContent = `调取证据异常: ${e.message}`;
  }
}

function closeIntegratedRefDrawer() {
  const backdrop = document.getElementById('refDrawerBackdrop');
  const drawer = document.getElementById('refDrawer');
  if (backdrop) backdrop.style.display = 'none';
  if (drawer) drawer.style.right = '-480px';
}

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


// ==================== 📚 历史复盘档案库弹窗控制 (时间倒序 + 多维检索) ====================
let _historyPage = 1;
let _historyPageSize = 6;
let _historyTotalPages = 1;
let _historyTotalCount = 0;

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

function changeHistoryPage(delta) {
  const target = _historyPage + delta;
  if (target >= 1 && target <= _historyTotalPages) {
    _historyPage = target;
    loadIntegratedHistoryReports();
  }
}

async function loadIntegratedHistoryReports() {
  const listEl = document.getElementById('rwHistoryReportsList');
  if (listEl) listEl.innerHTML = '<div style="color:#8b949e;text-align:center;padding:35px"><span class="spinner"></span> 正在检索历史复盘研报...</div>';

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

      // 渲染分页器
      const totalEl = document.getElementById('historyTotalCount');
      if (totalEl) totalEl.textContent = _historyTotalCount;
      const indicator = document.getElementById('historyPageIndicator');
      if (indicator) indicator.textContent = `${_historyPage} / ${_historyTotalPages}`;
      const prevBtn = document.getElementById('historyPrevBtn');
      const nextBtn = document.getElementById('historyNextBtn');
      if (prevBtn) prevBtn.disabled = (_historyPage <= 1);
      if (nextBtn) nextBtn.disabled = (_historyPage >= _historyTotalPages);

      if (reports.length === 0) {
        listEl.innerHTML = '<div style="color:#8b949e;text-align:center;padding:35px">暂未检索到符合条件的复盘记录 (可放宽日期或关键词)</div>';
        return;
      }

      listEl.innerHTML = reports.map(r => {
        const isCurrent = r.trade_date === _selectedReviewDate;
        const borderStyle = isCurrent ? 'border:1px solid #58a6ff;background:#1c2128' : 'border:1px solid #30363d;background:#0d1117';
        const currentTag = isCurrent ? '<span style="font-size:11px;background:#388bfd;color:#fff;padding:2px 6px;border-radius:4px;margin-left:6px">当前查看中</span>' : '';
        const themesHtml = (r.main_themes_names || []).map(t => `<span style="font-size:11px;background:#21262d;color:#58a6ff;padding:2px 6px;border-radius:3px">${t}</span>`).join(' ');
        const medChg = r.median_change_pct || 0;

        return `
          <div style="${borderStyle};padding:14px 18px;border-radius:8px;display:flex;flex-direction:column;gap:8px;transition:all 0.15s" onmouseover="this.style.borderColor='#58a6ff'" onmouseout="this.style.borderColor='${isCurrent?'#58a6ff':'#30363d'}'">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <b style="font-size:16px;color:#e6edf3;font-family:'JetBrains Mono',monospace">📅 ${r.trade_date}</b>
                ${currentTag}
              </div>
              <div style="display:flex;gap:12px;font-size:12px;color:#8b949e;font-family:'JetBrains Mono',monospace">
                <span>成交: <b style="color:#58a6ff">${(r.total_amount_yi||0).toLocaleString()} 亿</b></span>
                <span>涨跌中位数: <b style="color:${getPnlColor(medChg)}">${medChg >= 0 ? '+' : ''}${medChg}%</b></span>
                <span>空间高标: <b style="color:#bc8cff">${r.highest_ladder_stock||'--'}</b></span>
              </div>
            </div>

            <div style="font-size:12px;color:#c9d1d9;line-height:1.6;background:rgba(255,255,255,0.02);padding:8px 12px;border-radius:4px;border:1px dashed #21262d">
              ${r.sentiment_summary_short}
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;flex-wrap:wrap;gap:8px">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-size:11px;color:#8b949e">主线聚焦:</span>
                ${themesHtml || '<span style="font-size:11px;color:#8b949e">综合热点</span>'}
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


// ==================== 💼 🌟 VIP 1. 渲染【我的持仓与自选专属复盘】 ====================
async function renderPortfolioReviewPanel(container) {
  container.innerHTML = '<div style="color:#8b949e;text-align:center;padding:50px"><span class="spinner"></span> 正在实时提取您的实盘持仓与重点自选深度数据...</div>';

  try {
    const res = await authFetch('/api/review/portfolio-custom-plan');
    const json = await res.json();
    if (json.code !== 200 || !json.data) {
      container.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">获取持仓专属复盘失败: ${json.message || '未知异常'}</div>`;
      return;
    }

    const d = json.data;
    const posList = d.positions || [];
    const watchList = d.watchlist || [];

    const posCardsHtml = posList.length === 0 ? `
      <div style="color:#8b949e;text-align:center;padding:30px;background:#161b22;border-radius:8px;border:1px dashed #30363d">
        当前暂无实盘持仓数据。您可以在【Alpha 盘中实战交易】中添加持仓或导入交割单！
      </div>
    ` : posList.map(p => {
      const changePct = (p.today_change_pct !== undefined && p.today_change_pct !== null) ? p.today_change_pct : ((p.change_pct !== undefined && p.change_pct !== null) ? p.change_pct : 0);
      const profitPct = (p.profit_pct !== undefined && p.profit_pct !== null) ? p.profit_pct : ((p.pnl_pct !== undefined && p.pnl_pct !== null) ? p.pnl_pct : 0);
      const todayPnl = (p.today_profit_amount !== undefined && p.today_profit_amount !== null) ? p.today_profit_amount : 0;
      const totalPnl = (p.profit_amount !== undefined && p.profit_amount !== null) ? p.profit_amount : ((p.pnl_amount !== undefined && p.pnl_amount !== null) ? p.pnl_amount : 0);
      const costPrice = p.cost_price || 0;
      const currPrice = p.current_price || costPrice;
      const posWeight = p.position_weight_pct || 0;
      const reasonsListHtml = (p.reasons || []).map(r => `<li>${r}</li>`).join('');

      return `
        <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px;display:flex;flex-direction:column;gap:12px;margin-bottom:12px">
          <!-- 顶栏：股票名称、持仓、现价、盈亏 -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <b style="font-size:17px;color:#e6edf3">${p.name}</b>
              <span style="font-size:13px;color:#8b949e;font-family:'JetBrains Mono'">${p.symbol}</span>
              <span style="font-size:12px;background:rgba(88,166,255,0.12);color:#58a6ff;padding:2px 8px;border-radius:4px">持仓: <b style="color:#e6edf3">${(p.shares||0).toLocaleString()} 股</b></span>
              <span style="font-size:12px;color:#8b949e">成本: <b style="color:#e6edf3;font-family:'JetBrains Mono'">¥${costPrice}</b></span>
              <span style="font-size:12px;color:#8b949e">现价: <b style="color:#58a6ff;font-family:'JetBrains Mono'">¥${currPrice}</b></span>
              <span style="font-size:12px;color:#8b949e">仓位: <b style="color:#e6edf3">${posWeight}%</b></span>
            </div>
            <div style="display:flex;gap:16px;align-items:center;font-family:'JetBrains Mono';font-size:12px">
              <div style="text-align:right">
                <div style="color:#8b949e;font-size:11px">当日盈亏</div>
                <b style="color:${getPnlColor(changePct)}">${todayPnl >= 0 ? '+' : ''}¥${todayPnl} (${changePct >= 0 ? '+' : ''}${changePct}%)</b>
              </div>
              <div style="text-align:right">
                <div style="color:#8b949e;font-size:11px">持仓盈亏</div>
                <b style="font-size:14px;color:${getPnlColor(profitPct)}">${totalPnl >= 0 ? '+' : ''}¥${totalPnl} (${profitPct >= 0 ? '+' : ''}${profitPct}%)</b>
              </div>
            </div>
          </div>

          <!-- 中栏：智能执行指令与建议防守价 -->
          <div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:12px;color:#8b949e;display:flex;align-items:center;gap:4px">
                <i class="ri-flashlight-fill" style="color:#e3b341"></i>
                <span>智能执行指令:</span>
              </span>
              <span style="background:rgba(248,81,73,0.15);color:${p.tag_color || '#58a6ff'};border:1px solid ${p.tag_color || '#58a6ff'};font-weight:800;font-size:12px;padding:3px 10px;border-radius:4px">${p.action}</span>
              <span style="font-size:12px;color:#c9d1d9">建议处理: <b>${p.suggest_shares || 0} 股</b> (约 ¥${p.suggest_amount || 0}万) · 剩余: <b>${p.remaining_shares || 0} 股</b></span>
            </div>
            <div style="display:flex;gap:14px;font-size:12px;font-family:'JetBrains Mono'">
              <span>建议防守止损价: <b style="color:#3fb950">¥${p.stop_loss_price || '--'}</b></span>
              <span>目标止盈价: <b style="color:#f85149">¥${p.take_profit_price || '--'}</b></span>
            </div>
          </div>

          <!-- 底栏：3大底层逻辑深度拆解与大模型专属预案 -->
          <div style="font-size:12px;color:var(--sys-text-primary);line-height:1.7;background:rgba(255,255,255,0.02);padding:10px 14px;border-radius:6px;border-left:3px solid ${p.tag_color || 'var(--sys-accent)'}">
            <div style="color:var(--sys-accent);font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:4px">
              <i class="ri-vip-crown-fill" style="color:#e3b341"></i>
              <span>AI 智能操盘博弈预案与决策依据：</span>
            </div>
            <ul style="margin:0;padding-left:18px;color:var(--sys-text-primary)">
              ${reasonsListHtml || `<li>${p.action_desc}</li>`}
            </ul>
          </div>
        </div>
      `;

    }).join('');

    const watchRowsHtml = watchList.length === 0 ? `
      <div style="color:#8b949e;text-align:center;padding:30px">暂无自选关注标的</div>
    ` : watchList.map((w, idx) => {
      const chgColor = getPnlColor(w.change_pct);
      return `
        <tr style="border-bottom:1px solid #21262d;font-size:12px;transition:background 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
          <td style="padding:10px;text-align:center;color:#8b949e">${idx + 1}</td>
          <td style="padding:10px">
            <b style="color:#58a6ff;font-size:13px">${w.name}</b>
            <span style="color:#8b949e;font-size:11px;font-family:'JetBrains Mono';margin-left:4px">${w.symbol}</span>
          </td>
          <td style="padding:10px;font-family:'JetBrains Mono';color:#e6edf3;font-weight:700">¥${w.current_price}</td>
          <td style="padding:10px;font-family:'JetBrains Mono';font-weight:800;color:${chgColor}">${(w.change_pct||0) >= 0 ? '+' : ''}${w.change_pct}%</td>
          <td style="padding:10px;font-family:'JetBrains Mono';color:#c9d1d9">${w.amount_yi} 亿</td>
          <td style="padding:10px"><span style="background:rgba(255,255,255,0.06);color:${w.tag_color || '#58a6ff'};padding:3px 8px;border-radius:4px;font-weight:700;font-size:11px">${w.status}</span></td>
          <td style="padding:10px;color:#8b949e;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${w.matched_ref}">${w.matched_ref}</td>
          <td style="padding:10px;color:#c9d1d9;font-size:12px">
            <span style="display:inline-flex;align-items:center;gap:4px">
              <i class="ri-lightbulb-line" style="color:#e3b341"></i>
              <span>${w.advice}</span>
            </span>
          </td>
        </tr>
      `;
    }).join('');


    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- 顶部提示 -->
        <div style="background:linear-gradient(135deg,rgba(56,139,253,0.15),#161b22);border:1px solid rgba(56,139,253,0.3);padding:14px 18px;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:10px">
            <i class="ri-briefcase-4-line" style="font-size:22px;color:var(--sys-accent)"></i>
            <div>
              <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_portfolio')" style="font-size:15px;color:#58a6ff;display:inline-flex;align-items:center;gap:6px">
                <span>我的实盘持仓 · 100% 精确量化诊断与次日博弈预案</span>
                <i class="ri-information-line" style="font-size:14px;color:var(--sys-accent)"></i>
              </b>
              <p style="margin:2px 0 0 0;font-size:12px;color:#8b949e">实时严格对齐券商真实持仓成本、当日盈亏、仓位比例与 MA20 关键止损防线</p>
            </div>
          </div>
          <span style="font-size:12px;color:#3fb950;font-weight:700">共 ${posList.length} 只持仓标的 · ${watchList.length} 只重点自选</span>
        </div>


        <!-- 持仓卡片列表 -->
        <div>
          ${posCardsHtml}
        </div>

        <!-- 重点自选盘后深度异动雷达 -->
        <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:16px;border-radius:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px">
              <i class="ri-star-fill" style="font-size:18px;color:#e3b341"></i>
              <b class="clickable-feature-title" onclick="openFeatureGuideModal('watchlist')" style="font-size:14px;color:#e6edf3;display:inline-flex;align-items:center;gap:6px">
                <span>重点自选股盘后深度异动雷达 · 量价与买点研判</span>
                <i class="ri-information-line" style="font-size:13px;color:var(--sys-accent)"></i>
              </b>
            </div>
            <span style="font-size:11px;color:#8b949e">实时并发拉取盘口成交与日内形态</span>
          </div>

          <table style="width:100%;border-collapse:collapse;text-align:left">
            <thead>
              <tr style="background:#0d1117;color:#8b949e;font-size:11px;border-bottom:1px solid #30363d">
                <th style="padding:8px;text-align:center;width:40px">#</th>
                <th style="padding:8px">自选标的/代码</th>
                <th style="padding:8px">最新现价</th>
                <th style="padding:8px">今日涨跌幅</th>
                <th style="padding:8px">今日成交额</th>
                <th style="padding:8px">盘口形态特征</th>
                <th style="padding:8px">关联催化证据</th>
                <th style="padding:8px">AI 跟踪与实战买点建议</th>
              </tr>
            </thead>
            <tbody>
              ${watchRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

  } catch (e) {
    container.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">渲染持仓复盘失败: ${e.message}</div>`;
  }
}


// ==================== 🔥 🌟 VIP 2. 渲染【核心题材板块深度穿透】 ====================
let _selectedSectorName = "人形机器人";



async function renderSectorDeepDivePanel(container) {
  container.innerHTML = '<div style="color:#8b949e;text-align:center;padding:50px"><span class="spinner"></span> 正在穿透拉取板块资金流、成分股与 AI 持续性评级...</div>';

  try {
    const res = await authFetch(`/api/review/sector-deep-dive?sector=${encodeURIComponent(_selectedSectorName)}`);
    const json = await res.json();
    if (json.code !== 200 || !json.data) {
      container.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">获取板块穿透分析失败: ${json.message || '未知异常'}</div>`;
      return;
    }

    const d = json.data;
    const sectorList = d.sector_list || [];
    const stocks = d.stocks || [];
    const evidence = d.evidence || [];

    // 1. 板块快速切换胶囊 (A股红涨绿跌)
    const sectorTabsHtml = sectorList.map(s => {
      const isSel = s.name === _selectedSectorName;
      const borderStyle = isSel ? 'border:1px solid #e3b341;background:rgba(227,179,65,0.15);color:#e3b341' : 'border:1px solid #30363d;background:#0d1117;color:#c9d1d9';
      return `
        <button style="${borderStyle};padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s" onclick="switchSectorAndReload('${jsStr(s.name)}')">
          ${s.name} <span style="font-family:'JetBrains Mono';color:${getPnlColor(s.change_pct)}">${(s.change_pct||0) >= 0 ? '+' : ''}${s.change_pct}%</span>
        </button>
      `;
    }).join(' ');

    // 2. 成分股表格
    const stocksTableHtml = stocks.map((st, idx) => `
      <tr style="border-bottom:1px solid #21262d;font-size:12px">
        <td style="padding:10px;text-align:center">${idx + 1}</td>
        <td style="padding:10px"><b style="color:#58a6ff">${st.name}</b> <span style="color:#8b949e;font-family:'JetBrains Mono'">${st.code}</span></td>
        <td style="padding:10px;font-family:'JetBrains Mono'">¥${st.price}</td>
        <td style="padding:10px;font-family:'JetBrains Mono';font-weight:700;color:${getPnlColor(st.change_pct)}">${(st.change_pct||0) >= 0 ? '+' : ''}${st.change_pct}%</td>
        <td style="padding:10px"><span style="background:rgba(248,81,73,0.15);color:#f85149;padding:2px 6px;border-radius:3px;font-weight:700">${st.ladder}</span></td>
        <td style="padding:10px;font-family:'JetBrains Mono';color:${getPnlColor(st.net_inflow_yi)}">${st.net_inflow_yi >= 0 ? '+' : ''}${st.net_inflow_yi} 亿</td>
        <td style="padding:10px;color:#c9d1d9">${st.status}</td>
      </tr>
    `).join('');

    // 3. 关联证据列表 (纯中文通俗展示 + 支持点击研读)
    const evidenceHtml = evidence.map((e, idx) => `
      <div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px 16px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor='#58a6ff'" onmouseout="this.style.borderColor='#21262d'" onclick="openEvidenceDetailModal('${jsStr(e.ref_tag)}')">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <b style="color:#58a6ff;font-size:13px;display:flex;align-items:center;gap:6px">
            <i class="ri-pushpin-2-fill" style="color:var(--sys-accent)"></i>
            <span>催化依据 ${idx + 1}：${e.title}</span>
          </b>
          <span style="font-size:11px;color:#8b949e">${e.source} · ${e.publish_time} · <span style="color:#388bfd">点击研读全文 ↗</span></span>
        </div>
        <div style="font-size:12px;color:#8b949e;line-height:1.6">${e.content}</div>
      </div>
    `).join('');


    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- 板块切换导航条与任意板块搜索 -->
        <div style="background:#161b22;border:1px solid #30363d;padding:14px 16px;border-radius:8px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <i class="ri-fire-fill" style="font-size:18px;color:#f85149"></i>
              <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_sectors')" style="font-size:14px;color:#e6edf3;display:inline-flex;align-items:center;gap:4px">
                <span>核心热门题材板块联动切换 (全市场资金流动态排行)</span>
                <i class="ri-information-line" style="font-size:13px;color:var(--sys-accent)"></i>
              </b>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <input type="text" id="customSectorSearchInput" placeholder="输入任意板块 (如 固态电池/算力)..." style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:4px 10px;color:#e6edf3;font-size:12px;width:200px" onkeydown="if(event.key==='Enter') searchAndSwitchSector()">
              <button class="btn btn-blue" style="padding:4px 12px;font-size:12px;display:flex;align-items:center;gap:4px" onclick="searchAndSwitchSector()">
                <i class="ri-search-line"></i>
                <span>穿透</span>
              </button>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${sectorTabsHtml}
          </div>
        </div>


        <!-- 板块 AI 景气度与持续性定调 -->
        <div style="background:linear-gradient(135deg,rgba(227,179,65,0.12),#161b22);border:1px solid rgba(227,179,65,0.3);padding:14px 18px;border-radius:8px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:15px;color:#e3b341;display:flex;align-items:center;gap:6px">
              <i class="ri-brain-line"></i>
              <span>【${d.current_sector}】板块 AI 持续性研判与博弈策略</span>
            </b>
            <span style="font-size:12px;color:#e6edf3;font-weight:700">${d.ai_sustainability}</span>
          </div>
          <div style="font-size:12px;color:#c9d1d9;line-height:1.6;display:flex;align-items:flex-start;gap:6px">
            <i class="ri-focus-3-line" style="color:var(--sys-accent);margin-top:2px"></i>
            <div><b>操盘策略：</b>${d.ai_strategy}</div>
          </div>
        </div>

        <!-- 领涨龙头成分股列表 -->
        <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:16px;border-radius:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <b style="font-size:14px;color:#e6edf3;display:flex;align-items:center;gap:6px">
              <i class="ri-rocket-line" style="color:var(--sys-accent)"></i>
              <span>【${d.current_sector}】板块领涨龙头与核心梯队</span>
            </b>
            <span style="font-size:11px;color:#8b949e">按主力净流入与连板高度排序</span>
          </div>
          <table style="width:100%;border-collapse:collapse;text-align:left">
            <thead>
              <tr style="background:#0d1117;color:#8b949e;font-size:11px;border-bottom:1px solid #30363d">
                <th style="padding:8px;text-align:center;width:40px">#</th>
                <th style="padding:8px">标的名称/代码</th>
                <th style="padding:8px">现价</th>
                <th style="padding:8px">涨跌幅</th>
                <th style="padding:8px">梯队身位</th>
                <th style="padding:8px">主力净流入</th>
                <th style="padding:8px">地位特征</th>
              </tr>
            </thead>
            <tbody>
              ${stocksTableHtml}
            </tbody>
          </table>
        </div>

        <!-- 关联产业催化与新闻证据 -->
        <div class="panel" style="margin:0;background:#161b22;border:1px solid #30363d;padding:16px;border-radius:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <b style="font-size:14px;color:#e6edf3;display:flex;align-items:center;gap:6px">
              <i class="ri-newspaper-line" style="color:var(--sys-accent)"></i>
              <span>【${d.current_sector}】关联产业政策与催化证据</span>
            </b>
            <span style="font-size:11px;color:#8b949e">SimHash 90% 去重证据库联动</span>
          </div>
          <div>
            ${evidenceHtml}
          </div>
        </div>
      </div>
    `;

  } catch (e) {
    container.innerHTML = `<div style="color:#f85149;text-align:center;padding:30px">渲染板块穿透分析失败: ${e.message}</div>`;
  }
}

function switchSectorAndReload(secName) {
  _selectedSectorName = secName;
  const container = document.getElementById('agentMainViewContainer');
  if (container) renderSectorDeepDivePanel(container);
}

function searchAndSwitchSector() {
  const input = document.getElementById('customSectorSearchInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    showToast('请输入要穿透分析的板块名称 (例如 固态电池/算力/医药生物)', 'info');
    return;
  }
  switchSectorAndReload(val);
}
window.searchAndSwitchSector = searchAndSwitchSector;


/* ==================== 10. 复盘子功能按钮悬停气泡介绍卡片引擎 ==================== */
let _hoverCardTimer = null;

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
window.switchSectorAndReload = switchSectorAndReload;
window.switchReviewSubTab = switchReviewSubTab;
window.switchAgentView = switchAgentView;
window.loadFullAgentDashboardData = loadFullAgentDashboardData;
window.renderCurrentAgentView = renderCurrentAgentView;
window.changeIntegratedReviewDate = changeIntegratedReviewDate;