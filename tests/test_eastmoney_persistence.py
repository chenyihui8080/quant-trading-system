"""
东方财富持久化直连、心跳保活与降级容灾全链路自动化测试套件
=========================================================
"""

import pytest
import json
from pathlib import Path
from fastapi.testclient import TestClient
from api.main import app
from utils.auth import create_token
from utils.eastmoney_crypto import encrypt_text, decrypt_text
from utils.eastmoney_daemon import eastmoney_auth, eastmoney_daemon

client = TestClient(app)
admin_token = create_token("admin")
headers = {"Authorization": f"Bearer {admin_token}"}


class TestEastMoneyPersistence:
    """东财持久化连接与安全机制测试"""

    def test_01_crypto_encryption_decryption(self):
        """测试 AES-256 加密与解密准确性"""
        raw_password = "SuperSafeTradingPassword2026!@#"
        encrypted = encrypt_text(raw_password)
        assert encrypted != raw_password
        decrypted = decrypt_text(encrypted)
        assert decrypted == raw_password

    def test_02_cookie_parsing_and_sanitization(self):
        """测试 Cookie 清洗与 ValidateKey 正则提取"""
        sample_cookie = "ctoken=xyz987; em_hq_fls=js; validatekey=abc1234567890def; user_id=test"
        info = eastmoney_auth.set_full_credentials(
            cookie_str=sample_cookie,
            validatekey="",
            user_name="陈一辉实盘"
        )
        assert info["validatekey"] == "abc1234567890def"
        assert info["user_name"] == "陈一辉实盘"
        assert eastmoney_auth.is_authenticated() is True

    def test_03_heartbeat_probe(self):
        """测试心跳探活接口响应"""
        heartbeat_res = eastmoney_daemon.keep_alive_heartbeat()
        assert "status" in heartbeat_res
        assert "time" in heartbeat_res
        assert "message" in heartbeat_res

    def test_04_daemon_status_endpoint(self):
        """测试获取守护进程与 Session 状态接口"""
        response = client.get("/api/market/eastmoney/daemon-status", headers=headers)
        assert response.status_code == 200
        data = response.json().get("data", {})
        assert "is_session_alive" in data
        assert "last_heartbeat_time" in data
        assert "last_heartbeat_status" in data
        assert "user_name" in data

    def test_05_bind_full_credentials_endpoint(self):
        """测试完整 Cookie 绑定 API 接口"""
        payload = {
            "user_name": "陈一辉实盘",
            "cookie": "ctoken=test_token_123; validatekey=test_vkey_456; path=/",
            "validatekey": "test_vkey_456"
        }
        response = client.post("/api/market/eastmoney/bind-full-credentials", json=payload, headers=headers)
        assert response.status_code == 200
        res_json = response.json()
        assert res_json.get("code") == 200

    def test_06_verify_session_endpoint(self):
        """测试手动探活接口"""
        response = client.post("/api/market/eastmoney/verify-session", headers=headers)
        assert response.status_code == 200
        assert "data" in response.json()

    def test_07_save_browser_auth_endpoint(self):
        """测试账号密码本地安全存储接口"""
        payload = {
            "account": "12345678",
            "password": "Password@2026",
            "broker": "东方财富"
        }
        response = client.post("/api/market/eastmoney/save-browser-auth", json=payload, headers=headers)
        assert response.status_code == 200
        res_data = response.json()
        assert res_data.get("code") == 200

    def test_08_sync_all_fallback_to_live_quotes(self):
        """测试多通道降级：在离线或模拟模式下依然能保证全量持仓与自选的真实行情刷新"""
        summary = eastmoney_daemon.sync_all(quiet=True)
        assert summary.get("status") == "success"
        assert summary.get("positions_count") >= 0
        assert "total_market_value" in summary
        assert "total_pnl_amount" in summary
