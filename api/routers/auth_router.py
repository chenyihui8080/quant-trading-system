#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用户认证与授权路由 (Authentication & User Router)
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from utils.auth import (
    hash_password, verify_password, create_token,
    get_current_user, get_optional_user, require_admin, init_admin_user
)
from utils.database import log_audit, init_db, get_db

# 自动确保用户表和初始管理员就绪
init_db()
init_admin_user()

router = APIRouter(prefix="/auth", tags=["用户认证"])


class AuthRequest(BaseModel):
    username: str
    password: str
    role: Optional[str] = "trader"


@router.post("/register")
def register(req: AuthRequest):
    """用户注册"""
    if len(req.username.strip()) < 2:
        raise HTTPException(status_code=400, detail="用户名至少2个字符")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少6位")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ?", (req.username.strip(),))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="用户名已存在")

        hashed = hash_password(req.password)
        cursor.execute(
            "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
            (req.username.strip(), hashed, req.role or "trader"),
        )
        conn.commit()

    log_audit(req.username.strip(), "register", f"用户注册: role={req.role}")
    token = create_token(req.username.strip(), req.role or "trader")
    return {"code": 200, "message": "注册成功", "token": token, "username": req.username.strip(), "role": req.role}


@router.post("/login")
def login(req: AuthRequest):
    """用户登录"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, username, password, role FROM users WHERE username = ?",
            (req.username.strip(),),
        )
        user = cursor.fetchone()

    if not user or not verify_password(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_token(user["username"], user["role"])
    log_audit(user["username"], "login", "用户登录成功")
    return {"code": 200, "message": "登录成功", "token": token, "username": user["username"], "role": user["role"]}


@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    """获取当前登录用户信息"""
    user_name = current_user.get("username") if isinstance(current_user, dict) else str(current_user)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, role, created_at FROM users WHERE username = ?", (user_name,))
        row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "code": 200,
        "user": {
            "id": row["id"],
            "username": row["username"],
            "role": row["role"],
            "created_at": row["created_at"],
        }
    }
