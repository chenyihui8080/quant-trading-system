"""
情报搜集员与资讯证据库服务 (Intelligence & Evidence Service)
职责：
1. 𝕏 (Twitter) 纯股票博主情报流提取与动态白名单同步 (修复 D-07 代码与数据库割裂)
2. 过滤非股票生活杂音，精准匹配持仓与自选
3. 资讯证据库持久化深度分页与单篇证据详情提取
"""

import re
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

logger = logging.getLogger("IntelService")

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "review.db"

# 纯股票博主基础白名单兜底
FINANCIAL_STOCK_AUTHORS = [
    {"handle": "@aiwangupiao", "key": "aiwangupiao", "name": "爱玩股票AiWanGuPiao", "badge": "A股短线量化 · 选股与买卖点", "icon": "ri-line-chart-line"},
    {"handle": "@dacefupan", "key": "dacefupan", "name": "🇨🇳 大策复盘", "badge": "A股复盘教练 · 连板情绪周期", "icon": "ri-funds-line"},
    {"handle": "@xiajingfa8", "key": "xiajingfa8", "name": "证势交易", "badge": "趋势交易体系 · 盘面买卖战法", "icon": "ri-compass-3-line"},
    {"handle": "@stevenkim24", "key": "stevenkim24", "name": "大A-炒股来养家", "badge": "A股超短线 · 龙头主升战法", "icon": "ri-fire-line"},
    {"handle": "@Stock_Tutor_Hen", "key": "stock_tutor_hen", "name": "Henry全职交易员", "badge": "盘面技术剖析 · 量价实战", "icon": "ri-user-star-line"},
    {"handle": "@AnnabelCooper10", "key": "annabelcooper10", "name": "大a复盘日记", "badge": "A股实盘买卖 · 个股短线研判", "icon": "ri-book-read-line"},
    {"handle": "@libainice6006", "key": "libainice6006", "name": "里白Nice🌞A股首板", "badge": "A股首板起爆 · 盘口抓涨停", "icon": "ri-flashlight-line"},
    {"handle": "@Ueueueuwn", "key": "ueueueuwn", "name": "蓝筹-追梦人", "badge": "实盘调研 · 蓝筹产业链动向", "icon": "ri-shield-star-line"},
    {"handle": "@snake_w", "key": "snake_w", "name": "戒色交易员", "badge": "A股波段战法 · 题材个股掘金", "icon": "ri-sword-line"}
]
FINANCIAL_STOCK_HANDLES = [a["handle"] for a in FINANCIAL_STOCK_AUTHORS]

# 全局非股票噪音词典
NON_STOCK_NOISE_KEYWORDS = (
    "跑步", "健身", "减肥", "美食", "晚餐", "午餐", "喝咖啡",
    "旅游", "景点", "酒店", "机票", "度假", "拍照",
    "自拍", "美女", "穿搭", "发型", "化妆", "护肤",
    "情感", "谈恋爱", "结婚", "离婚", "相亲", "渣男", "渣女",
    "八卦", "明星", "追星", "演唱会", "电影", "电视剧", "综艺",
    "打游戏", "王者荣耀", "吃鸡", "原神", "黑神话",
    "养生", "感冒", "发烧", "医院", "吃药", "失眠",
    "买衣服", "鞋子", "包包", "口红", "逛街", "购物节",
    "宠物", "猫咪", "狗狗", "吸猫", "遛狗",
    "心灵鸡汤", "人生感悟", "晚安", "早安", "心情不好", "累了"
)

_AUTHORS_CACHE: List[Dict[str, Any]] = []
_AUTHORS_CACHE_TIME = 0.0


def get_dynamic_stock_authors() -> List[Dict[str, Any]]:
    """
    动态获取博主白名单 (解决 D-07 代码与数据库割裂问题)
    优先从 twitter_intel.db 的 twitter_author_profiles 动态读取 150+ 位博主，
    并与内置核心 9 人合并去重，保证数据库新增博主自动生效。
    """
    import time
    global _AUTHORS_CACHE, _AUTHORS_CACHE_TIME

    if _AUTHORS_CACHE and (time.time() - _AUTHORS_CACHE_TIME < 60):
        return _AUTHORS_CACHE

    authors_map = {a["handle"].lower(): dict(a) for a in FINANCIAL_STOCK_AUTHORS}

    twitter_db_path = ROOT_DIR / "data" / "twitter_intel.db"
    if twitter_db_path.exists():
        conn = None
        try:
            conn = sqlite3.connect(str(twitter_db_path), timeout=15.0)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT handle, name, category, desc, avatar
                FROM twitter_author_profiles
                WHERE category IN ('A_STOCK', 'MACRO_GLOBAL', 'TECH_INDUSTRY')
                   OR handle IN (SELECT DISTINCT author_handle FROM twitter_tweets WHERE is_noise = 0)
            """)
            for handle, name, category, desc, avatar in cursor.fetchall():
                if not handle:
                    continue
                h_clean = str(handle).strip()
                h_formatted = h_clean if h_clean.startswith("@") else f"@{h_clean}"
                h_lower = h_formatted.lower()
                key = h_formatted.replace("@", "").lower()

                if h_lower not in authors_map:
                    authors_map[h_lower] = {
                        "name": name or handle,
                        "handle": h_formatted,
                        "category": category or "A_STOCK",
                        "desc": desc or "",
                        "avatar": avatar or "",
                        "badge": desc or f"{category or 'A股'}博主",
                        "icon": "ri-twitter-x-line",
                        "key": key
                    }
                else:
                    if name and not authors_map[h_lower].get("name"):
                        authors_map[h_lower]["name"] = name
        except Exception as e:
            logger.warning(f"动态加载推特博主白名单异常: {e}")
        finally:
            if conn:
                conn.close()

    result = list(authors_map.values())
    _AUTHORS_CACHE = result
    _AUTHORS_CACHE_TIME = time.time()
    return result


def get_curated_news_paginated(
    page: int = 1,
    page_size: int = 10,
    sort_by: str = "time",
    portfolio_only: bool = False,
    keyword: Optional[str] = None,
    source_category: str = "all",
    author: Optional[str] = None
) -> dict:
    """获取去重持久化资讯情报列表，支持按博主范围抓取、来源分流 (推特专属 / 其他来源 / 综合)、排序、持仓过滤与卡片分页"""
    try:
        from utils.portfolio_advisor import portfolio_store
        portfolio_store.load()
        user_symbols = set()
        user_names = set()
        for sym, p in (portfolio_store.positions or {}).items():
            user_symbols.add(sym)
            if hasattr(p, "name") and p.name:
                user_names.add(p.name)
        for sym, w in (portfolio_store.watchlist or {}).items():
            user_symbols.add(sym)
            if hasattr(w, "name") and w.name:
                user_names.add(w.name)

        news_items = []
        all_authors = get_dynamic_stock_authors()
        all_handles = [a["handle"] for a in all_authors]
        authors_stat_map = {a["handle"]: 0 for a in all_authors}

        # 1. 𝕏 (Twitter) 专属股票情报流提取
        twitter_db_path = ROOT_DIR / "data" / "twitter_intel.db"
        if source_category in ("twitter", "all") and twitter_db_path.exists():
            tw_conn = None
            try:
                tw_conn = sqlite3.connect(str(twitter_db_path), timeout=15.0)
                tw_cursor = tw_conn.cursor()

                tw_where = ["is_noise = 0"]
                tw_params = []

                # 严格限定在关注的股票博主名单内
                if author and author.strip() and author.lower() != "all":
                    target_auth = author.strip().lower()
                    matched_h = None
                    for item in all_authors:
                        if item["key"] == target_auth or item["handle"].lower() == target_auth or item["handle"].lower().replace("@", "") == target_auth:
                            matched_h = item["handle"]
                            break
                    if matched_h:
                        tw_where.append("author_handle = ?")
                        tw_params.append(matched_h)
                    else:
                        tw_where.append("author_handle LIKE ?")
                        tw_params.append(f"%{target_auth}%")
                else:
                    placeholders = ",".join(["?"] * len(all_handles))
                    tw_where.append(f"author_handle IN ({placeholders})")
                    tw_params.extend(all_handles)

                # 关键词筛选
                if keyword and keyword.strip():
                    kw = f"%{keyword.strip()}%"
                    tw_where.append("(text_raw LIKE ? OR text_translated LIKE ? OR author_name LIKE ? OR related_concept LIKE ?)")
                    tw_params.extend([kw, kw, kw, kw])

                tw_order = "id DESC"
                if sort_by == "rating":
                    tw_order = "importance_score DESC, id DESC"

                tw_sql = f"""
                    SELECT id, author_name, author_handle, author_avatar, created_at, relative_time,
                           text_raw, text_translated, related_concept, sentiment, importance_score, tweet_url,
                           media_urls, related_stocks, has_stock_mention, mentioned_stocks
                    FROM twitter_tweets
                    WHERE {" AND ".join(tw_where)}
                    ORDER BY {tw_order}
                """
                tw_cursor.execute(tw_sql, tw_params)
                
                for tr in tw_cursor.fetchall():
                    (tw_id, a_name, a_handle, a_avatar, c_at, rel_time, t_raw, t_trans, 
                     rel_concept, sent, imp_score, tw_url, media_urls_raw, rel_stocks_raw, 
                     has_stock_m, ment_stocks_raw) = tr

                    body_text = t_trans or t_raw or ""

                    # 过滤非股票生活杂质与鸡汤
                    if any(nsk in body_text for nsk in NON_STOCK_NOISE_KEYWORDS):
                        continue

                    display_title = f"【@{a_handle.replace('@','')} {a_name}】 {body_text[:68]}..." if len(body_text) > 68 else f"【@{a_handle.replace('@','')} {a_name}】 {body_text}"
                    
                    # 持仓与自选关联判定
                    is_rel = any(name in body_text for name in user_names if len(name) >= 2)
                    is_rel = is_rel or any(sym in body_text for sym in user_symbols)
                    if portfolio_only and not is_rel:
                        continue

                    parsed_media = []
                    if media_urls_raw:
                        try:
                            parsed_media = json.loads(media_urls_raw) if isinstance(media_urls_raw, str) else media_urls_raw
                        except Exception:
                            pass

                    parsed_stocks = []
                    if ment_stocks_raw:
                        try:
                            parsed_stocks = json.loads(ment_stocks_raw) if isinstance(ment_stocks_raw, str) else ment_stocks_raw
                        except Exception:
                            pass

                    stars_count = max(2, min(5, int((imp_score or 50) / 20) + 1))
                    rating_stars = "★" * stars_count + "☆" * (5 - stars_count)

                    # 统计每个博主的实际推文数
                    for ah in authors_stat_map.keys():
                        if ah.lower() == a_handle.lower():
                            authors_stat_map[ah] += 1
                            break

                    news_items.append({
                        "id": f"tw_{tw_id}",
                        "ref_tag": f"tw_{tw_id}",
                        "title": display_title,
                        "content": body_text,
                        "source": f"𝕏 @{a_handle.replace('@','')}",
                        "author_name": a_name,
                        "author_handle": a_handle,
                        "author_avatar": a_avatar or "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png",
                        "publish_time": rel_time or (str(c_at)[:16] if c_at else "刚刚"),
                        "created_at": c_at or "",
                        "sector": rel_concept or "A股个股研判与买卖点",
                        "sentiment": sent or "中性",
                        "rating": rating_stars,
                        "stars_num": stars_count,
                        "url": tw_url or f"https://x.com/{a_handle.replace('@','')}",
                        "is_portfolio_related": is_rel,
                        "is_twitter": True,
                        "media_urls": parsed_media if isinstance(parsed_media, list) else [],
                        "mentioned_stocks": parsed_stocks if isinstance(parsed_stocks, list) else []
                    })
            except Exception as e:
                logger.warning(f"读取推特情报异常: {e}")
            finally:
                if tw_conn:
                    tw_conn.close()

        # 2. 其他渠道资讯提取
        if source_category in ("other", "all") and DB_PATH.exists():
            conn = None
            try:
                conn = sqlite3.connect(str(DB_PATH), timeout=15.0)
                cursor = conn.cursor()
                cursor.execute("PRAGMA table_info(news_curated)")
                cols = [c[1] for c in cursor.fetchall()]
                time_col = "publish_time" if "publish_time" in cols else "created_at"
                imp_col = "importance_level" if "importance_level" in cols else "rating"
                url_col = "source_url" if "source_url" in cols else "'' AS source_url"
                sec_col = "sector" if "sector" in cols else "'' AS sector"
                sent_col = "sentiment" if "sentiment" in cols else "'中性' AS sentiment"

                where_clauses = ["1=1"]
                params = []

                if keyword and keyword.strip():
                    kw = f"%{keyword.strip()}%"
                    where_clauses.append("(title LIKE ? OR content LIKE ?)")
                    params.extend([kw, kw])

                order_by = "id DESC"
                if sort_by == "rating":
                    order_by = f"{imp_col} DESC, id DESC"

                sql = f"""
                    SELECT id, ref_tag, title, content, source, {time_col}, {imp_col}, {url_col}, {sec_col}, {sent_col}
                    FROM news_curated
                    WHERE {" AND ".join(where_clauses)}
                    ORDER BY {order_by}
                """
                cursor.execute(sql, params)
                rows = cursor.fetchall()
                for r in rows:
                    n_id, r_tag, title, content, source, pub_time, imp_val, src_url, sec_val, sent_val = r
                    is_rel = any(name in title for name in user_names if len(name) >= 2)
                    is_rel = is_rel or any(sym in title for sym in user_symbols)
                    if portfolio_only and not is_rel:
                        continue

                    stars_count = (imp_val + 1) if isinstance(imp_val, int) else 4
                    rating_stars = "★" * stars_count + "☆" * (5 - stars_count)

                    display_source = str(source or "权威财经").strip()
                    landing_url = str(src_url or "").strip()
                    if not landing_url:
                        landing_url = "https://finance.sina.com.cn/7x24/" if "新浪" in display_source else "https://kuaixun.eastmoney.com/"

                    news_items.append({
                        "id": n_id,
                        "ref_tag": r_tag,
                        "title": title,
                        "content": content or title,
                        "source": display_source,
                        "publish_time": str(pub_time)[-8:] if pub_time else "今日盘后",
                        "created_at": str(pub_time) if pub_time else "",
                        "sector": sec_val or "综合热点",
                        "sentiment": sent_val or "中性",
                        "rating": rating_stars,
                        "stars_num": stars_count,
                        "url": landing_url,
                        "is_portfolio_related": is_rel,
                        "is_twitter": False,
                        "media_urls": [],
                        "mentioned_stocks": []
                    })
            except Exception as e:
                logger.warning(f"读取 news_curated 异常: {e}")
            finally:
                if conn:
                    conn.close()

        # 3. 排序与切页
        if sort_by == "rating":
            news_items.sort(key=lambda x: (x.get("stars_num", 0), x.get("id", 0)), reverse=True)
        else:
            news_items.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)

        total_count = len(news_items)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paged_items = news_items[start_idx:end_idx]
        total_pages = max(1, (total_count + page_size - 1) // page_size)

        author_list_res = []
        for a in all_authors:
            h = a.get("handle", "")
            cnt = authors_stat_map.get(h, 0)
            author_list_res.append({
                "key": a.get("key", h.replace("@", "").lower()),
                "handle": h,
                "name": a.get("name", h),
                "badge": a.get("badge", a.get("desc", "财经大V")),
                "icon": a.get("icon", "ri-twitter-x-line"),
                "tweet_count": cnt
            })

        author_list_res.sort(key=lambda x: x.get("tweet_count", 0), reverse=True)

        return {
            "code": 200,
            "data": paged_items,
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "portfolio_related_count": sum(1 for x in news_items if x.get("is_portfolio_related")),
            "twitter_count": sum(1 for x in news_items if x.get("is_twitter")),
            "other_count": sum(1 for x in news_items if not x.get("is_twitter")),
            "authors_list": author_list_res
        }
    except Exception as e:
        logger.error(f"获取分页资讯异常: {e}")
        return {"code": 500, "message": str(e), "data": [], "total": 0, "total_pages": 1}


def get_single_news_detail(news_id_or_tag: str) -> dict:
    """获取单篇新闻快讯的完整正文、真实出处与官方落地页链接"""
    clean_id = news_id_or_tag.replace("ref:", "").strip()
    if DB_PATH.exists():
        conn = None
        try:
            conn = sqlite3.connect(str(DB_PATH), timeout=15.0)
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(news_curated)")
            cols = [c[1] for c in cursor.fetchall()]
            time_col = "publish_time" if "publish_time" in cols else "created_at"
            imp_col = "importance_level" if "importance_level" in cols else "rating"
            url_col = "source_url" if "source_url" in cols else "'' AS source_url"

            cursor.execute(f"""
                SELECT id, ref_tag, title, content, source, {time_col}, {imp_col}, {url_col}
                FROM news_curated
                WHERE id = ? OR ref_tag = ? OR title LIKE ?
                ORDER BY id DESC LIMIT 1
            """, (clean_id, news_id_or_tag, f"%{clean_id}%"))
            row = cursor.fetchone()
            if row:
                n_id, r_tag, title, content, source, pub_time, imp_val, src_url = row
                stars_count = (imp_val + 1) if isinstance(imp_val, int) else 4
                
                clean_time = str(pub_time).strip() if pub_time else ""
                today_str = datetime.now().strftime("%Y-%m-%d")
                if len(clean_time) == 8 and ":" in clean_time:
                    full_time = f"{today_str} {clean_time}"
                elif len(clean_time) >= 19:
                    full_time = clean_time[:19]
                else:
                    full_time = clean_time or f"{today_str} 09:30:00"

                display_source = str(source or "权威财经快讯").strip()
                landing_url = str(src_url or "").strip()
                if not landing_url:
                    landing_url = "https://finance.sina.com.cn/7x24/" if "新浪" in display_source else "https://kuaixun.eastmoney.com/"

                return {
                    "code": 200,
                    "data": {
                        "id": n_id,
                        "title": title,
                        "content": content or title,
                        "source": display_source,
                        "publish_time": full_time,
                        "sector": "核心宏观与行业资讯",
                        "sentiment": "政策/行业催化",
                        "rating": "★" * max(1, min(5, stars_count)),
                        "url": landing_url
                    }
                }
        except Exception as e:
            logger.warning(f"从 news_curated 读取异常: {e}")
        finally:
            if conn:
                conn.close()

    return {
        "code": 404,
        "message": f"未找到证据记录：{news_id_or_tag}",
        "data": None
    }


def get_single_evidence_detail(ref_tag: str) -> dict:
    """兼容旧路由：判断是股票代码还是新闻文章"""
    clean_tag = ref_tag.replace("ref:", "").strip()
    if clean_tag.isdigit() and len(clean_tag) == 6:
        from agents.stock_research_service import get_single_stock_research_detail
        return get_single_stock_research_detail(clean_tag)
    return get_single_news_detail(ref_tag)
