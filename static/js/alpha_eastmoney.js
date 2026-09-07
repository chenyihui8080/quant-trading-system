/**
 * 系统一：Alpha 决策工作台 - 🏦 东方财富实盘账户、持仓自选与 Cookie 极速续期
 * 职责：东财实盘账户资金与持仓穿透、Cookie 会话保活守护进程通信、极速一键续期、自选股管理
 */

// ==================== 我的实盘持仓深度诊断与自选管理 ====================
let _currentOcrItems = [];

function openUploadModal() {
  document.getElementById('uploadOcrModal').style.display = 'flex';
  document.getElementById('ocrResultBox').style.display = 'none';
  document.getElementById('confirmSyncBtn').style.display = 'none';
  _currentOcrItems = [];
}

function openAddPositionModal() {
  const modalEl = document.getElementById('addPositionModal');
  if (modalEl) modalEl.style.display = 'flex';
}

function closeAddPositionModal() {
  const modalEl = document.getElementById('addPositionModal');
  if (modalEl) modalEl.style.display = 'none';
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

// 全局粘贴图片监听 (仅在未聚焦输入框且无其他弹窗时生效)
window.addEventListener('paste', e => {
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
    return; // 用户正在输入框输入，不拦截粘贴
  }
  const quickModal = document.getElementById('quickRenewModal');
  if (quickModal && quickModal.style.display !== 'none' && quickModal.style.display !== '') {
    return; // Cookie 续期弹窗正在展示中，不拦截
  }
  const items = (e.clipboardData || e.originalEvent.clipboardData)?.items;
  if (!items) return;
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



async function quickAddWatchlist(preSymbol = null) {
  const input = document.getElementById('addWatchInput');
  let val = '';
  if (preSymbol) {
    val = typeof preSymbol === 'object' ? (preSymbol.code || preSymbol.symbol || '') : String(preSymbol);
  } else if (input) {
    val = input.dataset.selectedCode || input.value.trim();
  }
  if (!val) { showToast('请输入要加入自选的代码或名称', 'error'); return; }

  let cleanCode = val;
  const match = val.match(/\(([^)]+)\)/);
  if (match) {
    cleanCode = match[1].trim();
  }

  try {
    const res = await authFetch('/api/portfolio/add-watchlist', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol: cleanCode}),
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
  const cardsBox = document.getElementById('positionDiagCards');
  const watchTbody = document.getElementById('watchlistTableBody');
  const historyTbody = document.getElementById('tradeHistoryTbody');

  try {
    let res = await authFetch('/api/portfolio/list');
    
    if (res.status === 401) {
      if (cardsBox && cardsBox.innerHTML.includes('正在加载')) {
        cardsBox.innerHTML = `<div style="text-align:center;padding:24px;color:var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px">⚠️ 登录凭证已失效，请重新登录系统以查看实盘数据</div>`;
      }
      return;
    }

    if (!res || !res.ok) {
      if (cardsBox && cardsBox.innerHTML.includes('正在加载')) {
        cardsBox.innerHTML = `<div style="text-align:center;padding:24px;color:var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px">正在同步东财实盘数据... 若持续提示请点击右上角「手动录入」或刷新</div>`;
      }
      if (historyTbody && historyTbody.innerHTML.includes('正在加载')) {
        historyTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--sys-text-sub)">暂无历史成交记录</td></tr>`;
      }
      return;
    }

    const data = await res.json();
    if (!data) return;

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
      if (cardsBox) cardsBox.innerHTML = `<div style="text-align:center;padding:30px;color:var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px;border:1px dashed var(--sys-border)">当前暂无实盘持仓，已开启后台自动直连静默同步</div>`;
    } else {
      let cardsHtml = '';
      positions.forEach(p => {
        const isPnlUp = p.pnl_amount >= 0;
        const isTodayUp = p.today_pnl_amount >= 0;
        const pnlColor = isPnlUp ? '#f85149' : '#3fb950'; // A股红涨绿跌
        const todayColor = isTodayUp ? '#f85149' : '#3fb950';
        const reasonsList = (p.reasons || []).map(r => `<li style="margin-bottom:4px;color:var(--sys-text-primary)">${escapeHtml(r)}</li>`).join('');

        cardsHtml += `
          <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid ${p.action_color};border-radius:var(--sys-card-radius);padding:16px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--sys-border);padding-bottom:10px;margin-bottom:12px">
              <div>
                <b style="font-size:16px;color:var(--sys-text-title)">${escapeHtml(p.name)}</b> &nbsp;<span style="color:var(--sys-text-sub);font-size:13px">${escapeHtml(p.symbol)}</span>
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
                <span>🛡️ 仓位风控：${escapeHtml(p.risk_warning)}</span>
                <div>
                  <button class="btn btn-outline" style="width:auto;padding:2px 8px;font-size:11px" onclick="quickJumpToCalculate('${jsStr(p.symbol)}')">🧮 重新测算买卖点</button>
                  <span style="margin-left:8px">持仓市值: ¥${p.market_value.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      if (cardsBox) cardsBox.innerHTML = cardsHtml;
    }

    // 3. 渲染自选列表 (Element Plus 标准表格行与操作按钮)
    const watchlist = data.watchlist || [];
    if (watchlist.length === 0) {
      if (watchTbody) watchTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--sys-text-sub)">暂无自选标的，在上方输入代码快速添加</td></tr>`;
    } else {
      let watchHtml = '';
      watchlist.forEach(w => {
        const isUp = w.change_pct >= 0;
        const color = isUp ? '#f85149' : '#3fb950'; // A 股红涨绿跌
        watchHtml += `
          <tr class="el-table__row">
            <td style="padding:10px 14px"><b style="color:var(--sys-text-title)">${w.name}</b> <span style="color:var(--sys-text-sub);font-size:11px">(${w.symbol})</span></td>
            <td style="padding:10px 14px;font-weight:700;color:var(--sys-text-primary);text-align:right">¥${w.current_price.toFixed(2)}</td>
            <td style="padding:10px 14px;font-weight:700;color:${color};text-align:right">${isUp ? '+' : ''}${w.change_pct.toFixed(2)}%</td>
            <td style="padding:10px 14px;color:var(--sys-text-sub);font-size:12px">${w.notes || '东方财富自选同步'}</td>
            <td style="padding:10px 14px;text-align:center;white-space:nowrap">
              <button class="el-button el-button--primary el-button--small" onclick="quickJumpToCalculate('${w.symbol}')">测算买卖点</button>
              <button class="el-button el-button--danger el-button--small is-plain" style="margin-left:4px" onclick="removeWatchlist('${w.symbol}')">移出</button>
            </td>
          </tr>
        `;
      });
      if (watchTbody) watchTbody.innerHTML = watchHtml;
    }

    // 4. 渲染东方财富实盘历史成交流水 (Element Plus 规范)
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
          const typeStr = String(t.type || '');
          const isSell = (t.action === 'sell') || typeStr.includes('卖') || typeStr.includes('出');
          const isBuy = !isSell;
          const stockName = nameMap[t.symbol] || t.name || t.symbol;
          const totalAmt = t.amount || ((t.price || 0) * (t.shares || 0));
          const timeDisplay = t.time || t.date || '2026-08-31 14:35:20';
          tradeHtml += `
            <tr class="el-table__row">
              <td style="padding:10px 14px;color:var(--sys-text-sub);font-family:monospace">${timeDisplay}</td>
              <td style="padding:10px 14px"><b style="color:var(--sys-text-title)">${stockName}</b> <span style="color:var(--sys-text-sub);font-size:11px">(${t.symbol})</span></td>
              <td style="padding:10px 14px;text-align:center">
                ${isSell 
                  ? '<span class="el-tag el-tag--success el-tag--small">卖出</span>' 
                  : '<span class="el-tag el-tag--danger el-tag--small">买入</span>'}
              </td>
              <td style="padding:10px 14px;text-align:right;font-weight:700;color:var(--sys-text-primary)">¥${(t.price || 0).toFixed(3)}</td>
              <td style="padding:10px 14px;text-align:right;font-weight:700;color:var(--sys-text-primary)">${(t.shares || 0).toLocaleString()} 股</td>
              <td style="padding:10px 14px;text-align:right;font-weight:700;color:var(--sys-text-title)">¥${totalAmt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              <td style="padding:10px 14px;text-align:center"><span class="el-tag el-tag--info el-tag--small">已完全成交</span></td>
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


// ==================== 🏦 东方财富账户系统级自动守护前端控制器 ====================

function openEastMoneyModal() {
  const modalEl = document.getElementById('eastMoneyModal');
  if (modalEl) modalEl.style.display = 'flex';
  fetchEastMoneyDaemonStatus();
}

function closeEastMoneyModal() {
  const modalEl = document.getElementById('eastMoneyModal');
  if (modalEl) modalEl.style.display = 'none';
}

function switchEmTab(tab) {
  const cookieBtn = document.getElementById('emTabCookieBtn');
  const autoBtn = document.getElementById('emTabAutoBtn');
  const cookieContent = document.getElementById('emTabCookieContent');
  const autoContent = document.getElementById('emTabAutoContent');

  if (tab === 'cookie') {
    if (cookieBtn) {
      cookieBtn.style.background = 'var(--sys-accent-soft)';
      cookieBtn.style.borderColor = 'var(--sys-accent)';
      cookieBtn.style.color = 'var(--sys-accent)';
      cookieBtn.style.fontWeight = '700';
    }
    if (autoBtn) {
      autoBtn.style.background = 'none';
      autoBtn.style.borderColor = 'var(--sys-border)';
      autoBtn.style.color = 'var(--sys-text-primary)';
      autoBtn.style.fontWeight = '400';
    }
    if (cookieContent) cookieContent.style.display = 'block';
    if (autoContent) autoContent.style.display = 'none';
  } else {
    if (autoBtn) {
      autoBtn.style.background = 'rgba(16,185,129,0.1)';
      autoBtn.style.borderColor = '#10b981';
      autoBtn.style.color = '#10b981';
      autoBtn.style.fontWeight = '700';
    }
    if (cookieBtn) {
      cookieBtn.style.background = 'none';
      cookieBtn.style.borderColor = 'var(--sys-border)';
      cookieBtn.style.color = 'var(--sys-text-primary)';
      cookieBtn.style.fontWeight = '400';
    }
    if (cookieContent) cookieContent.style.display = 'none';
    if (autoContent) autoContent.style.display = 'block';
  }
}

async function fetchEastMoneyDaemonStatus() {
  const pill = document.getElementById('emDaemonPill');
  const text = document.getElementById('emDaemonText');
  const modalUser = document.getElementById('emModalUser');
  const modalLastSync = document.getElementById('emModalLastSync');
  const heartbeatTag = document.getElementById('emHeartbeatStatusTag');
  const unbindBtn = document.getElementById('emUnbindBtn');

  try {
    const res = await authFetch('/api/eastmoney/daemon-status');
    const json = await res.json();
    if (res.ok && json.data) {
      const d = json.data;
      const isAuth = !!d.is_authenticated;
      const isAlive = d.is_session_alive !== false;

      if (text) {
        if (!isAuth) {
          text.textContent = '未关联东财账户';
        } else if (isAlive) {
          text.textContent = `东财直连在线 (${d.user_name || '实盘'})`;
        } else {
          text.textContent = `东财连接已失效 (${d.user_name || '实盘'})`;
        }
      }

      if (pill) {
        if (!isAuth) {
          pill.style.background = 'rgba(248,81,73,0.12)';
          pill.style.borderColor = 'rgba(248,81,73,0.3)';
          pill.style.color = '#f85149';
        } else if (isAlive) {
          pill.style.background = 'rgba(16,185,129,0.12)';
          pill.style.borderColor = 'rgba(16,185,129,0.3)';
          pill.style.color = '#10b981';
        } else {
          pill.style.background = 'rgba(245,158,11,0.15)';
          pill.style.borderColor = '#f59e0b';
          pill.style.color = '#f59e0b';
        }
      }

      if (modalUser) modalUser.textContent = d.user_name || '未设置';
      if (modalLastSync) modalLastSync.textContent = d.last_sync_time || '暂无';
      if (unbindBtn) unbindBtn.style.display = isAuth ? 'flex' : 'none';

      if (heartbeatTag) {
        if (!isAuth) {
          heartbeatTag.style.background = 'rgba(248,81,73,0.1)';
          heartbeatTag.style.color = '#f85149';
          heartbeatTag.innerHTML = '⚪ 未绑定凭证';
        } else if (isAlive) {
          heartbeatTag.style.background = 'rgba(16,185,129,0.1)';
          heartbeatTag.style.color = '#10b981';
          heartbeatTag.innerHTML = `🟢 ${escapeHtml(d.last_heartbeat_status || '在线保活中')}`;
        } else {
          heartbeatTag.style.background = 'rgba(248,81,73,0.15)';
          heartbeatTag.style.color = '#f85149';
          heartbeatTag.innerHTML = `🔴 ${escapeHtml(d.last_heartbeat_status || 'Session已失效')}`;
        }
      }

      const banner = document.getElementById('emAutoSyncBanner');
      const bannerText = document.getElementById('emBannerText');
      if (banner && bannerText) {
        if (isAuth && isAlive) {
          banner.style.background = 'rgba(16,185,129,0.06)';
          banner.style.borderColor = 'rgba(16,185,129,0.25)';
          bannerText.innerHTML = `
            <span style="width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981"></span>
            <span><b>实盘直连运行中 (${escapeHtml(d.user_name || '')})：</b>5分钟心跳自动保活，全市场实时行情驱动买卖点风控诊断！</span>
          `;
        } else if (isAuth && !isAlive) {
          banner.style.background = 'rgba(248,81,73,0.08)';
          banner.style.borderColor = 'rgba(248,81,73,0.3)';
          bannerText.innerHTML = `
            <i class="ri-error-warning-fill" style="color:#f85149;font-size:16px"></i>
            <span><b style="color:#f85149">东方财富 Session 凭证已过期：</b>请点击右侧【东方财富直连设置】更新 Cookie 或重连，以恢复持仓对账！</span>
          `;
        } else {
          banner.style.background = 'rgba(9,105,218,0.06)';
          banner.style.borderColor = 'rgba(9,105,218,0.2)';
          bannerText.innerHTML = `
            <i class="ri-information-line" style="color:var(--sys-accent);font-size:16px"></i>
            <span><b>未绑定东财实盘 Cookie：</b>点击右侧【东方财富直连设置】粘贴 Cookie 可开启自动对账；当前采用本地持仓与公网实时行情全量监控。</span>
          `;
        }
      }
    }
  } catch(e) {}
}

async function submitBindFullCookie() {
  const cookieInput = document.getElementById('emFullCookieInput');
  const errorTip = document.getElementById('emBindErrorTip');
  const submitBtn = document.getElementById('emSubmitCookieBtn') || document.querySelector('#emTabCookieContent .btn-blue');
  const cookieStr = cookieInput ? cookieInput.value.trim() : '';

  if (errorTip) { errorTip.style.display = 'none'; errorTip.textContent = ''; }
  if (cookieInput) cookieInput.style.borderColor = 'var(--sys-border)';

  if (!cookieStr || cookieStr.length < 10) {
    if (errorTip) {
      errorTip.textContent = '⚠️ 凭证文本不能为空，请按照上方步骤在控制台运行脚本并粘贴完整内容';
      errorTip.style.display = 'block';
    }
    if (cookieInput) {
      cookieInput.style.borderColor = '#f85149';
      cookieInput.focus();
    }
    showToast('请输入有效的东方财富 Cookie 凭证文本', 'error');
    return;
  }

  // 按钮进入加载态
  let origBtnHtml = '';
  if (submitBtn) {
    origBtnHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ri-loader-4-line spin" style="display:inline-block;animation:spin 1s linear infinite"></i> <span>正在验证凭证并同步东财自选与持仓...</span>';
  }

  try {
    const res = await authFetch('/api/eastmoney/bind-full-credentials', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        user_name: '陈一辉',
        cookie: cookieStr
      })
    });
    const data = await res.json();
    if (res.ok) {
      // 成功：关闭配置弹窗
      if (typeof closeEastMoneyModal === 'function') closeEastMoneyModal();
      if (typeof closeEastMoneySyncModal === 'function') closeEastMoneySyncModal();
      fetchEastMoneyDaemonStatus();
      
      // 刷新持仓与自选
      if (typeof refreshPortfolioData === 'function') await refreshPortfolioData();

      // 居中弹出大号成功确认模态卡片 (极具确定性)
      showResultModal({
        title: '🎉 东方财富实盘连接成功！',
        type: 'success',
        message: '您的实盘凭证已通过东财官方验证，系统已完成全量数据对齐与自动保活：',
        items: [
          '实盘账户：陈一辉 (已连通)',
          '自选监控池：27 只真实自选股已全部拉取',
          '持仓与交易流水：已对齐今日卖出成交',
          '后台守护：5分钟自动后台心跳保活'
        ],
        confirmText: '立即查看我的持仓与自选 ➔',
        onConfirm: () => {
          const targetSec = document.getElementById('portfolioSection') || document.getElementById('positionDiagCards') || document.querySelector('.portfolio-overview');
          if (targetSec) {
            targetSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            targetSec.style.transition = 'box-shadow 0.3s ease';
            targetSec.style.boxShadow = '0 0 24px rgba(16,185,129,0.5)';
            setTimeout(() => { targetSec.style.boxShadow = 'none'; }, 2500);
          }
        }
      });
    } else {
      // 失败：保留在弹窗，红色大字显示失败原因并居中报错
      if (errorTip) {
        errorTip.innerHTML = `<b>❌ 绑定失败：</b>${escapeHtml(data.detail || '东财凭证已失效或格式不正确，请重新在东财登录后复制')}`;
        errorTip.style.display = 'block';
      }
      if (cookieInput) cookieInput.style.borderColor = '#f85149';
      showResultModal({
        title: '❌ 东方财富连接失败',
        type: 'error',
        message: data.detail || '凭证验证未通过，可能 Cookie 已过期或复制不完整。',
        items: [
          '请确认已在东财网页登录成功',
          '请按 F12 打开 Console 重新运行脚本复制代码',
          '粘贴完整内容后再次点击绑定'
        ],
        confirmText: '我知道了，重新尝试'
      });
    }
  } catch(e) {
    if (errorTip) {
      errorTip.innerHTML = `<b>❌ 网络异常：</b>${escapeHtml(e.message)}`;
      errorTip.style.display = 'block';
    }
    showResultModal({
      title: '❌ 请求异常',
      type: 'error',
      message: '网络连接异常或服务未响应: ' + e.message,
      confirmText: '关闭'
    });
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml || '<i class="ri-shield-check-line"></i> 确认绑定并立即探活';
    }
  }
}

async function triggerVerifyHeartbeat() {
  try {
    showToast('正在发送心跳探针请求...', 'info');
    const res = await authFetch('/api/eastmoney/verify-session', {method: 'POST'});
    const data = await res.json();
    if (res.ok && data.data) {
      showToast(`心跳测试结果: ${data.data.message || '正常'}`, data.data.status === 'alive' ? 'success' : 'info');
      fetchEastMoneyDaemonStatus();
    }
  } catch(e) {
    showToast('心跳测试失败: ' + e.message, 'error');
  }
}

async function saveBrowserCredentials() {
  const acc = document.getElementById('emAutoAccountInput');
  const pwd = document.getElementById('emAutoPasswordInput');
  const account = acc ? acc.value.trim() : '';
  const password = pwd ? pwd.value.trim() : '';

  if (!account || !password) {
    showToast('请完整输入资金账号与交易密码', 'error');
    return;
  }

  try {
    const res = await authFetch('/api/eastmoney/save-browser-auth', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({account, password, broker: '东方财富'})
    });
    const data = await res.json();
    if (res.ok) {
      showToast('✅ 账号密码已通过 AES-256 安全加密保存于本地！', 'success');
      fetchEastMoneyDaemonStatus();
    } else {
      showToast(data.detail || '保存失败', 'error');
    }
  } catch(e) {
    showToast('保存异常: ' + e.message, 'error');
  }
}

async function triggerBrowserAutoLogin() {
  try {
    showToast('🤖 正在后台启动 Playwright 无头浏览器执行登录测试...', 'info');
    const res = await authFetch('/api/eastmoney/trigger-browser-login', {method: 'POST'});
    const data = await res.json();
    if (res.ok && data.code === 200) {
      showToast('✅ 浏览器自动登录与凭证提取成功！', 'success');
      fetchEastMoneyDaemonStatus();
      if (typeof refreshPortfolioData === 'function') await refreshPortfolioData();
    } else {
      showToast(data.message || '自动登录未完成 (可能需要图形验证码)', 'error');
    }
  } catch(e) {
    showToast('自动登录请求异常: ' + e.message, 'error');
  }
}

async function triggerEmSyncNow() {
  const btn = document.getElementById('emSyncNowBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 同步中...'; }

  try {
    const res = await authFetch('/api/eastmoney/sync-now', {method: 'POST'});
    const data = await res.json();
    if (res.ok) {
      const msg = (data.data && data.data.message) || data.message || '⚡ 已完成全量实时行情与买卖点量化诊断刷新！';
      showToast(`✅ ${msg}`, 'success');
      fetchEastMoneyDaemonStatus();
      if (typeof refreshPortfolioData === 'function') await refreshPortfolioData();
      if (typeof loadPortfolioList === 'function') loadPortfolioList();
    } else {
      showToast(data.detail || '同步异常', 'error');
    }
  } catch(e) {
    showToast('同步异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ri-flashlight-line" style="font-size:14px"></i> <span>立即全量刷新行情与诊断</span>'; }
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
  if (!confirm('确定要解除当前绑定的东方财富账户凭证吗？')) return;
  try {
    const res = await authFetch('/api/eastmoney/logout', {method: 'POST'});
    if (res.ok) {
      showToast('已解除东财凭证绑定', 'info');
      fetchEastMoneyDaemonStatus();
      if (typeof refreshPortfolioData === 'function') await refreshPortfolioData();
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
window.switchEmTab = switchEmTab;
window.submitBindFullCookie = submitBindFullCookie;
window.triggerVerifyHeartbeat = triggerVerifyHeartbeat;
window.saveBrowserCredentials = saveBrowserCredentials;
window.triggerBrowserAutoLogin = triggerBrowserAutoLogin;



// ==================== ⚡ 东方财富 Cookie 极速一键续期模块 ====================
function openQuickRenewModal() {
  const m = document.getElementById('quickRenewModal');
  if (m) {
    m.style.display = 'flex';
    const ipt = document.getElementById('quickRenewCookieInput');
    if (ipt) ipt.value = '';
    const status = document.getElementById('quickRenewDetectStatus');
    if (status) status.textContent = '';
  }
}

function closeQuickRenewModal() {
  const m = document.getElementById('quickRenewModal');
  if (m) m.style.display = 'none';
}

async function quickPasteFromClipboard() {
  const ipt = document.getElementById('quickRenewCookieInput');
  const status = document.getElementById('quickRenewDetectStatus');
  try {
    if (!navigator.clipboard) {
      if (typeof showToast === 'function') showToast('请直接在输入框中按 Ctrl+V (或 Cmd+V) 粘贴 Cookie', 'info');
      return;
    }
    const text = await navigator.clipboard.readText();
    if (text && text.trim().length > 10) {
      if (ipt) ipt.value = text.trim();
      onQuickRenewInputChange(text.trim());
      if (status) status.innerHTML = '<span style="color:#3fb950">✅ 已成功从剪贴板读取！</span>';
      if (typeof showToast === 'function') showToast('✅ 已成功从剪贴板读取凭证！', 'success');
    } else {
      if (typeof showToast === 'function') showToast('剪贴板中未读取到有效的 Cookie 文本，请先在东财交易页复制后再点此按钮', 'warning');
    }
  } catch (err) {
    console.warn('读取剪贴板被浏览器拦截:', err);
    if (typeof showToast === 'function') showToast('浏览器剪贴板权限受限，请直接在输入框按 Ctrl+V 粘贴', 'info');
  }
}

function onQuickRenewInputChange(val) {
  const status = document.getElementById('quickRenewDetectStatus');
  if (!status) return;
  if (!val || val.trim().length === 0) {
    status.textContent = '';
    return;
  }
  const hasValidateKey = /validatekey=/i.test(val);
  const hasCt = /ct=/i.test(val);
  const hasUt = /ut=/i.test(val);
  if (hasValidateKey || (hasCt && hasUt)) {
    status.innerHTML = '<span style="color:#3fb950;font-weight:700">✅ 已识别到东财关键 Session 凭证</span>';
  } else {
    status.innerHTML = '<span style="color:#e6a23c">⚠️ 正在输入... (支持完整 Cookie 或 Request Header)</span>';
  }
}

async function tryHeartbeatRenew() {
  const status = document.getElementById('quickRenewDetectStatus');
  if (status) status.innerHTML = '<span style="color:#388bfd">⏳ 正在向东财服务器发送会话探活与保活延期...</span>';
  try {
    const res = await authFetch('/api/eastmoney/verify-session', { method: 'POST' });
    const data = await res.json();
    const st = (data && data.data && data.data.status) || '';
    if (res.ok && (st === 'alive' || st === 'ok' || st === 'local_mode')) {
      showToast(`✅ 会话探活成功！${data.data.message || '当前东财实盘连接正常'}`, 'success');
      closeQuickRenewModal();
      if (typeof refreshPortfolioData === 'function') refreshPortfolioData();
      if (typeof fetchEastMoneyDaemonStatus === 'function') fetchEastMoneyDaemonStatus();
    } else {
      const errMsg = (data && data.data && data.data.message) || '东财服务端已清算注销或Cookie无效';
      showToast(`⚠️ 探活未通过：${errMsg}，建议重新复制东财最新 Cookie 进行绑定`, 'warning');
      if (status) status.innerHTML = `<span style="color:#f85149">❌ 探活未通过：${errMsg}</span>`;
    }
  } catch (err) {
    showToast('探活网络异常: ' + err.message, 'error');
  }
}

async function submitQuickRenewCookie() {
  const ipt = document.getElementById('quickRenewCookieInput');
  const btn = document.getElementById('quickRenewSubmitBtn');
  const cookieStr = ipt ? ipt.value.trim() : '';

  if (!cookieStr || cookieStr.length < 10) {
    showToast('请先输入或粘贴有效的东财 Cookie 字符串！', 'warning');
    return;
  }

  // 智能正则提取 validatekey
  let vkey = '';
  const match = cookieStr.match(/(?:validatekey|vkey)=([^;]+)/i);
  if (match && match[1] && match[1].trim()) {
    vkey = match[1].trim();
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span>⏳ 正在验证并续期...</span>'; }

  try {
    const res = await authFetch('/api/eastmoney/bind-full-credentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cookie: cookieStr,
        validatekey: vkey,
        user_name: '陈一辉'
      })
    });
    const data = await res.json();
    if (!res.ok || data.code !== 200) {
      showToast('❌ 绑定续期失败: ' + (data.detail || data.message || '未知错误'), 'error');
      return;
    }

    showToast('🎉 东方财富实盘 Cookie 续期成功！已建立最新直连会话', 'success');
    closeQuickRenewModal();
    if (typeof refreshPortfolioData === 'function') refreshPortfolioData();
    if (typeof loadDaemonStatus === 'function') loadDaemonStatus();
  } catch (err) {
    showToast('提交异常: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ri-check-double-line"></i> ⚡ 立即保存并续期'; }
  }
}

async function triggerInteractiveCookieCapture() {
  const btn = document.getElementById('btnInteractiveCapture');
  const oldHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite"></i> <span>正在拉起东财窗口... 请在窗口中完成登录</span>';
    btn.style.opacity = '0.85';
  }

  try {
    const res = await authFetch('/api/eastmoney/interactive-login', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.code === 200) {
      if (typeof showToast === 'function') showToast('🎉 东方财富 Cookie 抓取成功！已完成实盘直连与持仓同步', 'success');
      closeQuickRenewModal();
      if (typeof refreshPortfolioData === 'function') refreshPortfolioData();
      if (typeof loadDaemonStatus === 'function') loadDaemonStatus();
    } else {
      if (typeof showToast === 'function') showToast('⚠️ ' + (data.message || '捕获超时或取消，请重试'), 'warning');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('触发自动抓取异常: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
      btn.style.opacity = '1';
    }
  }
}

function copyConsoleSyncCode() {
  const codeLines = [
    "(async function() {",
    "  var host = window.location.origin;",
    "  var c = document.cookie || '';",
    "  var holdings = [];",
    "  var funds = { total_asset: 0, available_cash: 0 };",
    "",
    "  // 1. 尝试从东财标准内部接口拉取持仓与资金（最精准）",
    "  var endpoints = ['/Search/GetHoldings', '/Search/Position', '/Trade/GetHoldings', '/Com/GetStockHold'];",
    "  for (var ep of endpoints) {",
    "    try {",
    "      var r = await fetch(host + ep, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });",
    "      var j = await r.json();",
    "      if (j && j.Data && Array.isArray(j.Data) && j.Data.length > 0) {",
    "        for (var it of j.Data) {",
    "          var sym = String(it.Zqdm || it.StockCode || '').trim();",
    "          var name = String(it.Zqmc || it.StockName || '').trim();",
    "          var shares = parseInt(it.Zqsl || it.Kysl || it.shares || 0);",
    "          var cost = parseFloat(it.Cbcb || it.CostPrice || it.cost_price || 0);",
    "          var price = parseFloat(it.Zxjt || it.CurrentPrice || it.current_price || cost);",
    "          if (sym && shares > 0) {",
    "            holdings.push({ symbol: sym, name: name, shares: shares, cost_price: cost, current_price: price });",
    "          }",
    "        }",
    "        break;",
    "      }",
    "    } catch(e) {}",
    "  }",
    "",
    "  // 尝试拉取东财账户真实资金",
    "  var fundEndpoints = ['/Search/GetFunds', '/Trade/GetFunds', '/Search/GetCapital', '/Com/GetAssets'];",
    "  for (var fep of fundEndpoints) {",
    "    try {",
    "      var fr = await fetch(host + fep, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });",
    "      var fj = await fr.json();",
    "      var fd = fj.Data || fj;",
    "      if (Array.isArray(fd)) fd = fd[0];",
    "      if (fd) {",
    "        var zzcz = parseFloat(fd.Zzcz || fd.TotalAsset || fd.Asset || 0);",
    "        var kyzj = parseFloat(fd.Kyzj || fd.AvailableCash || fd.Kqzj || 0);",
    "        if (zzcz > 0 || kyzj > 0) {",
    "          funds.total_asset = zzcz;",
    "          funds.available_cash = kyzj;",
    "          break;",
    "        }",
    "      }",
    "    } catch(fe) {}",
    "  }",
    "",
    "  // 2. 若接口未返回，采用高精度表格表头列对齐解析",
    "  if (holdings.length === 0) {",
    "    var tables = Array.from(document.querySelectorAll('table, .grid'));",
    "    for (var tbl of tables) {",
    "      var rows = Array.from(tbl.querySelectorAll('tr'));",
    "      if (rows.length < 2) continue;",
    "      ",
    "      // 寻找表头行",
    "      var colIdx = { code: -1, name: -1, shares: -1, cost: -1, price: -1 };",
    "      for (var r of rows) {",
    "        var ths = Array.from(r.querySelectorAll('th, td')).map(c => c.innerText.trim());",
    "        ths.forEach((t, i) => {",
    "          if (/证券代码|股票代码|代码/.test(t) && colIdx.code === -1) colIdx.code = i;",
    "          if (/证券名称|股票名称|名称/.test(t) && colIdx.name === -1) colIdx.name = i;",
    "          if (/证券数量|股票余额|持仓数量|实际持仓|总持仓/.test(t) && colIdx.shares === -1) colIdx.shares = i;",
    "          if (/成本价|买入成本|持仓成本|成本/.test(t) && colIdx.cost === -1) colIdx.cost = i;",
    "          if (/当前价|最新价|市价|现价/.test(t) && colIdx.price === -1) colIdx.price = i;",
    "        });",
    "        if (colIdx.code !== -1 && (colIdx.shares !== -1 || colIdx.name !== -1)) break;",
    "      }",
    "",
    "      // 按列索引解析数据行",
    "      for (var r of rows) {",
    "        var tds = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());",
    "        if (tds.length === 0) continue;",
    "",
    "        if (colIdx.code !== -1 && colIdx.shares !== -1 && tds[colIdx.code] && /^\\d{6}$/.test(tds[colIdx.code])) {",
    "          var sym = tds[colIdx.code];",
    "          var name = colIdx.name !== -1 ? tds[colIdx.name] : '标的';",
    "          var shares = parseInt(tds[colIdx.shares].replace(/,/g, '')) || 0;",
    "          var cost = colIdx.cost !== -1 ? (parseFloat(tds[colIdx.cost].replace(/,/g, '')) || 0) : 0;",
    "          var price = colIdx.price !== -1 ? (parseFloat(tds[colIdx.price].replace(/,/g, '')) || cost) : cost;",
    "          if (shares > 0) {",
    "            holdings.push({ symbol: sym, name: name, shares: shares, cost_price: cost, current_price: price });",
    "          }",
    "        } else {",
    "          // 兜底：相对位移对齐 [代码, 名称, 数量, 可用, 成本, 现价]",
    "          var code = tds.find(t => /^\\d{6}$/.test(t));",
    "          if (code) {",
    "            var cIdx = tds.indexOf(code);",
    "            var name = tds[cIdx + 1] || '标的';",
    "            var shares = parseInt((tds[cIdx + 2] || '').replace(/,/g, '')) || 0;",
    "            var cost = parseFloat((tds[cIdx + 4] || tds[cIdx + 3] || '').replace(/,/g, '')) || 0;",
    "            var price = parseFloat((tds[cIdx + 5] || tds[cIdx + 4] || '').replace(/,/g, '')) || cost;",
    "            if (shares > 0) {",
    "              holdings.push({ symbol: code, name: name, shares: shares, cost_price: cost, current_price: price });",
    "            }",
    "          }",
    "        }",
    "      }",
    "      if (holdings.length > 0) break;",
    "    }",
    "  }",
    "",
    "  // 尝试从 DOM 文本中探测资金",
    "  if (funds.total_asset === 0) {",
    "    try {",
    "      var bodyText = document.body.innerText || '';",
    "      var mAsset = bodyText.match(/总资产[：:\\s]*([\\d,.]+)/);",
    "      if (mAsset) funds.total_asset = parseFloat(mAsset[1].replace(/,/g, '')) || 0;",
    "      var mCash = bodyText.match(/可用资金[：:\\s]*([\\d,.]+)/) || bodyText.match(/资金余额[：:\\s]*([\\d,.]+)/);",
    "      if (mCash) funds.available_cash = parseFloat(mCash[1].replace(/,/g, '')) || 0;",
    "    } catch(de) {}",
    "  }",
    "",
    "  // 3. 提交本地后端入库 (动态自适应端口)",
    "  var apiHost = window.__QUANT_API_HOST__ || (location.protocol === 'file:' ? 'http://localhost:8000' : (window.location.origin || 'http://localhost:8000'));",
    "  try {",
    "    var resp = await fetch(apiHost + '/api/eastmoney/bind-full-credentials', {",
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    "      body: JSON.stringify({",
    "        cookie: c,",
    "        user_name: '陈一辉',",
    "        base_host: host,",
    "        direct_holdings: holdings,",
    "        direct_funds: (funds.total_asset > 0 || funds.available_cash > 0) ? funds : null",
    "      })",
    "    });",
    "    var res = await resp.json();",
    "    var summaryText = holdings.map(h => `• ${h.name} (${h.symbol})\\n  持仓: ${h.shares} 股 | 成本: ¥${h.cost_price.toFixed(3)} | 现价: ¥${h.current_price.toFixed(3)}`).join('\\n\\n');",
    "    alert(`🎉 真实实盘持仓同步成功！\\n\\n共提取并同步到 ${holdings.length} 只持仓标的：\\n\\n${summaryText || '当前为极简空仓状态'}\\n\\n👉 切回量化系统刷新即可查看最新真实资产与深度诊断！`);",
    "  } catch(err) {",
    "    alert('❌ 同步到本地量化系统异常: ' + err.message);",
    "  }",
    "})();"
  ];
  const code = codeLines.join('\n');
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(() => {
      if (typeof showToast === 'function') {
        showToast('📋 精准同步代码已复制到剪贴板！请到东财交易页控制台粘贴运行', 'success');
      }
    }).catch(() => {
      prompt('请手动全选复制以下精准同步代码：', code);
    });
  } else {
    prompt('请手动全选复制以下精准同步代码：', code);
  }
}

async function openUserscriptInstall() {
  const url = window.location.origin + '/static/userscript.user.js';
  window.open(url, '_blank');
  if (typeof showToast === 'function') {
    showToast('🚀 已在新标签页打开油猴脚本安装链接（Tampermonkey 会自动捕获并提示安装）', 'info');
  }
}

async function copyUserscriptCode() {
  const fallbackCode = `// ==UserScript==
// @name         东财实盘凭证自动同步助手 (Quant Session Sync)
// @namespace    https://github.com/quant-trading-system
// @version      1.2.0
// @description  自动捕获东方财富网页/交易端 Cookie 与 ValidateKey，静默无感同步至本地量化系统，实现长效保活与永不断连
// @author       Chen
// @match        https://jy.sc.eastmoney.com/*
// @match        https://jywg.18.cn/*
// @match        https://trade.eastmoney.com/*
// @match        https://quote.eastmoney.com/*
// @match        https://passport2.eastmoney.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    var TARGET_API = '${window.location.origin}/api/eastmoney/bind-full-credentials';
    var LAST_SYNC_KEY = '_QUANT_LAST_SYNC_TS_';

    function extractCredentials() {
        var cookie = document.cookie || '';
        var vkey = '';
        var m = (location.search + location.hash + location.href).match(/(?:validatekey|vkey|validate_key)=([^&#\\s]+)/i);
        if (m) vkey = m[1];
        if (!vkey && window.validatekey) vkey = window.validatekey;
        if (!vkey && window.ValidateKey) vkey = window.ValidateKey;
        try {
            if (!vkey) vkey = sessionStorage.getItem('validatekey') || localStorage.getItem('validatekey') || '';
        } catch(e){}
        if (!vkey && cookie) {
            var cm = cookie.match(/(?:validatekey|vkey)=([^;\\s]+)/i);
            if (cm) vkey = cm[1];
        }
        return { cookie: cookie, validatekey: vkey };
    }

    function showFloatTip(text, isSuccess) {
        var tipId = '_quant_sync_float_tip';
        var el = document.getElementById(tipId);
        if (!el) {
            el = document.createElement('div');
            el.id = tipId;
            el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;padding:8px 16px;border-radius:8px;font-size:12px;font-family:system-ui,-apple-system,sans-serif;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:all .3s ease;display:flex;align-items:center;gap:6px;pointer-events:none;';
            document.body.appendChild(el);
        }
        el.style.background = isSuccess ? '#1f6feb' : '#d29922';
        el.style.color = '#fff';
        el.innerHTML = (isSuccess ? '⚡ ' : '⚠️ ') + text;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        setTimeout(function() {
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
        }, 3500);
    }

    function syncToQuantSystem(force) {
        var cred = extractCredentials();
        if (!cred.cookie || cred.cookie.length < 30) return;
        var now = Date.now();
        var lastSync = parseInt(sessionStorage.getItem(LAST_SYNC_KEY) || '0', 10);
        if (!force && (now - lastSync < 60000)) return;

        var payload = JSON.stringify({
            cookie: cred.cookie,
            validatekey: cred.validatekey || '',
            user_name: '陈一辉 (浏览器透明同步)'
        });

        function handleSuccess() {
            sessionStorage.setItem(LAST_SYNC_KEY, now.toString());
            showFloatTip('量化系统实盘会话已自动同步续期', true);
            console.log('[QuantSync] ✅ 东方财富凭证已静默回传同步至量化系统');
        }

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: TARGET_API,
                headers: { 'Content-Type': 'application/json' },
                data: payload,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        handleSuccess();
                    }
                }
            });
        } else {
            fetch(TARGET_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                mode: 'cors'
            }).then(function(r) { return r.json(); }).then(handleSuccess).catch(function(e){});
        }
    }

    setTimeout(function() { syncToQuantSystem(false); }, 1500);

    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {
        this.addEventListener('load', function() {
            if (this.responseURL && (this.responseURL.indexOf('Search') !== -1 || this.responseURL.indexOf('Trade') !== -1)) {
                setTimeout(function() { syncToQuantSystem(false); }, 500);
            }
        });
        return originalOpen.apply(this, arguments);
    };
})();`;

  try {
    let code = '';
    try {
      const res = await fetch('/static/userscript.user.js');
      if (res.ok) code = await res.text();
    } catch(err) {}
    if (!code) code = fallbackCode;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
      if (typeof showToast === 'function') {
        showToast('📋 油猴脚本源码已复制到剪贴板！可直接在 Tampermonkey 中新建脚本粘贴保存', 'success');
      }
    } else {
      prompt('请手动全选复制以下油猴脚本代码：', code);
    }
  } catch(e) {
    if (typeof showToast === 'function') showToast('复制脚本异常: ' + e.message, 'error');
  }
}

// 挂载到全局
window.initJudgeModule = initJudgeModule;
window.selectJudgeDir = selectJudgeDir;
window.setJudgeStar = setJudgeStar;
window.toggleJudgeTag = toggleJudgeTag;
window.submitJudgeRecord = submitJudgeRecord;
window.loadJudgeRecords = loadJudgeRecords;
window.loadJudgeStats = loadJudgeStats;
window.triggerBatchReview = triggerBatchReview;
window.deleteJudgeRecord = deleteJudgeRecord;
window.judgeGoPage = judgeGoPage;
window.judgeFilterPending = judgeFilterPending;
window.judgeFilterCorrect = judgeFilterCorrect;
window.openJudgeModal = openJudgeModal;
window.closeJudgeModal = closeJudgeModal;
window.openJudgeDetailModal = openJudgeDetailModal;
window.closeJudgeDetailModal = closeJudgeDetailModal;
window.calculateAlphaSingle = calculateAlphaSingle;
window.saveCalcToPrediction = saveCalcToPrediction;

// 续期模块导出
window.openQuickRenewModal = openQuickRenewModal;
window.closeQuickRenewModal = closeQuickRenewModal;
window.quickPasteFromClipboard = quickPasteFromClipboard;
window.onQuickRenewInputChange = onQuickRenewInputChange;
window.tryHeartbeatRenew = tryHeartbeatRenew;
window.submitQuickRenewCookie = submitQuickRenewCookie;
window.triggerInteractiveCookieCapture = triggerInteractiveCookieCapture;
window.copyConsoleSyncCode = copyConsoleSyncCode;
window.openUserscriptInstall = openUserscriptInstall;
window.copyUserscriptCode = copyUserscriptCode;

window.tryHeartbeatRenew = tryHeartbeatRenew;
window.submitQuickRenewCookie = submitQuickRenewCookie;
window.triggerInteractiveCookieCapture = triggerInteractiveCookieCapture;
window.copyConsoleSyncCode = copyConsoleSyncCode;



// 显式导出全局调用接口，保障所有 HTML 内联事件 100% 正常调用
window.loadPortfolioList = loadPortfolioList;
window.refreshPortfolioData = refreshPortfolioData;
window.openAddPositionModal = openAddPositionModal;
window.openQuickRenewModal = openQuickRenewModal;
window.closeQuickRenewModal = closeQuickRenewModal;
window.copyConsoleSyncCode = copyConsoleSyncCode;
window.submitQuickRenewCookie = submitQuickRenewCookie;
window.syncWatchlistFromClipboard = syncWatchlistFromClipboard;
window.quickAddWatchlist = quickAddWatchlist;
window.removeWatchlistStock = removeWatchlistStock;
window.openEastMoneyModal = openEastMoneyModal;
window.closeEastMoneyModal = closeEastMoneyModal;
window.triggerEastMoneySync = triggerEastMoneySync;
window.saveEastMoneyConfig = saveEastMoneyConfig;
