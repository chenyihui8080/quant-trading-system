"""风控模块：三层风控架构（策略层 / 账户层 / 平台层）"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# ==================== 配置 ====================

@dataclass
class StrategyRiskConfig:
    """策略层风控配置"""
    stop_loss_pct: float = -5.0       # 止损
    take_profit_pct: float = 15.0     # 止盈
    trailing_stop_pct: float = -8.0   # 移动止损（从最高点回落）
    max_position_pct: float = 30.0    # 单只最大仓位占比
    max_daily_loss_pct: float = -5.0  # 策略单日最大亏损


@dataclass
class AccountRiskConfig:
    """账户层风控配置"""
    max_drawdown_pct: float = -20.0   # 账户最大回撤
    max_single_concentration: float = 30.0  # 单品种持仓集中度 %
    max_total_position_pct: float = 80.0    # 总持仓占总资产上限 %
    max_leverage: float = 1.0         # 最大杠杆倍数（股票=1）


@dataclass
class PlatformRiskConfig:
    """平台层风控配置"""
    blacklist: list[str] = field(default_factory=lambda: ["ST", "*ST", "退市"])
    limit_price_pct: float = 10.0     # 涨跌停幅度（科创板/创业板=20%）
    abnormal_price_dev_pct: float = 5.0  # 委托价偏离最新价超此比例则拦截
    max_order_per_minute: int = 30    # 单策略每分钟最大下单数
    respect_t_plus_1: bool = True     # 是否执行 T+1 规则


# ==================== 风控结果 ====================

@dataclass
class RiskResult:
    """风控校验结果"""
    passed: bool
    level: str           # "strategy" / "account" / "platform"
    rule: str            # 触发的规则名
    message: str         # 人类可读说明
    action: str = "reject"  # "reject" 拒绝 / "close_all" 全平 / "warn" 仅警告


def passed_result() -> RiskResult:
    return RiskResult(passed=True, level="", rule="", message="")


# ==================== 策略层风控 ====================

class StrategyRiskGuard:
    """策略层：单策略维度的风控"""

    def __init__(self, config: StrategyRiskConfig = None):
        self.config = config or StrategyRiskConfig()
        self.entry_price: float = 0.0
        self.highest_price: float = 0.0
        self.daily_pnl: float = 0.0
        self.daily_reset_date: str = ""

    def on_trade(self, price: float, pos: int, qty: int = 0):
        """成交回调（qty 默认按 pos 增量推断；显式传入更精确）"""
        now = datetime.now().strftime("%Y-%m-%d")
        if now != self.daily_reset_date:
            self.daily_pnl = 0.0
            self.daily_reset_date = now

        if pos > 0 and self.entry_price == 0:
            self.entry_price = price
            self.highest_price = price
        elif pos > 0 and self.entry_price > 0:
            # 加仓：按加权平均更新成本
            trade_qty = qty if qty > 0 else pos
            self.entry_price = (self.entry_price * (pos - trade_qty) + price * trade_qty) / pos if pos > 0 else price
            self.highest_price = max(self.highest_price, price)
        elif pos == 0:
            if self.entry_price > 0 and qty > 0:
                # 平仓：按本次成交股数累计盈亏
                self.daily_pnl += (price - self.entry_price) * qty
            self.entry_price = 0.0
            self.highest_price = 0.0

    def check(self, price: float, pos: int, capital: float) -> RiskResult:
        """策略层风控校验"""
        if pos <= 0:
            return passed_result()
        if self.entry_price <= 0:
            return RiskResult(
                passed=False, level="strategy", rule="missing_entry",
                message="缺少有效入场价，无法计算盈亏比",
            )

        # 止损
        pnl_pct = (price - self.entry_price) / self.entry_price * 100
        if pnl_pct <= self.config.stop_loss_pct:
            return RiskResult(
                passed=False, level="strategy", rule="stop_loss",
                message=f"止损触发：亏损 {pnl_pct:.2f}%（阈值 {self.config.stop_loss_pct}%）",
            )

        # 止盈
        if pnl_pct >= self.config.take_profit_pct:
            return RiskResult(
                passed=False, level="strategy", rule="take_profit",
                message=f"止盈触发：盈利 {pnl_pct:.2f}%（阈值 {self.config.take_profit_pct}%）",
            )

        # 移动止损
        self.highest_price = max(self.highest_price, price)
        drawdown = (price - self.highest_price) / self.highest_price * 100
        if drawdown <= self.config.trailing_stop_pct and pnl_pct > 0:
            return RiskResult(
                passed=False, level="strategy", rule="trailing_stop",
                message=f"移动止损：从最高点回落 {drawdown:.2f}%",
            )

        # 单日最大亏损
        if self.daily_pnl < 0:
            daily_pnl_pct = self.daily_pnl / capital * 100
            if daily_pnl_pct <= self.config.max_daily_loss_pct:
                return RiskResult(
                    passed=False, level="strategy", rule="daily_loss",
                    message=f"策略单日亏损 {daily_pnl_pct:.2f}%（阈值 {self.config.max_daily_loss_pct}%）",
                )

        return passed_result()

    def calc_position_size(self, price: float, capital: float) -> int:
        """计算仓位大小"""
        max_amount = capital * self.config.max_position_pct / 100
        shares = int(max_amount / price)
        return max(shares // 100 * 100, 100)


# ==================== 账户层风控 ====================

class AccountRiskGuard:
    """账户层：跨策略、账户维度的风控"""

    def __init__(self, config: AccountRiskConfig = None):
        self.config = config or AccountRiskConfig()
        self.peak_equity: float = 0.0
        self.positions: dict[str, dict] = {}  # symbol -> {qty, cost, market_value}

    def update_equity(self, equity: float):
        """更新账户净值"""
        if equity > self.peak_equity:
            self.peak_equity = equity

    def update_position(self, symbol: str, qty: int, price: float):
        """更新持仓信息"""
        if qty <= 0:
            self.positions.pop(symbol, None)
        else:
            self.positions[symbol] = {
                "qty": qty, "price": price,
                "market_value": qty * price,
            }

    def check(self, symbol: str, price: float, qty: int, capital: float) -> RiskResult:
        """账户层风控校验"""
        total_position_value = sum(p["market_value"] for p in self.positions.values())

        # 最大回撤
        if self.peak_equity > 0:
            drawdown = (capital - self.peak_equity) / self.peak_equity * 100
            if drawdown <= self.config.max_drawdown_pct:
                return RiskResult(
                    passed=False, level="account", rule="max_drawdown",
                    message=f"账户最大回撤触发：回撤 {drawdown:.2f}%",
                    action="close_all",
                )

        # 总持仓比例
        new_total = total_position_value + qty * price
        total_pct = new_total / capital * 100 if capital > 0 else 0
        if total_pct > self.config.max_total_position_pct:
            return RiskResult(
                passed=False, level="account", rule="total_position",
                message=f"总持仓 {total_pct:.1f}% 超限（上限 {self.config.max_total_position_pct}%）",
            )

        # 单品种集中度
        symbol_value = self.positions.get(symbol, {}).get("market_value", 0) + qty * price
        concentration = symbol_value / capital * 100 if capital > 0 else 0
        if concentration > self.config.max_single_concentration:
            return RiskResult(
                passed=False, level="account", rule="concentration",
                message=f"{symbol} 持仓集中度 {concentration:.1f}% 超限（上限 {self.config.max_single_concentration}%）",
            )

        return passed_result()


# ==================== 平台层风控 ====================

class PlatformRiskGuard:
    """平台层：全局规则，所有策略共同遵守"""

    def __init__(self, config: PlatformRiskConfig = None):
        self.config = config or PlatformRiskConfig()
        self.order_timestamps: dict[str, list[float]] = {}  # strategy -> [timestamp...]

    def check_blacklist(self, symbol_name: str) -> RiskResult:
        """检查品种黑名单"""
        for keyword in self.config.blacklist:
            if keyword in symbol_name:
                return RiskResult(
                    passed=False, level="platform", rule="blacklist",
                    message=f"{symbol_name} 命中黑名单关键词「{keyword}」",
                )
        return passed_result()

    def check_price(self, order_price: float, last_price: float) -> RiskResult:
        """检查异常价格"""
        if last_price <= 0:
            return passed_result()
        dev = abs(order_price - last_price) / last_price * 100
        if dev >= self.config.abnormal_price_dev_pct:
            return RiskResult(
                passed=False, level="platform", rule="abnormal_price",
                message=f"委托价 {order_price} 偏离最新价 {last_price} 达 {dev:.1f}%（上限 {self.config.abnormal_price_dev_pct}%）",
            )
        return passed_result()

    def check_limit_price(
        self,
        order_price: float,
        pre_close: float,
        side: str | None = None,
        market: str = "main",
    ) -> RiskResult:
        """涨跌停保护；显式方向优先，旧调用按委托价相对昨收价推断方向。"""
        if side is None:
            side = "buy" if order_price >= pre_close else "sell"
        if pre_close <= 0:
            return RiskResult(
                passed=False, level="platform", rule="limit_price",
                message="缺少昨收价，无法做涨跌停校验",
            )
        limit_pct = self.config.limit_price_pct
        if market in ("star", "chinext", "创业板", "科创板"):
            limit_pct = 20.0
        elif market in ("bj", "北交所"):
            limit_pct = 30.0
        elif market in ("st",):
            limit_pct = 5.0

        if side == "buy":
            upper = pre_close * (1 + limit_pct / 100)
            if order_price >= upper:
                return RiskResult(
                    passed=False, level="platform", rule="limit_up",
                    message=f"涨停价 {upper:.2f} 禁止追买（{market} 涨幅上限 {limit_pct}%）",
                )
        else:
            lower = pre_close * (1 - limit_pct / 100)
            if order_price <= lower:
                return RiskResult(
                    passed=False, level="platform", rule="limit_down",
                    message=f"跌停价 {lower:.2f} 禁止追卖（{market} 跌幅上限 {limit_pct}%）",
                )
        return passed_result()

    def check_frequency(self, strategy_name: str, commit: bool = True) -> RiskResult:
        """下单频率限制；commit=False 表示仅校验不计数（用于拒绝前不递增）"""
        now = datetime.now().timestamp()
        timestamps = self.order_timestamps.setdefault(strategy_name, [])
        # 清理 1 分钟前的记录
        timestamps[:] = [t for t in timestamps if now - t < 60]
        if len(timestamps) >= self.config.max_order_per_minute:
            return RiskResult(
                passed=False, level="platform", rule="frequency",
                message=f"策略 {strategy_name} 1分钟内下单 {len(timestamps)} 次，超限 {self.config.max_order_per_minute}",
            )
        if commit:
            timestamps.append(now)
        return passed_result()

    def check_t_plus_1(self, symbol: str, buy_date: str, sell_date: str) -> RiskResult:
        """T+1 规则校验"""
        if not self.config.respect_t_plus_1:
            return passed_result()
        if buy_date == sell_date:
            return RiskResult(
                passed=False, level="platform", rule="t_plus_1",
                message=f"A股 T+1 限制：{symbol} 当日买入不可当日卖出",
            )
        return passed_result()


# ==================== 统一风控入口 ====================

class RiskManager:
    """三层风控统一入口"""

    def __init__(
        self,
        strategy_config: StrategyRiskConfig = None,
        account_config: AccountRiskConfig = None,
        platform_config: PlatformRiskConfig = None,
    ):
        self.strategy = StrategyRiskGuard(strategy_config)
        self.account = AccountRiskGuard(account_config)
        self.platform = PlatformRiskGuard(platform_config)

    def check_order(
        self,
        strategy_name: str,
        symbol: str,
        symbol_name: str,
        order_price: float,
        last_price: float,
        pre_close: float,
        qty: int,
        pos: int,
        capital: float,
        buy_date: str = "",
        sell_date: str = "",
        side: str = "buy",
        market: str = "main",
    ) -> RiskResult:
        """下单前全量风控校验（依次执行 平台→账户→策略）。
        关键字段缺失时 fail-closed（直接拒绝）以避免绕过。"""
        if not strategy_name or not symbol:
            return RiskResult(False, "platform", "missing_field", "策略名/标的代码不能为空")
        if order_price <= 0 or last_price <= 0:
            return RiskResult(False, "platform", "invalid_price", "委托价/最新价必须为正")
        if qty <= 0:
            return RiskResult(False, "platform", "invalid_qty", "下单数量必须为正")
        if qty % 100 != 0:
            return RiskResult(False, "platform", "lot_size", "下单数量必须为 100 的整数倍")
        if capital <= 0:
            return RiskResult(False, "account", "invalid_capital", "可用资金必须为正")

        # 平台层
        r = self.platform.check_blacklist(symbol_name)
        if not r.passed:
            return r

        r = self.platform.check_price(order_price, last_price)
        if not r.passed:
            return r

        r = self.platform.check_limit_price(
            order_price, pre_close, side=side, market=market
        )
        if not r.passed:
            return r

        r = self.platform.check_frequency(strategy_name, commit=False)
        if not r.passed:
            return r

        if buy_date and sell_date:
            r = self.platform.check_t_plus_1(symbol, buy_date, sell_date)
            if not r.passed:
                return r

        # 全部通过后提交频率计数
        self.platform.check_frequency(strategy_name, commit=True)

        # 账户层
        r = self.account.check(symbol, order_price, qty, capital)
        if not r.passed:
            return r

        # 策略层（仅持仓时校验）
        if pos > 0:
            r = self.strategy.check(last_price, pos, capital)
            if not r.passed:
                return r

        return passed_result()

    # 兼容旧接口
    def on_trade(self, price: float, pos: int, capital: float):
        """成交回调（兼容旧代码）"""
        self.strategy.on_trade(price, pos)
        self.account.update_equity(capital)

    def check_stop_loss(self, price: float) -> str | None:
        """兼容旧接口：止损检查"""
        if self.strategy.entry_price <= 0:
            return None
        result = self.strategy.check(price, 1, 1_000_000)
        if not result.passed:
            return result.message
        return None

    def check_drawdown(self, current_equity: float | None = None) -> str | None:
        """兼容旧接口：回撤检查"""
        peak = self.account.peak_equity
        if peak <= 0:
            return None
        if current_equity is None:
            return None
        drawdown = (current_equity - peak) / peak * 100
        if drawdown <= self.account.config.max_drawdown_pct:
            return f"账户最大回撤 {drawdown:.2f}% 触发（上限 {self.account.config.max_drawdown_pct}%）"
        return None

    def calc_position_size(self, price: float, capital: float) -> int:
        """兼容旧接口"""
        return self.strategy.calc_position_size(price, capital)
