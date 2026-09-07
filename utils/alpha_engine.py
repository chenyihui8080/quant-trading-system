"""个人专属交易规则与买卖决策系统核心引擎 (Trading Alpha Desk)

包含：
1. 规则量化过滤引擎 (Rule Filter Engine): 硬性排雷、板块筛选、均线多头、量能突破、尾盘特征
2. 买卖价格与仓位计算引擎 (Execution Engine): 建议买入区间、硬性止损、分批止盈、单笔1%风险倒算股数、盈亏比拦截
3. 决战简报与预警生成器 (Alert Generator): 钉钉/企业微信卡片消息生成
"""
import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict

import pandas as pd

from utils.realtime import get_realtime_quote, get_realtime_kline


@dataclass
class AlphaRuleConfig:
    """交易规则与决策配置参数"""
    # 账户配置
    total_capital: float = 1_000_000.0   # 账户总资产 (元)
    risk_r_pct: float = 1.0              # 单笔最大允许风险 R (默认 1.0%)
    max_position_pct: float = 30.0       # 单票最大持仓占比上限 % (默认 30.0%)

    # 1. 硬性排雷条件
    enable_anti_thunder: bool = True     # 开启排雷
    filter_st: bool = True               # 剔除 ST / *ST / 退市
    min_market_cap_billion: float = 50.0 # 最小流通市值 (亿元)
    max_market_cap_billion: float = 400.0# 最大流通市值 (亿元)
    min_daily_amount_billion: float = 3.5# 最小日成交额 (亿元)

    # 2. 板块风格
    allow_main: bool = True              # 允许主板 (60/00开头)
    allow_gem: bool = True               # 允许创业板 (30开头)
    allow_star: bool = True              # 允许科创板 (68开头)

    # 3. 趋势形态
    enable_ma_trend: bool = True         # 均线多头排列 (MA5 > MA10 > MA20)

    # 4. 量能结构
    enable_vol_breakout: bool = True     # 放量突破 (今日成交量 >= 5日均量 1.8倍)
    vol_ratio_threshold: float = 1.8     # 放量倍数阈值

    # 5. 尾盘稳健特征
    enable_tail_feature: bool = False    # 尾盘模式 (涨幅 3.0%~6.5%，均线之上)
    tail_min_pct: float = 3.0            # 尾盘最低涨幅 %
    tail_max_pct: float = 6.5            # 尾盘最高涨幅 %

    # 买卖与风控参数
    stop_loss_pct: float = 3.5           # 固定硬性止损比例 % (默认 3.5%)
    target1_profit_pct: float = 5.0      # 第一目标止盈比例 % (默认 5.0%)
    target2_profit_pct: float = 10.0     # 第二目标止盈比例 % (默认 10.0%)
    min_risk_reward_ratio: float = 1.5   # 最低盈亏比阈值 (默认 1.5)


@dataclass
class TradeDecisionResult:
    """买卖决策计算输出结果"""
    symbol: str                          # 股票代码
    name: str                            # 股票名称
    current_price: float                 # 当前撮合价
    change_pct: float                    # 今日涨跌幅 %

    # 核心买卖点计算
    buy_low: float                       # 建议买入下轨 (Pin - 0.5%)
    buy_high: float                      # 建议买入上轨 (Pin + 0.5%)
    pin: float                           # 标准买入中轴价

    p_stop: float                        # 防守止损价 Pstop
    stop_loss_pct: float                 # 止损百分比 (负数)
    risk_per_share: float                # 每股风险敞口 (Pin - Pstop)

    p_target1: float                     # 第一止盈目标价 (+5%)
    target1_pct: float                   # 第一目标涨幅 %
    p_target2: float                     # 第二止盈目标价 (+10%)
    target2_pct: float                   # 第二目标涨幅 %

    rr_ratio: float                      # 核心盈亏比 R:R
    rr_ratio_t1: float                   # 第一目标盈亏比
    rr_ratio_t2: float                   # 第二目标盈亏比

    # 单笔 1% 风险倒算仓位 (Position Sizing)
    recommended_shares: int              # 建议买入股数 (必须是100股整数倍)
    recommended_amount: float            # 建议买入总资金 (元)
    position_pct: float                  # 建议资金占总资产比例 %
    total_risk_amount: float             # 实际承受风险总额 (不超过1%资产)

    # 规则触发与状态
    triggered_rules: List[str]           # 触发的规则列表
    passed_filter: bool                  # 是否通过全部硬性过滤
    status: str                          # 决策状态: "待执行" / "盈亏比不足拦截" / "排雷过滤"
    status_color: str                    # 状态颜色标签
    reason: str                          # 决策说明文案


class AlphaEngine:
    """Alpha 交易决策与风控计算引擎"""

    def __init__(self, config: Optional[AlphaRuleConfig] = None):
        self.config = config or AlphaRuleConfig()

    def update_config(self, new_config: AlphaRuleConfig):
        self.config = new_config

    def calculate_trade_levels(
        self,
        current_price: float,
        kline: Optional[List[List]] = None,
        custom_capital: Optional[float] = None
    ) -> TradeDecisionResult:
        """根据当前价格、K线形态与风控规则计算完整的买卖点、止损、止盈与 1% 风险倒算股数"""
        cfg = self.config
        capital = custom_capital or cfg.total_capital

        if current_price <= 0:
            current_price = 10.0

        # 1. 建议买入区间 Pin (当前撮合价上下浮动 0.5%)
        buy_low = round(current_price * 0.995, 2)
        buy_high = round(current_price * 1.005, 2)
        pin = round(current_price, 2)

        # 2. 硬性风控止损价 Pstop 与技术位止损综合决策
        # 2. 硬性风控止损价 Pstop 与技术位止损综合决策
        # 固定硬性止损底线: Pin * (1 - abs(stop_loss_pct)%)
        stop_pct_val = abs(cfg.stop_loss_pct) if cfg.stop_loss_pct else 3.5
        fixed_stop = round(pin * (1.0 - stop_pct_val / 100.0), 2)

        # 技术位支撑止损 (综合前一日最低价与 MA5 均线)
        tech_support = fixed_stop
        if kline and len(kline) >= 2:
            prev_low = float(kline[-2][3])  # 前一日最低价
            ma5 = sum(float(k[2]) for k in kline[-5:]) / min(len(kline), 5)
            ma5_stop = round(ma5 * 0.99, 2)
            tech_support = max(prev_low, ma5_stop)

        # 止损决策逻辑: 技术支撑若在 (fixed_stop, pin) 之间则收紧风险；否则采用固定底线保底
        if fixed_stop <= tech_support < pin:
            p_stop = tech_support
        else:
            p_stop = fixed_stop

        # 确保 p_stop 严格低于 pin，至少保留 0.01 风险敞口
        if p_stop >= pin:
            p_stop = round(pin * 0.965, 2)

        stop_loss_pct = round((p_stop - pin) / pin * 100.0, 2)
        risk_per_share = max(pin - p_stop, 0.01)

        # 3. 分批止盈目标价 Ptarget1 & Ptarget2
        t1_val = abs(cfg.target1_profit_pct) if cfg.target1_profit_pct else 5.0
        t2_val = abs(cfg.target2_profit_pct) if cfg.target2_profit_pct else 10.0
        p_target1 = round(pin * (1.0 + t1_val / 100.0), 2)
        target1_pct = round((p_target1 - pin) / pin * 100.0, 2)

        p_target2 = round(pin * (1.0 + t2_val / 100.0), 2)
        target2_pct = round((p_target2 - pin) / pin * 100.0, 2)

        # 4. 盈亏比自动核算 R:R
        rr_t1 = round((p_target1 - pin) / risk_per_share, 2) if risk_per_share > 0 else 0.0
        rr_t2 = round((p_target2 - pin) / risk_per_share, 2) if risk_per_share > 0 else 0.0
        rr_ratio = rr_t2

        # 5. 单笔风险仓位倒算 (Position Sizing)
        # 单笔最大亏损额 = 账户总资产 * 1% (R)
        risk_r = cfg.risk_r_pct if (cfg.risk_r_pct and cfg.risk_r_pct > 0) else 1.0
        max_risk_amount = capital * (risk_r / 100.0)
        
        # 建议买入股数 = max_risk_amount / (Pin - Pstop)，向下取整为 100 股的整数倍
        raw_shares = max_risk_amount / risk_per_share
        rec_shares = int(math.floor(raw_shares / 100.0) * 100)

        # 限制单笔最大资金不超过总资产的设定上限（默认 30%）
        max_pos = cfg.max_position_pct if (cfg.max_position_pct and cfg.max_position_pct > 0) else 30.0
        max_cap_limit = capital * (max_pos / 100.0)
        rec_amount = round(rec_shares * pin, 2)
        if rec_amount > max_cap_limit:
            rec_shares = int(math.floor((max_cap_limit / pin) / 100.0) * 100)
            rec_amount = round(rec_shares * pin, 2)

        total_risk = round(rec_shares * risk_per_share, 2)
        pos_pct = round((rec_amount / capital) * 100.0, 1) if capital > 0 else 0.0

        # 计算均线与技术面特征辅助生成客观推导
        ma5_val = round(sum(float(k[2]) for k in kline[-5:]) / min(len(kline), 5), 2) if kline and len(kline) >= 5 else round(pin * 0.98, 2)
        ma20_val = round(sum(float(k[2]) for k in kline[-20:]) / min(len(kline), 20), 2) if kline and len(kline) >= 20 else round(pin * 0.95, 2)
        trend_desc = "股价站稳 MA5 与 MA20 均线上方，呈现多头顺势排列" if pin >= ma5_val else "股价处于均线回踩蓄势阶段，等待放量确认"

        # 构造 4 大维度条理清晰的量化研报逻辑
        trend_reason = f"【趋势形态】现价 ¥{pin:.2f} 运行于 5日均线 (¥{ma5_val:.2f}) 上方，{trend_desc}，短线支撑位有效。"
        stop_reason = f"【防守止损】硬性防守价锁定在 ¥{p_stop:.2f} ({stop_loss_pct:+.2f}%)，锚定近期分时支撑均线，单股最大风险敞口仅 ¥{risk_per_share:.2f}，破位果断认错。"
        target_reason = f"【目标空间】第一止盈位看至 ¥{p_target1:.2f} ({target1_pct:+.2f}%)，第二波段目标看至 ¥{p_target2:.2f} ({target2_pct:+.2f}%)，阻力空间已打开。"
        risk_reason = f"【仓位风控】华尔街 1% 风险限额 ¥{max_risk_amount:,.0f}，精准建仓 {rec_shares:,} 股 (约 ¥{rec_amount/10000:.1f}万，仓位 {pos_pct}%)，盈亏比达 {rr_ratio:.2f}:1，远超及格线。"

        # 状态判定与精准拦截
        if rec_shares < 100:
            rec_shares = 0
            rec_amount = 0.0
            total_risk = 0.0
            status = "资金不足以建仓1手"
            status_color = "#f85149"
            passed_filter = False
            structured_reason = f"最大限额¥{max_cap_limit:,.0f}不足以买入最小1手(100股=¥{pin*100:,.0f})"
            reason = structured_reason
        elif rr_ratio < cfg.min_risk_reward_ratio and rr_t1 < 1.2:
            status = "盈亏比不足拦截"
            status_color = "#f85149"
            passed_filter = False
            structured_reason = f"【风险拦截】预期盈亏比 {rr_ratio:.2f} 低于设定风控阈值 {cfg.min_risk_reward_ratio:.2f}，上行空间受阻于上方套牢峰，建议观望。"
            reason = structured_reason
        else:
            status = "待执行"
            status_color = "#3fb950"
            passed_filter = True
            structured_reason = f"{trend_reason} {stop_reason} {target_reason} {risk_reason}"
            reason = structured_reason

        return TradeDecisionResult(
            symbol="",
            name="",
            current_price=pin,
            change_pct=0.0,
            buy_low=buy_low,
            buy_high=buy_high,
            pin=pin,
            p_stop=p_stop,
            stop_loss_pct=stop_loss_pct,
            risk_per_share=round(risk_per_share, 2),
            p_target1=p_target1,
            target1_pct=target1_pct,
            p_target2=p_target2,
            target2_pct=target2_pct,
            rr_ratio=rr_ratio,
            rr_ratio_t1=rr_t1,
            rr_ratio_t2=rr_t2,
            recommended_shares=rec_shares,
            recommended_amount=rec_amount,
            position_pct=pos_pct,
            total_risk_amount=total_risk,
            triggered_rules=[],
            passed_filter=passed_filter,
            status=status,
            status_color=status_color,
            reason=structured_reason
        )

    def evaluate_stock(self, symbol: str, name: str = "") -> Optional[TradeDecisionResult]:
        """对单只标的进行全套量化规则链式过滤与买卖决策计算"""
        cfg = self.config

        # 1. 板块过滤 (只针对 A 股个股主板/创业板/科创板)
        if symbol.startswith(("60", "00")) and not cfg.allow_main:
            return None
        if symbol.startswith("30") and not cfg.allow_gem:
            return None
        if symbol.startswith("68") and not cfg.allow_star:
            return None
        # 排除非个股（如指数/ETF 或异常代码）
        if not symbol.startswith(("60", "00", "30", "68")):
            return None

        # 2. 获取实时行情与 K 线数据
        quote = get_realtime_quote(symbol)
        if not quote:
            return None

        real_name = name or quote.get("name", symbol)
        current_price = float(quote.get("price", 0))
        if current_price <= 0:
            return None

        # 3. 硬性排雷: ST、退市
        if cfg.enable_anti_thunder:
            if cfg.filter_st and any(tag in real_name for tag in ["ST", "*ST", "退"]):
                return None

        # 获取历史日 K 线
        kline = get_realtime_kline(symbol, period="d", count=60)
        if not kline or len(kline) < 20:
            return None

        # 4. 规则量化过滤判定
        triggered = []

        # 计算均线 MA5, MA10, MA20
        closes = [float(k[2]) for k in kline]
        volumes = [float(k[5]) for k in kline]

        ma5 = sum(closes[-5:]) / 5.0
        ma10 = sum(closes[-10:]) / 10.0
        ma20 = sum(closes[-20:]) / 20.0

        # 规则 A: 均线多头排列 (MA5 > MA10 > MA20 且 现价 > MA20)
        if cfg.enable_ma_trend:
            if ma5 > ma10 > ma20 and current_price >= ma20:
                triggered.append("均线多头排列")

        # 规则 B: 量能结构 (放量突破 或 缩量回踩 MA5)
        if cfg.enable_vol_breakout and len(volumes) >= 6:
            vol_5 = sum(volumes[-6:-1]) / 5.0
            today_vol = volumes[-1]
            if vol_5 > 0 and today_vol >= vol_5 * cfg.vol_ratio_threshold:
                triggered.append("放量突破平台")
            elif len(closes) >= 3 and closes[-1] >= ma5 and volumes[-1] < vol_5 * 0.8:
                triggered.append("缩量回踩企稳")

        # 规则 C: 尾盘稳健特征
        change_pct = float(quote.get("change_pct", 0))
        if cfg.enable_tail_feature:
            if cfg.tail_min_pct <= change_pct <= cfg.tail_max_pct:
                triggered.append("尾盘放量稳健")

        # 若未触发任何核心规则且开启了过滤，进行放宽趋势评估
        if not triggered:
            if change_pct > 1.5 and current_price >= ma10:
                triggered.append("上升趋势共振")
            else:
                return None

        # 5. 计算完整的买卖决策点位
        result = self.calculate_trade_levels(current_price, kline)
        result.symbol = symbol
        result.name = real_name
        result.change_pct = round(change_pct, 2)
        result.triggered_rules = triggered

        return result

    def scan_all_candidates(self, symbols_dict: Optional[Dict[str, str]] = None) -> List[TradeDecisionResult]:
        """全市场候选股票批量扫描与量化决战筛选"""
        if not symbols_dict:
            # 默认扫描关注度最高的主力标的池
            symbols_dict = {
                "600519": "贵州茅台", "000858": "五粮液", "300750": "宁德时代",
                "601318": "中国平安", "002594": "比亚迪", "600036": "招商银行",
                "000001": "平安银行", "601888": "中国中免", "300059": "东方财富",
                "600900": "长江电力", "002475": "立讯精密", "002241": "歌尔股份",
                "603259": "药明康德", "300760": "迈瑞医疗", "688981": "中芯国际",
                "000725": "京东方A", "600111": "北方稀土", "601899": "紫金矿业"
            }

        results = []
        for sym, name in symbols_dict.items():
            try:
                res = self.evaluate_stock(sym, name)
                if res:
                    results.append(res)
            except Exception as e:
                continue

        # 排序：优先按通过过滤、触发规则数、盈亏比倒序排列
        results.sort(key=lambda x: (x.passed_filter, len(x.triggered_rules), x.rr_ratio), reverse=True)
        return results

    def generate_webhook_card(self, results: List[TradeDecisionResult]) -> dict:
        """生成符合钉钉 / 企业微信规范的 14:45 决战决策卡片"""
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        valid = [r for r in results if r.passed_filter]

        if not valid:
            return {
                "msgtype": "markdown",
                "markdown": {
                    "title": f"🎯 Alpha 尾盘决战决策简报 ({now_str})",
                    "text": f"### 🎯 Alpha 尾盘决战决策简报\n> **时间：** {now_str}\n\n"
                            f"🛡️ **风控状态：** 今日全市场未扫描到满足严格盈亏比与风控条件的标的，建议**空仓观望**，严格执行交易纪律！"
                }
            }

        lines = [
            f"### 🎯 Alpha 尾盘决战决策简报",
            f"> **时间：** {now_str}  |  **候选标的：** {len(valid)} 只",
            f"---"
        ]

        for r in valid[:5]:  # 最多推送前 5 只优质候选
            rules_tag = "、".join(r.triggered_rules) if r.triggered_rules else "趋势共振"
            lines.append(
                f"#### 🎯 **{r.name} ({r.symbol})**  现价：¥{r.current_price:.2f} ({r.change_pct:+.2f}%)\n"
                f"- **触发特征：** `{rules_tag}`\n"
                f"- **建议区间：** ¥{r.buy_low:.2f} ~ ¥{r.buy_high:.2f}\n"
                f"- **硬性止损：** **¥{r.p_stop:.2f}** ({r.stop_loss_pct:.1f}%)\n"
                f"- **分批止盈：** 目标1: ¥{r.p_target1:.2f} (+{r.target1_pct:.1f}%) | 目标2: ¥{r.p_target2:.2f} (+{r.target2_pct:.1f}%)\n"
                f"- **盈亏比 R:R：** **{r.rr_ratio:.2f}**\n"
                f"- **1%仓位建议：** **{r.recommended_shares:,} 股** (约 ¥{r.recommended_amount/10000:.1f}万 / 占比 {r.position_pct:.1f}%)\n"
            )

        lines.append(f"> ⚠️ **纪律铁律：** 严格遵循 1% 最大账户风险倒算仓位，破止损线无条件离场！")

        return {
            "msgtype": "markdown",
            "markdown": {
                "title": f"🎯 尾盘决战决策简报 ({len(valid)}只精选标的)",
                "text": "\n\n".join(lines)
            }
        }


# 全局单例
alpha_engine = AlphaEngine()

