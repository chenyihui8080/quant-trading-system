"""均值回归策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class MeanReversionStrategy(RiskStrategy):
    """均值回归：价格偏离均线过多时反向交易"""

    ma_window: int = 20       # 均线窗口
    entry_std: float = 2.0    # 入场标准差倍数
    exit_std: float = 0.5     # 出场标准差倍数

    parameters = ["ma_window", "entry_std", "exit_std"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(self.ma_window)

    def on_start(self):
        pass

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        ma = am.sma(self.ma_window)
        std = am.std(self.ma_window)

        if std <= 0:
            return

        z_score = (bar.close_price - ma) / std

        # 超卖买入（价格低于均线 2 个标准差）
        if z_score < -self.entry_std and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        # 超买卖出（价格高于均线 2 个标准差）
        elif z_score > self.entry_std and self.pos > 0:
            self.sell_with_risk(bar.close_price)
        # 回归均线附近平仓
        elif self.pos > 0 and abs(z_score) < self.exit_std:
            self.sell_with_risk(bar.close_price)

        self.put_event()
