"""动量策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class MomentumStrategy(RiskStrategy):
    """动量策略：N日收益率突破阈值买入，跌破卖出"""

    lookback: int = 20       # 动量观察窗口
    buy_threshold: float = 5.0    # 买入阈值（%）
    sell_threshold: float = -3.0  # 卖出阈值（%）

    parameters = ["lookback", "buy_threshold", "sell_threshold"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(self.lookback + 1)

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        # 动量 = (当前价 - N日前价) / N日前价 * 100
        if len(am.close) < self.lookback + 1:
            return

        prev_close = am.close[-self.lookback - 1]
        if prev_close <= 0:
            return

        momentum = (bar.close_price - prev_close) / prev_close * 100

        if momentum > self.buy_threshold and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        elif momentum < self.sell_threshold and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
