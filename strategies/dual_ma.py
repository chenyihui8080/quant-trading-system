"""双均线策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class DualMaStrategy(RiskStrategy):
    """快慢均线金叉死叉 + 止损止盈"""

    fast_window: int = 10
    slow_window: int = 30

    parameters = ["fast_window", "slow_window"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(self.slow_window)

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        # 先检查风控
        if self.check_risk(bar):
            return

        fast_ma = am.sma(self.fast_window)
        slow_ma = am.sma(self.slow_window)

        if fast_ma > slow_ma and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        elif fast_ma < slow_ma and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
