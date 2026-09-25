"""
深度分析师 / 多层漏斗过滤引擎 (Funnel Filter)
职责：
1. 读取可配置量化规则集 (funnel_rulesets.json)
2. 执行 Stage 1 -> Stage 2 -> Stage 3 -> Stage 4 的链式过滤 (全市场 -> 350+ -> 115 -> 87 -> 约45只)
3. 记录每层过滤日志至 funnel_logs 表，并将最终 45 只核心观察池黄金标的持久化到 core_watchlists
"""

import json
import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger("FunnelFilter")

DB_PATH = Path(__file__).parent.parent / "data" / "review.db"
RULESET_PATH = Path(__file__).parent.parent / "data" / "funnel_rulesets.json"


@dataclass
class WatchlistStock:
    stock_code: str
    stock_name: str
    sector: str
    change_pct: float
    amount_yi: float
    attribution_tag: str
    attribution_detail: str
    attribution_confidence: float
    confidence_level: str
    risk_flags: list[str] = field(default_factory=list)
    evidence_ref: str = "ref:0"
    trade_date: str = ""


class FunnelFilter:
    """可配置多层漏斗过滤核心引擎"""

    def __init__(self):

        self.ruleset = self._load_ruleset()

    def _load_ruleset(self) -> dict:
        """加载漏斗规则集"""
        if RULESET_PATH.exists():
            try:
                with open(RULESET_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    rulesets = data.get("rulesets", [])
                    if rulesets:
                        return rulesets[0]
            except Exception as e:
                logger.error(f"加载漏斗规则文件失败: {e}")
        
        # 默认内置兜底规则
        return {
            "stages": [
                {
                    "stage": 1,
                    "name": "全市场客观波动初筛 (Stage 1)",
                    "rules": [{"field": "change_pct_abs", "op": ">=", "value": 4.5}]
                },
                {
                    "stage": 2,
                    "name": "硬性排雷与基础流动性过滤 (Stage 2)",
                    "rules": [
                        {"field": "is_st", "op": "==", "value": False},
                        {"field": "amount_yi", "op": ">=", "value": 1.5}
                    ]
                },
                {
                    "stage": 3,
                    "name": "量价形态与筹码换手健康度 (Stage 3)",
                    "rules": [
                        {"field": "turnover_rate", "op": "between", "value": [2.5, 30.0]}
                    ]
                },
                {
                    "stage": 4,
                    "name": "逻辑归因与核心龙头池精炼 (Stage 4)",
                    "rules": [
                        {"field": "attribution_confidence", "op": ">=", "value": 0.40}
                    ]
                }
            ]
        }

    def _ensure_tables(self, cursor):
        """确保 funnel_logs 与 core_watchlists 表存在 (自愈建表)"""
        from review_workbench.scripts.init_db import init_database
        try:
            cursor.execute("SELECT 1 FROM funnel_logs LIMIT 1")
            cursor.execute("SELECT 1 FROM core_watchlists LIMIT 1")
        except Exception:
            init_database()

    def apply_funnel(self, pool: list[dict], trade_date: Optional[str] = None) -> list[dict]:
        """链式执行 4 层量化漏斗过滤与日志审计 (带表自愈保护)"""
        current_date = trade_date or datetime.now().strftime("%Y-%m-%d")
        logger.info(f"🌪️ [深度分析师] 启动 4 层量化漏斗链式过滤 (输入原始标的: {len(pool)} 只)...")

        stages_cfg = self.ruleset.get("stages", [])
        current_pool = list(pool)
        
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH))
        try:
            with conn:
                cursor = conn.cursor()
                self._ensure_tables(cursor)
                
                # 清理当日旧漏斗审计日志
                cursor.execute("DELETE FROM funnel_logs WHERE trade_date = ?", (current_date,))


            # 收集淘汰标的以生成同日并立的避雷黑榜
            dropped_candidates = []

            # 1. 逐层过滤
            for stage_info in stages_cfg:
                stage_num = stage_info["stage"]
                stage_name = stage_info["name"]
                rules = stage_info.get("rules", [])
                in_cnt = len(current_pool)

                next_pool = []
                for item in current_pool:
                    if self._match_all_rules(item, rules):
                        next_pool.append(item)
                    else:
                        if stage_num in (2, 3, 4):
                            dropped_candidates.append({
                                "item": item,
                                "failed_stage": stage_num,
                                "stage_name": stage_name
                            })

                out_cnt = len(next_pool)
                logger.info(f"  • Stage {stage_num} [{stage_name}]: {in_cnt} 只 -> 保留 {out_cnt} 只 (剔除 {in_cnt - out_cnt} 只)")

                # 写入 funnel_logs 审计
                cursor.execute("""
                    INSERT INTO funnel_logs (trade_date, stage, stage_name, input_count, output_count, filter_summary)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    current_date,
                    stage_num,
                    stage_name,
                    in_cnt,
                    out_cnt,
                    json.dumps({"rules": rules, "dropped": in_cnt - out_cnt}, ensure_ascii=False)
                ))

                current_pool = next_pool

            # 2. 核心观察池（进攻红榜）铁律：必须收阳且真实上涨（change_pct > 0.0）！严禁任何绿盘下跌或破位跌停票混入进攻池！
            bull_pool = []
            for it in current_pool:
                chg = float(it.get("change_pct", 0.0) or 0.0)
                if chg > 0.0:
                    bull_pool.append(it)
                else:
                    dropped_candidates.append({
                        "item": it,
                        "failed_stage": 3,
                        "stage_name": "趋势走弱与破位下跌 (绿盘下跌)"
                    })

            # 排序权重：置信度降序 -> 涨幅健康度 -> 成交额降序
            bull_pool.sort(key=lambda x: (x.get("attribution_confidence", 0), x.get("change_pct", 0), x.get("amount_yi", 0)), reverse=True)
            final_watchpool = bull_pool[:45]

            # 3. 持久化最终核心观察池至 core_watchlists (进攻红榜)
            cursor.execute("DELETE FROM core_watchlists WHERE trade_date = ?", (current_date,))
            for it in final_watchpool:
                # 安全兜底防线：绝对严禁 <= 0 的绿盘下跌票入库
                if float(it.get("change_pct", 0.0) or 0.0) <= 0.0:
                    continue
                stock_code_clean = str(it.get("stock_code", "")).strip().zfill(6)
                
                # 动态计算真实置信度与等级 (解决 C-WATCH-002: 去除 0.5 固定兜底)
                raw_conf = it.get("attribution_confidence")
                if raw_conf is not None and float(raw_conf) > 0:
                    dyn_conf = round(float(raw_conf), 2)
                else:
                    # 基于标的成交量、换手率与异动模式动态打分
                    turnover = float(it.get("turnover_rate", 0.0) or 0.0)
                    chg = abs(float(it.get("change_pct", 0.0) or 0.0))
                    dyn_conf = round(min(0.95, 0.35 + (turnover / 50.0) * 0.3 + (chg / 10.0) * 0.3), 2)
                
                # 置信度等级动态映射
                if dyn_conf >= 0.80:
                    conf_level = "high"
                elif dyn_conf >= 0.60:
                    conf_level = "medium"
                else:
                    conf_level = "low"

                cursor.execute("""
                    INSERT INTO core_watchlists (
                        trade_date, stock_code, stock_name, sector_name, close_price,
                        change_pct, turnover_rate, amount_yi, volatility_pattern,
                        attribution_type, attribution_detail, attribution_confidence,
                        confidence_level, risk_flags, evidence_ref
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    current_date,
                    stock_code_clean,
                    str(it.get("stock_name", "")).strip(),
                    it.get("sector_name", ""),
                    float(it.get("close_price", 0.0) or 0.0),
                    float(it.get("change_pct", 0.0) or 0.0),
                    float(it.get("turnover_rate", 0.0) or 0.0),
                    float(it.get("amount_yi", 0.0) or 0.0),
                    it.get("volatility_pattern", "active"),
                    it.get("attribution_type", "unconfirmed"),
                    it.get("attribution_detail", ""),
                    dyn_conf,
                    conf_level,
                    json.dumps(it.get("risk_flags", []), ensure_ascii=False),
                    it.get("evidence_ref", "ref:0")
                ))

            # 4. 同步持久化避雷黑榜至 blacklist_watchlists (保证红黑双榜同日并立、数量自洽)
            cursor.execute("DELETE FROM blacklist_watchlists WHERE trade_date = ?", (current_date,))
            dropped_candidates.sort(key=lambda x: float(x["item"].get("amount_yi", 0) or 0), reverse=True)
            black_selected = dropped_candidates[:8]
            
            stage_reject_map = {
                2: ("【流动性严重匮乏/合规隐患】日成交额不足或存在ST/合规瑕疵，深度低于量化安全线，大资金无法全身而退。", "流动性枯竭"),
                3: ("【筹码天花板压顶/破位】击穿多头防守生命线，放量下跌或阴线破位，套牢抛压沉重，严禁盲目接飞刀。", "严重破位"),
                4: ("【逻辑归因置信度不足/资金撤离】所属板块热度退潮或主力资金呈现净流出，无实质产业催化支撑。", "主力出货")
            }

            for bc in black_selected:
                b_item = bc["item"]
                b_stage = bc["failed_stage"]
                b_code = str(b_item.get("stock_code", "")).strip().zfill(6)
                def_reason, def_risk = stage_reject_map.get(b_stage, ("量化多因子综合筛查未过关，存在较大回撤风险", "中高风险"))
                
                cursor.execute("""
                    INSERT INTO blacklist_watchlists (
                        trade_date, stock_code, stock_name, sector_name, close_price,
                        change_pct, turnover_rate, amount_yi, failed_stage, reject_reason,
                        risk_level, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    current_date,
                    b_code,
                    str(b_item.get("stock_name", "")).strip(),
                    b_item.get("sector_name", ""),
                    float(b_item.get("close_price", 0.0) or 0.0),
                    float(b_item.get("change_pct", 0.0) or 0.0),
                    float(b_item.get("turnover_rate", 0.0) or 0.0),
                    float(b_item.get("amount_yi", 0.0) or 0.0),
                    b_stage,
                    def_reason,
                    def_risk,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                ))

            conn.commit()

        finally:
            conn.close()

        logger.info(f"🏆 [深度分析师] 核心观察池入库完成: 共 {len(final_watchpool)} 只进攻红标入库 | 避雷黑榜收集: {len(dropped_candidates)} 只")
        return final_watchpool

    def load_core_watchpool(self, trade_date: Optional[str] = None, top_n: int = 45) -> list[WatchlistStock]:
        """从数据库中读取已生成的当日核心观察池黄金标的"""
        current_date = trade_date or datetime.now().strftime("%Y-%m-%d")
        results: list[WatchlistStock] = []
        if not DB_PATH.exists():
            return results

        conn = sqlite3.connect(str(DB_PATH))
        try:
            with conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT stock_code, stock_name, sector_name, change_pct, amount_yi, attribution_type,
                           attribution_detail, attribution_confidence, confidence_level, risk_flags, evidence_ref, trade_date
                    FROM core_watchlists
                    WHERE trade_date = ?
                    ORDER BY attribution_confidence DESC, amount_yi DESC
                    LIMIT ?
                """, (current_date, top_n))
                rows = cursor.fetchall()
                for r in rows:
                    results.append(WatchlistStock(
                        stock_code=r["stock_code"],
                        stock_name=r["stock_name"],
                        sector=r["sector_name"] or "",
                        change_pct=float(r["change_pct"] or 0.0),
                        amount_yi=float(r["amount_yi"] or 0.0),
                        attribution_tag=r["attribution_type"] or "技术突破",
                        attribution_detail=r["attribution_detail"] or "",
                        attribution_confidence=float(r["attribution_confidence"] or 0.0),
                        confidence_level=r["confidence_level"] or "medium",
                        risk_flags=json.loads(r["risk_flags"]) if r["risk_flags"] else [],
                        evidence_ref=r["evidence_ref"] or "ref:0",
                        trade_date=r["trade_date"]
                    ))
        except Exception as e:
            logger.warning(f"读取核心观察池数据异常: {e}")
        finally:
            conn.close()
        return results


    def _match_all_rules(self, item: dict, rules: list[dict]) -> bool:
        """规则匹配引擎 (严格防御性校验，防止缺失关键字段静默放行)"""
        for r in rules:
            field = r.get("field")
            op = r.get("op")
            target_val = r.get("value")

            val = item.get(field)
            if val is None:
                # 兼容性字段补齐计算
                if field == "change_pct_abs":
                    val = abs(float(item.get("change_pct", 0.0) or 0.0))
                elif field == "is_st":
                    val = bool(item.get("is_st", False))
                elif field == "is_suspended":
                    val = bool(item.get("is_suspended", False))
                elif field == "list_days":
                    val = int(item.get("list_days", 365) or 365)
                elif field == "attribution_confidence":
                    if "attribution_confidence" in item:
                        val = float(item["attribution_confidence"] or 0.0)
                    elif "confidence" in item:
                        val = float(item["confidence"] or 0.0)
                    else:
                        # 缺失归因置信度的标的坚决拦截 (Fail-Safe)
                        return False
                else:
                    # 关键字段缺失时严格拦截 (Fail-Safe)
                    return False


            try:
                if op == "==" and val != target_val:
                    return False
                elif op == "!=" and val == target_val:
                    return False
                elif op == ">=" and float(val) < float(target_val):
                    return False
                elif op == "<=" and float(val) > float(target_val):
                    return False
                elif op == ">" and float(val) <= float(target_val):
                    return False
                elif op == "<" and float(val) >= float(target_val):
                    return False
                elif op == "between":
                    num_val = float(val)
                    if not (float(target_val[0]) <= num_val <= float(target_val[1])):
                        return False
                elif op == "in" and val not in target_val:
                    return False
                elif op == "not_in" and val in target_val:
                    return False
                elif op not in ("==", "!=", ">=", "<=", ">", "<", "between", "in", "not_in"):
                    # 未知操作符防御性直接拦截 (Fail-Safe 策略)
                    logger.warning(f"⚠️ [漏斗引擎] 遇到未知规则操作符 '{op}'，严格拦截该标的")
                    return False
            except (ValueError, TypeError):
                # 数据类型异常直接判定不匹配
                return False

        return True



# 全局单例
funnel_filter = FunnelFilter()

