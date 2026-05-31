"""实盘交易接口封装（easytrader）

支持券商: 银河(yh)、华泰(ht)、雪球(xq)
注意: 需要对应券商客户端运行中才能连接。
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# 券商映射
BROKER_MAP = {
    "yh": {"name": "银河证券", "key": "yh"},
    "银河": {"name": "银河证券", "key": "yh"},
    "ht": {"name": "华泰证券", "key": "ht"},
    "华泰": {"name": "华泰证券", "key": "ht"},
    "xq": {"name": "雪球", "key": "xq"},
    "雪球": {"name": "雪球", "key": "xq"},
}

# 全局连接实例
_broker_instance = None
_broker_type = None


def connect(broker: str, **kwargs) -> dict:
    """连接券商客户端。

    Args:
        broker: 券商代码 "yh"/"ht"/"xq"
        kwargs: 传给 easytrader 的额外参数

    Returns:
        {"status": "ok", "broker": name, "balance": {...}}
    """
    global _broker_instance, _broker_type

    import easytrader

    broker_info = BROKER_MAP.get(broker)
    if not broker_info:
        return {"status": "error", "message": f"不支持的券商: {broker}，可选: 银河(yh)/华泰(ht)/雪球(xq)"}

    try:
        user = easytrader.use(broker_info["key"])

        # 银河/华泰需要客户端路径，雪球需要cookie
        if broker_info["key"] in ("yh", "ht"):
            exe_path = kwargs.get("exe_path")
            if exe_path:
                user.prepare(exe_path)
            else:
                # 尝试自动查找
                user.prepare("")
        elif broker_info["key"] == "xq":
            cookie = kwargs.get("cookie", "")
            user.prepare(cookie)

        _broker_instance = user
        _broker_type = broker_info["name"]

        # 获取账户信息
        balance = get_balance()
        return {
            "status": "ok",
            "broker": broker_info["name"],
            "balance": balance,
        }

    except Exception as e:
        logger.error(f"连接券商失败: {e}")
        return {"status": "error", "message": str(e)}


def disconnect() -> dict:
    """断开券商连接"""
    global _broker_instance, _broker_type
    _broker_instance = None
    _broker_type = None
    return {"status": "ok", "message": "已断开连接"}


def get_status() -> dict:
    """获取当前连接状态"""
    if _broker_instance:
        return {"connected": True, "broker": _broker_type}
    return {"connected": False, "broker": None}


def _check_connected() -> Optional[str]:
    """检查是否已连接，返回错误信息或None"""
    if not _broker_instance:
        return "未连接券商，请先调用 /broker/connect"
    return None


def get_balance() -> dict:
    """查询账户资金"""
    err = _check_connected()
    if err:
        return {"error": err}

    try:
        balance = _broker_instance.balance
        return {
            "总资产": balance[0].get("总资产", 0),
            "可用资金": balance[0].get("可用资金", 0),
            "冻结资金": balance[0].get("冻结资金", 0),
            "持仓市值": balance[0].get("证券市值", 0),
        }
    except Exception as e:
        return {"error": str(e)}


def get_positions() -> list:
    """查询持仓"""
    err = _check_connected()
    if err:
        return [{"error": err}]

    try:
        positions = _broker_instance.position
        return [{
            "股票代码": p.get("证券代码", ""),
            "股票名称": p.get("证券名称", ""),
            "持仓数量": p.get("股票余额", 0),
            "可用数量": p.get("可用余额", 0),
            "成本价": p.get("成本价", 0),
            "当前价": p.get("市价", 0),
            "盈亏": p.get("盈亏", 0),
            "市值": p.get("市值", 0),
        } for p in positions]
    except Exception as e:
        return [{"error": str(e)}]


def buy(symbol: str, price: float, amount: int) -> dict:
    """买入股票。

    Args:
        symbol: 股票代码，如 "600519"
        price: 买入价格
        amount: 买入数量（必须是100的整数倍）
    """
    err = _check_connected()
    if err:
        return {"error": err}

    if amount <= 0 or amount % 100 != 0:
        return {"error": "买入数量必须是100的整数倍"}

    try:
        result = _broker_instance.buy(symbol, price=price, amount=amount)
        return {
            "status": "ok",
            "direction": "买入",
            "symbol": symbol,
            "price": price,
            "amount": amount,
            "order_id": result.get("entrust_no", ""),
            "message": result.get("entrust_no", "下单成功"),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def sell(symbol: str, price: float, amount: int) -> dict:
    """卖出股票。

    Args:
        symbol: 股票代码，如 "600519"
        price: 卖出价格
        amount: 卖出数量
    """
    err = _check_connected()
    if err:
        return {"error": err}

    if amount <= 0:
        return {"error": "卖出数量必须大于0"}

    try:
        result = _broker_instance.sell(symbol, price=price, amount=amount)
        return {
            "status": "ok",
            "direction": "卖出",
            "symbol": symbol,
            "price": price,
            "amount": amount,
            "order_id": result.get("entrust_no", ""),
            "message": result.get("entrust_no", "下单成功"),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def cancel_order(order_id: str) -> dict:
    """撤销委托单"""
    err = _check_connected()
    if err:
        return {"error": err}

    try:
        result = _broker_instance.cancel_entrust(order_id)
        return {"status": "ok", "message": f"撤单成功: {order_id}", "result": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_orders() -> list:
    """查询当日委托"""
    err = _check_connected()
    if err:
        return [{"error": err}]

    try:
        orders = _broker_instance.entrust
        return [{
            "委托编号": o.get("entrust_no", ""),
            "股票代码": o.get("证券代码", ""),
            "股票名称": o.get("证券名称", ""),
            "方向": o.get("买卖标志", ""),
            "价格": o.get("委托价格", 0),
            "数量": o.get("委托数量", 0),
            "已成交": o.get("成交数量", 0),
            "状态": o.get("状态说明", ""),
        } for o in orders]
    except Exception as e:
        return [{"error": str(e)}]
