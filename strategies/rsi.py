"""RSI 策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class RsiStrategy(RiskStrategy):
    """RSI 超买超卖 + 止损止盈"""

    rsi_window: int = 14
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0

    parameters = ["rsi_window", "rsi_oversold", "rsi_overbought"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(self.rsi_window)

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        rsi = am.rsi(self.rsi_window)

        if rsi < self.rsi_oversold and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        elif rsi > self.rsi_overbought and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
