#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
定向深度回溯脚本 (近半个月推文收割)
严格复用当前打磨完毕的 ai_tweet_classifier 分类引擎与 FAMOUS_STOCKS_DICT 股票提取，
保持最高过滤纯度，不放松任何规则，将数据跨度稳健扩充到近半个月！
"""

import sys
import time
import json
import re
import sqlite3
import requests
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.twitter_monitor import DB_FILE_PATH, global_twitter_monitor, FAMOUS_STOCKS_DICT
from utils.ai_tweet_classifier import classify_tweet


def run_half_month_backfill(max_pages=20):
    print(f"🚀 启动推特关注流【深度连续回溯】(计划最大翻页: {max_pages} 页)...")
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
        url = "https://x.com/i/api/2/timeline/home.json?tweet_mode=extended&count=40"
        if cursor_val:
            url += f"&cursor={cursor_val}"

        try:
            resp = requests.get(url, headers=headers, proxies=proxies, timeout=15)
            if resp.status_code != 200:
                print(f"   ⚠️ 第 {page_idx} 页抓取受限 (HTTP {resp.status_code})，停止继续翻页")
                break

            data = resp.json()
            tweets = data.get("globalObjects", {}).get("tweets", {})
            users = data.get("globalObjects", {}).get("users", {})
            raw_tweets_map.update(tweets)
            raw_users_map.update(users)

            print(f"   [第 {page_idx:02d}/{max_pages} 页] 本页抓取 {len(tweets)} 条，累计已收割: {len(raw_tweets_map)} 条推文...")

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
            time.sleep(0.8)
        except Exception as e:
            print(f"   ❌ 第 {page_idx} 页抓取异常: {e}")
            break

    total_harvested = len(raw_tweets_map)
    print(f"\n📊 深度回溯总计抓取到 {total_harvested} 条历史推文！开始批量翻译与【严格分类审查】...")

    # 查重：只翻译和处理库里没有的推文
    with sqlite3.connect(DB_FILE_PATH) as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM twitter_tweets")
        existing_ids = {str(r[0]) for r in cur.fetchall()}

    new_tweets = {k: v for k, v in raw_tweets_map.items() if str(k) not in existing_ids}
    print(f"💡 其中全新历史推文: {len(new_tweets)} 条，已有推文已自动跳过！")

    if not new_tweets:
        print("✅ 没有新的未入库历史推文需要处理！")
        return

    # 并发翻译未翻译文本
    raw_texts = [tw.get("full_text", tw.get("text", "")) for tw in new_tweets.values() if tw.get("full_text") or tw.get("text")]
    print(f"🌐 正在并行批量翻译 {len(raw_texts)} 条全新推文...")
    translated_map = global_twitter_monitor.batch_translate_texts(raw_texts)

    # 严格审查与入库
    seen_fingerprints = set()
    inserted_clean = 0
    inserted_noise = 0

    with sqlite3.connect(DB_FILE_PATH) as conn:
        cursor = conn.cursor()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        for tw_id, tw in new_tweets.items():
            text_raw = tw.get("full_text", tw.get("text", ""))
            text_trans = translated_map.get(text_raw, text_raw)
            combined = f"{text_raw} {text_trans}".strip()

            user_id = str(tw.get("user_id_str", tw.get("user_id", "")))
            user_obj = raw_users_map.get(user_id, {})
            author_name = user_obj.get("name", "推特博主")
            author_handle = "@" + user_obj.get("screen_name", "unknown")
            clean_handle = user_obj.get("screen_name", "").lower().strip()
            author_avatar = user_obj.get("profile_image_url_https", "")

            # ⭐️ 核心审查：100% 沿用当前最新调优的 classify_tweet 规则
            ai_res = classify_tweet(combined, author_handle=clean_handle, tweet_id=str(tw_id))
            is_relevant = ai_res.get("is_stock_relevant", False)
            is_spam = ai_res.get("is_spam", False)
            ai_reason = ai_res.get("reason", "")
            symbols = ai_res.get("stock_symbols", [])

            # 股票识别与提取 (严格对齐 FAMOUS_STOCKS_DICT)
            ment = []
            seen_symbols = set()
            for sym in symbols:
                if sym in FAMOUS_STOCKS_DICT:
                    info = FAMOUS_STOCKS_DICT[sym]
                    if info["symbol"] not in seen_symbols:
                        ment.append(info)
                        seen_symbols.add(info["symbol"])
                elif sym.isdigit():
                    if sym not in seen_symbols:
                        ment.append({"symbol": sym, "name": sym, "market": "A"})
                        seen_symbols.add(sym)
                else:
                    if sym not in seen_symbols:
                        ment.append({"symbol": sym, "name": "$" + sym, "market": "US"})
                        seen_symbols.add(sym)

            # 中文股票名匹配
            for name_key, info in FAMOUS_STOCKS_DICT.items():
                if len(name_key) >= 2 and name_key in combined:
                    if info["symbol"] not in seen_symbols:
                        ment.append(info)
                        seen_symbols.add(info["symbol"])

            is_noise = 0 if (is_relevant and not is_spam) else 1
            has_stock = 1 if (is_relevant and len(ment) > 0) else 0
            importance = 5 if (is_relevant and has_stock) else (3 if is_relevant else 0)

            # 解析发推时间戳
            created_at_str = tw.get("created_at", "")
            created_ts = 0.0
            if created_at_str:
                try:
                    dt = datetime.strptime(created_at_str, "%a %b %d %H:%M:%S %z %Y")
                    created_ts = dt.timestamp()
                except Exception:
                    pass

            # 配图解析
            media_urls = []
            for m in tw.get("entities", {}).get("media", []):
                if m.get("media_url_https"):
                    media_urls.append(m["media_url_https"])

            try:
                cursor.execute("""
                    INSERT OR REPLACE INTO twitter_tweets (
                        id, author_name, author_handle, author_avatar,
                        text_raw, text_translated, created_at, created_timestamp,
                        relative_time, likes, retweets, tweet_url,
                        is_stock_relevant, is_noise, ai_reason,
                        has_stock_mention, mentioned_stocks, importance_score,
                        is_demo, fetched_at, source_type, media_urls
                    ) VALUES (
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        0, ?, 'following', ?
                    )
                """, (
                    str(tw_id), author_name, author_handle, author_avatar,
                    text_raw, text_trans, created_at_str, created_ts,
                    "刚刚", tw.get("favorite_count", 0), tw.get("retweet_count", 0),
                    f"https://x.com/{clean_handle}/status/{tw_id}",
                    1 if is_relevant else 0, is_noise, ai_reason,
                    has_stock, json.dumps(ment, ensure_ascii=False), importance,
                    now_str, json.dumps(media_urls, ensure_ascii=False)
                ))

                if is_noise == 0:
                    inserted_clean += 1
                else:
                    inserted_noise += 1
            except Exception as e:
                pass

        conn.commit()

    print(f"\n🎉 回溯收割入库完毕！")
    print(f"✨ 新增有效纯净金融推文: {inserted_clean} 条")
    print(f"🛡️ 自动过滤非金融噪音: {inserted_noise} 条")


if __name__ == "__main__":
    run_half_month_backfill(max_pages=15)
