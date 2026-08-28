#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alpha 实战持仓与多源直连路由 (Portfolio & Watchlist Router)
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from utils.auth import get_current_user
from utils.portfolio_advisor import portfolio_store
from utils.realtime import get_realtime_quote
from utils.database import log_audit

router = APIRouter(tags=["实盘持仓与自选监控"])


class PositionItem(BaseModel):
    symbol: str
    name: Optional[str] = ""
    shares: int
    cost_price: float
    current_price: Optional[float] = None
    target_stop_loss: Optional[float] = None
    target_take_profit: Optional[float] = None


class WatchlistItem(BaseModel):
    symbol: str
    name: Optional[str] = ""
    target_price: Optional[float] = None
    notes: Optional[str] = ""


class FreeTextInput(BaseModel):
    text: str
    target_type: Optional[str] = "position"  # position or watchlist


from utils.portfolio_advisor import portfolio_advisor, portfolio_store


from utils.realtime import get_realtime_quote

@router.get("/api/portfolio/list")
def get_portfolio_list(user: str = Depends(get_current_user)):
    """获取用户全部实盘持仓、量化深度诊断及实时财务统计"""
    try:
        portfolio_store.load()
        diagnose_list = portfolio_advisor.diagnose_all_positions()
        summary_info = portfolio_advisor.get_portfolio_summary()

        positions_data = [d.__dict__ for d in diagnose_list]
        
        # 实时拉取自选池每只标的的最新现价与今日涨跌幅 (支持腾讯/新浪高并发实时行情)
        watchlist_data = []
        for sym, w in portfolio_store.watchlist.items():
            q = get_realtime_quote(sym)
            current_price = float(q.get("price", 0.0)) if q else (w.current_price or 0.0)
            change_pct = float(q.get("change_pct", 0.0)) if q else (w.change_pct or 0.0)
            name = (q.get("name") if q and q.get("name") else w.name) or sym
            
            watchlist_data.append({
                "symbol": sym,
                "name": name,
                "current_price": current_price,
                "change_pct": change_pct,
                "add_date": getattr(w, "add_date", ""),
                "notes": getattr(w, "notes", "东方财富自选同步") or "东方财富自选同步"
            })

        history_trades = getattr(portfolio_store, "history_trades", [])

        return {
            "code": 200,
            "status": "success",
            "positions": positions_data,
            "summary": summary_info,
            "watchlist": watchlist_data,
            "history_trades": history_trades,
            "data": {
                "positions": positions_data,
                "summary": summary_info,
                "watchlist": watchlist_data,
                "history_trades": history_trades
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"code": 500, "message": str(e), "positions": [], "summary": {}, "watchlist": [], "history_trades": []}





@router.post("/api/portfolio/position/save")
def save_position(item: PositionItem, user: str = Depends(get_current_user)):
    """新增或修改单只持仓"""
    try:
        portfolio_store.add_or_update_position(
            symbol=item.symbol,
            name=item.name,
            shares=item.shares,
            cost_price=item.cost_price,
            target_stop_loss=item.target_stop_loss,
            target_take_profit=item.target_take_profit
        )
        log_audit(user, "save_position", f"更新持仓: {item.name}({item.symbol}) {item.shares}股")
        return {"code": 200, "message": "持仓已成功保存"}
    except Exception as e:
        return {"code": 500, "message": str(e)}


@router.delete("/api/portfolio/position/{symbol}")
def delete_position(symbol: str, user: str = Depends(get_current_user)):
    """删除持仓"""
    try:
        portfolio_store.remove_position(symbol)
        log_audit(user, "delete_position", f"移除持仓: {symbol}")
        return {"code": 200, "message": "持仓已成功移除"}
    except Exception as e:
        return {"code": 500, "message": str(e)}


@router.get("/api/portfolio/watchlist")
def get_watchlist(user: str = Depends(get_current_user)):
    """获取自选监控池"""
    try:
        portfolio_store.load()
        items = []
        for sym, w in portfolio_store.watchlist.items():
            q = get_realtime_quote(sym)
            items.append({
                "symbol": sym,
                "name": w.name,
                "current_price": float(q.get("price", 0)) if q else 0.0,
                "change_pct": float(q.get("change_pct", 0)) if q else 0.0,
                "notes": w.notes
            })
        return {"code": 200, "data": items}
    except Exception as e:
        return {"code": 500, "message": str(e)}


@router.post("/api/portfolio/parse-free-text")
def parse_free_text(payload: FreeTextInput, user: str = Depends(get_current_user)):
    """自由自然语言文本持仓极速识别与入库"""
    from utils.text_holding_parser import parse_holding_text
    try:
        results = parse_holding_text(payload.text, payload.target_type)
        return {"code": 200, "message": f"成功识别并导入 {len(results)} 条标的", "data": results}
    except Exception as e:
        return {"code": 500, "message": f"解析异常: {str(e)}"}
