"""全天候行情数据与交易决策自动同步调度引擎 (Auto Sync Scheduler)

功能：
1. 本地日 K 线数据自动增量查缺补漏 (全市场/持仓/自选)
2. 交易日 14:45:00 尾盘决战全市场自动扫描与卡片预警生成并推送
3. 盘中全自动静默定时更新 (板块资金流向、持仓诊断)
4. 企业级防重复、防穿透、断点续传机制
"""
import logging
import threading
import time
from datetime import datetime, time as dtime
from pathlib import Path
from typing import List, Set, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests

from utils.realtime import get_realtime_kline
from utils.database import get_db

logger = logging.getLogger("auto_sync_scheduler")

DATA_DIR = Path(__file__).parent.parent / "data"
PORTFOLIO_FILE = DATA_DIR / "portfolio.json"

# 核心重点监控与回测基准股票池
CORE_DEFAULT_STOCKS = [
    "600519", "000858", "300750", "601318", "002594",
    "600036", "000001", "601888", "300059", "600900",
    "002475", "002241", "603259", "300760", "688981",
    "000725", "600111", "601899", "512570", "510300"
]


class AutoSyncScheduler:
    """自动同步与尾盘预警调度管理器"""

    def __init__(self):
        self._is_running = False
        self._last_sync_time: Optional[str] = None
        self._sync_stats = {"total": 0, "success": 0, "failed": 0}
        self._lock = threading.Lock()

    def get_sync_status(self) -> dict:
        """获取当前同步状态"""
        return {
            "last_sync_time": self._last_sync_time,
            "stats": self._sync_stats,
            "is_running": self._is_running,
        }

    def sync_single_stock(self, symbol: str) -> bool:
        """针对单只标的执行增量查缺补漏并存入本地 CSV (修复 Bug 18: 统一列顺序)"""
        clean_sym = symbol.split(".")[0] if not symbol.endswith(".HK") else symbol
        csv_path = DATA_DIR / f"{clean_sym}.csv"

        try:
            # 1. 获取最新日 K 线数据 (最新 300 条)
            # get_realtime_kline 返回格式: [date, open, close, low, high, volume]
            raw_kline = get_realtime_kline(clean_sym, period="d", count=300)
            if not raw_kline:
                return False

            # 统一转为标准列序: date, open, high, low, close, volume
            formatted_data = []
            for row in raw_kline:
                if len(row) >= 6:
                    d, o, c, l, h, v = row[0], float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])
                    formatted_data.append({
                        "date": str(d),
                        "open": o,
                        "high": h,
                        "low": l,
                        "close": c,
                        "volume": v
                    })

            if not formatted_data:
                return False

            new_df = pd.DataFrame(formatted_data)[["date", "open", "high", "low", "close", "volume"]]
            new_df = new_df.drop_duplicates(subset=["date"]).sort_values("date")

            # 2. 若本地已有 CSV，进行增量合并去重
            if csv_path.exists():
                try:
                    old_df = pd.read_csv(csv_path)
                    # 确保旧文件列名一致
                    if "high" in old_df.columns and "close" in old_df.columns:
                        old_df = old_df[["date", "open", "high", "low", "close", "volume"]]
                        combined_df = pd.concat([old_df, new_df], ignore_index=True)
                        combined_df = combined_df.drop_duplicates(subset=["date"], keep="last").sort_values("date")
                        combined_df.to_csv(csv_path, index=False)
                        return True
                except Exception:
                    pass

            # 3. 首次创建或重写
            new_df.to_csv(csv_path, index=False)
            return True
        except Exception as e:
            logger.error(f"同步股票 {symbol} 失败: {e}")
            return False

    def sync_all_incremental(self) -> dict:
        """全市场/持仓/自选标的高并发增量查缺补漏"""
        with self._lock:
            start_t = time.time()
            all_symbols = set(CORE_DEFAULT_STOCKS)

            # 1. 自动收集本地已有 CSV 的标的
            for p in DATA_DIR.glob("*.csv"):
                all_symbols.add(p.stem)

            # 2. 自动收集用户实盘持仓与自选池
            if PORTFOLIO_FILE.exists():
                try:
                    import json
                    with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    for k in data.get("positions", {}).keys():
                        all_symbols.add(k)
                    for k in data.get("watchlist", {}).keys():
                        all_symbols.add(k)
                except Exception:
                    pass

            success_cnt = 0
            failed_cnt = 0

            # 多线程并发拉取 (控制在 8 线程内，防券商接口限流)
            with ThreadPoolExecutor(max_workers=8) as executor:
                future_to_sym = {executor.submit(self.sync_single_stock, sym): sym for sym in all_symbols}
                for future in as_completed(future_to_sym):
                    sym = future_to_sym[future]
                    try:
                        ok = future.result()
                        if ok:
                            success_cnt += 1
                        else:
                            failed_cnt += 1
                    except Exception:
                        failed_cnt += 1

            cost_t = round(time.time() - start_t, 2)
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self._last_sync_time = now_str
            self._sync_stats = {
                "total": len(all_symbols),
                "success": success_cnt,
                "failed": failed_cnt,
                "cost_seconds": cost_t
            }

            logger.info(f"✅ 全量数据自动增量查缺补漏完成: 成功 {success_cnt}/{len(all_symbols)}, 耗时 {cost_t}s")
            return self._sync_stats

    def start_scheduler_thread(self):
        """启动后台常驻守护线程"""
        if self._is_running:
            return
        self._is_running = True

        def _worker_loop():
            logger.info("🚀 AutoSyncScheduler 全天候数据同步守护线程已启动")
            last_tail_trigger = ""
            last_close_trigger = ""

            while self._is_running:
                try:
                    now = datetime.now()
                    now_time = now.time()
                    today_str = now.strftime("%Y-%m-%d")
                    is_weekday = now.weekday() < 5

                    # 1. 交易日 14:45:00 尾盘决战自动扫描并生成简报 (修复 Bug 10: 自动推送 Webhook)
                    if is_weekday and dtime(14, 45) <= now_time <= dtime(14, 46):
                        if last_tail_trigger != today_str:
                            last_tail_trigger = today_str
                            logger.info("⏰ 触发交易日 14:45 尾盘决战全市场自动扫描与卡片预警...")
                            try:
                                from utils.alpha_engine import alpha_engine
                                candidates = alpha_engine.scan_all_candidates()
                                card = alpha_engine.generate_webhook_card(candidates)
                                
                                # 自动通过数据库中的 Webhook 配置推送
                                try:
                                    from utils.database import get_db
                                    db = get_db()
                                    cursor = db.cursor()
                                    cursor.execute("SELECT webhook_url FROM notification_configs WHERE is_active = 1")
                                    rows = cursor.fetchall()
                                    for r in rows:
                                        url = r["webhook_url"] if isinstance(r, dict) else r[0]
                                        if url:
                                            requests.post(url, json=card, timeout=5)
                                            logger.info(f"✅ 14:45 尾盘决策卡片已推送至: {url[:30]}...")
                                except Exception as err:
                                    logger.warning(f"14:45 尾盘预警推送跳过: {err}")
                            except Exception as e:
                                logger.error(f"尾盘自动扫描异常: {e}")


                    # 2. 每天 15:05 收盘后自动执行全量日 K 线增量归档
                    if is_weekday and dtime(15, 5) <= now_time <= dtime(15, 8):
                        if last_close_trigger != today_str:
                            last_close_trigger = today_str
                            logger.info("⏰ 触发收盘 15:05 全市场日 K 线增量归档查缺补漏...")
                            try:
                                self.sync_all_incremental()
                            except Exception as e:
                                logger.error(f"收盘自动增量归档异常: {e}")

                    # 3. 盘中交易时间 (9:30~11:30, 13:00~15:00) 每 30 秒静默更新板块资金流向
                    is_trading_hour = (
                        is_weekday
                        and ((dtime(9, 30) <= now_time <= dtime(11, 30)) or (dtime(13, 0) <= now_time <= dtime(15, 0)))
                    )
                    if is_trading_hour:
                        try:
                            from utils.sector_fund_flow import sector_fund_flow_fetcher
                            sector_fund_flow_fetcher.get_sector_flows("industry")
                            sector_fund_flow_fetcher.get_sector_flows("concept")
                        except Exception:
                            pass

                    time.sleep(30)
                except Exception as e:
                    logger.error(f"调度器循环异常: {e}")
                    time.sleep(30)

        t = threading.Thread(target=_worker_loop, daemon=True, name="AutoSyncSchedulerThread")
        t.start()


# 全局单例
auto_sync_scheduler = AutoSyncScheduler()
