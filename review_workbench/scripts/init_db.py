"""
交易复盘工作台数据库初始化脚本 (SQLite / TimescaleDB Compatible)
创建 4 大核心数据表：
1. daily_reviews (每日复盘主表)
2. core_watchlists (核心观察池 45 只高胜率标的)
3. news_curated (经过 SimHash 去重的核心资讯证据库)
4. funnel_logs (漏斗过滤全流程审计日志)
"""

import sqlite3
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("InitReviewDB")

DB_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DB_DIR / "review.db"


def init_database():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # 1. 每日复盘主表 (daily_reviews)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_date TEXT UNIQUE NOT NULL,            -- 交易日期 (YYYY-MM-DD)
            market_summary TEXT NOT NULL,               -- 大盘总成交额/涨跌停/涨跌中位数 JSON
            sentiment_summary TEXT NOT NULL,            -- 复盘组长定调文案 (携带 [ref:X])
            main_themes JSON,                           -- 主线板块列表 JSON
            game_plan_tomorrow TEXT,                    -- 次日博弈策略建议
            citations JSON,                             -- 引用证据索引字典
            degraded_nodes JSON,                        -- 降级节点列表 (如 ["attribution_matcher"])
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 2. 核心观察池 (core_watchlists)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS core_watchlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_date TEXT NOT NULL,                   -- 交易日期
            stock_code TEXT NOT NULL,                   -- 股票代码 (如 300308.SZ)
            stock_name TEXT NOT NULL,                   -- 股票名称
            sector_name TEXT,                           -- 所属板块
            close_price REAL,                           -- 收盘价
            change_pct REAL,                            -- 今日涨跌幅 %
            turnover_rate REAL,                         -- 换手率 %
            amount_yi REAL,                             -- 成交额 (亿元)
            volatility_pattern TEXT,                    -- 形态 (如 "limit_up", "breakout")
            attribution_type TEXT,                      -- 归因类型 (hotspot/earnings/policy/us_mapping)
            attribution_detail TEXT,                    -- 归因描述说明
            attribution_confidence REAL,                -- 置信度分数 (0.0 ~ 1.0)
            confidence_level TEXT,                      -- 置信度等级 ("high", "medium", "low", "unconfirmed")
            risk_flags JSON,                            -- 风险标签列表 (如 ["high_turnover", "micro_cap"])
            evidence_ref TEXT,                          -- 引用证据编号 (如 "ref:2")
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(trade_date, stock_code)
        );
    """)

    # 3. 核心资讯证据库 (news_curated)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS news_curated (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_date TEXT NOT NULL,                   -- 交易日期
            ref_tag TEXT NOT NULL,                      -- 引用编号 (如 "ref:1", "ref:2")
            title TEXT NOT NULL,                        -- 新闻标题
            content TEXT,                               -- 精炼摘要
            source TEXT,                                -- 来源 (如 "交易所公告", "行业要闻", "美股映射")
            simhash_fingerprint TEXT,                   -- SimHash 指纹 (用于去重)
            importance_level INTEGER DEFAULT 1,         -- 重要性评级 (1~4 级)
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(trade_date, ref_tag)
        );
    """)

    # 4. 漏斗过滤审计日志表 (funnel_logs)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS funnel_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_date TEXT NOT NULL,
            stage INTEGER NOT NULL,                     -- 漏斗第几层 (1/2/3/4)
            stage_name TEXT NOT NULL,                   -- 层级名称
            input_count INTEGER NOT NULL,               -- 输入标的数量
            output_count INTEGER NOT NULL,              -- 过滤后保留数量
            filter_summary JSON,                        -- 各项规则剔除统计详情
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 索引优化
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_watchlists_date ON core_watchlists (trade_date);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_news_date ON news_curated (trade_date);")

    conn.commit()
    conn.close()
    logger.info(f"✅ 交易复盘工作台数据库初始化成功: {DB_PATH}")


if __name__ == "__main__":
    init_database()
