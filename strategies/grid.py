"""网格交易策略（带风控）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy


class GridStrategy(RiskStrategy):
    """固定价格网格：下跌触网买入，上涨触网卖出"""

    grid_pct: float = 3.0       # 网格间距百分比
    max_grids: int = 5          # 最大网格层数

    parameters = ["grid_pct", "max_grids"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(10)

    def on_start(self):
        self.grid_base = 0.0     # 网格基准价
        self.grid_count = 0      # 当前网格持仓层数

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        price = bar.close_price

        # 首次进入，以当前价为网格基准
        if self.grid_base == 0:
            self.grid_base = price
            return

        pct_change = (price - self.grid_base) / self.grid_base * 100

        # 下跌触网 → 买入一层
        if pct_change <= -self.grid_pct and self.grid_count < self.max_grids:
            self.buy_with_risk(price)
            self.grid_count += 1
            self.grid_base = price  # 基准下移
        # 上涨触网 → 卖出一层
        elif pct_change >= self.grid_pct and self.grid_count > 0:
            self.sell_with_risk(price)
            self.grid_count -= 1
            self.grid_base = price  # 基准上移

        self.put_event()
