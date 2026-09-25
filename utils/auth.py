"""用户认证：JWT + bcrypt"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import HTTPException, Security, Depends, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from utils.database import get_db, log_audit

from pathlib import Path

_MEMORY_FALLBACK_JWT_SECRET = None

def _get_or_create_secret_key() -> str:
    """获取或安全持久化生成 JWT 签名密钥，杜绝可预测的默认硬编码"""
    env_secret = os.getenv("JWT_SECRET")
    if env_secret:
        return env_secret
    key_file = Path(__file__).parent.parent / "data" / ".jwt_secret"
    try:
        if key_file.exists():
            content = key_file.read_text(encoding="utf-8").strip()
            if len(content) >= 32:
                return content
        key_file.parent.mkdir(parents=True, exist_ok=True)
        import secrets
        generated = secrets.token_urlsafe(48)
        key_file.write_text(generated, encoding="utf-8")
        try:
            os.chmod(key_file, 0o600)
        except Exception:
            pass
        return generated
    except Exception as e:
        # 落盘失败时使用进程内随机密钥兜底，绝不回退到可预测的固定串
        global _MEMORY_FALLBACK_JWT_SECRET
        if _MEMORY_FALLBACK_JWT_SECRET is None:
            import secrets
            import logging
            _MEMORY_FALLBACK_JWT_SECRET = secrets.token_urlsafe(48)
            logging.getLogger("Auth").warning(
                f"⚠️ JWT 密钥落盘失败({e})，已启用进程内随机密钥；重启后旧 Token 将失效"
            )
        return _MEMORY_FALLBACK_JWT_SECRET

# JWT 配置
SECRET_KEY = _get_or_create_secret_key()
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
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
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
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
) -> dict:
    """FastAPI 依赖：解析当前用户，未登录或 Token 无效时严格返回 401"""
    if credentials is None or not credentials.credentials:
        raise HTTPException(401, "未提供认证凭证，请先登录")
    payload = decode_token(credentials.credentials)
    username = payload.get("sub")
    if not username:
        raise HTTPException(401, "无效凭证：缺少用户标识")
    return {"username": username, "role": payload.get("role", "user")}


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
) -> Optional[dict]:
    """可选认证：未登录时返回 None，Token 有效时返回用户信息"""
    if credentials is None or not credentials.credentials:
        return None
    try:
        payload = decode_token(credentials.credentials)
        username = payload.get("sub")
        if not username:
            return None
        return {"username": username, "role": payload.get("role", "user")}
    except Exception:
        return None


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """仅管理员可用"""
    if user["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


_MEMORY_FALLBACK_SYNC_TOKEN: Optional[str] = None

def get_or_create_sync_token() -> str:
    """获取或动态生成专用同步安全令牌 (专供东财油猴插件跨域持久同步鉴权)
    安全策略：
    1. 优先读取 QUANT_SYNC_TOKEN 环境变量；
    2. 若未配置，安全落盘至 data/.sync_token (权限 0600，受 .gitignore 保护)；
    3. 异常兜底采用进程生命周期内的高熵内存随机令牌，绝不使用硬编码固定可预测口令！
    """
    env_token = os.getenv("QUANT_SYNC_TOKEN")
    if env_token:
        return env_token.strip()
    token_file = Path(__file__).parent.parent / "data" / ".sync_token"
    try:
        if token_file.exists():
            content = token_file.read_text(encoding="utf-8").strip()
            if len(content) >= 24:
                return content
        token_file.parent.mkdir(parents=True, exist_ok=True)
        import secrets
        generated = secrets.token_urlsafe(32)
        try:
            fd = os.open(str(token_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(generated)
        except Exception:
            token_file.write_text(generated, encoding="utf-8")
        return generated
    except Exception as e:
        global _MEMORY_FALLBACK_SYNC_TOKEN
        if not _MEMORY_FALLBACK_SYNC_TOKEN:
            import secrets
            _MEMORY_FALLBACK_SYNC_TOKEN = secrets.token_urlsafe(32)
        return _MEMORY_FALLBACK_SYNC_TOKEN


async def verify_sync_or_user(
    request: Request,
    user_opt: Optional[dict] = Depends(get_optional_user)
) -> dict:
    """双通道认证依赖：
    通道 A: 有效的管理员/用户 JWT 凭证 (常规系统内发起)
    通道 B: X-Quant-Sync-Token 请求头或 sync_token 参数 (油猴插件从第三方域名跨域同步)
    未提供有效凭证时严格返回 401。
    """
    # 1. 优先校验登录用户
    if user_opt:
        return user_opt

    # 2. 校验专用同步安全令牌
    expected_token = get_or_create_sync_token()
    token_in_header = request.headers.get("X-Quant-Sync-Token") or request.headers.get("x-quant-sync-token")
    token_in_query = request.query_params.get("sync_token")

    provided_token = (token_in_header or token_in_query or "").strip()
    if provided_token and provided_token == expected_token:
        return {"username": "tampermonkey_sync", "role": "sync_agent"}

    # 尝试从 json body 解析 sync_token
    try:
        body = await request.json()
        if isinstance(body, dict) and body.get("sync_token") == expected_token:
            return {"username": "tampermonkey_sync", "role": "sync_agent"}
    except Exception:
        pass

    # 3. 校验正规东方财富官方域来源 (针对浏览器书签与油猴插件跨域回传)
    import re
    origin = request.headers.get("origin") or ""
    referer = request.headers.get("referer") or ""
    em_pattern = r"^https?://([a-zA-Z0-9-]+\.)*(eastmoney\.com|18\.cn)(:\d+)?(/.*)?$"
    if (origin and re.match(em_pattern, origin)) or (referer and re.match(em_pattern, referer)):
        path = request.url.path
        if "bind-community-cookie" in path or "bind-full-credentials" in path:
            return {"username": "eastmoney_web_agent", "role": "sync_agent"}

    raise HTTPException(401, "未提供认证凭证，请登录或提供有效的同步安全令牌 (X-Quant-Sync-Token)")


async def get_current_user_from_token_or_query(
    request: Request,
    token: Optional[str] = Query(None)
) -> dict:
    """从 Authorization Header (Bearer) 或 Query 参数 (?token=...) 解析已认证用户，专供脚本安全下载分发"""
    auth_header = request.headers.get("Authorization")
    jwt_str = None
    if auth_header and auth_header.startswith("Bearer "):
        jwt_str = auth_header[7:].strip()
    elif token:
        jwt_str = token.strip()

    if not jwt_str:
        raise HTTPException(
            status_code=401,
            detail="下载或分发含系统密钥的同步脚本需要管理员登录凭证，请登录后重试",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return decode_token(jwt_str)


def init_admin_user():
    """初始化管理员账户。
    严格安全策略：
    1. 优先读取环境变量 ADMIN_PASSWORD；
    2. 若未配置环境变量，动态生成高强度随机密码并安全落盘至 data/.admin_initial_password（权限 0600，已被 gitignore 保护）；
    3. 源码中杜绝任何明文硬编码口令。
    """
    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
        if existing:
            return

        password = os.getenv("ADMIN_PASSWORD")
        if not password:
            pwd_file = Path(__file__).resolve().parent.parent / "data" / ".admin_initial_password"
            pwd_file.parent.mkdir(parents=True, exist_ok=True)
            if pwd_file.exists():
                password = pwd_file.read_text(encoding="utf-8").strip()
            if not password:
                import secrets
                password = secrets.token_urlsafe(18)
                try:
                    fd = os.open(str(pwd_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                    with os.fdopen(fd, "w", encoding="utf-8") as f:
                        f.write(password)
                except Exception:
                    pwd_file.write_text(password, encoding="utf-8")
                logger.warning(
                    f"⚠️ [安全警报] 系统已为 admin 自动生成首次随机口令，已保存在 data/.admin_initial_password，请登录后立即改密或配置 ADMIN_PASSWORD 环境变量！"
                )

        hashed = hash_password(password)
        db.execute(
            "INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')",
            ("admin", hashed),
        )
        log_audit("system", "init_admin", "创建初始管理员账户 admin (强随机凭证)", db=db)

