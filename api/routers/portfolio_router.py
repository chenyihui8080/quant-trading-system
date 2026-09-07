#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alpha 实战持仓与多源直连路由 (Portfolio & Watchlist Router)
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import re

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

from utils.auth import get_current_user, get_optional_user

@router.get("/api/portfolio/list")
def get_portfolio_list(user: Optional[dict] = Depends(get_optional_user)):
    """获取用户全部实盘持仓、量化深度诊断及实时财务统计 (单次并发批量极速版)"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else "admin"
        portfolio_store.load(username)

        # 1. 一次性打包收集持仓与自选的所有代码
        pos_symbols = list(portfolio_store.positions.keys())
        watch_symbols = list(portfolio_store.watchlist.keys())
        all_symbols = list(set(pos_symbols + watch_symbols))

        # 2. 单次 HTTP 批量获取全部行情快照
        from utils.realtime import get_batch_realtime_quotes
        quotes_dict = get_batch_realtime_quotes(all_symbols) if all_symbols else {}

        # 3. 内存极速诊断与统计计算
        diagnose_list = portfolio_advisor.diagnose_all_positions(preloaded_quotes=quotes_dict)
        summary_info = portfolio_advisor.get_portfolio_summary(preloaded_quotes=quotes_dict)
        positions_data = [d.__dict__ for d in diagnose_list]

        # 4. 组装自选池数据
        watchlist_data = []
        for sym, w in portfolio_store.watchlist.items():
            q = quotes_dict.get(sym) or {}
            current_price = float(q.get("price", 0.0)) if q else (w.current_price or 0.0)
            change_pct = float(q.get("change_pct", 0.0)) if q else (w.change_pct or 0.0)
            name = (q.get("name") if q and q.get("name") else w.name) or sym
            
            watchlist_data.append({
                "symbol": sym,
                "name": name,
                "current_price": current_price,
                "change_pct": change_pct,
                "add_date": getattr(w, "add_date", ""),
                "notes": getattr(w, "notes", "自选监控") or "自选监控"
            })

        history_trades = getattr(portfolio_store, "history_trades", []) or []
        
        # 智能关联：若无独立流水但有实盘持仓，自动根据持仓生成建仓明细流水
        if not history_trades and portfolio_store.positions:
            auto_trades = []
            for sym, pos in portfolio_store.positions.items():
                if pos.shares > 0:
                    trade_time = pos.buy_date if getattr(pos, "buy_date", "") else "2026-08-31 14:35:20"
                    auto_trades.append({
                        "symbol": sym,
                        "name": pos.name,
                        "time": trade_time,
                        "type": "证券买入",
                        "action": "buy",
                        "price": pos.cost_price,
                        "shares": pos.shares,
                        "amount": round(pos.cost_price * pos.shares, 2),
                        "status": "已成交 (建仓买入)"
                    })
            if auto_trades:
                history_trades = auto_trades
                portfolio_store.history_trades = auto_trades
                portfolio_store.save()

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





class WatchlistAddRequest(BaseModel):
    symbol: str
    name: Optional[str] = ""
    notes: Optional[str] = ""


class SymbolOnlyRequest(BaseModel):
    symbol: str


@router.post("/api/portfolio/add-watchlist")
@router.post("/api/portfolio/watchlist")
def add_watchlist_item(req: WatchlistAddRequest, user: dict = Depends(get_current_user)):
    """添加自选标的 (多源自动识别并持久化)"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        portfolio_store.load(username)
        
        sym = req.symbol.strip().upper()
        # 实时自动补全标的名称
        name = req.name
        if not name:
            q = get_realtime_quote(sym)
            if q and q.get("name"):
                name = q.get("name")
            else:
                from utils.stock_search import search_symbol
                matches = search_symbol(sym, limit=1)
                if matches:
                    name = matches[0].get("name", sym)
                    sym = matches[0].get("code", sym)

        portfolio_store.add_to_watchlist(sym, name=name or sym, notes=req.notes or "自选监控")
        log_audit(username, "add_watchlist", f"添加自选: {name}({sym})")
        return {"code": 200, "message": f"标的 {name or sym} ({sym}) 已成功加入自选！"}
    except Exception as e:
        return {"code": 500, "detail": f"添加自选失败: {str(e)}"}


@router.post("/api/portfolio/remove-watchlist")
def remove_watchlist_post(req: SymbolOnlyRequest, user: dict = Depends(get_current_user)):
    """移除自选标的 (POST 方式)"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        portfolio_store.load(username)
        portfolio_store.remove_from_watchlist(req.symbol)
        log_audit(username, "remove_watchlist", f"移除自选: {req.symbol}")
        return {"code": 200, "message": f"标的 {req.symbol} 已移出自选"}
    except Exception as e:
        return {"code": 500, "detail": str(e)}


@router.delete("/api/portfolio/watchlist/{symbol}")
def remove_watchlist_delete(symbol: str, user: dict = Depends(get_current_user)):
    """移除自选标的 (DELETE 方式)"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        portfolio_store.load(username)
        portfolio_store.remove_from_watchlist(symbol)
        log_audit(username, "remove_watchlist", f"移除自选: {symbol}")
        return {"code": 200, "message": f"标的 {symbol} 已移出自选"}
    except Exception as e:
        return {"code": 500, "detail": str(e)}


@router.post("/api/portfolio/add-position")
@router.post("/api/portfolio/position/save")
def save_position(item: PositionItem, user: dict = Depends(get_current_user)):
    """新增或修改单只持仓"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        from utils.portfolio_advisor import PositionItem as PAItem
        
        name = item.name
        if not name:
            q = get_realtime_quote(item.symbol)
            name = q.get("name", item.symbol) if q else item.symbol

        pos_item = PAItem(
            symbol=item.symbol,
            name=name or item.symbol,
            shares=item.shares,
            cost_price=item.cost_price,
            current_price=item.current_price or 0.0,
        )
        portfolio_store.load(username)
        portfolio_store.add_or_update_position(pos_item)
        log_audit(username, "save_position", f"更新持仓: {name}({item.symbol}) {item.shares}股")
        return {"code": 200, "message": f"持仓 {name}({item.symbol}) 已成功保存"}
    except Exception as e:
        return {"code": 500, "detail": str(e)}


@router.post("/api/portfolio/remove-position")
def remove_position_post(req: SymbolOnlyRequest, user: dict = Depends(get_current_user)):
    """删除持仓 (POST 方式)"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        portfolio_store.load(username)
        portfolio_store.remove_position(req.symbol)
        log_audit(username, "delete_position", f"移除持仓: {req.symbol}")
        return {"code": 200, "message": f"持仓 {req.symbol} 已成功移除"}
    except Exception as e:
        return {"code": 500, "detail": str(e)}


@router.delete("/api/portfolio/position/{symbol}")
def delete_position(symbol: str, user: dict = Depends(get_current_user)):
    """删除持仓 (DELETE 方式)"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        portfolio_store.load(username)
        portfolio_store.remove_position(symbol)
        log_audit(username, "delete_position", f"移除持仓: {symbol}")
        return {"code": 200, "message": f"持仓 {symbol} 已成功移除"}
    except Exception as e:
        return {"code": 500, "detail": str(e)}


class CapitalSetRequest(BaseModel):
    total_capital: Optional[float] = 0.0
    available_cash: Optional[float] = None


@router.post("/api/portfolio/set-capital")
def set_portfolio_capital(req: CapitalSetRequest, user: dict = Depends(get_current_user)):
    """设置或微调账户真实总资产与可用现金"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        portfolio_store.load(username)
        portfolio_store.set_total_capital(req.total_capital or 0.0, req.available_cash)
        log_audit(username, "set_capital", f"更新总资金: ¥{req.total_capital}, 可用资金: ¥{req.available_cash}")
        return {"code": 200, "message": "账户资金配置已成功更新", "total_capital": portfolio_store.total_capital, "available_cash": portfolio_store.available_cash}
    except Exception as e:
        return {"code": 500, "detail": str(e)}


@router.get("/api/portfolio/watchlist")
def get_watchlist(user: dict = Depends(get_current_user)):
    """获取自选监控池"""
    try:
        username = user.get("username", "admin") if isinstance(user, dict) else str(user)
        portfolio_store.load(username)
        items = []
        for sym, w in portfolio_store.watchlist.items():
            q = get_realtime_quote(sym)
            items.append({
                "symbol": sym,
                "name": w.name or (q.get("name") if q else sym),
                "current_price": float(q.get("price", 0)) if q else 0.0,
                "change_pct": float(q.get("change_pct", 0)) if q else 0.0,
                "notes": w.notes or "自选监控"
            })
        return {"code": 200, "data": items}
    except Exception as e:
        return {"code": 500, "detail": str(e)}


@router.post("/api/portfolio/parse-free-text")
def parse_free_text(payload: FreeTextInput, user: dict = Depends(get_current_user)):
    """自由自然语言文本持仓极速识别与入库"""
    from utils.text_holding_parser import parse_holding_text
    try:
        results = parse_holding_text(payload.text, payload.target_type)
        return {"code": 200, "message": f"成功识别并导入 {len(results)} 条标的", "data": results}
    except Exception as e:
        return {"code": 500, "detail": f"解析异常: {str(e)}"}


@router.post("/api/portfolio/upload-image")
async def upload_portfolio_image(request: Request, user: dict = Depends(get_current_user)):
    """上传券商持仓/交割单截图并智能提取股票持仓 (原生Request无依赖模式)"""
    try:
        content = await request.body()
        raw_text = ""
        items = []

        # 尝试使用 OCR
        try:
            import io
            from PIL import Image
            img = Image.open(io.BytesIO(content))
            
            try:
                import pytesseract
                raw_text = pytesseract.image_to_string(img, lang='chi_sim+eng')
            except Exception:
                pass
                
            if not raw_text:
                try:
                    import easyocr
                    import numpy as np
                    reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
                    results = reader.readtext(np.array(img))
                    raw_text = "\n".join([r[1] for r in results])
                except Exception:
                    pass
        except Exception:
            pass

        if raw_text and raw_text.strip():
            from utils.text_holding_parser import parse_holding_text
            items = parse_holding_text(raw_text, target_type="position")

        return {
            "code": 200,
            "items": items,
            "raw_text": raw_text or "（图片已接收，建议直接使用【文本极速识别】粘贴文字）"
        }
    except Exception as e:
        return {
            "code": 500,
            "detail": f"图片识别处理异常: {str(e)}",
            "items": [],
            "raw_text": ""
        }


