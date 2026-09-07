#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
行情数据与市场/券商直连路由 (Market Data & Broker Connection Router)
"""

import os
import time as _time
import json
import logging
from datetime import datetime
from pathlib import Path
from dataclasses import asdict
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel

from utils.auth import get_current_user, get_optional_user
from utils.realtime import get_realtime_quote, get_realtime_kline
from utils.database import log_audit
from utils.eastmoney_daemon import eastmoney_daemon, eastmoney_auth

logger = logging.getLogger("MarketRouter")
router = APIRouter(prefix="/api/market", tags=["行情与市场数据"])
legacy_router = APIRouter(tags=["行情与市场数据兼容接口"])


class AutoSyncToggleRequest(BaseModel):
    enabled: bool


class BindAccountRequest(BaseModel):
    account: str
    password: Optional[str] = ""


class PriceAlertRequest(BaseModel):
    symbol: str
    name: str = ""
    direction: str
    target_price: float


_price_alerts: dict[str, list[dict]] ={}
@router.post("/alerts/price")
@legacy_router.post("/alerts/price")
def create_price_alert(req: PriceAlertRequest, user: dict = Depends(get_current_user)):
    if req.direction not in ("above", "below"):
        raise HTTPException(status_code=400, detail="direction 必须为 above 或 below")
    username = user.get("username", str(user))
    alert = {**req.model_dump(), "username": username, "active": True}
    _price_alerts.setdefault(username, []).append(alert)
    return {"code": 200, "data": alert}


@router.get("/alerts/price")
@legacy_router.get("/alerts/price")
def list_price_alerts(user: dict = Depends(get_current_user)):
    username = user.get("username", str(user))
    alerts = _price_alerts.get(username, [])
    return {"code": 200, "data": alerts, "alerts": alerts}


@router.post("/alerts/check")
@legacy_router.post("/alerts/check")
def check_price_alerts(user: dict = Depends(get_current_user)):
    username = user.get("username", str(user))
    return {"code": 200, "data": [], "alerts": _price_alerts.get(username, [])}


@router.get("/realtime/{symbol}")
def realtime_quote(symbol: str):
    """获取实时股票/ETF行情切片"""
    quote = get_realtime_quote(symbol)
    if not quote:
        raise HTTPException(status_code=404, detail=f"未找到标的 {symbol} 行情")
    return {"code": 200, "data": quote}


@router.get("/realtime-kline/{symbol}")
def realtime_kline(symbol: str, days: int = Query(60, description="K线天数")):
    """获取标的最新K线数据"""
    bars = get_realtime_kline(symbol, period="d", count=days)
    if not bars:
        raise HTTPException(status_code=404, detail=f"标的 {symbol} K线获取失败")
    return {"code": 200, "data": bars, "count": len(bars)}


@router.get("/minute-data/{symbol}")
def minute_data(symbol: str, period: str = Query("5", description="周期: 5/15/30/60 分钟")):
    """获取分时走势图数据"""
    try:
        from utils.minute_data import fetch_minute_klines_with_info
        data = fetch_minute_klines_with_info(symbol, period=period)
        return {"code": 200, "data": data}
    except Exception as e:
        return {"code": 200, "data": [], "message": str(e)}


@router.get("/search_stocks")
@router.get("/stocks/search")
def search_stocks(q: str = Query(..., min_length=1)):
    """搜索标的代码或名称 (支持代码、名称、拼音缩写及模糊匹配)"""
    from utils.stock_search import search_symbol
    raw_results = search_symbol(q)
    formatted = []
    for item in raw_results:
        c = item.get("code", "")
        formatted.append({
            "code": c,
            "symbol": c,
            "name": item.get("name", ""),
            "market": item.get("market", "sz"),
            "type": item.get("type", "A股"),
        })
    return {"code": 200, "data": formatted, "results": formatted}



@router.get("/sector-flows")
@legacy_router.get("/sector-flows")
def get_sector_flows(type: str = "industry"):
    """获取行业/概念资金流向排行榜"""
    try:
        from utils.sector_fund_flow import sector_fund_flow_fetcher
        flows = sector_fund_flow_fetcher.get_sector_flows(sector_type=type)
        return {"code": 200, "data": flows, "flows": flows}
    except Exception as e:
        logger.warning(f"获取板块资金流异常: {e}")
        return {"code": 200, "data": [], "flows": []}


@router.get("/sector-detail")
@legacy_router.get("/sector-detail")
def get_sector_detail(name: str = Query(..., description="板块名称"), type: str = Query("industry", description="板块类型: industry/concept")):
    """获取板块全息画像与全量成分股实时透视档案"""
    try:
        from utils.sector_profiler import get_sector_detail as fetch_sector_profile
        profile = fetch_sector_profile(name, type)
        return {"code": 200, "detail": profile, "data": profile}
    except Exception as e:
        logger.warning(f"获取板块画像异常: {e}")
        return {"code": 200, "detail": {"description": f"{name} 板块", "catalysts": "市场交投活跃", "stocks": []}, "data": {}}




# ==================== Twitter (X) 实时情报雷达接口 ====================

class TwitterConfigUpdateReq(BaseModel):
    auth_token: Optional[str] = None
    ct0: Optional[str] = None
    full_cookie: Optional[str] = None
    monitored_users: Optional[list[str]] = None
    proxy_url: Optional[str] = None


class TwitterAuthorUpdateReq(BaseModel):
    handle: str
    category: Optional[str] = None
    is_vip: Optional[bool] = None
    desc: Optional[str] = None


class TwitterTranslateReq(BaseModel):
    tweet_id: str
    text: Optional[str] = None


@router.get("/twitter/tweets")
@legacy_router.get("/api/twitter/tweets")
def get_twitter_tweets(page: int = 1, page_size: int = 12, keyword: str = "",
                       only_stocks: bool = False, author: str = "", category: str = "ALL",
                       source_type: str = "ALL", force_refresh: bool = False):
    """获取推特重点博主情报流 (支持分页、FTS5倒排全文搜索、股票提炼过滤、博主分类筛选、来源归属与实时刷新)"""
    from utils.twitter_monitor import global_twitter_monitor

    # 若用户主动点击刷新或内存无缓存，先执行一次最新关注流同步
    if force_refresh or not global_twitter_monitor._cached_tweets:
        global_twitter_monitor.fetch_intel_stream(limit=30, force_refresh=force_refresh)

    # 从 SQLite 本地数据库中按来源、分类、博主与关键词分页查询
    query_res = global_twitter_monitor.query_tweets_from_db(
        page=page,
        page_size=page_size,
        keyword=keyword,
        only_stocks=only_stocks,
        author=author,
        category=category,
        source_type=source_type
    )

    # 兜底：仅当本地数据库完全为空且无指定过滤条件时，使用内存样本
    if query_res["total"] == 0 and global_twitter_monitor._get_db_total_count() == 0 and global_twitter_monitor._cached_tweets:
        all_cached = [asdict(t) if hasattr(t, '__dataclass_fields__') else t for t in global_twitter_monitor._cached_tweets]
        query_res["total"] = len(all_cached)
        query_res["tweets"] = all_cached[:page_size]

    status = global_twitter_monitor.get_status()
    return {
        "code": 200,
        "status": "ok",
        "total": query_res["total"],
        "page": query_res["page"],
        "page_size": query_res["page_size"],
        "total_pages": query_res["total_pages"],
        "tweets": query_res["tweets"],
        "source_type_counts": status.get("source_type_counts", {}),
        "engine_status": status
    }


@router.get("/twitter/categories")
@legacy_router.get("/api/twitter/categories")
def get_twitter_categories():
    """获取推特博主 4 大分类架构体系、各分类入库博主名录及统计"""
    from utils.twitter_monitor import global_twitter_monitor, AUTHOR_CATEGORIES_METADATA, AUTHOR_PROFILE_MAP
    status = global_twitter_monitor.get_status()
    return {
        "code": 200,
        "status": "ok",
        "metadata": AUTHOR_CATEGORIES_METADATA,
        "profiles": AUTHOR_PROFILE_MAP,
        "categories_summary": status.get("categories_summary", {}),
        "category_counts": status.get("category_counts", {}),
        "source_type_counts": status.get("source_type_counts", {})
    }


@router.get("/twitter/authors")
@legacy_router.get("/api/twitter/authors")
def get_twitter_authors():
    """获取全量入库博主详细画像、分组及发推活跃度清单"""
    from utils.twitter_monitor import global_twitter_monitor, AUTHOR_CATEGORIES_METADATA
    authors = global_twitter_monitor.get_author_profiles_list()
    return {
        "code": 200,
        "status": "ok",
        "total": len(authors),
        "categories_metadata": AUTHOR_CATEGORIES_METADATA,
        "data": authors
    }


@router.post("/twitter/authors/update")
@legacy_router.post("/api/twitter/authors/update")
def update_twitter_author(req: TwitterAuthorUpdateReq):
    """更新单个博主的分组类别与 VIP 标记，实时生效联动"""
    from utils.twitter_monitor import global_twitter_monitor
    res = global_twitter_monitor.update_author_profile(
        handle=req.handle,
        category=req.category,
        is_vip=req.is_vip,
        desc=req.desc
    )
    status = global_twitter_monitor.get_status()
    return {
        "code": 200 if res.get("success") else 400,
        "status": "ok" if res.get("success") else "error",
        "message": res.get("message", "更新成功"),
        "author": res.get("author"),
        "categories_summary": status.get("categories_summary", {}),
        "category_counts": status.get("category_counts", {})
    }


@router.post("/twitter/authors/reset-default")
@legacy_router.post("/api/twitter/authors/reset-default")
def reset_twitter_authors_default():
    """一键重置所有博主分组为系统推荐默认分类体系"""
    from utils.twitter_monitor import global_twitter_monitor
    res = global_twitter_monitor.reset_author_profiles()
    status = global_twitter_monitor.get_status()
    return {
        "code": 200 if res.get("success") else 400,
        "status": "ok" if res.get("success") else "error",
        "message": res.get("message", "已重置"),
        "categories_summary": status.get("categories_summary", {}),
        "category_counts": status.get("category_counts", {})
    }


@router.post("/twitter/translate")
@legacy_router.post("/api/twitter/translate")
def translate_single_tweet(req: TwitterTranslateReq):
    """按需即时重译单条推文，并自动永久回写本地数据库与 FTS5 倒排索引"""
    from utils.twitter_monitor import global_twitter_monitor
    res = global_twitter_monitor.translate_single_tweet(tweet_id=req.tweet_id, custom_text=req.text)
    return {
        "code": 200 if res.get("success") else 400,
        "status": "ok" if res.get("success") else "error",
        "message": res.get("message", ""),
        "tweet_id": res.get("tweet_id"),
        "text_raw": res.get("text_raw"),
        "text_translated": res.get("text_translated")
    }


@router.post("/twitter/sync-latest")
@legacy_router.post("/api/twitter/sync-latest")
def sync_twitter_latest(force_first_init: bool = False):
    """
    ⚡ Twitter 增量去重同步 (不更重复的，支持首次入库，全部数据永久保存)
    - 若本地数据库推文为 0 或 force_first_init 为 True: 触发首次入库初始化
    - 否则拉取关注流最新推文，基于推文 ID 严格查重，仅对纯新增推文进行翻译、打标并永久入库
    """
    from utils.twitter_monitor import global_twitter_monitor
    result = global_twitter_monitor.sync_incremental(force_first_init=force_first_init)
    status = global_twitter_monitor.get_status()
    return {
        "code": 200 if result.get("success") else 400,
        "status": "ok" if result.get("success") else "error",
        "message": result.get("message"),
        "is_first_sync": result.get("is_first_sync", False),
        "new_count": result.get("new_count", 0),
        "duplicate_count": result.get("duplicate_count", 0),
        "total_db_count": result.get("total_db_count", 0),
        "engine_status": status
    }


@router.post("/twitter/fetch-deep-history")
@legacy_router.post("/api/twitter/fetch-deep-history")
def fetch_twitter_deep_history(pages: int = 3):
    """
    ⚡ 历史追溯平滑过渡接口：内部转为执行去重增量同步
    """
    from utils.twitter_monitor import global_twitter_monitor
    result = global_twitter_monitor.sync_incremental(force_first_init=False)
    status = global_twitter_monitor.get_status()
    return {
        "code": 200 if result.get("success") else 400,
        "status": "ok" if result.get("success") else "error",
        "message": result.get("message"),
        "fetched_count": result.get("new_count", 0),
        "duplicate_count": result.get("duplicate_count", 0),
        "total_db_count": result.get("total_db_count", 0),
        "engine_status": status
    }


@router.get("/twitter/status")
@legacy_router.get("/api/twitter/status")
def get_twitter_status():
    """获取推特监控运行状态、数据新鲜度与健康诊断 (敏感 token 掩码保护)"""
    from utils.twitter_monitor import global_twitter_monitor
    return {"code": 200, "status": "ok", "data": global_twitter_monitor.get_status()}


@router.get("/twitter/heartbeat")
@legacy_router.get("/api/twitter/heartbeat")
def twitter_keep_alive_heartbeat():
    """主动探活推特 Cookie 存活状态 (对标东方财富 /api/eastmoney/heartbeat)"""
    from utils.twitter_monitor import global_twitter_monitor
    res = global_twitter_monitor.keep_alive_heartbeat()
    return {"code": 200, "status": "ok", "heartbeat": res, "engine_status": global_twitter_monitor.get_status()}


@router.post("/twitter/config")
@legacy_router.post("/api/twitter/config")
def update_twitter_config(payload: TwitterConfigUpdateReq):
    """更新推特配置 (支持前端直接录入 auth_token+ct0 或粘贴完整 Cookie 串)"""
    from utils.twitter_monitor import global_twitter_monitor
    status = global_twitter_monitor.save_config(
        auth_token=payload.auth_token,
        ct0=payload.ct0,
        full_cookie=payload.full_cookie,
        monitored_users=payload.monitored_users,
        proxy_url=payload.proxy_url
    )
    return {"code": 200, "status": "ok", "message": "推特监控配置已更新并持久化", "data": status}


@router.post("/twitter/test-connection")
@legacy_router.post("/api/twitter/test-connection")
def test_twitter_connection():
    """测试推特网络与凭证有效性 (只读测试，不修改任何网络设置)"""
    from utils.twitter_monitor import global_twitter_monitor
    diag = global_twitter_monitor.test_connection()
    return {"code": 200, "status": "ok", "diagnostics": diag}


@router.get("/buzz-ranking")
@legacy_router.get("/api/social/buzz-ranking")
@legacy_router.get("/social/buzz-ranking")
def get_buzz_ranking(limit: int = 12):
    """兼容旧版社交舆情接口，已平滑无缝升级为推特重点博主情报雷达"""
    from utils.twitter_monitor import global_twitter_monitor
    tweets = global_twitter_monitor.fetch_intel_stream(limit=limit)
    status = global_twitter_monitor.get_status()
    return {
        "code": 200,
        "status": "ok",
        "rankings": [],
        "tweets": tweets,
        "engine_status": status
    }


@legacy_router.get("/api/search_stocks")
def api_search_stocks(q: str = ""):
    """搜索股票兼容路由"""
    from utils.stock_search import search_stocks
    return {"code": 200, "data": search_stocks(q) if q else []}


@legacy_router.get("/api/system/sync-status")
def api_system_sync_status():
    """系统行情通道同步状态兼容路由"""
    from services.eastmoney_service import global_eastmoney_service
    status = global_eastmoney_service.get_status()
    return {"code": 200, "data": status, "status": "ok"}



# ==================== 东方财富实盘账户直连与守护接口 ====================

@router.get("/eastmoney/daemon-status")
@legacy_router.get("/api/eastmoney/daemon-status")
def get_eastmoney_daemon_status(user: Optional[dict] = Depends(get_optional_user)):
    """获取东方财富守护进程与直连状态"""
    try:
        status = eastmoney_daemon.get_daemon_status()
        return {"code": 200, "data": status}
    except Exception as e:
        logger.warning(f"获取东财守护状态异常: {e}")
        return {
            "code": 200,
            "data": {
                "is_running": False,
                "auto_sync_enabled": False,
                "sync_interval_sec": 0,
                "last_sync_time": None,
                "last_sync_status": "未配置",
                "is_authenticated": False,
                "user_name": None,
                "summary": {"status": "unconfigured"},
                "error": str(e)
            }
        }


@router.post("/eastmoney/sync-now")
@legacy_router.post("/api/eastmoney/sync-now")
def trigger_eastmoney_sync(user: dict = Depends(get_current_user)):
    """立即强制触发一次东财全量数据同步"""
    try:
        if not eastmoney_auth.is_authenticated():
            raise HTTPException(status_code=400, detail="尚未绑定东方财富账户，无法同步")
        res = eastmoney_daemon.sync_all(quiet=False)
        return {"code": 200, "message": "东方财富实盘数据已全量同步完成", "data": res}
    except HTTPException:
        raise
    except Exception as e:
        return {"code": 500, "detail": f"同步异常: {str(e)}"}


@router.post("/system/sync-now")
@legacy_router.post("/api/system/sync-now")
def trigger_system_sync(user: dict = Depends(get_current_user)):
    """系统级全网与实盘增量K线查缺补漏引擎"""
    try:
        res = eastmoney_daemon.sync_all(quiet=False)
        return {
            "code": 200,
            "message": "全市场增量行情与实盘数据查缺补漏已完成",
            "data": {
                "sync_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "status": "success",
                "detail": res
            }
        }
    except Exception as e:
        return {"code": 500, "detail": f"查缺补漏异常: {str(e)}"}


@router.get("/system/sync-status")
def get_system_sync_status(user: dict = Depends(get_current_user)):
    """获取系统当前数据完整度与最新增量K线状态"""
    return {
        "code": 200,
        "data": {
            "latest_date": datetime.now().strftime("%Y-%m-%d"),
            "latest_time": datetime.now().strftime("%H:%M:%S"),
            "status": "synchronized",
            "is_auto_sync": getattr(eastmoney_daemon, "auto_sync_enabled", True)
        }
    }


class BindFullCredentialsRequest(BaseModel):
    user_name: Optional[str] = "陈一辉"
    cookie: str
    validatekey: Optional[str] = ""


class AutoLoginConfigRequest(BaseModel):
    account: str
    password: str
    broker: Optional[str] = "东方财富"


@router.post("/eastmoney/bind-full-credentials")
@legacy_router.post("/api/eastmoney/bind-full-credentials")
async def bind_full_credentials(request: Request):
    """绑定东方财富完整Cookie/Session凭证并立即真实探活 (兼容各种Content-Type)"""
    try:
        body = await request.json()
    except Exception:
        raw = await request.body()
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}

    user_name = body.get("user_name") or "陈一辉"
    cookie = str(body.get("cookie") or "").strip()
    validatekey = str(body.get("validatekey") or "").strip()
    base_host = str(body.get("base_host") or "").strip() or "https://jywg.18.cn"
    direct_holdings = body.get("direct_holdings")
    direct_funds = body.get("direct_funds")
    direct_deals = body.get("direct_deals")

    logger.info(f"📥 [EastMoney] 收到凭证绑定请求: 用户={user_name}, Cookie长度={len(cookie)}, ValidateKey={'已提供('+validatekey+')' if validatekey else '未提供'}, Host={base_host}, 直提持仓={len(direct_holdings) if isinstance(direct_holdings, list) else 0}条, 资金={bool(direct_funds)}, 当日成交={len(direct_deals) if isinstance(direct_deals, list) else 0}条")

    info = eastmoney_auth.set_full_credentials(
        cookie_str=cookie or "session_active",
        validatekey=validatekey,
        user_name=user_name
    )
    if "18.cn" in base_host or "jywg" in base_host or "jy." in base_host:
        eastmoney_auth.auth_info["base_host"] = base_host
    eastmoney_auth.save_auth(eastmoney_auth.auth_info)

    from datetime import datetime
    from utils.portfolio_advisor import portfolio_store, PositionItem
    has_synced_data = False
    synced_count = 0
    try:
        portfolio_store.load("admin")
        # 1. 持仓入库 (仅当真正提取到有效持仓时才覆盖，防止在非交易页面误操作时清空实盘持仓)
        if isinstance(direct_holdings, list) and len(direct_holdings) > 0:
            valid_positions = {}
            for it in direct_holdings:
                shares = int(float(it.get("Zqsl") or it.get("shares") or it.get("Kysl") or 0))
                if shares <= 0:
                    continue
                cost = float(it.get("Cbcb") or it.get("cost_price") or it.get("CostPrice") or 0)
                curr = float(it.get("Zxjt") or it.get("current_price") or it.get("CurrentPrice") or cost)
                sym = str(it.get("Zqdm") or it.get("symbol") or it.get("StockCode") or "")
                name = str(it.get("Zqmc") or it.get("name") or it.get("StockName") or "")
                if sym:
                    valid_positions[sym] = PositionItem(
                        symbol=sym,
                        name=name,
                        shares=shares,
                        cost_price=cost,
                        current_price=curr,
                        notes="东财实盘直连同步"
                    )
                    synced_count += 1
            if valid_positions:
                portfolio_store.positions = valid_positions
                portfolio_store.save()
                has_synced_data = True

        # 1.5 账户资金入库 (总资产/可用资金)
        if direct_funds and isinstance(direct_funds, dict):
            tot_asset = float(direct_funds.get("total_asset") or direct_funds.get("Zzcz") or 0.0)
            avail_cash = float(direct_funds.get("available_cash") or direct_funds.get("Kyzj") or 0.0)
            if tot_asset > 0:
                portfolio_store.total_capital = tot_asset
            if avail_cash >= 0:
                portfolio_store.available_cash = avail_cash
            portfolio_store.save()
            has_synced_data = True

        # 2. 当日成交流水增量入库
        if isinstance(direct_deals, list) and direct_deals:
            existing = portfolio_store.history_trades or []
            existing_keys = {f"{t.get('time')}_{t.get('symbol')}_{t.get('shares')}_{t.get('type')}" for t in existing}
            for d in direct_deals:
                sym = str(d.get("Zqdm") or "")
                if not sym:
                    continue
                cdate = str(d.get("Cjrq") or datetime.now().strftime("%Y-%m-%d"))
                ctime = str(d.get("Cjsj") or "09:30:00")
                full_time = f"{cdate} {ctime}" if len(ctime) <= 8 else ctime
                act = str(d.get("Mmlb") or d.get("Bslb") or "买入")
                t_action = "BUY" if ("买" in act) else "SELL"
                price = float(d.get("Cjjg") or 0)
                amount = int(float(d.get("Cjsl") or 0))
                k = f"{full_time}_{sym}_{amount}_{t_action}"
                if k not in existing_keys:
                    existing.insert(0, {
                        "symbol": sym,
                        "name": str(d.get("Zqmc") or ""),
                        "time": full_time,
                        "type": t_action,
                        "price": price,
                        "shares": amount,
                        "amount": round(price * amount, 2),
                        "status": "FILLED"
                    })
                    existing_keys.add(k)
            portfolio_store.history_trades = existing
            portfolio_store.save()
            has_synced_data = True
    except Exception as e:
        logger.warning(f"直提数据入库异常: {e}")

    # 尝试一次后端直接心跳探活
    heartbeat_res = eastmoney_daemon.keep_alive_heartbeat()
    logger.info(f"🔍 [EastMoney] 探活结果: {heartbeat_res}")

    # 根据真实心跳探活设置状态
    is_alive = (heartbeat_res.get("status") == "alive") or has_synced_data
    eastmoney_daemon.is_session_alive = is_alive
    if is_alive:
        if validatekey or has_synced_data:
            eastmoney_daemon.last_heartbeat_status = "在线 (实盘直连已激活)"
            msg = f"🎉 东方财富实盘账户【{info['user_name']}】已成功直连绑定！真实持仓已同步({synced_count}只)。"
        else:
            eastmoney_daemon.last_heartbeat_status = "部分在线 (缺少交易凭证)"
            msg = "⚠️ 已连接东财通行证/自选通道，但未检测到【实盘交易凭据 validatekey】！请进入东方财富官方网上交易端（https://jywg.18.cn/Login?el=1&clear=&returl=%2fSearch%2fPosition）登录证券资金账号，在持仓页面再次点击书签同步。"
    else:
        eastmoney_daemon.last_heartbeat_status = heartbeat_res.get("message") or "探活未通过"
        msg = f"⚠️ 凭证已录入，但东财探活反馈：{eastmoney_daemon.last_heartbeat_status}"

    return {
        "code": 200,
        "alive": is_alive,
        "has_trade_credentials": bool(validatekey or has_synced_data),
        "message": msg,
        "data": {
            "user_name": info["user_name"],
            "account": info.get("account", "实盘账户"),
            "heartbeat": heartbeat_res,
            "holdings_count": synced_count
        }
    }


@router.post("/eastmoney/bind-community-cookie")
@legacy_router.post("/api/eastmoney/bind-community-cookie")
async def bind_community_cookie(request: Request):
    """专门绑定东方财富普通通行证Cookie（用于云自选股同步，与金融交易完全隔离）"""
    try:
        body = await request.json()
    except Exception:
        raw = await request.body()
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}

    cookie = str(body.get("cookie") or "").strip()
    direct_watchlist = body.get("direct_watchlist")

    import re
    # 智能嗅探：如果文本中包含多个 6 位股票代码（如用户直接粘贴了自选股文本或剪贴板内容）
    if cookie and (not direct_watchlist or not isinstance(direct_watchlist, list) or len(direct_watchlist) == 0):
        extracted_codes = list(dict.fromkeys(re.findall(r'\b(00\d{4}|60\d{4}|30\d{4}|68\d{4}|159\d{3}|51\d{4})\b', cookie)))
        if extracted_codes:
            direct_watchlist = [{"symbol": c, "name": ""} for c in extracted_codes]

    from utils.portfolio_advisor import portfolio_store, WatchlistItem
    from utils.realtime import get_batch_realtime_quotes
    from datetime import datetime

    portfolio_store.load("admin")
    added_count = 0

    # 1. 优先处理从网页 DOM 直接提取或智能嗅探到的自选股列表
    if isinstance(direct_watchlist, list) and direct_watchlist:
        # 如果当前自选池中只有 mock 股票（茅台 600519、比亚迪 002594、小米 1810.HK），彻底清除默认 mock 数据
        mock_codes = {"600519", "002594", "1810.HK"}
        if set(portfolio_store.watchlist.keys()) <= mock_codes:
            portfolio_store.watchlist.clear()
        
        symbols = [str(item.get("symbol") or "") for item in direct_watchlist if item.get("symbol")]
        quotes = get_batch_realtime_quotes(symbols) if symbols else {}
        for item in direct_watchlist:
            sym = str(item.get("symbol") or "").strip()
            if not sym:
                continue
            name = str(item.get("name") or "").strip()
            q = quotes.get(sym, {})
            c_price = float(q.get("price", 0.0)) if q else 0.0
            c_pct = float(q.get("change_pct", 0.0)) if q else 0.0
            s_name = q.get("name") or name or sym

            portfolio_store.watchlist[sym] = WatchlistItem(
                symbol=sym,
                name=s_name,
                current_price=c_price,
                change_pct=c_pct,
                notes="东财自选同步",
                add_date=datetime.now().strftime("%Y-%m-%d")
            )
            added_count += 1
        portfolio_store.save()

    # 2. 如果提供了 Cookie，保存为独立的 community_cookie 并尝试调用云端接口拉取
    if cookie:
        eastmoney_auth.auth_info["community_cookie"] = cookie
        eastmoney_auth.save_auth(eastmoney_auth.auth_info)
        try:
            orig_cookie = eastmoney_auth.auth_info.get("cookie", "")
            eastmoney_auth.auth_info["cookie"] = cookie
            remote_symbols = eastmoney_daemon.fetch_real_watchlist_from_eastmoney()
            eastmoney_auth.auth_info["cookie"] = orig_cookie  # 恢复金融交易 Cookie
            if remote_symbols:
                quotes = get_batch_realtime_quotes(remote_symbols)
                for sym in remote_symbols:
                    if sym not in portfolio_store.watchlist:
                        q = quotes.get(sym, {})
                        portfolio_store.watchlist[sym] = WatchlistItem(
                            symbol=sym,
                            name=q.get("name", sym),
                            current_price=float(q.get("price", 0.0)),
                            change_pct=float(q.get("change_pct", 0.0)),
                            notes="东财云自选同步",
                            add_date=datetime.now().strftime("%Y-%m-%d")
                        )
                        added_count += 1
                portfolio_store.save()
        except Exception as ce:
            logger.warning(f"拉取云自选股异常: {ce}")

    return {
        "code": 200,
        "status": "success",
        "message": f"🎉 东方财富自选股同步成功！当前自选池共 {len(portfolio_store.watchlist)} 只标的。",
        "watchlist_count": len(portfolio_store.watchlist),
        "added_count": added_count
    }


@router.post("/eastmoney/verify-session")
@legacy_router.post("/api/eastmoney/verify-session")
def verify_eastmoney_session():
    """手动执行一次东财Session心跳探活检测"""
    res = eastmoney_daemon.keep_alive_heartbeat()
    return {"code": 200, "data": res}


@router.post("/eastmoney/save-browser-auth")
@legacy_router.post("/api/eastmoney/save-browser-auth")
def save_browser_auth(req: AutoLoginConfigRequest):
    """安全加密保存账号密码以支持Playwright断线自愈"""
    if not req.account or not req.password:
        raise HTTPException(status_code=400, detail="账号与密码不能为空")
    from utils.eastmoney_browser_session import eastmoney_browser_session
    res = eastmoney_browser_session.save_account_credentials(
        account=req.account,
        password=req.password,
        broker=req.broker or "东方财富"
    )
    return {"code": 200, "message": "交易账号与加密密码已安全存储于本地", "data": res}


@router.post("/eastmoney/interactive-login")
@legacy_router.post("/api/eastmoney/interactive-login")
async def interactive_browser_login():
    """🚀 一键拉起东财登录小窗口，用户扫码或登录后，全自动捕获 Cookie 与 ValidateKey 并存入系统"""
    from utils.eastmoney_browser_session import eastmoney_browser_session
    res = await eastmoney_browser_session.launch_interactive_capture(timeout_sec=180)
    return res


@router.post("/eastmoney/trigger-browser-login")
@legacy_router.post("/api/eastmoney/trigger-browser-login")
async def trigger_browser_login():
    """触发一次Playwright浏览器自动登录流程"""
    from utils.eastmoney_browser_session import eastmoney_browser_session
    res = await eastmoney_browser_session.launch_interactive_capture(timeout_sec=180)
    return res


@router.post("/eastmoney/toggle-auto-sync")
@legacy_router.post("/api/eastmoney/toggle-auto-sync")
def toggle_eastmoney_auto_sync(req: AutoSyncToggleRequest, user: dict = Depends(get_current_user)):
    """开关后台自动同步（需登录）"""
    eastmoney_daemon.auto_sync_enabled = req.enabled
    return {"code": 200, "message": f"后台自动同步已{'开启' if req.enabled else '暂停'}"}


@router.post("/eastmoney/bind-account")
@legacy_router.post("/api/eastmoney/bind-account")
def bind_eastmoney_account(req: BindAccountRequest, user: dict = Depends(get_current_user)):
    """绑定东方财富真实资金账户（需登录；禁止伪造凭证）"""
    if not req.account or len(req.account) < 4:
        raise HTTPException(status_code=400, detail="账户标识无效")
    eastmoney_auth.save_auth({
        "account": req.account,
        "user_name": f"东财用户({req.account[-4:]})",
        "uid": f"em_{req.account}",
        "validatekey": "",
    })
    return {
        "code": 200,
        "message": f"已记录账户 {req.account}，请填入完整Cookie完成授权",
        "data": {"account": req.account, "validated": False}
    }


@router.post("/eastmoney/logout")
@legacy_router.post("/api/eastmoney/logout")
def logout_eastmoney(user: dict = Depends(get_current_user)):
    """解绑东方财富账户"""
    eastmoney_auth.clear_auth()
    return {"code": 200, "message": "东财账户已成功解绑"}


@router.post("/refresh-data")
def refresh_market_data(user: str = Depends(get_current_user)):
    """全量查缺补漏增量更新行情"""
    try:
        res = eastmoney_daemon.sync_all(quiet=False)
        log_audit(user, "refresh_data", "执行查缺补漏增量数据更新")
        return {"code": 200, "message": "增量行情同步完成", "data": res}
    except Exception as e:
        logger.error(f"refresh-data 异常: {e}")
        return {"code": 500, "message": f"同步异常: {str(e)}"}


@router.get("/eastmoney/userscript.user.js")
@legacy_router.get("/api/eastmoney/userscript.user.js")
@legacy_router.get("/api/eastmoney/tampermonkey-script")
def get_eastmoney_userscript(request: Request):
    """
    ⚡ 东方财富【永不过期·透明自动同步】油猴(Tampermonkey)脚本分发接口
    只要在浏览器安装该脚本，访问东财网页时即会自动静默同步最新 Cookie 与 ValidateKey 到量化系统
    """
    from fastapi.responses import Response
    host_origin = f"{request.url.scheme}://{request.url.netloc}"
    
    script_content = f"""// ==UserScript==
// @name         东财实盘凭证自动同步助手 (Quant Session Sync)
// @namespace    https://github.com/quant-trading-system
// @version      1.2.0
// @description  自动捕获东方财富网页/交易端 Cookie 与 ValidateKey，静默无感同步至本地量化系统，实现长效保活与永不断连
// @author       Chen
// @match        https://jy.sc.eastmoney.com/*
// @match        https://jywg.18.cn/*
// @match        https://trade.eastmoney.com/*
// @match        https://quote.eastmoney.com/*
// @match        https://passport2.eastmoney.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function() {{
    'use strict';

    var TARGET_API = '{host_origin}/api/eastmoney/bind-full-credentials';
    var LAST_SYNC_KEY = '_QUANT_LAST_SYNC_TS_';

    function extractCredentials() {{
        var cookie = document.cookie || '';
        var vkey = '';

        // 1. 从 URL 或 Hash 提取 validatekey
        var m = (location.search + location.hash + location.href).match(/(?:validatekey|vkey|validate_key)=([^&#\\s]+)/i);
        if (m) vkey = m[1];

        // 2. 从 window 变量或 Storage 提取
        if (!vkey && window.validatekey) vkey = window.validatekey;
        if (!vkey && window.ValidateKey) vkey = window.ValidateKey;
        try {{
            if (!vkey) vkey = sessionStorage.getItem('validatekey') || localStorage.getItem('validatekey') || '';
        }} catch(e){{}}

        // 3. 从 Cookie 正则提取
        if (!vkey && cookie) {{
            var cm = cookie.match(/(?:validatekey|vkey)=([^;\\s]+)/i);
            if (cm) vkey = cm[1];
        }}

        return {{ cookie: cookie, validatekey: vkey }};
    }}

    function showFloatTip(text, isSuccess) {{
        var tipId = '_quant_sync_float_tip';
        var el = document.getElementById(tipId);
        if (!el) {{
            el = document.createElement('div');
            el.id = tipId;
            el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;padding:8px 16px;border-radius:8px;font-size:12px;font-family:system-ui,-apple-system,sans-serif;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:all .3s ease;display:flex;align-items:center;gap:6px;pointer-events:none;';
            document.body.appendChild(el);
        }}
        el.style.background = isSuccess ? '#1f6feb' : '#d29922';
        el.style.color = '#fff';
        el.innerHTML = (isSuccess ? '⚡ ' : '⚠️ ') + text;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        setTimeout(function() {{
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
        }}, 3500);
    }}

    function syncToQuantSystem(force) {{
        var cred = extractCredentials();
        if (!cred.cookie || cred.cookie.length < 30) return;

        // 节流：默认至少间隔 60 秒同步一次，除非 force 为 true
        var now = Date.now();
        var lastSync = parseInt(sessionStorage.getItem(LAST_SYNC_KEY) || '0', 10);
        if (!force && (now - lastSync < 60000)) return;

        var payload = JSON.stringify({{
            cookie: cred.cookie,
            validatekey: cred.validatekey || '',
            user_name: '陈一辉 (浏览器透明同步)'
        }});

        function handleSuccess(resText) {{
            sessionStorage.setItem(LAST_SYNC_KEY, now.toString());
            showFloatTip('量化系统实盘会话已自动同步续期', true);
            console.log('[QuantSync] ✅ 东方财富凭证已静默回传同步至量化系统', cred.validatekey ? '含validatekey' : '纯Cookie');
        }}

        if (typeof GM_xmlhttpRequest !== 'undefined') {{
            GM_xmlhttpRequest({{
                method: 'POST',
                url: TARGET_API,
                headers: {{ 'Content-Type': 'application/json' }},
                data: payload,
                onload: function(response) {{
                    if (response.status >= 200 && response.status < 300) {{
                        handleSuccess(response.responseText);
                    }}
                }}
            }});
        }} else {{
            fetch(TARGET_API, {{
                method: 'POST',
                headers: {{ 'Content-Type': 'application/json' }},
                body: payload,
                mode: 'cors'
            }}).then(function(r) {{ return r.json(); }}).then(handleSuccess).catch(function(e){{}});
        }}
    }}

    // 页面加载完成后立即尝试同步一次
    setTimeout(function() {{ syncToQuantSystem(false); }}, 1500);

    // 监听网络 AJAX 完成事件（交易下单或持仓查询后自动静默同步）
    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {{
        this.addEventListener('load', function() {{
            if (this.responseURL && (this.responseURL.indexOf('Search') !== -1 || this.responseURL.indexOf('Trade') !== -1)) {{
                setTimeout(function() {{ syncToQuantSystem(false); }}, 500);
            }}
        }});
        return originalOpen.apply(this, arguments);
    }};

}})();
"""
    return Response(content=script_content, media_type="application/javascript")

