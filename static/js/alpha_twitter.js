/**
 * 系统一：Alpha 决策工作台 - 🐦 X (Twitter) 顶级博主实时情报雷达控制器
 * 职责：负责推特关注流拉取、卡片渲染、题材高亮、中英翻译双向切换、即时重译与凭据模态框管理
 */

// ==================== 🐦 X (Twitter) 顶级博主实时情报雷达控制器 ====================

let _twitterEngineStatus = null;
let _twitterCurrentPage = 1;
const _twitterPageSize = 12;
let _twitterKeyword = '';
let _twitterOnlyStocks = false;
let _twitterTotalPages = 1;

async function loadTwitterRadar(forceRefresh = false) {
  const grid = document.getElementById('twitterTweetsGrid');
  const badge = document.getElementById('twitterStatusBadge');
  const noticeText = document.getElementById('twitterNoticeText');
  const updateTime = document.getElementById('twitterLastUpdateTime');
  const pillsContainer = document.getElementById('twitterMonitoredUsersPills');
  const refreshBtn = document.getElementById('twitterRefreshBtn');
  const dbCountText = document.getElementById('dbCountText');
  const totalTweetPill = document.getElementById('totalTweetPill');
  const stockTweetPill = document.getElementById('stockTweetPill');

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="ri-loader-4-line spin" style="display:inline-block;animation:spin 1s linear infinite"></i> <span>正在拉取海外大V...</span>';
  }

  if (grid && !grid.children.length) {
    grid.innerHTML = '<div style="color:var(--sys-text-sub);text-align:center;padding:40px;grid-column:1/-1"><span class="spinner"></span> 正在通过本地代理连接 Twitter 关注情报雷达...</div>';
  }

  try {
    const kwParam = encodeURIComponent(_twitterKeyword.trim());
    const url = `/api/twitter/tweets?page=${_twitterCurrentPage}&page_size=${_twitterPageSize}&keyword=${kwParam}&only_stocks=${_twitterOnlyStocks}&force_refresh=${forceRefresh ? 'true' : 'false'}`;
    const res = await authFetch(url);
    const data = await res.json();

    if (!res.ok) {
      if (grid) grid.innerHTML = `<div style="color:#f85149;padding:30px;grid-column:1/-1;text-align:center">拉取推特情报失败: ${data.detail || '接口异常'}</div>`;
      return;
    }

    const tweets = data.tweets || [];
    _twitterEngineStatus = data.engine_status || {};
    _twitterTotalPages = data.total_pages || 1;
    _twitterCurrentPage = data.page || 1;

    const authState = _twitterEngineStatus.auth_state || (_twitterEngineStatus.has_auth ? 'online' : 'unconfigured');

    // 1. 更新顶部状态徽章 (对齐东财规范)
    if (badge) {
      if (authState === 'online') {
        badge.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#3fb950;margin-right:2px"></span> 实时关注流在线';
        badge.style.background = 'rgba(63,185,80,0.15)';
        badge.style.color = '#3fb950';
        badge.style.border = '1px solid rgba(63,185,80,0.3)';
        badge.title = '推特凭证有效，正在以毫秒级通道监听您关注的海外大V发推 (点击可查看或重测)';
      } else if (authState === 'expired') {
        badge.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f85149;margin-right:2px;animation:pulse 1.2s infinite"></span> 🔴 Cookie 已失效 (点击更新)';
        badge.style.background = 'rgba(248,81,73,0.18)';
        badge.style.color = '#f85149';
        badge.style.border = '1px solid rgba(248,81,73,0.4)';
        badge.title = '推特会话已失效 (401)，点击立即重新粘贴 Cookie 恢复监听';
      } else if (authState === 'network_error') {
        badge.innerHTML = '🟠 代理异常 (检查7897)';
        badge.style.background = 'rgba(230,162,60,0.15)';
        badge.style.color = '#e6a23c';
        badge.style.border = '1px solid rgba(230,162,60,0.3)';
        badge.title = '本地代理 127.0.0.1:7897 连接失败，请检查客户端开启状态';
      } else {
        badge.innerHTML = '⚪ 演示模式 (待配Cookie)';
        badge.style.background = 'rgba(110,118,129,0.15)';
        badge.style.color = 'var(--sys-text-sub)';
        badge.style.border = '1px solid var(--sys-border)';
        badge.title = '当前以精选大V样本演示，填入 Cookie 即可实时同步关注流';
      }
    }

    // 2. 更新本地数据库统计与数据新鲜度
    const dbTotal = _twitterEngineStatus.db_total_count || data.total || 0;
    const dbStocks = _twitterEngineStatus.db_stock_count || 0;
    if (dbCountText) dbCountText.textContent = dbTotal.toLocaleString();
    if (totalTweetPill) totalTweetPill.textContent = dbTotal;
    if (stockTweetPill) stockTweetPill.textContent = dbStocks;

    if (updateTime) {
      const syncTime = _twitterEngineStatus.last_fetch_time || '刚刚';
      const tweetRelTime = _twitterEngineStatus.latest_tweet_relative;
      if (tweetRelTime && tweetRelTime !== '暂无数据') {
        updateTime.innerHTML = `<span>上次同步: ${syncTime}</span> <span style="opacity:0.4">|</span> <span style="color:var(--sys-accent)">最新推文: ${tweetRelTime}</span>`;
      } else {
        updateTime.innerHTML = `<span>上次同步: ${syncTime}</span>`;
      }
    }

    if (noticeText) {
      if (authState === 'online') {
        const freshness = _twitterEngineStatus.data_freshness_desc || '关注流极速更新中';
        noticeText.innerHTML = `<i class="ri-checkbox-circle-fill" style="color:#3fb950;font-size:16px"></i> <span>推特直连在线：<b>${freshness}</b>。所有抓取推文已永久归档至 SQLite 数据库。</span>`;
      } else if (authState === 'expired') {
        noticeText.innerHTML = `<i class="ri-error-warning-fill" style="color:#f85149;font-size:16px"></i> <span style="color:#f85149"><b>⚠️ 凭据已过期：</b>推特登录 Cookie 已失效，当前为您展示本地已归档推文。<a href="javascript:void(0)" onclick="openTwitterConfigModal()" style="color:#f85149;text-decoration:underline;font-weight:700;margin-left:4px">点击此处 10秒重新填入 Cookie</a> 即可恢复实时抓取！</span>`;
      } else if (authState === 'network_error') {
        noticeText.innerHTML = `<i class="ri-alert-line" style="color:#e6a23c;font-size:16px"></i> <span><b>⚠️ 本地代理连接异常：</b>请确认 Clash Verge 或 Mihomo 已启动，并在本地监听端口 7897。</span>`;
      } else {
        noticeText.innerHTML = '<i class="ri-information-line" style="color:#e6a23c;font-size:16px"></i> <span>当前以<b>海外精选科技/金融博主样本</b>演示。点击右上角【⚙️ 推特配置与凭证】填入 Cookie 即可实时监听！</span>';
      }
    }

    // 3. 更新监控博主胶囊
    if (pillsContainer && _twitterEngineStatus.monitored_users) {
      pillsContainer.innerHTML = _twitterEngineStatus.monitored_users.map(u => 
        `<span style="padding:2px 8px;border-radius:4px;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.25);color:var(--sys-text-primary);font-weight:600">@${u}</span>`
      ).join(' ');
    }

    // 4. 渲染情报流卡片 (包含股票提炼标星高亮)
    if (tweets.length === 0) {
      if (grid) {
        grid.innerHTML = `
          <div style="color:var(--sys-text-sub);padding:50px 20px;grid-column:1/-1;text-align:center">
            <i class="ri-inbox-archive-line" style="font-size:36px;display:block;margin-bottom:8px;opacity:0.5"></i>
            <div>未检索到符合条件的推特情报</div>
            ${_twitterKeyword ? `<div style="font-size:12px;margin-top:6px">关键词【${_twitterKeyword}】暂无匹配推文，请尝试清除搜索或点击上方【追溯半月历史】从推特拉取更早历史。</div>` : ''}
          </div>
        `;
      }
      renderTwitterPagination(data.total || 0, data.page || 1, data.total_pages || 1);
      return;
    }

    if (grid) {
      grid.innerHTML = tweets.map(tw => {
        const isDemo = tw.is_demo;
        const hasStock = tw.has_stock_mention;
        const mentStocks = tw.mentioned_stocks || [];

        // 标星与来源徽章
        const sourceBadge = isDemo
          ? '<span style="background:rgba(230,162,60,0.12);color:#e6a23c;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600">💡 演示</span>'
          : '<span style="background:rgba(63,185,80,0.12);color:#3fb950;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600">🟢 真实发推</span>';

        // ⭐️ 股票高亮标星胶囊
        const stockStarBadge = hasStock ? `
          <span style="background:linear-gradient(135deg, rgba(245,158,11,0.2), rgba(217,119,6,0.25));color:#d97706;border:1px solid rgba(245,158,11,0.5);font-size:10px;padding:2px 8px;border-radius:12px;font-weight:700;display:inline-flex;align-items:center;gap:3px;box-shadow:0 0 8px rgba(245,158,11,0.2)">
            ⭐ 核心提股: ${mentStocks.map(s => s.name || s.symbol).join(', ') || '重点标的'}
          </span>
        ` : '';

        // 卡片边框样式：提及股票时呈现尊贵金色边框微光
        const cardBorderStyle = hasStock
          ? 'border:1px solid rgba(245,158,11,0.45);background:linear-gradient(180deg, rgba(245,158,11,0.03) 0%, var(--sys-bg-card-inner) 100%);box-shadow:0 4px 16px rgba(245,158,11,0.08);'
          : 'border:1px solid var(--sys-border);background:var(--sys-bg-card-inner);box-shadow:var(--sys-shadow-card);';

        const stocksPills = (tw.related_stocks || []).map(s => {
          const isDirect = mentStocks.some(m => m.symbol === s.symbol);
          const pillBg = isDirect ? 'background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);color:#d97706;' : 'background:rgba(9,105,218,0.1);border:1px solid rgba(9,105,218,0.25);color:var(--sys-accent);';
          return `
            <button class="btn" style="width:auto;padding:3px 8px;font-size:11px;border-radius:4px;cursor:pointer;${pillBg}" onclick="quickJumpToCalculate('${s.symbol}')" title="${s.desc || ''}">
              ${isDirect ? '⭐ ' : ''}<b>${s.name}</b> <span style="font-size:10px;opacity:0.8">${s.symbol}</span>
            </button>
          `;
        }).join(' ');

        const firstStock = (tw.related_stocks && tw.related_stocks.length > 0) ? tw.related_stocks[0].symbol : '510300';

        // 语言与翻译检测 (参考 GitHub 开源 twitter-translator 与 X 官方规范)
        const rawText = (tw.text_raw || '').trim();
        const transText = (tw.text_translated || '').trim();
        const chineseChars = (rawText.match(/[\u4e00-\u9fa5]/g) || []).length;
        const isForeign = (rawText.length > 8 && chineseChars / rawText.length < 0.35) || (transText && transText !== rawText);

        // 正文中股票名高亮展示辅助函数
        function highlightStocks(text) {
          if (!text) return '';
          let res = text;
          if (mentStocks.length > 0) {
            mentStocks.forEach(ms => {
              const sym = ms.symbol;
              const nm = ms.name;
              if (sym && sym.length >= 2) {
                const reg = new RegExp(`(\\$?${sym})`, 'gi');
                res = res.replace(reg, `<span style="background:rgba(245,158,11,0.25);color:#d97706;padding:1px 4px;border-radius:3px;font-weight:700">$1</span>`);
              }
              if (nm && nm !== `$${sym}` && nm.length >= 2) {
                const reg2 = new RegExp(`(${nm})`, 'g');
                res = res.replace(reg2, `<span style="background:rgba(245,158,11,0.25);color:#d97706;padding:1px 4px;border-radius:3px;font-weight:700">$1</span>`);
              }
            });
          }
          return res;
        }

        const transHighlighted = highlightStocks(transText || rawText);
        const rawHighlighted = highlightStocks(rawText);

        // 构造安全健壮的推特原文链接
        let tweetUrl = (tw.tweet_url || '').trim();
        if (!tweetUrl || tweetUrl === 'undefined' || !tweetUrl.startsWith('http')) {
          const cleanHandle = (tw.author_handle || '').replace('@', '').trim() || 'x';
          tweetUrl = tw.id ? `https://x.com/${cleanHandle}/status/${tw.id}` : `https://x.com/${cleanHandle}`;
        }

        // 🌐 翻译工具栏 (仅对外文或有翻译结果的推文展示，支持双向切换与重新翻译)
        const translationToolbar = isForeign ? `
          <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(29,155,240,0.06);border:1px solid rgba(29,155,240,0.2);padding:4px 10px;border-radius:6px;margin-bottom:8px;font-size:11px">
            <div style="display:flex;align-items:center;gap:6px;color:#1d9bf0;font-weight:600">
              <i class="ri-translate-2"></i>
              <span id="tw-trans-state-${tw.id}">已翻译为中文</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <button type="button" class="btn" id="tw-trans-toggle-${tw.id}" onclick="event.stopPropagation(); toggleTwitterCardTranslation('${tw.id}')" style="width:auto;padding:2px 8px;font-size:11px;background:#fff;border:1px solid #1d9bf0;color:#1d9bf0;border-radius:4px;cursor:pointer" title="在中文译文与英文原文之间一键切换">
                <i class="ri-global-line"></i> 查看英文原文
              </button>
              <button type="button" class="btn" id="tw-retrans-btn-${tw.id}" onclick="event.stopPropagation(); retranslateTwitterTweet('${tw.id}', event)" style="width:auto;padding:2px 8px;font-size:11px;background:rgba(29,155,240,0.12);border:1px solid rgba(29,155,240,0.3);color:#1d9bf0;border-radius:4px;cursor:pointer" title="调用 Google/DeepL 即时重新翻译并回存数据库">
                <i class="ri-refresh-line"></i> 重新翻译
              </button>
            </div>
          </div>
        ` : '';

        return `
          <div id="tw-card-${tw.id}" data-mode="trans" data-raw="${encodeURIComponent(rawHighlighted)}" data-trans="${encodeURIComponent(transHighlighted)}" style="${cardBorderStyle}border-radius:10px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;transition:transform 0.2s, box-shadow 0.2s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
            <div>
              <!-- 头部：博主头像与昵称及原文跳转按钮 -->
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                <div style="display:flex;align-items:center;gap:10px">
                  <a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" title="查看该推文原文">
                    <img src="${tw.author_avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'}" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid var(--sys-border);cursor:pointer">
                  </a>
                  <div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <b style="font-size:15px;color:var(--sys-text-title);cursor:pointer" onclick="window.open('${tweetUrl}', '_blank')">${tw.author_name}</b>
                      ${sourceBadge}
                      ${stockStarBadge}
                    </div>
                    <a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:var(--sys-text-sub);text-decoration:none;display:inline-flex;align-items:center;gap:2px" title="新标签页查看作者与原文">
                      ${tw.author_handle} · <span>${tw.relative_time || '刚刚'}</span>
                    </a>
                  </div>
                </div>

                <!-- 右侧：推特原文直达按钮与点赞统计 -->
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--sys-text-sub);margin-right:2px">
                    <span title="点赞数">❤️ ${(tw.likes || 0).toLocaleString()}</span>
                    <span title="转推数">🔁 ${(tw.retweets || 0).toLocaleString()}</span>
                  </div>
                  <a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" 
                     style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;font-size:11px;font-weight:600;border-radius:4px;background:#f0f2f5;color:#1d9bf0;border:1px solid #dcdfe6;text-decoration:none;transition:all 0.2s" 
                     onmouseover="this.style.background='#1d9bf0';this.style.color='#fff';this.style.borderColor='#1d9bf0'" 
                     onmouseout="this.style.background='#f0f2f5';this.style.color='#1d9bf0';this.style.borderColor='#dcdfe6'"
                     title="在新标签页中打开该条推文原文">
                    <i class="ri-twitter-x-line"></i> <span>原文 ↗</span>
                  </a>
                </div>
              </div>

              <!-- 🌐 翻译工具条 (GitHub twitter-translator 风格) -->
              ${translationToolbar}

              <!-- 推特正文 (醒目突出，点击直接新标签页跳转推特原文) -->
              <div onclick="window.open('${tweetUrl}', '_blank')" 
                   style="font-size:14px;line-height:1.6;color:var(--sys-text-title);font-weight:500;margin-bottom:8px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:6px;border-left:3px solid ${hasStock ? '#f59e0b' : 'var(--sys-accent)'};cursor:pointer;transition:background 0.2s"
                   onmouseover="this.style.background='rgba(29,155,240,0.06)'"
                   onmouseout="this.style.background='rgba(255,255,255,0.03)'"
                   title="点击直接在推特打开该条推文">
                <div id="tw-text-content-${tw.id}">${transHighlighted}</div>
                <div style="display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-top:6px;font-size:11px;color:#1d9bf0;opacity:0.85">
                  <i class="ri-external-link-line"></i> 点击直达推特原文
                </div>
              </div>

              <!-- 原文对照 (小号弱化，点击亦可直达推特原文) -->
              <div id="tw-subtext-container-${tw.id}"
                   onclick="window.open('${tweetUrl}', '_blank')" 
                   style="font-size:12px;line-height:1.4;color:var(--sys-text-sub);margin-bottom:12px;font-style:italic;cursor:pointer;${isForeign ? '' : 'display:none'}" 
                   title="点击直接在推特打开该条推文">
                "${tw.text_raw}"
              </div>
            </div>

            <!-- 底部：关联 A 股概念与标的胶囊 -->
            <div style="border-top:1px dashed var(--sys-border);padding-top:10px;margin-top:4px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:11px;color:var(--sys-text-sub);font-weight:600">
                  🎯 映射题材：<span style="color:#e6a23c">${tw.related_concept || '海外科技催化'}</span>
                </span>
                <button class="btn btn-blue" style="width:auto;padding:3px 10px;font-size:11px;font-weight:600" onclick="quickJumpToCalculate('${firstStock}')">
                  🧮 测算买卖点
                </button>
              </div>

              <!-- 标的列表 -->
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${stocksPills}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // 5. 渲染 Element Plus 经典分页器
    renderTwitterPagination(data.total || 0, _twitterCurrentPage, _twitterTotalPages);

  } catch (e) {
    if (grid) grid.innerHTML = `<div style="color:#f85149;padding:30px;grid-column:1/-1;text-align:center">请求推特雷达异常: ${e.message}</div>`;
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="ri-refresh-line"></i> <span>立即拉取最新推文</span>';
    }
  }
}

// ==================== 🌐 推特卡片中英文切换与实时重译交互函数 ====================

/**
 * 切换推文卡片的中英文视图
 * @param {string} tweetId 推文唯一ID
 */
window.toggleTwitterCardTranslation = function(tweetId) {
  const card = document.getElementById(`tw-card-${tweetId}`);
  if (!card) return;
  const currentMode = card.getAttribute('data-mode') || 'trans';
  const rawText = decodeURIComponent(card.getAttribute('data-raw') || '');
  const transText = decodeURIComponent(card.getAttribute('data-trans') || '');
  const contentEl = document.getElementById(`tw-text-content-${tweetId}`);
  const stateEl = document.getElementById(`tw-trans-state-${tweetId}`);
  const toggleBtn = document.getElementById(`tw-trans-toggle-${tweetId}`);
  const subTextEl = document.getElementById(`tw-subtext-container-${tweetId}`);

  if (currentMode === 'trans') {
    // 当前为中文译文 -> 切换为英文原文
    card.setAttribute('data-mode', 'raw');
    if (contentEl) contentEl.innerHTML = rawText;
    if (stateEl) stateEl.innerHTML = '<span style="color:var(--sys-text-sub)">🔤 显示英文原文</span>';
    if (toggleBtn) toggleBtn.innerHTML = '<i class="ri-translate-2"></i> 查看中文译文';
    if (subTextEl) subTextEl.style.display = 'none';
  } else {
    // 当前为英文原文 -> 切换为中文译文
    card.setAttribute('data-mode', 'trans');
    if (contentEl) contentEl.innerHTML = transText;
    if (stateEl) stateEl.innerHTML = '已翻译为中文';
    if (toggleBtn) toggleBtn.innerHTML = '<i class="ri-global-line"></i> 查看英文原文';
    if (subTextEl) subTextEl.style.display = 'block';
  }
};

/**
 * 重新调用 Google/DeepL 翻译该条推文并更新本地数据库
 * @param {string} tweetId 推文唯一ID
 * @param {Event} event 点击事件
 */
window.retranslateTwitterTweet = async function(tweetId, event) {
  if (event) event.stopPropagation();
  const card = document.getElementById(`tw-card-${tweetId}`);
  const retransBtn = document.getElementById(`tw-retrans-btn-${tweetId}`);
  const contentEl = document.getElementById(`tw-text-content-${tweetId}`);
  const stateEl = document.getElementById(`tw-trans-state-${tweetId}`);
  const toggleBtn = document.getElementById(`tw-trans-toggle-${tweetId}`);

  if (!card || !retransBtn) return;

  const origBtnHtml = retransBtn.innerHTML;
  try {
    retransBtn.disabled = true;
    retransBtn.innerHTML = '<i class="ri-loader-4-line" style="display:inline-block;animation:spin 1s linear infinite"></i> 翻译中...';

    const resp = await fetch('/api/twitter/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweet_id: tweetId })
    });
    const res = await resp.json();

    if (res.status === 'ok' && res.text_translated) {
      const newTrans = res.text_translated;
      card.setAttribute('data-trans', encodeURIComponent(newTrans));
      card.setAttribute('data-mode', 'trans');
      if (contentEl) contentEl.innerHTML = newTrans;
      if (stateEl) stateEl.innerHTML = '<span style="color:#3fb950">✅ 翻译已更新</span>';
      if (toggleBtn) toggleBtn.innerHTML = '<i class="ri-global-line"></i> 查看英文原文';

      retransBtn.innerHTML = '<i class="ri-check-line"></i> 已完成';
      setTimeout(() => {
        retransBtn.innerHTML = origBtnHtml;
        retransBtn.disabled = false;
      }, 2000);
    } else {
      alert('重新翻译未果: ' + (res.message || '翻译通道无响应'));
      retransBtn.innerHTML = origBtnHtml;
      retransBtn.disabled = false;
    }
  } catch (err) {
    console.error('翻译推文异常:', err);
    alert('请求翻译服务异常: ' + err.message);
    retransBtn.innerHTML = origBtnHtml;
    retransBtn.disabled = false;
  }
};

// 渲染 Element Plus 官方规范推特分页器
function renderTwitterPagination(total, page, totalPages) {
  const infoEl = document.getElementById('twitterPaginationInfo');
  const mountEl = document.getElementById('twitterPaginationMount');

  if (infoEl) {
    infoEl.innerHTML = `共收录 <b id="pageTotalCount" style="color:var(--sys-text-primary);font-weight:700">${total}</b> 条推文情报 · 当前第 <b id="pageCurrentNum" style="color:var(--sys-accent);font-weight:700">${page}</b> / <span id="pageTotalPages">${totalPages}</span> 页`;
  }

  if (!mountEl) return;

  if (totalPages <= 1) {
    mountEl.innerHTML = `
      <div class="el-pagination is-background">
        <span class="el-pagination__total">共 ${total} 条</span>
      </div>
    `;
    return;
  }

  let html = `<div class="el-pagination is-background">`;

  // 1. 总条数统计 (Element Plus 官方 total 规范)
  html += `<span class="el-pagination__total">共 ${total} 条</span>`;

  // 2. 上一页按钮
  const prevDisabled = page <= 1 ? 'disabled' : '';
  html += `
    <button type="button" class="btn-prev" ${prevDisabled} onclick="jumpTwitterPage(${page - 1})" title="上一页">
      <i class="ri-arrow-left-s-line"></i>
    </button>
  `;

  // 3. 经典 Pager 页码列表 (带省略号与快进快退)
  html += `<ul class="el-pager">`;

  if (totalPages <= 7) {
    // 总页数较少时完整显示所有页码
    for (let p = 1; p <= totalPages; p++) {
      html += `<li class="number ${p === page ? 'is-active' : ''}" onclick="jumpTwitterPage(${p})">${p}</li>`;
    }
  } else {
    // 总页数较多时，采用 Element Plus 折叠分页算法
    const showPrevMore = page > 4;
    const showNextMore = page < totalPages - 3;

    // 永远固定显示第 1 页
    html += `<li class="number ${page === 1 ? 'is-active' : ''}" onclick="jumpTwitterPage(1)">1</li>`;

    // 前向省略号 (点击向前快跳 5 页)
    if (showPrevMore) {
      html += `<li class="more btn-quickprev" onclick="jumpTwitterPage(${Math.max(1, page - 5)})" title="向前跳 5 页">···</li>`;
    }

    // 中间动态页码段
    let startP = 2;
    let endP = totalPages - 1;

    if (showPrevMore && !showNextMore) {
      // 靠近尾部
      startP = totalPages - 4;
      endP = totalPages - 1;
    } else if (!showPrevMore && showNextMore) {
      // 靠近头部
      startP = 2;
      endP = 5;
    } else if (showPrevMore && showNextMore) {
      // 居中
      startP = page - 1;
      endP = page + 1;
    }

    for (let p = startP; p <= endP; p++) {
      html += `<li class="number ${p === page ? 'is-active' : ''}" onclick="jumpTwitterPage(${p})">${p}</li>`;
    }

    // 后向省略号 (点击向后快跳 5 页)
    if (showNextMore) {
      html += `<li class="more btn-quicknext" onclick="jumpTwitterPage(${Math.min(totalPages, page + 5)})" title="向后跳 5 页">···</li>`;
    }

    // 永远固定显示最后 1 页
    html += `<li class="number ${page === totalPages ? 'is-active' : ''}" onclick="jumpTwitterPage(${totalPages})">${totalPages}</li>`;
  }

  html += `</ul>`;

  // 4. 下一页按钮
  const nextDisabled = page >= totalPages ? 'disabled' : '';
  html += `
    <button type="button" class="btn-next" ${nextDisabled} onclick="jumpTwitterPage(${page + 1})" title="下一页">
      <i class="ri-arrow-right-s-line"></i>
    </button>
  `;

  // 5. 前往指定页输入框 Jumper
  html += `
    <span class="el-pagination__jump">
      前往
      <input type="number" class="el-pagination__editor" min="1" max="${totalPages}" value="${page}" 
        onkeydown="if(event.key==='Enter'){ const v = Math.min(${totalPages}, Math.max(1, parseInt(this.value)||1)); jumpTwitterPage(v); }" 
        onblur="const v = Math.min(${totalPages}, Math.max(1, parseInt(this.value)||1)); if(v !== ${page}) jumpTwitterPage(v);" />
      页
    </span>
  `;

  html += `</div>`;
  mountEl.innerHTML = html;
}

// 统一跳页并平滑置顶
function jumpTwitterPage(p) {
  if (p >= 1 && p <= _twitterTotalPages && p !== _twitterCurrentPage) {
    _twitterCurrentPage = p;
    loadTwitterRadar(false);
    const gridEl = document.getElementById('twitterTweetsGrid');
    if (gridEl) {
      gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

// 翻页兼容方法
function changeTwitterPage(delta) {
  const targetPage = _twitterCurrentPage + delta;
  jumpTwitterPage(targetPage);
}

// 执行搜索
function doSearchTwitter() {
  const kwInput = document.getElementById('twitterSearchKeyword');
  _twitterKeyword = kwInput ? kwInput.value.trim() : '';
  _twitterCurrentPage = 1;
  loadTwitterRadar(false);
}

// 切换股票标星过滤
function setTwitterStockFilter(onlyStocks) {
  _twitterOnlyStocks = onlyStocks;
  _twitterCurrentPage = 1;

  const allBtn = document.getElementById('filterAllBtn');
  const stockBtn = document.getElementById('filterStocksOnlyBtn');

  if (onlyStocks) {
    if (allBtn) {
      allBtn.className = 'btn btn-outline';
      allBtn.style.color = 'var(--sys-text-sub)';
      allBtn.style.background = 'transparent';
    }
    if (stockBtn) {
      stockBtn.className = 'btn btn-blue';
      stockBtn.style.color = '#fff';
      stockBtn.style.background = '#d97706';
      stockBtn.style.borderColor = '#d97706';
    }
  } else {
    if (allBtn) {
      allBtn.className = 'btn btn-blue';
      allBtn.style.color = '#fff';
      allBtn.style.background = '';
    }
    if (stockBtn) {
      stockBtn.className = 'btn btn-outline';
      stockBtn.style.color = '#d97706';
      stockBtn.style.background = 'rgba(217,119,6,0.06)';
      stockBtn.style.borderColor = 'rgba(217,119,6,0.35)';
    }
  }

  loadTwitterRadar(false);
}

// 深度追溯半个月历史推文并归档入库
async function fetchTwitterDeepHistory() {
  const btn = document.getElementById('twitterDeepFetchBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin" style="display:inline-block;animation:spin 1s linear infinite"></i> 正在追溯半个月历史...';
  }

  try {
    const res = await authFetch('/api/twitter/fetch-deep-history?pages=3', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.code === 200) {
      showSystemToast(`🎉 ${data.message || '历史推文已深度追溯归档！'}`, 'success');
      _twitterCurrentPage = 1;
      await loadTwitterRadar(false);
    } else {
      showSystemToast(`⚠️ 深度追溯提示: ${data.message || data.detail || '拉取未果'}`, 'warning');
    }
  } catch (e) {
    showSystemToast(`深度追溯异常: ${e.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-history-line"></i> <span>追溯半月历史</span>';
    }
  }
}

// 兼容老调用别名
async function loadSocialBuzz() {
  return loadTwitterRadar(false);
}

// ==================== 推特凭证配置模态框交互 ====================

async function openTwitterConfigModal() {
  const modal = document.getElementById('twitterConfigModal');
  const diagEl = document.getElementById('twitterDiagResult');
  if (diagEl) diagEl.style.display = 'none';

  if (modal) modal.style.display = 'flex';

  try {
    const res = await authFetch('/api/twitter/status');
    const data = await res.json();
    if (res.ok && data.data) {
      const cfg = data.data;
      const tokenInput = document.getElementById('inputTwitterAuthToken');
      const ct0Input = document.getElementById('inputTwitterCt0');
      const usersInput = document.getElementById('inputTwitterUsers');
      const proxyInput = document.getElementById('inputTwitterProxy');

      if (tokenInput && cfg.auth_token_masked) {
        tokenInput.placeholder = `已配置: ${cfg.auth_token_masked}（如需更换请重新粘贴）`;
      }
      if (usersInput && cfg.monitored_users) {
        usersInput.value = cfg.monitored_users.join(', ');
      }
      if (proxyInput && cfg.proxy_url) {
        proxyInput.value = cfg.proxy_url;
      }
    }
  } catch (e) {
    console.error('获取推特配置异常:', e);
  }
}

function closeTwitterConfigModal() {
  const modal = document.getElementById('twitterConfigModal');
  if (modal) modal.style.display = 'none';
}

async function testTwitterConnectionInModal() {
  const btn = document.getElementById('btnTestTwitter');
  const diagEl = document.getElementById('twitterDiagResult');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin" style="display:inline-block;animation:spin 1s linear infinite"></i> 正在安全诊断中...';
  }
  if (diagEl) {
    diagEl.style.display = 'block';
    diagEl.style.background = 'rgba(88,166,255,0.08)';
    diagEl.style.border = '1px solid rgba(88,166,255,0.2)';
    diagEl.style.color = 'var(--sys-text-primary)';
    diagEl.innerHTML = '正在通过本地代理测试与推特的连通性，请稍候...';
  }

  try {
    const res = await authFetch('/api/twitter/test-connection', { method: 'POST' });
    const data = await res.json();
    const d = data.diagnostics || {};

    if (diagEl) {
      if (d.auth_valid) {
        diagEl.style.background = 'rgba(63,185,80,0.12)';
        diagEl.style.border = '1px solid rgba(63,185,80,0.3)';
        diagEl.style.color = '#3fb950';
        diagEl.innerHTML = `<b>${d.message}</b>`;
      } else if (d.proxy_connected && d.twitter_reachable) {
        diagEl.style.background = 'rgba(230,162,60,0.12)';
        diagEl.style.border = '1px solid rgba(230,162,60,0.3)';
        diagEl.style.color = '#e6a23c';
        diagEl.innerHTML = `<b>${d.message}</b>`;
      } else {
        diagEl.style.background = 'rgba(248,81,73,0.12)';
        diagEl.style.border = '1px solid rgba(248,81,73,0.3)';
        diagEl.style.color = '#f85149';
        diagEl.innerHTML = `<b>诊断异常：</b>${d.message || '无法连接推特'}`;
      }
    }
  } catch (e) {
    if (diagEl) {
      diagEl.style.background = 'rgba(248,81,73,0.12)';
      diagEl.style.border = '1px solid rgba(248,81,73,0.3)';
      diagEl.style.color = '#f85149';
      diagEl.innerHTML = `测试请求异常: ${e.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-pulse-line"></i> 连通性深度诊断';
    }
  }
}

function handleTwitterFullCookieInput(fullCookieText) {
  if (!fullCookieText || !fullCookieText.trim()) return;
  const raw = fullCookieText.trim();
  const tokenInput = document.getElementById('inputTwitterAuthToken');
  const ct0Input = document.getElementById('inputTwitterCt0');

  let extractedCount = 0;
  // 智能提取 auth_token
  const authMatch = raw.match(/auth_token=([^;\s]+)/i);
  if (authMatch && authMatch[1]) {
    if (tokenInput) {
      tokenInput.value = authMatch[1];
      tokenInput.style.borderColor = '#3fb950';
    }
    extractedCount++;
  }

  // 智能提取 ct0
  const ct0Match = raw.match(/ct0=([^;\s]+)/i);
  if (ct0Match && ct0Match[1]) {
    if (ct0Input) {
      ct0Input.value = ct0Match[1];
      ct0Input.style.borderColor = '#3fb950';
    }
    extractedCount++;
  }

  if (extractedCount > 0) {
    showToast(`⚡ 成功自动提取 ${extractedCount} 项推特核心凭证！`, 'success');
  }
}

async function saveTwitterConfigFromModal() {
  const btn = document.getElementById('btnSaveTwitter');
  const fullCookieInput = document.getElementById('inputTwitterFullCookie');
  const tokenInput = document.getElementById('inputTwitterAuthToken');
  const ct0Input = document.getElementById('inputTwitterCt0');
  const usersInput = document.getElementById('inputTwitterUsers');
  const proxyInput = document.getElementById('inputTwitterProxy');

  const payload = {};
  if (fullCookieInput && fullCookieInput.value.trim()) payload.full_cookie = fullCookieInput.value.trim();
  if (tokenInput && tokenInput.value.trim()) payload.auth_token = tokenInput.value.trim();
  if (ct0Input && ct0Input.value.trim()) payload.ct0 = ct0Input.value.trim();
  if (usersInput && usersInput.value.trim()) {
    payload.monitored_users = usersInput.value.split(/[,，]/).map(u => u.trim()).filter(Boolean);
  }
  if (proxyInput && proxyInput.value.trim()) payload.proxy_url = proxyInput.value.trim();

  if (btn) {
    btn.disabled = true;
    btn.innerText = '正在保存与探活自愈...';
  }

  try {
    const res = await authFetch('/api/twitter/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('🎉 推特监控凭据已热载更新，自愈探活成功！', 'success');
      closeTwitterConfigModal();
      loadTwitterRadar(true);
    } else {
      showToast(data.detail || '保存配置失败', 'error');
    }
  } catch (e) {
    showToast('保存异常: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '保存并启用';
    }
  }
}

// 暴露全局
window.loadTwitterRadar = loadTwitterRadar;
window.openTwitterConfigModal = openTwitterConfigModal;
window.closeTwitterConfigModal = closeTwitterConfigModal;
window.testTwitterConnectionInModal = testTwitterConnectionInModal;
window.saveTwitterConfigFromModal = saveTwitterConfigFromModal;
window.handleTwitterFullCookieInput = handleTwitterFullCookieInput;


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



// 显式导出推特雷达全局函数与状态，确保 HTML 内联事件 100% 正常调用
window.loadTwitterRadar = loadTwitterRadar;
window.renderTwitterPagination = renderTwitterPagination;
window.toggleTwitterCardTranslation = toggleTwitterCardTranslation;
window.retranslateTwitterTweet = retranslateTwitterTweet;
window.jumpTwitterPage = jumpTwitterPage;
window.openTwitterConfigModal = openTwitterConfigModal;
window.closeTwitterConfigModal = closeTwitterConfigModal;
window.saveTwitterConfig = saveTwitterConfig;
window.triggerTwitterSync = triggerTwitterSync;
window.testTwitterConnection = testTwitterConnection;
