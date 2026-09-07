"""
风控配置数据访问层 (CRUD / DAO)
解决 A-RISK-001: 风控配置持久化入库，按用户隔离，防重启丢失
"""
from typing import Dict, Any, Optional
from core.database import get_db
from core.datetime_utils import format_timestamp

# 默认风控标准配置
DEFAULT_RISK_CONFIG = {
    "total_capital": 1_000_000.0,
    "risk_r_pct": 1.0,
    "max_position_pct": 20.0,
    "target1_profit_pct": 6.0,
    "target2_profit_pct": 12.0,
    "tail_min_pct": 3.0
}


def get_user_risk_config(username: str) -> Dict[str, Any]:
    """获取指定用户的风控配置，如不存在则初始化并返回默认值"""
    with get_db() as db:
        row = db.execute("""
            SELECT total_capital, risk_r_pct, max_position_pct,
                   target1_profit_pct, target2_profit_pct, tail_min_pct
            FROM risk_configs
            WHERE username = ?
        """, (username,)).fetchone()
        
        if row:
            return dict(row)
            
        # 不存在则持久化一份默认配置
        now_str = format_timestamp()
        db.execute("""
            INSERT INTO risk_configs (
                username, total_capital, risk_r_pct, max_position_pct,
                target1_profit_pct, target2_profit_pct, tail_min_pct, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            username,
            DEFAULT_RISK_CONFIG["total_capital"],
            DEFAULT_RISK_CONFIG["risk_r_pct"],
            DEFAULT_RISK_CONFIG["max_position_pct"],
            DEFAULT_RISK_CONFIG["target1_profit_pct"],
            DEFAULT_RISK_CONFIG["target2_profit_pct"],
            DEFAULT_RISK_CONFIG["tail_min_pct"],
            now_str
        ))
        return dict(DEFAULT_RISK_CONFIG)


def save_user_risk_config(username: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """保存或更新用户风控配置 (强制校验资金与比例合法性)"""
    total_capital = float(config.get("total_capital", 1_000_000.0))
    risk_r_pct = float(config.get("risk_r_pct", 1.0))
    max_position_pct = float(config.get("max_position_pct", 20.0))
    target1_profit_pct = float(config.get("target1_profit_pct", 6.0))
    target2_profit_pct = float(config.get("target2_profit_pct", 12.0))
    tail_min_pct = float(config.get("tail_min_pct", 3.0))

    now_str = format_timestamp()
    with get_db() as db:
        db.execute("""
            INSERT INTO risk_configs (
                username, total_capital, risk_r_pct, max_position_pct,
                target1_profit_pct, target2_profit_pct, tail_min_pct, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                total_capital = excluded.total_capital,
                risk_r_pct = excluded.risk_r_pct,
                max_position_pct = excluded.max_position_pct,
                target1_profit_pct = excluded.target1_profit_pct,
                target2_profit_pct = excluded.target2_profit_pct,
                tail_min_pct = excluded.tail_min_pct,
                updated_at = excluded.updated_at
        """, (
            username, total_capital, risk_r_pct, max_position_pct,
            target1_profit_pct, target2_profit_pct, tail_min_pct, now_str
        ))

    return get_user_risk_config(username)
