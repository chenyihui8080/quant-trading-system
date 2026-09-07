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
  } catch(e) {}


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

  // 初始获取东方财富账户直连守护状态，并开启 10 秒心跳监听
  fetchEastMoneyDaemonStatus();
  setInterval(fetchEastMoneyDaemonStatus, 10000);

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
  const cardBox = document.getElementById('alphaCardPreview');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ 正在全市场扫描...'; }
  if (statusSpan) statusSpan.textContent = '扫描中...';
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--sys-text-sub)"><span class="spinner"></span> 正在链式执行硬性排雷、均线多头、量能突破与买卖点风控测算...</td></tr>`;

  try {
    const res = await authFetch('/api/alpha/scan');
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || '扫描失败', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔍 立即全市场扫描'; }
      return;
    }

    _alphaScanData = data;
    const results = data.results || [];
    if (statusSpan) statusSpan.innerHTML = `最近更新: <b style="color:var(--sys-accent)">${data.updated_at}</b>，共筛选出 <b style="color:#3fb950">${data.passed_count}</b> 只待执行标的`;

    const RULE_EXPLANATIONS = {
      "均线多头排列": "【均线多头判定】5日均线 > 10日均线 > 20日均线，且现价高于20日均线，处于稳健上升主升浪通道。",
      "放量突破平台": "【放量突破判定】今日成交量 ≥ 过去5日均量的 1.8 倍，主力资金真金白银放量突破横盘平台。",
      "缩量回踩企稳": "【缩量回踩判定】股价回踩 5日/10日 关键均线未破，全天缩量 20% 以上，主力洗盘企稳信号。",
      "尾盘稳健收红": "【尾盘稳健判定】14:45 涨幅处于 +3.0% ~ +6.5% 黄金区间，涨势确立且未封死涨停，留有次日早盘冲高空间。",
      "主力资金持续净流入": "【主力做多判定】大单与特大单主力资金持续净买入，机构大资金坚决做多。",
      "硬性排雷通过": "【硬性排雷判定】剔除 ST/退市股，流通市值处于 50亿~400亿，日成交额 ≥ 3.5 亿元。"
    };

    if (results.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--sys-text-sub)">今日暂无符合全部严苛规则的候选标的，知行合一保持空仓</td></tr>`;
    } else {
      let rowsHtml = '';
      results.forEach(r => {
        const rulesBadges = (r.triggered_rules || []).map(rg => {
          const tip = RULE_EXPLANATIONS[rg] || `满足量化规则：${rg}`;
          return `<span style="display:inline-block;padding:2px 8px;margin:2px;font-size:11px;background:rgba(9,105,218,0.1);border:1px solid rgba(9,105,218,0.25);border-radius:4px;color:var(--sys-accent);cursor:help" title="${tip}"><i class="ri-checkbox-circle-line"></i> ${rg}</span>`;
        }).join('');
        
        let statusBadge = '';
        if (r.status === '待执行') {
          statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:rgba(63,185,80,0.15);color:#3fb950;font-weight:700;border:1px solid rgba(63,185,80,0.3)">● 建议建仓</span>`;
        } else if (r.status.includes('拦截')) {
          statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:rgba(248,81,73,0.15);color:#f85149;font-weight:700;border:1px solid rgba(248,81,73,0.3)">⚠️ 盈亏比不足</span>`;
        } else {
          statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:rgba(139,148,158,0.15);color:var(--sys-text-sub);border:1px solid rgba(139,148,158,0.3)">观察中</span>`;
        }

        const rrColor = r.risk_reward_ratio >= 2.0 ? '#3fb950' : (r.risk_reward_ratio >= 1.5 ? '#f0883e' : '#f85149');

        rowsHtml += `
          <tr style="border-bottom:1px solid var(--sys-border);transition:background 0.15s" onmouseover="this.style.background='var(--sys-bg-hover)'" onmouseout="this.style.background='transparent'">
            <td style="padding:12px 8px">
              <b style="color:var(--sys-text-title);font-size:14px">${escapeHtml(r.name)}</b><br>
              <span style="color:var(--sys-text-sub);font-size:12px">${escapeHtml(r.symbol)}</span>
            </td>
            <td style="padding:12px 8px">${rulesBadges}</td>
            <td style="padding:12px 8px;font-weight:700;color:var(--sys-text-title)">¥${r.current_price.toFixed(2)}</td>
            <td style="padding:12px 8px;color:var(--sys-accent);font-weight:600">¥${r.buy_price_low.toFixed(2)} ~ ¥${r.buy_price_high.toFixed(2)}</td>
            <td style="padding:12px 8px;color:#f85149">
              <b>¥${r.stop_loss_price.toFixed(2)}</b>
              <span style="font-size:11px;display:block">(${r.stop_loss_pct}%)</span>
            </td>
            <td style="padding:12px 8px;color:#3fb950">
              <b>¥${r.target_price_1.toFixed(2)}</b>
              <span style="font-size:11px;display:block">(+${r.target_profit_pct_1}%)</span>
            </td>
            <td style="padding:12px 8px;font-weight:800;color:${rrColor};font-size:14px">${r.risk_reward_ratio}:1</td>
            <td style="padding:12px 8px">
              <b style="color:var(--sys-text-title)">${r.recommended_shares.toLocaleString()} 股</b><br>
              <span style="color:var(--sys-text-sub);font-size:11px">约 ¥${(r.recommended_amount/10000).toFixed(1)}万 (风险控制:¥${r.risk_amount.toFixed(0)})</span>
            </td>
            <td style="padding:12px 8px">${statusBadge}</td>
          </tr>
        `;
      });
      if (tbody) tbody.innerHTML = rowsHtml;
    }

    if (cardBox && data.card?.markdown?.text) {
      cardBox.textContent = data.card.markdown.text;
    }
    showToast('尾盘决策扫描完成', 'success');
  } catch(e) {
    showToast('扫描请求异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 立即全市场扫描'; }
  }
}



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


  if (resultBox) resultBox.innerHTML = '<div style="color:var(--sys-text-sub);text-align:center;padding:20px"><span class="spinner"></span> 正在实时拉取真实行情并测算买卖点...</div>';

  try {
    const res = await authFetch('/api/alpha/calculate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol: cleanCode}),
    });
    const data = await res.json();
    if (!res.ok) {
      if (resultBox) resultBox.innerHTML = `<div style="color:#f85149;padding:10px">测算失败: ${data.detail || '未找到标的'}</div>`;
      return;
    }

    const r = data.result;
    const isSafe = r.risk_reward_ratio >= 2.0;
    const rrColor = isSafe ? '#3fb950' : '#f85149';

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
            <span style="font-size:12px;color:${r.change_pct >= 0 ? '#dc2626' : '#16a34a'};font-weight:600">${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(2)}%</span>
          </div>
          <div>
            ${isSafe ? '<span style="color:#059669;font-weight:700;font-size:12px;background:#ecfdf5;padding:3px 10px;border-radius:6px;border:1px solid #a7f3d0">● 盈亏比达标</span>' : '<span style="color:#dc2626;font-weight:700;font-size:12px;background:#fef2f2;padding:3px 10px;border-radius:6px;border:1px solid #fecaca">⚠️ 盈亏比不足 2.0 建议拦截</span>'}
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
  switchAlphaSubTab('decision');
  const input = document.getElementById('alphaCalcInput');
  if (input) {
    input.value = sym;
    calculateAlphaSingle();
  }
}

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
window.switchAlphaSubTab = switchAlphaSubTab;
window.scanAlphaCandidates = scanAlphaCandidates;
window.calculateAlphaSingle = calculateAlphaSingle;
window.calculateAlpha = calculateAlpha;
window.saveAlphaConfig = saveAlphaConfig;
window.pushAlphaAlert = pushAlphaAlert;
window.copyAlphaCardText = copyAlphaCardText;
window.quickJumpToCalculate = quickJumpToCalculate;
window.initAlphaDeskCalc = initAlphaDesk;
