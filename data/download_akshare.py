"""下载股票真实行情数据（A 股用 baostock，港股/美股用 yfinance）"""
import os
os.environ["NO_PROXY"] = "*"

import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent


def _detect_market(symbol: str) -> str:
    """识别股票市场：a / hk / us"""
    if symbol.endswith(".HK"):
        return "hk"
    if symbol.endswith((".SS", ".SZ")):
        return "a"
    # 6 位纯数字 = A 股
    if len(symbol) == 6 and symbol.isdigit():
        return "a"
    return "us"


def download_stock(symbol: str, start: str = "2020-01-01", end: str = "2026-12-31"):
    """下载单只股票日线数据（自动识别市场，支持 A股/港股/美股）"""
    market = _detect_market(symbol)
    if market == "a":
        df = _download_a_stock(symbol, start, end)
        if df is None or len(df) == 0:
            df = _download_tx_stock(symbol)
        return df
    else:
        return _download_yf_stock(symbol, start, end)


def _download_a_stock(symbol: str, start: str, end: str):
    """A 股下载（优先 baostock，失败回退腾讯行情）"""
    import baostock as bs

    if symbol.startswith(("6", "9")):
        bs_code = f"sh.{symbol}"
    else:
        bs_code = f"sz.{symbol}"

    print(f"下载 A 股 {symbol} ({bs_code})...", end=" ")
    try:
        bs.login()
        rs = bs.query_history_k_data_plus(
            bs_code,
            "date,open,high,low,close,volume",
            start_date=start, end_date=end,
            frequency="d", adjustflag="2",
        )

        rows = []
        while rs.next():
            rows.append(rs.get_row_data())
        bs.logout()

        if not rows:
            print("baostock无数据，尝试腾讯源...", end=" ")
            return _download_tx_stock(symbol)

        df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = df[col].astype(float)

        save_path = DATA_DIR / f"{symbol}.csv"
        df.to_csv(save_path, index=False)
        print(f"成功 ({len(df)} 条)")
        return df
    except Exception as e:
        print(f"baostock异常({e})，尝试腾讯源...", end=" ")
        return _download_tx_stock(symbol)


def _download_tx_stock(symbol: str, count: int = 1200):
    """腾讯金融日K线下载（港股/美股/A股全市场支持）"""
    import requests
    market = _detect_market(symbol)
    label = "港股" if market == "hk" else ("美股" if market == "us" else "A股")
    print(f"下载 {label} {symbol} (腾讯接口)...", end=" ")

    session = requests.Session()
    session.trust_env = False

    days = []
    if market == "hk":
        code = symbol.replace(".HK", "")
        code_5 = code.zfill(5)
        url = f"https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk{code_5},day,,,{count},qfq"
        try:
            resp = session.get(url, timeout=6)
            data = resp.json()
            k_data = data.get("data", {}).get(f"hk{code_5}", {})
            days = k_data.get("qfqday") or k_data.get("day") or []
        except Exception:
            pass
    elif market == "us":
        sym_clean = symbol.upper()
        for suffix in [".OQ", ".N", ""]:
            try:
                url = f"https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=us{sym_clean}{suffix},day,,,{count},qfq"
                resp = session.get(url, timeout=6)
                data = resp.json()
                k_data = data.get("data", {}).get(f"us{sym_clean}{suffix}", {})
                cur_days = k_data.get("qfqday") or k_data.get("day") or []
                if len(cur_days) > len(days):
                    days = cur_days
                if len(days) >= 30:
                    break
            except Exception:
                pass
    else:
        prefix = "sh" if symbol.startswith(("6", "9")) else "sz"
        url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={prefix}{symbol},day,,,{count},qfq"
        try:
            resp = session.get(url, timeout=6)
            data = resp.json()
            k_data = data.get("data", {}).get(f"{prefix}{symbol}", {})
            days = k_data.get("qfqday") or k_data.get("day") or []
        except Exception:
            pass

    if not days:
        print("无数据")
        return None

    rows = []
    for d in days:
        if len(d) >= 6:
            rows.append({
                "date": str(d[0]),
                "open": float(d[1]),
                "high": float(d[3]),
                "low": float(d[4]),
                "close": float(d[2]),
                "volume": float(d[5]),
            })

    if not rows:
        print("解析数据为空")
        return None

    df = pd.DataFrame(rows)[["date", "open", "high", "low", "close", "volume"]]
    save_path = DATA_DIR / f"{symbol}.csv"
    df.to_csv(save_path, index=False)
    print(f"成功 ({len(df)} 条)")
    return df


def _download_yf_stock(symbol: str, start: str, end: str):
    """港股/美股下载（优先腾讯接口，回退 yfinance）"""
    df = _download_tx_stock(symbol)
    if df is not None and len(df) > 0:
        return df

    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start, end=end)
        if df.empty:
            return None
        df = df.reset_index()
        df = df.rename(columns={"Date": "date", "Open": "open", "High": "high",
                                 "Low": "low", "Close": "close", "Volume": "volume"})
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        df = df[["date", "open", "high", "low", "close", "volume"]]
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = df[col].astype(float)
        save_path = DATA_DIR / f"{symbol}.csv"
        df.to_csv(save_path, index=False)
        return df
    except Exception:
        return None


HOT_STOCKS = [
    "000001",  # 平安银行
    "601318",  # 中国平安
    "600036",  # 招商银行
    "600519",  # 贵州茅台
    "000858",  # 五粮液
    "000568",  # 泸州老窖
    "300750",  # 宁德时代
    "002594",  # 比亚迪
    "601012",  # 隆基绿能
    "002415",  # 海康威视
    "603501",  # 韦尔股份
    "002230",  # 科大讯飞
    "600276",  # 恒瑞医药
    "300760",  # 迈瑞医疗
    "600887",  # 伊利股份
    "000333",  # 美的集团
    "002027",  # 分众传媒
    "300059",  # 东方财富
]


if __name__ == "__main__":
    import sys
    bs.login()
    codes = sys.argv[1:] if len(sys.argv) > 1 else HOT_STOCKS
    success, fail = 0, 0
    for code in codes:
        try:
            download_stock(code)
            success += 1
        except Exception as e:
            print(f"失败: {e}")
            fail += 1
    bs.logout()
    print(f"\n完成: 成功 {success}，失败 {fail}")
