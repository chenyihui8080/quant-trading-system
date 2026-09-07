"""测试基础设施：fixtures 和辅助工具"""
import sys
import os
import sqlite3
import tempfile
from pathlib import Path

import pytest

# 确保项目根目录在 Python path 中
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _test_database(tmp_path, monkeypatch):
    """每个测试使用独立的临时数据库"""
    test_db = tmp_path / "quant.db"
    monkeypatch.setattr("utils.database.DB_PATH", test_db)
    monkeypatch.setattr("core.database.DB_PATH", test_db)

    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-password")

    # 初始化表结构
    from utils.database import init_db
    init_db()

    # 同时让 strategies 文件用临时路径
    test_strategies = tmp_path / "user_strategies.json"
    monkeypatch.setattr("utils.strategy_rules.STRATEGIES_FILE", test_strategies)

    test_portfolio = tmp_path / "portfolio.json"
    monkeypatch.setattr("utils.portfolio_advisor.DATA_FILE", test_portfolio)

    yield test_db


@pytest.fixture()
def client():
    """未认证的测试客户端"""
    from api.main import app
    return TestClient(app)


@pytest.fixture()
def auth_headers(client):
    """注册并登录，返回带 Token 的请求头"""
    # 注册
    client.post("/auth/register", json={
        "username": "testuser",
        "password": "test123456",
    })
    # 登录
    resp = client.post("/auth/login", json={
        "username": "testuser",
        "password": "test123456",
    })
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def admin_headers(client):
    """创建管理员用户并返回带 Token 的请求头"""
    # 注册
    client.post("/auth/register", json={
        "username": "admin",
        "password": "admin123456",
    })
    # 手动升级为管理员
    from utils.database import get_db
    with get_db() as db:
        db.execute("UPDATE users SET role='admin' WHERE username='admin'", )
    # 登录
    resp = client.post("/auth/login", json={
        "username": "admin",
        "password": "admin123456",
    })
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}
