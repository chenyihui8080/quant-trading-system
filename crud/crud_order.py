"""
订单表数据访问层 (CRUD / DAO)
严格执行阿里规范与多用户强物理隔离 (解决 A-ORDER-001)
"""
from typing import Optional, List, Dict
from core.database import get_db
from core.datetime_utils import format_timestamp


def save_or_update_order(username: str, order_dict: dict) -> None:
    """
    保存或更新订单记录 (强制绑定当前用户名，禁止跨用户覆盖)
    :param username: 当前登录用户
    :param order_dict: 订单字段字典
    """
    with get_db() as db:
        now_str = format_timestamp()
        order_id = order_dict["order_id"]
        
        # 1. 尝试按 (order_id, username) 针对性更新
        values = (
            order_dict.get("strategy_name") or order_dict.get("strategy", ""),
            order_dict["symbol"],
            order_dict["direction"],
            order_dict.get("offset", "OPEN"),
            float(order_dict["price"]),
            int(order_dict["volume"]),
            int(order_dict.get("filled_volume", 0)),
            float(order_dict.get("avg_price", 0.0)),
            order_dict["status"],
            order_dict.get("broker_order_id", ""),
            order_dict.get("reason", ""),
            now_str,
            order_id,
            username,
        )
        
        cursor = db.execute("""
            UPDATE order_records SET
                strategy_name = ?, symbol = ?, direction = ?, offset = ?, price = ?, volume = ?,
                filled_volume = ?, avg_price = ?, status = ?, broker_order_id = ?, reason = ?, updated_at = ?
            WHERE order_id = ? AND username = ?
        """, values)
        
        # 2. 若不存在则安全插入并显式打上 username
        if cursor.rowcount == 0:
            create_time = order_dict.get("created_at") or now_str
            db.execute("""
                INSERT INTO order_records (
                    order_id, username, strategy_name, symbol, direction, offset, price, volume,
                    filled_volume, avg_price, status, broker_order_id, reason, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                order_id,
                username,
                order_dict.get("strategy_name") or order_dict.get("strategy", ""),
                order_dict["symbol"],
                order_dict["direction"],
                order_dict.get("offset", "OPEN"),
                float(order_dict["price"]),
                int(order_dict["volume"]),
                int(order_dict.get("filled_volume", 0)),
                float(order_dict.get("avg_price", 0.0)),
                order_dict["status"],
                order_dict.get("broker_order_id", ""),
                order_dict.get("reason", ""),
                create_time,
                now_str,
            ))


def get_user_order_history(
    username: str,
    strategy: str = "",
    symbol: str = "",
    status: str = "",
    limit: int = 100
) -> List[Dict]:
    """
    获取指定用户的订单历史 (禁止 SELECT *，强制 username 过滤)
    :param username: 当前登录用户
    :param strategy: 策略名称过滤
    :param symbol: 标的代码过滤
    :param status: 订单状态过滤
    :param limit: 最大查询记录数
    """
    conditions = ["username = ?"]
    params = [username]
    
    if strategy:
        conditions.append("strategy_name = ?")
        params.append(strategy)
    if symbol:
        conditions.append("symbol = ?")
        params.append(symbol)
    if status:
        conditions.append("status = ?")
        params.append(status)

    where_clause = "WHERE " + " AND ".join(conditions)
    params.append(limit)

    with get_db() as db:
        # 严格指定字段列表，严禁 SELECT *
        rows = db.execute(f"""
            SELECT id, order_id, username, strategy_name, symbol, direction, offset,
                   price, volume, filled_volume, avg_price, status, broker_order_id,
                   reason, created_at, updated_at
            FROM order_records
            {where_clause}
            ORDER BY id DESC
            LIMIT ?
        """, params).fetchall()

    return [dict(r) for r in rows]
