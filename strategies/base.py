"""带风控的策略基类（三层风控）"""
from vnpy_ctastrategy import CtaTemplate
from vnpy.trader.object import BarData, TradeData
from vnpy.trader.utility import ArrayManager
from utils.risk_manager import (
    RiskManager, StrategyRiskConfig, AccountRiskConfig, PlatformRiskConfig,
)
from utils.notifier import Notifier, SignalGenerator


class RiskStrategy(CtaTemplate):
    """带三层风控的策略基类"""

    # 风控参数（子类可覆盖，前端可通过 setting 传入）
    stop_loss_pct: float = -5.0
    take_profit_pct: float = 15.0
    trailing_stop_pct: float = -8.0
    max_drawdown_pct: float = -20.0
    max_daily_loss_pct: float = -5.0
    position_size: int = 100

    risk_parameters = [
        "stop_loss_pct", "take_profit_pct",
        "trailing_stop_pct", "max_drawdown_pct",
        "max_daily_loss_pct", "position_size",
    ]

    # 信号推送（类级别共享）
    _notifier: Notifier = None
    _signal_gen: SignalGenerator = None

    @classmethod
    def setup_notifier(cls, dingtalk_url: str = None, wechat_url: str = None):
        cls._notifier = Notifier(dingtalk_url=dingtalk_url, wechat_url=wechat_url)
        cls._signal_gen = SignalGenerator(notifier=cls._notifier)

    def __init__(self, cta_engine, strategy_name, vt_symbol, setting):
        super().__init__(cta_engine, strategy_name, vt_symbol, setting)
        self.am = ArrayManager(size=200)
        self.risk = RiskManager(
            strategy_config=StrategyRiskConfig(
                stop_loss_pct=self.stop_loss_pct,
                take_profit_pct=self.take_profit_pct,
                trailing_stop_pct=self.trailing_stop_pct,
                max_daily_loss_pct=self.max_daily_loss_pct,
            ),
            account_config=AccountRiskConfig(
                max_drawdown_pct=self.max_drawdown_pct,
            ),
        )
        self.entry_price = 0.0

    def on_trade(self, trade: TradeData):
        """成交回调 → 更新风控状态 + 推送信号"""
        super().on_trade(trade)
        if self.pos > 0 and self.entry_price == 0:
            self.entry_price = trade.price
        elif self.pos == 0:
            self.entry_price = 0.0

        self.risk.on_trade(trade.price, self.pos, 1_000_000)

        if self._signal_gen:
            self._signal_gen.check_signal(
                strategy_name=self.strategy_name,
                symbol=self.vt_symbol,
                signal="trade",
                price=trade.price,
                pos=self.pos,
            )

    def check_risk(self, bar: BarData) -> bool:
        """三层风控检查，触发则平仓"""
        if self.pos <= 0:
            return False

        result = self.risk.strategy.check(bar.close_price, self.pos, 1_000_000)
        if not result.passed:
            self.write_log(f"[{result.level}] {result.message}")
            self.sell(bar.close_price, self.pos)
            return True

        return False

    def buy_with_risk(self, price: float):
        """带风控的买入"""
        size = self.risk.calc_position_size(price, 1_000_000)
        self.buy(price, size)

    def sell_with_risk(self, price: float):
        """带风控的卖出"""
        if self.pos > 0:
            self.sell(price, self.pos)
