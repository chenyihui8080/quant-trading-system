#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
交易复盘工作台 (Review Workbench) 核心路由套件
"""

import json
import logging
import sqlite3
from datetime import datetime
import sys
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, APIRouter, HTTPException, Query, Response, Body, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys as _sys
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
if str(PROJECT_ROOT) not in _sys.path:
    _sys.path.insert(0, str(PROJECT_ROOT))
if str(BASE_DIR) not in _sys.path:
    _sys.path.insert(0, str(BASE_DIR))

from utils.auth import get_current_user


from pipeline.graph import review_pipeline
from agents.full_dashboard_service import (
    get_full_workbench_dashboard_data,
    get_portfolio_custom_review,
    get_sector_deep_dive_analysis,
    decode_real_broker_statement,
    get_curated_news_paginated,
    get_single_evidence_detail,
    get_single_news_detail,
    get_single_stock_research_detail
)
from agents.dashboard_builder import perform_stock_risk_check

logger = logging.getLogger("ReviewAPI")
router = APIRouter(tags=["交易复盘工作台"])
app = FastAPI(title="交易复盘工作台统一 API", version="2.0.0")

# 全局 CORS（复盘工作台为主系统跨域调用提供数据，必须显式落地）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = BASE_DIR / "data" / "review.db"



class RiskCheckRequest(BaseModel):
    code: Optional[str] = None
    symbol: Optional[str] = None
    name: Optional[str] = ""


class BrokerDecodeRequest(BaseModel):
    text: Optional[str] = ""
    lines: Optional[List[str]] = None


@router.get("/api/review/full-agent-dashboard")
async def get_full_agent_dashboard(date: Optional[str] = Query(None, description="交易日期 YYYY-MM-DD"), user: dict = Depends(get_current_user)):
    """全量聚合 7 人小智能体团队协同数据与大盘盘面特征"""
    target_date = date or datetime.now().strftime("%Y-%m-%d")
    try:
        data = get_full_workbench_dashboard_data(target_date)
        if isinstance(data, dict) and "data" in data and "code" in data:
            return data
        return {"code": 200, "message": "智能体团队数据调度完成", "data": data}
    except Exception as e:
        logger.error(f"调度智能体大屏异常: {e}")
        return {"code": 500, "message": str(e), "data": None}


@router.get("/api/review/portfolio-custom-plan")
@router.post("/api/review/portfolio-custom-plan")
async def get_portfolio_custom_plan(user: dict = Depends(get_current_user)):
    """获取用户持仓专属量化复盘与做T规划"""
    try:
        data = get_portfolio_custom_review()
        if isinstance(data, dict) and "data" in data and "code" in data:
            return data
        return {"code": 200, "data": data}
    except Exception as e:
        return {"code": 500, "message": str(e), "data": []}


@router.get("/api/review/sector-deep-dive")
async def get_sector_deep_dive(sector: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    """获取核心题材板块深度穿透与逻辑归因"""
    try:
        data = get_sector_deep_dive_analysis(sector)
        if isinstance(data, dict) and "data" in data and "code" in data:
            return data
        return {"code": 200, "data": data}
    except Exception as e:
        return {"code": 500, "message": str(e), "data": None}


@router.post("/api/review/check-risk-mine")
async def check_risk_mine(req: RiskCheckRequest, user: dict = Depends(get_current_user)):
    """个股深度排雷专家检测 (支持代码/名称，Fail-Closed 严防假通过)"""
    query_val = req.code or req.symbol or req.name
    if not query_val or not str(query_val).strip():
        raise HTTPException(status_code=400, detail="请提供有效的股票代码或标的名称进行排雷检测")
    
    result = perform_stock_risk_check(str(query_val).strip())
    if not result:
        raise HTTPException(status_code=404, detail=f"未找到标的 {query_val} 的有效上市公司数据")
    
    return {"code": 200, "data": result}


@router.post("/api/review/decode-broker")
async def decode_broker(req: BrokerDecodeRequest, user: dict = Depends(get_current_user)):
    """真实交割单买卖解析与战法映射"""
    try:
        text = req.text or "\n".join(req.lines or [])
        result = decode_real_broker_statement(text)
        if isinstance(result, dict) and "data" in result and "code" in result:
            return result
        return {"code": 200, "data": result}
    except Exception as e:
        return {"code": 500, "message": str(e)}


# 📰 情报证据库分页接口 (同时支持 /curated-news 与 /evidence-list)
@router.get("/api/review/evidence-list")
@router.get("/api/review/curated-news")
async def get_evidence_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=1, le=50),
    keyword: Optional[str] = Query(None),
    portfolio_only: bool = Query(False),
    only_portfolio: Optional[bool] = Query(None),
    sort_by: Optional[str] = Query("time"),
    user: dict = Depends(get_current_user)
):
    """分页获取情报资讯与新闻证据"""
    is_port_only = bool(portfolio_only or only_portfolio)
    res = get_curated_news_paginated(
        page=page,
        page_size=page_size,
        sort_by=sort_by or "time",
        portfolio_only=is_port_only,
        keyword=keyword
    )
    return res



@router.get("/api/review/evidence-detail")
async def get_evidence_detail(ref_tag: str = Query(..., description="证据标签"), user: dict = Depends(get_current_user)):
    """兼容旧接口：获取单篇新闻证据详情"""
    return get_single_evidence_detail(ref_tag)


@router.get("/api/review/news-detail")
async def get_news_detail(news_id: str = Query(..., description="新闻ID或标签"), user: dict = Depends(get_current_user)):
    """纯净新闻快讯全文与来源详情"""
    return get_single_news_detail(news_id)


@router.get("/api/review/stock-research")
async def get_stock_research(
    stock_code: Optional[str] = Query(None, description="股票代码"),
    symbol: Optional[str] = Query(None, description="股票代码 (别名)"),
    user: dict = Depends(get_current_user)
):
    """个股独家深度催化与量价研报"""
    target_code = stock_code or symbol or ""
    if not target_code:
        raise HTTPException(status_code=400, detail="股票代码不能为空")
    return get_single_stock_research_detail(target_code)



@router.get("/api/review/daily-report")
async def get_daily_report(
    date: Optional[str] = Query(None, description="交易日期 YYYY-MM-DD", alias="trade_date"),
    trade_date: Optional[str] = Query(None, description="交易日期 YYYY-MM-DD (兼容别名)"),
    user: dict = Depends(get_current_user)
):
    """获取指定日期的每日复盘总览报告"""
    target_date = date or trade_date or datetime.now().strftime("%Y-%m-%d")
    with sqlite3.connect(str(DB_PATH)) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT trade_date, market_summary, sentiment_summary, main_themes,
                   game_plan_tomorrow, citations, degraded_nodes, created_at
            FROM daily_reviews
            WHERE trade_date = ?
            ORDER BY id DESC LIMIT 1
        """, (target_date,))
        row = cursor.fetchone()

    if not row:
        return {"code": 200, "data": None, "message": f"{target_date} 暂无复盘归档"}

    trade_date, mkt_raw, sentiment, themes_raw, plan, citations_raw, degraded_raw, created_at = row
    return {
        "code": 200,
        "data": {
            "trade_date": trade_date,
            "market_summary": json.loads(mkt_raw) if mkt_raw else {},
            "sentiment_summary": sentiment,
            "main_themes": json.loads(themes_raw) if themes_raw else [],
            "game_plan_tomorrow": plan,
            "citations": json.loads(citations_raw) if citations_raw else {},
            "degraded_nodes": json.loads(degraded_raw) if degraded_raw else [],
            "created_at": created_at
        }
    }


@router.get("/api/review/core-watchlist")
async def get_core_watchlist(
    date: Optional[str] = Query(None, description="交易日期 YYYY-MM-DD", alias="trade_date"),
    trade_date: Optional[str] = Query(None, description="交易日期 YYYY-MM-DD (兼容别名)"),
    user: dict = Depends(get_current_user)
):
    """获取 4 层漏斗严选的核心观察池列表"""
    target_date = date or trade_date or datetime.now().strftime("%Y-%m-%d")
    watchlist = []
    
    # 1. 尝试从数据库读取
    try:
        if DB_PATH.exists():
            with sqlite3.connect(str(DB_PATH)) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT stock_code, stock_name, sector_name, close_price, change_pct,
                           turnover_rate, amount_yi, volatility_pattern, attribution_type,
                           attribution_detail, attribution_confidence, confidence_level,
                           risk_flags, evidence_ref
                    FROM core_watchlists
                    WHERE trade_date = ?
                    ORDER BY attribution_confidence DESC, amount_yi DESC
                """, (target_date,))
                rows = cursor.fetchall()
                for r in rows:
                    watchlist.append({
                        "stock_code": r[0],
                        "stock_name": r[1],
                        "sector_name": r[2],
                        "close_price": r[3],
                        "change_pct": r[4],
                        "turnover_rate": r[5],
                        "amount_yi": r[6],
                        "volatility_pattern": r[7],
                        "attribution_type": r[8],
                        "attribution_detail": r[9],
                        "attribution_confidence": r[10],
                        "confidence_level": r[11],
                        "risk_flags": json.loads(r[12]) if r[12] else [],
                        "evidence_ref": r[13]
                    })
    except Exception as e:
        logger.warning(f"读取 core_watchlists 异常: {e}")

    # 2. 若库中无数据且查询的是【今日交易日】，自动触发真实 Pipeline A 运算与入库
    if not watchlist:
        today_str = datetime.now().strftime("%Y-%m-%d")
        if target_date == today_str:
            # 判定今天是否为周末休市
            if datetime.now().weekday() < 5:
                logger.info(f"⚡ 检测到今日 ({today_str}) 尚未执行复盘归档，自动触发 Pipeline A 实时运算...")
                try:
                    state = review_pipeline.run_pipeline_a(today_str)
                    raw_pool = state.get("final_watchpool", [])
                    for r in raw_pool:
                        watchlist.append({
                            "stock_code": r.get("stock_code", ""),
                            "stock_name": r.get("stock_name", ""),
                            "sector_name": r.get("sector", r.get("sector_name", "")),
                            "close_price": float(r.get("close_price", 0.0) or 0.0),
                            "change_pct": float(r.get("change_pct", 0.0) or 0.0),
                            "turnover_rate": float(r.get("turnover_rate", 0.0) or 0.0),
                            "amount_yi": float(r.get("amount_yi", 0.0) or 0.0),
                            "volatility_pattern": r.get("volatility_pattern", "volatility_active"),
                            "attribution_type": r.get("attribution_tag", r.get("attribution_type", "技术突破")),
                            "attribution_detail": r.get("attribution_detail", ""),
                            "attribution_confidence": float(r.get("attribution_confidence", 0.0) or 0.0),
                            "confidence_level": r.get("confidence_level", "medium"),
                            "risk_flags": r.get("risk_flags", []),
                            "evidence_ref": r.get("evidence_ref", "ref:0")
                        })
                except Exception as pe:
                    logger.error(f"自动触发 Pipeline A 异常: {pe}")

    # 若依然无数据 (历史空白日、休市日或运算无标的)，诚实返回空列表，坚决不编造假股票
    return {"code": 200, "total": len(watchlist), "data": watchlist}



@router.get("/api/review/history-reports")
async def get_history_reports(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    user: dict = Depends(get_current_user)
):
    """获取历史复盘研报档案列表 (只返回真实归档记录，彻底杜绝编造)"""
    all_reports = []
    
    # 1. 从本地数据库读取真实归档
    try:
        if DB_PATH.exists():
            with sqlite3.connect(str(DB_PATH)) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT trade_date, market_summary, sentiment_summary, main_themes, created_at
                    FROM daily_reviews
                    ORDER BY trade_date DESC LIMIT 100
                """)
                rows = cursor.fetchall()
                for r in rows:
                    t_date, mkt_raw, sentiment, themes_raw, created_at = r
                    mkt = json.loads(mkt_raw) if mkt_raw else {}
                    themes = json.loads(themes_raw) if themes_raw else []
                    all_reports.append({
                        "trade_date": t_date,
                        "total_amount_yi": mkt.get("total_amount_yi", 0.0),
                        "median_change_pct": mkt.get("median_change_pct", 0.0),
                        "highest_ladder_stock": mkt.get("highest_ladder_stock", "暂无"),
                        "sentiment_summary_short": sentiment or "当日暂无文字定调",
                        "main_themes_names": [t.get("theme_name", t) if isinstance(t, dict) else str(t) for t in themes],
                        "created_at": created_at
                    })
    except Exception as e:
        logger.warning(f"读取 daily_reviews 异常: {e}")

    # 按日期倒序排列
    all_reports.sort(key=lambda x: x["trade_date"], reverse=True)

    # 2. 执行起止日期与关键词过滤
    filtered = []
    for rep in all_reports:
        t_date = rep["trade_date"]
        if start_date and t_date < start_date:
            continue
        if end_date and t_date > end_date:
            continue
        if keyword:
            kw = keyword.lower()
            text_corpus = f"{t_date} {rep['highest_ladder_stock']} {rep['sentiment_summary_short']} {' '.join(rep['main_themes_names'])}".lower()
            if kw not in text_corpus:
                continue
        filtered.append(rep)

    # 3. 执行分页
    total = len(filtered)
    total_pages = max(1, (total + page_size - 1) // page_size)
    if page > total_pages and total > 0:
        return {
            "code": 200,
            "total": total,
            "total_pages": total_pages,
            "page": page,
            "page_size": page_size,
            "data": [],
            "warning": f"请求页码 {page} 超出实际总页数 {total_pages}，已返回空结果，请减少页码重新查询"
        }
    start_idx = (page - 1) * page_size
    paged_data = filtered[start_idx:start_idx + page_size]


    return {
        "code": 200,
        "total": total,
        "total_pages": total_pages,
        "page": page,
        "page_size": page_size,
        "data": paged_data
    }


@router.post("/api/review/trigger-pipeline-a")
async def trigger_pipeline_a(date: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    """手动强制重新触发一次 Pipeline A 盘后复盘（盘后 15:05 由调度器自动触发）"""
    target_date = date or datetime.now().strftime("%Y-%m-%d")
    # 软时段提示：盘中（交易日 09:15~15:00）触发属于复盘，行情仍在变动，数据为盘中实时快照而非盘后定稿
    warning = ""
    now = datetime.now()
    if now.weekday() < 5 and (9 * 60 + 15) <= (now.hour * 60 + now.minute) < (15 * 60 + 5):
        warning = "当前处于交易时段，本次为盘中实时快照，非盘后定稿，复盘结论可能随行情变动"
    state = review_pipeline.run_pipeline_a(target_date)
    return {
        "code": 200,
        "message": "Pipeline A 盘后复盘执行成功",
        "warning": warning,
        "execution_time_sec": state["execution_time_sec"],
        "degraded_nodes": state["degraded_nodes"],
        "watchpool_count": len(state["final_watchpool"]),
        "pipeline_version": state.get("pipeline_version", state.get("version", "unknown")),
        "run_id": state.get("run_id", ""),
        "generated_at": state.get("generated_at", "")
    }


@router.get("/api/review/export-txt")
async def export_watchlist_txt(date: Optional[str] = Query(None, description="交易日期 YYYY-MM-DD"), user: dict = Depends(get_current_user)):
    """导出核心观察池为通达信/同花顺格式 txt 文件"""
    target_date = date or datetime.now().strftime("%Y-%m-%d")
    watchlist = []
    try:
        if DB_PATH.exists():
            with sqlite3.connect(str(DB_PATH)) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT stock_code, stock_name, close_price, change_pct, sector_name
                    FROM core_watchlists
                    WHERE trade_date = ?
                    ORDER BY attribution_confidence DESC, amount_yi DESC
                """, (target_date,))
                rows = cursor.fetchall()
                for r in rows:
                    code = r[0]
                    # 转换代码格式：A股 6开头→SH，0/3开头→SZ
                    if code.startswith("6"):
                        prefix = "SH"
                    elif code.startswith(("0", "3")):
                        prefix = "SZ"
                    else:
                        prefix = "BJ"
                    watchlist.append(f"{prefix}{code}\t{r[1]}\t{r[2]}\t{r[3]}%\t{r[4]}")
    except Exception as e:
        logger.error(f"导出观察池失败: {e}")

    content = f"复盘日期: {target_date}\n代码\t名称\t收盘价\t涨跌幅\t所属板块\n" + "\n".join(watchlist)
    return Response(
        content=content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="watchlist_{target_date}.txt"'}
    )


@app.get("/", response_class=Response)
async def root_page():
    """复盘工作台页面入口"""
    html_path = Path(__file__).parent / "templates" / "index.html"
    if not html_path.exists():
        return Response("index.html not found", status_code=404)
    content = html_path.read_text(encoding="utf-8")
    return Response(content.encode("utf-8"), media_type="text/html; charset=utf-8")


# 挂载内部路由
app.include_router(router)


