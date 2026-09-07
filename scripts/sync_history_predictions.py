"""
历史预测记录真实次日行情核对工具
职责：
1. 严禁向 prediction_records 虚构或机械灌入任何假数据；
2. 仅针对 prediction_records 中现有未完成结算的真实预测记录，抓取其真实的次日行情进行客观核对；
3. 记录次日真实开盘价、收盘价、最高价、最低价，并根据止盈/止损线与涨跌表现综合判定对错。
"""

import asyncio
import logging
import sys
from datetime import date
from pathlib import Path

# 将项目根目录加入模块检索路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.routers.prediction_router import trigger_review, ReviewTrigger

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SyncPredictions")


async def sync_history_predictions():
    """核对真实预测记录的次日行情并结算"""
    logger.info("=" * 60)
    logger.info("🚀 启动真实预测记录次日行情比对与结算引擎...")
    logger.info("=" * 60)

    try:
        # 直接调用核心结算路由，执行严格的多源行情拉取与真实胜率核算
        res = await trigger_review(ReviewTrigger(record_date="all", use_ai=False))
        reviewed_count = res.get("reviewed_count", 0)
        logger.info(f"✅ 真实预测记录比对结算完成，本次成功核对 {reviewed_count} 条记录")
        return res
    except Exception as e:
        logger.error(f"❌ 预测记录结算异常: {e}")
        return {"code": 500, "message": str(e)}


if __name__ == "__main__":
    asyncio.run(sync_history_predictions())
