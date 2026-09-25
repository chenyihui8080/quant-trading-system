#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
极速二段式推特数据库历史噪音清洗脚本
"""

import sys
import sqlite3
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.twitter_monitor import DB_FILE_PATH, FAMOUS_STOCKS_DICT
from utils.ai_tweet_classifier import HARD_SPAM_KEYWORDS, extract_explicit_stock_codes, _call_local_ollama_classifier


def run_fast_purge():
    print(f"🚀 开始极速清洗推特历史数据库: {DB_FILE_PATH}", flush=True)
    if not DB_FILE_PATH.exists():
        print("❌ 数据库文件不存在", flush=True)
        return

    with sqlite3.connect(DB_FILE_PATH) as conn:
        cursor = conn.cursor()

        try:
            cursor.execute("ALTER TABLE twitter_tweets ADD COLUMN is_noise INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE twitter_tweets ADD COLUMN ai_reason TEXT DEFAULT ''")
        except Exception:
            pass

        cursor.execute("SELECT id, text_raw, text_translated, author_handle, author_name FROM twitter_tweets")
        rows = cursor.fetchall()
        total = len(rows)
        print(f"📊 检出历史推文 {total} 条，开始二段式极速研判...", flush=True)

        noise_ids = []
        valid_ids = []

        for idx, r in enumerate(rows, 1):
            t_id, raw, trans, handle, name = r
            combined = f"{raw or ''} {trans or ''}".strip()

            # 1. 规则直通：命中强引流/打卡/生活垃圾
            is_spam = any(k in combined for k in HARD_SPAM_KEYWORDS)
            if is_spam:
                noise_ids.append((t_id, "包含社群引流/打卡/无意义琐事"))
                continue

            # 2. 规则直通：包含精确股票代码或知名上市公司龙头
            explicit_syms = extract_explicit_stock_codes(combined)
            famous_hit = any(fn in combined for fn in ["英伟达", "特斯拉", "苹果", "微软", "谷歌", "中际旭创", "新易盛", "寒武纪", "赛力斯", "机器人", "芯片", "半导体", "光模块", "算力", "FSD", "Robotaxi", "Cybercab"])
            if explicit_syms or famous_hit:
                valid_ids.append((t_id, f"精准提及股票/产业标的: {', '.join(explicit_syms) if explicit_syms else '核心产业龙头'}"))
                continue

            # 3. 极短无实质社交
            if combined.startswith("@") and len(combined) < 20 and not any(k in combined for k in ["涨", "跌", "买", "卖", "仓", "线", "板块"]):
                noise_ids.append((t_id, "纯社交闲聊互撩"))
                continue

            # 4. 包含泛市场词 (如板块、大盘、震荡)
            has_market = any(k in combined for k in ["板块", "大盘", "指数", "反弹", "跳水", "成交额", "主力", "仓位", "止损", "突破"])
            if has_market:
                valid_ids.append((t_id, "讨论盘面走势与板块情绪"))
            else:
                noise_ids.append((t_id, "无金融实体或泛生活闲聊"))

        print(f"💾 审查完毕！正在批量写入数据库...", flush=True)
        # 批量更新噪音推文
        for nid, reason in noise_ids:
            cursor.execute("UPDATE twitter_tweets SET is_noise = 1, importance_score = 0, has_stock_mention = 0, ai_reason = ? WHERE id = ?", (reason, nid))

        # 批量更新有效推文
        for vid, reason in valid_ids:
            cursor.execute("UPDATE twitter_tweets SET is_noise = 0, ai_reason = ? WHERE id = ?", (reason, vid))

        conn.commit()
        print(f"\n🎉 历史推特清洗成功！总数: {total} 条：", flush=True)
        print(f"   🗑️ 成功揪出并隔离垃圾水推/引流: {len(noise_ids)} 条", flush=True)
        print(f"   ✨ 提炼确认纯净股票与产业情报: {len(valid_ids)} 条", flush=True)


if __name__ == "__main__":
    run_fast_purge()
