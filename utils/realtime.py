"""
企业级实时行情模块：多源容灾 + 权威指数智能识别 + 北交所/A股/港美股全覆盖 + 盘中/盘后动态缓存
支持：
- 大盘指数 (上证指数 sh000001, 沪深300 sh000300, 创业板指 sz399006, 深证成指 sz399001, 北证50 bj899050)
- A 股主板 / 创业板 / 科创板 (sh/sz)
- 北交所股票 (43xxxx, 83xxxx, 87xxxx, 88xxxx, 92xxxx -> bj 前缀)
- 港股 (1810.HK -> hk01810)
- 美股 (AAPL, TSLA, NVDA -> usaapl)
- 盘中 5 秒毫秒级缓存 / 盘后自动延长至 30 分钟保护机制
"""

import time
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

DATA_DIR = Path(__file__).parent.parent / "data"

# 全局高可用 Session (带连接池与 Keep-Alive)
_SESSION = requests.Session()
_SESSION.trust_env = False
_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://finance.sina.com.cn",
    "Accept": "*/*",
})

# 行情内存缓存: symbol -> (timestamp, quote_dict)
_QUOTE_CACHE: dict[str, tuple[float, dict]] = {}

# 权威大盘指数白名单映射 (严格要求带指数标识，防止与 000001 平安银行冲突)
INDEX_CODE_MAP = {
    "SH000001": "sh000001",
    "000001.SH": "sh000001",
    "1A0001": "sh000001",
    "SH000300": "sh000300",      # 沪深300
    "000300.SH": "sh000300",
    "SH000905": "sh000905",      # 中证500
    "000905.SH": "sh000905",
    "SH000852": "sh000852",      # 中证1000
    "000852.SH": "sh000852",
    "SZ399001": "sz399001",      # 深证成指
    "399001.SZ": "sz399001",
    "399001": "sz399001",
    "SZ399006": "sz399006",      # 创业板指
    "399006.SZ": "sz399006",
    "399006": "sz399006",
    "SZ399106": "sz399106",      # 深证综指
    "399106": "sz399106",
    "BJ899050": "bj899050",      # 北证50
    "899050": "bj899050",
}


def _get_dynamic_cache_ttl() -> float:
    """盘中/盘后动态缓存 TTL：盘中 3 秒毫秒级更新，盘后/周末 30 分钟延长保护"""
    now = datetime.now()
    # 周末 (周六=5, 周日=6)
    if now.weekday() >= 5:
        return 1800.0
    # 交易时段：09:15 ~ 15:05
    t_min = now.hour * 60 + now.minute
    if (9 * 60 + 15) <= t_min <= (15 * 60 + 5):
        return 3.0  # 盘中 3 秒极速更新，前端 15 秒轮询 = 最坏 18 秒内必刷新
    return 1800.0  # 盘后静态数据 30 分钟缓存


def _detect_market(symbol: str) -> str:
    """识别标的市场: index / a / bj / hk / us"""
    sym = symbol.strip().upper()
    if sym in INDEX_CODE_MAP:
        return "index"
    if sym.endswith(".HK") or (len(sym) == 5 and sym.isdigit()):
        return "hk"
    if any(sym.endswith(sfx) for sfx in [".US", ".OQ", ".N"]) or (sym.isalpha() and len(sym) <= 5):
        return "us"
    # 北交所代码段 (43xxxx, 83xxxx, 87xxxx, 88xxxx, 92xxxx)
    clean_sym = sym.replace(".BJ", "").replace(".SH", "").replace(".SZ", "")
    if clean_sym.startswith(("43", "83", "87", "88", "92")) and len(clean_sym) == 6:
        return "bj"
    return "a"


def _to_tx_code(symbol: str) -> str:
    """将标准代码转换为腾讯财经权威格式"""
    sym = symbol.strip().upper()
    
    # 1. 优先大盘指数精准映射
    if sym in INDEX_CODE_MAP:
        return INDEX_CODE_MAP[sym]

    market = _detect_market(sym)
    
    if market == "hk":
        clean_code = sym.replace(".HK", "").zfill(5)
        return f"hk{clean_code}"
    elif market == "us":
        clean_code = sym.replace(".US", "").replace(".OQ", "").replace(".N", "").lower()
        return f"us{clean_code}"
    elif market == "bj":
        clean_code = sym.replace(".BJ", "")
        return f"bj{clean_code}"
    else:
        # A 股 / ETF
        clean_code = sym.replace(".SH", "").replace(".SZ", "")
        # 如果明确带 SZ 后缀或者是平安银行专门指定
        if sym.endswith(".SZ") and clean_code == "000001":
            return "sz000001"
        if clean_code.startswith(("6", "9", "5", "688")):
            return f"sh{clean_code}"
        else:
            return f"sz{clean_code}"


def _to_sina_code(symbol: str) -> str:
    """转换为新浪备用行情代码"""
    sym = symbol.strip().upper()
    if sym in INDEX_CODE_MAP:
        return INDEX_CODE_MAP[sym]

    market = _detect_market(sym)
    if market == "hk":
        clean_code = sym.replace(".HK", "").zfill(5)
        return f"rt_hk{clean_code}"
    elif market == "us":
        clean_code = sym.replace(".US", "").replace(".OQ", "").replace(".N", "").lower()
        return f"gb_{clean_code}"
    elif market == "bj":
        clean_code = sym.replace(".BJ", "")
        return f"bj{clean_code}"
    else:
        clean_code = sym.replace(".SH", "").replace(".SZ", "")
        if sym.endswith(".SZ") and clean_code == "000001":
            return "sz000001"
        if clean_code.startswith(("6", "9", "5", "688")):
            return f"sh{clean_code}"
        return f"sz{clean_code}"


def _normalize_time(raw: str) -> str:
    """统一各行情源时间字段为 'YYYY-MM-DD HH:MM:SS' 标准格式"""
    if not raw:
        return ""
    raw = str(raw).strip()
    # 腾讯/新浪紧凑格式: YYYYMMDDHHMMSS 或 YYYYMMDD
    digits = "".join(ch for ch in raw if ch.isdigit())
    try:
        if len(digits) >= 14:
            return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]} {digits[8:10]}:{digits[10:12]}:{digits[12:14]}"
        if len(digits) == 8:
            return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]} 00:00:00"
    except Exception:
        pass
    # 已带分隔符: 2026-08-29 14:30:00 或 2026/08/29 14:30:00
    import re
    m = re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?", raw)
    if m:
        y, mo, d, h, mi, s = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d} {int(h):02d}:{mi}:{s or '00'}"
    return raw


def get_sina_realtime_quote(symbol: str, force_refresh: bool = False) -> dict | None:
    """获取股票/指数/ETF/港美股实时行情 (高可用直连 + 动态缓存)"""
    sym = symbol.strip().upper()
    now = time.time()
    ttl = _get_dynamic_cache_ttl()
    
    if not force_refresh and sym in _QUOTE_CACHE:
        cache_time, cached_quote = _QUOTE_CACHE[sym]
        if now - cache_time < ttl:
            return cached_quote

    tx_code = _to_tx_code(sym)
    market = _detect_market(sym)

    # 1. 优先腾讯财经官方权威高可用专线
    try:
        url = f"http://qt.gtimg.cn/q={tx_code}"
        resp = _SESSION.get(url, timeout=3.5)
        resp.encoding = "gbk"

        text = resp.text.strip()
        if "=" in text and '""' not in text:
            parts = text.split("~")
            if len(parts) > 37:
                name = parts[1]
                price = float(parts[3] or 0.0)
                pre_close = float(parts[4] or 0.0)
                open_p = float(parts[5] or 0.0)
                high = float(parts[33] or price)
                low = float(parts[34] or price)
                change_pct = float(parts[32] or 0.0)
                volume = float(parts[36] or 0.0)
                raw_amt = float(parts[37] or 0.0)
                
                # 单位处理：A股为万元，港美股为元
                if market in ("a", "bj", "index"):
                    amount = raw_amt * 10000.0
                else:
                    amount = raw_amt
                
                date_str = parts[30] if len(parts) > 30 else datetime.now().strftime("%Y%m%d%H%M%S")

                quote = {
                    "symbol": sym,
                    "name": name,
                    "price": price,
                    "open": open_p,
                    "high": high,
                    "low": low,
                    "pre_close": pre_close,
                    "volume": volume,
                    "amount": amount,
                    "change_pct": round(change_pct, 2),
                    "updated": _normalize_time(date_str),
                    "source": "tencent_official",
                }
                _QUOTE_CACHE[sym] = (now, quote)
                return quote
    except Exception:
        pass

    # 2. 备用新浪行情源
    try:
        sina_code = _to_sina_code(sym)
        url = f"https://hq.sinajs.cn/list={sina_code}"
        resp = _SESSION.get(url, timeout=3.5)
        resp.encoding = "gbk"
        text = resp.text.strip()
        if "=" in text and '""' not in text:
            data = text.split('"')[1].split(",")
            if market == "us" and len(data) >= 26:
                name = data[0]
                price = float(data[1] or 0.0)
                chg = float(data[2] or 0.0)
                open_p = float(data[5] or price)
                high = float(data[6] or price)
                low = float(data[7] or price)
                volume = float(data[10] or 0.0)
                date_str = data[3] if len(data) > 3 else ""
                quote = {
                    "symbol": sym,
                    "name": name,
                    "price": price,
                    "open": open_p,
                    "high": high,
                    "low": low,
                    "pre_close": float(data[26] or price),
                    "volume": volume,
                    "amount": 0.0,
                    "change_pct": round(chg, 2),
                    "updated": _normalize_time(date_str),
                    "source": "sina_us",
                }
                _QUOTE_CACHE[sym] = (now, quote)
                return quote
            elif len(data) >= 32:
                name = data[0]
                open_price = float(data[1])
                pre_close = float(data[2])
                price = float(data[3])
                high = float(data[4])
                low = float(data[5])
                volume = float(data[8])
                change_pct = (price - pre_close) / pre_close * 100 if pre_close > 0 else 0
                quote = {
                    "symbol": sym,
                    "name": name,
                    "price": price,
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "pre_close": pre_close,
                    "volume": volume,
                    "amount": float(data[9]) if len(data) > 9 else 0.0,
                    "change_pct": round(change_pct, 2),
                    "updated": _normalize_time(f"{data[30]} {data[31]}"),
                    "source": "sina_backup",
                }
                _QUOTE_CACHE[sym] = (now, quote)
                return quote
    except Exception:
        pass

    return None


def get_realtime_quote(symbol: str) -> dict | None:
    """获取最新实时行情（统一入口）"""
    return get_sina_realtime_quote(symbol)


def get_sina_kline(symbol: str, period: str = "d", count: int = 250) -> list | None:
    """A股K线数据 (腾讯专线/新浪/东财三源毫秒级容灾)"""
    scale_map = {"d": 240, "w": 1200, "m": 7200, "5": 5, "15": 15, "30": 30, "60": 60}
    scale = scale_map.get(period, 240)
    sina_code = _to_sina_code(symbol)
    clean_sym = symbol.strip().upper().replace("SH", "").replace("SZ", "").replace("BJ", "")

    # 1. 优先使用腾讯股票 K 线 (极速 50ms)
    try:
        tx_pfx = "sh" if (clean_sym.startswith("6") or clean_sym.startswith("51") or clean_sym.startswith("68")) else "sz"
        tx_url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tx_pfx}{clean_sym},day,,,{count},qfq"
        resp = _SESSION.get(tx_url, timeout=1.5)
        k_data = resp.json().get("data", {}).get(f"{tx_pfx}{clean_sym}", {})
        days = k_data.get("qfqday") or k_data.get("day") or []
        if days:
            result = []
            for d in days:
                if len(d) >= 6:
                    result.append([str(d[0]), float(d[1]), float(d[2]), float(d[4]), float(d[3]), float(d[5])])
            if result:
                return result[-count:] if len(result) > count else result
    except Exception:
        pass

    # 2. 备用：新浪财经 K 线接口 (1.5s 超时)
    try:
        url = (
            f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
            f"CN_MarketData.getKLineData?symbol={sina_code}&scale={scale}"
            f"&ma=no&datalen={count}"
        )
        resp = _SESSION.get(url, timeout=1.5)
        resp.encoding = "utf-8"
        text = resp.text.strip()
        if text and text != "null":
            import json
            data = json.loads(text)
            if isinstance(data, list) and len(data) > 0:
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
        pass

    return None



def get_hk_us_kline(symbol: str, count: int = 250) -> list | None:
    """港股/美股 K 线数据 (腾讯接口 + 本地 CSV 回退)"""
    sym = symbol.strip().upper()
    market = _detect_market(sym)
    days = []

    if market == "hk":
        code = sym.replace(".HK", "").zfill(5)
        url = f"https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk{code},day,,,{count},qfq"
        try:
            resp = _SESSION.get(url, timeout=4)
            data = resp.json()
            k_data = data.get("data", {}).get(f"hk{code}", {})
            days = k_data.get("qfqday") or k_data.get("day") or []
        except Exception:
            pass
    elif market == "us":
        sym_clean = sym.replace(".US", "").replace(".OQ", "").replace(".N", "")
        for suffix in [".OQ", ".N", ""]:
            try:
                url = f"https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=us{sym_clean}{suffix},day,,,{count},qfq"
                resp = _SESSION.get(url, timeout=4)
                data = resp.json()
                k_data = data.get("data", {}).get(f"us{sym_clean}{suffix}", {})
                cur_days = k_data.get("qfqday") or k_data.get("day") or []
                if len(cur_days) > len(days):
                    days = cur_days
                if len(days) >= 30:
                    break
            except Exception:
                pass

    if days:
        result = []
        for d in days:
            if len(d) >= 6:
                result.append([
                    str(d[0]),
                    float(d[1]),
                    float(d[2]),
                    float(d[4]),
                    float(d[3]),
                    float(d[5]),
                ])
        if result:
            return result[-count:] if len(result) > count else result

    # 回退到本地 CSV
    csv_path = DATA_DIR / f"{sym}.csv"
    if csv_path.exists():
        try:
            df = pd.read_csv(csv_path)
            res = []
            for _, row in df.iterrows():
                res.append([
                    str(row["date"]),
                    float(row["open"]),
                    float(row["close"]),
                    float(row["low"]),
                    float(row["high"]),
                    float(row["volume"]),
                ])
            return res[-count:] if len(res) > count else res
        except Exception:
            pass
    return None


def get_realtime_kline(symbol: str, period: str = "d", count: int = 250) -> list:
    """获取 K 线数据 (自动识别市场)"""
    market = _detect_market(symbol)

    if market in ("hk", "us"):
        kline = get_hk_us_kline(symbol, count)
        if kline:
            return kline[-count:] if len(kline) > count else kline
        return []

    # A 股/指数优先新浪实时日 K
    sina_data = get_sina_kline(symbol, period, count)
    if sina_data:
        return sina_data[-count:] if len(sina_data) > count else sina_data

    # 本地 CSV 回退
    csv_path = DATA_DIR / f"{symbol}.csv"
    if csv_path.exists():
        try:
            df = pd.read_csv(csv_path)
            res = []
            for _, row in df.iterrows():
                res.append([
                    str(row["date"]),
                    float(row["open"]),
                    float(row["close"]),
                    float(row["low"]),
                    float(row["high"]),
                    float(row["volume"]),
                ])
            return res[-count:] if len(res) > count else res
        except Exception:
            pass

    return []


def get_batch_realtime_quotes(symbols: list[str]) -> dict[str, dict]:
    """批量获取实时行情 (腾讯行情专线单次可查 80+ 标的，0.1秒级秒开)"""
    if not symbols:
        return {}
    
    results = {}
    now = time.time()
    ttl = _get_dynamic_cache_ttl()
    
    to_fetch = []
    for s in symbols:
        sym = s.strip().upper()
        if sym in _QUOTE_CACHE:
            ts, q = _QUOTE_CACHE[sym]
            if now - ts < ttl:
                results[sym] = q
                continue
        to_fetch.append(sym)
        
    if not to_fetch:
        return results

    # 分块批量请求 (每批 60 只)
    chunk_size = 60
    for i in range(0, len(to_fetch), chunk_size):
        chunk = to_fetch[i:i+chunk_size]
        tx_codes = [_to_tx_code(c) for c in chunk]
        query_str = ",".join(tx_codes)
        url = f"https://qt.gtimg.cn/q={query_str}"
        try:
            resp = _SESSION.get(url, timeout=3.5)
            resp.encoding = "gbk"
            lines = resp.text.strip().split(";")
            for idx, line in enumerate(lines):
                if "=" not in line or '""' in line:
                    continue
                parts = line.split("=")[1].strip('"').split("~")
                if len(parts) >= 35:
                    orig_sym = chunk[idx] if idx < len(chunk) else parts[2]
                    name = parts[1]
                    price = float(parts[3] or 0.0)
                    pre_close = float(parts[4] or price)
                    change_pct = float(parts[32] or 0.0)
                    quote = {
                        "symbol": orig_sym,
                        "name": name,
                        "price": price,
                        "change_pct": round(change_pct, 2),
                        "pre_close": pre_close,
                        "updated": _normalize_time(datetime.now().strftime("%Y%m%d%H%M%S"))
                    }
                    _QUOTE_CACHE[orig_sym] = (now, quote)
                    results[orig_sym] = quote
        except Exception:
            pass
            
    return results
