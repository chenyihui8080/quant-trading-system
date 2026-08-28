/* ==================== 📈 系统三：量化投研与策略回测引擎 ==================== */
function switchTab(name, el) {
  if (typeof window.switchQuantTab === 'function') {
    window.switchQuantTab(name, el);
  } else {
    document.querySelectorAll('#quantSubTabs .tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    document.querySelectorAll('#sysSectionQuant .tab-content').forEach(c => {
      c.classList.remove('active');
      c.classList.remove('hidden');
      c.style.display = 'none';
    });
    const target = document.getElementById('tab-' + name);
    if (target) {
      target.classList.add('active');
      target.classList.remove('hidden');
      target.style.display = 'block';
    }
  }
}


// ==================== 回测 ====================
function selectStrategy(key, el) {
  document.querySelectorAll('.strategy-item').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  selectedStrategy = key;
}

async function runBacktest() {
  if (!selectedStrategy) { showToast('请先选择一个策略', 'error'); return; }
  const btn = document.getElementById('runBtn');
  const result = document.getElementById('resultArea');
  btn.disabled = true; btn.textContent = '回测中...';
  result.innerHTML = '<div class="loading"><span class="spinner"></span>正在运行回测...</div>';

  const symbol = document.getElementById('symbolSelect').value || null;
  const capital = parseInt(document.getElementById('capital').value) || 1000000;
  const days = parseInt(document.getElementById('days').value) || 500;
  const interval = document.getElementById('interval').value || null;

  if (interval && !symbol) { showToast('分钟级回测需要选择股票', 'error'); btn.disabled = false; btn.textContent = '开始回测'; return; }

  // 读取本地保存的风控配置
  let risk = null;
  const savedRisk = localStorage.getItem('risk_config');
  if (savedRisk) {
    try {
      const c = JSON.parse(savedRisk);
      risk = {
        stop_loss_pct: c.stop_loss_pct,
        take_profit_pct: c.take_profit_pct,
        trailing_stop_pct: c.trailing_stop_pct,
        max_drawdown_pct: c.max_drawdown_pct,
        position_size: c.position_size,
      };
    } catch(e) {}
  }

  try {
    const res = await authFetch('/backtest-detail', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ strategy: selectedStrategy, symbol, capital, days, risk, interval }),
    });
    const data = await res.json();
    if (res.ok) { renderResult(data); showToast('回测完成', 'success'); }
    else { result.innerHTML = `<div style="color:#f85149">${data.detail || '回测失败'}</div>`; }
  } catch (e) { result.innerHTML = `<div style="color:#f85149">请求失败: ${e.message}</div>`; }

  btn.disabled = false; btn.textContent = '开始回测';
}

async function runBacktestWithParams(strategy, params) {
  if (!strategy) { showToast('未指定策略', 'error'); return; }
  const result = document.getElementById('resultArea');
  result.innerHTML = '<div class="loading"><span class="spinner"></span>正在用优化参数运行回测...</div>';

  const symbol = document.getElementById('symbolSelect').value || null;
  const capital = parseInt(document.getElementById('capital').value) || 1000000;
  const days = parseInt(document.getElementById('days').value) || 500;

  try {
    const res = await authFetch('/backtest-detail', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ strategy, symbol, capital, days, params }),
    });
    const data = await res.json();
    if (res.ok) { renderResult(data); showToast(`优化参数回测完成`, 'success'); }
    else { result.innerHTML = `<div style="color:#f85149">${data.detail || '回测失败'}</div>`; }
  } catch (e) { result.innerHTML = `<div style="color:#f85149">请求失败: ${e.message}</div>`; }
}

function renderResult(data) {
  const s = data.stats;
  if (!s || Object.keys(s).length === 0) {
    document.getElementById('resultArea').innerHTML = '<div style="color:#8b949e">无交易记录</div>';
    return;
  }
  const pnl = s.total_net_pnl, ret = s.total_return;
  const pnlC = pnl >= 0 ? 'positive' : 'negative', retC = ret >= 0 ? 'positive' : 'negative';
  document.getElementById('resultArea').innerHTML = `
    <div style="margin-bottom:12px;font-size:13px;color:#8b949e">
      策略: <b style="color:#e6edf3">${data.strategy}</b> &nbsp;|&nbsp;
      数据: <b style="color:#e6edf3">${data.symbol}</b>（${data.data_count}条） &nbsp;|&nbsp;
      周期: ${s.start_date} ~ ${s.end_date}
    </div>
    <div class="stats-grid">
      ${statCard('总收益', ret.toFixed(2) + '%', retC)}
      ${statCard('总盈亏', '¥' + fmtN(pnl), pnlC)}
      ${statCard('最终资金', '¥' + fmtN(s.end_balance), 'neutral')}
      ${statCard('年化收益', s.annual_return.toFixed(2) + '%', s.annual_return >= 0 ? 'positive' : 'negative')}
      ${statCard('夏普比率', s.sharpe_ratio.toFixed(2), s.sharpe_ratio >= 1 ? 'positive' : s.sharpe_ratio >= 0 ? 'neutral' : 'negative')}
      ${statCard('最大回撤', s.max_ddpercent.toFixed(2) + '%', 'negative')}
      ${statCard('回撤天数', s.max_drawdown_duration + '天', 'neutral')}
      ${statCard('交易次数', s.total_trade_count, 'neutral')}
      ${statCard('盈利天数', s.profit_days, 'positive')}
      ${statCard('亏损天数', s.loss_days, 'negative')}
      ${statCard('日均盈亏', '¥' + s.daily_net_pnl.toFixed(2), s.daily_net_pnl >= 0 ? 'positive' : 'negative')}
      ${statCard('手续费', '¥' + s.total_commission.toFixed(2), 'neutral')}
    </div>
    <button class="btn btn-sm" style="margin-bottom:12px" onclick="exportReport()">📥 导出报告</button>
    <div class="chart-box"><h3>资金曲线</h3><div id="equityChart" style="height:300px"></div></div>
    <div class="chart-box" style="margin-top:12px"><h3>K线图 + 买卖点</h3><div id="klineChart" style="height:400px"></div></div>
  `;

  // 渲染图表
  setTimeout(() => {
    if (data.daily && data.daily.length > 0) renderEquityChart(data.daily);
    if (data.kline && data.kline.length > 0) renderKlineChart(data.kline, data.trades || []);
  }, 100);
}

// ==================== 报告导出 ====================
async function exportReport() {
  if (!selectedStrategy) { showToast('请先运行回测', 'error'); return; }
  const symbol = document.getElementById('symbolSelect').value || null;
  const capital = parseInt(document.getElementById('capital').value) || 1000000;
  const days = parseInt(document.getElementById('days').value) || 500;
  showToast('正在生成报告...', 'success');
  try {
    const res = await authFetch('/export-report', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ strategy: selectedStrategy, symbol, capital, days }),
    });
    const data = await res.json();
    if (res.ok) {
      const blob = new Blob([data.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `回测报告_${data.strategy}_${data.symbol}_${new Date().toISOString().slice(0,10)}.html`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('报告已下载', 'success');
    } else { showToast(data.detail || '导出失败', 'error'); }
  } catch (e) { showToast('导出失败: ' + e.message, 'error'); }
}

// ==================== 策略对比 ====================
async function runCompare() {
  const btn = document.getElementById('compareBtn');
  const area = document.getElementById('compareArea');
  btn.disabled = true; btn.textContent = '对比中...';
  area.innerHTML = '<div class="loading"><span class="spinner"></span>正在运行所有策略...</div>';

  const symbol = document.getElementById('compareSymbol').value || null;
  const days = parseInt(document.getElementById('compareDays').value) || 500;

  try {
    const res = await authFetch('/compare', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ symbol, days }),
    });
    const data = await res.json();
    if (res.ok) { renderCompare(data.results); showToast('对比完成', 'success'); }
    else { area.innerHTML = `<div style="color:#f85149">${data.detail || '对比失败'}</div>`; }
  } catch (e) { area.innerHTML = `<div style="color:#f85149">请求失败: ${e.message}</div>`; }

  btn.disabled = false; btn.textContent = '运行对比';
}

function renderCompare(results) {
  if (!results || results.length === 0) {
    document.getElementById('compareArea').innerHTML = '<div style="color:#8b949e">无对比数据</div>';
    return;
  }

  // 找最优/最差
  const bestReturn = Math.max(...results.map(r => r.stats?.total_return || -Infinity));
  const bestSharpe = Math.max(...results.map(r => r.stats?.sharpe_ratio || -Infinity));
  const bestDD = Math.max(...results.map(r => r.stats?.max_ddpercent || -Infinity)); // 回撤是负数，最大=最小绝对值

  let rows = '';
  results.forEach(r => {
    const s = r.stats || {};
    const ret = s.total_return || 0, sharpe = s.sharpe_ratio || 0, dd = s.max_ddpercent || 0;
    const retCls = ret === bestReturn ? 'best' : (ret < 0 ? 'worst' : '');
    const sharpeCls = sharpe === bestSharpe ? 'best' : (sharpe < 0 ? 'worst' : '');
    const ddCls = dd === bestDD ? 'best' : '';

    rows += `<tr>
      <td style="font-weight:600;color:#e6edf3">${r.name}</td>
      <td class="${retCls}">${ret.toFixed(2)}%</td>
      <td class="${sharpeCls}">${sharpe.toFixed(2)}</td>
      <td class="${ddCls}">${dd.toFixed(2)}%</td>
      <td>${fmtN(s.end_balance || 0)}</td>
      <td>${s.total_trade_count || 0}</td>
      <td>${(s.annual_return || 0).toFixed(2)}%</td>
    </tr>`;
  });

  document.getElementById('compareArea').innerHTML = `
    <div style="overflow-x:auto">
      <table class="compare-table">
        <thead><tr>
          <th>策略</th><th>总收益</th><th>夏普比率</th><th>最大回撤</th><th>最终资金</th><th>交易次数</th><th>年化收益</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:12px;font-size:12px;color:#8b949e">
      <span style="color:#3fb950">绿色</span> = 最优 &nbsp;|&nbsp; <span style="color:#f85149">红色</span> = 最差
    </div>`;
}

// ==================== 参数优化 ====================
async function runOptimize() {
  const btn = document.getElementById('optimizeBtn');
  const area = document.getElementById('optimizeArea');
  btn.disabled = true; btn.textContent = '优化中...';
  area.innerHTML = '<div class="loading"><span class="spinner"></span>正在搜索最优参数（可能需要较长时间）...</div>';

  const strategy = document.getElementById('optimizeStrategy').value;
  const symbol = document.getElementById('optimizeSymbol').value || null;
  const days = parseInt(document.getElementById('optimizeDays').value) || 500;
  window._optimizeStrategy = strategy;

  try {
    const res = await authFetch('/optimize', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ strategy, symbol, days }),
    });
    const data = await res.json();
    if (res.ok) { renderOptimize(data); showToast(`优化完成，共${data.total_combos}种组合`, 'success'); }
    else { area.innerHTML = `<div style="color:#f85149">${data.detail || '优化失败'}</div>`; }
  } catch (e) { area.innerHTML = `<div style="color:#f85149">请求失败: ${e.message}</div>`; }

  btn.disabled = false; btn.textContent = '开始优化';
}

function renderOptimize(data) {
  const results = data.results;
  if (!results || results.length === 0) {
    document.getElementById('optimizeArea').innerHTML = '<div style="color:#8b949e">无优化结果</div>';
    return;
  }

  let rows = '';
  results.forEach((r, i) => {
    const rank = i + 1;
    const cls = rank <= 3 ? `rank-${rank}` : '';
    const s = r.stats || {};
    const paramsStr = Object.entries(r.params || {}).map(([k,v]) => `${k}=${v}`).join(', ');
    rows += `<tr class="${cls}">
      <td style="font-weight:700;color:${rank===1?'#3fb950':rank<=3?'#58a6ff':'#e6edf3'}">#${rank}</td>
      <td style="font-size:12px;font-family:monospace">${paramsStr}</td>
      <td style="color:${(s.total_return||0)>=0?'#3fb950':'#f85149'}">${(s.total_return||0).toFixed(2)}%</td>
      <td>${(s.sharpe_ratio||0).toFixed(2)}</td>
      <td style="color:#f85149">${(s.max_ddpercent||0).toFixed(2)}%</td>
      <td>${s.total_trade_count||0}</td>
    </tr>`;
  });

  let html = `
    <div style="margin-bottom:8px;font-size:13px;color:#8b949e">
      策略: <b style="color:#e6edf3">${data.strategy}</b> &nbsp;|&nbsp;
      共测试 <b style="color:#e6edf3">${data.total_combos}</b> 种参数组合
    </div>`;

  // 热力图
  if (data.heatmap) {
    html += `<div style="margin-bottom:12px">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn btn-sm" onclick="_renderHeatmap('sharpe')" id="hmSharpe" style="background:#238636">夏普比率</button>
        <button class="btn btn-sm" onclick="_renderHeatmap('return')" id="hmReturn" style="background:#21262d">总收益</button>
      </div>
      <div id="heatmapChart" style="height:400px"></div>
    </div>`;
  }

  html += `<div style="overflow-x:auto">
    <table class="optimize-table">
      <thead><tr>
        <th>排名</th><th>参数</th><th>总收益</th><th>夏普比率</th><th>最大回撤</th><th>交易次数</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  document.getElementById('optimizeArea').innerHTML = html;

  // 渲染热力图
  if (data.heatmap) {
    window._heatmapData = data.heatmap;
    _renderHeatmap('sharpe');
  }
}

function _renderHeatmap(metric) {
  const hm = window._heatmapData;
  if (!hm) return;
  const isSharpe = metric === 'sharpe';
  const rawData = isSharpe ? hm.sharpe : hm.return;
  const title = isSharpe ? '夏普比率' : '总收益 (%)';

  document.getElementById('hmSharpe').style.background = isSharpe ? '#238636' : '#21262d';
  document.getElementById('hmReturn').style.background = isSharpe ? '#21262d' : '#238636';

  const vals = rawData.map(d => d[2]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);

  const el = document.getElementById('heatmapChart');
  const chart = getChart(el);
  _chartInstances['heatmap'] = chart;

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      formatter: p => `${hm.x_key}=${hm.x_vals[p.value[0]]}<br>${hm.y_key}=${hm.y_vals[p.value[1]]}<br>${title}: <b>${p.value[2]}</b>`,
    },
    grid: { left: 80, right: 40, top: 40, bottom: 60 },
    xAxis: { type: 'category', data: hm.x_vals, name: hm.x_key, nameTextStyle: { color: '#8b949e' }, axisLabel: { color: '#484f58' } },
    yAxis: { type: 'category', data: hm.y_vals, name: hm.y_key, nameTextStyle: { color: '#8b949e' }, axisLabel: { color: '#484f58' } },
    visualMap: {
      min, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: ['#f85149', '#30363d', '#3fb950'] },
      textStyle: { color: '#8b949e' },
    },
    series: [{
      type: 'heatmap', data: rawData,
      label: { show: true, color: '#e6edf3', fontSize: 11, formatter: p => p.value[2] },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
    }],
  });

  // 点击热力图格子 → 跳转回测页并用该参数运行
  chart.off('click');
  chart.on('click', function(params) {
    const xVal = hm.x_vals[params.value[0]];
    const yVal = hm.y_vals[params.value[1]];
    const strategy = window._optimizeStrategy || '';
    // 存储待运行参数
    window._pendingOptimizeRun = { strategy, params: { [hm.x_key]: Number(xVal), [hm.y_key]: Number(yVal) } };
    showToast(`参数 ${hm.x_key}=${xVal}, ${hm.y_key}=${yVal}，正在跳转回测...`, 'success');
    // 切换到回测 tab 并自动运行
    const tab = document.querySelector(".tab");
    switchTab('backtest', document.querySelectorAll('.tab')[0]);
    // 选择对应策略
    setTimeout(() => {
      const items = document.querySelectorAll('.strategy-item');
      items.forEach(el => {
        if (el.dataset.key === strategy) { el.click(); }
      });
      // 通过 API 运行回测
      if (window._pendingOptimizeRun) {
        const pr = window._pendingOptimizeRun;
        window._pendingOptimizeRun = null;
        runBacktestWithParams(pr.strategy, pr.params);
      }
    }, 300);
  });
}

// ==================== 组合回测 ====================
async function runPortfolio() {
  const btn = document.getElementById('portfolioBtn');
  const area = document.getElementById('portfolioArea');
  btn.disabled = true; btn.textContent = '回测中...';
  area.innerHTML = '<div class="loading"><span class="spinner"></span>正在运行组合回测...</div>';

  const strategies = Array.from(document.querySelectorAll('#portfolioStrategies input:checked')).map(c => c.value);
  const symbols = document.getElementById('portfolioSymbols').value.split(/[,，\s]+/).filter(s => s.trim());
  const capital = parseInt(document.getElementById('portfolioCapital').value) || 1000000;

  if (strategies.length === 0) { area.innerHTML = '<div style="color:#f85149">请至少选择一个策略</div>'; btn.disabled = false; btn.textContent = '运行组合回测'; return; }
  if (symbols.length === 0) { area.innerHTML = '<div style="color:#f85149">请至少输入一只股票</div>'; btn.disabled = false; btn.textContent = '运行组合回测'; return; }

  try {
    const res = await authFetch('/portfolio', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ strategies, symbols, capital }),
    });
    const data = await res.json();
    if (res.ok) { renderPortfolio(data); showToast(`组合回测完成，共${data.total_combos}个组合`, 'success'); }
    else { area.innerHTML = `<div style="color:#f85149">${data.detail || '回测失败'}</div>`; }
  } catch (e) { area.innerHTML = `<div style="color:#f85149">请求失败: ${e.message}</div>`; }

  btn.disabled = false; btn.textContent = '运行组合回测';
}

function renderPortfolio(data) {
  const area = document.getElementById('portfolioArea');
  const items = data.items || [];

  // 表格
  let rows = '';
  items.forEach(r => {
    if (r.error) {
      rows += `<tr><td>${r.strategy_name || r.strategy}</td><td>${r.symbol}</td><td colspan="5" style="color:#f85149">${r.error}</td></tr>`;
      return;
    }
    const s = r.stats || {};
    rows += `<tr>
      <td>${r.strategy_name || r.strategy}</td>
      <td>${r.symbol}</td>
      <td style="color:${(s.total_return||0)>=0?'#3fb950':'#f85149'}">${(s.total_return||0).toFixed(2)}%</td>
      <td>${(s.sharpe_ratio||0).toFixed(2)}</td>
      <td style="color:#f85149">${(s.max_ddpercent||0).toFixed(2)}%</td>
      <td>${(s.win_rate||0).toFixed(1)}%</td>
      <td>${s.total_trade_count||0}</td>
    </tr>`;
  });

  let html = `
    <div style="margin-bottom:12px;font-size:13px;color:#8b949e">
      共 <b style="color:#e6edf3">${data.total_combos}</b> 个策略×股票组合
    </div>
    <div style="overflow-x:auto;margin-bottom:16px">
      <table class="optimize-table">
        <thead><tr>
          <th>策略</th><th>股票</th><th>收益</th><th>Sharpe</th><th>最大回撤</th><th>胜率</th><th>交易数</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // 组合收益曲线
  if (data.portfolio && data.portfolio.length > 0) {
    html += `<div id="portfolioChart" style="height:350px"></div>`;
  }

  area.innerHTML = html;

  // 渲染组合曲线
  if (data.portfolio && data.portfolio.length > 0) {
    const el = document.getElementById('portfolioChart');
    const chart = getChart(el);
    _chartInstances['portfolio'] = chart;
    const dates = data.portfolio.map(d => d.date);
    const balances = data.portfolio.map(d => d.balance);
    const returns = data.portfolio.map(d => d.return_pct);

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { data: ['组合净值', '收益率%'], textStyle: { color: '#8b949e' }, top: 0 },
      grid: { left: 60, right: 60, top: 40, bottom: 60 },
      dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 10, height: 20, borderColor: '#30363d' }],
      xAxis: { type: 'category', data: dates, axisLabel: { color: '#484f58', fontSize: 10 } },
      yAxis: [
        { type: 'value', name: '净值', axisLabel: { color: '#484f58', formatter: v => (v/10000).toFixed(0)+'万' }, splitLine: { lineStyle: { color: '#21262d' } } },
        { type: 'value', name: '收益率%', axisLabel: { color: '#484f58', formatter: v => v+'%' }, splitLine: { show: false } },
      ],
      series: [
        { name: '组合净值', type: 'line', data: balances, smooth: true, lineStyle: { color: '#58a6ff', width: 2 }, showSymbol: false,
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#58a6ff33' }, { offset: 1, color: '#58a6ff05' }] } } },
        { name: '收益率%', type: 'line', data: returns, smooth: true, yAxisIndex: 1, lineStyle: { color: '#ffa657', width: 1, type: 'dashed' }, showSymbol: false },
      ],
    });
  }
}

// ==================== 风控配置 ====================
function saveRiskConfig() {
  const config = {
    stop_loss_pct: parseFloat(document.getElementById('riskStopLoss').value),
    take_profit_pct: parseFloat(document.getElementById('riskTakeProfit').value),
    trailing_stop_pct: parseFloat(document.getElementById('riskTrailingStop').value),
    max_drawdown_pct: parseFloat(document.getElementById('riskMaxDrawdown').value),
    position_size: parseInt(document.getElementById('riskPositionSize').value),
    capital: parseInt(document.getElementById('riskCapital').value),
  };
  localStorage.setItem('risk_config', JSON.stringify(config));
  document.getElementById('riskSaveMsg').textContent = '已保存到本地，回测时自动应用';
  setTimeout(() => { document.getElementById('riskSaveMsg').textContent = ''; }, 3000);
  showToast('风控配置已保存', 'success');
}

// 启动时加载已保存的风控配置
function loadRiskConfig() {
  const saved = localStorage.getItem('risk_config');
  if (!saved) return;
  try {
    const c = JSON.parse(saved);
    if (c.stop_loss_pct != null) document.getElementById('riskStopLoss').value = c.stop_loss_pct;
    if (c.take_profit_pct != null) document.getElementById('riskTakeProfit').value = c.take_profit_pct;
    if (c.trailing_stop_pct != null) document.getElementById('riskTrailingStop').value = c.trailing_stop_pct;
    if (c.max_drawdown_pct != null) document.getElementById('riskMaxDrawdown').value = c.max_drawdown_pct;
    if (c.position_size != null) document.getElementById('riskPositionSize').value = c.position_size;
    if (c.capital != null) document.getElementById('riskCapital').value = c.capital;
  } catch(e) {}
}

// ==================== 推送通知配置 ====================
async function saveNotifyConfig() {
  const cfg = {
    feishu_webhook: document.getElementById('cfgFeishuWebhook').value.trim(),
    feishu_secret: document.getElementById('cfgFeishuSecret').value.trim(),
    serverchan_key: document.getElementById('cfgServerchan').value.trim(),
    dingtalk_url: document.getElementById('cfgDingtalk').value.trim(),
    wechat_url: document.getElementById('cfgWechat').value.trim(),
    smtp_host: document.getElementById('cfgSmtpHost').value.trim(),
    smtp_port: 465,
    smtp_user: document.getElementById('cfgSmtpUser').value.trim(),
    smtp_pass: document.getElementById('cfgSmtpPass').value.trim(),
    email_to: document.getElementById('cfgEmailTo').value.trim(),
  };
  try {
    const resp = await authFetch('/notify-config', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(cfg),
    });
    const data = await resp.json();
    if (resp.ok) {
      localStorage.setItem('notify_config', JSON.stringify(cfg));
      const channels = data.channels || {};
      const enabled = Object.entries(channels).filter(([,v]) => v).map(([k]) => k);
      document.getElementById('notifySaveMsg').textContent = enabled.length > 0
        ? '已启用: ' + enabled.join(', ')
        : '已保存（未启用任何渠道）';
      showToast('推送配置已保存', 'success');
    } else {
      showToast(data.detail || '保存失败', 'error');
    }
  } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
}

async function testNotify() {
  try {
    const resp = await authFetch('/notify/test', { method: 'POST' });
    const data = await resp.json();
    const channels = Object.entries(data).filter(([,v]) => typeof v === 'boolean');
    const success = channels.filter(([,v]) => v).map(([k]) => k);
    const failed = channels.filter(([,v]) => !v).map(([k]) => k);
    let msg = '';
    if (success.length) msg += '成功: ' + success.join(', ');
    if (failed.length) msg += (msg ? ' | ' : '') + '失败: ' + failed.join(', ');
    if (!channels.length) msg = '未配置任何推送渠道';
    document.getElementById('notifySaveMsg').textContent = msg;
    showToast(success.length ? '测试消息已发送' : '发送失败', success.length ? 'success' : 'error');
  } catch(e) { showToast('测试失败: ' + e.message, 'error'); }
}

function loadNotifyConfig() {
  const saved = localStorage.getItem('notify_config');
  if (!saved) return;
  try {
    const c = JSON.parse(saved);
    if (c.feishu_webhook) document.getElementById('cfgFeishuWebhook').value = c.feishu_webhook;
    if (c.feishu_secret) document.getElementById('cfgFeishuSecret').value = c.feishu_secret;
    if (c.serverchan_key) document.getElementById('cfgServerchan').value = c.serverchan_key;
    if (c.dingtalk_url) document.getElementById('cfgDingtalk').value = c.dingtalk_url;
    if (c.wechat_url) document.getElementById('cfgWechat').value = c.wechat_url;
    if (c.smtp_host) document.getElementById('cfgSmtpHost').value = c.smtp_host;
    if (c.smtp_user) document.getElementById('cfgSmtpUser').value = c.smtp_user;
    if (c.smtp_pass) document.getElementById('cfgSmtpPass').value = c.smtp_pass;
    if (c.email_to) document.getElementById('cfgEmailTo').value = c.email_to;
  } catch(e) {}
}

// ==================== 工具函数 ====================
function statCard(label, value, cls) {
  return `<div class="stat-card"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
}
function fmtN(n) { return Number(n).toLocaleString('zh-CN', {maximumFractionDigits: 0}); }

// ==================== ECharts 图表 ====================

// 图表实例缓存，避免重复初始化和 resize 监听器泄漏
const _chartInstances = {};
function getChart(el) {
  return echarts.getInstanceByDom(el) || echarts.init(el, 'dark');
}
// 全局统一 resize（替代每个图表单独监听）
window.addEventListener('resize', () => {
  Object.values(_chartInstances).forEach(c => { try { c.resize(); } catch(e){} });
});

// 共享 MA 计算
function calcMA(data, n) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < n - 1) { result.push('-'); continue; }
    let sum = 0;
    for (let j = 0; j < n; j++) sum += data[i - j][1];
    result.push((sum / n).toFixed(2));
  }
  return result;
}

function renderEquityChart(daily) {
  const el = document.getElementById('equityChart');
  if (!el) return;
  const chart = getChart(el);
  _chartInstances['equity'] = chart;
  const dates = daily.map(d => d.date);
  const balances = daily.map(d => d.balance);
  const pnls = daily.map(d => d.net_pnl);

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: { data: ['资金', '日盈亏'], textStyle: { color: '#8b949e' }, top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 60 },
    dataZoom: [{ type: 'inside', start: 80, end: 100 }, { type: 'slider', bottom: 10, height: 20, borderColor: '#30363d', textStyle: { color: '#484f58' } }],
    xAxis: { type: 'category', data: dates, axisLabel: { color: '#484f58', fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '资金', axisLabel: { color: '#484f58', formatter: v => (v/10000).toFixed(0)+'万' }, splitLine: { lineStyle: { color: '#21262d' } } },
      { type: 'value', name: '日盈亏', axisLabel: { color: '#484f58' }, splitLine: { show: false } },
    ],
    series: [
      { name: '资金', type: 'line', data: balances, smooth: true, lineStyle: { color: '#58a6ff', width: 2 }, itemStyle: { color: '#58a6ff' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#58a6ff33' }, { offset: 1, color: '#58a6ff05' }] } }, showSymbol: false },
      { name: '日盈亏', type: 'bar', yAxisIndex: 1, data: pnls, itemStyle: { color: p => p.value >= 0 ? '#3fb950' : '#f85149' }, barMaxWidth: 4 },
    ],
  });
}

// ==================== 通用 K 线图 Tooltip 格式化（纯中文） ====================
function _klineTooltipFormatter(params) {
  if (!params || !params.length) return '';
  let html = `<div style="font-size:12px;line-height:1.7;min-width:170px;">`;
  html += `<div style="font-weight:600;margin-bottom:6px;color:#e6edf3;border-bottom:1px solid #30363d;padding-bottom:3px">${params[0].axisValue}</div>`;

  const candleParam = params.find(p => p.seriesType === 'candlestick');
  if (candleParam) {
    const d = Array.isArray(candleParam.data)
      ? (candleParam.data.length >= 5 ? candleParam.data.slice(1) : candleParam.data)
      : (candleParam.value ? candleParam.value.slice(1) : []);
    const open = Number(d[0]);
    const close = Number(d[1]);
    const lowest = Number(d[2]);
    const highest = Number(d[3]);
    const isUp = close >= open;
    const color = isUp ? '#f85149' : '#3fb950';
    const change = close - open;
    const changePct = open > 0 ? (change / open * 100).toFixed(2) : '0.00';

    html += `<div style="margin-bottom:4px"><span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background-color:${color};"></span><b style="color:${color}">K线 (${isUp ? '+' : ''}${changePct}%)</b></div>`;
    html += `<div style="display:flex;justify-content:space-between;padding-left:14px;color:#8b949e"><span>开盘</span><b style="color:#e6edf3">${open.toFixed(2)}</b></div>`;
    html += `<div style="display:flex;justify-content:space-between;padding-left:14px;color:#8b949e"><span>收盘</span><b style="color:${color}">${close.toFixed(2)}</b></div>`;
    html += `<div style="display:flex;justify-content:space-between;padding-left:14px;color:#8b949e"><span>最低</span><b style="color:#e6edf3">${lowest.toFixed(2)}</b></div>`;
    html += `<div style="display:flex;justify-content:space-between;padding-left:14px;color:#8b949e"><span>最高</span><b style="color:#e6edf3">${highest.toFixed(2)}</b></div>`;
  }

  params.filter(p => p.seriesType !== 'candlestick').forEach(p => {
    let valStr = '-';
    if (p.seriesType === 'line') {
      const val = typeof p.value === 'number' ? p.value : (Array.isArray(p.value) ? p.value[1] : p.value);
      valStr = typeof val === 'number' ? val.toFixed(2) : (val || '-');
    } else if (p.seriesType === 'bar') {
      const val = typeof p.value === 'object' && p.value !== null ? p.value.value : p.value;
      valStr = typeof val === 'number' ? (val >= 10000 ? (val / 10000).toFixed(2) + ' 万' : val.toLocaleString()) : (val || '-');
    }
    html += `<div style="display:flex;justify-content:space-between;color:#8b949e;margin-top:2px">
      <span><span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background-color:${p.color};"></span>${p.seriesName}</span>
      <b style="color:#e6edf3">${valStr}</b>
    </div>`;
  });

  html += `</div>`;
  return html;
}

function renderKlineChart(kline, trades) {
  const el = document.getElementById('klineChart');
  if (!el) return;
  const chart = getChart(el);
  _chartInstances['kline'] = chart;

  const dates = kline.map(k => k[0]);
  const ohlc = kline.map(k => [k[1], k[2], k[3], k[4]]);
  const volumes = kline.map(k => ({
    value: k[5] || 0,
    itemStyle: { color: k[2] >= k[1] ? '#3fb95088' : '#f8514988' },
  }));

  const ma5 = calcMA(kline, 5);
  const ma10 = calcMA(kline, 10);
  const ma20 = calcMA(kline, 20);

  // 买卖点标记
  const buyPoints = [], sellPoints = [];
  trades.forEach(t => {
    const date = t.datetime.split(' ')[0];
    const idx = dates.indexOf(date);
    if (idx < 0) return;
    if (t.offset === '开' || t.direction === '多') {
      buyPoints.push({ name: 'B', coord: [date, kline[idx][3] * 1.01], value: t.price.toFixed(2),
        symbol: 'arrow', symbolSize: 14, symbolRotate: 0, itemStyle: { color: '#3fb950' },
        label: { show: true, formatter: 'B', color: '#3fb950', fontSize: 10, position: 'top' } });
    } else {
      sellPoints.push({ name: 'S', coord: [date, kline[idx][4] * 0.99], value: t.price.toFixed(2),
        symbol: 'arrow', symbolSize: 14, symbolRotate: 180, itemStyle: { color: '#f85149' },
        label: { show: true, formatter: 'S', color: '#f85149', fontSize: 10, position: 'bottom' } });
    }
  });

  // 计算信号区间（持仓背景色）
  const markAreas = [];
  let openDate = null;
  trades.forEach(t => {
    const date = t.datetime.split(' ')[0];
    if (t.offset === '开' || t.direction === '多') {
      openDate = date;
    } else if (openDate) {
      markAreas.push([
        { xAxis: openDate, itemStyle: { color: 'rgba(63,185,80,0.06)' } },
        { xAxis: date },
      ]);
      openDate = null;
    }
  });

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#8b949e', width: 1, type: 'dashed' } },
      backgroundColor: '#21262d',
      borderColor: '#30363d',
      textStyle: { color: '#d1d4dc', fontSize: 12 },
      formatter: _klineTooltipFormatter,
    },
    legend: { data: ['K线', 'MA5', 'MA10', 'MA20'], textStyle: { color: '#8b949e' }, top: 0 },
    grid: [
      { left: 60, right: 20, top: 40, bottom: '28%' },
      { left: 60, right: 20, top: '76%', bottom: 40 },
    ],
    xAxis: [
      { type: 'category', data: dates, axisLabel: { color: '#484f58', fontSize: 10 }, boundaryGap: true, gridIndex: 0 },
      { type: 'category', data: dates, axisLabel: { show: false }, gridIndex: 1 },
    ],
    yAxis: [
      { type: 'value', scale: true, axisLabel: { color: '#484f58' }, splitLine: { lineStyle: { color: '#21262d' } }, gridIndex: 0 },
      { type: 'value', scale: true, axisLabel: { show: false }, splitLine: { show: false }, gridIndex: 1 },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 80, end: 100 },
      { type: 'slider', bottom: 10, height: 20, borderColor: '#30363d', textStyle: { color: '#484f58' }, xAxisIndex: [0, 1] },
    ],
    series: [
      { name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: '#f85149', color0: '#3fb950', borderColor: '#f85149', borderColor0: '#3fb950' },
        markPoint: { data: [...buyPoints, ...sellPoints] },
        markArea: { data: markAreas, silent: true } },
      { name: 'MA5', type: 'line', data: ma5, smooth: true, lineStyle: { color: '#ffa657', width: 1 }, showSymbol: false, xAxisIndex: 0, yAxisIndex: 0 },
      { name: 'MA10', type: 'line', data: ma10, smooth: true, lineStyle: { color: '#58a6ff', width: 1 }, showSymbol: false, xAxisIndex: 0, yAxisIndex: 0 },
      { name: 'MA20', type: 'line', data: ma20, smooth: true, lineStyle: { color: '#bc8cff', width: 1 }, showSymbol: false, xAxisIndex: 0, yAxisIndex: 0 },
      { name: '成交量', type: 'bar', data: volumes, xAxisIndex: 1, yAxisIndex: 1 },
    ],
  });
}

// ==================== 实时行情 ====================
let _liveSearchTimer = null;
let _liveSelectedCode = '';

function onLiveSymbolSelect(val) {
  if (!val) return;
  _liveSelectedCode = val;
  const sel = document.getElementById('liveSymbol');
  const opt = sel ? sel.options[sel.selectedIndex] : null;
  const input = document.getElementById('liveSearchInput');
  if (input && opt) {
    input.value = opt.textContent.split('（')[0].trim();
  }
  loadLiveKline();
}

async function loadLiveKline(targetSymbol = '') {
  const input = document.getElementById('liveSearchInput');
  const sel = document.getElementById('liveSymbol');
  let symbol = targetSymbol || _liveSelectedCode || (input ? input.value.trim() : '') || (sel ? sel.value : '');
  const range = parseInt(document.getElementById('liveRange')?.value || '250');

  if (!symbol) {
    showToast('请输入或选择要查看的股票', 'error');
    return;
  }

  const btn = document.getElementById('liveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '加载中...'; }

  try {
    // 若输入的是名称或未下载代码，先尝试直接获取；若404则先自动下载再展示
    let res = await authFetch(`/realtime-kline/${encodeURIComponent(symbol)}?period=d&count=${range || 250}`);
    if (!res.ok) {
      // 自动调用 /stocks/add 解析并下载
      showToast(`正在从全市场关联拉取 ${symbol} 数据...`, 'success');
      const addRes = await authFetch('/stocks/add', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({symbols: [symbol]}),
      });
      const addData = await addRes.json();
      if (addData.results && addData.results[0]?.status === 'ok') {
        symbol = addData.results[0].symbol;
        _liveSelectedCode = symbol;
        const name = addData.results[0].name || symbol;
        if (input) input.value = `${name} ${symbol}`;
        // 同步更新下拉框
        if (sel) {
          const exists = Array.from(sel.options).some(o => o.value === symbol);
          if (!exists) {
            const opt = document.createElement('option');
            opt.value = symbol;
            opt.textContent = `${name} ${symbol}`;
            sel.appendChild(opt);
          }
          sel.value = symbol;
        }
        res = await authFetch(`/realtime-kline/${encodeURIComponent(symbol)}?period=d&count=${range || 250}`);
      } else {
        showToast(`未找到标的「${symbol}」: ${addData.results?.[0]?.msg || '请检查输入'}`, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '查看行情'; }
        return;
      }
    }

    const data = await res.json();
    if (!res.ok || !data.kline) {
      showToast(data.detail || '行情数据加载失败', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '查看行情'; }
      return;
    }

    // 获取实时行情报价
    let quote = null;
    try {
      const qr = await authFetch(`/realtime/${encodeURIComponent(symbol)}`);
      if (qr.ok) quote = await qr.json();
    } catch(e) {}

    const kline = data.kline || [];
    const quoteName = quote?.name || symbol;
    const quotePrice = quote?.price != null ? `¥${quote.price.toFixed(2)}` : (kline.length ? `¥${kline[kline.length-1][2]}` : '');
    const changePct = quote?.change_pct != null ? quote.change_pct : 0;
    const isUp = changePct >= 0;

    const quoteInfo = `<div style="margin-bottom:10px;padding:8px 12px;background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:8px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:14px">
      <b style="color:#e6edf3;font-size:16px">${quoteName} <span style="color:#8b949e;font-size:13px;font-weight:normal">${symbol}</span></b>
      <span style="color:${isUp?'#3fb950':'#f85149'};font-size:20px;font-weight:800">${quotePrice}</span>
      <span style="color:${isUp?'#3fb950':'#f85149'};font-weight:700">${isUp?'+':''}${changePct.toFixed(2)}%</span>
      <span style="color:#8b949e;font-size:12px;margin-left:auto">
        ${quote ? `开: ${quote.open?.toFixed(2)} &nbsp; 高: ${quote.high?.toFixed(2)} &nbsp; 低: ${quote.low?.toFixed(2)} &nbsp; 更新: ${quote.updated}` : `历史数据共 ${kline.length} 条`}
      </span>
    </div>`;

    renderLiveKline(kline, [], symbol, kline.length, quoteInfo);
    showToast(`${quoteName} 行情加载完成`, 'success');
  } catch(e) {
    showToast('请求失败: ' + e.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = '查看行情'; }
}

function renderLiveKline(kline, trades, symbol, total, quoteInfo) {
  const el = document.getElementById('liveKlineChart');
  el.innerHTML = (quoteInfo || '') + '<div id="liveChartInner" style="height:500px"></div>';
  const chart = echarts.init(document.getElementById('liveChartInner'), 'dark');
  _chartInstances['live'] = chart;

  const dates = kline.map(k => k[0]);
  const ohlc = kline.map(k => [k[1], k[2], k[3], k[4]]);
  const volumes = kline.map(k => k[5]);

  const ma5 = calcMA(kline, 5);
  const ma10 = calcMA(kline, 10);
  const ma20 = calcMA(kline, 20);

  const buyPoints = [], sellPoints = [];
  trades.forEach(t => {
    const date = t.datetime.split(' ')[0];
    const idx = dates.indexOf(date);
    if (idx < 0) return;
    if (t.offset === '开' || t.direction === '多') {
      buyPoints.push({ coord: [date, kline[idx][4] * 0.98], value: t.price.toFixed(2),
        symbol: 'triangle', symbolSize: 14, symbolRotate: 0, itemStyle: { color: '#3fb950' },
        label: { show: true, formatter: 'B', color: '#3fb950', fontSize: 10, position: 'bottom' } });
    } else {
      sellPoints.push({ coord: [date, kline[idx][3] * 1.02], value: t.price.toFixed(2),
        symbol: 'triangle', symbolSize: 14, symbolRotate: 180, itemStyle: { color: '#f85149' },
        label: { show: true, formatter: 'S', color: '#f85149', fontSize: 10, position: 'top' } });
    }
  });

  // 默认显示最近 60 根 K 线
  const startPct = kline.length > 60 ? Math.round((1 - 60 / kline.length) * 100) : 0;

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#8b949e', width: 1, type: 'dashed' } },
      backgroundColor: '#21262d',
      borderColor: '#30363d',
      textStyle: { color: '#d1d4dc', fontSize: 12 },
      formatter: _klineTooltipFormatter,
    },
    legend: { data: ['K线', 'MA5', 'MA10', 'MA20', '成交量'], textStyle: { color: '#8b949e' }, top: 0 },
    grid: [
      { left: 60, right: 20, top: 40, bottom: '25%' },
      { left: 60, right: 20, top: '78%', bottom: 40 },
    ],
    xAxis: [
      { type: 'category', data: dates, axisLabel: { color: '#484f58', fontSize: 10 }, boundaryGap: true, gridIndex: 0 },
      { type: 'category', data: dates, axisLabel: { show: false }, gridIndex: 1 },
    ],
    yAxis: [
      { type: 'value', scale: true, axisLabel: { color: '#484f58' }, splitLine: { lineStyle: { color: '#21262d' } }, gridIndex: 0 },
      { type: 'value', scale: true, axisLabel: { color: '#484f58', formatter: v => (v/10000).toFixed(0)+'万' }, splitLine: { show: false }, gridIndex: 1 },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: startPct, end: 100 },
      { type: 'slider', bottom: 10, height: 25, borderColor: '#30363d', textStyle: { color: '#484f58' }, xAxisIndex: [0, 1] },
    ],
    series: [
      { name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: '#f85149', color0: '#3fb950', borderColor: '#f85149', borderColor0: '#3fb950' },
        markPoint: { data: [...buyPoints, ...sellPoints] } },
      { name: 'MA5', type: 'line', data: ma5, smooth: true, lineStyle: { color: '#ffa657', width: 1 }, showSymbol: false, xAxisIndex: 0, yAxisIndex: 0 },
      { name: 'MA10', type: 'line', data: ma10, smooth: true, lineStyle: { color: '#58a6ff', width: 1 }, showSymbol: false, xAxisIndex: 0, yAxisIndex: 0 },
      { name: 'MA20', type: 'line', data: ma20, smooth: true, lineStyle: { color: '#bc8cff', width: 1 }, showSymbol: false, xAxisIndex: 0, yAxisIndex: 0 },
      { name: '成交量', type: 'bar', data: volumes.map((v, i) => ({
          value: v,
          itemStyle: { color: kline[i][2] >= kline[i][1] ? '#3fb95088' : '#f8514988' }
        })), xAxisIndex: 1, yAxisIndex: 1 },
    ],
  });
}

// ==================== 通用股票搜索绑定 ====================
let _searchAbort = null;

function bindStockSearch(inputId, dropdownId, marketId, onSelect, limit = 10) {
  let timer = null;
  const input = document.getElementById(inputId);
  const dd = document.getElementById(dropdownId);
  if (!input || !dd) return;

  input.addEventListener('input', e => {
    const q = e.target.value.trim();
    clearTimeout(timer);
    if (q.length < 1) { dd.style.display = 'none'; return; }
    timer = setTimeout(async () => {
      if (_searchAbort) _searchAbort.abort();
      _searchAbort = new AbortController();
      const market = marketId ? document.getElementById(marketId)?.value : '';
      const url = `/stocks/search?q=${encodeURIComponent(q)}&limit=${limit}` + (market ? `&market=${market}` : '');
      try {
        const resp = await authFetch(url, { signal: _searchAbort.signal });
        const data = await resp.json();
        const items = data.results || [];
        if (items.length === 0) { dd.style.display = 'none'; return; }
        dd.innerHTML = items.map(s =>
          `<div style="padding:6px 10px;cursor:pointer;border-bottom:1px solid #21262d;font-size:13px"
            onmouseover="this.style.background='#21262d'" onmouseout="this.style.background='transparent'"
            onclick="(${onSelect})('${s.code}','${s.name.replace(/'/g, "\\'")}')">
            <b style="color:#e6edf3">${s.name}</b> <span style="color:#8b949e">${s.code}</span>
          </div>`
        ).join('');
        dd.style.display = 'block';
      } catch(e) { if (e.name !== 'AbortError') dd.style.display = 'none'; }
    }, 200);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${dropdownId}`))
      dd.style.display = 'none';
  });
}

// ==================== 实时行情页搜索联想绑定 ====================
document.getElementById('liveSearchInput')?.addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(_liveSearchTimer);
  const dd = document.getElementById('liveSearchDropdown');
  if (q.length < 1) { if (dd) dd.style.display = 'none'; return; }
  _liveSearchTimer = setTimeout(() => searchLiveStocks(q), 250);
});

document.getElementById('liveSearchInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const dd = document.getElementById('liveSearchDropdown');
    if (dd) dd.style.display = 'none';
    loadLiveKline();
  }
});

async function searchLiveStocks(q) {
  const dd = document.getElementById('liveSearchDropdown');
  if (!dd) return;
  const market = document.getElementById('liveMarketFilter')?.value || '';
  try {
    const resp = await authFetch(`/stocks/search?q=${encodeURIComponent(q)}&limit=25` + (market ? `&market=${market}` : ''));
    const data = await resp.json();
    const items = (data.results || []).slice(0, 20);
    if (items.length === 0) { dd.style.display = 'none'; return; }
    const marketTag = {a: 'A股', sh: '沪A', sz: '深A', hk: '港股', us: '美股'};
    dd.innerHTML = items.map(s => {
      const tag = marketTag[s.market] || s.market || '';
      return `<div style="padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #21262d"
        onmouseover="this.style.background='#21262d'" onmouseout="this.style.background='transparent'"
        onclick="selectLiveStock('${s.code}','${s.name.replace(/'/g, "\\'")}')">
        <span><b style="color:#e6edf3">${s.name}</b> <span style="color:#8b949e;margin-left:6px">${s.code}</span></span>
        <span style="color:${tag.includes('A') ? '#3fb950' : tag === '港股' ? '#f0883e' : '#58a6ff'};font-size:11px">${tag}</span>
      </div>`;
    }).join('');
    dd.style.display = 'block';
  } catch(e) { dd.style.display = 'none'; }
}

function selectLiveStock(code, name) {
  const input = document.getElementById('liveSearchInput');
  const dd = document.getElementById('liveSearchDropdown');
  if (input) input.value = `${name} ${code}`;
  if (dd) dd.style.display = 'none';
  _liveSelectedCode = code;
  loadLiveKline(code);
}

document.addEventListener('click', e => {
  if (!e.target.closest('#liveSearchInput') && !e.target.closest('#liveSearchDropdown')) {
    const dd = document.getElementById('liveSearchDropdown');
    if (dd) dd.style.display = 'none';
  }
});

// ==================== 回测页快速搜索 ====================
let _quickTimer = null;

document.getElementById('quickSearch')?.addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(_quickTimer);
  if (q.length < 1) { document.getElementById('quickDropdown').style.display = 'none'; return; }
  _quickTimer = setTimeout(() => quickSearchStocks(q), 300);
});

document.getElementById('quickSearch')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('quickDropdown').style.display = 'none';
});

async function quickSearchStocks(q) {
  const dropdown = document.getElementById('quickDropdown');
  const market = document.getElementById('quickMarket').value;
  try {
    const resp = await authFetch(`/stocks/search?q=${encodeURIComponent(q)}&limit=30` + (market ? `&market=${market}` : ''));
    const data = await resp.json();
    const items = (data.results || []).slice(0, 25);
    if (items.length === 0) { dropdown.style.display = 'none'; return; }
    const marketTag = {a: 'A', hk: '港股', us: '美股'};
    dropdown.innerHTML = items.map(s => {
      const tag = marketTag[s.market] || '';
      return `<div style="padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;border-bottom:1px solid #21262d"
        onmouseover="this.style.background='#21262d'" onmouseout="this.style.background='transparent'"
        onclick="quickAddStock('${s.code}','${s.name.replace(/'/g, "\\'")}')">
        <span><b style="color:#e6edf3">${s.name}</b> <span style="color:#8b949e">${s.code}</span></span>
        <span style="color:${tag === 'A' ? '#3fb950' : tag === '港股' ? '#f0883e' : '#58a6ff'};font-size:11px">${tag}</span>
      </div>`;
    }).join('');
    dropdown.style.display = 'block';
  } catch(e) { dropdown.style.display = 'none'; }
}

async function quickAddStock(code, name) {
  document.getElementById('quickDropdown').style.display = 'none';
  document.getElementById('quickSearch').value = '';
  // 检查是否已存在
  const sel = document.getElementById('symbolSelect');
  if (Array.from(sel.options).some(o => o.value === code)) {
    sel.value = code;
    showToast(`已选择 ${name} ${code}`, 'success');
    return;
  }
  // 下载并添加
  showToast(`正在下载 ${name}...`, 'success');
  try {
    const resp = await authFetch('/stocks/add', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({symbols: [code]}),
    });
    const data = await resp.json();
    if (data.results && data.results[0]?.status === 'ok') {
      const r = data.results[0];
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${name} ${code}（${r.rows}条）`;
      sel.appendChild(opt);
      sel.value = code;
      showToast(`${name} 添加成功`, 'success');
    } else {
      showToast(`添加失败: ${data.results?.[0]?.msg || '未知错误'}`, 'error');
    }
  } catch(e) { showToast('网络错误', 'error'); }
}

document.addEventListener('click', e => {
  if (!e.target.closest('#quickSearch') && !e.target.closest('#quickDropdown')) {
    document.getElementById('quickDropdown').style.display = 'none';
  }
});

// ==================== 股票搜索联想 ====================
const _selectedStocks = new Map(); // code -> name
let _searchTimer = null;

function renderSelectedStocks() {
  const el = document.getElementById('selectedStocks');
  if (_selectedStocks.size === 0) { el.innerHTML = ''; return; }
  el.innerHTML = Array.from(_selectedStocks.entries()).map(([code, name]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:#1f6feb22;border:1px solid #1f6feb55;border-radius:6px;padding:2px 8px;font-size:12px;color:#58a6ff;cursor:pointer" onclick="removeStock('${code}')">${name} ${code} ×</span>`
  ).join('');
}

function removeStock(code) {
  _selectedStocks.delete(code);
  renderSelectedStocks();
}

document.getElementById('addStockInput')?.addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(_searchTimer);
  if (q.length < 1) { document.getElementById('searchDropdown').style.display = 'none'; return; }
  _searchTimer = setTimeout(() => searchStocks(q), 250);
});

document.getElementById('addStockInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('searchDropdown').style.display = 'none';
    addStocks();
  }
});

async function searchStocks(q) {
  const dropdown = document.getElementById('searchDropdown');
  try {
    const resp = await authFetch(`/stocks/search?q=${encodeURIComponent(q)}`);
    const data = await resp.json();
    const items = (data.results || []).slice(0, 20);
    if (items.length === 0) { dropdown.style.display = 'none'; return; }
    const marketTag = {a: 'A股', sh: '沪A', sz: '深A', hk: '港股', us: '美股'};
    dropdown.innerHTML = items.map(s => {
      const selected = _selectedStocks.has(s.code);
      const tag = marketTag[s.market] || s.market || '';
      return `<div style="padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #21262d;${selected ? 'opacity:0.4' : ''}"
        onmouseover="this.style.background='#21262d'" onmouseout="this.style.background='transparent'"
        onclick="selectStock('${s.code}','${s.name.replace(/'/g, "\\'")}')">
        <span><b style="color:#e6edf3">${s.name}</b> <span style="color:#8b949e;margin-left:6px">${s.code}</span></span>
        <span style="color:${tag.includes('A') ? '#3fb950' : tag === '港股' ? '#f0883e' : '#58a6ff'};font-size:11px">${tag}</span>
      </div>`;
    }).join('');
    dropdown.style.display = 'block';
  } catch(e) { dropdown.style.display = 'none'; }
}

function selectStock(code, name) {
  if (_selectedStocks.has(code)) return;
  _selectedStocks.set(code, name);
  renderSelectedStocks();
  document.getElementById('addStockInput').value = '';
  document.getElementById('searchDropdown').style.display = 'none';
}

// 点击外部关闭下拉
document.addEventListener('click', e => {
  if (!e.target.closest('#addStockInput') && !e.target.closest('#searchDropdown')) {
    document.getElementById('searchDropdown').style.display = 'none';
  }
});

// ==================== 股票管理 ====================
async function addStocks() {
  // 如果有选中的股票，用选中的；否则从输入框解析（支持名称、拼音或代码）
  let symbols = [];
  if (_selectedStocks.size > 0) {
    symbols = Array.from(_selectedStocks.keys());
  } else {
    const input = document.getElementById('addStockInput').value.trim();
    if (!input) { showToast('请输入股票名称或代码搜索添加', 'error'); return; }
    symbols = input.split(/[,，\s\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  }
  if (symbols.length === 0) { showToast('请输入股票名称或代码', 'error'); return; }

  const btn = document.getElementById('addStockBtn');
  const msg = document.getElementById('addStockMsg');
  btn.disabled = true; btn.textContent = '下载中...';
  msg.innerHTML = `<span style="color:#58a6ff">正在搜索并下载 ${symbols.join(', ')} 数据，请稍候...</span>`;

  try {
    const res = await authFetch('/stocks/add', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbols}),
    });
    const data = await res.json();
    if (res.ok) {
      let html = '<div style="font-size:13px;margin-top:8px">';
      let lastAddedCode = '';
      data.results.forEach(r => {
        if (r.status === 'ok') {
          html += `<div style="color:#3fb950">✓ ${r.name || ''} (${r.symbol}) 下载成功 (${r.rows}条，${r.start}~${r.end})</div>`;
          lastAddedCode = r.symbol;
        } else {
          html += `<div style="color:#f85149">✗ ${r.name || r.symbol} 失败: ${r.msg}</div>`;
        }
      });
      html += `<div style="margin-top:8px;color:#8b949e">当前本地库共 ${data.total_stocks} 只标的</div></div>`;
      msg.innerHTML = html;

      // 刷新所有下拉框
      const selects = ['symbolSelect', 'compareSymbol', 'optimizeSymbol', 'liveSymbol'];
      selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        data.results.forEach(r => {
          if (r.status !== 'ok') return;
          const exists = Array.from(sel.options).some(o => o.value === r.symbol);
          if (!exists) {
            const opt = document.createElement('option');
            opt.value = r.symbol;
            const name = r.name || r.symbol;
            opt.textContent = `${name} ${r.symbol}（${r.rows}条）`;
            sel.appendChild(opt);
          }
          if (lastAddedCode && id === 'liveSymbol') {
            sel.value = lastAddedCode;
          }
        });
      });
      showToast(`标的下载添加完成，正在展示行情...`, 'success');
      document.getElementById('addStockInput').value = '';
      _selectedStocks.clear();
      renderSelectedStocks();

      // 自动加载并展示刚添加股票的 K 线
      if (lastAddedCode) {
        const liveSel = document.getElementById('liveSymbol');
        if (liveSel) {
          liveSel.value = lastAddedCode;
          loadLiveKline();
        }
      }
    } else {
      msg.innerHTML = `<span style="color:#f85149">${data.detail || '添加失败'}</span>`;
    }
  } catch(e) {
    msg.innerHTML = `<span style="color:#f85149">网络错误: ${e.message}</span>`;
  }
  btn.disabled = false; btn.textContent = '下载添加';
}

async function refreshData() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true; btn.textContent = '刷新中...';
  document.getElementById('refreshMsg').textContent = '正在从 baostock 下载最新数据，可能需要 30 秒...';

  try {
    const res = await authFetch('/refresh-data', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('refreshMsg').textContent = `已更新 ${data.count} 只股票，数据范围: ${data.start} ~ ${data.end}`;
      showToast('数据已刷新', 'success');
      // 刷新下拉框：一次性插入
      const liveSel = document.getElementById('liveSymbol');
      if (data.files) {
        liveSel.innerHTML = data.files.map(f =>
          `<option value="${f.symbol}">${f.symbol}（${f.start} ~ ${f.end}）</option>`
        ).join('');
      }
    } else {
      document.getElementById('refreshMsg').textContent = '刷新失败: ' + (data.detail || '未知错误');
    }
  } catch(e) {
    document.getElementById('refreshMsg').textContent = '请求失败: ' + e.message;
  }

  btn.disabled = false; btn.textContent = '刷新数据';
}

// ==================== 自定义策略 ====================
const _buyConditions = [];
const _sellConditions = [];

const INDICATORS = {
  close: {name: '收盘价', params: []},
  open: {name: '开盘价', params: []},
  high: {name: '最高价', params: []},
  low: {name: '最低价', params: []},
  ma: {name: 'MA 均线', params: [{key:'period',label:'周期',default:20}]},
  ema: {name: 'EMA 均线', params: [{key:'period',label:'周期',default:20}]},
  wma: {name: 'WMA 加权均线', params: [{key:'period',label:'周期',default:20}]},
  rsi: {name: 'RSI', params: [{key:'period',label:'周期',default:14}]},
  macd: {name: 'MACD', params: [{key:'fast',label:'快线',default:12},{key:'slow',label:'慢线',default:26},{key:'signal',label:'信号线',default:9}], fields:['dif','dea','macd']},
  boll: {name: '布林带', params: [{key:'period',label:'周期',default:20},{key:'std',label:'标准差',default:2}], fields:['upper','middle','lower']},
  kdj: {name: 'KDJ', params: [{key:'n',label:'N',default:9},{key:'m1',label:'M1',default:3},{key:'m2',label:'M2',default:3}], fields:['k','d','j']},
  atr: {name: 'ATR 波幅', params: [{key:'period',label:'周期',default:14}]},
  cci: {name: 'CCI', params: [{key:'period',label:'周期',default:20}]},
  volume: {name: '成交量', params: []},
  vol_ma: {name: '成交量均线', params: [{key:'period',label:'周期',default:20}]},
  vol_ratio: {name: '量比', params: [{key:'period',label:'周期',default:20}]},
  obv: {name: 'OBV 能量潮', params: []},
  highest: {name: 'N日最高价', params: [{key:'period',label:'天数',default:20}]},
  lowest: {name: 'N日最低价', params: [{key:'period',label:'天数',default:20}]},
  donchian: {name: '唐奇安通道', params: [{key:'period',label:'周期',default:20}], fields:['upper','lower','middle']},
  return: {name: 'N日收益率%', params: [{key:'period',label:'天数',default:20}]},
};

const OPERATORS = [
  {value:'cross_above', label:'上穿'},
  {value:'cross_below', label:'下穿'},
  {value:'>', label:'大于 (>)'},
  {value:'<', label:'小于 (<)'},
  {value:'>=', label:'大于等于 (>=)'},
  {value:'<=', label:'小于等于 (<=)'},
  {value:'==', label:'等于 (==)'},
];

function buildConditionHTML(cond, type, idx) {
  const borderColor = type === 'buy' ? '#238636' : '#da3633';
  const indOpts = Object.entries(INDICATORS).map(([k,v]) =>
    `<option value="${k}" ${cond.left.indicator===k||cond.left.type==='value'&&k==='close' ? 'selected' : ''}>${v.name}</option>`).join('');

  const rightType = cond.right.type === 'fixed' ? 'fixed' : 'indicator';
  const opOpts = OPERATORS.map(o => `<option value="${o.value}" ${cond.op===o.value?'selected':''}>${o.label}</option>`).join('');

  return `<div style="display:flex;gap:6px;align-items:center;padding:8px;background:#131722;border:1px solid ${borderColor}33;border-radius:6px;flex-wrap:wrap">
    <select onchange="updateCondLeftType('${type}',${idx},this.value)" style="width:85px;font-size:12px">
      <option value="indicator" ${cond.left.type==='indicator'?'selected':''}>指标</option>
      <option value="fixed" ${cond.left.type==='fixed'?'selected':''}>数值</option>
    </select>
    ${cond.left.type === 'fixed'
      ? `<input type="number" step="any" value="${cond.left.value||0}" style="width:80px;font-size:12px" onchange="updateCondLeftValue('${type}',${idx},this.value)">`
      : `<select onchange="updateCondLeftIndicator('${type}',${idx},this.value)" style="width:115px;font-size:12px">${indOpts}</select>
         ${buildIndicatorParams(cond.left, type, idx, 'left')}`
    }
    <select onchange="updateCondOp('${type}',${idx},this.value)" style="width:125px;font-size:12px">${opOpts}</select>
    <select onchange="updateCondRightType('${type}',${idx},this.value)" style="width:85px;font-size:12px">
      <option value="indicator" ${rightType==='indicator'?'selected':''}>指标</option>
      <option value="fixed" ${rightType==='fixed'?'selected':''}>数值</option>
    </select>
    ${rightType === 'fixed'
      ? `<input type="number" step="any" value="${cond.right.value||0}" style="width:80px;font-size:12px" onchange="updateCondRightValue('${type}',${idx},this.value)">`
      : `<select onchange="updateCondRightIndicator('${type}',${idx},this.value)" style="width:115px;font-size:12px">${indOpts}</select>
         ${buildIndicatorParams(cond.right, type, idx, 'right')}`
    }
    <span style="color:#484f58;cursor:pointer;font-size:16px" onclick="removeCondition('${type}',${idx})">×</span>
  </div>`;
}

function buildIndicatorParams(ref, type, idx, side) {
  const ind = INDICATORS[ref.indicator || 'ma'];
  if (!ind) return '';
  let html = '';
  const p = ref.params || {};
  for (const param of (ind.params || [])) {
    html += `<input type="number" value="${p[param.key]||param.default}" title="${param.label}" style="width:50px;font-size:11px;padding:2px 4px" placeholder="${param.key}"
      onchange="updateCondParam('${type}',${idx},'${side}','${param.key}',this.value)">`;
  }
  if (ind.fields) {
    html += `<select style="width:80px;font-size:11px" onchange="updateCondParam('${type}',${idx},'${side}','field',this.value)">
      ${ind.fields.map(f => `<option value="${f}" ${(p.field||ind.fields[0])===f?'selected':''}>${f}</option>`).join('')}
    </select>`;
  }
  return html;
}

function renderConditions(type) {
  const conds = type === 'buy' ? _buyConditions : _sellConditions;
  const el = document.getElementById(type === 'buy' ? 'buyConditions' : 'sellConditions');
  if (conds.length === 0) {
    el.innerHTML = `<div style="color:#484f58;font-size:13px;padding:12px;text-align:center;border:1px dashed #21262d;border-radius:6px">点击「+ 添加条件」配置${type==='buy'?'买入':'卖出'}规则</div>`;
    return;
  }
  el.innerHTML = conds.map((c, i) => buildConditionHTML(c, type, i)).join('');
}

function defaultCondition() {
  return {
    left: {type:'indicator', indicator:'ma', params:{period:5}},
    op: 'cross_above',
    right: {type:'indicator', indicator:'ma', params:{period:20}},
  };
}

function addCondition(type) {
  (type === 'buy' ? _buyConditions : _sellConditions).push(defaultCondition());
  renderConditions(type);
}

function removeCondition(type, idx) {
  (type === 'buy' ? _buyConditions : _sellConditions).splice(idx, 1);
  renderConditions(type);
}

function updateCondLeftType(type, idx, val) {
  const cond = (type === 'buy' ? _buyConditions : _sellConditions)[idx];
  if (val === 'fixed') { cond.left = {type:'fixed', value: 100}; }
  else { cond.left = {type:'indicator', indicator:'ma', params:{period:20}}; }
  renderConditions(type);
}
function updateCondRightType(type, idx, val) {
  const cond = (type === 'buy' ? _buyConditions : _sellConditions)[idx];
  if (val === 'fixed') { cond.right = {type:'fixed', value: 100}; }
  else { cond.right = {type:'indicator', indicator:'ma', params:{period:20}}; }
  renderConditions(type);
}
function updateCondLeftIndicator(type, idx, val) {
  const cond = (type === 'buy' ? _buyConditions : _sellConditions)[idx];
  cond.left.indicator = val;
  const ind = INDICATORS[val];
  cond.left.params = {};
  for (const p of (ind.params || [])) cond.left.params[p.key] = p.default;
  if (ind.fields) cond.left.params.field = ind.fields[0];
  renderConditions(type);
}
function updateCondRightIndicator(type, idx, val) {
  const cond = (type === 'buy' ? _buyConditions : _sellConditions)[idx];
  cond.right.indicator = val;
  const ind = INDICATORS[val];
  cond.right.params = {};
  for (const p of (ind.params || [])) cond.right.params[p.key] = p.default;
  if (ind.fields) cond.right.params.field = ind.fields[0];
  renderConditions(type);
}
function updateCondOp(type, idx, val) { (type === 'buy' ? _buyConditions : _sellConditions)[idx].op = val; }
function updateCondLeftValue(type, idx, val) { (type === 'buy' ? _buyConditions : _sellConditions)[idx].left.value = parseFloat(val); }
function updateCondRightValue(type, idx, val) { (type === 'buy' ? _buyConditions : _sellConditions)[idx].right.value = parseFloat(val); }
function updateCondParam(type, idx, side, key, val) {
  const cond = (type === 'buy' ? _buyConditions : _sellConditions)[idx];
  if (!cond[side].params) cond[side].params = {};
  cond[side].params[key] = isNaN(val) ? val : parseFloat(val);
}

// 股票搜索联想（策略页）
bindStockSearch('strategySymbol', 'strategySymbolDropdown', 'strategyMarket',
  (code) => { document.getElementById('strategySymbol').value = code; document.getElementById('strategySymbolDropdown').style.display = 'none'; });

async function saveStrategy() {
  const name = document.getElementById('strategyName').value.trim();
  const symbol = document.getElementById('strategySymbol').value.trim();
  const market = document.getElementById('strategyMarket').value;
  const msg = document.getElementById('strategySaveMsg');
  if (!name) { msg.innerHTML = '<span style="color:#f85149">请输入策略名称</span>'; return; }
  if (!symbol) { msg.innerHTML = '<span style="color:#f85149">请输入股票代码</span>'; return; }
  if (_buyConditions.length === 0 && _sellConditions.length === 0) {
    msg.innerHTML = '<span style="color:#f85149">至少配置一个买入或卖出条件</span>'; return;
  }
  try {
    const resp = await authFetch('/user-strategies', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({name, symbol, market, buy_conditions: _buyConditions, sell_conditions: _sellConditions}),
    });
    if (resp.ok) {
      msg.innerHTML = '<span style="color:#3fb950">策略创建成功！</span>';
      _buyConditions.length = 0; _sellConditions.length = 0;
      renderConditions('buy'); renderConditions('sell');
      document.getElementById('strategyName').value = '';
      document.getElementById('strategySymbol').value = '';
      loadStrategies();
      showToast('策略已保存', 'success');
    } else {
      const d = await resp.json();
      msg.innerHTML = `<span style="color:#f85149">${d.detail || '创建失败'}</span>`;
    }
  } catch(e) { msg.innerHTML = `<span style="color:#f85149">${e.message}</span>`; }
}

async function loadStrategies() {
  const el = document.getElementById('userStrategyList');
  try {
    const resp = await authFetch('/user-strategies');
    const data = await resp.json();
    const strats = data.strategies || [];
    if (strats.length === 0) {
      el.innerHTML = '<div style="color:#484f58;text-align:center;padding:24px">还没有策略，先在左边创建一个吧</div>';
      return;
    }
    el.innerHTML = strats.map(s => {
      const buyN = (s.buy_conditions || []).length;
      const sellN = (s.sell_conditions || []).length;
      const statusColor = s.enabled ? '#3fb950' : '#484f58';
      const lastEval = s.last_evaluated || '未评估';
      return `<div style="padding:12px;background:#0d1117;border:1px solid #21262d;border-radius:8px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <b style="color:#e6edf3">${s.name}</b>
            <span style="color:#8b949e;font-size:12px;margin-left:8px">${s.symbol}</span>
            <span style="color:${statusColor};font-size:11px;margin-left:8px">${s.enabled ? '●运行中' : '●已暂停'}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn" style="background:#1f6feb;padding:3px 10px;font-size:11px" onclick="evaluateStrategy(${s.id})">评估</button>
            <button class="btn" style="background:${s.enabled?'#6e7681':'#238636'};padding:3px 10px;font-size:11px" onclick="toggleStrategy(${s.id},${!s.enabled})">${s.enabled?'暂停':'启用'}</button>
            <button class="btn" style="background:#da3633;padding:3px 10px;font-size:11px" onclick="deleteStrategy(${s.id})">删除</button>
          </div>
        </div>
        <div style="font-size:12px;color:#8b949e">
          买入条件: ${buyN} 条 | 卖出条件: ${sellN} 条 | 上次评估: ${lastEval}
        </div>
      </div>`;
    }).join('');
  } catch(e) { el.innerHTML = `<div style="color:#f85149">加载失败: ${e.message}</div>`; }
}

async function evaluateStrategy(id) {
  showToast('正在评估...', 'success');
  try {
    const resp = await authFetch(`/user-strategies/${id}/evaluate`, {method:'POST'});
    const data = await resp.json();
    if (data.status === 'error') {
      showToast(`评估失败: ${data.error}`, 'error');
      return;
    }
    const signals = data.signals || [];
    if (signals.length > 0) {
      const s = signals[0];
      showToast(`发现信号: ${s.type === 'buy' ? '买入' : '卖出'}！已推送通知`, 'success');
    } else {
      showToast(`评估完成: 暂无信号 (最新: ${data.latest_date} 收盘 ${data.latest_close})`, 'success');
    }
    loadStrategies();
  } catch(e) { showToast('评估失败', 'error'); }
}

async function toggleStrategy(id, enabled) {
  await authFetch(`/user-strategies/${id}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({enabled}),
  });
  loadStrategies();
}

async function deleteStrategy(id) {
  if (!confirm('确认删除这个策略？')) return;
  await authFetch(`/user-strategies/${id}`, {method:'DELETE'});
  loadStrategies();
  showToast('已删除', 'success');
}

async function evaluateAllStrategies() {
  const msg = document.getElementById('evalAllMsg');
  msg.innerHTML = '<span style="color:#58a6ff">正在评估所有策略...</span>';
  try {
    const resp = await authFetch('/user-strategies/evaluate-all', {method:'POST'});
    const data = await resp.json();
    msg.innerHTML = `<span style="color:#3fb950">评估完成: ${data.evaluated} 个策略，发现 ${data.signals} 个信号</span>`;
    loadStrategies();
    showToast(`评估完成，${data.signals} 个信号`, 'success');
  } catch(e) { msg.innerHTML = `<span style="color:#f85149">${e.message}</span>`; }
}

// 初始化策略页
renderConditions('buy');
renderConditions('sell');
loadStrategies();

// 自然语言策略解析
function fillNLExample(text) {
  document.getElementById('nlInput').value = text;
  document.getElementById('nlInput').focus();
}

async function parseNLStrategy() {
  const text = document.getElementById('nlInput').value.trim();
  const result = document.getElementById('nlResult');
  if (!text) {
    result.innerHTML = '<span style="color:#f85149">请输入你的策略描述</span>';
    return;
  }
  result.innerHTML = '<span style="color:#58a6ff">正在翻译...</span>';
  try {
    const resp = await authFetch('/nl/parse', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text}),
    });
    const data = await resp.json();
    if (resp.ok && data.status === 'ok') {
      const src = data.source === 'llm' ? '<span style="background:#a371f733;color:#a371f7;padding:1px 6px;border-radius:3px;font-size:11px">AI解析</span>' : '<span style="background:#23863633;color:#3fb950;padding:1px 6px;border-radius:3px;font-size:11px">免费解析</span>';

      // 多股票模式
      if (data.multi && data.rules) {
        let html = `<div style="color:#3fb950;margin-bottom:8px">识别到 ${data.rules.length} 只股票的规则 ${src}</div>`;
        data.rules.forEach((rule, idx) => {
          const bc = rule.buy_conditions || [];
          const sc = rule.sell_conditions || [];
          const hasConditions = bc.length > 0 || sc.length > 0;
          const stockLabel = rule.stock_code !== 'unknown' ? `${rule.stock_name}（${rule.stock_code}）` : '未绑定股票';
          html += `<div style="background:var(--sys-bg-panel);border:1px solid var(--sys-border);border-radius:6px;padding:10px;margin-bottom:6px">`;
          html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">`;
          html += `<span style="color:#58a6ff;font-weight:600">${stockLabel}</span>`;
          if (hasConditions) {
            html += `<button class="btn" style="background:#238636;padding:3px 10px;font-size:11px" onclick="applyNLRule(${idx})">应用此规则</button>`;
          }
          html += `</div>`;
          if (hasConditions) {
            html += `<div style="color:#8b949e;font-size:12px">${rule.explanation}</div>`;
          } else {
            html += `<div style="color:#f85149;font-size:12px">未能识别条件</div>`;
          }
          if (rule.unmatched && rule.unmatched.length > 0) {
            html += `<div style="color:#d29922;font-size:11px;margin-top:2px">未识别: ${rule.unmatched.join('、')}</div>`;
          }
          html += `</div>`;
        });
        // 缓存规则供 applyNLRule 使用
        window._nlRules = data.rules;
        html += `<div style="color:#484f58;font-size:11px;margin-top:4px">点击「应用此规则」填入下方表单，调整后保存</div>`;
        result.innerHTML = html;
        showToast(`识别到 ${data.rules.length} 条规则`, 'success');
      } else {
        // 单股票模式（向后兼容）
        const rule = data;
        const bc = rule.buy_conditions || [];
        const sc = rule.sell_conditions || [];
        if (bc.length === 0 && sc.length === 0) {
          result.innerHTML = `<span style="color:#f85149">未能识别条件，请换个说法试试</span>
            <div style="color:#484f58;font-size:12px;margin-top:4px">试试：涨了就买跌了就卖、亏了20%就跑、茅台亏10%就卖</div>`;
          return;
        }
        window._nlRules = [rule];
        let html = `<div style="color:#3fb950;margin-bottom:6px">翻译成功！${src}</div>`;
        if (rule.stock_name && rule.stock_name !== 'unknown') {
          html += `<div style="color:#58a6ff;font-size:13px;margin-bottom:4px">股票: ${rule.stock_name}（${rule.stock_code}）</div>`;
        }
        html += `<div style="color:#8b949e;font-size:12px">${rule.explanation}</div>`;
        if (rule.unmatched && rule.unmatched.length > 0) {
          html += `<div style="color:#d29922;font-size:12px;margin-top:4px">未识别: ${rule.unmatched.join('、')}</div>`;
        }
        html += `<div style="margin-top:6px"><button class="btn" style="background:#238636;padding:4px 12px;font-size:12px" onclick="applyNLRule(0)">应用规则</button>
          <span style="color:#484f58;font-size:11px;margin-left:8px">填入下方表单后可手动调整</span></div>`;
        result.innerHTML = html;
        showToast('策略翻译成功', 'success');
      }
    } else {
      result.innerHTML = `<span style="color:#f85149">${data.detail || '翻译失败'}</span>`;
    }
  } catch(e) {
    result.innerHTML = `<span style="color:#f85149">网络错误: ${e.message}</span>`;
  }
}

function applyNLRule(idx) {
  const rules = window._nlRules || [];
  if (idx >= rules.length) return;
  const rule = rules[idx];
  const bc = rule.buy_conditions || [];
  const sc = rule.sell_conditions || [];
  _buyConditions.length = 0;
  _sellConditions.length = 0;
  for (const c of bc) _buyConditions.push(c);
  for (const c of sc) _sellConditions.push(c);
  renderConditions('buy');
  renderConditions('sell');
  // 如果有股票代码，自动选中
  if (rule.stock_code && rule.stock_code !== 'unknown') {
    const sel = document.getElementById('symbolSelect');
    if (sel) {
      const opt = [...sel.options].find(o => o.value === rule.stock_code);
      if (opt) { sel.value = rule.stock_code; sel.dispatchEvent(new Event('change')); }
    }
  }
  showToast(`已应用 ${rule.stock_name !== 'unknown' ? rule.stock_name : ''} 的规则`, 'success');
}

// 预设策略模板
async function loadPresets() {
  try {
    const resp = await authFetch('/user-strategies/presets');
    const data = await resp.json();
    const presets = data.presets || [];
    const el = document.getElementById('presetList');
    const colors = ['#238636','#1f6feb','#f0883e','#a371f7','#3fb950','#58a6ff','#d29922','#f778ba'];
    el.innerHTML = presets.map((p, i) => {
      const color = colors[i % colors.length];
      return `<div style="padding:12px;background:#0d1117;border:1px solid ${color}44;border-radius:8px;cursor:pointer;transition:border-color .2s"
        onmouseover="this.style.borderColor='${color}'" onmouseout="this.style.borderColor='${color}44'"
        onclick="loadPreset(${p.index})">
        <div style="font-size:14px;font-weight:600;color:#e6edf3;margin-bottom:4px">${p.name}</div>
        <div style="font-size:12px;color:#8b949e;margin-bottom:8px">${p.description}</div>
        <div style="display:flex;gap:12px;font-size:11px">
          <span style="color:#3fb950">买入 ${p.buy_count} 条</span>
          <span style="color:#f85149">卖出 ${p.sell_count} 条</span>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('presetList').innerHTML = `<div style="color:#f85149">加载失败: ${e.message}</div>`;
  }
}

async function loadPreset(index) {
  const symbol = document.getElementById('presetSymbol').value.trim();
  const market = document.getElementById('presetMarket').value;
  const msg = document.getElementById('presetMsg');
  if (!symbol) {
    msg.innerHTML = '<span style="color:#f85149">请先输入股票代码</span>';
    return;
  }
  try {
    const resp = await authFetch(`/user-strategies/presets/${index}?symbol=${encodeURIComponent(symbol)}&market=${market}`, {
      method: 'POST',
    });
    if (resp.ok) {
      const data = await resp.json();
      msg.innerHTML = `<span style="color:#3fb950">已加载: ${data.strategy.name} → ${symbol}</span>`;
      loadStrategies();
      showToast('预设策略已创建', 'success');
    } else {
      const d = await resp.json();
      msg.innerHTML = `<span style="color:#f85149">${d.detail || '加载失败'}</span>`;
    }
  } catch(e) {
    msg.innerHTML = `<span style="color:#f85149">${e.message}</span>`;
  }
}

// 预设页股票搜索联想
bindStockSearch('presetSymbol', 'presetSymbolDropdown', 'presetMarket',
  (code) => { document.getElementById('presetSymbol').value = code; document.getElementById('presetSymbolDropdown').style.display = 'none'; });

loadPresets();

// 快捷键支持
document.addEventListener('keydown', e => {
  // Ctrl+Enter / Cmd+Enter → 运行当前 Tab 的主操作
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    const active = document.querySelector('.tab-content:not(.hidden)');
    if (!active) return;
    const id = active.id;
    if (id === 'tab-backtest') document.getElementById('runBtn')?.click();
    else if (id === 'tab-portfolio') document.getElementById('portfolioBtn')?.click();
    else if (id === 'tab-optimize') document.getElementById('optimizeBtn')?.click();
  }
  // Escape → 关闭下拉框
  if (e.key === 'Escape') {
    document.querySelectorAll('[id$="Dropdown"]').forEach(d => d.style.display = 'none');
  }
});

// ==================== 实时行情刷新 ====================
let _quoteTimer = null;
async function onSymbolChange(symbol) {
  const bar = document.getElementById('quoteBar');
  if (!symbol) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  bar.innerHTML = '<span style="color:#8b949e">获取行情中...</span>';
  try {
    const res = await authFetch(`/realtime/${symbol}`);
    if (!res.ok) { bar.innerHTML = '<span style="color:#f85149">获取失败</span>'; return; }
    const q = await res.json();
    const color = q.change_pct >= 0 ? '#3fb950' : '#f85149';
    const sign = q.change_pct >= 0 ? '+' : '';
    bar.innerHTML = `<b style="color:#e6edf3">${q.name}</b> ` +
      `<span style="color:${color};font-weight:700">¥${q.price.toFixed(2)}</span> ` +
      `<span style="color:${color}">${sign}${q.change_pct.toFixed(2)}%</span> ` +
      `<span style="color:#8b949e">开:${q.open.toFixed(2)} 高:${q.high.toFixed(2)} 低:${q.low.toFixed(2)} ${q.updated||''}</span>`;
  } catch(e) { bar.innerHTML = `<span style="color:#f85149">${e.message}</span>`; }
}

// ==================== 模拟盘 ====================
let paperWs = null;
let paperRunning = false;

function populatePaperStrategies() {
  const sel = document.getElementById('paperStrategy');
  sel.innerHTML = strategyKeys.map(k => `<option value="${k}">${k}</option>`).join('');
}

async function startPaperTrade() {
  const strategy = document.getElementById('paperStrategy').value;
  const symbol = document.getElementById('paperSymbol').value.trim();
  const interval = parseInt(document.getElementById('paperInterval').value) || 3;
  if (!strategy) { showToast('请选择策略', 'error'); return; }
  if (!symbol) { showToast('请输入股票代码', 'error'); return; }

  try {
    const res = await authFetch('/paper-trade/start', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ strategy, symbol, interval }),
    });
    if (!res.ok) { const d = await res.json(); showToast(d.detail || '启动失败', 'error'); return; }
    paperRunning = true;
    document.getElementById('paperStartBtn').disabled = true;
    document.getElementById('paperStopBtn').disabled = false;
    document.getElementById('paperStatus').textContent = `运行中: ${strategy} / ${symbol}`;
    document.getElementById('paperSignalsEmpty').style.display = 'none';
    connectPaperWs();
    showToast('模拟盘已启动', 'success');
  } catch (e) { showToast('启动失败: ' + e.message, 'error'); }
}

async function stopPaperTrade() {
  const strategy = document.getElementById('paperStrategy').value;
  const symbol = document.getElementById('paperSymbol').value.trim();
  try {
    await authFetch('/paper-trade/stop', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ strategy, symbol }),
    });
  } catch (e) {}
  paperRunning = false;
  document.getElementById('paperStartBtn').disabled = false;
  document.getElementById('paperStopBtn').disabled = true;
  document.getElementById('paperStatus').textContent = '已停止';
  if (paperWs) { paperWs.close(); paperWs = null; }
  showToast('模拟盘已停止', 'success');
}

function connectPaperWs() {
  if (paperWs) paperWs.close();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  paperWs = new WebSocket(`${proto}//${location.host}/ws`);
  paperWs.onopen = () => {
    paperWs.send(JSON.stringify({ action: 'subscribe', topic: 'paper-trade' }));
  };
  paperWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.topic === 'paper-trade') addPaperSignal(msg.data);
    } catch {}
  };
  paperWs.onclose = () => { if (paperRunning) setTimeout(connectPaperWs, 3000); };
}

function addPaperSignal(d) {
  const tbody = document.getElementById('paperSignalsBody');
  const color = d.action === '买入' ? '#3fb950' : d.action === '卖出' ? '#f85149' : '#8b949e';
  const pnlColor = (d.pnl || 0) > 0 ? '#3fb950' : (d.pnl || 0) < 0 ? '#f85149' : '#8b949e';
  const row = document.createElement('tr');
  row.style.borderBottom = '1px solid #21262d';
  row.innerHTML = `
    <td style="padding:4px 6px">${d.time || '-'}</td>
    <td style="text-align:center;color:${color};font-weight:600">${d.action || '-'}</td>
    <td style="text-align:center">¥${d.price || '-'}</td>
    <td style="text-align:center;color:${(d.change_pct||0)>0?'#3fb950':(d.change_pct||0)<0?'#f85149':'#8b949e'}">${d.change_pct != null ? d.change_pct.toFixed(2) + '%' : '-'}</td>
    <td style="text-align:center">${d.pos != null ? d.pos : '-'}</td>
    <td style="text-align:center;color:${pnlColor}">${d.pnl != null ? d.pnl.toFixed(2) + '%' : '-'}</td>
  `;
  tbody.insertBefore(row, tbody.firstChild);
  // 保留最近 50 条
  while (tbody.children.length > 50) tbody.removeChild(tbody.lastChild);
}

// ==================== 数据质量 ====================
async function loadDataQuality() {
  const container = document.getElementById('qualityResult');
  container.innerHTML = '<div class="loading"><span class="spinner"></span>正在检测数据质量...</div>';
  try {
    const res = await authFetch('/data/quality');
    if (!res.ok) throw new Error('请求失败');
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      container.innerHTML = '<p style="color:#8b949e">暂无数据文件，请先下载股票数据。</p>';
      return;
    }
    let html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="border-bottom:1px solid #30363d"><th style="text-align:left;padding:8px">股票</th><th>行数</th><th>日期范围</th><th>质量评分</th><th>问题数</th><th>操作</th></tr>';
    data.results.forEach(r => {
      const scoreColor = r.score >= 80 ? '#3fb950' : r.score >= 60 ? '#f0883e' : '#f85149';
      const issueCount = r.issues ? r.issues.length : 0;
      html += `<tr style="border-bottom:1px solid #21262d">
        <td style="padding:8px;font-weight:600">${r.symbol}</td>
        <td style="text-align:center">${r.rows}</td>
        <td style="text-align:center">${r.date_range ? r.date_range.join(' ~ ') : '-'}</td>
        <td style="text-align:center;color:${scoreColor};font-weight:700">${r.score}</td>
        <td style="text-align:center">${issueCount}</td>
        <td style="text-align:center"><button class="btn" style="padding:4px 10px;font-size:12px" onclick="showQualityDetail('${r.symbol}')">详情</button></td>
      </tr>`;
    });
    html += '</table></div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p style="color:#f85149">检测失败：${e.message}</p>`;
  }
}

async function showQualityDetail(symbol) {
  try {
    const res = await authFetch(`/data/quality/${symbol}`);
    if (!res.ok) throw new Error('请求失败');
    const r = await res.json();
    const scoreColor = r.score >= 80 ? '#3fb950' : r.score >= 60 ? '#f0883e' : '#f85149';
    let html = `<div style="margin-top:12px">`;
    html += `<h3 style="margin-bottom:8px">${r.symbol} — <span style="color:${scoreColor}">评分 ${r.score}</span></h3>`;
    html += `<p style="color:#8b949e;font-size:13px">${r.rows} 行数据，${r.date_range ? r.date_range.join(' ~ ') : ''}</p>`;
    if (r.issues && r.issues.length > 0) {
      html += '<div style="margin-top:10px">';
      r.issues.forEach(issue => {
        const icon = issue.type === 'critical' ? '🔴' : issue.type === 'warning' ? '🟡' : '🔵';
        html += `<div style="padding:6px 0;font-size:13px;border-bottom:1px solid #21262d">${icon} ${issue.message}</div>`;
      });
      html += '</div>';
    } else {
      html += '<p style="color:#3fb950;margin-top:8px">未发现问题，数据质量良好。</p>';
    }
    html += `<button class="btn" style="margin-top:12px;padding:4px 12px;font-size:12px" onclick="loadDataQuality()">返回列表</button>`;
    html += '</div>';
    document.getElementById('qualityResult').innerHTML = html;
  } catch (e) {
    showToast('加载详情失败：' + e.message, 'error');
  }
}

// ==================== 实盘交易 ====================
async function brokerConnect() {
  const broker = document.getElementById('brokerType').value;
  const exePath = document.getElementById('brokerExePath').value || null;
  try {
    const res = await authFetch('/broker/connect', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ broker, exe_path: exePath }),
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('brokerStatus').innerHTML = `<span style="color:#3fb950">已连接: ${data.broker}</span>`;
      document.getElementById('brokerTrading').style.display = '';
      document.getElementById('brokerOrdersCard').style.display = '';
      showToast(`已连接 ${data.broker}`, 'success');
    } else {
      document.getElementById('brokerStatus').innerHTML = `<span style="color:#f85149">${data.detail || '连接失败'}</span>`;
    }
  } catch(e) {
    document.getElementById('brokerStatus').innerHTML = `<span style="color:#f85149">${e.message}</span>`;
  }
}

async function brokerDisconnect() {
  await authFetch('/broker/disconnect', { method: 'POST' });
  document.getElementById('brokerStatus').innerHTML = '<span style="color:#8b949e">未连接</span>';
  document.getElementById('brokerTrading').style.display = 'none';
  document.getElementById('brokerOrdersCard').style.display = 'none';
  showToast('已断开券商连接', 'success');
}

async function brokerRefreshBalance() {
  try {
    const res = await authFetch('/broker/balance');
    const data = await res.json();
    if (res.ok) {
      const el = document.getElementById('brokerBalance');
      el.innerHTML = Object.entries(data).map(([k,v]) => `<div>${k}: <b style="color:#e6edf3">¥${Number(v).toLocaleString()}</b></div>`).join('');
    }
  } catch(e) { showToast(e.message, 'error'); }
}

async function brokerRefreshPositions() {
  try {
    const res = await authFetch('/broker/positions');
    const data = await res.json();
    const el = document.getElementById('brokerPositions');
    if (data.length === 0 || data[0].error) {
      el.innerHTML = data[0]?.error ? `<span style="color:#f85149">${data[0].error}</span>` : '无持仓';
      return;
    }
    el.innerHTML = '<table style="font-size:12px;width:100%"><tr><th>代码</th><th>名称</th><th>数量</th><th>现价</th><th>盈亏</th></tr>' +
      data.map(p => `<tr><td>${p.股票代码}</td><td>${p.股票名称}</td><td>${p.持仓数量}</td><td>¥${p.当前价}</td><td style="color:${p.盈亏>=0?'#3fb950':'#f85149'}">${p.盈亏}</td></tr>`).join('') + '</table>';
  } catch(e) { showToast(e.message, 'error'); }
}

async function brokerRefreshOrders() {
  try {
    const res = await authFetch('/broker/orders');
    const data = await res.json();
    const body = document.getElementById('brokerOrdersBody');
    body.innerHTML = data.map(o => `<tr>
      <td>${o.委托编号||''}</td><td>${o.股票代码||''}</td><td>${o.股票名称||''}</td>
      <td style="color:${o.方向?.includes('买')?'#3fb950':'#f85149'}">${o.方向||''}</td>
      <td>${o.价格||''}</td><td>${o.数量||''}</td><td>${o.已成交||0}</td><td>${o.状态||''}</td>
      <td><button class="btn" style="background:#30363d;font-size:11px;padding:2px 6px" onclick="brokerCancel('${o.委托编号}')">撤单</button></td>
    </tr>`).join('');
  } catch(e) { showToast(e.message, 'error'); }
}

async function brokerBuy() {
  const symbol = document.getElementById('brokerSymbol').value.trim();
  const price = parseFloat(document.getElementById('brokerPrice').value);
  const amount = parseInt(document.getElementById('brokerAmount').value);
  if (!symbol || !price || !amount) { showToast('请填写完整信息', 'error'); return; }
  if (!confirm(`确认买入 ${symbol} ${amount}股 @ ¥${price}？`)) return;
  try {
    const res = await authFetch('/broker/buy', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ symbol, price, amount }),
    });
    const data = await res.json();
    if (res.ok) { showToast(`买入成功: ${data.message}`, 'success'); brokerRefreshOrders(); }
    else showToast(data.detail || '买入失败', 'error');
  } catch(e) { showToast(e.message, 'error'); }
}

async function brokerSell() {
  const symbol = document.getElementById('brokerSymbol').value.trim();
  const price = parseFloat(document.getElementById('brokerPrice').value);
  const amount = parseInt(document.getElementById('brokerAmount').value);
  if (!symbol || !price || !amount) { showToast('请填写完整信息', 'error'); return; }
  if (!confirm(`确认卖出 ${symbol} ${amount}股 @ ¥${price}？`)) return;
  try {
    const res = await authFetch('/broker/sell', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ symbol, price, amount }),
    });
    const data = await res.json();
    if (res.ok) { showToast(`卖出成功: ${data.message}`, 'success'); brokerRefreshOrders(); }
    else showToast(data.detail || '卖出失败', 'error');
  } catch(e) { showToast(e.message, 'error'); }
}

async function brokerCancel(orderId) {
  if (!confirm(`确认撤销委托 ${orderId}？`)) return;
  try {
    const res = await authFetch(`/broker/cancel/${orderId}`, { method: 'POST' });
    if (res.ok) { showToast('撤单成功', 'success'); brokerRefreshOrders(); }
    else { const d = await res.json(); showToast(d.detail || '撤单失败', 'error'); }
  } catch(e) { showToast(e.message, 'error'); }
}

async function brokerFillPrice() {
  const symbol = document.getElementById('brokerSymbol').value.trim();
  if (!symbol) { showToast('请先输入股票代码', 'error'); return; }
  try {
    const res = await authFetch(`/realtime/${symbol}`);
    const q = await res.json();
    if (q.price) document.getElementById('brokerPrice').value = q.price.toFixed(2);
  } catch(e) { showToast(e.message, 'error'); }
}