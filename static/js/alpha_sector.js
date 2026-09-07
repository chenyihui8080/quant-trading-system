/**
 * 系统一：Alpha 决策工作台 - 🏢 板块主力资金流动与成分股全息画像
 * 职责：大盘概念/实体行业资金流向排行、多维排序翻页、成分股全息画像透视弹窗
 */


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
          onclick="openSectorDetailModal('${jsStr(f.sector_name)}', '${jsStr(f.sector_type)}')"
          title="点击查看 ${escapeHtml(f.sector_name)} 全部成分股与企业主营业务画像">
        <td style="padding:10px 8px;text-align:left">
          <div style="font-weight:700;color:var(--sys-text-title);font-size:14px;display:flex;align-items:center;gap:6px">
            <span>${escapeHtml(f.sector_name)}</span>
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
          <div style="font-weight:700;color:var(--sys-accent);font-size:13px">${escapeHtml(leaderName)}</div>
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
          <b style="color:var(--sys-text-title);font-size:14px">${escapeHtml(s.name)}</b>
          <div style="font-family:monospace;font-size:11px;color:var(--sys-text-sub);margin-top:2px">${escapeHtml(s.code)} (${(s.market || 'A').toUpperCase()})</div>
        </td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:13px;color:var(--sys-text-title)">
          ¥${s.price > 0 ? s.price.toFixed(2) : '--'}
        </td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:13px;color:${chgColor}">
          ${isUp ? '+' : ''}${s.change_pct.toFixed(2)}%
        </td>
        <td style="padding:10px 12px;color:#d1d4dc;font-size:12px;line-height:1.5">
          ${escapeHtml(s.business)}
        </td>
        <td style="padding:10px 12px;text-align:center">
          <div style="display:flex;gap:6px;justify-content:center">
            <button class="btn btn-outline" style="width:auto;padding:3px 8px;font-size:11px;border-color:#388bfd;color:var(--sys-accent)" onclick="modalCalcStock('${jsStr(s.code)}')" title="测算买卖点">🧮 测算</button>
            <button class="btn btn-outline" style="width:auto;padding:3px 8px;font-size:11px" onclick="modalAddWatch('${jsStr(s.code)}')" title="加入自选池">⭐ 自选</button>
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
          <div style="color:#f85149;font-size:13px">❌ 测算失败: ${escapeHtml(data.detail || '标的异常')}</div>
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
          <span style="font-size:16px;font-weight:700;color:var(--sys-text-title)">🎯 ${escapeHtml(r.name)} (${escapeHtml(r.symbol)})</span>
          <span style="font-size:14px;color:var(--sys-accent);font-weight:700">现价 ¥${r.current_price.toFixed(2)}</span>
          ${isSafe ? '<span style="color:#3fb950;font-weight:700;font-size:11px;background:rgba(63,185,80,0.15);padding:2px 8px;border-radius:4px">● 盈亏比达标 (建议入场)</span>' : '<span style="color:#f85149;font-weight:700;font-size:11px;background:rgba(248,81,73,0.15);padding:2px 8px;border-radius:4px">⚠️ 盈亏比低于2.0 (建议观望)</span>'}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-blue" style="width:auto;padding:3px 10px;font-size:11px" onclick="gotoAlphaTrader('${jsStr(r.symbol)}')">🚀 去交易台深度分析</button>
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
        💡 <b>量化操盘策略：</b>${escapeHtml(r.summary)}
      </div>
    `;
  } catch (err) {
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="color:#f85149;font-size:13px">请求异常: ${escapeHtml(err.message)}</div>
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




// 显式导出全局调用接口，保障所有 HTML 内联事件 100% 正常调用
window.loadSectorFlows = loadSectorFlows;
window.sortSectorFlows = sortSectorFlows;
window.switchSectorType = switchSectorType;
window.changeSectorFlowsPage = changeSectorFlowsPage;
window.clearSectorSearch = clearSectorSearch;
window.openSectorDetailModal = openSectorDetailModal;
window.closeSectorDetailModal = closeSectorDetailModal;
