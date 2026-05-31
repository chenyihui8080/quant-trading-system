"""纯 Python 单元测试（不依赖 vnpy 引擎/浏览器）

覆盖模块：
- strategies/ml_strategy.py  特征计算 + KNN 预测
- utils/risk_manager.py      三层风控
- utils/data_quality.py      数据质量检测
- utils/notifier.py          通知模块
"""
import math
import tempfile
from pathlib import Path

import numpy as np
import pytest

from utils.risk_manager import (
    StrategyRiskConfig, AccountRiskConfig, PlatformRiskConfig,
    StrategyRiskGuard, AccountRiskGuard, PlatformRiskGuard,
    RiskManager, passed_result,
)
from utils.data_quality import check_data_quality
from utils.notifier import Notifier, SignalGenerator


# ======================================================================
#  ML 策略：特征计算 + KNN
# ======================================================================

class TestMlFeatures:
    """MlStrategy._compute_features 单元测试"""

    @staticmethod
    def _make_instance():
        """构造一个无引擎的 MlStrategy 实例（仅用于调用纯函数）"""
        from strategies.ml_strategy import MlStrategy
        # 不调用 __init__（需要 cta_engine），直接构造对象绑定方法
        obj = object.__new__(MlStrategy)
        return obj

    def test_compute_features_shape(self):
        """输出列数 = 6（MA 比率×3 + RSI + 波动率 + ATR 比率）"""
        obj = self._make_instance()
        n = 100
        close = np.linspace(10, 20, n) + np.random.randn(n) * 0.1
        high = close + np.abs(np.random.randn(n)) * 0.5
        low = close - np.abs(np.random.randn(n)) * 0.5
        feat = obj._compute_features(close, high, low)
        assert feat.shape == (n, 6)

    def test_compute_features_no_nan(self):
        """特征矩阵无 NaN（输入合理时）"""
        obj = self._make_instance()
        n = 200
        close = np.cumsum(np.random.randn(n)) + 100
        close = np.maximum(close, 1)  # 保证 >0
        high = close + 1
        low = close - 0.5
        feat = obj._compute_features(close, high, low)
        assert not np.isnan(feat).any()

    def test_rsi_in_range(self):
        """RSI 特征应在 [0, 1] 范围内"""
        obj = self._make_instance()
        n = 200
        close = np.cumsum(np.random.randn(n)) + 100
        close = np.maximum(close, 1)
        high = close + 1
        low = close - 0.5
        feat = obj._compute_features(close, high, low)
        rsi = feat[:, 3]  # 第 4 列是 RSI
        assert np.all(rsi >= 0) and np.all(rsi <= 1)

    def test_volatility_non_negative(self):
        """波动率特征 >= 0"""
        obj = self._make_instance()
        n = 100
        close = np.cumsum(np.random.randn(n)) + 100
        close = np.maximum(close, 1)
        high = close + 1
        low = close - 0.5
        feat = obj._compute_features(close, high, low)
        vol = feat[:, 4]  # 第 5 列是波动率
        assert np.all(vol >= 0)


class TestMlKnn:
    """MlStrategy._knn_predict 单元测试"""

    @staticmethod
    def _make_instance():
        from strategies.ml_strategy import MlStrategy
        return object.__new__(MlStrategy)

    def test_knn_returns_probability(self):
        """预测值在 [0, 1] 范围内"""
        obj = self._make_instance()
        rng = np.random.default_rng(42)
        X_train = rng.standard_normal((100, 5))
        y_train = rng.integers(0, 2, 100)
        x_new = rng.standard_normal((1, 5))
        prob = obj._knn_predict(X_train, y_train, x_new)
        assert 0 <= prob <= 1

    def test_knn_all_positive_class(self):
        """训练集全是正类 → 预测概率接近 1"""
        obj = self._make_instance()
        X_train = np.random.randn(50, 3)
        y_train = np.ones(50)
        x_new = np.zeros((1, 3))
        prob = obj._knn_predict(X_train, y_train, x_new)
        assert prob > 0.9

    def test_knn_all_negative_class(self):
        """训练集全是负类 → 预测概率接近 0"""
        obj = self._make_instance()
        X_train = np.random.randn(50, 3)
        y_train = np.zeros(50)
        x_new = np.zeros((1, 3))
        prob = obj._knn_predict(X_train, y_train, x_new)
        assert prob < 0.1

    def test_knn_insufficient_data(self):
        """样本不足 k 个时返回 0.5"""
        obj = self._make_instance()
        X_train = np.random.randn(5, 3)
        y_train = np.array([1, 0, 1, 0, 1])
        x_new = np.zeros((1, 3))
        prob = obj._knn_predict(X_train, y_train, x_new, k=15)
        assert prob == 0.5


# ======================================================================
#  风控模块：三层风控
# ======================================================================

class TestStrategyRiskGuard:
    """策略层风控"""

    def test_no_position_returns_passed(self):
        """无持仓时不触发任何风控"""
        guard = StrategyRiskGuard()
        result = guard.check(price=100, pos=0, capital=1_000_000)
        assert result.passed

    def test_stop_loss_triggered(self):
        """止损触发：亏损超过 -5%"""
        guard = StrategyRiskGuard(StrategyRiskConfig(stop_loss_pct=-5.0))
        guard.entry_price = 100.0
        guard.highest_price = 100.0
        # 94 = -6% 亏损
        result = guard.check(price=94, pos=100, capital=1_000_000)
        assert not result.passed
        assert result.rule == "stop_loss"

    def test_stop_loss_not_triggered(self):
        """亏损未达止损线"""
        guard = StrategyRiskGuard(StrategyRiskConfig(stop_loss_pct=-5.0))
        guard.entry_price = 100.0
        guard.highest_price = 100.0
        # 96 = -4% 亏损
        result = guard.check(price=96, pos=100, capital=1_000_000)
        assert result.passed

    def test_take_profit_triggered(self):
        """止盈触发：盈利超过 15%"""
        guard = StrategyRiskGuard(StrategyRiskConfig(take_profit_pct=15.0))
        guard.entry_price = 100.0
        guard.highest_price = 100.0
        # 116 = +16% 盈利
        result = guard.check(price=116, pos=100, capital=1_000_000)
        assert not result.passed
        assert result.rule == "take_profit"

    def test_trailing_stop_triggered(self):
        """移动止损：从最高点回落超过 -8%"""
        config = StrategyRiskConfig(trailing_stop_pct=-8.0)
        guard = StrategyRiskGuard(config)
        guard.entry_price = 100.0
        guard.highest_price = 120.0  # 最高 120
        # 110 相对 entry 还是盈利，但从最高点回落了 (110-120)/120 = -8.3%
        result = guard.check(price=110, pos=100, capital=1_000_000)
        assert not result.passed
        assert result.rule == "trailing_stop"

    def test_trailing_stop_not_triggered_no_profit(self):
        """移动止损不触发：未盈利时不触发（仅在盈利时触发）"""
        config = StrategyRiskConfig(trailing_stop_pct=-8.0)
        guard = StrategyRiskGuard(config)
        guard.entry_price = 100.0
        guard.highest_price = 100.0
        # 91 = -9% 亏损（pnl_pct < 0 → trailing_stop 不触发）
        result = guard.check(price=91, pos=100, capital=1_000_000)
        # 应该触发止损而非移动止损
        assert not result.passed
        assert result.rule == "stop_loss"

    def test_calc_position_size(self):
        """仓位计算：max_position_pct=30% → capital=1M, price=10 → 最大 30000 股"""
        guard = StrategyRiskGuard(StrategyRiskConfig(max_position_pct=30.0))
        size = guard.calc_position_size(price=10, capital=1_000_000)
        assert size == 30000  # 300000 / 10 = 30000, 整百

    def test_calc_position_size_min_100(self):
        """仓位下限 100 股"""
        guard = StrategyRiskGuard(StrategyRiskConfig(max_position_pct=30.0))
        size = guard.calc_position_size(price=100_000, capital=1_000_000)
        assert size == 100  # 300000 / 100000 = 3 → 最低 100


class TestAccountRiskGuard:
    """账户层风控"""

    def test_max_drawdown_triggered(self):
        """账户回撤超限"""
        guard = AccountRiskGuard(AccountRiskConfig(max_drawdown_pct=-20.0))
        guard.peak_equity = 1_200_000
        # capital=900_000, drawdown = (900k - 1200k) / 1200k = -25%
        result = guard.check("600519", 100, 100, capital=900_000)
        assert not result.passed
        assert result.rule == "max_drawdown"
        assert result.action == "close_all"

    def test_no_drawdown(self):
        """回撤未超限"""
        guard = AccountRiskGuard(AccountRiskConfig(max_drawdown_pct=-20.0))
        guard.peak_equity = 1_000_000
        # capital=900_000, drawdown = -10%
        result = guard.check("600519", 100, 100, capital=900_000)
        assert result.passed

    def test_position_update_and_clear(self):
        """持仓更新和清除"""
        guard = AccountRiskGuard()
        guard.update_position("600519", 1000, 100)
        assert "600519" in guard.positions
        guard.update_position("600519", 0, 100)
        assert "600519" not in guard.positions


class TestPlatformRiskGuard:
    """平台层风控"""

    def test_blacklist_st(self):
        """ST 股票被拦截"""
        guard = PlatformRiskGuard()
        result = guard.check_blacklist("贵州茅台ST")
        assert not result.passed
        assert result.rule == "blacklist"

    def test_blacklist_normal(self):
        """正常股票通过"""
        guard = PlatformRiskGuard()
        result = guard.check_blacklist("贵州茅台")
        assert result.passed

    def test_abnormal_price(self):
        """委托价偏离最新价超 5%"""
        guard = PlatformRiskGuard(PlatformRiskConfig(abnormal_price_dev_pct=5.0))
        result = guard.check_price(order_price=110, last_price=100)
        assert not result.passed
        assert result.rule == "abnormal_price"

    def test_normal_price(self):
        """委托价在正常范围内"""
        guard = PlatformRiskGuard(PlatformRiskConfig(abnormal_price_dev_pct=5.0))
        result = guard.check_price(order_price=103, last_price=100)
        assert result.passed

    def test_limit_up_blocked(self):
        """涨停价禁止追买"""
        guard = PlatformRiskGuard(PlatformRiskConfig(limit_price_pct=10.0))
        result = guard.check_limit_price(order_price=110.1, pre_close=100)
        assert not result.passed
        assert result.rule == "limit_up"

    def test_limit_down_blocked(self):
        """跌停价禁止追卖"""
        guard = PlatformRiskGuard(PlatformRiskConfig(limit_price_pct=10.0))
        result = guard.check_limit_price(order_price=89.9, pre_close=100)
        assert not result.passed
        assert result.rule == "limit_down"

    def test_frequency_limit(self):
        """下单频率超限"""
        guard = PlatformRiskGuard(PlatformRiskConfig(max_order_per_minute=2))
        guard.check_frequency("test_strategy")
        guard.check_frequency("test_strategy")
        result = guard.check_frequency("test_strategy")
        assert not result.passed
        assert result.rule == "frequency"

    def test_t_plus_1_same_day(self):
        """T+1：当日买入当日卖出被拦截"""
        guard = PlatformRiskGuard(PlatformRiskConfig(respect_t_plus_1=True))
        result = guard.check_t_plus_1("600519", "2025-01-01", "2025-01-01")
        assert not result.passed
        assert result.rule == "t_plus_1"

    def test_t_plus_1_next_day(self):
        """T+1：次日卖出通过"""
        guard = PlatformRiskGuard(PlatformRiskConfig(respect_t_plus_1=True))
        result = guard.check_t_plus_1("600519", "2025-01-01", "2025-01-02")
        assert result.passed


class TestRiskManager:
    """三层风控统一入口"""

    def test_check_order_passes_all(self):
        """全部通过"""
        rm = RiskManager()
        result = rm.check_order(
            strategy_name="test", symbol="600519", symbol_name="贵州茅台",
            order_price=100, last_price=100, pre_close=100,
            qty=100, pos=0, capital=1_000_000,
        )
        assert result.passed

    def test_check_order_blacklist_first(self):
        """黑名单优先拦截（平台层最先检查）"""
        rm = RiskManager()
        result = rm.check_order(
            strategy_name="test", symbol="000001", symbol_name="ST某某",
            order_price=100, last_price=100, pre_close=100,
            qty=100, pos=0, capital=1_000_000,
        )
        assert not result.passed
        assert result.rule == "blacklist"

    def test_calc_position_size_delegates(self):
        """仓位计算委托到策略层"""
        rm = RiskManager(StrategyRiskConfig(max_position_pct=50.0))
        size = rm.calc_position_size(price=10, capital=1_000_000)
        assert size == 50000  # 500000 / 10


# ======================================================================
#  数据质量检测
# ======================================================================

class TestDataQuality:
    """utils/data_quality 单元测试"""

    @staticmethod
    def _write_csv(content: str) -> Path:
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False)
        f.write(content)
        f.close()
        return Path(f.name)

    def test_normal_data_score_100(self):
        """正常数据 → score=100"""
        csv = "date,open,high,low,close,volume\n"
        for i in range(30):
            csv += f"2025-01-{i+1:02d},100,105,99,103,{1000+i}\n"
        p = self._write_csv(csv)
        result = check_data_quality(p)
        p.unlink()
        assert result["score"] == 100

    def test_missing_date_column(self):
        """缺少 date 列 → score=0"""
        csv = "open,high,low,close\n100,105,99,103\n"
        p = self._write_csv(csv)
        result = check_data_quality(p)
        p.unlink()
        assert result["score"] == 0

    def test_high_less_than_low(self):
        """high < low → critical issue"""
        csv = "date,open,high,low,close,volume\n"
        csv += "2025-01-01,100,90,105,103,1000\n"
        csv += "2025-01-02,100,105,99,103,1000\n"
        p = self._write_csv(csv)
        result = check_data_quality(p)
        p.unlink()
        assert result["score"] < 100
        assert any(i["type"] == "critical" for i in result["issues"])

    def test_duplicate_dates(self):
        """重复日期 → critical issue"""
        csv = "date,open,high,low,close,volume\n"
        csv += "2025-01-01,100,105,99,103,1000\n"
        csv += "2025-01-01,100,105,99,103,1000\n"
        csv += "2025-01-02,100,105,99,103,1000\n"
        p = self._write_csv(csv)
        result = check_data_quality(p)
        p.unlink()
        assert any("重复日期" in i["message"] for i in result["issues"])

    def test_null_values_warning(self):
        """含 NaN → warning issue"""
        csv = "date,open,high,low,close,volume\n"
        csv += "2025-01-01,100,105,99,103,1000\n"
        csv += "2025-01-02,,105,99,103,1000\n"
        csv += "2025-01-03,100,105,99,103,1000\n"
        p = self._write_csv(csv)
        result = check_data_quality(p)
        p.unlink()
        assert any(i["type"] == "warning" and "缺失值" in i["message"] for i in result["issues"])


# ======================================================================
#  通知模块
# ======================================================================

class TestNotifier:
    """utils/notifier 单元测试"""

    def test_no_channels_no_error(self):
        """无配置任何渠道时 send 不报错"""
        n = Notifier()
        n.send("test title", "test content")  # 不应抛异常

    def test_send_backtest_result(self):
        """send_backtest_result 格式化正确"""
        n = Notifier()
        stats = {
            "total_return": 12.34,
            "sharpe_ratio": 1.56,
            "max_ddpercent": -8.76,
            "win_rate": 55.5,
        }
        n.send_backtest_result("DualMa", "600519", stats)  # 不应抛异常

    def test_signal_generator_buy_signal(self):
        """买入信号：仓位从 0 → 100"""
        n = Notifier()
        gen = SignalGenerator(notifier=n)
        gen.check_signal("test", "600519", "trade", 100.0, 100)
        assert gen.positions["600519"] == 100

    def test_signal_generator_sell_signal(self):
        """卖出信号：仓位从 100 → 0"""
        n = Notifier()
        gen = SignalGenerator(notifier=n)
        gen.positions["600519"] = 100
        gen.check_signal("test", "600519", "trade", 110.0, 0)
        assert gen.positions["600519"] == 0

    def test_signal_generator_no_change(self):
        """仓位不变时不发送通知"""
        n = Notifier()
        gen = SignalGenerator(notifier=n)
        gen.positions["600519"] = 100
        gen.check_signal("test", "600519", "trade", 100.0, 100)
        # 仓位不变，positions 不更新
        assert gen.positions["600519"] == 100


# ==================== NL 解析器测试 ====================

class TestNlParser:
    """自然语言策略解析器测试"""

    def test_basic_ma_golden_cross(self):
        """基本均线金叉买入"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("5日均线金叉20日均线买入")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["op"] == "cross_above"
        assert r["unmatched"] == []

    def test_basic_ma_death_cross_sell(self):
        """基本均线死叉卖出"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("5日均线下穿20日均线卖出")
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["op"] == "cross_below"

    def test_context_inherit_death_cross(self):
        """上下文继承：买入指定均线，卖出简写'死叉'"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("5日均线金叉20日均线买入，死叉卖出")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1
        sell = r["sell_conditions"][0]
        assert sell["op"] == "cross_below"
        assert sell["left"]["indicator"] == "ma"
        assert sell["left"]["params"]["period"] == 5
        assert sell["right"]["indicator"] == "ma"
        assert sell["right"]["params"]["period"] == 20

    def test_context_inherit_rsi_above(self):
        """上下文继承：RSI买入条件，'高于70卖出'继承RSI"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("RSI低于30买入，高于70卖出")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1
        sell = r["sell_conditions"][0]
        assert sell["op"] == ">"
        assert sell["left"]["indicator"] == "rsi"
        assert sell["right"]["value"] == 70

    def test_macd_death_cross(self):
        """MACD死叉卖出"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("MACD金叉买入，MACD死叉卖出")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["op"] == "cross_below"

    def test_kdj_death_cross(self):
        """KDJ死叉卖出"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("KDJ超卖买入，KDJ死叉卖出")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["op"] == "cross_below"
        assert r["sell_conditions"][0]["left"]["indicator"] == "kdj"

    def test_boll_middle_band(self):
        """布林中轨突破/跌破"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("突破中轨买入，跌破中轨卖出")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["op"] == "<"
        assert r["sell_conditions"][0]["right"]["indicator"] == "boll"

    def test_bare_super_overbought(self):
        """简写'超买'→RSI>70"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("超买卖出")
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["op"] == ">"
        assert r["sell_conditions"][0]["left"]["indicator"] == "rsi"

    def test_bare_supersold(self):
        """简写'超卖'→RSI<30"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("超卖买入")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["op"] == "<"
        assert r["buy_conditions"][0]["left"]["indicator"] == "rsi"

    def test_volume_conditions(self):
        """放量/缩量"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("放量买入，缩量卖出")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1

    def test_complex_strategy(self):
        """复合策略：多条件"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("5日均线金叉20日均线买入，RSI超买卖出，跌破10块止损")
        assert len(r["buy_conditions"]) >= 1
        assert len(r["sell_conditions"]) >= 1

    def test_no_conditions_returns_empty(self):
        """无条件输入"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("今天天气不错")
        assert r["buy_conditions"] == []
        assert r["sell_conditions"] == []

    def test_chinese_numbers(self):
        """中文数字支持"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("站上二十日均线买入")
        assert len(r["buy_conditions"]) == 1

    def test_explanation_generated(self):
        """生成中文说明"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("5日均线金叉20日均线买入")
        assert "买入" in r["explanation"]

    def test_context_inherit_kdj_above(self):
        """上下文继承：KDJ买入，'高于80卖出'继承KDJ"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("KDJ超卖买入，高于80卖出")
        assert len(r["sell_conditions"]) == 1
        sell = r["sell_conditions"][0]
        assert sell["left"]["indicator"] == "kdj"
        assert sell["right"]["value"] == 80


class TestNlMultiStock:
    """多股票自然语言解析测试"""

    def test_two_stocks(self):
        """识别两只股票各自的规则"""
        from utils.nl_parser import parse_nl_multi
        results = parse_nl_multi("茅台亏百分之十就卖 杭州柯林涨到150就卖")
        assert len(results) == 2
        assert results[0]["stock_code"] == "600519"
        assert len(results[0]["sell_conditions"]) == 1
        assert results[1]["stock_name"] == "杭州柯林"
        assert len(results[1]["sell_conditions"]) == 1

    def test_chinese_percent(self):
        """中文百分之N识别"""
        from utils.nl_parser import parse_nl_multi
        results = parse_nl_multi("茅台亏了百分之二十就跑")
        assert len(results) == 1
        assert results[0]["sell_conditions"][0]["right"]["value"] == -20.0

    def test_no_stock_returns_unknown(self):
        """没有股票名时返回unknown"""
        from utils.nl_parser import parse_nl_multi
        results = parse_nl_multi("涨了就买，跌了就卖")
        assert len(results) == 1
        assert results[0]["stock_name"] == "unknown"

    def test_short_stock_name(self):
        """简称匹配（茅台→贵州茅台）"""
        from utils.nl_parser import parse_nl_multi
        results = parse_nl_multi("茅台跌破1000就买")
        assert results[0]["stock_code"] == "600519"

    def test_price_condition(self):
        """绝对价格条件"""
        from utils.nl_parser import parse_nl_multi
        results = parse_nl_multi("五粮液跌破50块就买")
        assert results[0]["stock_code"] == "000858"
        assert results[0]["buy_conditions"][0]["right"]["value"] == 50.0


# ==================== 分钟数据模块测试 ====================

class TestMinuteData:
    """分钟K线数据模块测试"""

    def test_period_map(self):
        """周期映射正确性"""
        from utils.minute_data import PERIOD_MAP
        assert PERIOD_MAP["5"] == 5
        assert PERIOD_MAP["15m"] == 15
        assert PERIOD_MAP["60"] == 60

    def test_sina_symbol_format(self):
        """股票代码转新浪格式"""
        from utils.minute_data import _get_sina_symbol
        assert _get_sina_symbol("600519") == "sh600519"
        assert _get_sina_symbol("000001") == "sz000001"
        assert _get_sina_symbol("300750") == "sz300750"

    def test_fetch_returns_list(self):
        """fetch_minute_klines 返回列表"""
        from utils.minute_data import fetch_minute_klines
        bars = fetch_minute_klines("600519", "60", limit=5)
        assert isinstance(bars, list)
        if bars:
            assert "datetime" in bars[0]
            assert "open" in bars[0]
            assert "close" in bars[0]
            assert "high" in bars[0]
            assert "low" in bars[0]
            assert "volume" in bars[0]

    def test_fetch_with_info(self):
        """fetch_minute_klines_with_info 包含元信息"""
        from utils.minute_data import fetch_minute_klines_with_info
        info = fetch_minute_klines_with_info("600519", "60", limit=5)
        assert "name" in info
        assert "symbol" in info
        assert "count" in info
        assert info["symbol"] == "600519"
        assert info["count"] <= 5

    def test_to_vnpy_bars(self):
        """to_vnpy_bars 转换正确"""
        from utils.minute_data import to_vnpy_bars
        bars = [
            {"datetime": "2026-05-29 10:00:00", "open": 100, "high": 105, "low": 99, "close": 103, "volume": 1000, "amount": 0},
        ]
        vnpy_bars = to_vnpy_bars("600519", bars)
        assert len(vnpy_bars) == 1
        assert vnpy_bars[0].symbol == "600519"
        assert vnpy_bars[0].open_price == 100
        assert vnpy_bars[0].close_price == 103


# ==================== 券商模块测试 ====================

class TestBroker:
    """实盘交易模块测试"""

    def test_broker_map(self):
        """券商映射正确"""
        from utils.broker import BROKER_MAP
        assert "yh" in BROKER_MAP
        assert "ht" in BROKER_MAP
        assert BROKER_MAP["银河"]["key"] == "yh"

    def test_status_disconnected(self):
        """初始状态未连接"""
        from utils.broker import get_status, disconnect
        disconnect()  # 确保断开
        status = get_status()
        assert status["connected"] is False

    def test_balance_without_connection(self):
        """未连接时查询资金返回错误"""
        from utils.broker import get_balance, disconnect
        disconnect()
        result = get_balance()
        assert "error" in result

    def test_buy_validation(self):
        """买入数量校验 — mock已连接状态"""
        import utils.broker as broker_mod
        from utils.broker import buy, disconnect
        disconnect()
        # 模拟已连接状态以触发数量校验
        broker_mod._broker_instance = object()
        try:
            result = buy("600519", 100.0, 50)  # 不是100整数倍
            assert "error" in result
            assert "100" in result["error"]
        finally:
            broker_mod._broker_instance = None

    def test_sell_validation(self):
        """卖出数量校验"""
        from utils.broker import sell, disconnect
        disconnect()
        result = sell("600519", 100.0, 0)
        assert "error" in result

    def test_connect_invalid_broker(self):
        """连接无效券商返回错误"""
        from utils.broker import connect
        result = connect("invalid_broker")
        assert result["status"] == "error"
        assert "不支持" in result["message"]


# ==================== NL解析器边界测试 ====================

class TestNlParserEdgeCases:
    """NL解析器边界情况测试"""

    def test_empty_input(self):
        """空输入"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("")
        assert r["buy_conditions"] == []
        assert r["sell_conditions"] == []

    def test_percent_zhi(self):
        """中文百分之"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("亏百分之十就卖")
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["right"]["value"] == -10.0

    def test_percent_er_shi(self):
        """中文百分之二十"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("亏百分之二十就卖")
        assert r["sell_conditions"][0]["right"]["value"] == -20.0

    def test_multi_stock_two_rules(self):
        """多股票两条规则"""
        from utils.nl_parser import parse_nl_multi
        r = parse_nl_multi("宁德时代RSI低于30买入，比亚迪涨了20%就卖")
        assert len(r) == 2
        assert r[0]["stock_code"] == "300750"
        assert r[1]["stock_code"] == "002594"

    def test_multi_stock_single(self):
        """单股票"""
        from utils.nl_parser import parse_nl_multi
        r = parse_nl_multi("五粮液跌破50块就买")
        assert len(r) == 1
        assert r[0]["stock_code"] == "000858"

    def test_context_inherit_all_loose(self):
        """买卖都是简写，默认RSI"""
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("跌到底了就买，涨到头了就卖")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1
        assert r["buy_conditions"][0]["left"]["indicator"] == "rsi"
        assert r["sell_conditions"][0]["left"]["indicator"] == "rsi"
