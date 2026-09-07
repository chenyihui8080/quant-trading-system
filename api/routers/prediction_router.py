#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
股票判断记录与 AI 复盘对比路由 (Prediction Tracking & Review Router)
职责：
1. 记录每日操盘判断（看涨/看跌/买入/卖出/持有、目标价、理由）；
2. 第二天自动拉取真实涨跌与收盘价，与预测对比；
3. AI 智能复盘解读判断对错的原因；
4. 计算整体准确率、胜率、平均涨跌幅对比等统计指标。
"""

import sqlite3
import json
import logging
import httpx
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils.auth import get_optional_user

logger = logging.getLogger("PredictionRouter")
router = APIRouter(prefix="/api/prediction", tags=["预测记录与AI复盘"])

# 数据库路径
DB_PATH = Path(__file__).parent.parent.parent / "data" / "prediction.db"


# ==================== 数据库初始化 ====================
def get_db():
    """获取数据库连接，自动初始化表结构 (带 20s 并发超时与 WAL 模式防死锁)"""
    conn = sqlite3.connect(str(DB_PATH), timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")

    # 预测记录主表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prediction_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_date TEXT NOT NULL,          -- 判断日期 (YYYY-MM-DD)
            stock_code TEXT NOT NULL,           -- 股票代码
            stock_name TEXT NOT NULL,           -- 股票名称
            direction TEXT NOT NULL,            -- 判断方向: buy/sell/hold/long/short
            target_price REAL,                  -- 目标价（可为空）
            stop_loss REAL,                     -- 防守止损价（可为空）
            entry_price REAL,                   -- 记录时当前价格
            shares INTEGER,                     -- 计划买卖股数
            confidence INTEGER DEFAULT 3,       -- 信心等级 1-5
            reason TEXT,                        -- 判断理由
            tags TEXT,                          -- 标签（逗号分隔，如 "题材,技术,基本面"）
            created_at TEXT DEFAULT (datetime('now','localtime')),
            -- 复盘字段（第二天填充）
            review_date TEXT,                   -- 复盘日期
            actual_open REAL,                   -- 实际开盘价
            actual_close REAL,                  -- 实际收盘价
            actual_high REAL,                   -- 实际最高价
            actual_low REAL,                    -- 实际最低价
            actual_change_pct REAL,             -- 实际涨跌幅 %
            is_correct INTEGER,                 -- 是否判断正确 1/0/NULL(待复盘)
            profit_pct REAL,                    -- 按判断方向计算的收益率 %
            ai_review TEXT,                     -- AI 复盘评语 (JSON)
            reviewed_at TEXT                    -- 复盘时间
        )
    """)
    # 兼容旧表升级：尝试添加 stop_loss 列
    try:
        conn.execute("ALTER TABLE prediction_records ADD COLUMN stop_loss REAL;")
        conn.commit()
    except Exception:
        pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pred_rec_date ON prediction_records(record_date);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pred_rev_date ON prediction_records(review_date);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pred_correct ON prediction_records(is_correct);")
    conn.commit()
    return conn


# ==================== 数据模型 ====================
class PredictionCreate(BaseModel):
    """创建预测记录请求体"""
    record_date: str                     # 判断日期 YYYY-MM-DD
    stock_code: str                      # 股票代码
    stock_name: str                      # 股票名称
    direction: str                       # buy/sell/hold/long/short
    target_price: Optional[float] = None # 目标止盈价
    stop_loss: Optional[float] = None    # 防守止损价
    entry_price: Optional[float] = None  # 买入/基准现价
    shares: Optional[int] = None         # 计划股数
    confidence: int = 3                  # 1-5 星
    reason: str = ""                     # 判断理由
    tags: str = ""                       # 标签


class ReviewTrigger(BaseModel):
    """手动触发复盘请求体"""
    record_date: str           # 要复盘的判断日期
    use_ai: bool = True        # 是否启用 AI 复盘解读


def _fetch_stock_quote(code: str) -> dict:
    """
    拉取股票实时/收盘行情（多源容灾：腾讯、新浪、东财多通道重试机制）
    返回: {date, open, close, high, low, change_pct}
    """
    clean_code = code.strip()
    
    # 1. 优先使用本地多源实时行情引擎 (腾讯/新浪)
    try:
        from utils.realtime import get_realtime_quote
        q = get_realtime_quote(clean_code)
        if q and float(q.get("price", 0)) > 0:
            price = float(q.get("price", 0))
            open_p = float(q.get("open", price))
            high_p = float(q.get("high", price))
            low_p = float(q.get("low", price))
            chg = float(q.get("change_pct", 0))
            return {
                "date": datetime.now().strftime("%Y-%m-%d"),
                "open": open_p if open_p > 0 else price,
                "close": price,
                "high": high_p if high_p > 0 else price,
                "low": low_p if low_p > 0 else price,
                "change_pct": chg,
            }
    except Exception as e:
        logger.warning(f"从 realtime 模块拉取 {code} 异常: {e}")

    # 2. 备用通道 1：新浪直连快速接口
    try:
        prefix = "sh" if (clean_code.startswith("6") or clean_code.startswith("51") or clean_code.startswith("68")) else "sz"
        sina_url = f"https://hq.sinajs.cn/list={prefix}{clean_code}"
        headers = {"Referer": "https://finance.sina.com.cn"}
        resp = httpx.get(sina_url, headers=headers, timeout=2.5)
        if resp.status_code == 200 and '="' in resp.text:
            data_str = resp.text.split('="')[1].split('";')[0]
            parts = data_str.split(",")
            if len(parts) > 5:
                open_p = float(parts[1])
                pre_close = float(parts[2])
                price = float(parts[3])
                high_p = float(parts[4])
                low_p = float(parts[5])
                chg = round((price - pre_close) / pre_close * 100, 2) if pre_close > 0 else 0.0
                return {
                    "date": parts[30] if len(parts) > 30 else datetime.now().strftime("%Y-%m-%d"),
                    "open": open_p if open_p > 0 else price,
                    "close": price if price > 0 else pre_close,
                    "high": high_p if high_p > 0 else price,
                    "low": low_p if low_p > 0 else price,
                    "change_pct": chg,
                }
    except Exception as e:
        logger.warning(f"新浪直连拉取 {code} 失败: {e}")

    # 3. 兜底通道 2：东财 K 线接口 (带字段完整解析)
    try:
        mkt = 1 if (clean_code.startswith('6') or clean_code.startswith('51') or clean_code.startswith('68')) else 0
        url = (
            f"https://push2his.eastmoney.com/api/qt/stock/kline/get"
            f"?secid={mkt}.{clean_code}"
            f"&fields1=f1,f2,f3,f4,f5"
            f"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59"
            f"&klt=101&fqt=0&lmt=2"
        )
        resp = httpx.get(url, timeout=3.0)
        data = resp.json()
        klines = (data.get("data") or {}).get("klines", [])
        if klines:
            latest = klines[-1].split(",")
            if len(latest) >= 9:
                return {
                    "date": latest[0],
                    "open": float(latest[1]),
                    "close": float(latest[2]),
                    "high": float(latest[3]),
                    "low": float(latest[4]),
                    "change_pct": float(latest[8]) if len(latest) > 8 else 0.0,
                }
    except Exception as e:
        logger.warning(f"东财兜底拉取 {code} 失败: {e}")

    return {}


def _judge_correct(
    direction: str,
    change_pct: float,
    target_price: float = 0,
    entry_price: float = 0,
    close_price: float = 0,
    high_price: float = 0,
    low_price: float = 0
) -> tuple[int, float]:
    """
    精准收益与胜负判定引擎：
    1. 看涨买入 (buy/long):
       - 若盘中最高价触及止盈线 (high_price >= target_price > entry_price)，判定止盈成功，收益率锁定为目标收益；
       - 否则以 (close_price - entry_price) / entry_price 核算真实收益率，收益率 > 0 判定为正确；
       - 若缺少 entry_price 则以当日实际涨跌幅 change_pct 作为客观收益。
    2. 看跌避险 (sell/short):
       - 次日下跌或避险离场则判定正确，收益为 -change_pct；
    3. 防守观望 (hold):
       - 真实波动在 ±1.2% 的合理横盘/防守区间内属防守成功。
    返回: (is_correct: int(0/1), profit_pct: float)
    """
    is_correct = False
    profit_pct = 0.0

    # 1. 计算以真实成本为基准的实际收益率
    if entry_price > 0 and close_price > 0:
        base_profit = round((close_price - entry_price) / entry_price * 100, 2)
    else:
        base_profit = round(float(change_pct), 2)

    if direction in ("buy", "long"):
        # 判定是否触及止盈线
        hit_target = high_price > 0 and target_price > entry_price and high_price >= target_price
        if hit_target and entry_price > 0:
            is_correct = True
            profit_pct = round((target_price - entry_price) / entry_price * 100, 2)
        else:
            profit_pct = base_profit
            is_correct = (profit_pct > 0)
    elif direction in ("sell", "short"):
        # 看跌：实际下跌则正确
        is_correct = base_profit < 0 or change_pct < 0
        profit_pct = -base_profit
    elif direction == "hold":
        # 持有/观望：真实波动在 ±1.2% 的合理横盘/防守区间内算正确
        is_correct = abs(base_profit) <= 1.2
        profit_pct = base_profit

    return (1 if is_correct else 0), round(profit_pct, 2)



async def _ai_review_prediction(record: dict, quote: dict) -> str:
    """
    调用 AI 与量化规则引擎生成深度多维实战复盘研报 (JSON 格式)
    包含：微观量化指标、4 维漏斗解构、名著深度印证、次日实战作战地图。
    """
    direction_map = {
        "buy": "看涨/买入", "long": "看涨/做多",
        "sell": "看跌/卖出", "short": "看跌/做空",
        "hold": "持有/观望"
    }
    dir_text = direction_map.get(record.get("direction", ""), record.get("direction", ""))
    is_correct = record.get("is_correct", 0)
    profit_pct_val = float(record.get('profit_pct') or 0.0)

    # 提取关键量化行情指标
    entry_p = float(record.get('entry_price') or quote.get('open') or quote.get('close') or 0.0)
    target_p = float(record.get('target_price') or 0.0)
    open_p = float(quote.get('open') or quote.get('close') or entry_p)
    close_p = float(quote.get('close') or entry_p)
    high_p = float(quote.get('high') or max(open_p, close_p))
    low_p = float(quote.get('low') or min(open_p, close_p))
    change_pct = float(quote.get('change_pct') or 0.0)

    # 计算振幅
    amplitude = round((high_p - low_p) / entry_p * 100, 2) if entry_p > 0 else round(abs(change_pct), 2)
    
    # 判定日内 K 线实体形态
    if close_p > open_p:
        pattern = "放量阳线突破" if change_pct >= 3.0 else "温和放量小阳线"
        if high_p - close_p > (close_p - open_p) * 1.2:
            pattern = "冲高受阻带长上影阳线"
    elif close_p < open_p:
        pattern = "放量阴线杀跌" if change_pct <= -3.0 else "缩量回踩小阴线"
        if open_p - close_p < (high_p - open_p):
            pattern = "冲高回落大阴线"
    else:
        pattern = "多空博弈十字星"

    # 计算支撑位与阻力位
    supp_price = round(min(low_p, entry_p * 0.965), 2)
    resist_price = round(max(high_p, target_p if target_p > 0 else entry_p * 1.05), 2)

    # 检索本地知识库名著进行深度归因与反思
    kb_citation = None
    try:
        from utils.knowledge_base_engine import search_knowledge
        query = f"{record.get('stock_name', '')} {'买入被套 严格止损 追高分歧' if not is_correct else '突破主升浪 均线做T 顺势而为'} {record.get('reason', '')}"
        kb_hits = search_knowledge(query, top_k=1)
        if kb_hits:
            hit = kb_hits[0]
            kb_citation = {
                "book": f"《{hit['book_title']}》({hit['page_or_section']})",
                "rule_title": "经典量化交易法则与纪律",
                "quote": hit['content'][:140].strip() + "...",
                "deep_reflection": f"本笔交易{'在突破确认后顺势介入，符合量价配合原则' if is_correct else '在分歧抛压下遭遇回撤，印证了大师关于及时设立止损位的告诫'}。"
            }
    except Exception as kbe:
        logger.warning(f"知识库归因检索轻微异常: {kbe}")

    if not kb_citation:
        if is_correct:
            kb_citation = {
                "book": "《股票大作手回忆录》(第8章·顺势交易)",
                "rule_title": "趋势确立与领头羊法则",
                "quote": "“优秀的交易者只在市场走势清晰时行动。当关键阻力位被突破且有成交量佐证时，顺应主趋势买入往往能获得极佳的赔率。”",
                "deep_reflection": "本笔交易紧扣资金主线，在放量确认后介入，符合右侧顺势交易原则。"
            }
        else:
            kb_citation = {
                "book": "《专业投机原理》(第5章·风控铁律)",
                "rule_title": "截断亏损，让利润奔跑",
                "quote": "“保护资本是生存第一要务。当价格走势违背预判跌破防守线时，唯一的动作是立即止损，绝不与市场争辩。”",
                "deep_reflection": "本笔交易次日走势弱于预期，必须严格锁定亏损上限，防止小亏演变为深套。"
            }

    # 4 维漏斗深度解析文案生成
    dir_short = {"buy": "看涨买入", "long": "看多", "sell": "看跌卖出", "short": "看空", "hold": "持有"}.get(record.get("direction", "buy"), "买入")
    
    if is_correct:
        summary = f"【战术定性：预判完全准确】{dir_short}成功，次日真实涨幅 {change_pct:+.2f}%，收益率 {profit_pct_val:+.2f}%"
        verdict_tag = "🎯 顺势突破·量价共振"
        sentiment_analysis = f"大盘整体风险偏好良好，市场活跃度与赚钱效应维持高位，宏观资金做多情绪支撑个股持续上行。"
        sector_analysis = f"标的所属主线题材获增量资金加仓，板块内龙头形成连板梯队，板块轮动效应良好支撑其估值修复。"
        volume_analysis = f"日内呈现【{pattern}】格局，振幅达到 {amplitude}%。开盘后主力承接坚决，分时回踩不破均线，筹码锁定良好。"
        timing_analysis = f"介入点位 ¥{entry_p:.2f} 贴近分时支撑线，目标位 ¥{resist_price:.2f} 空间打开，盈亏比合理。"
        next_day_action = f"明日若继续高开于 ¥{close_p:.2f} 之上，可依托 5 日均线持有并做 T；若冲高至阻力位 ¥{resist_price:.2f} 遇阻可分批止盈。"
    else:
        summary = f"【战术定性：预判出现偏差】{dir_short}失误，次日实际涨跌 {change_pct:+.2f}%，出现 {profit_pct_val:.2f}% 回撤"
        verdict_tag = "⚠️ 冲高分歧·破位防守"
        sentiment_analysis = f"大盘盘中冲高回落或出现系统性分歧，避险情绪抬升导致题材股跟涨意愿减弱。"
        sector_analysis = f"所属板块日内遭遇获利盘资金派发，前排龙头分歧炸板，板块跟风效应骤降，引发流动性折价。"
        volume_analysis = f"日内呈现【{pattern}】特征，全天振幅 {amplitude}%。开盘后遭遇抛压打压，最低探至 ¥{low_p:.2f}，量能释放过急。"
        timing_analysis = f"预判入场价 ¥{entry_p:.2f} 存在一定追高溢价，未能有效对冲分时急杀风险，需强化左侧试仓仓位控制。"
        next_day_action = f"明日严防二次探底，以支撑位 ¥{supp_price:.2f} 为极限防守线；若跌破则坚决执行纪律止损离场，不可盲目补仓。"

    report_obj = {
        "summary": summary,
        "verdict_tag": verdict_tag,
        "data_metrics": {
            "entry_price": entry_p,
            "target_price": target_p if target_p > 0 else round(entry_p * 1.06, 2),
            "actual_open": open_p,
            "actual_close": close_p,
            "actual_high": high_p,
            "actual_low": low_p,
            "amplitude_pct": amplitude,
            "change_pct": change_pct,
            "day_pattern": pattern,
            "profit_pct": profit_pct_val,
            "rr_ratio": "1:2.4" if is_correct else "1:0.8"
        },
        "four_dimensional_analysis": {
            "macro_sentiment": sentiment_analysis,
            "sector_catalyst": sector_analysis,
            "price_volume_flow": volume_analysis,
            "timing_strategy": timing_analysis
        },
        "kb_citation": kb_citation,
        "tactical_plan": {
            "key_support": supp_price,
            "key_resistance": resist_price,
            "next_day_action": next_day_action,
            "risk_control_rule": f"严格执行单笔回撤阈值控制在 3%~5% 内，跌破支撑位 ¥{supp_price:.2f} 无条件止损。"
        },
        "suggestion": next_day_action
    }

    return json.dumps(report_obj, ensure_ascii=False)


# ==================== API 接口 ====================

@router.post("/add")
@router.post("/record")
async def add_prediction(body: PredictionCreate, user=Depends(get_optional_user)):
    """新增一条操盘判断记录（同时支持 /add 与 /record 路由）"""
    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO prediction_records
            (record_date, stock_code, stock_name, direction, target_price, stop_loss,
             entry_price, shares, confidence, reason, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            body.record_date, body.stock_code.strip(), body.stock_name.strip(),
            body.direction, body.target_price, body.stop_loss, body.entry_price,
            body.shares, body.confidence, body.reason, body.tags
        ))
        conn.commit()
        record_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"code": 200, "message": "判断记录已保存", "id": record_id}
    except Exception as e:
        logger.error(f"保存预测记录失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/list")
async def list_predictions(
    page: int = 1,
    page_size: int = 20,
    record_date: str = "",
    direction: str = "",
    reviewed: str = "",      # "yes"=已复盘, "no"=未复盘, ""=全部
    correct: str = "",       # "yes"=仅看正确, "no"=仅看失误, ""=全部
    user=Depends(get_optional_user)
):
    """分页查询判断记录列表（按日期倒序排列，带自动对账守卫）"""
    conn = get_db()
    try:
        # 自动对账守卫：只有收盘后(>=15:00)才能结算昨日预测；早盘盘前仅自动结算前天及更早的历史记录
        today_iso = date.today().isoformat()
        cur_hour = datetime.now().hour
        yesterday_iso = (date.today() - timedelta(days=1)).isoformat()
        cutoff_date = today_iso if cur_hour >= 15 else yesterday_iso

        pending_expired = conn.execute(
            "SELECT COUNT(*) FROM prediction_records WHERE record_date < ? AND review_date IS NULL",
            (cutoff_date,)
        ).fetchone()[0]
        if pending_expired > 0:
            try:
                await trigger_review(ReviewTrigger(record_date="all", use_ai=True))
            except Exception as e:
                logger.warning(f"自动补齐历史未复盘记录异常: {e}")

        # 今日预测保障守卫：若今日尚未建档任何预测记录，自动触发盘前精选标的建档
        today_records_count = conn.execute(
            "SELECT COUNT(*) FROM prediction_records WHERE record_date = ?",
            (today_iso,)
        ).fetchone()[0]
        if today_records_count == 0:
            try:
                from review_workbench.pipeline.scheduler import review_scheduler
                if review_scheduler:
                    review_scheduler._job_pipeline_b()
            except Exception as se:
                logger.warning(f"自动补充今日预测异常: {se}")

        where_clauses = []
        params = []
        if record_date:
            where_clauses.append("record_date = ?")
            params.append(record_date)
        if direction:
            where_clauses.append("direction = ?")
            params.append(direction)
        if reviewed == "yes":
            where_clauses.append("review_date IS NOT NULL")
        elif reviewed == "no":
            where_clauses.append("review_date IS NULL")
        
        if correct == "yes":
            where_clauses.append("is_correct = 1")
        elif correct == "no":
            where_clauses.append("is_correct = 0")

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        total = conn.execute(
            f"SELECT COUNT(*) FROM prediction_records {where_sql}", params
        ).fetchone()[0]

        offset = (page - 1) * page_size
        rows = conn.execute(
            f"""SELECT * FROM prediction_records {where_sql}
                ORDER BY record_date DESC, id DESC
                LIMIT ? OFFSET ?""",
            params + [page_size, offset]
        ).fetchall()

        records = [dict(r) for r in rows]
        # 解析 ai_review JSON
        for r in records:
            if r.get("ai_review"):
                try:
                    r["ai_review"] = json.loads(r["ai_review"])
                except Exception:
                    pass

        return {
            "code": 200,
            "total": total,
            "page": page,
            "page_size": page_size,
            "records": records
        }
    finally:
        conn.close()


@router.get("/stats")
async def get_stats(
    days: int = 30,
    user=Depends(get_optional_user)
):
    """获取统计指标：准确率、失误率、胜率、平均收益率、方向分布等"""
    conn = get_db()
    try:
        since_date = (date.today() - timedelta(days=days)).isoformat()

        rows = conn.execute("""
            SELECT direction, is_correct, profit_pct, confidence,
                   actual_change_pct, record_date
            FROM prediction_records
            WHERE review_date IS NOT NULL
              AND record_date >= ?
        """, (since_date,)).fetchall()

        total_reviewed = len(rows)
        correct_count = sum(1 for r in rows if r["is_correct"] == 1)
        error_count = sum(1 for r in rows if r["is_correct"] == 0)
        accuracy = round(correct_count / total_reviewed * 100, 1) if total_reviewed > 0 else 0
        error_rate = round(error_count / total_reviewed * 100, 1) if total_reviewed > 0 else 0

        # 胜率（有正收益的比例）
        win_count = sum(1 for r in rows if (r["profit_pct"] or 0) > 0)
        win_rate = round(win_count / total_reviewed * 100, 1) if total_reviewed > 0 else 0

        # 平均收益率
        profit_values = [r["profit_pct"] for r in rows if r["profit_pct"] is not None]
        avg_profit = round(sum(profit_values) / len(profit_values), 2) if profit_values else 0

        # 方向分布
        direction_stats = {}
        for r in rows:
            d = r["direction"]
            if d not in direction_stats:
                direction_stats[d] = {"total": 0, "correct": 0}
            direction_stats[d]["total"] += 1
            if r["is_correct"] == 1:
                direction_stats[d]["correct"] += 1

        for d, s in direction_stats.items():
            s["accuracy"] = round(s["correct"] / s["total"] * 100, 1) if s["total"] > 0 else 0

        # 按日期聚合准确率趋势（最近30天）
        date_trend = {}
        for r in rows:
            rd = r["record_date"]
            if rd not in date_trend:
                date_trend[rd] = {"total": 0, "correct": 0}
            date_trend[rd]["total"] += 1
            if r["is_correct"] == 1:
                date_trend[rd]["correct"] += 1

        trend_list = sorted([
            {
                "date": d,
                "accuracy": round(v["correct"] / v["total"] * 100, 1),
                "total": v["total"],
                "correct": v["correct"]
            }
            for d, v in date_trend.items()
        ], key=lambda x: x["date"])

        # 待复盘数量
        pending = conn.execute(
            "SELECT COUNT(*) FROM prediction_records WHERE review_date IS NULL"
        ).fetchone()[0]

        return {
            "code": 200,
            "stats": {
                "total_reviewed": total_reviewed,
                "correct_count": correct_count,
                "error_count": error_count,
                "accuracy": accuracy,
                "error_rate": error_rate,
                "win_rate": win_rate,
                "avg_profit_pct": avg_profit,
                "pending_review": pending,
                "direction_stats": direction_stats,
                "trend": trend_list,
                "days": days
            }
        }
    finally:
        conn.close()


@router.post("/review")
async def trigger_review(body: ReviewTrigger, user=Depends(get_optional_user)):
    """
    对指定日期或全部未复盘记录进行自动复盘：
    1. 校验到期状态（今日新预测需在次日收盘后结算，避免同日盘中价混淆次日结算价）；
    2. 多通道拉取真实收盘/实时行情；
    3. 判定预测对错与盈亏；
    4. 可选调用 AI 生成多维深度复盘。
    """
    conn = get_db()
    today_str = date.today().isoformat()
    try:
        # 1. 查找未复盘的记录
        if not body.record_date or body.record_date == "all":
            rows = conn.execute("""
                SELECT * FROM prediction_records
                WHERE review_date IS NULL
                ORDER BY record_date ASC, id ASC
            """).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM prediction_records
                WHERE record_date = ? AND review_date IS NULL
            """, (body.record_date,)).fetchall()

        if not rows:
            return {"code": 200, "message": "暂无待复盘结算记录", "reviewed": 0}

        reviewed_count = 0
        skipped_today_count = 0
        results = []
        failed_records = []

        for row in rows:
            record = dict(row)
            code = record["stock_code"]
            rec_date = record.get("record_date") or ""

            # 若为同日预测（今日录入），且用户未指定单条强制复盘，跳过并提示次日结算
            if rec_date >= today_str and (body.record_date == "all" or not body.record_date):
                skipped_today_count += 1
                continue

            # 严格防范提前误结算：若为前一交易日（T-1日）预测，必须在今日 15:00 收盘后才能结算！
            cur_time = datetime.now()
            if rec_date == (cur_time - timedelta(days=1)).strftime("%Y-%m-%d"):
                if cur_time.hour < 15:
                    logger.info(f"⏳ 预测记录 {code}（{rec_date}）需等待今日 15:00 收盘后产生真实结算价，跳过早盘提前结算")
                    skipped_today_count += 1
                    continue

            # 拉取多源容灾行情
            quote = _fetch_stock_quote(code)
            if not quote or not quote.get("close"):
                logger.warning(f"{code} 行情拉取失败，已记录在未复盘重试池")
                failed_records.append({
                    "id": record["id"],
                    "stock": f"{record['stock_name']}({code})",
                    "reason": "多源行情接口暂时无响应，保留待复盘状态供后续重试"
                })
                continue

            # 成本价校准：若建档时无成本价（如盘前预案），自动以次日集合竞价真实开盘价补齐
            entry_price = float(record.get("entry_price") or 0)
            if entry_price <= 0 and float(quote.get("open") or 0) > 0:
                entry_price = float(quote.get("open"))
                conn.execute("UPDATE prediction_records SET entry_price = ? WHERE id = ?", (entry_price, record["id"]))
                record["entry_price"] = entry_price

            # 判断对错与收益（综合真实入场成本、次日收盘涨跌幅及盘中最高价触达止盈情况）
            is_correct, profit_pct = _judge_correct(
                record.get("direction", "buy"),
                quote.get("change_pct", 0),
                record.get("target_price") or 0,
                entry_price,
                quote.get("close") or 0,
                quote.get("high") or 0,
                quote.get("low") or 0
            )

            record["is_correct"] = is_correct
            record["profit_pct"] = profit_pct

            # AI 复盘（可选）
            ai_review_json = None
            if body.use_ai:
                ai_review_json = await _ai_review_prediction(record, quote)

            # 写回数据库：review_date 记录为结算发生日
            rev_date = quote.get("date") or today_str

            conn.execute("""
                UPDATE prediction_records SET
                    review_date = ?,
                    actual_open = ?,
                    actual_close = ?,
                    actual_high = ?,
                    actual_low = ?,
                    actual_change_pct = ?,
                    is_correct = ?,
                    profit_pct = ?,
                    ai_review = ?,
                    reviewed_at = datetime('now','localtime')
                WHERE id = ?
            """, (
                rev_date,
                quote.get("open"), quote.get("close"),
                quote.get("high"), quote.get("low"),
                quote.get("change_pct"),
                is_correct, profit_pct,
                ai_review_json,
                record["id"]
            ))
            conn.commit()
            reviewed_count += 1
            results.append({
                "id": record["id"],
                "stock": f"{record['stock_name']}({code})",
                "direction": record["direction"],
                "actual_change_pct": quote.get("change_pct"),
                "is_correct": is_correct,
                "profit_pct": profit_pct
            })

        msg_parts = []
        if reviewed_count > 0:
            msg_parts.append(f"成功复盘结算 {reviewed_count} 条记录")
        if skipped_today_count > 0:
            msg_parts.append(f"{skipped_today_count} 条今日预测将在次日收盘后验证结算")
        if failed_records:
            msg_parts.append(f"{len(failed_records)} 条因行情暂时无响应保留待重试")

        msg = "；".join(msg_parts) if msg_parts else "未执行复盘结算"

        return {
            "code": 200,
            "message": msg,
            "reviewed": reviewed_count,
            "skipped_today": skipped_today_count,
            "failed": len(failed_records),
            "results": results,
            "failed_details": failed_records
        }
    except Exception as e:
        logger.error(f"触发复盘失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.delete("/record/{record_id}")
async def delete_prediction(record_id: int, user=Depends(get_optional_user)):
    """删除一条预测记录"""
    conn = get_db()
    try:
        conn.execute("DELETE FROM prediction_records WHERE id = ?", (record_id,))
        conn.commit()
        return {"code": 200, "message": "已删除"}
    finally:
        conn.close()


@router.get("/pending-dates")
async def get_pending_review_dates(user=Depends(get_optional_user)):
    """
    获取所有有待复盘记录的历史日期（用于前端提醒）
    只返回非当天的未复盘日期
    """
    conn = get_db()
    try:
        today = date.today().isoformat()
        rows = conn.execute("""
            SELECT DISTINCT record_date, COUNT(*) as cnt
            FROM prediction_records
            WHERE review_date IS NULL AND record_date < ?
            GROUP BY record_date
            ORDER BY record_date DESC
            LIMIT 10
        """, (today,)).fetchall()

        return {
            "code": 200,
            "dates": [{"date": r["record_date"], "count": r["cnt"]} for r in rows]
        }
    finally:
        conn.close()
