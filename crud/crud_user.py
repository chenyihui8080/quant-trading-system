"""
用户与自选股数据访问层 (CRUD / DAO)
"""
from typing import List, Dict, Optional
from core.database import get_db
from core.datetime_utils import format_timestamp


def add_user_favorite(username: str, symbol: str, name: str = "") -> bool:
    """添加用户自选股"""
    try:
        with get_db() as db:
            db.execute("""
                INSERT OR IGNORE INTO user_favorites (username, symbol, name, added_at)
                VALUES (?, ?, ?, ?)
            """, (username, symbol, name, format_timestamp()))
        return True
    except Exception:
        return False


def remove_user_favorite(username: str, symbol: str) -> bool:
    """移除用户自选股"""
    with get_db() as db:
        db.execute("""
            DELETE FROM user_favorites WHERE username = ? AND symbol = ?
        """, (username, symbol))
    return True


def get_user_favorites(username: str) -> List[Dict]:
    """获取用户自选股列表 (严格按用户隔离)"""
    with get_db() as db:
        rows = db.execute("""
            SELECT symbol, name, added_at
            FROM user_favorites
            WHERE username = ?
            ORDER BY added_at DESC
        """, (username,)).fetchall()
    return [dict(r) for r in rows]


def is_user_favorite(username: str, symbol: str) -> bool:
    """检查是否为当前用户的自选股"""
    with get_db() as db:
        row = db.execute("""
            SELECT 1 FROM user_favorites WHERE username = ? AND symbol = ?
        """, (username, symbol)).fetchone()
    return row is not None


def record_audit_log(username: str, action: str, detail: str = "", ip: str = "", db=None):
    """记录审计日志"""
    now_str = format_timestamp()
    if db:
        db.execute("""
            INSERT INTO audit_log (username, action, detail, ip, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (username, action, detail, ip, now_str))
    else:
        with get_db() as conn:
            conn.execute("""
                INSERT INTO audit_log (username, action, detail, ip, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (username, action, detail, ip, now_str))


def get_user_audit_logs(username: str = "", limit: int = 100) -> List[Dict]:
    """查询审计日志"""
    with get_db() as db:
        if username:
            rows = db.execute("""
                SELECT id, username, action, detail, ip, created_at
                FROM audit_log
                WHERE username = ?
                ORDER BY id DESC
                LIMIT ?
            """, (username, limit)).fetchall()
        else:
            rows = db.execute("""
                SELECT id, username, action, detail, ip, created_at
                FROM audit_log
                ORDER BY id DESC
                LIMIT ?
            """, (limit,)).fetchall()
    return [dict(r) for r in rows]
