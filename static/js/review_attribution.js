/**
 * ====================================================================
 * 🔗 review_attribution.js - 交易复盘工作台：四类互斥逻辑归因与产业链图谱看板
 * ====================================================================
 */
// ==================== 🔗 4. 渲染【逻辑归因与产业链图谱】 ====================
var _attrFilterType = 'all';

async function renderAttributionAgentPanel(container, attr) {
  attr = attr || (_fullAgentDashboardData ? _fullAgentDashboardData.attribution : {}) || {};
  const cats = attr.four_categories || [
    { type: '连板土特产', count: 18, pct: 24.5, color: '#ef4444', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.2)', desc: '情绪周期驱动，连板妖股与高度龙头，无视基本面' },
    { type: '美股异动指引', count: 12, pct: 16.3, color: '#3b82f6', bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.2)', desc: '隔夜纳斯达克与标普映射，海外产业链景气共振' },
    { type: '热点新闻驱动', count: 28, pct: 38.1, color: '#10b981', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.2)', desc: '行业突发重磅政策利好、重大订单与产业催化' },
    { type: '活人因子/游资抢筹', count: 15, pct: 21.1, color: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.2)', desc: '主力大单逆势吸筹，盘口承接极强，潜伏资金启动' }
  ];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- 顶部四类互斥归因看板 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-card, #ffffff);border:1px solid var(--sys-border, #e2e8f0);border-radius:10px;padding:20px;box-shadow:var(--sys-shadow-card, 0 1px 3px rgba(0,0,0,0.05))">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="ri-links-line" style="font-size:20px;color:#7c3aed"></i>
            <b class="clickable-feature-title" onclick="openFeatureGuideModal('review_main')" style="font-size:16px;font-weight:800;color:var(--sys-text-title, #1e293b);display:inline-flex;align-items:center;gap:6px">
              <span>四类互斥暴涨逻辑归因体系</span>
              <i class="ri-information-line" style="font-size:14px;color:#7c3aed"></i>
            </b>
            <span style="font-size:12.5px;color:var(--sys-text-sub, #64748b)">严格互斥分类 · 查明个股到底因何暴涨</span>
          </div>
          <span style="font-size:11.5px;font-weight:700;color:#059669;background:rgba(16,185,129,0.1);padding:4px 10px;border-radius:6px;border:1px solid rgba(16,185,129,0.25);display:inline-flex;align-items:center;gap:4px">
            <i class="ri-checkbox-circle-line"></i>
            <span>四类严格互斥 · 杜绝买糊涂票</span>
          </span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px">
          ${cats.map(c => `
            <div style="padding:14px 16px;background:${c.bg || 'var(--sys-bg-sub, #f8fafc)'};border-radius:8px;border:1px solid ${c.border || 'var(--sys-border, #e2e8f0)'};display:flex;flex-direction:column;gap:8px;transition:all 0.2s">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b style="font-size:14px;font-weight:800;color:${c.color}">${c.type}</b>
                <span style="font-size:13px;color:var(--sys-text-title, #1e293b);font-family:'JetBrains Mono',monospace;font-weight:800">${c.count} 只 (${c.pct}%)</span>
              </div>
              <div style="height:6px;background:rgba(0,0,0,0.06);border-radius:3px;overflow:hidden">
                <div style="width:${c.pct}%;height:100%;background:${c.color};border-radius:3px"></div>
              </div>
              <div style="font-size:12px;color:var(--sys-text-sub, #64748b);line-height:1.5">${c.desc}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 核心标的逻辑归因穿透列表 -->
      <div class="panel" style="margin:0;background:var(--sys-bg-card, #ffffff);border:1px solid var(--sys-border, #e2e8f0);border-radius:10px;padding:20px;box-shadow:var(--sys-shadow-card, 0 1px 3px rgba(0,0,0,0.05))">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="ri-node-tree" style="font-size:18px;color:#2563eb"></i>
            <b style="font-size:16px;font-weight:800;color:var(--sys-text-title, #1e293b)">个股逻辑归因与产业链映射明细</b>
            <span style="font-size:12px;color:var(--sys-text-sub, #64748b)">置信度降序 · 关联催化研报与 Alpha 测算</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="text" id="rwAttrSearchInput" placeholder="搜索标的名称/代码..." style="background:#ffffff;border:1px solid #dcdfe6;padding:6px 12px;border-radius:6px;color:var(--sys-text-primary, #303133);font-size:12.5px;width:200px;outline:none" onkeydown="if(event.key==='Enter') loadAttributionTableData()">
            <button class="btn btn-blue" style="padding:6px 14px;font-size:12.5px;font-weight:700;border-radius:6px" onclick="loadAttributionTableData()">
              <i class="ri-search-line"></i> 筛选
            </button>
          </div>
        </div>

        <div style="overflow-x:auto;border:1px solid var(--sys-border, #e2e8f0);border-radius:8px">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left">
            <thead>
              <tr style="background:var(--sys-bg-sub, #f8fafc);color:var(--sys-text-sub, #64748b);border-bottom:1px solid var(--sys-border, #e2e8f0);font-weight:700">
                <th style="padding:11px 14px">标的代码/名称</th>
                <th style="padding:11px 14px">所属题材</th>
                <th style="padding:11px 14px">收盘价</th>
                <th style="padding:11px 14px">涨跌幅</th>
                <th style="padding:11px 14px">换手率</th>
                <th style="padding:11px 14px">暴涨核心归因</th>
                <th style="padding:11px 14px">归因置信度</th>
                <th style="padding:11px 14px;text-align:center">研报研读 / 实盘联动</th>
              </tr>
            </thead>
            <tbody id="rwAttrTableBody">
              <tr><td colspan="8" style="text-align:center;padding:30px;color:var(--sys-text-sub, #64748b)"><span class="spinner"></span> 正在加载逻辑归因数据...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  loadAttributionTableData();
}

async function loadAttributionTableData() {
  const tbody = document.getElementById('rwAttrTableBody');
  const searchInput = document.getElementById('rwAttrSearchInput');
  const query = searchInput ? searchInput.value.trim() : '';

  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:25px;color:var(--sys-text-sub, #64748b)"><span class="spinner"></span> 正在穿透提取标的逻辑归因...</td></tr>';

  try {
    const res = await authFetch(`/api/review/core-watchlist?date=${_selectedReviewDate}&page=1&page_size=10&search=${encodeURIComponent(query)}`);
    const json = await res.json();
    if (json.code === 200 && json.data) {
      let list = json.data || [];
      list.sort((a, b) => (parseFloat(b.attribution_confidence || 0) - parseFloat(a.attribution_confidence || 0)));

      if (list.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--sys-text-sub, #64748b)">当前无归因标的数据，请先执行复盘</td></tr>';
        return;
      }

      const attrTypeMap = {
        'technical_breakout': '技术形态放量突破',
        'policy_support': '国家政策重磅支持',
        'hotspot_driver': '行业突发利好催化',
        'us_mapping': '隔夜美股强映射',
        'earnings_surprise': '业绩超预期高增',
        'social_buzz': '游资全网热度发酵',
        'hot_money_influx': '主力大单逆势建仓',
        'unconfirmed': '盘口资金活跃试盘'
      };

      if (tbody) {
        tbody.innerHTML = list.map(item => {
          const chg = parseFloat(item.change_pct || 0);
          const chgColor = chg >= 0 ? '#ef4444' : '#10b981';
          const chgText = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
          const conf = parseFloat(item.attribution_confidence || 0.85);
          const rawAttr = String(item.attribution_type || '').toLowerCase();
          const cleanAttr = attrTypeMap[rawAttr] || item.attribution_type || '主线逻辑共振';

          return `
            <tr style="border-bottom:1px solid var(--sys-border, #f1f5f9);transition:background 0.15s" onmouseover="this.style.background='rgba(37,99,235,0.04)'" onmouseout="this.style.background='transparent'">
              <td style="padding:11px 14px"><b style="color:#2563eb;cursor:pointer" onclick="openStockDetail('${jsStr(item.stock_code)}')">${escapeHtml(item.stock_name)}</b> <span style="font-size:11.5px;color:var(--sys-text-sub, #94a3b8)">(${escapeHtml(item.stock_code)})</span></td>
              <td style="padding:11px 14px"><span style="background:rgba(37,99,235,0.08);color:#2563eb;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:600">${escapeHtml(item.sector_name || '核心主线')}</span></td>
              <td style="padding:11px 14px;font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--sys-text-primary, #1e293b)">${item.close_price ? '¥' + parseFloat(item.close_price).toFixed(2) : '--'}</td>
              <td style="padding:11px 14px;color:${chgColor};font-weight:800;font-family:'JetBrains Mono',monospace">${chgText}</td>
              <td style="padding:11px 14px;font-family:'JetBrains Mono',monospace;color:#d97706;font-weight:600">${item.turnover_rate ? parseFloat(item.turnover_rate).toFixed(2) + '%' : '--'}</td>
              <td style="padding:11px 14px"><span style="background:rgba(100,116,139,0.08);color:var(--sys-text-primary, #334155);padding:3px 8px;border-radius:4px;font-size:11.5px;border:1px solid rgba(100,116,139,0.18);font-weight:600">${cleanAttr}</span></td>
              <td style="padding:11px 14px"><span style="background:rgba(16,185,129,0.1);color:#059669;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:800;border:1px solid rgba(16,185,129,0.25)">${Math.round(conf * 100)}%</span></td>
              <td style="padding:11px 14px;text-align:center;white-space:nowrap">
                <button class="btn btn-outline" style="padding:4px 9px;font-size:11.5px;font-weight:700;color:#2563eb;border-color:rgba(37,99,235,0.35);background:rgba(37,99,235,0.06);cursor:pointer;display:inline-flex;align-items:center;gap:4px;border-radius:5px" onclick="openStockResearchModal('${jsStr(item.stock_code)}')">
                  <i class="ri-newspaper-line"></i>
                  <span>查催化研报</span>
                </button>
                <button class="btn btn-outline" style="font-size:12px;padding:3px 8px;background:rgba(16,185,129,0.1);border-color:rgba(16,185,129,0.35);color:#10b981;cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-left:6px" onclick="jumpToSingleStockBacktest('${jsStr(item.stock_code)}')" title="一键将该标的带入【🔬 任意单股战法体检室】进行真实历史战法回测与胜率检验">
                  <i class="ri-flask-line"></i>
                  <span>战法体检</span>
                </button>
                <button class="el-button el-button--primary is-plain" style="padding:4px 9px;height:auto;font-size:11.5px;font-weight:700;border-radius:5px;background:rgba(37,99,235,0.1);border-color:rgba(37,99,235,0.35);color:#2563eb;cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-left:6px" onclick="jumpToAlphaCalc('${jsStr(item.stock_code)}')" title="一键转入 Alpha 盘中实战测算器">
                  <i class="ri-crosshair-2-line"></i>
                  <span>Alpha 测算</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:25px;color:#ef4444">逻辑归因加载异常: ${e.message}</td></tr>`;
  }
}
window.loadAttributionTableData = loadAttributionTableData;



window.renderAttributionAgentPanel = renderAttributionAgentPanel;