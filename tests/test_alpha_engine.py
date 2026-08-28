"""Alpha 实战交易系统核心逻辑、风控计算与数据层单元测试套件"""
import pytest
from utils.alpha_engine import AlphaEngine, AlphaRuleConfig
from utils.broker_importer import broker_importer
from utils.portfolio_advisor import PortfolioStore, PortfolioAdvisor, PositionItem
from utils.auto_sync_scheduler import auto_sync_scheduler


class TestAlphaEngineLevels:
    """测试买卖点、止损与仓位测算核心逻辑"""

    def test_tech_stop_loss_calculation(self):
        """验证 Bug 1 修复：技术支撑位高于固定底线时，应采用技术支撑位以收紧风险"""
        engine = AlphaEngine(AlphaRuleConfig(stop_loss_pct=3.5))
        # 现价 100，前日最低 98.0，MA5 98.5 -> 技术支撑位 98.0/97.51 均高于固定止损 96.5
        kline = [
            ["2026-08-15", 95, 96, 94, 97, 1000],
            ["2026-08-16", 96, 97, 95, 98, 1000],
            ["2026-08-17", 97, 98, 96, 99, 1000],
            ["2026-08-18", 98, 99, 98.0, 100, 1000],  # 前一日最低 98.0
            ["2026-08-19", 99, 100, 99, 101, 1000],
        ]
        res = engine.calculate_trade_levels(100.0, kline=kline)
        # 止损价应为 98.0 (前日最低支撑)，而非固定止损 96.5
        assert res.p_stop == 98.0
        assert res.stop_loss_pct == -2.0

    def test_fixed_stop_loss_fallback(self):
        """当技术支撑位过低跌破硬性底线时，应以固定止损 96.5 作为铁律兜底"""
        engine = AlphaEngine(AlphaRuleConfig(stop_loss_pct=3.5))
        # 前日最低 90.0，MA5 90.0 (跌破了 96.5 的固定硬性底线)
        kline = [
            ["2026-08-18", 92, 91, 90.0, 93, 1000],
            ["2026-08-19", 99, 100, 99, 101, 1000],
        ]
        res = engine.calculate_trade_levels(100.0, kline=kline)
        assert res.p_stop == 96.5

    def test_risk_reward_ratio_and_filter(self):
        """验证 Bug 2 修复：盈亏比与风控过滤正常连通"""
        engine = AlphaEngine(AlphaRuleConfig(stop_loss_pct=3.5, target1_profit_pct=5.0, target2_profit_pct=10.0, min_risk_reward_ratio=1.5))
        res = engine.calculate_trade_levels(100.0)
        # 第二目标 110.0，风险 3.5 -> 盈亏比 10 / 3.5 = 2.86 >= 1.5
        assert res.rr_ratio >= 2.0
        assert res.passed_filter is True
        assert res.status == "待执行"


class TestBrokerImporterText:
    """测试券商与文本导入解析逻辑"""

    def test_parse_chinese_units_shou(self):
        """验证 Bug 3 & Bug 4 修复：中文“5手”正确识别为 500 股"""
        text = "贵州茅台 5手 成本1200元"
        results = broker_importer.parse_free_text(text)
        assert len(results) >= 1
        assert results[0]["name"] == "贵州茅台"
        assert results[0]["shares"] == 500
        assert results[0]["cost_price"] == 1200.0

    def test_parse_chinese_units_wangu(self):
        """验证“2万股”正确识别为 20000 股"""
        text = "平安银行 2万股 买入价11.5"
        results = broker_importer.parse_free_text(text)
        assert len(results) >= 1
        assert results[0]["shares"] == 20000
        assert results[0]["cost_price"] == 11.5


class TestPortfolioAdvisorLogic:
    """测试持仓诊断与风控评估"""

    def test_cost_unknown_safety(self):
        """验证 Bug 6 修复：成本为 0 时标记成本待补充，不生成荒谬盈亏"""
        advisor = PortfolioAdvisor(PortfolioStore())
        pos = PositionItem(symbol="600519", name="贵州茅台", shares=100, cost_price=0.0)
        diag = advisor.diagnose_single_position(pos, total_capital=1_000_000.0)
        assert diag.pnl_amount == 0.0
        assert diag.pnl_pct == 0.0
        assert diag.action == "成本待补充"

    def test_real_holding_days(self):
        """验证 Bug 5 修复：真实计算持仓天数"""
        advisor = PortfolioAdvisor(PortfolioStore())
        pos = PositionItem(symbol="600519", name="贵州茅台", shares=100, cost_price=1000.0, buy_date="2026-08-01")
        diag = advisor.diagnose_single_position(pos, total_capital=1_000_000.0)
        assert diag.holding_days > 1
