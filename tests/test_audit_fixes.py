# -*- coding: utf-8 -*-
"""
针对本次白盒审计 26 项修复的专用自动化验证测试
覆盖：
1. 认证鉴权阻断 (401)
2. 登录弱口令后门封堵
3. 注册提权防范
4. 健康检查 probe 非 null 返回
5. 敏感接口需要身份鉴权
6. 行业资金流安全浮点转换 (float('-'))
7. 风控仓位除零保护与平仓盈亏累加
"""
import pytest
from fastapi.testclient import TestClient
from api.main import app
from utils.sector_fund_flow import _safe_float
from utils.risk_manager import StrategyRiskGuard, StrategyRiskConfig

client = TestClient(app)

def test_health_check_endpoint():
    """验证 /api/health 返回完整 JSON 且非 null"""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data is not None
    assert "status" in data
    assert "database" in data
    assert "timestamp" in data

def test_unauthenticated_protected_endpoints_return_401():
    """验证未提供 Token 访问保护接口严格返回 401，不再兜底 admin"""
    endpoints = [
        "/profile",
        "/strategies",
        "/data",
        "/orders",
        "/history/orders",
    ]
    for ep in endpoints:
        resp = client.get(ep)
        assert resp.status_code == 401, f"{ep} 应被 401 拦截"

def test_login_backdoor_blocked():
    """验证硬编码弱口令后门已被彻底封堵"""
    resp = client.post("/auth/login", json={"username": "admin", "password": "admin_default_password"})
    # 只要密码不对，必须 401
    assert resp.status_code == 401

def test_register_privilege_escalation_prevented():
    """验证注册传 role=admin 无法提权"""
    resp = client.post("/register", json={
        "username": "attacker_test_999",
        "password": "strong_password_123",
        "role": "admin"
    })
    if resp.status_code == 200:
        data = resp.json()
        assert data["role"] != "admin"
        assert data["role"] == "user"

def test_safe_float_parsing():
    """验证停牌股 '-' 或脏数据安全解析为 0.0，杜绝 ValueError"""
    assert _safe_float("-") == 0.0
    assert _safe_float("--") == 0.0
    assert _safe_float("") == 0.0
    assert _safe_float(None) == 0.0
    assert _safe_float("12.34") == 12.34
    assert _safe_float(99.5) == 99.5

def test_risk_manager_zero_division_guard():
    """验证风控仓位计算 price<=0 防除零保护"""
    srm = StrategyRiskGuard()
    assert srm.calc_position_size(0.0, 1_000_000) == 0
    assert srm.calc_position_size(-5.0, 1_000_000) == 0
    assert srm.calc_position_size(10.0, 100_000) > 0

def test_risk_manager_daily_pnl_accumulation():
    """验证平仓时正常累计 daily_pnl"""
    srm = StrategyRiskGuard()
    # 开仓 1000 股，价格 10 元
    srm.on_trade(price=10.0, pos=1000, qty=1000)
    assert srm.entry_price == 10.0
    # 平仓 1000 股，价格 8 元（亏损 2000 元）
    srm.on_trade(price=8.0, pos=0, qty=1000)
    assert srm.daily_pnl == -2000.0
    # 再次平仓 1000 股，从 pos=1000 到 pos=0，未传 qty 时自动推断
    srm.on_trade(price=10.0, pos=1000)
    srm.on_trade(price=7.0, pos=0)
    # 累加亏损 3000 元，总 daily_pnl 达到 -5000 元
    assert srm.daily_pnl == -5000.0


def test_credential_endpoints_require_strict_auth():
    """验证三个券商凭证与登录端点强制要求登录鉴权 (401 阻断)"""
    # 1. 保存浏览器凭证
    r1 = client.post("/api/eastmoney/save-browser-auth", json={"account": "test_acc", "password": "pwd"})
    assert r1.status_code == 401
    
    # 2. 交互式拉起登录
    r2 = client.post("/api/eastmoney/interactive-login")
    assert r2.status_code == 401

    # 3. 触发自动登录
    r3 = client.post("/api/eastmoney/trigger-browser-login")
    assert r3.status_code == 401


def test_bind_endpoints_require_strict_auth():
    """验证两个凭证绑定端点不再使用弱回环认证，未带 Token 即使本地也严格 401"""
    r1 = client.post("/api/eastmoney/bind-full-credentials", json={"cookie": "test_cookie", "validatekey": "123"})
    assert r1.status_code == 401

    r2 = client.post("/api/eastmoney/bind-community-cookie", json={"cookie": "community_cookie"})
    assert r2.status_code == 401


def test_prediction_write_endpoints_require_strict_auth():
    """验证操盘预测记录的写入、复盘与删除端点未登录严格 401"""
    # 1. 新增预测
    r1 = client.post("/api/prediction/add", json={"record_date": "2026-09-21", "stock_code": "600519", "stock_name": "贵州茅台"})
    assert r1.status_code == 401

    # 2. 触发复盘
    r2 = client.post("/api/prediction/review", json={"record_date": "2026-09-21"})
    assert r2.status_code == 401

    # 3. 删除记录
    r3 = client.delete("/api/prediction/record/999999")
    assert r3.status_code == 401


def test_funnel_filter_rejects_unknown_operator():
    """验证量化漏斗引擎遇到未知操作符防御性拒绝 (Fail-Safe)，不静默放行"""
    from review_workbench.agents.funnel_filter import funnel_filter
    item = {"test_field": 100, "attribution_confidence": 0.8}
    
    # 正常已知操作符
    rules_valid = [{"field": "test_field", "op": ">=", "value": 50}]
    assert funnel_filter._match_all_rules(item, rules_valid) is True
    
    # 正常支持的 > 操作符
    rules_gt = [{"field": "test_field", "op": ">", "value": 50}]
    assert funnel_filter._match_all_rules(item, rules_gt) is True
    
    # 未知操作符，必须严格拦截返回 False
    rules_unknown = [{"field": "test_field", "op": "INVALID_OP", "value": 50}]
    assert funnel_filter._match_all_rules(item, rules_unknown) is False


def test_gitignore_protects_jwt_secret():
    """验证 .gitignore 明确包含了 .jwt_secret 与敏感凭证，杜绝提交泄露"""
    from pathlib import Path
    gitignore = (Path(__file__).parent.parent / ".gitignore").read_text(encoding="utf-8")
    assert ".jwt_secret" in gitignore
    assert "data/.jwt_secret" in gitignore
    assert "data/.admin_initial_password" in gitignore
    assert "data/.sync_token" in gitignore


def test_userscript_sync_token_channel():
    """验证油猴插件专用 X-Quant-Sync-Token 认证通道 (解决跨域401阻断，同时杜绝未授权注入)"""
    from utils.auth import get_or_create_sync_token
    token = get_or_create_sync_token()

    # 1. 携带正确 Token，请求成功放行 (不被 401 拦截)
    resp_ok = client.post(
        "/api/eastmoney/bind-full-credentials",
        headers={"X-Quant-Sync-Token": token},
        json={"cookie": "auth_test_cookie", "validatekey": "test_vkey"}
    )
    assert resp_ok.status_code in (200, 400), f"应鉴权通过，状态码: {resp_ok.status_code}"

    # 2. 携带错误 Token，严格返回 401
    resp_bad = client.post(
        "/api/eastmoney/bind-full-credentials",
        headers={"X-Quant-Sync-Token": "wrong_invalid_token_999"},
        json={"cookie": "auth_test_cookie"}
    )
    assert resp_bad.status_code == 401


def test_trading_calendar_holiday_check():
    """验证 A 股交易日历精准判定：杜绝公历硬编码漂移"""
    from utils.trading_calendar import check_trading_day

    # 周末休市
    is_open_sat, reason_sat = check_trading_day("2026-09-19")  # 2026-09-19 是周六
    assert is_open_sat is False
    assert "周六" in reason_sat

    # 2026 年除夕与春节
    is_open_cny, reason_cny = check_trading_day("2026-02-17")
    assert is_open_cny is False
    assert "春节" in reason_cny

    # 2026 年国庆
    is_open_nat, reason_nat = check_trading_day("2026-10-01")
    assert is_open_nat is False
    assert "国庆" in reason_nat

    # 正常工作日 (如 2026-09-21 周一)
    is_open_mon, _ = check_trading_day("2026-09-21")
    assert is_open_mon is True


def test_review_workbench_syntax_and_import():
    """验证 review_workbench 及其全智能体模块语法无报错、完整可导入"""
    import review_workbench.agents.full_dashboard_service as fds
    import review_workbench.api.main as rwm
    assert fds is not None
    assert rwm.router is not None


def test_cors_disallows_wildcard_with_credentials():
    """验证全局未配置 allow_origins=['*'] 与 allow_credentials=True 的违规危险组合"""
    from fastapi.middleware.cors import CORSMiddleware
    for middleware in app.user_middleware:
        if middleware.cls == CORSMiddleware:
            allow_origins = middleware.kwargs.get("allow_origins", [])
            allow_credentials = middleware.kwargs.get("allow_credentials", False)
            if allow_credentials:
                assert "*" not in allow_origins, "CORS 规范：开启凭证时禁止使用通配符 '*' allow_origins"


def test_no_backup_files_in_codebase():
    """验证工作区内无 *.bak 残留历史遗留备份文件"""
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    bak_files = list(root.glob("api/**/*.bak")) + list(root.glob("utils/**/*.bak"))
    assert len(bak_files) == 0, f"发现残留备份文件: {bak_files}"


def test_sync_token_unpredictable_entropy():
    """验证同步令牌异常兜底不使用固定可预测口令"""
    from utils.auth import get_or_create_sync_token
    t1 = get_or_create_sync_token()
    assert t1 != "quant_sync_default_local_token", "禁止使用固定硬编码默认令牌"
    assert len(t1) >= 20


def test_news_collector_historical_date_isolation():
    """验证 news_collector 针对历史日期不抓取今日实时流，杜绝时间穿越"""
    from review_workbench.agents.news_collector import news_collector
    # 针对遥远历史空白交易日，返回为空，绝不拿今日实时快讯混入
    past_items = news_collector._fetch_raw_news_stream("2020-01-01")
    assert isinstance(past_items, list)
    # 历史日期的快讯不能包含今天的时间
    from datetime import datetime
    today_str = datetime.now().strftime("%Y-%m-%d")
    for it in past_items:
        assert not it.get("time", "").startswith(today_str)


def test_userscript_endpoint_requires_auth():
    """验证油猴脚本分发接口杜绝未认证访客窃取 sync_token"""
    # 1. 无认证直接访问 -> 必须 401
    resp_unauth = client.get("/api/eastmoney/userscript.user.js")
    assert resp_unauth.status_code == 401, f"未认证下载脚本必须被 401 拦截，实际返回: {resp_unauth.status_code}"

    # 2. 携带有效 token 访问 -> 200 且正常注入
    from utils.auth import create_token
    valid_jwt = create_token("admin", "admin")
    resp_auth = client.get("/api/eastmoney/userscript.user.js", headers={"Authorization": f"Bearer {valid_jwt}"})
    assert resp_auth.status_code == 200
    assert "东财实盘凭证自动同步助手" in resp_auth.text
    # 脚本内包含真实 token 且不再是原始占位符
    assert "__QUANT_SYNC_TOKEN__" not in resp_auth.text


def test_write_endpoints_require_strict_auth():
    """验证所有写操作和敏感触发端点均已被 Depends(get_current_user) 严格保护"""
    # 1. 模拟盘写操作
    resp = client.post("/api/paper-portfolio/reset", json={"capital": 20000})
    assert resp.status_code == 401, "POST /api/paper-portfolio/reset 必须要求登录凭据"

    resp = client.post("/api/paper-portfolio/rebalance")
    assert resp.status_code == 401, "POST /api/paper-portfolio/rebalance 必须要求登录凭据"

    # 2. 推特写操作与触发
    resp = client.post("/api/twitter/authors/update", json={"handle": "test", "category": "tech"})
    assert resp.status_code == 401, "POST /api/twitter/authors/update 必须要求登录凭据"

    resp = client.post("/api/twitter/sync-latest")
    assert resp.status_code == 401, "POST /api/twitter/sync-latest 必须要求登录凭据"

    resp = client.post("/api/twitter/test-connection")
    assert resp.status_code == 401, "POST /api/twitter/test-connection 必须要求登录凭据"

    # 3. 判官调度写操作
    resp = client.post("/api/prediction/force_tuning")
    assert resp.status_code == 401, "POST /api/prediction/force_tuning 必须要求登录凭据"

    resp = client.post("/api/prediction/force_premarket")
    assert resp.status_code == 401, "POST /api/prediction/force_premarket 必须要求登录凭据"


def test_sensitive_read_endpoints_require_strict_auth():
    """验证敏感管理数据查询端点严禁未登录匿名访问或自动回退为 admin"""
    # 1. 判官预测记录列表
    resp = client.get("/api/prediction/list")
    assert resp.status_code == 401, f"GET /api/prediction/list 必须拦截未登录访客，实际返回: {resp.status_code}"

    # 2. 自定义策略库
    resp = client.get("/user-strategies")
    assert resp.status_code == 401, f"GET /user-strategies 必须拦截未登录访客，实际返回: {resp.status_code}"

    # 3. Alpha 选股与风控配置
    resp = client.get("/api/alpha/config")
    assert resp.status_code == 401, f"GET /api/alpha/config 必须拦截未登录访客，实际返回: {resp.status_code}"

    # 4. 实盘持仓与资产列表
    resp = client.get("/api/portfolio/list")
    assert resp.status_code == 401, f"GET /api/portfolio/list 必须拦截未登录访客，实际返回: {resp.status_code}"


def test_playbook_repair_and_reset_endpoints_require_strict_auth():
    """验证战法参数修复与重置端点必须要求登录认证，杜绝匿名篡改"""
    resp = client.post("/api/prediction/playbook_repair", json={
        "playbook_id": "playbook_01",
        "trigger_reason": "test",
        "proposed_params": {}
    })
    assert resp.status_code == 401, f"POST /api/prediction/playbook_repair 必须要求登录凭据，实际: {resp.status_code}"

    resp = client.post("/api/prediction/custom_params/reset", json={
        "playbook_id": "playbook_01"
    })
    assert resp.status_code == 401, f"POST /api/prediction/custom_params/reset 必须要求登录凭据，实际: {resp.status_code}"


def test_eastmoney_bookmark_origin_channel():
    """验证东方财富官方合法 Origin/Referer 发起的自选股同步放行与 CORS OPTIONS 预检 (书签与油猴保障)"""
    client = TestClient(app)
    # 0. 验证浏览器发送的 OPTIONS 预检请求返回 200，杜绝 NameError: Response 导致的 500
    options_resp = client.options(
        "/api/eastmoney/bind-community-cookie",
        headers={
            "Origin": "https://quote.eastmoney.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"
        }
    )
    assert options_resp.status_code == 200
    assert options_resp.headers.get("Access-Control-Allow-Origin") == "https://quote.eastmoney.com"
    assert options_resp.headers.get("Access-Control-Allow-Private-Network") == "true"

    # 1. 模拟在 quote.eastmoney.com 页面执行书签发送请求
    resp = client.post(
        "/api/eastmoney/bind-community-cookie",
        headers={
            "Origin": "https://quote.eastmoney.com",
            "Referer": "https://quote.eastmoney.com/zixuan/"
        },
        json={"direct_watchlist": [{"symbol": "600519", "name": "贵州茅台"}]}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok" or data.get("code") == 200

    # 2. 非法第三方域冒充应该被 401 拦截
    bad_resp = client.post(
        "/api/eastmoney/bind-community-cookie",
        headers={
            "Origin": "https://malicious-site.com",
            "Referer": "https://malicious-site.com/hack"
        },
        json={"direct_watchlist": [{"symbol": "600519", "name": "贵州茅台"}]}
    )
    assert bad_resp.status_code == 401
