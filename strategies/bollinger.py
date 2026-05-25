"""布林带策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class BollingerStrategy(RiskStrategy):
    """布林带突破 + 止损止盈"""

    boll_window: int = 20
    boll_dev: float = 2.0

    parameters = ["boll_window", "boll_dev"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(self.boll_window)

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        up, mid, down = am.boll(self.boll_window, self.boll_dev)

        if bar.close_price > up and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        elif bar.close_price < mid and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
