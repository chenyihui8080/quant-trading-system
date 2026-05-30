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
    """下载单只股票日线数据（自动识别市场）"""
    market = _detect_market(symbol)
    if market == "a":
        return _download_a_stock(symbol, start, end)
    else:
        return _download_yf_stock(symbol, start, end)


def _download_a_stock(symbol: str, start: str, end: str):
    """A 股下载（baostock）"""
    import baostock as bs

    if symbol.startswith(("6", "9")):
        bs_code = f"sh.{symbol}"
    else:
        bs_code = f"sz.{symbol}"

    print(f"下载 A 股 {symbol} ({bs_code})...", end=" ")
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
        print("无数据")
        return None

    df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)

    save_path = DATA_DIR / f"{symbol}.csv"
    df.to_csv(save_path, index=False)
    print(f"成功 ({len(df)} 条)")
    return df


def _download_yf_stock(symbol: str, start: str, end: str):
    """港股/美股下载（yfinance）"""
    import yfinance as yf

    market = _detect_market(symbol)
    label = "港股" if market == "hk" else "美股"
    print(f"下载 {label} {symbol}...", end=" ")

    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start, end=end)

    if df.empty:
        print("无数据")
        return None

    df = df.reset_index()
    df = df.rename(columns={"Date": "date", "Open": "open", "High": "high",
                             "Low": "low", "Close": "close", "Volume": "volume"})
    # 去掉时区信息，只保留日期
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    df = df[["date", "open", "high", "low", "close", "volume"]]
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)

    save_path = DATA_DIR / f"{symbol}.csv"
    df.to_csv(save_path, index=False)
    print(f"成功 ({len(df)} 条)")
    return df


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
