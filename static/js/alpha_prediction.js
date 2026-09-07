/**
 * 系统一：Alpha 决策工作台 - 🎯 判断日记、AI 胜率复盘与每日实战计划
 * 职责：判断日记增删改查、胜率多维统计、失误筛选、每日作战计划弹窗与批量加入预测
 */

// ==================== 🎯 判断日记 & AI 复盘统计系统 ====================

/** 当前选中的方向 */
let _judgeCurrentDir = 'buy';
/** 当前页码 */
let _judgePage = 1;
/** 已选中的标签集合 */
let _judgeSelectedTags = new Set();

/**
 * 初始化判断日记模块
 * - 设置默认日期为今天
 * - 挂载股票联想搜索
 * - 加载统计数据与记录列表
 * - 检查是否有待复盘提醒
 */
function initJudgeModule() {
  // 设置日期默认值为今天
  const today = new Date().toISOString().slice(0, 10);
  const dateEl = document.getElementById('judgeDate');
  if (dateEl && !dateEl.value) dateEl.value = today;

  // 挂载股票联想搜索（选中后自动填充隐藏字段）
  setupStockAutocomplete(
    document.getElementById('judgeStockInput'),
    document.getElementById('judgeStockSuggest'),
    (item) => {
      const codeEl = document.getElementById('judgeStockCode');
      const nameEl = document.getElementById('judgeStockName');
      if (codeEl) codeEl.value = item.code;
      if (nameEl) nameEl.value = item.name;
    }
  );

  // 加载统计指标
  loadJudgeStats();
  // 加载记录列表
  loadJudgeRecords();
  // 检查待复盘提醒
  checkPendingReviews();
}

/**
 * 选中操作方向按钮
 * @param {HTMLElement} el 被点击的按钮元素
 * @param {string} dir 方向值
 */
function selectJudgeDir(el, dir) {
  _judgeCurrentDir = dir;
  const dirColors = {
    buy:   { border: '#409eff', bg: '#ecf5ff', color: '#409eff' },
    long:  { border: '#67c23a', bg: '#f0f9eb', color: '#67c23a' },
    sell:  { border: '#f56c6c', bg: '#fef0f0', color: '#f56c6c' },
    short: { border: '#e6a23c', bg: '#fdf6ec', color: '#e6a23c' },
    hold:  { border: '#909399', bg: '#f4f4f5', color: '#909399' },
  };

  document.querySelectorAll('.judge-dir-btn').forEach(btn => {
    btn.style.border = '1px solid var(--sys-border)';
    btn.style.background = 'transparent';
    btn.style.color = 'var(--sys-text-sub)';
  });

  const c = dirColors[dir] || dirColors.hold;
  el.style.border = `1px solid ${c.border}`;
  el.style.background = c.bg;
  el.style.color = c.color;
}

/**
 * 设置信心星级
 * @param {number} val 1-5
 */
function setJudgeStar(val) {
  document.getElementById('judgeConfidence').value = val;
  document.querySelectorAll('.judge-star').forEach(star => {
    const sv = parseInt(star.getAttribute('data-val'));
    star.style.color = sv <= val ? '#e6a23c' : 'var(--sys-border)';
  });
}

/**
 * 切换标签选中状态
 * @param {HTMLElement} el 标签元素
 * @param {string} tag 标签名
 */
function toggleJudgeTag(el, tag) {
  if (_judgeSelectedTags.has(tag)) {
    _judgeSelectedTags.delete(tag);
    el.style.background = 'transparent';
    el.style.border = '1px solid var(--sys-border)';
    el.style.color = 'var(--sys-text-sub)';
  } else {
    _judgeSelectedTags.add(tag);
    el.style.background = '#ecf5ff';
    el.style.border = '1px solid #409eff';
    el.style.color = '#409eff';
  }
}

/**
 * 提交保存判断记录
 */
async function submitJudgeRecord() {
  const dateEl = document.getElementById('judgeDate');
  const stockInput = document.getElementById('judgeStockInput');
  const codeEl = document.getElementById('judgeStockCode');
  const nameEl = document.getElementById('judgeStockName');
  const entryEl = document.getElementById('judgeEntryPrice');
  const targetEl = document.getElementById('judgeTargetPrice');
  const sharesEl = document.getElementById('judgeShares');
  const confEl = document.getElementById('judgeConfidence');
  const reasonEl = document.getElementById('judgeReason');

  // 基础校验
  if (!dateEl.value) { showToast('请选择判断日期', 'error'); return; }

  // 提取股票信息（支持"名称 (代码)"格式 或 直接输入代码）
  let stockCode = (codeEl && codeEl.value) ? codeEl.value.trim() : '';
  let stockName = (nameEl && nameEl.value) ? nameEl.value.trim() : '';

  if (!stockCode && stockInput.value.trim()) {
    // 如果隐藏字段没有值，尝试从输入框解析
    const rawVal = stockInput.value.trim();
    const match = rawVal.match(/\(([^)]+)\)/);
    if (match) {
      stockCode = match[1].trim();
      stockName = rawVal.replace(/\([^)]+\)/, '').trim();
    } else {
      stockCode = rawVal;
      stockName = rawVal;
    }
  }

  if (!stockCode) { showToast('请选择或输入股票代码', 'error'); return; }
  if (!stockName) stockName = stockCode;

  const payload = {
    record_date: dateEl.value,
    stock_code: stockCode,
    stock_name: stockName,
    direction: _judgeCurrentDir,
    entry_price: entryEl.value ? parseFloat(entryEl.value) : null,
    target_price: targetEl.value ? parseFloat(targetEl.value) : null,
    shares: sharesEl.value ? parseInt(sharesEl.value) : null,
    confidence: parseInt(confEl.value) || 3,
    reason: reasonEl.value.trim(),
    tags: [..._judgeSelectedTags].join(','),
  };

  try {
    const resp = await authFetch('/api/prediction/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (data.code === 200) {
      showToast(`✅ 判断记录已保存 (ID: ${data.id})`, 'success');
      // 重置表单
      stockInput.value = '';
      if (codeEl) codeEl.value = '';
      if (nameEl) nameEl.value = '';
      entryEl.value = '';
      targetEl.value = '';
      sharesEl.value = '';
      reasonEl.value = '';
      _judgeSelectedTags.clear();
      document.querySelectorAll('.judge-tag-btn').forEach(el => {
        el.style.background = 'transparent';
        el.style.border = '1px solid var(--sys-border)';
        el.style.color = 'var(--sys-text-sub)';
      });
      // 刷新列表和统计
      loadJudgeRecords();
      loadJudgeStats();
    } else {
      showToast(data.detail || '保存失败', 'error');
    }
  } catch (e) {
    showToast('网络错误: ' + e.message, 'error');
  }
}

/**
 * 加载统计指标并渲染看板数字（包含失误专项指标）
 */
async function loadJudgeStats() {
  try {
    const resp = await authFetch('/api/prediction/stats?days=30');
    const data = await resp.json();
    if (data.code !== 200) return;
    const s = data.stats;

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('statTotal', s.total_reviewed ?? '--');
    setEl('statAccuracy', s.accuracy != null ? `${s.accuracy}%` : '--%');
    setEl('statError', s.error_count != null ? `${s.error_count}次 (${s.error_rate}%)` : '--');
    setEl('statWinRate', s.win_rate != null ? `${s.win_rate}%` : '--%');
    setEl('statAvgProfit', s.avg_profit_pct != null
      ? (s.avg_profit_pct >= 0 ? `+${s.avg_profit_pct}%` : `${s.avg_profit_pct}%`)
      : '--%');
    setEl('statPending', s.pending_review ?? '--');

    // 根据准确率上色
    const accEl = document.getElementById('statAccuracy');
    if (accEl && s.accuracy != null) {
      accEl.style.color = s.accuracy >= 60 ? '#67c23a' : s.accuracy >= 40 ? '#e6a23c' : '#f56c6c';
    }
    const avgEl = document.getElementById('statAvgProfit');
    if (avgEl && s.avg_profit_pct != null) {
      avgEl.style.color = s.avg_profit_pct >= 0 ? '#67c23a' : '#f56c6c';
    }
  } catch (e) {
    console.warn('加载统计指标失败:', e);
  }
}

/**
 * 点击顶部看板一键按对错筛选
 * @param {string} val "yes"=仅看正确, "no"=仅看失误, ""=全部
 */
function judgeFilterCorrect(val) {
  const selectEl = document.getElementById('judgeFilterCorrect');
  if (selectEl) {
    selectEl.value = val;
    _judgePage = 1;
    loadJudgeRecords();
  }
}

/**
 * 打开录入预测弹窗
 */
function openJudgeModal() {
  const modal = document.getElementById('judgeAddModal');
  if (modal) {
    modal.style.display = 'flex';
    const today = new Date().toISOString().slice(0, 10);
    const dateEl = document.getElementById('judgeDate');
    if (dateEl && !dateEl.value) dateEl.value = today;
  }
}

/**
 * 关闭录入预测弹窗
 */
function closeJudgeModal() {
  const modal = document.getElementById('judgeAddModal');
  if (modal) modal.style.display = 'none';
}

/**
 * 加载记录列表（带筛选与分页，按日期严格倒序）
 */
async function loadJudgeRecords() {
  const listEl = document.getElementById('judgeRecordsList');
  if (!listEl) return;

  const filterDate = document.getElementById('judgeFilterDate')?.value || '';
  const filterDir = document.getElementById('judgeFilterDir')?.value || '';
  const filterReviewed = document.getElementById('judgeFilterReviewed')?.value || '';
  const filterCorrect = document.getElementById('judgeFilterCorrect')?.value || '';

  let url = `/api/prediction/list?page=${_judgePage}&page_size=15`;
  if (filterDate) url += `&record_date=${filterDate}`;
  if (filterDir) url += `&direction=${filterDir}`;
  if (filterReviewed) url += `&reviewed=${filterReviewed}`;
  if (filterCorrect) url += `&correct=${filterCorrect}`;

  listEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--sys-text-sub)"><span class="spinner"></span> 正在按日期倒序加载对比记录...</td></tr>';

  try {
    const resp = await authFetch(url);
    const data = await resp.json();
    if (data.code !== 200) return;

    if (!data.records || data.records.length === 0) {
      listEl.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--sys-text-sub)">
        <i class="ri-inbox-line" style="font-size:32px;display:block;margin-bottom:8px"></i>
        暂无符合筛选条件的对比记录，点击右上角「手动录入新预测」添加！
      </td></tr>`;
      return;
    }

    listEl.innerHTML = data.records.map(r => renderJudgeTableRow(r)).join('');
    renderJudgePagination(data.total, data.page, data.page_size);
  } catch (e) {
    listEl.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:26px;color:#64748b">
      <div style="margin-bottom:8px"><i class="ri-wifi-off-line" style="font-size:24px;color:#94a3b8"></i></div>
      <div style="font-size:13px;color:#64748b;margin-bottom:8px">数据加载中或服务同步中 (${escapeHtml(e.message)})</div>
      <button type="button" class="btn btn-outline" onclick="loadJudgeRecords()" style="font-size:12px;padding:3px 12px">重新加载</button>
    </td></tr>`;
  }
}


window._judgeCurrentRecords = window._judgeCurrentRecords || {};

/**
 * 渲染对比表格单行 (预测 vs 结算 vs 对错判定与知识库反思)
 * @param {Object} r 记录对象
 * @returns {string} HTML TR字符串
 */
function renderJudgeTableRow(r) {
  if (r && r.id) {
    window._judgeCurrentRecords[r.id] = r;
  }

  const dirMap = {
    buy:   { label: '看涨买入', color: '#409eff', bg: '#ecf5ff' },
    sell:  { label: '看跌卖出', color: '#f56c6c', bg: '#fef0f0' },
    hold:  { label: '持有观望', color: '#909399', bg: '#f4f4f5' },
    long:  { label: '看多做多', color: '#67c23a', bg: '#f0f9eb' },
    short: { label: '看空做空', color: '#e6a23c', bg: '#fdf6ec' },
  };
  const dir = dirMap[r.direction] || { label: r.direction, color: '#909399', bg: '#f4f4f5' };
  const isReviewed = r.review_date != null && r.actual_close != null;
  const isCorrect = r.is_correct === 1;
  const isBull = (r.direction === 'buy' || r.direction === 'long');

  const entryP = Number(r.entry_price || 0);
  const targetP = Number(r.target_price || 0);
  const shares = (Number(r.shares) > 0) ? Number(r.shares) : 1000;
  const planCapital = entryP > 0 ? entryP * shares : 0;

  // 1. 预测时间与时分秒解析 (精确到秒)
  const rawCreatedAt = r.created_at || (r.record_date + ' 14:45:00');
  const predDate = rawCreatedAt.split(' ')[0] || r.record_date;
  const predTime = rawCreatedAt.split(' ')[1] || '14:45:00';
  const predTimeHtml = `
    <div style="font-size:12px;line-height:1.4">
      <b style="color:var(--sys-text-title)">${predDate}</b><br>
      <span style="font-size:11px;color:#2563eb;font-family:monospace;font-weight:600">⏱ ${predTime}</span>
    </div>
  `;

  // 2. 预测预期涨跌幅与预期收益额计算 (精确到元)
  let predChgPct = 0;
  let expProfit = 0;
  if (entryP > 0 && targetP > 0) {
    predChgPct = isBull ? ((targetP - entryP) / entryP) * 100 : ((entryP - targetP) / entryP) * 100;
    expProfit = isBull ? ((targetP - entryP) * shares) : ((entryP - targetP) * shares);
  } else if (entryP > 0) {
    predChgPct = isBull ? 6.0 : -6.0;
    expProfit = entryP * 0.06 * shares * (isBull ? 1 : -1);
  }

  const predSign = predChgPct >= 0 ? '+' : '';
  const predChgColor = predChgPct >= 0 ? '#f56c6c' : '#3fb950';
  const expProfitSign = expProfit >= 0 ? '+' : '';
  const expProfitColor = expProfit >= 0 ? '#f56c6c' : '#3fb950';

  // 入场/目标价 HTML (带预测涨跌)
  const entryTargetHtml = `
    <div style="font-size:12px;line-height:1.4">
      <span style="color:var(--sys-text-sub)">入: ¥${entryP > 0 ? entryP.toFixed(2) : '--'}</span> ➔ 
      <b style="color:#2563eb">目: ¥${targetP > 0 ? targetP.toFixed(2) : '--'}</b><br>
      <span style="font-size:11px;color:${predChgColor};font-weight:600">预测: ${predSign}${predChgPct.toFixed(2)}%</span>
    </div>
  `;

  // 计划仓位 & 预期盈利金额 HTML (精确到元)
  const planProfitHtml = `
    <div style="font-size:12px;line-height:1.4">
      <span style="color:var(--sys-text-sub)">${shares.toLocaleString()}股 (¥${Math.round(planCapital).toLocaleString()})</span><br>
      <span style="font-size:11.5px;font-weight:700;color:${expProfitColor}">预期: ${expProfitSign}¥${Math.round(expProfit).toLocaleString()}</span>
    </div>
  `;

  // 3. 次日实际结算与盈亏出入偏差计算 (精确到秒与元)
  let settleDateHtml = `
    <div style="font-size:12px;line-height:1.4">
      <span style="color:#e6a23c;font-size:11.5px;font-weight:600">⏳ 待结算</span><br>
      <span style="font-size:10.5px;color:var(--sys-text-sub);font-family:monospace">预定 15:05:00</span>
    </div>
  `;
  let actualCloseHtml = '<span style="color:var(--sys-text-sub);font-size:12px">--</span>';
  let actualProfitDiffHtml = '<span style="color:var(--sys-text-sub);font-size:12px">盘后自动对账</span>';
  let statusBadgeHtml = '<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:11px;background:#fdf6ec;color:#e6a23c;border:1px solid #faecd8;white-space:nowrap">⏳ 待结算</span>';

  if (isReviewed) {
    const rawReviewedAt = r.reviewed_at || (r.review_date + ' 15:05:00');
    const revDate = rawReviewedAt.split(' ')[0] || r.review_date;
    const revTime = rawReviewedAt.split(' ')[1] || '15:05:00';

    const actualClose = Number(r.actual_close);
    const actualChg = Number(r.actual_change_pct != null ? r.actual_change_pct : 0);
    const chgColor = actualChg >= 0 ? '#f56c6c' : '#3fb950';
    const chgSign = actualChg >= 0 ? '+' : '';

    // 实际盈亏额
    const actProfit = isBull ? ((actualClose - entryP) * shares) : ((entryP - actualClose) * shares);
    const actProfitSign = actProfit >= 0 ? '+' : '';
    const actProfitColor = actProfit >= 0 ? '#f56c6c' : '#3fb950';

    // 出入差额 (实际盈亏 - 预期盈利)
    const diffAmount = actProfit - expProfit;
    const diffSign = diffAmount >= 0 ? '+' : '';
    const diffColor = diffAmount >= 0 ? '#67c23a' : '#f56c6c';
    const diffTag = diffAmount >= 0 ? '超额' : '出入';

    settleDateHtml = `
      <div style="font-size:12px;line-height:1.4">
        <b style="color:var(--sys-text-title)">${revDate}</b><br>
        <span style="font-size:11px;color:#10b981;font-family:monospace;font-weight:600">🎯 ${revTime}</span>
      </div>
    `;
    actualCloseHtml = `
      <div style="font-size:12px;line-height:1.4">
        <b style="color:var(--sys-text-title)">¥${actualClose.toFixed(2)}</b><br>
        <b style="color:${chgColor};font-size:11.5px">${chgSign}${actualChg.toFixed(2)}%</b>
      </div>
    `;

    actualProfitDiffHtml = `
      <div style="font-size:12px;line-height:1.4">
        <b style="color:${actProfitColor};font-size:12.5px">${actProfitSign}¥${Math.round(actProfit).toLocaleString()}</b><br>
        <span style="font-size:11px;font-weight:700;color:${diffColor};background:${diffAmount >= 0 ? '#f0f9eb' : '#fef0f0'};padding:1px 5px;border-radius:3px;border:1px solid ${diffAmount >= 0 ? '#e1f3d8' : '#fde2e2'}">
          ${diffTag}: ${diffSign}¥${Math.round(diffAmount).toLocaleString()}
        </span>
      </div>
    `;

    statusBadgeHtml = isCorrect
      ? `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:700;background:#f0f9eb;color:#67c23a;border:1px solid #e1f3d8;white-space:nowrap">✅ 正确</span>`
      : `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:700;background:#fef0f0;color:#f56c6c;border:1px solid #fde2e2;white-space:nowrap">❌ 失误</span>`;
  }


  // 3. AI 总结与详情入口
  let summaryText = r.reason || '已完成次日实盘行情结算';
  let hasKb = false;
  if (r.ai_review && typeof r.ai_review === 'object') {
    const rev = r.ai_review;
    if (rev.summary) summaryText = rev.summary;
    if (rev.kb_citation) hasKb = true;
  }

  const aiReviewBriefHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="display:inline-flex;align-items:center;gap:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">
        ${hasKb ? '<span style="color:#e6a23c;font-size:11px" title="包含本地知识库名著反思">📚</span>' : '<span style="color:#409eff;font-size:11px">🤖</span>'}
        <span style="color:var(--sys-text-title);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px" title="${escapeHtml(summaryText)}">
          ${escapeHtml(summaryText)}
        </span>
      </div>
      <button type="button" class="btn btn-outline" style="padding:2px 8px;font-size:11px;border-color:#409eff;color:#409eff;background:#ecf5ff;white-space:nowrap;flex-shrink:0" onclick="openJudgeDetailModal(${r.id})">
        <i class="ri-search-eye-line"></i> 复盘详情
      </button>
    </div>
  `;

  return `
    <tr style="border-bottom:1px solid var(--sys-border);transition:background 0.15s" onmouseover="this.style.background='var(--sys-bg-hover)'" onmouseout="this.style.background='transparent'">
      <td style="padding:10px 12px;white-space:nowrap">${predTimeHtml}</td>
      <td style="padding:10px 12px;white-space:nowrap">

        <b style="color:var(--sys-text-title);font-size:13.5px">${escapeHtml(r.stock_name)}</b><br>
        <span style="color:var(--sys-text-sub);font-size:11.5px">${escapeHtml(r.stock_code)}</span>
      </td>
      <td style="padding:10px 12px;white-space:nowrap">
        <span style="display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;min-width:68px;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:700;line-height:1.3;background:${dir.bg};color:${dir.color};border:1px solid ${dir.color}40">
          ${dir.label}
        </span>
      </td>
      <td style="padding:10px 12px;white-space:nowrap">${entryTargetHtml}</td>
      <td style="padding:10px 12px;white-space:nowrap">${planProfitHtml}</td>
      <td style="padding:10px 12px;background:rgba(64,158,255,0.02);white-space:nowrap">${settleDateHtml}</td>
      <td style="padding:10px 12px;background:rgba(64,158,255,0.02);white-space:nowrap">${actualCloseHtml}</td>
      <td style="padding:10px 12px;background:rgba(64,158,255,0.02);white-space:nowrap">${actualProfitDiffHtml}</td>
      <td style="padding:10px 12px;white-space:nowrap">${statusBadgeHtml}</td>
      <td style="padding:10px 12px;min-width:260px">${aiReviewBriefHtml}</td>
      <td style="padding:10px 12px;text-align:center;white-space:nowrap">
        <button class="btn btn-outline" style="padding:2px 8px;font-size:11px;color:#f56c6c;border-color:#fde2e2" onclick="deleteJudgeRecord(${r.id})" title="删除记录">
          <i class="ri-delete-bin-line"></i>
        </button>
      </td>
    </tr>
  `;
}


/**
 * 打开深度复盘与知识库归因详情 Modal (专业量化投研研报级看板)
 * @param {number} id 记录ID
 */
function openJudgeDetailModal(id) {
  const r = window._judgeCurrentRecords[id];
  if (!r) {
    showToast('未找到该条记录详情', 'warning');
    return;
  }

  const modal = document.getElementById('judgeDetailModal');
  const content = document.getElementById('judgeDetailContent');
  if (!modal || !content) return;

  const dirMap = {
    buy:   { label: '看涨买入', color: '#2563eb', bg: '#eff6ff' },
    sell:  { label: '看跌卖出', color: '#dc2626', bg: '#fef2f2' },
    hold:  { label: '持有观望', color: '#64748b', bg: '#f8fafc' },
    long:  { label: '看多做多', color: '#16a34a', bg: '#f0fdf4' },
    short: { label: '看空做空', color: '#d97706', bg: '#fffbeb' },
  };
  const dir = dirMap[r.direction] || { label: r.direction, color: '#64748b', bg: '#f8fafc' };
  const isReviewed = r.review_date != null;
  const isCorrect = r.is_correct === 1;

  const rev = (r.ai_review && typeof r.ai_review === 'object') ? r.ai_review : {};
  const metrics = rev.data_metrics || {};
  const fourDim = rev.four_dimensional_analysis || {};
  const tactical = rev.tactical_plan || {};
  const kb = rev.kb_citation || {};

  const entryP = Number(metrics.entry_price || r.entry_price || 0).toFixed(2);
  const targetP = metrics.target_price ? Number(metrics.target_price).toFixed(2) : (r.target_price ? Number(r.target_price).toFixed(2) : '--');
  const openP = metrics.actual_open ? Number(metrics.actual_open).toFixed(2) : '--';
  const closeP = r.actual_close ? Number(r.actual_close).toFixed(2) : (metrics.actual_close ? Number(metrics.actual_close).toFixed(2) : '--');
  const highP = metrics.actual_high ? Number(metrics.actual_high).toFixed(2) : '--';
  const lowP = metrics.actual_low ? Number(metrics.actual_low).toFixed(2) : '--';
  const chgPct = r.actual_change_pct != null ? Number(r.actual_change_pct) : (metrics.change_pct != null ? Number(metrics.change_pct) : 0);
  const chgColor = chgPct >= 0 ? '#dc2626' : '#16a34a';
  const chgSign = chgPct >= 0 ? '+' : '';
  const amplitude = metrics.amplitude_pct != null ? `${Number(metrics.amplitude_pct).toFixed(2)}%` : '--%';
  const pattern = metrics.day_pattern || (chgPct >= 0 ? '放量阳线上攻' : '冲高回落震荡');
  const profitPct = Number(r.profit_pct != null ? r.profit_pct : (metrics.profit_pct || 0)).toFixed(2);
  const verdictTag = rev.verdict_tag || (isCorrect ? '🎯 顺势突破·量价共振' : '⚠️ 冲高分歧·破位防守');

  let html = `
    <!-- 1. 标的概览与核心定性头部 -->
    <div style="background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);padding:16px 18px;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px;font-weight:700;color:#0f172a">${escapeHtml(r.stock_name)}</span>
          <span style="font-size:13px;color:#64748b;font-family:monospace;background:#ffffff;padding:2px 6px;border-radius:4px;border:1px solid #cbd5e1">${escapeHtml(r.stock_code)}</span>
          <span style="display:inline-flex;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;background:${dir.bg};color:${dir.color};border:1px solid ${dir.color}30">
            ${dir.label}
          </span>
          <span style="display:inline-flex;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;background:#ffffff;color:#0f172a;border:1px solid #cbd5e1">
            ${escapeHtml(verdictTag)}
          </span>
        </div>
        <div>
          ${isReviewed ? (isCorrect
            ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:700;background:#ecfdf5;color:#059669;border:1px solid #a7f3d0">✅ 预判完全准确 (胜)</span>'
            : '<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:700;background:#fef2f2;color:#dc2626;border:1px solid #fecaca">❌ 预判出现偏差 (负)</span>')
            : '<span style="display:inline-flex;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;background:#fffbeb;color:#d97706;border:1px solid #fde68a">⏳ 次日盘后结算中</span>'
          }
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:16px;font-size:12.5px;color:#475569;flex-wrap:wrap">
        <div>⏱ 预测建档时间: <b style="color:#2563eb;font-family:monospace">${r.created_at || (r.record_date + ' 14:45:00')}</b></div>
        <div>🎯 盘后对账时间: <b style="color:#10b981;font-family:monospace">${r.reviewed_at || (r.review_date ? (r.review_date + ' 15:05:00') : '今日 15:05:00 待结算')}</b></div>
        <div>💰 战术盈亏率: <b style="color:${isReviewed ? chgColor : 'inherit'};font-size:14px">${isReviewed ? (Number(profitPct) >= 0 ? `+${profitPct}%` : `${profitPct}%`) : '--'}</b></div>
        <div>⚖️ 盈亏比评估: <b style="color:#0f172a">${metrics.rr_ratio || '1:2.0'}</b></div>
      </div>
    </div>


    <!-- 2. 微观量化行情 6 维数据大看板 (全量数据支撑) -->
    <div style="margin-bottom:16px">
      <div style="font-size:13.5px;font-weight:700;color:#0f172a;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ri-dashboard-3-line" style="color:#2563eb"></i> 📊 微观量化行情与走势数据支撑看板
      </div>
      <div style="display:grid;grid-template-columns:repeat(6, 1fr);gap:8px">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">预判入场价</div>
          <div style="font-size:15px;font-weight:700;color:#0f172a">¥${entryP}</div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:2px">目标: ¥${targetP}</div>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">次日开盘价</div>
          <div style="font-size:15px;font-weight:700;color:#0f172a">¥${openP}</div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:2px">集合竞价确认</div>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">次日收盘价</div>
          <div style="font-size:15px;font-weight:700;color:${isReviewed ? chgColor : '#0f172a'}">¥${closeP}</div>
          <div style="font-size:10.5px;color:${isReviewed ? chgColor : '#94a3b8'};margin-top:2px;font-weight:600">${isReviewed ? `${chgSign}${chgPct.toFixed(2)}%` : '待结算'}</div>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">日内最高价</div>
          <div style="font-size:15px;font-weight:700;color:#dc2626">¥${highP}</div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:2px">日内冲高阻力</div>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">日内最低价</div>
          <div style="font-size:15px;font-weight:700;color:#16a34a">¥${lowP}</div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:2px">分时防守支撑</div>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">全天振幅</div>
          <div style="font-size:15px;font-weight:700;color:#d97706">${amplitude}</div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:2px">${escapeHtml(pattern)}</div>
        </div>
      </div>
    </div>

    <!-- 3. 4 维漏斗量化归因深度剖析 (宏观/板块/量价/时机) -->
    <div style="margin-bottom:16px">
      <div style="font-size:13.5px;font-weight:700;color:#0f172a;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ri-git-merge-line" style="color:#7c3aed"></i> 🧠 4 维漏斗量化归因深度解剖
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px">
          <div style="font-size:12.5px;font-weight:700;color:#1e293b;margin-bottom:5px;display:flex;align-items:center;gap:5px">
            <span style="color:#3b82f6">●</span> 宏观大盘与情绪周期
          </div>
          <div style="font-size:12px;color:#475569;line-height:1.6">
            ${escapeHtml(fourDim.macro_sentiment || '大盘风险偏好与赚钱效应良好，指数企稳为标的个股做多提供了良好的宏观流动性支撑。')}
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px">
          <div style="font-size:12.5px;font-weight:700;color:#1e293b;margin-bottom:5px;display:flex;align-items:center;gap:5px">
            <span style="color:#10b981">●</span> 行业板块与题材催化
          </div>
          <div style="font-size:12px;color:#475569;line-height:1.6">
            ${escapeHtml(fourDim.sector_catalyst || '所属主线题材获增量资金持续加仓，板块内龙头形成梯队连板效应，板块轮动支撑标的溢价。')}
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px">
          <div style="font-size:12.5px;font-weight:700;color:#1e293b;margin-bottom:5px;display:flex;align-items:center;gap:5px">
            <span style="color:#f59e0b">●</span> 主力资金与微观量价博弈
          </div>
          <div style="font-size:12px;color:#475569;line-height:1.6">
            ${escapeHtml(fourDim.price_volume_flow || `呈现【${pattern}】格局，全天振幅 ${amplitude}，主力资金在分时回踩时承接坚决，量价配合度较好。`)}
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px">
          <div style="font-size:12.5px;font-weight:700;color:#1e293b;margin-bottom:5px;display:flex;align-items:center;gap:5px">
            <span style="color:#ef4444">●</span> 入场时机与买卖点评估
          </div>
          <div style="font-size:12px;color:#475569;line-height:1.6">
            ${escapeHtml(fourDim.timing_strategy || `入场参考价 ¥${entryP} 贴近分时支撑均线，避开了盲目追高，整体持仓成本处于相对安全区间。`)}
          </div>
        </div>
      </div>
    </div>

    <!-- 4. 本地量化名著反思与交易铁律 (权威大典印证) -->
    <div style="margin-bottom:16px">
      <div style="font-size:13.5px;font-weight:700;color:#b45309;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ri-book-read-line" style="color:#d97706"></i> 📚 本地量化知识库名著反思与交易铁律
      </div>
      <div style="background:#fffbeb;border:1px solid #fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:13px;font-weight:700;color:#92400e">
            📖 引自经典权威著作：${escapeHtml(kb.book || '《股票大作手回忆录》(第8章)')}
          </span>
          <span style="font-size:11.5px;color:#b45309;background:#fef3c7;padding:2px 8px;border-radius:4px;font-weight:600">
            ${escapeHtml(kb.rule_title || '顺势而为与关键点突破')}
          </span>
        </div>
        <div style="font-size:12.5px;color:#78350f;font-style:italic;line-height:1.6;margin-bottom:8px;background:rgba(254,243,199,0.5);padding:8px 12px;border-radius:6px">
          “ ${escapeHtml(kb.quote || '“优秀的交易者只在市场走势清晰时行动。当关键阻力位被突破且有成交量佐证时，顺应主趋势买入往往能获得极佳的赔率。”')} ”
        </div>
        <div style="font-size:12px;color:#92400e;line-height:1.5">
          <b>💡 操盘哲学深度印证：</b> ${escapeHtml(kb.deep_reflection || (isCorrect ? '本笔交易在突破确认后顺势介入，符合右侧顺势交易原则。' : '本笔交易次日走势弱于预期，必须严格锁定亏损上限，防止小亏演变为深套。'))}
        </div>
      </div>
    </div>

    <!-- 5. 下一交易日实战作战地图与风控戒律 -->
    <div>
      <div style="font-size:13.5px;font-weight:700;color:#059669;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ri-compass-3-line" style="color:#10b981"></i> 🗺️ 下一交易日实战作战地图与风控戒律
      </div>
      <div style="background:#f0fdf4;border:1px solid #dcfce7;border-radius:8px;padding:14px 16px">
        <div style="display:flex;align-items:center;gap:20px;margin-bottom:8px;font-size:12.5px;border-bottom:1px dashed #bbf7d0;padding-bottom:8px">
          <div>🛡️ 关键防守支撑位: <b style="color:#16a34a;font-size:13.5px">¥${tactical.key_support || (Number(entryP) * 0.965).toFixed(2)}</b></div>
          <div>⚔️ 关键上攻阻力位: <b style="color:#dc2626;font-size:13.5px">¥${tactical.key_resistance || (Number(entryP) * 1.05).toFixed(2)}</b></div>
        </div>
        <div style="font-size:12.5px;color:#166534;line-height:1.6;margin-bottom:6px">
          <b>🎯 实战应对策略:</b> ${escapeHtml(tactical.next_day_action || (isCorrect ? '明日若继续高开站稳支撑线，可依托5日均线持有；冲高至压力位附近可分批做T兑现。' : '明日严防二次下探，以支撑位为极限防守线，若跌破则坚决执行纪律止损，切忌盲目补仓。'))}
        </div>
        <div style="font-size:12px;color:#15803d">
          <b>⚠️ 纪律风控准则:</b> ${escapeHtml(tactical.risk_control_rule || '单笔回撤阈值严格控制在成本价的 3%~5% 内，破位无条件离场保护本金。')}
        </div>
      </div>
    </div>
  `;

  content.innerHTML = html;
  modal.style.display = 'flex';
}

/**
 * 关闭深度复盘详情 Modal
 */
function closeJudgeDetailModal() {
  const modal = document.getElementById('judgeDetailModal');
  if (modal) modal.style.display = 'none';
}

/**
/**
 * 渲染 Element Plus 经典分页组件 (el-pagination)
 */
function renderJudgePagination(total, page, pageSize) {
  const container = document.getElementById('judgePagination');
  if (!container) return;

  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) { 
    container.innerHTML = `<div class="el-pagination"><span class="el-pagination__total">共 ${total} 条</span></div>`; 
    return; 
  }

  let html = `<div class="el-pagination is-background">`;
  
  // 1. 总条数
  html += `<span class="el-pagination__total">共 ${total} 条</span>`;

  // 2. 上一页
  const prevDisabled = page <= 1 ? 'disabled' : '';
  html += `<button type="button" class="btn-prev" ${prevDisabled} onclick="judgeGoPage(${page - 1})" title="上一页"><i class="ri-arrow-left-s-line"></i></button>`;

  // 3. 页码列表 Pager
  html += `<ul class="el-pager">`;
  
  // 生成页码数字逻辑 (类似 Element Plus: 始终保留首页和尾页，中间显示前后几页)
  let startP = Math.max(1, page - 2);
  let endP = Math.min(totalPages, page + 2);

  if (startP > 1) {
    html += `<li class="number ${page === 1 ? 'is-active' : ''}" onclick="judgeGoPage(1)">1</li>`;
    if (startP > 2) html += `<li class="more el-icon-more" onclick="judgeGoPage(${Math.max(1, page - 5)})">···</li>`;
  }

  for (let p = startP; p <= endP; p++) {
    html += `<li class="number ${p === page ? 'is-active' : ''}" onclick="judgeGoPage(${p})">${p}</li>`;
  }

  if (endP < totalPages) {
    if (endP < totalPages - 1) html += `<li class="more el-icon-more" onclick="judgeGoPage(${Math.min(totalPages, page + 5)})">···</li>`;
    html += `<li class="number ${page === totalPages ? 'is-active' : ''}" onclick="judgeGoPage(${totalPages})">${totalPages}</li>`;
  }

  html += `</ul>`;

  // 4. 下一页
  const nextDisabled = page >= totalPages ? 'disabled' : '';
  html += `<button type="button" class="btn-next" ${nextDisabled} onclick="judgeGoPage(${page + 1})" title="下一页"><i class="ri-arrow-right-s-line"></i></button>`;

  // 5. 前往指定页 Jumper
  html += `
    <span class="el-pagination__jump">
      前往
      <input type="number" class="el-pagination__editor" min="1" max="${totalPages}" value="${page}" onkeydown="if(event.key==='Enter') judgeGoPage(Math.min(${totalPages},Math.max(1,parseInt(this.value)||1)))" onblur="if(parseInt(this.value)!==${page}) judgeGoPage(Math.min(${totalPages},Math.max(1,parseInt(this.value)||1)))" />
      页
    </span>
  `;

  html += `</div>`;
  container.innerHTML = html;
}

/**
 * 跳转到指定页
 */
function judgeGoPage(p) {
  if (p < 1) return;
  _judgePage = p;
  loadJudgeRecords();
  document.getElementById('tab-alpha-judge')?.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 删除一条记录
 */
async function deleteJudgeRecord(id) {
  if (!confirm('确定删除这条判断记录吗？')) return;
  try {
    const resp = await authFetch(`/api/prediction/record/${id}`, { method: 'DELETE' });
    const data = await resp.json();
    if (data.code === 200) {
      showToast('已删除', 'success');
      loadJudgeRecords();
      loadJudgeStats();
    }
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

/**
 * AI 一键复盘：对所有未结算记录批量执行对账复盘
 */
async function triggerBatchReview() {
  const filterDateEl = document.getElementById('judgeFilterDate');
  let reviewDate = filterDateEl?.value || 'all';

  showToast('⏳ 正在并发拉取最新行情并执行 AI 复盘对账，请稍候...', 'info');

  try {
    const resp = await authFetch('/api/prediction/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record_date: reviewDate, use_ai: true }),
    });
    const data = await resp.json();
    if (data.code === 200) {
      if (data.reviewed === 0) {
        showToast('暂无待复盘的记录', 'info');
      } else {
        const correctCnt = (data.results || []).filter(r => r.is_correct).length;
        showToast(`✅ 复盘对账完成！共结算 ${data.reviewed} 条记录，方向准确 ${correctCnt} 条！`, 'success');
      }
      loadJudgeRecords();
      loadJudgeStats();
      checkPendingReviews();
    } else {
      showToast(data.detail || '复盘失败', 'error');
    }
  } catch (e) {
    showToast('复盘失败: ' + e.message, 'error');
  }
}

/**
 * 筛选出"待复盘"状态的记录（点击统计看板触发）
 */
function judgeFilterPending() {
  const el = document.getElementById('judgeFilterReviewed');
  if (el) { el.value = 'no'; loadJudgeRecords(); }
}


// ==========================================
// 【每日实战量化作战计划 (Daily Action Plan)】
// ==========================================
let _currentDailyPlanData = null;

/**
 * 打开每日作战计划弹窗
 */
function openDailyPlanModal() {
  const modal = document.getElementById('dailyPlanModal');
  if (modal) {
    modal.style.display = 'flex';
    loadDailyPlanData(false);
  }
}

/**
 * 关闭每日作战计划弹窗
 */
function closeDailyPlanModal() {
  const modal = document.getElementById('dailyPlanModal');
  if (modal) modal.style.display = 'none';
}

/**
 * 从后端加载每日作战计划数据
 */
async function loadDailyPlanData(forceRefresh = false) {
  const container = document.getElementById('dailyPlanContainer');
  if (!container) return;

  if (forceRefresh || !_currentDailyPlanData) {
    container.innerHTML = `
      <div style="text-align:center;padding:50px 0;color:#64748b">
        <i class="ri-loader-4-line ri-spin" style="font-size:32px;color:#2563eb"></i>
        <div style="margin-top:12px;font-size:13.5px;font-weight:500">正在实时拉取行情并执行 4 层量化漏斗与 1% 风险测算...</div>
      </div>
    `;
  }

  try {
    const resp = await authFetch('/api/alpha/daily_plan');
    const data = await resp.json();
    if (data.code === 200) {
      _currentDailyPlanData = data;
      renderDailyPlan(data);
    } else {
      container.innerHTML = `<div class="alert alert-danger" style="padding:16px;background:#fef2f2;border:1px solid #fee2e2;border-radius:8px;color:#b91c1c">❌ 获取作战计划失败: ${data.detail || data.message || '未知错误'}</div>`;
    }
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger" style="padding:16px;background:#fef2f2;border:1px solid #fee2e2;border-radius:8px;color:#b91c1c">❌ 网络异常: ${err.message}</div>`;
  }
}

/**
 * 渲染每日作战计划 4 大全景模块
 */
function renderDailyPlan(data) {
  const container = document.getElementById('dailyPlanContainer');
  if (!container) return;

  const acc = data.account_summary || {};
  const tactics = data.daily_tactics || {};
  const positions = data.positions || [];
  const passed = data.passed_candidates || [];
  const eliminated = data.eliminated_candidates || [];

  // 1. 顶部资产与战术总览卡片
  let html = `
    <!-- 顶部资产与战术总览条 -->
    <div style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
          <div>
            <span style="font-size:11px;color:#64748b;display:block">账户总资产基准</span>
            <span style="font-size:16px;font-weight:700;color:#0f172a">¥${(acc.total_capital || 1000000).toLocaleString()}</span>
          </div>
          <div style="border-left:1px solid #cbd5e1;padding-left:16px">
            <span style="font-size:11px;color:#64748b;display:block">1% 账户单笔风险限额</span>
            <span style="font-size:16px;font-weight:700;color:#2563eb">¥${(acc.max_single_risk || 10000).toLocaleString()}</span>
          </div>
          <div style="border-left:1px solid #cbd5e1;padding-left:16px">
            <span style="font-size:11px;color:#64748b;display:block">当前持仓标的</span>
            <span style="font-size:16px;font-weight:700;color:#0f172a">${acc.position_count || positions.length} 只</span>
          </div>
          <div style="border-left:1px solid #cbd5e1;padding-left:16px">
            <span style="font-size:11px;color:#64748b;display:block">4层漏斗通关入选</span>
            <span style="font-size:16px;font-weight:700;color:#16a34a">${acc.passed_count || passed.length} 只标的</span>
          </div>
          <div style="border-left:1px solid #cbd5e1;padding-left:16px">
            <span style="font-size:11px;color:#64748b;display:block">漏斗淘汰标的</span>
            <span style="font-size:16px;font-weight:700;color:#dc2626">${acc.eliminated_count || eliminated.length} 只</span>
          </div>
        </div>
        <div style="text-align:right">
          <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#e0f2fe;color:#0369a1;border-radius:4px;font-size:11.5px;font-weight:600">
            <i class="ri-time-line"></i> 生成时间: ${data.generated_at || '实时'}
          </span>
        </div>
      </div>
    </div>
  `;

  // 2. 模块 1: 💼 我的持仓与持股应对策略
  html += `
    <div style="margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h4 style="margin:0;font-size:15px;color:#0f172a;display:flex;align-items:center;gap:6px;font-weight:700">
          <i class="ri-briefcase-4-line" style="color:#2563eb;font-size:18px"></i>
          <span>一、 我的持仓与持股应对策略 (Portfolio Action Plan)</span>
        </h4>
        <span style="font-size:12px;color:#64748b">共持有 ${positions.length} 只标的 · 动态风控盯盘中</span>
      </div>

      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600">
              <th style="padding:10px 14px">持仓标的</th>
              <th style="padding:10px 12px">持股数 / 市值</th>
              <th style="padding:10px 12px">持仓成本</th>
              <th style="padding:10px 12px">当前最新价</th>
              <th style="padding:10px 12px">浮动盈亏 (金额 / 比例)</th>
              <th style="padding:10px 12px">防守止损线 / 目标位</th>
              <th style="padding:10px 14px">💡 今日实战应对预案</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (positions.length === 0) {
    html += `<tr><td colspan="7" style="padding:20px;text-align:center;color:#94a3b8">暂无持仓标的记录</td></tr>`;
  } else {
    positions.forEach(p => {
      const isProfit = (p.profit_pct || 0) >= 0;
      const profitColor = isProfit ? '#16a34a' : '#dc2626';
      const profitSign = isProfit ? '+' : '';
      html += `
        <tr style="border-bottom:1px solid #f1f5f9;transition:background 0.15s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
          <td style="padding:12px 14px">
            <div style="font-weight:700;color:#0f172a">${p.name || p.symbol}</div>
            <div style="font-size:11px;color:#64748b;font-family:monospace">${p.symbol}</div>
          </td>
          <td style="padding:12px 12px">
            <div style="font-weight:600;color:#0f172a">${(p.shares || 0).toLocaleString()} 股</div>
            <div style="font-size:11px;color:#64748b">¥${((p.current_price || 0) * (p.shares || 0)).toLocaleString()}</div>
          </td>
          <td style="padding:12px 12px;font-family:monospace;font-weight:500;color:#475569">
            ¥${(p.cost_price || 0).toFixed(2)}
          </td>
          <td style="padding:12px 12px;font-family:monospace;font-weight:700;color:#0f172a">
            ¥${(p.current_price || 0).toFixed(2)}
          </td>
          <td style="padding:12px 12px">
            <div style="font-weight:700;color:${profitColor};font-family:monospace">
              ${profitSign}${p.profit_pct || 0}%
            </div>
            <div style="font-size:11px;color:${profitColor}">
              ${profitSign}¥${(p.profit_amount || 0).toLocaleString()}
            </div>
          </td>
          <td style="padding:12px 12px;font-size:11.5px">
            <div style="color:#dc2626">止损: ¥${(p.stop_loss_price || 0).toFixed(2)}</div>
            <div style="color:#16a34a">目标: ¥${(p.target_price || 0).toFixed(2)}</div>
          </td>
          <td style="padding:12px 14px">
            <div style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;margin-bottom:3px;${isProfit ? 'background:#dcfce7;color:#15803d' : 'background:#fee2e2;color:#b91c1c'}">
              ${p.action_advice || '既定持有'}
            </div>
            <div style="font-size:11.5px;color:#475569;line-height:1.4">
              ${p.tactical_rule || '严格遵守均线生命线与止损纪律'}
            </div>
          </td>
        </tr>
      `;
    });
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  // 3. 模块 2: 🎯 你的筛选 · 4 层漏斗通关入选标的 & 华尔街 1% 盈亏比执行卡片
  html += `
    <div style="margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h4 style="margin:0;font-size:15px;color:#0f172a;display:flex;align-items:center;gap:6px;font-weight:700">
          <i class="ri-checkbox-circle-line" style="color:#16a34a;font-size:18px"></i>
          <span>二、 你的筛选 · 4 层漏斗通关入选标的 & 华尔街 1% 盈亏比执行模型</span>
        </h4>
        <span style="font-size:12px;color:#16a34a;font-weight:600">全市场精选 ${passed.length} 只标的 (满足 4 层漏斗且盈亏比 ≥ 2.0:1)</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px">
  `;

  if (passed.length === 0) {
    html += `<div style="grid-column:1/-1;padding:24px;text-align:center;color:#94a3b8;background:#f8fafc;border-radius:8px">今日未扫描到完全满足 4 层漏斗与 1% 盈亏比的激进标的，建议保持轻仓防守</div>`;
  } else {
    passed.forEach(c => {
      const chgColor = (c.change_pct || 0) >= 0 ? '#16a34a' : '#dc2626';
      const chgSign = (c.change_pct || 0) >= 0 ? '+' : '';
      const tags = (c.triggered_rules || []).map(t => `<span style="display:inline-block;padding:1px 6px;background:#e0f2fe;color:#0284c7;border-radius:4px;font-size:11px;font-weight:600">${t}</span>`).join(' ');

      html += `
        <div style="border:1px solid #cbd5e1;border-radius:10px;padding:16px 18px;background:#ffffff;box-shadow:0 4px 6px -1px rgba(0,0,0,0.04);position:relative">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;border-bottom:1px solid #f1f5f9;padding-bottom:10px">
            <div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:16px;font-weight:700;color:#0f172a">${c.name}</span>
                <span style="font-size:12px;color:#64748b;font-family:monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px">${c.symbol}</span>
                <span style="display:inline-block;padding:1px 6px;background:#dcfce7;color:#15803d;border-radius:4px;font-size:11px;font-weight:600">🎯 计划执行</span>
              </div>
              <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${tags}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:700;color:#0f172a;font-family:monospace">¥${(c.current_price || 0).toFixed(2)}</div>
              <div style="font-size:12px;font-weight:600;color:${chgColor};font-family:monospace">${chgSign}${c.change_pct || 0}%</div>
            </div>
          </div>

          <!-- 6 宫格华尔街 1% 盈亏比执行数据看板 -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#f8fafc;border-radius:8px;padding:10px 12px;margin-bottom:12px">
            <div>
              <span style="font-size:11px;color:#64748b;display:block">建议建仓区间</span>
              <span style="font-size:12.5px;font-weight:700;color:#0f172a;font-family:monospace">¥${(c.buy_price_low||c.current_price*0.99).toFixed(2)} ~ ¥${(c.buy_price_high||c.current_price*1.01).toFixed(2)}</span>
            </div>
            <div>
              <span style="font-size:11px;color:#dc2626;display:block">铁律止损价 (点位)</span>
              <span style="font-size:12.5px;font-weight:700;color:#dc2626;font-family:monospace">¥${(c.stop_loss_price||0).toFixed(2)} (${c.stop_loss_pct||'-3.5'}%)</span>
            </div>
            <div>
              <span style="font-size:11px;color:#16a34a;display:block">第一目标止盈价</span>
              <span style="font-size:12.5px;font-weight:700;color:#16a34a;font-family:monospace">¥${(c.target_price_1||0).toFixed(2)} (+${c.target_profit_pct_1||'5.0'}%)</span>
            </div>
            <div>
              <span style="font-size:11px;color:#2563eb;display:block">华尔街期望盈亏比</span>
              <span style="font-size:12.5px;font-weight:700;color:#2563eb;font-family:monospace">${c.risk_reward_ratio || '1:2.5'}</span>
            </div>
            <div>
              <span style="font-size:11px;color:#64748b;display:block">建议建仓股数</span>
              <span style="font-size:12.5px;font-weight:700;color:#0f172a;font-family:monospace">${(c.recommended_shares||1000).toLocaleString()} 股</span>
            </div>
            <div>
              <span style="font-size:11px;color:#64748b;display:block">1% 风险敞口金额</span>
              <span style="font-size:12.5px;font-weight:700;color:#0f172a;font-family:monospace">¥${(c.risk_amount||9000).toLocaleString()}</span>
            </div>
          </div>

          <!-- 入选逻辑解构 -->
          <div style="font-size:12px;color:#475569;line-height:1.5;background:#ffffff;border:1px dashed #e2e8f0;border-radius:6px;padding:8px 10px">
            <strong style="color:#0f172a">📊 入选核心战术理由：</strong>${c.reason || '多头排列发散，放量突破前期压力位，量价共振良好。'}
          </div>
        </div>
      `;
    });
  }

  html += `
      </div>
    </div>
  `;

  // 4. 模块 3: 🚫 筛选机制淘汰/剩下的股票档案 (详细列出淘汰阶段、失败指标与量化归因)
  html += `
    <div style="margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h4 style="margin:0;font-size:15px;color:#0f172a;display:flex;align-items:center;gap:6px;font-weight:700">
          <i class="ri-close-circle-line" style="color:#dc2626;font-size:18px"></i>
          <span>三、 筛选机制淘汰/剩下的股票归因档案 (4 层漏斗为何未入选)</span>
        </h4>
        <span style="font-size:12px;color:#dc2626;font-weight:600">观察池共淘汰 ${eliminated.length} 只标的 · 严格执行排雷与顺势纪律</span>
      </div>

      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left">
          <thead>
            <tr style="background:#fff1f2;border-bottom:1px solid #fecdd3;color:#9f1239;font-weight:600">
              <th style="padding:10px 14px;width:150px">标的代码 / 名称</th>
              <th style="padding:10px 12px;width:90px">当前现价</th>
              <th style="padding:10px 14px;width:170px">淘汰判定阶段</th>
              <th style="padding:10px 14px;width:160px">未达标量化指标</th>
              <th style="padding:10px 16px">🚫 深度淘汰归因剖析 (为什么坚决不能选)</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (eliminated.length === 0) {
    html += `<tr><td colspan="5" style="padding:20px;text-align:center;color:#94a3b8">观察池所有标的全部通过筛选</td></tr>`;
  } else {
    eliminated.forEach(el => {
      const chgColor = (el.change_pct || 0) >= 0 ? '#16a34a' : '#dc2626';
      const chgSign = (el.change_pct || 0) >= 0 ? '+' : '';
      html += `
        <tr style="border-bottom:1px solid #f1f5f9;transition:background 0.15s" onmouseover="this.style.background='#fff5f5'" onmouseout="this.style.background='transparent'">
          <td style="padding:12px 14px">
            <div style="font-weight:700;color:#0f172a">${el.name}</div>
            <div style="font-size:11px;color:#64748b;font-family:monospace">${el.symbol}</div>
          </td>
          <td style="padding:12px 12px">
            <div style="font-weight:700;color:#0f172a;font-family:monospace">¥${(el.current_price || 0).toFixed(2)}</div>
            <div style="font-size:11px;color:${chgColor};font-family:monospace">${chgSign}${el.change_pct || 0}%</div>
          </td>
          <td style="padding:12px 14px">
            <span style="display:inline-block;padding:2px 7px;background:#fee2e2;color:#b91c1c;border-radius:4px;font-size:11px;font-weight:600">
              ${el.eliminated_stage || '漏斗过滤'}
            </span>
          </td>
          <td style="padding:12px 14px;color:#b91c1c;font-weight:600">
            <i class="ri-error-warning-line" style="font-size:13px;vertical-align:middle"></i>
            <span>${el.failed_rule || '指标未达标'}</span>
          </td>
          <td style="padding:12px 16px;color:#475569;line-height:1.45;font-size:12px">
            ${el.eliminated_reason || '量价形态不符合标准。'}
          </td>
        </tr>
      `;
    });
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  // 5. 模块 4: ⚔️ 今日量化作战战略与纪律戒律
  html += `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px">
      <h4 style="margin:0 0 10px 0;font-size:14px;color:#0f172a;display:flex;align-items:center;gap:6px;font-weight:700">
        <i class="ri-sword-line" style="color:#2563eb;font-size:16px"></i>
        <span>四、 今日量化作战战略与纪律风控戒律</span>
      </h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;font-size:12px;color:#475569">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px">
          <strong style="color:#0f172a;display:block;margin-bottom:4px">🎯 战略总基调：</strong>
          ${tactics.macro_tone || '防守反击 · 聚焦主升浪共振标的'}
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px">
          <strong style="color:#0f172a;display:block;margin-bottom:4px">🛡️ 仓位总限额：</strong>
          ${tactics.position_limit || '总仓位建议控制在 60% 以内，单一标的建仓上限不超过 25%'}
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px">
          <strong style="color:#dc2626;display:block;margin-bottom:4px">⚡ 华尔街核心戒律：</strong>
          ${tactics.core_discipline || '严格执行 1% 账户单笔风险铁律，触及止损无条件离场，达第一目标价减仓 50% 并将止损上移至成本线保本。'}
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * 一键将 4 层漏斗入选标的批量同步录入预测日记
 */
async function batchAddPlanToPredictions() {
  if (!_currentDailyPlanData || !_currentDailyPlanData.passed_candidates || _currentDailyPlanData.passed_candidates.length === 0) {
    showToast('⚠️ 当前无通关入选标的或作战计划尚未加载', 'warning');
    return;
  }

  const btn = document.getElementById('btnBatchAddPlan');
  const oldText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> 正在批量同步入库...`;
  }

  const today = new Date().toISOString().slice(0, 10);
  let successCount = 0;

  for (const c of _currentDailyPlanData.passed_candidates) {
    const payload = {
      record_date: today,
      stock_code: c.symbol,
      stock_name: c.name,
      direction: 'buy',
      entry_price: parseFloat(c.current_price) || 0,
      target_price: parseFloat(c.target_price_1) || 0,
      shares: parseInt(c.recommended_shares) || 1000,
      confidence: 5,
      reason: c.reason || '每日实战量化作战计划 4 层漏斗通关入选',
      tags: (c.triggered_rules || ['尾盘选股', '均线多头']).join(','),
    };

    try {
      const resp = await authFetch('/api/prediction/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await resp.json();
      if (res.code === 200) successCount++;
    } catch (e) {
      console.warn(`同步 ${c.symbol} 异常:`, e);
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }

  showToast(`✅ 成功将 ${successCount} 只入选标的同步录入今日预测日记！`, 'success');
  if (typeof loadJudgeRecords === 'function') loadJudgeRecords();
  if (typeof loadJudgeStats === 'function') loadJudgeStats();
}

// 导出到全局
window.openDailyPlanModal = openDailyPlanModal;
window.closeDailyPlanModal = closeDailyPlanModal;
window.loadDailyPlanData = loadDailyPlanData;
window.batchAddPlanToPredictions = batchAddPlanToPredictions;

// 显式导出全局调用接口，保障所有 HTML 内联事件 100% 正常调用
window.loadJudgeRecords = loadJudgeRecords;
window.loadJudgeStats = loadJudgeStats;
window.openJudgeModal = openJudgeModal;
window.closeJudgeModal = closeJudgeModal;
window.openDailyPlanModal = openDailyPlanModal;
window.closeDailyPlanModal = closeDailyPlanModal;
window.triggerBatchReview = triggerBatchReview;
window.judgeFilterCorrect = judgeFilterCorrect;
window.judgeFilterPending = judgeFilterPending;
window.batchAddPlanToPredictions = batchAddPlanToPredictions;
