#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高可用生产级主服务保活守护启动器 (High-Availability System Supervisor)
核心功能：
1. 忽略 SIGHUP 信号，防止终端断开或 IDE 重启时连带杀进程；
2. 启动前自动检查并释放 8000 端口旧残留，防止端口占用冲突；
3. 输出带轮转备份的持久化日志 (logs/server.log) 与崩溃堆栈跟踪 (logs/crash.log)；
4. 遭遇任何未捕获异常时，0.5秒内自动自愈重启，保证服务永续在线。
"""

import os
import sys
import time
import signal
import logging
import traceback
import subprocess
from pathlib import Path
from logging.handlers import RotatingFileHandler

import uvicorn

# 确保 logs 目录存在
PROJECT_DIR = Path(__file__).parent.resolve()
LOGS_DIR = PROJECT_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

SERVER_LOG_FILE = LOGS_DIR / "server.log"
CRASH_LOG_FILE = LOGS_DIR / "crash.log"

# 配置日志记录器
file_handler = RotatingFileHandler(
    SERVER_LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
console_handler = logging.StreamHandler(sys.stdout)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[file_handler, console_handler]
)
logger = logging.getLogger("Supervisor")


def release_port(port: int = 8000):
    """自动清理端口上的旧进程，防止端口被占用导致死锁"""
    try:
        cmd = f"lsof -ti :{port}"
        out = subprocess.check_output(cmd, shell=True).decode().strip()
        current_pid = os.getpid()
        if out:
            pids = out.split("\n")
            for pid_str in pids:
                pid = int(pid_str.strip())
                if pid != current_pid:
                    logger.info(f"🔄 检测到端口 {port} 被旧进程 (PID: {pid}) 占用，正在安全释放...")
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except Exception:
                        pass
            time.sleep(0.5)
    except Exception:
        pass


def run():
    """启动 uvicorn 核心服务"""
    release_port(8000)
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
        err_detail = traceback.format_exc()
        logger.error(f"🔥 主服务运行发生异常: {e}\n{err_detail}")
        with open(CRASH_LOG_FILE, "a", encoding="utf-8") as cf:
            cf.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] 服务异常退出:\n{err_detail}\n")
        time.sleep(1)


if __name__ == "__main__":
    # 忽略 SIGHUP 信号，防止挂起/休眠唤醒时连带杀死
    if hasattr(signal, "SIGHUP"):
        try:
            signal.signal(signal.SIGHUP, signal.SIG_IGN)
        except Exception:
            pass

    logger.info("🛡️ [Supervisor] 高可用守护引擎启动，守护 PID: %d", os.getpid())
    while True:
        try:
            run()
        except KeyboardInterrupt:
            logger.info("🛑 收到用户键盘中断信号，正常退出服务。")
            break
        except Exception as ex:
            err_str = traceback.format_exc()
            logger.error(f"🚨 服务崩溃，0.5秒后自动自愈拉起: {ex}\n{err_str}")
            with open(CRASH_LOG_FILE, "a", encoding="utf-8") as cf:
                cf.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] 崩溃重启记录:\n{err_str}\n")
            time.sleep(0.5)
