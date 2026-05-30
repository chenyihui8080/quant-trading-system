"""ATR 通道突破策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class AtrBreakoutStrategy(RiskStrategy):
    """ATR 通道突破：价格突破 N 倍 ATR 通道买入/卖出"""

    atr_window: int = 14      # ATR 窗口
    atr_multiplier: float = 2.0  # ATR 倍数
    ma_filter: int = 50       # 趋势过滤均线

    parameters = ["atr_window", "atr_multiplier", "ma_filter"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(max(self.atr_window, self.ma_filter))

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        atr = am.atr(self.atr_window)
        ma = am.sma(self.ma_filter)

        if atr <= 0 or ma <= 0:
            return

        upper = ma + self.atr_multiplier * atr
        lower = ma - self.atr_multiplier * atr

        # 趋势过滤：只在均线之上做多
        if bar.close_price > upper and self.pos == 0 and bar.close_price > ma:
            self.buy_with_risk(bar.close_price)
        elif bar.close_price < lower and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()
