/* ==================== 三大系统切换与主题驱动 (System Switcher) ==================== */
let _currentCategory = localStorage.getItem('quant_active_category') || 'review';
let _currentAlphaSub = localStorage.getItem('quant_active_alpha_sub') || 'pos';
let _currentReviewSub = localStorage.getItem('quant_active_review_sub') || 'overview';
let _currentQuantSub = localStorage.getItem('quant_active_quant_sub') || 'backtest';

function switchCategory(cat) {
  _currentCategory = cat;
  try {
    localStorage.setItem('quant_active_category', cat);
  } catch(e) {}

  const btnAlpha = document.getElementById('catBtnAlpha');
  const btnReview = document.getElementById('catBtnReview');
  const btnQuant = document.getElementById('catBtnQuant');

  const secAlpha = document.getElementById('sysSectionAlpha');
  const secReview = document.getElementById('sysSectionReview');
  const secQuant = document.getElementById('sysSectionQuant');

  const mainTitleEl = document.getElementById('systemMainTitle');
  const mainTagEl = document.getElementById('systemMainTag');

  // 1. 全域主题类智能切换 (瞬间换装)
  document.body.classList.remove('theme-alpha', 'theme-review', 'theme-quant');
  document.body.classList.add(`theme-${cat}`);

  // 2. 根容器物理隔离互斥切换 (彻底杜绝任何跨系统元素穿透)
  if (secAlpha) secAlpha.style.display = (cat === 'alpha' ? 'block' : 'none');
  if (secReview) secReview.style.display = (cat === 'review' ? 'block' : 'none');
  if (secQuant) secQuant.style.display = (cat === 'quant' ? 'block' : 'none');

  // 3. 顶栏 Switcher 按钮激活状态
  if (btnAlpha) btnAlpha.classList.toggle('active', cat === 'alpha');
  if (btnReview) btnReview.classList.toggle('active', cat === 'review');
  if (btnQuant) btnQuant.classList.toggle('active', cat === 'quant');

  if (cat === 'alpha') {
    document.title = 'Alpha 盘中实战交易系统';
    if (mainTitleEl) mainTitleEl.textContent = 'Alpha 盘中实战交易系统';
    if (mainTagEl) mainTagEl.textContent = '实盘操盘';

    switchAlphaSubTab(_currentAlphaSub || 'pos');

  } else if (cat === 'review') {
    document.title = '交易复盘与智能体中枢 · 智能协同版';
    if (mainTitleEl) mainTitleEl.textContent = '交易复盘与智能体中枢';
    if (mainTagEl) mainTagEl.textContent = '7人智能体';


    switchReviewSubTab(_currentReviewSub || 'overview');
    if (typeof loadFullAgentDashboardData === 'function') {
      loadFullAgentDashboardData();
    }

  } else {
    document.title = '量化投研与策略回测引擎';
    if (mainTitleEl) mainTitleEl.textContent = '量化投研与策略回测引擎';
    if (mainTagEl) mainTagEl.textContent = '策略引擎';


    switchQuantTab(_currentQuantSub || 'backtest');
  }
}

// 系统二独立子 Tab 切换 (带持久化记忆)
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

// 系统一独立子 Tab 切换 (带持久化记忆)
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

  // 联动触发数据刷新
  if (sub === 'pos' && typeof window.refreshPortfolioData === 'function') {
    window.refreshPortfolioData();
  } else if (sub === 'sector' && typeof window.loadSectorFlows === 'function') {
    window.loadSectorFlows();
  } else if (sub === 'decision') {
    if (typeof window.initAlphaDesk === 'function') window.initAlphaDesk();
    if (typeof window.scanAlphaCandidates === 'function') window.scanAlphaCandidates();
  }
}

// 系统三独立子 Tab 切换
function switchQuantTab(name, el) {
  _currentQuantSub = name;
  document.querySelectorAll('#quantSubTabs .tab').forEach(t => t.classList.remove('active'));
  if (el) {
    el.classList.add('active');
  } else {
    const defaultBtn = document.querySelector(`#quantSubTabs .tab[onclick*="'${name}'"]`);
    if (defaultBtn) defaultBtn.classList.add('active');
  }

  document.querySelectorAll('#sysSectionQuant .tab-content').forEach(c => {
    c.classList.remove('active');
    c.classList.remove('hidden');
    c.style.display = 'none';
  });

  const target = document.getElementById('tab-' + name);
  if (target) {
    target.classList.add('active');
    target.classList.remove('hidden');
    target.style.display = 'block';
  }

  // 联动触发量化子页面数据初始化
  if (name === 'strategies' && typeof window.loadUserStrategies === 'function') {
    window.loadUserStrategies();
  } else if (name === 'compare' && typeof window.loadCompareStrategies === 'function') {
    window.loadCompareStrategies();
  } else if (name === 'portfolio' && typeof window.loadPortfolioStrategies === 'function') {
    window.loadPortfolioStrategies();
  } else if (name === 'optimize' && typeof window.loadOptimizeStrategies === 'function') {
    window.loadOptimizeStrategies();
  } else if (name === 'risk' && typeof window.loadRiskConfig === 'function') {
    window.loadRiskConfig();
  } else if (name === 'paper' && typeof window.loadPaperAccount === 'function') {
    window.loadPaperAccount();
  } else if (name === 'broker' && typeof window.loadBrokerStatus === 'function') {
    window.loadBrokerStatus();
  }
}


// 显式挂载全部函数到全局 window 对象
window.switchCategory = switchCategory;
window.switchAlphaSubTab = switchAlphaSubTab;
window.switchReviewSubTab = switchReviewSubTab;
window.switchQuantTab = switchQuantTab;
window.switchTab = switchQuantTab; // 兼容旧 switchTab 别名