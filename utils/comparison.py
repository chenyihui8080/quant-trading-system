"""策略对比和参数优化"""
import importlib
from itertools import product
from datetime import datetime
from vnpy_ctastrategy.backtesting import BacktestingEngine
from vnpy.trader.constant import Interval

from config.settings import STRATEGIES, BACKTEST_CONFIG
from utils.data_generator import generate_random_bars, load_csv_bars


def compare_strategies(symbol: str = None, days: int = 500) -> list[dict]:
    """所有策略在同一数据上对比"""
    if symbol:
        bars = load_csv_bars(symbol)
    else:
        bars = generate_random_bars(days=days)

    results = []
    for key, info in STRATEGIES.items():
        module = importlib.import_module(info["module"])
        strategy_cls = getattr(module, info["class"])

        engine = BacktestingEngine()
        engine.set_parameters(
            vt_symbol=f"{symbol or '000001'}.SSE",
            interval=Interval.DAILY,
            start=datetime(2024, 1, 1),
            end=datetime(2025, 12, 31),
            **BACKTEST_CONFIG,
        )
        engine.add_strategy(strategy_cls, {})
        engine.history_data = bars
        engine.run_backtesting()
        engine.calculate_result()
        stats = engine.calculate_statistics(output=False) or {}

        clean = {}
        for k, v in stats.items():
            clean[k] = v.item() if hasattr(v, "item") else v

        results.append({
            "key": key,
            "name": info["name"],
            "stats": clean,
        })

    return results


def optimize_strategy(strategy_key: str, param_grid: dict, symbol: str = None, days: int = 500) -> list[dict]:
    """参数网格搜索优化"""
    if strategy_key not in STRATEGIES:
        return []

    info = STRATEGIES[strategy_key]
    module = importlib.import_module(info["module"])
    strategy_cls = getattr(module, info["class"])

    if symbol:
        bars = load_csv_bars(symbol)
    else:
        bars = generate_random_bars(days=days)

    # 生成参数组合
    keys = list(param_grid.keys())
    values = list(param_grid.values())
    combos = list(product(*values))

    results = []
    for combo in combos:
        params = dict(zip(keys, combo))

        engine = BacktestingEngine()
        engine.set_parameters(
            vt_symbol=f"{symbol or '000001'}.SSE",
            interval=Interval.DAILY,
            start=datetime(2024, 1, 1),
            end=datetime(2025, 12, 31),
            **BACKTEST_CONFIG,
        )
        engine.add_strategy(strategy_cls, params)
        engine.history_data = bars
        engine.run_backtesting()
        engine.calculate_result()
        stats = engine.calculate_statistics(output=False) or {}

        clean = {}
        for k, v in stats.items():
            clean[k] = v.item() if hasattr(v, "item") else v

        results.append({"params": params, "stats": clean})

    # 按夏普比率排序
    results.sort(key=lambda x: x["stats"].get("sharpe_ratio", -999), reverse=True)
    return results
