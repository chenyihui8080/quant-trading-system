"""
SQLite 核心数据库连接池与表结构初始化管理
严格遵循阿里规范与数据隔离要求 (解决 A-ORDER-001, A-RISK-001)
"""
import sqlite3
import os
from pathlib import Path
from contextlib import contextmanager

# 默认数据库路径 (支持环境变量与单元测试 monkeypatch)
DB_PATH = Path(__file__).parent.parent / "data" / "quant.db"


@contextmanager
def get_db():
    """获取数据库连接（上下文管理器，支持 WAL 模式与外键约束）"""
    # 兼容测试框架对 utils.database.DB_PATH 的 monkeypatch
    target_path = DB_PATH
    try:
        import utils.database
        if hasattr(utils.database, "DB_PATH") and utils.database.DB_PATH != DB_PATH:
            target_path = utils.database.DB_PATH
    except Exception:
        pass

    target_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target_path))
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
    """初始化数据库表结构并自动执行增量迁移"""
    with get_db() as db:
        # 1. 基础表结构初始化
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

            -- 订单记录 (A-ORDER-001 强制 username 隔离)
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

            -- 风控配置持久化表 (A-RISK-001 解决内存字典与重启丢失问题)
            CREATE TABLE IF NOT EXISTS risk_configs (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                username            TEXT NOT NULL UNIQUE,
                total_capital       REAL NOT NULL DEFAULT 1000000.0,
                risk_r_pct          REAL NOT NULL DEFAULT 1.0,
                max_position_pct    REAL NOT NULL DEFAULT 20.0,
                target1_profit_pct  REAL NOT NULL DEFAULT 6.0,
                target2_profit_pct  REAL NOT NULL DEFAULT 12.0,
                tail_min_pct        REAL NOT NULL DEFAULT 3.0,
                updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- 用户自定义策略表 (A-STRATEGY-001 用户隔离)
            CREATE TABLE IF NOT EXISTS user_strategies (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                username    TEXT NOT NULL,
                strategy_id TEXT NOT NULL,
                name        TEXT NOT NULL,
                config_json TEXT NOT NULL,
                version     INTEGER NOT NULL DEFAULT 1,
                updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                UNIQUE(username, strategy_id)
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
        """)

        # 2. 增量热迁移：先确认字段存在，再建索引
        cursor = db.execute("PRAGMA table_info(order_records)")
        order_cols = [row["name"] for row in cursor.fetchall()]
        if "username" not in order_cols:
            db.execute("ALTER TABLE order_records ADD COLUMN username TEXT NOT NULL DEFAULT 'admin'")

        cursor_bt = db.execute("PRAGMA table_info(backtest_records)")
        bt_cols = [row["name"] for row in cursor_bt.fetchall()]
        if "username" not in bt_cols:
            db.execute("ALTER TABLE backtest_records ADD COLUMN username TEXT NOT NULL DEFAULT 'admin'")

        # 3. 创建索引
        db.executescript("""
            CREATE INDEX IF NOT EXISTS idx_orders_username ON order_records(username);
            CREATE INDEX IF NOT EXISTS idx_orders_strategy ON order_records(strategy_name);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON order_records(status);
            CREATE INDEX IF NOT EXISTS idx_backtest_username ON backtest_records(username);
            CREATE INDEX IF NOT EXISTS idx_backtest_strategy ON backtest_records(strategy);
            CREATE INDEX IF NOT EXISTS idx_backtest_symbol ON backtest_records(symbol);
            CREATE INDEX IF NOT EXISTS idx_audit_username ON audit_log(username);
            CREATE INDEX IF NOT EXISTS idx_strat_username ON user_strategies(username);
        """)
