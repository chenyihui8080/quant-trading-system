"""SimNow 模拟盘交易脚本（Docker 内运行）
凭证优先从环境变量读取，其次从 config.json 读取
"""
import json
import os
import sys
import signal
import time
from datetime import datetime
from pathlib import Path

from vnpy.event import EventEngine
from vnpy.trader.engine import MainEngine
from vnpy.trader.object import SubscribeRequest, LogData
from vnpy.trader.constant import Exchange
from vnpy_ctp import CtpGateway
from vnpy.event import EVENT_LOG

# 策略映射
STRATEGY_MAP = {
    "dual_ma": ("strategies.dual_ma", "DualMaStrategy"),
    "macd": ("strategies.macd", "MacdStrategy"),
    "bollinger": ("strategies.bollinger", "BollingerStrategy"),
    "rsi": ("strategies.rsi", "RsiStrategy"),
    "kdj": ("strategies.kdj", "KdjStrategy"),
    "turtle": ("strategies.turtle", "TurtleStrategy"),
    "grid": ("strategies.grid", "GridStrategy"),
}


def load_config():
    """加载配置，凭证优先从环境变量读取"""
    config_path = Path(__file__).parent / "config.json"
    with open(config_path) as f:
        config = json.load(f)

    # 环境变量覆盖（Docker 运行时注入）
    config["username"] = os.getenv("SIMNOW_USER", config.get("username", ""))
    config["password"] = os.getenv("SIMNOW_PASS", config.get("password", ""))

    if not config["username"] or not config["password"]:
        print("错误: 未配置 SimNow 凭证，请设置环境变量 SIMNOW_USER / SIMNOW_PASS 或填写 config.json")
        sys.exit(1)

    return config


def on_log(event):
    log: LogData = event.data
    print(f"[{log.time}] {log.gateway_name}: {log.msg}")


def main():
    config = load_config()

    print("=" * 50)
    print("SimNow 模拟盘交易系统")
    print(f"策略: {config['strategy']}")
    print(f"品种: {config['symbols']}")
    print(f"时间: {datetime.now()}")
    print("=" * 50)

    # 初始化引擎
    event_engine = EventEngine()
    event_engine.register(EVENT_LOG, on_log)
    main_engine = MainEngine(event_engine)

    # 添加 CTP 网关
    main_engine.add_gateway(CtpGateway)

    # 连接 SimNow
    ctp_setting = {
        "用户名": config["username"],
        "密码": config["password"],
        "经纪商代码": config["brokerid"],
        "交易服务器": config["td_address"],
        "行情服务器": config["md_address"],
        "产品名称": config.get("appid", "simnow_client_test"),
        "授权编码": config.get("auth_code", "0000000000000000"),
    }
    main_engine.connect(ctp_setting, "CTP")
    print("正在连接 SimNow...")

    time.sleep(10)  # 等待连接完成

    # 订阅行情
    for symbol in config["symbols"]:
        parts = symbol.split(".")
        code = parts[0]
        exchange = Exchange.SSE if parts[1] == "SSE" else Exchange.SZE
        req = SubscribeRequest(symbol=code, exchange=exchange)
        main_engine.subscribe(req, "CTP")
        print(f"已订阅: {symbol}")

    print("\n模拟盘运行中，按 Ctrl+C 停止...")

    # 保持运行
    def shutdown(signum, frame):
        print("\n正在断开连接...")
        main_engine.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        time.sleep(1)


if __name__ == "__main__":
    main()
