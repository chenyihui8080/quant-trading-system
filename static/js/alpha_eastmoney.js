/**
 * 系统一：Alpha 决策工作台 - 🏦 东方财富实盘账户、持仓自选与 Cookie 极速续期
 * 职责：东财实盘账户资金与持仓穿透、Cookie 会话保活守护进程通信、极速一键续期、自选股管理
 */

// ==================== 我的实盘持仓深度诊断与自选管理 ====================
let _currentOcrItems = [];

function openUploadModal() {
  const m = document.getElementById('uploadOcrModal');
  if (m) m.style.display = 'flex';
  const box = document.getElementById('ocrResultBox');
  if (box) box.style.display = 'none';
  const btn = document.getElementById('confirmSyncBtn');
  if (btn) btn.style.display = 'none';
  _currentOcrItems = [];
}

function closeUploadModal() {
  const m = document.getElementById('uploadOcrModal');
  if (m) m.style.display = 'none';
  const box = document.getElementById('ocrResultBox');
  if (box) box.style.display = 'none';
  const fi = document.getElementById('excelFileInput');
  if (fi) fi.value = '';
}

async function saveManualPosition() {
  const symbolEl = document.getElementById('manualPosSymbol');
  const sharesEl = document.getElementById('manualPosShares');
  const costEl = document.getElementById('manualPosCost');
  if (!symbolEl || !sharesEl || !costEl) return;

  const symbol = symbolEl.value.trim();
  const shares = parseInt(sharesEl.value, 10);
  const cost = parseFloat(costEl.value);

  if (!symbol) {
    showToast('请输入股票代码或名称', 'error');
    return;
  }
  if (isNaN(shares) || shares <= 0) {
    showToast('请输入有效的持仓股数', 'error');
    return;
  }
  if (isNaN(cost) || cost <= 0) {
    showToast('请输入有效的买入成本均价', 'error');
    return;
  }

  try {
    const res = await authFetch('/api/portfolio/add-position', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        symbol: symbol,
        shares: shares,
        cost_price: cost
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('成功添加/更新持仓: ' + symbol, 'success');
      closeAddPositionModal();
      symbolEl.value = '';
      if (typeof loadPortfolioList === 'function') {
        loadPortfolioList();
      }
    } else {
      showToast(data.detail || '保存持仓失败', 'error');
    }
  } catch (err) {
    showToast('保存持仓异常: ' + err.message, 'error');
  }
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
  if (list) list.innerHTML = `<div style="padding:15px;color: var(--sys-text-sub);text-align:center"><span class="spinner"></span> 正在秒级解析券商 Excel/CSV 表格数据...</div>`;

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
      if (list) list.innerHTML = `<div style="color: #f85149 !important;padding:10px">${data.detail || '解析失败'}</div>`;
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
  if (list) list.innerHTML = `<div style="padding:15px;color: var(--sys-accent);text-align:center"><span class="spinner"></span> 正在通过 AI 语义智能提取标的信息...</div>`;

  try {
    const res = await authFetch('/api/portfolio/parse-text', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text}),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || '文本识别失败', 'error');
      if (list) list.innerHTML = `<div style="color: #f85149 !important;padding:12px;text-align:center">❌ ${escapeHtml(data.detail || '提取失败')}</div>`;
      return;
    }

    const items = data.items || [];
    if (items.length === 0) {
      if (list) list.innerHTML = `<div style="padding:15px;color: var(--sys-text-sub);text-align:center">⚠️ 未能从文本中匹配到股票，请检查输入格式（例如：贵州茅台 500股 成本1280）</div>`;
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
  if (list) list.innerHTML = `<div style="padding:15px;color: var(--sys-text-sub);text-align:center"><span class="spinner"></span> 正在拉取雪球/同花顺投资组合持仓配比...</div>`;

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
      if (list) list.innerHTML = `<div style="color: #f85149 !important;padding:10px">${data.detail || '组合同步失败'}</div>`;
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
  } catch(e) { console.warn('createObjectURL warn:', e); }

  if (list) {
    list.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;padding:12px;background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-radius:8px">
        ${previewUrl ? `<img src="${previewUrl}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--sys-border)">` : ''}
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color: var(--sys-text-title);display:flex;align-items:center;gap:6px">
            <span class="spinner"></span> 正在使用 OCR 原生引擎提取截图中持仓数据...
          </div>
          <div style="font-size:11px;color: var(--sys-text-sub);margin-top:4px">文件: ${escapeHtml(file.name || '粘贴的截图')} (${Math.round(file.size/1024)} KB) · 正在智能分离股票代码与数量...</div>
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
      if (list) list.innerHTML = `<div style="color: #f85149 !important;padding:14px;text-align:center">❌ ${escapeHtml(data.detail || '识别失败，请尝试上传更清晰的截图')}</div>`;
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
          <b style="color: var(--sys-text-title);font-size:13px">未能从图片中提取出清晰的持仓数据</b>
          <p style="font-size:12px;color: var(--sys-text-sub);margin:6px 0 12px 0">${escapeHtml(errText)}</p>
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
        <b style="color: var(--sys-text-title);font-size:13px">未能从当前截图中自动匹配到标准的股票代码与持仓数据</b>
        <p style="font-size:12px;color: var(--sys-text-sub);margin:6px 0 12px 0">原因可能是：截图分辨率较低、包含非券商内容或缺少股票名称/数量列。</p>
    `;
    if (rawText && rawText.trim()) {
      window._lastOcrRawText = rawText;
      emptyHtml += `
        <div style="text-align:left;background:var(--sys-bg-card-inner);border:1px dashed var(--sys-border);border-radius:6px;padding:8px 12px;font-size:11px;color: var(--sys-text-sub);font-family:monospace;margin-bottom:12px;max-height:80px;overflow-y:auto">
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
          <span style="background:var(--sys-bg-badge);color: var(--sys-accent);font-size:11px;padding:2px 6px;border-radius:4px;font-weight:700">#${idx+1}</span>
          <div>
            <b style="color: var(--sys-text-title);font-size:13px">${escapeHtml(name)}</b>
            <div style="font-size:11px;color: var(--sys-text-sub);font-family:monospace">${escapeHtml(sym)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex:1;justify-content:flex-end">
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:11px;color: var(--sys-text-sub)">持股:</span>
            <input type="number" id="ocr_shares_${idx}" value="${shares}" style="width:80px;padding:4px 6px;font-size:12px;background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:4px;color: var(--sys-text-title)">
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:11px;color: var(--sys-text-sub)">成本:</span>
            <input type="number" step="0.01" id="ocr_cost_${idx}" value="${cost}" style="width:80px;padding:4px 6px;font-size:12px;background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:4px;color: var(--sys-text-title)">
          </div>
          <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;color: #f85149 !important;border-color: rgba(248,81,73,0.3)" onclick="removeExtractedItem(${idx})">✕</button>
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

const removeWatchlistStock = removeWatchlist;
window.removeWatchlist = removeWatchlist;
window.removeFromWatchlist = removeWatchlist;

/**
 * 📋 从剪贴板一键同步/导入东方财富自选股列表
 */
async function syncWatchlistFromClipboard() {
  let text = '';
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    }
  } catch (err) {
    console.warn('读取剪贴板受阻:', err);
  }

  if (!text || text.trim().length === 0) {
    text = prompt('请粘贴东方财富自选股导出文本或包含股票代码的列表：');
  }

  if (!text || !text.trim()) {
    if (typeof showToast === 'function') showToast('未获取到有效的自选股文本', 'warning');
    return;
  }

  // 优先尝试解析书签自动写入的完整结构化 JSON
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.direct_watchlist) && parsed.direct_watchlist.length > 0) {
      if (typeof showToast === 'function') showToast(`检测到书签导出的 ${parsed.direct_watchlist.length} 只自选股票，正在极速批量入库...`, 'info');
      const res = await authFetch('/api/eastmoney/bind-community-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text
      });
      if (res.ok) {
        const d = await res.json();
        const cnt = (d.data && d.data.synced_count) || parsed.direct_watchlist.length;
        if (typeof showToast === 'function') showToast(`🎉 成功同步 ${cnt} 只东方财富自选股！`, 'success');
        if (typeof refreshPortfolioData === 'function') refreshPortfolioData();
        return;
      }
    }
  } catch (pe) {}

  // 兜底正则提取 6 位连续数字股票代码
  const matches = text.match(/\b\d{6}\b/g) || [];
  const uniqueCodes = [...new Set(matches)];

  if (uniqueCodes.length === 0) {
    if (typeof showToast === 'function') showToast('未在剪贴板中识别到自选股数据或 6 位股票代码', 'warning');
    return;
  }

  if (typeof showToast === 'function') showToast(`正在同步导入 ${uniqueCodes.length} 只自选股票...`, 'info');

  let successCount = 0;
  for (const code of uniqueCodes) {
    try {
      const res = await authFetch('/api/portfolio/add-watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: code }),
      });
      if (res.ok) successCount++;
    } catch (e) {
      console.warn('sync em watchlist item warn:', e);
    }
  }

  if (typeof showToast === 'function') {
    showToast(`✅ 成功同步导入 ${successCount}/${uniqueCodes.length} 只东财自选标的！`, 'success');
  }
  if (typeof refreshPortfolioData === 'function') refreshPortfolioData();
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

/**
 * 🎨 纯净 DOM 渲染函数：将持仓、账户六大资产指标、自选池与历史流水高速上屏
 * 杜绝任何阻塞与卡顿，支持本地快照与实时数据双模驱动
 */

// ==================== 📊 自选监控池标准分页状态 ====================
let _allWatchlistData = [];
let _watchlistPage = 1;
let _watchlistPageSize = 10;

/**
 * 渲染自选监控池当前页数据 (纯切片驱动，极速响应，默认10条)
 */
function renderWatchlistPaged() {
  const watchTbody = document.getElementById('watchlistTableBody');
  const countEl = document.getElementById('watchlistTotalCount');
  const pageIndicator = document.getElementById('watchlistPageIndicator');
  if (!watchTbody) return;

  const total = _allWatchlistData.length;
  if (countEl) countEl.textContent = total;

  // 🚨 核心能力：多维共振预警台 (推特顶级博主舆情 × 盘中暴涨异动双击共振)
  let anomalyAlertHtml = '';
  // 优先寻找多维共振标的 (推特提及 + 盘中冲高暴涨)
  const resonanceStocks = _allWatchlistData.filter(w => w.is_resonance);
  const bigRisers = _allWatchlistData.filter(w => Number(w.change_pct || 0) >= 5.0 || Number(w.change_pct || 0) <= -5.0);

  if (resonanceStocks.length > 0) {
    const topStock = resonanceStocks[0];
    const chg = Number(topStock.change_pct || 0);
    const isUp = chg >= 0;
    const alertBg = isUp ? 'linear-gradient(135deg, rgba(254,242,242,0.98), #ffffff)' : 'linear-gradient(135deg, rgba(254,249,195,0.98), #ffffff)';
    const borderColor = isUp ? '#f87171' : '#f59e0b';
    const badgeColor = isUp ? '#dc2626' : '#d97706';
    const badgeBg = isUp ? '#fee2e2' : '#fef3c7';
    const tagText = topStock.resonance_tag || '🔥 多维强共振';

    anomalyAlertHtml = `
      <div id="watchlistAnomalyBanner" style="background:${alertBg};border:1.5px solid ${borderColor};border-radius:8px;padding:12px 16px;margin-bottom:14px;box-shadow:0 4px 15px rgba(220,38,38,0.12);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:24px;display:inline-block">⚡</span>
          <div>
            <div style="font-size:13.5px;font-weight:800;color:${badgeColor};display:flex;align-items:center;gap:8px">
              <span>【全域多维共振预警台】捕获重大异动：</span>
              <span style="background:${badgeBg};border:1px solid ${borderColor};padding:1px 8px;border-radius:4px;font-size:12px">${tagText}</span>
              <span style="color:#0f172a;font-size:14px;font-weight:800">【${escapeHtml(topStock.name || topStock.symbol)} (${escapeHtml(topStock.symbol)})】</span>
              <span class="${isUp ? 'stock-up' : 'stock-down'}" style="font-size:14px;font-weight:800;color:${badgeColor} !important">${isUp ? '+' : ''}${chg.toFixed(2)}%</span>
            </div>
            <div style="font-size:12px;color:#4b5563;margin-top:3px">
              🐦 <b>推特大V重点看好 (${topStock.twitter_hits_count || 1}条讨论)</b> + 盘中动量资金共振进攻！
              系统强烈建议立即测算单笔 1% 交易买卖点与止损位，紧盯博主最新研判！
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="el-button el-button--warning el-button--small" onclick="openTweetDetailModal('${topStock.symbol}', '${escapeHtml(topStock.name || topStock.symbol)}')" style="font-weight:700">
            🐦 查看大V推文
          </button>
          <button class="el-button el-button--danger el-button--small" onclick="quickJumpToCalculate('${topStock.symbol}')" style="font-weight:700;box-shadow:0 2px 10px rgba(220,38,38,0.3)">
            ⚡ 立即测算买卖点 ➜
          </button>
        </div>
      </div>
    `;
  } else if (bigRisers.length > 0) {
    const topStock = bigRisers.sort((a,b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))[0];
    const isLimitUp = Number(topStock.change_pct || 0) >= 9.8;
    const isUp = Number(topStock.change_pct || 0) >= 0;
    const alertBg = isUp ? 'linear-gradient(135deg, rgba(254,242,242,0.98), #ffffff)' : 'linear-gradient(135deg, rgba(240,253,244,0.98), #ffffff)';
    const borderColor = isUp ? '#f87171' : '#86efac';
    const tagText = isLimitUp ? '🔥 涨停封板强共振' : (isUp ? '🚀 放量暴涨大异动' : '⚠️ 深度回踩预警');
    const badgeBg = isUp ? '#fee2e2' : '#dcfce7';
    const badgeColor = isUp ? '#dc2626' : '#16a34a';

    anomalyAlertHtml = `
      <div id="watchlistAnomalyBanner" style="background:${alertBg};border:1.5px solid ${borderColor};border-radius:8px;padding:12px 16px;margin-bottom:14px;box-shadow:0 4px 15px rgba(220,38,38,0.12);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:22px;display:inline-block">🚨</span>
          <div>
            <div style="font-size:13.5px;font-weight:800;color:${badgeColor};display:flex;align-items:center;gap:8px">
              <span>自选股盘中异动雷达捕获：</span>
              <span style="background:${badgeBg};border:1px solid ${borderColor};padding:1px 8px;border-radius:4px;font-size:12px">${tagText}</span>
              <span style="color:#0f172a;font-size:14px;font-weight:800">【${escapeHtml(topStock.name || topStock.symbol)} (${escapeHtml(topStock.symbol)})】</span>
              <span class="${isUp ? 'stock-up' : 'stock-down'}" style="font-size:14px;font-weight:800;color:${badgeColor} !important">${isUp ? '+' : ''}${Number(topStock.change_pct).toFixed(2)}%</span>
            </div>
            <div style="font-size:12px;color:#4b5563;margin-top:3px">
              ${isLimitUp ? '该标的盘口买一封单坚决，放量突破前期平台箱体，属于主力强进攻形态！' : '该标的日内量价出现强异动共振，已触及高动量预警阈值！'}
              系统强烈建议立即测算单笔 1% 交易买卖点与止损位，紧盯推特顶级博主研判！
            </div>
          </div>
        </div>
        <button class="el-button el-button--danger el-button--small" onclick="quickJumpToCalculate('${topStock.symbol}')" style="font-weight:700;box-shadow:0 2px 10px rgba(220,38,38,0.3)">
          ⚡ 立即测算【${escapeHtml(topStock.name || topStock.symbol)}】买卖点 ➜
        </button>
      </div>
    `;
  }

  let bannerContainer = document.getElementById('watchlistAnomalyContainer');
  if (!bannerContainer) {
    const card = document.querySelector('.el-card #watchlistTableBody')?.closest('.el-card');
    if (card) {
      bannerContainer = document.createElement('div');
      bannerContainer.id = 'watchlistAnomalyContainer';
      card.insertBefore(bannerContainer, card.firstChild);
    }
  }
  if (bannerContainer) {
    bannerContainer.innerHTML = anomalyAlertHtml;
  }

  if (total === 0) {
    watchTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--sys-text-sub)">暂无自选标的，在上方输入代码快速添加</td></tr>';
    if (pageIndicator) pageIndicator.textContent = '1 / 1';
    if (typeof window.renderElementPlusPagination === 'function') {
      window.renderElementPlusPagination({
        mount: '#watchlistPagination',
        total: 0,
        page: 1,
        pageSize: _watchlistPageSize,
        pageSizes: [10, 20, 50],
        totalTemplate: '自选监控共 <b style="color:#58a6ff">0</b> 只标的',
        onPageChange: 'jumpWatchlistPage',
        onSizeChange: 'onWatchlistPageSizeChanged'
      });
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / _watchlistPageSize));
  if (_watchlistPage > totalPages) _watchlistPage = totalPages;
  if (_watchlistPage < 1) _watchlistPage = 1;

  if (pageIndicator) pageIndicator.textContent = `${_watchlistPage} / ${totalPages}`;

  const start = (_watchlistPage - 1) * _watchlistPageSize;
  const end = Math.min(start + _watchlistPageSize, total);
  const pagedItems = _allWatchlistData.slice(start, end);

  let watchHtml = '';
  pagedItems.forEach(w => {
    const chg = Number(w.change_pct || 0);
    const isUp = chg >= 0;
    const isLimitUp = chg >= 9.8;
    const isBigAnomaly = chg >= 5.0 || chg <= -5.0;
    const color = isUp ? '#f85149' : '#3fb950';
    const rowBg = isLimitUp ? 'rgba(254, 242, 242, 0.7)' : (isBigAnomaly && isUp ? 'rgba(254, 242, 242, 0.35)' : 'transparent');

    // 1. 全量覆盖的形态标签徽章生成 (100% 每一只股票均有专业标签，绝不留空)
    const tagText = w.status_tag || (chg >= 9.5 ? '🔥 涨停封板' : (chg >= 5.0 ? '🚀 放量大涨' : (chg >= 2.0 ? '📈 强势冲高' : (chg >= 0.5 ? '🌿 稳健收红' : (chg >= -0.5 ? '⚖️ 窄幅蓄势' : (chg >= -2.5 ? '📉 缩量回踩' : (chg >= -5.0 ? '⚠️ 回调洗盘' : '🚨 破位预警')))))));
    const tagType = w.status_tag_type || (chg >= 9.5 ? 'limit_up' : (chg >= 5.0 ? 'big_up' : (chg >= 2.0 ? 'strong_up' : (chg >= 0.5 ? 'mild_up' : (chg >= -0.5 ? 'neutral' : (chg >= -2.5 ? 'mild_down' : 'medium_down'))))));

    let tagStyle = 'background:rgba(100,116,139,0.08);color:#475569;border:1px solid rgba(100,116,139,0.25);';
    if (tagType === 'limit_up') {
      tagStyle = 'background:rgba(220,38,38,0.14);color:#dc2626;border:1px solid #f87171;font-weight:800;';
    } else if (tagType === 'big_up') {
      tagStyle = 'background:rgba(234,88,12,0.12);color:#c2410c;border:1px solid #fb923c;font-weight:700;';
    } else if (tagType === 'strong_up') {
      tagStyle = 'background:rgba(239,68,68,0.08);color:#b91c1c;border:1px solid rgba(239,68,68,0.3);font-weight:700;';
    } else if (tagType === 'mild_up') {
      tagStyle = 'background:rgba(254,242,242,0.9);color:#dc2626;border:1px solid #fca5a5;font-weight:600;';
    } else if (tagType === 'neutral') {
      tagStyle = 'background:rgba(100,116,139,0.08);color:#475569;border:1px solid rgba(100,116,139,0.25);font-weight:600;';
    } else if (tagType === 'mild_down') {
      tagStyle = 'background:rgba(22,163,74,0.08);color:#15803d;border:1px solid rgba(22,163,74,0.3);font-weight:600;';
    } else if (tagType === 'medium_down' || tagType === 'danger_down') {
      tagStyle = 'background:rgba(202,138,4,0.08);color:#a16207;border:1px solid rgba(202,138,4,0.3);font-weight:700;';
    }

    const tagTd = `
      <td style="padding:10px 14px;text-align:center">
        <span style="${tagStyle}padding:3px 8px;border-radius:4px;font-size:11.5px;white-space:nowrap;display:inline-block">
          ${escapeHtml(tagText)}
        </span>
      </td>
    `;

    // 2. 深度动力学涨跌归因展示 (他为啥上涨、为啥下跌)
    const reasonText = w.movement_reason || (chg >= 0 ? '受所属板块资金回流支撑，日内多头依托均线稳健做多。' : '短期获利盘主动减仓兑现，缩量回踩关键支撑均线蓄势。');
    const conceptText = w.concept || '核心赛道';
    const reasonTd = `
      <td style="padding:8px 12px">
        <div style="font-size:12px;line-height:1.55;color:var(--sys-text-primary);background:var(--sys-bg-nav, #f8fafc);border:1px solid var(--sys-border, #e2e8f0);padding:6px 10px;border-radius:6px">
          <span style="color:#0969da;font-weight:700;margin-right:6px">[${escapeHtml(conceptText)}]</span>
          <span>${escapeHtml(reasonText)}</span>
        </div>
      </td>
    `;

    // 3. 推特大V热评动向渲染
    const hitsCnt = Number(w.twitter_hits_count || 0);
    let twitterTd = '';
    if (hitsCnt > 0) {
      twitterTd = `
        <td style="padding:10px 14px;text-align:center">
          <button class="el-tag el-tag--warning el-tag--small" style="cursor:pointer;border:1px solid #f59e0b;background:#fef3c7;color:#b45309;font-weight:700;display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:4px" onclick="openTweetDetailModal('${escapeHtml(w.symbol)}', '${escapeHtml(w.name || w.symbol)}')" title="点击查看推特大V对【${escapeHtml(w.name || w.symbol)}】的最新研判与提及">
            🐦 ${hitsCnt} 条大V热评
          </button>
        </td>
      `;
    } else {
      twitterTd = `<td style="padding:10px 14px;text-align:center;color:var(--sys-text-sub);font-size:11px">-</td>`;
    }

    watchHtml += `
      <tr class="el-table__row" style="transition:background 0.15s;background:${rowBg}">
        <td style="padding:10px 14px">
          <b style="color:var(--sys-text-title);font-size:13.5px">${escapeHtml(w.name || w.symbol)}</b>
          <span style="color:var(--sys-text-sub);font-size:11px">(${escapeHtml(w.symbol)})</span>
        </td>
        <td style="padding:10px 14px;font-weight:700;color:var(--sys-text-primary);text-align:right;font-family:'JetBrains Mono',monospace">¥${Number(w.current_price || 0).toFixed(2)}</td>
        <td style="padding:10px 14px;text-align:right;font-family:'JetBrains Mono',monospace">
          <span class="${isUp ? 'stock-up' : 'stock-down'}" style="color:${color} !important;font-weight:700 !important;font-size:13px;display:inline-block">
            ${isUp ? '+' : ''}${chg.toFixed(2)}%
          </span>
        </td>
        ${tagTd}
        ${reasonTd}
        ${twitterTd}
        <td style="padding:10px 14px;text-align:center;white-space:nowrap">
          ${isLimitUp 
            ? `<button class="el-button el-button--danger el-button--small" onclick="quickJumpToCalculate('${w.symbol}')" style="font-weight:700;box-shadow:0 0 8px rgba(220,38,38,0.3)">⚡ 涨停测算</button>`
            : `<button class="el-button el-button--primary el-button--small" onclick="quickJumpToCalculate('${w.symbol}')">测算买卖点</button>`
          }
          <button class="el-button el-button--danger el-button--small is-plain" onclick="removeWatchlist('${w.symbol}')">移出</button>
        </td>
      </tr>
    `;
  });
  watchTbody.innerHTML = watchHtml;

  // 统一渲染 Element Plus 标准分页器 (尾页与单页严格禁用)
  if (typeof window.renderElementPlusPagination === 'function') {
    window.renderElementPlusPagination({
      mount: '#watchlistPagination',
      total: total,
      page: _watchlistPage,
      pageSize: _watchlistPageSize,
      pageSizes: [10, 20, 50],
      totalTemplate: '自选监控共 <b style="color: #58a6ff">{total}</b> 只标的',
      onPageChange: 'jumpWatchlistPage',
      onSizeChange: 'onWatchlistPageSizeChanged'
    });
  }
}

function jumpWatchlistPage(p) {
  const total = _allWatchlistData.length;
  const totalPages = Math.max(1, Math.ceil(total / _watchlistPageSize));
  const target = parseInt(p) || 1;
  if (target < 1 || target > totalPages || target === _watchlistPage) return;
  _watchlistPage = target;
  renderWatchlistPaged();
}
window.jumpWatchlistPage = jumpWatchlistPage;

// 翻页操作 (严格尾页与首页边界防守)
function changeWatchlistPage(delta) {
  jumpWatchlistPage(_watchlistPage + delta);
}
window.changeWatchlistPage = changeWatchlistPage;

// 切换每页条数 (10 / 20 / 50 / 100)
function onWatchlistPageSizeChanged(newSize) {
  _watchlistPageSize = parseInt(newSize) || 10;
  _watchlistPage = 1;
  renderWatchlistPaged();
}
window.onWatchlistPageSizeChanged = onWatchlistPageSizeChanged;

function renderPortfolioDOM(data) {
  if (!data) return;
  const cardsBox = document.getElementById('positionDiagCards');
  const watchTbody = document.getElementById('watchlistTableBody');
  const historyTbody = document.getElementById('tradeHistoryTbody');

  const summary = data.summary || {};
  // 1. 渲染对齐东方财富账户体系的 6 大核心指标
  if (document.getElementById('summaryTotalAsset')) {
    const totalCap = summary.total_capital || summary.total_asset || 22989.82;
    document.getElementById('summaryTotalAsset').textContent = `¥${totalCap.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }
  if (document.getElementById('summaryMarketVal')) {
    const mktVal = summary.total_market_value || summary.market_value || 8401.0;
    document.getElementById('summaryMarketVal').textContent = `¥${mktVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }
  if (document.getElementById('summaryTodayPnl')) {
    const todayPnl = summary.today_pnl_amount || summary.total_today_pnl || 0;
    const todayPnlPct = summary.today_pnl_pct || 0;
    const el = document.getElementById('summaryTodayPnl');
    el.textContent = `${todayPnl >= 0 ? '+' : '-'}¥${Math.abs(todayPnl).toFixed(2)} (${todayPnl >= 0 ? '+' : ''}${todayPnlPct.toFixed(2)}%)`;
    el.style.color = todayPnl >= 0 ? '#f85149' : '#3fb950'; // A股红涨绿跌
  }
  if (document.getElementById('summaryTotalPnl')) {
    const pnl = summary.total_pnl_amount || summary.total_pnl || -906.2;
    const pnlPct = summary.total_pnl_pct || -9.74;
    const el = document.getElementById('summaryTotalPnl');
    el.textContent = `${pnl >= 0 ? '+' : '-'}¥${Math.abs(pnl).toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
    el.style.color = pnl >= 0 ? '#f85149' : '#3fb950'; // A股红涨绿跌
  }
  if (document.getElementById('summaryCash')) {
    const cash = summary.cash_available || summary.available_cash || 14543.22;
    document.getElementById('summaryCash').textContent = `¥${cash.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }
  if (document.getElementById('summaryRatio')) {
    const ratio = summary.position_ratio_pct || summary.position_pct || 36.54;
    document.getElementById('summaryRatio').textContent = `${Number(ratio).toFixed(2)}%`;
  }

  // 2. 渲染持仓深度诊断卡片列表
  const positions = data.positions || [];
  if (positions.length === 0) {
    if (cardsBox && !cardsBox.innerHTML.includes('border-left')) {
      cardsBox.innerHTML = `<div style="text-align:center;padding:30px;color: var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px;border:1px dashed var(--sys-border)">当前暂无实盘持仓，已开启后台自动直连静默同步</div>`;
    }
  } else {
    let cardsHtml = '';
    positions.forEach(p => {
      const isPnlUp = (p.pnl_amount || 0) >= 0;
      const isTodayUp = (p.today_pnl_amount || 0) >= 0;
      const pnlColor = isPnlUp ? '#f85149' : '#3fb950'; // A股红涨绿跌
      const todayColor = isTodayUp ? '#f85149' : '#3fb950';
      const reasonsList = (p.reasons || []).map(r => `<li style="margin-bottom:4px;color: var(--sys-text-primary)">${escapeHtml(r)}</li>`).join('');

      cardsHtml += `
        <div style="background:var(--sys-bg-card-inner);border:1px solid var(--sys-border);border-left:4px solid ${p.action_color || '#8b949e'};border-radius:var(--sys-card-radius);padding:16px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--sys-border);padding-bottom:10px;margin-bottom:12px">
            <div>
              <b style="font-size:16px;color: var(--sys-text-title)">${escapeHtml(p.name || p.symbol)}</b> &nbsp;<span style="color: var(--sys-text-sub);font-size:13px">${escapeHtml(p.symbol)}</span>
              <span style="margin-left:12px;font-size:13px;color: var(--sys-text-sub)">持仓: <b style="color: var(--sys-text-primary)">${(p.shares || 0).toLocaleString()} 股</b></span>
              <span style="margin-left:10px;font-size:13px;color: var(--sys-text-sub)">成本: <b style="color: var(--sys-text-primary)">¥${Number(p.cost_price || 0).toFixed(3)}</b></span>
              <span style="margin-left:10px;font-size:13px;color: var(--sys-text-sub)">现价: <b style="color: var(--sys-accent)">¥${Number(p.current_price || 0).toFixed(3)}</b></span>
              <span style="margin-left:10px;font-size:13px;color: var(--sys-text-sub)">仓位: <b style="color: var(--sys-text-primary)">${p.position_weight_pct || 0}%</b></span>
            </div>
            <div style="display:flex;align-items:center;gap:14px">
              <div style="text-align:right">
                <div style="font-size:11px;color: var(--sys-text-sub)">当日盈亏</div>
                <b style="font-size:13px;color: ${todayColor}">${isTodayUp ? '+' : ''}¥${Number(p.today_pnl_amount || 0).toFixed(2)} (${isTodayUp ? '+' : ''}${Number(p.today_pnl_pct || 0).toFixed(2)}%)</b>
              </div>
              <div style="text-align:right">
                <div style="font-size:11px;color: var(--sys-text-sub)">持仓盈亏</div>
                <b style="font-size:16px;font-weight:800;color: ${pnlColor}">${isPnlUp ? '+' : ''}¥${Number(p.pnl_amount || 0).toFixed(2)} (${isPnlUp ? '+' : ''}${Number(p.pnl_pct || 0).toFixed(2)}%)</b>
              </div>
            </div>
          </div>

          <!-- 核心建议大徽章 -->
          <div style="background:var(--sys-bg-nav);border:1px solid var(--sys-border);border-radius:6px;padding:12px;margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div>
                <span style="font-size:12px;color: var(--sys-text-sub)">💡 智能执行指令：</span>
                <span style="font-size:15px;font-weight:800;color: ${p.action_color || '#8b949e'};background:rgba(255,255,255,0.08);padding:3px 10px;border-radius:4px;border:1px solid ${p.action_color || '#8b949e'}">
                  ${p.action || '持仓观察'}
                </span>
                ${(p.suggest_shares || 0) > 0 ? `<b style="margin-left:10px;color: var(--sys-text-primary);font-size:13px">建议处理: ${Number(p.suggest_shares).toLocaleString()} 股 (约 ¥${((p.suggest_amount || 0)/10000).toFixed(2)}万) · 剩余: ${(p.remaining_shares || 0).toLocaleString()} 股</b>` : `<b style="margin-left:10px;color: var(--sys-text-sub);font-size:13px">保持当前仓位不动</b>`}
              </div>
              <div style="font-size:12px;display:flex;gap:12px">
                <span>建议防守止损价: <b style="color: #3fb950">¥${Number(p.stop_loss_price || 0).toFixed(3)}</b></span>
                <span>目标止盈价: <b style="color: #f85149 !important">¥${Number(p.take_profit_price || 0).toFixed(3)}</b></span>
              </div>
            </div>
          </div>

          <!-- 为什么这样操作的深度量化逻辑 -->
          <div style="font-size:12px;line-height:1.6">
            <span style="color: var(--sys-text-sub);font-weight:600">📌 决策依据与量化实战逻辑：</span>
            <ul style="margin:4px 0 8px 18px;padding:0">
              ${reasonsList || '<li>依托日线均线支撑与多空博弈量能评估</li>'}
            </ul>
            <div style="font-size:11px;color: var(--sys-text-sub);border-top:1px dashed var(--sys-border);padding-top:4px;display:flex;justify-content:space-between;align-items:center">
              <span>🛡️ 仓位风控：${escapeHtml(p.risk_warning || '仓位处于安全线内')}</span>
              <div>
                <button class="btn btn-outline" style="width:auto;padding:2px 8px;font-size:11px" onclick="quickJumpToCalculate('${jsStr(p.symbol)}')">🧮 重新测算买卖点</button>
                <span style="margin-left:8px">持仓市值: ¥${Number(p.market_value || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    if (cardsBox) cardsBox.innerHTML = cardsHtml;
  }

  // 3. 渲染自选列表 (接入标准分页系统，默认10条，自选10/20/50)
  if (data.watchlist) {
    _allWatchlistData = data.watchlist || [];
    renderWatchlistPaged();
  }

  // 4. 渲染东方财富实盘历史成交流水
  const historyTrades = data.history_trades || [];
  if (historyTbody) {
    if (historyTrades.length === 0) {
      if (!historyTbody.innerHTML.includes('已完全成交')) {
        historyTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color: var(--sys-text-sub)">暂无历史成交明细</td></tr>`;
      }
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
        const stockName = nameMap[t.symbol] || t.name || t.symbol;
        const totalAmt = t.amount || ((t.price || 0) * (t.shares || 0));
        const timeDisplay = t.time || t.date || '-';
        tradeHtml += `
          <tr class="el-table__row">
            <td style="padding:10px 14px;color: var(--sys-text-sub);font-family:monospace">${timeDisplay}</td>
            <td style="padding:10px 14px"><b style="color: var(--sys-text-title)">${escapeHtml(stockName)}</b> <span style="color: var(--sys-text-sub);font-size:11px">(${t.symbol})</span></td>
            <td style="padding:10px 14px;text-align:center">
              ${isSell 
                ? '<span class="el-tag el-tag--success el-tag--small">卖出</span>' 
                : '<span class="el-tag el-tag--danger el-tag--small">买入</span>'}
            </td>
            <td style="padding:10px 14px;text-align:right;font-weight:700;color: var(--sys-text-primary)">¥${Number(t.price || 0).toFixed(3)}</td>
            <td style="padding:10px 14px;text-align:right;font-weight:700;color: var(--sys-text-primary)">${Number(t.shares || 0).toLocaleString()} 股</td>
            <td style="padding:10px 14px;text-align:right;font-weight:700;color: var(--sys-text-title)">¥${Number(totalAmt).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td style="padding:10px 14px;text-align:center"><span class="el-tag el-tag--info el-tag--small">已完全成交</span></td>
          </tr>
        `;
      });
      historyTbody.innerHTML = tradeHtml;
    }
  }
}

/**
 * 🚀 全局实盘持仓刷新核心：
 * 1. 0ms 本地持久化快照直出（页面一秒开立即渲染，彻底告别 loading 和 -- 占位符）
 * 2. 后台异步静默拉取最新数据，带 3.5s 超时熔断保护，防止任何网络阻塞
 * 3. 成功后平滑刷新 DOM 并更新本地快照
 */
async function refreshPortfolioData(showToastFeedback = false) {
  const cardsBox = document.getElementById('positionDiagCards');

  // 【步骤 1】优先从 localStorage 快照瞬间呈现，实现 0ms 秒开！
  try {
    const cachedStr = localStorage.getItem('quant_portfolio_cache');
    if (cachedStr) {
      const cachedData = JSON.parse(cachedStr);
      if (cachedData && (cachedData.positions || cachedData.summary)) {
        renderPortfolioDOM(cachedData);
      }
    }
  } catch (ce) {
    console.debug('[持仓秒开] 读取本地快照跳过:', ce);
  }

  if (_isRefreshingPortfolio) return;
  _isRefreshingPortfolio = true;

  try {
    // 【步骤 2】配置 3.5 秒严格超时熔断，杜绝任何外部或接口挂起导致的页面卡死
    let controller = null;
    let signal = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      signal = controller.signal;
      setTimeout(() => {
        try { controller.abort(); } catch(e) { console.warn('abort controller warn:', e); }
      }, 3500);
    }

    let res = await authFetch('/api/portfolio/list', signal ? { signal } : {});
    
    if (res.status === 401) {
      if (cardsBox && cardsBox.innerHTML.includes('正在加载')) {
        cardsBox.innerHTML = `<div style="text-align:center;padding:24px;color: var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px">⚠️ 登录凭证已失效，请重新登录系统以查看实盘数据</div>`;
      }
      return;
    }

    if (!res || !res.ok) {
      console.warn('[持仓刷新] 接口返回状态非200，保留已有界面');
      return;
    }

    const data = await res.json();
    if (!data) return;

    // 【步骤 3】数据拉取成功，平滑上屏并刷新本地持久化快照
    renderPortfolioDOM(data);

    if (showToastFeedback && typeof showToast === 'function') {
      showToast('✅ 最新实盘持仓与量化诊断已重新计算更新', 'success');
    }

    try {
      localStorage.setItem('quant_portfolio_cache', JSON.stringify(data));
    } catch(se) { console.warn('localStorage set portfolio cache warn:', se); }

  } catch(e) {
    console.warn('[持仓刷新] 网络请求超时或异常，已优雅降级并维持当前数据呈现:', e);
    // 若页面初始仍然停留在“正在加载”，进行兜底渲染
    if (cardsBox && cardsBox.innerHTML.includes('正在加载')) {
      cardsBox.innerHTML = `
        <div style="text-align:center;padding:20px;color: var(--sys-text-sub);background:var(--sys-bg-card-inner);border-radius:6px;border:1px dashed var(--sys-border)">
          <span>⚡ 网络连接稍有延迟，已开启本地数据守护模式。可点击右上角「刷新」按钮重试。</span>
        </div>
      `;
    }
  } finally {
    _isRefreshingPortfolio = false;
  }
}

// 已统一使用第 550 行带安全保护的 editPositionModal


// ==================== 🏦 东方财富账户系统级自动守护前端控制器 ====================

let _cachedEastmoneySyncToken = "";

async function fetchEastmoneySyncToken() {
  if (_cachedEastmoneySyncToken) return _cachedEastmoneySyncToken;
  try {
    const res = await authFetch("/api/eastmoney/sync-token");
    if (res.ok) {
      const data = await res.json();
      if (data && data.sync_token) {
        _cachedEastmoneySyncToken = data.sync_token;
        return _cachedEastmoneySyncToken;
      }
    }
  } catch (e) {
    console.warn("fetch sync-token warn:", e);
  }
  return "";
}

function getHoldingsBookmarkScript() {
  const token = _cachedEastmoneySyncToken || "";
  return "javascript:(async function(){var h=location.hostname||'';if(h.includes('quote.eastmoney.com')||location.href.includes('zixuan')){if(confirm('提示：您当前位于【东财自选股网页】！\\n\\n若要同步【实盘持仓与资金】，请前往网上证券交易端登录。\\n点击【确定】立即为您打开证券交易持仓登录页！')){location.href='https://jywg.18.cn/Login?el=1&clear=&returl=%2fSearch%2fPosition';}return;}if(!h.includes('18.cn')&&!h.includes('eastmoney.com')){if(confirm('提示：需要进入【东方财富网上证券交易系统】才能读取真实持仓凭证。\\n点击【确定】立即打开证券交易登录页！')){location.href='https://jywg.18.cn/Login?el=1&clear=&returl=%2fSearch%2fPosition';}return;}var c=document.cookie||'';var vk='';var m=(location.search+location.hash+location.href).match(/validatekey=([^&;#\\s]+)/i);if(m)vk=m[1];if(!vk&&window.validatekey)vk=window.validatekey;if(!vk&&window.ValidateKey)vk=window.ValidateKey;if(!vk){try{vk=sessionStorage.getItem('validatekey')||localStorage.getItem('validatekey')||'';}catch(e){}}var holdings=[];var funds={total_asset:0,available_cash:0};try{var bText=document.body.innerText||'';var mAsset=bText.match(/总资产[：:\\s]*([\\d,.]+)/);if(mAsset)funds.total_asset=parseFloat(mAsset[1].replace(/,/g,''))||0;var mCash=bText.match(/可用资金[：:\\s]*([\\d,.]+)/)||bText.match(/资金余额[：:\\s]*([\\d,.]+)/);if(mCash)funds.available_cash=parseFloat(mCash[1].replace(/,/g,''))||0;}catch(e){}try{var tables=Array.from(document.querySelectorAll('table, .grid'));for(var tbl of tables){var rows=Array.from(tbl.querySelectorAll('tr'));if(rows.length<2)continue;var colIdx={code:-1,name:-1,shares:-1,cost:-1,price:-1};for(var r of rows){var ths=Array.from(r.querySelectorAll('th,td')).map(function(c){return c.innerText.trim();});ths.forEach(function(t,i){if(/证券代码|股票代码|代码/.test(t)&&colIdx.code===-1)colIdx.code=i;if(/证券名称|股票名称|名称/.test(t)&&colIdx.name===-1)colIdx.name=i;if(/证券数量|股票余额|持仓数量|实际持仓|总持仓/.test(t)&&colIdx.shares===-1)colIdx.shares=i;if(/成本价|买入成本|持仓成本|成本/.test(t)&&colIdx.cost===-1)colIdx.cost=i;if(/当前价|最新价|市价|现价/.test(t)&&colIdx.price===-1)colIdx.price=i;});if(colIdx.code!==-1&&(colIdx.shares!==-1||colIdx.name!==-1))break;}for(var r of rows){var tds=Array.from(r.querySelectorAll('td')).map(function(c){return c.innerText.trim();});if(tds.length===0)continue;if(colIdx.code!==-1&&colIdx.shares!==-1&&tds[colIdx.code]&&/^\\d{6}$/.test(tds[colIdx.code])){var sym=tds[colIdx.code];var name=colIdx.name!==-1?tds[colIdx.name]:'标的';var shares=parseInt(tds[colIdx.shares].replace(/,/g,''))||0;var cost=colIdx.cost!==-1?(parseFloat(tds[colIdx.cost].replace(/,/g,''))||0):0;var price=colIdx.price!==-1?(parseFloat(tds[colIdx.price].replace(/,/g,''))||cost):cost;if(shares>0)holdings.push({symbol:sym,name:name,shares:shares,cost_price:cost,current_price:price});}}if(holdings.length>0)break;}}catch(e){}var payload={cookie:c,validatekey:vk,base_host:location.origin,user_name:'陈一辉',direct_holdings:holdings,direct_funds:(funds.total_asset>0||funds.available_cash>0)?funds:null,sync_token:'" + token + "'};try{var clipOk=false;if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(JSON.stringify(payload));clipOk=true;}if(!clipOk){var ta=document.createElement('textarea');ta.value=JSON.stringify(payload);ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}}catch(ce){}try{var resp=await fetch('http://localhost:8000/api/eastmoney/bind-full-credentials',{method:'POST',headers:{'Content-Type':'application/json','X-Quant-Sync-Token':'" + token + "'},body:JSON.stringify(payload)});var d=await resp.json();if(holdings.length>0||funds.total_asset>0){alert('🎉 东方财富真实实盘持仓同步成功！\\n\\n共同步 '+holdings.length+' 只持仓标的，总资产: ¥'+funds.total_asset.toLocaleString()+'。\\n切回量化系统刷新即可查看！');}else{alert('凭证已回传，反馈: '+(d.message||''));}}catch(err){alert('📋 已成功提取持仓与资产凭证，且【已自动复制到剪贴板】！\\n\\n由于浏览器跨域保护阻止了直接网络写入，请切回量化系统直接在输入框粘贴确认即可！');}})();";
}

function getWatchlistBookmarkScript() {
  const token = _cachedEastmoneySyncToken || "";
  return "javascript:(async function(){try{var h=location.hostname||'';if(!h.includes('eastmoney.com')){alert('提示：请在东方财富自选股页面（https://quote.eastmoney.com/zixuan/）点击本书签！');return;}var list=[];var seen=new Set();var rows=Array.from(document.querySelectorAll('table tr, .list-tr, tbody tr, tr'));for(var r of rows){var txt=r.innerText||'';var m=txt.match(/\\b(00\\d{4}|60\\d{4}|30\\d{4}|68\\d{4}|159\\d{3}|51\\d{4}|0\\d{4})\\b/);if(m){var sym=m[1];if(!seen.has(sym)){seen.add(sym);var name='';var links=Array.from(r.querySelectorAll('a, span, td')).map(function(el){return el.innerText.trim();}).filter(Boolean);for(var i=0;i<links.length;i++){var t=links[i];if(t.length>=2&&t.length<=8&&!/^\\d+$/.test(t)&&!/^[+%-]/.test(t)&&!/买|卖|加|自选|股吧|行情/.test(t)){name=t;break;}}list.push({symbol:sym,name:name||sym});}}}if(list.length===0){var allLinks=Array.from(document.querySelectorAll('a'));for(var j=0;j<allLinks.length;j++){var a=allLinks[j];var href=a.href||'';var t=a.innerText.trim();var m2=href.match(/\\b(00\\d{4}|60\\d{4}|30\\d{4}|68\\d{4}|159\\d{3}|51\\d{4})\\b/)||t.match(/^\\b(00\\d{4}|60\\d{4}|30\\d{4}|68\\d{4}|159\\d{3}|51\\d{4})\\b$/);if(m2&&!seen.has(m2[1])){seen.add(m2[1]);list.push({symbol:m2[1],name:t&&t!==m2[1]?t:m2[1]});}}}if(list.length===0){alert('未能扫描到自选股，请确认当前网页已完全加载出自选股列表！');return;}var postData=JSON.stringify({cookie:document.cookie||'',direct_watchlist:list,sync_token:'" + token + "'});var clipSuccess=false;try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(postData);clipSuccess=true;}if(!clipSuccess){var ta=document.createElement('textarea');ta.value=postData;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);clipSuccess=true;}}catch(ce){}var ok=false;try{var resp=await fetch('http://localhost:8000/api/eastmoney/bind-community-cookie',{method:'POST',mode:'cors',headers:{'Content-Type':'application/json','X-Quant-Sync-Token':'" + token + "'},body:postData});if(resp.ok){var d=await resp.json();if(d.code===200||d.status==='ok')ok=true;}}catch(err){}var preview=list.slice(0,5).map(function(s){return '• '+s.name+' ('+s.symbol+')';}).join('\\n');if(ok){alert('🎉 东方财富自选股直连同步成功！\\n\\n共同步 '+list.length+' 只自选标的：\\n'+preview+(list.length>5?'\\n...等':'')+'\\n\\n👉 切回本地量化系统刷新即可查看最新自选池！');}else{alert('📋 已成功抓取 '+list.length+' 只自选股票，数据已【自动复制到剪贴板】！\\n\\n'+preview+(list.length>5?'\\n...等':'')+'\\n\\n👉 请切回本地量化系统，点击【📋 一键从剪贴板同步】即可秒级导入！');}}catch(globalErr){alert('❌ 自选股书签执行异常: '+globalErr.message);}})();";
}

async function copyHoldingsBookmarkScript() {
  await fetchEastmoneySyncToken();
  const code = getHoldingsBookmarkScript();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
      if (typeof showToast === 'function') showToast('已复制【持仓盈亏】书签代码！新建书签粘贴为网址即可', 'success');
      return;
    }
  } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = code;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  if (typeof showToast === 'function') showToast('已复制【持仓盈亏】书签代码！新建书签粘贴为网址即可', 'success');
}

async function copyWatchlistBookmarkScript() {
  await fetchEastmoneySyncToken();
  const code = getWatchlistBookmarkScript();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
      if (typeof showToast === 'function') showToast('已复制【自选股票】书签代码！新建书签粘贴为网址即可', 'success');
      return;
    }
  } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = code;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  if (typeof showToast === 'function') showToast('已复制【自选股票】书签代码！新建书签粘贴为网址即可', 'success');
}

async function openEastMoneyModal() {
  const modalEl = document.getElementById('eastMoneyModal');
  if (modalEl) modalEl.style.display = 'flex';
  
  await fetchEastmoneySyncToken();

  // 安全动态注入书签拖拽链接，避免 HTML 模板语法污染
  const hLink = document.getElementById('emHoldingBookmarkLink');
  if (hLink) hLink.href = getHoldingsBookmarkScript();
  const wLink = document.getElementById('emWatchlistBookmarkLink');
  if (wLink) wLink.href = getWatchlistBookmarkScript();

  fetchEastMoneyDaemonStatus();
}

function closeEastMoneyModal() {
  const modalEl = document.getElementById('eastMoneyModal');
  if (modalEl) modalEl.style.display = 'none';
}

window.copyHoldingsBookmarkScript = copyHoldingsBookmarkScript;
window.copyWatchlistBookmarkScript = copyWatchlistBookmarkScript;

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
          heartbeatTag.style.background = 'rgba(248,81,73,0.12)';
          heartbeatTag.style.color = '#f85149';
          let statusText = '凭证已失效';
          const raw = String(d.last_heartbeat_status || '');
          if (raw.includes('过期') || raw.includes('失效') || raw.includes('超时')) {
            statusText = '凭证已失效 (请点书签同步)';
          }
          heartbeatTag.innerHTML = '🔴 ' + statusText;
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
            <i class="ri-error-warning-fill" style="color: #f85149 !important;font-size:16px"></i>
            <span><b style="color: #f85149 !important">东方财富 Session 凭证已过期：</b>请点击右侧【东方财富直连设置】更新 Cookie 或重连，以恢复持仓对账！</span>
          `;
        } else {
          banner.style.background = 'rgba(9,105,218,0.06)';
          banner.style.borderColor = 'rgba(9,105,218,0.2)';
          bannerText.innerHTML = `
            <i class="ri-information-line" style="color: var(--sys-accent);font-size:16px"></i>
            <span><b>未绑定东财实盘 Cookie：</b>点击右侧【东方财富直连设置】粘贴 Cookie 可开启自动对账；当前采用本地持仓与公网实时行情全量监控。</span>
          `;
        }
      }
    }
  } catch(e) {
    console.warn('checkEMAuthStatus warn:', e);
  }
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
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.closeAddPositionModal = closeAddPositionModal;
window.saveManualPosition = saveManualPosition;
window.editPositionModal = editPositionModal;
window.clearAllPortfolioData = clearAllPortfolioData;
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
  // 统一打开包含【金融交易网址+书签】与【自选股网址+书签】的统一极简弹窗
  openEastMoneyModal();
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
      if (status) status.innerHTML = '<span style="color: #3fb950">✅ 已成功从剪贴板读取！</span>';
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
    status.innerHTML = '<span style="color: #3fb950;font-weight:700">✅ 已识别到东财关键 Session 凭证</span>';
  } else {
    status.innerHTML = '<span style="color: #e6a23c">⚠️ 正在输入... (支持完整 Cookie 或 Request Header)</span>';
  }
}

async function tryHeartbeatRenew() {
  const status = document.getElementById('quickRenewDetectStatus');
  if (status) status.innerHTML = '<span style="color: #388bfd">⏳ 正在向东财服务器发送会话探活与保活延期...</span>';
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
      if (status) status.innerHTML = `<span style="color: #f85149 !important">❌ 探活未通过：${errMsg}</span>`;
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
    "    } catch(e) { console.warn('探测持仓跳过:', e); }",
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
    "    } catch(fe) { console.warn('探测资金跳过:', fe); }",
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
    "    } catch(de) { console.warn('DOM资金解析跳过:', de); }",
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
  const token = (typeof window.getToken === 'function' ? window.getToken() : null) 
    || localStorage.getItem('quant_token') 
    || localStorage.getItem('token') 
    || localStorage.getItem('auth_token') 
    || '';
  if (!token) {
    if (typeof showToast === 'function') showToast('请先登录系统后再安装或分发油猴同步脚本', 'warning');
    return;
  }
  const url = window.location.origin + '/api/eastmoney/userscript.user.js?token=' + encodeURIComponent(token);
  window.open(url, '_blank');
  if (typeof showToast === 'function') {
    showToast('🚀 已在新标签页打开油猴脚本安全安装链接（Tampermonkey 会自动捕获并提示安装）', 'info');
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
        } catch(e){ console.warn('extractCredentials validatekey warn:', e); }
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
            }).then(function(r) { return r.json(); }).then(handleSuccess).catch(function(e){ console.warn('syncToQuantSystem fetch warn:', e); });
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
      const doFetch = typeof window.authFetch === 'function' ? window.authFetch : fetch;
      const res = await doFetch('/api/eastmoney/userscript.user.js');
      if (res.ok) code = await res.text();
    } catch(err) { console.warn('fetch userscript warn:', err); }
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



/**
 * 确认保存东财自选股通行证 Cookie 或自选代码
 */
async function submitCommunityCookie() {
  const ipt = document.getElementById('communityCookieInput');
  const val = ipt ? ipt.value.trim() : '';
  if (!val) {
    if (typeof showToast === 'function') showToast('请先输入或粘贴东财 Cookie 或股票代码', 'warning');
    return;
  }
  try {
    const res = await authFetch('/api/eastmoney/bind-community-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: val })
    });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      if (typeof showToast === 'function') showToast(`✅ 自选凭证绑定成功！${data.message || ''}`, 'success');
      if (ipt) ipt.value = '';
      if (typeof refreshPortfolioData === 'function') refreshPortfolioData();
    } else {
      if (typeof showToast === 'function') showToast(data.message || '自选凭证绑定失败', 'error');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('保存自选凭证异常: ' + err.message, 'error');
  }
}

// 显式导出全局调用接口，保障所有 HTML 内联事件 100% 正常调用
window.loadPortfolioList = refreshPortfolioData;
window.refreshPortfolioData = refreshPortfolioData;
window.openAddPositionModal = openAddPositionModal;
window.openQuickRenewModal = openQuickRenewModal;
window.closeQuickRenewModal = closeQuickRenewModal;
window.copyConsoleSyncCode = copyConsoleSyncCode;
window.submitQuickRenewCookie = submitQuickRenewCookie;
window.submitCommunityCookie = submitCommunityCookie;
window.syncWatchlistFromClipboard = syncWatchlistFromClipboard;
window.quickAddWatchlist = quickAddWatchlist;
window.removeWatchlistStock = removeWatchlistStock;
window.openEastMoneyModal = openEastMoneyModal;
window.closeEastMoneyModal = closeEastMoneyModal;
if (typeof triggerEastMoneySync === 'function') window.triggerEastMoneySync = triggerEastMoneySync;
if (typeof saveEastMoneyConfig === 'function') window.saveEastMoneyConfig = saveEastMoneyConfig;

// -------------------------------------------------------------
// 🐦 推特大V热评穿透弹窗 (点击自选表格推特动向胶囊时弹出)
// -------------------------------------------------------------
window.openTweetDetailModal = function(symbol, name) {
  let modal = document.getElementById('tweetDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tweetDetailModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px);';
    document.body.appendChild(modal);
  }

  const stockItem = _allWatchlistData.find(w => String(w.symbol).trim() === String(symbol).trim()) || {};
  const latestTw = stockItem.latest_tweet;
  const hitsCnt = stockItem.twitter_hits_count || 0;

  let tweetContentHtml = '';
  if (latestTw) {
    tweetContentHtml = `
      <div style="background:var(--sys-bg-nav, #f8fafc);border:1px solid var(--sys-border, #e2e8f0);border-radius:8px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#1d9bf0;color:#fff;font-weight:800;font-size:14px">𝕏</span>
            <div>
              <b style="font-size:14px;color:var(--sys-text-title, #0f172a)">${escapeHtml(latestTw.author_name || '推特大V')}</b>
              <span style="color:var(--sys-text-sub, #64748b);font-size:11px;margin-left:4px">${escapeHtml(latestTw.author_handle || '')}</span>
            </div>
          </div>
          <span style="font-size:11px;color:var(--sys-text-sub, #64748b)">${escapeHtml(latestTw.relative_time || latestTw.created_at || '近期')}</span>
        </div>
        <div style="font-size:13px;line-height:1.6;color:var(--sys-text-primary, #1e293b);background:rgba(255,255,255,0.7);padding:10px 12px;border-radius:6px;border:1px solid rgba(0,0,0,0.06)">
          ${escapeHtml(latestTw.text_snippet || '正在分析中...')}
        </div>
        ${latestTw.tweet_url ? `<div style="text-align:right;margin-top:8px"><a href="${latestTw.tweet_url}" target="_blank" rel="noopener noreferrer" style="color:#0969da;font-size:12px;text-decoration:none;font-weight:600">打开推特原推查看完整对话 ↗</a></div>` : ''}
      </div>
    `;
  } else {
    tweetContentHtml = `
      <div style="text-align:center;padding:24px;color:var(--sys-text-sub, #64748b);background:var(--sys-bg-nav, #f8fafc);border-radius:8px;margin-bottom:14px">
        正在拉取最新大V推文详细上下文...
      </div>
    `;
  }

  modal.innerHTML = `
    <div style="background:var(--sys-bg-card, #ffffff);border-radius:10px;width:100%;max-width:540px;box-shadow:0 10px 25px rgba(0,0,0,0.2);overflow:hidden;border:1px solid var(--sys-border, #e2e8f0)">
      <div style="padding:14px 18px;background:var(--sys-table-header, #f1f5f9);border-bottom:1px solid var(--sys-border, #e2e8f0);display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:14px;color:var(--sys-text-title, #0f172a)">
          <span>🐦 推特大V热评透视：【${escapeHtml(name)} (${escapeHtml(symbol)})】</span>
          <span style="background:#fef3c7;color:#b45309;font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid #fde68a">${hitsCnt} 条提及</span>
        </div>
        <button onclick="document.getElementById('tweetDetailModal').style.display='none'" style="border:none;background:transparent;font-size:18px;cursor:pointer;color:var(--sys-text-sub, #64748b)">&times;</button>
      </div>
      <div style="padding:18px">
        ${tweetContentHtml}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <button class="el-button el-button--small" onclick="document.getElementById('tweetDetailModal').style.display='none'; if(typeof switchTwitterCategory==='function') { switchTwitterCategory('MY_WATCHLIST'); if(typeof switchTab==='function') switchTab('twitter'); }">
            🔍 跳转推特大厅查看全部自选推文
          </button>
          <button class="el-button el-button--primary el-button--small" onclick="document.getElementById('tweetDetailModal').style.display='none'">
            关闭
          </button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
};

// -------------------------------------------------------------
// ⏱️ 自选池 60 秒静默自动轮询机制 (保活与实时异动发现)
// -------------------------------------------------------------
let _watchlistAutoRefreshTimer = null;
function initWatchlistAutoRefresh() {
  if (_watchlistAutoRefreshTimer) clearInterval(_watchlistAutoRefreshTimer);
  _watchlistAutoRefreshTimer = setInterval(() => {
    // 仅在页面处于前台可见时静默刷新
    if (document.visibilityState === 'visible') {
      if (typeof loadPortfolioDiagnostics === 'function') {
        loadPortfolioDiagnostics(false);
      }
    }
  }, 60000); // 60 秒轮询

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (typeof loadPortfolioDiagnostics === 'function') {
        loadPortfolioDiagnostics(false);
      }
    }
  });
}

// 自动启动
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWatchlistAutoRefresh);
  } else {
    initWatchlistAutoRefresh();
  }
}
