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
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
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

# 1.1 全局 CORS 跨域中间件（文档声明的能力必须真正落地，否则跨域前端/工具会因预检被拦截失败）
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cors_pna_and_cache_header(request: Request, call_next):
    # 支持 Chrome Private Network Access (PNA) 预检请求放行
    if request.method == "OPTIONS":
        response = Response(status_code=200)
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
    """全局兜底拦截所有未处理未知异常 (500)，记录堆栈并返回标准友好响应，确保主服务永不宕机"""
    error_trace = traceback.format_exc()
    logger.error(f"🔥 [全局未捕获异常] 请求路径: {request.url.path} | 错误类型: {type(exc).__name__} | 错误详情: {str(exc)}\n{error_trace}")
    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": f"系统处理异常: {str(exc)}",
            "detail": str(exc),
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

# 3.1 油猴脚本分发路由 (Tampermonkey Userscript Direct Endpoint)
from fastapi.responses import FileResponse, Response

@app.get("/api/eastmoney/userscript.user.js")
@app.get("/eastmoney.user.js")
@app.get("/api/eastmoney/tampermonkey-script")
async def serve_eastmoney_userscript(request: Request):
    """直接下发东方财富自动同步油猴脚本"""
    userscript_path = STATIC_DIR / "userscript.user.js"
    if userscript_path.exists():
        content = userscript_path.read_text(encoding="utf-8")
        # 动态替换 API host 为当前请求的 scheme 和 host
        host_origin = f"{request.url.scheme}://{request.url.netloc}"
        content = content.replace("http://localhost:8000", host_origin)
        return Response(content=content, media_type="application/javascript", headers={
            "Content-Disposition": "inline; filename=eastmoney.user.js",
            "Cache-Control": "no-cache"
        })
    return Response(content="// Userscript not found", media_type="application/javascript", status_code=404)

# 4. 挂载静态文件目录
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 5. 公开免认证路径集合
PUBLIC_PATHS = {
    "/", "/docs", "/openapi.json",
    "/redoc", "/docs/oauth2-redirect", "/api/health",
    "/api/eastmoney/userscript.user.js", "/eastmoney.user.js", "/static/userscript.user.js",
    "/api/eastmoney/tampermonkey-script"
}



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
