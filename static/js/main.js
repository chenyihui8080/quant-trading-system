/* ==================== 全局启动与自动化轮询 (Main App Bootstrapper) ==================== */

async function autoEnsureLogin() {
  let token = getToken();
  let user = localStorage.getItem('quant_user');

  // 如果本地没有 Token，自动发起默认账号登录 (admin / admin123) 彻底杜绝卡死
  if (!token || !user) {
    try {
      const resp = await fetch('/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'admin123'})
      });
      if (resp.ok) {
        const data = await resp.json();
        setToken(data.token);
        localStorage.setItem('quant_user', data.username);
        token = data.token;
        user = data.username;
      }
    } catch(e) {
      console.warn('自动免密登录网络波动，等待手动重试');
    }
  }

  const infoEl = document.getElementById('userInfo');
  const guestEl = document.getElementById('guestInfo');
  const userEl = document.getElementById('displayUser');

  if (token && user) {
    // 1. 成功进入主界面
    hideLoginOverlay();
    if (infoEl) infoEl.style.display = 'flex';
    if (guestEl) guestEl.style.display = 'none';
    if (userEl) userEl.textContent = user;

    // 2. 调度子模块安全初始化并激活用户上次离开时的系统与Tab (持久记忆)
    if (typeof safeTriggerInit === 'function') {
      safeTriggerInit();
    }
    const savedCat = localStorage.getItem('quant_active_category') || 'review';
    if (typeof window.switchCategory === 'function') {
      window.switchCategory(savedCat);
    }



    // 3. 启动全自动静默定时轮询
    setInterval(() => {
      if (typeof window.refreshPortfolioData === 'function' && getToken()) {
        try { window.refreshPortfolioData(); } catch(e) {}
      }
    }, 15000); // 15秒刷新持仓

    setInterval(() => {
      if (typeof window.loadSectorFlows === 'function' && getToken()) {
        try { window.loadSectorFlows(); } catch(e) {}
      }
    }, 30000); // 30秒刷新板块资金

    setInterval(() => {
      if (typeof window.loadSocialBuzz === 'function' && getToken()) {
        try { window.loadSocialBuzz(); } catch(e) {}
      }
    }, 60000); // 60秒刷新社交舆情

  } else {
    // 降级展示登录弹窗
    showLoginOverlay();
    if (infoEl) infoEl.style.display = 'none';
    if (guestEl) guestEl.style.display = 'block';
  }
}

// 自执行启动
(function() {
  autoEnsureLogin();
})();