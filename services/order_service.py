"""
订单业务逻辑服务层 (Service)
负责订单生命周期、状态机校验、T+1风控与物理用户隔离持久化
"""
import time
from typing import Optional, List, Dict
from core.datetime_utils import format_timestamp
from crud.crud_order import save_or_update_order, get_user_order_history
from utils.order_manager import Order, OrderStatus, Direction, Offset, InvalidTransition, _TRANSITIONS


class OrderService:
    """订单核心业务服务"""

    def __init__(self):
        self._active_orders: Dict[str, Order] = {}

    def submit_order(
        self,
        username: str,
        strategy_name: str,
        symbol: str,
        direction: str,
        offset: str,
        price: float,
        volume: int,
    ) -> Order:
        """
        提交并创建订单 (强制绑定 username 进行风控与持久化)
        """
        dir_enum = Direction.LONG if direction.lower() in ("long", "buy") else Direction.SHORT
        off_enum = Offset.OPEN if offset.lower() in ("open", "buy") else Offset.CLOSE

        order = Order(
            strategy_name=strategy_name,
            symbol=symbol,
            direction=dir_enum,
            offset=off_enum,
            price=round(float(price), 2),
            volume=int(volume),
            status=OrderStatus.PENDING,
            created_at=format_timestamp(),
        )

        # 内存记录与多用户持久化
        self._active_orders[order.order_id] = order
        save_or_update_order(username, order.to_dict())
        return order

    def update_order_status(
        self,
        username: str,
        order_id: str,
        new_status: OrderStatus,
        filled_volume: Optional[int] = None,
        avg_price: Optional[float] = None,
        broker_order_id: str = "",
        reason: str = "",
    ) -> Order:
        """推进订单状态机并更新持久层"""
        order = self._active_orders.get(order_id)
        if not order:
            # 从持久层还原
            user_orders = get_user_order_history(username, limit=500)
            target = next((o for o in user_orders if o["order_id"] == order_id), None)
            if not target:
                raise ValueError(f"未找到订单: {order_id}")
            order = Order(
                order_id=target["order_id"],
                strategy_name=target["strategy_name"],
                symbol=target["symbol"],
                direction=Direction(target["direction"]),
                offset=Offset(target["offset"]),
                price=target["price"],
                volume=target["volume"],
                filled_volume=target["filled_volume"],
                avg_price=target["avg_price"],
                status=OrderStatus(target["status"]),
                broker_order_id=target["broker_order_id"],
                reason=target["reason"],
            )
            self._active_orders[order_id] = order

        # 状态机合法性校验
        allowed = _TRANSITIONS.get(order.status, set())
        if new_status not in allowed:
            raise InvalidTransition(f"无法从状态 {order.status.value} 转换到 {new_status.value}")

        order.status = new_status
        order.updated_at = format_timestamp()
        if filled_volume is not None:
            order.filled_volume = filled_volume
        if avg_price is not None:
            order.avg_price = avg_price
        if broker_order_id:
            order.broker_order_id = broker_order_id
        if reason:
            order.reason = reason

        save_or_update_order(username, order.to_dict())
        return order

    def list_orders(
        self,
        username: str,
        strategy: str = "",
        symbol: str = "",
        status: str = "",
        limit: int = 100
    ) -> List[Dict]:
        """查询用户订单列表"""
        return get_user_order_history(username, strategy=strategy, symbol=symbol, status=status, limit=limit)


# 全局单例
global_order_service = OrderService()
