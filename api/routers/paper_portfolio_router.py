# -*- coding: utf-8 -*-
"""
====================================================================
量化交易系统 - 2万元实战全真模拟盘与每日调仓 API 路由 (PaperPortfolioRouter)
====================================================================
接口清单：
1. GET  /api/paper-portfolio/status           : 获取当前全景资产、持仓明细与今日调仓体检
2. POST /api/paper-portfolio/rebalance        : 执行今日系统智能调仓（止损/止盈/补位买入）
3. POST /api/paper-portfolio/reset            : 重置模拟盘账户（支持指定本金）
4. POST /api/paper-portfolio/trade            : 手动快速买入/卖出调仓
====================================================================
"""

from fastapi import APIRouter, HTTPException, Query, Body, Depends
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from services.paper_portfolio_service import paper_portfolio_service
from utils.auth import get_current_user

router = APIRouter(prefix="/api/paper-portfolio", tags=["2万实战模拟盘"])


class ResetPortfolioRequest(BaseModel):
    capital: float = Field(default=20000.0, description="初始本金金额，默认20,000元")


class ManualTradeRequest(BaseModel):
    action: str = Field(..., description="交易动作：BUY 或 SELL")
    symbol: str = Field(..., description="股票代码，如 605222")
    name: str = Field(..., description="股票名称，如 起帆电缆")
    price: float = Field(..., description="委托/成交单价")
    shares: int = Field(..., description="买卖股数，必须是100的整数倍")


@router.get("/status", summary="获取2万模拟盘全景资产状态与持仓")
async def get_paper_portfolio_status():
    """
    获取模拟盘实时数据：
    - 账户总资产、现金储备、持仓市值
    - 累计收益率、今日盈亏、胜率统计
    - 当前持仓股票明细（含止损止盈百分比计算与操作建议）
    - 今日系统调仓指令包
    """
    try:
        data = paper_portfolio_service.get_portfolio_status()
        return {
            "code": 200,
            "message": "获取成功",
            "data": data
        }
    except Exception as e:
        return {
            "code": 500,
            "message": f"获取模拟盘状态异常: {str(e)}",
            "data": None
        }


@router.post("/rebalance", summary="执行今日系统调仓建议")
async def execute_rebalance(user: dict = Depends(get_current_user)):
    """
    根据今日行情诊断，自动执行止盈平仓、止损减仓或补位建仓（需管理员权限）
    """
    try:
        res = paper_portfolio_service.execute_rebalance()
        return {
            "code": 200,
            "message": res.get("message", "调仓执行完成"),
            "data": res
        }
    except Exception as e:
        return {
            "code": 500,
            "message": f"执行调仓异常: {str(e)}",
            "data": None
        }


@router.post("/reset", summary="重置模拟盘账户")
async def reset_paper_portfolio(req: ResetPortfolioRequest, user: dict = Depends(get_current_user)):
    """
    一键重置模拟账户，支持自定义本金（1万、2万、5万、10万等，需管理员权限）
    """
    try:
        res = paper_portfolio_service.reset_portfolio(capital=req.capital)
        return {
            "code": 200,
            "message": res.get("message", "重置成功"),
            "data": res
        }
    except Exception as e:
        return {
            "code": 500,
            "message": f"重置模拟盘异常: {str(e)}",
            "data": None
        }


@router.get("/history", summary="获取模拟盘全景历史记录与对比报告")
async def get_paper_portfolio_history():
    """
    获取量化实战全景历史对比数据：
    - 组合净值走势 vs 沪深300指数基准走势（逐日对照）
    - 6大核心对比量化指标（超额Alpha、最大回撤、夏普比率、胜率、盈亏比等）
    - 已平仓历史交易战绩复盘明细（买入价、卖出价、持仓天数、扣税净盈亏、归因）
    - 可供回溯查看的每日历史快照日期索引
    """
    try:
        data = paper_portfolio_service.get_history_report()
        return {
            "code": 200,
            "message": "获取历史对比报告成功",
            "data": data
        }
    except Exception as e:
        return {
            "code": 500,
            "message": f"获取历史对比报告异常: {str(e)}",
            "data": None
        }


@router.get("/snapshot", summary="获取指定历史交易日的持仓与调仓快照")
async def get_paper_portfolio_snapshot(date: Optional[str] = Query(None, description="交易日期，格式 YYYY-MM-DD")):
    """
    获取指定日期的每日持仓快照与当日调仓体检结论
    """
    try:
        target_date = date or ""
        data = paper_portfolio_service.get_snapshot_by_date(target_date)
        return {
            "code": 200,
            "message": "获取历史快照成功",
            "data": data
        }
    except Exception as e:
        return {
            "code": 500,
            "message": f"获取历史快照异常: {str(e)}",
            "data": None
        }
