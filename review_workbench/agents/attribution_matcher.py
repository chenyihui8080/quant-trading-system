"""
逻辑配对师 Agent (Attribution Matcher)
职责：
1. 将波动池标的与已清洗去重的核心资讯证据库进行严密因果逻辑配对
2. 给出归因类型 (hotspot_driver/us_mapping/policy_support/social_buzz/earnings_surprise/technical_breakout/unconfirmed)
3. 给出置信度打分 (0.0~1.0) 与等级 (high/medium/low/unconfirmed)，强制附带 evidence_ref 引用
4. 杜绝无根据的臆测，无明确证据一律打上 unconfirmed 待确认
"""

import logging
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger("AttributionMatcher")


class AttributionMatcher:
    """逻辑配对师核心引擎"""

    def __init__(self):
        # 产业链与板块关键词映射表
        self.sector_keywords = {
            "CPO": ["cpo", "光模块", "800g", "1.6t", "英伟达", "全光网", "中际旭创", "新易盛", "天孚通信"],
            "光模块": ["cpo", "光模块", "800g", "1.6t", "英伟达", "全光网", "中际旭创", "新易盛"],
            "芯片半导体": ["芯片", "半导体", "大基金", "先进制程", "eda", "刻蚀机", "中微公司", "北方华创", "寒武纪"],
            "半导体设备": ["半导体", "刻蚀机", "薄膜沉积", "北方华创", "中微公司"],
            "低空经济": ["低空经济", "evtol", "飞行汽车", "通航", "空域", "中信海直", "万丰奥威"],
            "通信设备": ["通信", "5g", "算力网络", "中兴通讯"],
            "生物医药": ["创新药", "出海", "临床", "license-out", "沃森生物", "恒瑞医药"],
            "贵金属": ["黄金", "降息", "避险", "山东黄金", "中金黄金"],
            "商业航天": ["卫星", "火箭", "低轨星座", "航天", "中国卫星"]
        }

    def match_attributions(self, volatility_pool: list[dict], curated_news: list) -> list[dict]:
        """执行因果逻辑配对与置信度打分"""
        logger.info(f"🔗 [逻辑配对师] 开始对 {len(volatility_pool)} 只波动标的与 {len(curated_news)} 条核心证据进行严密归因...")

        # 构建证据索引
        news_index = []
        for n in curated_news:
            ref_tag = getattr(n, "ref_tag", n.get("ref_tag", "ref:0") if isinstance(n, dict) else "ref:0")
            title = getattr(n, "title", n.get("title", "") if isinstance(n, dict) else "")
            content = getattr(n, "content", n.get("content", "") if isinstance(n, dict) else "")
            source = getattr(n, "source", n.get("source", "") if isinstance(n, dict) else "")
            news_index.append({
                "ref_tag": ref_tag,
                "text": (title + " " + content).lower(),
                "title": title,
                "source": source
            })

        attributed_pool = []

        for stock in volatility_pool:
            stock_code = stock["stock_code"]
            stock_name = stock["stock_name"]
            sector = stock.get("sector_name", "")
            chg = stock.get("change_pct", 0.0)

            matched_ref = None
            matched_reason = ""
            attr_type = "unconfirmed"
            confidence = 0.35

            # 1. 精确标的名称/代码直接点名
            for n in news_index:
                if stock_name.lower() in n["text"] or stock_code.lower() in n["text"]:
                    matched_ref = n["ref_tag"]
                    matched_reason = f"官方公告/行业要闻直接催化点名：{n['title']}"
                    attr_type = "hotspot_driver" if "政策" not in n["source"] else "policy_support"
                    confidence = 0.95
                    break

            # 2. 产业链龙头/板块关键词共振匹配
            if not matched_ref:
                for n in news_index:
                    # 检查美股映射
                    if "美股" in n["source"] and any(k in n["text"] for k in [sector.lower(), stock_name.lower(), "cpo", "ai", "半导体"]):
                        matched_ref = n["ref_tag"]
                        matched_reason = f"隔夜美股映射链共振走强：{n['title']}"
                        attr_type = "us_mapping"
                        confidence = 0.88
                        break
                    # 检查社交媒体舆情热度
                    elif "社交舆情" in n["source"] and any(k in n["text"] for k in [sector.lower(), stock_name.lower(), "算力", "cpo"]):
                        matched_ref = n["ref_tag"]
                        matched_reason = f"全网社交媒体与短视频舆情高度聚焦：{n['title']}"
                        attr_type = "social_buzz"
                        confidence = 0.82
                        break
                    # 检查产业重磅政策
                    elif any(k in n["text"] for k in [sector.lower(), stock_name.lower()]):
                        matched_ref = n["ref_tag"]
                        matched_reason = f"受益于行业重磅催化政策：{n['title']}"
                        attr_type = "policy_support"
                        confidence = 0.78
                        break

            # 3. 技术形态与待确认兜底 (无公开资讯催化，明示为低置信度待确认，杜绝伪装高确定性)
            if not matched_ref:
                if chg >= 9.5 and stock.get("turnover_rate", 0) >= 4.0:
                    matched_ref = "ref:tech"
                    matched_reason = "涨停放量但无公开资讯催化，技术形态待确认（低置信度）"
                    attr_type = "technical_breakout"
                    confidence = 0.35
                else:
                    matched_ref = "ref:funds"
                    matched_reason = "日内资金波动但无明确公开催化，归因待确认（低置信度）"
                    attr_type = "unconfirmed"
                    confidence = 0.25

            # 置信度等级评定
            if confidence >= 0.80:
                conf_level = "high"
            elif confidence >= 0.60:
                conf_level = "medium"
            elif confidence >= 0.40:
                conf_level = "low"
            else:
                conf_level = "unconfirmed"

            item = dict(stock)
            item.update({
                "attribution_type": attr_type,
                "attribution_detail": matched_reason,
                "attribution_confidence": confidence,
                "confidence_level": conf_level,
                "evidence_ref": matched_ref
            })
            attributed_pool.append(item)


        high_cnt = sum(1 for x in attributed_pool if x["confidence_level"] == "high")
        med_cnt = sum(1 for x in attributed_pool if x["confidence_level"] == "medium")
        logger.info(f"✅ [逻辑配对师] 配对完成：高置信度 {high_cnt} 只 / 中置信度 {med_cnt} 只 / 待确认 {len(attributed_pool) - high_cnt - med_cnt} 只！")
        return attributed_pool


# 全局单例
attribution_matcher = AttributionMatcher()
