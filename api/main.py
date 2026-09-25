#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FastAPI 主服务调度中枢 (FastAPI Main Hub)
职责：
1. 模块化装配全局子路由（认证、行情、持仓、回测、智能问答、知识库大典）；
2. 管理全局 WebSocket 实时行情与实盘交易推送通道；
3. 配置全局 CORS 跨域、HTTP 全局安全中间件与静态资源挂载；
4. 保持代码极简、高通透、符合阿里架构分层标准（单文件 < 200 行）。
"""

import os
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles

from api.websocket import manager as ws_manager, market_push_loop
from api.routers.auth_router import router as auth_router, audit_router
from api.routers.knowledge_router import router as knowledge_router
from api.routers.chat_router import router as chat_router
from api.routers.market_router import router as market_router, legacy_router as market_legacy_router
from api.routers.legacy_router import router as legacy_router
from api.routers.portfolio_router import router as portfolio_router
from api.routers.alpha_router import router as alpha_router
from api.routers.prediction_router import router as prediction_router

logger = logging.getLogger("MainHub")
TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent.parent / "static"


try:
    from review_workbench.pipeline.scheduler import review_scheduler
    from review_workbench.api.main import router as review_router
    HAS_REVIEW_WORKBENCH = True
except Exception as e:
    HAS_REVIEW_WORKBENCH = False
    review_scheduler = None
    review_router = None
    logger.warning(f"导入 review_workbench 模块异常: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理：启动行情广播、自动增量更新任务与 15:05 复盘调度器"""
    push_task = asyncio.create_task(market_push_loop())
    
    # 启动 15:05 每日盘后自动复盘调度器
    if HAS_REVIEW_WORKBENCH and review_scheduler:
        try:
            review_scheduler.start()
            logger.info("⏰ 交易复盘自动化调度器已成功并入主系统生命周期！")
        except Exception as se:
            logger.error(f"启动复盘调度器失败: {se}")

    # 异步延迟启动东方财富实盘同步守护线程 (解决 A-SYNC-001)
    def _start_em_daemon():
        try:
            from services.eastmoney_service import global_eastmoney_service
            global_eastmoney_service.start_sync_daemon()
            logger.info("🚀 东方财富实盘自动同步守护线程已成功并入主系统生命周期！")
        except Exception as ee:
            logger.warning(f"启动东财守护线程异常: {ee}")
    
    asyncio.get_event_loop().call_soon(_start_em_daemon)

    # 异步启动 Twitter/X 关注流自动增量监控守护线程 (保障推特情报实时在线)
    def _start_twitter_daemon():
        import threading, time
        def _twitter_loop():
            time.sleep(5) # 服务完全就绪后启动首轮抓取
            while True:
                try:
                    from utils.twitter_monitor import TwitterMonitorEngine
                    t_engine = TwitterMonitorEngine()
                    sync_res = t_engine.sync_incremental()
                    logger.info(f"🐦 [Twitter后台守护] 增量抓取完成: {sync_res.get('message', '')}")
                except Exception as te:
                    logger.debug(f"🐦 [Twitter后台守护] 轮询异常 (网络或代理暂不可用): {te}")
                time.sleep(180) # 每隔 3 分钟轮询一次关注流

        t_thread = threading.Thread(target=_twitter_loop, name="TwitterMonitorDaemon", daemon=True)
        t_thread.start()
        logger.info("🚀 Twitter/X 顶级操盘情报自动增量监控守护线程已成功启动！")

    asyncio.get_event_loop().call_soon(_start_twitter_daemon)

    yield

    # 极速优雅退出 (0.2s 超时防挂起)
    try:
        push_task.cancel()
    except Exception:
        pass


    try:
        from services.eastmoney_service import global_eastmoney_service
        global_eastmoney_service.stop_sync_daemon()
    except Exception:
        pass

    if HAS_REVIEW_WORKBENCH and review_scheduler:
        try:
            review_scheduler.stop()
        except Exception:
            pass

    try:
        await asyncio.wait_for(asyncio.shield(push_task), timeout=0.2)
    except (Exception, asyncio.CancelledError, BaseException):
        pass




# 1. 创建 FastAPI 主实例
app = FastAPI(
    title="VNPY 量化投研与实战交易平台",
    description="高通透暗黑交易终端 · 全栈模块化量化体系",
    version="3.0.0",
    lifespan=lifespan,
)

# 1.1 全局 CORS 跨域中间件 (规范合规与防 CSRF 跨域越权)
# 规约：allow_credentials=True 时禁止 allow_origins=["*"]。严格限定合法源与正则匹配。
from fastapi.middleware.cors import CORSMiddleware
cors_env_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
default_origins = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_env_origins or default_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://([a-zA-Z0-9-]+\.)*(eastmoney\.com|18\.cn)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cors_pna_and_cache_header(request: Request, call_next):
    # 支持 Chrome Private Network Access (PNA) 预检请求放行
    origin = request.headers.get("origin")
    if request.method == "OPTIONS":
        response = Response(status_code=200)
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        else:
            response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    if request.url.path.startswith("/static/") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# 1.2 全局异常拦截体系 (Global Exception Defense System)
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import traceback

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """处理标准 HTTP 异常 (如 404, 401, 403, 400)"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": exc.status_code,
            "message": exc.detail or "HTTP 请求异常",
            "detail": exc.detail,
            "path": request.url.path
        }
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理请求参数校验异常 (422)"""
    errors = exc.errors()
    first_err = errors[0]["msg"] if errors else "请求参数格式错误"
    return JSONResponse(
        status_code=422,
        content={
            "code": 422,
            "message": f"参数校验失败: {first_err}",
            "detail": str(errors),
            "path": request.url.path
        }
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """全局兜底拦截所有未处理未知异常 (500)，详细堆栈安全入库/入日志，对外返回标准脱敏响应，杜绝泄露内部 SQL 或绝对路径"""
    error_trace = traceback.format_exc()
    import uuid
    trace_id = uuid.uuid4().hex[:12]
    logger.error(f"🔥 [全局未捕获异常 TRACE-{trace_id}] 请求路径: {request.url.path} | 错误类型: {type(exc).__name__} | 错误详情: {str(exc)}\n{error_trace}")
    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": "系统处理异常，已记录审计日志，请稍后重试或联系管理员",
            "detail": "Internal Server Error",
            "trace_id": trace_id,
            "path": request.url.path
        }
    )


# 2. 安全模块化路由装配 (Fault-Tolerant Router Mounting)
# 采用故障隔离机制：任何单个子模块异常均记录警告并安全降级，绝不连带主系统宕机
def _safe_include_router(app_instance: FastAPI, router_module_path: str, router_var_name: str = "router"):
    try:
        import importlib
        mod = importlib.import_module(router_module_path)
        router_obj = getattr(mod, router_var_name, None)
        if router_obj:
            app_instance.include_router(router_obj)
            logger.info(f"✅ 子路由成功挂载: {router_module_path}")
        else:
            logger.warning(f"⚠️ 模块未找到路由对象 {router_var_name}: {router_module_path}")
    except Exception as e:
        logger.error(f"❌ 挂载子路由失败 (已安全隔离): {router_module_path} -> {e}")

_safe_include_router(app, "api.routers.auth_router", "router")
_safe_include_router(app, "api.routers.auth_router", "audit_router")
_safe_include_router(app, "api.routers.knowledge_router", "router")
_safe_include_router(app, "api.routers.chat_router", "router")
_safe_include_router(app, "api.routers.market_router", "router")
_safe_include_router(app, "api.routers.market_router", "legacy_router")
_safe_include_router(app, "api.routers.legacy_router", "router")
_safe_include_router(app, "api.routers.portfolio_router", "router")
_safe_include_router(app, "api.routers.alpha_router", "router")
_safe_include_router(app, "api.routers.prediction_router", "router")
_safe_include_router(app, "api.routers.backtest_router", "router")
_safe_include_router(app, "api.routers.paper_portfolio_router", "router")

if HAS_REVIEW_WORKBENCH and review_router:
    try:
        app.include_router(review_router)
        logger.info("✅ 交易复盘工作台路由已成功挂载至主服务！")
    except Exception as re_err:
        logger.error(f"❌ 挂载复盘工作台路由失败: {re_err}")


# 3. 系统健康检查探针 (Health Check Probe)
@app.get("/api/health")
async def health_check():
    """系统级健康检查与状态探针"""
    db_status = "ok"
    try:
        from api.routers.prediction_router import get_db
        with get_db() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception as de:
        db_status = f"error: {str(de)}"

    return {
        "status": "ok" if "error" not in db_status else "degraded",
        "database": db_status,
        "service": "quant-trading-system",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }



# 4. 挂载静态文件目录
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")



@app.get("/", response_class=HTMLResponse)
async def index_page():
    """三大系统主工作台聚合页面 (极速毫秒级动态拼装，确保模板修改实时生效)"""
    index_file = TEMPLATE_DIR / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h2>index.html 未找到</h2>", status_code=404)

    content = index_file.read_text(encoding="utf-8")
    modules_dir = TEMPLATE_DIR / "modules"
    if modules_dir.exists():
        for mod in modules_dir.glob("*.html"):
            tag = f"<!-- #include:{mod.name} -->"
            if tag in content:
                content = content.replace(tag, mod.read_text(encoding="utf-8"))

    return HTMLResponse(content)
