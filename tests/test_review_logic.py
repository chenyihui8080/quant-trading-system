"""复盘工作台纯逻辑测试（无网络依赖）"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


class TestBrokerDecode:
    """真实交割单解码：空输入 / 单笔买卖 / 多笔 / 异常格式"""

    def _decode(self, text):
        from review_workbench.agents.full_dashboard_service import decode_real_broker_statement
        return decode_real_broker_statement(text)

    def test_empty(self):
        r = self._decode("")
        assert r["total_lines"] == 0
        assert r["buy_count"] == 0 and r["sell_count"] == 0

    def test_whitespace_only(self):
        r = self._decode("   \n  \n")
        assert r["total_lines"] == 0

    def test_single_buy(self):
        r = self._decode("证券买入 600519 100股 1800.00")
        assert r["buy_count"] == 1
        assert r["sell_count"] == 0

    def test_single_sell(self):
        r = self._decode("证券卖出 600519 100股 1900.00")
        assert r["buy_count"] == 0
        assert r["sell_count"] == 1

    def test_mixed_buy_sell(self):
        text = "买入 600519 100 1800\n卖出 600519 100 1900\n买入 000001 200 15.5"
        r = self._decode(text)
        assert r["buy_count"] == 2
        assert r["sell_count"] == 1
        assert r["total_lines"] == 3

    def test_unrecognized(self):
        r = self._decode("今天天气不错，随便记录一下")
        assert r["buy_count"] == 0 and r["sell_count"] == 0
        assert "未解析" in r["strategy_pattern"]

    def test_malformed_numeric(self):
        # 数字异常不崩溃，仍能识别买卖动作
        r = self._decode("买入 abc def\n卖出 xyz")
        assert r["buy_count"] == 1
        assert r["sell_count"] == 1

    def test_not_string(self):
        r = self._decode(None)
        assert r["total_lines"] == 0


class TestAttributionMatcher:
    """归因匹配：无资讯涨停放量降为 unconfirmed（杜绝伪装高确定性）"""

    def _match(self, pool, news):
        from review_workbench.agents.attribution_matcher import attribution_matcher
        return attribution_matcher.match_attributions(pool, news)

    def test_no_news_limit_up(self):
        pool = [{"stock_code": "600519", "stock_name": "贵州茅台",
                 "change_pct": 10.0, "turnover_rate": 5.0}]
        item = self._match(pool, [])[0]
        assert item["confidence_level"] == "unconfirmed"
        assert item["attribution_confidence"] < 0.40

    def test_no_news_normal(self):
        pool = [{"stock_code": "600519", "stock_name": "贵州茅台",
                 "change_pct": 2.0, "turnover_rate": 1.0}]
        item = self._match(pool, [])[0]
        assert item["confidence_level"] == "unconfirmed"

    def test_direct_name_match(self):
        pool = [{"stock_code": "600519", "stock_name": "贵州茅台",
                 "change_pct": 5.0, "turnover_rate": 3.0}]
        news = [{"title": "贵州茅台公告", "text": "贵州茅台发布业绩预告",
                 "source": "官方公告", "ref_tag": "ref:1"}]
        item = self._match(pool, news)[0]
        assert item["confidence_level"] == "high"
        assert item["attribution_type"] == "hotspot_driver"


class TestPipelineStamp:
    """Pipeline 输出版本/运行标识"""

    def test_stamp_fields(self):
        from review_workbench.pipeline.graph import _stamp_state, PIPELINE_VERSION
        state = _stamp_state({"trade_date": "2026-08-28"})
        assert state["pipeline_version"] == PIPELINE_VERSION
        assert "run_id" in state and "generated_at" in state

    def test_version_nonempty(self):
        from review_workbench.pipeline.graph import PIPELINE_VERSION
        assert PIPELINE_VERSION and "." in PIPELINE_VERSION
