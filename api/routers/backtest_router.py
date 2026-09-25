#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多周期历史大样本回溯验证路由 (Playbook Backtest Router)
提供 1~3 年个股与战法大样本真实胜率、盈亏比与 A/B 版本同台对比 API
"""

import json
import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from utils.auth import get_optional_user
from utils.playbook_backtest_engine import (
    global_playbook_backtest_engine,
    PRESET_POOLS
)
from utils.playbook_engine import PLAYBOOK_REGISTRY

logger = logging.getLogger("BacktestRouter")
router = APIRouter(prefix="/api/backtest", tags=["大样本历史回测"])

# 内存轻量缓存最近一次回测结果
_LATEST_BACKTEST_CACHE: Dict[str, Any] = {}


class RunBacktestRequest(BaseModel):
    pool_id: Optional[str] = "core_a50"
    custom_symbols: Optional[str] = ""
    period: Optional[str] = "3y"  # 1y, 2y, 3y, 5y
    playbook_id: Optional[str] = "auto"
    version: Optional[str] = "v2.0"  # v1.0, v2.0
    compare_mode: Optional[bool] = False


from utils.playbook_backtest_engine import (
    global_playbook_backtest_engine,
    PRESET_POOLS,
    PLAYBOOK_VERSIONS
)

@router.get("/presets")
async def get_backtest_presets(user=Depends(get_optional_user)):
    """获取预设标的池、可选周期、战法列表及历史版本档案"""
    pools = []
    for k, v in PRESET_POOLS.items():
        pools.append({
            "id": v["id"],
            "name": v["name"],
            "symbols": v["symbols"],
            "count": len(v["symbols"])
        })

    playbooks = [{"id": "auto", "name": "⚡ 全战法自动匹配 (Auto)"}]
    for pb_id, pb_meta in PLAYBOOK_REGISTRY.items():
        playbooks.append({
            "id": pb_id,
            "name": pb_meta["name"],
            "short_name": pb_meta["short_name"],
            "style": pb_meta["style"]
        })

    periods = [
        {"id": "1y", "name": "近 1 年 (2025~至今)", "years": 1},
        {"id": "2y", "name": "近 2 年 (2024~至今)", "years": 2},
        {"id": "3y", "name": "近 3 年 (2023~至今 · 推荐大样本)", "years": 3},
        {"id": "5y", "name": "近 5 年 (2021~至今 · 极限压力测试)", "years": 5},
    ]

    return {
        "success": True,
        "pools": pools,
        "playbooks": playbooks,
        "periods": periods,
        "versions": list(PLAYBOOK_VERSIONS.values())
    }


@router.get("/versions")
async def get_playbook_versions_endpoint(user=Depends(get_optional_user)):
    """获取所有已归档的历史打法版本库明细"""
    return {
        "success": True,
        "versions": list(PLAYBOOK_VERSIONS.values())
    }


@router.post("/run")
async def run_history_backtest(req: RunBacktestRequest, user=Depends(get_optional_user)):
    """启动多周期历史大样本回溯验证 (支持 A/B 版本对比)"""
    # 1. 确定标的代码列表
    symbols = []
    if req.custom_symbols and req.custom_symbols.strip():
        # 用户手动输入了股票代码
        raw_syms = [s.strip().upper() for s in req.custom_symbols.replace("，", ",").replace(" ", ",").split(",") if s.strip()]
        symbols = list(dict.fromkeys(raw_syms))
    elif req.pool_id in PRESET_POOLS:
        symbols = PRESET_POOLS[req.pool_id]["symbols"]
    else:
        symbols = PRESET_POOLS["core_a50"]["symbols"]

    if not symbols:
        raise HTTPException(status_code=400, detail="未指定有效的回测标的池")

    # 2. 计算起止日期
    now = datetime.now()
    end_date = now.strftime("%Y-%m-%d")
    years_map = {"1y": 1, "2y": 2, "3y": 3, "5y": 5}
    years = years_map.get(req.period, 3)
    start_date = (now - timedelta(days=years * 365)).strftime("%Y-%m-%d")

    # 特殊优化：如果用户只测单只股票（如 600519、NVDA），走深度个股穿透逻辑
    if len(symbols) == 1:
        single_sym = symbols[0]
        single_res = await asyncio.to_thread(
            global_playbook_backtest_engine.run_individual_stock_detailed_backtest,
            symbol=single_sym,
            start_date=start_date,
            end_date=end_date,
            target_playbook_id=req.playbook_id or "auto",
            version=req.version or "v2.0",
            compare_mode=req.compare_mode or False
        )
        if single_res.get("success"):
            single_res["meta"] = {
                "symbols": symbols,
                "start_date": start_date,
                "end_date": end_date,
                "period": req.period,
                "playbook_id": req.playbook_id,
                "version": req.version,
                "is_single_stock": True,
                "generated_at": now.strftime("%Y-%m-%d %H:%M:%S")
            }
            global _LATEST_BACKTEST_CACHE
            _LATEST_BACKTEST_CACHE = single_res
            return {
                "success": True,
                "result": single_res
            }

    logger.info(f"🚀 触发历史大样本回测: 标的={symbols}, 跨度={start_date}~{end_date}, 战法={req.playbook_id}, A/B对比={req.compare_mode}")

    try:
        if req.compare_mode:
            # 执行 A/B 版本同台对比
            result = await asyncio.to_thread(
                global_playbook_backtest_engine.compare_versions,
                symbols=symbols,
                start_date=start_date,
                end_date=end_date,
                target_playbook_id=req.playbook_id or "auto"
            )
            result["compare_mode"] = True
        else:
            # 执行单版本回测
            backtest_res = await asyncio.to_thread(
                global_playbook_backtest_engine.run_multi_stock_backtest,
                symbols=symbols,
                start_date=start_date,
                end_date=end_date,
                target_playbook_id=req.playbook_id or "auto",
                version=req.version or "v2.0"
            )
            result = {
                "compare_mode": False,
                "data": backtest_res
            }

        result["meta"] = {
            "symbols": symbols,
            "start_date": start_date,
            "end_date": end_date,
            "period": req.period,
            "playbook_id": req.playbook_id,
            "version": req.version,
            "is_single_stock": False,
            "generated_at": now.strftime("%Y-%m-%d %H:%M:%S")
        }

        # 缓存最新一次结果
        _LATEST_BACKTEST_CACHE = result

        return {
            "success": True,
            "result": result
        }

    except Exception as e:
        logger.error(f"历史大样本回测执行异常: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


class RunSingleStockRequest(BaseModel):
    symbol: str
    period: Optional[str] = "3y"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    playbook_id: Optional[str] = "auto"
    version: Optional[str] = "v2.0"
    compare_mode: Optional[bool] = False


@router.post("/run_stock")
async def run_single_stock_backtest_endpoint(req: RunSingleStockRequest, user=Depends(get_optional_user)):
    """专门针对单只个股的 1~3 年历史战法穿透与适应度诊断接口 (支持任意自定义起止日期)"""
    sym = req.symbol.strip().upper()
    now = datetime.now()
    
    if req.start_date and req.end_date:
        start_date = req.start_date.strip()
        end_date = req.end_date.strip()
    else:
        end_date = now.strftime("%Y-%m-%d")
        years_map = {"1y": 1, "2y": 2, "3y": 3, "5y": 5}
        years = years_map.get(req.period, 3)
        start_date = (now - timedelta(days=years * 365)).strftime("%Y-%m-%d")

    res = await asyncio.to_thread(
        global_playbook_backtest_engine.run_individual_stock_detailed_backtest,
        symbol=sym,
        start_date=start_date,
        end_date=end_date,
        target_playbook_id=req.playbook_id or "auto",
        version=req.version or "v2.0",
        compare_mode=req.compare_mode or False
    )
    if not res.get("success"):
        return {"success": False, "error": res.get("error", "回测失败")}

    res["meta"] = {
        "symbols": [sym],
        "start_date": start_date,
        "end_date": end_date,
        "period": req.period,
        "playbook_id": req.playbook_id,
        "version": req.version,
        "is_single_stock": True,
        "generated_at": now.strftime("%Y-%m-%d %H:%M:%S")
    }
    global _LATEST_BACKTEST_CACHE
    _LATEST_BACKTEST_CACHE = res
    return {"success": True, "result": res}



@router.get("/latest")
async def get_latest_backtest_result(user=Depends(get_optional_user)):
    """获取最近一次运行的大样本回测缓存结果"""
    global _LATEST_BACKTEST_CACHE
    if not _LATEST_BACKTEST_CACHE:
        return {
            "success": True,
            "has_cache": False,
            "message": "尚未执行过大样本历史回测"
        }
    return {
        "success": True,
        "has_cache": True,
        "result": _LATEST_BACKTEST_CACHE
    }
