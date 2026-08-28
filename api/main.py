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
from api.routers.auth_router import router as auth_router
from api.routers.knowledge_router import router as knowledge_router
from api.routers.chat_router import router as chat_router
from api.routers.market_router import router as market_router
from api.routers.portfolio_router import router as portfolio_router
from api.routers.backtest_router import router as backtest_router
from api.routers.alpha_router import router as alpha_router

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

    yield

    # 优雅退出
    push_task.cancel()
    if HAS_REVIEW_WORKBENCH and review_scheduler:
        try:
            review_scheduler.stop()
        except Exception:
            pass

    try:
        await push_task
    except asyncio.CancelledError:
        pass


# 1. 创建 FastAPI 主实例
app = FastAPI(
    title="VNPY 量化投研与实战交易平台",
    description="高通透暗黑交易终端 · 全栈模块化量化体系",
    version="3.0.0",
    lifespan=lifespan,
)

# 2. 挂载全部模块化领域子路由
app.include_router(auth_router)
app.include_router(knowledge_router)
app.include_router(chat_router)
app.include_router(market_router)
app.include_router(portfolio_router)
app.include_router(backtest_router)
app.include_router(alpha_router)

# 挂载复盘工作台全量智能体中枢路由 (彻底消除 AttributeError)
if HAS_REVIEW_WORKBENCH and review_router:
    app.include_router(review_router)
    logger.info("✅ 交易复盘工作台路由已成功挂载至主服务！")




# 3. 挂载静态文件目录
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 4. 公开免认证路径集合
PUBLIC_PATHS = {
    "/", "/auth/register", "/auth/login", "/docs", "/openapi.json",
    "/redoc", "/docs/oauth2-redirect", "/api/knowledge-base/stats",
    "/api/market/sector-flows", "/api/social/buzz-ranking", "/api/eastmoney/daemon-status"
}



@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """全局认证中间件：公开路径外的所有请求必须携带有效 Token"""
    path = request.url.path

    # 公开路径、WebSocket、复盘工作台、Alpha买卖决策、系统同步与股票搜索放行
    if (
        path in PUBLIC_PATHS
        or path.startswith("/ws")
        or path.startswith("/api/knowledge-base")
        or path.startswith("/api/review")
        or path.startswith("/api/alpha")
        or path.startswith("/api/system")
        or path.startswith("/api/search_stocks")
        or path.startswith("/stocks/search")
    ):
        return await call_next(request)




    # 静态资源放行
    if path.endswith((".js", ".css", ".ico", ".png", ".jpg", ".svg", ".woff2")):
        return await call_next(request)

    # 检查 Authorization 头
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return HTMLResponse(
            content='{"detail":"未登录，请先调用 /auth/login 获取 Token"}',
            status_code=401,
            media_type="application/json",
        )

    return await call_next(request)


@app.get("/", response_class=HTMLResponse)
def index_page():
    """三大系统主工作台聚合页面 (支持模板动态拼装)"""
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
