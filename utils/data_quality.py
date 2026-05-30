"""数据质量检测模块"""
import pandas as pd
import numpy as np
from pathlib import Path


def check_data_quality(filepath: str | Path) -> dict:
    """检测 CSV 数据质量

    Returns:
        {
            "symbol": str, "rows": int, "columns": list,
            "date_range": [start, end],
            "issues": [{"type": str, "message": str, "count": int}],
            "score": float,  # 0-100
        }
    """
    df = pd.read_csv(filepath)
    issues = []
    symbol = Path(filepath).stem

    # 1. 基本信息
    if "date" not in df.columns:
        issues.append({"type": "critical", "message": "缺少 date 列", "count": 0})
        return {"symbol": symbol, "rows": len(df), "columns": list(df.columns), "issues": issues, "score": 0}

    # 2. 缺失值检测
    null_counts = df.isnull().sum()
    for col in df.columns:
        cnt = int(null_counts[col])
        if cnt > 0:
            pct = round(cnt / len(df) * 100, 2)
            issues.append({"type": "warning", "message": f"{col} 有 {cnt} 个缺失值 ({pct}%)", "count": cnt})

    # 3. 日期连续性检测
    df["date"] = pd.to_datetime(df["date"])
    date_diff = df["date"].diff().dt.days
    gaps = date_diff[date_diff > 3]  # 超过3天视为间隔
    if len(gaps) > 0:
        issues.append({"type": "warning", "message": f"日期间隔超过3天的位置有 {len(gaps)} 处", "count": len(gaps)})

    # 4. 异常值检测（价格为0或负数）
    for col in ["open", "high", "low", "close"]:
        if col in df.columns:
            bad = (df[col] <= 0).sum()
            if bad > 0:
                issues.append({"type": "critical", "message": f"{col} 存在 {bad} 个非正价格", "count": int(bad)})

    # 5. OHLC 逻辑检测
    if all(c in df.columns for c in ["open", "high", "low", "close"]):
        invalid_hl = (df["high"] < df["low"]).sum()
        if invalid_hl > 0:
            issues.append({"type": "critical", "message": f"high < low 的异常行有 {invalid_hl} 条", "count": int(invalid_hl)})
        invalid_range = ((df["close"] > df["high"]) | (df["close"] < df["low"])).sum()
        if invalid_range > 0:
            issues.append({"type": "warning", "message": f"close 超出 high-low 范围的行有 {invalid_range} 条", "count": int(invalid_range)})

    # 6. 涨跌停检测（单日涨跌幅超过 11%）
    if "close" in df.columns and len(df) > 1:
        returns = df["close"].pct_change().abs() * 100
        limit_hits = (returns > 11).sum()
        if limit_hits > 0:
            issues.append({"type": "info", "message": f"单日涨跌幅超过 11% 的天数: {limit_hits}", "count": int(limit_hits)})

    # 7. 成交量检测
    if "volume" in df.columns:
        zero_vol = (df["volume"] == 0).sum()
        if zero_vol > 0:
            issues.append({"type": "warning", "message": f"成交量为0的天数（可能停牌）: {zero_vol}", "count": int(zero_vol)})

    # 8. 重复行检测
    dupes = df.duplicated(subset=["date"]).sum()
    if dupes > 0:
        issues.append({"type": "critical", "message": f"重复日期行: {dupes}", "count": int(dupes)})

    # 计算质量得分
    score = 100
    for issue in issues:
        if issue["type"] == "critical":
            score -= 20
        elif issue["type"] == "warning":
            score -= 5
        elif issue["type"] == "info":
            score -= 1
    score = max(0, score)

    return {
        "symbol": symbol,
        "rows": len(df),
        "columns": list(df.columns),
        "date_range": [str(df["date"].min().date()), str(df["date"].max().date())],
        "issues": issues,
        "score": score,
    }


def check_all_data(data_dir: str | Path) -> list[dict]:
    """检测目录下所有 CSV 数据质量"""
    results = []
    for f in sorted(Path(data_dir).glob("*.csv")):
        if f.name.startswith(("_", "download")):
            continue
        try:
            results.append(check_data_quality(f))
        except Exception as e:
            results.append({"symbol": f.stem, "rows": 0, "issues": [{"type": "critical", "message": str(e), "count": 0}], "score": 0})
    return results
