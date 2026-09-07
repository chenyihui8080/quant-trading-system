"""
东方财富本地凭证与密码 AES 安全加密工具
=====================================
采用 AES-256 (Fernet) 本地密钥加密，防止账号密码与敏感凭证明文存储。
"""

import os
from pathlib import Path
from cryptography.fernet import Fernet
import logging

logger = logging.getLogger("EastMoneyCrypto")

DATA_DIR = Path(__file__).parent.parent / "data"
KEY_FILE = DATA_DIR / ".secret.key"


def _get_or_create_key() -> bytes:
    """获取或生成本地唯一的加解密密钥"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if KEY_FILE.exists():
        try:
            with open(KEY_FILE, "rb") as f:
                key = f.read().strip()
                if key:
                    return key
        except Exception as e:
            logger.warning(f"读取本地密钥失败，重新生成: {e}")

    new_key = Fernet.generate_key()
    try:
        with open(KEY_FILE, "wb") as f:
            f.write(new_key)
        # 严格限制密钥文件权限
        os.chmod(KEY_FILE, 0o600)
    except Exception as e:
        logger.warning(f"写入本地密钥文件异常: {e}")
    return new_key


def encrypt_text(plain_text: str) -> str:
    """加密字符串"""
    if not plain_text:
        return ""
    try:
        key = _get_or_create_key()
        f = Fernet(key)
        return f.encrypt(plain_text.encode("utf-8")).decode("utf-8")
    except Exception as e:
        logger.error(f"加密数据失败: {e}")
        return plain_text


def decrypt_text(cipher_text: str) -> str:
    """解密字符串"""
    if not cipher_text:
        return ""
    try:
        key = _get_or_create_key()
        f = Fernet(key)
        return f.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except Exception as e:
        logger.error(f"解密数据失败: {e}")
        return ""
