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
  setupStockAutocomplete(
    document.getElementById('alphaCalcInput'),
    document.getElementById('alphaCalcSuggest'),
    (item) => calculateAlphaSingle(item)
  );

  setupStockAutocomplete(
    document.getElementById('addWatchInput'),
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
              <b style="color:var(--sys-text-title);font-size:14px">${r.name}</b><br>
              <span style="color:var(--sys-text-sub);font-size:12px">${r.symbol}</span>
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
      resultBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--sys-border);padding-bottom:8px;margin-bottom:8px">
          <div>
            <b style="font-size:16px;color:var(--sys-text-title)">${r.name}</b> &nbsp;<span style="color:var(--sys-text-sub)">${r.symbol}</span>
            <span style="margin-left:8px;color:var(--sys-accent);font-weight:700">¥${r.current_price.toFixed(2)}</span>
          </div>
          <div>
            ${isSafe ? '<span style="color:#3fb950;font-weight:700;font-size:12px;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px;border:1px solid rgba(63,185,80,0.3)">● 盈亏比达标</span>' : '<span style="color:#f85149;font-weight:700;font-size:12px;background:rgba(248,81,73,0.15);padding:2px 8px;border-radius:4px;border:1px solid rgba(248,81,73,0.3)">⚠️ 盈亏比不足 2.0 建议拦截</span>'}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
          <div title="当前撮合价上下浮动 0.5% 的安全建仓区间">建议买入区间：<b style="color:var(--sys-accent)">¥${r.buy_price_low.toFixed(2)} ~ ¥${r.buy_price_high.toFixed(2)}</b></div>
          <div title="结合 3.5% 固定风控底线与前一日最低价、MA5 支撑位智能测算，跌破必须果断认错">硬性防守止损：<b style="color:#f85149">¥${r.stop_loss_price.toFixed(2)} (${r.stop_loss_pct}%)</b></div>
          <div title="短线波段第一止盈目标位 (+5.0%)">第一止盈目标：<b style="color:#3fb950">¥${r.target_price_1.toFixed(2)} (+${r.target_profit_pct_1}%)</b></div>
          <div title="波段第二止盈目标位 (+10.0%)">第二止盈目标：<b style="color:#3fb950">¥${r.target_price_2.toFixed(2)} (+${r.target_profit_pct_2}%)</b></div>
          <div title="预期止盈空间与风险之比">预期盈亏比：<b style="color:${rrColor};font-size:14px">${r.risk_reward_ratio} : 1</b></div>
          <div title="华尔街 1% 风险倒算模型：单笔最大损失限制在账户的 1%">单笔 1% 风险建仓：<b style="color:var(--sys-text-title)">${r.recommended_shares.toLocaleString()} 股 (约 ¥${(r.recommended_amount/10000).toFixed(1)}万)</b></div>
        </div>
        <div style="margin-top:8px;font-size:12px;color:var(--sys-text-sub);border-top:1px solid var(--sys-border);padding-top:6px">
          💡 <b>测算依据：</b>${r.summary}
        </div>
      `;
    }
    showToast(`已完成 ${r.name} 决策测算`, 'success');
  } catch(e) {
    if (resultBox) resultBox.innerHTML = `<div style="color:#f85149">请求异常: ${e.message}</div>`;
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

// ==================== 我的实盘持仓深度诊断与自选管理 ====================
let _currentOcrItems = [];

function openUploadModal() {
  document.getElementById('uploadOcrModal').style.display = 'flex';
  document.getElementById('ocrResultBox').style.display = 'none';
  document.getElementById('confirmSyncBtn').style.display = 'none';
  _currentOcrItems = [];
}

function closeUploadModal() {
  document.getElementById('uploadOcrModal').style.display = 'none';
}

function openAddPositionModal() {
  document.getElementById('addPositionModal').style.display = 'flex';
}

function closeAddPositionModal() {
  document.getElementById('addPositionModal').style.display = 'none';
}

function switchImportMode(mode) {
  const tabs = ['excel', 'text', 'cube', 'ocr'];
  tabs.forEach(t => {
    const btn = document.getElementById('importTab' + t.charAt(0).toUpperCase() + t.slice(1));
    const box = document.getElementById('mode' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) {
      if (t === mode) {
        btn.style.background = 'var(--sys-accent)';
        btn.style.color = '#fff';
      } else {
        btn.style.background = 'transparent';
        btn.style.color = 'var(--sys-text-sub)';
      }
    }
    if (box) box.style.display = (t === mode) ? 'block' : 'none';
  });
}

function handleExcelDrop(e) {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleExcelUpload(e.dataTransfer.files[0]);
  }
}

async function handleExcelUpload(file) {
  if (!file) return;
  const box = document.getElementById('ocrResultBox');
  const list = document.getElementById('ocrResultList');
  if (box) box.style.display = 'block';
  if (list) list.innerHTML = `<div style="padding:15px;color:var(--sys-text-sub);text-align:center"><span class="spinner"></span> 正在秒级解析券商 Excel/CSV 表格数据...</div>`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await authFetch('/api/portfolio/import-file', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`成功解析表格: ${data.filename}，共 ${data.parsed_count} 条持仓！`, 'success');
      renderOcrResults(data.items || []);
    } else {
      showToast(data.detail || '表格解析失败', 'error');
      if (list) list.innerHTML = `<div style="color:#f85149;padding:10px">${data.detail || '解析失败'}</div>`;
    }
  } catch(e) {
    showToast('上传表格异常: ' + e.message, 'error');
  }
}

async function parseFreeTextHolding() {
  const text = document.getElementById('freeTextHoldingInput').value.trim();
  if (!text) { showToast('请输入或粘贴股票名称/代码或聊天记录', 'error'); return; }

  const targetRadio = document.querySelector('input[name="textTargetType"]:checked');
  const targetType = targetRadio ? targetRadio.value : 'position';

  const box = document.getElementById('ocrResultBox');
  const list = document.getElementById('ocrResultList');
  if (box) box.style.display = 'block';
  if (list) list.innerHTML = `<div style="padding:15px;color:var(--sys-accent);text-align:center"><span class="spinner"></span> 正在通过 AI 语义智能提取标的信息...</div>`;

  try {
    const res = await authFetch('/api/portfolio/parse-text', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text}),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || '文本识别失败', 'error');
      if (list) list.innerHTML = `<div style="color:#f85149;padding:12px;text-align:center">❌ ${escapeHtml(data.detail || '提取失败')}</div>`;
      return;
    }

    const items = data.items || [];
    if (items.length === 0) {
      if (list) list.innerHTML = `<div style="padding:15px;color:var(--sys-text-sub);text-align:center">⚠️ 未能从文本中匹配到股票，请检查输入格式（例如：贵州茅台 500股 成本1280）</div>`;
      return;
    }

    if (targetType === 'watchlist') {
      // 批量加入自选池
      for (const it of items) {
        await authFetch('/api/portfolio/add-watchlist', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ symbol: it.symbol, name: it.name, notes: "批量文本添加" }),
        });
      }
      showToast(`⭐ 成功将 ${items.length} 只标的批量加入自选监控池！`, 'success');
      closeUploadModal();
      if (typeof loadPortfolioList === 'function') loadPortfolioList();
    } else {
      showToast(`✅ 成功提取出 ${items.length} 条持仓，请在下方确认参数后入库！`, 'success');
      renderOcrResults(items, '');
    }
  } catch(e) {
    showToast('文本提取异常: ' + e.message, 'error');
  }
}


async function syncCubeHolding() {
  const cubeCode = document.getElementById('cubeCodeInput').value.trim();
  if (!cubeCode) { showToast('请输入组合代码 (例如 ZH123456)', 'error'); return; }

  const box = document.getElementById('ocrResultBox');
  const list = document.getElementById('ocrResultList');
  if (box) box.style.display = 'block';
  if (list) list.innerHTML = `<div style="padding:15px;color:var(--sys-text-sub);text-align:center"><span class="spinner"></span> 正在拉取雪球/同花顺投资组合持仓配比...</div>`;

  try {
    const res = await authFetch('/api/portfolio/sync-cube', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({cube_symbol: cubeCode}),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`成功同步组合 ${data.cube_symbol}，共 ${data.parsed_count} 只标的！`, 'success');
      renderOcrResults(data.items || []);
    } else {
      showToast(data.detail || '组合同步失败', 'error');
      if (list) list.innerHTML = `<div style="color:#f85149;padding:10px">${data.detail || '组合同步失败'}</div>`;
    }
  } catch(e) { showToast(e.message, 'error'); }
}

function handleFileDrop(e) {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleImageUpload(e.dataTransfer.files[0]);
  }
}

// 全局粘贴图片监听 (Ctrl+V / Cmd+V)
window.addEventListener('paste', e => {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (let index in items) {
    const item = items[index];
    if (item.kind === 'file' && item.type.indexOf('image/') !== -1) {
      const blob = item.getAsFile();
      openUploadModal();
      switchImportMode('ocr');
      handleImageUpload(blob);
      break;
    }
  }
});

async function handleImageUpload(file) {
  if (!file) return;
  const box = document.getElementById('ocrResultBox');
  const list = document.getElementById('ocrResultList');
  const confirmBtn = document.getElementById('confirmSyncBtn');
  
  if (box) box.style.display = 'block';
  if (confirmBtn) confirmBtn.style.display = 'none';

  // 1. 本地生成即时图片缩略图预览
  let previewUrl = '';
  try {
    previewUrl = URL.createObjectURL(file);
  } catch(e) {}

  if (list) {
    list.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;padding:12px;background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:8px">
        ${previewUrl ? `<img src="${previewUrl}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--sys-border)">` : ''}
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:var(--sys-text-title);display:flex;align-items:center;gap:6px">
            <span class="spinner"></span> 正在使用 OCR 原生引擎提取截图中持仓数据...
          </div>
          <div style="font-size:11px;color:var(--sys-text-sub);margin-top:4px">文件: ${escapeHtml(file.name || '粘贴的截图')} (${Math.round(file.size/1024)} KB) · 正在智能分离股票代码与数量...</div>
        </div>
      </div>
    `;
  }

  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12秒防假死超时

  try {
    const res = await authFetch('/api/portfolio/upload-image', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || '图片识别失败', 'error');
      if (list) list.innerHTML = `<div style="color:#f85149;padding:14px;text-align:center">❌ ${escapeHtml(data.detail || '识别失败，请尝试上传更清晰的截图')}</div>`;
      return;
    }
    renderOcrResults(data.items || [], data.raw_text || '');
  } catch(e) {
    clearTimeout(timeoutId);
    const errText = e.name === 'AbortError' ? '识别请求超时，建议直接使用【文本智能识别】粘贴文字' : e.message;
    showToast('识别提示: ' + errText, 'error');
    if (list) {
      list.innerHTML = `
        <div style="padding:16px;background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:8px;text-align:center">
          <div style="font-size:20px;margin-bottom:6px">⚠️</div>
          <b style="color:var(--sys-text-title);font-size:13px">未能从图片中提取出清晰的持仓数据</b>
          <p style="font-size:12px;color:var(--sys-text-sub);margin:6px 0 12px 0">${escapeHtml(errText)}</p>
          <div style="display:flex;justify-content:center;gap:10px">
            <button class="btn btn-blue" style="width:auto;padding:6px 14px;font-size:12px" onclick="switchImportMode('text')">💬 切换到文本粘贴 (100%可靠)</button>
            <button class="btn btn-outline" style="width:auto;padding:6px 14px;font-size:12px" onclick="openAddPositionModal()">➕ 快速手动录入</button>
          </div>
        </div>
      `;
    }
  }
}

// 缓存当前识别提取出的待入库持仓列表
let _currentExtractedHoldings = [];

function renderOcrResults(items, rawText = '') {
  const box = document.getElementById('ocrResultBox');
  const list = document.getElementById('ocrResultList');
  const confirmBtn = document.getElementById('confirmSyncBtn');
  
  if (!box || !list) return;
  box.style.display = 'block';
  _currentExtractedHoldings = items || [];

  if (!items || items.length === 0) {
    let emptyHtml = `
      <div style="padding:16px;background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:8px;text-align:center">
        <div style="font-size:20px;margin-bottom:6px">⚠️</div>
        <b style="color:var(--sys-text-title);font-size:13px">未能从当前截图中自动匹配到标准的股票代码与持仓数据</b>
        <p style="font-size:12px;color:var(--sys-text-sub);margin:6px 0 12px 0">原因可能是：截图分辨率较低、包含非券商内容或缺少股票名称/数量列。</p>
    `;
    if (rawText && rawText.trim()) {
      window._lastOcrRawText = rawText;
      emptyHtml += `
        <div style="text-align:left;background:var(--sys-bg-card-inner);border:1px dashed var(--sys-border);border-radius:6px;padding:8px 12px;font-size:11px;color:var(--sys-text-sub);font-family:monospace;margin-bottom:12px;max-height:80px;overflow-y:auto">
          <b>OCR提取到的原始文字预览：</b><br>${escapeHtml(rawText)}
        </div>
        <div style="display:flex;justify-content:center;gap:10px">
          <button class="btn btn-blue" style="width:auto;padding:6px 14px;font-size:12px" onclick="fillOcrTextToTextInput()">📝 将提取文字转入【文本智能识别】一键解析</button>
          <button class="btn btn-outline" style="width:auto;padding:6px 14px;font-size:12px" onclick="openAddPositionModal()">➕ 快速手动录入</button>
        </div>
      `;
    } else {
      emptyHtml += `
        <div style="display:flex;justify-content:center;gap:10px">
          <button class="btn btn-blue" style="width:auto;padding:6px 14px;font-size:12px" onclick="switchImportMode('text')">💬 切换到文本粘贴 (100%可靠)</button>
          <button class="btn btn-outline" style="width:auto;padding:6px 14px;font-size:12px" onclick="openAddPositionModal()">➕ 快速手动录入</button>
        </div>
      `;
    }
    emptyHtml += `</div>`;
    list.innerHTML = emptyHtml;
    if (confirmBtn) confirmBtn.style.display = 'none';
    return;
  }

  if (confirmBtn) confirmBtn.style.display = 'inline-block';


  let html = '';
  items.forEach((item, idx) => {
    const sym = item.symbol || '';
    const name = item.name || sym;
    const shares = item.shares || 100;
    const cost = item.cost_price || 0.0;

    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--sys-bg-card);border:1px solid var(--sys-border);border-radius:6px;padding:8px 12px;gap:10px">
        <div style="display:flex;align-items:center;gap:8px;min-width:140px">
          <span style="background:var(--sys-bg-badge);color:var(--sys-accent);font-size:11px;padding:2px 6px;border-radius:4px;font-weight:700">#${idx+1}</span>
          <div>
            <b style="color:var(--sys-text-title);font-size:13px">${escapeHtml(name)}</b>
            <div style="font-size:11px;color:var(--sys-text-sub);font-family:monospace">${escapeHtml(sym)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex:1;justify-content:flex-end">
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:11px;color:var(--sys-text-sub)">持股:</span>
            <input type="number" id="ocr_shares_${idx}" value="${shares}" style="width:80px;padding:4px 6px;font-size:12px;background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:4px;color:var(--sys-text-title)">
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:11px;color:var(--sys-text-sub)">成本:</span>
            <input type="number" step="0.01" id="ocr_cost_${idx}" value="${cost}" style="width:80px;padding:4px 6px;font-size:12px;background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:4px;color:var(--sys-text-title)">
          </div>
          <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;color:#f85149;border-color:rgba(248,81,73,0.3)" onclick="removeExtractedItem(${idx})">✕</button>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;
}

function removeExtractedItem(index) {
  if (_currentExtractedHoldings && _currentExtractedHoldings.length > index) {
    _currentExtractedHoldings.splice(index, 1);
    renderOcrResults(_currentExtractedHoldings);
  }
}

function fillOcrTextToTextInput() {
  if (window._lastOcrRawText) {
    switchImportMode('text');
    const area = document.getElementById('textImportArea');
    if (area) {
      area.value = window._lastOcrRawText;
      parseCustomText();
    }
  }
}

async function confirmBatchSync() {
  if (!_currentExtractedHoldings || _currentExtractedHoldings.length === 0) {
    showToast('当前没有待入库的持仓标的', 'error');
    return;

  }

  const payload = _currentExtractedHoldings.map((item, idx) => {
    const sInput = document.getElementById(`ocr_shares_${idx}`);
    const cInput = document.getElementById(`ocr_cost_${idx}`);
    return {
      symbol: item.symbol,
      name: item.name || item.symbol,
      shares: sInput ? parseInt(sInput.value, 10) || 0 : item.shares,
      cost_price: cInput ? parseFloat(cInput.value) || 0.0 : item.cost_price,
      buy_date: item.buy_date || new Date().toISOString().split('T')[0],
      notes: item.notes || "智能导入持仓",
    };
  });

  const confirmBtn = document.getElementById('confirmSyncBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<span class="spinner"></span> 正在批量入库并测算实时诊断...`;
  }

  try {
    for (const pos of payload) {
      await authFetch('/api/portfolio/add-position', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(pos),
      });
    }

    showToast(`✅ 成功同步 ${payload.length} 只持仓至实盘诊断中枢！`, 'success');
    closeUploadModal();
    if (typeof loadPortfolioList === 'function') {
      loadPortfolioList();
    }
  } catch(e) {
    showToast('批量同步异常: ' + e.message, 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `🚀 确认同步至实盘持仓并诊断`;
    }
  }
}

async function clearAllPortfolioData() {
  if (!confirm('确定要一键清空当前的演示/现有持仓与自选吗？清空后您可以干净地重新导入您自己的真实股票')) {
    return;
  }
  try {
    const res = await authFetch('/api/portfolio/clear', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('已清空持仓与自选数据！您可以导入您自己的股票了', 'success');
      if (typeof loadPortfolioList === 'function') {
        loadPortfolioList();
      }
    } else {
      showToast(data.detail || '清空失败', 'error');
    }
  } catch(e) {
    showToast('清空异常: ' + e.message, 'error');
  }
}


let _allSectorFlows = [];
let _sectorSortField = 'net_inflow_amount';
let _sectorSortAsc = false;
let _sectorSearchKeyword = '';
let _sectorFlowsCurrentPage = 1;
const _sectorFlowsPageSize = 15;

function sortSectorFlows(field) {
  if (_sectorSortField === field) {
    _sectorSortAsc = !_sectorSortAsc;
  } else {
    _sectorSortField = field;
    _sectorSortAsc = false; // 默认降序
  }
  updateSectorSortHeaders();
  renderSectorFlowsTable();
}

function updateSectorSortHeaders() {
  const fields = ['sector_name', 'change_pct', 'net_inflow_amount', 'inflow_amount', 'outflow_amount', 'company_count', 'leader_stock_change'];
  fields.forEach(f => {
    const el = document.getElementById('sort_' + f);
    if (!el) return;
    if (_sectorSortField === f) {
      el.textContent = _sectorSortAsc ? '▲' : '▼';
      el.style.color = 'var(--sys-accent)';
      el.style.fontWeight = '700';
    } else {
      el.textContent = '↕';
      el.style.color = '#484f58';
      el.style.fontWeight = 'normal';
    }
  });
}

function changeSectorFlowsPage(delta) {
  _sectorFlowsCurrentPage += delta;
  renderSectorFlowsTable();
}

function renderSectorFlowsTable() {
  const tbody = document.getElementById('sectorFlowsTableBody');
  const countText = document.getElementById('sectorFlowsCountText');
  const pageInfo = document.getElementById('sectorFlowsPageInfo');
  const prevBtn = document.getElementById('sectorFlowsPrevBtn');
  const nextBtn = document.getElementById('sectorFlowsNextBtn');

  if (!tbody) return;

  let list = [..._allSectorFlows];

  // 1. 关键字过滤 (支持板块名、龙头股名)
  if (_sectorSearchKeyword) {
    const kw = _sectorSearchKeyword.toLowerCase();
    list = list.filter(f => 
      (f.sector_name && f.sector_name.toLowerCase().includes(kw)) ||
      (f.leader_stock_name && f.leader_stock_name.toLowerCase().includes(kw)) ||
      (f.sector_code && f.sector_code.toLowerCase().includes(kw))
    );
  }

  const total = list.length;
  const totalPages = Math.ceil(total / _sectorFlowsPageSize) || 1;
  if (_sectorFlowsCurrentPage > totalPages) _sectorFlowsCurrentPage = totalPages;
  if (_sectorFlowsCurrentPage < 1) _sectorFlowsCurrentPage = 1;

  if (countText) countText.textContent = `共 ${total} 个板块监控 (第 ${_sectorFlowsCurrentPage}/${totalPages} 页，每页 ${_sectorFlowsPageSize} 条)`;
  if (pageInfo) pageInfo.textContent = `第 ${_sectorFlowsCurrentPage} / ${totalPages} 页`;
  if (prevBtn) prevBtn.disabled = _sectorFlowsCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = _sectorFlowsCurrentPage >= totalPages;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--sys-text-sub)">未找到包含 "${_sectorSearchKeyword}" 的板块或题材</td></tr>`;
    return;
  }

  // 2. 多维排序
  list.sort((a, b) => {
    let valA = a[_sectorSortField];
    let valB = b[_sectorSortField];
    if (typeof valA === 'string') {
      return _sectorSortAsc ? valA.localeCompare(valB, 'zh-Hans-CN') : valB.localeCompare(valA, 'zh-Hans-CN');
    }
    valA = typeof valA === 'number' ? valA : parseFloat(valA || 0);
    valB = typeof valB === 'number' ? valB : parseFloat(valB || 0);
    return _sectorSortAsc ? (valA - valB) : (valB - valA);
  });

  // 3. 分页切片
  const startIdx = (_sectorFlowsCurrentPage - 1) * _sectorFlowsPageSize;
  const pageItems = list.slice(startIdx, startIdx + _sectorFlowsPageSize);

  // 4. 渲染当前页
  tbody.innerHTML = pageItems.map(f => {
    const chg = typeof f.change_pct === 'number' ? f.change_pct : parseFloat(f.change_pct || 0);
    const isUp = chg >= 0;
    const chgColor = isUp ? '#3fb950' : '#f85149';

    const netInflow = typeof f.net_inflow_amount === 'number' ? f.net_inflow_amount : parseFloat(f.net_inflow_amount || 0);
    const isInflow = netInflow >= 0;
    const inflowColor = isInflow ? '#3fb950' : '#f85149';
    const sign = isInflow ? '+' : '';

    const inflow = typeof f.inflow_amount === 'number' ? f.inflow_amount : parseFloat(f.inflow_amount || 0);
    const outflow = typeof f.outflow_amount === 'number' ? f.outflow_amount : parseFloat(f.outflow_amount || 0);

    const leaderName = f.leader_stock_name || f.sector_name || '-';
    const leaderChg = typeof f.leader_stock_change === 'number' ? f.leader_stock_change : parseFloat(f.leader_stock_change || 0);
    const leaderChgColor = leaderChg >= 0 ? '#3fb950' : '#f85149';

    return `
      <tr style="border-bottom:1px solid var(--sys-border);transition:background 0.2s;cursor:pointer" 
          onmouseover="this.style.background='var(--sys-bg-hover)'" 
          onmouseout="this.style.background='transparent'" 
          onclick="openSectorDetailModal('${f.sector_name}', '${f.sector_type}')"
          title="点击查看 ${f.sector_name} 全部成分股与企业主营业务画像">
        <td style="padding:10px 8px;text-align:left">
          <div style="font-weight:700;color:var(--sys-text-title);font-size:14px;display:flex;align-items:center;gap:6px">
            <span>${f.sector_name}</span>
            <span style="font-size:11px;color:var(--sys-accent);font-weight:normal;opacity:0.85;background:rgba(88,166,255,0.1);padding:1px 5px;border-radius:3px">🔍 详情</span>
          </div>
          <div style="margin-top:3px">
            <span style="display:inline-block;padding:1px 6px;background:${f.sector_type === 'concept' ? 'rgba(56,139,253,0.15)' : 'rgba(63,185,80,0.15)'};color:${f.sector_type === 'concept' ? 'var(--sys-accent)' : '#3fb950'};border-radius:3px;font-size:11px;font-weight:600">${f.sector_type === 'concept' ? '🏷️ 概念题材' : '🏢 实体行业'}</span>
          </div>
        </td>
        <td style="padding:10px 8px;text-align:right;font-weight:700;font-size:13px;color:${chgColor}">
          ${isUp ? '+' : ''}${chg.toFixed(2)}%
        </td>
        <td style="padding:10px 8px;text-align:right;font-weight:800;font-size:14px;color:${inflowColor}">
          ${sign}${netInflow.toFixed(2)} 亿
        </td>
        <td style="padding:10px 8px;text-align:right;font-size:12px;color:#3fb950;font-weight:600">
          +${inflow.toFixed(2)} 亿
        </td>
        <td style="padding:10px 8px;text-align:right;font-size:12px;color:#f85149;font-weight:600">
          -${outflow.toFixed(2)} 亿
        </td>
        <td style="padding:10px 8px;text-align:right;font-size:12px;color:var(--sys-text-sub)">
          ${f.company_count ? f.company_count + ' 家' : '-'}
        </td>
        <td style="padding:10px 8px;text-align:right">
          <div style="font-weight:700;color:var(--sys-accent);font-size:13px">${leaderName}</div>
          <div style="font-size:11px;color:${leaderChgColor};margin-top:2px;font-weight:600">
            ${leaderChg >= 0 ? '+' : ''}${leaderChg.toFixed(2)}%
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ==================== 板块全息画像与成分股透视弹窗逻辑 ====================
let _currentModalSectorStocks = [];
let _modalFilteredStocks = [];
let _modalCurrentPage = 1;
const _modalPageSize = 20;

async function openSectorDetailModal(sectorName, sectorType) {
  const modal = document.getElementById('sectorDetailModal');
  if (!modal) return;
  modal.style.display = 'flex';

  document.getElementById('modalSectorTitle').textContent = `🏢 ${sectorName} · 板块全息画像与成分股透视`;
  document.getElementById('modalSectorBadge').textContent = sectorType === 'concept' ? '🏷️ 概念题材' : '🏢 实体行业';
  document.getElementById('modalSectorDesc').textContent = '正在拉取该板块产业链全景与全量成分股实时数据...';
  document.getElementById('modalCatalystsText').textContent = '加载中...';
  document.getElementById('modalStocksTableBody').innerHTML = `<tr><td colspan="5" style="text-align:center;padding:35px;color:var(--sys-text-sub)"><span class="spinner"></span> 正在实时抓取 ${sectorName} 全部成分股企业主营档案与行情...</td></tr>`;
  const filterInput = document.getElementById('modalStockFilter');
  if (filterInput) filterInput.value = '';

  _modalCurrentPage = 1;

  try {
    const res = await authFetch(`/api/market/sector-detail?name=${encodeURIComponent(sectorName)}&type=${encodeURIComponent(sectorType || 'industry')}`);
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('modalStocksTableBody').innerHTML = `<tr><td colspan="5" style="text-align:center;padding:25px;color:#f85149">获取详情失败: ${data.detail || '接口异常'}</td></tr>`;
      return;
    }

    const detail = data.detail || {};
    document.getElementById('modalSectorDesc').textContent = detail.description || '暂无产业定位描述';
    document.getElementById('modalCatalystsText').textContent = detail.catalysts || '主力资金抢筹驱动';
    _currentModalSectorStocks = detail.stocks || [];
    _modalFilteredStocks = [..._currentModalSectorStocks];
    _modalCurrentPage = 1;
    renderModalStocksTable();

  } catch (err) {
    document.getElementById('modalStocksTableBody').innerHTML = `<tr><td colspan="5" style="text-align:center;padding:25px;color:#f85149">请求异常: ${err.message}</td></tr>`;
  }
}

function closeSectorDetailModal() {
  const modal = document.getElementById('sectorDetailModal');
  if (modal) modal.style.display = 'none';
}

function filterModalStocks(kw) {
  const keyword = (kw || '').trim().toLowerCase();
  if (!keyword) {
    _modalFilteredStocks = [..._currentModalSectorStocks];
  } else {
    _modalFilteredStocks = _currentModalSectorStocks.filter(s => 
      (s.name && s.name.toLowerCase().includes(keyword)) ||
      (s.code && s.code.toLowerCase().includes(keyword)) ||
      (s.business && s.business.toLowerCase().includes(keyword))
    );
  }
  _modalCurrentPage = 1;
  renderModalStocksTable();
}

function changeModalPage(delta) {
  const totalPages = Math.ceil(_modalFilteredStocks.length / _modalPageSize) || 1;
  const newPage = _modalCurrentPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    _modalCurrentPage = newPage;
    renderModalStocksTable();
  }
}

function renderModalStocksTable() {
  const tbody = document.getElementById('modalStocksTableBody');
  const countText = document.getElementById('modalStockCountText');
  const pageInfo = document.getElementById('modalPageInfo');
  const prevBtn = document.getElementById('modalPrevPageBtn');
  const nextBtn = document.getElementById('modalNextPageBtn');

  const total = _modalFilteredStocks.length;
  const totalPages = Math.ceil(total / _modalPageSize) || 1;
  if (_modalCurrentPage > totalPages) _modalCurrentPage = totalPages;
  if (_modalCurrentPage < 1) _modalCurrentPage = 1;

  if (countText) countText.textContent = `共 ${total} 家成分股与主营画像 (第 ${_modalCurrentPage}/${totalPages} 页)`;
  if (pageInfo) pageInfo.textContent = `第 ${_modalCurrentPage} / ${totalPages} 页`;
  if (prevBtn) prevBtn.disabled = _modalCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = _modalCurrentPage >= totalPages;

  if (!tbody) return;
  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--sys-text-sub)">未找到匹配的成分股</td></tr>`;
    return;
  }

  const startIdx = (_modalCurrentPage - 1) * _modalPageSize;
  const pageItems = _modalFilteredStocks.slice(startIdx, startIdx + _modalPageSize);

  tbody.innerHTML = pageItems.map(s => {
    const isUp = s.change_pct >= 0;
    const chgColor = isUp ? '#3fb950' : '#f85149';
    return `
      <tr style="border-bottom:1px solid var(--sys-border);transition:background 0.15s" onmouseover="this.style.background='var(--sys-bg-hover)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px">
          <b style="color:var(--sys-text-title);font-size:14px">${s.name}</b>
          <div style="font-family:monospace;font-size:11px;color:var(--sys-text-sub);margin-top:2px">${s.code} (${(s.market || 'A').toUpperCase()})</div>
        </td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:13px;color:var(--sys-text-title)">
          ¥${s.price > 0 ? s.price.toFixed(2) : '--'}
        </td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:13px;color:${chgColor}">
          ${isUp ? '+' : ''}${s.change_pct.toFixed(2)}%
        </td>
        <td style="padding:10px 12px;color:#d1d4dc;font-size:12px;line-height:1.5">
          ${s.business}
        </td>
        <td style="padding:10px 12px;text-align:center">
          <div style="display:flex;gap:6px;justify-content:center">
            <button class="btn btn-outline" style="width:auto;padding:3px 8px;font-size:11px;border-color:#388bfd;color:var(--sys-accent)" onclick="modalCalcStock('${s.code}')" title="测算买卖点">🧮 测算</button>
            <button class="btn btn-outline" style="width:auto;padding:3px 8px;font-size:11px" onclick="modalAddWatch('${s.code}')" title="加入自选池">⭐ 自选</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function modalCalcStock(code) {
  const card = document.getElementById('modalStockCalcResultCard');
  if (!card) return;

  // 展开并显示加载状态
  card.style.display = 'block';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="color:var(--sys-accent);font-size:13px;display:flex;align-items:center;gap:8px">
        <span class="spinner"></span> 正在实时抓取 <b>${code}</b> 盘口与历史量价，测算 Alpha 买卖点与盈亏比...
      </div>
      <button class="btn btn-outline" style="width:auto;padding:2px 8px;font-size:11px" onclick="closeModalStockCalc()">✕ 收起</button>
    </div>
  `;

  try {
    const res = await authFetch('/api/alpha/calculate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol: code}),
    });
    const data = await res.json();
    if (!res.ok) {
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="color:#f85149;font-size:13px">❌ 测算失败: ${data.detail || '标的异常'}</div>
          <button class="btn btn-outline" style="width:auto;padding:2px 8px;font-size:11px" onclick="closeModalStockCalc()">✕ 收起</button>
        </div>
      `;
      return;
    }

    const r = data.result;
    const isSafe = r.risk_reward_ratio >= 2.0;
    const rrColor = isSafe ? '#3fb950' : '#f85149';

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--sys-border);padding-bottom:8px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:16px;font-weight:700;color:var(--sys-text-title)">🎯 ${r.name} (${r.symbol})</span>
          <span style="font-size:14px;color:var(--sys-accent);font-weight:700">现价 ¥${r.current_price.toFixed(2)}</span>
          ${isSafe ? '<span style="color:#3fb950;font-weight:700;font-size:11px;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px">● 盈亏比达标 (建议入场)</span>' : '<span style="color:#f85149;font-weight:700;font-size:11px;background:rgba(248,81,73,0.15);padding:2px 8px;border-radius:4px">⚠️ 盈亏比低于2.0 (建议观望)</span>'}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-blue" style="width:auto;padding:3px 10px;font-size:11px" onclick="gotoAlphaTrader('${r.symbol}')">🚀 去交易台深度分析</button>
          <button class="btn btn-outline" style="width:auto;padding:3px 8px;font-size:11px" onclick="closeModalStockCalc()">✕ 收起</button>
        </div>
      </div>
      
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;font-size:12px">
        <div style="background:#0d1117;padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
          <div style="color:var(--sys-text-sub);font-size:11px;margin-bottom:2px">建议买入区间</div>
          <b style="color:var(--sys-accent);font-size:13px">¥${r.buy_price_low} ~ ¥${r.buy_price_high}</b>
        </div>
        <div style="background:#0d1117;padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
          <div style="color:var(--sys-text-sub);font-size:11px;margin-bottom:2px">硬性止损价位</div>
          <b style="color:#f85149;font-size:13px">¥${r.stop_loss_price} (${r.stop_loss_pct}%)</b>
        </div>
        <div style="background:#0d1117;padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
          <div style="color:var(--sys-text-sub);font-size:11px;margin-bottom:2px">第一 / 第二止盈目标</div>
          <b style="color:#3fb950;font-size:13px">¥${r.target_price_1} / ¥${r.target_price_2}</b>
        </div>
        <div style="background:#0d1117;padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border)">
          <div style="color:var(--sys-text-sub);font-size:11px;margin-bottom:2px">预期盈亏比 / 建议仓位</div>
          <b style="color:${rrColor};font-size:13px">${r.risk_reward_ratio} : 1</b> <span style="color:var(--sys-text-sub)">(${r.recommended_shares.toLocaleString()}股)</span>
        </div>
      </div>
      
      <div style="margin-top:10px;font-size:12px;color:#d1d4dc;background:#0d1117;padding:8px 12px;border-radius:6px;border:1px solid var(--sys-border);line-height:1.5">
        💡 <b>量化操盘策略：</b>${r.summary}
      </div>
    `;
  } catch (err) {
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="color:#f85149;font-size:13px">请求异常: ${err.message}</div>
        <button class="btn btn-outline" style="width:auto;padding:2px 8px;font-size:11px" onclick="closeModalStockCalc()">✕ 收起</button>
      </div>
    `;
  }
}

function closeModalStockCalc() {
  const card = document.getElementById('modalStockCalcResultCard');
  if (card) card.style.display = 'none';
}

function gotoAlphaTrader(code) {
  closeSectorDetailModal();
  const diagTab = document.querySelector('.sub-tab[onclick*="alpha-diag"]');
  if (diagTab) switchSubTab('alpha-diag', diagTab);
  const input = document.getElementById('alphaCalcInput');
  if (input) {
    input.value = code;
    calculateAlphaSingle({ code });
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function modalAddWatch(code) {
  await quickAddWatchlist(code);
}

async function loadSectorFlows() {
  if (_isRefreshingSectors) return;
  _isRefreshingSectors = true;
  const tbody = document.getElementById('sectorFlowsTableBody');
  if (tbody && (!tbody.hasChildNodes() || _allSectorFlows.length === 0)) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:25px;color:var(--sys-text-sub)"><span class="spinner"></span> 正在实时抓取各大板块资金流动数据...</td></tr>`;
  }

  try {
    const res = await authFetch(`/api/market/sector-flows?type=${_currentSectorType}`);
    const data = await res.json();
    if (!res.ok) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#f85149">抓取资金流向失败: ${data.detail || '接口异常'}</td></tr>`;
      return;
    }

    // 前端双重保险严格去重，确保每个板块全表唯一 (兼容 flows 与 data 双返回字段)
    const rawList = data.flows || data.data || [];
    const seen = new Set();
    _allSectorFlows = rawList.filter(f => {
      const k = (f.sector_name || '').trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // 防止浏览器密码管理器自动将用户名填入搜索框导致过滤为空
    const sectorInput = document.getElementById('sectorSearchInput');
    if (sectorInput && (sectorInput.value === 'admin' || !_sectorSearchKeyword)) {
      sectorInput.value = '';
      _sectorSearchKeyword = '';
    }

    updateSectorSortHeaders();
    renderSectorFlowsTable();

  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#f85149">请求异常: ${e.message}</td></tr>`;
  } finally {
    _isRefreshingSectors = false;
  }
}

function clearSectorSearch() {
  const input = document.getElementById('sectorSearchInput');
  const clearBtn = document.getElementById('sectorSearchClearBtn');
  const suggest = document.getElementById('sectorSearchSuggest');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (suggest) suggest.style.display = 'none';
  _sectorSearchKeyword = '';
  _sectorFlowsCurrentPage = 1;
  renderSectorFlowsTable();
}
window.clearSectorSearch = clearSectorSearch;


async function quickAddWatchlist(preSymbol = null) {
  const input = document.getElementById('addWatchInput');
  let val = '';
  if (preSymbol) {
    val = typeof preSymbol === 'object' ? (preSymbol.code || preSymbol.symbol || '') : String(preSymbol);
  } else if (input) {
    val = input.dataset.selectedCode || input.value.trim();
  }
  if (!val) { showToast('请输入要加入自选的代码或名称', 'error'); return; }
  try {
    const res = await authFetch('/api/portfolio/add-watchlist', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol: val}),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || '已加入自选', 'success');
      if (input && !preSymbol) input.value = '';
      refreshPortfolioData();
    } else {
      showToast(data.detail || '添加自选失败', 'error');
    }
  } catch(e) { showToast(e.message, 'error'); }
}


async function removeWatchlist(symbol) {
  try {
    const res = await authFetch('/api/portfolio/remove-watchlist', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol}),
    });
    if (res.ok) {
      showToast(`已将 ${symbol} 移出自选`, 'success');
      refreshPortfolioData();
    }
  } catch(e) { showToast(e.message, 'error'); }
}

async function removePosition(symbol) {
  if (!confirm(`确定要删除持仓标的 [${symbol}] 吗？`)) return;
  try {
    const res = await authFetch('/api/portfolio/remove-position', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol}),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`已成功删除持仓: ${symbol}`, 'success');
      refreshPortfolioData();
    } else {
      showToast(data.detail || '删除持仓失败', 'error');
    }
  } catch(e) {
    showToast('删除异常: ' + e.message, 'error');
  }
}

function editPositionModal(symbol, shares, cost) {
  openAddPositionModal();
  const symInput = document.getElementById('manualPosSymbol');
  const sharesInput = document.getElementById('manualPosShares');
  const costInput = document.getElementById('manualPosCost');
  if (symInput) symInput.value = symbol;
  if (sharesInput) sharesInput.value = shares;
  if (costInput) costInput.value = cost;
}


let _isRefreshingPortfolio = false;
let _isRefreshingSectors = false;
let _isRefreshingBuzz = false;

async function refreshPortfolioData() {
  if (_isRefreshingPortfolio) return;
  _isRefreshingPortfolio = true;
  const cardsBox = document.getElementById('positionDiagCards');
  const watchTbody = document.getElementById('watchlistTableBody');

  try {
    const res = await authFetch('/api/portfolio/list');
    const data = await res.json();
    if (!res.ok) return;

    const summary = data.summary || {};
    // 1. 渲染对齐东方财富账户体系的 6 大核心指标
    if (document.getElementById('summaryTotalAsset')) {
      document.getElementById('summaryTotalAsset').textContent = `¥${(summary.total_capital || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
    if (document.getElementById('summaryMarketVal')) {
      document.getElementById('summaryMarketVal').textContent = `¥${(summary.total_market_value || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
    if (document.getElementById('summaryTodayPnl')) {
      const todayPnl = summary.today_pnl_amount || 0;
      const todayPnlPct = summary.today_pnl_pct || 0;
      const el = document.getElementById('summaryTodayPnl');
      el.textContent = `${todayPnl >= 0 ? '+' : '-'}¥${Math.abs(todayPnl).toFixed(2)} (${todayPnl >= 0 ? '+' : ''}${todayPnlPct.toFixed(2)}%)`;
      el.style.color = todayPnl >= 0 ? '#f85149' : '#3fb950'; // A股红涨绿跌
    }
    if (document.getElementById('summaryTotalPnl')) {
      const pnl = summary.total_pnl_amount || 0;
      const pnlPct = summary.total_pnl_pct || 0;
      const el = document.getElementById('summaryTotalPnl');
      el.textContent = `${pnl >= 0 ? '+' : '-'}¥${Math.abs(pnl).toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
      el.style.color = pnl >= 0 ? '#f85149' : '#3fb950'; // A股红涨绿跌
    }

    if (document.getElementById('summaryCash')) {
      document.getElementById('summaryCash').textContent = `¥${(summary.cash_available || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
    if (document.getElementById('summaryRatio')) {
      document.getElementById('summaryRatio').textContent = `${(summary.position_ratio_pct || 0).toFixed(2)}%`;
    }

    // 2. 渲染持仓深度诊断卡片列表
    const positions = data.positions || [];
    if (positions.length === 0) {
      if (cardsBox) cardsBox.innerHTML = `<div style="text-align:center;padding:30px;color:var(--sys-text-sub);background:#131722;border-radius:6px;border:1px dashed #2a2e39">当前暂无实盘持仓，已开启后台自动直连静默同步</div>`;
    } else {
      let cardsHtml = '';
      positions.forEach(p => {
        const isPnlUp = p.pnl_amount >= 0;
        const isTodayUp = p.today_pnl_amount >= 0;
        const pnlColor = isPnlUp ? '#f85149' : '#3fb950'; // A股红涨绿跌
        const todayColor = isTodayUp ? '#f85149' : '#3fb950';
        const reasonsList = (p.reasons || []).map(r => `<li style="margin-bottom:4px;color:var(--sys-text-primary)">${r}</li>`).join('');

        cardsHtml += `
          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid ${p.action_color};border-radius:var(--sys-card-radius);padding:16px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--sys-border);padding-bottom:10px;margin-bottom:12px">
              <div>
                <b style="font-size:16px;color:var(--sys-text-title)">${p.name}</b> &nbsp;<span style="color:var(--sys-text-sub);font-size:13px">${p.symbol}</span>
                <span style="margin-left:12px;font-size:13px;color:var(--sys-text-sub)">持仓: <b style="color:var(--sys-text-primary)">${p.shares.toLocaleString()} 股</b></span>
                <span style="margin-left:10px;font-size:13px;color:var(--sys-text-sub)">成本: <b style="color:var(--sys-text-primary)">¥${p.cost_price.toFixed(3)}</b></span>
                <span style="margin-left:10px;font-size:13px;color:var(--sys-text-sub)">现价: <b style="color:var(--sys-accent)">¥${p.current_price.toFixed(3)}</b></span>
                <span style="margin-left:10px;font-size:13px;color:var(--sys-text-sub)">仓位: <b style="color:var(--sys-text-primary)">${p.position_weight_pct}%</b></span>
              </div>
              <div style="display:flex;align-items:center;gap:14px">
                <div style="text-align:right">
                  <div style="font-size:11px;color:var(--sys-text-sub)">当日盈亏</div>
                  <b style="font-size:13px;color:${todayColor}">${isTodayUp ? '+' : ''}¥${p.today_pnl_amount.toFixed(2)} (${isTodayUp ? '+' : ''}${p.today_pnl_pct.toFixed(2)}%)</b>
                </div>
                <div style="text-align:right">
                  <div style="font-size:11px;color:var(--sys-text-sub)">持仓盈亏</div>
                  <b style="font-size:16px;font-weight:800;color:${pnlColor}">${isPnlUp ? '+' : ''}¥${p.pnl_amount.toFixed(2)} (${isPnlUp ? '+' : ''}${p.pnl_pct.toFixed(2)}%)</b>
                </div>
              </div>
            </div>

            <!-- 核心建议大徽章 -->
            <div style="background:var(--sys-bg-nav);border:1px solid var(--sys-border);border-radius:6px;padding:12px;margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <div>
                  <span style="font-size:12px;color:var(--sys-text-sub)">💡 智能执行指令：</span>
                  <span style="font-size:15px;font-weight:800;color:${p.action_color};background:rgba(255,255,255,0.08);padding:3px 10px;border-radius:4px;border:1px solid ${p.action_color}">
                    ${p.action}
                  </span>
                  ${p.suggest_shares > 0 ? `<b style="margin-left:10px;color:var(--sys-text-primary);font-size:13px">建议处理: ${p.suggest_shares.toLocaleString()} 股 (约 ¥${(p.suggest_amount/10000).toFixed(2)}万) · 剩余: ${p.remaining_shares.toLocaleString()} 股</b>` : `<b style="margin-left:10px;color:var(--sys-text-sub);font-size:13px">保持当前仓位不动</b>`}
                </div>
                <div style="font-size:12px;display:flex;gap:12px">
                  <span>建议防守止损价: <b style="color:#3fb950">¥${p.stop_loss_price.toFixed(3)}</b></span>
                  <span>目标止盈价: <b style="color:#f85149">¥${p.take_profit_price.toFixed(3)}</b></span>
                </div>
              </div>
            </div>

            <!-- 为什么这样操作的深度量化逻辑 -->
            <div style="font-size:12px;line-height:1.6">
              <span style="color:var(--sys-text-sub);font-weight:600">📌 决策依据与量化实战逻辑：</span>

              <ul style="margin:4px 0 8px 18px;padding:0">
                ${reasonsList}
              </ul>
              <div style="font-size:11px;color:var(--sys-text-sub);border-top:1px dashed var(--sys-border);padding-top:4px;display:flex;justify-content:space-between;align-items:center">
                <span>🛡️ 仓位风控：${p.risk_warning}</span>
                <div>
                  <button class="btn btn-outline" style="width:auto;padding:2px 8px;font-size:11px" onclick="quickJumpToCalculate('${p.symbol}')">🧮 重新测算买卖点</button>
                  <span style="margin-left:8px">持仓市值: ¥${p.market_value.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      if (cardsBox) cardsBox.innerHTML = cardsHtml;
    }

    // 3. 渲染自选列表 (严格 A 股红涨绿跌规范)
    const watchlist = data.watchlist || [];
    if (watchlist.length === 0) {
      if (watchTbody) watchTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--sys-text-sub)">暂无自选标的，在上方输入代码快速添加</td></tr>`;
    } else {
      let watchHtml = '';
      watchlist.forEach(w => {
        const isUp = w.change_pct >= 0;
        const color = isUp ? '#f85149' : '#3fb950'; // A 股红涨绿跌
        watchHtml += `
          <tr style="border-bottom:1px solid var(--sys-border)">
            <td style="padding:8px"><b style="color:var(--sys-text-title)">${w.name}</b> <span style="color:var(--sys-text-sub);font-size:11px">(${w.symbol})</span></td>
            <td style="padding:8px;font-weight:700;color:var(--sys-text-primary)">¥${w.current_price.toFixed(2)}</td>
            <td style="padding:8px;font-weight:700;color:${color}">${isUp ? '+' : ''}${w.change_pct.toFixed(2)}%</td>
            <td style="padding:8px;color:var(--sys-text-sub);font-size:12px">${w.notes || '东方财富自选同步'}</td>
            <td style="padding:8px;text-align:center">
              <button class="btn btn-outline" style="width:auto;padding:2px 8px;font-size:11px" onclick="quickJumpToCalculate('${w.symbol}')">测算买卖点</button>
              <button class="btn btn-outline" style="width:auto;padding:2px 6px;font-size:11px;margin-left:4px" onclick="removeWatchlist('${w.symbol}')">移出</button>
            </td>
          </tr>
        `;
      });
      if (watchTbody) watchTbody.innerHTML = watchHtml;
    }

    // 4. 渲染东方财富实盘历史成交流水
    const historyTrades = data.history_trades || [];
    const historyTbody = document.getElementById('tradeHistoryTbody');
    if (historyTbody) {
      if (historyTrades.length === 0) {
        historyTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--sys-text-sub)">暂无历史成交明细</td></tr>`;
      } else {
        const nameMap = {
          '159020': '养殖ETF',
          '512570': '中证证券',
          '001330': '博纳影业',
          '159278': '机器人PH'
        };
        let tradeHtml = '';
        historyTrades.forEach(t => {
          const isBuy = (t.action || 'buy') === 'buy';
          const stockName = nameMap[t.symbol] || t.name || t.symbol;
          const totalAmt = (t.price || 0) * (t.shares || 0);
          tradeHtml += `
            <tr style="border-bottom:1px solid var(--sys-border)">
              <td style="padding:8px;color:var(--sys-text-sub);font-family:monospace">${t.date || '2026-08-24'}</td>
              <td style="padding:8px"><b style="color:var(--sys-text-title)">${stockName}</b> <span style="color:var(--sys-text-sub);font-size:11px">(${t.symbol})</span></td>
              <td style="padding:8px;text-align:center">
                ${isBuy 
                  ? '<span style="color:#f85149;font-weight:700;background:rgba(248,81,73,0.12);padding:2px 8px;border-radius:4px;border:1px solid rgba(248,81,73,0.25)">● 买入</span>' 
                  : '<span style="color:#3fb950;font-weight:700;background:rgba(63,185,80,0.12);padding:2px 8px;border-radius:4px;border:1px solid rgba(63,185,80,0.25)">● 卖出</span>'}
              </td>
              <td style="padding:8px;text-align:right;font-weight:700;color:var(--sys-text-primary)">¥${(t.price || 0).toFixed(3)}</td>
              <td style="padding:8px;text-align:right;font-weight:700;color:var(--sys-text-primary)">${(t.shares || 0).toLocaleString()} 股</td>
              <td style="padding:8px;text-align:right;font-weight:700;color:var(--sys-text-title)">¥${totalAmt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              <td style="padding:8px;text-align:center"><span style="color:#3fb950;font-weight:600">已完全成交</span></td>
            </tr>
          `;
        });
        historyTbody.innerHTML = tradeHtml;
      }
    }




  } catch(e) {
  } finally {
    _isRefreshingPortfolio = false;
  }
}

function editPositionModal(sym, shares, cost) {
  openAddPositionModal();
  document.getElementById('manualPosSymbol').value = sym;
  document.getElementById('manualPosShares').value = shares;
  document.getElementById('manualPosCost').value = cost;
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

// ==================== 大盘与板块主力资金流动监控 ====================
let _currentSectorType = 'industry';

function switchSectorType(type) {
  _currentSectorType = type;
  _sectorFlowsCurrentPage = 1;
  const btnInd = document.getElementById('sectorTabInd');
  const btnCpt = document.getElementById('sectorTabCpt');
  if (type === 'industry') {
    if (btnInd) { btnInd.style.background = 'var(--sys-accent)'; btnInd.style.color = '#fff'; }
    if (btnCpt) { btnCpt.style.background = 'transparent'; btnCpt.style.color = 'var(--sys-text-sub)'; }
  } else {
    if (btnInd) { btnInd.style.background = 'transparent'; btnInd.style.color = 'var(--sys-text-sub)'; }
    if (btnCpt) { btnCpt.style.background = 'var(--sys-accent)'; btnCpt.style.color = '#fff'; }
  }
  loadSectorFlows();
}



// ==================== 抖音 / 小红书 / 社交媒体热度雷达 ====================
async function loadSocialBuzz() {
  const grid = document.getElementById('socialBuzzGrid');
  if (grid) grid.innerHTML = '<div style="color:var(--sys-text-sub);text-align:center;padding:30px;grid-column:1/-1"><span class="spinner"></span> 正在抓取抖音、小红书与全网财经热度与情绪指数...</div>';

  try {
    const res = await authFetch('/api/social/buzz-ranking?limit=12');
    const data = await res.json();
    if (!res.ok) {
      if (grid) grid.innerHTML = `<div style="color:#f85149;padding:20px;grid-column:1/-1">抓取社交热度失败: ${data.detail || '接口异常'}</div>`;
      return;
    }

    const items = data.rankings || [];
    if (items.length === 0) {
      if (grid) grid.innerHTML = '<div style="color:var(--sys-text-sub);padding:20px;grid-column:1/-1">暂无社交热度数据</div>';
      return;
    }

    grid.innerHTML = items.map(it => {
      const isExtremeBull = it.bullish_ratio >= 85.0;
      const statusColor = isExtremeBull ? '#f85149' : (it.bullish_ratio >= 65 ? '#3fb950' : 'var(--sys-text-sub)');
      const tagsHtml = (it.top_topics || []).map(t => `<span style="background:rgba(255,255,255,0.06);border:1px solid var(--sys-border);padding:2px 6px;border-radius:4px;font-size:11px;color:var(--sys-accent)">${t}</span>`).join(' ');

      return `
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:8px;padding:14px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
              <div>
                <b style="font-size:16px;color:var(--sys-text-title)">${it.name}</b>
                <span style="font-size:12px;color:var(--sys-text-sub);margin-left:4px">${it.symbol}</span>
                <span style="background:var(--sys-border);color:#f0883e;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px">${it.primary_source}</span>
              </div>
              <div style="text-align:right">
                <div style="font-size:18px;font-weight:800;color:#f0883e">${it.buzz_score} <span style="font-size:10px">热度分</span></div>
                <div style="font-size:10px;color:#3fb950">+${it.surge_pct}% 24H飙升</div>
              </div>
            </div>

            <!-- 散户多空情绪进度条 -->
            <div style="margin:8px 0">
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
                <span style="color:#3fb950;font-weight:700">看多 ${it.bullish_ratio}%</span>
                <span style="color:${statusColor};font-weight:700">${it.sentiment_status}</span>
                <span style="color:#f85149;font-weight:700">看空 ${it.bearish_ratio}%</span>
              </div>
              <div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--sys-border)">
                <div style="width:${it.bullish_ratio}%;background:#3fb950"></div>
                <div style="width:${it.bearish_ratio}%;background:#f85149"></div>
              </div>
            </div>

            <!-- 热门讨论标签 -->
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0">
              ${tagsHtml}
            </div>
          </div>

          <div style="font-size:11px;color:var(--sys-text-sub);border-top:1px dashed var(--sys-border);padding-top:8px;margin-top:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
            <span style="flex:1">💡 <b>舆情雷达：</b>${it.risk_warning}</span>
            <button class="btn btn-blue" style="width:auto;padding:3px 10px;font-size:11px" onclick="quickJumpToCalculate('${it.symbol}')">🧮 测算买卖点</button>
          </div>
        </div>
      `;
    }).join('');

  } catch(e) {
    if (grid) grid.innerHTML = `<div style="color:#f85149;padding:20px;grid-column:1/-1">请求异常: ${e.message}</div>`;
  }
}

// ==================== 自动数据同步与手动查缺补漏 ====================
async function loadSyncStatus() {
  const badge = document.getElementById('syncStatusBadge');
  try {
    const res = await authFetch('/api/system/sync-status');
    const data = await res.json();
    if (res.ok && data.sync_info) {
      const stats = data.sync_info.stats || {};
      const latestDate = stats.latest_date || '今日';
      if (badge) {
        badge.innerHTML = `🟢 数据已同步至最新 (${latestDate})`;
      }
    }
  } catch(e) {}
}

async function triggerSyncNow() {
  const btn = document.getElementById('syncDataBtn');
  const badge = document.getElementById('syncStatusBadge');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin" style="font-size:13px;display:inline-block;animation:spin 1s linear infinite"></i> <span>正在补漏...</span>';
  }
  if (badge) badge.innerHTML = '<span style="color:var(--sys-accent)">🔄 正在全网并发查缺补漏...</span>';

  try {
    const res = await authFetch('/api/system/sync-now', {method: 'POST'});
    const data = await res.json();
    if (res.ok) {
      showToast('⚡ 全网最新行情与实盘数据查缺补漏已完成！', 'success');
      if (typeof loadSyncStatus === 'function') loadSyncStatus();
      if (typeof refreshPortfolioData === 'function') refreshPortfolioData();
      if (typeof loadSectorFlows === 'function') loadSectorFlows();
      if (typeof loadSocialBuzz === 'function') loadSocialBuzz();
    } else {
      showToast(data.detail || '查缺补漏失败', 'error');
    }
  } catch(e) {
    showToast('同步异常: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-flashlight-line" style="font-size:13px;color:#f59e0b"></i> <span>查缺补漏</span>';
    }
  }
}


// ==================== 🏦 东方财富账户系统级自动守护前端控制器 ====================

function openEastMoneyModal() {
  const m = document.getElementById('eastMoneyModal');
  if (m) m.style.display = 'flex';
  fetchEastMoneyDaemonStatus();
}

function closeEastMoneyModal() {
  const m = document.getElementById('eastMoneyModal');
  if (m) m.style.display = 'none';
}

async function fetchEastMoneyDaemonStatus() {
  const pill = document.getElementById('emDaemonPill');
  const text = document.getElementById('emDaemonText');
  const modalUser = document.getElementById('emModalUser');
  const modalLastSync = document.getElementById('emModalLastSync');
  const modalToggle = document.getElementById('emAutoSyncToggle');

  try {
    const res = await authFetch('/api/eastmoney/daemon-status');
    const json = await res.json();
    if (res.ok && json.data) {
      const d = json.data;
      if (text) {
        text.textContent = d.is_authenticated ? `东财已直连 (${d.user_name})` : `未关联东财账户`;
      }
      if (pill) {
        if (d.is_authenticated) {
          pill.style.background = 'rgba(16,185,129,0.12)';
          pill.style.borderColor = 'rgba(16,185,129,0.3)';
          pill.style.color = '#10b981';
        } else {
          pill.style.background = 'rgba(248,81,73,0.12)';
          pill.style.borderColor = 'rgba(248,81,73,0.3)';
          pill.style.color = '#f85149';
        }
      }
      if (modalUser) modalUser.textContent = d.user_name;
      if (modalLastSync) modalLastSync.textContent = d.last_sync_time || '暂无';
      if (modalToggle) modalToggle.checked = d.auto_sync_enabled;
    }
  } catch(e) {}
}

async function triggerEmSyncNow() {
  const btn = document.getElementById('emSyncNowBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 同步中...'; }

  try {
    const res = await authFetch('/api/eastmoney/sync-now', {method: 'POST'});
    const data = await res.json();
    if (res.ok) {
      showToast('⚡ 东方财富实盘持仓与行情已完成全量同步！', 'success');
      fetchEastMoneyDaemonStatus();
      if (typeof refreshPortfolioData === 'function') await refreshPortfolioData();
      if (typeof loadPortfolioList === 'function') loadPortfolioList();
    } else {

      showToast(data.detail || '同步失败', 'error');
    }
  } catch(e) {
    showToast('同步异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '⚡ 立即全量同步一次'; }
  }
}

async function toggleEmAutoSync(enabled) {
  try {
    const res = await authFetch('/api/eastmoney/toggle-auto-sync', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enabled}),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, 'success');
      fetchEastMoneyDaemonStatus();
    }
  } catch(e) {
    showToast('切换失败: ' + e.message, 'error');
  }
}

async function unbindEastMoney() {
  if (!confirm('确定要解除当前绑定的东方财富账户吗？')) return;
  try {
    const res = await authFetch('/api/eastmoney/logout', {method: 'POST'});
    const data = await res.json();
    if (res.ok) {
      showToast('东方财富账户已解绑', 'info');
      closeEastMoneyModal();
      fetchEastMoneyDaemonStatus();
    }
  } catch(e) {
    showToast('解绑异常: ' + e.message, 'error');
  }
}

// 显式挂载全部函数到全局 window 对象
window.initAlphaDesk = initAlphaDesk;
window.refreshPortfolioData = refreshPortfolioData;
window.loadSectorFlows = loadSectorFlows;
window.loadSocialBuzz = loadSocialBuzz;
window.triggerSyncNow = triggerSyncNow;
window.loadSyncStatus = loadSyncStatus;
window.openEastMoneyModal = openEastMoneyModal;
window.closeEastMoneyModal = closeEastMoneyModal;
window.fetchEastMoneyDaemonStatus = fetchEastMoneyDaemonStatus;
window.triggerEmSyncNow = triggerEmSyncNow;
window.toggleEmAutoSync = toggleEmAutoSync;
window.unbindEastMoney = unbindEastMoney;