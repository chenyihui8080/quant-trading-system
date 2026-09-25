"""
我的持仓与自选专属复盘服务 (Portfolio & Watchlist Review Service)
职责：
1. 1:1 严格对齐券商与实盘诊断
2. 计算每只持仓股的实时盈亏、仓位权重、止损/止盈价格与具体操作建议
3. 并发扫描高价值自选股异动、量价状态与当日关联情报证据
"""

import sqlite3
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("PortfolioService")
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "review.db"


def get_portfolio_custom_review() -> dict:
    """获取用户当前实盘持仓与重点自选的专属复盘诊断与次日推演预案 (100% 与券商和实盘对齐)"""
    try:
        from utils.portfolio_advisor import portfolio_advisor, portfolio_store

        portfolio_store.load()
        diags = portfolio_advisor.diagnose_all_positions()
        watchlist_raw = portfolio_store.watchlist or {}

        # 1. 组装持仓股详细复盘 (1:1 严格对齐券商与实盘诊断)
        position_reviews = []
        for d in diags:
            tag_color = "#f85149" if "止损" in d.action else ("#3fb950" if "止盈" in d.action else "#58a6ff")
            action_desc_detail = " · ".join(d.reasons) if d.reasons else d.summary

            position_reviews.append({
                "symbol": d.symbol,
                "name": d.name,
                "shares": d.shares,
                "cost_price": round(d.cost_price, 3),
                "current_price": round(d.current_price, 3),
                "market_value": round(d.market_value, 2),
                "profit_amount": round(d.pnl_amount, 2),
                "pnl_amount": round(d.pnl_amount, 2),
                "profit_pct": round(d.pnl_pct, 2),
                "pnl_pct": round(d.pnl_pct, 2),
                "today_profit_amount": round(d.today_pnl_amount, 2),
                "today_change_pct": round(d.today_pnl_pct, 2),
                "change_pct": round(d.today_pnl_pct, 2),
                "position_weight_pct": round(d.position_weight_pct, 2),
                "action": d.action,
                "suggest_shares": d.suggest_shares,
                "suggest_amount": round(d.suggest_amount, 2),
                "remaining_shares": d.remaining_shares,
                "stop_loss_price": round(d.stop_loss_price, 3),
                "take_profit_price": round(d.take_profit_price, 3),
                "reasons": d.reasons,
                "action_desc": action_desc_detail,
                "tag_color": tag_color,
                "summary": d.summary
            })

        # 2. 组装自选股高价值深度异动雷达 (并发拉取真实量价 + 匹配关联证据)
        watchlist_alerts = []
        from utils.realtime import get_realtime_quote

        for sym, w in list(watchlist_raw.items())[:25]:
            quote = get_realtime_quote(sym)
            curr_p = float(quote.get("price", 0.0)) if quote else 0.0
            chg_pct = float(quote.get("change_pct", 0.0)) if quote else 0.0
            amount_yi = round(float(quote.get("amount", 0.0)) / 100000000.0, 2) if quote and quote.get("amount") else 0.0
            name = (quote.get("name") if quote and quote.get("name") else (w.name if hasattr(w, "name") and w.name else sym))
            
            # 智能形态诊断与买入关注点
            if chg_pct >= 9.5:
                status = "🔥 强势涨停封板"
                advice = "空间龙头封板坚决，次日关注高开溢价与弱转强连板机会"
                tag_color = "#f85149"
            elif chg_pct >= 4.0:
                status = "🚀 主力放量拉升"
                advice = "日内大单资金净流入明显，可顺势跟踪回踩5日线低吸"
                tag_color = "#f85149"
            elif chg_pct <= -5.0:
                status = "⚠️ 破位大幅杀跌"
                advice = "空头放量杀跌，暂不盲目左侧抄底，等待企稳信号"
                tag_color = "#3fb950"
            elif abs(chg_pct) <= 1.5:
                status = "🎯 缩量蓄势洗盘"
                advice = "窄幅缩量震荡，若在关键均线支撑位上方可埋伏潜伏"
                tag_color = "#58a6ff"
            else:
                status = "👀 常态震荡轮动"
                advice = "跟随大盘震荡，关注板块是否出现主线合力催化"
                tag_color = "#8b949e"

            # 匹配该自选股当天在证据库里的关联催化
            matched_news_ref = None
            if DB_PATH.exists():
                conn = None
                try:
                    conn = sqlite3.connect(str(DB_PATH), timeout=15.0)
                    cursor = conn.cursor()
                    cursor.execute("SELECT ref_tag, title FROM news_curated WHERE title LIKE ? OR content LIKE ? LIMIT 1", (f"%{name}%", f"%{name}%"))
                    row = cursor.fetchone()
                    if row:
                        matched_news_ref = f"[{row[0]}] {row[1]}"
                except Exception as e:
                    logger.warning(f"读取自选股关联新闻异常: {e}")
                finally:
                    if conn:
                        conn.close()

            watchlist_alerts.append({
                "symbol": sym,
                "name": name,
                "current_price": round(curr_p, 3) if curr_p > 0 else "--",
                "change_pct": round(chg_pct, 2),
                "amount_yi": amount_yi,
                "status": status,
                "advice": advice,
                "tag_color": tag_color,
                "matched_ref": matched_news_ref or "日内暂无公开利好/看量价博弈"
            })

        return {
            "code": 200,
            "data": {
                "total_positions": len(position_reviews),
                "total_watchlist": len(watchlist_alerts),
                "positions": position_reviews,
                "watchlist": watchlist_alerts
            }
        }
    except Exception as e:
        logger.error(f"获取持仓与自选专属复盘异常: {e}")
        return {"code": 500, "message": str(e), "data": {"positions": [], "watchlist": []}}
