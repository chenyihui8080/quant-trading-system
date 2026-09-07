"""
数据库兼容桥接层 (向后兼容所有现有引用，底层无缝委派给 core.database 与 crud 模块)
"""
import json
import sqlite3
from pathlib import Path
from core.database import DB_PATH, get_db, init_db
from core.datetime_utils import format_timestamp
from crud.crud_order import save_or_update_order, get_user_order_history
from crud.crud_user import (
    add_user_favorite, remove_user_favorite, get_user_favorites,
    is_user_favorite, record_audit_log, get_user_audit_logs
)


# ==================== 回测记录 ====================

def save_backtest(
    strategy: str,
    symbol: str,
    params: dict,
    risk_config: dict,
    capital: float,
    data_count: int,
    stats: dict,
    username: str = "admin"
) -> int:
    with get_db() as db:
        cursor = db.execute(
            """INSERT INTO backtest_records (
                username, strategy, symbol, params, risk_config, capital, data_count, stats, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (username, strategy, symbol, json.dumps(params, ensure_ascii=False),
             json.dumps(risk_config, ensure_ascii=False), capital, data_count,
             json.dumps(stats, ensure_ascii=False, default=str), format_timestamp()),
        )
        return cursor.lastrowid


def get_backtest_history(
    strategy: str = "",
    symbol: str = "",
    limit: int = 50,
    offset: int = 0,
    username: str = ""
) -> list[dict]:
    conditions = []
    params = []
    if username:
        conditions.append("username = ?")
        params.append(username)
    if strategy:
        conditions.append("strategy = ?")
        params.append(strategy)
    if symbol:
        conditions.append("symbol = ?")
        params.append(symbol)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params.extend([limit, offset])

    with get_db() as db:
        rows = db.execute(
            f"""SELECT id, username, strategy, symbol, params, risk_config, capital, data_count, stats, created_at
                FROM backtest_records {where} ORDER BY id DESC LIMIT ? OFFSET ?""",
            params,
        ).fetchall()

    results = []
    for row in rows:
        item = dict(row)
        item["params"] = json.loads(item["params"]) if item["params"] else {}
        item["risk_config"] = json.loads(item["risk_config"]) if item["risk_config"] else {}
        item["stats"] = json.loads(item["stats"]) if item["stats"] else {}
        results.append(item)
    return results


def get_backtest_by_id(record_id: int) -> dict | None:
    with get_db() as db:
        row = db.execute(
            """SELECT id, username, strategy, symbol, params, risk_config, capital, data_count, stats, created_at
               FROM backtest_records WHERE id = ?""", (record_id,)
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["params"] = json.loads(item["params"]) if item["params"] else {}
    item["risk_config"] = json.loads(item["risk_config"]) if item["risk_config"] else {}
    item["stats"] = json.loads(item["stats"]) if item["stats"] else {}
    return item


# ==================== 订单记录 (桥接至 crud_order) ====================

def save_order(order_dict: dict, username: str = "admin"):
    """兼容旧 save_order 调用，智能提取并注入 username"""
    user = order_dict.get("username") or username or "admin"
    save_or_update_order(user, order_dict)


def get_order_history(
    strategy: str = "",
    symbol: str = "",
    status: str = "",
    limit: int = 100,
    username: str = ""
) -> list[dict]:
    """兼容旧 get_order_history 调用"""
    if username:
        return get_user_order_history(username, strategy=strategy, symbol=symbol, status=status, limit=limit)
    # 若无 username 则向后兼容查询全部或 admin
    return get_user_order_history("admin", strategy=strategy, symbol=symbol, status=status, limit=limit)


# ==================== 因子记录 ====================

def save_factor_ranking(symbols: list, weights: dict, ranking: list):
    with get_db() as db:
        db.execute(
            """INSERT INTO factor_records (symbols, weights, ranking, created_at)
               VALUES (?, ?, ?, ?)""",
            (json.dumps(symbols), json.dumps(weights), json.dumps(ranking, ensure_ascii=False), format_timestamp()),
        )


def get_factor_history(limit: int = 20) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            """SELECT id, symbols, weights, ranking, created_at
               FROM factor_records ORDER BY id DESC LIMIT ?""", (limit,)
        ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["symbols"] = json.loads(item["symbols"])
        item["weights"] = json.loads(item["weights"]) if item["weights"] else {}
        item["ranking"] = json.loads(item["ranking"])
        results.append(item)
    return results


# ==================== 审计日志与自选股兼容桥接 ====================

def log_audit(username: str, action: str, detail: str = "", ip: str = "", db=None):
    record_audit_log(username, action, detail, ip, db)


def get_audit_log(username: str = "", limit: int = 100) -> list[dict]:
    return get_user_audit_logs(username, limit)


def add_favorite(username: str, symbol: str, name: str = "") -> bool:
    return add_user_favorite(username, symbol, name)


def remove_favorite(username: str, symbol: str) -> bool:
    return remove_user_favorite(username, symbol)


def get_favorites(username: str) -> list[dict]:
    return get_user_favorites(username)


def is_favorite(username: str, symbol: str) -> bool:
    return is_user_favorite(username, symbol)
