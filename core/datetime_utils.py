"""
全局统一时间与时区工具类 (阿里规范与 ISO-8601 标准)
解决 A-TIME-001: 消除本地时间、无时区 naive datetime 与 UTC 时间混用问题
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

# 默认东八区北京时间 (Asia/Shanghai)
BEIJING_TZ = timezone(timedelta(hours=8))

def get_current_beijing_time() -> datetime:
    """获取当前东八区(北京时间)带时区的 datetime 对象"""
    return datetime.now(BEIJING_TZ)

def get_current_iso_time() -> str:
    """获取当前北京时间的标准 ISO 8601 字符串 (如: 2026-08-31T11:45:00+08:00)"""
    return get_current_beijing_time().isoformat()

def get_current_date_str() -> str:
    """获取当前北京时间日期字符串 (YYYY-MM-DD)"""
    return get_current_beijing_time().strftime("%Y-%m-%d")

def format_timestamp(dt: Optional[datetime] = None) -> str:
    """格式化标准展示时间 (YYYY-MM-DD HH:MM:SS)"""
    if dt is None:
        dt = get_current_beijing_time()
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=BEIJING_TZ)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def normalize_exchange_time(time_str: str) -> dict:
    """
    规范化行情源时间，显式区分交易所时间、采集时间与本地时间
    :param time_str: 原始行情时间字符串 (如 '20260828120524' 或 '2026-08-28 09:42:56')
    :return: 包含 exchange_time, collected_at, local_time 的字典
    """
    collected_at = get_current_iso_time()
    cleaned = str(time_str).strip().replace("/", "-")
    
    # 格式1: YYYYMMDDHHMMSS (14位)
    if len(cleaned) == 14 and cleaned.isdigit():
        exchange_time = f"{cleaned[:4]}-{cleaned[4:6]}-{cleaned[6:8]} {cleaned[8:10]}:{cleaned[10:12]}:{cleaned[12:14]}"
    # 格式2: YYYY-MM-DD HH:MM:SS
    elif len(cleaned) >= 19 and cleaned[4] == "-" and cleaned[7] == "-":
        exchange_time = cleaned[:19]
    else:
        exchange_time = cleaned or format_timestamp()

    return {
        "exchange_time": exchange_time,
        "collected_at": collected_at,
        "timezone": "Asia/Shanghai (UTC+8)"
    }
