#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
推特全量历史深度回溯与纯正金融收割脚本 (Deep Backfill & Pure Financial Ingestion)
通过 cursor-bottom 连续深度回溯翻页 10~15 页，收割过去数天内全部关注博主的推文，
并经过【正向金融准入 + 转推RT去重 + 凶案八卦排除】，充实本地纯净股票雷达！
"""

import sys
import time
import json
import re
import sqlite3
import requests
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.twitter_monitor import DB_FILE_PATH, global_twitter_monitor, FAMOUS_STOCKS_DICT
from scripts.pure_financial_filter import FINANCIAL_CORE_TRIGGERS, SECTOR_KEYWORDS, FAMOUS_COMPANIES, SPAM_BLOCKLIST


def deep_backfill_and_ingest(max_pages=12):
    print(f"🚀 启动推特关注流【深度连续回溯抓取流水线】(目标 {max_pages} 页)...")
    cfg = global_twitter_monitor.config
    headers = {
        "authorization": cfg.get("bearer_token"),
        "x-csrf-token": cfg.get("ct0"),
        "cookie": cfg.get("full_cookie"),
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
    proxies = {"http": cfg.get("proxy_url"), "https": cfg.get("proxy_url")}

    cursor_val = ""
    raw_tweets_map = {}
    raw_users_map = {}

    for page_idx in range(1, max_pages + 1):
        url = f"https://x.com/i/api/2/timeline/home.json?tweet_mode=extended&count=40"
        if cursor_val:
            url += f"&cursor={cursor_val}"

        try:
            resp = requests.get(url, headers=headers, proxies=proxies, timeout=12)
            if resp.status_code != 200:
                print(f"   ⚠️ 第 {page_idx} 页抓取受限 (HTTP {resp.status_code})，停止继续翻页")
                break

            data = resp.json()
            tweets = data.get("globalObjects", {}).get("tweets", {})
            users = data.get("globalObjects", {}).get("users", {})
            raw_tweets_map.update(tweets)
            raw_users_map.update(users)

            print(f"   [页码 {page_idx:02d}/{max_pages}] 抓取 {len(tweets)} 条，累计已收割: {len(raw_tweets_map)} 条推文...")

            # 提取下一页 cursor
            next_cursor = ""
            for inst in data.get("timeline", {}).get("instructions", []):
                for entry in inst.get("addEntries", {}).get("entries", []):
                    if "cursor-bottom" in entry.get("entryId", ""):
                        next_cursor = entry.get("content", {}).get("operation", {}).get("cursor", {}).get("value")
                        break
            if not next_cursor or next_cursor == cursor_val:
                print("   🏁 已到达推特时间线最底部！")
                break
            cursor_val = next_cursor
            time.sleep(0.6)
        except Exception as e:
            print(f"   ❌ 第 {page_idx} 页抓取异常: {e}")
            break

    total_harvested = len(raw_tweets_map)
    print(f"\n📊 深度回溯总计抓取到 {total_harvested} 条推文！开始批量翻译与正向金融准入审查...")

    # 1. 批量翻译
    raw_texts = [tw.get("full_text", tw.get("text", "")) for tw in raw_tweets_map.values() if tw.get("full_text") or tw.get("text")]
    print(f"🌐 正在并行翻译 {len(raw_texts)} 条推文...")
    translated_map = global_twitter_monitor.batch_translate_texts(raw_texts)

    # 2. 正向金融准入与转推RT去重
    seen_fingerprints = set()
    valid_items = []
    noise_count = 0
    dup_count = 0

    crime_keywords = ["死亡", "身亡", "遗体", "凶杀", "命案", "失联", "失踪", "杀害", "警方通报", "嫌疑人", "被杀", "遇害"]

    with sqlite3.connect(DB_FILE_PATH) as conn:
        cursor = conn.cursor()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        for tw_id, tw in raw_tweets_map.items():
            text_raw = tw.get("full_text", tw.get("text", ""))
            text_trans = translated_map.get(text_raw, text_raw)
            combined = (text_raw + " " + text_trans).strip()

            # 提取作者
            user_id = str(tw.get("user_id_str", tw.get("user_id", "")))
            user_obj = raw_users_map.get(user_id, {})
            author_name = user_obj.get("name", "推特博主")
            author_handle = "@" + user_obj.get("screen_name", "unknown")
            author_avatar = user_obj.get("profile_image_url_https", "")

            # 凶杀命案一票否决
            if any(ck in combined for ck in crime_keywords) or any(sp in combined for sp in SPAM_BLOCKLIST):
                is_noise = 1
                ai_reason = "凶杀案件/社会打假/垃圾引流"
                noise_count += 1
            else:
                # 检查正向金融准入
                ticker_matches = re.findall(r"\$([A-Za-z]{1,6})\b", text_raw)
                ignore_tickers = {"USD", "USDT", "BTC", "ETH", "SOL", "AI", "CEO", "IPO", "FED", "CPI", "SEC", "GDP", "LLM", "API", "APP", "IOS", "VIBE", "ASTRA", "RT"}
                valid_tickers = [t for t in ticker_matches if t.upper() not in ignore_tickers]
                cn_code_matches = re.findall(r"(?<!\d)(?:60\d{4}|00\d{4}|30\d{4}|68\d{4}|15\d{4}|51\d{4}|56\d{4}|58\d{4}|92\d{4})(?!\d)", combined)
                has_explicit = bool(valid_tickers or cn_code_matches)
                has_company = any(fn in combined for fn in FAMOUS_COMPANIES)
                has_finance = any(trig in combined for trig in FINANCIAL_CORE_TRIGGERS)
                has_sector = any(sec in combined for sec in SECTOR_KEYWORDS)

                is_stock = (has_explicit or has_company or (has_finance and has_sector) or ("盘前" in combined or "复盘" in combined or "新股" in combined))

                # 排除纯个人鸡汤闲聊
                if any(k in combined for k in ["上架APP", "独立开发", "处理破事", "日本职场", "赚够三千万", "住户调查", "监控视频"]):
                    is_stock = False

                if is_stock:
                    # 语义去重指纹 (去掉开头的 RT @xxx: )
                    cleaned_body = re.sub(r"^RT\s*@[a-zA-Z0-9_]+:\s*", "", text_raw).strip()[:80]
                    if cleaned_body in seen_fingerprints:
                        dup_count += 1
                        is_noise = 1
                        ai_reason = "重复转推副本"
                    else:
                        seen_fingerprints.add(cleaned_body)
                        is_noise = 0
                        ai_reason = "认证真实股票与产业情报"
                else:
                    is_noise = 1
                    ai_reason = "非股票投资/生活闲聊"
                    noise_count += 1

            # 提取提及股票明细
            ment_stocks = []
            if is_noise == 0:
                for sym in valid_tickers:
                    u = sym.upper()
                    if u in FAMOUS_STOCKS_DICT:
                        ment_stocks.append(FAMOUS_STOCKS_DICT[u])
                    else:
                        ment_stocks.append({"symbol": u, "name": f"${u}", "market": "US"})
                for c in cn_code_matches:
                    ment_stocks.append({"symbol": c, "name": c, "market": "A"})
                for fn in FAMOUS_COMPANIES:
                    if fn in combined and not any(s["name"] == fn for s in ment_stocks):
                        ment_stocks.append({"symbol": fn, "name": fn, "market": "A"})

            # 计算时间戳
            created_at_raw = tw.get("created_at", "")
            try:
                dt = datetime.strptime(created_at_raw, "%a %b %d %H:%M:%S %z %Y")
                ts = dt.timestamp()
            except Exception:
                ts = time.time()

            concept, stocks, sentiment = global_twitter_monitor.map_a_share_concepts(combined)

            # 写入 SQLite
            cursor.execute("""
                INSERT INTO twitter_tweets (
                    id, author_name, author_handle, author_avatar, created_at, created_timestamp,
                    relative_time, text_raw, text_translated, likes, retweets, tweet_url,
                    related_concept, related_stocks, sentiment, has_stock_mention,
                    mentioned_stocks, importance_score, is_demo, fetched_at, source_type, media_urls,
                    is_noise, ai_reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    text_translated = excluded.text_translated,
                    has_stock_mention = excluded.has_stock_mention,
                    mentioned_stocks = excluded.mentioned_stocks,
                    importance_score = excluded.importance_score,
                    is_noise = excluded.is_noise,
                    ai_reason = excluded.ai_reason
            """, (
                tw_id, author_name, author_handle, author_avatar, created_at_raw, ts,
                "刚刚", text_raw, text_trans, tw.get("favorite_count", 0), tw.get("retweet_count", 0),
                f"https://x.com/{user_obj.get('screen_name', '')}/status/{tw_id}",
                concept, json.dumps(stocks, ensure_ascii=False), sentiment,
                1 if (is_noise == 0 and len(ment_stocks) > 0) else 0,
                json.dumps(ment_stocks, ensure_ascii=False),
                5 if (is_noise == 0 and len(ment_stocks) > 0) else (3 if is_noise == 0 else 0),
                0, now_str, "following", "[]",
                is_noise, ai_reason
            ))

        conn.commit()

    # 统计库中当前留存的有效股票情报数量
    with sqlite3.connect(DB_FILE_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM twitter_tweets WHERE is_noise = 0")
        pure_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM twitter_tweets")
        total_db = cursor.fetchone()[0]

    print(f"\n🎉 深度回溯与纯正金融清洗圆满完成！")
    print(f"   📦 本地数据库总收纳推文: {total_db} 条")
    print(f"   🎯 纯正股票与产业投资情报: {pure_count} 条 (大幅充实且全部合规)")
    print(f"   🚫 过滤掉重复转推副本: {dup_count} 条")
    print(f"   🗑️ 隔离剔除凶案八卦与生活闲聊: {noise_count} 条")


if __name__ == "__main__":
    deep_backfill_and_ingest(max_pages=10)
