"""
东方财富账户同步业务服务层 (Service)
解决 A-SYNC-001: 守护线程生命周期管理与健康状态检测
"""
from typing import Dict, Any
from utils.eastmoney_daemon import (
    EastMoneyAuthManager, EastMoneySyncDaemon,
    eastmoney_auth as _auth_mgr, eastmoney_daemon as _sync_daemon
)


class EastMoneyService:
    """东方财富实盘同步业务服务"""

    def __init__(self):
        self.auth_manager: EastMoneyAuthManager = _auth_mgr
        self.daemon: EastMoneySyncDaemon = _sync_daemon

    def start_sync_daemon(self):
        """启动后台同步守护线程 (应用启动时调用)"""
        if not self.daemon.running:
            self.daemon.start()

    def stop_sync_daemon(self):
        """停止守护线程"""
        if self.daemon.running:
            self.daemon.stop()

    def get_status(self) -> Dict[str, Any]:
        """获取东财守护线程当前运行状态"""
        if hasattr(self.daemon, "get_daemon_status"):
            return self.daemon.get_daemon_status()
        return {}


# 全局单例服务
global_eastmoney_service = EastMoneyService()
