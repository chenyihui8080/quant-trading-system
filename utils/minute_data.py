"""分钟K线数据获取（新浪免费API）

支持 5/15/30/60 分钟线，最多 2000 条。
5分钟 ≈ 2个月，15分钟 ≈ 6个月，30分钟 ≈ 1年，60分钟 ≈ 2年。
"""
import json
import logging

import requests

logger = logging.getLogger(__name__)

# 新浪分钟K线API
_SINA_KLINE_URL = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"

# 周期映射（新浪 scale 参数）
PERIOD_MAP = {
    "5": 5, "15": 15, "30": 30, "60": 60,
    "5m": 5, "15m": 15, "30m": 30, "60m": 60,
}

PERIOD_NAMES = {
    5: "5分钟", 15: "15分钟", 30: "30分钟", 60: "60分钟",
}


def _get_sina_symbol(symbol: str) -> str:
    """股票代码 → 新浪格式（sh600519 / sz000001）"""
    if symbol.startswith("6") or symbol.startswith("9"):
        return f"sh{symbol}"
    return f"sz{symbol}"


def fetch_minute_klines(
    symbol: str,
    period: str = "5",
    limit: int = 2000,
) -> list[dict]:
    """获取分钟K线数据。

    Args:
        symbol: 股票代码，如 "600519"
        period: 周期 "5"/"15"/"30"/"60"
        limit: 最大条数（新浪上限约 2000）

    Returns:
        list[dict]: [{day, open, high, low, close, volume}, ...]
    """
    scale = PERIOD_MAP.get(period, 5)

    try:
        session = requests.Session()
        session.trust_env = False
        resp = session.get(
            _SINA_KLINE_URL,
            params={
                "symbol": _get_sina_symbol(symbol),
                "scale": str(scale),
                "ma": "no",
                "datalen": str(limit),
            },
            timeout=15,
            headers={"Referer": "https://finance.sina.com.cn"},
        )

        data = json.loads(resp.text)
        if not data:
            logger.warning(f"无分钟数据: {symbol} period={period}")
            return []

        bars = []
        for item in data:
            bars.append({
                "datetime": item["day"],
                "open": float(item["open"]),
                "high": float(item["high"]),
                "low": float(item["low"]),
                "close": float(item["close"]),
                "volume": float(item["volume"]),
                "amount": 0.0,  # 新浪不提供成交额
            })

        return bars

    except Exception as e:
        logger.error(f"获取分钟数据失败 {symbol}: {e}")
        return []


def fetch_minute_klines_with_info(
    symbol: str,
    period: str = "5",
    limit: int = 2000,
) -> dict:
    """获取分钟K线 + 元信息"""
    bars = fetch_minute_klines(symbol, period, limit)

    from utils.stock_search import get_stock_name
    name = get_stock_name(symbol)
    scale = PERIOD_MAP.get(period, 5)

    if not bars:
        return {"name": name, "symbol": symbol, "count": 0, "bars": [], "period": PERIOD_NAMES.get(scale, f"{scale}分钟")}

    return {
        "name": name,
        "symbol": symbol,
        "count": len(bars),
        "period": PERIOD_NAMES.get(scale, f"{scale}分钟"),
        "start": bars[0]["datetime"],
        "end": bars[-1]["datetime"],
        "bars": bars,
    }


def to_vnpy_bars(symbol: str, bars: list[dict]) -> list:
    """将分钟数据转为 vnpy BarData 列表（供回测引擎使用）"""
    from vnpy.trader.object import BarData
    from vnpy.trader.constant import Exchange, Interval
    from datetime import datetime as dt

    exchange = Exchange.SSE if symbol.startswith("6") else Exchange.SZSE

    vnpy_bars = []
    for bar in bars:
        dt_val = dt.strptime(bar["datetime"], "%Y-%m-%d %H:%M:%S")
        vnpy_bar = BarData(
            symbol=symbol,
            exchange=exchange,
            datetime=dt_val,
            interval=Interval.MINUTE,
            volume=bar["volume"],
            turnover=bar.get("amount", 0),
            open_interest=0,
            open_price=bar["open"],
            high_price=bar["high"],
            low_price=bar["low"],
            close_price=bar["close"],
            gateway_name="minute_data",
        )
        vnpy_bars.append(vnpy_bar)

    return vnpy_bars
