"""纸面账户账本逻辑测试：资金、持仓、T+1"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from api.routers.legacy_router import PaperAccount


class TestPaperAccount:
    def test_initial_state(self):
        acc = PaperAccount()
        d = acc.to_dict()
        assert d["cash"] == 1_000_000.0
        assert d["position_count"] == 0

    def test_buy_deducts_cash_and_adds_position(self):
        acc = PaperAccount()
        acc.apply_buy("600519", 1800.0, 100, "2026-08-28")
        assert acc.to_dict()["cash"] == 1_000_000.0 - 180000.0
        assert acc.positions["600519"]["qty"] == 100

    def test_buy_insufficient_funds(self):
        acc = PaperAccount(cash=100_000.0)
        ok, msg = acc.can_buy("600519", 1800.0, 100)
        assert ok is False
        assert "资金不足" in msg

    def test_buy_sufficient_funds(self):
        acc = PaperAccount(cash=1_000_000.0)
        ok, _ = acc.can_buy("600519", 1800.0, 100)
        assert ok is True

    def test_sell_t1_frozen_same_day(self):
        """当日买入不可当日卖出"""
        acc = PaperAccount()
        acc.apply_buy("600519", 1800.0, 100, "2026-08-28")
        ok, msg = acc.can_sell("600519", 100, "2026-08-28")
        assert ok is False
        assert "T+1" in msg

    def test_sell_next_day_allowed(self):
        """次日可卖全部持仓"""
        acc = PaperAccount()
        acc.apply_buy("600519", 1800.0, 100, "2026-08-27")
        ok, _ = acc.can_sell("600519", 100, "2026-08-28")
        assert ok is True
        acc.apply_sell("600519", 1900.0, 100, "2026-08-28")
        assert acc.positions.get("600519") is None  # 已清仓

    def test_sell_partial_t1_mixed_lots(self):
        """分批买入：当日批次冻结，旧批次可卖"""
        acc = PaperAccount()
        acc.apply_buy("600519", 1800.0, 100, "2026-08-27")  # 旧批次
        acc.apply_buy("600519", 1850.0, 100, "2026-08-28")  # 当日批次
        # 共 200 股，当日可卖仅旧批次 100 股
        ok, _ = acc.can_sell("600519", 100, "2026-08-28")
        assert ok is True
        ok, _ = acc.can_sell("600519", 200, "2026-08-28")
        assert ok is False
        # 卖 100 股后，剩余 100 股为当日冻结
        acc.apply_sell("600519", 1900.0, 100, "2026-08-28")
        assert acc.positions["600519"]["qty"] == 100
        ok, _ = acc.can_sell("600519", 100, "2026-08-28")
        assert ok is False  # 剩余为当日买入，仍冻结

    def test_sell_insufficient_position(self):
        acc = PaperAccount()
        acc.apply_buy("600519", 1800.0, 100, "2026-08-27")
        ok, msg = acc.can_sell("600519", 200, "2026-08-28")
        assert ok is False
        assert "持仓不足" in msg

    def test_avg_cost_weighted(self):
        acc = PaperAccount()
        acc.apply_buy("600519", 100.0, 100, "2026-08-27")
        acc.apply_buy("600519", 200.0, 100, "2026-08-28")
        assert acc.positions["600519"]["avg_cost"] == 150.0

    def test_account_view_sellable(self):
        """账户视图：当日买入冻结数量正确"""
        acc = PaperAccount()
        acc.apply_buy("600519", 1800.0, 100, "2026-08-28")
        d = acc.snapshot("2026-08-28")
        pos = d["positions"]["600519"]
        assert pos["qty"] == 100
        assert pos["frozen_t1_qty"] == 100
        assert pos["sellable_qty"] == 0
