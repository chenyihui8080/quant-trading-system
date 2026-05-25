"""下载 A 股真实行情数据（baostock）"""
import os
os.environ["NO_PROXY"] = "*"

import baostock as bs
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent


def download_stock(symbol: str, start: str = "2020-01-01", end: str = "2026-12-31"):
    """下载单只股票日线数据"""
    # 转换代码格式：000001 -> sz.000001, 600519 -> sh.600519
    if symbol.startswith(("6", "9")):
        bs_code = f"sh.{symbol}"
    else:
        bs_code = f"sz.{symbol}"

    print(f"下载 {symbol} ({bs_code})...", end=" ")
    rs = bs.query_history_k_data_plus(
        bs_code,
        "date,open,high,low,close,volume",
        start_date=start,
        end_date=end,
        frequency="d",
        adjustflag="2",  # 前复权
    )

    rows = []
    while rs.next():
        rows.append(rs.get_row_data())

    if not rows:
        print("无数据")
        return None

    df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])
    df["close"] = df["close"].astype(float)
    df["open"] = df["open"].astype(float)
    df["high"] = df["high"].astype(float)
    df["low"] = df["low"].astype(float)
    df["volume"] = df["volume"].astype(float)

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
