/**
 * 系统一：Alpha 决策工作台 - 🎯 核心买卖点量化测算器与子Tab调度
 * 职责：Alpha 尾盘决策单生成、单笔风险倒算、支撑压力测算、候选股扫描与卡片推送
 */

/* ==================== 🎯 系统一：Alpha 盘中实战交易决策 ==================== */
// ==================== Alpha 交易决策台 (Trading Alpha Desk) 前端逻辑 ====================
let _alphaScanData = null;

async function initAlphaDesk() {
  try {
    const res = await authFetch('/api/alpha/config');
    if (res.ok) {
      const data = await res.json();
      const cfg = data.config || {};
      if (document.getElementById('alphaFilterSt')) document.getElementById('alphaFilterSt').checked = (cfg.filter_st !== undefined ? cfg.filter_st : true);
      if (document.getElementById('alphaEnableThunder')) document.getElementById('alphaEnableThunder').checked = (cfg.enable_anti_thunder !== undefined ? cfg.enable_anti_thunder : true);
      if (document.getElementById('alphaMinAmount')) document.getElementById('alphaMinAmount').checked = (cfg.min_daily_amount_billion ? cfg.min_daily_amount_billion > 0 : true);
      if (document.getElementById('alphaAllowMain')) document.getElementById('alphaAllowMain').checked = (cfg.allow_main !== undefined ? cfg.allow_main : true);
      if (document.getElementById('alphaAllowGem')) document.getElementById('alphaAllowGem').checked = (cfg.allow_gem !== undefined ? cfg.allow_gem : true);
      if (document.getElementById('alphaAllowStar')) document.getElementById('alphaAllowStar').checked = (cfg.allow_star !== undefined ? cfg.allow_star : true);
      if (document.getElementById('alphaEnableMaTrend')) document.getElementById('alphaEnableMaTrend').checked = (cfg.enable_ma_trend !== undefined ? cfg.enable_ma_trend : true);
      if (document.getElementById('alphaEnableVolBreak')) document.getElementById('alphaEnableVolBreak').checked = (cfg.enable_vol_breakout !== undefined ? cfg.enable_vol_breakout : true);
      if (document.getElementById('alphaEnableTail')) document.getElementById('alphaEnableTail').checked = (cfg.enable_tail_feature !== undefined ? cfg.enable_tail_feature : false);
      if (document.getElementById('alphaCapital')) document.getElementById('alphaCapital').value = cfg.total_capital || 1000000;
      if (document.getElementById('alphaRiskR')) document.getElementById('alphaRiskR').value = cfg.risk_r_pct || 1.0;
      if (document.getElementById('alphaStopLoss')) document.getElementById('alphaStopLoss').value = cfg.stop_loss_pct || 3.5;
      if (document.getElementById('alphaTarget1')) document.getElementById('alphaTarget1').value = cfg.target1_profit_pct || 5.0;
      if (document.getElementById('alphaTarget2')) document.getElementById('alphaTarget2').value = cfg.target2_profit_pct || 10.0;
      if (document.getElementById('alphaMinRR')) document.getElementById('alphaMinRR').value = cfg.min_risk_reward_ratio || 1.5;
    }
  } catch (e) {
    console.warn('[AlphaCalc] 初始化配置回填异常:', e);
  }


  // 挂载全局智能联想下拉组件 (测算框、自选框、持仓框)
  const watchInputEl = document.getElementById('addWatchInput');
  const cleanAutofill = () => {
    if (watchInputEl && (watchInputEl.value === 'admin' || watchInputEl.value === 'root')) {
      watchInputEl.value = '';
    }
  };
  cleanAutofill();
  setTimeout(cleanAutofill, 100);
  setTimeout(cleanAutofill, 300);
  setTimeout(cleanAutofill, 800);
  setTimeout(cleanAutofill, 1500);

  setupStockAutocomplete(
    document.getElementById('alphaCalcInput'),
    document.getElementById('alphaCalcSuggest'),
    (item) => calculateAlphaSingle(item)
  );

  setupStockAutocomplete(
    watchInputEl,
    document.getElementById('addWatchSuggest'),
    (item) => quickAddWatchlist(item.code)
  );

  setupStockAutocomplete(
    document.getElementById('manualPosSymbol'),
    document.getElementById('manualPosSuggest'),
    (item) => {
      const codeEl = document.getElementById('manualPosSymbol');
      if (codeEl) codeEl.value = item.code;
    }
  );

  // 挂载板块资金流智能联想搜索
  const sectorInput = document.getElementById('sectorSearchInput');
  const sectorSuggest = document.getElementById('sectorSearchSuggest');
  const sectorClearBtn = document.getElementById('sectorSearchClearBtn');
  if (sectorInput && sectorSuggest) {
    // 强制防误填
    if (sectorInput.value === 'admin') sectorInput.value = '';

    sectorInput.addEventListener('input', () => {
      const val = sectorInput.value.trim();
      _sectorSearchKeyword = val;
      _sectorFlowsCurrentPage = 1;
      if (sectorClearBtn) sectorClearBtn.style.display = val ? 'block' : 'none';
      renderSectorFlowsTable();

      if (!val) {
        sectorSuggest.style.display = 'none';
        return;
      }

      const kw = val.toLowerCase();
      const matched = _allSectorFlows.filter(f => 
        (f.sector_name && f.sector_name.toLowerCase().includes(kw)) ||
        (f.leader_stock_name && f.leader_stock_name.toLowerCase().includes(kw))
      ).slice(0, 8);

      if (matched.length === 0) {
        sectorSuggest.innerHTML = '<div style="padding:10px;color:var(--sys-text-sub);font-size:12px;text-align:center">未找到匹配板块</div>';
        sectorSuggest.style.display = 'block';
        return;
      }

      sectorSuggest.innerHTML = matched.map(it => `
        <div class="autocomplete-item" data-name="${it.sector_name}">
          <div class="st-name">
            <span class="st-tag">${it.sector_type === 'concept' ? '概念' : '行业'}</span>
            <span>${it.sector_name}</span>
          </div>
          <div class="st-code" style="color:${it.change_pct >= 0 ? '#3fb950' : '#f85149'}">${it.change_pct >= 0 ? '+' : ''}${it.change_pct}% | 净流入 ${it.net_inflow_amount}亿</div>
        </div>
      `).join('');
      sectorSuggest.style.display = 'block';

      sectorSuggest.querySelectorAll('.autocomplete-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const sName = el.getAttribute('data-name');
          sectorInput.value = sName;
          _sectorSearchKeyword = sName;
          sectorSuggest.style.display = 'none';
          renderSectorFlowsTable();
        });
      });
    });

    document.addEventListener('click', (e) => {
      if (!sectorInput.contains(e.target) && !sectorSuggest.contains(e.target)) {
        sectorSuggest.style.display = 'none';
      }
    });
  }

  // 初始获取东方财富账户直连守护状态 (首屏一次性加载，不开启后台频繁轮询)
  fetchEastMoneyDaemonStatus();

  // 初始全量加载实盘持仓卡片与自选资产监控
  refreshPortfolioData();

  // 初始自动扫描
  setTimeout(scanAlphaCandidates, 400);
}


async function saveAlphaConfig() {
  const cfg = {
    filter_st: document.getElementById('alphaFilterSt')?.checked ?? true,
    enable_anti_thunder: document.getElementById('alphaEnableThunder')?.checked ?? true,
    min_daily_amount_billion: document.getElementById('alphaMinAmount')?.checked ? 3.5 : 0.0,
    allow_main: document.getElementById('alphaAllowMain')?.checked ?? true,
    allow_gem: document.getElementById('alphaAllowGem')?.checked ?? true,
    allow_star: document.getElementById('alphaAllowStar')?.checked ?? true,
    enable_ma_trend: document.getElementById('alphaEnableMaTrend')?.checked ?? true,
    enable_vol_breakout: document.getElementById('alphaEnableVolBreak')?.checked ?? true,
    enable_tail_feature: document.getElementById('alphaEnableTail')?.checked ?? false,
    total_capital: parseFloat(document.getElementById('alphaCapital')?.value || '1000000'),
    risk_r_pct: parseFloat(document.getElementById('alphaRiskR')?.value || '1.0'),
    stop_loss_pct: parseFloat(document.getElementById('alphaStopLoss')?.value || '3.5'),
    target1_profit_pct: parseFloat(document.getElementById('alphaTarget1')?.value || '5.0'),
    target2_profit_pct: parseFloat(document.getElementById('alphaTarget2')?.value || '10.0'),
    min_risk_reward_ratio: parseFloat(document.getElementById('alphaMinRR')?.value || '1.5'),
  };

  try {
    const res = await authFetch('/api/alpha/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(cfg),
    });
    if (res.ok) {
      showToast('规则配置已成功保存！', 'success');
      scanAlphaCandidates();
    } else {
      showToast('保存失败', 'error');
    }
  } catch(e) { showToast('请求失败: ' + e.message, 'error'); }
}


async function scanAlphaCandidates() {
  const btn = document.getElementById('alphaScanBtn');
  const statusSpan = document.getElementById('alphaScanStatus');
  const tbody = document.getElementById('alphaTableBody');
  const emptyBadge = document.getElementById('emptyDefenseBadge');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ 大浪淘沙漏斗筛选中...'; }
  if (statusSpan) statusSpan.textContent = '正在链式执行五大铁律四级漏斗过滤...';
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--sys-text-sub)"><span class="spinner"></span> 正在链式执行硬性排雷、大势共振、筹码天花板与盈亏比测算...</td></tr>`;

  try {
    const res = await authFetch('/api/alpha/scan');
    const data = await res.json();
    if (!res.ok || (data.code && data.code !== 200)) {
      showToast(data.detail || data.message || '扫描失败', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔍 立即全市场扫描'; }
      return;
    }

    _alphaScanData = data;

    // 1. 渲染四级大浪淘沙漏斗看板
    if (typeof renderFunnelBoard === 'function' && data.funnel_stats) {
      renderFunnelBoard(data.funnel_stats, data.total_scanned);
    }

    // 2. 渲染红黑找茬对比擂台
    if (typeof renderRedBlackArena === 'function' && data.red_black_arena) {
      renderRedBlackArena(data.red_black_arena);
    }

    // 3. 空仓防守勋章
    if (emptyBadge) {
      if (data.empty_defense_badge && data.empty_defense_badge.triggered) {
        emptyBadge.style.display = 'block';
      } else {
        emptyBadge.style.display = 'none';
      }
    }

    // 4. 模式指示灯
    const modeIndicator = document.getElementById('marketModeIndicator');
    if (modeIndicator && data.market_mode) {
      modeIndicator.innerHTML = `
        <span style="width:7px;height:7px;border-radius:50%;background:#60a5fa;box-shadow:0 0 6px #60a5fa"></span>
        <span>${data.market_mode}</span>
      `;
    }

    // 5. 核心：将通关的入围候选股票渲染到底部【尾盘 14:45 决策指令单】大表格中！
    renderAlphaCandidatesTable(data);

    const count = (data.candidates || data.results || []).length;
    showToast(`大浪淘沙完成，成功入围 ${count} 只黄金标的`, 'success');

  } catch (e) {
    showToast('扫描请求异常: ' + e.message, 'error');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#f85149">扫描异常: ${escapeHtml(e.message)}</td></tr>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 立即全市场扫描'; }
  }
}
window.scanAlphaCandidates = scanAlphaCandidates;

/**
 * 核心渲染：将筛选通关的标的完整填充到底部【尾盘 14:45 决策指令单】大表格
 */
function renderAlphaCandidatesTable(data) {
  const statusSpan = document.getElementById('alphaScanStatus');
  const tbody = document.getElementById('alphaTableBody');
  if (!tbody) return;

  const results = (data.candidates && data.candidates.length > 0) ? data.candidates : (data.results || []);
  const passedCount = data.total_candidates ?? data.passed_count ?? results.length;

  if (statusSpan) {
    statusSpan.innerHTML = `最近更新: <b style="color:var(--sys-accent)">${data.updated_at || new Date().toLocaleTimeString()}</b>，共筛选出 <b style="color:#3fb950">${passedCount}</b> 只符合执行标的`;
  }

  const RULE_EXPLANATIONS = {
    "均线多头排列": "【均线多头判定】5日均线 > 10日均线 > 20日均线，且现价高于20日均线，处于稳健上升主升浪通道。",
    "放量突破平台": "【放量突破判定】今日成交量 ≥ 过去5日均量的 1.8 倍，主力放量突破横盘平台。",
    "缩量回踩企稳": "【缩量回踩判定】股价回踩 5日/10日 关键均线未破，全天缩量 20% 以上，主力洗盘企稳信号。",
    "尾盘稳健收红": "【尾盘稳健判定】14:45 涨幅处于 +3.0% ~ +6.5% 黄金区间，涨势确立且留有冲高空间。",
    "主力资金持续净流入": "【主力做多判定】大单与特大单主力资金持续净买入，机构大资金坚决做多。",
    "硬性排雷通过": "【硬性排雷判定】剔除 ST/退市股，流通市值处于 50亿~400亿，日成交额 ≥ 3.5 亿元。",
    "流动性充沛(≥3.5亿)": "【流动性生存铁律】日成交额达标，流动性充足，杜绝死水股。",
    "大势共振良好": "【大势共振铁律】市场环境稳定，大盘无破位暴跌风险。",
    "无密集套牢峰压顶": "【筹码阻力铁律】距上方 60日套牢峰空间充裕，天花板高阔。",
    "盈亏比6.04:1优厚": "【盈亏比数学铁律】预期盈亏比远大于 1.5:1，赔率极佳。"
  };

  if (!results || results.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--sys-text-sub)">今日暂无符合全部严苛规则的候选标的，知行合一保持空仓</td></tr>`;
    return;
  }

  let rowsHtml = '';
  results.forEach(r => {
    const rulesBadges = (r.triggered_rules || []).map(rg => {
      const tip = RULE_EXPLANATIONS[rg] || `满足量化规则：${rg}`;
      return `<span style="display:inline-block;padding:2px 8px;margin:2px;font-size:11px;background:rgba(9,105,218,0.1);border:1px solid rgba(9,105,218,0.25);border-radius:4px;color:var(--sys-accent);cursor:help" title="${tip}"><i class="ri-checkbox-circle-line"></i> ${rg}</span>`;
    }).join('');
    
    const curPrice = Number(r.current_price != null ? r.current_price : (r.buy_price_low || 0));
    const buyLow = Number(r.buy_price_low != null ? r.buy_price_low : curPrice);
    const buyHigh = Number(r.buy_price_high != null ? r.buy_price_high : curPrice);
    const stopPrice = Number(r.stop_loss_price != null ? r.stop_loss_price : (curPrice * 0.95));
    const targetPrice = Number(r.target_price_1 != null ? r.target_price_1 : (curPrice * 1.1));
    const stopPct = r.stop_loss_pct != null ? r.stop_loss_pct : 5.0;
    const targetPct = r.target_profit_pct_1 != null ? r.target_profit_pct_1 : (r.resistance_margin || 15.0);
    const rrRatio = Number(r.risk_reward_ratio != null ? r.risk_reward_ratio : 2.0);
    const recShares = Number(r.recommended_shares || 100);
    const recAmt = Number(r.recommended_amount || (curPrice * recShares));
    const riskAmt = Number(r.risk_amount || 1000);

    let statusBadge = '';
    if (r.status === 'BUY' || r.status === '待执行') {
      statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:rgba(63,185,80,0.15);color:#3fb950;font-weight:700;border:1px solid rgba(63,185,80,0.3)">● 建议建仓</span>`;
    } else if (String(r.status || '').includes('拦截') || (rrRatio > 0 && rrRatio < 1.5)) {
      statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:rgba(248,81,73,0.15);color:#f85149;font-weight:700;border:1px solid rgba(248,81,73,0.3)">⚠️ 盈亏比不足</span>`;
    } else {
      statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:rgba(16,185,129,0.15);color:#10b981;font-weight:700;border:1px solid rgba(16,185,129,0.3)">● 铁律通关</span>`;
    }

    const rrColor = rrRatio >= 2.0 ? '#3fb950' : (rrRatio >= 1.5 ? '#f0883e' : '#f85149');

    rowsHtml += `
      <tr style="border-bottom:1px solid var(--sys-border);transition:background 0.15s" onmouseover="this.style.background='var(--sys-bg-hover)'" onmouseout="this.style.background='transparent'">
        <td style="padding:12px 8px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div>
              <b style="color:var(--sys-text-title);font-size:14px">${escapeHtml(r.name || '')}</b><br>
              <span style="color:var(--sys-text-sub);font-size:12px;font-family:monospace">${escapeHtml(r.symbol || '')}</span>
            </div>
            <button type="button" onclick="jumpToBacktestFromScan('${r.symbol}')" 
              class="el-tag el-tag--primary el-tag--small" 
              style="cursor:pointer;font-size:10.5px;padding:2px 8px;border-radius:4px;font-weight:600" 
              title="点击直接将该股票载入个股战法穿透实验室">
              战法穿透 ➔
            </button>
          </div>
        </td>
        <td style="padding:12px 8px">${rulesBadges || '<span style="color:var(--sys-text-sub);font-size:11px">五大交易铁律全部通过</span>'}</td>
        <td style="padding:12px 8px;font-weight:700;color:var(--sys-text-title)">${curPrice > 0 ? '¥' + curPrice.toFixed(2) : '--'}</td>
        <td style="padding:12px 8px;color:var(--sys-accent);font-weight:600">${buyLow > 0 ? '¥' + buyLow.toFixed(2) + ' ~ ¥' + buyHigh.toFixed(2) : '--'}</td>
        <td style="padding:12px 8px;color:#f85149">
          <b>${stopPrice > 0 ? '¥' + stopPrice.toFixed(2) : '--'}</b>
          <span style="font-size:11px;display:block">(-${stopPct}%)</span>
        </td>
        <td style="padding:12px 8px;color:#3fb950">
          <b>${targetPrice > 0 ? '¥' + targetPrice.toFixed(2) : '--'}</b>
          <span style="font-size:11px;display:block">(+${targetPct.toFixed(1)}%)</span>
        </td>
        <td style="padding:12px 8px;font-weight:800;color:${rrColor};font-size:14px">${rrRatio > 0 ? rrRatio.toFixed(2) + ':1' : '--'}</td>
        <td style="padding:12px 8px">
          <b style="color:var(--sys-text-title)">${recShares.toLocaleString()} 股</b><br>
          <span style="color:var(--sys-text-sub);font-size:11px">约 ¥${(recAmt/10000).toFixed(1)}万 (1%风控:¥${riskAmt.toFixed(0)})</span>
        </td>
        <td style="padding:12px 8px">${statusBadge}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;
}

/** 从选股扫描结果一键跳转到个股战法穿透实验室 */
function jumpToBacktestFromScan(symbol) {
  if (typeof switchAlphaSubTab === 'function') {
    switchAlphaSubTab('backtest');
  }
  const inputEl = document.getElementById('btSingleStockInput');
  if (inputEl) {
    inputEl.value = symbol;
  }
  if (typeof startSingleStockBacktest === 'function') {
    startSingleStockBacktest(symbol);
  }
}
window.jumpToBacktestFromScan = jumpToBacktestFromScan;

async function calculateAlphaSingle(preselectedItem) {
  const input = document.getElementById('alphaCalcInput');
  let targetCode = '';
  if (preselectedItem) {
    targetCode = typeof preselectedItem === 'object' ? (preselectedItem.code || preselectedItem.symbol || '') : String(preselectedItem);
  } else if (input) {
    targetCode = input.dataset.selectedCode || input.value.trim();
  }
  const resultBox = document.getElementById('alphaCalcResult');

  if (!targetCode) { showToast('请输入或从联想下拉中选择股票/ETF', 'error'); return; }

  // 如果输入的是包含括号的复合文本，提取代码
  let cleanCode = targetCode;
  const match = targetCode.match(/\(([^)]+)\)/);
  if (match) {
    cleanCode = match[1].trim();
  }


  if (resultBox) resultBox.innerHTML = '<div style="color:var(--sys-text-sub);text-align:center;padding:20px"><span class="spinner"></span> 正在实时拉取真实行情并按战法测算买卖点...</div>';

  try {
    const playbookSelect = document.getElementById('alphaPlaybookSelect');
    const playbookId = playbookSelect ? playbookSelect.value : 'auto';

    const res = await authFetch('/api/alpha/calculate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol: cleanCode, playbook_id: playbookId}),
    });
    const data = await res.json();
    if (!res.ok) {
      if (resultBox) resultBox.innerHTML = `<div style="color:#f85149;padding:10px">测算失败: ${data.detail || '未找到标的'}</div>`;
      return;
    }

    const r = data.result;
    const isSafe = r.risk_reward_ratio >= 2.0;
    const rrColor = isSafe ? '#3fb950' : '#f85149';
    const pb = r.playbook_info || {};

    if (resultBox) {
      window._lastAlphaCalcResult = r; // 暂存测算结果供一键入库使用

      const kb = r.kb_insight || {};
      const steps = kb.logic_steps || {};

      resultBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <b style="font-size:16px;color:#0f172a">${escapeHtml(r.name)}</b>
            <span style="color:#64748b;font-size:13px;font-family:monospace;background:#f1f5f9;padding:1px 6px;border-radius:4px">${escapeHtml(r.symbol)}</span>
            <span style="color:#2563eb;font-weight:700;font-size:15px">¥${r.current_price.toFixed(2)}</span>
            <span class="${r.change_pct >= 0 ? 'stock-up' : 'stock-down'}" style="font-size:13px;color:${r.change_pct >= 0 ? '#f85149' : '#3fb950'} !important;font-weight:700 !important">${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(2)}%</span>
          </div>
          <div>
            ${isSafe ? '<span style="color:#059669;font-weight:700;font-size:12px;background:#ecfdf5;padding:3px 10px;border-radius:6px;border:1px solid #a7f3d0">● 盈亏比达标</span>' : '<span style="color:#dc2626;font-weight:700;font-size:12px;background:#fef2f2;padding:3px 10px;border-radius:6px;border:1px solid #fecaca">⚠️ 盈亏比不足 2.0 建议拦截</span>'}
          </div>
        </div>

        <!-- 🔥 核心异动透视：为什么涨百分之十与 X (Twitter) 讨论直通 -->
        ${(() => {
          const wr = r.why_rise || {};
          const concepts = wr.concepts || [];
          const riseTitle = wr.rise_title || (r.change_pct >= 0 ? '🔥 今日大涨驱动透视' : '📌 个股异动透视');
          const riseDesc = wr.rise_desc || '依托核心主线题材回流与突破形态共振。';
          const twHits = wr.twitter_hits || [];
          const isUp = r.change_pct >= 0;
          const bannerBg = isUp ? 'linear-gradient(135deg, rgba(254,242,242,0.9), rgba(255,255,255,0.95))' : 'linear-gradient(135deg, rgba(240,253,244,0.9), rgba(255,255,255,0.95))';
          const borderColor = isUp ? '#fecaca' : '#bbf7d0';
          const titleColor = isUp ? '#dc2626' : '#16a34a';

          return `
            <div style="background:${bannerBg};border:1px solid ${borderColor};border-radius:8px;padding:12px 14px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.03)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px">
                <div style="font-size:13px;font-weight:800;color:${titleColor};display:flex;align-items:center;gap:6px">
                  <i class="ri-fire-fill" style="font-size:15px"></i>
                  <span>${escapeHtml(riseTitle)}</span>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <button class="btn btn-outline" style="padding:2px 10px;font-size:11px;border-color:#1d9bf0;color:#1d9bf0;background:rgba(29,155,240,0.06);display:inline-flex;align-items:center;gap:4px;border-radius:4px" onclick="jumpToTwitterSearch('${escapeHtml(r.name)}')">
                    <i class="ri-twitter-x-line"></i>
                    <span>在 X 雷达中查看【${escapeHtml(r.name)}】博主推文 ➜</span>
                  </button>
                </div>
              </div>

              <div style="font-size:12.5px;color:#334155;line-height:1.5;margin-bottom:8px">
                ${escapeHtml(riseDesc)}
              </div>

              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-size:11px;color:#64748b;font-weight:600">关联题材：</span>
                ${concepts.map(c => `<span style="font-size:11px;background:#ffffff;border:1px solid #cbd5e1;color:#1e293b;padding:1px 8px;border-radius:12px;font-weight:600">${escapeHtml(c)}</span>`).join('')}
              </div>

              ${twHits.length > 0 ? `
                <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;font-size:11.5px;color:#475569">
                  <span style="color:#1d9bf0;font-weight:700">🐦 X 顶级博主最新观点：</span>
                  <span style="color:#0f172a;font-weight:600">@${escapeHtml(twHits[0].author_name || twHits[0].author_handle)}:</span>
                  <span>"${escapeHtml((twHits[0].text || '').slice(0, 80))}..."</span>
                </div>
              ` : ''}
            </div>
          `;
        })()}

        <!-- 🎯 六大专属战法深度绑定与实战胜率卡片 -->
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
          <div style="flex:1;padding-right:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
              <span style="font-size:13.5px;font-weight:700;color:#1e40af">${escapeHtml(pb.playbook_name || '专属量化战法')}</span>
              <span style="font-size:11px;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px;font-weight:600">${escapeHtml(pb.playbook_style || '短线波段')}</span>
              ${pb.adaptive_status === 'hot' ? '<span style="font-size:11px;background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:12px;font-weight:700">🔥 主力推荐 (提仓放行)</span>' :
                pb.adaptive_status === 'cooling' ? '<span style="font-size:11px;background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:12px;font-weight:700">⚠️ 逆风防守 (减仓至50%)</span>' :
                pb.adaptive_status === 'frozen' ? '<span style="font-size:11px;background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:12px;font-weight:700">❄️ 战法冷冻 (暂停)</span>' :
                '<span style="font-size:11px;background:#e0e7ff;color:#4338ca;padding:2px 8px;border-radius:12px;font-weight:600">⚖️ 稳定运行 (基准仓位)</span>'}
            </div>
            <div style="font-size:12px;color:#1e3a8a;line-height:1.4">
              ${escapeHtml(pb.rule_rationale || '')}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;padding-left:14px;border-left:1px dashed #93c5fd">
            <div style="font-size:11px;color:#4b5563">历史实操胜率</div>
            <div style="font-size:18px;font-weight:700;color:#2563eb">${pb.win_rate != null ? pb.win_rate : 50}%</div>
            <div style="font-size:11px;color:#4b5563">建议仓位: <b style="color:#0f172a">${pb.adaptive_position_pct || r.position_pct || 30}%</b></div>
          </div>
        </div>

        <!-- 6 维关键指标 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-bottom:12px;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #e2e8f0">
          <div title="当前撮合价上下浮动 0.5% 的安全建仓区间">建议买入区间：<b style="color:#2563eb">¥${r.buy_price_low.toFixed(2)} ~ ¥${r.buy_price_high.toFixed(2)}</b></div>
          <div title="结合 3.5% 固定风控底线与前一日最低价、MA5 支撑位智能测算，跌破必须果断认错">硬性防守止损：<b style="color:#dc2626">¥${r.stop_loss_price.toFixed(2)} (${r.stop_loss_pct}%)</b></div>
          <div title="短线波段第一止盈目标位 (+6.0%)">第一止盈目标：<b style="color:#16a34a">¥${r.target_price_1.toFixed(2)} (+${r.target_profit_pct_1}%)</b></div>
          <div title="波段第二止盈目标位 (+12.0%)">第二止盈目标：<b style="color:#16a34a">¥${r.target_price_2.toFixed(2)} (+${r.target_profit_pct_2}%)</b></div>
          <div title="预期止盈空间与风险之比">预期盈亏比：<b style="color:${rrColor};font-size:13.5px;font-weight:700">${r.risk_reward_ratio} : 1</b></div>
          <div title="华尔街 1% 风险倒算模型：单笔最大损失限制在账户的 1%">单笔 1% 风险建仓：<b style="color:#0f172a;font-weight:700">${r.recommended_shares.toLocaleString()} 股 (约 ¥${(r.recommended_amount/10000).toFixed(1)}万)</b></div>
        </div>

        <!-- 📖 本地经典量化名著大典权威出处与原文精髓 -->
        ${kb.book_title ? `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:12px 14px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-size:12.5px;font-weight:700;color:#0369a1;display:flex;align-items:center;gap:6px">
              <i class="ri-book-read-line" style="font-size:15px"></i>
              <span>依据名著大典：${escapeHtml(kb.book_title)}</span>
            </div>
            <span style="font-size:11.5px;color:#0284c7;background:#e0f2fe;padding:1px 8px;border-radius:4px;border:1px solid #7dd3fc">${escapeHtml(kb.chapter || '')}</span>
          </div>
          <div style="font-size:12px;color:#334155;line-height:1.6;font-style:italic;background:#ffffff;padding:8px 10px;border-radius:4px;border:1px solid #e0f2fe;margin-bottom:8px">
            ${escapeHtml(kb.quote || '')}
          </div>
          <div style="font-size:11.5px;color:#0284c7;font-weight:600">
            🎯 核心战法体系：${escapeHtml(kb.rule_name || '')}
          </div>
        </div>
        ` : ''}

        <!-- 🧠 4 步连贯逻辑推导闭环 (哲学 -> 形态 -> 仓位 -> 打脸标准) -->
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin-bottom:12px">
          <div style="font-size:12.5px;font-weight:700;color:#0f172a;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <i class="ri-brain-line" style="color:#2563eb"></i> 🧠 4 步连贯推导逻辑链 (客观·严谨·对账打脸底稿)
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#475569;line-height:1.6">
            <div style="background:#f8fafc;padding:8px 10px;border-radius:4px;border-left:3px solid #2563eb">
              <b>① 哲学公理：</b>${escapeHtml(steps.philosophy || '')}
            </div>
            <div style="background:#f8fafc;padding:8px 10px;border-radius:4px;border-left:3px solid #10b981">
              <b>② 形态映射：</b>${escapeHtml(steps.pattern_mapping || '')}
            </div>
            <div style="background:#f8fafc;padding:8px 10px;border-radius:4px;border-left:3px solid #f59e0b">
              <b>③ 防守与仓位：</b>${escapeHtml(steps.defense_logic || '')}
            </div>
            <div style="background:#f8fafc;padding:8px 10px;border-radius:4px;border-left:3px solid #ef4444">
              <b>④ 对账打脸验证标准：</b>${escapeHtml(steps.verification_rule || '')}
            </div>
          </div>
        </div>

        <!-- 动作操作条：一键存入预测对账库 -->
        <div style="display:flex;justify-content:space-between;align-items:center;background:#f8fafc;padding:10px 14px;border-radius:6px;border:1px solid #e2e8f0">
          <span style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:4px">
            <i class="ri-information-line" style="color:#2563eb"></i> 点击右侧按钮将上述严密底稿直接存库，次日 15:00 自动对账验证！
          </span>
          <button type="button" class="btn btn-primary" onclick="saveCalcToPrediction()" style="padding:6px 18px;font-size:12.5px;font-weight:600;background:#2563eb;border-color:#2563eb;border-radius:6px;display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 4px rgba(37,99,235,0.2)">
            <i class="ri-save-line"></i>
            <span>📥 一键存入今日预测对账库 (供次日打脸)</span>
          </button>
        </div>
      `;
    }
    showToast(`已完成 ${r.name} 深度逻辑测算`, 'success');
  } catch(e) {
    if (resultBox) resultBox.innerHTML = `<div style="color:#f85149">请求异常: ${e.message}</div>`;
  }
}

/**
 * 将当前测算结果一键存入预测对账库
 */
async function saveCalcToPrediction() {
  const r = window._lastAlphaCalcResult;
  if (!r) {
    showToast('暂无有效测算结果', 'warning');
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const payload = {
    record_date: todayStr,
    stock_code: r.symbol,
    stock_name: r.name,
    direction: 'buy', // 测算器默认买入做多模型
    entry_price: r.current_price,
    target_price: r.target_price_1,
    stop_loss: r.stop_loss_price,
    confidence: 5,
    reason: r.summary || r.reason || '华尔街 1% 风险买卖点模型智能测算推荐',
    tags: '华尔街1%模型,量化测算'
  };

  try {
    const resp = await authFetch('/api/prediction/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data.code === 200) {
      showToast(`✅ 已将 ${r.name} (${r.symbol}) 成功写入今日操盘预测库！`, 'success');
      loadJudgeRecords();
      loadJudgeStats();
    } else {
      showToast(data.message || '保存失败', 'error');
    }
  } catch (e) {
    showToast('网络异常: ' + e.message, 'error');
  }
}


async function pushAlphaAlert() {
  const btn = document.getElementById('alphaPushBtn');
  if (btn) { btn.disabled = true; btn.textContent = '推送中...'; }
  try {
    const res = await authFetch('/api/alpha/push-alert', {method: 'POST'});
    const data = await res.json();
    if (res.ok) {
      showToast('已成功触发尾盘决战简报卡片推送！', 'success');
      const cardBox = document.getElementById('alphaCardPreview');
      if (cardBox && data.card?.markdown?.text) {
        cardBox.textContent = data.card.markdown.text;
      }
    } else {
      showToast(data.detail || '推送失败', 'error');
    }
  } catch(e) {
    showToast('请求失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📲 尾盘卡片推送'; }
  }
}


function quickJumpToCalculate(sym) {
  if (!sym) return;

  // 1. 确保系统主分类在实盘决策台
  if (typeof switchCategory === 'function') {
    switchCategory('alpha');
  }

  // 2. 切换到尾盘 14:45 决策子页面
  if (typeof switchAlphaSubTab === 'function') {
    switchAlphaSubTab('decision');
  }

  // 3. 注入股票代码并即刻触发实时测算
  const input = document.getElementById('alphaCalcInput');
  if (input) {
    input.value = sym;
    if (input.dataset) input.dataset.selectedCode = sym;
  }
  if (typeof calculateAlphaSingle === 'function') {
    calculateAlphaSingle(sym);
  }

  // 4. 🎯 一步到位瞬间定点直达：双重精准定位，绝无任何偏移歧义！
  const scrollToTarget = () => {
    const calcPanel = document.getElementById('alphaCalcPanel') || document.getElementById('alphaCalcResult') || input;
    if (calcPanel) {
      const rect = calcPanel.getBoundingClientRect();
      const targetY = window.pageYOffset + rect.top - 75;
      window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });

      // 耀眼聚焦光效动效，瞬间抓住用户视线
      calcPanel.style.transition = 'all 0.25s ease';
      calcPanel.style.boxShadow = '0 0 0 3px #2563eb, 0 10px 30px rgba(37, 99, 235, 0.25)';
      calcPanel.style.borderColor = '#2563eb';
      setTimeout(() => {
        calcPanel.style.boxShadow = '';
        calcPanel.style.borderColor = '';
      }, 2500);
    }
  };

  scrollToTarget();
  setTimeout(scrollToTarget, 80);
  setTimeout(scrollToTarget, 300);
}

// 🐦 全局辅助：一键直达 X (Twitter) 顶级博主情报雷达并检索特定标的
function jumpToTwitterSearch(keyword) {
  if (typeof switchAlphaSubTab === 'function') {
    switchAlphaSubTab('twitter');
  }
  const kwInput = document.getElementById('twitterSearchKeyword');
  if (kwInput) kwInput.value = keyword;
  if (typeof _twitterKeyword !== 'undefined') _twitterKeyword = keyword;
  if (typeof _twitterCurrentPage !== 'undefined') _twitterCurrentPage = 1;
  if (typeof loadTwitterRadar === 'function') {
    loadTwitterRadar(false);
  }
  setTimeout(() => {
    const grid = document.getElementById('twitterTweetsGrid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
}
window.jumpToTwitterSearch = jumpToTwitterSearch;

function copyAlphaCardText() {
  const cardBox = document.getElementById('alphaCardPreview');
  const text = cardBox ? cardBox.innerText || cardBox.textContent : '';
  if (!text) { showToast('暂无简报内容', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制尾盘决战简报到剪贴板！', 'success');
  }).catch(() => {
    showToast('复制失败，请手动选择复制', 'error');
  });
}



// 显式导出全局调用接口，保障所有 HTML 内联事件 100% 正常调用
if (typeof switchAlphaSubTab !== "undefined") window.switchAlphaSubTab = switchAlphaSubTab;
window.scanAlphaCandidates = scanAlphaCandidates;
window.calculateAlphaSingle = calculateAlphaSingle;
window.calculateAlpha = calculateAlphaSingle;
window.saveAlphaConfig = saveAlphaConfig;
window.pushAlphaAlert = pushAlphaAlert;
window.copyAlphaCardText = copyAlphaCardText;
window.quickJumpToCalculate = quickJumpToCalculate;
window.initAlphaDeskCalc = initAlphaDesk;


// ==============================================================================
// 🏛️ 五大交易铁律、行话人话字典与四级漏斗大浪淘沙交互逻辑
// ==============================================================================

let _cachedLaws = [];
let _cachedGlossary = {};

// 加载铁律元数据与行话字典
async function loadLawsAndGlossary() {
  try {
    const res = await fetch('/api/alpha/glossary');
    const data = await res.json();
    if (data.code === 200) {
      _cachedLaws = data.laws || [];
      _cachedGlossary = data.glossary || {};
    }
  } catch (e) {
    console.error('加载铁律字典失败:', e);
  }
}
document.addEventListener('DOMContentLoaded', loadLawsAndGlossary);

// 打开铁律详情弹窗
window.openLawModal = function(lawId) {
  const modal = document.getElementById('tradingLawModal');
  const title = document.getElementById('lawModalTitle');
  const body = document.getElementById('lawModalBody');
  if (!modal || !body) return;

  const law = _cachedLaws.find(l => l.id === lawId);
  if (!law) return;

  title.textContent = `${law.name}（${law.short_title}）`;
  title.style.color = law.color || '#58a6ff';

  body.innerHTML = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid var(--sys-border);border-radius:8px;padding:14px;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700;color:var(--sys-text-title);margin-bottom:6px">📢 操盘心法口诀</div>
      <div style="font-size:13px;color:${law.color};font-weight:600">"${law.slogan}"</div>
    </div>

    <div style="margin-bottom:12px">
      <b style="color:var(--sys-text-title)">🎯 硬性指标门槛：</b>
      <span style="color:var(--sys-accent);font-weight:700">${law.metric}</span>
      <div style="font-size:12px;color:var(--sys-text-sub);margin-top:2px">${law.metric_desc}</div>
    </div>

    <div style="margin-bottom:12px;background:rgba(239,68,68,0.06);border-left:3px solid #ef4444;padding:8px 12px;border-radius:0 6px 6px 0">
      <b style="color:#ef4444">💣 散户常见死穴（大白话）：</b>
      <div style="font-size:12px;color:var(--sys-text-sub);margin-top:4px">${law.trap_plain}</div>
    </div>

    <div style="margin-bottom:12px;background:rgba(88,166,255,0.06);border-left:3px solid #58a6ff;padding:8px 12px;border-radius:0 6px 6px 0">
      <b style="color:#58a6ff">🕵️ 主力庄家背后在想什么：</b>
      <div style="font-size:12px;color:var(--sys-text-sub);margin-top:4px">${law.dealer_mind}</div>
    </div>

    <div style="background:rgba(245,158,11,0.06);border-left:3px solid #f59e0b;padding:8px 12px;border-radius:0 6px 6px 0">
      <b style="color:#f59e0b">⚡ 违规血泪代价：</b>
      <div style="font-size:12px;color:var(--sys-text-sub);margin-top:4px">${law.violation_consequence}</div>
    </div>
  `;

  modal.style.display = 'flex';
};

window.closeLawModal = function() {
  const modal = document.getElementById('tradingLawModal');
  if (modal) modal.style.display = 'none';
};

// 打开行话字典弹窗
window.openGlossaryModal = function(termKey) {
  const modal = document.getElementById('glossaryModal');
  const body = document.getElementById('glossaryModalBody');
  if (!modal || !body) return;

  let html = '';
  const entries = (termKey === 'all' || !termKey) 
    ? Object.entries(_cachedGlossary) 
    : [[termKey, _cachedGlossary[termKey]]];

  for (const [key, item] of entries) {
    if (!item) continue;
    html += `
      <div style="background:var(--sys-bg-sub);border:1px solid var(--sys-border);border-radius:8px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <b style="font-size:15px;color:var(--sys-accent)">${item.term}</b>
          <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(88,166,255,0.15);color:#58a6ff">${item.jargon}</span>
        </div>
        <div style="margin-top:6px;font-size:13px;color:var(--sys-text-title);line-height:1.6">
          <b style="color:#10b981">【操盘手人话大白话】：</b>${item.plain}
        </div>
        <div style="margin-top:6px;font-size:12px;color:var(--sys-text-sub);line-height:1.5">
          <b style="color:#f59e0b">【主力真实博弈心理】：</b>${item.dealer}
        </div>
      </div>
    `;
  }

  body.innerHTML = html || '<div style="color:var(--sys-text-sub);text-align:center">暂无术语详情</div>';
  modal.style.display = 'flex';
};

window.closeGlossaryModal = function() {
  const modal = document.getElementById('glossaryModal');
  if (modal) modal.style.display = 'none';
};

// 打开单只标的五大铁律深度体检弹窗
window.openDiagnoseModal = async function(symbol, name) {
  const modal = document.getElementById('stockDiagnoseModal');
  const header = document.getElementById('diagModalHeader');
  const sub = document.getElementById('diagModalSub');
  const badge = document.getElementById('diagModalVerdictBadge');
  const body = document.getElementById('diagModalBody');
  if (!modal || !body) return;

  header.textContent = `🩺 正在对 ${name || symbol} (${symbol}) 执行五大铁律穿透体检...`;
  badge.textContent = '检测中';
  badge.style.background = 'rgba(255,255,255,0.1)';
  badge.style.color = '#fff';
  sub.textContent = '正在获取 60 日 OHLCV 历史 K 线并测算价格-成交量筹码密集峰...';
  body.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner"></span> 正在链式检测流动性、大势共振、筹码密集峰天花板与盈亏比...</div>';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/alpha/diagnose?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name || '')}`);
    const data = await res.json();
    if (data.code !== 200) {
      body.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center">体检失败: ${data.message || '网络异常'}</div>`;
      return;
    }

    header.textContent = `🩺 ${data.name} (${data.symbol}) 五大铁律体检报告`;
    sub.innerHTML = `现价: <b style="color:#58a6ff">¥${data.current_price}</b> (${data.change_pct >= 0 ? '+' : ''}${data.change_pct}%) | 今日成交额: <b>${data.amount_billion} 亿元</b>`;

    if (data.all_passed) {
      badge.textContent = '🏆 完美通关';
      badge.style.background = 'rgba(16,185,129,0.2)';
      badge.style.color = '#10b981';
    } else {
      badge.textContent = '⚠️ 触犯铁律枪毙';
      badge.style.background = 'rgba(239,68,68,0.2)';
      badge.style.color = '#ef4444';
    }

    // 渲染筹码天花板卡片
    const chips = data.chips || {};
    const tech = data.technicals || {};

    let html = `
      <!-- 筹码天花板特写视窗 -->
      <div style="background:${chips.has_heavy_resistance ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)'};border:1px solid ${chips.has_heavy_resistance ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};border-radius:8px;padding:14px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <b style="font-size:14px;color:${chips.has_heavy_resistance ? '#ef4444' : '#10b981'}">
            ${chips.has_heavy_resistance ? '🚨 头顶密集套牢峰天花板预警' : '🌤️ 上方筹码通畅 · 安全腾挪空间充裕'}
          </b>
          <span style="font-size:12px;font-weight:700">天花板空间: +${chips.margin_pct}%</span>
        </div>
        <div style="font-size:13px;color:var(--sys-text-title)">${chips.chips_description}</div>
        <div style="display:flex;gap:16px;margin-top:8px;font-size:12px;color:var(--sys-text-sub)">
          <span>阻力目标价: <b style="color:var(--sys-accent)">¥${chips.resistance_price}</b></span>
          <span>防守止损价: <b style="color:#ef4444">¥${tech.stop_loss_price}</b></span>
          <span>攻防盈亏比: <b style="color:#10b981">${tech.risk_reward_ratio} : 1</b></span>
        </div>
      </div>

      <!-- 五大铁律逐项检验列表 -->
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
    `;

    for (const v of (data.verdicts || [])) {
      const isPassed = v.passed;
      html += `
        <div style="background:var(--sys-bg-sub);border:1px solid var(--sys-border);border-left:4px solid ${isPassed ? '#10b981' : '#ef4444'};border-radius:0 6px 6px 0;padding:10px 14px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:16px">${isPassed ? '✅' : '❌'}</span>
              <b style="font-size:13px;color:var(--sys-text-title)">${v.name}</b>
            </div>
            <span style="font-size:11px;font-weight:700;color:${isPassed ? '#10b981' : '#ef4444'}">
              ${isPassed ? '通过' : '违规否决'}
            </span>
          </div>
          <div style="font-size:12px;color:var(--sys-text-sub);margin-top:4px">${v.detail}</div>
          <div style="font-size:12px;color:${isPassed ? 'var(--sys-text-sub)' : '#f87171'};margin-top:2px;font-style:italic">
            💡 ${v.comment}
          </div>
        </div>
      `;
    }

    html += `
      </div>

      <!-- 1% 纪律定仓指引 -->
      <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.25);border-radius:8px;padding:12px 14px">
        <b style="color:#8b5cf6;font-size:13px">📐 操盘手算命定仓（严格执行 1% 风险纪律）</b>
        <div style="font-size:12px;color:var(--sys-text-sub);margin-top:4px">
          假设账户总资金 10 万元，单笔最大允许风险暴露为 1% (即亏损上限 ¥1,000)：<br>
          买入单价 ¥${data.current_price}，破位止损价 ¥${tech.stop_loss_price}，单股风险敞口 ¥${(data.current_price - tech.stop_loss_price).toFixed(2)}。<br>
          👉 <b>建议单笔买入上限：<span style="color:#8b5cf6;font-size:15px;font-weight:700">${tech.shares_1pct}</span> 股</b> (约合 ¥${(tech.shares_1pct * data.current_price).toFixed(0)} 元)，严禁情绪化超仓！
        </div>
      </div>
    `;

    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center">体检网络异常: ${e.message}</div>`;
  }
};

window.closeDiagnoseModal = function() {
  const modal = document.getElementById('stockDiagnoseModal');
  if (modal) modal.style.display = 'none';
};

// 触发实盘持仓批量体检
window.triggerHoldingsDiagnosis = async function() {
  showToast('正在从东财账户同步持仓并执行五大铁律体检...', 'info');
  try {
    const res = await authFetch('/api/portfolio/list');
    const data = await res.json();
    const positions = (data && (data.positions || data.data?.positions)) || [];
    if (!positions || positions.length === 0) {
      showToast('当前东财实盘账户暂无持仓股票', 'info');
      return;
    }
    // 默认体检第一只持仓股
    const target = positions[0];
    const code = target.stock_code || target.code || target.symbol;
    const name = target.stock_name || target.name || '';
    openDiagnoseModal(code, name);
  } catch (e) {
    showToast('获取持仓数据异常: ' + e.message, 'error');
  }
};

// 触发自选股票批量体检
window.triggerWatchlistDiagnosis = async function() {
  showToast('正在从东财同步自选列表...', 'info');
  try {
    const res = await authFetch('/api/portfolio/list');
    const data = await res.json();
    const watchlist = (data && (data.watchlist || data.data?.watchlist)) || [];
    if (!watchlist || watchlist.length === 0) {
      showToast('当前自选列表暂无股票', 'info');
      return;
    }
    const target = watchlist[0];
    const code = target.stock_code || target.code || target.symbol;
    const name = target.stock_name || target.name || '';
    openDiagnoseModal(code, name);
  } catch (e) {
    showToast('获取自选数据异常: ' + e.message, 'error');
  }
};

// 渲染大浪淘沙四级漏斗看板
function renderFunnelBoard(stats, totalStart) {
  const section = document.getElementById('funnelBoardSection');
  const container = document.getElementById('funnelStepsContainer');
  const summary = document.getElementById('funnelSummaryText');
  if (!section || !container || !stats) return;

  summary.textContent = `初始 ${stats.total} 只 ➔ 最终通关 ${stats.final_winner_count} 只 (淘汰率 ${(((stats.total - stats.final_winner_count) / stats.total) * 100).toFixed(1)}%)`;

  container.innerHTML = `
    <!-- 初始池 -->
    <div style="background:var(--sys-bg-sub);border:1px solid var(--sys-border);border-radius:8px;padding:10px">
      <div style="font-size:11px;color:var(--sys-text-sub)">初始龙头池</div>
      <div style="font-size:20px;font-weight:700;color:var(--sys-accent);margin:2px 0">${stats.total}</div>
      <div style="font-size:10px;color:var(--sys-text-sub)">全市场活跃标的</div>
    </div>

    <!-- 关卡一 -->
    <div style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:10px">
      <div style="font-size:11px;color:#ef4444">① 流动性关卡</div>
      <div style="font-size:20px;font-weight:700;color:var(--sys-text-title);margin:2px 0">${stats.stage1_passed}</div>
      <div style="font-size:10px;color:#ef4444">淘汰 ${stats.stage1_rejected} 只死水股</div>
    </div>

    <!-- 关卡二 -->
    <div style="background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:10px">
      <div style="font-size:11px;color:#f59e0b">② 大势共振关卡</div>
      <div style="font-size:20px;font-weight:700;color:var(--sys-text-title);margin:2px 0">${stats.stage2_passed}</div>
      <div style="font-size:10px;color:#f59e0b">逆势淘汰 ${stats.stage2_rejected} 只</div>
    </div>

    <!-- 关卡三 -->
    <div style="background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:10px">
      <div style="font-size:11px;color:#10b981">③ 筹码天花板关卡</div>
      <div style="font-size:20px;font-weight:700;color:var(--sys-text-title);margin:2px 0">${stats.stage3_passed}</div>
      <div style="font-size:10px;color:#10b981">压顶淘汰 ${stats.stage3_rejected} 只</div>
    </div>

    <!-- 关卡四 -->
    <div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px">
      <div style="font-size:11px;color:#3b82f6">④ 盈亏比数学关卡</div>
      <div style="font-size:20px;font-weight:700;color:#10b981;margin:2px 0">${stats.stage4_passed}</div>
      <div style="font-size:10px;color:#3b82f6">赔率差淘汰 ${stats.stage4_rejected} 只</div>
    </div>
  `;

  section.style.display = 'block';
}

// 渲染红黑找茬对比擂台
function renderRedBlackArena(arena) {
  const section = document.getElementById('redBlackArenaSection');
  const cardsBox = document.getElementById('redBlackArenaCards');
  const diffBox = document.getElementById('redBlackDiffTable');
  if (!section || !cardsBox || !arena) return;

  const winner = arena.winner;
  const loser = arena.loser;

  if (!winner && !loser) {
    section.style.display = 'none';
    return;
  }

  cardsBox.innerHTML = `
    <!-- 红榜：真突破榜样 -->
    <div style="background:rgba(16,185,129,0.06);border:2px solid rgba(16,185,129,0.4);border-radius:10px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:20px">🟢</span>
          <b style="font-size:16px;color:#10b981">真突破 · 黄金标杆</b>
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(16,185,129,0.2);color:#10b981;font-weight:700">四级铁律通关</span>
      </div>

      ${winner ? `
        <div style="font-size:18px;font-weight:700;color:var(--sys-text-title);margin-bottom:4px">
          ${winner.name} <span style="font-size:14px;color:var(--sys-text-sub)">(${winner.symbol})</span>
        </div>
        <div style="font-size:13px;color:var(--sys-text-sub);margin-bottom:8px">
          现价: <b style="color:var(--sys-text-title)">¥${winner.current_price}</b> (${winner.change_pct >= 0 ? '+' : ''}${winner.change_pct}%) | 
          上方腾挪空间: <b style="color:#10b981">+${winner.resistance_margin}%</b>
        </div>
        <div style="font-size:12px;background:rgba(16,185,129,0.1);padding:8px 12px;border-radius:6px;color:var(--sys-text-title)">
          <b>👍 操盘手解析：</b>${winner.chips_desc || '筹码峰已被跃迁踩在脚下，成为坚固防守托底支撑，主升浪空间彻底打开！'}
        </div>
      ` : '<div style="color:var(--sys-text-sub);padding:15px;text-align:center">今日全市场无黄金标的通关</div>'}
    </div>

    <!-- 黑榜：假突破诱多受罚 -->
    <div style="background:rgba(239,68,68,0.06);border:2px solid rgba(239,68,68,0.4);border-radius:10px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:20px">🔴</span>
          <b style="font-size:16px;color:#ef4444">假突破 · 致命死穴标的</b>
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(239,68,68,0.2);color:#ef4444;font-weight:700">铁律一票否决枪毙</span>
      </div>

      ${loser ? `
        <div style="font-size:18px;font-weight:700;color:var(--sys-text-title);margin-bottom:4px">
          ${loser.name} <span style="font-size:14px;color:var(--sys-text-sub)">(${loser.symbol})</span>
        </div>
        <div style="font-size:13px;color:var(--sys-text-sub);margin-bottom:8px">
          现价: <b style="color:var(--sys-text-title)">¥${loser.price || '—'}</b> (${(loser.change_pct || 0) >= 0 ? '+' : ''}${loser.change_pct || 0}%) | 
          触犯天条: <b style="color:#ef4444">${loser.law}</b>
        </div>
        <div style="font-size:12px;background:rgba(239,68,68,0.1);padding:8px 12px;border-radius:6px;color:var(--sys-text-title)">
          <b>💀 致命死穴：</b>${loser.reason}。散户以为放量要大涨，实则头顶全是套牢盘解套抛压，一买就站岗！
        </div>
      ` : '<div style="color:var(--sys-text-sub);padding:15px;text-align:center">暂无典型受罚样本</div>'}
    </div>
  `;

  // 找茬表格
  const diffs = arena.differences || [];
  let diffHtml = `
    <div style="font-size:13px;font-weight:700;color:var(--sys-text-title);margin-bottom:8px">🔍 操盘手火眼金睛找茬（三点致命差距对比）：</div>
    <div style="display:grid;grid-template-columns:1fr 1.5fr 1.5fr;gap:8px;font-size:12px">
      <div style="font-weight:700;color:var(--sys-text-sub);padding:4px">核心维度</div>
      <div style="font-weight:700;color:#10b981;padding:4px">真突破表现 (榜样)</div>
      <div style="font-weight:700;color:#ef4444;padding:4px">假突破表现 (陷阱)</div>
  `;

  for (const d of diffs) {
    diffHtml += `
      <div style="padding:6px;border-bottom:1px dashed var(--sys-border);color:var(--sys-text-title)"><b>${d.dimension}</b></div>
      <div style="padding:6px;border-bottom:1px dashed var(--sys-border);color:var(--sys-text-title)">${d.winner_text}</div>
      <div style="padding:6px;border-bottom:1px dashed var(--sys-border);color:#f87171">${d.loser_text}</div>
    `;
  }
  diffHtml += '</div>';
  diffBox.innerHTML = diffHtml;

  section.style.display = 'block';
}
