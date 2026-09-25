#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
纯正金融投资情报准入与清洗引擎 (Financial Signal Admission Engine)
彻底消灭社会打假新闻、自媒体爽文故事会、程序员写App、生活鸡汤与日常闲聊。
只准入：真实股票标的、上市公司动态、盘前盘后复盘、板块轮动与宏观财经政策！
"""

import sys
import sqlite3
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.twitter_monitor import DB_FILE_PATH, FAMOUS_STOCKS_DICT

# 1. 核心金融/交易/宏观关键词 (必须命中至少一项，证明是严肃交易投资内容)
FINANCIAL_CORE_TRIGGERS = [
    "盘前", "盘后", "复盘", "开盘", "收盘", "涨停", "跌停", "龙虎榜", "北向资金",
    "主力资金", "主力净流入", "成交额", "加仓", "减仓", "轻仓", "建仓", "清仓", "止损", "买点", "卖点",
    "美联储", "降息", "加息", "降准", "央行", "CPI", "非农", "国债", "汇率", "关税", "反倾销",
    "A股", "港股", "美股", "上证", "创业板", "科创板", "ETF", "股票", "证券", "个股", "选股", "持仓",
    "新股", "申购", "中签", "转债", "分红", "财报", "业绩", "净利润", "牛市", "熊市", "大盘", "指数",
    "机器人PH", "中证证券", "商业化", "交付量", "量产", "毛利率", "营收"
]

# 2. 科技与产业细分板块库
SECTOR_KEYWORDS = [
    "板块", "光通信", "光模块", "PCB", "液冷", "算力", "半导体", "集成电路", "芯片", 
    "机器人", "智能驾驶", "无人驾驶", "FSD", "Robotaxi", "Cybercab", "低空经济", "具身智能", 
    "新能源汽车", "锂电", "固态电池", "商业航天", "量子计算", "军工", "信创", "工业母机", "存储芯片",
    "DDR", "HBM", "CPO", "Optimus", "Blackwell"
]

# 3. 核心上市公司龙头字典
FAMOUS_COMPANIES = [
    "英伟达", "特斯拉", "比亚迪", "中际旭创", "新易盛", "寒武纪", "赛力斯", "苹果", "微软", "谷歌", 
    "台积电", "中芯国际", "腾讯", "阿里", "宁德时代", "浙江荣泰", "斯菱智驱", "剑桥科技", "共进股份", 
    "龙版传媒", "百大集团", "海欣食品", "亚盛集团", "超声电子", "中京电子", "集泰股份", "华为", "小米",
    "理想", "小鹏", "蔚来", "宇树科技", "高通", "博通", "AMD", "ASML", "HOOD", "美团"
]

# 4. 强垃圾一票否决
SPAM_BLOCKLIST = [
    "打卡戒色", "戒色", "被黑客", "黑客威胁", "会员购买", "赠送独家指标", "社群内部打卡", 
    "进群打卡", "入群打卡", "加微信", "微信群", "打卡满", "打卡送", "指标以及用法", "独家指标",
    "赵一鸣", "好想来", "称重", "复秤", "高额彩礼", "杀害", "打码", "抓小偷", "猪脚饭"
]


def execute_pure_financial_purge():
    print(f"🚀 启动纯正金融交易情报准入审查: {DB_FILE_PATH}")
    with sqlite3.connect(DB_FILE_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, author_name, text_raw, text_translated, mentioned_stocks FROM twitter_tweets")
        rows = cursor.fetchall()
        total = len(rows)

        qualified_ids = []
        discarded_ids = []

        for r in rows:
            t_id, author, raw, trans, ment_json = r
            combined = (raw or "") + " " + (trans or "")

            # A. 命中硬性社会八卦/生活琐事/引流词，一票否决
            if any(sp in combined for sp in SPAM_BLOCKLIST):
                discarded_ids.append((t_id, "社会八卦/打假维权/引流水推"))
                continue

            # B. 匹配有效股票代码 ($TICKER 或 A股6位代码如 601091, 159278)
            ticker_matches = re.findall(r"\$([A-Za-z]{1,6})\b", raw or "")
            ignore_tickers = {"USD", "USDT", "BTC", "ETH", "SOL", "AI", "CEO", "IPO", "FED", "CPI", "SEC", "GDP", "LLM", "API", "APP", "IOS", "VIBE", "ASTRA", "RT"}
            valid_tickers = [t for t in ticker_matches if t.upper() not in ignore_tickers]
            cn_code_matches = re.findall(r"(?<!\d)(?:60\d{4}|00\d{4}|30\d{4}|68\d{4}|15\d{4}|51\d{4}|56\d{4}|58\d{4}|92\d{4})(?!\d)", combined)
            has_explicit_stock = bool(valid_tickers or cn_code_matches)

            # C. 匹配知名上市公司与龙头企业
            has_famous_stock = any(fn in combined for fn in FAMOUS_COMPANIES)

            # D. 匹配核心金融盘面词与板块
            has_financial_core = any(trig in combined for trig in FINANCIAL_CORE_TRIGGERS)
            has_sector = any(sec in combined for sec in SECTOR_KEYWORDS)

            # 准入法则：必须具备实质股票代码、上市公司动态、或者（金融词 + 板块词）共振！
            is_valid = (
                has_explicit_stock or 
                has_famous_stock or 
                (has_financial_core and has_sector) or 
                ("盘前" in combined or "复盘" in combined or "新股" in combined or "热点事件" in combined)
            )

            # 特殊过滤：纯程序员个人做开发/上架App、纯职场鸡汤碎碎念
            if any(k in combined for k in ["上架APP", "独立开发", "处理破事", "日本职场", "赚够三千万", "住户调查", "监控视频在哪里"]):
                is_valid = False

            if is_valid:
                qualified_ids.append((t_id, "认证真实股票与产业投资情报"))
            else:
                discarded_ids.append((t_id, "非股票投资/社会鸡汤/个人琐事"))

        # 批量写库
        print(f"💾 正在更新数据库标记: 准入 {len(qualified_ids)} 条，剔除 {len(discarded_ids)} 条...")
        for qid, reason in qualified_ids:
            cursor.execute("UPDATE twitter_tweets SET is_noise = 0, ai_reason = ? WHERE id = ?", (reason, qid))

        for did, reason in discarded_ids:
            cursor.execute("UPDATE twitter_tweets SET is_noise = 1, importance_score = 0, has_stock_mention = 0, ai_reason = ? WHERE id = ?", (reason, did))

        conn.commit()

        print(f"\n🎉 纯正金融过滤彻底完成！")
        print(f"   📊 总推文: {total} 条")
        print(f"   ✅ 纯正股票与宏观产业情报: {len(qualified_ids)} 条 (已呈现在雷达中)")
        print(f"   🗑️ 剔除社会八卦/生活琐事/职场爽文: {len(discarded_ids)} 条 (已全部隔离)")


if __name__ == "__main__":
    execute_pure_financial_purge()
