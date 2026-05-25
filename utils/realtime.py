"""实时行情：baostock（历史K线）+ 新浪财经（盘中实时）"""
import baostock as bs
import requests
from datetime import datetime, timedelta


def _to_bs_code(symbol: str) -> str:
    if symbol.startswith(("6", "9")):
        return f"sh.{symbol}"
    return f"sz.{symbol}"


def _to_sina_code(symbol: str) -> str:
    """转换为新浪行情代码"""
    if symbol.startswith(("6", "9")):
        return f"sh{symbol}"
    return f"sz{symbol}"


def get_sina_kline(symbol: str, period: str = "d", count: int = 250) -> list | None:
    """新浪财经K线数据（盘中实时，无T+1延迟）

    Args:
        symbol: 股票代码
        period: d=日K, w=周K, m=月K, 5/15/30/60=分钟K
        count: 获取条数
    Returns:
        list: [[date, open, close, low, high, volume], ...] 或 None
    """
    # 新浪周期映射: scale 参数
    scale_map = {"d": 240, "w": 1200, "m": 7200, "5": 5, "15": 15, "30": 30, "60": 60}
    scale = scale_map.get(period, 240)

    try:
        sina_code = _to_sina_code(symbol)
        session = requests.Session()
        session.trust_env = False
        url = (
            f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
            f"CN_MarketData.getKLineData?symbol={sina_code}&scale={scale}"
            f"&ma=no&datalen={count}"
        )
        resp = session.get(url, timeout=8, headers={"Referer": "https://finance.sina.com.cn"})
        resp.encoding = "utf-8"

        text = resp.text.strip()
        if not text or text == "null":
            return None

        import json
        data = json.loads(text)
        if not isinstance(data, list) or len(data) == 0:
            return None

        # 转换格式: [date, open, close, low, high, volume]
        result = []
        for item in data:
            result.append([
                item["day"],
                float(item["open"]),
                float(item["close"]),
                float(item["low"]),
                float(item["high"]),
                float(item["volume"]),
            ])

        return result
    except Exception:
        return None


def get_realtime_kline(symbol: str, period: str = "d", count: int = 250) -> list:
    """获取 K 线数据（优先新浪财经实时 → baostock 回退）

    Args:
        symbol: 股票代码，如 '600519'
        period: d/101=日K, w/102=周K, m/103=月K, 5=5分钟, 15=15分钟, 30=30分钟, 60=60分钟
        count: 获取条数
    Returns:
        list: [[date, open, close, low, high, volume], ...]
    """
    # 兼容东方财富周期格式：101->d, 102->w, 103->m
    period_map = {"101": "d", "102": "w", "103": "m"}
    period = period_map.get(period, period)

    # 优先使用新浪财经（盘中实时，无T+1延迟）
    sina_data = get_sina_kline(symbol, period, count)
    if sina_data and len(sina_data) > 0:
        return sina_data[-count:] if len(sina_data) > count else sina_data

    bs_code = _to_bs_code(symbol)
    if period == "d":
        days_back = max(count * 3, 60)
    elif period in ("w", "m"):
        days_back = count * 10
    else:
        days_back = 30
    start = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")

    fields = "date,open,high,low,close,volume"
    if period in ("5", "15", "30", "60"):
        fields = "date,time,open,high,low,close,volume"

    bs.login()
    rs = bs.query_history_k_data_plus(
        bs_code, fields,
        start_date=start, end_date=end,
        frequency=period, adjustflag="2",
    )

    rows = []
    while rs.next():
        rows.append(rs.get_row_data())
    bs.logout()

    result = []
    for row in rows:
        if period in ("5", "15", "30", "60"):
            time_str = row[1]
            if len(time_str) >= 12:
                dt = f"{time_str[:4]}-{time_str[4:6]}-{time_str[6:8]} {time_str[8:10]}:{time_str[10:12]}"
            else:
                dt = row[0]
            result.append([
                dt,
                float(row[2]),
                float(row[5]),
                float(row[4]),
                float(row[3]),
                float(row[6]),
            ])
        else:
            result.append([
                row[0],
                float(row[1]),
                float(row[4]),
                float(row[3]),
                float(row[2]),
                float(row[5]),
            ])

    return result[-count:] if len(result) > count else result


def get_sina_realtime_quote(symbol: str) -> dict | None:
    """新浪财经实时行情（盘中可用，绕过系统代理）"""
    try:
        sina_code = _to_sina_code(symbol)
        session = requests.Session()
        session.trust_env = False  # 绕过系统代理
        url = f"https://hq.sinajs.cn/list={sina_code}"
        headers = {"Referer": "https://finance.sina.com.cn"}
        resp = session.get(url, headers=headers, timeout=5)
        resp.encoding = "gbk"

        text = resp.text
        if "=" not in text or '""' in text:
            return None

        # 解析格式：var hq_str_sh600519="名称,今开,昨收,最新价,最高,最低,..."
        data = text.split('"')[1].split(",")
        if len(data) < 32:
            return None

        name = data[0]
        open_price = float(data[1])
        pre_close = float(data[2])
        price = float(data[3])
        high = float(data[4])
        low = float(data[5])
        volume = float(data[8])
        date_str = data[30]
        time_str = data[31]

        change_pct = (price - pre_close) / pre_close * 100 if pre_close > 0 else 0

        return {
            "symbol": symbol,
            "name": name,
            "price": price,
            "open": open_price,
            "high": high,
            "low": low,
            "pre_close": pre_close,
            "volume": volume,
            "change_pct": round(change_pct, 2),
            "updated": f"{date_str} {time_str}",
            "source": "sina",
        }
    except Exception:
        return None


def get_realtime_quote(symbol: str) -> dict | None:
    """获取最新行情（优先新浪实时 → baostock 回退）"""
    # 优先用新浪财经（盘中实时）
    quote = get_sina_realtime_quote(symbol)
    if quote:
        return quote

    # 回退到 baostock（T+1 延迟）
    kline = get_realtime_kline(symbol, period="d", count=2)
    if not kline:
        return None

    latest = kline[-1]
    prev = kline[-2] if len(kline) > 1 else latest
    pre_close = prev[2] if len(kline) > 1 else latest[1]
    change_pct = (latest[2] - pre_close) / pre_close * 100 if pre_close > 0 else 0

    return {
        "symbol": symbol,
        "name": symbol,
        "price": latest[2],
        "open": latest[1],
        "high": latest[4],
        "low": latest[3],
        "pre_close": pre_close,
        "volume": latest[5],
        "change_pct": round(change_pct, 2),
        "updated": latest[0],
        "source": "baostock",
    }
