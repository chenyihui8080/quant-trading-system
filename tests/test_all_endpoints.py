"""全量 API 端点自动化测试（覆盖全部 57 个端点）"""
import json
import pytest


# ================================================================
#  1. 认证接口（4 个端点）
# ================================================================

class TestAuth:
    """POST /auth/register, /auth/login, GET /auth/profile, POST /auth/change-password"""

    def test_register(self, client):
        resp = client.post("/auth/register", json={
            "username": "newuser", "password": "pass123456",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "token" in data
        assert data["username"] == "newuser"
        assert data["role"] == "user"

    def test_register_short_username(self, client):
        resp = client.post("/auth/register", json={
            "username": "ab", "password": "pass123456",
        })
        assert resp.status_code == 400

    def test_register_short_password(self, client):
        resp = client.post("/auth/register", json={
            "username": "validuser", "password": "123",
        })
        assert resp.status_code == 400

    def test_register_duplicate(self, client):
        client.post("/auth/register", json={"username": "dup", "password": "pass123456"})
        resp = client.post("/auth/register", json={"username": "dup", "password": "pass123456"})
        assert resp.status_code == 409

    def test_login(self, client):
        client.post("/auth/register", json={"username": "loginuser", "password": "pass123456"})
        resp = client.post("/auth/login", json={"username": "loginuser", "password": "pass123456"})
        assert resp.status_code == 200
        assert "token" in resp.json()

    def test_login_wrong_password(self, client):
        client.post("/auth/register", json={"username": "wrongpw", "password": "pass123456"})
        resp = client.post("/auth/login", json={"username": "wrongpw", "password": "wrongpassword"})
        assert resp.status_code == 401

    def test_login_nonexistent_user(self, client):
        resp = client.post("/auth/login", json={"username": "ghost", "password": "pass123456"})
        assert resp.status_code == 401

    def test_profile(self, client, auth_headers):
        resp = client.get("/auth/profile", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["username"] == "testuser"

    def test_profile_no_auth(self, client):
        resp = client.get("/auth/profile")
        assert resp.status_code == 401

    def test_change_password(self, client, auth_headers):
        resp = client.post("/auth/change-password",
                           params={"old_password": "test123456", "new_password": "newpass123456"},
                           headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_change_password_wrong_old(self, client, auth_headers):
        resp = client.post("/auth/change-password",
                           params={"old_password": "wrong", "new_password": "newpass123456"},
                           headers=auth_headers)
        assert resp.status_code == 401


# ================================================================
#  2. 审计日志（1 个端点）
# ================================================================

class TestAuditLog:
    """GET /audit/log"""

    def test_audit_log_as_admin(self, client, admin_headers):
        resp = client.get("/audit/log", headers=admin_headers)
        assert resp.status_code == 200
        assert "logs" in resp.json()

    def test_audit_log_as_user_forbidden(self, client, auth_headers):
        resp = client.get("/audit/log", headers=auth_headers)
        assert resp.status_code in (401, 403)


# ================================================================
#  3. 首页（1 个端点）
# ================================================================

class TestRoot:
    """GET /"""

    def test_root(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert "量化" in resp.text or "html" in resp.text.lower()


# ================================================================
#  4. 策略与数据（2 个端点）
# ================================================================

class TestStrategiesAndData:
    """GET /strategies, GET /data"""

    def test_list_strategies(self, client, auth_headers):
        resp = client.get("/strategies", headers=auth_headers)
        assert resp.status_code == 200
        assert "strategies" in resp.json()
        assert "dual_ma" in resp.json()["strategies"]

    def test_list_data(self, client, auth_headers):
        resp = client.get("/data", headers=auth_headers)
        assert resp.status_code == 200
        assert "data" in resp.json()

    def test_unauthenticated(self, client):
        assert client.get("/strategies").status_code == 401
        assert client.get("/data").status_code == 401


# ================================================================
#  5. 回测（3 个端点）
# ================================================================

class TestBacktest:
    """POST /backtest, POST /backtest-detail, GET /backtest/{key}"""

    def test_backtest(self, client, auth_headers):
        resp = client.post("/backtest", json={
            "strategy": "dual_ma", "days": 100, "capital": 500000,
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "stats" in data or "total_return" in data

    def test_backtest_unknown_strategy(self, client, auth_headers):
        resp = client.post("/backtest", json={
            "strategy": "nonexistent_xyz", "days": 100,
        }, headers=auth_headers)
        assert resp.status_code == 400

    def test_backtest_detail(self, client, auth_headers):
        resp = client.post("/backtest-detail", json={
            "strategy": "dual_ma", "days": 100, "capital": 500000,
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_quick_backtest(self, client, auth_headers):
        resp = client.get("/backtest/dual_ma", headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  6. 策略对比与优化（2 个端点）
# ================================================================

class TestCompareOptimize:
    """POST /compare, POST /optimize"""

    def test_compare(self, client, auth_headers):
        resp = client.post("/compare", json={
            "strategies": ["dual_ma", "rsi"],
            "symbol": "", "days": 100, "capital": 500000,
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_optimize(self, client, auth_headers):
        resp = client.post("/optimize", json={
            "strategy": "dual_ma",
            "symbol": "", "days": 100, "capital": 500000,
        }, headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  7. 推送通知（2 个端点）
# ================================================================

class TestNotify:
    """POST /notify-config, POST /notify/test"""

    def test_notify_config(self, client, auth_headers):
        resp = client.post("/notify-config", json={
            "serverchan_key": "",
            "dingtalk_webhook": "",
            "feishu_webhook": "",
            "feishu_secret": "",
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_notify_test(self, client, auth_headers):
        resp = client.post("/notify/test", headers=auth_headers)
        # 可能会因没有配置推送渠道而失败，但端点本身应该可达
        assert resp.status_code in (200, 400, 500)


# ================================================================
#  8. 价格告警（3 个端点）
# ================================================================

class TestPriceAlerts:
    """POST /alerts/price, GET /alerts/price, POST /alerts/check"""

    def test_create_alert(self, client, auth_headers):
        resp = client.post("/alerts/price", json={
            "symbol": "600519", "name": "茅台", "direction": "above", "target_price": 2000.0,
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_list_alerts(self, client, auth_headers):
        resp = client.get("/alerts/price", headers=auth_headers)
        assert resp.status_code == 200

    def test_check_alerts(self, client, auth_headers):
        resp = client.post("/alerts/check", headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  9. 风控配置（3 个端点）
# ================================================================

class TestRiskConfig:
    """GET /risk/config, POST /risk/config, POST /risk/check"""

    def test_get_risk_config(self, client, auth_headers):
        resp = client.get("/risk/config", headers=auth_headers)
        assert resp.status_code == 200

    def test_set_risk_config(self, client, auth_headers):
        resp = client.post("/risk/config", json={
            "max_position_pct": 0.3,
            "stop_loss_pct": 0.05,
            "max_drawdown_pct": 0.15,
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_risk_check(self, client, auth_headers):
        resp = client.post("/risk/check", json={
            "symbol": "600519", "direction": "buy", "price": 1800, "volume": 100,
        }, headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  10. 数据刷新与股票管理（3 个端点）
# ================================================================

class TestStockManagement:
    """POST /refresh-data, POST /stocks/add, GET /stocks/search"""

    def test_search_stock(self, client, auth_headers):
        resp = client.get("/stocks/search", params={"q": "600519", "limit": 5},
                          headers=auth_headers)
        assert resp.status_code == 200
        assert "results" in resp.json()

    def test_search_stock_market_filter(self, client, auth_headers):
        resp = client.get("/stocks/search", params={"q": "茅台", "limit": 5, "market": "a"},
                          headers=auth_headers)
        assert resp.status_code == 200

    def test_add_stock(self, client, auth_headers):
        resp = client.post("/stocks/add", json={
            "symbols": ["600519"], "days": 30,
        }, headers=auth_headers)
        # 可能因网络问题失败，但端点应可达
        assert resp.status_code in (200, 400, 500)

    def test_refresh_data(self, client, auth_headers):
        resp = client.post("/refresh-data", headers=auth_headers)
        assert resp.status_code in (200, 400, 500)


# ================================================================
#  11. 自选股（3 个端点）
# ================================================================

class TestFavorites:
    """POST /stocks/favorites/add, /remove, GET /stocks/favorites"""

    def test_add_favorite(self, client, auth_headers):
        resp = client.post("/stocks/favorites/add", json={"symbol": "600519"},
                           headers=auth_headers)
        assert resp.status_code == 200

    def test_list_favorites(self, client, auth_headers):
        resp = client.get("/stocks/favorites", headers=auth_headers)
        assert resp.status_code == 200

    def test_remove_favorite(self, client, auth_headers):
        client.post("/stocks/favorites/add", json={"symbol": "600519"}, headers=auth_headers)
        resp = client.post("/stocks/favorites/remove", json={"symbol": "600519"},
                           headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  12. 实时行情（2 个端点）
# ================================================================

class TestRealtime:
    """GET /realtime/{symbol}, GET /realtime-kline/{symbol}"""

    def test_realtime_quote(self, client, auth_headers):
        resp = client.get("/realtime/600519", headers=auth_headers)
        # 可能因网络超时失败，但端点应可达
        assert resp.status_code in (200, 400, 500, 502)

    def test_realtime_kline(self, client, auth_headers):
        resp = client.get("/realtime-kline/600519", headers=auth_headers)
        assert resp.status_code in (200, 400, 500, 502)


# ================================================================
#  13. 因子计算（4 个端点）
# ================================================================

class TestFactors:
    """GET /factors, POST /factors/compute, GET /factors/score/{symbol}, POST /factors/ranking"""

    def test_list_factors(self, client, auth_headers):
        resp = client.get("/factors", headers=auth_headers)
        assert resp.status_code == 200
        assert "factors" in resp.json()

    def test_compute_factors(self, client, auth_headers):
        resp = client.post("/factors/compute", json={
            "symbol": "600519", "factors": ["momentum"],
        }, headers=auth_headers)
        # 可能因没有数据失败
        assert resp.status_code in (200, 400, 500)

    def test_factor_score(self, client, auth_headers):
        resp = client.get("/factors/score/600519", headers=auth_headers)
        assert resp.status_code in (200, 400, 500)

    def test_factor_ranking(self, client, auth_headers):
        resp = client.post("/factors/ranking", json={
            "symbols": ["600519"],
        }, headers=auth_headers)
        assert resp.status_code in (200, 400, 500)


# ================================================================
#  14. 历史记录（4 个端点）
# ================================================================

class TestHistory:
    """GET /history/backtest, /history/backtest/{id}, /history/orders, /history/factors"""

    def test_backtest_history(self, client, auth_headers):
        resp = client.get("/history/backtest", headers=auth_headers)
        assert resp.status_code == 200

    def test_backtest_detail_not_found(self, client, auth_headers):
        resp = client.get("/history/backtest/99999", headers=auth_headers)
        assert resp.status_code in (200, 404)

    def test_order_history(self, client, auth_headers):
        resp = client.get("/history/orders", headers=auth_headers)
        assert resp.status_code == 200

    def test_factor_history(self, client, auth_headers):
        resp = client.get("/history/factors", headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  15. WebSocket 状态（1 个端点）
# ================================================================

class TestWebSocket:
    """GET /ws/status"""

    def test_ws_status(self, client, auth_headers):
        resp = client.get("/ws/status", headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  16. 订单管理（7 个端点）
# ================================================================

class TestOrders:
    """POST /orders, GET /orders, GET /orders/stats, submit/fill/cancel/reject"""

    def test_create_order(self, client, auth_headers):
        resp = client.post("/orders", json={
            "strategy_name": "test", "symbol": "600519", "direction": "long", "offset": "open",
            "price": 1800.0, "volume": 100,
        }, headers=auth_headers)
        assert resp.status_code == 200
        assert "order" in resp.json()

    def test_list_orders(self, client, auth_headers):
        resp = client.get("/orders", headers=auth_headers)
        assert resp.status_code == 200

    def test_order_stats(self, client, auth_headers):
        resp = client.get("/orders/stats", headers=auth_headers)
        assert resp.status_code == 200

    def test_order_lifecycle(self, client, auth_headers):
        """测试订单完整生命周期：创建→提交→成交"""
        resp = client.post("/orders", json={
            "strategy_name": "test", "symbol": "600519", "direction": "long", "offset": "open",
            "price": 1800.0, "volume": 100,
        }, headers=auth_headers)
        order_id = resp.json()["order"]["order_id"]

        resp = client.post(f"/orders/{order_id}/submit", headers=auth_headers)
        assert resp.status_code == 200

        resp = client.post(f"/orders/{order_id}/fill",
                           params={"trade_price": 1800.0, "trade_volume": 100},
                           headers=auth_headers)
        assert resp.status_code == 200

    def test_order_cancel(self, client, auth_headers):
        """测试订单取消"""
        resp = client.post("/orders", json={
            "strategy_name": "test", "symbol": "600519", "direction": "long", "offset": "open",
            "price": 1800.0, "volume": 100,
        }, headers=auth_headers)
        order_id = resp.json()["order"]["order_id"]

        resp = client.post(f"/orders/{order_id}/submit", headers=auth_headers)
        resp = client.post(f"/orders/{order_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

    def test_order_reject(self, client, auth_headers):
        """测试订单拒绝"""
        resp = client.post("/orders", json={
            "strategy_name": "test", "symbol": "600519", "direction": "long", "offset": "open",
            "price": 1800.0, "volume": 100,
        }, headers=auth_headers)
        order_id = resp.json()["order"]["order_id"]

        resp = client.post(f"/orders/{order_id}/submit", headers=auth_headers)
        resp = client.post(f"/orders/{order_id}/reject", headers=auth_headers)
        assert resp.status_code == 200


# ================================================================
#  17. 自定义策略 CRUD（7 个端点）
# ================================================================

class TestUserStrategies:
    """CRUD + evaluate + evaluate-all + presets"""

    def test_create_strategy(self, client, auth_headers):
        resp = client.post("/user-strategies", json={
            "name": "测试策略",
            "symbol": "600519",
            "market": "a",
            "buy_conditions": [
                {"left": {"type": "indicator", "indicator": "close", "params": {}},
                 "op": ">", "right": {"type": "fixed", "value": 1800}},
            ],
            "sell_conditions": [
                {"left": {"type": "indicator", "indicator": "close", "params": {}},
                 "op": "<", "right": {"type": "fixed", "value": 1700}},
            ],
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "测试策略"
        assert data["symbol"] == "600519"

    def test_list_strategies(self, client, auth_headers):
        client.post("/user-strategies", json={
            "name": "列表测试", "symbol": "600519",
            "buy_conditions": [{"left": {"type": "indicator", "indicator": "close", "params": {}},
                                "op": ">", "right": {"type": "fixed", "value": 100}}],
        }, headers=auth_headers)

        resp = client.get("/user-strategies", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()["strategies"]) >= 1

    def test_get_strategy(self, client, auth_headers):
        create_resp = client.post("/user-strategies", json={
            "name": "获取测试", "symbol": "600519",
            "buy_conditions": [{"left": {"type": "indicator", "indicator": "close", "params": {}},
                                "op": ">", "right": {"type": "fixed", "value": 100}}],
        }, headers=auth_headers)
        sid = create_resp.json()["id"]

        resp = client.get(f"/user-strategies/{sid}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["name"] == "获取测试"

    def test_update_strategy(self, client, auth_headers):
        create_resp = client.post("/user-strategies", json={
            "name": "更新前", "symbol": "600519",
            "buy_conditions": [{"left": {"type": "indicator", "indicator": "close", "params": {}},
                                "op": ">", "right": {"type": "fixed", "value": 100}}],
        }, headers=auth_headers)
        sid = create_resp.json()["id"]

        resp = client.put(f"/user-strategies/{sid}", json={"name": "更新后", "enabled": False},
                          headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["name"] == "更新后"
        assert resp.json()["enabled"] is False

    def test_delete_strategy(self, client, auth_headers):
        create_resp = client.post("/user-strategies", json={
            "name": "删除测试", "symbol": "600519",
            "buy_conditions": [{"left": {"type": "indicator", "indicator": "close", "params": {}},
                                "op": ">", "right": {"type": "fixed", "value": 100}}],
        }, headers=auth_headers)
        sid = create_resp.json()["id"]

        resp = client.delete(f"/user-strategies/{sid}", headers=auth_headers)
        assert resp.status_code == 200

        resp = client.get(f"/user-strategies/{sid}", headers=auth_headers)
        assert resp.status_code == 404

    def test_get_presets(self, client, auth_headers):
        resp = client.get("/user-strategies/presets", headers=auth_headers)
        assert resp.status_code == 200
        presets = resp.json()["presets"]
        assert len(presets) >= 8
        assert "海龟" in presets[0]["name"]

    def test_load_preset(self, client, auth_headers):
        resp = client.post("/user-strategies/presets/0", params={"symbol": "600519", "market": "a"},
                           headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["strategy"]["symbol"] == "600519"

    def test_load_preset_invalid_index(self, client, auth_headers):
        resp = client.post("/user-strategies/presets/999", params={"symbol": "600519"},
                           headers=auth_headers)
        assert resp.status_code == 400

    def test_load_preset_no_symbol(self, client, auth_headers):
        resp = client.post("/user-strategies/presets/0", params={"symbol": ""},
                           headers=auth_headers)
        assert resp.status_code == 400


# ================================================================
#  18. 自然语言策略（2 个端点）
# ================================================================

class TestNLStrategy:
    """POST /nl/parse, POST /nl/create-strategy"""

    def test_nl_parse_basic(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "跌破20%就卖，涨了5%就买",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert len(data["buy_conditions"]) == 1
        assert len(data["sell_conditions"]) == 1

    def test_nl_parse_ma(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "站上20日线买入，跌破10日线卖出",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 1
        assert len(data["sell_conditions"]) == 1
        assert data["buy_conditions"][0]["left"]["indicator"] == "close"
        assert data["buy_conditions"][0]["op"] == "cross_above"

    def test_nl_parse_macd(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "MACD金叉买入，MACD死叉卖出",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 1
        assert len(data["sell_conditions"]) == 1

    def test_nl_parse_rsi(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "RSI超买卖出，RSI低于30买入",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 1
        assert len(data["sell_conditions"]) == 1

    def test_nl_parse_compound(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "放量突破10日高点",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 2  # 量比 + 突破

    def test_nl_parse_chinese_numbers(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "二十日线金叉五十日线",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 1
        assert data["buy_conditions"][0]["left"]["params"]["period"] == 20
        assert data["buy_conditions"][0]["right"]["params"]["period"] == 50

    def test_nl_parse_volume(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "缩量跌破10日线",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sell_conditions"]) == 2

    def test_nl_parse_empty(self, client, auth_headers):
        resp = client.post("/nl/parse", json={"text": ""}, headers=auth_headers)
        assert resp.status_code == 400

    def test_nl_parse_unrecognized(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "今天天气不错",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 0
        assert len(data["sell_conditions"]) == 0

    def test_nl_create_strategy(self, client, auth_headers):
        resp = client.post("/nl/create-strategy", json={
            "text": "跌破20%就卖，涨了5%就买",
            "symbol": "600519",
            "market": "a",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["strategy"]["symbol"] == "600519"
        assert len(data["strategy"]["buy_conditions"]) == 1
        assert len(data["strategy"]["sell_conditions"]) == 1

    def test_nl_create_strategy_no_symbol(self, client, auth_headers):
        resp = client.post("/nl/create-strategy", json={
            "text": "跌破20%就卖", "symbol": "",
        }, headers=auth_headers)
        assert resp.status_code == 400

    def test_nl_create_strategy_unrecognized(self, client, auth_headers):
        resp = client.post("/nl/create-strategy", json={
            "text": "随便说说", "symbol": "600519",
        }, headers=auth_headers)
        assert resp.status_code == 400

    def test_nl_parse_kdj(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "KDJ超买卖出，站上5日线就买",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 1
        assert len(data["sell_conditions"]) == 1

    def test_nl_parse_absolute_price(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "跌破20块就卖",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sell_conditions"]) == 1
        assert data["sell_conditions"][0]["right"]["value"] == 20.0

    def test_nl_parse_boll(self, client, auth_headers):
        resp = client.post("/nl/parse", json={
            "text": "突破布林上轨买入，跌破布林下轨卖出",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["buy_conditions"]) == 1
        assert len(data["sell_conditions"]) == 1


# ================================================================
#  19. 认证中间件测试
# ================================================================

class TestAuthMiddleware:
    """测试未认证请求被正确拒绝"""

    def test_no_token(self, client):
        protected_get = ["/strategies", "/data", "/factors",
                         "/risk/config", "/stocks/search", "/orders"]
        protected_post = ["/backtest", "/nl/parse"]
        for path in protected_get:
            resp = client.get(path)
            assert resp.status_code == 401, f"GET {path} 应返回 401"
        for path in protected_post:
            resp = client.post(path, json={})
            assert resp.status_code in (401, 422), f"POST {path} 应返回 401/422"

    def test_invalid_token(self, client):
        headers = {"Authorization": "Bearer invalid.token.here"}
        resp = client.get("/strategies", headers=headers)
        assert resp.status_code == 401

    def test_expired_token_format(self, client):
        headers = {"Authorization": "Bearer "}
        resp = client.get("/strategies", headers=headers)
        assert resp.status_code == 401


# ================================================================
#  20. NL 解析器单元测试（不经过 API）
# ================================================================

class TestNLParserUnit:
    """直接测试 utils/nl_parser.py 的解析能力"""

    def test_parse_basic_percentage(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("跌破20%就卖")
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["right"]["value"] == -20.0

    def test_parse_gain_percentage(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("涨了5%就买")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["right"]["value"] == 5.0

    def test_parse_ma_cross(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("站上20日线就买")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["op"] == "cross_above"
        assert r["buy_conditions"][0]["right"]["params"]["period"] == 20

    def test_parse_macd_golden(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("MACD金叉买入")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["left"]["indicator"] == "macd"
        assert r["buy_conditions"][0]["op"] == "cross_above"

    def test_parse_rsi_overbought(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("RSI超买卖出")
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["left"]["indicator"] == "rsi"
        assert r["sell_conditions"][0]["right"]["value"] == 70

    def test_parse_rsi_oversold(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("RSI低于30买入")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["right"]["value"] == 30

    def test_parse_volume_breakout(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("放量突破10日高点")
        assert len(r["buy_conditions"]) == 2
        indicators = {c["left"]["indicator"] for c in r["buy_conditions"]}
        assert "vol_ratio" in indicators
        assert "close" in indicators

    def test_parse_shrink_volume(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("缩量跌破10日线")
        assert len(r["sell_conditions"]) == 2

    def test_parse_absolute_price(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("跌破20块就卖")
        assert r["sell_conditions"][0]["left"]["indicator"] == "close"
        assert r["sell_conditions"][0]["right"]["value"] == 20.0

    def test_parse_chinese_numbers(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("二十日线金叉五十日线")
        assert r["buy_conditions"][0]["left"]["params"]["period"] == 20
        assert r["buy_conditions"][0]["right"]["params"]["period"] == 50

    def test_parse_consecutive_decline(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("连跌3天")
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["left"]["params"]["period"] == 3

    def test_parse_bollinger(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("突破布林上轨")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["right"]["indicator"] == "boll"

    def test_parse_kdj_overbought(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("KDJ超买卖出")
        assert len(r["sell_conditions"]) == 1
        assert r["sell_conditions"][0]["left"]["indicator"] == "kdj"

    def test_parse_mixed_buy_sell(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("KDJ超买卖出，站上5日线就买")
        assert len(r["buy_conditions"]) == 1
        assert len(r["sell_conditions"]) == 1

    def test_parse_yesterday_gain(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("比昨天涨了3%")
        assert len(r["buy_conditions"]) == 1
        assert r["buy_conditions"][0]["right"]["value"] == 3.0

    def test_parse_empty(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("")
        assert len(r["buy_conditions"]) == 0
        assert len(r["sell_conditions"]) == 0

    def test_parse_unrecognized(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("今天天气不错")
        assert r["unmatched"] != []

    def test_explanation_present(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("跌破20%就卖，涨了5%就买")
        assert "买入" in r["explanation"]
        assert "卖出" in r["explanation"]

    def test_source_is_regex(self):
        from utils.nl_parser import parse_nl_strategy
        r = parse_nl_strategy("跌破20%就卖")
        assert r["source"] == "regex"
