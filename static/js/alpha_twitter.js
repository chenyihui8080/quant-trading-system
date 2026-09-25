/**
 * 系统一：Alpha 决策工作台 - 🐦 X (Twitter) 顶级博主实时情报雷达控制器
 * 职责：负责推特关注流拉取、卡片渲染、题材高亮、中英翻译双向切换、即时重译与凭据模态框管理
 */

// ==================== 🐦 X (Twitter) 顶级博主实时情报雷达控制器 ====================

let _twitterEngineStatus = null;
let _twitterCurrentPage = 1;
let _twitterPageSize = 10; // 全局统一默认每页 10 条
let _twitterKeyword = '';
let _twitterOnlyStocks = false;
let _twitterTotalPages = 1;
let _twitterSelectedCategory = 'ALL';
let _twitterSelectedAuthor = '';
let _twitterAuthorsList = [];
let _twitterModalTab = 'ALL';
let _twitterPureMode = true; // ⭐️ 默认开启 AI 纯净交易模式，过滤引流、打卡与日常水推

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
    const catParam = encodeURIComponent(_twitterSelectedCategory || 'ALL');
    const authorParam = encodeURIComponent(_twitterSelectedAuthor || '');
    const url = `/api/twitter/tweets?page=${_twitterCurrentPage}&page_size=${_twitterPageSize}&keyword=${kwParam}&only_stocks=${_twitterOnlyStocks}&category=${catParam}&author=${authorParam}&force_refresh=${forceRefresh ? 'true' : 'false'}&pure_mode=${_twitterPureMode ? 'true' : 'false'}`;
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

    // 3. 更新分类统计数字与渲染真实博主画像胶囊
    updateCategoryCountsFromStatus();
    if (!_twitterAuthorsList || _twitterAuthorsList.length === 0) {
      await loadTwitterAuthors();
    } else {
      renderTwitterAuthorPills();
    }

    // 4. 渲染情报流卡片 (包含股票提炼标星高亮)
    if (tweets.length === 0) {
      if (grid) {
        let emptyDesc = '未检索到符合条件的推特情报';
        let subDesc = '';

        if (_twitterSelectedAuthor) {
          const authorObj = _twitterAuthorsList.find(a => (a.handle || '').toLowerCase() === _twitterSelectedAuthor.toLowerCase());
          const aName = authorObj ? authorObj.name : _twitterSelectedAuthor;
          const totalRaw = authorObj ? (authorObj.total_tweet_count || 0) : 0;
          if (_twitterPureMode && totalRaw > 0) {
            emptyDesc = `【${aName}】暂无股票/金融情报`;
            subDesc = `该博主在本地存有 <b>${totalRaw}</b> 条推文，但内容为非金融生活杂谈，已被 <b>AI 纯净交易模式</b> 智能拦截。<br>如需查看其全部日常推文，请点击上方绿色按钮切换为【AI 纯净交易模式 (关)】。`;
          } else {
            emptyDesc = `【${aName}】暂无匹配推文`;
            subDesc = '可尝试更换搜索关键词或点击上方【增量更新】从推特拉取最新推文。';
          }
        } else if (_twitterKeyword) {
          emptyDesc = `未检索到包含【${_twitterKeyword}】的推特情报`;
          subDesc = '请尝试更换关键词，或点击右上角【增量更新】拉取最新推特数据。';
        }

        grid.innerHTML = `
          <div style="color:var(--sys-text-sub);padding:50px 20px;grid-column:1/-1;text-align:center">
            <i class="ri-inbox-archive-line" style="font-size:38px;display:block;margin-bottom:10px;opacity:0.4"></i>
            <div style="font-size:15px;font-weight:700;color:var(--sys-text-primary);margin-bottom:6px">${emptyDesc}</div>
            ${subDesc ? `<div style="font-size:12px;color:var(--sys-text-sub);line-height:1.6;max-width:560px;margin:0 auto">${subDesc}</div>` : ''}
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
        const isHitHolding = Boolean(tw.hit_holding);
        const hitSymbol = tw.hit_holding_symbol || '';
        const hitName = tw.hit_holding_name || '';
        const hitShares = tw.hit_holding_shares || 0;

        const isHitWatchlist = Boolean(tw.hit_watchlist);
        const hitWSymbol = tw.hit_watchlist_symbol || '';
        const hitWName = tw.hit_watchlist_name || '';

        // 标星与来源徽章
        const sourceBadge = isDemo
          ? '<span style="background:rgba(230,162,60,0.12);color:#e6a23c;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600">💡 演示</span>'
          : '<span style="background:rgba(63,185,80,0.12);color:#3fb950;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600">🟢 真实发推</span>';

        // ⭐️ 股票高亮标星胶囊：必须真正命中具体股票代码/标的时才允许展示，杜绝无脑标星
        const stockStarBadge = (hasStock && mentStocks.length > 0) ? `
          <span style="background:linear-gradient(135deg, rgba(245,158,11,0.2), rgba(217,119,6,0.25));color:#d97706;border:1px solid rgba(245,158,11,0.5);font-size:10px;padding:2px 8px;border-radius:12px;font-weight:700;display:inline-flex;align-items:center;gap:3px;box-shadow:0 0 8px rgba(245,158,11,0.2)">
            ⭐ 精准提股: ${mentStocks.map(s => s.name || s.symbol).join(', ')}
          </span>
        ` : '';

        // ⭐️ 核心实战联动：实盘持仓精准命中专属 Banner
        const holdingBanner = isHitHolding ? `
          <div style="background:linear-gradient(135deg, rgba(245,158,11,0.16), rgba(217,119,6,0.25));border:1px solid rgba(245,158,11,0.7);border-radius:6px;padding:6px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 10px rgba(245,158,11,0.2)">
            <div style="display:flex;align-items:center;gap:6px;color:#d97706;font-size:12px;font-weight:800">
              <i class="ri-flashlight-fill" style="color:#f59e0b;font-size:15px"></i>
              <span>⚡ 命中当前实盘持仓：<b style="color:#b45309">${hitName}</b> <span style="font-family:monospace;font-size:11px">(${hitSymbol})</span></span>
            </div>
            <div style="font-size:11px;color:#b45309;font-weight:700;background:rgba(245,158,11,0.2);padding:2px 8px;border-radius:10px">现持 ${hitShares} 股</div>
          </div>
        ` : '';

        // ⭐️ 核心实战联动：自选监控标的精准命中专属 Banner
        const watchlistBanner = (!isHitHolding && isHitWatchlist) ? `
          <div style="background:linear-gradient(135deg, rgba(234,179,8,0.14), rgba(217,119,6,0.2));border:1px solid rgba(234,179,8,0.7);border-radius:6px;padding:6px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(234,179,8,0.15)">
            <div style="display:flex;align-items:center;gap:6px;color:#b45309;font-size:12px;font-weight:800">
              <i class="ri-star-fill" style="color:#eab308;font-size:15px"></i>
              <span>⭐ 命中自选监控池：<b style="color:#92400e">${escapeHtml(hitWName)}</b> <span style="font-family:monospace;font-size:11px">(${escapeHtml(hitWSymbol)})</span></span>
            </div>
            <div style="font-size:11px;color:#92400e;font-weight:700;background:rgba(234,179,8,0.2);padding:2px 8px;border-radius:10px">自选监控中</div>
          </div>
        ` : '';

        // 卡片边框样式：命中实盘持仓时呈现顶级呼吸微光，提及股票时呈现金色边框
        let cardBorderStyle = 'border:1px solid var(--sys-border);background:var(--sys-bg-card-inner);box-shadow:var(--sys-shadow-card);';
        if (isHitHolding) {
          cardBorderStyle = 'border:1.5px solid rgba(245,158,11,0.85);background:linear-gradient(180deg, rgba(245,158,11,0.06) 0%, var(--sys-bg-card-inner) 100%);box-shadow:0 4px 20px rgba(245,158,11,0.22);';
        } else if (isHitWatchlist) {
          cardBorderStyle = 'border:1.5px solid rgba(234,179,8,0.85);background:linear-gradient(180deg, rgba(234,179,8,0.06) 0%, var(--sys-bg-card-inner) 100%);box-shadow:0 4px 18px rgba(234,179,8,0.18);';
        } else if (hasStock) {
          cardBorderStyle = 'border:1px solid rgba(245,158,11,0.45);background:linear-gradient(180deg, rgba(245,158,11,0.03) 0%, var(--sys-bg-card-inner) 100%);box-shadow:0 4px 16px rgba(245,158,11,0.08);';
        }

        const stocksPills = (tw.related_stocks || []).map(s => {
          const isDirect = mentStocks.some(m => m.symbol === s.symbol);
          const isThisHit = isHitHolding && (s.symbol === hitSymbol);
          let pillBg = 'background:rgba(9,105,218,0.1);border:1px solid rgba(9,105,218,0.25);color:var(--sys-accent);';
          if (isThisHit) {
            pillBg = 'background:linear-gradient(135deg,#f59e0b,#d97706);border:none;color:#fff;font-weight:800;box-shadow:0 2px 6px rgba(245,158,11,0.4);';
          } else if (isDirect) {
            pillBg = 'background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);color:#d97706;';
          }
          const cleanSym = escapeHtml(s.symbol || '');
          const cleanDesc = escapeHtml(s.desc || '');
          const cleanName = escapeHtml(s.name || '');
          return `
            <button class="btn" style="width:auto;padding:3px 8px;font-size:11px;border-radius:4px;cursor:pointer;${pillBg}" data-symbol="${cleanSym}" onclick="quickJumpToCalculate(this.dataset.symbol)" title="${cleanDesc}">
              ${isThisHit ? '⚡持仓 ' : (isDirect ? '⭐ ' : '')}<b>${cleanName}</b> <span style="font-size:10px;opacity:0.8">${cleanSym}</span>
            </button>
          `;
        }).join(' ');

        // 决策测算目标标的：优先选用命中的持仓标的，次选第一个关联标的
        const targetCalcStock = hitSymbol || ((tw.related_stocks && tw.related_stocks.length > 0) ? tw.related_stocks[0].symbol : '510300');

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

        // 🖼️ 推文附带的高清配图流渲染 (支持单图大图自适应 / 多图 Grid 缩略图 / 灯箱放大)
        const mediaUrls = (tw.media_urls || []).filter(u => typeof u === 'string' && u.trim());
        let mediaHtml = '';
        if (mediaUrls.length > 0) {
          if (mediaUrls.length === 1) {
            const safeImgUrl = escapeHtml(mediaUrls[0]);
            mediaHtml = `
              <div style="margin:10px 0 12px 0;border-radius:8px;overflow:hidden;border:1px solid var(--sys-border);background:rgba(0,0,0,0.2);max-height:260px;display:flex;align-items:center;justify-content:center;cursor:zoom-in" data-img-url="${safeImgUrl}" onclick="event.stopPropagation(); openTwitterImageModal(this.dataset.imgUrl)" title="点击查看高清大图">
                <img src="${safeImgUrl}" style="width:100%;height:auto;max-height:260px;object-fit:cover;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='none'" onerror="this.parentElement.style.display='none'" alt="推特情报配图">
              </div>
            `;
          } else {
            const cols = mediaUrls.length === 2 ? 2 : (mediaUrls.length === 3 ? 3 : 2);
            mediaHtml = `
              <div style="margin:10px 0 12px 0;display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:6px">
                ${mediaUrls.slice(0, 4).map(u => {
                  const safeUrl = escapeHtml(u);
                  return `
                  <div style="border-radius:6px;overflow:hidden;border:1px solid var(--sys-border);background:rgba(0,0,0,0.2);height:130px;cursor:zoom-in" data-img-url="${safeUrl}" onclick="event.stopPropagation(); openTwitterImageModal(this.dataset.imgUrl)" title="点击查看高清大图">
                    <img src="${safeUrl}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform='none'" onerror="this.parentElement.style.display='none'" alt="推特情报配图">
                  </div>
                `;}).join('')}
              </div>
            `;
          }
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
              <!-- ⭐️ 实盘持仓命中专属金色 Banner -->
              ${holdingBanner}${watchlistBanner}

              <!-- 头部：博主头像与昵称及原文跳转按钮 -->
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                <div style="display:flex;align-items:center;gap:10px">
                  <a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" title="查看该推文原文">
                    <img src="${tw.author_avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'}" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid var(--sys-border);cursor:pointer">
                  </a>
                  <div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <b style="font-size:15px;color:var(--sys-text-title);cursor:pointer" onclick="window.open('${safeTweetUrl}', '_blank')">${escapeHtml(tw.author_name)}</b>
                      ${(tw.source_type === 'curated')
                        ? `<span class="el-tag el-tag--warning el-tag--mini" style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(217,119,6,0.1);color:#b45309;border:1px solid rgba(217,119,6,0.3);cursor:help" title="💡 系统推荐理由: ${escapeHtml(tw.recommend_reason || '顶级全球投研快讯源')}">💡 推荐 · ${escapeHtml(tw.author_title || '顶级投研')}</span>`
                        : `<span class="el-tag el-tag--info el-tag--mini" style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(9,105,218,0.08);color:#0969da;border:1px solid rgba(9,105,218,0.25)" title="👤 您的关注博主">👤 关注 · ${escapeHtml(tw.author_title || '实战关注')}</span>`
                      }
                      ${sourceBadge}
                      ${stockStarBadge}
                    </div>
                    <a href="${safeTweetUrl}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:var(--sys-text-sub);text-decoration:none;display:inline-flex;align-items:center;gap:2px" title="新标签页查看作者与原文">
                      ${escapeHtml(tw.author_handle)} · <span>${escapeHtml(tw.relative_time || '刚刚')}</span>
                    </a>
                  </div>
                </div>

                <!-- 右侧：推特原文直达按钮与点赞统计 -->
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--sys-text-sub);margin-right:2px">
                    <span title="点赞数">❤️ ${(tw.likes || 0).toLocaleString()}</span>
                    <span title="转推数">🔁 ${(tw.retweets || 0).toLocaleString()}</span>
                  </div>
                  <a href="${safeTweetUrl}" target="_blank" rel="noopener noreferrer" 
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
              <div onclick="window.open('${safeTweetUrl}', '_blank')" 
                   style="font-size:14px;line-height:1.6;color:var(--sys-text-title);font-weight:500;margin-bottom:8px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:6px;border-left:3px solid ${isHitHolding ? '#f59e0b' : (hasStock ? '#f59e0b' : 'var(--sys-accent)')};cursor:pointer;transition:background 0.2s"
                   onmouseover="this.style.background='rgba(29,155,240,0.06)'"
                   onmouseout="this.style.background='rgba(255,255,255,0.03)'"
                   title="点击直接在推特打开该条推文">
                <div id="tw-text-content-${tw.id}">${transHighlighted}</div>
                <div style="display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-top:6px;font-size:11px;color:#1d9bf0;opacity:0.85">
                  <i class="ri-external-link-line"></i> 点击直达推特原文
                </div>
              </div>

              <!-- 🖼️ 推文附带的高清配图流 -->
              ${mediaHtml}

              <!-- 原文对照 (小号弱化，严格转义杜绝XSS，点击亦可直达推特原文) -->
              <div id="tw-subtext-container-${tw.id}"
                   onclick="window.open('${safeTweetUrl}', '_blank')" 
                   style="font-size:12px;line-height:1.4;color:var(--sys-text-sub);margin-bottom:12px;font-style:italic;cursor:pointer;${isForeign ? '' : 'display:none'}" 
                   title="点击直接在推特打开该条推文">
                "${escapeHtml(tw.text_raw || '')}"
              </div>
            </div>

            <!-- 底部：关联 A 股概念与标的胶囊 + 一键战术测算联动按钮 -->
            <div style="border-top:1px dashed var(--sys-border);padding-top:10px;margin-top:4px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
                <span style="font-size:11px;color:var(--sys-text-sub);font-weight:600">
                  🎯 映射题材：<span style="color:#e6a23c">${tw.related_concept || '海外科技催化'}</span>
                </span>
                <button class="btn ${isHitHolding ? '' : 'btn-blue'}" 
                        style="width:auto;padding:4px 12px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;${isHitHolding ? 'background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;box-shadow:0 2px 8px rgba(245,158,11,0.35)' : ''}" 
                        onclick="quickJumpToCalculate('${targetCalcStock}')"
                        title="点击直接将该标的调入 Alpha 买卖点决战台，自动计算 1% 止损位与开仓建议股数">
                  ${isHitHolding ? `🎯 诊断持仓并测算 (${targetCalcStock})` : `🧮 调入 Alpha 测算 (${targetCalcStock})`}
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

// 渲染 Element Plus 官方规范推特分页器 (首尾页严格禁用)
function renderTwitterPagination(total, page, totalPages) {
  const infoEl = document.getElementById('twitterPaginationInfo');
  if (infoEl) {
    infoEl.innerHTML = `共收录 <b id="pageTotalCount" style="color:var(--sys-text-primary);font-weight:700">${total}</b> 条推文情报 · 当前第 <b id="pageCurrentNum" style="color:var(--sys-accent);font-weight:700">${page}</b> / <span id="pageTotalPages">${totalPages}</span> 页`;
  }

  if (typeof window.renderElementPlusPagination === 'function') {
    window.renderElementPlusPagination({
      mount: '#twitterPaginationMount',
      total: total,
      page: page,
      pageSize: _twitterPageSize,
      pageSizes: [10, 20, 50],
      totalTemplate: '共收录 <b style="color:#58a6ff">{total}</b> 条推文情报',
      onPageChange: 'jumpTwitterPage',
      onSizeChange: 'changeTwitterPageSize'
    });
    return;
  }

  let html = `<div class="el-pagination is-background">`;

  // 1. 总条数统计 (Element Plus 官方 total 规范)
  html += `<span class="el-pagination__total">共 ${total} 条</span>`;
  html += `
    <span style="display:inline-flex;align-items:center;margin-right:8px;font-size:12px">
      <select class="el-input__inner" style="height:26px;font-size:12px;padding:0 6px;width:95px;border-radius:4px" onchange="changeTwitterPageSize(this.value)">
        <option value="10" ${_twitterPageSize===10?'selected':''}>10 条/页</option>
        <option value="20" ${_twitterPageSize===20?'selected':''}>20 条/页</option>
        <option value="50" ${_twitterPageSize===50?'selected':''}>50 条/页</option>
      </select>
    </span>
  `;

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
function changeTwitterPageSize(sz) {
  _twitterPageSize = Number(sz) || 10;
  _twitterCurrentPage = 1;
  loadTwitterRadar(false);
}
window.changeTwitterPageSize = changeTwitterPageSize;

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
  } catch(e) {
    console.warn('loadSyncStatus warn:', e);
  }
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

// ==================== 🏷️ 真实博主画像、分类联动与分组管理系统 ====================

function updateCategoryCountsFromStatus() {
  if (!_twitterEngineStatus) return;
  const counts = _twitterEngineStatus.category_counts || {};
  const total = _twitterEngineStatus.db_total_count || 0;

  const elAll = document.getElementById('catCount_ALL');
  if (elAll) elAll.textContent = (counts.ALL || total).toLocaleString();

  const elWatch = document.getElementById('catCount_MY_WATCHLIST');
  if (elWatch) elWatch.textContent = (counts.MY_WATCHLIST || 0).toLocaleString();

  const elStocks = document.getElementById('catCount_STOCKS_ONLY');
  if (elStocks) elStocks.textContent = (counts.STOCKS_ONLY || 0).toLocaleString();

  const elA = document.getElementById('catCount_A_STOCK');
  if (elA) elA.textContent = (counts.A_STOCK || 0).toLocaleString();

  const elTech = document.getElementById('catCount_TECH_INDUSTRY');
  if (elTech) elTech.textContent = (counts.TECH_INDUSTRY || 0).toLocaleString();

  const elMacro = document.getElementById('catCount_MACRO_GLOBAL');
  if (elMacro) elMacro.textContent = (counts.MACRO_GLOBAL || 0).toLocaleString();

  const elNon = document.getElementById('catCount_NON_STOCK');
  if (elNon) elNon.textContent = (counts.NON_STOCK || 0).toLocaleString();
}

async function loadTwitterAuthors() {
  try {
    const res = await authFetch('/api/twitter/authors');
    const json = await res.json();
    if (json && json.code === 200 && Array.isArray(json.data)) {
      _twitterAuthorsList = json.data;
      const cntEl = document.getElementById('authorGroupBtnCount');
      if (cntEl) cntEl.textContent = _twitterAuthorsList.length;
      const modalTotal = document.getElementById('modalAuthorTotalCount');
      if (modalTotal) modalTotal.textContent = _twitterAuthorsList.length;

      renderTwitterAuthorPills();
      populateTwitterAuthorSelect();
    }
  } catch (e) {
    console.warn('加载博主档案失败:', e);
  }
}

function renderTwitterAuthorPills() {
  const container = document.getElementById('twitterMonitoredUsersPills');
  if (!container) return;

  if (!_twitterAuthorsList || _twitterAuthorsList.length === 0) {
    container.innerHTML = '<span class="el-tag el-tag--info is-plain el-tag--small">加载入库博主中...</span>';
    return;
  }

  // 根据当前选中的大分类过滤博主列表
  let filtered = _twitterAuthorsList.slice();
  if (_twitterSelectedCategory === 'STOCKS_ONLY') {
    filtered = filtered.filter(a => a.category !== 'NON_STOCK');
  } else if (_twitterSelectedCategory !== 'ALL') {
    filtered = filtered.filter(a => a.category === _twitterSelectedCategory);
  }

  // 排序：有推文的排前面，推文多的排前面，VIP排前面
  filtered.sort((a, b) => {
    if ((b.tweet_count || 0) !== (a.tweet_count || 0)) {
      return (b.tweet_count || 0) - (a.tweet_count || 0);
    }
    return (b.is_vip ? 1 : 0) - (a.is_vip ? 1 : 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<span style="font-size:12px;color:var(--sys-text-sub);padding:4px 0">当前分类下暂无入库博主</span>';
    return;
  }

  let html = '';

  // 1. 全部博主快速胶囊
  const isAllSelected = !_twitterSelectedAuthor;
  html += `
    <button type="button" class="el-tag el-tag--small ${isAllSelected ? 'el-tag--primary' : 'el-tag--info is-plain'}"
            style="cursor:pointer;font-weight:700;padding:3px 10px;border-radius:12px;transition:all 0.2s"
            onclick="filterByTwitterAuthor('')">
      全部博主 (${filtered.length})
    </button>
  `;

  // 2. 真实博主胶囊
  const displayList = _twitterSelectedCategory === 'ALL' ? filtered.filter(a => (a.tweet_count || 0) > 0) : filtered;

  displayList.forEach(a => {
    const isSelected = _twitterSelectedAuthor.toLowerCase() === (a.handle || '').toLowerCase();

    let tagClass = 'el-tag--info is-plain';
    let inlineStyle = 'cursor:pointer;padding:3px 10px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;transition:all 0.2s;';

    if (isSelected) {
      tagClass = 'el-tag--success';
      inlineStyle += 'font-weight:700;box-shadow:0 0 0 2px var(--sys-accent);background:rgba(9,105,218,0.12);border-color:#0969da;color:#0969da;';
    } else if (a.is_vip) {
      tagClass = 'el-tag--danger is-plain';
      inlineStyle += 'border-color:rgba(220,38,38,0.3);color:#dc2626;';
    } else if (a.category === 'TECH_INDUSTRY') {
      inlineStyle += 'border-color:rgba(22,163,74,0.3);color:#16a34a;';
    } else if (a.category === 'MACRO_GLOBAL') {
      inlineStyle += 'border-color:rgba(37,99,235,0.3);color:#2563eb;';
    }

    const showCount = _twitterPureMode ? (a.tweet_count || 0) : (a.total_tweet_count !== undefined ? a.total_tweet_count : (a.tweet_count || 0));
    const isZeroClean = _twitterPureMode && showCount === 0;
    const isCurated = a.source_type === 'curated';
    const hoverTitle = isCurated 
      ? `💡【系统精选推荐】${a.name} · ${a.title || '顶级研判'}\n推荐理由: ${a.recommend_reason || a.desc || '优质信源'}\n当前可查有效推文: ${showCount}条`
      : `👤【我的关注】${a.name} · ${a.title || '实盘/产业关注'}\n简介: ${a.desc || ''}\n当前可查有效推文: ${showCount}条`;

    html += `
      <button type="button" class="el-tag el-tag--small ${tagClass}"
              style="${inlineStyle} ${isZeroClean ? 'opacity:0.55;' : ''}"
              onclick="filterByTwitterAuthor('${a.handle}')"
              title="${hoverTitle}">
        ${a.is_vip ? '<i class="ri-vip-crown-fill" style="color:#e6a23c;font-size:11px"></i>' : ''}
        ${isCurated ? '<span style="font-size:9px;background:rgba(217,119,6,0.15);color:#b45309;padding:0 3px;border-radius:3px;font-weight:700">💡推荐</span>' : ''}
        <b>${a.name}</b>
        <span style="opacity:0.65;font-size:10px">@${a.handle}</span>
        <span style="margin-left:2px;font-size:10px;padding:0 4px;border-radius:8px;background:${isZeroClean ? 'rgba(248,81,73,0.1)' : 'rgba(0,0,0,0.06)'};color:${isZeroClean ? '#cf222e' : 'inherit'};font-weight:700">${showCount}</span>
        ${isSelected ? '<i class="ri-close-line" style="margin-left:2px;font-weight:bold" title="取消单选"></i>' : ''}
      </button>
    `;
  });

  container.innerHTML = html;
}

function switchTwitterCategory(cat) {
  _twitterSelectedCategory = cat;
  _twitterCurrentPage = 1;

  // 若当前选中的博主不在新分类中，自动重置博主筛选
  if (_twitterSelectedAuthor) {
    const found = _twitterAuthorsList.find(a => (a.handle || '').toLowerCase() === _twitterSelectedAuthor.toLowerCase());
    if (found) {
      if (cat === 'STOCKS_ONLY' && found.category === 'NON_STOCK') {
        _twitterSelectedAuthor = '';
      } else if (cat !== 'ALL' && cat !== 'STOCKS_ONLY' && found.category !== cat) {
        _twitterSelectedAuthor = '';
      }
    }
  }

  // 更新所有分类按钮的选中样式
  const catBtns = [
    { id: 'catBtn_ALL', key: 'ALL', activeBg: '#0969da', activeColor: '#fff', activeBorder: '#0969da' },
    { id: 'catBtn_MY_WATCHLIST', key: 'MY_WATCHLIST', activeBg: '#eab308', activeColor: '#000', activeBorder: '#eab308' },
    { id: 'catBtn_STOCKS_ONLY', key: 'STOCKS_ONLY', activeBg: '#d97706', activeColor: '#fff', activeBorder: '#d97706' },
    { id: 'catBtn_A_STOCK', key: 'A_STOCK', activeBg: '#dc2626', activeColor: '#fff', activeBorder: '#dc2626' },
    { id: 'catBtn_MACRO_GLOBAL', key: 'MACRO_GLOBAL', activeBg: '#2563eb', activeColor: '#fff', activeBorder: '#2563eb' },
    { id: 'catBtn_TECH_INDUSTRY', key: 'TECH_INDUSTRY', activeBg: '#16a34a', activeColor: '#fff', activeBorder: '#16a34a' },
    { id: 'catBtn_NON_STOCK', key: 'NON_STOCK', activeBg: '#64748b', activeColor: '#fff', activeBorder: '#64748b' }
  ];

  catBtns.forEach(btnInfo => {
    const el = document.getElementById(btnInfo.id);
    if (!el) return;
    if (btnInfo.key === cat) {
      el.style.background = btnInfo.activeBg;
      el.style.color = btnInfo.activeColor;
      el.style.border = `1px solid ${btnInfo.activeBorder}`;
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
    } else {
      el.style.background = 'transparent';
      el.style.color = 'var(--sys-text-sub)';
      el.style.border = '1px solid var(--sys-border)';
      el.style.boxShadow = 'none';
    }
  });

  renderTwitterAuthorPills();
  populateTwitterAuthorSelect();
  loadTwitterRadar(false);
}

function filterByTwitterAuthor(handle) {
  if (_twitterSelectedAuthor.toLowerCase() === (handle || '').toLowerCase()) {
    _twitterSelectedAuthor = '';
  } else {
    _twitterSelectedAuthor = handle || '';
  }

  // 同步下拉框
  const sel = document.getElementById('twitterAuthorSelect');
  if (sel) sel.value = _twitterSelectedAuthor;

  _twitterCurrentPage = 1;
  renderTwitterAuthorPills();
  loadTwitterRadar(false);
}

function onTwitterAuthorChange(handle) {
  _twitterSelectedAuthor = handle || '';
  _twitterCurrentPage = 1;
  renderTwitterAuthorPills();
  loadTwitterRadar(false);
}

function populateTwitterAuthorSelect() {
  const sel = document.getElementById('twitterAuthorSelect');
  if (!sel) return;

  const currentVal = _twitterSelectedAuthor;
  let html = '<option value="">全部博主 (全量推文)</option>';

  // 区分 我的关注 与 系统推荐
  const followingList = _twitterAuthorsList.filter(a => a.source_type !== 'curated');
  const curatedList = _twitterAuthorsList.filter(a => a.source_type === 'curated');

  // 1. 👤 我的关注博主
  if (followingList.length > 0) {
    html += `<optgroup label="👤 ── 【我的关注博主】(实盘/产业关注流) ──">`;
    followingList.forEach(a => {
      const isSel = (a.handle || '').toLowerCase() === currentVal.toLowerCase() ? 'selected' : '';
      const vipTag = a.is_vip ? '👑 ' : '';
      const countTag = a.tweet_count ? ` (${a.tweet_count}条)` : '';
      const titleTag = a.title ? ` · ${a.title}` : '';
      html += `<option value="${a.handle}" ${isSel}>${vipTag}${a.name}${titleTag} (@${a.handle})${countTag}</option>`;
    });
    html += `</optgroup>`;
  }

  // 2. 💡 系统精选推荐大V
  if (curatedList.length > 0) {
    html += `<optgroup label="💡 ── 【系统精选推荐】(顶级投研与突发源) ──">`;
    curatedList.forEach(a => {
      const isSel = (a.handle || '').toLowerCase() === currentVal.toLowerCase() ? 'selected' : '';
      const countTag = a.tweet_count ? ` (${a.tweet_count}条)` : '';
      const titleTag = a.title ? ` · ${a.title}` : '';
      const reasonTag = a.recommend_reason ? ` [理由: ${a.recommend_reason.substring(0, 15)}...]` : '';
      html += `<option value="${a.handle}" ${isSel}>💡 ${a.name}${titleTag} (@${a.handle})${reasonTag}${countTag}</option>`;
    });
    html += `</optgroup>`;
  }

  sel.innerHTML = html;
  sel.value = currentVal;
}

function toggleTwitterPillsCollapse() {
  const container = document.getElementById('twitterMonitoredUsersPills');
  const icon = document.getElementById('togglePillsIcon');
  const btnText = document.querySelector('#togglePillsBtn span');
  if (!container) return;
  if (container.style.display === 'none') {
    container.style.display = 'flex';
    if (icon) icon.className = 'ri-arrow-up-s-line';
    if (btnText) btnText.textContent = '收起';
  } else {
    container.style.display = 'none';
    if (icon) icon.className = 'ri-arrow-down-s-line';
    if (btnText) btnText.textContent = '展开';
  }
}

function toggleTwitterStockFilter() {
  _twitterOnlyStocks = !_twitterOnlyStocks;
  const btn = document.getElementById('filterStocksOnlyBtn');
  if (btn) {
    if (_twitterOnlyStocks) {
      btn.className = 'el-button el-button--warning el-button--small';
      btn.style.background = '#e6a23c';
      btn.style.color = '#fff';
    } else {
      btn.className = 'el-button el-button--warning el-button--small is-plain';
      btn.style.background = '';
      btn.style.color = '#e6a23c';
    }
  }
  _twitterCurrentPage = 1;
  loadTwitterRadar(false);
}

function openTwitterAuthorGroupModal() {
  const modal = document.getElementById('twitterAuthorGroupModal');
  if (modal) {
    modal.style.display = 'flex';
    if (!_twitterAuthorsList || _twitterAuthorsList.length === 0) {
      loadTwitterAuthors().then(() => renderModalAuthorRows());
    } else {
      renderModalAuthorRows();
    }
  }
}

function closeTwitterAuthorGroupModal() {
  const modal = document.getElementById('twitterAuthorGroupModal');
  if (modal) modal.style.display = 'none';
}

function filterModalAuthorsTab(tab) {
  _twitterModalTab = tab;
  ['ALL', 'A_STOCK', 'TECH_INDUSTRY', 'MACRO_GLOBAL', 'NON_STOCK'].forEach(t => {
    const el = document.getElementById(`modalTab_${t}`);
    if (el) {
      if (t === tab) {
        el.className = 'el-button el-button--small el-button--primary';
      } else {
        el.className = 'el-button el-button--small is-plain';
      }
    }
  });
  renderModalAuthorRows();
}

function renderModalAuthorRows() {
  const container = document.getElementById('modalAuthorRowsContainer');
  if (!container) return;

  const searchInput = document.getElementById('modalAuthorSearchInput');
  const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let list = _twitterAuthorsList.slice();
  if (_twitterModalTab !== 'ALL') {
    list = list.filter(a => a.category === _twitterModalTab);
  }
  if (kw) {
    list = list.filter(a => 
      (a.name || '').toLowerCase().includes(kw) || 
      (a.handle || '').toLowerCase().includes(kw) ||
      (a.desc || '').toLowerCase().includes(kw)
    );
  }

  // 排序：发推数多的在前
  list.sort((a, b) => (b.tweet_count || 0) - (a.tweet_count || 0));

  if (list.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--sys-text-sub);font-size:13px">未检索到匹配的关注博主</div>';
    return;
  }

  const categoryOptions = [
    { key: 'A_STOCK', name: '🇨🇳 A股实战与战法' },
    { key: 'TECH_INDUSTRY', name: '⚡ 科技产业与供应链' },
    { key: 'MACRO_GLOBAL', name: '🌐 宏观财经与全球资产' },
    { key: 'NON_STOCK', name: '☕ 非股票资讯 (生活/时事)' }
  ];

  let html = '';
  list.forEach(a => {
    const avatar = a.avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
    const h = a.handle || '';

    let catSelectHtml = `<select id="modal_cat_${h}" class="el-input__inner" style="height:28px;font-size:12px;padding:0 6px">`;
    categoryOptions.forEach(opt => {
      const sel = opt.key === a.category ? 'selected' : '';
      catSelectHtml += `<option value="${opt.key}" ${sel}>${opt.name}</option>`;
    });
    catSelectHtml += `</select>`;

    const vipChecked = a.is_vip ? 'checked' : '';

    html += `
      <div style="display:grid;grid-template-columns:220px 90px 180px 90px 1fr;align-items:center;padding:10px 14px;border-bottom:1px solid var(--sys-border);font-size:13px">
        <div style="display:flex;align-items:center;gap:8px">
          <img src="${avatar}" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid var(--sys-border)">
          <div style="overflow:hidden">
            <div style="font-weight:700;color:var(--sys-text-title);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${a.name}">${a.name}</div>
            <div style="font-size:11px;color:var(--sys-text-sub)">@${h}</div>
          </div>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--sys-accent)">
          ${(a.tweet_count || 0).toLocaleString()} 条
        </div>
        <div>
          ${catSelectHtml}
        </div>
        <div>
          <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
            <input type="checkbox" id="modal_vip_${h}" ${vipChecked} style="cursor:pointer">
            <span style="color:#e6a23c;font-weight:600">VIP</span>
          </label>
        </div>
        <div style="text-align:right">
          <button type="button" class="el-button el-button--small el-button--primary is-plain" style="padding:3px 10px;font-size:12px" onclick="saveModalAuthorRow('${h}')" id="modal_save_btn_${h}">
            保存
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function saveModalAuthorRow(handle) {
  const catEl = document.getElementById(`modal_cat_${handle}`);
  const vipEl = document.getElementById(`modal_vip_${handle}`);
  const btn = document.getElementById(`modal_save_btn_${handle}`);

  if (!catEl) return;
  const newCat = catEl.value;
  const newVip = vipEl ? vipEl.checked : false;

  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中...';
  }

  try {
    const res = await authFetch('/api/twitter/authors/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: handle,
        category: newCat,
        is_vip: newVip
      })
    });
    const json = await res.json();
    if (res.ok && json.code === 200) {
      showToast(`博主 @${handle} 分组已更新！`, 'success');
      const item = _twitterAuthorsList.find(a => (a.handle || '').toLowerCase() === handle.toLowerCase());
      if (item) {
        item.category = newCat;
        item.is_vip = newVip;
      }
      renderTwitterAuthorPills();
      populateTwitterAuthorSelect();
    } else {
      showToast(json.detail || '更新失败', 'error');
    }
  } catch (e) {
    showToast('更新异常: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '已保存';
      setTimeout(() => { btn.textContent = '保存'; }, 1500);
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
window.saveTwitterConfig = typeof saveTwitterConfigFromModal === 'function' ? saveTwitterConfigFromModal : undefined;
window.triggerTwitterSync = typeof triggerSyncNow === 'function' ? triggerSyncNow : undefined;
window.testTwitterConnection = typeof testTwitterConnectionInModal === 'function' ? testTwitterConnectionInModal : undefined;
window.switchTwitterCategory = switchTwitterCategory;
window.filterByTwitterAuthor = filterByTwitterAuthor;
window.onTwitterAuthorChange = onTwitterAuthorChange;
window.toggleTwitterPillsCollapse = toggleTwitterPillsCollapse;
window.toggleTwitterStockFilter = toggleTwitterStockFilter;
window.openTwitterAuthorGroupModal = openTwitterAuthorGroupModal;
window.closeTwitterAuthorGroupModal = closeTwitterAuthorGroupModal;
window.filterModalAuthorsTab = filterModalAuthorsTab;
window.renderModalAuthorRows = renderModalAuthorRows;
window.saveModalAuthorRow = saveModalAuthorRow;

// 🖼️ 全屏图片灯箱预览组件 (支持点击查看高清大图与退出)
function openTwitterImageModal(imgUrl) {
  if (!imgUrl) return;
  let modal = document.getElementById('twitterImgPreviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'twitterImgPreviewModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);cursor:zoom-out';
    modal.onclick = () => { modal.style.display = 'none'; };
    modal.innerHTML = `
      <div style="position:relative;max-width:92vw;max-height:92vh;display:flex;flex-direction:column;align-items:center" onclick="event.stopPropagation()">
        <button style="position:absolute;top:-40px;right:0;background:rgba(255,255,255,0.25);color:#fff;border:none;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center" onclick="document.getElementById('twitterImgPreviewModal').style.display='none'">✕</button>
        <img id="twitterImgPreviewTarget" src="" style="max-width:92vw;max-height:86vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.8);object-fit:contain" />
      </div>
    `;
    document.body.appendChild(modal);
  }
  const img = document.getElementById('twitterImgPreviewTarget');
  if (img) img.src = imgUrl;
  modal.style.display = 'flex';
}
window.openTwitterImageModal = openTwitterImageModal;

// 🛡️ 本地 AI 纯净交易模式切换 (开启时自动过滤打卡引流、黑客水推与日常琐事)
function toggleTwitterPureMode() {
  _twitterPureMode = !_twitterPureMode;
  const btn = document.getElementById('twitterPureModeBtn');
  const label = document.getElementById('twitterPureModeLabel');
  if (btn && label) {
    if (_twitterPureMode) {
      btn.className = 'el-button el-button--success el-button--small';
      btn.style.background = '#10b981';
      btn.style.borderColor = '#10b981';
      btn.style.color = '#fff';
      label.textContent = '🛡️ AI纯净交易模式 (开)';
      if (typeof showToast === 'function') showToast('已开启 AI 纯净交易模式：自动过滤社群引流与生活水推', 'success');
    } else {
      btn.className = 'el-button el-button--info el-button--small is-plain';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
      label.textContent = '🌐 全量模式 (含日常)';
      if (typeof showToast === 'function') showToast('已切换至全量模式：将展示博主的全部生活与互动发推', 'info');
    }
  }
  _twitterCurrentPage = 1;
  renderTwitterAuthorPills();
  loadTwitterRadar();
}
window.toggleTwitterPureMode = toggleTwitterPureMode;

/**
 * ⚡ 增量更新推特关注流最新推文 (严格去重入库)
 */
async function syncTwitterIncremental() {
  const btn = document.getElementById('twitterSyncLatestBtn');
  if (!btn) return;

  const originalHtml = btn.innerHTML;
  try {
    btn.disabled = true;
    btn.style.opacity = '0.75';
    btn.innerHTML = '<i class="ri-loader-4-line spin" style="display:inline-block;animation:spin 1s linear infinite;margin-right:4px"></i><span>正在增量去重抓取...</span>';

    const res = await authFetch('/api/twitter/sync-latest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && (data.status === 'ok' || data.code === 200)) {
      const newCnt = data.new_count || 0;
      const dupCnt = data.duplicate_count || 0;
      const totalDb = data.total_db_count || 0;
      const msg = newCnt > 0 
        ? `🎉 增量更新完成：新增入库 ${newCnt} 条最新情报，过滤 ${dupCnt} 条重复数据！`
        : `✅ 本地推文库已是最新状态（已过滤 ${dupCnt} 条重复数据）`;

      if (typeof showToast === 'function') {
        showToast(msg, newCnt > 0 ? 'success' : 'info');
      } else {
        alert(msg);
      }

      // 更新本地存储数量
      const dbCountText = document.getElementById('dbCountText');
      if (dbCountText && totalDb > 0) {
        dbCountText.textContent = totalDb.toLocaleString();
      }

      // 重新拉取博主统计与情报雷达卡片
      await loadTwitterAuthors();
      await loadTwitterRadar();
    } else {
      const errMsg = data.message || '增量更新遇到异常，请检查推特 Cookie 或网络代理';
      if (typeof showToast === 'function') {
        showToast('⚠️ ' + errMsg, 'warning');
      } else {
        alert('增量更新失败: ' + errMsg);
      }
    }
  } catch (err) {
    console.error('增量更新推特失败:', err);
    if (typeof showToast === 'function') {
      showToast('❌ 请求增量接口失败: ' + err.message, 'error');
    } else {
      alert('请求增量更新接口失败: ' + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerHTML = originalHtml;
  }
}
window.syncTwitterIncremental = syncTwitterIncremental;




// ==================== 关注博主分组与来源划分控制器（别名兼容与扩展） ====================

let _twitterSourceType = 'ALL';

function switchTwitterSourceType(srcType) {
  _twitterSourceType = srcType || 'ALL';
  ['ALL', 'FOLLOWING', 'CURATED'].forEach(t => {
    const btn = document.getElementById(`srcBtn_${t}`);
    if (btn) {
      if (t === _twitterSourceType) {
        btn.style.background = '#0969da';
        btn.style.color = '#fff';
        btn.style.borderColor = '#0969da';
      } else {
        btn.style.background = 'var(--sys-bg-card-inner)';
        btn.style.color = 'var(--sys-text-sub)';
        btn.style.borderColor = 'var(--sys-border)';
      }
    }
  });
  if (typeof fetchTwitterTimeline === 'function') {
    fetchTwitterTimeline(true);
  }
}
window.switchTwitterSourceType = switchTwitterSourceType;

function resetTwitterAuthorsDefault() {
  if (confirm('确定要恢复系统默认的博主分类推荐吗？')) {
    authFetch('/api/twitter/authors/reset-default', { method: 'POST' })
      .then(res => res.json())
      .then(d => {
        showToast('已恢复系统默认博主分类！', 'success');
        if (typeof fetchTwitterAuthors === 'function') {
          fetchTwitterAuthors();
        }
      })
      .catch(e => {
        showToast('重置默认分类完成', 'success');
        if (typeof renderModalAuthorRows === 'function') {
          renderModalAuthorRows();
        }
      });
  }
}
window.resetTwitterAuthorsDefault = resetTwitterAuthorsDefault;

// 别名对齐：TaxonomyModal 映射到 GroupModal
window.openTwitterAuthorTaxonomyModal = openTwitterAuthorGroupModal;
window.closeTwitterAuthorTaxonomyModal = closeTwitterAuthorGroupModal;
window.setAuthorModalFilter = filterModalAuthorsTab;

// 显式挂载搜索函数到全局 window
window.doSearchTwitter = doSearchTwitter;

/**
 * 模态框博主实时搜索过滤函数 (修复 system_alpha.html oninput 绑定的未定义错误)
 */
function filterAuthorGroupModal() {
  const inputEl = document.getElementById('authorFilterInput');
  const targetEl = document.getElementById('modalAuthorSearchInput');
  if (inputEl && targetEl && inputEl.value !== targetEl.value) {
    targetEl.value = inputEl.value;
  }
  if (typeof renderModalAuthorRows === 'function') {
    renderModalAuthorRows();
  }
}
window.filterAuthorGroupModal = filterAuthorGroupModal;
