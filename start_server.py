#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高可用生产级主服务保活启动器 (High-Availability System Supervisor)
职责：
1. 启动 FastAPI 主服务；
2. 捕获任何未预料的退出信号并自动自愈重启；
3. 输出结构化日志并提供守护保活。
"""

import sys
import time
import logging
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("server.log", encoding="utf-8")
    ]
)
logger = logging.getLogger("Supervisor")

def run():
    logger.info("🚀 [Supervisor] 正在启动 VNPY 量化高可用中枢服务 (0.0.0.0:8000)...")
    config = uvicorn.Config(
        app="api.main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True,
        loop="asyncio",
        timeout_keep_alive=65
    )
    server = uvicorn.Server(config)
    try:
        server.run()
    except Exception as e:
        logger.error(f"🔥 主服务运行发生异常: {e}", exc_info=True)
        time.sleep(1)

if __name__ == "__main__":
    while True:
        try:
            run()
        except KeyboardInterrupt:
            logger.info("🛑 收到终止信号，正常退出服务。")
            break
        except Exception as ex:
            logger.error(f"🚨 服务崩溃，0.5秒后自动自愈拉起: {ex}")
            time.sleep(0.5)
