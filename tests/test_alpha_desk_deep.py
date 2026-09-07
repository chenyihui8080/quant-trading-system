"""
Alpha 盘中实战交易系统深度专项自动化测试套件 (Alpha Desk Deep Unit & Integration Tests)
全方位覆盖：止损正负号防御、高价股小资金截断、1%风险法则倒算、多用户风控物理隔离
"""
import pytest
from fastapi.testclient import TestClient
from api.main import app
from utils.alpha_engine import AlphaEngine, AlphaRuleConfig
from services.alpha_service import AlphaService


class TestAlphaDeskDeep:
    """Alpha 交易决策与风控计算深度测试"""

    def test_stop_loss_calculation_never_above_price(self):
        """测试止损价在任何配置下绝对不会高于买入价 (消除倒挂缺陷)"""
        # 测试 1: 正常传入正数止损比例 3.5%
        cfg_pos = AlphaRuleConfig(stop_loss_pct=3.5)
        engine_pos = AlphaEngine(cfg_pos)
        res_pos = engine_pos.calculate_trade_levels(current_price=100.0)
        assert res_pos.p_stop < 100.0
        assert res_pos.p_stop == 96.5
        assert res_pos.stop_loss_pct == -3.5

        # 测试 2: 防御传入负数止损比例 -5.0%
        cfg_neg = AlphaRuleConfig(stop_loss_pct=-5.0)
        engine_neg = AlphaEngine(cfg_neg)
        res_neg = engine_neg.calculate_trade_levels(current_price=100.0)
        assert res_neg.p_stop < 100.0
        assert res_neg.p_stop == 95.0
        assert res_neg.stop_loss_pct == -5.0

    def test_expensive_stock_insufficient_capital_interception(self):
        """测试高价股在小资金限额下不足 1 手(100股)时的精准拦截"""
        # 总资金 50,000 元，单票最大仓位 20% = 10,000 元
        # 股票现价 1800 元/股 (茅台)，买一手 100 股需要 180,000 元
        cfg = AlphaRuleConfig(total_capital=50_000, max_position_pct=20.0)
        engine = AlphaEngine(cfg)
        res = engine.calculate_trade_levels(current_price=1800.0)
        
        assert res.recommended_shares == 0
        assert res.recommended_amount == 0.0
        assert res.passed_filter is False
        assert "不足" in res.status or "拦截" in res.status

    def test_one_percent_risk_rule_and_position_capping(self):
        """测试 1% 风险法则倒算股数与最大持仓占比上限截断"""
        # 资金 1,000,000 元，1% 风险 R = 10,000 元，最大持仓 20% = 200,000 元
        # 股价 20 元，止损价 19 元 (每股风险 1 元) -> 理论股数 = 10,000 / 1 = 10,000 股
        # 10,000 股 * 20 元 = 200,000 元 (恰好达到 20% 仓位上限)
        cfg = AlphaRuleConfig(total_capital=1_000_000, risk_r_pct=1.0, max_position_pct=20.0, stop_loss_pct=5.0)
        engine = AlphaEngine(cfg)
        res = engine.calculate_trade_levels(current_price=20.0)

        assert res.recommended_shares == 10000
        assert res.recommended_amount == 200000.0
        assert res.total_risk_amount <= 10000.0
        assert res.passed_filter is True

    def test_multi_user_alpha_config_isolation(self, client: TestClient):
        """测试多用户 Alpha 风控配置物理级隔离 (解决跨用户配置覆盖)"""
        # 1. 注册并登录用户 A
        client.post("/auth/register", json={"username": "user_a", "password": "password123"})
        r_a = client.post("/auth/login", json={"username": "user_a", "password": "password123"})
        token_a = r_a.json()["token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}

        # 2. 注册并登录用户 B
        client.post("/auth/register", json={"username": "user_b", "password": "password123"})
        r_b = client.post("/auth/login", json={"username": "user_b", "password": "password123"})
        token_b = r_b.json()["token"]
        headers_b = {"Authorization": f"Bearer {token_b}"}

        # 3. 用户 A 修改总资金为 5,000,000 元
        client.post("/api/alpha/config", headers=headers_a, json={
            "total_capital": 5_000_000.0,
            "risk_r_pct": 2.0,
            "max_position_pct": 25.0
        })

        # 4. 验证用户 A 读取到 500 万
        res_a = client.get("/api/alpha/config", headers=headers_a).json()
        assert res_a["config"]["total_capital"] == 5_000_000.0
        assert res_a["config"]["risk_r_pct"] == 2.0

        # 5. 验证用户 B 读取到的依然是自己独立的默认配置 (100 万)，绝对不受用户 A 影响！
        res_b = client.get("/api/alpha/config", headers=headers_b).json()
        assert res_b["config"]["total_capital"] == 1_000_000.0
        assert res_b["config"]["risk_r_pct"] == 1.0

    def test_api_calculate_endpoint(self, client: TestClient, auth_headers):
        """测试 POST /api/alpha/calculate 端点测算返回完整性"""
        resp = client.post("/api/alpha/calculate", headers=auth_headers, json={
            "symbol": "600519",
            "custom_capital": 2_000_000.0
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["code"] == 200
        res = data["result"]
        assert "buy_price_low" in res
        assert "buy_price_high" in res
        assert "stop_loss_price" in res
        assert "target_price_1" in res
        assert "recommended_shares" in res
        assert res["stop_loss_price"] < res["current_price"]
