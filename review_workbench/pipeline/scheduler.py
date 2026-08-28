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
            # 任务 1: 每个交易日 15:05 执行 Pipeline A
            self.scheduler.add_job(
                func=self._job_pipeline_a,
                trigger=CronTrigger(hour=15, minute=5, day_of_week="mon-fri"),
                id="review_pipeline_a_1505",
                name="每日 15:05 盘后深度复盘",
                replace_existing=True
            )

            # 任务 2: 每个交易日 08:30 执行 Pipeline B
            self.scheduler.add_job(
                func=self._job_pipeline_b,
                trigger=CronTrigger(hour=8, minute=30, day_of_week="mon-fri"),
                id="review_pipeline_b_0830",
                name="每日 08:30 盘前博弈预案",
                replace_existing=True
            )

            self.scheduler.start()
            self._is_running = True
            logger.info("⏰ [定时调度器] 启动成功！已注册 15:05 盘后复盘与 08:30 盘前预案定时作业")
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
        """15:05 自动化触发 Pipeline A"""
        today = datetime.now().strftime("%Y-%m-%d")
        logger.info(f"⏰ [定时触发] 15:05 自动执行 Pipeline A 盘后复盘 ({today})...")
        try:
            from review_workbench.pipeline.graph import review_pipeline
            review_pipeline.run_pipeline_a(today)
        except Exception as e:
            logger.error(f"15:05 自动盘后复盘执行异常: {e}")

    def _job_pipeline_b(self):
        """08:30 自动化触发 Pipeline B"""
        today = datetime.now().strftime("%Y-%m-%d")
        logger.info(f"⏰ [定时触发] 08:30 自动执行 Pipeline B 盘前预案 ({today})...")
        try:
            from review_workbench.pipeline.graph import review_pipeline
            review_pipeline.run_pipeline_b(today)
        except Exception as e:
            logger.error(f"08:30 自动盘前预案执行异常: {e}")


# 全局单例
review_scheduler = ReviewScheduler()
