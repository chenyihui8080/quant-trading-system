"""海龟策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class TurtleStrategy(RiskStrategy):
    """海龟突破策略：突破N日高点买入，跌破M日低点卖出"""

    entry_window: int = 20
    exit_window: int = 10

    parameters = ["entry_window", "exit_window"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(max(self.entry_window, self.exit_window))

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        # donchian(n) 返回 (upper, lower) 唐奇安通道
        entry_high, _ = am.donchian(self.entry_window)
        _, exit_low = am.donchian(self.exit_window)

        if bar.close_price > entry_high and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        elif bar.close_price < exit_low and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
