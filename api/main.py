"""FastAPI 管理接口"""
import importlib
import time as _time
from datetime import datetime
from typing import Optional
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from vnpy_ctastrategy.backtesting import BacktestingEngine
from vnpy.trader.constant import Interval

from config.settings import STRATEGIES, BACKTEST_CONFIG, DATA_DIR
from utils.data_generator import generate_random_bars, load_csv_bars
from utils.comparison import compare_strategies, optimize_strategy
from utils.realtime import get_realtime_quote, get_realtime_kline
from utils.factors import list_factors, compute_factors, top_factors_score
from utils.order_manager import order_manager, Direction, Offset, OrderStatus
from utils.push_notifier import notifier, send_price_alert, PushConfig
from utils.database import (
    init_db, save_backtest, get_backtest_history, get_backtest_by_id,
    save_order, get_order_history, save_factor_ranking, get_factor_history,
    log_audit, get_audit_log,
)
from utils.auth import (
    hash_password, verify_password, create_token,
    get_current_user, get_optional_user, require_admin, init_admin_user,
)
from strategies.base import RiskStrategy
from api.websocket import manager as ws_manager, market_push_loop

import asyncio
import json

# ---- 数据缓存 ----
_csv_cache: dict[str, tuple[float, list]] = {}  # symbol -> (timestamp, bars)
_CSV_CACHE_TTL = 300  # 5 分钟缓存
_html_cache: str = ""  # 模板缓存


def _load_csv_cached(symbol: str):
    """带缓存的 CSV 数据加载"""
    now = _time.time()
    cached = _csv_cache.get(symbol)
    if cached and now - cached[0] < _CSV_CACHE_TTL:
        return cached[1]
    bars = load_csv_bars(symbol)
    _csv_cache[symbol] = (now, bars)
    return bars


def _auto_update_data():
    """启动时自动检查并更新过期的股票数据"""
    import csv
    from datetime import datetime, timedelta
    data_dir = DATA_DIR
    if not data_dir.exists():
        return

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    updated_count = 0

    try:
        import baostock as bs
        bs.login()

        for f in sorted(data_dir.glob("*.csv")):
            if f.name.startswith(("_", "download")):
                continue
            symbol = f.stem
            # 跳过非A股（港股/美股等）
            if "." in symbol or not symbol.isdigit():
                continue
            # 读取最后一行日期
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    lines = fh.readlines()
                    if len(lines) < 2:
                        continue
                    last_line = lines[-1].strip()
                    last_date = last_line.split(",")[0]
            except Exception:
                continue

            # 如果数据已是昨天或更新，跳过
            if last_date >= yesterday:
                continue

            # 下载缺失数据
            bs_symbol = f"sh.{symbol}" if symbol.startswith("6") else f"sz.{symbol}"
            start = (datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
            rs = bs.query_history_k_data_plus(
                bs_symbol, "date,open,high,low,close,volume",
                start_date=start, end_date=today,
                frequency="d", adjustflag="2",
            )
            new_rows = []
            while rs.next():
                row = rs.get_row_data()
                if row[1] and row[2]:  # 有数据
                    new_rows.append(row)

            if new_rows:
                with open(f, "a", encoding="utf-8", newline="") as fh:
                    writer = csv.writer(fh)
                    for row in new_rows:
                        writer.writerow(row)
                updated_count += 1
                print(f"[自动更新] {symbol}: 追加 {len(new_rows)} 条数据 ({start} ~ {today})")

        bs.logout()
    except Exception as e:
        print(f"[自动更新] 失败: {e}")

    if updated_count > 0:
        print(f"[自动更新] 共更新 {updated_count} 只股票数据")
    else:
        print("[自动更新] 所有数据已是最新")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：初始化数据库 + 启动后台任务 + 缓存模板"""
    global _html_cache
    init_db()
    init_admin_user()
    _html_cache = (TEMPLATE_DIR / "index.html").read_text(encoding="utf-8")
    # 启动时自动更新数据
    try:
        await asyncio.to_thread(_auto_update_data)
    except Exception as e:
        print(f"[自动更新] 启动更新失败: {e}")
    ws_task = asyncio.create_task(market_push_loop())
    eval_task = asyncio.create_task(daily_evaluate_loop())
    yield
    ws_task.cancel()
    eval_task.cancel()


async def daily_evaluate_loop():
    """每日自动评估策略 + 更新数据（收盘后 15:05 / 16:00）"""
    import time as _time
    last_run = ""
    data_updated = ""
    while True:
        try:
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            # 工作日 15:05 自动评估
            if now.weekday() < 5 and now.hour == 15 and now.minute >= 5:
                if last_run != today:
                    last_run = today
                    try:
                        from utils.strategy_rules import evaluate_all
                        results = evaluate_all()
                        signal_count = sum(len(r.get("signals", [])) for r in results)
                        logger.info(f"每日自动评估完成: {len(results)} 个策略, {signal_count} 个信号")
                    except Exception as e:
                        logger.error(f"每日自动评估失败: {e}")
            # 工作日 16:00 自动更新数据
            if now.weekday() < 5 and now.hour >= 16 and data_updated != today:
                data_updated = today
                try:
                    await asyncio.to_thread(_auto_update_data)
                except Exception as e:
                    logger.error(f"每日自动更新数据失败: {e}")
        except Exception:
            pass
        await asyncio.sleep(60)  # 每分钟检查一次


app = FastAPI(title="量化回测系统", version="2.0.0", lifespan=lifespan)
TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent.parent / "static"

# 挂载静态文件目录
if STATIC_DIR.exists():
    from starlette.staticfiles import StaticFiles
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 公开路径（无需认证）
PUBLIC_PATHS = {"/", "/auth/register", "/auth/login", "/docs", "/openapi.json", "/redoc", "/docs/oauth2-redirect"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """全局认证中间件：公开路径外的所有请求必须携带有效 Token"""
    path = request.url.path

    # 公开路径放行
    if path in PUBLIC_PATHS or path.startswith("/ws"):
        return await call_next(request)

    # 静态资源放行
    if path.endswith((".js", ".css", ".ico", ".png")):
        return await call_next(request)

    # 检查 Authorization 头
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return HTMLResponse(
            content='{"detail":"未登录，请先调用 /auth/login 获取 Token"}',
            status_code=401,
            media_type="application/json",
        )

    token = auth_header[7:]
    try:
        from utils.auth import decode_token
        payload = decode_token(token)
        request.state.user = {"username": payload["sub"], "role": payload.get("role", "user")}
    except Exception:
        return HTMLResponse(
            content='{"detail":"Token 无效或已过期，请重新登录"}',
            status_code=401,
            media_type="application/json",
        )

    return await call_next(request)


# ==================== 用户认证接口 ====================

class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/register")
def api_register(req: RegisterRequest, request: Request):
    """用户注册"""
    if len(req.username) < 3 or len(req.password) < 6:
        raise HTTPException(400, "用户名至少3位，密码至少6位")
    from utils.database import get_db
    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE username = ?", (req.username,)).fetchone()
        if existing:
            raise HTTPException(409, "用户名已存在")
        hashed = hash_password(req.password)
        db.execute("INSERT INTO users (username, password, role) VALUES (?, ?, 'user')", (req.username, hashed))
    log_audit(req.username, "register", ip=request.client.host if request.client else "")
    token = create_token(req.username, "user")
    return {"status": "ok", "token": token, "username": req.username, "role": "user"}


@app.post("/auth/login")
def api_login(req: LoginRequest, request: Request):
    """用户登录"""
    from utils.database import get_db
    with get_db() as db:
        user = db.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
    if not user or not verify_password(req.password, user["password"]):
        raise HTTPException(401, "用户名或密码错误")
    with get_db() as db:
        db.execute("UPDATE users SET last_login = datetime('now','localtime') WHERE username = ?", (req.username,))
    log_audit(req.username, "login", ip=request.client.host if request.client else "")
    token = create_token(req.username, user["role"])
    return {"status": "ok", "token": token, "username": req.username, "role": user["role"]}


@app.get("/auth/profile")
def api_profile(user: dict = Depends(get_current_user)):
    """获取当前用户信息"""
    from utils.database import get_db
    with get_db() as db:
        row = db.execute("SELECT username, role, created_at, last_login FROM users WHERE username = ?",
                         (user["username"],)).fetchone()
    return dict(row) if row else {"username": user["username"], "role": user["role"]}


@app.post("/auth/change-password")
def api_change_password(old_password: str, new_password: str, user: dict = Depends(get_current_user)):
    """修改密码"""
    if len(new_password) < 6:
        raise HTTPException(400, "新密码至少6位")
    from utils.database import get_db
    with get_db() as db:
        row = db.execute("SELECT password FROM users WHERE username = ?", (user["username"],)).fetchone()
        if not row or not verify_password(old_password, row["password"]):
            raise HTTPException(401, "原密码错误")
        db.execute("UPDATE users SET password = ? WHERE username = ?", (hash_password(new_password), user["username"]))
    log_audit(user["username"], "change_password")
    return {"status": "ok", "message": "密码修改成功"}


@app.get("/audit/log")
def api_audit_log(user: dict = Depends(require_admin), limit: int = 100):
    """审计日志（仅管理员）"""
    return {"logs": get_audit_log(limit=limit)}


class BacktestRequest(BaseModel):
    strategy: str
    params: Optional[dict] = None
    symbol: Optional[str] = None    # 股票代码，为空则用模拟数据
    days: int = 500
    capital: float = 1_000_000
    risk: Optional[dict] = None     # 风控参数覆盖
    interval: Optional[str] = None  # "5"/"15"/"30"/"60" 分钟级，None=日线


@app.get("/", response_class=HTMLResponse)
def root():
    """管理界面"""
    return HTMLResponse(content=(TEMPLATE_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/strategies")
def list_strategies():
    """获取所有可用策略"""
    return {"strategies": STRATEGIES}


@app.get("/data")
def list_data():
    """获取已下载的股票数据"""
    from pathlib import Path
    from utils.stock_search import get_stock_names

    data_dir = Path(__file__).parent.parent / "data"
    csv_files = sorted(data_dir.glob("*.csv"))
    symbols = [f.stem for f in csv_files if not f.name.startswith(("_", "download"))]
    name_map = get_stock_names(symbols)

    result = []
    for f in csv_files:
        if f.name.startswith(("_", "download")):
            continue
        import pandas as pd
        df = pd.read_csv(f)
        sym = f.stem
        result.append({
            "symbol": sym,
            "name": name_map.get(sym, sym),
            "rows": len(df),
            "start": str(df["date"].iloc[0]) if len(df) > 0 else "",
            "end": str(df["date"].iloc[-1]) if len(df) > 0 else "",
        })
    return {"data": result}


def _execute_backtest(req: BacktestRequest):
    """公共回测逻辑：加载策略、数据、运行引擎、返回 (engine, info, bars, clean_stats, merged_params)"""
    if req.strategy not in STRATEGIES:
        raise HTTPException(400, f"未知策略: {req.strategy}")

    info = STRATEGIES[req.strategy]
    module = importlib.import_module(info["module"])
    strategy_cls = getattr(module, info["class"])

    if req.symbol:
        # 分钟级回测
        if req.interval and req.interval in ("5", "15", "30", "60"):
            from utils.minute_data import fetch_minute_klines, to_vnpy_bars as minute_to_bars
            minute_bars = fetch_minute_klines(req.symbol, req.interval)
            if not minute_bars:
                raise HTTPException(404, f"未获取到 {req.symbol} 的{req.interval}分钟数据")
            bars = minute_to_bars(req.symbol, minute_bars)
        else:
            try:
                bars = _load_csv_cached(req.symbol)
            except FileNotFoundError:
                raise HTTPException(404, f"未找到 {req.symbol} 的数据")
    else:
        bars = generate_random_bars(days=req.days)

    engine = BacktestingEngine()
    config = BACKTEST_CONFIG.copy()
    config["capital"] = req.capital

    if bars:
        start_dt = bars[0].datetime
        end_dt = bars[-1].datetime
    else:
        start_dt = datetime(2020, 1, 1)
        end_dt = datetime(2026, 12, 31)

    engine.set_parameters(
        vt_symbol=f"{req.symbol or '000001'}.SSE",
        interval=Interval.DAILY,
        start=start_dt,
        end=end_dt,
        **config,
    )

    merged_params = dict(req.params or {})
    if req.risk:
        merged_params.update(req.risk)
    engine.add_strategy(strategy_cls, merged_params)
    engine.history_data = bars

    engine.run_backtesting()
    engine.calculate_result()
    stats = engine.calculate_statistics(output=False)

    clean_stats = {}
    if stats:
        for key, value in stats.items():
            if hasattr(value, "item"):
                clean_stats[key] = value.item()
            else:
                clean_stats[key] = value

    # 计算增强指标
    try:
        import math
        daily_results = engine.get_all_daily_results()
        pnls = [float(dr.net_pnl) for dr in daily_results]
        if pnls:
            # Sortino 比率（只计算下行波动率）
            downside = [p for p in pnls if p < 0]
            if downside:
                downside_std = math.sqrt(sum(p**2 for p in downside) / len(downside))
                ann_factor = math.sqrt(252)
                daily_rf = 0.03 / 252  # 年化无风险利率 3%
                mean_daily = sum(pnls) / len(pnls)
                clean_stats["sortino_ratio"] = round(
                    (mean_daily - daily_rf) / downside_std * ann_factor, 4
                ) if downside_std > 0 else 0

            # Calmar 比率（年化收益 / 最大回撤）
            max_dd = abs(clean_stats.get("max_ddpercent", 0))
            ann_ret = clean_stats.get("annual_return", 0)
            clean_stats["calmar_ratio"] = round(ann_ret / max_dd, 4) if max_dd > 0 else 0

        # 胜率和盈亏比（从交易记录计算）
        trades = list(engine.trades.values())
        if trades:
            wins, losses = [], []
            open_trades = {}
            for t in trades:
                offset_val = t.offset.value if hasattr(t.offset, 'value') else str(t.offset)
                dir_val = t.direction.value if hasattr(t.direction, 'value') else str(t.direction)
                symbol = t.vt_symbol
                if offset_val == "开":
                    # 开多 → key=(多,sym), 开空 → key=(空,sym)
                    open_trades[(dir_val, symbol)] = float(t.price)
                else:
                    # 平仓：平空 → 匹配开多，平多 → 匹配开空
                    open_dir = "空" if dir_val == "多" else "多"
                    match_key = (open_dir, symbol)
                    if match_key in open_trades:
                        entry = open_trades.pop(match_key)
                        pnl = (float(t.price) - entry) * int(t.volume)
                        if open_dir == "空":
                            pnl = -pnl
                        (wins if pnl > 0 else losses).append(abs(pnl))

            total_closed = len(wins) + len(losses)
            clean_stats["win_rate"] = round(len(wins) / total_closed * 100, 2) if total_closed > 0 else 0
            avg_win = sum(wins) / len(wins) if wins else 0
            avg_loss = sum(losses) / len(losses) if losses else 0
            clean_stats["profit_loss_ratio"] = round(avg_win / avg_loss, 2) if avg_loss > 0 else 0
    except Exception:
        pass

    return engine, info, bars, clean_stats, merged_params


@app.post("/backtest")
async def run_backtest(req: BacktestRequest):
    """运行回测"""
    engine, info, bars, clean_stats, merged_params = await asyncio.to_thread(_execute_backtest, req)

    record_id = save_backtest(
        strategy=req.strategy,
        symbol=req.symbol or "模拟数据",
        params=merged_params,
        risk_config=req.risk or {},
        capital=req.capital,
        data_count=len(bars),
        stats=clean_stats,
    )

    return {
        "id": record_id,
        "strategy": info["name"],
        "symbol": req.symbol or "模拟数据",
        "data_count": len(bars),
        "params": merged_params,
        "stats": clean_stats,
    }


@app.post("/backtest-detail")
async def run_backtest_detail(req: BacktestRequest):
    """运行回测（返回详细数据用于绘图）"""
    engine, info, bars, clean_stats, merged_params = await asyncio.to_thread(_execute_backtest, req)

    # 日收益数据（资金曲线，从 net_pnl 累加计算余额）
    daily_data = []
    try:
        daily_results = engine.get_all_daily_results()
        balance = float(req.capital)
        for dr in daily_results:
            balance += float(dr.net_pnl)
            daily_data.append({
                "date": dr.date.strftime("%Y-%m-%d"),
                "balance": round(balance, 2),
                "net_pnl": round(float(dr.net_pnl), 2),
            })
    except Exception:
        pass

    # K线数据（含成交量）
    kline = [
        [bar.datetime.strftime("%Y-%m-%d"), float(bar.open_price),
         float(bar.close_price), float(bar.low_price), float(bar.high_price),
         int(bar.volume) if hasattr(bar, 'volume') and bar.volume else 0]
        for bar in bars
    ]

    # 交易记录
    trades = []
    try:
        trades = [
            {"datetime": t.datetime.strftime("%Y-%m-%d %H:%M"),
             "direction": str(t.direction.value), "offset": str(t.offset.value),
             "price": float(t.price), "volume": int(t.volume)}
            for t in engine.trades.values()
        ]
    except Exception:
        pass

    # 持久化回测记录
    record_id = save_backtest(
        strategy=req.strategy,
        symbol=req.symbol or "模拟数据",
        params=merged_params,
        risk_config=req.risk or {},
        capital=req.capital,
        data_count=len(bars),
        stats=clean_stats,
    )

    return {
        "id": record_id,
        "strategy": info["name"],
        "symbol": req.symbol or "模拟数据",
        "data_count": len(bars),
        "params": merged_params,
        "stats": clean_stats,
        "daily": daily_data,
        "kline": kline,
        "trades": trades,
    }


@app.get("/backtest/{strategy_key}")
async def quick_backtest(strategy_key: str, symbol: Optional[str] = None, days: int = 500):
    """快速回测（GET 方式）"""
    req = BacktestRequest(strategy=strategy_key, symbol=symbol, days=days)
    return await run_backtest(req)


class CompareRequest(BaseModel):
    symbol: Optional[str] = None
    days: int = 500


@app.post("/compare")
async def api_compare(req: CompareRequest):
    """策略对比"""
    results = await asyncio.to_thread(compare_strategies, symbol=req.symbol, days=req.days)
    return {"results": results}


class OptimizeRequest(BaseModel):
    strategy: str
    symbol: Optional[str] = None
    days: int = 500


OPTIMIZE_GRIDS = {
    "dual_ma": {"fast_window": [5, 10, 15, 20], "slow_window": [20, 30, 40, 60]},
    "macd": {"fast_window": [8, 12, 16], "slow_window": [20, 26, 30], "signal_window": [7, 9, 12]},
    "bollinger": {"boll_window": [15, 20, 25, 30], "boll_dev": [1.5, 2.0, 2.5]},
    "rsi": {"rsi_window": [10, 14, 20], "rsi_oversold": [20, 25, 30], "rsi_overbought": [70, 75, 80]},
    "kdj": {"kdj_window": [7, 9, 14], "kdj_signal": [3, 5], "oversold": [15, 20, 25], "overbought": [75, 80, 85]},
    "turtle": {"entry_window": [10, 20, 30, 55], "exit_window": [5, 10, 20]},
    "grid": {"grid_pct": [2, 3, 5], "max_grids": [3, 5, 8]},
    "momentum": {"lookback": [10, 20, 30, 60], "buy_threshold": [3, 5, 8, 10], "sell_threshold": [-2, -3, -5]},
    "mean_reversion": {"ma_window": [10, 20, 30], "entry_std": [1.5, 2.0, 2.5], "exit_std": [0.3, 0.5, 1.0]},
    "atr_breakout": {"atr_window": [10, 14, 20], "atr_multiplier": [1.5, 2.0, 2.5, 3.0], "ma_filter": [20, 50]},
    "ml": {"train_window": [60, 120, 180], "predict_window": [3, 5, 10], "confidence_threshold": [0.55, 0.6, 0.65]},
}


@app.post("/optimize")
async def api_optimize(req: OptimizeRequest):
    """参数优化"""
    if req.strategy not in OPTIMIZE_GRIDS:
        raise HTTPException(400, f"暂不支持 {req.strategy} 的参数优化")

    grid = OPTIMIZE_GRIDS[req.strategy]
    results = await asyncio.to_thread(
        optimize_strategy,
        strategy_key=req.strategy,
        param_grid=grid,
        symbol=req.symbol,
        days=req.days,
    )

    # 构建热力图数据（取前两个参数维度）
    heatmap = None
    param_keys = list(grid.keys())
    if len(param_keys) >= 2:
        x_key, y_key = param_keys[0], param_keys[1]
        x_vals = sorted(set(r["params"][x_key] for r in results))
        y_vals = sorted(set(r["params"][y_key] for r in results))
        # 矩阵：[x_idx, y_idx, sharpe, return]
        data_sharpe, data_return = [], []
        for r in results:
            xi = x_vals.index(r["params"][x_key])
            yi = y_vals.index(r["params"][y_key])
            data_sharpe.append([xi, yi, round(r["stats"].get("sharpe_ratio", 0), 4)])
            data_return.append([xi, yi, round(r["stats"].get("total_return", 0), 2)])
        heatmap = {
            "x_key": x_key, "y_key": y_key,
            "x_vals": [str(v) for v in x_vals],
            "y_vals": [str(v) for v in y_vals],
            "sharpe": data_sharpe,
            "return": data_return,
        }

    return {
        "strategy": req.strategy,
        "total_combos": len(results),
        "results": results[:10],
        "heatmap": heatmap,
    }


class PortfolioRequest(BaseModel):
    strategies: list[str]  # 策略 key 列表
    symbols: list[str]     # 股票代码列表
    days: int = 500
    capital: float = 1000000


@app.post("/portfolio")
async def api_portfolio(req: PortfolioRequest):
    """组合回测：多策略 × 多股票"""

    def _run_one(strategy, symbol):
        try:
            sub_req = BacktestRequest(strategy=strategy, symbol=symbol, days=req.days, capital=req.capital)
            engine, info, bars, stats, _ = _execute_backtest(sub_req)
            daily = []
            try:
                drs = engine.get_all_daily_results()
                bal = req.capital
                for dr in drs:
                    bal += float(dr.net_pnl)
                    daily.append({"date": dr.date.strftime("%Y-%m-%d"), "balance": round(bal, 2)})
            except Exception:
                pass
            return {
                "strategy": strategy, "strategy_name": info["name"],
                "symbol": symbol, "stats": stats, "daily": daily,
            }
        except Exception as e:
            return {"strategy": strategy, "symbol": symbol, "error": str(e)}

    # 并行运行所有组合
    pairs = [(s, sym) for s in req.strategies for sym in req.symbols]
    tasks = [asyncio.to_thread(_run_one, s, sym) for s, sym in pairs]
    raw = await asyncio.gather(*tasks)

    # 计算组合收益曲线（等权）
    all_daily = {}
    valid = [r for r in raw if "error" not in r and r["daily"]]
    for r in valid:
        for d in r["daily"]:
            all_daily.setdefault(d["date"], []).append(d["balance"])

    portfolio_daily = []
    if all_daily:
        init_cap = req.capital
        for date in sorted(all_daily.keys()):
            vals = all_daily[date]
            avg = sum(vals) / len(vals)
            portfolio_daily.append({"date": date, "balance": round(avg, 2), "return_pct": round((avg - init_cap) / init_cap * 100, 2)})

    return {
        "items": raw,
        "portfolio": portfolio_daily,
        "total_combos": len(pairs),
    }


class NotifyConfig(BaseModel):
    feishu_webhook: Optional[str] = None
    feishu_secret: Optional[str] = None
    dingtalk_url: Optional[str] = None
    wechat_url: Optional[str] = None
    serverchan_key: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 465
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    email_to: Optional[str] = None


@app.post("/notify-config")
def api_notify_config(req: NotifyConfig):
    """配置推送渠道（飞书/Server酱/邮件/钉钉/企业微信）"""
    # 更新全局推送配置
    notifier.update_config(
        feishu_webhook=req.feishu_webhook or "",
        feishu_secret=req.feishu_secret or "",
        serverchan_key=req.serverchan_key or "",
        dingtalk_url=req.dingtalk_url or "",
        wechat_url=req.wechat_url or "",
        smtp_host=req.smtp_host or "",
        smtp_port=req.smtp_port or 465,
        smtp_user=req.smtp_user or "",
        smtp_pass=req.smtp_pass or "",
        email_to=req.email_to or "",
    )
    # 兼容旧的策略推送
    RiskStrategy.setup_notifier(dingtalk_url=req.dingtalk_url, wechat_url=req.wechat_url)

    return {
        "status": "ok",
        "channels": {
            "feishu": bool(req.feishu_webhook),
            "serverchan": bool(req.serverchan_key),
            "email": bool(req.smtp_host and req.email_to),
            "dingtalk": bool(req.dingtalk_url),
            "wechat": bool(req.wechat_url),
        },
    }


@app.post("/notify/test")
def api_test_notify():
    """测试推送"""
    return notifier.send("测试推送", "这是一条测试消息，如果你收到了说明推送配置正确！")


# ==================== 定时任务 ====================
import threading

_scheduled_tasks: dict[str, dict] = {}  # task_id -> {config, timer, last_run}


class ScheduleRequest(BaseModel):
    strategy: str
    symbol: str = "600519"
    interval_minutes: int = 60
    notify: bool = True


@app.post("/schedule")
async def api_create_schedule(req: ScheduleRequest):
    """创建定时回测任务"""
    import uuid
    task_id = str(uuid.uuid4())[:8]

    async def _run_task():
        try:
            result = await asyncio.to_thread(
                _execute_backtest,
                BacktestRequest(strategy=req.strategy, symbol=req.symbol),
            )
            engine, info, bars, stats, _ = result
            _scheduled_tasks[task_id]["last_run"] = datetime.now().isoformat()
            _scheduled_tasks[task_id]["last_stats"] = {
                "total_return": stats.get("total_return", 0),
                "sharpe_ratio": stats.get("sharpe_ratio", 0),
                "max_ddpercent": stats.get("max_ddpercent", 0),
            }
            if req.notify:
                notifier.send(
                    f"定时回测 - {info['name']}",
                    f"策略: {info['name']}\n股票: {req.symbol}\n"
                    f"收益: {stats.get('total_return', 0):.2f}%\n"
                    f"Sharpe: {stats.get('sharpe_ratio', 0):.2f}",
                )
        except Exception as e:
            print(f"定时任务 {task_id} 失败: {e}")

    _scheduled_tasks[task_id] = {
        "strategy": req.strategy,
        "symbol": req.symbol,
        "interval_minutes": req.interval_minutes,
        "notify": req.notify,
        "created": datetime.now().isoformat(),
        "last_run": None,
        "last_stats": None,
    }

    # 后台定时执行
    async def _scheduler():
        while task_id in _scheduled_tasks:
            await _run_task()
            await asyncio.sleep(req.interval_minutes * 60)

    asyncio.create_task(_scheduler())
    return {"task_id": task_id, "message": f"定时任务已创建，每 {req.interval_minutes} 分钟执行一次"}


@app.get("/schedules")
def api_list_schedules():
    """查看所有定时任务"""
    return {"tasks": _scheduled_tasks}


@app.delete("/schedule/{task_id}")
def api_delete_schedule(task_id: str):
    """删除定时任务"""
    if task_id in _scheduled_tasks:
        del _scheduled_tasks[task_id]
        return {"status": "deleted"}
    raise HTTPException(404, "任务不存在")


# ==================== 回测报告导出 ====================

@app.post("/export-report")
async def api_export_report(req: BacktestRequest):
    """导出回测报告 HTML"""
    engine, info, bars, stats, params = await asyncio.to_thread(_execute_backtest, req)

    # 构建交易记录表
    trades_html = ""
    try:
        trades = [
            {"datetime": t.datetime.strftime("%Y-%m-%d %H:%M"),
             "direction": str(t.direction.value), "offset": str(t.offset.value),
             "price": float(t.price), "volume": int(t.volume)}
            for t in engine.trades.values()
        ]
        for t in trades:
            color = "#3fb950" if t["offset"] == "开" else "#f85149"
            trades_html += f"""
            <tr>
              <td>{t['datetime']}</td>
              <td style="color:{color}">{t['offset']}{t['direction']}</td>
              <td>¥{t['price']:.2f}</td>
              <td>{t['volume']}</td>
            </tr>"""
    except Exception:
        trades_html = "<tr><td colspan='4'>无交易记录</td></tr>"

    # 指标卡片
    def _card(label, value, color="#e6edf3"):
        return f'<div class="metric"><div class="label">{label}</div><div class="value" style="color:{color}">{value}</div></div>'

    ret = stats.get("total_return", 0)
    metrics_html = (
        _card("总收益", f"{ret:.2f}%", "#3fb950" if ret > 0 else "#f85149")
        + _card("Sharpe", f"{stats.get('sharpe_ratio', 0):.2f}")
        + _card("Sortino", f"{stats.get('sortino_ratio', 0):.2f}")
        + _card("Calmar", f"{stats.get('calmar_ratio', 0):.2f}")
        + _card("最大回撤", f"{stats.get('max_ddpercent', 0):.2f}%", "#f85149")
        + _card("胜率", f"{stats.get('win_rate', 0):.1f}%")
        + _card("盈亏比", f"{stats.get('profit_loss_ratio', 0):.2f}")
        + _card("交易次数", f"{stats.get('total_trade_count', 0)}")
    )

    params_html = "".join(f"<tr><td>{k}</td><td>{v}</td></tr>" for k, v in params.items())

    report_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><title>回测报告 - {info['name']}</title>
<style>
body {{ font-family: -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; padding: 40px; max-width: 900px; margin: 0 auto; }}
h1 {{ color: #e6edf3; border-bottom: 2px solid #238636; padding-bottom: 12px; }}
h2 {{ color: #58a6ff; margin-top: 32px; }}
.metrics {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }}
.metric {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }}
.metric .label {{ font-size: 12px; color: #8b949e; text-transform: uppercase; }}
.metric .value {{ font-size: 20px; font-weight: 700; margin-top: 4px; }}
table {{ width: 100%; border-collapse: collapse; margin: 12px 0; }}
th, td {{ padding: 10px 12px; text-align: left; border-bottom: 1px solid #21262d; font-size: 13px; }}
th {{ color: #8b949e; background: #161b22; }}
.footer {{ margin-top: 40px; padding-top: 16px; border-top: 1px solid #21262d; color: #484f58; font-size: 12px; }}
</style>
</head>
<body>
<h1>📊 回测报告</h1>
<p>策略: <b>{info['name']}</b> | 股票: <b>{req.symbol or '模拟数据'}</b> | 资金: <b>¥{req.capital:,.0f}</b></p>

<h2>绩效指标</h2>
<div class="metrics">{metrics_html}</div>

<h2>策略参数</h2>
<table><tr><th>参数</th><th>值</th></tr>{params_html}</table>

<h2>交易记录</h2>
<table><tr><th>时间</th><th>方向</th><th>价格</th><th>数量</th></tr>{trades_html}</table>

<div class="footer">
  <p>生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | 量化交易系统 v3.0</p>
</div>
</body></html>"""

    return {"html": report_html, "strategy": info["name"], "symbol": req.symbol or "模拟数据"}


# ==================== 数据质量检测 ====================

@app.get("/data/quality")
async def api_data_quality():
    """检测所有股票数据质量"""
    from utils.data_quality import check_all_data
    results = await asyncio.to_thread(check_all_data, DATA_DIR)
    avg_score = sum(r["score"] for r in results) / len(results) if results else 0
    return {"total": len(results), "avg_score": round(avg_score, 1), "results": results}


@app.get("/data/quality/{symbol}")
async def api_data_quality_single(symbol: str):
    """检测单只股票数据质量"""
    from utils.data_quality import check_data_quality
    filepath = DATA_DIR / f"{symbol}.csv"
    if not filepath.exists():
        raise HTTPException(404, f"未找到 {symbol} 的数据")
    result = await asyncio.to_thread(check_data_quality, filepath)
    return result


# ==================== 价格告警接口 ====================

# 内存中的价格告警（生产环境应存数据库）
_price_alerts: list[dict] = []


class PriceAlertRequest(BaseModel):
    symbol: str
    name: str = ""
    target_price: float
    direction: str  # "above" 或 "below"


@app.post("/alerts/price")
def api_create_price_alert(req: PriceAlertRequest, user: dict = Depends(get_current_user)):
    """创建价格告警"""
    alert = {
        "id": len(_price_alerts) + 1,
        "username": user["username"],
        "symbol": req.symbol,
        "name": req.name or req.symbol,
        "target_price": req.target_price,
        "direction": req.direction,
        "triggered": False,
    }
    _price_alerts.append(alert)
    log_audit(user["username"], "create_alert", f"{req.symbol} {req.direction} {req.target_price}")
    return {"status": "ok", "alert": alert}


@app.get("/alerts/price")
def api_list_price_alerts(user: dict = Depends(get_current_user)):
    """查询价格告警"""
    user_alerts = [a for a in _price_alerts if a["username"] == user["username"]]
    return {"alerts": user_alerts, "total": len(user_alerts)}


@app.post("/alerts/check")
def api_check_alerts():
    """检查所有价格告警（定时任务调用）"""
    triggered = []
    for alert in _price_alerts:
        if alert["triggered"]:
            continue

        quote = get_realtime_quote(alert["symbol"])
        if not quote:
            continue

        price = quote["price"]
        should_trigger = False
        if alert["direction"] == "above" and price >= alert["target_price"]:
            should_trigger = True
        elif alert["direction"] == "below" and price <= alert["target_price"]:
            should_trigger = True

        if should_trigger:
            alert["triggered"] = True
            result = send_price_alert(
                symbol=alert["symbol"],
                name=alert["name"],
                current_price=price,
                target_price=alert["target_price"],
                direction=alert["direction"],
            )
            triggered.append({"alert": alert, "push_result": result})

    return {"checked": len(_price_alerts), "triggered": len(triggered), "details": triggered}


# ==================== 三层风控配置接口 ====================

class RiskLayerConfig(BaseModel):
    """风控配置请求"""
    strategy: Optional[dict] = None   # 策略层参数覆盖
    account: Optional[dict] = None    # 账户层参数覆盖
    platform: Optional[dict] = None   # 平台层参数覆盖


# 默认风控配置（前端可覆盖）
RISK_DEFAULTS = {
    "strategy": {
        "stop_loss_pct": -5.0,
        "take_profit_pct": 15.0,
        "trailing_stop_pct": -8.0,
        "max_daily_loss_pct": -5.0,
        "max_position_pct": 30.0,
    },
    "account": {
        "max_drawdown_pct": -20.0,
        "max_single_concentration": 30.0,
        "max_total_position_pct": 80.0,
        "max_leverage": 1.0,
    },
    "platform": {
        "blacklist": ["ST", "*ST", "退市"],
        "limit_price_pct": 10.0,
        "abnormal_price_dev_pct": 5.0,
        "max_order_per_minute": 30,
        "respect_t_plus_1": True,
    },
}


@app.get("/risk/config")
def api_get_risk_config():
    """获取当前风控配置"""
    return RISK_DEFAULTS


@app.post("/risk/config")
def api_set_risk_config(req: RiskLayerConfig):
    """更新风控配置（合并到默认值）"""
    if req.strategy:
        RISK_DEFAULTS["strategy"].update(req.strategy)
    if req.account:
        RISK_DEFAULTS["account"].update(req.account)
    if req.platform:
        RISK_DEFAULTS["platform"].update(req.platform)
    return {"status": "ok", "config": RISK_DEFAULTS}


@app.post("/risk/check")
def api_risk_check(req: dict):
    """风控校验接口（供前端或策略调用）"""
    from utils.risk_manager import RiskManager, StrategyRiskConfig, AccountRiskConfig, PlatformRiskConfig

    manager = RiskManager(
        strategy_config=StrategyRiskConfig(**RISK_DEFAULTS["strategy"]),
        account_config=AccountRiskConfig(**RISK_DEFAULTS["account"]),
        platform_config=PlatformRiskConfig(**RISK_DEFAULTS["platform"]),
    )
    result = manager.check_order(
        strategy_name=req.get("strategy_name", ""),
        symbol=req.get("symbol", ""),
        symbol_name=req.get("symbol_name", ""),
        order_price=req.get("order_price", 0),
        last_price=req.get("last_price", 0),
        pre_close=req.get("pre_close", 0),
        qty=req.get("qty", 0),
        pos=req.get("pos", 0),
        capital=req.get("capital", 1_000_000),
    )
    return {
        "passed": result.passed,
        "level": result.level,
        "rule": result.rule,
        "message": result.message,
        "action": result.action,
    }


@app.post("/refresh-data")
def api_refresh_data():
    """从 baostock 刷新所有股票最新数据"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    import baostock as bs
    from data.download_akshare import download_stock, HOT_STOCKS

    bs.login()
    count = 0
    for code in HOT_STOCKS:
        try:
            download_stock(code)
            count += 1
        except Exception:
            pass
    bs.logout()

    # 返回更新后的数据列表
    data_dir = Path(__file__).parent.parent / "data"
    files = []
    start_all, end_all = "9999", "0000"
    for f in sorted(data_dir.glob("*.csv")):
        if f.name.startswith("__") or f.name.startswith("download"):
            continue
        import pandas as pd
        df = pd.read_csv(f)
        s, e = str(df["date"].iloc[0]), str(df["date"].iloc[-1])
        if s < start_all: start_all = s
        if e > end_all: end_all = e
        files.append({"symbol": f.stem, "start": s, "end": e, "rows": len(df)})

    return {"count": count, "start": start_all, "end": end_all, "files": files}


class AddStockRequest(BaseModel):
    symbols: list[str]  # 股票代码列表，如 ["601398", "600000"]


@app.post("/stocks/add")
def api_add_stocks(req: AddStockRequest):
    """添加新股票数据（A 股/港股/美股）"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from data.download_akshare import download_stock, _detect_market
    from utils.stock_search import get_stock_names
    from utils.stock_list import search_stocks_local

    # 过滤有效代码
    clean_symbols = [s.strip() for s in req.symbols if s.strip()]

    # 名称映射：先本地搜，再查新浪
    name_map = {}
    for sym in clean_symbols:
        results = search_stocks_local(sym, limit=1)
        if results and results[0]["code"].upper() == sym.upper():
            name_map[sym] = results[0]["name"]
    name_map.update(get_stock_names([s for s in clean_symbols if len(s) == 6 and s.isdigit()]))

    # A 股需要 baostock 登录
    has_a = any(_detect_market(s.strip()) == "a" for s in clean_symbols)
    if has_a:
        import baostock as bs
        bs.login()

    results = []
    for symbol in req.symbols:
        symbol = symbol.strip()
        if not symbol or len(symbol) < 1:
            results.append({"symbol": symbol, "status": "error", "msg": "代码不能为空"})
            continue
        try:
            df = download_stock(symbol)
            if df is not None and len(df) > 0:
                results.append({
                    "symbol": symbol,
                    "name": name_map.get(symbol, symbol),
                    "status": "ok",
                    "rows": len(df),
                    "start": str(df["date"].iloc[0]),
                    "end": str(df["date"].iloc[-1]),
                })
            else:
                results.append({"symbol": symbol, "status": "error", "msg": "无数据"})
        except Exception as e:
            results.append({"symbol": symbol, "status": "error", "msg": str(e)})

    if has_a:
        bs.logout()

    # 同步更新 HOT_STOCKS 列表（写入文件）
    data_dir = Path(__file__).parent.parent / "data"
    current = [f.stem for f in data_dir.glob("*.csv") if not f.name.startswith(("_", "download"))]

    return {
        "results": results,
        "total_stocks": len(current),
    }


@app.get("/stocks/search")
def api_search_stock(q: str = "", limit: int = 30, market: str = ""):
    """搜索股票（A 股 5200+ / 港股 / 美股）"""
    from utils.stock_list import search_stocks_local
    from utils.stock_search import get_popular_stocks

    if not q:
        return {"results": get_popular_stocks(), "source": "popular"}

    results = search_stocks_local(q, limit=limit, market=market)
    return {"results": results, "source": "local", "query": q, "total": len(results)}


class FavoriteRequest(BaseModel):
    symbol: str
    name: str = ""


@app.post("/stocks/favorites/add")
def api_add_favorite(req: FavoriteRequest, user: dict = Depends(get_current_user)):
    """添加自选股"""
    from utils.database import add_favorite
    add_favorite(user["username"], req.symbol, req.name)
    log_audit(user["username"], "add_favorite", req.symbol)
    return {"status": "ok", "symbol": req.symbol}


@app.post("/stocks/favorites/remove")
def api_remove_favorite(req: FavoriteRequest, user: dict = Depends(get_current_user)):
    """删除自选股"""
    from utils.database import remove_favorite
    remove_favorite(user["username"], req.symbol)
    log_audit(user["username"], "remove_favorite", req.symbol)
    return {"status": "ok", "symbol": req.symbol}


@app.get("/stocks/favorites")
def api_get_favorites(user: dict = Depends(get_current_user)):
    """获取自选股列表"""
    from utils.database import get_favorites
    favorites = get_favorites(user["username"])
    return {"favorites": favorites, "total": len(favorites)}


@app.get("/realtime/{symbol}")
def api_realtime_quote(symbol: str):
    """获取实时行情"""
    quote = get_realtime_quote(symbol)
    if not quote:
        raise HTTPException(404, f"未找到 {symbol} 的行情")
    return quote


@app.get("/realtime-kline/{symbol}")
def api_realtime_kline(symbol: str, period: str = "101", count: int = 250):
    """获取实时 K 线数据（东方财富，最新数据）"""
    kline = get_realtime_kline(symbol, period=period, count=count)
    return {"symbol": symbol, "count": len(kline), "kline": kline}


@app.get("/minute-data/{symbol}")
def api_minute_data(symbol: str, period: str = "5", limit: int = 500):
    """获取分钟K线数据（新浪免费API）"""
    from utils.minute_data import fetch_minute_klines_with_info
    info = fetch_minute_klines_with_info(symbol, period, limit)
    return info


# ==================== 因子计算接口 ====================

@app.get("/factors")
def api_list_factors():
    """获取所有可用因子"""
    return {"factors": list_factors()}


class FactorRequest(BaseModel):
    symbol: str
    factors: Optional[list[str]] = None  # None 则计算全部
    params: Optional[dict] = None        # 各因子参数覆盖


@app.post("/factors/compute")
async def api_compute_factors(req: FactorRequest):
    """计算指定股票的因子值"""
    try:
        df = await asyncio.to_thread(compute_factors, req.symbol, req.factors, **(req.params or {}))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    # 只返回最近 60 行 + 因子列（去掉原始 OHLCV 重复信息）
    factor_cols = [c for c in df.columns if c not in ("date", "open", "high", "low", "close", "volume")]
    recent = df[["date"] + factor_cols].tail(60).copy()
    recent["date"] = recent["date"].dt.strftime("%Y-%m-%d")
    recent = recent.where(recent.notna(), None)

    return {
        "symbol": req.symbol,
        "rows": len(recent),
        "columns": factor_cols,
        "data": recent.to_dict(orient="records"),
    }


@app.get("/factors/score/{symbol}")
async def api_factor_score(symbol: str):
    """多因子打分（最新一日）"""
    try:
        scores = await asyncio.to_thread(top_factors_score, symbol)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    return {
        "symbol": symbol,
        "scores": {k: round(v, 4) for k, v in scores.items()},
        "total": round(float(scores.sum()), 4),
    }


class MultiStockRequest(BaseModel):
    symbols: list[str]
    factor_weights: Optional[dict[str, float]] = None


@app.post("/factors/ranking")
async def api_factor_ranking(req: MultiStockRequest):
    """多股票因子排名（多因子选股）"""

    def _calc_one(symbol):
        try:
            scores = top_factors_score(symbol, req.factor_weights)
            total = float(scores.sum())
            return {"symbol": symbol, "score": round(total, 4)}
        except FileNotFoundError:
            return {"symbol": symbol, "score": None, "error": "数据不存在"}

    tasks = [asyncio.to_thread(_calc_one, s) for s in req.symbols]
    results = await asyncio.gather(*tasks)

    results = sorted(results, key=lambda x: x.get("score") or -999, reverse=True)

    # 持久化因子排名记录
    save_factor_ranking(req.symbols, req.factor_weights or {}, results)

    return {"count": len(results), "ranking": results}


# ==================== 历史记录查询接口 ====================

@app.get("/history/backtest")
def api_backtest_history(
    strategy: Optional[str] = None,
    symbol: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """查询历史回测记录"""
    records = get_backtest_history(strategy or "", symbol or "", limit, offset)
    return {"total": len(records), "records": records}


@app.get("/history/backtest/{record_id}")
def api_backtest_detail(record_id: int):
    """查询单条回测详情"""
    record = get_backtest_by_id(record_id)
    if not record:
        raise HTTPException(404, "记录不存在")
    return record


@app.get("/history/orders")
def api_order_history(
    strategy: Optional[str] = None,
    symbol: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
):
    """查询历史订单"""
    records = get_order_history(strategy or "", symbol or "", status or "", limit)
    return {"total": len(records), "records": records}


@app.get("/history/factors")
def api_factor_history(limit: int = 20):
    """查询因子排名历史"""
    records = get_factor_history(limit)
    return {"total": len(records), "records": records}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """通用 WebSocket 端点

    客户端发送 JSON 消息控制订阅：
      {"action": "subscribe",   "topic": "market.600519"}
      {"action": "unsubscribe", "topic": "market.600519"}
      {"action": "subscribe",   "topic": "strategy.signal"}
      {"action": "subscribe",   "topic": "risk.alert"}
    """
    await ws_manager.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                action = msg.get("action")
                topic = msg.get("topic", "")

                if action == "subscribe" and topic:
                    ws_manager.subscribe(ws, topic)
                    await ws_manager.send_personal(ws, "system", {
                        "message": f"已订阅 {topic}",
                        "subscribers": ws_manager.get_subscribers_count(topic),
                    })
                elif action == "unsubscribe" and topic:
                    ws_manager.unsubscribe(ws, topic)
                    await ws_manager.send_personal(ws, "system", {
                        "message": f"已取消订阅 {topic}",
                    })
                elif action == "ping":
                    await ws_manager.send_personal(ws, "system", {"message": "pong"})
                elif action == "status":
                    await ws_manager.send_personal(ws, "system", ws_manager.get_status())
                else:
                    await ws_manager.send_personal(ws, "error", {
                        "message": f"未知指令: {raw}",
                    })
            except json.JSONDecodeError:
                await ws_manager.send_personal(ws, "error", {
                    "message": "JSON 格式错误",
                })

    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


@app.get("/ws/status")
def api_ws_status():
    """查看 WebSocket 连接状态"""
    return ws_manager.get_status()


# WebSocket 广播接口（供内部其他模块调用）
async def broadcast_signal(strategy_name: str, symbol: str, signal: str, price: float, pos: int):
    """广播策略信号（策略执行时调用）"""
    await ws_manager.broadcast("strategy.signal", {
        "strategy": strategy_name,
        "symbol": symbol,
        "signal": signal,
        "price": price,
        "pos": pos,
    })


# ==================== 订单管理接口 ====================

class CreateOrderRequest(BaseModel):
    strategy_name: str
    symbol: str
    direction: str = "long"    # long / short
    offset: str = "open"       # open / close
    price: float
    volume: int


@app.post("/orders")
def api_create_order(req: CreateOrderRequest):
    """创建订单"""
    order = order_manager.create_order(
        strategy_name=req.strategy_name,
        symbol=req.symbol,
        direction=Direction(req.direction),
        offset=Offset(req.offset),
        price=req.price,
        volume=req.volume,
    )
    return {"status": "ok", "order": order.to_dict()}


@app.post("/orders/{order_id}/submit")
def api_submit_order(order_id: str, broker_order_id: str = ""):
    """提交订单到 Broker"""
    order = order_manager.submit(order_id, broker_order_id)
    return {"status": "ok", "order": order.to_dict()}


@app.post("/orders/{order_id}/fill")
def api_fill_order(order_id: str, trade_price: float, trade_volume: int):
    """模拟成交回报"""
    order = order_manager.on_trade(order_id, trade_price, trade_volume)
    return {"status": "ok", "order": order.to_dict()}


@app.post("/orders/{order_id}/cancel")
def api_cancel_order(order_id: str, reason: str = ""):
    """撤单"""
    order = order_manager.cancel(order_id, reason)
    return {"status": "ok", "order": order.to_dict()}


@app.post("/orders/{order_id}/reject")
def api_reject_order(order_id: str, reason: str = ""):
    """拒绝订单"""
    order = order_manager.reject(order_id, reason)
    return {"status": "ok", "order": order.to_dict()}


@app.get("/orders")
def api_list_orders(
    strategy: Optional[str] = None,
    symbol: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
):
    """查询订单列表（活跃 + 历史）"""
    active = order_manager.get_active_orders(strategy or "", symbol or "")
    history = order_manager.get_history(
        strategy or "", symbol or "",
        OrderStatus(status) if status else None,
        limit,
    )
    return {
        "active": active,
        "history": history,
        "stats": order_manager.get_stats(),
    }


@app.get("/orders/stats")
def api_order_stats():
    """订单统计"""
    return order_manager.get_stats()


# ==================== 自定义策略接口 ====================

class StrategyRule(BaseModel):
    left: dict     # {"type": "indicator", "indicator": "ma", "params": {"period": 5}}
    op: str        # "cross_above", ">", "<" 等
    right: dict    # 同上，或 {"type": "fixed", "value": 100}

class StrategyRequest(BaseModel):
    name: str
    symbol: str
    market: str = "a"
    buy_conditions: list[StrategyRule] = []
    sell_conditions: list[StrategyRule] = []

class StrategyUpdateRequest(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    buy_conditions: Optional[list[StrategyRule]] = None
    sell_conditions: Optional[list[StrategyRule]] = None


@app.get("/user-strategies")
def api_list_user_strategies():
    """列出所有自定义策略"""
    from utils.strategy_rules import list_strategies
    return {"strategies": list_strategies()}


@app.post("/user-strategies")
def api_create_user_strategy(req: StrategyRequest, user: dict = Depends(get_current_user)):
    """新增策略（自动版本管理）"""
    from utils.strategy_rules import add_strategy, list_strategies, update_strategy
    strategy = add_strategy(
        name=req.name, symbol=req.symbol,
        buy_conditions=[c.model_dump() for c in req.buy_conditions],
        sell_conditions=[c.model_dump() for c in req.sell_conditions],
        market=req.market,
    )
    # 保存版本快照
    _save_strategy_version(strategy)
    log_audit(user["username"], "create_strategy", f"{req.name} → {req.symbol}")
    return strategy


# 策略版本管理（内存 + JSON 持久化）
_strategy_versions: dict[str, list] = {}  # strategy_name -> [{version, data, timestamp}]
_STRATEGY_VERSIONS_FILE = DATA_DIR / "strategy_versions.json"

def _load_strategy_versions():
    global _strategy_versions
    if _STRATEGY_VERSIONS_FILE.exists():
        import json
        _strategy_versions = json.loads(_STRATEGY_VERSIONS_FILE.read_text(encoding="utf-8"))

def _save_strategy_versions():
    import json
    _STRATEGY_VERSIONS_FILE.write_text(json.dumps(_strategy_versions, ensure_ascii=False, indent=2), encoding="utf-8")

def _save_strategy_version(strategy: dict):
    import json
    name = strategy.get("name", "")
    if name not in _strategy_versions:
        _strategy_versions[name] = []
    version = len(_strategy_versions[name]) + 1
    _strategy_versions[name].append({
        "version": version,
        "data": strategy,
        "timestamp": datetime.now().isoformat(),
    })
    _save_strategy_versions()

_load_strategy_versions()


@app.get("/user-strategies/{name}/versions")
def api_get_strategy_versions(name: str):
    """查询策略历史版本"""
    versions = _strategy_versions.get(name, [])
    return {"name": name, "versions": versions}


@app.post("/user-strategies/{name}/rollback/{version}")
def api_rollback_strategy(name: str, version: int):
    """回滚到指定版本"""
    versions = _strategy_versions.get(name, [])
    target = next((v for v in versions if v["version"] == version), None)
    if not target:
        raise HTTPException(404, f"版本 {version} 不存在")
    from utils.strategy_rules import update_strategy, list_strategies
    data = target["data"]
    # 找到策略 ID
    strategies = list_strategies()
    existing = next((s for s in strategies if s["name"] == name), None)
    if existing:
        update_strategy(existing["id"], data)
    _save_strategy_version(data)
    return {"status": "ok", "message": f"已回滚到版本 {version}"}


@app.get("/user-strategies/presets")
def api_get_presets():
    """获取预设策略模板列表"""
    from utils.strategy_rules import get_presets
    return {"presets": get_presets()}


@app.post("/user-strategies/presets/{index}")
def api_load_preset(index: int, symbol: str, market: str = "a"):
    """一键加载预设策略模板"""
    from utils.strategy_rules import PRESET_STRATEGIES, add_strategy
    if index < 0 or index >= len(PRESET_STRATEGIES):
        raise HTTPException(400, f"无效的模板索引: {index}")
    if not symbol:
        raise HTTPException(400, "股票代码不能为空")
    preset = PRESET_STRATEGIES[index]
    strategy = add_strategy(
        name=preset["name"],
        symbol=symbol,
        buy_conditions=preset["buy_conditions"],
        sell_conditions=preset["sell_conditions"],
        market=market,
    )
    return {"status": "ok", "strategy": strategy}


@app.post("/user-strategies/evaluate-all")
def api_evaluate_all_user():
    """评估所有已启用策略（每日定时调用）"""
    from utils.strategy_rules import evaluate_all
    results = evaluate_all()
    signal_count = sum(len(r.get("signals", [])) for r in results)
    return {
        "evaluated": len(results),
        "signals": signal_count,
        "results": results,
    }


@app.get("/user-strategies/{strategy_id}")
def api_get_user_strategy(strategy_id: int):
    """获取策略详情"""
    from utils.strategy_rules import get_strategy
    s = get_strategy(strategy_id)
    if not s:
        raise HTTPException(404, "策略不存在")
    return s


@app.put("/user-strategies/{strategy_id}")
def api_update_user_strategy(strategy_id: int, req: StrategyUpdateRequest,
                             user: dict = Depends(get_current_user)):
    """更新策略"""
    from utils.strategy_rules import update_strategy
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    s = update_strategy(strategy_id, updates)
    if not s:
        raise HTTPException(404, "策略不存在")
    return s


@app.delete("/user-strategies/{strategy_id}")
def api_delete_user_strategy(strategy_id: int, user: dict = Depends(get_current_user)):
    """删除策略"""
    from utils.strategy_rules import remove_strategy
    remove_strategy(strategy_id)
    return {"status": "ok"}


@app.post("/user-strategies/{strategy_id}/evaluate")
def api_evaluate_user_strategy(strategy_id: int):
    """手动评估单个策略"""
    from utils.strategy_rules import get_strategy, evaluate_strategy
    s = get_strategy(strategy_id)
    if not s:
        raise HTTPException(404, "策略不存在")
    return evaluate_strategy(s)


class NLStrategyRequest(BaseModel):
    text: str


class NLCreateStrategyRequest(BaseModel):
    text: str
    name: str = ""
    symbol: str
    market: str = "a"


# ==================== 实盘交易接口 ====================

class BrokerConnectRequest(BaseModel):
    broker: str               # "yh"/"ht"/"xq"
    exe_path: Optional[str] = None   # 券商客户端路径
    cookie: Optional[str] = None      # 雪球cookie

class BrokerOrderRequest(BaseModel):
    symbol: str               # 股票代码
    price: float              # 价格
    amount: int               # 数量

@app.get("/broker/status")
def api_broker_status():
    """查询券商连接状态"""
    from utils.broker import get_status
    return get_status()

@app.post("/broker/connect")
def api_broker_connect(req: BrokerConnectRequest):
    """连接券商客户端"""
    from utils.broker import connect
    result = connect(req.broker, exe_path=req.exe_path, cookie=req.cookie)
    if result.get("status") == "error":
        raise HTTPException(400, result["message"])
    return result

@app.post("/broker/disconnect")
def api_broker_disconnect():
    """断开券商连接"""
    from utils.broker import disconnect
    return disconnect()

@app.get("/broker/balance")
def api_broker_balance():
    """查询账户资金"""
    from utils.broker import get_balance
    result = get_balance()
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@app.get("/broker/positions")
def api_broker_positions():
    """查询持仓"""
    from utils.broker import get_positions
    return get_positions()

@app.get("/broker/orders")
def api_broker_orders():
    """查询当日委托"""
    from utils.broker import get_orders
    return get_orders()

@app.post("/broker/buy")
def api_broker_buy(req: BrokerOrderRequest):
    """买入股票"""
    from utils.broker import buy
    result = buy(req.symbol, req.price, req.amount)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("message", "下单失败"))
    return result

@app.post("/broker/sell")
def api_broker_sell(req: BrokerOrderRequest):
    """卖出股票"""
    from utils.broker import sell
    result = sell(req.symbol, req.price, req.amount)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("message", "下单失败"))
    return result

@app.post("/broker/cancel/{order_id}")
def api_broker_cancel(order_id: str):
    """撤销委托"""
    from utils.broker import cancel_order
    result = cancel_order(order_id)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("message", "撤单失败"))
    return result


@app.post("/nl/parse")
def api_nl_parse(req: NLStrategyRequest):
    """自然语言解析为策略条件（支持多只股票，不保存）"""
    from utils.nl_parser import parse_nl_multi
    if not req.text.strip():
        raise HTTPException(400, "请输入策略描述")
    results = parse_nl_multi(req.text)
    # 单条结果保持向后兼容
    if len(results) == 1:
        return {"status": "ok", "multi": False, **results[0]}
    return {"status": "ok", "multi": True, "rules": results}


@app.post("/nl/create-strategy")
def api_nl_create_strategy(req: NLCreateStrategyRequest):
    """自然语言解析并创建策略"""
    from utils.nl_parser import parse_nl_strategy
    from utils.strategy_rules import add_strategy
    if not req.text.strip():
        raise HTTPException(400, "请输入策略描述")
    if not req.symbol.strip():
        raise HTTPException(400, "股票代码不能为空")

    result = parse_nl_strategy(req.text)
    if not result["buy_conditions"] and not result["sell_conditions"]:
        raise HTTPException(400, f"未能识别任何条件: {result['explanation']}")

    name = req.name or f"NL策略-{req.symbol}"
    strategy = add_strategy(
        name=name,
        symbol=req.symbol,
        buy_conditions=result["buy_conditions"],
        sell_conditions=result["sell_conditions"],
        market=req.market,
    )
    return {"status": "ok", "strategy": strategy, "parsed": result}


# ==================== 模拟盘 ====================

# 全局模拟盘任务管理
_paper_trade_tasks: dict[str, asyncio.Task] = {}


class PaperTradeRequest(BaseModel):
    strategy: str
    symbol: str = "600519"
    capital: float = 1_000_000
    interval: int = 3  # 秒


@app.post("/paper-trade/start")
async def start_paper_trade(req: PaperTradeRequest):
    """启动模拟盘"""
    task_key = f"{req.strategy}_{req.symbol}"
    if task_key in _paper_trade_tasks and not _paper_trade_tasks[task_key].done():
        raise HTTPException(400, "该策略已在运行中")

    _paper_trade_tasks[task_key] = asyncio.create_task(
        _run_paper_trade(req.strategy, req.symbol, req.capital, req.interval)
    )
    return {"status": "started", "task_key": task_key}


@app.post("/paper-trade/stop")
async def stop_paper_trade(req: PaperTradeRequest):
    """停止模拟盘"""
    task_key = f"{req.strategy}_{req.symbol}"
    task = _paper_trade_tasks.get(task_key)
    if task and not task.done():
        task.cancel()
    _paper_trade_tasks.pop(task_key, None)
    return {"status": "stopped", "task_key": task_key}


@app.get("/paper-trade/status")
async def paper_trade_status():
    """查看所有模拟盘状态"""
    running = []
    for key, task in _paper_trade_tasks.items():
        if not task.done():
            running.append(key)
    return {"running": running}


def _fetch_realtime_quote(symbol: str) -> dict | None:
    """从新浪/腾讯获取实时行情（免费，盘中3-5秒延迟）"""
    import requests as req
    prefix = "sh" if symbol.startswith("6") else "sz"
    code = f"{prefix}{symbol}"

    # 新浪行情
    try:
        r = req.get(
            f"https://hq.sinajs.cn/list={code}",
            headers={"Referer": "https://finance.sina.com.cn"}, timeout=3,
        )
        parts = r.text.split('"')[1].split(",")
        if len(parts) > 30 and parts[3]:
            return {
                "name": parts[0], "price": float(parts[3]),
                "open": float(parts[1]), "pre_close": float(parts[2]),
                "high": float(parts[4]), "low": float(parts[5]),
                "volume": float(parts[8]), "time": parts[30],
                "source": "sina",
            }
    except Exception:
        pass

    # 腾讯行情（备选）
    try:
        r = req.get(f"https://qt.gtimg.cn/q={code}", timeout=3)
        parts = r.text.split("~")
        if len(parts) > 40 and parts[3]:
            return {
                "name": parts[1], "price": float(parts[3]),
                "open": float(parts[5]), "pre_close": float(parts[4]),
                "high": float(parts[33]), "low": float(parts[34]),
                "volume": float(parts[6]) * 100,  # 腾讯单位是手
                "time": parts[30], "source": "tencent",
            }
    except Exception:
        pass

    return None


async def _run_paper_trade(strategy: str, symbol: str, capital: float, interval: int):
    """模拟盘后台任务：真实历史数据初始化 + 实时行情驱动"""
    import random
    from vnpy.trader.object import BarData
    from vnpy.trader.constant import Exchange, Interval
    from datetime import datetime, timedelta

    strategy_info = STRATEGIES.get(strategy)
    if not strategy_info:
        return

    # 1) 用 baostock 获取最近 200 天真实历史数据
    real_prices = []
    try:
        import baostock as bs
        bs.login()
        bs_symbol = f"sh.{symbol}" if symbol.startswith("6") else f"sz.{symbol}"
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=300)).strftime("%Y-%m-%d")
        rs = bs.query_history_k_data_plus(
            bs_symbol, "date,open,high,low,close,volume",
            start_date=start_date, end_date=end_date,
            frequency="d", adjustflag="2",
        )
        while rs.next():
            row = rs.get_row_data()
            try:
                real_prices.append({
                    "date": row[0],
                    "open": float(row[1]), "high": float(row[2]),
                    "low": float(row[3]), "close": float(row[4]),
                    "volume": float(row[5]) if row[5] else 0,
                })
            except (ValueError, IndexError):
                continue
        bs.logout()
    except Exception as e:
        print(f"[模拟盘] 获取历史数据失败: {e}")

    if not real_prices:
        await ws_manager.broadcast("paper-trade", {
            "action": "错误", "strategy": strategy, "symbol": symbol,
            "message": "无法获取历史数据", "time": datetime.now().strftime("%H:%M:%S"),
        })
        return

    # 2) 获取实时行情作为初始价格
    quote = await asyncio.to_thread(_fetch_realtime_quote, symbol)
    if quote:
        price = quote["price"]
        prev_close = quote["pre_close"]
        source = quote["source"]
        msg = f"实时行情: ¥{price:.2f} (来源: {source})"
    else:
        price = real_prices[-1]["close"]
        prev_close = real_prices[-2]["close"] if len(real_prices) > 1 else price
        source = "历史"
        msg = f"使用历史收盘价: ¥{price:.2f}"

    pos = 0
    entry_price = 0.0

    await ws_manager.broadcast("paper-trade", {
        "action": "启动", "strategy": strategy, "symbol": symbol,
        "price": round(price, 2), "history_bars": len(real_prices),
        "message": f"已加载 {len(real_prices)} 天数据，{msg}",
        "time": datetime.now().strftime("%H:%M:%S"),
    })

    try:
        while True:
            # 3) 每次循环获取最新实时价格（盘中3-5秒刷新）
            new_quote = await asyncio.to_thread(_fetch_realtime_quote, symbol)
            if new_quote and new_quote["price"] > 0:
                price = new_quote["price"]
                source = new_quote["source"]
            else:
                # 非交易时段：小幅随机波动模拟
                import random as _rand
                price *= (1 + _rand.gauss(0, 0.003))
                source = "模拟"

            now = datetime.now()
            daily_change = (price - prev_close) / prev_close if prev_close > 0 else 0

            signal_data = {
                "time": now.strftime("%H:%M:%S"),
                "price": round(price, 2),
                "change_pct": round(daily_change * 100, 2),
                "strategy": strategy, "symbol": symbol,
                "source": source,
            }

            if daily_change > 0.008 and pos == 0:
                pos = 100
                entry_price = price
                signal_data["action"] = "买入"
                signal_data["pos"] = pos
            elif daily_change < -0.008 and pos > 0:
                pnl = (price - entry_price) / entry_price * 100
                pos = 0
                signal_data["action"] = "卖出"
                signal_data["pnl"] = round(pnl, 2)
                signal_data["pos"] = 0
            else:
                signal_data["action"] = "持仓" if pos > 0 else "观望"
                signal_data["pos"] = pos
                if pos > 0:
                    signal_data["pnl"] = round((price - entry_price) / entry_price * 100, 2)

            prev_close = price
            await ws_manager.broadcast("paper-trade", signal_data)
            await asyncio.sleep(interval)

    except asyncio.CancelledError:
        await ws_manager.broadcast("paper-trade", {
            "action": "停止", "strategy": strategy, "symbol": symbol,
            "time": datetime.now().strftime("%H:%M:%S"),
        })
