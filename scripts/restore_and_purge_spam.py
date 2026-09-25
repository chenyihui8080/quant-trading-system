#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
精准排毒与历史多日推文全量召回脚本 (Restore & Precise Spam Purge)
1. 精准屏蔽：打卡戒色、黑客威胁、进群打卡、会员购买等硬性引流水推 (is_noise = 1)
2. 完整召回：前几天收集的全部真实历史大V推文 (is_noise = 0)
3. 纠正标星：无具体股票代码的推文取消 has_stock_mention，杜绝乱打星
"""

import sys
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.twitter_monitor import DB_FILE_PATH

HARD_SPAM = [
    "打卡戒色", "戒色", "被黑客", "黑客威胁", "会员购买", "赠送独家指标", 
    "社群打卡", "进群打卡", "社群内部打卡", "入群打卡", "加微信", "微信群", 
    "打卡满", "打卡送", "指标以及用法", "独家指标", "独家通达信指标", "源码分享", "进群"
]

def restore_and_purge():
    print(f"🚀 连接推特数据库: {DB_FILE_PATH}")
    with sqlite3.connect(DB_FILE_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, author_name, text_raw, text_translated, mentioned_stocks FROM twitter_tweets")
        rows = cursor.fetchall()
        total = len(rows)

        spam_ids = []
        clean_ids = []
        clear_star_ids = []

        for r in rows:
            t_id, author, raw, trans, ment_stocks_json = r
            combined = f"{raw or ''} {trans or ''}".strip()
            
            # 判断是否为硬性垃圾引流
            is_spam = any(sp in combined for sp in HARD_SPAM) or (combined.startswith("@") and len(combined) < 18 and not any(k in combined for k in ["涨", "跌", "买", "卖", "仓", "线", "板块", "股", "币"]))

            if is_spam:
                spam_ids.append(t_id)
            else:
                clean_ids.append(t_id)
                # 检查是否虚标提股 (无具体代码但打了星)
                ment_list = []
                try:
                    import json
                    ment_list = json.loads(ment_stocks_json or "[]")
                except Exception:
                    ment_list = []
                if not ment_list:
                    clear_star_ids.append(t_id)

        # 1. 垃圾推文打标隔离
        for sid in spam_ids:
            cursor.execute("UPDATE twitter_tweets SET is_noise = 1, importance_score = 0, has_stock_mention = 0, ai_reason = '社群引流/打卡戒色/黑客琐事' WHERE id = ?", (sid,))

        # 2. 正常历史推文全量召回
        for cid in clean_ids:
            cursor.execute("UPDATE twitter_tweets SET is_noise = 0, ai_reason = '正常历史情报' WHERE id = ?", (cid,))

        # 3. 纠正无代码的虚标推文
        for csid in clear_star_ids:
            cursor.execute("UPDATE twitter_tweets SET has_stock_mention = 0 WHERE id = ?", (csid,))

        conn.commit()

        print(f"🎉 历史推特精准排毒与召回完成！")
        print(f"   📊 数据库总推文: {total} 条")
        print(f"   🗑️ 精准隔离引流水推: {len(spam_ids)} 条 (已屏蔽)")
        print(f"   ✨ 完整召回正常历史推文: {len(clean_ids)} 条 (完整涵盖好几天)")
        print(f"   🎯 纠正消除虚假提股标星: {len(clear_star_ids)} 条 (只有真提代码才标星)")

if __name__ == "__main__":
    restore_and_purge()
