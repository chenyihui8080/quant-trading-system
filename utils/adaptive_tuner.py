#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
战法胜率自适应调优引擎 (Playbook Adaptive Tuner)
系统自主进化核心：
1. 每日盘后自动从 prediction.db 读取各战法的真实结算结果；
2. 统计六大战法的胜率、盈亏比、平均收益与单笔最大回撤；
3. 根据实战胜率自动调优各战法的状态 (hot/normal/cooling/frozen) 与推荐仓位；
4. 胜率高的战法加仓放行，回撤大的战法减仓防守甚至冷冻，实现完全数据驱动的自我迭代。
"""

import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from utils.playbook_engine import PLAYBOOK_REGISTRY

logger = logging.getLogger("AdaptiveTuner")

# 默认数据库路径
DB_PATH = Path("data/prediction.db")


class PlaybookAdaptiveTuner:
    """战法胜率自适应调优引擎"""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DB_PATH
        self._ensure_table()

    def _get_connection(self) -> sqlite3.Connection:
        """获取 SQLite 连接并配置 WAL 模式防死锁"""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=20.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _ensure_table(self):
        """确保战法统计表 playbook_stats 存在，并安全兼容升级主预测表字段"""
        try:
            with self._get_connection() as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS playbook_stats (
                        playbook_id TEXT PRIMARY KEY,
                        playbook_name TEXT,
                        total_count INTEGER DEFAULT 0,
                        win_count INTEGER DEFAULT 0,
                        win_rate REAL DEFAULT 0.0,
                        avg_profit_pct REAL DEFAULT 0.0,
                        avg_loss_pct REAL DEFAULT 0.0,
                        realized_rr REAL DEFAULT 0.0,
                        max_drawdown REAL DEFAULT 0.0,
                        adaptive_status TEXT DEFAULT 'normal',
                        adaptive_position_pct REAL,
                        adaptive_rr_threshold REAL,
                        last_updated TEXT
                    )
                """)
                # 兼容升级主预测表字段
                cols = [
                    ("playbook_id", "TEXT"),
                    ("playbook_name", "TEXT"),
                    ("playbook_params", "TEXT"),
                    ("is_auto_generated", "INTEGER DEFAULT 0"),
                    ("actual_max_profit", "REAL"),
                    ("actual_max_loss", "REAL")
                ]
                for col_name, col_type in cols:
                    try:
                        conn.execute(f"ALTER TABLE prediction_records ADD COLUMN {col_name} {col_type};")
                    except Exception:
                        pass
                conn.commit()
        except Exception as e:
            logger.error(f"初始化/升级表结构异常: {e}")

    def run_tuning(self) -> Dict[str, Any]:
        """
        执行一轮全自动自适应调优循环：
        1. 读取 prediction_records 中所有已完成对账结算的预测记录；
        2. 按 playbook_id 分组计算统计指标；
        3. 应用自适应状态机与仓位自适应算法；
        4. 保存调优结果至 playbook_stats。
        """
        logger.info("🔄 [自适应调优] 开始执行战法胜率自适应调优计算...")
        tuning_results = {}
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            with self._get_connection() as conn:
                # 针对六大战法分别统计已复盘的记录
                for pb_id, pb_meta in PLAYBOOK_REGISTRY.items():
                    cursor = conn.cursor()
                    # 匹配 playbook_id 或 tags/reason 包含战法短名的记录
                    cursor.execute("""
                        SELECT is_correct, profit_pct, actual_max_profit, actual_max_loss
                        FROM prediction_records
                        WHERE (playbook_id = ? OR tags LIKE ? OR reason LIKE ?)
                          AND is_correct IS NOT NULL
                    """, (pb_id, f"%{pb_meta['short_name']}%", f"%{pb_meta['short_name']}%"))
                    records = cursor.fetchall()

                    total_count = len(records)
                    win_count = 0
                    profits = []
                    losses = []
                    max_drawdown = 0.0

                    for r in records:
                        is_corr = r["is_correct"]
                        pct = r["profit_pct"] if r["profit_pct"] is not None else 0.0
                        loss = r["actual_max_loss"] if r["actual_max_loss"] is not None else 0.0

                        if is_corr == 1 or pct > 0:
                            win_count += 1
                            profits.append(pct)
                        else:
                            losses.append(abs(pct))

                        if loss and loss < max_drawdown:
                            max_drawdown = loss

                    # 指标计算
                    win_rate = round((win_count / total_count) * 100.0, 1) if total_count > 0 else 50.0
                    avg_profit = round(sum(profits) / len(profits), 2) if profits else 0.0
                    avg_loss = round(sum(losses) / len(losses), 2) if losses else 0.0
                    realized_rr = round(avg_profit / max(avg_loss, 0.01), 2) if avg_loss > 0 else (2.0 if profits else 1.5)

                    default_pos = pb_meta["default_position_pct"]

                    # 自适应状态机推演
                    if total_count < 3:
                        # 样本量过少，冷启动观察期
                        adaptive_status = "normal"
                        adaptive_pos = default_pos
                        adaptive_rr = 1.5
                        status_label = "⚖️ 样本积累中 (正常)"
                    elif win_rate >= 65.0:
                        # 胜率极高，设为主力推荐战法，仓位上调 1.25 倍 (上限 40%)
                        adaptive_status = "hot"
                        adaptive_pos = min(40.0, round(default_pos * 1.25, 1))
                        adaptive_rr = 1.3 # 宽容门槛，加大选股放行
                        status_label = "🔥 主力推荐 (加仓)"
                    elif win_rate >= 45.0:
                        # 胜率正常
                        adaptive_status = "normal"
                        adaptive_pos = default_pos
                        adaptive_rr = 1.5
                        status_label = "⚖️ 稳定运行 (基准)"
                    elif win_rate >= 30.0:
                        # 胜率处于逆风期，降仓防守，提高门槛
                        adaptive_status = "cooling"
                        adaptive_pos = round(default_pos * 0.5, 1)
                        adaptive_rr = 2.0 # 提高最低盈亏比门槛
                        status_label = "⚠️ 逆风防守 (减半)"
                    else:
                        # 胜率极低 (<30%)，战法进入冷冻期
                        adaptive_status = "frozen"
                        adaptive_pos = 0.0
                        adaptive_rr = 2.5
                        status_label = "❄️ 战法冷冻 (暂停)"

                    # 写入或更新 playbook_stats
                    conn.execute("""
                        INSERT INTO playbook_stats
                        (playbook_id, playbook_name, total_count, win_count, win_rate, 
                         avg_profit_pct, avg_loss_pct, realized_rr, max_drawdown, 
                         adaptive_status, adaptive_position_pct, adaptive_rr_threshold, last_updated)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(playbook_id) DO UPDATE SET
                            playbook_name = excluded.playbook_name,
                            total_count = excluded.total_count,
                            win_count = excluded.win_count,
                            win_rate = excluded.win_rate,
                            avg_profit_pct = excluded.avg_profit_pct,
                            avg_loss_pct = excluded.avg_loss_pct,
                            realized_rr = excluded.realized_rr,
                            max_drawdown = excluded.max_drawdown,
                            adaptive_status = excluded.adaptive_status,
                            adaptive_position_pct = excluded.adaptive_position_pct,
                            adaptive_rr_threshold = excluded.adaptive_rr_threshold,
                            last_updated = excluded.last_updated
                    """, (
                        pb_id,
                        pb_meta["name"],
                        total_count,
                        win_count,
                        win_rate,
                        avg_profit,
                        avg_loss,
                        realized_rr,
                        abs(max_drawdown),
                        adaptive_status,
                        adaptive_pos,
                        adaptive_rr,
                        now_str
                    ))

                    tuning_results[pb_id] = {
                        "playbook_id": pb_id,
                        "playbook_name": pb_meta["name"],
                        "total_count": total_count,
                        "win_count": win_count,
                        "win_rate": win_rate,
                        "avg_profit_pct": avg_profit,
                        "avg_loss_pct": avg_loss,
                        "realized_rr": realized_rr,
                        "max_drawdown": abs(max_drawdown),
                        "adaptive_status": adaptive_status,
                        "status_label": status_label,
                        "adaptive_position_pct": adaptive_pos,
                        "adaptive_rr_threshold": adaptive_rr,
                        "last_updated": now_str
                    }

                conn.commit()

            logger.info("✅ [自适应调优] 六大战法自适应参数更新完毕，飞轮自学习闭环完成！")
            return {"code": 200, "message": "战法胜率自适应调优完成", "data": tuning_results}

        except Exception as e:
            logger.error(f"自适应调优执行失败: {e}", exc_info=True)
            return {"code": 500, "message": f"调优异常: {str(e)}", "data": {}}

    def get_all_stats(self) -> List[Dict[str, Any]]:
        """获取所有战法的最新胜率统计与自适应状态"""
        results = []
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT * FROM playbook_stats ORDER BY win_rate DESC, total_count DESC
                """)
                rows = cursor.fetchall()
                for row in rows:
                    results.append(dict(row))
        except Exception as e:
            logger.error(f"查询战法统计失败: {e}")

        # 如果表内尚无数据，初始化默认六大战法
        if not results:
            for pb_id, pb_meta in PLAYBOOK_REGISTRY.items():
                results.append({
                    "playbook_id": pb_id,
                    "playbook_name": pb_meta["name"],
                    "total_count": 0,
                    "win_count": 0,
                    "win_rate": 50.0,
                    "avg_profit_pct": 0.0,
                    "avg_loss_pct": 0.0,
                    "realized_rr": 1.5,
                    "max_drawdown": 0.0,
                    "adaptive_status": "normal",
                    "adaptive_position_pct": pb_meta["default_position_pct"],
                    "adaptive_rr_threshold": 1.5,
                    "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                })
        return results

    def get_stat(self, playbook_id: str) -> Optional[Dict[str, Any]]:
        """获取单个战法的自适应配置"""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM playbook_stats WHERE playbook_id = ?", (playbook_id,))
                row = cursor.fetchone()
                if row:
                    return dict(row)
        except Exception as e:
            logger.error(f"查询战法 {playbook_id} 统计失败: {e}")
            
        if playbook_id in PLAYBOOK_REGISTRY:
            pb_meta = PLAYBOOK_REGISTRY[playbook_id]
            return {
                "playbook_id": playbook_id,
                "playbook_name": pb_meta["name"],
                "total_count": 0,
                "win_count": 0,
                "win_rate": 50.0,
                "adaptive_status": "normal",
                "adaptive_position_pct": pb_meta["default_position_pct"],
                "adaptive_rr_threshold": 1.5,
            }
        return None


# 全局单例调优器实例
global_adaptive_tuner = PlaybookAdaptiveTuner()
