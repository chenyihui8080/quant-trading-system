"""用户自定义策略规则引擎

支持的技术指标：MA、EMA、RSI、MACD、BOLL、ATR、KDJ、成交量
支持的算子：>、<、>=、<=、==、cross_above、cross_below
信号类型：buy / sell → 自动推送飞书/微信
"""
import json
import logging
from pathlib import Path
from datetime import datetime

from utils.realtime import get_realtime_kline

logger = logging.getLogger(__name__)

STRATEGIES_FILE = Path(__file__).parent.parent / "data" / "user_strategies.json"

# ==================== 技术指标计算 ====================

def _calc_ma(closes: list, period: int) -> list:
    """简单移动平均线"""
    result = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        result[i] = sum(closes[i - period + 1: i + 1]) / period
    return result


def _calc_ema(closes: list, period: int) -> list:
    """指数移动平均线"""
    result = [None] * len(closes)
    if len(closes) < period:
        return result
    result[period - 1] = sum(closes[:period]) / period
    k = 2 / (period + 1)
    for i in range(period, len(closes)):
        result[i] = closes[i] * k + result[i - 1] * (1 - k)
    return result


def _calc_rsi(closes: list, period: int = 14) -> list:
    """相对强弱指数"""
    result = [None] * len(closes)
    if len(closes) < period + 1:
        return result
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    if avg_loss == 0:
        result[period] = 100
    else:
        result[period] = 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            result[i + 1] = 100
        else:
            result[i + 1] = 100 - 100 / (1 + avg_gain / avg_loss)
    return result


def _calc_macd(closes: list, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    """MACD 指标，返回 {dif, dea, macd}"""
    ema_fast = _calc_ema(closes, fast)
    ema_slow = _calc_ema(closes, slow)
    n = len(closes)
    dif = [None] * n
    for i in range(n):
        if ema_fast[i] is not None and ema_slow[i] is not None:
            dif[i] = ema_fast[i] - ema_slow[i]
    # DEA = EMA(DIF, signal)
    dea = [None] * n
    valid = [(i, v) for i, v in enumerate(dif) if v is not None]
    if len(valid) >= signal:
        start = valid[signal - 1][0]
        dea[start] = sum(v for _, v in valid[:signal]) / signal
        k = 2 / (signal + 1)
        for i in range(start + 1, n):
            if dif[i] is not None and dea[i - 1] is not None:
                dea[i] = dif[i] * k + dea[i - 1] * (1 - k)
    macd = [None] * n
    for i in range(n):
        if dif[i] is not None and dea[i] is not None:
            macd[i] = (dif[i] - dea[i]) * 2
    return {"dif": dif, "dea": dea, "macd": macd}


def _calc_boll(closes: list, period: int = 20, std_dev: float = 2.0) -> dict:
    """布林带，返回 {upper, middle, lower}"""
    middle = _calc_ma(closes, period)
    n = len(closes)
    upper = [None] * n
    lower = [None] * n
    for i in range(period - 1, n):
        window = closes[i - period + 1: i + 1]
        avg = middle[i]
        std = (sum((x - avg) ** 2 for x in window) / period) ** 0.5
        upper[i] = avg + std_dev * std
        lower[i] = avg - std_dev * std
    return {"upper": upper, "middle": middle, "lower": lower}


def _calc_atr(highs: list, lows: list, closes: list, period: int = 14) -> list:
    """平均真实波幅"""
    n = len(closes)
    result = [None] * n
    trs = [highs[0] - lows[0]]
    for i in range(1, n):
        tr = max(highs[i] - lows[i],
                 abs(highs[i] - closes[i - 1]),
                 abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    if len(trs) >= period:
        result[period - 1] = sum(trs[:period]) / period
        for i in range(period, n):
            result[i] = (result[i - 1] * (period - 1) + trs[i]) / period
    return result


def _calc_kdj(highs: list, lows: list, closes: list,
              n: int = 9, m1: int = 3, m2: int = 3) -> dict:
    """KDJ 指标，返回 {k, d, j}"""
    length = len(closes)
    k_vals = [50.0] * length
    d_vals = [50.0] * length
    j_vals = [50.0] * length
    for i in range(n - 1, length):
        hn = max(highs[i - n + 1: i + 1])
        ln = min(lows[i - n + 1: i + 1])
        rsv = ((closes[i] - ln) / (hn - ln) * 100) if hn != ln else 50
        k_vals[i] = k_vals[i - 1] * (m1 - 1) / m1 + rsv / m1
        d_vals[i] = d_vals[i - 1] * (m2 - 1) / m2 + k_vals[i] / m2
        j_vals[i] = 3 * k_vals[i] - 2 * d_vals[i]
    return {"k": k_vals, "d": d_vals, "j": j_vals}


def _calc_highest(highs: list, period: int) -> list:
    """N日最高价（唐奇安通道上轨）"""
    n = len(highs)
    result = [None] * n
    for i in range(period - 1, n):
        result[i] = max(highs[i - period + 1: i + 1])
    return result


def _calc_lowest(lows: list, period: int) -> list:
    """N日最低价（唐奇安通道下轨）"""
    n = len(lows)
    result = [None] * n
    for i in range(period - 1, n):
        result[i] = min(lows[i - period + 1: i + 1])
    return result


def _calc_vol_ma(volumes: list, period: int) -> list:
    """成交量移动平均"""
    result = [None] * len(volumes)
    for i in range(period - 1, len(volumes)):
        result[i] = sum(volumes[i - period + 1: i + 1]) / period
    return result


def _calc_return(closes: list, period: int) -> list:
    """N日收益率（百分比）"""
    n = len(closes)
    result = [None] * n
    for i in range(period, n):
        if closes[i - period] != 0:
            result[i] = (closes[i] / closes[i - period] - 1) * 100
    return result


def _calc_vol_ratio(volumes: list, period: int) -> list:
    """量比 = 当日成交量 / N日平均成交量"""
    vol_ma = _calc_vol_ma(volumes, period)
    n = len(volumes)
    result = [None] * n
    for i in range(n):
        if vol_ma[i] is not None and vol_ma[i] > 0:
            result[i] = volumes[i] / vol_ma[i]
    return result


def _calc_donchian(highs: list, lows: list, period: int) -> dict:
    """唐奇安通道，返回 {upper, lower, middle}"""
    upper = _calc_highest(highs, period)
    lower = _calc_lowest(lows, period)
    n = len(highs)
    middle = [None] * n
    for i in range(n):
        if upper[i] is not None and lower[i] is not None:
            middle[i] = (upper[i] + lower[i]) / 2
    return {"upper": upper, "lower": lower, "middle": middle}


def _calc_wma(closes: list, period: int) -> list:
    """加权移动平均线（近期权重大）"""
    n = len(closes)
    result = [None] * n
    weights = list(range(1, period + 1))
    total_w = sum(weights)
    for i in range(period - 1, n):
        result[i] = sum(closes[i - period + 1 + j] * weights[j] for j in range(period)) / total_w
    return result


def _calc_cci(highs: list, lows: list, closes: list, period: int = 20) -> list:
    """CCI 商品通道指数"""
    n = len(closes)
    result = [None] * n
    tp = [(highs[i] + lows[i] + closes[i]) / 3 for i in range(n)]
    for i in range(period - 1, n):
        window = tp[i - period + 1: i + 1]
        avg_tp = sum(window) / period
        md = sum(abs(v - avg_tp) for v in window) / period
        if md > 0:
            result[i] = (tp[i] - avg_tp) / (0.015 * md)
        else:
            result[i] = 0
    return result


def _calc_obv(closes: list, volumes: list) -> list:
    """OBV 能量潮"""
    n = len(closes)
    result = [0.0] * n
    for i in range(1, n):
        if closes[i] > closes[i - 1]:
            result[i] = result[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            result[i] = result[i - 1] - volumes[i]
        else:
            result[i] = result[i - 1]
    return result


def _get_indicator(candles: list, indicator: str, params: dict) -> list:
    """根据指标名计算数值序列"""
    closes = [c[2] for c in candles]
    highs = [c[4] for c in candles]
    lows = [c[3] for c in candles]

    if indicator == "ma":
        return _calc_ma(closes, int(params.get("period", 20)))
    elif indicator == "ema":
        return _calc_ema(closes, int(params.get("period", 20)))
    elif indicator == "rsi":
        return _calc_rsi(closes, int(params.get("period", 14)))
    elif indicator == "macd":
        result = _calc_macd(closes, int(params.get("fast", 12)),
                            int(params.get("slow", 26)),
                            int(params.get("signal", 9)))
        return result[params.get("field", "dif")]
    elif indicator == "boll":
        result = _calc_boll(closes, int(params.get("period", 20)),
                            float(params.get("std", 2.0)))
        return result[params.get("field", "upper")]
    elif indicator == "atr":
        return _calc_atr(highs, lows, closes, int(params.get("period", 14)))
    elif indicator == "kdj":
        result = _calc_kdj(highs, lows, closes,
                           int(params.get("n", 9)),
                           int(params.get("m1", 3)),
                           int(params.get("m2", 3)))
        return result[params.get("field", "k")]
    elif indicator == "close":
        return closes
    elif indicator == "open":
        return [c[1] for c in candles]
    elif indicator == "high":
        return highs
    elif indicator == "low":
        return lows
    elif indicator == "volume":
        return [c[5] for c in candles]
    elif indicator == "highest":
        return _calc_highest(highs, int(params.get("period", 20)))
    elif indicator == "lowest":
        return _calc_lowest(lows, int(params.get("period", 20)))
    elif indicator == "vol_ma":
        return _calc_vol_ma([c[5] for c in candles], int(params.get("period", 20)))
    elif indicator == "return":
        return _calc_return(closes, int(params.get("period", 20)))
    elif indicator == "vol_ratio":
        return _calc_vol_ratio([c[5] for c in candles], int(params.get("period", 20)))
    elif indicator == "donchian":
        result = _calc_donchian(highs, lows, int(params.get("period", 20)))
        return result[params.get("field", "upper")]
    elif indicator == "wma":
        return _calc_wma(closes, int(params.get("period", 20)))
    elif indicator == "cci":
        return _calc_cci(highs, lows, closes, int(params.get("period", 20)))
    elif indicator == "obv":
        return _calc_obv(closes, [c[5] for c in candles])
    else:
        return closes


# ==================== 条件求值 ====================

def _get_value(candles: list, ref: dict, shift: int = 0) -> float | None:
    """获取条件左侧/右侧的值"""
    if ref["type"] == "fixed":
        return float(ref["value"])

    series = _get_indicator(candles, ref["indicator"], ref.get("params", {}))
    idx = len(series) - 1 - shift
    if idx < 0 or idx >= len(series):
        return None
    val = series[idx]
    if val is None:
        return None
    return float(val)


def _compare(left: float, right: float, op: str, left_prev: float = None,
             right_prev: float = None) -> bool:
    """执行比较运算"""
    if left is None or right is None:
        return False

    if op in ("cross_above", "cross_below"):
        if left_prev is None or right_prev is None:
            return False
        if op == "cross_above":
            return left_prev <= right_prev and left > right
        else:
            return left_prev >= right_prev and left < right

    ops = {
        ">": lambda a, b: a > b,
        "<": lambda a, b: a < b,
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
        "==": lambda a, b: abs(a - b) < 1e-10,
    }
    return ops.get(op, lambda a, b: False)(left, right)


def check_condition(candles: list, condition: dict) -> bool:
    """检查单个条件是否成立"""
    left = condition["left"]
    right = condition["right"]
    op = condition["op"]

    left_val = _get_value(candles, left)
    right_val = _get_value(candles, right)

    if left_val is None or right_val is None:
        return False

    # 对 cross 算子，用前一日 K 线重新计算指标值
    left_prev = None
    right_prev = None
    if op in ("cross_above", "cross_below"):
        prev_candles = candles[:-1]
        if len(prev_candles) < 2:
            return False
        left_prev = _get_value(prev_candles, left)
        right_prev = _get_value(prev_candles, right)

    return _compare(left_val, right_val, op, left_prev, right_prev)


def find_signals(strategy: dict, candles: list) -> list:
    """根据策略配置检测买卖信号

    返回: [{"type": "buy"/"sell", "conditions": [...], "details": {...}}, ...]
    """
    signals = []

    # 检查买入条件（AND 逻辑：全部成立才触发）
    buy_conds = strategy.get("buy_conditions", [])
    if buy_conds:
        all_met = all(check_condition(candles, c) for c in buy_conds)
        if all_met:
            signals.append({
                "type": "buy",
                "name": strategy["name"],
                "conditions": buy_conds,
                "details": _build_details(candles, buy_conds),
            })

    # 检查卖出条件
    sell_conds = strategy.get("sell_conditions", [])
    if sell_conds:
        all_met = all(check_condition(candles, c) for c in sell_conds)
        if all_met:
            signals.append({
                "type": "sell",
                "name": strategy["name"],
                "conditions": sell_conds,
                "details": _build_details(candles, sell_conds),
            })

    return signals


def _build_details(candles: list, conditions: list) -> dict:
    """构建信号详情（用于推送通知）"""
    details = {}
    for i, cond in enumerate(conditions):
        left_val = _get_value(candles, cond["left"])
        right_val = _get_value(candles, cond["right"])
        details[f"条件{i+1}"] = {
            "left": f"{cond['left'].get('indicator', cond['left'].get('value', '?'))}={left_val:.2f}" if left_val else "N/A",
            "op": cond["op"],
            "right": f"{cond['right'].get('indicator', cond['right'].get('value', '?'))}={right_val:.2f}" if right_val else "N/A",
        }
    details["最新收盘价"] = candles[-1][2]
    details["日期"] = candles[-1][0]
    return details


# ==================== 策略管理 ====================

def _load_strategies() -> dict:
    """加载策略文件"""
    if STRATEGIES_FILE.exists():
        try:
            with open(STRATEGIES_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"next_id": 1, "strategies": []}


def _save_strategies(data: dict):
    """保存策略文件"""
    STRATEGIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STRATEGIES_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def add_strategy(name: str, symbol: str, buy_conditions: list,
                 sell_conditions: list, market: str = "a") -> dict:
    """新增策略"""
    data = _load_strategies()
    strategy = {
        "id": data["next_id"],
        "name": name,
        "symbol": symbol,
        "market": market,
        "buy_conditions": buy_conditions,
        "sell_conditions": sell_conditions,
        "enabled": True,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "last_evaluated": None,
    }
    data["strategies"].append(strategy)
    data["next_id"] += 1
    _save_strategies(data)
    return strategy


def update_strategy(strategy_id: int, updates: dict) -> dict | None:
    """更新策略"""
    data = _load_strategies()
    for s in data["strategies"]:
        if s["id"] == strategy_id:
            s.update(updates)
            _save_strategies(data)
            return s
    return None


def remove_strategy(strategy_id: int) -> bool:
    """删除策略"""
    data = _load_strategies()
    data["strategies"] = [s for s in data["strategies"] if s["id"] != strategy_id]
    _save_strategies(data)
    return True


def list_strategies() -> list:
    """列出所有策略"""
    return _load_strategies()["strategies"]


def get_strategy(strategy_id: int) -> dict | None:
    """获取单个策略"""
    for s in _load_strategies()["strategies"]:
        if s["id"] == strategy_id:
            return s
    return None


# ==================== 策略评估 ====================

def evaluate_strategy(strategy: dict) -> dict:
    """评估单个策略，返回信号和状态"""
    symbol = strategy["symbol"]

    try:
        candles = get_realtime_kline(symbol, period="d", count=120)
    except Exception as e:
        return {"status": "error", "error": str(e), "signals": [], "strategy": strategy}

    if not candles or len(candles) < 30:
        return {"status": "error", "error": f"数据不足 ({len(candles) if candles else 0} 条，需要至少 30 条)",
                "signals": [], "strategy": strategy}

    signals = find_signals(strategy, candles)

    # 更新最后评估时间
    update_strategy(strategy["id"], {"last_evaluated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})

    return {
        "status": "ok",
        "symbol": symbol,
        "data_count": len(candles),
        "latest_date": candles[-1][0],
        "latest_close": candles[-1][2],
        "signals": signals,
        "strategy": strategy,
    }


def evaluate_all() -> list:
    """评估所有已启用的策略，有信号则推送通知"""
    from utils.push_notifier import notifier

    strategies = list_strategies()
    results = []

    for strategy in strategies:
        if not strategy.get("enabled", True):
            continue

        result = evaluate_strategy(strategy)
        results.append(result)

        # 有信号就推送
        for signal in result.get("signals", []):
            action = "买入" if signal["type"] == "buy" else "卖出"
            title = f"[策略信号] {strategy['name']} → {action} {strategy['symbol']}"
            lines = [f"**策略**: {strategy['name']}", f"**股票**: {strategy['symbol']}",
                     f"**信号**: {action}"]
            details = signal.get("details", {})
            for k, v in details.items():
                if isinstance(v, dict):
                    lines.append(f"- {k}: {v['left']} {v['op']} {v['right']}")
                else:
                    lines.append(f"- {k}: {v}")
            lines.append(f"\n**评估时间**: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
            notifier.send(title, "\n\n".join(lines), priority="high")
            logger.info(f"策略信号推送: {title}")

    return results


# ==================== 预设策略模板 ====================

PRESET_STRATEGIES = [
    {
        "name": "🐢 海龟交易法",
        "description": "经典趋势跟踪策略：突破20日高点买入，跌破10日低点卖出",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "close", "params": {}},
             "op": ">",
             "right": {"type": "indicator", "indicator": "highest", "params": {"period": 20}}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "close", "params": {}},
             "op": "<",
             "right": {"type": "indicator", "indicator": "lowest", "params": {"period": 10}}},
        ],
    },
    {
        "name": "📊 布林带突破",
        "description": "价格突破布林带上轨买入，跌破下轨卖出",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "close", "params": {}},
             "op": ">",
             "right": {"type": "indicator", "indicator": "boll", "params": {"period": 20, "std": 2, "field": "upper"}}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "close", "params": {}},
             "op": "<",
             "right": {"type": "indicator", "indicator": "boll", "params": {"period": 20, "std": 2, "field": "lower"}}},
        ],
    },
    {
        "name": "📈 量价突破",
        "description": "价格突破10日新高且量比大于2倍（放量突破）",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "close", "params": {}},
             "op": ">",
             "right": {"type": "indicator", "indicator": "highest", "params": {"period": 10}}},
            {"left": {"type": "indicator", "indicator": "vol_ratio", "params": {"period": 20}},
             "op": ">",
             "right": {"type": "fixed", "value": 2.0}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "close", "params": {}},
             "op": "<",
             "right": {"type": "indicator", "indicator": "ma", "params": {"period": 20}}},
        ],
    },
    {
        "name": "🚀 动量策略",
        "description": "RSI从超卖区回升 + MA金叉（RSI>30且5日MA上穿20日MA）",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "rsi", "params": {"period": 14}},
             "op": ">",
             "right": {"type": "fixed", "value": 30}},
            {"left": {"type": "indicator", "indicator": "ma", "params": {"period": 5}},
             "op": "cross_above",
             "right": {"type": "indicator", "indicator": "ma", "params": {"period": 20}}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "rsi", "params": {"period": 14}},
             "op": ">",
             "right": {"type": "fixed", "value": 70}},
            {"left": {"type": "indicator", "indicator": "ma", "params": {"period": 5}},
             "op": "cross_below",
             "right": {"type": "indicator", "indicator": "ma", "params": {"period": 20}}},
        ],
    },
    {
        "name": "⚡ MACD 金叉死叉",
        "description": "经典MACD策略：DIF上穿DEA买入，DIF下穿DEA卖出",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "macd", "params": {"field": "dif"}},
             "op": "cross_above",
             "right": {"type": "indicator", "indicator": "macd", "params": {"field": "dea"}}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "macd", "params": {"field": "dif"}},
             "op": "cross_below",
             "right": {"type": "indicator", "indicator": "macd", "params": {"field": "dea"}}},
        ],
    },
    {
        "name": "🎯 CCI 超买超卖",
        "description": "CCI低于-100超卖买入，高于100超买卖出",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "cci", "params": {"period": 20}},
             "op": "cross_above",
             "right": {"type": "fixed", "value": -100}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "cci", "params": {"period": 20}},
             "op": "cross_below",
             "right": {"type": "fixed", "value": 100}},
        ],
    },
    {
        "name": "🔄 均线多头排列",
        "description": "MA5>MA10>MA20 且价格在MA5之上（强势形态）",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "ma", "params": {"period": 5}},
             "op": ">",
             "right": {"type": "indicator", "indicator": "ma", "params": {"period": 10}}},
            {"left": {"type": "indicator", "indicator": "ma", "params": {"period": 10}},
             "op": ">",
             "right": {"type": "indicator", "indicator": "ma", "params": {"period": 20}}},
            {"left": {"type": "indicator", "indicator": "close", "params": {}},
             "op": ">",
             "right": {"type": "indicator", "indicator": "ma", "params": {"period": 5}}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "ma", "params": {"period": 5}},
             "op": "cross_below",
             "right": {"type": "indicator", "indicator": "ma", "params": {"period": 20}}},
        ],
    },
    {
        "name": "📉 跌幅反弹",
        "description": "20日跌幅超过15%且RSI超卖（反弹机会）",
        "symbol": "",
        "market": "a",
        "buy_conditions": [
            {"left": {"type": "indicator", "indicator": "return", "params": {"period": 20}},
             "op": "<",
             "right": {"type": "fixed", "value": -15}},
            {"left": {"type": "indicator", "indicator": "rsi", "params": {"period": 14}},
             "op": "<",
             "right": {"type": "fixed", "value": 30}},
        ],
        "sell_conditions": [
            {"left": {"type": "indicator", "indicator": "rsi", "params": {"period": 14}},
             "op": ">",
             "right": {"type": "fixed", "value": 50}},
        ],
    },
]


def get_presets() -> list:
    """返回预设策略模板列表"""
    return [{"index": i, "name": p["name"], "description": p["description"],
             "buy_count": len(p["buy_conditions"]), "sell_count": len(p["sell_conditions"])}
            for i, p in enumerate(PRESET_STRATEGIES)]
