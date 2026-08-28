#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自然语言量化策略规则库与代码生成模板 (NL Parser Rules & Templates)
"""

STRATEGY_KEYWORDS = {
    "double_ma": ["双均线", "均线交叉", "金叉", "死叉", "ma交叉", "快线", "慢线"],
    "boll": ["布林带", "布林通道", "boll", "突破上轨", "跌破下轨"],
    "atr_rsi": ["atr", "rsi", "波动率", "相对强弱", "超买", "超卖"],
    "turtle": ["海龟", "唐奇安", "突破20日高点", "海龟交易"],
    "grid": ["网格", "网格交易", "高抛低吸", "震荡网格"],
}

DEFAULT_PARAMS = {
    "double_ma": {"fast_window": 10, "slow_window": 30},
    "boll": {"boll_window": 20, "boll_dev": 2.0},
    "atr_rsi": {"atr_window": 14, "rsi_window": 14, "rsi_entry": 30, "rsi_exit": 70},
    "turtle": {"entry_window": 20, "exit_window": 10, "atr_window": 20},
    "grid": {"grid_step": 0.02, "max_positions": 5},
}

CODE_TEMPLATES = {
    "double_ma": """from vnpy_ctastrategy import CtaTemplate, BarData, ArrayManager

class DynamicDoubleMaStrategy(CtaTemplate):
    fast_window = {fast_window}
    slow_window = {slow_window}
    
    def __init__(self, cta_engine, strategy_name, vt_symbol, setting):
        super().__init__(cta_engine, strategy_name, vt_symbol, setting)
        self.am = ArrayManager()

    def on_bar(self, bar: BarData):
        self.am.update_bar(bar)
        if not self.am.inited:
            return
        fast_ma = self.am.sma(self.fast_window, array=True)
        slow_ma = self.am.sma(self.slow_window, array=True)
        if fast_ma[-1] > slow_ma[-1] and fast_ma[-2] <= slow_ma[-2]:
            self.buy(bar.close_price, 1)
        elif fast_ma[-1] < slow_ma[-1] and fast_ma[-2] >= slow_ma[-2]:
            self.sell(bar.close_price, 1)
"""
}
