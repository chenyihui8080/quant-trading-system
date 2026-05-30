"""实时行情：A 股（baostock + 新浪）+ 港股/美股（yfinance）"""
import baostock as bs
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta

DATA_DIR = Path(__file__).parent.parent / "data"


def _read_local_csv(symbol: str, count: int = 250) -> list | None:
    """从本地 CSV 读取历史 K 线（回退方案）"""
    csv_path = DATA_DIR / f"{symbol}.csv"
    if not csv_path.exists():
        return None
    try:
        df = pd.read_csv(csv_path)
        result = []
        for _, row in df.iterrows():
            result.append([
                str(row["date"]),
                float(row["open"]),
                float(row["close"]),
                float(row["low"]),
                float(row["high"]),
                float(row["volume"]),
            ])
        return result[-count:] if len(result) > count else result
    except Exception:
        return None


def _to_bs_code(symbol: str) -> str:
    if symbol.startswith(("6", "9")):
        return f"sh.{symbol}"
    return f"sz.{symbol}"


def _to_sina_code(symbol: str) -> str:
    """转换为新浪行情代码"""
    if symbol.startswith(("6", "9")):
        return f"sh{symbol}"
    return f"sz{symbol}"


def _detect_market(symbol: str) -> str:
    """识别市场: a / hk / us"""
    if symbol.endswith(".HK"):
        return "hk"
    if len(symbol) == 6 and symbol.isdigit():
        return "a"
    return "us"


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


def get_yf_kline(symbol: str, period: str = "d", count: int = 250) -> list | None:
    """yfinance K 线数据（港股/美股）"""
    import yfinance as yf

    yf_period_map = {"d": "1y", "w": "2y", "m": "5y", "5": "5d", "15": "1mo", "30": "1mo", "60": "3mo"}
    yf_interval_map = {"d": "1d", "w": "1wk", "m": "1mo", "5": "5m", "15": "15m", "30": "30m", "60": "1h"}

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=yf_period_map.get(period, "1y"),
                            interval=yf_interval_map.get(period, "1d"))
        if df.empty:
            return None

        result = []
        for idx, row in df.iterrows():
            date_str = pd.Timestamp(idx).strftime("%Y-%m-%d")
            result.append([
                date_str,
                float(row["Open"]),
                float(row["Close"]),
                float(row["Low"]),
                float(row["High"]),
                float(row["Volume"]),
            ])
        return result[-count:] if len(result) > count else result
    except Exception:
        return None


def get_realtime_kline(symbol: str, period: str = "d", count: int = 250) -> list:
    """获取 K 线数据（自动识别市场）

    Args:
        symbol: 股票代码，如 '600519' / '0700.HK' / 'AAPL'
        period: d/101=日K, w/102=周K, m/103=月K, 5=5分钟, 15=15分钟, 30=30分钟, 60=60分钟
        count: 获取条数
    Returns:
        list: [[date, open, close, low, high, volume], ...]
    """
    # 兼容东方财富周期格式：101->d, 102->w, 103->m
    period_map = {"101": "d", "102": "w", "103": "m"}
    period = period_map.get(period, period)

    market = _detect_market(symbol)

    # 港股/美股用 yfinance，失败则读本地 CSV
    if market in ("hk", "us"):
        yf_data = get_yf_kline(symbol, period, count)
        if yf_data and len(yf_data) > 0:
            return yf_data[-count:] if len(yf_data) > count else yf_data
        # 回退到本地 CSV（已下载的历史数据）
        csv_data = _read_local_csv(symbol, count)
        if csv_data:
            return csv_data
        return []

    # A 股：优先新浪财经（盘中实时，无T+1延迟）
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
    """新浪财经实时行情（A 股/港股/美股，盘中可用）"""
    market = _detect_market(symbol)
    try:
        if market == "hk":
            return _get_hk_quote(symbol)
        elif market == "us":
            return _get_us_quote(symbol)
        else:
            return _get_a_quote(symbol)
    except Exception:
        return None


def _get_a_quote(symbol: str) -> dict | None:
    """A 股实时行情"""
    sina_code = _to_sina_code(symbol)
    session = requests.Session()
    session.trust_env = False
    url = f"https://hq.sinajs.cn/list={sina_code}"
    headers = {"Referer": "https://finance.sina.com.cn"}
    resp = session.get(url, headers=headers, timeout=5)
    resp.encoding = "gbk"

    text = resp.text
    if "=" not in text or '""' in text:
        return None

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


def _get_hk_quote(symbol: str) -> dict | None:
    """港股实时行情（新浪）"""
    # 0700.HK → rt_hk00700
    code = symbol.replace(".HK", "").zfill(5)
    sina_code = f"rt_hk{code}"

    session = requests.Session()
    session.trust_env = False
    url = f"https://hq.sinajs.cn/list={sina_code}"
    resp = session.get(url, headers={"Referer": "https://finance.sina.com.cn"}, timeout=5)
    resp.encoding = "gbk"

    text = resp.text
    if "=" not in text or '""' in text:
        return None

    data = text.split('"')[1].split(",")
    # 港股字段: name_en, name_cn, open, pre_close, high, low, price, ...
    if len(data) < 15:
        return None

    name = data[1] or data[0]  # 中文名优先
    open_price = float(data[2])
    pre_close = float(data[3])
    high = float(data[4])
    low = float(data[5])
    price = float(data[6])
    volume = float(data[11]) if len(data) > 11 else 0

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
        "updated": data[-2] if len(data) > 15 else "",
        "source": "sina",
    }


def _get_us_quote(symbol: str) -> dict | None:
    """美股实时行情（新浪）"""
    # AAPL → gb_aapl
    sina_code = f"gb_{symbol.lower()}"

    session = requests.Session()
    session.trust_env = False
    url = f"https://hq.sinajs.cn/list={sina_code}"
    resp = session.get(url, headers={"Referer": "https://finance.sina.com.cn"}, timeout=5)
    resp.encoding = "gbk"

    text = resp.text
    if "=" not in text or '""' in text:
        return None

    data = text.split('"')[1].split(",")
    # 美股字段: name, open, pre_close, high, low, price, ...volume=10
    if len(data) < 20:
        return None

    name = data[0]
    open_price = float(data[5]) if data[5] else 0
    pre_close = float(data[26]) if len(data) > 26 and data[26] else 0
    price = float(data[1]) if data[1] else 0
    high = float(data[6]) if data[6] else 0
    low = float(data[7]) if data[7] else 0
    volume = float(data[10]) if len(data) > 10 and data[10] else 0

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
        "updated": "",
        "source": "sina",
    }


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
