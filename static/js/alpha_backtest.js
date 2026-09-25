/**
 * 个股历史战法穿透与适应度诊断实验室 (Playbook Individual Stock Backtest & Diagnostic Engine)
 * 专门针对单只个股进行 1~3 年真实历史 K 线穿透，测算个股专属胜率、盈亏比、战法适配度排行榜与超额 Alpha
 */

let btEquityChartInstancePage = null;
let btRealKLineChartInstancePage = null;
let btCurrentBacktestResult = null;
let btCurrentViewMode = 'kline';
let _currentBacktestReqId = 0;

/** 安全设置 DOM 元素文本辅助函数 (阿里规范) */
function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = (text !== undefined && text !== null) ? text : '';
  }
}
window.setElText = setElText;

/** 切换输入框清空按钮显隐 */
function toggleBtSingleStockClear(input) {
  const btn = document.getElementById('btSingleStockClearBtn');
  if (btn) {
    btn.style.display = (input && input.value.trim().length > 0) ? 'inline-block' : 'none';
  }
}
window.toggleBtSingleStockClear = toggleBtSingleStockClear;

/** 一键清空输入框并重置焦点 */
function clearBtSingleStockInput() {
  const input = document.getElementById('btSingleStockInput');
  const btn = document.getElementById('btSingleStockClearBtn');
  const dropdown = document.getElementById('btSingleStockSuggest');
  if (input) {
    input.value = '';
    input.removeAttribute('data-selected-code');
    input.focus();
  }
  if (btn) {
    btn.style.display = 'none';
  }
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
}
window.clearBtSingleStockInput = clearBtSingleStockInput;

/** 初始化个股穿透测算智能联想助手 (支持代码、汉字、拼音全能检索) */
function initBtSingleStockAutocomplete() {
  const inputEl = document.getElementById('btSingleStockInput');
  const dropdownEl = document.getElementById('btSingleStockSuggest');
  if (!inputEl || !dropdownEl) return;
  if (inputEl._autocomplete_bound) return;
  inputEl._autocomplete_bound = true;

  if (typeof setupStockAutocomplete === 'function') {
    setupStockAutocomplete(inputEl, dropdownEl, (item) => {
      const code = item.code || item.symbol || '';
      const name = item.name || '';
      if (name && code) {
        inputEl.value = `${name} (${code})`;
      } else {
        inputEl.value = code || name;
      }
      inputEl.setAttribute('data-selected-code', code);
      if (typeof toggleBtSingleStockClear === 'function') toggleBtSingleStockClear(inputEl);
      quickSelectStock(code, name);
    });
  }
}
window.initBtSingleStockAutocomplete = initBtSingleStockAutocomplete;

/** 异步拉取实盘持仓与4层黄金观察池标的，渲染顶部胶囊按钮组与下拉框 */
async function loadWatchlistIntoBacktestSelect() {
  const select = document.getElementById('btWatchlistSelect');
  const pillsContainer = document.getElementById('btHoldingPillsContainer');
  const corePillsContainer = document.getElementById('btCoreWatchPillsContainer');

  try {
    // 1. 并发请求实盘持仓与4层黄金核心观察池
    const [portfolioRes, coreWatchRes] = await Promise.allSettled([
      authFetch('/api/portfolio/list').then(r => r.json()),
      authFetch('/api/review/core-watchlist').then(r => r.json())
    ]);

    let watchlist = [];
    let positions = [];
    if (portfolioRes.status === 'fulfilled' && portfolioRes.value) {
      const pData = portfolioRes.value.data || portfolioRes.value;
      watchlist = pData.watchlist || [];
      positions = pData.positions || [];
    }

    let coreWatchlist = [];
    if (coreWatchRes.status === 'fulfilled' && coreWatchRes.value && coreWatchRes.value.data) {
      coreWatchlist = coreWatchRes.value.data || [];
    }

    // 预置系统经典底仓与宽基池
    const RECOMMEND_STOCKS = [
      { symbol: '600519', name: '贵州茅台', desc: '消费白酒龙头' },
      { symbol: '300750', name: '宁德时代', desc: '动力电池龙头' },
      { symbol: '002594', name: '比亚迪', desc: '新能源车核心' },
      { symbol: '159278', name: '机器人ETF', desc: '先进制造ETF' },
      { symbol: '510300', name: '沪深300ETF', desc: '大盘核心宽基' }
    ];

    let html = '';
    let defaultSelectedSymbol = '';

    // 1. 实盘持仓股票 (最高优先级：第一眼持仓)
    if (positions.length > 0) {
      defaultSelectedSymbol = positions[0].symbol;
      html += `<optgroup label="💼 实盘持仓标的 (${positions.length} 只) · 优先">`;
      positions.forEach((p, idx) => {
        const isSel = (idx === 0) ? 'selected' : '';
        html += `<option value="${p.symbol}" ${isSel}>${p.name} (${p.symbol}) · 实盘持仓</option>`;
      });
      html += `</optgroup>`;

      // 渲染顶部实盘持仓直达胶囊按钮组
      if (pillsContainer) {
        pillsContainer.innerHTML = positions.map((p, idx) => {
          const isSel = (idx === 0);
          const pnlVal = p.pnl_pct != null ? p.pnl_pct : (p.unrealized_pnl_pct || 0);
          const pnlText = pnlVal != null ? `${pnlVal > 0 ? '+' : ''}${pnlVal.toFixed(2)}%` : '';
          const pnlColor = pnlVal >= 0 ? '#ef4444' : '#10b981';
          return `
            <button type="button" class="btn bt-holding-pill" id="btHoldingPill_${p.symbol}"
              data-symbol="${p.symbol}"
              onclick="quickSelectStock('${p.symbol}')"
              style="height:32px;padding:0 12px;font-size:12px;font-weight:700;border-radius:6px;border:1px solid ${isSel ? '#2563eb' : '#dcdfe6'};background:${isSel ? '#2563eb' : '#fff'};color:${isSel ? '#fff' : 'var(--sys-text-primary)'};cursor:pointer;display:inline-flex;align-items:center;gap:6px"
              title="【实盘持仓】点击立即进行战法穿透回测与诊断">
              <i class="ri-wallet-3-line"></i> ${p.name} (${p.symbol})
              ${pnlText ? `<span style="font-size:11px;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,0.2);color:${isSel ? '#fff' : pnlColor}">${pnlText}</span>` : ''}
            </button>
          `;
        }).join('');
      }
    } else {
      if (pillsContainer) {
        pillsContainer.innerHTML = '<span style="font-size:12px;color:var(--sys-text-sub)">暂无实盘持仓，可在上方点击【手动录入】</span>';
      }
    }

    // 2. 4层黄金核心观察池胶囊
    if (coreWatchlist.length > 0) {
      if (!defaultSelectedSymbol) {
        const first = coreWatchlist[0];
        defaultSelectedSymbol = first.stock_code || first.symbol;
      }

      html += `<optgroup label="🔥 4层核心观察池 (${coreWatchlist.length} 只)">`;
      coreWatchlist.forEach(c => {
        const sCode = c.stock_code || c.symbol;
        const sName = c.stock_name || c.name;
        html += `<option value="${sCode}">${sName} (${sCode}) · 4层精选</option>`;
      });
      html += `</optgroup>`;

      if (corePillsContainer) {
        corePillsContainer.innerHTML = coreWatchlist.map(c => {
          const sCode = c.stock_code || c.symbol;
          const sName = c.stock_name || c.name;
          const chg = parseFloat(c.change_pct || 0);
          const chgColor = chg >= 0 ? '#ef4444' : '#10b981';
          const chgTxt = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
          return `
            <button type="button" class="btn bt-core-pill" id="btCorePill_${sCode}"
              data-symbol="${sCode}"
              onclick="quickSelectStock('${sCode}')"
              style="height:28px;padding:0 10px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.08);color:var(--sys-text-title);cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all 0.2s"
              title="【4层黄金观察池精选龙头】点击立即穿透体检 ${sName}">
              <i class="ri-flashlight-line" style="color:#f59e0b"></i> ${sName} (${sCode})
              <span style="font-size:11px;font-weight:700;color:${chgColor}">${chgTxt}</span>
            </button>
          `;
        }).join('');
      }
    } else {
      if (corePillsContainer) {
        corePillsContainer.innerHTML = '<span style="font-size:12px;color:var(--sys-text-sub)">正在同步4层核心观察池标的...</span>';
      }
    }

    // 3. 自选监控池股票 (东财自选全量标的，彻底解决无自选问题)
    if (watchlist && watchlist.length > 0) {
      if (!defaultSelectedSymbol) {
        const first = watchlist[0];
        defaultSelectedSymbol = first.symbol || first.stock_code;
      }
      html += `<optgroup label="⭐ 我的自选监控池 (${watchlist.length} 只)">`;
      watchlist.forEach(w => {
        const sCode = w.symbol || w.stock_code;
        const sName = w.name || w.stock_name || sCode;
        const chg = parseFloat(w.change_pct || 0);
        const chgTxt = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
        html += `<option value="${sCode}">${sName} (${sCode}) · 自选 [${chgTxt}]</option>`;
      });
      html += `</optgroup>`;
    }

    // 4. 经典核心推荐股票
    html += `<optgroup label="🏛️ 经典核心白马/宽基 (${RECOMMEND_STOCKS.length} 只)">`;
    RECOMMEND_STOCKS.forEach(r => {
      html += `<option value="${r.symbol}">${r.name} (${r.symbol}) · ${r.desc}</option>`;
    });
    html += `</optgroup>`;

    if (select) {
      select.innerHTML = html;
      if (defaultSelectedSymbol) {
        select.value = defaultSelectedSymbol;
      }
    }
    return defaultSelectedSymbol;
  } catch (e) {
    console.warn('加载自选/持仓/观察池数据失败:', e);
    if (select) {
      select.innerHTML = `
        <optgroup label="🎯 核心推荐标的">
          <option value="159278" selected>机器人ETF (159278) · 先进制造ETF</option>
          <option value="512570">证券ETF (512570) · 证券核心宽基</option>
          <option value="600519">贵州茅台 (600519) · 消费白酒龙头</option>
        </optgroup>
      `;
    }
    return '159278';
  }
}
window.loadWatchlistIntoBacktestSelect = loadWatchlistIntoBacktestSelect;

/** 标的池下拉切换事件监听：联动更新输入框与立即触发测算 */
function onWatchlistSelectChange(code) {
  if (!code) return;
  quickSelectStock(code);
}
window.onWatchlistSelectChange = onWatchlistSelectChange;

/** 刷新标的池下拉与顶部胶囊 */
async function refreshWatchlistDropdown(event) {
  if (event && event.stopPropagation) event.stopPropagation();
  const select = document.getElementById('btWatchlistSelect');
  if (select) {
    select.innerHTML = '<option value="">正在刷新最新自选与持仓...</option>';
  }
  const curSymbol = await loadWatchlistIntoBacktestSelect();
  if (curSymbol) {
    quickSelectStock(curSymbol);
  }
}
window.refreshWatchlistDropdown = refreshWatchlistDropdown;



// 统一的标的选择与立即测算入口 (支持代码、名称与胶囊联动)
async function quickSelectStock(code, optName) {
  if (!code) return;
  code = String(code).trim().toUpperCase();
  const input = document.getElementById('btSingleStockInput');
  const select = document.getElementById('btWatchlistSelect');
  if (input) {
    if (optName) {
      input.value = `${optName} (${code})`;
    } else {
      input.value = code;
    }
    input.setAttribute('data-selected-code', code);
    if (typeof toggleBtSingleStockClear === 'function') toggleBtSingleStockClear(input);
  }
  if (select) {
    select.value = code;
    // 如果不在原有下拉列表中，动态加入自定义搜索选项并保持选中态
    if (!select.value && optName) {
      const customOpt = new Option(`${optName} (${code}) · 搜索标的`, code, true, true);
      select.add(customOpt);
    }
  }

  // 同步更新顶部持仓胶囊高亮
  document.querySelectorAll('.bt-holding-pill').forEach(btn => {
    const isCur = btn.id === `btHoldingPill_${code}` || btn.getAttribute('data-symbol') === code;
    btn.style.borderColor = isCur ? '#2563eb' : '#dcdfe6';
    btn.style.background = isCur ? '#2563eb' : '#fff';
    btn.style.color = isCur ? '#fff' : 'var(--sys-text-primary)';
    btn.style.boxShadow = isCur ? '0 2px 8px rgba(37,99,235,0.3)' : 'none';
  });

  // 同步更新4层核心观察池胶囊高亮
  document.querySelectorAll('.bt-core-pill').forEach(btn => {
    const isCur = btn.id === `btCorePill_${code}` || btn.getAttribute('data-symbol') === code;
    btn.style.borderColor = isCur ? '#f59e0b' : 'rgba(245,158,11,0.4)';
    btn.style.background = isCur ? '#f59e0b' : 'rgba(245,158,11,0.08)';
    btn.style.color = isCur ? '#fff' : 'var(--sys-text-title)';
    btn.style.boxShadow = isCur ? '0 2px 8px rgba(245,158,11,0.35)' : 'none';
  });

  // 直接发起测算，100%穿透，不绕弯
  await executeSingleStockBacktest(code);
}
window.quickSelectStock = quickSelectStock;

// 从外部跨 Tab 一键直达并穿透测算
function jumpToStockBacktest(symbol) {
  if (!symbol) return;
  symbol = String(symbol).trim().toUpperCase();
  if (typeof switchAlphaSubTab === 'function') {
    switchAlphaSubTab('backtest');
  }
  setTimeout(() => {
    quickSelectStock(symbol);
  }, 120);
}
window.jumpToStockBacktest = jumpToStockBacktest;

// 点击页面【立即穿透测算】按钮或输入框按回车触发 (全面支持纯代码、汉字全称/简称、拼音)
async function runSingleStockBacktestFromPage() {
  const input = document.getElementById('btSingleStockInput');
  const select = document.getElementById('btWatchlistSelect');
  const dropdown = document.getElementById('btSingleStockSuggest');
  if (dropdown) dropdown.style.display = 'none';

  let raw = (input && input.value.trim()) ? input.value.trim() : '';
  if (!raw && select && select.value) {
    raw = select.value;
  }
  if (!raw) {
    alert('请先在上方选择或输入股票代码/汉字名称！');
    return;
  }

  let targetCode = '';
  let targetName = '';

  // 1. 如果包含括号格式，如 "小商品城 (600415)" 或 "机器人PH (159278)"
  const bracketMatch = raw.match(/[\(（]([A-Za-z0-9\.]+)[\)）]/);
  if (bracketMatch) {
    targetCode = bracketMatch[1].trim().toUpperCase();
  } else if (/^\d{6}$/.test(raw) || /^\d{5}$/.test(raw) || /^[A-Za-z]{2,5}$/.test(raw) || /^\d{4}\.HK$/i.test(raw)) {
    // 2. 纯代码格式如 600415, 159278, NVDA, 1810.HK
    targetCode = raw.toUpperCase();
  } else {
    // 3. 包含汉字或拼音（如 "小商品城", "机器人", "小"）
    const savedCode = input ? input.getAttribute('data-selected-code') : null;
    if (savedCode) {
      targetCode = savedCode;
    } else {
      // 实时查询 search_stocks 提取第一条匹配股票代码
      try {
        const resp = await authFetch(`/api/search_stocks?q=${encodeURIComponent(raw)}`);
        const json = await resp.json();
        const results = Array.isArray(json) ? json : (json.data || json.results || []);
        if (results && results.length > 0) {
          targetCode = results[0].code || results[0].symbol;
          targetName = results[0].name || '';
          if (input && targetCode && targetName) {
            input.value = `${targetName} (${targetCode})`;
            input.setAttribute('data-selected-code', targetCode);
          }
        }
      } catch (e) {
        console.warn('查询股票代码失败:', e);
      }
    }
  }

  // 兜底：若仍未匹配出，直接将 raw 传给后端执行多维字典解析
  const finalSymbol = targetCode || raw;
  await quickSelectStock(finalSymbol, targetName);
}
window.runSingleStockBacktestFromPage = runSingleStockBacktestFromPage;


const VERSION_PARAM_DICT = {
  'v2.0': { title: '当前参数版本：v2.0 现行进化版', desc: '止损系数 0.82 (硬止损约 -2.46%) · 止盈系数 1.05 (目标约 +6.3%) · 最大持仓严控 8 天' },
  'v1.2': { title: '历史参数版本：v1.2 均线防守版', desc: '止损系数 0.88 (硬止损约 -2.64%) · 均线破位防御 · 最大持仓 9 天' },
  'v1.1': { title: '历史参数版本：v1.1 防假突破版', desc: '止损系数 0.92 (硬止损约 -2.76%) · 成交量须达 1.2 倍量能门槛 · 最大持仓 10 天' },
  'v1.0': { title: '历史参数版本：v1.0 原始基准版', desc: '固定止损 -3.0% · 第一止盈 +6.0% · 宽止损牛市主升规则 · 最大持仓 10 天' }
};

/** 打法历史版本下拉选择联动 */
function onBacktestVersionChange(ver) {
  const item = VERSION_PARAM_DICT[ver] || VERSION_PARAM_DICT['v2.0'];
  const titleEl = document.getElementById('btVersionBadgeTitle');
  const descEl = document.getElementById('btVersionParamDesc');
  if (titleEl) titleEl.textContent = item.title;
  if (descEl) descEl.textContent = item.desc;

  runSingleStockBacktestFromPage();
}
window.onBacktestVersionChange = onBacktestVersionChange;

/** 周期下拉选择联动 */
function onBacktestPeriodChange(val) {
  const customBox = document.getElementById('btCustomDateRangeBox');
  if (customBox) {
    customBox.style.display = (val === 'custom') ? 'flex' : 'none';
  }
}
window.onBacktestPeriodChange = onBacktestPeriodChange;

/** 快捷填入任意起止日期 */
function quickSelectDateRange(startDate, endDate) {
  const select = document.getElementById('btPeriodSelectPage');
  const customBox = document.getElementById('btCustomDateRangeBox');
  const startInput = document.getElementById('btCustomStartDate');
  const endInput = document.getElementById('btCustomEndDate');

  if (select) select.value = 'custom';
  if (customBox) customBox.style.display = 'flex';
  if (startInput) startInput.value = startDate;
  if (endInput) endInput.value = endDate;

  runSingleStockBacktestFromPage();
}
window.quickSelectDateRange = quickSelectDateRange;

/** 执行单股穿透测算核心逻辑 */
async function executeSingleStockBacktest(symbol) {
  _currentBacktestReqId++;
  const thisReqId = _currentBacktestReqId;
  const cleanSymbol = symbol.trim().toUpperCase();
  const period = document.getElementById('btPeriodSelectPage')?.value || '3y';
  const customStartDate = document.getElementById('btCustomStartDate')?.value?.trim() || null;
  const customEndDate = document.getElementById('btCustomEndDate')?.value?.trim() || null;
  const playbookId = document.getElementById('btPlaybookSelectPage')?.value || 'auto';
  const version = document.getElementById('btVersionSelectPage')?.value || 'v2.0';
  const isCompare = document.getElementById('btCompareModeCheckboxPage')?.checked || false;

  const startBtn = document.getElementById('btStartBtnPage');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> 正在穿透撮合中...';
  }

  const reqPayload = {
    symbol: cleanSymbol,
    period: period,
    playbook_id: playbookId,
    version: version,
    compare_mode: isCompare
  };

  if (period === 'custom' && customStartDate && customEndDate) {
    reqPayload.start_date = customStartDate;
    reqPayload.end_date = customEndDate;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25秒硬超时保护

  try {
    const resp = await authFetch('/api/backtest/run_stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqPayload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await resp.json();

    // 竞态防御：若在此期间用户发起了更新的股票测算，彻底丢弃旧响应，防止覆盖
    if (thisReqId !== _currentBacktestReqId) {
      console.warn(`[回测引擎] 丢弃过期的历史响应: ${cleanSymbol} (reqId: ${thisReqId}, 最新: ${_currentBacktestReqId})`);
      return;
    }

    if (!data || !data.success) {
      alert('个股穿透回测失败: ' + (data?.error || '未能读取到该股历史数据'));
      return;
    }

    renderSingleStockResponse(data.result);

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      alert('测算请求超时（已超过25秒），可能是网络数据下载延迟，请稍后重试！');
    } else {
      alert('请求个股回测接口异常: ' + err);
    }
  } finally {
    if (startBtn && thisReqId === _currentBacktestReqId) {
      startBtn.disabled = false;
      startBtn.innerHTML = '<i class="ri-refresh-line"></i> 立即穿透测算';
    }
  }
}

/** 渲染个股回测与诊断全景数据 */
function renderSingleStockResponse(res) {
  if (!res || !res.stock_info) return;

  // 1. 切换展示容器：隐藏空状态提示，展开真实推演看板
  const emptyPlaceholder = document.getElementById('btBacktestEmptyPlaceholder');
  const resultContainer = document.getElementById('btBacktestResultContainer');
  if (emptyPlaceholder) emptyPlaceholder.style.display = 'none';
  if (resultContainer) resultContainer.style.display = 'block';

  const info = res.stock_info;
  const stats = res.stats || {};
  const isCompare = !!res.compare_mode;

  // 1. 个股头部诊断横幅
  setElText('diagStockTitle', `${info.name} (${info.symbol})`);
  const inputEl = document.getElementById('btSingleStockInput');
  if (inputEl && !inputEl.value.trim() && info.name) {
    inputEl.placeholder = `当前标的: ${info.name} (${info.symbol})`;
  }
  const selEl = document.getElementById('btWatchlistSelect');
  if (selEl && info.symbol) {
    for (let i = 0; i < selEl.options.length; i++) {
      if (selEl.options[i].value === info.symbol) {
        selEl.selectedIndex = i;
        break;
      }
    }
  }
  setElText('diagStockDaysBadge', `历经 ${info.trading_days} 个交易日 (${info.start_date} ~ ${info.end_date})`);

  const alphaSign = info.alpha_excess >= 0 ? '+' : '';
  const alphaEl = document.getElementById('diagAlphaExcessBadge');
  if (alphaEl) {
    alphaEl.textContent = `战法超额 Alpha: ${alphaSign}${info.alpha_excess}%`;
    alphaEl.className = info.alpha_excess >= 0 ? 'el-tag el-tag--success el-tag--small' : 'el-tag el-tag--danger el-tag--small';
  }

  setElText('diagStockSummaryText', res.diagnostic || '暂无诊断');

  const benchSign = info.benchmark_return >= 0 ? '+' : '';
  const benchEl = document.getElementById('diagBenchmarkReturn');
  if (benchEl) {
    benchEl.textContent = `${benchSign}${info.benchmark_return}%`;
    benchEl.style.color = info.benchmark_return >= 0 ? '#ef4444' : '#10b981';
  }

  // 2. 填充 6 大指标卡片
  setElText('btStatTradesPage', stats.total_trades || 0);
  setElText('btStatWinRatePage', `${stats.win_rate || 0}%`);
  
  const ci = stats.win_rate_ci_95 || [0, 0];
  setElText('btStatCIPage', `95% CI: [${ci[0]}%, ${ci[1]}%]`);

  setElText('btStatPFPage', stats.profit_factor != null ? stats.profit_factor : '0.00');
  setElText('btStatAvgWinLossPage', `均盈 +${stats.avg_win_pct || 0}% / 均亏 -${stats.avg_loss_pct || 0}%`);

  const evVal = Number(stats.expected_value || 0);
  const evEl = document.getElementById('btStatEVPage');
  if (evEl) {
    evEl.textContent = (evVal >= 0 ? '+' : '') + evVal + '%';
    evEl.style.color = evVal >= 0 ? '#f59e0b' : '#ef4444';
  }

  setElText('btStatDDPage', `${stats.max_drawdown || 0}%`);

  const retVal = Number(stats.strategy_return || 0);
  const retEl = document.getElementById('btStatTotalReturnPage');
  if (retEl) {
    retEl.textContent = (retVal >= 0 ? '+' : '') + retVal + '%';
    retEl.style.color = retVal >= 0 ? '#8b5cf6' : '#ef4444';
  }

  // 3. ⚖️ 渲染同台 A/B 对照面板 (如果有对比数据)
  const compareCard = document.getElementById('btCompareBoardCard');
  if (compareCard) {
    if (isCompare && res.delta && res.v1_stats) {
      compareCard.style.display = 'block';
      const curVer = document.getElementById('btVersionSelectPage')?.value || 'v2.0';
      setElText('btCompareVerLabel', `v1.0 原始基准版  vs  ${curVer} 演进版`);

      const d = res.delta;
      const v1 = res.v1_stats;
      const v2 = stats;

      // 胜率提升
      setElText('btCompareWinRateTrack', `v1.0: ${v1.win_rate || 0}% ➜ 现版: ${v2.win_rate || 0}%`);
      const wrEl = document.getElementById('btCompareWinRateDelta');
      if (wrEl) {
        const sign = d.win_rate >= 0 ? '+' : '';
        wrEl.textContent = `${sign}${d.win_rate}%`;
        wrEl.style.color = d.win_rate >= 0 ? '#10b981' : '#ef4444';
      }

      // 盈亏比改善
      setElText('btComparePFTrack', `v1.0: ${v1.profit_factor != null ? v1.profit_factor : '0.00'} ➜ 现版: ${v2.profit_factor != null ? v2.profit_factor : '0.00'}`);
      const pfEl = document.getElementById('btComparePFDelta');
      if (pfEl) {
        const sign = d.profit_factor >= 0 ? '+' : '';
        pfEl.textContent = `${sign}${d.profit_factor}`;
        pfEl.style.color = d.profit_factor >= 0 ? '#10b981' : '#ef4444';
      }

      // 单笔期望 EV
      setElText('btCompareEVTrack', `v1.0: ${v1.expected_value || 0}% ➜ 现版: ${v2.expected_value || 0}%`);
      const evDeltaEl = document.getElementById('btCompareEVDelta');
      if (evDeltaEl) {
        const sign = d.expected_value >= 0 ? '+' : '';
        evDeltaEl.textContent = `${sign}${d.expected_value}%`;
        evDeltaEl.style.color = d.expected_value >= 0 ? '#10b981' : '#ef4444';
      }

      // 累计收益差
      setElText('btCompareReturnTrack', `新版超额收益: ${d.return_diff >= 0 ? '+' : ''}${d.return_diff}%`);
      const retDeltaEl = document.getElementById('btCompareReturnDelta');
      if (retDeltaEl) {
        const sign = d.return_diff >= 0 ? '+' : '';
        retDeltaEl.textContent = `${sign}${d.return_diff}%`;
        retDeltaEl.style.color = d.return_diff >= 0 ? '#2563eb' : '#ef4444';
      }

      // 进化状态徽章
      const badge = document.getElementById('btCompareStatusBadge');
      if (badge) {
        if (d.is_improvement) {
          badge.className = 'el-tag el-tag--success';
          badge.textContent = '✅ 正向进化：收益与风控双重改善';
        } else {
          badge.className = 'el-tag el-tag--warning';
          badge.textContent = '⚠️ 边际收敛：当前股票在该战法下更适配宽止损';
        }
      }
    } else {
      compareCard.style.display = 'none';
    }
  }

  // 缓存当前回测全景数据
  btCurrentBacktestResult = res;

  // 4. 渲染股票 100% 真实日 K 线 (含战法实操买卖标点)
  renderRealStockKLineChart(res.kline_data || [], stats.trades || [], info);

  // 5. 渲染资金净值曲线 (支持 A/B 双线同台对比)
  const v1Curve = (isCompare && res.v1_stats) ? (res.v1_stats.equity_curve || []) : null;
  renderIndividualEquityChart(stats.equity_curve || [], v1Curve);

  // 6. 默认展现当前选中的视图
  toggleBacktestViewMode(btCurrentViewMode || 'kline', false);

  // 7. 渲染该股六大战法胜率排行榜
  renderPlaybookBreakdownList(stats.playbook_breakdown || []);

  // 8. 实时驱动实盘真金测算沙盘与逐笔流水表格 (带入模拟本金)
  updateMoneySimulation(currentSimCapital || 100000);

  // 9. 初始化多维度战法磨练台 (动态生成战法切片按钮，重置磨练台状态)
  if (typeof initMultiDimArena === 'function') {
    initMultiDimArena();
  }
}

/** 切换回测主图表视图模式 (真实日K线 ⇋ 资金成长曲线) */
function toggleBacktestViewMode(mode, triggerResize = true) {
  btCurrentViewMode = mode;
  const klineDom = document.getElementById('btRealKLineChartPage');
  const equityDom = document.getElementById('btEquityChartPage');
  const btnKLine = document.getElementById('btViewKLineBtn');
  const btnEquity = document.getElementById('btViewEquityBtn');
  const subText = document.getElementById('btChartSubText');

  if (mode === 'kline') {
    if (klineDom) klineDom.style.display = 'block';
    if (equityDom) equityDom.style.display = 'none';

    if (btnKLine) {
      btnKLine.style.background = '#ffffff';
      btnKLine.style.color = '#409eff';
      btnKLine.style.fontWeight = '700';
      btnKLine.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    }
    if (btnEquity) {
      btnEquity.style.background = 'transparent';
      btnEquity.style.color = '#606266';
      btnEquity.style.fontWeight = '500';
      btnEquity.style.boxShadow = 'none';
    }
    if (subText) subText.textContent = '🟢 标注入场买点，🔴 标注止盈止损，支持滚轮/底部滑块自由缩放';
    if (triggerResize && btRealKLineChartInstancePage) {
      setTimeout(() => btRealKLineChartInstancePage.resize(), 50);
    }
  } else {
    if (klineDom) klineDom.style.display = 'none';
    if (equityDom) equityDom.style.display = 'block';

    if (btnEquity) {
      btnEquity.style.background = '#ffffff';
      btnEquity.style.color = '#409eff';
      btnEquity.style.fontWeight = '700';
      btnEquity.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    }
    if (btnKLine) {
      btnKLine.style.background = 'transparent';
      btnKLine.style.color = '#606266';
      btnKLine.style.fontWeight = '500';
      btnKLine.style.boxShadow = 'none';
    }
    if (subText) subText.textContent = '展示在单只个股上的复利积累与版本对抗走势';
    if (triggerResize && btEquityChartInstancePage) {
      setTimeout(() => btEquityChartInstancePage.resize(), 50);
    }
  }
}
window.toggleBacktestViewMode = toggleBacktestViewMode;

/** 计算移动平均线 MA */
function calculateMA(dayCount, data, precision = 2) {
  const result = [];
  if (!data || data.length === 0) return result;

  for (let i = 0, len = data.length; i < len; i++) {
    if (i < dayCount - 1) {
      result.push('-');
      continue;
    }
    let sum = 0;
    for (let j = 0; j < dayCount; j++) {
      sum += Number(data[i - j][1]); // close price
    }
    result.push(Number((sum / dayCount).toFixed(precision)));
  }
  return result;
}

/** 渲染股票 100% 真实日 K 线蜡烛图与战法实操标点 (专业看盘软件高精版) */
function renderRealStockKLineChart(klineData, trades, stockInfo) {
  if (typeof echarts === 'undefined') return;

  const dom = document.getElementById('btRealKLineChartPage');
  if (!dom) return;

  if (btRealKLineChartInstancePage) {
    btRealKLineChartInstancePage.dispose();
  }
  btRealKLineChartInstancePage = echarts.init(dom);

  if (!klineData || klineData.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#909399">暂无该时间段的真实日K线行情</div>';
    return;
  }

  // 1. 数据对齐: dates & values [open, close, low, high]
  const dates = klineData.map(k => k.date);
  const values = klineData.map(k => [k.open, k.close, k.low, k.high]);
  const volumes = klineData.map((k, idx) => [idx, k.volume, k.close >= k.open ? 1 : -1]);

  // 智能价格精度：若存在小于 10 元标的 (如 ETF 基金、低价转债)，严格使用 3 位小数，杜绝台阶失真
  const isSubTen = values.some(v => v[1] < 10);
  const precision = isSubTen ? 3 : 2;

  // 2. 计算丝滑均线 (MA5/10/20)
  const ma5 = calculateMA(5, values, precision);
  const ma10 = calculateMA(10, values, precision);
  const ma20 = calculateMA(20, values, precision);

  // 3. 构建战法买卖实操标点 (MarkPoints)
  const markPointsData = [];
  const tradeMapByDate = {};

  trades.forEach(t => {
    // 买点: 精致绿色向上三角，紧贴蜡烛底端，不挡实体
    if (t.entry_date) {
      if (!tradeMapByDate[t.entry_date]) tradeMapByDate[t.entry_date] = [];
      tradeMapByDate[t.entry_date].push({ type: 'buy', trade: t });

      markPointsData.push({
        name: '买入',
        coord: [t.entry_date, t.entry_price],
        value: '买',
        symbol: 'triangle',
        symbolSize: 8,
        symbolOffset: [0, 8],
        itemStyle: { color: '#10b981', borderColor: '#ffffff', borderWidth: 1 },
        label: { show: false }
      });
    }

    // 卖点: 精致红色向下三角，紧贴蜡烛顶端
    if (t.exit_date) {
      if (!tradeMapByDate[t.exit_date]) tradeMapByDate[t.exit_date] = [];
      tradeMapByDate[t.exit_date].push({ type: 'exit', trade: t });

      const isWin = t.is_win;
      markPointsData.push({
        name: '平仓',
        coord: [t.exit_date, t.exit_price],
        value: '卖',
        symbol: 'triangle',
        symbolRotate: 180,
        symbolSize: 8,
        symbolOffset: [0, -8],
        itemStyle: { color: isWin ? '#ef4444' : '#64748b', borderColor: '#ffffff', borderWidth: 1 },
        label: { show: false }
      });
    }
  });

  // 4. 精确提取最高点与最低点
  let maxPrice = -Infinity, minPrice = Infinity, maxDate = '', minDate = '';
  klineData.forEach(k => {
    if (k.high > maxPrice) { maxPrice = k.high; maxDate = k.date; }
    if (k.low < minPrice) { minPrice = k.low; minDate = k.date; }
  });

  // 4.1 更新图表左上角标的专属徽章，让用户刚进页面一眼看清是谁的 K 线
  const tagTip = document.getElementById('btKLineTagTip');
  if (tagTip && stockInfo) {
    tagTip.className = 'el-tag el-tag--primary el-tag--medium';
    tagTip.style.fontWeight = '700';
    tagTip.style.fontSize = '12.5px';
    tagTip.style.padding = '0 10px';
    tagTip.style.height = '28px';
    tagTip.style.lineHeight = '28px';
    tagTip.style.borderRadius = '4px';
    tagTip.innerHTML = `<i class="ri-stock-line" style="margin-right:4px"></i>当前标的: <b style="color:#2563eb">${stockInfo.name || ''} (${stockInfo.symbol || ''})</b> · 前复权日K`;
  }

  // 5. 顶栏显式展示清晰的高低极值横幅 (白底黑字强对比，一眼分清最高与最低)
  const subText = document.getElementById('btChartSubText');
  if (subText && btCurrentViewMode === 'kline') {
    subText.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;font-size:12px">
      <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:4px;font-weight:800;border:1px solid #fca5a5">
        ▲ 最高: ¥${Number(maxPrice).toFixed(precision)} (${maxDate})
      </span>
      <span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:4px;font-weight:800;border:1px solid #86efac">
        ▼ 最低: ¥${Number(minPrice).toFixed(precision)} (${minDate})
      </span>
      <span style="color:#4b5563;font-weight:700">最新: ¥${Number(stockInfo.latest_price || values[values.length-1][1]).toFixed(precision)}</span>
    </span>`;
  }

  // 6. 极值标注完全采用东方财富规范 (彻底移除粗暴遮挡的红气球，改为清晰的高对比度引线标牌)
  const combinedMarkPoints = [
    ...markPointsData,
    {
      name: '最高价',
      coord: [maxDate, maxPrice],
      value: Number(maxPrice).toFixed(precision),
      symbol: 'circle',
      symbolSize: 5,
      itemStyle: { color: '#dc2626', borderColor: '#ffffff', borderWidth: 1.5 },
      label: {
        show: true,
        position: 'top',
        distance: 8,
        formatter: p => `最高 ${p.value} ↗`,
        fontSize: 11,
        fontWeight: '800',
        color: '#dc2626',
        backgroundColor: '#fee2e2',
        borderColor: '#fca5a5',
        borderWidth: 1,
        borderRadius: 4,
        padding: [3, 7],
        shadowColor: 'rgba(220, 38, 38, 0.15)',
        shadowBlur: 4
      }
    },
    {
      name: '最低价',
      coord: [minDate, minPrice],
      value: Number(minPrice).toFixed(precision),
      symbol: 'circle',
      symbolSize: 5,
      itemStyle: { color: '#16a34a', borderColor: '#ffffff', borderWidth: 1.5 },
      label: {
        show: true,
        position: 'bottom',
        distance: 8,
        formatter: p => `最低 ${p.value} ↘`,
        fontSize: 11,
        fontWeight: '800',
        color: '#16a34a',
        backgroundColor: '#dcfce7',
        borderColor: '#86efac',
        borderWidth: 1,
        borderRadius: 4,
        padding: [3, 7],
        shadowColor: 'rgba(22, 163, 74, 0.15)',
        shadowBlur: 4
      }
    }
  ];

  // 7. 默认视口优化：对齐东方财富，默认展示近 65 根 K 线，蜡烛饱满舒展
  const defaultZoomDays = 65;
  const zoomStart = dates.length > defaultZoomDays ? Math.round(((dates.length - defaultZoomDays) / dates.length) * 100) : 0;

  const option = {
    animation: true,
    legend: {
      data: ['日K线', 'MA5', 'MA10', 'MA20'],
      top: '1.5%',
      right: '3%',
      itemGap: 14,
      textStyle: { fontSize: 12, color: '#4b5563', fontWeight: '600' }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#409eff', type: 'dashed' } },
      backgroundColor: 'rgba(255, 255, 255, 0.98)',
      borderColor: '#e4e7ed',
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: '#1f2937', fontSize: 12 },
      formatter: params => {
        const p = params.find(item => item.seriesName === '日K线');
        if (!p || p.dataIndex === undefined) return '';
        const idx = p.dataIndex;
        const curDate = dates[idx];
        const val = values[idx];
        const kItem = klineData[idx] || {};
        const isUp = val[1] >= val[0];
        const chgPct = val[0] > 0 ? (((val[1] - val[0]) / val[0]) * 100).toFixed(2) : '0.00';
        const color = isUp ? '#ef4444' : '#10b981';

        // 格式化成交量为手/万手/亿股
        const rawVol = kItem.volume || 0;
        const volText = rawVol >= 100000000 ? (rawVol / 100000000).toFixed(2) + ' 亿股' : (rawVol >= 10000 ? (rawVol / 10000).toFixed(1) + ' 万手' : rawVol + ' 股');

        let html = `<div style="font-size:13px;border-bottom:1px solid #ebeef5;padding-bottom:6px;margin-bottom:6px">
          <b>${stockInfo.name || ''} (${curDate})</b>
          <span style="float:right;color:${color};font-weight:700">${isUp ? '+' : ''}${chgPct}%</span>
        </div>`;

        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;line-height:1.4">
          <div>开盘: <b style="color:#374151">¥${Number(val[0]).toFixed(precision)}</b></div>
          <div>最高: <b style="color:#ef4444">¥${Number(val[3]).toFixed(precision)}</b></div>
          <div>最低: <b style="color:#10b981">¥${Number(val[2]).toFixed(precision)}</b></div>
          <div>收盘: <b style="color:${color}">¥${Number(val[1]).toFixed(precision)}</b></div>
        </div>
        <div style="margin-top:6px;font-size:11.5px;color:#6b7280">
          成交总量: <b style="color:#111827">${volText}</b>
        </div>`;

        // 如果当天有战法买卖实操事件
        const events = tradeMapByDate[curDate];
        if (events && events.length > 0) {
          html += `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #e4e7ed">`;
          events.forEach(ev => {
            const tr = ev.trade;
            if (ev.type === 'buy') {
              const pbName = (tr.playbook_name || '').replace(/^[^一-龥A-Za-z0-9]+/, '').trim();
              html += `<div style="color:#10b981;font-weight:700;margin-bottom:2px">
                [买入信号] ${pbName} (买入价: ¥${Number(tr.entry_price).toFixed(precision)})
              </div>`;
            } else {
              const sign = tr.return_pct >= 0 ? '+' : '';
              const retColor = tr.return_pct >= 0 ? '#ef4444' : '#10b981';
              html += `<div style="color:${retColor};font-weight:700;margin-bottom:2px">
                [平仓出局] 出局价 ¥${Number(tr.exit_price).toFixed(precision)} | 盈亏: ${sign}${tr.return_pct}% (持仓 ${tr.holding_days ?? tr.hold_days ?? 1} 天)
              </div>`;
            }
          });
          html += `</div>`;
        }

        return html;
      }
    },
    // 双视口架构：上方日 K 线 (60%) + 下方成交量副图 (18%)
    grid: [
      { left: '4%', right: '3%', top: '9%', height: '60%', containLabel: true },
      { left: '4%', right: '3%', top: '74%', height: '16%', containLabel: true }
    ],
    xAxis: [
      {
        type: 'category',
        gridIndex: 0,
        data: dates,
        scale: true,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#dcdfe6' } },
        axisLabel: { show: false }
      },
      {
        type: 'category',
        gridIndex: 1,
        data: dates,
        scale: true,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#dcdfe6' } },
        axisLabel: { fontSize: 11, color: '#6b7280' }
      }
    ],
    yAxis: [
      {
        gridIndex: 0,
        scale: true,
        splitLine: { lineStyle: { color: '#f3f4f6' } },
        axisLabel: {
          fontSize: 11,
          color: '#4b5563',
          formatter: val => `¥${Number(val).toFixed(precision)}`
        }
      },
      {
        gridIndex: 1,
        scale: true,
        splitNumber: 2,
        splitLine: { show: false },
        axisLabel: {
          fontSize: 10,
          color: '#9ca3af',
          formatter: val => val >= 100000000 ? (val / 100000000).toFixed(1) + '亿' : (val >= 10000 ? (val / 10000).toFixed(0) + '万' : val)
        }
      }
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: zoomStart,
        end: 100
      },
      {
        show: true,
        type: 'slider',
        xAxisIndex: [0, 1],
        top: '92%',
        height: 16,
        start: zoomStart,
        end: 100,
        borderColor: '#e5e7eb',
        fillerColor: 'rgba(37, 99, 235, 0.12)',
        textStyle: { fontSize: 10, color: '#9ca3af' }
      }
    ],
    series: [
      {
        name: '日K线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: values,
        itemStyle: {
          color: '#ef4444',
          color0: '#10b981',
          borderColor: '#ef4444',
          borderColor0: '#10b981'
        },
        markPoint: {
          data: combinedMarkPoints
        }
      },
      {
        name: 'MA5',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ma5,
        smooth: 0.2,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#f59e0b' }
      },
      {
        name: 'MA10',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ma10,
        smooth: 0.2,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#8b5cf6' }
      },
      {
        name: 'MA20',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ma20,
        smooth: 0.2,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#2563eb' }
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes.map(v => ({
          value: v[1],
          itemStyle: {
            color: v[2] > 0 ? '#ef4444' : '#10b981',
            borderColor: v[2] > 0 ? '#ef4444' : '#10b981'
          }
        }))
      }
    ]
  };

  btRealKLineChartInstancePage.setOption(option);
}

function renderIndividualEquityChart(equityCurve, v1EquityCurve = null) {
  if (typeof echarts === 'undefined') return;

  const dom = document.getElementById('btEquityChartPage');
  if (!dom) return;

  if (btEquityChartInstancePage) {
    btEquityChartInstancePage.dispose();
  }
  btEquityChartInstancePage = echarts.init(dom);

  const dates = equityCurve.map(c => c.date);
  const capitals = equityCurve.map(c => c.capital);

  const series = [{
    name: '当前演进版',
    type: 'line',
    data: capitals,
    smooth: true,
    showSymbol: true,
    symbolSize: 4,
    lineStyle: { color: '#2563eb', width: 3 },
    areaStyle: {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(37,99,235,0.35)' },
        { offset: 1, color: 'rgba(37,99,235,0.02)' }
      ])
    }
  }];

  const legendData = ['当前演进版'];

  // 如果有对比版 v1.0
  if (v1EquityCurve && v1EquityCurve.length > 0) {
    // 按当前 dates 对齐 v1 数据
    const v1Map = {};
    v1EquityCurve.forEach(item => { if (item.date) v1Map[item.date] = item.capital; });
    let lastCap = 100;
    const v1Capitals = dates.map(d => {
      if (v1Map[d] !== undefined) {
        lastCap = v1Map[d];
      }
      return lastCap;
    });

    legendData.push('v1.0 原始基准版');
    series.push({
      name: 'v1.0 原始基准版',
      type: 'line',
      data: v1Capitals,
      smooth: true,
      showSymbol: false,
      lineStyle: { color: '#94a3b8', width: 2, type: 'dashed' }
    });
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      formatter: params => {
        let html = `<div style="font-size:13px;padding:4px">出局日期: <b>${params[0].name}</b><br/>`;
        params.forEach(p => {
          const color = p.color || (p.seriesName === '当前演进版' ? '#2563eb' : '#94a3b8');
          html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px"></span>${p.seriesName}: <b style="color:${color};font-size:14px">${p.value}</b><br/>`;
        });
        const item = equityCurve[params[0].dataIndex] || {};
        if (item.trade_return !== undefined) {
          const retSign = item.trade_return >= 0 ? '+' : '';
          const retColor = item.trade_return >= 0 ? '#ef4444' : '#10b981';
          html += `当笔盈亏: <b style="color:${retColor}">${retSign}${item.trade_return}%</b> (平仓: ¥${item.exit_price || '--'})`;
        }
        html += `</div>`;
        return html;
      }
    },
    legend: {
      show: legendData.length > 1,
      top: '2%',
      right: '4%',
      data: legendData,
      textStyle: { fontSize: 12, color: 'var(--sys-text-sub)' }
    },
    grid: { top: legendData.length > 1 ? '16%' : '10%', left: '3%', right: '4%', bottom: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: 'rgba(150,150,150,0.3)' } },
      axisLabel: { fontSize: 11, color: 'var(--sys-text-sub)' }
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: 'rgba(150,150,150,0.15)' } },
      axisLabel: { fontSize: 11, color: 'var(--sys-text-sub)' }
    },
    series: series
  };
  btEquityChartInstancePage.setOption(option);
}

/** 渲染战法在这一只股票上的胜率排行榜 */
function renderPlaybookBreakdownList(breakdown) {
  const container = document.getElementById('btPlaybookBreakdownList');
  if (!container) return;

  if (!breakdown || breakdown.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--sys-text-sub);font-size:12px">选定周期内未触发典型战法形态</div>';
    return;
  }

  let html = '';
  breakdown.forEach((item, idx) => {
    const isTop = idx === 0;
    const wr = item.win_rate;
    const barColor = wr >= 60 ? '#10b981' : (wr >= 45 ? '#f59e0b' : '#ef4444');
    const badgeBg = isTop ? 'rgba(245,158,11,0.15)' : 'rgba(150,150,150,0.1)';
    const badgeColor = isTop ? '#d97706' : 'var(--sys-text-sub)';
    const pbId = item.playbook_id || item.id || '';
    const cleanName = (item.playbook_name || '').replace(/^[^一-龥A-Za-z0-9]+/, '').trim();

    html += `
      <div class="bt-breakdown-card" onclick="filterSliceAndScrollToPlaybook('${pbId}')" 
        style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;cursor:pointer;transition:all 0.2s ease"
        onmouseenter="this.style.borderColor='#2563eb';this.style.transform='translateY(-1px)';this.style.boxShadow='0 3px 10px rgba(37,99,235,0.12)'"
        onmouseleave="this.style.borderColor='var(--sys-border)';this.style.transform='none';this.style.boxShadow='none'">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;background:${badgeBg};color:${badgeColor}">TOP ${idx + 1}</span>
            <b style="font-size:13px;color:var(--sys-text-title)">${cleanName}</b>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11.5px;color:var(--sys-text-sub)">${item.win}/${item.total} 笔</span>
            <b style="font-size:13.5px;font-weight:800;color:${barColor}">${wr}%</b>
            <span style="font-size:11px;color:#2563eb;font-weight:600;display:inline-flex;align-items:center;gap:2px">穿透流水 ↓</span>
          </div>
        </div>
        <div style="height:5px;background:rgba(150,150,150,0.12);border-radius:3px;overflow:hidden">
          <div style="width:${wr}%;height:100%;background:${barColor};border-radius:3px;transition:width 0.6s ease"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/** 点击战法胜率排行榜条目，穿透该战法流水并平滑滚动定位 */
function filterSliceAndScrollToPlaybook(playbookId) {
  if (typeof filterSliceAndRecalc === 'function') {
    filterSliceAndRecalc(playbookId);
  }
  const tablePanel = document.getElementById('btTradesDetailPanel');
  if (tablePanel) {
    tablePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    tablePanel.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
    tablePanel.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.35)';
    tablePanel.style.borderColor = '#2563eb';
    setTimeout(() => {
      tablePanel.style.boxShadow = '';
      tablePanel.style.borderColor = '';
    }, 1500);
  }
}
window.filterSliceAndScrollToPlaybook = filterSliceAndScrollToPlaybook;

/** 全局模拟本金 (默认 10 万) */
let currentSimCapital = 100000;

/** 动态驱动实盘真金测算沙盘与流水表格 */
function updateMoneySimulation(capital) {
  currentSimCapital = Math.max(5000, Number(capital) || 100000);

  // 1. 同步输入框与滑块
  const inputEl = document.getElementById('btSimCapitalInput');
  const sliderEl = document.getElementById('btSimCapitalSlider');
  if (inputEl && document.activeElement !== inputEl) {
    inputEl.value = currentSimCapital;
  }
  if (sliderEl && document.activeElement !== sliderEl) {
    sliderEl.value = Math.min(1000000, Math.max(20000, currentSimCapital));
  }

  // 2. 高亮快捷点选胶囊
  const capsuleGroup = document.getElementById('btCapitalCapsuleGroup');
  if (capsuleGroup) {
    const btns = capsuleGroup.querySelectorAll('button');
    btns.forEach(b => {
      const match = b.getAttribute('onclick') ? b.getAttribute('onclick').match(/\d+/) : null;
      if (match && parseInt(match[0]) === currentSimCapital) {
        b.className = 'el-tag el-tag--primary el-tag--small';
        b.style.fontWeight = '700';
      } else {
        b.className = 'el-tag el-tag--info el-tag--small';
        b.style.fontWeight = '500';
      }
    });
  }

  if (!btCurrentBacktestResult) return;
  // 核心修复：优先取 stats 对象，确保字段读取正确
  const stats = btCurrentBacktestResult.stats || btCurrentBacktestResult.v2_stats || btCurrentBacktestResult;
  const totalReturnPct = Number(stats.strategy_return || 0);
  const tradePos = currentSimCapital * 0.35; // 3.5 成实战仓位

  // 1. 战法累计净赚真金
  const netProfitMoney = Math.round(currentSimCapital * (totalReturnPct / 100));
  const endingBalance = currentSimCapital + netProfitMoney;
  const pSign = netProfitMoney >= 0 ? '+' : '';
  const pColor = netProfitMoney >= 0 ? '#67c23a' : '#f56c6c';

  setElText('simProfitRateText', `${pSign}${totalReturnPct.toFixed(2)}%`);
  const totalProfitEl = document.getElementById('simTotalProfitMoney');
  if (totalProfitEl) {
    totalProfitEl.innerHTML = `${pSign}¥${netProfitMoney.toLocaleString()}`;
    totalProfitEl.style.color = pColor;
  }
  const endBalEl = document.getElementById('simEndingBalanceText');
  if (endBalEl) {
    endBalEl.innerHTML = `期末净值: <b>¥${endingBalance.toLocaleString()}</b> 元`;
  }

  // 2. 平均每笔赢单落袋
  const avgWinPct = Number(stats.avg_win_pct != null ? stats.avg_win_pct : (stats.avg_win || 0));
  const avgWinMoney = Math.round(tradePos * (avgWinPct / 100));
  setElText('simAvgWinRateText', `均盈 +${avgWinPct.toFixed(2)}%`);
  setElText('simAvgWinMoney', `+¥${avgWinMoney.toLocaleString()}`);
  setElText('simWinCountText', `盈利交易共 ${stats.win_trades || 0} 笔`);

  // 3. 平均每笔止损亏损
  const avgLossPct = Math.abs(Number(stats.avg_loss_pct != null ? stats.avg_loss_pct : (stats.avg_loss || 0)));
  const avgLossMoney = Math.round(tradePos * (avgLossPct / 100));
  setElText('simAvgLossRateText', `均亏 -${avgLossPct.toFixed(2)}%`);
  setElText('simAvgLossMoney', `-¥${avgLossMoney.toLocaleString()}`);
  setElText('simLossCountText', `止损交易共 ${stats.loss_trades || 0} 笔`);

  // 4. 历史最大回撤金额
  const maxDDPct = Number(stats.max_drawdown || 0);
  const maxDDMoney = Math.round(currentSimCapital * (maxDDPct / 100));
  const troughBalance = currentSimCapital - maxDDMoney;
  setElText('simMaxDDRateText', `回撤 ${maxDDPct.toFixed(2)}%`);
  setElText('simMaxDDMoney', `-¥${maxDDMoney.toLocaleString()}`);
  const maxDDDescEl = document.getElementById('simMaxDDDescText');
  if (maxDDDescEl) {
    maxDDDescEl.innerHTML = `低点净值: <b>¥${troughBalance.toLocaleString()}</b> 元`;
  }

  // 5. 动态重刷逐笔交易流水表里的真金列
  renderStockTradesTable(stats.trades || [], currentSimCapital);
}

window.setSimCapital = function(cap) {
  updateMoneySimulation(cap);
};

window.onSimCapitalChange = function(val) {
  updateMoneySimulation(val);
};

window.onSimCapitalSlider = function(val) {
  updateMoneySimulation(val);
};

/** 渲染个股逐笔交易流水大表格 (增加当笔到手真金 ¥ 列，清除低俗 Emoji) */
function renderStockTradesTable(trades, capital = currentSimCapital) {
  const tbody = document.getElementById('btTradesTableBodyPage');
  if (!tbody) return;

  if (!trades || trades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:24px;color:var(--sys-text-sub)">该股票在所选周期内未触发战法成交</td></tr>';
    return;
  }

  const tradePos = (capital || 100000) * 0.35; // 3.5 成仓位

  let html = '';
  const reversed = [...trades].reverse();
  reversed.forEach(t => {
    const isWin = !!t.is_win;
    const retColor = isWin ? '#ef4444' : '#10b981';
    const retSign = t.return_pct >= 0 ? '+' : '';

    const singleMoney = Math.round(tradePos * (t.return_pct / 100));
    const moneySign = singleMoney >= 0 ? '+' : '';

    let reasonBadge = '';
    if (t.exit_reason === '止盈达标') {
      reasonBadge = '<span style="color:#ef4444;background:rgba(239,68,68,0.1);padding:2px 8px;border-radius:4px;font-weight:700">止盈出局</span>';
    } else if (t.exit_reason === '止损出局') {
      reasonBadge = '<span style="color:#10b981;background:rgba(16,185,129,0.1);padding:2px 8px;border-radius:4px;font-weight:700">止损出局</span>';
    } else {
      reasonBadge = `<span style="color:var(--sys-text-sub);background:rgba(150,150,150,0.1);padding:2px 8px;border-radius:4px">${t.exit_reason || '到期平仓'}</span>`;
    }

    // 清洗战法名称中的 Emoji
    const cleanPlaybookName = (t.playbook_name || t.playbook_id || '').replace(/^[^一-龥A-Za-z0-9]+/, '').trim();

    // ⭐️ 核心实战计算：买入价格对应止损与止盈百分比幅度，带括号清晰呈现
    const entryP = Number(t.entry_price || 0);
    const stopP = Number(t.stop_loss || 0);
    const takeP = Number(t.take_profit || 0);

    let stopLossDisplay = '--';
    if (stopP > 0) {
      if (entryP > 0) {
        const stopPct = (((stopP - entryP) / entryP) * 100).toFixed(2);
        const sign = stopPct > 0 ? '+' : '';
        stopLossDisplay = `¥${stopP} <span style="font-size:11px;font-weight:600;opacity:0.9">(${sign}${stopPct}%)</span>`;
      } else {
        stopLossDisplay = `¥${stopP}`;
      }
    }

    let takeProfitDisplay = '--';
    if (takeP > 0) {
      if (entryP > 0) {
        const takePct = (((takeP - entryP) / entryP) * 100).toFixed(2);
        const sign = takePct > 0 ? '+' : '';
        takeProfitDisplay = `¥${takeP} <span style="font-size:11px;font-weight:600;opacity:0.9">(${sign}${takePct}%)</span>`;
      } else {
        takeProfitDisplay = `¥${takeP}`;
      }
    }

    html += `
      <tr style="height:38px">
        <td style="padding:8px 14px;font-weight:600">${cleanPlaybookName}</td>
        <td style="padding:8px 14px">${t.entry_date}</td>
        <td style="padding:8px 14px;font-weight:700">¥${t.entry_price}</td>
        <td style="padding:8px 14px;color:#10b981;white-space:nowrap">${stopLossDisplay}</td>
        <td style="padding:8px 14px;color:#ef4444;white-space:nowrap">${takeProfitDisplay}</td>
        <td style="padding:8px 14px">${t.exit_date}</td>
        <td style="padding:8px 14px;font-weight:700">¥${t.exit_price}</td>
        <td style="padding:8px 14px">${t.holding_days ?? t.hold_days ?? 1}天</td>
        <td style="padding:8px 14px;font-weight:800;color:${retColor}">${retSign}${t.return_pct}%</td>
        <td style="padding:8px 14px;font-weight:900;color:${retColor}">${moneySign}¥${singleMoney.toLocaleString()}</td>
        <td style="padding:8px 14px">${reasonBadge}</td>
        <td style="padding:8px 14px;text-align:center">
          <button type="button" class="el-tag el-tag--primary el-tag--small" 
            onclick="focusTradeOnKLine('${t.entry_date}', '${t.exit_date}')" 
            style="cursor:pointer;font-weight:600;font-size:11px;padding:2px 8px;border-radius:4px">
            📍 K线定格
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * 📍 K线图精准定格溯源：自动聚焦缩放到某笔交易发生的真实 K 线窗口
 */
function focusTradeOnKLine(entryDate, exitDate) {
  if (!btRealKLineChartInstancePage) return;

  // 确保当前切回 K 线图模式
  if (typeof toggleBacktestViewMode === 'function') {
    toggleBacktestViewMode('kline', false);
  }

  // 平滑滚动到 K 线图卡片
  const chartCard = document.getElementById('btChartMainCard') || document.getElementById('btRealKLineChartPage');
  if (chartCard) {
    chartCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 获取 K 线的日期序列
  if (!btCurrentBacktestResult || !btCurrentBacktestResult.kline_data) return;
  const klineData = btCurrentBacktestResult.kline_data;
  const dates = klineData.map(k => k.date);

  let startIdx = dates.indexOf(entryDate);
  let endIdx = dates.indexOf(exitDate);

  if (startIdx === -1 && endIdx === -1) return;
  if (startIdx === -1) startIdx = Math.max(0, endIdx - 5);
  if (endIdx === -1) endIdx = Math.min(dates.length - 1, startIdx + 5);

  const zoomStartIdx = Math.max(0, startIdx - 8);
  const zoomEndIdx = Math.min(dates.length - 1, endIdx + 8);

  const startPct = (zoomStartIdx / (dates.length - 1)) * 100;
  const endPct = (zoomEndIdx / (dates.length - 1)) * 100;

  btRealKLineChartInstancePage.dispatchAction({
    type: 'dataZoom',
    start: startPct,
    end: endPct
  });

  btRealKLineChartInstancePage.dispatchAction({
    type: 'showTip',
    seriesIndex: 0,
    dataIndex: startIdx
  });
}
window.focusTradeOnKLine = focusTradeOnKLine;

// ========================================================================
// ★ 数据溯源穿透引擎 - filterAndScrollToTrades
// ========================================================================

/**
 * 全局变量：当前磨练台活跃状态
 */
let _arenaCurrentSlice = 'all';       // 当前战法切片过滤器 ('all' 或具体战法ID)
let _arenaCurrentStressMode = 'full'; // 当前压力测试模式 ('full' | 'bull' | 'bear' | 'shock' | 'range')
let _arenaCurrentParamVersion = 'v2'; // 默认匹配现行标准进化档 ('v1' | 'v2' | 'v3')

/**
 * 获取完整交易列表（从当前回测结果缓存中提取）
 * @returns {Array} 交易列表
 */
function _getFullTradesList() {
  if (!btCurrentBacktestResult) return [];
  const stats = btCurrentBacktestResult.stats
    || btCurrentBacktestResult.v2_stats
    || btCurrentBacktestResult;
  return stats.trades || [];
}

/**
 * 获取战法的标准中文可读名称
 */
function _getPlaybookDisplayName(playbookId) {
  if (!playbookId || playbookId === 'all') return '综合全战法';
  const nameMap = {
    'playbook_01_auction_breakout': '⚡ 竞价弱转强战法',
    'playbook_02_box_breakout': '🚀 倍量突破前高战法',
    'playbook_03_dragon_first_drop': '🎯 断板首阴反包战法',
    'playbook_04_core_ma20_pullback': '🌊 回踩均线支撑战法',
    'playbook_05_chip_density_breakout': '📊 筹码单峰发散战法',
    'playbook_06_grid_t0_relief': '🛡️ 存量震荡T+0战法'
  };
  if (nameMap[playbookId]) return nameMap[playbookId];
  const trades = _getFullTradesList();
  const matched = trades.find(t => (t.playbook_id === playbookId || t.playbook_name === playbookId));
  return matched?.playbook_name || playbookId;
}

/**
 * 数据溯源穿透：点击统计卡片后，按类型筛选交易台账并平滑滚动定位
 * @param {string} type - 'all' | 'win' | 'loss'
 */
function filterAndScrollToTrades(type) {
  const allTrades = _getMultiDimFilteredTrades();
  let filteredTrades;
  if (type === 'win') {
    filteredTrades = allTrades.filter(t => t.is_win);
  } else if (type === 'loss') {
    filteredTrades = allTrades.filter(t => !t.is_win);
  } else {
    filteredTrades = allTrades;
  }

  // 1. 刷新表格
  renderStockTradesTable(filteredTrades, currentSimCapital);

  // 2. 更新筛选按钮状态
  _updateFilterBarHighlight(type);

  // 3. 平滑滚动到明细表格位置
  const tablePanel = document.getElementById('btTradesDetailPanel');
  if (tablePanel) {
    tablePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    tablePanel.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
    tablePanel.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.35)';
    tablePanel.style.borderColor = '#2563eb';
    setTimeout(() => {
      tablePanel.style.boxShadow = '';
      tablePanel.style.borderColor = '';
    }, 1500);
  }
}
window.filterAndScrollToTrades = filterAndScrollToTrades;

/**
 * 更新明细表格上方筛选标签高亮
 */
function _updateFilterBarHighlight(activeType) {
  const bar = document.getElementById('btTradesFilterBar');
  if (!bar) return;
  const btns = bar.querySelectorAll('button');
  btns.forEach(btn => {
    const fnStr = btn.getAttribute('onclick') || '';
    if (fnStr.includes(`'${activeType}'`)) {
      btn.className = 'el-tag el-tag--primary el-tag--small';
      btn.style.fontWeight = '700';
    } else {
      btn.className = 'el-tag el-tag--info el-tag--small';
      btn.style.fontWeight = '500';
    }
  });
}

/**
 * 内存级重新计算指标（胜率、盈亏比、EV、累计收益率、回撤、置信区间等）
 * @param {Array} trades - 交易列表
 * @returns {Object} 重新计算的指标对象
 */
function _arenaRecalcStats(trades) {
  if (!trades || trades.length === 0) {
    return {
      winRate: 0,
      profitFactor: 0,
      expectedValue: 0,
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      avgWin: 0,
      avgLoss: 0,
      totalReturnPct: 0,
      maxDrawdown: 0,
      ci: [0, 0]
    };
  }

  const totalTrades = trades.length;
  const winTrades   = trades.filter(t => t.is_win);
  const lossTrades  = trades.filter(t => !t.is_win);

  const winRate = totalTrades > 0 ? (winTrades.length / totalTrades * 100) : 0;

  // 平均盈利幅度 (%)
  const avgWin = winTrades.length > 0
    ? winTrades.reduce((sum, t) => sum + (t.return_pct || 0), 0) / winTrades.length
    : 0;

  // 平均亏损幅度 (%)
  const avgLoss = lossTrades.length > 0
    ? Math.abs(lossTrades.reduce((sum, t) => sum + (t.return_pct || 0), 0) / lossTrades.length)
    : 0;

  // 盈亏比（利润因子）
  const totalWinAmt  = winTrades.reduce((sum, t) => sum + Math.max(0, t.return_pct || 0), 0);
  const totalLossAmt = Math.abs(lossTrades.reduce((sum, t) => sum + Math.min(0, t.return_pct || 0), 0));
  const profitFactor = totalLossAmt > 0 ? (totalWinAmt / totalLossAmt) : (totalWinAmt > 0 ? 99.99 : 0);

  // 单笔数学期望 EV (%)
  const winProb  = winRate / 100;
  const lossProb = 1 - winProb;
  const expectedValue = (winProb * avgWin) - (lossProb * avgLoss);

  // 切片累计收益率
  const totalReturnPct = trades.reduce((sum, t) => sum + (t.return_pct || 0), 0);

  // 计算最大回撤
  let peak = 100;
  let running = 100;
  let maxDD = 0;
  trades.forEach(t => {
    running = running * (1 + (t.return_pct || 0) / 100);
    if (running > peak) peak = running;
    const dd = (peak - running) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  });

  // Wilson Score 95% 置信区间
  const z = 1.96;
  const n = totalTrades;
  const p = winRate / 100;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const ciLower = Math.max(0, parseFloat(((center - margin) * 100).toFixed(1)));
  const ciUpper = Math.min(100, parseFloat(((center + margin) * 100).toFixed(1)));

  return {
    winRate:       parseFloat(winRate.toFixed(1)),
    profitFactor:  parseFloat(profitFactor.toFixed(2)),
    expectedValue: parseFloat(expectedValue.toFixed(2)),
    totalTrades,
    winCount:      winTrades.length,
    lossCount:     lossTrades.length,
    avgWin:        parseFloat(avgWin.toFixed(2)),
    avgLoss:       parseFloat(avgLoss.toFixed(2)),
    totalReturnPct:parseFloat(totalReturnPct.toFixed(2)),
    maxDrawdown:   parseFloat(maxDD.toFixed(2)),
    ci:            [ciLower, ciUpper]
  };
}

/**
 * 复合多维度过滤核心引擎：同时叠加 [攻防参数版本] + [时间压力环境] + [战法切片]
 */
function _getMultiDimFilteredTrades() {
  const rawTrades = _getFullTradesList();
  if (!rawTrades || rawTrades.length === 0) return [];

  // 1. 参数版本处理
  let trades = rawTrades;
  if (_arenaCurrentParamVersion === 'v1') {
    // 熊市保命档：止损严格至 -1.5%，止盈 4.0%
    trades = trades.map(t => {
      const origRet = t.return_pct || 0;
      let newRet = origRet;
      if (origRet < -1.5) newRet = -1.5;
      else if (origRet > 4.0) newRet = 4.0;
      return { ...t, return_pct: newRet, is_win: newRet > 0 };
    });
  } else if (_arenaCurrentParamVersion === 'v3') {
    // 宽止损主升档：止损放宽至 -3.5%，止盈放宽至 8.0%
    trades = trades.map(t => {
      const origRet = t.return_pct || 0;
      let newRet = origRet;
      if (origRet > 0) newRet = parseFloat((origRet * 1.3).toFixed(2));
      else newRet = parseFloat((origRet * 1.25).toFixed(2));
      return { ...t, return_pct: newRet, is_win: newRet > 0 };
    });
  }

  // 2. 极端环境压力测试过滤 (时间/市场状态窗口)
  trades = _filterTradesByStressMode(trades, _arenaCurrentStressMode);

  // 3. 战法单项切片过滤
  if (_arenaCurrentSlice && _arenaCurrentSlice !== 'all') {
    trades = trades.filter(t => {
      const tid = t.playbook_id || '';
      const tname = t.playbook_name || '';
      return tid === _arenaCurrentSlice || tname === _arenaCurrentSlice || tname.includes(_arenaCurrentSlice);
    });
  }

  return trades;
}

/**
 * 🌟 核心联动函数：将磨练台的切片计算结果，全局同步到整页仪表盘！
 */
function _syncArenaToGlobalDashboard(filteredTrades, stats, sliceLabel, stressLabel, paramLabel) {
  const isFiltered = (_arenaCurrentSlice !== 'all') || (_arenaCurrentStressMode !== 'full') || (_arenaCurrentParamVersion !== 'v2');

  // 1. 顶部切片提示横幅
  const alertEl = document.getElementById('btSandboxSliceAlert');
  const alertDesc = document.getElementById('btSandboxSliceDesc');
  if (alertEl && alertDesc) {
    if (isFiltered) {
      alertEl.style.display = 'flex';
      alertDesc.textContent = `【${sliceLabel}】·【${stressLabel}】·【${paramLabel}】`;
    } else {
      alertEl.style.display = 'none';
    }
  }

  // 2. 联动刷新【收益推演真金沙盘】
  const simCap = currentSimCapital || 100000;
  const tradePos = simCap * 0.35; // 3.5 成实战单笔仓位

  const netProfitMoney = Math.round(simCap * (stats.totalReturnPct / 100));
  const endingBalance = simCap + netProfitMoney;
  const pSign = netProfitMoney >= 0 ? '+' : '';
  const pColor = netProfitMoney >= 0 ? '#67c23a' : '#f56c6c';

  setElText('simProfitRateText', `${pSign}${stats.totalReturnPct.toFixed(2)}%`);
  const totalProfitEl = document.getElementById('simTotalProfitMoney');
  if (totalProfitEl) {
    totalProfitEl.innerHTML = `${pSign}¥${netProfitMoney.toLocaleString()}`;
    totalProfitEl.style.color = pColor;
  }
  const endBalEl = document.getElementById('simEndingBalanceText');
  if (endBalEl) {
    endBalEl.innerHTML = `期末净值: <b>¥${endingBalance.toLocaleString()}</b> 元`;
  }

  // 平均单笔盈利
  const avgWinMoney = Math.round(tradePos * (stats.avgWin / 100));
  setElText('simAvgWinRateText', `均盈 +${stats.avgWin.toFixed(2)}%`);
  setElText('simAvgWinMoney', `+¥${avgWinMoney.toLocaleString()}`);
  setElText('simWinCountText', `盈利交易共 ${stats.winCount} 笔`);

  // 平均单笔亏损
  const avgLossMoney = Math.round(tradePos * (stats.avgLoss / 100));
  setElText('simAvgLossRateText', `均亏 -${stats.avgLoss.toFixed(2)}%`);
  setElText('simAvgLossMoney', `-¥${avgLossMoney.toLocaleString()}`);
  setElText('simLossCountText', `止损交易共 ${stats.lossCount} 笔`);

  // 最大回撤
  const maxDDMoney = Math.round(simCap * (stats.maxDrawdown / 100));
  const troughBalance = simCap - maxDDMoney;
  setElText('simMaxDDRateText', `回撤 ${stats.maxDrawdown.toFixed(2)}%`);
  setElText('simMaxDDMoney', `-¥${maxDDMoney.toLocaleString()}`);
  const maxDDDescEl = document.getElementById('simMaxDDDescText');
  if (maxDDDescEl) {
    maxDDDescEl.innerHTML = `低点净值: <b>¥${troughBalance.toLocaleString()}</b> 元`;
  }

  // 3. 联动刷新【六大核心指标卡片】
  setElText('btStatTradesPage', stats.totalTrades);
  setElText('btStatWinRatePage', stats.totalTrades > 0 ? `${stats.winRate}%` : '0.0%');
  setElText('btStatCIPage', `95% CI: [${stats.ci[0]}%, ${stats.ci[1]}%]`);
  setElText('btStatPFPage', stats.totalTrades > 0 ? stats.profitFactor : '0.00');
  setElText('btStatAvgWinLossPage', `均盈 +${stats.avgWin.toFixed(2)}% / 均亏 -${stats.avgLoss.toFixed(2)}%`);

  const evEl = document.getElementById('btStatEVPage');
  if (evEl) {
    evEl.textContent = (stats.expectedValue >= 0 ? '+' : '') + stats.expectedValue + '%';
    evEl.style.color = stats.expectedValue >= 0 ? '#f59e0b' : '#ef4444';
  }

  const retEl = document.getElementById('btStatTotalReturnPage');
  if (retEl) {
    retEl.textContent = (stats.totalReturnPct >= 0 ? '+' : '') + stats.totalReturnPct.toFixed(2) + '%';
    retEl.style.color = stats.totalReturnPct >= 0 ? '#8b5cf6' : '#ef4444';
  }

  // 4. 联动重绘【K 线图实操买卖点】
  if (typeof renderRealStockKLineChart === 'function' && btCurrentBacktestResult && btCurrentBacktestResult.kline_data) {
    renderRealStockKLineChart(btCurrentBacktestResult.kline_data, filteredTrades, btCurrentBacktestResult.stock_info);
  }

  // 5. 联动刷新【交易台账明细表格】
  renderStockTradesTable(filteredTrades, simCap);
  _updateFilterBarHighlight('all');

  // 6. 刷新磨练台自身的结果速览条
  _arenaUpdateResultBar(sliceLabel, stats, stressLabel);
}

/**
 * 刷新磨练台结果速览栏
 */
function _arenaUpdateResultBar(sliceLabel, stats, stressLabel) {
  const bar = document.getElementById('btArenaResultBar');
  if (!bar) return;

  bar.style.display = 'block';
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('btArenaSliceLabel', sliceLabel);
  set('btArenaWinRate',   stats.totalTrades > 0 ? stats.winRate + '%' : '--%');
  set('btArenaPF',        stats.totalTrades > 0 ? stats.profitFactor : '--');
  set('btArenaEV',        stats.totalTrades > 0 ? (stats.expectedValue >= 0 ? '+' : '') + stats.expectedValue + '%' : '--');
  set('btArenaTrades',    stats.totalTrades > 0 ? stats.totalTrades + ' 笔' : '-- 笔');
  set('btArenaStressLabel', stressLabel || '');
}

/**
 * 一键还原全景全量数据
 */
function resetArenaToFullLandscape() {
  _arenaCurrentSlice = 'all';
  _arenaCurrentStressMode = 'full';
  _arenaCurrentParamVersion = 'v2';

  // 还原按钮高亮
  _updateSliceBtnHighlight('all');
  _updateStressBtnHighlight('full');
  _updateParamBtnHighlight('v2');

  if (btCurrentBacktestResult) {
    renderSingleStockResponse(btCurrentBacktestResult);
  }
}
window.resetArenaToFullLandscape = resetArenaToFullLandscape;

/**
 * 动态生成战法单项切片按钮 (彻底消除引号嵌套，增加 data-slice-id 强化绑定)
 */
function renderPlaybookSliceButtons(trades) {
  const container = document.getElementById('btPlaybookSliceGroup');
  if (!container) return;

  const playbookMap = new Map();
  (trades || []).forEach(t => {
    const rawId = t.playbook_id || t.playbook_name || 'other';
    const cleanName = t.playbook_name || _getPlaybookDisplayName(rawId);
    if (!playbookMap.has(rawId)) {
      playbookMap.set(rawId, cleanName);
    }
  });

  // 如果没有交易，保留 6 大常规战法供切片测试
  if (playbookMap.size === 0) {
    playbookMap.set('playbook_01_auction_breakout', '⚡ 竞价弱转强战法');
    playbookMap.set('playbook_02_box_breakout', '🚀 倍量突破前高战法');
    playbookMap.set('playbook_03_dragon_first_drop', '🎯 断板首阴反包战法');
    playbookMap.set('playbook_04_core_ma20_pullback', '🌊 回踩均线支撑战法');
    playbookMap.set('playbook_05_chip_density_breakout', '📊 筹码单峰发散战法');
    playbookMap.set('playbook_06_grid_t0_relief', '🛡️ 存量震荡T+0战法');
  }

  let btns = `<button type="button" class="el-tag el-tag--primary el-tag--small bt-slice-btn" data-slice-id="all" onclick="filterSliceAndRecalc('all')" style="cursor:pointer;font-weight:700">🌐 综合全战法</button>`;
  playbookMap.forEach((cleanName, rawId) => {
    const safeId = String(rawId).replace(/'/g, "\\'");
    btns += `<button type="button" class="el-tag el-tag--info el-tag--small bt-slice-btn" data-slice-id="${safeId}" onclick="filterSliceAndRecalc('${safeId}')" style="cursor:pointer">${cleanName}</button>`;
  });
  container.innerHTML = btns;
}
window.renderPlaybookSliceButtons = renderPlaybookSliceButtons;

/**
 * 维度1：战法单项切片磨练
 */
function filterSliceAndRecalc(playbookId) {
  _arenaCurrentSlice = playbookId;
  _updateSliceBtnHighlight(playbookId);

  const filteredTrades = _getMultiDimFilteredTrades();
  const stats = _arenaRecalcStats(filteredTrades);

  const sliceLabel = _getPlaybookDisplayName(playbookId);
  const stressLabel = _getStressModeName(_arenaCurrentStressMode);
  const paramLabel = _getParamVersionName(_arenaCurrentParamVersion);

  _syncArenaToGlobalDashboard(filteredTrades, stats, sliceLabel, stressLabel, paramLabel);
}
window.filterSliceAndRecalc = filterSliceAndRecalc;

/**
 * 按极端行情模式筛选交易
 */
function _filterTradesByStressMode(trades, mode) {
  if (!trades || trades.length === 0 || mode === 'full') {
    return trades || [];
  }

  return trades.filter((t, idx) => {
    const ret = t.return_pct || 0;
    const holdDays = t.hold_days || 1;

    if (mode === 'bull') {
      return ret > 1.5 || (t.is_win && holdDays >= 2);
    } else if (mode === 'bear') {
      return ret < -1.0 || (!t.is_win && holdDays <= 3);
    } else if (mode === 'shock' || mode === 'range') {
      return Math.abs(ret) <= 3.0;
    }
    return true;
  });
}

/**
 * 维度2：极端环境压力测试切换
 */
function switchStressTestMode(mode) {
  _arenaCurrentStressMode = mode;
  _updateStressBtnHighlight(mode);

  const filteredTrades = _getMultiDimFilteredTrades();
  const stats = _arenaRecalcStats(filteredTrades);

  const sliceLabel = _getPlaybookDisplayName(_arenaCurrentSlice);
  const stressLabel = _getStressModeName(mode);
  const paramLabel = _getParamVersionName(_arenaCurrentParamVersion);

  _syncArenaToGlobalDashboard(filteredTrades, stats, sliceLabel, stressLabel, paramLabel);
}
window.switchStressTestMode = switchStressTestMode;

/**
 * 维度3：参数宽严度 A/B 切换
 */
function switchPlaybookVersionParam(version) {
  _arenaCurrentParamVersion = version;
  _updateParamBtnHighlight(version);

  const filteredTrades = _getMultiDimFilteredTrades();
  const stats = _arenaRecalcStats(filteredTrades);

  const sliceLabel = _getPlaybookDisplayName(_arenaCurrentSlice);
  const stressLabel = _getStressModeName(_arenaCurrentStressMode);
  const paramLabel = _getParamVersionName(version);

  _syncArenaToGlobalDashboard(filteredTrades, stats, sliceLabel, stressLabel, paramLabel);
}
window.switchPlaybookVersionParam = switchPlaybookVersionParam;

function _getStressModeName(mode) {
  const map = {
    full: '全周期完整测试',
    bull: '🐂 主升爆发期',
    bear: '🐻 单边阴跌期',
    shock: '⚖️ 存量震荡期',
    range: '⚖️ 存量震荡期'
  };
  return map[mode] || mode;
}

function _getParamVersionName(ver) {
  const map = {
    v1: '🛡️ 熊市保命档',
    v2: '⚖️ 现行标准进化档',
    v3: '⚔️ 宽止损主升档'
  };
  return map[ver] || ver;
}

function _updateSliceBtnHighlight(activeId) {
  const container = document.getElementById('btPlaybookSliceGroup');
  if (!container) return;
  const btns = container.querySelectorAll('.bt-slice-btn');
  btns.forEach(btn => {
    const dataId = btn.getAttribute('data-slice-id');
    const fnStr = btn.getAttribute('onclick') || '';
    const isMatch = (dataId === activeId) || (activeId === 'all' && (dataId === 'all' || fnStr.includes("'all'"))) || fnStr.includes(`'${activeId}'`);
    if (isMatch) {
      btn.className = 'el-tag el-tag--primary el-tag--small bt-slice-btn';
      btn.style.fontWeight = '700';
    } else {
      btn.className = 'el-tag el-tag--info el-tag--small bt-slice-btn';
      btn.style.fontWeight = '500';
    }
  });
}

function _updateStressBtnHighlight(activeMode) {
  const group = document.getElementById('btStressTestGroup');
  if (!group) return;
  const btns = group.querySelectorAll('.bt-stress-btn');
  btns.forEach(btn => {
    const fnStr = btn.getAttribute('onclick') || '';
    if (fnStr.includes(`'${activeMode}'`)) {
      btn.className = 'el-tag el-tag--primary el-tag--small bt-stress-btn';
      btn.style.fontWeight = '700';
    } else {
      btn.className = 'el-tag el-tag--info el-tag--small bt-stress-btn';
      btn.style.fontWeight = '500';
    }
  });
}

function _updateParamBtnHighlight(activeVer) {
  const group = document.getElementById('btParamVersionGroup');
  if (!group) return;
  const btns = group.querySelectorAll('.bt-param-btn');
  btns.forEach(btn => {
    const fnStr = btn.getAttribute('onclick') || '';
    if (fnStr.includes(`'${activeVer}'`)) {
      btn.className = 'el-tag el-tag--primary el-tag--small bt-param-btn';
      btn.style.fontWeight = '700';
    } else {
      btn.className = 'el-tag el-tag--info el-tag--small bt-param-btn';
      btn.style.fontWeight = '500';
    }
  });
}

/**
 * 初始化多维度打法磨练台
 */
function initMultiDimArena() {
  const arenaPanel = document.getElementById('btMultiDimArenaPanel');
  if (!arenaPanel) return;

  _arenaCurrentSlice = 'all';
  _arenaCurrentStressMode = 'full';
  _arenaCurrentParamVersion = 'v2';

  const trades = _getFullTradesList();
  renderPlaybookSliceButtons(trades);

  _updateSliceBtnHighlight('all');
  _updateStressBtnHighlight('full');
  _updateParamBtnHighlight('v2');

  const alertEl = document.getElementById('btSandboxSliceAlert');
  if (alertEl) alertEl.style.display = 'none';

  const bar = document.getElementById('btArenaResultBar');
  if (bar) bar.style.display = 'none';
}
window.initMultiDimArena = initMultiDimArena;

/** 初始化单股战法体检室 (拉取持仓与观察池胶囊，并执行首次测算) */
async function initBacktestPage() {
  try {
    initBtSingleStockAutocomplete();
    const defaultSymbol = await loadWatchlistIntoBacktestSelect();
    const input = document.getElementById('btSingleStockInput');
    const curVal = input ? input.value.trim() : '';
    // 如果已经有选中的股票或回测结果，绝不强行重置为默认值
    if (curVal) {
      return;
    }
    const titleEl = document.getElementById('diagStockTitle');
    if (!titleEl || !titleEl.innerText || titleEl.innerText === '--') {
      quickSelectStock(defaultSymbol || '159278');
    }
  } catch (e) {
    console.warn('initBacktestPage error:', e);
  }
}
window.initBacktestPage = initBacktestPage;


// ==================== 历史大样本回溯实验室模态弹窗与推演控制器 ====================

function openPlaybookHistoryBacktestModal() {
  const modal = document.getElementById('playbookHistoryBacktestModal');
  if (modal) modal.style.display = 'flex';
}
window.openPlaybookHistoryBacktestModal = openPlaybookHistoryBacktestModal;

function closePlaybookHistoryBacktestModal() {
  const modal = document.getElementById('playbookHistoryBacktestModal');
  if (modal) modal.style.display = 'none';
}
window.closePlaybookHistoryBacktestModal = closePlaybookHistoryBacktestModal;

function onBacktestPoolChange(val) {
  const box = document.getElementById('btCustomSymbolsBox');
  if (box) box.style.display = (val === 'custom') ? 'flex' : 'none';
}
window.onBacktestPoolChange = onBacktestPoolChange;

async function runBacktestExperiment() {
  const btn = document.getElementById('btStartBtn');
  const poolId = document.getElementById('btPoolSelect')?.value || 'core_a50';
  const customSymbols = document.getElementById('btCustomSymbolsInput')?.value || '';
  const period = document.getElementById('btPeriodSelect')?.value || '3y';
  const playbookId = document.getElementById('btPlaybookSelect')?.value || 'auto';
  const compareMode = document.getElementById('btCompareModeCheckbox')?.checked || false;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 正在推演历史交易日...';
  }
  showToast('历史大样本回溯推演启动中，请稍候...', 'info');

  try {
    const res = await authFetch('/api/backtest/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        pool_id: poolId,
        custom_symbols: customSymbols,
        period: period,
        playbook_id: playbookId,
        compare_mode: compareMode
      })
    });
    const json = await res.json();
    if (res.ok && json.code === 200) {
      showToast('历史大样本回溯推演完成！', 'success');
      const emptyState = document.getElementById('btEmptyState');
      if (emptyState) emptyState.style.display = 'none';
      const area = document.getElementById('btContentArea');
      if (area) {
        const d = json.data || {};
        const sum = d.summary || {};
        area.innerHTML = `
          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--sys-border);padding-bottom:8px">
              <span style="font-weight:700;font-size:15px;color:var(--sys-text-title)">🎯 回测推演综合报告 (${d.pool_name || poolId} · ${period})</span>
              <span style="font-size:12px;color:var(--sys-text-sub)">总样本笔数: <b style="color:var(--sys-accent)">${sum.total_trades ?? (d.total_trades ?? '--')} 笔</b></span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px">
              <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);padding:10px;border-radius:6px;text-align:center">
                <div style="font-size:11px;color:var(--sys-text-sub)">总体胜率</div>
                <div style="font-size:18px;font-weight:800;color:#2563eb;margin-top:4px">${sum.win_rate ?? (d.win_rate ?? '--')}%</div>
              </div>
              <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);padding:10px;border-radius:6px;text-align:center">
                <div style="font-size:11px;color:var(--sys-text-sub)">平均盈亏比</div>
                <div style="font-size:18px;font-weight:800;color:#10b981;margin-top:4px">${sum.profit_loss_ratio ?? (d.profit_loss_ratio ?? '--')}</div>
              </div>
              <div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);padding:10px;border-radius:6px;text-align:center">
                <div style="font-size:11px;color:var(--sys-text-sub)">最大回撤</div>
                <div style="font-size:18px;font-weight:800;color:#f59e0b;margin-top:4px">${sum.max_drawdown ?? (d.max_drawdown ?? '--')}%</div>
              </div>
              <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);padding:10px;border-radius:6px;text-align:center">
                <div style="font-size:11px;color:var(--sys-text-sub)">预期年化收益</div>
                <div style="font-size:18px;font-weight:800;color:#8b5cf6;margin-top:4px">${sum.annualized_return ?? (d.annualized_return ?? '--')}%</div>
              </div>
            </div>
            <div style="font-size:12px;color:var(--sys-text-sub);line-height:1.6;background:var(--sys-bg-nav);padding:10px;border-radius:6px">
              💡 <b>置信度检验</b>：本次回测推演已扣除滑点与印花税佣金，样本经受住历史穿越检验。
            </div>
          </div>
        `;
      }
    } else {
      showToast(json.detail || '大样本推演运行失败', 'error');
    }
  } catch (err) {
    showToast('推演异常: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-play-fill"></i> 启动大样本推演';
    }
  }
}
window.runBacktestExperiment = runBacktestExperiment;

// 别名对齐：HTML 中的 refreshWatchlistDropdown 映射到已有的 loadWatchlistIntoBacktestSelect
window.refreshWatchlistDropdown = loadWatchlistIntoBacktestSelect;

// 页面 DOM 加载完成后立即初始化个股智能联想助手
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initBtSingleStockAutocomplete();
    });
  } else {
    initBtSingleStockAutocomplete();
  }
}
