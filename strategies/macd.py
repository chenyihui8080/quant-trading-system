"""MACD 策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class MacdStrategy(RiskStrategy):
    """MACD 金叉死叉 + 零轴过滤 + 止损止盈"""

    fast_window: int = 12
    slow_window: int = 26
    signal_window: int = 9

    parameters = ["fast_window", "slow_window", "signal_window"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(self.slow_window)

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        macd, signal, hist = am.macd(
            self.fast_window, self.slow_window, self.signal_window
        )

        if macd > signal and macd > 0 and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        elif macd < signal and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
