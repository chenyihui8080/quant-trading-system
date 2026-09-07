"""
复盘工作台自动化调度器 (APScheduler Engine)
职责：
1. 每天 15:05 定时触发 Pipeline A (盘后深度复盘工作流，15:20 前就绪)
2. 交易日 08:30 定时触发 Pipeline B (盘前博弈预案流水线，09:15 集合竞价前就绪)
3. 支持独立启动与主系统生命周期绑定
"""

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger("ReviewScheduler")

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    HAS_APSCHEDULER = True
except ImportError:
    HAS_APSCHEDULER = False
    logger.warning("未安装 apscheduler，定时调度将处于待机状态，可通过 pip install apscheduler 启用")


class ReviewScheduler:
    """复盘定时调度器"""

    def __init__(self):
        self.scheduler = BackgroundScheduler() if HAS_APSCHEDULER else None
        self._is_running = False

    def start(self):
        """启动定时调度任务"""
        if not HAS_APSCHEDULER or not self.scheduler:
            logger.warning("APScheduler 未就绪，跳过调度器启动")
            return

        if self._is_running:
            logger.info("调度器已在运行中")
            return

        try:
            # 任务 1: 每个交易日 14:45 执行尾盘决战选股决策并自动录入预测日记
            self.scheduler.add_job(
                func=self._job_pipeline_tail_alpha,
                trigger=CronTrigger(hour=14, minute=45, day_of_week="mon-fri"),
                id="alpha_pipeline_scan_1445",
                name="每日 14:45 尾盘选股决策与预测入库",
                replace_existing=True
            )

            # 任务 2: 每个交易日 15:05 执行 Pipeline A (盘后深度复盘与前日预测次日自动比对)
            self.scheduler.add_job(
                func=self._job_pipeline_a,
                trigger=CronTrigger(hour=15, minute=5, day_of_week="mon-fri"),
                id="review_pipeline_a_1505",
                name="每日 15:05 盘后深度复盘与打脸对账",
                replace_existing=True
            )

            # 任务 3: 每个交易日 08:30 执行 Pipeline B
            self.scheduler.add_job(
                func=self._job_pipeline_b,
                trigger=CronTrigger(hour=8, minute=30, day_of_week="mon-fri"),
                id="review_pipeline_b_0830",
                name="每日 08:30 盘前博弈预案",
                replace_existing=True
            )

            self.scheduler.start()
            self._is_running = True
            logger.info("⏰ [定时调度器] 启动成功！已注册 08:30 盘前预案、14:45 尾盘选股入库与 15:05 盘后对账定时作业")
        except Exception as e:
            logger.error(f"启动定时调度器异常: {e}")


    def stop(self):
        """停止调度"""
        if self.scheduler and self._is_running:
            self.scheduler.shutdown()
            self._is_running = False
            logger.info("定时调度器已停止")

    def get_status(self) -> dict:
        """获取调度器当前状态"""
        jobs = []
        if self.scheduler and self._is_running:
            for j in self.scheduler.get_jobs():
                jobs.append({
                    "id": j.id,
                    "name": j.name,
                    "next_run_time": str(j.next_run_time) if j.next_run_time else None
                })
        return {
            "is_running": self._is_running,
            "jobs_count": len(jobs),
            "jobs": jobs
        }

    def _job_pipeline_a(self):
        """15:05 自动化触发 Pipeline A 盘后复盘及前日预测次日自动比对"""
        today = datetime.now().strftime("%Y-%m-%d")
        logger.info(f"⏰ [定时触发] 15:05 自动执行 Pipeline A 盘后复盘与预测次日比对 ({today})...")
        try:
            from review_workbench.pipeline.graph import review_pipeline
            review_pipeline.run_pipeline_a(today)
            logger.info("✅ 15:05 Pipeline A 盘后复盘执行完成")
        except Exception as e:
            logger.error(f"15:05 自动盘后复盘执行异常: {e}")

        # 同步触发历史及昨日真实预测记录的次日收盘行情比对与结算核算
        try:
            from api.routers.prediction_router import trigger_review, ReviewTrigger
            import asyncio
            # 自动针对所有到期的未结算预测单执行真实行情比对
            asyncio.run(trigger_review(ReviewTrigger(record_date="all", use_ai=False)))
            logger.info("✅ 15:05 历史及前日预测记录次日真实行情比对结算完成")
        except Exception as pe:
            logger.error(f"15:05 预测记录次日真实行情比对结算异常: {pe}")

    def _job_pipeline_tail_alpha(self):
        """14:45 自动化执行尾盘全市场 Alpha 规则选股并将建议标的自动录入待结算预测日记"""
        today = datetime.now().strftime("%Y-%m-%d")
        logger.info(f"⏰ [定时触发] 14:45 自动执行尾盘全市场选股与预测入库 ({today})...")
        try:
            from api.routers.alpha_router import scan_alpha_candidates
            scan_res = scan_alpha_candidates()
            results = scan_res.get("results", []) if isinstance(scan_res, dict) else []
            
            import sqlite3
            from pathlib import Path
            db_path = Path("data/prediction.db")
            if db_path.exists() and results:
                with sqlite3.connect(str(db_path), timeout=15.0) as conn:
                    conn.execute("PRAGMA journal_mode=WAL")
                    conn.execute("PRAGMA busy_timeout=5000")
                    cursor = conn.cursor()
                    for r in results:
                        # 检查今日该股票是否已入库
                        cursor.execute("SELECT id FROM prediction_records WHERE record_date=? AND stock_code=?", (today, r["symbol"]))
                        if not cursor.fetchone():
                            cursor.execute("""
                                INSERT INTO prediction_records
                                (record_date, stock_code, stock_name, direction, entry_price, target_price, shares, confidence, reason, tags, is_correct, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
                            """, (
                                today,
                                r["symbol"],
                                r["name"],
                                "buy",
                                float(r.get("current_price", 0)),
                                float(r.get("target_price_1", 0)),
                                int(r.get("recommended_shares", 1000)),
                                5,
                                r.get("reason", "14:45 尾盘选股决策自动入库"),
                                ",".join(r.get("triggered_rules", ["尾盘选股", "均线多头"]))
                            ))
                    conn.commit()

            logger.info(f"✅ 14:45 尾盘选股完成，已自动建档入库 {len(results)} 只待结算标的")
        except Exception as e:
            logger.error(f"14:45 自动选股与建档异常: {e}")

    def _job_pipeline_b(self):
        """08:30 自动化触发 Pipeline B 盘前预案，并自动精选盘前进攻标的录入预测日记"""
        today = datetime.now().strftime("%Y-%m-%d")
        logger.info(f"⏰ [定时触发] 08:30 自动执行 Pipeline B 盘前预案与标的建档 ({today})...")
        try:
            from review_workbench.pipeline.graph import review_pipeline
            plan = review_pipeline.run_pipeline_b(today)
            
            # 严选量化高胜率标的录入预测日记（禁止无脑抓取观察池导致盲目接盘）
            from api.routers.alpha_router import scan_alpha_candidates
            scan_res = scan_alpha_candidates()
            raw_candidates = scan_res.get("results", []) if isinstance(scan_res, dict) else []
            # 过滤掉涨幅过高（>6%）追高风险品种与极小盘股，精选前2只
            filtered_results = [
                c for c in raw_candidates 
                if 1.0 <= float(c.get("change_pct", 0)) <= 6.0 and float(c.get("current_price", 0)) > 2.0
            ]
            results = filtered_results[:2]

            import sqlite3
            from pathlib import Path
            db_path = Path("data/prediction.db")
            if db_path.exists() and results:
                with sqlite3.connect(str(db_path), timeout=15.0) as conn:
                    conn.execute("PRAGMA journal_mode=WAL")
                    cursor = conn.cursor()
                    for r in results[:3]:
                        cursor.execute("SELECT id FROM prediction_records WHERE record_date=? AND stock_code=?", (today, r["symbol"]))
                        if not cursor.fetchone():
                            cursor.execute("""
                                INSERT INTO prediction_records
                                (record_date, stock_code, stock_name, direction, entry_price, target_price, shares, confidence, reason, tags, is_correct, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                            """, (
                                today,
                                r["symbol"],
                                r["name"],
                                "buy",
                                float(r.get("current_price", 0)),
                                float(r.get("target_price_1", 0)),
                                int(r.get("recommended_shares", 1000)),
                                5,
                                r.get("reason", "08:30 盘前预案精选标的自动入库"),
                                ",".join(r.get("triggered_rules", ["盘前预案", "开盘前精选"])),
                                f"{today} 08:30:00"
                            ))
                    conn.commit()

            logger.info("✅ 08:30 Pipeline B 盘前预案执行与标的自动建档完成")
        except Exception as e:
            logger.error(f"08:30 自动盘前预案执行异常: {e}")


    def trigger_test_run(self):
        """即时触发一次定时任务全流程测试"""
        logger.info("🧪 开始手动触发定时任务全流程测试...")
        self._job_pipeline_a()
        return {"code": 200, "message": "定时任务已即时触发执行"}


# 全局单例
review_scheduler = ReviewScheduler()
