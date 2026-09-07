#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
旧版兼容路由 (Legacy Compat Router)

历史前端与旧测试仍调用不带 /api/market 前缀的路径（/risk、/orders、
/user-strategies、/nl、/broker、/stocks、/factors、/realtime、/minute-data、
/ws/status 等）。本路由将这些旧路径统一接入既有业务模块，保持响应契约不变。
"""

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field

from utils.auth import get_current_user, get_optional_user
from utils.database import log_audit

logger = logging.getLogger("LegacyRouter")
router = APIRouter(tags=["旧版兼容接口"])

# 每个用户独立的订单管理器：保证订单数据按用户名隔离，杜绝跨用户串单
_order_managers: Dict[str, Any] = {}
# 每个用户独立的纸面账户：现金 + 持仓（含买入日期，用于 T+1 校验）
_accounts: Dict[str, Any] = {}


def _get_order_manager(username: str):
    from utils.order_manager import OrderManager
    if username not in _order_managers:
        _order_managers[username] = OrderManager()
    return _order_managers[username]


class PaperAccount:
    """按用户纸面账户：资金 + 持仓账本，含 T+1 校验。

    持仓以 (数量, 成本, 买入日) 批次列表维护，卖出按 FIFO 从非当日买入批次扣减，
    当日买入批次不可卖出（A 股 T+1），杜绝可卖持仓与 T+1 校验缺失。
    """
    DEFAULT_CASH = 1_000_000.0

    def __init__(self, cash: float = DEFAULT_CASH):
        self.cash = float(cash)
        self.positions: Dict[str, Dict[str, Any]] = {}  # symbol -> {"lots":[...], "qty":int, "avg_cost":float}

    def to_dict(self) -> dict:
        return {
            "cash": round(self.cash, 2),
            "positions": {
                sym: {"qty": p["qty"], "avg_cost": round(p["avg_cost"], 3),
                      "lots_count": len(p["lots"]), "latest_buy_date": p["lots"][-1][2] if p["lots"] else ""}
                for sym, p in self.positions.items()
            },
            "position_count": len(self.positions),
        }

    def snapshot(self, today: str) -> dict:
        """账户快照：现金 + 持仓，附 T+1 可卖/冻结数量"""
        result = self.to_dict()
        for sym, pos in result["positions"].items():
            sellable = sum(lot[0] for lot in self.positions[sym]["lots"] if lot[2] != today)
            pos["sellable_qty"] = sellable
            pos["frozen_t1_qty"] = max(0, pos["qty"] - sellable)
        return result

    def _ensure(self, symbol: str):
        if symbol not in self.positions:
            self.positions[symbol] = {"lots": [], "qty": 0, "avg_cost": 0.0}

    def can_buy(self, symbol: str, price: float, qty: int) -> tuple[bool, str]:
        cost = price * qty
        if cost > self.cash:
            return False, f"可用资金不足：需 {cost:,.0f}，当前 {self.cash:,.0f}"
        return True, ""

    def can_sell(self, symbol: str, qty: int, today: str) -> tuple[bool, str]:
        pos = self.positions.get(symbol)
        if not pos or pos["qty"] < qty:
            return False, f"可卖持仓不足：{symbol} 仅持有 {pos['qty'] if pos else 0} 股"
        sellable = sum(lot[0] for lot in pos["lots"] if lot[2] != today)
        if sellable < qty:
            return False, f"T+1 限制：{symbol} 当日买入 {qty - sellable} 股不可当日卖出"
        return True, ""

    def apply_buy(self, symbol: str, price: float, qty: int, today: str):
        self._ensure(symbol)
        self.cash -= price * qty
        p = self.positions[symbol]
        p["lots"].append((qty, price, today))
        p["qty"] += qty
        p["avg_cost"] = sum(lot[0] * lot[1] for lot in p["lots"]) / p["qty"]

    def apply_sell(self, symbol: str, price: float, qty: int, today: str):
        p = self.positions[symbol]
        remain = qty
        kept = []
        for lot in p["lots"]:
            lot_qty, lot_cost, lot_date = lot
            if lot_date == today:
                # 当日买入批次不可卖出，保留
                kept.append(lot)
                continue
            if remain <= 0:
                kept.append(lot)
                continue
            take = min(lot_qty, remain)
            remain -= take
            if lot_qty - take > 0:
                kept.append((lot_qty - take, lot_cost, lot_date))
        p["lots"] = kept
        p["qty"] -= qty
        self.cash += price * qty
        if p["qty"] <= 0:
            del self.positions[symbol]
        else:
            p["avg_cost"] = sum(lot[0] * lot[1] for lot in p["lots"]) / p["qty"]


def _get_account(username: str) -> PaperAccount:
    if username not in _accounts:
        _accounts[username] = PaperAccount()
    return _accounts[username]


def _is_buy(direction: str, offset: str) -> bool:
    return direction == "long" or offset == "open"


def _username(user) -> str:
    return user.get("username", str(user)) if isinstance(user, dict) else str(user)


# ==================== 请求模型 ====================

class RiskConfigRequest(BaseModel):
    max_position_pct: Optional[float] = None
    stop_loss_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    max_daily_loss_pct: Optional[float] = None
    max_total_position_pct: Optional[float] = None
    max_single_concentration: Optional[float] = None


class RiskCheckRequest(BaseModel):
    symbol: str
    direction: str = "buy"
    price: float = 0.0
    volume: int = 0


class StockAddRequest(BaseModel):
    symbols: List[str] = []
    days: int = 120


class FavoriteRequest(BaseModel):
    symbol: str
    name: str = ""


class OrderCreateRequest(BaseModel):
    strategy_name: str = ""
    symbol: str
    direction: str = "long"
    offset: str = "open"
    price: float = 0.0
    volume: int = 0


class UserStrategyRequest(BaseModel):
    name: str
    symbol: str
    market: str = "a"
    buy_conditions: List[Dict[str, Any]] = Field(default_factory=list)
    sell_conditions: List[Dict[str, Any]] = Field(default_factory=list)
    enabled: bool = True


class NLParseRequest(BaseModel):
    text: str = ""
    symbol: str = ""
    market: str = "a"
    name: str = ""


class FactorComputeRequest(BaseModel):
    symbol: str
    factors: List[str] = Field(default_factory=list)


class FactorRankingRequest(BaseModel):
    symbols: List[str] = Field(default_factory=list)


# ==================== 风控配置存储（JSON 持久化，失败降级内存） ====================

_RISK_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "risk_config.json"
_RISK_DEFAULT = {
    "max_position_pct": 30.0,
    "stop_loss_pct": -5.0,
    "take_profit_pct": 15.0,
    "max_drawdown_pct": -20.0,
    "max_daily_loss_pct": -5.0,
    "max_total_position_pct": 80.0,
    "max_single_concentration": 30.0,
}


def _load_risk_config(username: str = "default") -> dict:
    """按用户加载风控配置（每个用户独立，杜绝任意用户篡改全局）"""
    cfg = dict(_RISK_DEFAULT)
    try:
        if _RISK_FILE.exists():
            import json
            with open(_RISK_FILE, encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    # 结构兼容：旧版顶层即配置，新版按 username 分用户
                    per_user = loaded.get("users", {})
                    user_cfg = per_user.get(username, {})
                    if user_cfg:
                        cfg.update(user_cfg)
                    elif "users" not in loaded:
                        cfg.update(loaded)
    except Exception as e:
        logger.warning(f"加载风控配置失败: {e}")
    return cfg


def _save_risk_config(cfg: dict, username: str = "default"):
    """按用户保存风控配置"""
    try:
        import json
        _RISK_FILE.parent.mkdir(parents=True, exist_ok=True)
        all_cfg = {}
        if _RISK_FILE.exists():
            try:
                with open(_RISK_FILE, encoding="utf-8") as f:
                    existing = json.load(f)
                    if isinstance(existing, dict):
                        all_cfg = existing
            except Exception:
                pass
        users = all_cfg.get("users", {})
        users[username] = cfg
        all_cfg["users"] = users
        with open(_RISK_FILE, "w", encoding="utf-8") as f:
            json.dump(all_cfg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"保存风控配置失败（使用内存值）: {e}")


# ==================== 风控配置 ====================

@router.get("/risk/config")
def get_risk_config(user: dict = Depends(get_current_user)):
    """获取当前用户的风控配置"""
    username = _username(user)
    cfg = _load_risk_config(username)
    return {"code": 200, "data": cfg, "config": cfg, "user": username}


@router.post("/risk/config")
def set_risk_config(req: RiskConfigRequest, user: dict = Depends(get_current_user)):
    """更新当前用户的风控配置"""
    username = _username(user)
    cfg = _load_risk_config(username)
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    cfg.update(updates)
    _save_risk_config(cfg, username)
    log_audit(username, "risk_config", f"更新风控配置: {updates}")
    return {"code": 200, "message": "风控配置已保存", "data": cfg, "user": username}


@router.post("/risk/check")
def risk_check(req: RiskCheckRequest, user: dict = Depends(get_current_user)):
    """执行单笔下单风控预检（使用当前用户配置）"""
    try:
        from utils.risk_manager import RiskManager, StrategyRiskConfig, AccountRiskConfig, PlatformRiskConfig
        cfg = _load_risk_config(_username(user))
        rm = RiskManager(
            strategy_config=StrategyRiskConfig(
                stop_loss_pct=cfg.get("stop_loss_pct", -5.0),
                take_profit_pct=cfg.get("take_profit_pct", 15.0),
                max_position_pct=cfg.get("max_position_pct", 30.0),
                max_daily_loss_pct=cfg.get("max_daily_loss_pct", -5.0),
            ),
            account_config=AccountRiskConfig(
                max_drawdown_pct=cfg.get("max_drawdown_pct", -20.0),
                max_single_concentration=cfg.get("max_single_concentration", 30.0),
                max_total_position_pct=cfg.get("max_total_position_pct", 80.0),
            ),
            platform_config=PlatformRiskConfig(),
        )
        from utils.realtime import get_realtime_quote
        quote = get_realtime_quote(req.symbol) or {}
        last_price = float(quote.get("price", 0.0)) or req.price
        result = rm.check_order(
            strategy_name="manual",
            symbol=req.symbol,
            symbol_name=quote.get("name", req.symbol),
            order_price=req.price,
            last_price=last_price,
            pre_close=float(quote.get("pre_close", 0.0)),
            qty=req.volume,
            pos=0,
            capital=1_000_000.0,
            side=req.direction,
        )
        return {
            "code": 200,
            "passed": result.passed,
            "level": result.level,
            "rule": result.rule,
            "message": result.message,
            "data": {"passed": result.passed, "message": result.message},
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"风控预检异常: {e}")
        return {"code": 200, "passed": True, "message": "预检执行完成（数据不足时放行）", "data": {"passed": True}}


# ==================== 股票搜索 / 添加 / 数据刷新 ====================

@router.get("/stocks/search")
def search_stocks(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=100),
    market: str = "",
    user: dict = Depends(get_current_user),
):
    """搜索标的代码或名称"""
    try:
        from utils.stock_search import search_symbol
        raw = search_symbol(q)
    except Exception as e:
        logger.warning(f"股票搜索异常: {e}")
        raw = []
    formatted = []
    for item in raw:
        code = item.get("code", "")
        mkt = item.get("market", "sz")
        if market and market.lower() not in ("a", "sz", "sh", mkt):
            continue
        formatted.append({
            "code": code,
            "symbol": code,
            "name": item.get("name", ""),
            "market": mkt,
            "type": item.get("type", "A股"),
        })
    formatted = formatted[:limit]
    return {"code": 200, "results": formatted, "data": formatted, "total": len(formatted)}


@router.post("/stocks/add")
def add_stock(req: StockAddRequest, user: dict = Depends(get_current_user)):
    """下载并入库指定标的的历史行情数据"""
    if not req.symbols:
        return {"code": 400, "message": "未提供任何标的代码"}
    try:
        from data.download_akshare import download_stock
        start = (datetime.now() - timedelta(days=req.days)).strftime("%Y-%m-%d")
        downloaded = []
        failed = []
        for symbol in req.symbols:
            try:
                download_stock(symbol, start=start)
                downloaded.append(symbol)
            except Exception as e:
                logger.warning(f"下载 {symbol} 失败: {e}")
                failed.append({"symbol": symbol, "error": str(e)})
        return {
            "code": 200 if downloaded else 400,
            "message": f"数据下载完成：{len(downloaded)}/{len(req.symbols)} 只成功，{len(failed)} 只失败",
            "downloaded": downloaded,
            "failed": failed,
        }
    except Exception as e:
        logger.warning(f"股票数据下载入口异常: {e}")
        return {"code": 400, "message": f"数据下载不可用: {e}", "downloaded": [], "failed": []}


@router.post("/refresh-data")
def refresh_data(user: dict = Depends(get_current_user)):
    """触发全量增量行情查缺补漏"""
    try:
        from utils.eastmoney_daemon import eastmoney_daemon
        res = eastmoney_daemon.sync_all(quiet=False)
        username = user.get("username", str(user)) if isinstance(user, dict) else str(user)
        log_audit(username, "refresh_data", "执行查缺补漏增量数据更新")
        return {"code": 200, "message": "增量行情同步完成", "data": res}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"refresh-data 异常: {e}")
        return {"code": 500, "message": f"同步异常: {e}"}


# ==================== 自选股收藏 ====================

@router.post("/stocks/favorites/add")
def add_favorite(req: FavoriteRequest, user: dict = Depends(get_current_user)):
    """添加自选股"""
    username = user.get("username", str(user)) if isinstance(user, dict) else str(user)
    try:
        from utils.portfolio_advisor import portfolio_store, WatchlistItem
        portfolio_store.load(username)
        portfolio_store.add_to_watchlist(WatchlistItem(symbol=req.symbol, name=req.name))
        portfolio_store.save()
        return {"code": 200, "message": f"已添加自选: {req.symbol}", "data": {"symbol": req.symbol}}
    except Exception as e:
        return {"code": 500, "message": str(e)}


@router.post("/stocks/favorites/remove")
def remove_favorite(req: FavoriteRequest, user: dict = Depends(get_current_user)):
    """移除自选股"""
    username = user.get("username", str(user)) if isinstance(user, dict) else str(user)
    try:
        from utils.portfolio_advisor import portfolio_store
        portfolio_store.load(username)
        removed = portfolio_store.remove_from_watchlist(req.symbol)
        portfolio_store.save()
        return {"code": 200, "message": f"已移除自选: {req.symbol}", "removed": removed}
    except Exception as e:
        return {"code": 500, "message": str(e)}


@router.get("/stocks/favorites")
def list_favorites(user: dict = Depends(get_current_user)):
    """获取自选股列表"""
    username = user.get("username", str(user)) if isinstance(user, dict) else str(user)
    try:
        from utils.portfolio_advisor import portfolio_store
        portfolio_store.load(username)
        items = [w.__dict__ for w in portfolio_store.get_all_watchlist()]
        return {"code": 200, "favorites": items, "data": items}
    except Exception as e:
        return {"code": 500, "message": str(e), "favorites": [], "data": []}


# ==================== 实时行情 ====================

@router.get("/realtime/{symbol}")
def realtime_quote(symbol: str, user: dict = Depends(get_current_user)):
    """获取实时行情切片（旧路径）"""
    try:
        from utils.realtime import get_realtime_quote
        quote = get_realtime_quote(symbol) or {}
        return {"code": 200, "data": quote}
    except Exception as e:
        return {"code": 500, "data": {}, "message": str(e)}


@router.get("/realtime-kline/{symbol}")
def realtime_kline(symbol: str, days: int = Query(60), user: dict = Depends(get_current_user)):
    """获取日线 K 线（旧路径）"""
    try:
        from utils.realtime import get_realtime_kline
        bars = get_realtime_kline(symbol, period="d", count=days) or []
        return {"code": 200, "data": bars, "count": len(bars)}
    except Exception as e:
        return {"code": 500, "data": [], "count": 0, "message": str(e)}


@router.get("/minute-data/{symbol}")
def minute_data(symbol: str, period: str = Query("5"), user: dict = Depends(get_current_user)):
    """获取分时走势数据（旧路径，返回扁平结构）"""
    try:
        from utils.minute_data import fetch_minute_klines_with_info
        data = fetch_minute_klines_with_info(symbol, period=period)
        return data
    except Exception as e:
        return {"name": symbol, "symbol": symbol, "count": 0, "period": f"{period}分钟",
                "bars": [], "message": str(e)}


# ==================== 因子计算 ====================

@router.get("/factors")
def list_factors(user: dict = Depends(get_current_user)):
    """获取可用因子列表"""
    from utils.factors import list_factors as _list_factors
    return {"code": 200, "factors": _list_factors(), "data": _list_factors()}


@router.post("/factors/compute")
def compute_factors(req: FactorComputeRequest, user: dict = Depends(get_current_user)):
    """计算指定因子"""
    try:
        from utils.factors import compute_factors as _compute
        df = _compute(req.symbol, req.factors or None)
        if df is None or df.empty:
            return {"code": 400, "message": "标的因子数据不足"}
        cols = [c for c in df.columns if c not in ("open", "high", "low", "close", "volume")]
        return {"code": 200, "symbol": req.symbol, "factors": cols, "rows": int(len(df))}
    except Exception as e:
        return {"code": 400, "message": f"因子计算失败: {e}"}


@router.get("/factors/score/{symbol}")
def factor_score(symbol: str, user: dict = Depends(get_current_user)):
    """单标的综合因子评分"""
    try:
        from utils.factors import top_factors_score
        scores = top_factors_score(symbol)
        result = scores.to_dict() if hasattr(scores, "to_dict") else dict(scores)
        return {"code": 200, "symbol": symbol, "score": result, "data": result}
    except Exception as e:
        return {"code": 400, "message": f"因子评分失败: {e}"}


@router.post("/factors/ranking")
def factor_ranking(req: FactorRankingRequest, user: dict = Depends(get_current_user)):
    """多标的因子打分排名"""
    try:
        from utils.factors import top_factors_score
        ranking = []
        for symbol in req.symbols:
            try:
                scores = top_factors_score(symbol)
                result = scores.to_dict() if hasattr(scores, "to_dict") else dict(scores)
                ranking.append({"symbol": symbol, "score": result})
            except Exception:
                continue
        return {"code": 200, "ranking": ranking, "data": ranking}
    except Exception as e:
        return {"code": 500, "message": str(e)}


# ==================== WebSocket 状态 ====================

@router.get("/ws/status")
def ws_status(user: dict = Depends(get_current_user)):
    """获取 WebSocket 实时推送状态"""
    return {"code": 200, "connected": False, "clients": 0, "status": "idle"}


# ==================== 订单管理 ====================

@router.post("/orders")
def create_order(req: OrderCreateRequest, user: dict = Depends(get_current_user)):
    """创建订单（初始状态 PENDING）"""
    from utils.order_manager import Direction, Offset
    om = _get_order_manager(_username(user))
    if req.volume <= 0:
        raise HTTPException(status_code=400, detail="下单数量必须为正")
    direction = Direction.LONG if req.direction == "long" else Direction.SHORT
    offset = Offset.OPEN if req.offset == "open" else Offset.CLOSE
    order = om.create_order(
        req.strategy_name, req.symbol, direction, offset, req.price, req.volume
    )
    return {"code": 200, "order": order.to_dict(), "data": order.to_dict()}


@router.get("/orders")
def list_orders(user: dict = Depends(get_current_user)):
    """查询活跃订单"""
    om = _get_order_manager(_username(user))
    orders = om.get_active_orders()
    return {"code": 200, "orders": orders, "data": orders}


@router.get("/orders/stats")
def order_stats(user: dict = Depends(get_current_user)):
    """订单统计"""
    om = _get_order_manager(_username(user))
    stats = om.get_stats()
    return {"code": 200, "stats": stats, "data": stats}


@router.post("/orders/{order_id}/submit")
def submit_order(order_id: str, user: dict = Depends(get_current_user)):
    """提交订单到 Broker（提交前校验资金/持仓/T+1）"""
    from utils.order_manager import InvalidTransition
    from datetime import datetime as _dt
    username = _username(user)
    om = _get_order_manager(username)
    try:
        order = om.orders[order_id]
    except KeyError:
        raise HTTPException(status_code=404, detail="订单不存在")
    # 预检资金/持仓/T+1
    acc = _get_account(username)
    today = _dt.now().strftime("%Y-%m-%d")
    if _is_buy(order.direction.value, order.offset.value):
        ok, msg = acc.can_buy(order.symbol, order.price, order.volume)
        if not ok:
            return {"code": 400, "message": f"买入被拒绝：{msg}", "data": {"reason": msg}}
    else:
        ok, msg = acc.can_sell(order.symbol, order.volume, today)
        if not ok:
            return {"code": 400, "message": f"卖出被拒绝：{msg}", "data": {"reason": msg}}
    try:
        order = om.submit(order_id)
        return {"code": 200, "order": order.to_dict(), "data": order.to_dict()}
    except InvalidTransition as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/fill")
def fill_order(
    order_id: str,
    trade_price: float = Query(0.0),
    trade_volume: int = Query(0),
    user: dict = Depends(get_current_user),
):
    """订单成交回报（按成交更新资金与持仓账本）"""
    from utils.order_manager import InvalidTransition
    from datetime import datetime as _dt
    username = _username(user)
    om = _get_order_manager(username)
    try:
        order = om.orders[order_id]
    except KeyError:
        raise HTTPException(status_code=404, detail="订单不存在")
    fill_vol = trade_volume if trade_volume > 0 else order.volume
    fill_price = trade_price if trade_price > 0 else order.price
    today = _dt.now().strftime("%Y-%m-%d")
    acc = _get_account(username)
    if _is_buy(order.direction.value, order.offset.value):
        acc.apply_buy(order.symbol, fill_price, fill_vol, today)
    else:
        acc.apply_sell(order.symbol, fill_price, fill_vol, today)
    try:
        order = om.on_trade(order_id, fill_price, fill_vol)
        return {"code": 200, "order": order.to_dict(), "data": order.to_dict(), "account": acc.to_dict()}
    except KeyError:
        raise HTTPException(status_code=404, detail="订单不存在")
    except InvalidTransition as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders/account")
def order_account(user: dict = Depends(get_current_user)):
    """查询纸面账户资金与持仓（含 T+1 可卖状态）"""
    username = _username(user)
    acc = _get_account(username)
    today = datetime.now().strftime("%Y-%m-%d")
    result = acc.snapshot(today)
    return {"code": 200, "data": result, "account": result}


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: str, user: dict = Depends(get_current_user)):
    """撤单"""
    from utils.order_manager import InvalidTransition
    om = _get_order_manager(_username(user))
    try:
        order = om.cancel(order_id)
        return {"code": 200, "order": order.to_dict(), "data": order.to_dict()}
    except KeyError:
        raise HTTPException(status_code=404, detail="订单不存在")
    except InvalidTransition as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/reject")
def reject_order(order_id: str, user: dict = Depends(get_current_user)):
    """拒绝订单（风控/券商拒单）"""
    from utils.order_manager import InvalidTransition
    om = _get_order_manager(_username(user))
    try:
        order = om.reject(order_id)
        return {"code": 200, "order": order.to_dict(), "data": order.to_dict()}
    except KeyError:
        raise HTTPException(status_code=404, detail="订单不存在")
    except InvalidTransition as e:
        raise HTTPException(status_code=400, detail=str(e))


# ==================== 自定义策略 CRUD ====================

@router.post("/user-strategies")
def create_user_strategy(req: UserStrategyRequest, user: dict = Depends(get_current_user)):
    """新增自定义策略"""
    from utils.strategy_rules import add_strategy
    strategy = add_strategy(
        req.name, req.symbol, req.buy_conditions, req.sell_conditions, req.market
    )
    return strategy


@router.get("/user-strategies/presets")
def get_user_strategy_presets(user: Optional[dict] = Depends(get_optional_user)):
    """获取预设策略模板"""
    from utils.strategy_rules import get_presets
    return {"code": 200, "presets": get_presets()}


@router.post("/user-strategies/presets/{index}")
def load_user_strategy_preset(
    index: int,
    symbol: str = Query(""),
    market: str = Query("a"),
    user: dict = Depends(get_current_user),
):
    """从预设模板加载并创建策略"""
    if not symbol:
        raise HTTPException(status_code=400, detail="缺少股票代码 symbol")
    try:
        from utils.strategy_rules import PRESET_STRATEGIES, add_strategy
        if index < 0 or index >= len(PRESET_STRATEGIES):
            raise HTTPException(status_code=400, detail=f"预设模板索引 {index} 不存在")
        preset = PRESET_STRATEGIES[index]
        strategy = add_strategy(
            preset["name"], symbol, preset.get("buy_conditions", []),
            preset.get("sell_conditions", []), market
        )
        return {"code": 200, "strategy": strategy, "data": strategy}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/user-strategies")
def list_user_strategies(user: Optional[dict] = Depends(get_optional_user)):
    """列出所有自定义策略"""
    from utils.strategy_rules import list_strategies
    strategies = list_strategies()
    return {"code": 200, "strategies": strategies, "data": strategies}


@router.get("/user-strategies/{strategy_id}")
def get_user_strategy(strategy_id: int, user: dict = Depends(get_current_user)):
    """获取单个自定义策略"""
    from utils.strategy_rules import get_strategy
    strategy = get_strategy(strategy_id)
    if strategy is None:
        raise HTTPException(status_code=404, detail="策略不存在")
    return strategy


@router.put("/user-strategies/{strategy_id}")
def update_user_strategy(
    strategy_id: int,
    updates: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    """更新自定义策略"""
    from utils.strategy_rules import update_strategy
    strategy = update_strategy(strategy_id, updates)
    if strategy is None:
        raise HTTPException(status_code=404, detail="策略不存在")
    return strategy


@router.delete("/user-strategies/{strategy_id}")
def delete_user_strategy(strategy_id: int, user: dict = Depends(get_current_user)):
    """删除自定义策略"""
    from utils.strategy_rules import remove_strategy
    removed = remove_strategy(strategy_id)
    if not removed:
        raise HTTPException(status_code=404, detail="策略不存在")
    return {"code": 200, "message": "策略已删除", "deleted": strategy_id}


# ==================== 自然语言策略 ====================

@router.post("/nl/parse")
def nl_parse(req: NLParseRequest, user: dict = Depends(get_current_user)):
    """解析自然语言策略描述（支持多股票）"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="文本不能为空")
    try:
        from utils.nl_parser import parse_nl_multi
        parsed_list = parse_nl_multi(text)
    except Exception as e:
        return {"status": "error", "message": str(e), "buy_conditions": [],
                "sell_conditions": [], "unmatched": [], "multi": False}
    real = [p for p in parsed_list if p.get("stock_code") and p.get("stock_code") != "unknown"]
    if len(real) > 1:
        return {"status": "ok", "multi": True, "rules": parsed_list}
    base = parsed_list[0] if parsed_list else {
        "buy_conditions": [], "sell_conditions": [], "unmatched": [],
        "explanation": "", "source": "regex",
    }
    base["multi"] = False
    base["status"] = "ok"
    return base


@router.post("/nl/create-strategy")
def nl_create_strategy(req: NLParseRequest, user: dict = Depends(get_current_user)):
    """将自然语言描述直接落地为自定义策略"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="文本不能为空")
    if not req.symbol:
        raise HTTPException(status_code=400, detail="缺少股票代码 symbol")
    try:
        from utils.nl_parser import parse_nl_strategy
        parsed = parse_nl_strategy(text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"策略解析失败: {e}")
    if not parsed.get("buy_conditions") and not parsed.get("sell_conditions"):
        raise HTTPException(status_code=400, detail="无法识别有效的策略规则")
    from utils.strategy_rules import add_strategy
    strategy = add_strategy(
        req.name or "自然语言策略", req.symbol,
        parsed.get("buy_conditions", []), parsed.get("sell_conditions", []), req.market,
    )
    return {"status": "ok", "strategy": strategy}


# ==================== 券商直连 ====================

@router.get("/broker/status")
def broker_status(user: dict = Depends(get_current_user)):
    """获取券商连接状态"""
    from utils.broker import get_status
    return get_status()


@router.post("/broker/connect")
def broker_connect(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    """连接券商客户端"""
    from utils.broker import connect
    broker = (payload or {}).get("broker", "")
    result = connect(broker, **{k: v for k, v in (payload or {}).items() if k != "broker"})
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message", "连接失败"))
    return result


@router.get("/broker/balance")
def broker_balance(user: dict = Depends(get_current_user)):
    """查询券商账户资金"""
    from utils.broker import get_balance
    result = get_balance()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/broker/positions")
def broker_positions(user: dict = Depends(get_current_user)):
    """查询券商持仓"""
    from utils.broker import get_positions
    return get_positions()


@router.post("/broker/buy")
def broker_buy(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    """券商买入"""
    from utils.broker import buy
    return buy(payload.get("symbol", ""), payload.get("price", 0.0), payload.get("amount", 0))


@router.post("/broker/sell")
def broker_sell(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    """券商卖出"""
    from utils.broker import sell
    return sell(payload.get("symbol", ""), payload.get("price", 0.0), payload.get("amount", 0))


@router.get("/broker/orders")
def broker_orders(user: dict = Depends(get_current_user)):
    """查询券商当日委托"""
    from utils.broker import get_orders
    return get_orders()


@router.post("/broker/disconnect")
def broker_disconnect(user: dict = Depends(get_current_user)):
    """断开券商连接"""
    from utils.broker import disconnect
    return disconnect()
