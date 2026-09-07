/* ==================== 全局启动与自动化轮询 (Main App Bootstrapper) ==================== */

async function autoEnsureLogin() {
  let token = getToken();
  let user = localStorage.getItem('quant_user');

  if (token && user) {
    showAuthenticated(token, user);
    return;
  }

  // 尝试使用本地默认开发者凭据静默获取真实有效 Token
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

  const savedCat = localStorage.getItem('quant_active_category') || 'alpha';
  if (typeof window.switchCategory === 'function') {
    window.switchCategory(savedCat);
  }

  // 立即极速渲染持仓与自选池
  if (typeof window.refreshPortfolioData === 'function') {
    try { window.refreshPortfolioData(); } catch(e) {}
  }

  // 定时器保活刷新
  setInterval(() => {
    if (typeof window.refreshPortfolioData === 'function') {
      try { window.refreshPortfolioData(); } catch(e) {}
    }
  }, 15000);

  setInterval(() => {
    if (typeof window.loadSectorFlows === 'function') {
      try { window.loadSectorFlows(); } catch(e) {}
    }
  }, 30000);
}

// 页面脚本加载完毕立即并发执行，无需等待任何其他阻塞请求
(function() {
  if (typeof window.refreshPortfolioData === 'function') {
    try { window.refreshPortfolioData(); } catch(e) {}
  }
  autoEnsureLogin();
})();