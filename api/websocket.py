"""WebSocket 连接管理 + 实时推送"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        # topic -> set[WebSocket]
        self.subscriptions: dict[str, set[WebSocket]] = {}
        self.active_connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.add(ws)
        logger.info(f"WebSocket 已连接，当前 {len(self.active_connections)} 个连接")

    def disconnect(self, ws: WebSocket):
        self.active_connections.discard(ws)
        for topic_subs in self.subscriptions.values():
            topic_subs.discard(ws)
        logger.info(f"WebSocket 已断开，当前 {len(self.active_connections)} 个连接")

    def subscribe(self, ws: WebSocket, topic: str):
        """订阅主题"""
        if topic not in self.subscriptions:
            self.subscriptions[topic] = set()
        self.subscriptions[topic].add(ws)

    def unsubscribe(self, ws: WebSocket, topic: str):
        """取消订阅"""
        if topic in self.subscriptions:
            self.subscriptions[topic].discard(ws)

    async def broadcast(self, topic: str, data: dict):
        """向订阅了指定主题的所有客户端广播消息"""
        message = json.dumps({
            "topic": topic,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }, ensure_ascii=False, default=str)

        subscribers = self.subscriptions.get(topic, set()).copy()
        disconnected = set()

        for ws in subscribers:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.add(ws)

        # 清理断开的连接
        for ws in disconnected:
            self.disconnect(ws)

    async def send_personal(self, ws: WebSocket, topic: str, data: dict):
        """向单个客户端发送消息"""
        message = json.dumps({
            "topic": topic,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }, ensure_ascii=False, default=str)
        try:
            await ws.send_text(message)
        except Exception:
            self.disconnect(ws)

    def get_subscribers_count(self, topic: str) -> int:
        return len(self.subscriptions.get(topic, set()))

    def get_status(self) -> dict:
        return {
            "total_connections": len(self.active_connections),
            "topics": {
                topic: len(subs)
                for topic, subs in self.subscriptions.items()
                if subs
            },
        }


# 全局实例
manager = ConnectionManager()


# ==================== 行情推送任务 ====================

async def market_push_loop():
    """后台任务：定期推送行情数据（每 30 秒）"""
    from utils.realtime import get_realtime_quote
    # 等待服务器启动
    await asyncio.sleep(3)

    while True:
        try:
            # 收集所有订阅了 market.* 的主题
            topics = list(manager.subscriptions.keys())
            market_topics = [t for t in topics if t.startswith("market.")]

            for topic in market_topics:
                symbol = topic.split(".")[-1]
                if manager.get_subscribers_count(topic) == 0:
                    continue

                try:
                    # 严禁在 async 协程中直接同步阻塞调用网络 IO，通过 asyncio.to_thread 卸载至后台线程
                    quote = await asyncio.to_thread(get_realtime_quote, symbol)
                    if quote:
                        await manager.broadcast(topic, quote)
                except Exception as e:
                    logger.warning(f"推送 {symbol} 行情失败: {e}")

        except Exception as e:
            logger.error(f"行情推送循环异常: {e}")

        await asyncio.sleep(30)  # 每 30 秒推送一次


async def risk_alert_loop():
    """后台任务：定期检查并推送风控告警"""
    await asyncio.sleep(5)

    while True:
        try:
            if manager.get_subscribers_count("risk.alert") > 0:
                # 此处可对接实际的风控检查逻辑
                # 目前仅在有订阅者时保持心跳
                pass
        except Exception as e:
            logger.error(f"风控告警推送异常: {e}")

        await asyncio.sleep(10)
