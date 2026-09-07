"""实盘持仓与自选监控智能顾问核心 (Portfolio Advisor)

包含：
1. 实盘持仓管理 (增删改查、Excel导入、图片OCR解析入库)
2. 持仓盈亏与量化深度诊断 (精确买卖指令、止盈止损、减仓股数、底层量化逻辑)
3. 自选股跟踪池与即时测算
"""
import json
import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from utils.realtime import get_realtime_quote, get_realtime_kline
from utils.alpha_engine import alpha_engine

DATA_FILE = Path(__file__).parent.parent / "data" / "portfolio.json"


@dataclass
class PositionItem:
    """单个持仓标的"""
    symbol: str                          # 股票代码
    name: str                            # 股票名称
    shares: int                          # 持仓股数 (股)
    cost_price: float                    # 买入成本均价 (元)
    current_price: float = 0.0           # 当前实时价格 (元)
    market_value: float = 0.0            # 最新持仓市值 (元)
    cost_amount: float = 0.0             # 买入总成本金额 (元，精确对齐券商)
    pnl_amount: float = 0.0              # 累计持仓盈亏额 (元)
    pnl_pct: float = 0.0                 # 累计持仓盈亏比例 %
    today_pnl_amount: float = 0.0        # 当日参考盈亏额 (元)
    today_pnl_pct: float = 0.0           # 今日涨跌幅 %
    buy_date: str = ""                   # 建仓日期 (YYYY-MM-DD)
    notes: str = ""                      # 交易备注


@dataclass
class WatchlistItem:
    """自选监控标的"""
    symbol: str                          # 股票代码
    name: str                            # 股票名称
    current_price: float = 0.0           # 当前实时价格 (元)
    change_pct: float = 0.0              # 今日涨跌幅 %
    add_date: str = ""                   # 加入自选日期
    notes: str = ""                      # 跟踪逻辑与看点备注


@dataclass
class PositionDiagnostic:
    """持仓全方位量化深度诊断输出"""
    symbol: str
    name: str
    shares: int
    cost_price: float
    current_price: float
    market_value: float
    cost_amount: float                   # 买入总成本 (元)
    pnl_amount: float                    # 累计持仓盈亏 (元)
    pnl_pct: float                       # 累计持仓盈亏比例 %
    today_pnl_amount: float              # 当日参考盈亏 (元)
    today_pnl_pct: float                 # 当日涨跌幅 %
    holding_days: int                    # 真实持仓天数

    # 智能执行指令与建议
    action: str                          # 指令: "硬性止损清仓" / "第一目标止盈减仓50%" / "保本持有推止损" / "持有观望"
    action_type: str                     # "sell" / "hold" / "buy"
    action_color: str                    # 颜色 (红色/绿色/灰色)
    suggest_shares: int                  # 建议操作股数 (股)
    suggest_amount: float                # 建议操作对应金额 (元)
    remaining_shares: int                # 操作后剩余建议股数 (股)

    # 关键点位建议
    stop_loss_price: float               # 建议防守止损价 (元)
    take_profit_price: float             # 建议目标止盈价 (元)

    # 3 大底层逻辑深度拆解
    reasons: List[str]                   # 决策依据 Why (列表)

    # 仓位与风控评估
    position_weight_pct: float           # 占账户总资产比例 %
    risk_warning: str                    # 仓位风险提示 (如 "仓位合理" / "⚠️ 单票超30%集中度上限")
    summary: str                         # 一句话核心操作指令



class PortfolioStore:
    """持仓与自选持久化存储管理器"""

    def __init__(self):
        self.positions: dict[str, PositionItem] = {}
        self.watchlist: dict[str, WatchlistItem] = {}
        self.today_trades: list[dict] = []
        self.history_trades: list[dict] = []  # 东方财富历史买入/卖出交易记录
        self.total_capital: float = 0.0       # 真实账户总资产 (元)，0 表示自适应持仓总市值
        self.available_cash: float = 0.0      # 真实账户可用资金 (元)
        self.current_user = "admin"
        self.load("admin")

    def load(self, username: str = "admin"):
        """从文件加载指定用户的数据 (默认 admin，并自动兼容 default 数据)"""
        self.current_user = username or "admin"
        if not DATA_FILE.exists():
            self.positions = {}
            self.watchlist = {}
            self.today_trades = []
            self.history_trades = []
            self.total_capital = 0.0
            self.available_cash = 0.0
            return

        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                raw_data = json.load(f)
            data = {}
            if "users" in raw_data:
                data = raw_data["users"].get(self.current_user)
                # 若当前用户无数据或持仓为空，自动继承 default 或 admin 的预置实盘持仓
                if not data or not data.get("positions"):
                    fallback_key = "default" if self.current_user != "default" else "admin"
                    data = raw_data["users"].get(fallback_key, {})
            elif isinstance(raw_data, dict):
                data = raw_data

            self.positions = {
                k: PositionItem(**v) for k, v in data.get("positions", {}).items()
            }
            self.watchlist = {
                k: WatchlistItem(**v) for k, v in data.get("watchlist", {}).items()
            }
            self.today_trades = data.get("today_trades", [])
            self.history_trades = data.get("history_trades", [])
            self.total_capital = float(data.get("total_capital", 0.0))
            self.available_cash = float(data.get("available_cash", 0.0))
        except Exception:
            self.positions = {}
            self.watchlist = {}
            self.today_trades = []
            self.history_trades = []
            self.total_capital = 0.0
            self.available_cash = 0.0

    def save(self):
        """保存到文件（内置数据校验与断流防空覆盖保护）"""
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing_data = {}
        if DATA_FILE.exists():
            try:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    existing_data = json.load(f)
            except (OSError, json.JSONDecodeError):
                existing_data = {}

        if isinstance(existing_data, dict) and isinstance(existing_data.get("users"), dict):
            users = existing_data["users"]
        else:
            legacy_data = existing_data if isinstance(existing_data, dict) else {}
            users = {"default": legacy_data}

        # 数据防断裂保护：若原用户存在有效持仓，而新数据因网络或Cookie掉线导致持仓为空，拒绝空数据覆写
        old_user_data = users.get(self.current_user, {})
        old_pos = old_user_data.get("positions", {})
        if old_pos and len(self.positions) == 0 and len(self.history_trades) == 0:
            logger.warning(f"⚠️ [数据保护] 检测到用户 {self.current_user} 实盘持仓异常置空，已触发熔断保护拒绝覆盖！")
            return

        # 字段自动修复与完整性校准 (cost_amount, market_value, pnl_amount)
        clean_positions = {}
        for k, v in self.positions.items():
            pos_dict = v.__dict__.copy() if hasattr(v, "__dict__") else dict(v)
            shares = int(pos_dict.get("shares", 0))
            cost_p = float(pos_dict.get("cost_price", 0.0))
            curr_p = float(pos_dict.get("current_price", cost_p))
            
            # 自愈修复缺失的关键金额字段
            cost_amt = round(shares * cost_p, 2)
            mkt_val = round(shares * curr_p, 2)
            pnl_amt = round(mkt_val - cost_amt, 2)
            pnl_pct = round((curr_p - cost_p) / cost_p * 100, 2) if cost_p > 0 else 0.0
            
            pos_dict["cost_amount"] = cost_amt
            pos_dict["market_value"] = mkt_val if float(pos_dict.get("market_value", 0)) <= 0 else float(pos_dict["market_value"])
            pos_dict["pnl_amount"] = pnl_amt if float(pos_dict.get("pnl_amount", 0)) == 0 else float(pos_dict["pnl_amount"])
            pos_dict["pnl_pct"] = pnl_pct if float(pos_dict.get("pnl_pct", 0)) == 0 else float(pos_dict["pnl_pct"])
            clean_positions[k] = pos_dict

        users[self.current_user] = {
            "total_capital": self.total_capital,
            "available_cash": self.available_cash,
            "positions": clean_positions,
            "watchlist": {k: v.__dict__ for k, v in self.watchlist.items()},
            "today_trades": self.today_trades,
            "history_trades": self.history_trades
        }
        data = {
            "users": users,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def add_history_trade(self, trade: dict):
        """记录一笔历史买卖成交记录"""
        self.history_trades.insert(0, trade)
        self.save()


    def set_total_capital(self, capital: float, cash: Optional[float] = None):
        """更新账户真实总资金及可用现金"""
        self.total_capital = max(float(capital), 0.0)
        if cash is not None:
            self.available_cash = max(float(cash), 0.0)
        self.save()

    def add_or_update_position(self, item: PositionItem):
        self.positions[item.symbol] = item
        self.save()

    def remove_position(self, symbol: str) -> bool:
        if symbol in self.positions:
            del self.positions[symbol]
            self.save()
            return True
        return False

    def get_all_positions(self) -> List[PositionItem]:
        return list(self.positions.values())

    def add_to_watchlist(self, item_or_symbol, name: str = "", notes: str = ""):
        if isinstance(item_or_symbol, WatchlistItem):
            item = item_or_symbol
        else:
            item = WatchlistItem(symbol=str(item_or_symbol), name=name or str(item_or_symbol), notes=notes)
        self.watchlist[item.symbol] = item
        self.save()

    add_watchlist = add_to_watchlist

    def remove_from_watchlist(self, symbol: str) -> bool:
        if symbol in self.watchlist:
            del self.watchlist[symbol]
            self.save()
            return True
        return False

    def get_all_watchlist(self) -> List[WatchlistItem]:
        return list(self.watchlist.values())


class PortfolioAdvisor:
    """实盘持仓与量化风控深度诊断决策系统"""

    def __init__(self, store: PortfolioStore):
        self.store = store

    def get_effective_capital(self, total_market_value: float) -> float:
        """获取有效的账户总资产：优先使用实盘同步或设定的真实资产；若设置了可用资金则累加；若未设置，则自适应等于持仓市值"""
        if self.store.total_capital > 0:
            return self.store.total_capital
        if self.store.available_cash > 0:
            return max(total_market_value + self.store.available_cash, 0.0)
        # 若未设置真实总资产与可用现金，自适应等于持仓总市值（确保仓位与资产真实透明）
        return max(total_market_value, 0.0)

    def get_portfolio_summary(self, total_capital_or_user: Any = None, preloaded_quotes: Optional[dict] = None) -> dict:
        """
        获取账户全景统计概览 (完全对齐东方财富账户体系，支持批量预加载行情极速秒出与智能入参)
        智能入参兼容：
        - 若传入字符串则识别为 username，自动加载对应用户数据；
        - 若传入数值则识别为 total_capital；
        - 若传入字典则识别为 preloaded_quotes。
        """
        total_capital = None
        if isinstance(total_capital_or_user, str):
            self.store.load(total_capital_or_user)
        elif isinstance(total_capital_or_user, (int, float)):
            total_capital = float(total_capital_or_user)
        elif isinstance(total_capital_or_user, dict) and not preloaded_quotes:
            preloaded_quotes = total_capital_or_user

        positions = self.store.get_all_positions()
        total_market_value = 0.0
        total_cost_value = 0.0
        total_pnl_amount = 0.0
        today_pnl_amount = 0.0

        quotes = preloaded_quotes or {}
        if not quotes and positions:
            symbols = [p.symbol for p in positions]
            try:
                from utils.realtime import get_batch_realtime_quotes
                quotes = get_batch_realtime_quotes(symbols)
            except Exception:
                quotes = {}

        for pos in positions:
            quote = quotes.get(pos.symbol)
            if not quote:
                quote = get_realtime_quote(pos.symbol)
            price = float(quote.get("price", 0)) if quote else 0.0
            if price <= 0:
                price = pos.current_price if pos.current_price > 0 else (pos.cost_price if pos.cost_price > 0 else 10.0)

            pre_close = float(quote.get("pre_close", 0)) if quote else 0.0
            if pre_close <= 0:
                pre_close = price

            mv = price * pos.shares
            cost_v = pos.cost_amount if pos.cost_amount > 0 else (pos.cost_price if pos.cost_price > 0 else price) * pos.shares
            pnl_v = mv - cost_v
            
            # 当日盈亏计算：如果实时有价差则用实时价差；若无价差(非交易时段)则优先读取持仓记录中已记录的当日盈亏
            if abs(price - pre_close) > 0.0001:
                today_v = (price - pre_close) * pos.shares
            elif getattr(pos, 'today_pnl_amount', None) is not None and pos.today_pnl_amount != 0:
                today_v = float(pos.today_pnl_amount)
            else:
                today_v = (price - pre_close) * pos.shares

            total_market_value += mv
            total_cost_value += cost_v
            total_pnl_amount += pnl_v
            today_pnl_amount += today_v

        # 动态真实总资产与可用资金计算
        if total_capital and total_capital > 0:
            eff_capital = total_capital
            cash_avail = max(eff_capital - total_market_value, 0.0)
        elif self.store.total_capital > 0:
            eff_capital = self.store.total_capital
            cash_avail = self.store.available_cash if self.store.available_cash > 0 else max(eff_capital - total_market_value, 0.0)
        elif self.store.available_cash > 0:
            cash_avail = self.store.available_cash
            eff_capital = total_market_value + cash_avail
        else:
            eff_capital = total_market_value
            cash_avail = 0.0

        total_pnl_pct = round((total_pnl_amount / total_cost_value) * 100.0, 2) if total_cost_value > 0 else 0.0
        today_pnl_pct = round((today_pnl_amount / (total_market_value - today_pnl_amount)) * 100.0, 2) if (total_market_value - today_pnl_amount) > 0 else 0.0
        position_ratio_pct = round((total_market_value / eff_capital) * 100.0, 2) if eff_capital > 0 else 0.0

        res_dict = {
            "total_positions": len(positions),
            "total_watchlist": len(self.store.get_all_watchlist()),
            "total_market_value": round(total_market_value, 2),
            "market_value": round(total_market_value, 2),
            "total_cost_value": round(total_cost_value, 2),
            "today_pnl_amount": round(today_pnl_amount, 2),
            "total_today_pnl": round(today_pnl_amount, 2),
            "today_pnl_pct": today_pnl_pct,
            "total_pnl_amount": round(total_pnl_amount, 2),
            "total_pnl": round(total_pnl_amount, 2),
            "total_pnl_pct": total_pnl_pct,
            "total_capital": round(eff_capital, 2),
            "total_asset": round(eff_capital, 2),
            "cash_available": round(cash_avail, 2),
            "available_cash": round(cash_avail, 2),
            "position_ratio_pct": position_ratio_pct,
            "position_pct": position_ratio_pct,
        }
        # 支持点号属性访问与字典访问兼容
        class SummaryObj(dict):
            __getattr__ = dict.get
            __setattr__ = dict.__setitem__
        return SummaryObj(res_dict)

    def diagnose_all_positions(self, username_or_quotes: Any = None, preloaded_quotes: Optional[dict] = None) -> List[PositionDiagnostic]:
        """
        批量执行全账户持仓深度诊断 (行情+kline全部并发批量，彻底消除串行阻塞与参数类型崩溃)
        智能入参兼容：
        - 若传入字符串则识别为 username，自动加载对应用户数据；
        - 若传入字典则识别为 preloaded_quotes；
        - 确保 quotes 永远为 dict 类型，杜绝 AttributeError。
        """
        results = []

        # 智能解析参数
        actual_quotes = {}
        if isinstance(username_or_quotes, str):
            self.store.load(username_or_quotes)
            if isinstance(preloaded_quotes, dict):
                actual_quotes = preloaded_quotes
        elif isinstance(username_or_quotes, dict):
            actual_quotes = username_or_quotes
        elif isinstance(preloaded_quotes, dict):
            actual_quotes = preloaded_quotes

        positions = self.store.get_all_positions()
        if not positions:
            return results

        symbols = [p.symbol for p in positions]

        # 并发批量拉取：行情快照 + K线数据 同时发起
        from concurrent.futures import ThreadPoolExecutor
        from utils.realtime import get_batch_realtime_quotes, get_realtime_kline

        quotes = actual_quotes if isinstance(actual_quotes, dict) else {}

        def fetch_kline(sym):
            return sym, get_realtime_kline(sym, period="d", count=30)

        with ThreadPoolExecutor(max_workers=max(len(symbols), 1)) as ex:
            quote_future = None
            if not quotes:
                quote_future = ex.submit(get_batch_realtime_quotes, symbols)
            kline_futures = {ex.submit(fetch_kline, sym): sym for sym in symbols}

            if quote_future:
                try:
                    res_quotes = quote_future.result(timeout=5)
                    quotes = res_quotes if isinstance(res_quotes, dict) else {}
                except Exception:
                    quotes = {}

            klines = {}
            for future in kline_futures:
                try:
                    sym, kl = future.result(timeout=5)
                    klines[sym] = kl
                except Exception:
                    pass

        # 先统计总市值以计算真实比例
        est_market_val = sum(pos.shares * (pos.current_price if pos.current_price > 0 else pos.cost_price) for pos in positions)
        eff_capital = self.get_effective_capital(est_market_val)

        has_updates = False
        for pos in positions:
            quote = quotes.get(pos.symbol)
            kline = klines.get(pos.symbol)
            diag = self.diagnose_single_position(pos, eff_capital, quote=quote, kline=kline)
            if diag:
                results.append(diag)
                if (pos.current_price != diag.current_price or
                    pos.market_value != diag.market_value or
                    pos.pnl_amount != diag.pnl_amount or
                    pos.pnl_pct != diag.pnl_pct or
                    pos.today_pnl_amount != diag.today_pnl_amount or
                    pos.today_pnl_pct != diag.today_pnl_pct):
                    pos.current_price = diag.current_price
                    pos.market_value = diag.market_value
                    pos.pnl_amount = diag.pnl_amount
                    pos.pnl_pct = diag.pnl_pct
                    pos.today_pnl_amount = diag.today_pnl_amount
                    pos.today_pnl_pct = diag.today_pnl_pct
                    has_updates = True

        if has_updates:
            self.store.save()

        return results

    def diagnose_single_position(self, pos: PositionItem, total_capital: float = 20_000.0, quote: Optional[dict] = None, kline: Optional[list] = None) -> Optional[PositionDiagnostic]:
        """针对单个持仓执行全方位诊断与买卖/减仓/止损指令计算 (支持精确成本金额与当日盈亏)"""
        symbol = pos.symbol
        shares = max(int(pos.shares), 0)

        # 优先使用预加载的批量行情
        if not quote:
            quote = get_realtime_quote(symbol)
        real_price = float(quote.get("price", 0)) if quote else 0.0
        current_price = real_price if real_price > 0 else (pos.current_price if pos.current_price > 0 else 10.0)

        pre_close = float(quote.get("pre_close", 0)) if quote else 0.0
        if pre_close <= 0:
            pre_close = current_price

        today_pnl_amount = round((current_price - pre_close) * shares, 2)
        today_pnl_pct = round((current_price - pre_close) / pre_close * 100.0, 2) if pre_close > 0 else 0.0

        cost_unknown = (pos.cost_price <= 0 and pos.cost_amount <= 0)
        cost = pos.cost_price if pos.cost_price > 0 else (current_price if cost_unknown else (pos.cost_amount / shares if shares > 0 else current_price))
        cost_amount = pos.cost_amount if pos.cost_amount > 0 else round(cost * shares, 2)

        market_value = round(shares * current_price, 2)
        if cost_unknown:
            pnl_amount = 0.0
            pnl_pct = 0.0
        else:
            pnl_amount = round(market_value - cost_amount, 2)
            pnl_pct = round((pnl_amount / cost_amount) * 100.0, 2) if cost_amount > 0 else 0.0

        # 计算持仓天数
        holding_days = 1
        if pos.buy_date:
            try:
                b_date = datetime.strptime(pos.buy_date[:10], "%Y-%m-%d")
                holding_days = max((datetime.now() - b_date).days, 1)
            except Exception:
                holding_days = 1


        # 获取日 K 线技术形态（优先使用外部预加载，避免单票串行网络请求）
        if kline is None:
            kline = get_realtime_kline(symbol, period="d", count=30)
        ma5 = current_price
        ma10 = current_price
        ma20 = current_price
        if kline and len(kline) >= 20:
            closes = [float(k[2]) for k in kline]
            ma5 = sum(closes[-5:]) / 5.0
            ma10 = sum(closes[-10:]) / 10.0
            ma20 = sum(closes[-20:]) / 20.0

        # 单票集中度评估
        weight_pct = round(market_value / total_capital * 100.0, 2) if total_capital > 0 else 0.0
        risk_warning = "仓位配置合理 (在35%安全线内)"
        if weight_pct > 35.0:
            risk_warning = f"⚠️ 单票集中度达 {weight_pct}% (已超出 35% 机构风控红线，建议逢高压降)"

        # ==================== 买卖决策与股数建议逻辑 ====================
        action = "持有观望"
        action_type = "hold"
        action_color = "#8b949e"
        suggest_shares = 0
        suggest_amount = 0.0
        remaining_shares = shares
        reasons = []

        if cost_unknown:
            action = "成本待补充"
            action_type = "hold"
            action_color = "#8b949e"
            stop_loss_price = round(current_price * 0.965, 3)
            take_profit_price = round(current_price * 1.05, 3)
            reasons = [
                f"当前标的成本价格未知，暂无法核算精准盈亏比例；",
                f"现价 ¥{current_price:.3f}，以当前市价参考技术止损位为 ¥{stop_loss_price:.3f} (MA20=¥{ma20:.3f})；",
                "建议通过【修改持仓】补齐建仓成本以获取精确的减仓与止损指令。"
            ]
        # 1. 硬性止损情景 (浮亏达到 -3.5% 或 跌破关键支撑)
        elif pnl_pct <= -3.5 or (current_price < ma20 * 0.98 and pnl_pct < 0):
            action = "硬性止损清仓"
            action_type = "sell"
            action_color = "#f85149"
            suggest_shares = shares
            suggest_amount = market_value
            remaining_shares = 0
            stop_loss_price = round(cost * 0.965, 3)
            take_profit_price = round(cost * 1.05, 3)
            reasons = [
                f"当前浮亏 {pnl_pct}%，已触及个人交易系统硬性 -3.5% 止损纪律底线；",
                f"现价 (¥{current_price:.3f}) 已有效跌破关键防守支撑线 (MA20=¥{ma20:.3f})；",
                f"严禁死扛亏损与侥幸补仓，建议全部离场锁定最大单笔亏损在账户安全风险内。",
            ]

        # 2. 第二目标止盈清仓情景 (+10% 以上或高位滞涨)
        elif pnl_pct >= 10.0:
            action = "第二目标止盈清仓"
            action_type = "sell"
            action_color = "#3fb950"
            suggest_shares = shares
            suggest_amount = market_value
            remaining_shares = 0
            stop_loss_price = round(cost * 1.05, 3)
            take_profit_price = round(cost * 1.15, 3)
            reasons = [
                f"当前累计浮盈达 +{pnl_pct}%，已圆满达到系统第二目标位 (+10%~+12%)；",
                "高位量能面临阻力与获利盘抛压，防止利润大幅回撤坐过山车；",
                f"建议将剩余 {shares:,} 股全部卖出清仓，锁定 ¥{pnl_amount:,.0f} 净利润落袋为安。",
            ]

        # 3. 第一目标止盈减仓 50% 情景 (+4.5% ~ +9.9%)
        elif pnl_pct >= 4.5:
            action = "第一目标止盈减仓50%"
            action_type = "sell"
            action_color = "#3fb950"
            half_shares = max(int(math.ceil((shares / 2.0) / 100.0) * 100), 100)
            suggest_shares = min(half_shares, shares)
            suggest_amount = round(suggest_shares * current_price, 2)
            remaining_shares = shares - suggest_shares
            # 剩余仓位防守线上移至成本线
            stop_loss_price = round(cost * 1.002, 3)
            take_profit_price = round(cost * 1.10, 3)
            reasons = [
                f"当前浮盈达 +{pnl_pct}%，成功触及第一止盈目标位 (+4.5%~+6.0%)；",
                f"根据交易纪律立即减仓 50% ({suggest_shares:,} 股)，先将 ¥{(pnl_amount/2):,.0f} 利润装进口袋；",
                f"【核心纪律】将剩余 {remaining_shares:,} 股的硬性止损线上移至买入成本价 (¥{cost:.3f})，实现本笔交易“零风险奔跑”博取更大波段。",
            ]

        # 4. 保本持有情景 (微盈 +0.5% ~ +4.4%) -> 修复 Bug 1: 准确计算保本防守止损线
        elif pnl_pct >= 0.5:
            action = "保本持有推止损"
            action_type = "hold"
            action_color = "#58a6ff"
            suggest_shares = 0
            stop_loss_price = round(cost * 0.99, 3)
            take_profit_price = round(cost * 1.05, 3)
            reasons = [
                f"当前处于微利状态 (+{pnl_pct}%)，日线依托均线向上发散；",
                f"将止损线上移至成本保护位 (¥{stop_loss_price:.3f})，静待股价冲击第一止盈目标位 (¥{take_profit_price:.3f})；",
                "无需频繁短线倒手，保持持仓耐心与交易纪律。",
            ]

        # 5. 回踩企稳/轻度回撤情景 (-3.4% ~ +0.4%)
        else:
            stop_loss_price = round(cost * 0.965, 3)
            take_profit_price = round(cost * 1.05, 3)
            if current_price >= ma20:
                action = "均线支撑企稳持有"
                action_type = "hold"
                action_color = "#8b949e"
                reasons = [
                    f"现价 (¥{current_price:.3f}) 处于成本线附近，并在 MA20 (¥{ma20:.3f}) 之上获得有效支撑；",
                    f"未触及 -3.5% 硬性止损位 (¥{stop_loss_price:.3f})，形态尚未走坏；",
                    "严密关注尾盘承接力度，若跌破防守线则果断执行止损。",
                ]
            else:
                action = "贴近止损谨慎防守"
                action_type = "hold"
                action_color = "#f0883e"
                reasons = [
                    f"现价跌破短周期均线，当前浮亏 {pnl_pct}%，距离止损位仅差 {round(abs(pnl_pct+3.5), 2)}%；",
                    f"若盘中进一步跌破 ¥{stop_loss_price:.3f}，系统将触发强制清仓指令；",
                    "严禁在下跌途中逆势补仓摊薄成本。",
                ]

        summary = f"{action}: 现价 ¥{current_price:.3f} (盈亏 {pnl_pct}%)，建议操作 {suggest_shares:,} 股，防守止损价 ¥{stop_loss_price:.3f}"

        return PositionDiagnostic(
            symbol=symbol,
            name=pos.name,
            shares=shares,
            cost_price=cost,
            current_price=current_price,
            market_value=market_value,
            cost_amount=cost_amount,
            pnl_amount=pnl_amount,
            pnl_pct=pnl_pct,
            today_pnl_amount=today_pnl_amount,
            today_pnl_pct=today_pnl_pct,
            holding_days=holding_days,
            action=action,
            action_type=action_type,
            action_color=action_color,
            suggest_shares=suggest_shares,
            suggest_amount=suggest_amount,
            remaining_shares=remaining_shares,
            stop_loss_price=stop_loss_price,
            take_profit_price=take_profit_price,
            reasons=reasons,
            position_weight_pct=weight_pct,
            risk_warning=risk_warning,
            summary=summary,
        )




# 全局单例
portfolio_store = PortfolioStore()
portfolio_advisor = PortfolioAdvisor(portfolio_store)

# 重新导出 ImageParser 保持向后兼容
from utils.broker_importer import ImageParser

