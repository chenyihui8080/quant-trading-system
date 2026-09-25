/* ==================== 双核心系统切换与主题驱动 (System Switcher) ==================== */
// 系统核心定位：⚡ 实盘决策 (Live Trading) ⇋ 📊 盘后复盘 (Post-Market Review)
// 支持通过 URL hash 快速直达
const urlHash = (typeof window !== 'undefined' && window.location) ? window.location.hash : '';
const urlSearch = (typeof window !== 'undefined' && window.location) ? window.location.search : '';

let _currentCategory = 'alpha';
if (urlHash.includes('evidence') || urlHash.includes('news') || urlSearch.includes('evidence') || urlSearch.includes('news')) {
  _currentCategory = 'review';
} else if (urlHash.includes('review') || urlSearch.includes('review')) {
  _currentCategory = 'review';
} else if (urlHash.includes('paper20k') || urlSearch.includes('paper20k')) {
  _currentCategory = 'alpha';
} else {
  _currentCategory = localStorage.getItem('quant_active_category') || 'alpha';
}
if (_currentCategory === 'quant') {
  _currentCategory = 'alpha'; // 自动平滑纠偏旧缓存
}
let _currentAlphaSub = 'paper20k';
if (urlHash.includes('paper20k') || window.location.search.includes('paper20k')) {
  _currentAlphaSub = 'paper20k';
} else if (urlHash.includes('backtest')) {
  _currentAlphaSub = 'backtest';
} else if (urlHash.includes('watchpool')) {
  _currentAlphaSub = 'watchpool';
} else if (urlHash.includes('decision')) {
  _currentAlphaSub = 'decision';
} else if (urlHash.includes('pos')) {
  _currentAlphaSub = 'pos';
} else {
  _currentAlphaSub = localStorage.getItem('quant_active_alpha_sub') || 'paper20k';
}
// 如果以前缓存的是已迁出的 sector 或 judge，自动纠偏到 watchpool
if (_currentAlphaSub === 'sector' || _currentAlphaSub === 'judge') {
  _currentAlphaSub = 'watchpool';
}
let _currentReviewSub = localStorage.getItem('quant_active_review_sub') || 'overview';
if (urlHash.includes('evidence') || urlHash.includes('news') || urlSearch.includes('evidence') || urlSearch.includes('news')) {
  _currentReviewSub = 'news';
} else if (_currentReviewSub === 'funnel') {
  _currentReviewSub = 'overview';
}

/**
 * 核心系统切换 (实盘决策 ⇋ 盘后复盘)
 * @param {string} cat 目标系统键名 ('alpha' | 'review')
 */
function switchCategory(cat) {

  if (cat !== 'alpha' && cat !== 'review') {
    cat = 'alpha';
  }
  _currentCategory = cat;
  try {
    localStorage.setItem('quant_active_category', cat);
  } catch(e) { console.warn('localStorage set active category warn:', e); }

  const btnAlpha = document.getElementById('catBtnAlpha');
  const btnReview = document.getElementById('catBtnReview');

  const secAlpha = document.getElementById('sysSectionAlpha');
  const secReview = document.getElementById('sysSectionReview');

  const mainTitleEl = document.getElementById('systemMainTitle');
  const mainTagEl = document.getElementById('systemMainTag');

  // 1. 全域主题类智能切换
  document.body.classList.remove('theme-alpha', 'theme-review', 'theme-quant');
  document.body.classList.add(`theme-${cat}`);

  // 2. 根容器物理隔离互斥切换
  if (secAlpha) secAlpha.style.setProperty('display', cat === 'alpha' ? 'block' : 'none', 'important');
  if (secReview) secReview.style.setProperty('display', cat === 'review' ? 'block' : 'none', 'important');

  // 3. 顶栏 Switcher 按钮激活状态
  if (btnAlpha) btnAlpha.classList.toggle('active', cat === 'alpha');
  if (btnReview) btnReview.classList.toggle('active', cat === 'review');

  if (cat === 'alpha') {
    document.title = '⚡ 实盘决策 (Live Trading) · 股票协同操盘';
    if (mainTitleEl) mainTitleEl.textContent = '⚡ 实盘决策台';
    if (mainTagEl) mainTagEl.textContent = '实盘操盘';

    try { switchAlphaSubTab(_currentAlphaSub || 'pos'); } catch(e) { console.error('切换Alpha子页面异常:', e); }

  } else {
    document.title = '📊 盘后复盘 (Post-Market Review) · 智能协同版';
    if (mainTitleEl) mainTitleEl.textContent = '📊 盘后复盘研判台';
    if (mainTagEl) mainTagEl.textContent = '7人智能体';

    // 切换到复盘系统
    try { switchReviewSubTab(_currentReviewSub || 'overview'); } catch(e) { console.error('切换复盘子页面异常:', e); }
    try {
      if (typeof loadFullAgentDashboardData === 'function') {
        loadFullAgentDashboardData();
      }
    } catch(e) { console.error('加载复盘数据异常:', e); }
  }
}

/**
 * 系统二：盘后复盘独立子 Tab 切换 (带持久化记忆)
 * @param {string} sub 子视图标识 ('overview' | 'sector' | 'attribution' | 'judge' | 'news')
 */
function switchReviewSubTab(sub) {
  if (sub === 'funnel') sub = 'overview'; // 兼容历史调用
  _currentReviewSub = sub;
  try {
    localStorage.setItem('quant_active_review_sub', sub);
  } catch(e) { console.warn('localStorage set review sub warn:', e); }

  const subToAgentMap = {
    'overview': 'overview',
    'sector': 'sector',
    'attribution': 'attribution',
    'judge': 'judge',
    'news': 'news',
    'portfolio': 'portfolio'
  };
  const agentKey = subToAgentMap[sub] || sub;
  if (typeof window.switchAgentView === 'function') {
    window.switchAgentView(agentKey);
  }
}

/**
 * 系统一：实盘决策独立子 Tab 切换 (带持久化记忆)
 * @param {string} sub 子视图标识 ('watchpool' | 'pos' | 'decision' | 'backtest' | 'twitter')
 */
function switchAlphaSubTab(sub) {
  // 迁出路由兼容：如果请求了 sector 或 judge，自动无缝跳转到复盘对应 Tab！
  if (sub === 'sector' || sub === 'judge') {
    switchCategory('review');
    switchReviewSubTab(sub);
    return;
  }

  _currentAlphaSub = sub;
  try {
    localStorage.setItem('quant_active_alpha_sub', sub);
  } catch(e) { console.warn('localStorage set alpha sub warn:', e); }

  document.querySelectorAll('#alphaSubTabs .tab').forEach(t => {
    t.classList.remove('active');
    t.style.removeProperty('background');
    t.style.removeProperty('border');
  });
  document.querySelectorAll('.alpha-sub-content').forEach(c => {
    c.classList.remove('active');
    c.classList.remove('hidden');
    c.style.display = 'none';
  });

  const subCap = sub.charAt(0).toUpperCase() + sub.slice(1);
  const btn = document.getElementById('subTabBtn' + subCap);
  const cnt = document.getElementById('tab-alpha-' + sub);
  if (btn) btn.classList.add('active');
  if (cnt) {
    cnt.classList.add('active');
    cnt.classList.remove('hidden');
    cnt.style.display = 'block';
  }

  // 联动触发对应子模块数据刷新
  if (sub === 'watchpool') {
    if (typeof window.loadIntegratedWatchlistData === 'function') {
      window.loadIntegratedWatchlistData();
    }
  } else if (sub === 'pos') {
    if (typeof window.refreshPortfolioData === 'function') {
      window.refreshPortfolioData();
    }
  } else if (sub === 'decision') {
    if (typeof window.initAlphaDesk === 'function') window.initAlphaDesk();
    if (typeof window.scanAlphaCandidates === 'function') window.scanAlphaCandidates();
  } else if (sub === 'backtest') {
    if (typeof window.initBacktestPage === 'function') window.initBacktestPage();
  } else if (sub === 'twitter') {
    if (typeof window.loadTwitterRadar === 'function') window.loadTwitterRadar();
  } else if (sub === 'paper20k') {
    if (typeof window.initPaper20kDashboard === 'function') window.initPaper20kDashboard();
  }
}

// 显式挂载核心函数到全局 window 对象
window.switchCategory = switchCategory;
window.switchAlphaSubTab = switchAlphaSubTab;
window.switchReviewSubTab = switchReviewSubTab;
// 兼容历史调用空兜底
window.switchQuantTab = function() {};
window.switchTab = function() {};
