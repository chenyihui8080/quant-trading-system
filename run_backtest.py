"""统一回测入口"""
import importlib
from datetime import datetime
from vnpy_ctastrategy.backtesting import BacktestingEngine
from vnpy.trader.constant import Interval

from config.settings import STRATEGIES, BACKTEST_CONFIG
from utils.data_generator import generate_random_bars


def run_backtest(strategy_key: str, params: dict = None):
    """运行指定策略的回测"""
    if strategy_key not in STRATEGIES:
        print(f"未知策略: {strategy_key}")
        print(f"可选: {list(STRATEGIES.keys())}")
        return

    info = STRATEGIES[strategy_key]
    module = importlib.import_module(info["module"])
    strategy_cls = getattr(module, info["class"])

    print(f"策略: {info['name']} — {info['desc']}")
    print("=" * 50)

    # 生成数据
    bars = generate_random_bars(days=500)
    print(f"数据: {len(bars)} 根 K 线")
    print(f"起始价: {bars[0].close_price:.2f}  结束价: {bars[-1].close_price:.2f}")

    # 初始化引擎
    engine = BacktestingEngine()
    engine.set_parameters(
        vt_symbol="000001.SSE",
        interval=Interval.DAILY,
        start=datetime(2024, 1, 1),
        end=datetime(2025, 12, 31),
        **BACKTEST_CONFIG,
    )

    setting = params or {}
    engine.add_strategy(strategy_cls, setting)
    engine.history_data = bars

    # 运行
    engine.run_backtesting()
    engine.calculate_result()
    stats = engine.calculate_statistics(output=False)

    print("\n回测结果:")
    print("-" * 50)
    if stats:
        for key, value in stats.items():
            if isinstance(value, float):
                print(f"  {key:>20}: {value:>12.4f}")
            else:
                print(f"  {key:>20}: {value}")
    else:
        print("  无交易记录")

    print("=" * 50)
    return stats


if __name__ == "__main__":
    import sys
    key = sys.argv[1] if len(sys.argv) > 1 else "dual_ma"
    run_backtest(key)
