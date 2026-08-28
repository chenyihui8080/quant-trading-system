"""
节点降级管理与状态追踪器 (Degradation Manager)
职责：
1. 监控并记录流水线各节点的执行状态与耗时
2. 当外部接口或算法节点异常时，自动触发兜底降级方案并向复盘组长汇报 degraded_nodes
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

logger = logging.getLogger("DegradationManager")


@dataclass
class DegradationEvent:
    """降级事件记录"""
    node_name: str
    error_message: str
    timestamp: str
    fallback_applied: str


class DegradationTracker:
    """降级追踪器"""

    def __init__(self):
        self.degraded_nodes: list[str] = []
        self.events: list[DegradationEvent] = []

    def reset(self):
        """重置状态"""
        self.degraded_nodes.clear()
        self.events.clear()

    def record_degradation(self, node_name: str, error: Exception, fallback_desc: str):
        """记录一次节点降级"""
        err_msg = str(error)
        logger.warning(f"⚠️ [降级告警] 节点 [{node_name}] 异常降级: {err_msg} | 兜底方案: {fallback_desc}")
        if node_name not in self.degraded_nodes:
            self.degraded_nodes.append(node_name)
        
        event = DegradationEvent(
            node_name=node_name,
            error_message=err_msg,
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            fallback_applied=fallback_desc
        )
        self.events.append(event)

    def get_degraded_nodes(self) -> list[str]:
        """获取当前降级节点列表"""
        return list(self.degraded_nodes)


# 全局单例
degradation_tracker = DegradationTracker()
