#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
战法失误穿透归因与参数修复进化引擎 (Loss Attribution & Strategy Evolution Engine)
终极目标：
围绕「打造胜率 7 成（70%）以上的万能打法」，实现真实实盘复盘对账数据的穿透分析：
1. 失败单穿透归因：精准诊断 5 大失误根因（买点过早/过高、止损过钝防守失效、止损过窄洗盘误杀、利润回吐未及时止盈、大盘泥沙俱下系统逆风）；
2. 战法动态参数热加载：战法参数不再写死在代码中，支持数据库热配置并实时在选股扫描与点位测算中生效；
3. 70% 胜率推演模拟器：测算若调整买点或止损，能将多少笔失败单扭亏为盈，推导预期胜率提升幅度；
4. 战法进化履历追踪 (Changelog)：完整记录每一次调优触发原因、诊断结论、参数修改前后对比与版本迭代 (v1.0 -> v1.1 -> v2.0)。
"""

import json
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("LossAttributionEngine")

# 默认数据库路径
DB_PATH = Path("data/prediction.db")

# 归因原因枚举与诊断配置
ATTRIBUTION_TYPES = {
    "entry_too_high": {
        "code": "entry_too_high",
        "name": "买点过早/追高被套",
        "icon": "⚠️",
        "description": "建仓位置过急，分时未企稳即买入，建仓后盘中大幅继续下探超过 3%",
        "action": "建议将买点区间向下调整 1.5%~3.0%，等待深跌企稳确认再进场"
    },
    "stop_loss_too_wide": {
        "code": "stop_loss_too_wide",
        "name": "止损过钝/防守失效",
        "icon": "🚨",
        "description": "单笔亏损超过 -4.0% 以上，止损线设置过宽或破位时未坚决果断斩仓",
        "action": "建议将战法铁血硬止损线收紧至 2.5%~3.0%，严控单笔最大回撤"
    },
    "profit_giveback": {
        "code": "profit_giveback",
        "name": "止盈不及时/大幅回吐",
        "icon": "📉",
        "description": "盘中最高浮盈曾达 3.5% 以上，但未按计划阶梯减仓，尾盘获利盘回吐甚至由盈转亏",
        "action": "建议将第一目标位 Target1 前移 1.0%~1.5%，触发即锁定半仓并启动保本止损"
    },
    "stop_loss_too_tight": {
        "code": "stop_loss_too_tight",
        "name": "止损过窄/洗盘误杀",
        "icon": "🔄",
        "description": "盘中打穿止损线割肉后，股价当天或次日迅速反抽翻红，属于主力洗盘假破位",
        "action": "建议适当放宽日内止损缓冲空间 0.5%~1.0%，或改用收盘确认防假破位"
    },
    "market_regime_drag": {
        "code": "market_regime_drag",
        "name": "大盘逆风/泥沙俱下",
        "icon": "🌧️",
        "description": "大盘或所属板块普跌冰点，个股技术形态被系统性抛压击穿",
        "action": "建议启动大盘逆风过滤开关，大盘中位数跌幅>1.5% 时自动降仓或冷冻该打法"
    },
    "pattern_failure": {
        "code": "pattern_failure",
        "name": "形态破位/假突破",
        "icon": "❌",
        "description": "突破未能吸引增量资金接力，次日直接低开低走跌破关键支撑",
        "action": "建议增加成交量比与换手率门槛要求，过滤缩量假突破形态"
    }
}


class LossAttributionEngine:
    """战法失误归因与进化调优引擎"""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DB_PATH
        self._ensure_tables()

    def _get_connection(self) -> sqlite3.Connection:
        """获取 SQLite 连接并配置 WAL 模式"""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=20.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _ensure_tables(self):
        """初始化战法修复履历表与动态生效参数表"""
        try:
            with self._get_connection() as conn:
                # 1. 战法修复进化履历表 (Changelog)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS playbook_repair_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        playbook_id TEXT NOT NULL,
                        playbook_name TEXT NOT NULL,
                        version TEXT NOT NULL,
                        repair_time TEXT NOT NULL,
                        repair_type TEXT NOT NULL,
                        pre_win_rate REAL,
                        target_win_rate REAL DEFAULT 70.0,
                        post_win_rate REAL,
                        trigger_reason TEXT NOT NULL,
                        loss_attribution TEXT,
                        param_before TEXT NOT NULL,
                        param_after TEXT NOT NULL,
                        simulated_improvement TEXT,
                        operator TEXT DEFAULT 'AI进化引擎'
                    )
                """)

                # 2. 战法动态参数热加载表 (当前最新生效参数)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS playbook_custom_params (
                        playbook_id TEXT PRIMARY KEY,
                        playbook_name TEXT,
                        buy_offset_low REAL DEFAULT 0.0,
                        buy_offset_high REAL DEFAULT 0.0,
                        stop_loss_pct REAL DEFAULT 3.0,
                        target1_pct REAL DEFAULT 6.0,
                        target2_pct REAL DEFAULT 10.0,
                        position_pct REAL DEFAULT 25.0,
                        min_rr_ratio REAL DEFAULT 1.5,
                        active_version TEXT DEFAULT 'v1.0',
                        updated_at TEXT
                    )
                """)

                conn.commit()
        except Exception as e:
            logger.error(f"初始化归因与修复表结构失败: {e}", exc_info=True)

    def get_custom_params(self, playbook_id: str) -> Optional[Dict[str, Any]]:
        """读取指定战法当前动态生效的参数"""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM playbook_custom_params WHERE playbook_id = ?", (playbook_id,))
                row = cursor.fetchone()
                if row:
                    return dict(row)
        except Exception as e:
            logger.error(f"读取战法 {playbook_id} 动态参数失败: {e}")
        return None

    def get_all_custom_params(self) -> Dict[str, Dict[str, Any]]:
        """读取所有战法的动态参数集合"""
        params_dict = {}
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM playbook_custom_params")
                for row in cursor.fetchall():
                    d = dict(row)
                    params_dict[d["playbook_id"]] = d
        except Exception as e:
            logger.error(f"读取全部动态参数异常: {e}")
        return params_dict

    def diagnose_single_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """
        穿透诊断单笔亏损/失误记录，返回归因判定与关键技术数据
        """
        entry_price = float(record.get("entry_price") or 0.0)
        actual_close = float(record.get("actual_close") or 0.0)
        actual_low = float(record.get("actual_low") or (entry_price if entry_price > 0 else actual_close))
        actual_high = float(record.get("actual_high") or actual_close)
        profit_pct = float(record.get("profit_pct") or 0.0)
        actual_change = float(record.get("actual_change_pct") or profit_pct)
        stop_loss = float(record.get("stop_loss") or 0.0)
        
        # 最大盘中回撤幅度
        intra_low_pct = ((actual_low - entry_price) / entry_price * 100.0) if entry_price > 0 else profit_pct
        # 盘中曾达到过的最高盈利
        intra_high_pct = ((actual_high - entry_price) / entry_price * 100.0) if entry_price > 0 else 0.0

        attribution = "pattern_failure"
        detail = "标的未按预期反弹，技术形态破位"

        # 规则 1: 曾大幅冲高，但最终由盈转亏 (利润回吐)
        if intra_high_pct >= 3.5 and profit_pct < 0:
            attribution = "profit_giveback"
            detail = f"盘中最高曾上冲 +{round(intra_high_pct, 1)}%，但因未启动阶梯止盈，尾盘回吐转亏 {round(profit_pct, 1)}%"

        # 规则 2: 单笔亏损极大（>4%），止损过钝
        elif profit_pct <= -4.0:
            attribution = "stop_loss_too_wide"
            detail = f"收盘录得深度亏损 {round(profit_pct, 1)}%，防守线设置过宽或未能果断执行止损"

        # 规则 3: 盘中大幅下挫击穿（下探>3.0%），说明买点过急
        elif intra_low_pct <= -3.0:
            attribution = "entry_too_high"
            detail = f"买入后盘中最大下探达 {round(intra_low_pct, 1)}%，进场缺乏分时企稳确认，买点过急"

        # 规则 4: 盘中被打穿止损后收盘回拉
        elif actual_low < stop_loss and actual_close > stop_loss and stop_loss > 0:
            attribution = "stop_loss_too_tight"
            detail = f"盘中低点 {actual_low} 触碰止损后回升至 {actual_close}，属于洗盘假击穿误杀"

        # 规则 5: 大盘整体环境拖累 (如实际下跌但相对抗跌)
        elif actual_change <= -3.0 and profit_pct <= -2.5:
            attribution = "market_regime_drag"
            detail = f"标的日内跌幅 {round(actual_change, 1)}%，受市场系统性恐慌情绪拖累深跌"

        meta = ATTRIBUTION_TYPES.get(attribution, ATTRIBUTION_TYPES["pattern_failure"])
        return {
            "record_id": record.get("id"),
            "stock_code": record.get("stock_code"),
            "stock_name": record.get("stock_name"),
            "record_date": record.get("record_date"),
            "entry_price": entry_price,
            "actual_close": actual_close,
            "actual_low": actual_low,
            "actual_high": actual_high,
            "profit_pct": profit_pct,
            "intra_low_pct": round(intra_low_pct, 2),
            "intra_high_pct": round(intra_high_pct, 2),
            "attribution_code": attribution,
            "attribution_name": meta["name"],
            "attribution_icon": meta["icon"],
            "diagnostic_detail": detail,
            "repair_action": meta["action"]
        }

    def analyze_failures(self, playbook_id: Optional[str] = None) -> Dict[str, Any]:
        """
        穿透审计指定战法或全系统的失误单，生成深度归因报告与 7 成胜率改进路线
        """
        from utils.playbook_engine import PLAYBOOK_REGISTRY

        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                # 查询已经复盘的失败单 (is_correct == 0 或 profit_pct < 0)
                if playbook_id and playbook_id != "all":
                    pb_meta = PLAYBOOK_REGISTRY.get(playbook_id, {})
                    short_name = pb_meta.get("short_name", "")
                    cursor.execute("""
                        SELECT * FROM prediction_records
                        WHERE (playbook_id = ? OR tags LIKE ? OR reason LIKE ?)
                          AND is_correct IS NOT NULL
                        ORDER BY record_date DESC, id DESC
                    """, (playbook_id, f"%{short_name}%", f"%{short_name}%"))
                else:
                    cursor.execute("""
                        SELECT * FROM prediction_records
                        WHERE is_correct IS NOT NULL
                        ORDER BY record_date DESC, id DESC
                    """)

                all_records = [dict(r) for r in cursor.fetchall()]

                total_count = len(all_records)
                win_records = [r for r in all_records if r.get("is_correct") == 1 or (r.get("profit_pct") or 0) > 0]
                fail_records = [r for r in all_records if r not in win_records]

                win_count = len(win_records)
                fail_count = len(fail_records)
                current_win_rate = round((win_count / total_count * 100.0), 1) if total_count > 0 else 0.0

                # 穿透诊断所有失败单
                diagnosed_failures = []
                attribution_counter: Dict[str, int] = {}
                for attr_key in ATTRIBUTION_TYPES:
                    attribution_counter[attr_key] = 0

                for rec in fail_records:
                    diag = self.diagnose_single_record(rec)
                    diagnosed_failures.append(diag)
                    code = diag["attribution_code"]
                    attribution_counter[code] = attribution_counter.get(code, 0) + 1

                # 计算 7 成胜率目标差距
                target_win_rate = 70.0
                needed_wins_for_70 = max(0, int(total_count * 0.70 + 0.99) - win_count) if total_count > 0 else 0

                # AI 修复模拟推演：通过优化买点与止损，能拯救多少笔失败单？
                # 若优化买点（下移2%），可拯救 entry_too_high 中低吸企稳的单；
                # 若优化阶梯止盈，可拯救 profit_giveback 的单。
                recoverable_entry = int(attribution_counter.get("entry_too_high", 0) * 0.7)
                recoverable_profit = attribution_counter.get("profit_giveback", 0)
                recoverable_stop = int(attribution_counter.get("stop_loss_too_tight", 0) * 0.8)
                total_simulated_recovered = recoverable_entry + recoverable_profit + recoverable_stop

                simulated_win_count = win_count + total_simulated_recovered
                simulated_win_rate = round((simulated_win_count / total_count * 100.0), 1) if total_count > 0 else 70.0

                # 归因排行榜
                attribution_ranking = []
                for code, count in attribution_counter.items():
                    if count > 0:
                        meta = ATTRIBUTION_TYPES[code]
                        attribution_ranking.append({
                            "code": code,
                            "name": meta["name"],
                            "icon": meta["icon"],
                            "count": count,
                            "ratio": round((count / fail_count * 100.0), 1) if fail_count > 0 else 0,
                            "action": meta["action"]
                        })
                attribution_ranking.sort(key=lambda x: x["count"], reverse=True)

                # 生成具体战法当前生效参数快照
                active_params = {}
                if playbook_id and playbook_id in PLAYBOOK_REGISTRY:
                    active_params = self.get_custom_params(playbook_id) or {
                        "playbook_id": playbook_id,
                        "playbook_name": PLAYBOOK_REGISTRY[playbook_id]["name"],
                        "buy_offset_low": -2.0,
                        "buy_offset_high": 1.0,
                        "stop_loss_pct": 3.0,
                        "target1_pct": 6.5,
                        "target2_pct": 10.0,
                        "position_pct": PLAYBOOK_REGISTRY[playbook_id]["default_position_pct"],
                        "min_rr_ratio": 1.5,
                        "active_version": "v1.0"
                    }

                # 给出针对性修复建议方案
                recommended_proposal = self._generate_repair_proposal(
                    playbook_id=playbook_id,
                    active_params=active_params,
                    attribution_counter=attribution_counter,
                    fail_count=fail_count
                )

                return {
                    "code": 200,
                    "playbook_id": playbook_id or "all",
                    "total_count": total_count,
                    "win_count": win_count,
                    "fail_count": fail_count,
                    "current_win_rate": current_win_rate,
                    "target_win_rate": target_win_rate,
                    "needed_wins_for_70": needed_wins_for_70,
                    "simulated_recovered_count": total_simulated_recovered,
                    "simulated_win_rate": simulated_win_rate,
                    "is_70pct_achieved": (current_win_rate >= 70.0),
                    "attribution_ranking": attribution_ranking,
                    "diagnosed_failures": diagnosed_failures,
                    "active_params": active_params,
                    "recommended_proposal": recommended_proposal
                }

        except Exception as e:
            logger.error(f"穿透归因分析异常: {e}", exc_info=True)
            return {"code": 500, "message": f"穿透归因失败: {str(e)}"}

    def _generate_repair_proposal(
        self,
        playbook_id: Optional[str],
        active_params: Dict[str, Any],
        attribution_counter: Dict[str, int],
        fail_count: int
    ) -> Dict[str, Any]:
        """根据当前主要失误类型，生成直接可应用的调优参数方案"""
        curr_stop = float(active_params.get("stop_loss_pct") or 3.0)
        curr_t1 = float(active_params.get("target1_pct") or 6.5)
        curr_t2 = float(active_params.get("target2_pct") or 10.0)
        curr_pos = float(active_params.get("position_pct") or 25.0)

        # 找最大的失误痛点
        primary_issue = "entry_too_high"
        max_c = -1
        for k, v in attribution_counter.items():
            if v > max_c:
                max_c = v
                primary_issue = k

        # 针对性调参
        new_buy_offset_low = -2.5
        new_buy_offset_high = 0.5
        new_stop = curr_stop
        new_t1 = curr_t1
        new_t2 = curr_t2
        reason_text = "自适应调优"

        if primary_issue == "entry_too_high":
            new_buy_offset_low = -3.5
            new_buy_offset_high = -1.0
            reason_text = f"历史失误中买点过早占比最高({max_c}笔)，将进场区间下移1.5%~2.0%，耐心等待深跌分时筑底低吸"
        elif primary_issue == "stop_loss_too_wide":
            new_stop = max(2.0, round(curr_stop * 0.8, 1))
            reason_text = f"单笔深度亏损过多({max_c}笔)，将硬止损线从 {curr_stop}% 严控至 {new_stop}%，阻断单笔大回撤"
        elif primary_issue == "profit_giveback":
            new_t1 = max(4.0, round(curr_t1 - 1.5, 1))
            reason_text = f"存在冲高获利回吐痛点({max_c}笔)，将第一止盈位前移至 +{new_t1}%，强制执行落袋为安锁定胜率"
        elif primary_issue == "stop_loss_too_tight":
            new_stop = min(4.5, round(curr_stop + 0.8, 1))
            reason_text = f"存在洗盘误杀现象({max_c}笔)，适度拓宽止损缓冲至 {new_stop}%，防主力日内假摔"
        else:
            reason_text = "综合胜率与盈亏比收敛调优，提升买点安全边际"

        return {
            "primary_issue": primary_issue,
            "primary_issue_name": ATTRIBUTION_TYPES.get(primary_issue, {}).get("name", "技术破位"),
            "reason": reason_text,
            "proposed_params": {
                "buy_offset_low": new_buy_offset_low,
                "buy_offset_high": new_buy_offset_high,
                "stop_loss_pct": new_stop,
                "target1_pct": new_t1,
                "target2_pct": new_t2,
                "position_pct": curr_pos,
                "min_rr_ratio": 1.6
            }
        }

    def apply_repair(
        self,
        playbook_id: str,
        trigger_reason: str,
        params_after: Dict[str, Any],
        repair_type: str = "ai_diagnostic",
        operator: str = "AI进化引擎",
        loss_attribution: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        提交一次战法修复：
        1. 获取当前版本与参数快照；
        2. 计算新版本号 (v1.0 -> v1.1 -> v1.2)；
        3. 保存至 playbook_repair_history 进化履历表；
        4. 更新 playbook_custom_params，实现全系统动态热生效！
        """
        from utils.playbook_engine import PLAYBOOK_REGISTRY
        pb_name = PLAYBOOK_REGISTRY.get(playbook_id, {}).get("name", playbook_id)
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()

                # 1. 查询当前参数与履历版本
                cursor.execute("""
                    SELECT version FROM playbook_repair_history
                    WHERE playbook_id = ?
                    ORDER BY id DESC LIMIT 1
                """, (playbook_id,))
                last_hist = cursor.fetchone()

                # 版本号递增
                if last_hist and last_hist["version"]:
                    old_ver = last_hist["version"]
                    try:
                        ver_num = float(old_ver.replace("v", ""))
                        new_ver = f"v{round(ver_num + 0.1, 1)}"
                    except Exception:
                        new_ver = "v1.1"
                else:
                    new_ver = "v1.1"

                # 2. 查询当前战法胜率
                cursor.execute("SELECT win_rate FROM playbook_stats WHERE playbook_id = ?", (playbook_id,))
                stat_row = cursor.fetchone()
                pre_win_rate = stat_row["win_rate"] if stat_row else 50.0

                # 当前旧参数
                old_params = self.get_custom_params(playbook_id) or {}

                # 3. 写入进化履历表
                cursor.execute("""
                    INSERT INTO playbook_repair_history
                    (playbook_id, playbook_name, version, repair_time, repair_type,
                     pre_win_rate, target_win_rate, post_win_rate, trigger_reason,
                     loss_attribution, param_before, param_after, simulated_improvement, operator)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    playbook_id,
                    pb_name,
                    new_ver,
                    now_str,
                    repair_type,
                    pre_win_rate,
                    70.0,
                    None, # 修复后真实跟踪胜率待后续结算填入
                    trigger_reason,
                    loss_attribution or "穿透诊断参数收敛",
                    json.dumps(old_params, ensure_ascii=False),
                    json.dumps(params_after, ensure_ascii=False),
                    "预期调优后买点下移，过滤假突破，目标胜率收敛至 70%+",
                    operator
                ))

                # 4. 更新当前生效参数表 playbook_custom_params (热生效)
                cursor.execute("""
                    INSERT INTO playbook_custom_params
                    (playbook_id, playbook_name, buy_offset_low, buy_offset_high,
                     stop_loss_pct, target1_pct, target2_pct, position_pct, min_rr_ratio,
                     active_version, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(playbook_id) DO UPDATE SET
                        playbook_name = excluded.playbook_name,
                        buy_offset_low = excluded.buy_offset_low,
                        buy_offset_high = excluded.buy_offset_high,
                        stop_loss_pct = excluded.stop_loss_pct,
                        target1_pct = excluded.target1_pct,
                        target2_pct = excluded.target2_pct,
                        position_pct = excluded.position_pct,
                        min_rr_ratio = excluded.min_rr_ratio,
                        active_version = excluded.active_version,
                        updated_at = excluded.updated_at
                """, (
                    playbook_id,
                    pb_name,
                    float(params_after.get("buy_offset_low", 0.0)),
                    float(params_after.get("buy_offset_high", 0.0)),
                    float(params_after.get("stop_loss_pct", 3.0)),
                    float(params_after.get("target1_pct", 6.5)),
                    float(params_after.get("target2_pct", 10.0)),
                    float(params_after.get("position_pct", 25.0)),
                    float(params_after.get("min_rr_ratio", 1.5)),
                    new_ver,
                    now_str
                ))

                conn.commit()

            logger.info(f"✅ 战法 {playbook_id} 成功修复升级至版本 {new_ver}，参数已热加载生效！")
            return {
                "code": 200,
                "message": f"战法修复成功！已升级至 {new_ver} 并热加载生效",
                "version": new_ver,
                "playbook_id": playbook_id,
                "repair_time": now_str,
                "params_after": params_after
            }

        except Exception as e:
            logger.error(f"应用战法修复异常: {e}", exc_info=True)
            return {"code": 500, "message": f"战法修复保存失败: {str(e)}"}

    def get_repair_history(self, playbook_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取战法进化履历时间线 (Changelog)"""
        results = []
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                if playbook_id and playbook_id != "all":
                    cursor.execute("""
                        SELECT * FROM playbook_repair_history
                        WHERE playbook_id = ?
                        ORDER BY id DESC
                    """, (playbook_id,))
                else:
                    cursor.execute("""
                        SELECT * FROM playbook_repair_history
                        ORDER BY id DESC
                    """)

                for row in cursor.fetchall():
                    item = dict(row)
                    try:
                        item["param_before"] = json.loads(item["param_before"]) if item.get("param_before") else {}
                        item["param_after"] = json.loads(item["param_after"]) if item.get("param_after") else {}
                    except Exception:
                        pass
                    results.append(item)
        except Exception as e:
            logger.error(f"查询修复历史失败: {e}")
        return results


# 全局单例
global_attribution_engine = LossAttributionEngine()
