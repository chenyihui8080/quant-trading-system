/* ==================== 全局启动与自动化轮询 (Main App Bootstrapper) ==================== */

async function autoEnsureLogin() {
  const urlParams = new URLSearchParams(window.location.search);
  const requestedCat = urlParams.get('cat') || (window.location.hash.includes('review') ? 'review' : null);
  if (requestedCat) {
    try { localStorage.setItem('quant_active_category', requestedCat); } catch(e) { console.warn('localStorage set active category warn:', e); }
  }
  const requestedSub = urlParams.get('sub');
  if (requestedSub) {
    if (requestedCat === 'review') {
      try { localStorage.setItem('quant_active_review_sub', requestedSub); } catch(e) { console.warn('localStorage set review sub warn:', e); }
    } else {
      try { localStorage.setItem('quant_active_alpha_sub', requestedSub); } catch(e) { console.warn('localStorage set alpha sub warn:', e); }
    }
  }

  let token = getToken();
  let user = localStorage.getItem('quant_user');

  // 1. 若本地存在 Token，必须先向后端自检验真，严禁直接盲信失效/过期凭证导致假登录
  if (token) {
    try {
      const verifyRes = await fetch('/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (verifyRes.ok) {
        const meData = await verifyRes.json();
        const validUser = meData.username || user || 'admin';
        localStorage.setItem('quant_user', validUser);
        showAuthenticated(token, validUser);
        return;
      } else {
        console.warn('本地 Token 已失效(HTTP ' + verifyRes.status + ')，重置登录态');
        clearToken();
      }
    } catch (ve) {
      console.warn('校验 Token 有效性异常:', ve);
    }
  }

  // 2. 尝试使用本地开发环境凭据自动登录
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin_default_password' })
    });
    if (res.ok) {
      const data = await res.json();
      token = data.access_token || data.token;
      user = 'admin';
      if (token) {
        setToken(token);
        localStorage.setItem('quant_user', user);
        showAuthenticated(token, user);
        return;
      }
    }
  } catch (e) {
    console.warn('静默认证尝试跳过，由用户手动输入:', e);
  }

  // 若静默获取失败，才展示手动登录弹窗
  showLoginOverlay();
  const infoEl = document.getElementById('userInfo');
  const guestEl = document.getElementById('guestInfo');
  if (infoEl) infoEl.style.display = 'none';
  if (guestEl) guestEl.style.display = 'block';
}

function showAuthenticated(token, user) {
  hideLoginOverlay();
  const infoEl = document.getElementById('userInfo');
  const guestEl = document.getElementById('guestInfo');
  const userEl = document.getElementById('displayUser');
  if (infoEl) infoEl.style.display = 'flex';
  if (guestEl) guestEl.style.display = 'none';
  if (userEl) userEl.textContent = user;

  const urlParams = new URLSearchParams(window.location.search);
  const requestedCat = urlParams.get('cat');
  const requestedSub = urlParams.get('sub');
  const activeCat = requestedCat || (window.location.hash.includes('review') ? 'review' : (localStorage.getItem('quant_active_category') || 'alpha'));
  if (typeof window.switchCategory === 'function') {
    window.switchCategory(activeCat);
  }
  if (requestedSub) {
    if (activeCat === 'review' && typeof window.switchReviewSubTab === 'function') {
      window.switchReviewSubTab(requestedSub);
    } else if (typeof window.switchAlphaSubTab === 'function') {
      window.switchAlphaSubTab(requestedSub);
    }
  }
  const requestedRank = urlParams.get('rank');
  if (requestedRank && typeof window.switchWatchpoolRankType === 'function') {
    setTimeout(() => { window.switchWatchpoolRankType(requestedRank); }, 200);
  }
  if (urlParams.get('modal') === 'eastmoney' && typeof window.openEastMoneyModal === 'function') {
    setTimeout(window.openEastMoneyModal, 300);
  }
  if (urlParams.get('modal') === 'ai_chat' && typeof window.openAiChatDrawer === 'function') {
    setTimeout(window.openAiChatDrawer, 400);
  }
  const modalDate = urlParams.get('modal_date');
  if (modalDate && typeof window.openPaperSnapshotModal === 'function') {
    setTimeout(() => { window.openPaperSnapshotModal(modalDate); }, 600);
  }
  // 监听 hash 变化实时平滑切换
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash.includes('review') && typeof window.switchCategory === 'function') {
      window.switchCategory('review');
    } else if (typeof window.switchCategory === 'function') {
      window.switchCategory('alpha');
      if (typeof window.switchAlphaSubTab === 'function') {
        if (hash.includes('paper20k')) window.switchAlphaSubTab('paper20k');
        else if (hash.includes('backtest')) window.switchAlphaSubTab('backtest');
        else if (hash.includes('watchpool')) window.switchAlphaSubTab('watchpool');
        else if (hash.includes('decision')) window.switchAlphaSubTab('decision');
        else if (hash.includes('pos')) window.switchAlphaSubTab('pos');
      }
    }
  });

  // 立即极速渲染持仓与自选池 (仅在页面打开/强刷时首屏加载一次，后续完全由用户按需手动点击【刷新】触发)
  if (typeof window.refreshPortfolioData === 'function') {
    try { window.refreshPortfolioData(); } catch(e) { console.warn('initial refreshPortfolioData warn:', e); }
  }
}

// 页面脚本加载完毕执行自动登录保障（持仓数据统一由DOMContentLoaded/initPage有序加载）
(function() {
  autoEnsureLogin();
})();
document.addEventListener('DOMContentLoaded', () => {
  if (window.location.hash.includes('review') && typeof window.switchCategory === 'function') {
    window.switchCategory('review');
  }
});

// ==================== 统一 Element Plus 标准分页渲染工厂 (全系统保证尾页/首页严格禁用) ====================
function renderElementPlusPagination(options) {
  if (!options) return;
  const mountEl = typeof options.mount === 'string' ? document.querySelector(options.mount) : options.mount;
  if (!mountEl) return;

  const total = Math.max(0, parseInt(options.total) || 0);
  const pageSize = Math.max(1, parseInt(options.pageSize) || 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  let page = parseInt(options.page) || 1;
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  const pageSizes = options.pageSizes || [10, 20, 50];
  const onPageChange = options.onPageChange || '';
  const onSizeChange = options.onSizeChange || '';
  const totalText = (options.totalTemplate || '共 {total} 条').replace('{total}', total);

  const prevDisabled = (page <= 1) ? 'disabled' : '';
  const nextDisabled = (page >= totalPages || totalPages <= 1) ? 'disabled' : '';

  let html = `<div class="el-pagination is-background" style="display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap;gap:10px">`;

  // 左侧：总数统计 + 规格下拉选择器 (10 / 20 / 50)
  html += `<div style="display:flex;align-items:center;gap:12px">`;
  html += `  <span class="el-pagination__total" style="font-size:12.5px;color:var(--sys-text-sub, #606266)">${totalText}</span>`;
  if (onSizeChange) {
    html += `  <span class="el-pagination__sizes" style="display:inline-flex;align-items:center;gap:4px">`;
    html += `    <select class="el-input__inner" style="height:26px;font-size:11.5px;padding:0 6px;width:96px;background:var(--sys-input-bg, #ffffff);border:1px solid var(--sys-border, #dcdfe6);border-radius:4px;color:var(--sys-text-primary, #303133)" onchange="${onSizeChange}(this.value)">`;
    pageSizes.forEach(sz => {
      const isSel = (sz === pageSize) ? 'selected' : '';
      html += `      <option value="${sz}" ${isSel}>${sz} 条/页</option>`;
    });
    html += `    </select>`;
    html += `  </span>`;
  }
  html += `</div>`;

  // 右侧：上一页 + 经典 Pager 数字页码 + 下一页 + 前往指定页
  html += `<div style="display:flex;align-items:center;gap:6px">`;
  
  // 上一页
  html += `  <button type="button" class="btn-prev" ${prevDisabled} onclick="${onPageChange}(${page - 1})" title="上一页" style="${page <= 1 ? 'cursor:not-allowed;opacity:0.5' : ''}">`;
  html += `    <i class="ri-arrow-left-s-line"></i>`;
  html += `  </button>`;

  // 页码列表
  html += `  <ul class="el-pager" style="display:flex;list-style:none;margin:0;padding:0;gap:4px">`;
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) {
      const isActive = (p === page) ? 'is-active' : '';
      html += `    <li class="number ${isActive}" onclick="${onPageChange}(${p})">${p}</li>`;
    }
  } else {
    // 永远固定显示第 1 页
    html += `    <li class="number ${page === 1 ? 'is-active' : ''}" onclick="${onPageChange}(1)">1</li>`;
    // 前向省略号
    if (page > 4) {
      html += `    <li class="more btn-quickprev" onclick="${onPageChange}(${Math.max(1, page - 5)})" title="向前跳 5 页">···</li>`;
    }
    // 中间动态段
    let startP = Math.max(2, page - 2);
    let endP = Math.min(totalPages - 1, page + 2);
    if (page <= 4) { startP = 2; endP = 5; }
    if (page >= totalPages - 3) { startP = totalPages - 4; endP = totalPages - 1; }
    for (let p = startP; p <= endP; p++) {
      const isActive = (p === page) ? 'is-active' : '';
      html += `    <li class="number ${isActive}" onclick="${onPageChange}(${p})">${p}</li>`;
    }
    // 后向省略号
    if (page < totalPages - 3) {
      html += `    <li class="more btn-quicknext" onclick="${onPageChange}(${Math.min(totalPages, page + 5)})" title="向后跳 5 页">···</li>`;
    }
    // 永远固定显示最后 1 页
    html += `    <li class="number ${page === totalPages ? 'is-active' : ''}" onclick="${onPageChange}(${totalPages})">${totalPages}</li>`;
  }
  html += `  </ul>`;

  // 下一页 (尾页或单页严密禁用)
  html += `  <button type="button" class="btn-next" ${nextDisabled} onclick="${onPageChange}(${page + 1})" title="下一页" style="${(page >= totalPages || totalPages <= 1) ? 'cursor:not-allowed;opacity:0.5' : ''}">`;
  html += `    <i class="ri-arrow-right-s-line"></i>`;
  html += `  </button>`;

  // Jumper 前往第 X 页
  if (totalPages > 1) {
    html += `  <span class="el-pagination__jump" style="display:inline-flex;align-items:center;height:28px;line-height:28px;margin-left:8px;font-size:12.5px;color:var(--sys-text-sub, #606266)">`;
    html += `    前往 <input type="text" inputmode="numeric" class="el-pagination__editor" value="${page}" style="width:42px;height:28px;line-height:28px;text-align:center;border-radius:4px;border:1px solid var(--sys-border,#dcdfe6);margin:0 4px;padding:0;box-sizing:border-box;font-size:12.5px;color:var(--sys-text-primary, #303133);background:var(--sys-input-bg, #ffffff)" onkeydown="if(event.key==='Enter'){ const v=Math.min(${totalPages},Math.max(1,parseInt(this.value)||1)); ${onPageChange}(v); }" onblur="const v=Math.min(${totalPages},Math.max(1,parseInt(this.value)||1)); if(v !== ${page}) ${onPageChange}(v);" /> 页`;
    html += `  </span>`;
  }

  html += `</div>`;
  html += `</div>`;

  mountEl.innerHTML = html;
}
window.renderElementPlusPagination = renderElementPlusPagination;
