"""用户认证：JWT + bcrypt"""
import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from utils.database import get_db, log_audit

# JWT 配置
SECRET_KEY = os.getenv("JWT_SECRET", "quant-system-secret-key-change-in-production-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_token(username: str, role: str = "user") -> str:
    payload = {
        "sub": username,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token 已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "无效的 Token")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """FastAPI 依赖：解析当前用户（所有受保护接口使用）"""
    if credentials is None:
        raise HTTPException(401, "未提供认证凭证，请先登录")
    payload = decode_token(credentials.credentials)
    return {"username": payload["sub"], "role": payload.get("role", "user")}


def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> Optional[dict]:
    """可选认证（部分接口可以无 Token 访问）"""
    if credentials is None:
        return None
    try:
        payload = decode_token(credentials.credentials)
        return {"username": payload["sub"], "role": payload.get("role", "user")}
    except Exception:
        return None


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """仅管理员可用"""
    if user["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


def init_admin_user():
    """初始化默认管理员账户（仅首次）"""
    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
        if existing:
            return

        password = os.getenv("ADMIN_PASSWORD", "admin123")
        hashed = hash_password(password)
        db.execute(
            "INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')",
            ("admin", hashed),
        )
        log_audit("system", "init_admin", "创建默认管理员账户 admin", db=db)
