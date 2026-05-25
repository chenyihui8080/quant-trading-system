"""KDJ 策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class KdjStrategy(RiskStrategy):
    """KDJ 金叉死叉 + 超买超卖过滤 + 止损止盈"""

    kdj_window: int = 9
    kdj_signal: int = 3
    oversold: float = 20.0
    overbought: float = 80.0

    parameters = [
        "kdj_window", "kdj_signal", "oversold", "overbought",
    ] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(self.kdj_window)

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        # vnpy stoch 返回 (K, D)，J = 3K - 2D
        k, d = am.stoch(
            self.kdj_window, self.kdj_signal, 0,
            self.kdj_signal, 0,
        )
        j = 3 * k - 2 * d

        # J 线从超卖区向上穿越 → 买入
        if j < self.oversold and k > d and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        # J 线从超买区向下穿越 → 卖出
        elif j > self.overbought and k < d and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
