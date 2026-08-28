/* ==================== 基础工具与用户鉴权 (Utils & Auth Engine) ==================== */

// 🌟 全局 A 股红涨绿跌色彩引擎 (红涨 + / 绿跌 - / 灰平 0)
function getPnlColor(val) {
  const num = parseFloat(val) || 0;
  if (num > 0.00001) return '#f85149'; // 🔴 涨 / 盈利 / 正数 -> 红色
  if (num < -0.00001) return '#3fb950'; // 🟢 跌 / 亏损 / 负数 -> 绿色
  return '#8b949e';                    // ⚪ 平 / 0 -> 灰色
}
window.getPnlColor = getPnlColor;

// 0. 全局 HTML 转义安全助手
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;


// 1. 核心 Token 存取管理
function getToken() { 
  return localStorage.getItem('quant_token'); 
}

function setToken(token) { 
  if (token) localStorage.setItem('quant_token', token); 
}

function clearToken() { 
  localStorage.removeItem('quant_token'); 
  localStorage.removeItem('quant_user'); 
}


// 2. 登录浮层控制
function showLoginOverlay() { 
  const el = document.getElementById('loginOverlay');
  if (el) el.style.display = 'flex'; 
}

function hideLoginOverlay() { 
  const el = document.getElementById('loginOverlay');
  if (el) el.style.display = 'none'; 
}

function showLogin() { 
  const loginF = document.getElementById('loginForm');
  const regF = document.getElementById('registerForm');
  const errEl = document.getElementById('loginError');
  if (loginF) loginF.classList.remove('hidden'); 
  if (regF) regF.classList.add('hidden'); 
  if (errEl) errEl.textContent = ''; 
}

function showRegister() { 
  const loginF = document.getElementById('loginForm');
  const regF = document.getElementById('registerForm');
  const errEl = document.getElementById('registerError');
  if (loginF) loginF.classList.add('hidden'); 
  if (regF) regF.classList.remove('hidden'); 
  if (errEl) errEl.textContent = ''; 
}

// 3. 登录与注册核心流程 (绝对防御·一键秒登)
async function doLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmitBtn');
  
  let username = usernameInput ? usernameInput.value.trim() : '';
  let password = passwordInput ? passwordInput.value : '';

  if (!username) username = 'admin';
  if (!password) password = 'admin123';
  
  if (usernameInput) usernameInput.value = username;
  if (passwordInput) passwordInput.value = password;

  if (errorEl) {
    errorEl.style.color = '#58a6ff';
    errorEl.textContent = '正在连接服务器登录...';
  }
  if (submitBtn) { 
    submitBtn.disabled = true; 
    submitBtn.textContent = '登录中...'; 
  }

  try {
    const resp = await fetch('/auth/login', { 
      method: 'POST', 
      headers: {'Content-Type': 'application/json'}, 
      body: JSON.stringify({username, password}) 
    });
    
    const data = await resp.json();
    if (!resp.ok) { 
      if (errorEl) {
        errorEl.style.color = '#f85149';
        errorEl.textContent = data.detail || '用户名或密码错误'; 
      }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '登 录 系 统'; }
      return; 
    }
    
    // 写入 Token
    setToken(data.token);
    localStorage.setItem('quant_user', data.username);
    
    // 隐藏浮层与更新顶栏用户信息
    hideLoginOverlay();
    const infoEl = document.getElementById('userInfo');
    const guestEl = document.getElementById('guestInfo');
    const userEl = document.getElementById('displayUser');
    if (infoEl) infoEl.style.display = 'flex';
    if (guestEl) guestEl.style.display = 'none';
    if (userEl) userEl.textContent = data.username;
    
    if (typeof showToast === 'function') showToast(`欢迎回来，${data.username}！`, 'success');
    
    // 触发系统全模块初始化加载
    safeTriggerInit();
    
  } catch(err) { 
    if (errorEl) {
      errorEl.style.color = '#f85149';
      errorEl.textContent = '网络连接异常或服务未就绪，请检查服务状态'; 
    }
  } finally {
    if (submitBtn) { 
      submitBtn.disabled = false; 
      submitBtn.textContent = '登 录 系 统'; 
    }
  }
}


async function doRegister(e) {
  if (e && e.preventDefault) e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const password2 = document.getElementById('regPassword2').value;
  const errorEl = document.getElementById('registerError');

  if (!username || !password) { if (errorEl) errorEl.textContent = '请完整填写注册信息'; return; }
  if (password !== password2) { if (errorEl) errorEl.textContent = '两次输入的密码不一致'; return; }

  try {
    const resp = await fetch('/auth/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, password})
    });
    const data = await resp.json();
    if (!resp.ok) { if (errorEl) errorEl.textContent = data.detail || '注册失败'; return; }
    if (errorEl) { errorEl.style.color = '#3fb950'; errorEl.textContent = '注册成功，正在自动登录...'; }
    setTimeout(() => {
      document.getElementById('loginUsername').value = username;
      document.getElementById('loginPassword').value = password;
      showLogin();
      doLogin();
    }, 600);
  } catch(err) { 
    if (errorEl) errorEl.textContent = '网络错误'; 
  }
}

function doLogout() {
  clearToken();
  location.reload();
}

// ---------------- 👤 用户下拉菜单控制 ----------------
function toggleUserDropdown(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const menu = document.getElementById('userDropdownMenu');
  const arrow = document.getElementById('userDropdownArrow');
  if (!menu) return;

  if (menu.style.display === 'none' || !menu.style.display) {
    menu.style.display = 'flex';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  } else {
    menu.style.display = 'none';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  }
}

function closeUserDropdown() {
  const menu = document.getElementById('userDropdownMenu');
  const arrow = document.getElementById('userDropdownArrow');
  if (menu) menu.style.display = 'none';
  if (arrow) arrow.style.transform = 'rotate(0deg)';
}

// 点击外部区域自动收起用户下拉菜单
document.addEventListener('click', function(e) {
  const trigger = document.getElementById('userDropdownTrigger');
  const menu = document.getElementById('userDropdownMenu');
  if (menu && menu.style.display === 'flex') {
    if (trigger && !trigger.contains(e.target) && !menu.contains(e.target)) {
      closeUserDropdown();
    }
  }
});

// 4. 健壮的模块安全启动调度器
function safeTriggerInit() {
  const tasks = [
    { name: '策略与数据', fn: window.init },
    { name: '风控配置', fn: window.loadRiskConfig },
    { name: '通知配置', fn: window.loadNotifyConfig },
    { name: 'Alpha工作台', fn: window.initAlphaDesk },
    { name: '实盘持仓', fn: window.refreshPortfolioData },
    { name: '板块资金流', fn: window.loadSectorFlows },
    { name: '社交热度', fn: window.loadSocialBuzz },
    { name: '同步状态', fn: window.loadSyncStatus },
    { name: '智能体复盘中枢', fn: window.loadFullAgentDashboardData }
  ];


  tasks.forEach(t => {
    if (typeof t.fn === 'function') {
      try {
        t.fn();
      } catch (err) {
        console.warn(`[Init] ${t.name} 加载异常 (已安全隔离):`, err);
      }
    }
  });
}

// 5. 带全局 401 拦截恢复的网络请求
async function authFetch(url, options = {}) {
  const token = getToken();
  if (!options.headers) options.headers = {};
  if (token) options.headers['Authorization'] = 'Bearer ' + token;
  
  try {
    const resp = await fetch(url, options);
    if (resp.status === 401) {
      console.warn('登录已过期或未授权，自动唤起登录浮层');
      clearToken();
      showLoginOverlay();
      const guestEl = document.getElementById('guestInfo');
      const infoEl = document.getElementById('userInfo');
      if (guestEl) guestEl.style.display = 'block';
      if (infoEl) infoEl.style.display = 'none';
      throw new Error('认证过期，请重新登录');
    }
    return resp;
  } catch (err) {
    throw err;
  }
}

// 6. 全局 Toast 提示组件
function showToast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

// 7. 股票智能联想输入助手组件
function setupStockAutocomplete(inputEl, dropdownEl, onSelectCallback) {
  if (!inputEl || !dropdownEl) return;
  let debounceTimer = null;
  let currentFocus = -1;

  inputEl.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    const kw = this.value.trim();
    if (!kw) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const resp = await authFetch(`/api/search_stocks?q=${encodeURIComponent(kw)}`);
        const data = await resp.json();
        const results = data.results || [];
        if (results.length === 0) {
          dropdownEl.style.display = 'none';
          dropdownEl.innerHTML = '';
          return;
        }
        dropdownEl.innerHTML = results.map(item => `
          <div class="stock-search-item" data-symbol="${item.symbol}" data-name="${item.name}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--sys-border);display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:700;color:var(--sys-text-title)">${item.symbol}</span>
            <span style="color:var(--sys-text-primary)">${item.name}</span>
            <span style="font-size:11px;color:var(--sys-text-sub)">${item.industry || ''}</span>
          </div>
        `).join('');
        dropdownEl.style.display = 'block';

        dropdownEl.querySelectorAll('.stock-search-item').forEach(el => {
          el.addEventListener('click', function() {
            const sym = this.getAttribute('data-symbol');
            const nm = this.getAttribute('data-name');
            inputEl.value = sym;
            dropdownEl.style.display = 'none';
            if (onSelectCallback) {
              onSelectCallback({ symbol: sym, code: sym, name: nm }, nm);
            }
          });
        });
      } catch (e) {
        dropdownEl.style.display = 'none';
      }

    }, 200);
  });

  document.addEventListener('click', function(e) {
    if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
      dropdownEl.style.display = 'none';
    }
  });
}


/* ==================== 🤖 AI 首席量化操盘手 · 实时对话问答驱动 ==================== */
function openAiChatDrawer() {
  const backdrop = document.getElementById('aiChatDrawerBackdrop');
  const drawer = document.getElementById('aiChatDrawer');
  if (backdrop) backdrop.style.display = 'block';
  if (drawer) {
    drawer.style.display = 'flex';
    loadAiChatHistoryFromStorage();
    setTimeout(() => {
      const input = document.getElementById('aiChatInputText');
      if (input) input.focus();
    }, 100);
  }
}

function closeAiChatDrawer() {
  const backdrop = document.getElementById('aiChatDrawerBackdrop');
  const drawer = document.getElementById('aiChatDrawer');
  if (backdrop) backdrop.style.display = 'none';
  if (drawer) drawer.style.display = 'none';
}

function quickAskAi(questionText) {
  const input = document.getElementById('aiChatInputText');
  if (input) {
    input.value = questionText;
    sendAiChatMessage();
  }
}

// 全局炒股与量化术语大白话速查字典表 (用于 AI 对话点词成译)
const GLOSSARY_TERMS_MAP = {
  "均线多头排列": "【均线多头】5日>10日>20日均线向上发散，买入者普遍赚钱，处于主升浪上升通道。",
  "均线多头": "【均线多头】5日>10日>20日均线向上发散，买入者普遍赚钱，处于主升浪上升通道。",
  "放量突破平台": "【放量突破】成交量达到前5天均量的1.8倍以上，主力真金白银向上突破整理平台。",
  "放量突破": "【放量突破】成交量达到前5天均量的1.8倍以上，主力真金白银向上突破整理平台。",
  "缩量回踩企稳": "【缩量回踩】回踩关键支撑均线未破且成交量萎缩20%以上，主力洗盘结束企稳信号。",
  "缩量回踩": "【缩量回踩】回踩关键支撑均线未破且成交量萎缩20%以上，主力洗盘结束企稳信号。",
  "做 T": "【逢低做T+0】早盘急跌低吸相同股数，盘中冲高卖出原持仓，股数不变但赚了差价拉低持仓成本。",
  "做T": "【逢低做T+0】早盘急跌低吸相同股数，盘中冲高卖出原持仓，股数不变但赚了差价拉低持仓成本。",
  "1% 风险": "【单笔1%风控】任何一笔交易的最大亏损严格锁死在总资产的1%以内，绝不伤筋动骨。",
  "1%风险": "【单笔1%风控】任何一笔交易的最大亏损严格锁死在总资产的1%以内，绝不伤筋动骨。",
  "盈亏比": "【预期盈亏比】(目标止盈利润 ÷ 止损风险)，必须 ≥ 1.5:1 才能开仓做交易。",
  "移动止盈": "【移动止盈】股价上涨时不急着卖，以5日均线为防守底线，不跌破就一直拿住让利润奔跑。",
  "龙头首阴": "【龙头首阴】连板大妖股第一次收大阴线断板，主力未出逃，次日早盘急跌低吸抢反包胜率极高。",
  "弱转强": "【竞价弱转强】昨日走势较烂，今日09:25集合竞价突然爆量高开，主力资金逆市抢筹反转信号。",
  "中军标的": "【中军大容量】市值500亿以上、能容纳几十亿大机构资金的定海神针核心品种。",
};

// 高对比度、大字号 Markdown 解析器（集成术语点词成译大白话气泡，且同一段对话每个术语只标记第1次）
function formatMarkdownToHtml(md) {
  if (!md) return '';
  let html = md
    .replace(/^### (.*$)/gim, '<h4 style="margin:14px 0 8px 0;color:var(--sys-accent);font-size:16px;font-weight:700">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="margin:16px 0 10px 0;color:var(--sys-text-title);font-size:17.5px;font-weight:800">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<b style="color:var(--sys-text-title);font-weight:700">$1</b>')
    .replace(/^\s*-\s+(.*$)/gim, '<li style="margin:8px 0;color:var(--sys-text-primary);font-size:14.5px;line-height:1.7">$1</li>')
    .replace(/^\s*\d+\.\s+(.*$)/gim, '<li style="margin:8px 0;color:var(--sys-text-primary);font-size:14.5px;line-height:1.7">$1</li>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  // 🌟 术语精简标记：同一段对话里，每个核心术语仅在【首次出现】时标记问号与解释，杜绝重复满屏打标
  const taggedTerms = new Set();
  Object.keys(GLOSSARY_TERMS_MAP).forEach(term => {
    const tip = GLOSSARY_TERMS_MAP[term];
    // 构造单次匹配正则（非全局 /g，仅匹配第 1 次出现）
    const regex = new RegExp(`(?<!<[^>]*)(${term})(?![^<]*>)`);
    if (regex.test(html) && !taggedTerms.has(term)) {
      html = html.replace(regex, `<span class="term-tip" data-term="${term}" title="${tip}" onclick="showTermExplanationPopover(this, '${term}', event)">$1 <i class="ri-question-line" style="font-size:11px;opacity:0.85"></i></span>`);
      taggedTerms.add(term);
      if (term === '做T' || term === '做 T') {
        taggedTerms.add('做T');
        taggedTerms.add('做 T');
      }
    }
  });

  return html;
}

// 🌟 术语点击立即弹出大白话悬浮卡片 (Popover)
function showTermExplanationPopover(el, term, event) {
  if (event) event.stopPropagation();
  
  // 移除旧卡片
  const old = document.getElementById('termActivePopover');
  if (old) old.remove();

  const tip = GLOSSARY_TERMS_MAP[term] || GLOSSARY_TERMS_MAP[term.replace(/\s+/g, '')] || '核心量化实战术语';
  
  const popover = document.createElement('div');
  popover.id = 'termActivePopover';
  popover.className = 'term-popover-card';
  popover.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid var(--sys-border);padding-bottom:6px">
      <span style="font-weight:700;color:var(--sys-accent);font-size:14px">💡 术语通俗速查 · ${term}</span>
      <button style="background:none;border:none;color:var(--sys-text-sub);cursor:pointer;font-size:16px;padding:0 4px" onclick="document.getElementById('termActivePopover').remove()"><i class="ri-close-line"></i></button>
    </div>
    <div style="font-size:13px;line-height:1.65;color:var(--sys-text-primary);margin-bottom:10px">
      ${tip}
    </div>
    <div style="text-align:right">
      <button class="btn btn-blue" style="padding:4px 10px;font-size:11px;border-radius:6px" onclick="document.getElementById('termActivePopover').remove();openGlossaryModal();">
        <i class="ri-book-open-line"></i> 打开术语大字典
      </button>
    </div>
  `;

  document.body.appendChild(popover);

  const rect = el.getBoundingClientRect();
  popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  let leftPos = rect.left + window.scrollX - 40;
  if (leftPos + 330 > window.innerWidth) {
    leftPos = window.innerWidth - 340;
  }
  if (leftPos < 10) leftPos = 10;
  popover.style.left = leftPos + 'px';

  // 点击外部自动关闭
  setTimeout(() => {
    const handleOutsideClick = (e) => {
      if (!popover.contains(e.target) && e.target !== el) {
        popover.remove();
        document.removeEventListener('click', handleOutsideClick);
      }
    };
    document.addEventListener('click', handleOutsideClick);
  }, 10);
}



// ==================== 🤖 官方 Gemini 架构：AI 首席量化操盘顾问多会话与数据注入引擎 ====================
const GEMINI_SESSIONS_KEY = 'quant_gemini_sessions_v2';
const GEMINI_ACTIVE_ID_KEY = 'quant_gemini_active_id_v2';

function getGeminiSessions() {
  try {
    const data = localStorage.getItem(GEMINI_SESSIONS_KEY);
    let sessions = data ? JSON.parse(data) : [];
    if (!Array.isArray(sessions) || sessions.length === 0) {
      // 首次初始化默认创建一条欢迎会话，并尝试从旧记录迁移
      sessions = [createDefaultGeminiSession()];
      localStorage.setItem(GEMINI_SESSIONS_KEY, JSON.stringify(sessions));
    }
    return sessions;
  } catch (e) {
    return [createDefaultGeminiSession()];
  }
}

function saveGeminiSessions(sessions) {
  try {
    localStorage.setItem(GEMINI_SESSIONS_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('保存 Gemini 会话失败:', e);
  }
}

function createDefaultGeminiSession(title = '新研判会话') {
  const now = new Date();
  return {
    id: 'ses_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    title: title,
    createdAt: now.toLocaleString('zh-CN', { hour12: false }),
    updatedAt: now.toLocaleString('zh-CN', { hour12: false }),
    messages: [] // 🌟 干净空白，绝不塞入伪造的历史消息！
  };
}

function getActiveGeminiSessionId() {
  const activeId = localStorage.getItem(GEMINI_ACTIVE_ID_KEY);
  const sessions = getGeminiSessions();
  if (activeId && sessions.some(s => s.id === activeId)) {
    return activeId;
  }
  const firstId = sessions[0].id;
  localStorage.setItem(GEMINI_ACTIVE_ID_KEY, firstId);
  return firstId;
}

function createNewGeminiSession() {
  const sessions = getGeminiSessions();
  // 如果当前已有空白会话，直接切换过去，不重复创建
  const emptySes = sessions.find(s => s.messages && s.messages.length === 0);
  if (emptySes) {
    switchGeminiSession(emptySes.id);
    const input = document.getElementById('aiChatInputText');
    if (input) { input.value = ''; input.focus(); }
    showToast('已切换至新会话', 'info');
    return;
  }

  const newSes = createDefaultGeminiSession('新研判会话 ' + (sessions.length + 1));
  sessions.unshift(newSes);
  saveGeminiSessions(sessions);
  localStorage.setItem(GEMINI_ACTIVE_ID_KEY, newSes.id);
  renderGeminiSessionList();
  renderGeminiActiveMessages();
  const input = document.getElementById('aiChatInputText');
  if (input) {
    input.value = '';
    input.focus();
  }
  showToast('已新建研判会话！', 'info');
}

function switchGeminiSession(sessionId) {
  localStorage.setItem(GEMINI_ACTIVE_ID_KEY, sessionId);
  renderGeminiSessionList();
  renderGeminiActiveMessages();
}

function deleteGeminiSession(sessionId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!confirm('确定要删除此条研判会话吗？')) return;
  let sessions = getGeminiSessions().filter(s => s.id !== sessionId);
  if (sessions.length === 0) {
    sessions = [createDefaultGeminiSession('新研判会话 1')];
  }
  saveGeminiSessions(sessions);
  localStorage.setItem(GEMINI_ACTIVE_ID_KEY, sessions[0].id);
  renderGeminiSessionList();
  renderGeminiActiveMessages();
  showToast('已删除会话', 'info');
}

function renameGeminiSession(sessionId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const sessions = getGeminiSessions();
  const target = sessions.find(s => s.id === sessionId);
  if (!target) return;
  const newTitle = prompt('请输入会话新名称：', target.title);
  if (newTitle && newTitle.trim()) {
    target.title = newTitle.trim();
    saveGeminiSessions(sessions);
    renderGeminiSessionList();
    const titleEl = document.getElementById('geminiCurrentTitle');
    if (titleEl && getActiveGeminiSessionId() === sessionId) titleEl.textContent = target.title;
  }
}

function clearAllGeminiSessions() {
  if (!confirm('确定要清空全部的历史研判会话吗？')) return;
  const fresh = [createDefaultGeminiSession('新研判会话 1')];
  saveGeminiSessions(fresh);
  localStorage.setItem(GEMINI_ACTIVE_ID_KEY, fresh[0].id);
  renderGeminiSessionList();
  renderGeminiActiveMessages();
  showToast('已重置清空全部会话', 'info');
}

function toggleGeminiSidebar() {
  const sidebar = document.getElementById('geminiSidebar');
  if (!sidebar) return;
  if (sidebar.style.display === 'none') {
    sidebar.style.display = 'flex';
  } else {
    sidebar.style.display = 'none';
  }
}

function renderGeminiSessionList() {
  const listEl = document.getElementById('geminiSessionList');
  if (!listEl) return;
  const sessions = getGeminiSessions();
  const activeId = getActiveGeminiSessionId();

  listEl.innerHTML = sessions.map(ses => {
    const isActive = ses.id === activeId;
    const itemStyle = isActive 
      ? 'background:rgba(9,105,218,0.12);border:1.5px solid var(--sys-accent);color:var(--sys-accent);font-weight:700' 
      : 'background:var(--sys-bg-panel);border:1px solid var(--sys-border-subtle);color:var(--sys-text-primary)';
    return `
      <div onclick="switchGeminiSession('${ses.id}')" style="${itemStyle};border-radius:8px;padding:9px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:all 0.15s;margin-bottom:4px" 
           onmouseover="if(!${isActive}) this.style.borderColor='var(--sys-accent)'"
           onmouseout="if(!${isActive}) this.style.borderColor='var(--sys-border-subtle)'"
           title="${escapeHtml(ses.title)}">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;flex:1;display:flex;align-items:center;gap:6px">
          <i class="ri-message-3-line" style="color:${isActive ? 'var(--sys-accent)' : 'var(--sys-text-sub)'};font-size:13px"></i>
          <span style="color:${isActive ? 'var(--sys-accent)' : 'var(--sys-text-title)'}">${escapeHtml(ses.title)}</span>
        </div>
        <div style="display:flex;gap:6px;opacity:${isActive ? '1' : '0.6'};margin-left:6px">
          <span onclick="renameGeminiSession('${ses.id}', event)" title="重命名" style="cursor:pointer;font-size:13px;padding:1px 3px;color:var(--sys-text-sub)"><i class="ri-edit-line"></i></span>
          <span onclick="deleteGeminiSession('${ses.id}', event)" title="删除会话" style="cursor:pointer;font-size:13px;padding:1px 3px;color:#f85149"><i class="ri-delete-bin-line"></i></span>
        </div>
      </div>
    `;
  }).join('');


  const activeSes = sessions.find(s => s.id === activeId);
  const titleEl = document.getElementById('geminiCurrentTitle');
  if (titleEl && activeSes) {
    titleEl.textContent = activeSes.title;
  }
}

// 🌟 核心：Gemini 风格消息区渲染（空状态显示 Hero 欢迎大屏，有消息则显示气泡流）
function renderGeminiActiveMessages() {
  const list = document.getElementById('aiChatMessagesList');
  if (!list) return;
  const sessions = getGeminiSessions();
  const activeId = getActiveGeminiSessionId();
  const activeSes = sessions.find(s => s.id === activeId) || sessions[0];

  // 1. 如果该会话尚无任何问答，呈现官方 Gemini 经典的 Hero 欢迎卡片
  if (!activeSes || !activeSes.messages || activeSes.messages.length === 0) {
    list.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:360px;text-align:center;padding:20px 10px">
        <div style="font-size:42px;margin-bottom:12px;color:var(--sys-accent)"><i class="ri-sparkling-fill"></i></div>
        <h2 style="font-size:24px;font-weight:800;color:var(--sys-text-title);margin:0 0 10px 0">
          你好，今天想推演什么？
        </h2>
        <p style="font-size:13px;color:var(--sys-text-sub);max-width:520px;line-height:1.6;margin:0 0 24px 0">
          已实时联动您的 <b>实盘持仓（养殖ETF、中证证券、博纳影业、机器人）</b>、4层漏斗黄金观察池与 646 部经典名著战法大典
        </p>

        <!-- 4 张 Gemini 经典高质感 Prompt 建议卡片 -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;width:100%;max-width:680px;text-align:left">
          
          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:12px;padding:14px 16px;cursor:pointer;transition:all 0.2s" 
               onmouseover="this.style.borderColor='var(--sys-accent)';this.style.transform='translateY(-2px)'" 
               onmouseout="this.style.borderColor='var(--sys-border)';this.style.transform='none'"
               onclick="injectPortfolioDataToPrompt()">
            <div style="font-size:22px;margin-bottom:6px;color:var(--sys-accent)"><i class="ri-briefcase-4-line"></i></div>
            <div style="font-size:13px;font-weight:700;color:var(--sys-text-title);margin-bottom:4px">诊断实盘 4 只持仓</div>
            <div style="font-size:11px;color:var(--sys-text-sub)">一键注入当前持仓量价，测算明日做 T 与止盈防守线</div>
          </div>

          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:12px;padding:14px 16px;cursor:pointer;transition:all 0.2s" 
               onmouseover="this.style.borderColor='#10b981';this.style.transform='translateY(-2px)'" 
               onmouseout="this.style.borderColor='var(--sys-border)';this.style.transform='none'"
               onclick="quickAskAi('明天最看好哪几只放量突破黄金标的？请用大白话讲清楚理由！')">
            <div style="font-size:22px;margin-bottom:6px;color:#10b981"><i class="ri-focus-3-line"></i></div>
            <div style="font-size:13px;font-weight:700;color:var(--sys-text-title);margin-bottom:4px">明天推荐买什么标的？</div>
            <div style="font-size:11px;color:var(--sys-text-sub)">基于 4 层过滤与突破战法，精选确定性最强的龙头</div>
          </div>

          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:12px;padding:14px 16px;cursor:pointer;transition:all 0.2s" 
               onmouseover="this.style.borderColor='#8957e5';this.style.transform='translateY(-2px)'" 
               onmouseout="this.style.borderColor='var(--sys-border)';this.style.transform='none'"
               onclick="injectSectorFlowsToPrompt()">
            <div style="font-size:22px;margin-bottom:6px;color:#8957e5"><i class="ri-funds-line"></i></div>
            <div style="font-size:13px;font-weight:700;color:var(--sys-text-title);margin-bottom:4px">大盘板块主力资金流向</div>
            <div style="font-size:11px;color:var(--sys-text-sub)">一键注入主力抢筹 Top3 行业，研判主力抱团意图</div>
          </div>

          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:12px;padding:14px 16px;cursor:pointer;transition:all 0.2s" 
               onmouseover="this.style.borderColor='#f59e0b';this.style.transform='translateY(-2px)'" 
               onmouseout="this.style.borderColor='var(--sys-border)';this.style.transform='none'"
               onclick="quickAskAi('300308 中际旭创你看好吗？请用大白话测算支撑位与止损价')">
            <div style="font-size:22px;margin-bottom:6px;color:#f59e0b"><i class="ri-line-chart-line"></i></div>
            <div style="font-size:13px;font-weight:700;color:var(--sys-text-title);margin-bottom:4px">个股买卖点深度测算</div>
            <div style="font-size:11px;color:var(--sys-text-sub)">输入任意股票代码或名称，获取支撑位与硬核止损价</div>
          </div>

        </div>
      </div>
    `;
    return;
  }

  // 2. 如果有问答，呈现高对比度、清晰明亮的气泡消息流
  list.innerHTML = activeSes.messages.map(msg => {
    if (msg.role === 'user') {
      return `
        <div style="display:flex;gap:12px;align-items:flex-start;justify-content:flex-end">
          <div style="background:rgba(9,105,218,0.1);border:1px solid rgba(9,105,218,0.3);border-radius:12px;padding:12px 18px;font-size:14.5px;color:var(--sys-text-title);line-height:1.6;max-width:82%;font-weight:600">
            ${escapeHtml(msg.text)}
          </div>
          <div style="width:34px;height:34px;border-radius:8px;background:rgba(9,105,218,0.15);border:1px solid var(--sys-accent);display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--sys-accent);flex-shrink:0">
            <i class="ri-user-3-fill"></i>
          </div>
        </div>
      `;
    } else {
      return `
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#8957e5,#58a6ff);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0;box-shadow:0 2px 8px rgba(137,87,229,0.3)">
            <i class="ri-robot-2-fill"></i>
          </div>
          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:12px;padding:16px 22px;font-size:14.5px;color:var(--sys-text-primary);line-height:1.75;max-width:88%;box-shadow:var(--sys-shadow-card)">
            <div>${formatMarkdownToHtml(msg.text)}</div>
            <div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--sys-border-subtle);font-size:11px;color:var(--sys-text-sub);display:flex;justify-content:space-between;align-items:center">
              <span>🧠 ${msg.model || 'Qwen2.5 金融大模型'} · ${msg.time || ''}</span>
              <div style="display:flex;gap:8px">
                <button class="btn btn-outline" style="padding:2px 8px;font-size:10px;color:var(--sys-accent);border-color:var(--sys-border);display:flex;align-items:center;gap:4px" onclick="copyGeminiMessageText(this)">
                  <i class="ri-file-copy-line"></i>
                  <span>复制</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }).join('');



  list.scrollTop = list.scrollHeight;
}


function copyGeminiMessageText(btn) {
  const container = btn.closest('div[style*="background:#161b22"]');
  if (container) {
    const text = container.innerText.replace(/📋 复制.*/, '').trim();
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制完整研判内容！', 'success');
    });
  }
}

function exportCurrentSessionMarkdown() {
  const sessions = getGeminiSessions();
  const activeId = getActiveGeminiSessionId();
  const activeSes = sessions.find(s => s.id === activeId);
  if (!activeSes || !activeSes.messages) return;

  let md = `# 📜 AI 首席操盘顾问 · ${activeSes.title}\n\n`;
  md += `> 会话创建时间：${activeSes.createdAt} | 更新时间：${activeSes.updatedAt}\n\n---\n\n`;

  activeSes.messages.forEach(m => {
    if (m.role === 'user') {
      md += `### 👤 提问：\n\n${m.text}\n\n`;
    } else {
      md += `### 🤖 AI 研判结论 (${m.model || 'Qwen2.5'}):\n\n${m.text}\n\n---\n\n`;
    }
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `操盘研判_${activeSes.title.slice(0, 12)}_${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('已导出当前会话 Markdown 文件！', 'success');
}

// ---------------- 📎 核心数据注入器 (把真实实盘/资金流喂给大模型) ----------------
async function injectPortfolioDataToPrompt() {
  const input = document.getElementById('aiChatInputText');
  if (!input) return;

  let posList = [];
  try {
    const res = await authFetch('/api/portfolio/list');
    const data = await res.json();
    posList = data.positions || [];
  } catch (e) {
    posList = [];
  }

  if (posList.length === 0) {
    input.value = `请结合我的实盘账户总资产与风控指标，帮我制定一份明日高胜率建仓与防守策略！`;
  } else {
    const summaryStrs = posList.map(p => {
      const pnlRate = parseFloat(p.pnl_rate || 0);
      const sign = pnlRate >= 0 ? '+' : '';
      return `【${p.name} (${p.symbol})：持仓${p.shares}股, 成本¥${p.cost_price}, 现价¥${p.current_price}, 浮动盈亏${sign}${pnlRate.toFixed(2)}%】`;
    }).join('、');

    input.value = `请深度结合我当前最新的真实实盘持仓数据：${summaryStrs}。请逐只分析当前走势、明日盘中冲高做T减仓点位、回踩加仓支撑位与铁血防守止损线！`;
  }

  input.focus();
  showToast('✅ 已成功注入实盘持仓量价数据到提问框！', 'success');
}

async function injectSectorFlowsToPrompt() {
  const input = document.getElementById('aiChatInputText');
  if (!input) return;

  let flows = [];
  try {
    const res = await authFetch('/api/market/sector-flows?type=industry');
    const data = await res.json();
    flows = data.flows || data.data || [];
  } catch (e) {
    flows = [];
  }

  if (flows.length === 0) {
    input.value = `请分析当前全市场各大板块的主力资金抢筹动向，哪个核心题材持续性最强？`;
  } else {
    const top3 = flows.slice(0, 3).map(f => `【${f.sector_name}：今日涨跌${f.change_pct >= 0 ? '+' : ''}${f.change_pct}%, 主力净流入+${f.net_inflow_amount}亿, 领涨龙头${f.leader_stock_name}】`).join('、');
    input.value = `今日全市场主力资金净流入前列板块为：${top3}。请结合 646 部名著战法，分析主力资金抱团意图与次日龙头接力胜率！`;
  }

  input.focus();
  showToast('✅ 已成功注入大盘板块资金流向数据到提问框！', 'success');
}

// ---------------- 抽屉与快速提问驱动 ----------------
function openAiChatDrawer() {
  const backdrop = document.getElementById('aiChatDrawerBackdrop');
  const drawer = document.getElementById('aiChatDrawer');
  if (backdrop) backdrop.style.display = 'block';
  if (drawer) {
    drawer.style.display = 'flex';
    renderGeminiSessionList();
    renderGeminiActiveMessages();
    setTimeout(() => {
      const input = document.getElementById('aiChatInputText');
      if (input) input.focus();
    }, 100);
  }
}

function closeAiChatDrawer() {
  const backdrop = document.getElementById('aiChatDrawerBackdrop');
  const drawer = document.getElementById('aiChatDrawer');
  if (backdrop) backdrop.style.display = 'none';
  if (drawer) drawer.style.display = 'none';
}

function quickAskAi(questionText) {
  const input = document.getElementById('aiChatInputText');
  if (input) {
    input.value = questionText;
    sendAiChatMessage();
  }
}

// ==================== 🌟 全系统功能·大白话深度指南字典表 (通俗生动·保姆级实战步骤) ====================
const SYSTEM_FEATURE_GUIDES = {
  // 1. Alpha 系统
  "alpha_system": {
    title: "尾盘 14:45 买卖决策系统",
    badge: "实战选股操盘台",
    icon: "ri-time-line",
    summary: "专门在每天下午 14:45（离收盘还剩 15 分钟）从全市场 5200 多只股票中精准挑出“次日早盘冲高获利胜率极高”的实战选股系统。",
    why: "为什么要在 14:45 选股？早盘 9 点半主力经常拉高诱多骗散户追高，而到了 14:45 全天走势和量价形态已经板上钉钉，主力无法做假线！此时买入，次日早盘趁冲高即可锁定利润，持股时间短、资金不过夜受折磨！",
    steps: [
      "<b>① 14:45 点击扫描</b>：每天下午 14:45 打开本页面，点击右上角【立即全市场扫描选股】。",
      "<b>② 查看推荐标的</b>：在下方表格中看哪些股票被打上了绿色的【推荐买入】标签和高盈亏比指标。",
      "<b>③ 一键测算买卖点</b>：点击右侧【测算】，左侧会自动算出精确买入价、止损价与推荐买多少股，直接在您的券商 App 下单挂单！"
    ],
    tips: "💡 操盘口诀：尾盘选股不追高，次日冲高早落袋，跌破止损坚决跑，复利积累收益高！"
  },
  "alpha_rule_engine": {
    title: "选股规则过滤引擎配置",
    badge: "全自动严苛安检机",
    icon: "ri-filter-3-line",
    summary: "相当于一个严苛的选股“安检门”，只有同时满足均线多头、成交量放大、缩量洗盘企稳等硬指标的股票才能通关。",
    why: "市场上股票有 5200 多只，绝大多数都在震荡甚至下跌。这个引擎帮您把垃圾股、僵尸股和假突破全自动过滤掉，只保留形态最完美的真龙头！",
    steps: [
      "<b>① 默认推荐配置</b>：系统已为您开启【均线多头】+【放量突破平台】+【缩量回踩企稳】三大主力起涨形态。",
      "<b>② 按需调整参数</b>：如果您偏好更激进或更稳健的风格，可勾选或取消特定规则，调整突破倍数与回踩幅度。",
      "<b>③ 保存实时生效</b>：修改完成后点击【保存引擎配置】，后续的全市场扫描将立刻按新规则筛选！"
    ],
    tips: "💡 操盘口诀：规则越严，选出来的股票越少但越精准，宁可错过，绝不做无把握的杂毛票！"
  },
  "alpha_risk_calc": {
    title: "华尔街单笔 1% 风险倒算买卖点测算器",
    badge: "保命铁血算盘",
    icon: "ri-calculator-line",
    summary: "华尔街顶级对冲基金专用的风控利器，彻底解决您“不知道买多少股、万一跌了亏多少钱”的心中恐惧！",
    why: "普通散户买股票全凭感觉瞎买，跌了就死扛导致爆亏。本测算器根据您的【总账户本金】和【硬性止损价】，严格倒算出即使股票不幸跌破止损点，这笔交易亏损也绝对死死锁在总资金的 1% 以内（比如 10 万元本金最多只亏 1000 元），绝不伤筋动骨！",
    steps: [
      "<b>① 输入股票代码/名称</b>：输入如【300308】或【中际旭创】，下拉框智能联想点击即可。",
      "<b>② 点击智能测算</b>：系统自动获取现价，测算出最佳买入区间、硬性止损价、止盈目标价与推荐股数。",
      "<b>③ 券商 App 严格下单</b>：严格按照推荐的股数和买入价挂单，并在券商设置好条件单止损！"
    ],
    tips: "💡 操盘口诀：未思进先思退，单笔亏损锁死 1%，保住本金在，股市永远有翻倍机会！"
  },
  "alpha_dashboard": {
    title: "尾盘 14:45 选股操盘决策指令单",
    badge: "全市场选股成绩单",
    icon: "ri-table-line",
    summary: "展示全市场 5200+ 只股票经过 5 重严格量化过滤后，最终突围的黄金标的大表格与操盘指令单。",
    why: "不用自己一只只翻看股票走势图！表格里清晰列出了每只股票代码、名称、现价、买入区间、止损价、止盈目标价和预期盈亏比，所有操盘决策一目了然！",
    steps: [
      "<b>① 关注排序靠前的标的</b>：排在最上方的标的代表量化形态得分最高、主力净买入最坚决。",
      "<b>② 检查盈亏比</b>：优先选择预期盈亏比 ≥ 2.0:1 的品种（即潜在利润远大于潜在风险）。",
      "<b>③ 点击【测算】或【加入自选】</b>：一键将心仪标的转入测算器，或同步至东方财富实盘自选股！"
    ],
    tips: "💡 操盘口诀：看表格做交易，数字说话不带情绪，符合指令才出手，不符合坚决不碰！"
  },

  "trade_history": {
    title: "东方财富实盘交易历史成交流水",
    badge: "自动记账与交割单",
    icon: "ri-file-history-line",
    summary: "自动同步您在东方财富实盘账户里的每一笔买入、卖出和做 T 交易记录，分文不差自动归档。",
    why: "很多散户炒完股根本不知道自己是在几点买的、成本多少、手续费扣了多少。本流水看板自动记录每笔成交均价与发生金额，帮您清清楚楚复盘每一笔实盘交易！",
    steps: [
      "<b>① 自动静默同步</b>：手机 App 上买卖后，系统后台每 10 秒自动感知并记录在表格中。",
      "<b>② 查看买卖操作类型</b>：绿色代表买入建仓，红色代表高抛止盈或做 T 卖出。",
      "<b>③ 复盘买卖点</b>：结合当时的股票分时图，反思这笔买卖是否买在了急跌低吸点、卖在了冲高阻力位！"
    ],
    tips: "💡 操盘口诀：好记性不如烂笔头，笔笔交易留记录，常复盘才能常盈利！"
  },
  "watchlist": {
    title: "我的自选监控池",
    badge: "专属自选雷达",
    icon: "ri-star-line",
    summary: "您的专属自选股票备忘录与实时跟踪雷达，支持与东方财富实盘自选股双向秒级同步。",
    why: "将 4 层漏斗选出的优质好票、或者您长期跟踪的潜力品种加入自选池，盘中实时盯紧最新涨跌幅与异动，绝不错过主力起涨的买入信号！",
    steps: [
      "<b>① 输入股票代码或名称</b>：在输入框输入代码或拼音（如 300308 或 机器人），点击【加入自选】。",
      "<b>② 实时盯盘与测算</b>：点击表格中的操作按钮，可随时一键调用买卖点测算器或 AI 进行诊断。",
      "<b>③ 及时清理</b>：失去上涨逻辑或破位的股票，点击【删除】及时移出自选池，保持池子精炼纯净！"
    ],
    tips: "💡 操盘口诀：自选不在多而在精，只跟踪形态最美的主线龙头，机会来了果断出击！"
  },
  "sector_fund_flow": {
    title: "大盘与板块主力资金流动监控",
    badge: "主力热钱流向大屏",
    icon: "ri-funds-box-line",
    summary: "全天候毫秒级追踪全市场各大行业与题材概念板块的资金进出，实时洞察主力机构在抢筹哪个方向。",
    why: "股市炒作讲究‘跟着主力有肉吃’！大盘 5200 只股票不可能普涨，看清主力百亿资金今天到底是净流入券商、芯片还是机器人，跟着主力抱团主线，胜率提升一倍！",
    steps: [
      "<b>① 查看资金净流入排名</b>：排在最前面的板块代表主力真金白银净买入最多。",
      "<b>② 点击板块查看成分股</b>：点击任意板块直接穿透查看领涨龙头与主营业务看点。",
      "<b>③ 避开主力出逃板块</b>：净流出排行榜前列的板块坚决不要去抄底！"
    ],
    tips: "💡 操盘口诀：大资金进场板块涨，大资金出逃板块跌，盯紧资金流向不迷路！"
  },
  "review_main": {
    title: "首席操盘手 · 全局推演中枢",


    badge: "股市诸葛亮",
    icon: "ri-vip-crown-line",
    summary: "您的私人量化首席操盘总监，每天收盘后对全天 A 股市场的大盘走势、主力资金动向与次日机会进行深度复盘定调。",
    why: "散户常常“只看个股不看大盘”，结果大盘暴跌个股跟着遭殃。全局推演中枢帮您看清宏观大趋势与主力真实意图，明确告诉你明天是该【重拳出击】还是【防守观望】！",
    steps: [
      "<b>① 查看大盘核心定调</b>：看顶部卡片给出的【市场进攻评级】与【核心主线】。",
      "<b>② 研读主力动向</b>：了解今天主力机构是在抱团科技、新能源还是在流出避险。",
      "<b>③ 明确次日操盘总基调</b>：按总监定下的攻防节奏决定明天仓位大小！"
    ],
    tips: "💡 操盘口诀：顺势而为，大盘好时重仓干主线，大盘差时轻仓防守留现金！"
  },
  "review_risk": {
    title: "铁血风控总监 · 仓位压制中枢",
    badge: "安全带与刹车片",
    icon: "ri-shield-line",
    summary: "为您账户保驾护航的“风控刹车系统”，根据当前大盘风险系数与波动率，强制给出一套绝对安全的仓位上限。",
    why: "散户亏大钱的根源就是【盲目满仓】和【逆势加仓】。风控中枢实时监测市场回撤风险，行情差时强制建议压低仓位，留出充裕现金等待黄金坑！",
    steps: [
      "<b>① 查看总仓位建议</b>：看当前建议仓位是 3 成、5 成还是 7 成。",
      "<b>② 检查单票上限</b>：单只股票无论再看好，严禁超过 2~3 成，绝不满仓单吊一只股！",
      "<b>③ 保持流动性</b>：手里永远留有 3~4 成现金，一旦被套才能有底气做 T+0 自救！"
    ],
    tips: "💡 操盘口诀：仓位决定心态，心态决定成败，不盲目满仓是职业交易员第一铁律！"
  },
  "review_funnel": {
    title: "4 层漏斗黄金观察池",
    badge: "层层过筛黄金池",
    icon: "ri-filter-line",
    summary: "像选美比赛一样，从全市场股票中经过 4 道严苛关卡层层淘汰，最终筛选出最具爆发力的黄金龙头股！",
    why: "第 1 层筛日内冲高爆发力，第 2 层筛主力大单真金白银净流入，第 3 层筛活跃换手率，第 4 层一键排雷破位股！只有 4 层全部绿灯点亮的股票，才是万中无一的超级好票！",
    steps: [
      "<b>① 看 4 层指示灯</b>：观察表格中每只股票的 4 个绿色圆点是否全部点亮。",
      "<b>② 查看入池理由</b>：悬停查看为何该股票能通过 4 层考验（如特大单净买入超 1 亿、放量突破等）。",
      "<b>③ 纳入明日重点观察</b>：把 4 层全通关的股票加入自选，次日早盘重点捕捉买点！"
    ],
    tips: "💡 操盘口诀：真金不怕火炼，四层漏斗过筛，假突破无处遁形，真龙头脱颖而出！"
  },
  "review_agents": {
    title: "盘中 7 人小智能体协同定调与分时量价轨迹",
    badge: "顶级投研专家团",
    icon: "ri-team-line",
    summary: "由 7 位分别擅长宏观、技术、量价、游资情绪、做T、风控与排雷的 AI 专业分析师，针对每一只股票协同会诊！",
    why: "一个人看盘容易有盲点，7 人智能体团队从 7 个不同维度同时审视一只股票，主力是在洗盘还是在出货、是假拉升还是真突破，7 位专家各抒己见形成合力！",
    steps: [
      "<b>① 点击左侧任意股票</b>：右侧立刻呈现该股票的 7 人智能体会诊结论与分时量价轨迹图。",
      "<b>② 重点查看【做T分析师】与【排雷总监】</b>：了解支撑位、压力位与是否存在财务暗雷。",
      "<b>③ 综合定调做决策</b>：如果多位分析师一致看多，且风控亮绿灯，即可放心操作！"
    ],
    tips: "💡 操盘口诀：兼听则明，七人会诊把脉，看清主力底牌，不做糊涂交易！"
  },
  "review_portfolio": {
    title: "我的实盘持仓与买卖量化深度诊断",
    badge: "持仓体检与保姆级指南",
    icon: "ri-briefcase-4-line",
    summary: "专门针对您当前真实持有的实盘股票（如养殖ETF、中证证券、机器人PH、博纳影业）进行手把手体检与保姆级实操指导。",
    why: "解决散户持仓被套后不知所措的困境！系统直接给出通俗大白话建议：哪只票该拿、哪只票该在明天几点加仓买入多少股、下午反弹几点卖出赚差价（做T降成本）、哪只票破位必须坚决割肉！",
    steps: [
      "<b>① 逐只查看大白话定调</b>：看绿灯（盈利持有）、黄灯（被套做T自救）、红灯（破位割肉保命）。",
      "<b>② 严格执行做 T 步骤</b>：按照卡片里的具体价格和股数，早上低吸、下午高抛赚差价。",
      "<b>③ 设好止损防守线</b>：一旦收盘跌破防守价，不带幻想果断处理！"
    ],
    tips: "💡 操盘口诀：盈利股票让利润跑，被套股票做 T 降成本，破位杂毛坚决割，账户永远生机勃勃！"
  },
  "review_sectors": {
    title: "行业板块主力资金流向 Top 榜",
    badge: "主力热钱雷达",
    icon: "ri-funds-line",
    summary: "全天候毫秒级监控全市场 90 个行业板块，实时呈现主力百亿大资金到底在疯狂买入哪个行业、在抛售哪个行业。",
    why: "股市炒作永远是“板块轮动、板块抱团”。只要看准了主力资金今天净流入第一名是谁，跟着大机构买入该板块的前排领涨龙头，赚钱胜率提升一大半！",
    steps: [
      "<b>① 查看净流入 Top3 板块</b>：看哪些行业主力资金净流入超 10 亿、20 亿。",
      "<b>② 查看板块领涨龙头</b>：点击板块直接查看该行业内涨得最猛的核心成分股。",
      "<b>③ 规避净流出板块</b>：主力持续大笔出逃的行业坚决不碰，不接下落的飞刀！"
    ],
    tips: "💡 操盘口诀：跟着主力走，吃喝啥都有；逆着主力干，账户直冒汗！"
  },
  "review_social": {
    title: "全网同花顺/东财社交热度与游资情绪榜",
    badge: "散户与游资人气晴雨表",
    icon: "ri-fire-line",
    summary: "实时抓取同花顺热榜、东方财富股吧与游资龙虎榜数据，看千万股民当前讨论最火爆的超级妖股和人气核心。",
    why: "有热度的地方才有流动性，游资打板和散户合力最容易在人气榜前排诞生短线翻倍大牛股！但同时也能帮您识别主力“高位喊单诱多”的风险！",
    steps: [
      "<b>① 查看前排人气龙头</b>：关注热度持续攀升、且股价处于起涨初期的品种。",
      "<b>② 警惕高位加速滞涨</b>：如果一只股票热度第一但股价高位放量不涨，说明主力正在借助人气出货，切忌追高！",
      "<b>③ 结合 4 层漏斗印证</b>：人气榜股票必须通过 4 层漏斗排雷检验才可参与！"
    ],
    tips: "💡 操盘口诀：人气在低位是黄金，人气在高位是陷阱，辨别真伪跟主力！"
  },

  // 3. 量化回测系统
  "quant_engine": {
    title: "策略配置与回测参数引擎",
    badge: "量化时光机与模拟演习场",
    icon: "ri-line-chart-line",
    summary: "将您的炒股战法和规则放进过去 3 年的历史实盘行情中，让计算机自动模拟买卖几千次，用真实数据检验到底能不能赚钱！",
    why: "在真实实盘花真金白银亏损前，先用历史数据做演习！回测会精确算出年化收益率、胜率、最大回撤亏损，绝不靠主观臆想和运气炒股！",
    steps: [
      "<b>① 选择量化策略</b>：如选择【尾盘放量突破战法】或【均线多头趋势跟踪】。",
      "<b>② 设定测试参数</b>：设置初始本金、止损百分比（如 3.5%）和止盈目标（如 6%）。",
      "<b>③ 点击【启动历史回测】</b>：只需几秒钟，系统立刻绘制出过去 3 年的历史净值收益曲线！"
    ],
    tips: "💡 操盘口诀：实盘前先回测，数据不会说谎，经得起历史考验的策略才是常胜法宝！"
  },


  // 4. AI 对话与全域
  "ai_advisor": {
    title: "🤖 AI 首席操盘顾问工作台",
    badge: "24小时私人操盘导师",
    icon: "ri-robot-2-line",
    summary: "联动您的东方财富实盘持仓、4 层观察池与 646 部经典战法大典的顶级 AI 操盘智脑。",
    why: "遇到任何股票走势看不懂、不知道怎么做 T、想查某个量化指标，随时在右下角点击提问。AI 严格用老百姓听得懂的大白话作答，点词成译，手把手指导！",
    steps: [
      "<b>① 点击快捷数据注入</b>：如点击【注入实盘持仓数据】，AI 自动获取您的 4 只股票量价。",
      "<b>② 发送您的疑问</b>：如“300308 明天几点能买？”，AI 分三步直给结论与点位。",
      "<b>③ 点击术语看卡片</b>：对话中任何带下划线的词汇，点击即可原地弹出大白话解释卡片！"
    ],
    tips: "💡 操盘口诀：有不懂随时问，大白话讲明白，不打无准备之仗！"
  }
};

// ---------------- 🌟 全系统功能大白话深度指南弹窗控制 ----------------
function openFeatureGuideModal(featureKey) {
  const guide = SYSTEM_FEATURE_GUIDES[featureKey];
  if (!guide) {
    showToast('暂无该功能详细指南', 'info');
    return;
  }

  const modal = document.getElementById('featureGuideModal');
  const titleEl = document.getElementById('fgTitle');
  const badgeEl = document.getElementById('fgBadge');
  const iconEl = document.getElementById('fgIcon');
  const bodyEl = document.getElementById('fgBodyContent');

  if (titleEl) titleEl.textContent = guide.title;
  if (badgeEl) badgeEl.textContent = guide.badge;
  if (iconEl) iconEl.innerHTML = `<i class="${guide.icon || 'ri-lightbulb-flash-line'}"></i>`;

  if (bodyEl) {
    const stepsHtml = (guide.steps || []).map(s => `
      <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.6;color:var(--sys-text-primary)">
        ${s}
      </div>
    `).join('');

    bodyEl.innerHTML = `
      <!-- 1. 这是个啥功能？ -->
      <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid var(--sys-accent);border-radius:8px;padding:14px">
        <div style="font-weight:700;color:var(--sys-accent);font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <i class="ri-question-answer-line"></i> 📌 这是个啥功能？（一分钟听懂）
        </div>
        <div style="font-size:13.5px;line-height:1.65;color:var(--sys-text-primary)">
          ${guide.summary}
        </div>
      </div>

      <!-- 2. 它能帮我干啥？能解决什么操盘痛点？ -->
      <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #10b981;border-radius:8px;padding:14px">
        <div style="font-weight:700;color:#10b981;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <i class="ri-heart-pulse-line"></i> 🎯 它能帮我干啥？能解决什么痛点？
        </div>
        <div style="font-size:13.5px;line-height:1.65;color:var(--sys-text-primary)">
          ${guide.why}
        </div>
      </div>

      <!-- 3. 手把手保姆级实战用法 -->
      <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid #8957e5;border-radius:8px;padding:14px">
        <div style="font-weight:700;color:#8957e5;font-size:14px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <i class="ri-guide-line"></i> 🛠️ 老手是怎么用的？（手把手实战三步法）
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${stepsHtml}
        </div>
      </div>

      <!-- 4. 操盘避坑口诀 -->
      <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px 14px;font-size:13px;font-weight:600;color:#f59e0b;line-height:1.6">
        ${guide.tips || '💡 操盘铁律：保住本金第一，严格执行纪律，复利奔跑！'}
      </div>
    `;
  }

  if (modal) modal.style.display = 'flex';
}

function closeFeatureGuideModal() {
  const modal = document.getElementById('featureGuideModal');
  if (modal) modal.style.display = 'none';
}


// ---------------- 📖 术语大白话字典 ----------------
let _currentGlossaryCat = 'all';

function openGlossaryModal() {
  const modal = document.getElementById('glossaryModal');
  if (modal) {
    modal.style.display = 'flex';
    const input = document.getElementById('glossarySearchInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    filterGlossaryTerms();
  }
}

function closeGlossaryModal() {
  const modal = document.getElementById('glossaryModal');
  if (modal) modal.style.display = 'none';
}


function filterGlossaryCategory(cat, btnEl) {
  _currentGlossaryCat = cat;
  const container = document.getElementById('glossaryCategoryTabs');
  if (container) {
    container.querySelectorAll('button').forEach(b => {
      b.className = 'btn btn-outline';
    });
  }
  if (btnEl) btnEl.className = 'btn btn-blue';
  filterGlossaryTerms();
}

function filterGlossaryTerms() {
  const input = document.getElementById('glossarySearchInput');
  const kw = (input ? input.value : '').trim().toLowerCase();
  const items = document.querySelectorAll('.glossary-item');
  let visibleCount = 0;

  items.forEach(item => {
    const cat = item.getAttribute('data-cat') || '';
    const keywords = (item.getAttribute('data-keywords') || '').toLowerCase();
    const text = item.textContent.toLowerCase();

    const matchesCat = (_currentGlossaryCat === 'all' || cat === _currentGlossaryCat);
    const matchesKw = (!kw || keywords.includes(kw) || text.includes(kw));

    if (matchesCat && matchesKw) {
      item.style.display = 'block';
      visibleCount++;
    } else {
      item.style.display = 'none';
    }
  });

  const countLabel = document.getElementById('glossaryCountLabel');
  if (countLabel) {
    countLabel.textContent = `当前展示 ${visibleCount} / ${items.length} 个核心术语解释`;
  }
}


// ---------------- 🚀 发送消息与大模型推演核心流程 ----------------
async function sendAiChatMessage() {
  const input = document.getElementById('aiChatInputText');
  const sendBtn = document.getElementById('aiChatSendBtn');
  const list = document.getElementById('aiChatMessagesList');

  if (!input) return;
  const question = input.value.trim();
  if (!question) return;

  const sessions = getGeminiSessions();
  const activeId = getActiveGeminiSessionId();
  const currentSes = sessions.find(s => s.id === activeId) || sessions[0];

  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
  const userMsgId = 'u_' + Date.now();

  // 1. 追加用户消息
  currentSes.messages.push({
    id: userMsgId,
    role: 'user',
    text: question,
    time: timeStr
  });

  // 自动根据用户第一个实战问题精炼会话标题
  if (currentSes.messages.filter(m => m.role === 'user').length === 1 || currentSes.title.startsWith('新研判会话')) {
    currentSes.title = question.slice(0, 16) + (question.length > 16 ? '...' : '');
  }
  currentSes.updatedAt = now.toLocaleString('zh-CN', { hour12: false });

  saveGeminiSessions(sessions);
  renderGeminiSessionList();
  renderGeminiActiveMessages();
  input.value = '';

  // 2. 临时呈现 AI 思考中指示器
  const thinkingId = 'ai_thinking_' + Date.now();
  const thinkingHtml = `
    <div id="${thinkingId}" style="display:flex;gap:12px;align-items:flex-start">
      <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#8957e5,#58a6ff);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🤖</div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px 20px;font-size:14px;color:#8b949e;line-height:1.6;max-width:88%">
        <span class="spinner"></span> 正在联动您的实盘分时、4层漏斗核心池与大模型深度推演中...
      </div>
    </div>
  `;
  list.insertAdjacentHTML('beforeend', thinkingHtml);
  list.scrollTop = list.scrollHeight;

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span>思考中...</span>';
  }

  try {
    const res = await authFetch('/api/chat/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question })
    });

    if (!res || !res.ok) {
      throw new Error(res ? `模型服务响应异常 (HTTP ${res.status})` : '未能连接到本地 AI 服务');
    }

    const json = await res.json();
    const thinkEl = document.getElementById(thinkingId);
    if (thinkEl) thinkEl.remove();

    if (json.code === 200 && json.answer) {
      currentSes.messages.push({
        id: 'ai_' + Date.now(),
        role: 'assistant',
        text: json.answer,
        model: json.model || 'Qwen2.5 金融大模型',
        time: json.timestamp || timeStr
      });
      saveGeminiSessions(sessions);
      renderGeminiActiveMessages();
    } else {
      currentSes.messages.push({
        id: 'ai_' + Date.now(),
        role: 'assistant',
        text: `⚠️ 获取大模型推理失败: ${json.message || '模型连接超时'}`,
        model: '系统异常提示',
        time: timeStr
      });
      saveGeminiSessions(sessions);
      renderGeminiActiveMessages();
    }
  } catch (e) {
    const thinkEl = document.getElementById(thinkingId);
    if (thinkEl) thinkEl.remove();
    currentSes.messages.push({
      id: 'ai_' + Date.now(),
      role: 'assistant',
      text: `⚠️ 网络请求异常: ${e.message}`,
      model: '错误报告',
      time: timeStr
    });
    saveGeminiSessions(sessions);
    renderGeminiActiveMessages();
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>发送</span><span>🚀</span>';
    }
  }
}



// ==================== 📚 炒股知识库与战法大典弹窗控制 ====================
function openKnowledgeBaseModal() {
  const modal = document.getElementById('knowledgeBaseModal');
  if (modal) {
    modal.style.display = 'flex';
    switchKbTab('playbooks');
  }
}

function closeKnowledgeBaseModal() {
  const modal = document.getElementById('knowledgeBaseModal');
  if (modal) modal.style.display = 'none';
}

function switchKbTab(tab) {
  const btnPlaybooks = document.getElementById('kbTabPlaybooks');
  const btnBooks = document.getElementById('kbTabBooks');
  const pnlPlaybooks = document.getElementById('kbPanelPlaybooks');
  const pnlBooks = document.getElementById('kbPanelBooks');

  if (tab === 'playbooks') {
    if (btnPlaybooks) { btnPlaybooks.style.background = 'var(--sys-accent)'; btnPlaybooks.style.color = '#fff'; }
    if (btnBooks) { btnBooks.style.background = 'none'; btnBooks.style.color = 'var(--sys-text-sub)'; }
    if (pnlPlaybooks) pnlPlaybooks.style.display = 'grid';
    if (pnlBooks) pnlBooks.style.display = 'none';
  } else {
    if (btnBooks) { btnBooks.style.background = 'var(--sys-accent)'; btnBooks.style.color = '#fff'; }
    if (btnPlaybooks) { btnPlaybooks.style.background = 'none'; btnPlaybooks.style.color = 'var(--sys-text-sub)'; }
    if (pnlBooks) pnlBooks.style.display = 'flex';
    if (pnlPlaybooks) pnlPlaybooks.style.display = 'none';
  }
}

async function searchKbDocs() {
  const input = document.getElementById('kbSearchInput');
  const list = document.getElementById('kbSearchResultsList');
  if (!input || !list) return;

  const query = input.value.trim();
  if (!query) {
    showToast('请输入战法关键词 (如: 集合竞价, 一红定江山, 突破)', 'warning');
    return;
  }

  list.innerHTML = '<div style="text-align:center;color:var(--sys-text-sub);padding:30px 0">🔍 正在 40,474 条战法切片中精准检索...</div>';

  try {
    const res = await authFetch(`/api/chat/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: `请在知识库中检索并解释：${query}` })
    });
    const json = await res.json();
    if (json.code === 200 && json.answer) {
      list.innerHTML = `
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:8px;padding:16px;font-size:13px;line-height:1.7;color:var(--sys-text-primary)">
          ${formatMarkdownToHtml(json.answer)}
        </div>
      `;
    } else {
      list.innerHTML = `<div style="color:#f85149;padding:20px;text-align:center">检索失败: ${json.message || '无响应'}</div>`;
    }
  } catch (e) {
    list.innerHTML = `<div style="color:#f85149;padding:20px;text-align:center">检索异常: ${e.message}</div>`;
  }
}

// 显式挂载全部函数到全局 window 对象
window.getToken = getToken;
window.setToken = setToken;
window.clearToken = clearToken;
window.authFetch = authFetch;
window.showToast = showToast;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.doLogout = doLogout;
window.toggleUserDropdown = toggleUserDropdown;
window.closeUserDropdown = closeUserDropdown;
window.showLogin = showLogin;
window.showRegister = showRegister;
window.showLoginOverlay = showLoginOverlay;
window.hideLoginOverlay = hideLoginOverlay;
window.safeTriggerInit = safeTriggerInit;
window.setupStockAutocomplete = setupStockAutocomplete;


window.openAiChatDrawer = openAiChatDrawer;
window.closeAiChatDrawer = closeAiChatDrawer;
window.quickAskAi = quickAskAi;
window.sendAiChatMessage = sendAiChatMessage;
window.openGlossaryModal = openGlossaryModal;
window.closeGlossaryModal = closeGlossaryModal;
window.filterGlossaryCategory = filterGlossaryCategory;
window.filterGlossaryTerms = filterGlossaryTerms;
window.showTermExplanationPopover = showTermExplanationPopover;
window.openFeatureGuideModal = openFeatureGuideModal;
window.closeFeatureGuideModal = closeFeatureGuideModal;




window.createNewGeminiSession = createNewGeminiSession;
window.switchGeminiSession = switchGeminiSession;
window.deleteGeminiSession = deleteGeminiSession;
window.renameGeminiSession = renameGeminiSession;
window.clearAllGeminiSessions = clearAllGeminiSessions;
window.toggleGeminiSidebar = toggleGeminiSidebar;
window.copyGeminiMessageText = copyGeminiMessageText;
window.exportCurrentSessionMarkdown = exportCurrentSessionMarkdown;
window.injectPortfolioDataToPrompt = injectPortfolioDataToPrompt;
window.injectSectorFlowsToPrompt = injectSectorFlowsToPrompt;

window.openAiChatHistoryModal = openAiChatDrawer;
window.closeAiChatHistoryModal = closeAiChatDrawer;

window.openKnowledgeBaseModal = openKnowledgeBaseModal;
window.closeKnowledgeBaseModal = closeKnowledgeBaseModal;
window.switchKbTab = switchKbTab;
window.searchKbDocs = searchKbDocs;

// ==================== 🤖 AI 首席操盘顾问悬浮球：全屏自由拖拽与持久记忆引擎 ====================
function initDraggableAiFloatingTrigger() {
  const el = document.getElementById('aiChatFloatingTrigger');
  if (!el) return;

  // 1. 从 localStorage 恢复上次用户放置的位置
  try {
    const savedPos = localStorage.getItem('ai_floating_capsule_pos');
    if (savedPos) {
      const { left, top } = JSON.parse(savedPos);
      const maxLeft = window.innerWidth - el.offsetWidth - 10;
      const maxTop = window.innerHeight - el.offsetHeight - 10;
      const finalLeft = Math.max(10, Math.min(left, maxLeft));
      const finalTop = Math.max(10, Math.min(top, maxTop));
      el.style.left = `${finalLeft}px`;
      el.style.top = `${finalTop}px`;
      el.style.bottom = 'auto';
      el.style.right = 'auto';
    }
  } catch (e) {}

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let hasMoved = false;

  const onPointerDown = (e) => {
    if (e.type === 'mousedown' && e.button !== 0) return;

    isDragging = true;
    hasMoved = false;

    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    startX = clientX;
    startY = clientY;

    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    el.style.transition = 'none';
    el.style.cursor = 'grabbing';

    document.addEventListener('mousemove', onPointerMove, { passive: false });
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;

    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      hasMoved = true;
    }

    if (hasMoved) {
      if (e.cancelable) e.preventDefault();
      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // 边界限制 (防止拖出视口屏幕)
      const maxLeft = window.innerWidth - el.offsetWidth - 10;
      const maxTop = window.innerHeight - el.offsetHeight - 10;

      newLeft = Math.max(10, Math.min(newLeft, maxLeft));
      newTop = Math.max(10, Math.min(newTop, maxTop));

      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
      el.style.bottom = 'auto';
      el.style.right = 'auto';
    }
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    el.style.cursor = 'pointer';
    el.style.transition = 'transform 0.2s, box-shadow 0.2s';

    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);

    if (hasMoved) {
      // 记录拖动最终位置
      const rect = el.getBoundingClientRect();
      localStorage.setItem('ai_floating_capsule_pos', JSON.stringify({
        left: rect.left,
        top: rect.top
      }));
    }
  };

  // 绑定事件
  el.addEventListener('mousedown', onPointerDown);
  el.addEventListener('touchstart', onPointerDown, { passive: true });

  // 阻止拖拽时的原生 click 事件穿透
  el.addEventListener('click', (e) => {
    if (hasMoved) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

// 页面载入时自动初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDraggableAiFloatingTrigger);
} else {
  initDraggableAiFloatingTrigger();
}
window.initDraggableAiFloatingTrigger = initDraggableAiFloatingTrigger;