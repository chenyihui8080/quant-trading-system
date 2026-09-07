"""
Alpha 实战交易服务层 (Service)
负责买卖点即时测算、动态止损止盈、1%风险法则倒算仓位与全市场选股扫描
"""
from typing import Optional, Dict, Any, List
from utils.alpha_engine import AlphaEngine, AlphaRuleConfig, TradeDecisionResult
from crud.crud_risk_config import get_user_risk_config, save_user_risk_config


class AlphaService:
    """Alpha 交易与风控计算服务"""

    def __init__(self):
        self.engine = AlphaEngine()

    def get_user_config(self, username: str) -> AlphaRuleConfig:
        """获取用户独立的 Alpha 风控配置"""
        raw = get_user_risk_config(username)
        return AlphaRuleConfig(
            total_capital=float(raw.get("total_capital", 1_000_000.0)),
            risk_r_pct=float(raw.get("risk_r_pct", 1.0)),
            max_position_pct=float(raw.get("max_position_pct", 20.0)),
            target1_profit_pct=float(raw.get("target1_profit_pct", 6.0)),
            target2_profit_pct=float(raw.get("target2_profit_pct", 12.0)),
            tail_min_pct=float(raw.get("tail_min_pct", 3.0)),
        )

    def update_user_config(self, username: str, config_dict: dict) -> AlphaRuleConfig:
        """更新用户独立的 Alpha 风控配置 (持久化入库)"""
        saved = save_user_risk_config(username, config_dict)
        return AlphaRuleConfig(
            total_capital=float(saved.get("total_capital", 1_000_000.0)),
            risk_r_pct=float(saved.get("risk_r_pct", 1.0)),
            max_position_pct=float(saved.get("max_position_pct", 20.0)),
            target1_profit_pct=float(saved.get("target1_profit_pct", 6.0)),
            target2_profit_pct=float(saved.get("target2_profit_pct", 12.0)),
            tail_min_pct=float(saved.get("tail_min_pct", 3.0)),
        )

    def calculate_levels(
        self,
        username: str,
        current_price: float,
        kline: list,
        custom_capital: Optional[float] = None
    ) -> TradeDecisionResult:
        """
        根据用户专属风控配置，计算单只标的的买卖点与 1% 倒算仓位
        """
        user_cfg = self.get_user_config(username)
        custom_engine = AlphaEngine(user_cfg)
        return custom_engine.calculate_trade_levels(
            current_price=current_price,
            kline=kline,
            custom_capital=custom_capital
        )


# 全局单例服务
global_alpha_service = AlphaService()
