"""项目配置"""
import os
from pathlib import Path

# 路径配置
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
LOG_DIR = PROJECT_ROOT / "logs"

# 回测配置
BACKTEST_CONFIG = {
    "rate": 0.0003,         # 手续费率
    "slippage": 0.2,        # 滑点
    "size": 1,              # 合约乘数（股票按手=100股）
    "pricetick": 0.01,      # 最小价格变动
    "capital": 1_000_000,   # 初始资金
}

# API 配置
API_HOST = "0.0.0.0"
API_PORT = 8000

# 已注册策略
STRATEGIES = {
    "dual_ma": {
        "name": "双均线策略",
        "module": "strategies.dual_ma",
        "class": "DualMaStrategy",
        "desc": "快慢均线金叉死叉，经典趋势跟踪",
    },
    "macd": {
        "name": "MACD 策略",
        "module": "strategies.macd",
        "class": "MacdStrategy",
        "desc": "MACD 金叉死叉 + 零轴过滤",
    },
    "bollinger": {
        "name": "布林带策略",
        "module": "strategies.bollinger",
        "class": "BollingerStrategy",
        "desc": "布林带突破/回归策略",
    },
    "rsi": {
        "name": "RSI 策略",
        "module": "strategies.rsi",
        "class": "RsiStrategy",
        "desc": "RSI 超买超卖反转策略",
    },
    "kdj": {
        "name": "KDJ 策略",
        "module": "strategies.kdj",
        "class": "KdjStrategy",
        "desc": "KDJ 金叉死叉 + 超买超卖过滤",
    },
    "turtle": {
        "name": "海龟策略",
        "module": "strategies.turtle",
        "class": "TurtleStrategy",
        "desc": "唐奇安通道突破，经典趋势跟踪",
    },
    "grid": {
        "name": "网格交易",
        "module": "strategies.grid",
        "class": "GridStrategy",
        "desc": "固定百分比网格，下跌买上涨卖",
    },
}

# LLM 配置（可选，不配置则仅使用正则解析）
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_API_URL = os.getenv("LLM_API_URL", "https://api.openai.com/v1/chat/completions")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
