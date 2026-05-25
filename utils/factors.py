"""因子计算框架：内置因子库 + 自定义因子注册"""
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Callable


# 全局因子注册表
_FACTOR_REGISTRY: dict[str, "Factor"] = {}


def register_factor(name: str):
    """装饰器：注册自定义因子"""
    def decorator(cls: type):
        _FACTOR_REGISTRY[name] = cls()
        return cls
    return decorator


def get_factor(name: str) -> "Factor":
    """获取已注册的因子"""
    if name not in _FACTOR_REGISTRY:
        raise KeyError(f"未注册因子: {name}，可用: {list(_FACTOR_REGISTRY.keys())}")
    return _FACTOR_REGISTRY[name]


def list_factors() -> list[dict]:
    """列出所有已注册因子"""
    return [
        {"name": name, "desc": factor.desc, "params": factor.default_params}
        for name, factor in _FACTOR_REGISTRY.items()
    ]


def load_price_df(symbol: str) -> pd.DataFrame:
    """加载股票数据为 DataFrame，统一列名"""
    csv_path = Path(__file__).parent.parent / "data" / f"{symbol}.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"未找到 {symbol} 的数据")
    df = pd.read_csv(csv_path)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    return df


class Factor:
    """因子基类"""
    desc: str = ""
    default_params: dict = {}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        """计算因子，返回带新列的 DataFrame"""
        raise NotImplementedError


# ==================== 内置因子 ====================

@register_factor("ma")
class MaFactor(Factor):
    desc = "简单移动平均线"
    default_params = {"windows": [5, 10, 20, 60]}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        windows = kwargs.get("windows", self.default_params["windows"])
        for w in windows:
            df[f"ma_{w}"] = df["close"].rolling(w).mean()
        return df


@register_factor("ema")
class EmaFactor(Factor):
    desc = "指数移动平均线"
    default_params = {"windows": [12, 26]}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        windows = kwargs.get("windows", self.default_params["windows"])
        for w in windows:
            df[f"ema_{w}"] = df["close"].ewm(span=w, adjust=False).mean()
        return df


@register_factor("macd")
class MacdFactor(Factor):
    desc = "MACD（快线、慢线、柱状图）"
    default_params = {"fast": 12, "slow": 26, "signal": 9}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        fast = kwargs.get("fast", 12)
        slow = kwargs.get("slow", 26)
        signal_period = kwargs.get("signal", 9)
        ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
        ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
        df["macd_dif"] = ema_fast - ema_slow
        df["macd_dea"] = df["macd_dif"].ewm(span=signal_period, adjust=False).mean()
        df["macd_hist"] = 2 * (df["macd_dif"] - df["macd_dea"])
        return df


@register_factor("rsi")
class RsiFactor(Factor):
    desc = "相对强弱指标"
    default_params = {"window": 14}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        window = kwargs.get("window", 14)
        delta = df["close"].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.rolling(window).mean()
        avg_loss = loss.rolling(window).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        df["rsi"] = 100 - 100 / (1 + rs)
        return df


@register_factor("bollinger")
class BollingerFactor(Factor):
    desc = "布林带（上轨、中轨、下轨、带宽）"
    default_params = {"window": 20, "dev": 2.0}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        window = kwargs.get("window", 20)
        dev = kwargs.get("dev", 2.0)
        df["boll_mid"] = df["close"].rolling(window).mean()
        std = df["close"].rolling(window).std()
        df["boll_upper"] = df["boll_mid"] + dev * std
        df["boll_lower"] = df["boll_mid"] - dev * std
        df["boll_width"] = (df["boll_upper"] - df["boll_lower"]) / df["boll_mid"]
        return df


@register_factor("atr")
class AtrFactor(Factor):
    desc = "平均真实波幅（衡量波动率）"
    default_params = {"window": 14}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        window = kwargs.get("window", 14)
        high = df["high"]
        low = df["low"]
        prev_close = df["close"].shift(1)
        tr = pd.concat([
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ], axis=1).max(axis=1)
        df["atr"] = tr.rolling(window).mean()
        return df


@register_factor("vwap")
class VwapFactor(Factor):
    desc = "成交量加权平均价"
    default_params = {"window": 20}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        window = kwargs.get("window", 20)
        typical_price = (df["high"] + df["low"] + df["close"]) / 3
        cum_tp_vol = (typical_price * df["volume"]).rolling(window).sum()
        cum_vol = df["volume"].rolling(window).sum()
        df["vwap"] = cum_tp_vol / cum_vol.replace(0, np.nan)
        return df


@register_factor("kdj")
class KdjFactor(Factor):
    desc = "KDJ 随机指标"
    default_params = {"window": 9, "signal_k": 3, "signal_d": 3}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        window = kwargs.get("window", 9)
        sk = kwargs.get("signal_k", 3)
        sd = kwargs.get("signal_d", 3)
        low_min = df["low"].rolling(window).min()
        high_max = df["high"].rolling(window).max()
        rsv = (df["close"] - low_min) / (high_max - low_min).replace(0, np.nan) * 100
        df["kdj_k"] = rsv.ewm(com=sk - 1, adjust=False).mean()
        df["kdj_d"] = df["kdj_k"].ewm(com=sd - 1, adjust=False).mean()
        df["kdj_j"] = 3 * df["kdj_k"] - 2 * df["kdj_d"]
        return df


@register_factor("momentum")
class MomentumFactor(Factor):
    desc = "动量因子（过去 N 日收益率）"
    default_params = {"windows": [5, 10, 20, 60]}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        windows = kwargs.get("windows", self.default_params["windows"])
        for w in windows:
            df[f"mom_{w}"] = df["close"].pct_change(w)
        return df


@register_factor("volatility")
class VolatilityFactor(Factor):
    desc = "波动率因子（过去 N 日收益率标准差，年化）"
    default_params = {"windows": [20, 60]}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        windows = kwargs.get("windows", self.default_params["windows"])
        daily_ret = df["close"].pct_change()
        for w in windows:
            df[f"vol_{w}"] = daily_ret.rolling(w).std() * np.sqrt(252)
        return df


@register_factor("turnover")
class TurnoverFactor(Factor):
    desc = "换手率因子（成交量均值比）"
    default_params = {"window": 20}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        window = kwargs.get("window", 20)
        df["turnover_ma"] = df["volume"].rolling(window).mean()
        df["turnover_ratio"] = df["volume"] / df["turnover_ma"].replace(0, np.nan)
        return df


@register_factor("pe_pb_roe")
class PePbRoeFactor(Factor):
    desc = "估值因子（PE/PB/ROE，需要财务数据）"
    default_params = {}

    def calculate(self, df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        # 目前无财务数据，留作扩展接口
        # 接入 Tushare / baostock 财务数据后实现
        df["pe"] = np.nan
        df["pb"] = np.nan
        df["roe"] = np.nan
        return df


# ==================== 工具函数 ====================

def compute_factors(
    symbol: str,
    factor_names: list[str] | None = None,
    **kwargs,
) -> pd.DataFrame:
    """一键计算多个因子，返回完整 DataFrame

    Args:
        symbol: 股票代码
        factor_names: 要计算的因子列表，None 则计算全部
        **kwargs: 传递给各因子的额外参数
    Returns:
        DataFrame，包含原始 OHLCV + 各因子列
    """
    df = load_price_df(symbol)
    targets = factor_names or list(_FACTOR_REGISTRY.keys())

    for name in targets:
        factor = get_factor(name)
        params = {**factor.default_params, **kwargs.get(name, {})}
        df = factor.calculate(df, **params)

    return df


def top_factors_score(
    symbol: str,
    factor_weights: dict[str, float] | None = None,
) -> pd.Series:
    """多因子打分（最新一行数据）

    Args:
        symbol: 股票代码
        factor_weights: 因子名→权重映射，默认等权
    Returns:
        Series，各因子标准化后的加权得分
    """
    df = compute_factors(symbol)
    latest = df.iloc[-1]

    # 默认权重
    if factor_weights is None:
        factor_weights = {
            "rsi": 0.2,      # 超卖越低越好
            "macd": 0.2,     # 柱状图正值越好
            "momentum": 0.3, # 动量越高越好
            "volatility": -0.2,  # 波动率越低越好
            "turnover": 0.1, # 换手活跃度适中
        }

    scores = {}
    for name, weight in factor_weights.items():
        if name == "rsi":
            val = latest.get("rsi", 50)
            scores[name] = (100 - val) / 100 * weight  # 超卖得分高
        elif name == "macd":
            val = latest.get("macd_hist", 0)
            scores[name] = 1 if val > 0 else -1 * weight
        elif name == "momentum":
            val = latest.get("mom_20", 0)
            scores[name] = val * weight
        elif name == "volatility":
            val = latest.get("vol_20", 0)
            scores[name] = -val * weight  # 低波动加分
        elif name == "turnover":
            val = latest.get("turnover_ratio", 1)
            scores[name] = min(val, 3) / 3 * weight

    return pd.Series(scores, dtype=float)
