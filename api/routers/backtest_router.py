#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
量化回测引擎与策略投研路由 (Backtest & Strategy Quant Router)
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from vnpy.trader.constant import Interval

from config.settings import STRATEGIES, BACKTEST_CONFIG, DATA_DIR
from utils.data_generator import load_csv_bars
from utils.comparison import compare_strategies, optimize_strategy
from utils.factors import list_factors, compute_factors, top_factors_score
from utils.database import (
    save_backtest, get_backtest_history, get_backtest_by_id,
    save_factor_ranking, get_factor_history, log_audit
)
from utils.auth import get_current_user

router = APIRouter(tags=["量化回测与策略投研"])


class BacktestRequest(BaseModel):
    strategy: str
    symbol: Optional[str] = "rb8888"
    capital: Optional[float] = 1_000_000
    rate: Optional[float] = 1 / 10000
    slippage: Optional[float] = 0.2
    size: Optional[int] = 10
    pricetick: Optional[float] = 1.0
    start: Optional[str] = "2023-01-01"
    end: Optional[str] = "2023-12-31"
    setting: Optional[Dict[str, Any]] = None


@router.get("/strategies")
def list_strategies():
    """获取所有可用策略列表及默认参数"""
    return {"code": 200, "strategies": STRATEGIES}


@router.post("/backtest")
def run_backtest(req: BacktestRequest, user: str = Depends(get_current_user)):
    """运行单策略历史回测"""
    if req.strategy not in STRATEGIES:
        raise HTTPException(status_code=400, detail=f"未知策略: {req.strategy}")

    from vnpy_ctastrategy.backtesting import BacktestingEngine
    bars = load_csv_bars(req.symbol)
    if not bars:
        raise HTTPException(status_code=404, detail=f"未找到标的 {req.symbol} 数据")

    engine = BacktestingEngine()
    engine.set_parameters(
        vt_symbol=f"{req.symbol}.LOCAL",
        interval=Interval.DAILY,
        start=bars[0].datetime,
        end=bars[-1].datetime,
        rate=req.rate,
        slippage=req.slippage,
        size=req.size,
        pricetick=req.pricetick,
        capital=req.capital,
    )
    engine.add_strategy(STRATEGIES[req.strategy]["class"], req.setting or STRATEGIES[req.strategy]["default_setting"])
    engine.load_data()
    engine.run_backtesting()
    df = engine.calculate_result()
    stats = engine.calculate_statistics(output=False)

    record_id = save_backtest(
        user=user,
        strategy=req.strategy,
        symbol=req.symbol,
        capital=req.capital,
        start_date=str(bars[0].datetime)[:10],
        end_date=str(bars[-1].datetime)[:10],
        setting=req.setting or STRATEGIES[req.strategy]["default_setting"],
        statistics=stats
    )
    log_audit(user, "backtest", f"运行回测: {req.strategy} @ {req.symbol}")
    return {"code": 200, "record_id": record_id, "statistics": stats}
