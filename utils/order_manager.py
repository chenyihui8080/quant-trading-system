"""订单管理：状态机 + 订单生命周期"""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4


class OrderStatus(str, Enum):
    """订单状态（参照 docx PRD）"""
    PENDING = "PENDING"            # 待提交（风控通过）
    SUBMITTED = "SUBMITTED"        # 已提交到 Broker
    PARTIAL_FILLED = "PARTIAL_FILLED"  # 部分成交
    FILLED = "FILLED"              # 全部成交（终态）
    CANCELLED = "CANCELLED"        # 已撤单（终态）
    REJECTED = "REJECTED"          # 被拒绝（终态）
    ERROR = "ERROR"                # 系统错误（终态）


# 合法的状态转换
_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.PENDING:       {OrderStatus.SUBMITTED, OrderStatus.REJECTED, OrderStatus.CANCELLED},
    OrderStatus.SUBMITTED:     {OrderStatus.PARTIAL_FILLED, OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.ERROR},
    OrderStatus.PARTIAL_FILLED:{OrderStatus.PARTIAL_FILLED, OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.ERROR},
}


class InvalidTransition(Exception):
    pass


class Direction(str, Enum):
    LONG = "long"
    SHORT = "short"


class Offset(str, Enum):
    OPEN = "open"
    CLOSE = "close"


@dataclass
class Order:
    """订单"""
    order_id: str = field(default_factory=lambda: uuid4().hex[:12])
    strategy_name: str = ""
    symbol: str = ""
    direction: Direction = Direction.LONG
    offset: Offset = Offset.OPEN
    price: float = 0.0
    volume: int = 0
    filled_volume: int = 0
    avg_price: float = 0.0
    status: OrderStatus = OrderStatus.PENDING
    created_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    updated_at: str = ""
    broker_order_id: str = ""
    reason: str = ""      # 拒绝/错误原因
    trades: list = field(default_factory=list)  # 成交记录

    def to_dict(self) -> dict:
        return {
            "order_id": self.order_id,
            "strategy": self.strategy_name,
            "symbol": self.symbol,
            "direction": self.direction.value,
            "offset": self.offset.value,
            "price": self.price,
            "volume": self.volume,
            "filled_volume": self.filled_volume,
            "avg_price": self.avg_price,
            "status": self.status.value,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "broker_order_id": self.broker_order_id,
            "reason": self.reason,
            "trades_count": len(self.trades),
        }


class OrderManager:
    """订单管理器：状态机 + 订单生命周期"""

    def __init__(self):
        self.orders: dict[str, Order] = {}
        self._history: list[Order] = []

    def create_order(
        self,
        strategy_name: str,
        symbol: str,
        direction: Direction,
        offset: Offset,
        price: float,
        volume: int,
    ) -> Order:
        """创建订单（初始状态 PENDING）"""
        order = Order(
            strategy_name=strategy_name,
            symbol=symbol,
            direction=direction,
            offset=offset,
            price=price,
            volume=volume,
        )
        self.orders[order.order_id] = order
        return order

    def submit(self, order_id: str, broker_order_id: str = "") -> Order:
        """提交订单到 Broker"""
        order = self._get_order(order_id)
        self._transition(order, OrderStatus.SUBMITTED)
        order.broker_order_id = broker_order_id
        order.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return order

    def on_trade(self, order_id: str, trade_price: float, trade_volume: int) -> Order:
        """成交回报"""
        order = self._get_order(order_id)
        order.trades.append({
            "price": trade_price,
            "volume": trade_volume,
            "time": datetime.now().isoformat(),
        })

        # 更新成交量和均价
        total_cost = order.avg_price * order.filled_volume + trade_price * trade_volume
        order.filled_volume += trade_volume
        order.avg_price = round(total_cost / order.filled_volume, 2) if order.filled_volume > 0 else 0

        if order.filled_volume >= order.volume:
            self._transition(order, OrderStatus.FILLED)
        else:
            self._transition(order, OrderStatus.PARTIAL_FILLED)

        order.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return order

    def cancel(self, order_id: str, reason: str = "") -> Order:
        """撤单"""
        order = self._get_order(order_id)
        self._transition(order, OrderStatus.CANCELLED)
        order.reason = reason
        order.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._archive(order)
        return order

    def reject(self, order_id: str, reason: str = "") -> Order:
        """拒绝订单（风控拒绝或 Broker 拒单）"""
        order = self._get_order(order_id)
        self._transition(order, OrderStatus.REJECTED)
        order.reason = reason
        order.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._archive(order)
        return order

    def error(self, order_id: str, reason: str = "") -> Order:
        """系统错误"""
        order = self._get_order(order_id)
        self._transition(order, OrderStatus.ERROR)
        order.reason = reason
        order.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._archive(order)
        return order

    def get_order(self, order_id: str) -> Optional[dict]:
        """查询订单"""
        order = self.orders.get(order_id)
        return order.to_dict() if order else None

    def get_active_orders(self, strategy_name: str = "", symbol: str = "") -> list[dict]:
        """查询活跃订单（非终态）"""
        terminal = {OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.ERROR}
        result = []
        for order in self.orders.values():
            if order.status in terminal:
                continue
            if strategy_name and order.strategy_name != strategy_name:
                continue
            if symbol and order.symbol != symbol:
                continue
            result.append(order.to_dict())
        return result

    def get_history(
        self,
        strategy_name: str = "",
        symbol: str = "",
        status: Optional[OrderStatus] = None,
        limit: int = 100,
    ) -> list[dict]:
        """查询历史订单"""
        result = self._history
        if strategy_name:
            result = [o for o in result if o.strategy_name == strategy_name]
        if symbol:
            result = [o for o in result if o.symbol == symbol]
        if status:
            result = [o for o in result if o.status == status]
        return [o.to_dict() for o in result[-limit:]]

    def get_stats(self) -> dict:
        """订单统计"""
        all_orders = list(self.orders.values()) + self._history
        total = len(all_orders)
        filled = sum(1 for o in all_orders if o.status == OrderStatus.FILLED)
        cancelled = sum(1 for o in all_orders if o.status == OrderStatus.CANCELLED)
        rejected = sum(1 for o in all_orders if o.status == OrderStatus.REJECTED)
        active = sum(1 for o in self.orders.values()
                     if o.status not in {OrderStatus.FILLED, OrderStatus.CANCELLED,
                                         OrderStatus.REJECTED, OrderStatus.ERROR})
        return {
            "total": total,
            "filled": filled,
            "cancelled": cancelled,
            "rejected": rejected,
            "active": active,
        }

    def _get_order(self, order_id: str) -> Order:
        if order_id not in self.orders:
            raise KeyError(f"订单 {order_id} 不存在")
        return self.orders[order_id]

    def _transition(self, order: Order, new_status: OrderStatus):
        """执行状态转换（校验合法性）"""
        allowed = _TRANSITIONS.get(order.status, set())
        if new_status not in allowed:
            raise InvalidTransition(
                f"非法状态转换: {order.status.value} → {new_status.value}"
            )
        order.status = new_status

    def _archive(self, order: Order):
        """终态订单移入历史"""
        self._history.append(order)
        del self.orders[order.order_id]


# 全局订单管理器实例
order_manager = OrderManager()
