/* ==================== 双核心系统切换与主题驱动 (System Switcher) ==================== */
// 系统核心定位：Alpha 实战操盘中枢 ⇋ 交易复盘与智能体中枢
let _currentCategory = localStorage.getItem('quant_active_category') || 'alpha';
if (_currentCategory === 'quant') {
  _currentCategory = 'alpha'; // 自动平滑纠偏旧缓存
}
let _currentAlphaSub = localStorage.getItem('quant_active_alpha_sub') || 'pos';
let _currentReviewSub = localStorage.getItem('quant_active_review_sub') || 'overview';

/**
 * 核心系统切换 (Alpha 实盘 ⇋ 交易复盘)
 * @param {string} cat 目标系统键名 ('alpha' | 'review')
 */
function switchCategory(cat) {
  if (cat !== 'alpha' && cat !== 'review') {
    cat = 'alpha';
  }
  _currentCategory = cat;
  try {
    localStorage.setItem('quant_active_category', cat);
  } catch(e) {}

  const btnAlpha = document.getElementById('catBtnAlpha');
  const btnReview = document.getElementById('catBtnReview');

  const secAlpha = document.getElementById('sysSectionAlpha');
  const secReview = document.getElementById('sysSectionReview');

  const mainTitleEl = document.getElementById('systemMainTitle');
  const mainTagEl = document.getElementById('systemMainTag');

  // 1. 全域主题类智能切换 (瞬间换装)
  document.body.classList.remove('theme-alpha', 'theme-review', 'theme-quant');
  document.body.classList.add(`theme-${cat}`);

  // 2. 根容器物理隔离互斥切换 (确保 display 优先级最高)
  if (secAlpha) secAlpha.style.setProperty('display', cat === 'alpha' ? 'block' : 'none', 'important');
  if (secReview) secReview.style.setProperty('display', cat === 'review' ? 'block' : 'none', 'important');

  // 3. 顶栏 Switcher 按钮激活状态
  if (btnAlpha) btnAlpha.classList.toggle('active', cat === 'alpha');
  if (btnReview) btnReview.classList.toggle('active', cat === 'review');

  if (cat === 'alpha') {
    document.title = 'Alpha 盘中实战交易系统';
    if (mainTitleEl) mainTitleEl.textContent = 'Alpha 盘中实战交易系统';
    if (mainTagEl) mainTagEl.textContent = '实盘操盘';

    try { switchAlphaSubTab(_currentAlphaSub || 'pos'); } catch(e) { console.error('切换Alpha子页面异常:', e); }

  } else {
    document.title = '交易复盘与智能体中枢 · 智能协同版';
    if (mainTitleEl) mainTitleEl.textContent = '交易复盘与智能体中枢';
    if (mainTagEl) mainTagEl.textContent = '7人智能体';

    try { switchReviewSubTab(_currentReviewSub || 'overview'); } catch(e) { console.error('切换复盘子页面异常:', e); }
    try {
      if (typeof loadFullAgentDashboardData === 'function') {
        loadFullAgentDashboardData();
      }
    } catch(e) { console.error('加载复盘数据异常:', e); }
  }
}

/**
 * 系统二：交易复盘独立子 Tab 切换 (带持久化记忆)
 * @param {string} sub 子视图标识
 */
function switchReviewSubTab(sub) {
  _currentReviewSub = sub;
  try {
    localStorage.setItem('quant_active_review_sub', sub);
  } catch(e) {}

  const subToAgentMap = {
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
  const agentKey = subToAgentMap[sub] || sub;
  if (typeof window.switchAgentView === 'function') {
    window.switchAgentView(agentKey);
  }
}

/**
 * 系统一：Alpha 实操独立子 Tab 切换 (带持久化记忆)
 * @param {string} sub 子视图标识
 */
function switchAlphaSubTab(sub) {
  _currentAlphaSub = sub;
  try {
    localStorage.setItem('quant_active_alpha_sub', sub);
  } catch(e) {}

  document.querySelectorAll('#alphaSubTabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.alpha-sub-content').forEach(c => {
    c.classList.remove('active');
    c.classList.remove('hidden');
    c.style.display = 'none';
  });

  const btn = document.getElementById('subTabBtn' + sub.charAt(0).toUpperCase() + sub.slice(1));
  const cnt = document.getElementById('tab-alpha-' + sub);
  if (btn) btn.classList.add('active');
  if (cnt) {
    cnt.classList.add('active');
    cnt.classList.remove('hidden');
    cnt.style.display = 'block';
  }

  // 联动触发对应子模块数据刷新
  if (sub === 'pos' && typeof window.refreshPortfolioData === 'function') {
    window.refreshPortfolioData();
  } else if (sub === 'sector' && typeof window.loadSectorFlows === 'function') {
    window.loadSectorFlows();
  } else if (sub === 'decision') {
    if (typeof window.initAlphaDesk === 'function') window.initAlphaDesk();
    if (typeof window.scanAlphaCandidates === 'function') window.scanAlphaCandidates();
  } else if (sub === 'judge') {
    if (typeof window.initJudgeModule === 'function') window.initJudgeModule();
  } else if (sub === 'twitter') {
    if (typeof window.loadTwitterRadar === 'function') window.loadTwitterRadar();
  }
}

// 显式挂载核心函数到全局 window 对象
window.switchCategory = switchCategory;
window.switchAlphaSubTab = switchAlphaSubTab;
window.switchReviewSubTab = switchReviewSubTab;
// 兼容历史调用空兜底
window.switchQuantTab = function() {};
window.switchTab = function() {};