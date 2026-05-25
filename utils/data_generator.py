"""数据工具：模拟数据生成 + 真实数据加载"""
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
from vnpy.trader.constant import Interval, Exchange
from vnpy.trader.object import BarData

DATA_DIR = Path(__file__).parent.parent / "data"


def generate_random_bars(
    symbol: str = "000001",
    exchange: Exchange = Exchange.SSE,
    days: int = 500,
    start_price: float = 3000.0,
    seed: int = 42,
) -> list[BarData]:
    """生成随机走势的 K 线数据"""
    np.random.seed(seed)

    price = start_price
    bars = []
    dt = datetime(2024, 1, 1, 9, 30)

    for _ in range(days):
        ret = np.random.normal(0.0002, 0.015)
        price *= (1 + ret)

        open_price = price * (1 + np.random.uniform(-0.005, 0.005))
        high_price = max(price, open_price) * (1 + abs(np.random.normal(0, 0.008)))
        low_price = min(price, open_price) * (1 - abs(np.random.normal(0, 0.008)))

        bar = BarData(
            symbol=symbol,
            exchange=exchange,
            datetime=dt,
            interval=Interval.DAILY,
            volume=float(np.random.randint(100000, 1000000)),
            turnover=0.0,
            open_interest=0.0,
            open_price=round(open_price, 2),
            high_price=round(high_price, 2),
            low_price=round(low_price, 2),
            close_price=round(price, 2),
            gateway_name="BACKTEST",
        )
        bars.append(bar)
        dt += timedelta(days=1)

    return bars


def load_csv_bars(symbol: str, exchange: Exchange = Exchange.SSE) -> list[BarData]:
    """从 CSV 加载真实行情数据"""
    csv_path = DATA_DIR / f"{symbol}.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"数据文件不存在: {csv_path}")

    df = pd.read_csv(csv_path)
    bars = []
    for _, row in df.iterrows():
        dt = datetime.strptime(str(row["date"]), "%Y-%m-%d")
        bar = BarData(
            symbol=symbol,
            exchange=exchange,
            datetime=dt,
            interval=Interval.DAILY,
            volume=float(row["volume"]),
            turnover=0.0,
            open_interest=0.0,
            open_price=float(row["open"]),
            high_price=float(row["high"]),
            low_price=float(row["low"]),
            close_price=float(row["close"]),
            gateway_name="CSV",
        )
        bars.append(bar)
    return bars
