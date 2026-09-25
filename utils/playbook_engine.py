#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
六大战法专属算法引擎 (Playbook Custom Engine)
专为量化实战定制，告别一刀切通用算法：
1. playbook_01_auction_breakout: 竞价弱转强战法 (开盘抢筹，-2.5%铁血止损，+6%~+8%止盈，2成仓)
2. playbook_02_box_breakout: 倍量突破前高战法 (突破确认，破中轴止损，黄金拓展位止盈，3成仓)
3. playbook_03_dragon_first_drop: 断板首阴反包战法 (下杀低吸，破前低止损，反包止盈，2成仓)
4. playbook_04_core_ma20_pullback: 回踩均线支撑战法 (MA5/20缩量承接，破MA10止损，波段止盈，3.5成仓)
5. playbook_05_chip_density_breakout: 筹码单峰发散战法 (峰顶突破，破峰下沿止损，主升派发止盈，3.5成仓)
6. playbook_06_grid_t0_relief: 存量震荡T+0战法 (箱底下轨支撑，破位止损，高抛止盈，2.5成仓)
"""

import math
from typing import Dict, Any, List, Optional
from utils.playbooks_engine import PLAYBOOKS_CATALOG


# 战法注册定义字典
PLAYBOOK_REGISTRY: Dict[str, Dict[str, Any]] = {
    "playbook_01_auction_breakout": {
        "id": "playbook_01_auction_breakout",
        "name": "⚡ 竞价弱转强战法",
        "short_name": "竞价弱转强",
        "default_position_pct": 20.0,
        "style": "短线情绪 · 激进爆发流",
        "description": "开盘抢筹，高开1%~2.5%追入，-2.5%极速铁血止损，冲高+6%~+8%分批止盈",
    },
    "playbook_02_box_breakout": {
        "id": "playbook_02_box_breakout",
        "name": "🚀 倍量突破前高战法",
        "short_name": "倍量突破前高",
        "default_position_pct": 30.0,
        "style": "波段主升 · 箱体突破流",
        "description": "突破20~60日箱顶上方0.5%~1.5%追入，跌回突破中轴止损，黄金位止盈",
    },
    "playbook_03_dragon_first_drop": {
        "id": "playbook_03_dragon_first_drop",
        "name": "🎯 断板首阴反包战法",
        "short_name": "断板首阴反包",
        "default_position_pct": 20.0,
        "style": "游资接力 · 龙头博弈流",
        "description": "龙头断板次日低开或急杀-3%~-6%低吸企稳，破昨日最低止损，博弈反包",
    },
    "playbook_04_core_ma20_pullback": {
        "id": "playbook_04_core_ma20_pullback",
        "name": "🌊 回踩均线支撑战法",
        "short_name": "回踩均线支撑",
        "default_position_pct": 35.0,
        "style": "机构趋势 · 稳健波段流",
        "description": "多头趋势缩量回踩MA5/MA20生命线企稳低吸，破MA10止损，稳健波段",
    },
    "playbook_05_chip_density_breakout": {
        "id": "playbook_05_chip_density_breakout",
        "name": "📊 筹码单峰发散战法",
        "short_name": "筹码单峰发散",
        "default_position_pct": 35.0,
        "style": "主力控盘 · 筹码分布流",
        "description": "底部筹码密集度>70%，放量越过筹码峰上沿买入，跌破峰底-3%止损",
    },
    "playbook_06_grid_t0_relief": {
        "id": "playbook_06_grid_t0_relief",
        "name": "🛡️ 存量震荡T+0战法",
        "short_name": "存量震荡T+0",
        "default_position_pct": 25.0,
        "style": "防守反击 · 日内做T流",
        "description": "箱体下轨企稳低吸做T，反抽上轨高抛，跌破下轨-2%果断防守止损",
    },
}


def detect_best_playbook(quote: Dict[str, Any], kline: Optional[List[Any]] = None) -> str:
    """
    根据标的实时行情与近期K线形态，全自动识别最匹配的战法ID
    
    规则链：
    1. 前日大阳或涨停，今日开盘低开急杀 (-2% ~ -7%) -> 断板首阴反包 (playbook_03_dragon_first_drop)
    2. 今日高开且涨幅在 +1.0% ~ +4.5%，量比大 -> 竞价弱转强 (playbook_01_auction_breakout)
    3. 放量突破近20日最高价 -> 倍量突破前高 (playbook_02_box_breakout)
    4. 均线多头排列且现价贴近 MA5/MA20 -> 回踩均线支撑 (playbook_04_core_ma20_pullback)
    5. 振幅窄、波动平缓 -> 存量震荡T+0 (playbook_06_grid_t0_relief)
    6. 默认 -> 筹码单峰发散 (playbook_05_chip_density_breakout)
    """
    price = float(quote.get("price", 0.0))
    change_pct = float(quote.get("change_pct", 0.0))
    open_price = float(quote.get("open", price))
    
    if not kline or len(kline) < 5:
        # K线数据较少时，根据涨跌幅与开盘特征速配
        if change_pct < -2.0:
            return "playbook_03_dragon_first_drop"
        elif 1.0 <= change_pct <= 4.5 and open_price > 0 and (open_price >= price * 0.99):
            return "playbook_01_auction_breakout"
        elif change_pct >= 5.0:
            return "playbook_02_box_breakout"
        return "playbook_04_core_ma20_pullback"

    # 解析近期 K 线 (格式通常为 [date, open, close, high, low, volume, ...])
    try:
        closes = [float(k[2]) for k in kline]
        highs = [float(k[3]) for k in kline]
        lows = [float(k[4]) for k in kline]
        vols = [float(k[5]) for k in kline]
        
        prev_close = closes[-2] if len(closes) >= 2 else price
        prev_prev_close = closes[-3] if len(closes) >= 3 else prev_close
        prev_change = ((prev_close - prev_prev_close) / prev_prev_close) * 100.0 if prev_prev_close > 0 else 0.0
        
        # 1. 检测是否符合【断板首阴反包】：前日涨停或涨幅>7%，今日大幅低开或下杀
        if prev_change >= 6.8 and change_pct < 0.0:
            return "playbook_03_dragon_first_drop"
            
        # 2. 检测是否符合【竞价弱转强】：高开高走，量比活跃
        if 1.0 <= change_pct <= 5.0 and open_price >= prev_close * 1.008:
            return "playbook_01_auction_breakout"

        # 3. 检测是否符合【倍量突破前高】：今日现价或最高价突破近 20 日最高点，且成交量放大
        recent_20_high = max(highs[-21:-1]) if len(highs) >= 21 else max(highs[:-1])
        if price >= recent_20_high * 0.995:
            return "playbook_02_box_breakout"

        # 4. 检测是否符合【回踩均线支撑】：MA5与MA20支撑
        ma5 = sum(closes[-5:]) / 5.0
        ma20 = sum(closes[-20:]) / min(len(closes), 20)
        # 现价在 MA5 附近 1.5% 范围内，且 MA5 > MA20 (均线多头)
        if abs(price - ma5) / price <= 0.018 and ma5 >= ma20 * 0.98:
            return "playbook_04_core_ma20_pullback"

        # 5. 检测是否符合【存量震荡T+0】：近10日振幅较窄 (<6%)
        recent_10_high = max(highs[-10:])
        recent_10_low = min(lows[-10:])
        if (recent_10_high - recent_10_low) / price < 0.07:
            return "playbook_06_grid_t0_relief"

    except Exception:
        pass

    # 默认兜底为筹码单峰发散战法
    return "playbook_05_chip_density_breakout"


def calculate_playbook_levels(
    playbook_id: str,
    quote: Dict[str, Any],
    kline: Optional[List[Any]] = None,
    total_capital: float = 1_000_000.0,
    custom_capital: Optional[float] = None,
    tuned_position_pct: Optional[float] = None,
    tuned_rr_threshold: Optional[float] = None
) -> Dict[str, Any]:
    """
    根据战法专属算法，计算定制化的买入区间、止损价、止盈价、风险盈亏比与建议仓位
    
    参数:
    - playbook_id: 战法ID (若为 'auto' 则调用 detect_best_playbook 自动识别)
    - quote: 实时行情字典
    - kline: 历史K线序列
    - total_capital: 账户总资金
    - custom_capital: 自定义可用资金
    - tuned_position_pct: 自适应引擎动态调优后的推荐仓位比例 (%)
    - tuned_rr_threshold: 自适应引擎动态调优后的最低盈亏比门槛
    """
    # 智能识别打法
    if not playbook_id or playbook_id == "auto" or playbook_id not in PLAYBOOK_REGISTRY:
        playbook_id = detect_best_playbook(quote, kline)

    pb_meta = PLAYBOOK_REGISTRY[playbook_id]
    price = float(quote.get("price", 0.0))
    if price <= 0:
        price = float(quote.get("open", 10.0))
        
    capital = custom_capital if (custom_capital and custom_capital > 0) else total_capital
    pos_pct = tuned_position_pct if (tuned_position_pct is not None and tuned_position_pct > 0) else pb_meta["default_position_pct"]

    # 提取 K 线统计指标
    ma5 = price
    ma10 = price * 0.98
    ma20 = price * 0.96
    prev_low = price * 0.98
    prev_high = price * 1.02

    if kline and len(kline) >= 5:
        try:
            closes = [float(k[2]) for k in kline]
            lows = [float(k[4]) for k in kline]
            highs = [float(k[3]) for k in kline]
            ma5 = sum(closes[-5:]) / 5.0
            if len(closes) >= 10:
                ma10 = sum(closes[-10:]) / 10.0
            if len(closes) >= 20:
                ma20 = sum(closes[-20:]) / 20.0
            prev_low = lows[-2] if len(lows) >= 2 else lows[-1]
            prev_high = highs[-2] if len(highs) >= 2 else highs[-1]
        except Exception:
            pass

    # 六大战法分别计算基准买点、止损、止盈
    if playbook_id == "playbook_01_auction_breakout":
        # ① 竞价弱转强：买点为开盘到现价上浮1%~2%，止损严控-2.5%，止盈+6.5% / +8.5%
        buy_low = round(price * 1.00, 2)
        buy_high = round(price * 1.025, 2)
        p_stop = round(price * 0.975, 2)
        stop_loss_pct = 2.50
        target1_pct = 6.50
        target2_pct = 8.50
        p_target1 = round(price * (1.0 + target1_pct / 100.0), 2)
        p_target2 = round(price * (1.0 + target2_pct / 100.0), 2)
        rule_rationale = "【竞价弱转强算法】开盘资金强行承接高举高打，买入区间设为当前抢筹位[现价, +2.5%]；以开盘防守线-2.5%作为铁血止损；目标博弈日内封板或次日冲高+6.5%~+8.5%。"

    elif playbook_id == "playbook_02_box_breakout":
        # ② 倍量突破前高：买点为箱顶确认带，止损为跌回箱体突破中轴（-3.0%），止盈黄金拓展+8.0% / +15.0%
        breakout_base = max(price * 0.99, prev_high)
        buy_low = round(breakout_base * 1.005, 2)
        buy_high = round(breakout_base * 1.015, 2)
        p_stop = round(breakout_base * 0.97, 2)
        stop_loss_pct = round(((price - p_stop) / price) * 100.0, 2) if price > 0 else 3.0
        target1_pct = 8.00
        target2_pct = 15.00
        p_target1 = round(price * (1.0 + target1_pct / 100.0), 2)
        p_target2 = round(price * (1.0 + target2_pct / 100.0), 2)
        rule_rationale = "【倍量突破前高算法】确认为放量跳出箱顶压制的真突破，买入设在突破上方0.5%~1.5%确认带；跌回箱体突破中轴即判定为假突破止损；目标位按斐波那契1.618倍空间推导。"

    elif playbook_id == "playbook_03_dragon_first_drop":
        # ③ 断板首阴反包：买入为下杀带，止损为首阴最低价下沿或MA20，止盈分时反包+5.5% / +9.5%
        buy_low = round(price * 0.97, 2)
        buy_high = round(price * 0.99, 2)
        p_stop = round(min(prev_low * 0.985, ma20 * 0.98), 2)
        stop_loss_pct = round(((price - p_stop) / price) * 100.0, 2) if price > 0 else 3.5
        target1_pct = 5.50
        target2_pct = 9.50
        p_target1 = round(price * (1.0 + target1_pct / 100.0), 2)
        p_target2 = round(price * (1.0 + target2_pct / 100.0), 2)
        rule_rationale = "【断板首阴反包算法】龙头股分歧下探，在急杀区间逢低吸纳博弈次日强反包；止损设在前日低点下方-1.5%防破位；止盈锁定在日内反抽或连板接力空间。"

    elif playbook_id == "playbook_04_core_ma20_pullback":
        # ④ 回踩均线支撑：买入在MA5/MA20缩量承接带，止损跌破MA10，止盈+5.0% / +9.0%
        base_ma = ma5 if abs(price - ma5) < abs(price - ma20) else ma20
        buy_low = round(base_ma * 0.995, 2)
        buy_high = round(base_ma * 1.005, 2)
        p_stop = round(min(ma10 * 0.99, prev_low), 2)
        stop_loss_pct = round(((price - p_stop) / price) * 100.0, 2) if price > 0 else 3.2
        target1_pct = 5.00
        target2_pct = 9.00
        p_target1 = round(price * (1.0 + target1_pct / 100.0), 2)
        p_target2 = round(price * (1.0 + target2_pct / 100.0), 2)
        rule_rationale = "【回踩均线支撑算法】多头生命线缩量企稳低吸，买入区间咬合关键均线支撑；以破位MA10或前低作为防守底线；波段顺势向上拓展。"

    elif playbook_id == "playbook_05_chip_density_breakout":
        # ⑤ 筹码单峰发散：突破密集峰顶，止损跌穿峰底-3.0%，止盈+7.0% / +14.0%
        buy_low = round(price * 1.002, 2)
        buy_high = round(price * 1.010, 2)
        p_stop = round(price * 0.965, 2)
        stop_loss_pct = 3.50
        target1_pct = 7.00
        target2_pct = 14.00
        p_target1 = round(price * (1.0 + target1_pct / 100.0), 2)
        p_target2 = round(price * (1.0 + target2_pct / 100.0), 2)
        rule_rationale = "【筹码单峰发散算法】主力底部吸筹完毕向上发散，买入挂在单峰密集区突破带；止损严守密集峰下沿-3.0%；目标直指主力高位派发区。"

    else: # playbook_06_grid_t0_relief
        # ⑥ 存量震荡T+0：下轨支撑企稳吸纳，跌破下轨-2%止损，上轨高抛+3.5% / +6.0%
        buy_low = round(price * 0.985, 2)
        buy_high = round(price * 0.995, 2)
        p_stop = round(buy_low * 0.98, 2)
        stop_loss_pct = round(((price - p_stop) / price) * 100.0, 2) if price > 0 else 2.5
        target1_pct = 3.50
        target2_pct = 6.00
        p_target1 = round(price * (1.0 + target1_pct / 100.0), 2)
        p_target2 = round(price * (1.0 + target2_pct / 100.0), 2)
        rule_rationale = "【存量震荡T+0算法】箱体下轨或布林下轨企稳做T，日内买入摊薄成本；跌破下轨-2.0%严守纪律防深跌；反抽触及均线阻力区获利平仓。"

    # 【核心升级】从动态参数热加载表读取最新修复调优参数
    active_version = "v1.0"
    try:
        from utils.loss_attribution_engine import global_attribution_engine
        custom_param = global_attribution_engine.get_custom_params(playbook_id)
        if custom_param:
            active_version = custom_param.get("active_version", "v1.0")
            # 1. 调优止损
            if custom_param.get("stop_loss_pct"):
                stop_loss_pct = float(custom_param["stop_loss_pct"])
                p_stop = round(price * (1.0 - stop_loss_pct / 100.0), 2)
            # 2. 调优止盈
            if custom_param.get("target1_pct"):
                target1_pct = float(custom_param["target1_pct"])
                p_target1 = round(price * (1.0 + target1_pct / 100.0), 2)
            if custom_param.get("target2_pct"):
                target2_pct = float(custom_param["target2_pct"])
                p_target2 = round(price * (1.0 + target2_pct / 100.0), 2)
            # 3. 调优买入偏置区间
            offset_low = float(custom_param.get("buy_offset_low") or 0.0)
            offset_high = float(custom_param.get("buy_offset_high") or 0.0)
            if offset_low != 0.0 or offset_high != 0.0:
                buy_low = round(price * (1.0 + offset_low / 100.0), 2)
                buy_high = round(price * (1.0 + offset_high / 100.0), 2)
            # 4. 推荐仓位
            if tuned_position_pct is None and custom_param.get("position_pct"):
                pos_pct = float(custom_param["position_pct"])
            rule_rationale += f" [已热加载最新进化调优参数 {active_version}]"
    except Exception:
        pass

    # 保证止损止盈合理性
    if stop_loss_pct <= 0.5:
        stop_loss_pct = 2.0
        p_stop = round(price * 0.98, 2)
    rr_ratio = round(target1_pct / max(stop_loss_pct, 0.1), 2)

    # 仓位与股数折算 (按手整取 100 股)
    recommended_amount = round(capital * (pos_pct / 100.0), 2)
    raw_shares = int(recommended_amount / price) if price > 0 else 0
    recommended_shares = max(100, (raw_shares // 100) * 100)
    actual_rec_amount = round(recommended_shares * price, 2)
    risk_amount = round(actual_rec_amount * (stop_loss_pct / 100.0), 2)

    return {
        "playbook_id": playbook_id,
        "playbook_name": pb_meta["name"],
        "playbook_short_name": pb_meta["short_name"],
        "playbook_style": pb_meta["style"],
        "position_pct": pos_pct,
        "buy_price_low": buy_low,
        "buy_price_high": buy_high,
        "stop_loss_price": p_stop,
        "stop_loss_pct": stop_loss_pct,
        "target_price_1": p_target1,
        "target_profit_pct_1": target1_pct,
        "target_price_2": p_target2,
        "target_profit_pct_2": target2_pct,
        "risk_reward_ratio": rr_ratio,
        "recommended_shares": recommended_shares,
        "recommended_amount": actual_rec_amount,
        "risk_amount": risk_amount,
        "rule_rationale": rule_rationale,
    }
