"""SQLite 持久化存储"""
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent.parent / "data" / "quant.db"


@contextmanager
def get_db():
    """获取数据库连接（上下文管理器）"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """初始化数据库表结构"""
    with get_db() as db:
        db.executescript("""
            -- 用户表
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                username    TEXT NOT NULL UNIQUE,
                password    TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'user',
                created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                last_login  TEXT
            );

            -- 回测记录
            CREATE TABLE IF NOT EXISTS backtest_records (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                strategy    TEXT NOT NULL,
                symbol      TEXT NOT NULL,
                params      TEXT,
                risk_config TEXT,
                capital     REAL NOT NULL DEFAULT 1000000,
                data_count  INTEGER,
                stats       TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- 订单记录
            CREATE TABLE IF NOT EXISTS order_records (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id        TEXT NOT NULL UNIQUE,
                strategy_name   TEXT NOT NULL,
                symbol          TEXT NOT NULL,
                direction       TEXT NOT NULL,
                offset          TEXT NOT NULL,
                price           REAL NOT NULL,
                volume          INTEGER NOT NULL,
                filled_volume   INTEGER DEFAULT 0,
                avg_price       REAL DEFAULT 0,
                status          TEXT NOT NULL,
                broker_order_id TEXT DEFAULT '',
                reason          TEXT DEFAULT '',
                created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at      TEXT
            );

            -- 因子打分记录
            CREATE TABLE IF NOT EXISTS factor_records (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                symbols     TEXT NOT NULL,
                weights     TEXT,
                ranking     TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- 审计日志
            CREATE TABLE IF NOT EXISTS audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                username    TEXT NOT NULL,
                action      TEXT NOT NULL,
                detail      TEXT,
                ip          TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- 用户自选股
            CREATE TABLE IF NOT EXISTS user_favorites (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                username    TEXT NOT NULL,
                symbol      TEXT NOT NULL,
                name        TEXT DEFAULT '',
                added_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                UNIQUE(username, symbol)
            );

            CREATE INDEX IF NOT EXISTS idx_backtest_strategy ON backtest_records(strategy);
            CREATE INDEX IF NOT EXISTS idx_backtest_symbol ON backtest_records(symbol);
            CREATE INDEX IF NOT EXISTS idx_orders_strategy ON order_records(strategy_name);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON order_records(status);
            CREATE INDEX IF NOT EXISTS idx_audit_username ON audit_log(username);
        """)


# ==================== 回测记录 ====================

def save_backtest(
    strategy: str,
    symbol: str,
    params: dict,
    risk_config: dict,
    capital: float,
    data_count: int,
    stats: dict,
) -> int:
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO backtest_records (strategy, symbol, params, risk_config, capital, data_count, stats) VALUES (?,?,?,?,?,?,?)",
            (strategy, symbol, json.dumps(params, ensure_ascii=False),
             json.dumps(risk_config, ensure_ascii=False), capital, data_count,
             json.dumps(stats, ensure_ascii=False, default=str)),
        )
        return cursor.lastrowid


def get_backtest_history(
    strategy: str = "",
    symbol: str = "",
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    conditions = []
    params = []
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
            f"SELECT * FROM backtest_records {where} ORDER BY id DESC LIMIT ? OFFSET ?",
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
        row = db.execute("SELECT * FROM backtest_records WHERE id = ?", (record_id,)).fetchone()
    if not row:
        return None
    item = dict(row)
    item["params"] = json.loads(item["params"]) if item["params"] else {}
    item["risk_config"] = json.loads(item["risk_config"]) if item["risk_config"] else {}
    item["stats"] = json.loads(item["stats"]) if item["stats"] else {}
    return item


# ==================== 订单记录 ====================

def save_order(order_dict: dict):
    with get_db() as db:
        db.execute(
            """INSERT OR REPLACE INTO order_records
            (order_id, strategy_name, symbol, direction, offset, price, volume,
             filled_volume, avg_price, status, broker_order_id, reason, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (order_dict["order_id"], order_dict["strategy"], order_dict["symbol"],
             order_dict["direction"], order_dict["offset"], order_dict["price"],
             order_dict["volume"], order_dict["filled_volume"], order_dict["avg_price"],
             order_dict["status"], order_dict.get("broker_order_id", ""),
             order_dict.get("reason", ""), datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )


def get_order_history(
    strategy: str = "",
    symbol: str = "",
    status: str = "",
    limit: int = 100,
) -> list[dict]:
    conditions = []
    params = []
    if strategy:
        conditions.append("strategy_name = ?")
        params.append(strategy)
    if symbol:
        conditions.append("symbol = ?")
        params.append(symbol)
    if status:
        conditions.append("status = ?")
        params.append(status)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params.append(limit)

    with get_db() as db:
        rows = db.execute(
            f"SELECT * FROM order_records {where} ORDER BY id DESC LIMIT ?",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


# ==================== 因子记录 ====================

def save_factor_ranking(symbols: list, weights: dict, ranking: list):
    with get_db() as db:
        db.execute(
            "INSERT INTO factor_records (symbols, weights, ranking) VALUES (?,?,?)",
            (json.dumps(symbols), json.dumps(weights), json.dumps(ranking, ensure_ascii=False)),
        )


def get_factor_history(limit: int = 20) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM factor_records ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["symbols"] = json.loads(item["symbols"])
        item["weights"] = json.loads(item["weights"]) if item["weights"] else {}
        item["ranking"] = json.loads(item["ranking"])
        results.append(item)
    return results


# ==================== 审计日志 ====================

def log_audit(username: str, action: str, detail: str = "", ip: str = "", db=None):
    """记录审计日志（db 为外部传入的连接，避免嵌套死锁）"""
    if db:
        db.execute(
            "INSERT INTO audit_log (username, action, detail, ip) VALUES (?,?,?,?)",
            (username, action, detail, ip),
        )
    else:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO audit_log (username, action, detail, ip) VALUES (?,?,?,?)",
                (username, action, detail, ip),
            )


def get_audit_log(username: str = "", limit: int = 100) -> list[dict]:
    if username:
        with get_db() as db:
            rows = db.execute(
                "SELECT * FROM audit_log WHERE username = ? ORDER BY id DESC LIMIT ?",
                (username, limit),
            ).fetchall()
    else:
        with get_db() as db:
            rows = db.execute(
                "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
    return [dict(r) for r in rows]


# ==================== 用户自选股 ====================

def add_favorite(username: str, symbol: str, name: str = "") -> bool:
    """添加自选股"""
    try:
        with get_db() as db:
            db.execute(
                "INSERT OR IGNORE INTO user_favorites (username, symbol, name) VALUES (?,?,?)",
                (username, symbol, name),
            )
        return True
    except Exception:
        return False


def remove_favorite(username: str, symbol: str) -> bool:
    """删除自选股"""
    with get_db() as db:
        db.execute(
            "DELETE FROM user_favorites WHERE username = ? AND symbol = ?",
            (username, symbol),
        )
    return True


def get_favorites(username: str) -> list[dict]:
    """获取用户自选股列表"""
    with get_db() as db:
        rows = db.execute(
            "SELECT symbol, name, added_at FROM user_favorites WHERE username = ? ORDER BY added_at DESC",
            (username,),
        ).fetchall()
    return [dict(r) for r in rows]


def is_favorite(username: str, symbol: str) -> bool:
    """检查是否已收藏"""
    with get_db() as db:
        row = db.execute(
            "SELECT 1 FROM user_favorites WHERE username = ? AND symbol = ?",
            (username, symbol),
        ).fetchone()
    return row is not None
