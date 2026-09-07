"""
X (Twitter) 顶级博主与关注流实时情报雷达 (Twitter Intelligence Monitor)

功能特色：
1. 支持使用用户真实推特凭证 (Cookie / auth_token + ct0)，走本地代理实时拉取关注流 (Home Timeline)
2. 自动中英智能翻译：海外大 V 英文推文毫秒级对照翻译为简体中文
3. A 股科技概念与龙头标的智能打标：自动识别英伟达链、特斯拉 FSD、算力光模块、AI 智能体、美联储等宏观与产业概念
4. 代理与网络安全：严格使用本地已有代理 (127.0.0.1:7897)，绝不篡改系统网络
5. 优雅容灾与降级：若凭证过期或网络瞬断，平滑提示并提供精选演示情报，绝不导致系统报崩
"""

import os
import json
import copy
import time
import threading
import concurrent.futures
import sqlite3
import re
from datetime import datetime, timezone
import logging
import urllib.parse
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, asdict
from pathlib import Path
import requests

try:
    import jieba
except ImportError:
    jieba = None


def tokenize_for_fts5(text: str) -> str:
    """使用 jieba 分词生成适配 SQLite FTS5 全文检索引擎的词序列 (中文分词+英文+股票代码)"""
    if not text:
        return ""
    if jieba is not None:
        try:
            tokens = [w.strip() for w in jieba.cut_for_search(text) if w.strip()]
            return " ".join(tokens)
        except Exception:
            pass
    return " ".join(text.split())

# 日志器配置
logger = logging.getLogger("TwitterMonitor")

# 持久化配置文件与数据库路径
DATA_DIR = Path(__file__).parent.parent / "data"
CONFIG_FILE_PATH = DATA_DIR / "twitter_config.json"
DB_FILE_PATH = DATA_DIR / "twitter_intel.db"
AUTHORS_CUSTOM_FILE = DATA_DIR / "twitter_authors_custom.json"

# 推特官方 Web Client 公共 Bearer Token
TWITTER_BEARER_TOKEN = (
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)

# 默认本地代理地址 (Clash Verge / Mihomo 本地端口)
DEFAULT_PROXY_URL = os.getenv("TWITTER_PROXY", "http://127.0.0.1:7897")

# ==================== 重点股票代码与名称智能识别词库 ====================
FAMOUS_STOCKS_DICT = {
    # 美股核心巨头与热点
    "NVDA": {"symbol": "NVDA", "name": "英伟达", "market": "US"},
    "TSLA": {"symbol": "TSLA", "name": "特斯拉", "market": "US"},
    "AAPL": {"symbol": "AAPL", "name": "苹果", "market": "US"},
    "MSFT": {"symbol": "MSFT", "name": "微软", "market": "US"},
    "GOOGL": {"symbol": "GOOGL", "name": "谷歌", "market": "US"},
    "GOOG": {"symbol": "GOOG", "name": "谷歌", "market": "US"},
    "AMZN": {"symbol": "AMZN", "name": "亚马逊", "market": "US"},
    "META": {"symbol": "META", "name": "Meta", "market": "US"},
    "AMD": {"symbol": "AMD", "name": "超威半导体", "market": "US"},
    "AVGO": {"symbol": "AVGO", "name": "博通", "market": "US"},
    "TSM": {"symbol": "TSM", "name": "台积电", "market": "US"},
    "ASML": {"symbol": "ASML", "name": "阿斯麦", "market": "US"},
    "PLTR": {"symbol": "PLTR", "name": "Palantir", "market": "US"},
    "COIN": {"symbol": "COIN", "name": "Coinbase", "market": "US"},
    "BABA": {"symbol": "BABA", "name": "阿里巴巴", "market": "US"},
    "BIDU": {"symbol": "BIDU", "name": "百度", "market": "US"},
    "TCEHY": {"symbol": "TCEHY", "name": "腾讯", "market": "US"},
    # 常用中文股名映射
    "英伟达": {"symbol": "NVDA", "name": "英伟达", "market": "US"},
    "特斯拉": {"symbol": "TSLA", "name": "特斯拉", "market": "US"},
    "苹果": {"symbol": "AAPL", "name": "苹果", "market": "US"},
    "微软": {"symbol": "MSFT", "name": "微软", "market": "US"},
    "谷歌": {"symbol": "GOOGL", "name": "谷歌", "market": "US"},
    "亚马逊": {"symbol": "AMZN", "name": "亚马逊", "market": "US"},
    "台积电": {"symbol": "TSM", "name": "台积电", "market": "US"},
    "中际旭创": {"symbol": "300308", "name": "中际旭创", "market": "A"},
    "新易盛": {"symbol": "300502", "name": "新易盛", "market": "A"},
    "天孚通信": {"symbol": "300394", "name": "天孚通信", "market": "A"},
    "浪潮信息": {"symbol": "000977", "name": "浪潮信息", "market": "A"},
    "赛力斯": {"symbol": "601127", "name": "赛力斯", "market": "A"},
    "中芯国际": {"symbol": "688981", "name": "中芯国际", "market": "A"},
    "北方华创": {"symbol": "002371", "name": "北方华创", "market": "A"},
    "海光信息": {"symbol": "688041", "name": "海光信息", "market": "A"},
    "寒武纪": {"symbol": "688256", "name": "寒武纪", "market": "A"},
    "三花智控": {"symbol": "002050", "name": "三花智控", "market": "A"},
    "德赛西威": {"symbol": "002920", "name": "德赛西威", "market": "A"}
}


# ==================== A 股核心概念与标的映射库 ====================
A_SHARE_CONCEPT_MAPPING = [
    {
        "keywords": ["robotaxi", "fsd", "tesla", "cybercab", "autonomous driving", "自动驾驶", "无人驾驶", "特斯拉", "马斯克"],
        "concept": "特斯拉链 / 智能驾驶龙头",
        "stocks": [
            {"symbol": "002050", "name": "三花智控", "desc": "热管理与执行器龙头"},
            {"symbol": "601689", "name": "拓普集团", "desc": "底盘轻量化与线控执行器"},
            {"symbol": "002920", "name": "德赛西威", "desc": "高算力智驾域控制器"},
            {"symbol": "002703", "name": "浙江世宝", "desc": "智能转向与线控底盘"}
        ]
    },
    {
        "keywords": ["nvidia", "blackwell", "b200", "b100", "gpu", "cuda", "jensen huang", "英伟达", "算力", "黄仁勋", "光模块"],
        "concept": "英伟达链 / 算力光模块",
        "stocks": [
            {"symbol": "300308", "name": "中际旭创", "desc": "全球 800G/1.6T 光模块绝对龙头"},
            {"symbol": "300502", "name": "新易盛", "desc": "北美大客户核心光模块供应商"},
            {"symbol": "300394", "name": "天孚通信", "desc": "光器件精密无源有源封装"},
            {"symbol": "000977", "name": "浪潮信息", "desc": "AI 高性能服务器出货龙头"}
        ]
    },
    {
        "keywords": ["openai", "chatgpt", "gpt-5", "gpt-6", "sora", "sam altman", "ai agent", "claude", "anthropic", "大模型", "智能体"],
        "concept": "生成式 AI / 大模型应用",
        "stocks": [
            {"symbol": "002230", "name": "科大讯飞", "desc": "星火大模型与产业落地核心"},
            {"symbol": "300418", "name": "昆仑万维", "desc": "天工 AI 与出海垂类应用"},
            {"symbol": "688787", "name": "海天瑞声", "desc": "AI 训练数据工程基石"}
        ]
    },
    {
        "keywords": ["apple", "iphone", "apple intelligence", "tim cook", "vision pro", "苹果", "果链"],
        "concept": "苹果链 / 端侧 AI 硬件",
        "stocks": [
            {"symbol": "002475", "name": "立讯精密", "desc": "果链精密制造集成总龙头"},
            {"symbol": "002241", "name": "歌尔股份", "desc": "精密声学与 MR 模组核心"},
            {"symbol": "300433", "name": "蓝思科技", "desc": "视窗防护屏与外观结构件"}
        ]
    },
    {
        "keywords": ["spacex", "starlink", "starship", "falcon", "satellite", "星链", "商业航天", "低轨卫星"],
        "concept": "商业航天 / 卫星互联网",
        "stocks": [
            {"symbol": "600118", "name": "中国卫星", "desc": "小卫星制造与总体研制总包"},
            {"symbol": "600879", "name": "航天电子", "desc": "星载测控通信与惯性制导"},
            {"symbol": "300045", "name": "华力创通", "desc": "卫星通信天通基带芯片"}
        ]
    },
    {
        "keywords": ["fed", "rate cut", "interest rate", "cpi", "powell", "inflation", "美联储", "降息", "加息", "鲍威尔", "黄金"],
        "concept": "宏观货币宽松 / 黄金资源",
        "stocks": [
            {"symbol": "600547", "name": "山东黄金", "desc": "央行购金与利率对冲避险"},
            {"symbol": "601899", "name": "紫金矿业", "desc": "全球化金铜矿业巨头"}
        ]
    },
    {
        "keywords": ["semiconductor", "tsmc", "asml", "lithography", "chip", "semis", "台积电", "光刻机", "芯片", "半导体"],
        "concept": "半导体设备 / 国产替代",
        "stocks": [
            {"symbol": "688981", "name": "中芯国际", "desc": "国内晶圆先进制程制造中枢"},
            {"symbol": "002371", "name": "北方华创", "desc": "半导体刻蚀与薄膜沉积装备领军"},
            {"symbol": "688012", "name": "中微公司", "desc": "先进制程刻蚀机核心标的"}
        ]
    },
    {
        "keywords": ["海南", "海南板块", "海南自贸港", "离岛免税", "封关"],
        "concept": "海南自贸港 / 区域题材",
        "stocks": [
            {"symbol": "600515", "name": "海南机场", "desc": "自贸港免税与客流中枢"},
            {"symbol": "600221", "name": "海航控股", "desc": "海南本土主基地航司龙头"},
            {"symbol": "000571", "name": "新大洲A", "desc": "海南本土综合产业与投资"}
        ]
    },
    {
        "keywords": ["农业", "农业板块", "防御板块", "生猪", "粮食", "种业", "养殖"],
        "concept": "防御板块 / 农业与养殖",
        "stocks": [
            {"symbol": "159020", "name": "养殖ETF", "desc": "防御周期性农业养殖配置"},
            {"symbol": "002041", "name": "登海种业", "desc": "玉米杂交种业科研领头"},
            {"symbol": "600359", "name": "新农开发", "desc": "西北特色农业与棉花种业"}
        ]
    },
    {
        "keywords": ["影视", "AI影视", "短剧", "传媒", "游戏", "文化传媒"],
        "concept": "AI影视传媒 / 文化内容",
        "stocks": [
            {"symbol": "605577", "name": "龙版传媒", "desc": "多模态数字版权与文化出版"},
            {"symbol": "001330", "name": "博纳影业", "desc": "院线大片与主旋律电影全产业链"},
            {"symbol": "300413", "name": "芒果超媒", "desc": "国有长视频平台与短剧商业化"}
        ]
    }
]

# ⭐️ 用户最高优先级 VIP 重点关注博主名单 (默认加权置顶)
VIP_AUTHORS = ["snake_w", "Crypto/戒色交易员", "戒色交易员"]

# ==================== 博主专业归类体系与档案画像 ====================
# 1. 4 大分类元数据体系 (对齐 Element Plus 视觉体系)
AUTHOR_CATEGORIES_METADATA = {
    "A_STOCK": {
        "key": "A_STOCK",
        "name": "A股实盘与战法",
        "short_name": "A股实战",
        "badge": "A股实战",
        "color": "danger",
        "icon": "ri-vip-crown-fill",
        "is_stock_related": True,
        "priority": 1,
        "desc": "专注A股实盘、仓位管理、板块轮动(海南/农业防御等)、买卖点与通达信指标"
    },
    "MACRO_GLOBAL": {
        "key": "MACRO_GLOBAL",
        "name": "宏观财经与全球资产",
        "short_name": "宏观美股",
        "badge": "宏观美股",
        "color": "primary",
        "icon": "ri-global-line",
        "is_stock_related": True,
        "priority": 2,
        "desc": "美联储政策、全球宏观流动性、离岸汇率、中概股与全球资本流动"
    },
    "TECH_INDUSTRY": {
        "key": "TECH_INDUSTRY",
        "name": "科技产业与供应链",
        "short_name": "科技产业",
        "badge": "科技产业",
        "color": "success",
        "icon": "ri-cpu-line",
        "is_stock_related": True,
        "priority": 3,
        "desc": "苹果供应链果链、华强北数码硬件行情、AI算力集群与半导体芯片产业"
    },
    "NON_STOCK": {
        "key": "NON_STOCK",
        "name": "社会资讯/币圈/生活",
        "short_name": "非股票资讯",
        "badge": "非股票资讯",
        "color": "info",
        "icon": "ri-cup-line",
        "is_stock_related": False,
        "priority": 4,
        "desc": "社会突发事件、网络随笔与加密货币推广（系统支持一键过滤屏蔽）"
    }
}

# 2. 全量 29 位博主详细画像与分类字典
AUTHOR_PROFILE_MAP = {
    # ── 👑 A股实盘与战法 (核心关注) ──
    "snake_w": {
        "category": "A_STOCK",
        "name": "Crypto/戒色交易员",
        "is_vip": True,
        "desc": "【特级重点关注 VIP】仓位管理、大盘窄幅震荡预判、海南/农业防御板块与通达信指标",
        "focus_topics": ["大盘震荡", "海南板块", "农业防御", "通达信指标", "实盘仓位"]
    },
    "dacefupan": {
        "category": "A_STOCK",
        "name": "🇨🇳 大策复盘",
        "is_vip": False,
        "desc": "A股盘后全市场复盘、连板热点梯队与短线情绪周期分析",
        "focus_topics": ["每日大盘复盘", "连板梯队", "短线情绪", "热点题材"]
    },
    "aiwangupiao": {
        "category": "A_STOCK",
        "name": "爱玩股票AiWanGuPiao",
        "is_vip": False,
        "desc": "短线选股策略、买卖点量化判定与实盘操作心得",
        "focus_topics": ["短线选股", "实战买卖点", "量化波段"]
    },
    "xiajingfa8": {
        "category": "A_STOCK",
        "name": "证势交易",
        "is_vip": False,
        "desc": "盘面技术形态、趋势推演与实盘交易系统构建",
        "focus_topics": ["趋势推演", "技术形态", "交易系统"]
    },

    # ── 🌐 宏观财经与全球资产 ──
    "asiafinance": {
        "category": "MACRO_GLOBAL",
        "name": "亚洲金融 Asia Finance",
        "is_vip": False,
        "desc": "亚太资本流动、中概股深度剖析、外资动向与宏观金融大事件",
        "focus_topics": ["亚太资本", "中概股", "外资流动", "宏观金融"]
    },
    "supfin": {
        "category": "MACRO_GLOBAL",
        "name": "超级财经 SuperFinance",
        "is_vip": False,
        "desc": "全球跨国企业财报、美联储宏观经济数据与金融市场联动",
        "focus_topics": ["美联储政策", "全球财报", "宏观利率"]
    },
    "ifinance": {
        "category": "MACRO_GLOBAL",
        "name": "iFinance",
        "is_vip": False,
        "desc": "全球指数、外汇大宗与美股市场快速行情速递",
        "focus_topics": ["全球指数", "美股行情", "大宗商品"]
    },
    "globalmoney": {
        "category": "MACRO_GLOBAL",
        "name": "全球货币 Global Money",
        "is_vip": False,
        "desc": "全球离岸人民币、美元指数与央行外汇货币政策分析",
        "focus_topics": ["货币政策", "汇率波动", "央行流动性"]
    },
    "ceobriefing": {
        "category": "MACRO_GLOBAL",
        "name": "总裁简报 CEO Briefing",
        "is_vip": False,
        "desc": "商业经济要闻、宏观产业政策与跨国巨头战略动向",
        "focus_topics": ["商业经济", "宏观政策", "跨国巨头"]
    },

    # ── ⚡ 科技产业与供应链 ──
    "stanleysobest": {
        "category": "TECH_INDUSTRY",
        "name": "Stanley",
        "is_vip": False,
        "desc": "苹果供应链（立讯/歌尔/蓝思等）、消费电子、iPhone及数码科技硬件",
        "focus_topics": ["果链代工", "消费电子", "手机供应链", "科技硬件"]
    },
    "weiyux2021": {
        "category": "TECH_INDUSTRY",
        "name": "动物园园长",
        "is_vip": False,
        "desc": "华强北电子行情、元器件芯片流通价格、数码硬件供应链一手动态",
        "focus_topics": ["华强北电子", "数码硬件", "元器件行情", "供应链流通"]
    },
    "vincent_ainotes": {
        "category": "TECH_INDUSTRY",
        "name": "Vincent",
        "is_vip": False,
        "desc": "AI Agent、智能体落地框架、英伟达 Blackwell 算力集群与大模型应用",
        "focus_topics": ["AI Agent", "英伟达算力", "大模型落地", "光模块算力"]
    },
    "berryxia": {
        "category": "TECH_INDUSTRY",
        "name": "Berryxia.AI",
        "is_vip": False,
        "desc": "生成式 AI 应用评测、AI 生产力工具与前沿科技创新",
        "focus_topics": ["AI应用工具", "大模型前沿", "科技软件生态"]
    },
    "aleabitoreddit": {
        "category": "TECH_INDUSTRY",
        "name": "Serenity",
        "is_vip": False,
        "desc": "先进制程芯片、激光与光刻设备、智能驾驶高精传感硬件",
        "focus_topics": ["半导体芯片", "光刻激光", "智驾硬件"]
    },
    "brand": {
        "category": "TECH_INDUSTRY",
        "name": "BrandAI",
        "is_vip": False,
        "desc": "前沿人工智能应用与设计开发技术动态",
        "focus_topics": ["人工智能", "软件开发", "交互体验"]
    },
    "dilumsanjaya": {
        "category": "TECH_INDUSTRY",
        "name": "Dilum Sanjaya",
        "is_vip": False,
        "desc": "前沿软件架构与数字技术生态",
        "focus_topics": ["技术生态", "软件工程"]
    },

    # ── ☕ 社会资讯/币圈/生活 (非股票资讯，可一键屏蔽) ──
    "whyyoutouzhele": {
        "category": "NON_STOCK",
        "name": "李老师不是你老师",
        "is_vip": False,
        "desc": "【非股票资讯】国内外突发社会时事事件通报（非财经投资类）",
        "focus_topics": ["社会新闻", "突发时事"]
    },
    "hanpaoao": {
        "category": "NON_STOCK",
        "name": "韩跑跑",
        "is_vip": False,
        "desc": "【非股票资讯】日常生活与网络随感（非股票）",
        "focus_topics": ["生活随笔", "日常感悟"]
    },
    "sunyuchentron": {
        "category": "NON_STOCK",
        "name": "孙宇晨（去过太空版）🧑‍🚀",
        "is_vip": False,
        "desc": "【非股票资讯】波场 TRON 生态与加密货币个人营销",
        "focus_topics": ["加密货币", "波场TRON"]
    },
    "justinsuntron": {
        "category": "NON_STOCK",
        "name": "H.E. Justin Sun 👨‍🚀 🌞",
        "is_vip": False,
        "desc": "【非股票资讯】加密货币海外动态",
        "focus_topics": ["加密货币"]
    },
    "huobiglobal": {
        "category": "NON_STOCK",
        "name": "火币HTX",
        "is_vip": False,
        "desc": "【非股票资讯】加密货币交易所平台推广与活动通知",
        "focus_topics": ["加密交易所", "平台活动"]
    },
    "baby__btc": {
        "category": "NON_STOCK",
        "name": "Tonys🔸Tucker｜「火币余币宝13%」",
        "is_vip": False,
        "desc": "【非股票资讯】币圈理财推广与合约推广",
        "focus_topics": ["币圈理财", "加密推广"]
    },
    "wolfyxbt": {
        "category": "NON_STOCK",
        "name": "杀破狼 WolfyXBT",
        "is_vip": False,
        "desc": "【非股票资讯】纯加密货币合约与炒币动态",
        "focus_topics": ["炒币合约", "纯加密货币"]
    },
    "0xmoon": {
        "category": "NON_STOCK",
        "name": "0xMoon",
        "is_vip": False,
        "desc": "【非股票资讯】Web3 链上代币动态",
        "focus_topics": ["链上代币", "Web3"]
    },
    "akokoi1": {
        "category": "NON_STOCK",
        "name": "WY",
        "is_vip": False,
        "desc": "【非股票资讯】个人日常随笔与随感",
        "focus_topics": ["生活杂谈"]
    },
    "shanghaojin": {
        "category": "NON_STOCK",
        "name": "Herman Jin",
        "is_vip": False,
        "desc": "【非股票资讯】海外个人随笔与生活观察",
        "focus_topics": ["生活观察"]
    },
    "realpurenomad": {
        "category": "NON_STOCK",
        "name": "Pure Nomad",
        "is_vip": False,
        "desc": "【非股票资讯】数字游民生活与海外见闻",
        "focus_topics": ["数字游民"]
    },
    "_forab": {
        "category": "NON_STOCK",
        "name": "AB Kuai.Dong",
        "is_vip": False,
        "desc": "【非股票资讯】产品使用日常闲聊",
        "focus_topics": ["日常闲聊"]
    },
    "ring_hyacinth": {
        "category": "NON_STOCK",
        "name": "Ring Hyacinth",
        "is_vip": False,
        "desc": "【非股票资讯】个人日常观点",
        "focus_topics": ["日常随笔"]
    },

    # ── 💡 系统精选/推荐大V (Curated) ──
    "elonmusk": {
        "category": "TECH_INDUSTRY",
        "source_type": "curated",
        "name": "Elon Musk",
        "is_vip": False,
        "desc": "【系统精选】特斯拉、SpaceX、xAI 创始人，全球科技与智能硬件风向标",
        "focus_topics": ["特斯拉", "Robotaxi", "FSD", "xAI", "算力集群"]
    },
    "sama": {
        "category": "TECH_INDUSTRY",
        "source_type": "curated",
        "name": "Sam Altman",
        "is_vip": False,
        "desc": "【系统精选】OpenAI CEO，大模型与生成式 AI 算力基础设施战略",
        "focus_topics": ["OpenAI", "ChatGPT", "算力集群", "AI智能体"]
    },
    "tier10k": {
        "category": "MACRO_GLOBAL",
        "source_type": "curated",
        "name": "tier10k",
        "is_vip": False,
        "desc": "【系统精选】华尔街突发金融要闻、美联储政策与全球快讯",
        "focus_topics": ["美联储", "全球宏观快讯", "美股异动"]
    },
    "zerohedge": {
        "category": "MACRO_GLOBAL",
        "source_type": "curated",
        "name": "ZeroHedge",
        "is_vip": False,
        "desc": "【系统精选】全球宏观流动性、美债收益率、地缘政治与对冲基金深度投研",
        "focus_topics": ["宏观对冲", "流动性", "美债市场"]
    },
    "wublockchain": {
        "category": "NON_STOCK",
        "source_type": "curated",
        "name": "吴说区块链",
        "is_vip": False,
        "desc": "【系统精选】加密货币行业动态与海外监管跟踪",
        "focus_topics": ["加密监管", "Web3动态"]
    }
}

# 默认博主分类深拷贝备份 (供一键重置使用)
DEFAULT_AUTHOR_PROFILE_MAP = copy.deepcopy(AUTHOR_PROFILE_MAP)


def resolve_author_profile(author_handle: str = "", author_name: str = "") -> Dict[str, Any]:
    """根据博主 handle 或 name 智能解析其分类与归属档案 (含 source_type: following / curated)"""
    clean_h = (author_handle or "").lower().replace("@", "").strip()
    clean_n = (author_name or "").strip()

    # 1. 精确句柄匹配
    if clean_h in AUTHOR_PROFILE_MAP:
        prof = dict(AUTHOR_PROFILE_MAP[clean_h])
        cat_meta = AUTHOR_CATEGORIES_METADATA.get(prof["category"], AUTHOR_CATEGORIES_METADATA["NON_STOCK"])
        prof["handle"] = clean_h
        prof["source_type"] = prof.get("source_type", "following")
        prof["source_type_name"] = "我关注的" if prof["source_type"] == "following" else "系统精选"
        prof["category_name"] = cat_meta["name"]
        prof["category_short_name"] = cat_meta["short_name"]
        prof["category_badge"] = cat_meta["badge"]
        prof["category_color"] = cat_meta["color"]
        prof["category_icon"] = cat_meta["icon"]
        prof["is_stock_related"] = cat_meta["is_stock_related"]
        return prof

    # 2. VIP 交易员模糊匹配
    if "snake_w" in clean_h or "戒色" in clean_n:
        prof = dict(AUTHOR_PROFILE_MAP["snake_w"])
        cat_meta = AUTHOR_CATEGORIES_METADATA["A_STOCK"]
        prof["handle"] = "snake_w"
        prof["source_type"] = "following"
        prof["source_type_name"] = "我关注的"
        prof["category_name"] = cat_meta["name"]
        prof["category_short_name"] = cat_meta["short_name"]
        prof["category_badge"] = cat_meta["badge"]
        prof["category_color"] = cat_meta["color"]
        prof["category_icon"] = cat_meta["icon"]
        prof["is_stock_related"] = True
        return prof

    # 3. 常见非股票特征识别
    non_stock_keywords = ["btc", "eth", "crypto", "token", "swap", "usdt", "李老师", "韩跑跑", "孙宇晨"]
    is_non_stock = any(k in clean_h or k in clean_n.lower() for k in non_stock_keywords)

    # 4. 股票与财经特征识别
    stock_keywords = ["股票", "复盘", "交易", "证券", "财经", "finance", "stock", "alpha"]
    is_stock = any(k in clean_h or k in clean_n.lower() for k in stock_keywords)

    if is_stock:
        cat_key = "A_STOCK"
    elif is_non_stock:
        cat_key = "NON_STOCK"
    else:
        cat_key = "NON_STOCK"

    cat_meta = AUTHOR_CATEGORIES_METADATA[cat_key]
    return {
        "category": cat_key,
        "source_type": "following",
        "source_type_name": "我关注的",
        "name": clean_n or clean_h,
        "handle": clean_h,
        "is_vip": False,
        "desc": f"归类为 {cat_meta['name']}",
        "focus_topics": [],
        "category_name": cat_meta["name"],
        "category_short_name": cat_meta["short_name"],
        "category_badge": cat_meta["badge"],
        "category_color": cat_meta["color"],
        "category_icon": cat_meta["icon"],
        "is_stock_related": cat_meta["is_stock_related"]
    }


# A 股实战盘面与交易术语关键词库 (命中即归入实战干货，非无关闲聊)
A_SHARE_TRADING_KEYWORDS = [
    "板块", "大盘", "指数", "上证", "创业板", "科创板", "仓位", "大仓位", "轻仓", "空仓",
    "建仓", "加仓", "减仓", "清仓", "止损", "止盈", "震荡", "方向", "买点", "卖点", "抄底",
    "追高", "打板", "洗盘", "突破", "通达信", "指标", "均线", "涨停", "跌停", "行情", "利好",
    "利空", "主力", "主力资金", "防御板块", "低位板块", "海南板块", "农业板块", "智驾", "智能驾驶",
    "影视", "AI影视", "光模块", "机器人", "芯片", "半导体", "信创", "低空经济", "无人驾驶", "窄幅震荡"
]


@dataclass
class TwitterTweetItem:
    """推特情报单条数据模型"""
    id: str                               # 推文唯一 ID
    author_name: str                      # 博主昵称 (如 Elon Musk)
    author_handle: str                    # 博主推特号 (如 @elonmusk)
    author_avatar: str                    # 博主头像 URL
    created_at: str                       # 原始发布时间字符串
    relative_time: str                    # 友好相对时间 (如 5分钟前, 2小时前)
    text_raw: str                         # 英文/原文内容
    text_translated: str                  # 简体中文翻译 (中文推文则保持原文)
    likes: int                            # 点赞数
    retweets: int                         # 转发数
    tweet_url: str                        # 推特原文跳转链接
    related_concept: str                  # 关联的 A 股题材/概念
    related_stocks: List[Dict[str, str]]  # 关联核心 A 股标的列表
    sentiment: str                        # 情绪/催化打标 (利好催化 / 关注 / 风险 / 日常)
    has_stock_mention: bool = False       # ⭐️ 核心关键：是否直接提及了具体股票名或代码
    mentioned_stocks: List[Dict[str, str]] = None  # 具体直接提及的股票明细
    importance_score: int = 1             # 重要性评级 (3: 直接谈及股票标的[置顶/标星], 2: 核心产业链, 1: 宏观泛动态)
    is_demo: bool = False                 # 是否为演示模拟数据
    source_type: str = "following"        # ⭐️ 来源归属：following(我关注的), curated(系统精选)


class TwitterMonitorEngine:
    """推特博主与关注流实时监控引擎 (全面对标东方财富心跳保活与健康检测体系)"""

    def __init__(self):
        self.config: Dict[str, Any] = self._load_config()
        self._cached_tweets: List[TwitterTweetItem] = []
        self._last_fetch_time: float = 0.0
        self._cache_ttl_seconds: float = 45.0  # 缓存 45 秒，兼顾实时性与防风控
        self._fetch_lock = threading.Lock()     # 防并发穿透互斥锁
        self._translation_cache: Dict[str, str] = {}  # 翻译结果内存级 LRU 缓存
        self._init_db()  # 初始化 SQLite 本地持久化数据库

        # ==================== 对标东财的状态机与健康指标 ====================
        # auth_state: online(在线正常), expired(Cookie失效), network_error(网络/代理断连), unconfigured(未配置)
        self.auth_state: str = "online" if (self.config.get("auth_token") and self.config.get("ct0")) else "unconfigured"
        self.is_session_alive: bool = True if self.auth_state == "online" else False
        self.last_heartbeat_time: str = ""
        self.last_heartbeat_status: str = "就绪待探活"
        self.last_success_time: str = ""
        self.latest_tweet_time: str = ""
        self.latest_tweet_relative: str = ""
        self.data_freshness_desc: str = "尚未执行同步"
        self.consecutive_failures: int = 0
        self.last_error: str = ""

        # ==================== 定时日更与增量去重核心指标 ====================
        self.daily_sync_enabled: bool = True
        self.last_daily_sync_time: str = ""
        self.today_added_count: int = 0
        self.last_sync_result: Dict[str, Any] = {}

        # 启动时预热加载本地数据库中的历史数据至内存，确保永久数据持续在线
        self._preload_cache_from_db()
        # 启动后台常驻每日定时增量更新调度线程
        self._start_daily_scheduler()

    def _load_config(self) -> Dict[str, Any]:
        """从磁盘加载配置，不存在则创建默认模板"""
        default_cfg = {
            "auth_token": "",
            "ct0": "",
            "bearer_token": TWITTER_BEARER_TOKEN,
            "full_cookie": "",
            "proxy_url": DEFAULT_PROXY_URL,
            "monitored_users": ["elonmusk", "Sama", "tier10k", "WuBlockchain", "zerohedge"],
            "auto_translate": True,
            "fetch_interval_seconds": 60
        }
        if CONFIG_FILE_PATH.exists():
            try:
                with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    default_cfg.update(saved)
            except Exception as e:
                logger.error(f"读取推特配置文件失败，恢复默认配置: {e}")
        else:
            self._save_config_file(default_cfg)
        return default_cfg

    def _init_db(self):
        """初始化 SQLite 本地持久化数据库，确保推文数据永久沉淀，并构建 FTS5 全文检索引擎"""
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS twitter_tweets (
                        id TEXT PRIMARY KEY,
                        author_name TEXT,
                        author_handle TEXT,
                        author_avatar TEXT,
                        created_at TEXT,
                        created_timestamp REAL,
                        relative_time TEXT,
                        text_raw TEXT,
                        text_translated TEXT,
                        likes INTEGER,
                        retweets INTEGER,
                        tweet_url TEXT,
                        related_concept TEXT,
                        related_stocks TEXT,
                        sentiment TEXT,
                        has_stock_mention INTEGER DEFAULT 0,
                        mentioned_stocks TEXT,
                        importance_score INTEGER DEFAULT 1,
                        is_demo INTEGER DEFAULT 0,
                        fetched_at TEXT,
                        source_type TEXT DEFAULT 'following'
                    )
                """)
                # 兼容升级：老表无 source_type 时自动增列
                try:
                    cursor.execute("ALTER TABLE twitter_tweets ADD COLUMN source_type TEXT DEFAULT 'following'")
                except Exception:
                    pass

                cursor.execute("CREATE INDEX IF NOT EXISTS idx_twitter_ts ON twitter_tweets(created_timestamp DESC)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_twitter_stock ON twitter_tweets(has_stock_mention)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_twitter_author ON twitter_tweets(author_handle)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_twitter_source ON twitter_tweets(source_type)")

                # ⚡ 初始化 SQLite FTS5 全文倒排索引虚拟表
                cursor.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS twitter_tweets_fts USING fts5(
                        id UNINDEXED,
                        segmented_content,
                        author_info,
                        related_concept,
                        tokenize='unicode61'
                    )
                """)

                # 检查并全量回填构建历史推文的 FTS5 倒排索引
                cursor.execute("SELECT COUNT(*) FROM twitter_tweets_fts")
                fts_cnt = cursor.fetchone()[0] or 0
                cursor.execute("SELECT COUNT(*) FROM twitter_tweets")
                tbl_cnt = cursor.fetchone()[0] or 0

                if fts_cnt < tbl_cnt:
                    cursor.execute("SELECT id, author_name, author_handle, text_raw, text_translated, related_concept FROM twitter_tweets")
                    rows = cursor.fetchall()
                    for r in rows:
                        tid, name, handle, raw, trans, concept = r
                        full_content = f"{name or ''} {handle or ''} {raw or ''} {trans or ''} {concept or ''}"
                        tokens = tokenize_for_fts5(full_content)
                        cursor.execute("INSERT OR REPLACE INTO twitter_tweets_fts VALUES (?, ?, ?, ?)",
                                       (tid, tokens, f"{name or ''} {handle or ''}", concept or ""))
                    logger.info(f"⚡ 成功构建 {len(rows)} 条推文的 SQLite FTS5 全文倒排索引 (支持结巴中文分词与 BM25 算分)")

                # ⚡ 初始化博主分组与自定义画像持久化表
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS twitter_author_profiles (
                        handle TEXT PRIMARY KEY,
                        name TEXT,
                        category TEXT,
                        is_vip INTEGER DEFAULT 0,
                        desc TEXT,
                        avatar TEXT,
                        source_type TEXT DEFAULT 'following',
                        updated_at TEXT
                    )
                """)
                self._sync_author_profiles_from_db(cursor)

                conn.commit()
            logger.info(f"推特持久化数据库与 FTS5 检索引擎初始化就绪: {DB_FILE_PATH}")
        except Exception as e:
            logger.error(f"初始化推特 SQLite 数据库与 FTS5 索引失败: {e}", exc_info=True)

    def _sync_author_profiles_from_db(self, cursor):
        """
        初始化并双向同步博主分类档案：
        1. 若数据库为空，将初始 DEFAULT_AUTHOR_PROFILE_MAP 写入数据库；
        2. 从 twitter_tweets 提取所有发推博主，对新博主自动补登入库；
        3. 读取数据库中的博主自定义分类，覆盖并实时同步全局 AUTHOR_PROFILE_MAP。
        """
        try:
            cursor.execute("SELECT handle, name, category, is_vip, desc, avatar, source_type FROM twitter_author_profiles")
            rows = cursor.fetchall()
            db_profiles = {r[0]: {"handle": r[0], "name": r[1], "category": r[2], "is_vip": bool(r[3]), "desc": r[4], "avatar": r[5], "source_type": r[6]} for r in rows}

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # 首次初始化默认博主
            if not db_profiles:
                for h, p in AUTHOR_PROFILE_MAP.items():
                    cursor.execute("""
                        INSERT OR REPLACE INTO twitter_author_profiles 
                        (handle, name, category, is_vip, desc, avatar, source_type, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        h,
                        p.get("name", h),
                        p.get("category", "NON_STOCK"),
                        1 if p.get("is_vip") else 0,
                        p.get("desc", ""),
                        p.get("avatar", ""),
                        p.get("source_type", "following"),
                        now_str
                    ))
                logger.info(f"💾 初始化导入 {len(AUTHOR_PROFILE_MAP)} 位系统默认关注博主档案至数据库")
            else:
                # 用数据库里的自定义配置同步更新 AUTHOR_PROFILE_MAP
                for h, p in db_profiles.items():
                    if h in AUTHOR_PROFILE_MAP:
                        AUTHOR_PROFILE_MAP[h]["category"] = p["category"]
                        AUTHOR_PROFILE_MAP[h]["is_vip"] = p["is_vip"]
                        if p.get("name"):
                            AUTHOR_PROFILE_MAP[h]["name"] = p["name"]
                        if p.get("desc"):
                            AUTHOR_PROFILE_MAP[h]["desc"] = p["desc"]
                    else:
                        AUTHOR_PROFILE_MAP[h] = {
                            "category": p["category"],
                            "name": p["name"] or h,
                            "is_vip": p["is_vip"],
                            "desc": p["desc"] or "",
                            "avatar": p["avatar"] or "",
                            "source_type": p["source_type"] or "following"
                        }

            # 自动扫描推文表中所有实际发推的博主，自动补登并分类
            cursor.execute("""
                SELECT author_handle, author_name, author_avatar, COUNT(*) 
                FROM twitter_tweets 
                GROUP BY author_handle
            """)
            for a_row in cursor.fetchall():
                raw_h = (a_row[0] or "").lower().replace("@", "").strip()
                a_name = a_row[1] or raw_h
                a_avatar = a_row[2] or ""
                if not raw_h:
                    continue
                if raw_h not in AUTHOR_PROFILE_MAP:
                    prof = resolve_author_profile(raw_h, a_name)
                    cat = prof.get("category", "NON_STOCK")
                    cursor.execute("""
                        INSERT OR REPLACE INTO twitter_author_profiles 
                        (handle, name, category, is_vip, desc, avatar, source_type, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (raw_h, a_name, cat, 0, f"关注流发推博主 (已收录 {a_row[3]} 条)", a_avatar, "following", now_str))
                    AUTHOR_PROFILE_MAP[raw_h] = {
                        "category": cat,
                        "name": a_name,
                        "is_vip": False,
                        "desc": f"关注流发推博主 (已收录 {a_row[3]} 条)",
                        "avatar": a_avatar,
                        "source_type": "following"
                    }
        except Exception as e:
            logger.error(f"同步博主档案异常: {e}", exc_info=True)

    def get_author_profiles_list(self) -> List[Dict[str, Any]]:
        """获取所有关注博主详细清单 (包含发推数量、最新发推时间、当前分组、VIP状态)"""
        authors = []
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT author_handle, COUNT(*) as cnt, MAX(created_timestamp) as latest_ts, MAX(author_name), MAX(author_avatar)
                    FROM twitter_tweets
                    GROUP BY author_handle
                """)
                stats_map = {}
                for r in cursor.fetchall():
                    h = (r[0] or "").lower().replace("@", "").strip()
                    stats_map[h] = {
                        "count": int(r[1] or 0),
                        "latest_ts": float(r[2] or 0),
                        "name": r[3] or "",
                        "avatar": r[4] or ""
                    }

                cursor.execute("SELECT handle, name, category, is_vip, desc, avatar, source_type, updated_at FROM twitter_author_profiles")
                for r in cursor.fetchall():
                    h = (r[0] or "").lower().replace("@", "").strip()
                    st = stats_map.get(h, {})
                    cat_k = r[2] or "NON_STOCK"
                    cat_meta = AUTHOR_CATEGORIES_METADATA.get(cat_k, AUTHOR_CATEGORIES_METADATA["NON_STOCK"])

                    latest_time_str = ""
                    if st.get("latest_ts", 0) > 0:
                        try:
                            latest_time_str = datetime.fromtimestamp(st["latest_ts"]).strftime("%Y-%m-%d %H:%M")
                        except Exception:
                            pass

                    authors.append({
                        "handle": h,
                        "name": r[1] or st.get("name") or h,
                        "avatar": r[5] or st.get("avatar") or "",
                        "category": cat_k,
                        "category_name": cat_meta["name"],
                        "category_short_name": cat_meta["short_name"],
                        "category_badge": cat_meta["badge"],
                        "category_color": cat_meta["color"],
                        "category_icon": cat_meta["icon"],
                        "is_vip": bool(r[3]),
                        "desc": r[4] or "",
                        "source_type": r[6] or "following",
                        "tweet_count": st.get("count", 0),
                        "latest_tweet_time": latest_time_str,
                        "updated_at": r[7] or ""
                    })
        except Exception as e:
            logger.error(f"获取博主档案列表失败: {e}", exc_info=True)

        # 排序：VIP 置顶优先，其次按推文量降序
        authors.sort(key=lambda x: (1 if x["is_vip"] else 0, x["tweet_count"]), reverse=True)
        return authors

    def update_author_profile(self, handle: str, category: Optional[str] = None, is_vip: Optional[bool] = None, desc: Optional[str] = None) -> Dict[str, Any]:
        """更新博主分组类别与 VIP 标记，同步保存至 SQLite 并实时同步全局内存"""
        clean_h = (handle or "").lower().replace("@", "").strip()
        if not clean_h:
            return {"success": False, "message": "博主 handle 不能为空"}

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT handle, name, category, is_vip, desc, avatar, source_type FROM twitter_author_profiles WHERE handle = ?", (clean_h,))
                row = cursor.fetchone()
                if row:
                    cur_cat = category if category is not None else row[2]
                    cur_vip = (1 if is_vip else 0) if is_vip is not None else row[3]
                    cur_desc = desc if desc is not None else row[4]
                    cursor.execute("""
                        UPDATE twitter_author_profiles 
                        SET category = ?, is_vip = ?, desc = ?, updated_at = ?
                        WHERE handle = ?
                    """, (cur_cat, cur_vip, cur_desc, now_str, clean_h))
                else:
                    cur_cat = category or "NON_STOCK"
                    cur_vip = 1 if is_vip else 0
                    cur_desc = desc or ""
                    cursor.execute("""
                        INSERT INTO twitter_author_profiles (handle, name, category, is_vip, desc, avatar, source_type, updated_at)
                        VALUES (?, ?, ?, ?, ?, '', 'following', ?)
                    """, (clean_h, clean_h, cur_cat, cur_vip, cur_desc, now_str))
                conn.commit()

            # 内存全局字典实时同步
            if clean_h in AUTHOR_PROFILE_MAP:
                if category is not None:
                    AUTHOR_PROFILE_MAP[clean_h]["category"] = category
                if is_vip is not None:
                    AUTHOR_PROFILE_MAP[clean_h]["is_vip"] = bool(is_vip)
                if desc is not None:
                    AUTHOR_PROFILE_MAP[clean_h]["desc"] = desc
            else:
                AUTHOR_PROFILE_MAP[clean_h] = {
                    "category": cur_cat,
                    "name": clean_h,
                    "is_vip": bool(cur_vip),
                    "desc": cur_desc,
                    "source_type": "following"
                }

            cat_info = AUTHOR_CATEGORIES_METADATA.get(cur_cat, {})
            logger.info(f"✅ 成功将博主 @{clean_h} 分组更新为 [{cat_info.get('name', cur_cat)}], VIP={cur_vip}")
            return {
                "success": True,
                "message": f"博主 @{clean_h} 已成功移入【{cat_info.get('name', cur_cat)}】分组",
                "author": {
                    "handle": clean_h,
                    "category": cur_cat,
                    "category_name": cat_info.get("name", cur_cat),
                    "is_vip": bool(cur_vip)
                }
            }
        except Exception as e:
            logger.error(f"更新博主 @{clean_h} 档案异常: {e}", exc_info=True)
            return {"success": False, "message": f"更新失败: {str(e)}"}

    def reset_author_profiles(self) -> Dict[str, Any]:
        """一键恢复所有博主分组为系统推荐默认分类体系"""
        try:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                for h, p in DEFAULT_AUTHOR_PROFILE_MAP.items():
                    cursor.execute("""
                        UPDATE twitter_author_profiles
                        SET category = ?, is_vip = ?, desc = ?, updated_at = ?
                        WHERE handle = ?
                    """, (
                        p.get("category", "NON_STOCK"),
                        1 if p.get("is_vip") else 0,
                        p.get("desc", ""),
                        now_str,
                        h
                    ))
                conn.commit()

            # 内存字典同步还原
            for h, p in DEFAULT_AUTHOR_PROFILE_MAP.items():
                if h in AUTHOR_PROFILE_MAP:
                    AUTHOR_PROFILE_MAP[h]["category"] = p["category"]
                    AUTHOR_PROFILE_MAP[h]["is_vip"] = p.get("is_vip", False)
                    AUTHOR_PROFILE_MAP[h]["desc"] = p.get("desc", "")

            logger.info("🔄 博主分组档案已成功恢复为系统默认推荐分类")
            return {"success": True, "message": "已成功恢复为系统默认博主分类体系"}
        except Exception as e:
            logger.error(f"恢复默认博主分组失败: {e}", exc_info=True)
            return {"success": False, "message": str(e)}

    def translate_single_tweet(self, tweet_id: str, custom_text: Optional[str] = None) -> Dict[str, Any]:
        """对单条推文执行按需即时重译，并自动沉淀更新本地 SQLite 数据库与 FTS5 全文倒排索引"""
        clean_id = str(tweet_id).strip()
        if not clean_id:
            return {"success": False, "message": "推文 ID 不能为空"}

        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT text_raw, text_translated, author_name, author_handle, related_concept FROM twitter_tweets WHERE id = ?", (clean_id,))
                row = cursor.fetchone()
                if not row:
                    return {"success": False, "message": f"未在本地数据库找到推文 {clean_id}"}
                raw_text = custom_text or row[0]
                author_name = row[2]
                author_handle = row[3]
                related_concept = row[4]

            # 强制清空该条推文的内存缓存，触发高可用网络翻译
            cache_key = raw_text.strip()[:100]
            if cache_key in self._translation_cache:
                del self._translation_cache[cache_key]

            translated_text = self.translate_to_chinese(raw_text)
            if not translated_text:
                translated_text = raw_text

            # 永久回写至 SQLite 数据库并更新 FTS5 倒排索引
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE twitter_tweets SET text_translated = ? WHERE id = ?", (translated_text, clean_id))
                full_content = f"{author_name or ''} {author_handle or ''} {raw_text} {translated_text} {related_concept or ''}"
                tokens = tokenize_for_fts5(full_content)
                cursor.execute("INSERT OR REPLACE INTO twitter_tweets_fts VALUES (?, ?, ?, ?)",
                               (clean_id, tokens, f"{author_name or ''} {author_handle or ''}", related_concept or ""))
                conn.commit()

            # 同步更新内存缓存中的推文实体
            for t in self._cached_tweets:
                if t.id == clean_id:
                    t.text_translated = translated_text
                    break

            logger.info(f"🌐 成功即时翻译推文 {clean_id}: {translated_text[:40]}...")
            return {
                "success": True,
                "message": "翻译成功",
                "tweet_id": clean_id,
                "text_raw": raw_text,
                "text_translated": translated_text
            }
        except Exception as e:
            logger.error(f"即时翻译推文 {clean_id} 异常: {e}", exc_info=True)
            return {"success": False, "message": f"翻译异常: {str(e)}"}

    def _preload_cache_from_db(self):
        """从 SQLite 预热前 30 条最新推文至内存缓存，保证系统启动即刻展示永久历史"""
        try:
            res = self.query_tweets_from_db(page=1, page_size=30)
            tweets = res.get("tweets", [])
            if tweets:
                cached_items = []
                for t in tweets:
                    cached_items.append(TwitterTweetItem(
                        id=t["id"],
                        author_name=t["author_name"],
                        author_handle=t["author_handle"],
                        author_avatar=t["author_avatar"],
                        created_at=t["created_at"],
                        relative_time=t["relative_time"],
                        text_raw=t["text_raw"],
                        text_translated=t["text_translated"],
                        likes=t["likes"],
                        retweets=t["retweets"],
                        tweet_url=t["tweet_url"],
                        related_concept=t["related_concept"],
                        related_stocks=t["related_stocks"],
                        sentiment=t["sentiment"],
                        has_stock_mention=t["has_stock_mention"],
                        mentioned_stocks=t["mentioned_stocks"],
                        importance_score=t["importance_score"],
                        is_demo=t["is_demo"]
                    ))
                self._cached_tweets = cached_items
                logger.info(f"💾 成功从本地 SQLite 数据库预热装载 {len(cached_items)} 条永久沉淀情报")
        except Exception as e:
            logger.debug(f"从 SQLite 预热缓存跳过: {e}")

    def _get_db_total_count(self) -> int:
        """获取本地 SQLite 数据库中永久存储的推文总条数"""
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM twitter_tweets")
                row = cursor.fetchone()
                return int(row[0] or 0) if row else 0
        except Exception:
            return 0

    def _get_existing_tweet_ids(self, ids: List[str]) -> set:
        """批量检查传入的推文 ID 列表中哪些已在本地 SQLite 数据库中存在 (核心去重判定)"""
        if not ids:
            return set()
        existing = set()
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                batch_size = 500
                for i in range(0, len(ids), batch_size):
                    batch = ids[i:i + batch_size]
                    placeholders = ",".join(["?"] * len(batch))
                    cursor.execute(f"SELECT id FROM twitter_tweets WHERE id IN ({placeholders})", batch)
                    rows = cursor.fetchall()
                    for r in rows:
                        existing.add(str(r[0]))
        except Exception as e:
            logger.error(f"批量查询推文去重 ID 异常: {e}")
        return existing

    def _extract_stocks_and_importance(self, text_raw: str, text_translated: str,
                                       author_handle: str = "", author_name: str = "") -> Tuple[bool, List[Dict[str, str]], int]:
        """智能提取推文中直接提及的具体股票标的 (代码/名称)，结合作者权重与实战术语赋予分级重要性"""
        combined = f"{text_raw} {text_translated}"
        mentioned: List[Dict[str, str]] = []
        seen_symbols = set()

        # 1. 匹配标准推特股票语法 $NVDA, $TSLA 等
        ticker_matches = re.findall(r'\$([A-Za-z]{1,6})\b', text_raw)
        ignore_tickers = {"USD", "USDT", "BTC", "ETH", "SOL", "AI", "CEO", "IPO", "FED", "CPI", "SEC", "GDP", "LLM"}
        for t in ticker_matches:
            sym = t.upper()
            if sym in ignore_tickers:
                continue
            if sym in FAMOUS_STOCKS_DICT:
                info = FAMOUS_STOCKS_DICT[sym]
                if info["symbol"] not in seen_symbols:
                    mentioned.append(info)
                    seen_symbols.add(info["symbol"])
            else:
                if sym not in seen_symbols and len(sym) >= 2:
                    mentioned.append({"symbol": sym, "name": f"${sym}", "market": "US"})
                    seen_symbols.add(sym)

        # 2. 匹配中文核心公司名与龙头股 (如 英伟达、特斯拉、中际旭创、中芯国际等)
        for name_key, info in FAMOUS_STOCKS_DICT.items():
            if len(name_key) >= 2 and name_key in combined:
                if info["symbol"] not in seen_symbols:
                    mentioned.append(info)
                    seen_symbols.add(info["symbol"])

        # 3. 检查是否命中 A 股实战交易/板块术语
        has_trading_keyword = any(kw in combined for kw in A_SHARE_TRADING_KEYWORDS)

        # 4. 重点 VIP 博主判定 (Crypto/戒色交易员)
        handle_clean = (author_handle or "").lower().replace("@", "")
        name_clean = author_name or ""
        is_vip_author = any(vip.lower() in handle_clean or vip in name_clean for vip in VIP_AUTHORS)

        if is_vip_author:
            # VIP 博主：最高置顶权重 10，无论是否带有具体代码，全量归入实战干货并置顶！
            importance = 10
            has_stock = True
        elif len(mentioned) > 0:
            # 直接提及具体股票代码：5 星高权重
            importance = 5
            has_stock = True
        elif has_trading_keyword:
            # 谈论板块、大盘震荡、仓位控制、选股指标等实战：4 星实战权重
            importance = 4
            has_stock = True
        else:
            # 纯社会新闻/生活琐事/无关打卡：1 星普通，且不属于股票强相关
            importance = 1
            has_stock = False

        return has_stock, mentioned, importance

    def _upsert_tweets_to_db(self, items: List[TwitterTweetItem]):
        """将抓取的推文批量持久化插入或更新至 SQLite (永久保留历史)"""
        if not items:
            return
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                for it in items:
                    # 计算精确时间戳
                    ts = 0.0
                    try:
                        dt = datetime.strptime(it.created_at, "%a %b %d %H:%M:%S %z %Y")
                        ts = dt.timestamp()
                    except Exception:
                        ts = time.time()

                    src_type = getattr(it, 'source_type', 'following') or 'following'
                    cursor.execute("""
                        INSERT INTO twitter_tweets (
                            id, author_name, author_handle, author_avatar, created_at, created_timestamp,
                            relative_time, text_raw, text_translated, likes, retweets, tweet_url,
                            related_concept, related_stocks, sentiment, has_stock_mention,
                            mentioned_stocks, importance_score, is_demo, fetched_at, source_type
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            likes = excluded.likes,
                            retweets = excluded.retweets,
                            text_translated = excluded.text_translated,
                            has_stock_mention = excluded.has_stock_mention,
                            mentioned_stocks = excluded.mentioned_stocks,
                            importance_score = excluded.importance_score,
                            relative_time = excluded.relative_time,
                            source_type = excluded.source_type
                    """, (
                        it.id, it.author_name, it.author_handle, it.author_avatar, it.created_at, ts,
                        it.relative_time, it.text_raw, it.text_translated, it.likes, it.retweets, it.tweet_url,
                        it.related_concept, json.dumps(it.related_stocks, ensure_ascii=False), it.sentiment,
                        1 if it.has_stock_mention else 0,
                        json.dumps(it.mentioned_stocks or [], ensure_ascii=False),
                        it.importance_score, 1 if it.is_demo else 0, now_str, src_type
                    ))

                    # ⚡ 同步维护 SQLite FTS5 倒排索引 (结巴分词全文检索)
                    try:
                        cursor.execute("DELETE FROM twitter_tweets_fts WHERE id = ?", (it.id,))
                        full_content = f"{it.author_name} {it.author_handle} {it.text_raw} {it.text_translated} {it.related_concept or ''}"
                        tokens = tokenize_for_fts5(full_content)
                        cursor.execute("INSERT INTO twitter_tweets_fts VALUES (?, ?, ?, ?)",
                                       (it.id, tokens, f"{it.author_name} {it.author_handle}", it.related_concept or ""))
                    except Exception as fts_sync_err:
                        logger.debug(f"同步推文至 FTS5 倒排索引跳过: {fts_sync_err}")

                conn.commit()
            logger.info(f"✅ 成功将 {len(items)} 条推特推文归档沉淀至本地 SQLite 数据库！")
        except Exception as e:
            logger.error(f"持久化推特数据入库失败: {e}", exc_info=True)

    def query_tweets_from_db(self, page: int = 1, page_size: int = 15, keyword: str = "",
                             only_stocks: bool = False, author: str = "", category: str = "ALL",
                             source_type: str = "ALL") -> Dict[str, Any]:
        """从 SQLite 数据库中按分页、关键词(FTS5倒排索引+BM25)、提股标星、博主专业归类及来源归属多维检索历史推文"""
        page = max(1, page)
        page_size = max(1, min(100, page_size))
        offset = (page - 1) * page_size

        where_clauses = ["1=1"]
        params = []

        if only_stocks:
            where_clauses.append("has_stock_mention = 1")

        # ⭐️ 来源归属过滤 (我关注的 vs 系统精选)
        clean_src = (source_type or "ALL").upper().strip()
        if clean_src == "FOLLOWING":
            where_clauses.append("(source_type = 'following' OR source_type IS NULL OR source_type = '')")
        elif clean_src == "CURATED":
            where_clauses.append("source_type = 'curated'")

        # ⭐️ 核心分类过滤支持 (精选股票博主 / A股实盘 / 宏观全球 / 科技产业 / 非股票)
        clean_cat = (category or "ALL").upper().strip()
        if clean_cat == "STOCKS_ONLY":
            # 精选股票博主合集：自动过滤李老师、韩跑跑及纯币圈平台推广
            non_stock_handles = [h for h, p in AUTHOR_PROFILE_MAP.items() if p.get("category") == "NON_STOCK"]
            if non_stock_handles:
                ph = ",".join(["?"] * len(non_stock_handles))
                where_clauses.append(f"LOWER(REPLACE(author_handle, '@', '')) NOT IN ({ph})")
                params.extend(non_stock_handles)
        elif clean_cat in AUTHOR_CATEGORIES_METADATA:
            # 单一指定类别过滤
            cat_handles = [h for h, p in AUTHOR_PROFILE_MAP.items() if p.get("category") == clean_cat]
            if cat_handles:
                ph = ",".join(["?"] * len(cat_handles))
                where_clauses.append(f"LOWER(REPLACE(author_handle, '@', '')) IN ({ph})")
                params.extend(cat_handles)

        if author and author.strip():
            clean_author = author.strip().lstrip("@")
            where_clauses.append("(author_handle LIKE ? OR author_name LIKE ?)")
            params.extend([f"%{clean_author}%", f"%{clean_author}%"])

        # ⚡ 智能搜索：优先使用 SQLite FTS5 全文倒排索引 (结巴分词 + BM25 算分)，异常时平滑降级至 LIKE
        used_fts = False
        fts_matched_ids = []
        if keyword and keyword.strip():
            kw_clean = keyword.strip()
            try:
                if jieba is not None:
                    k_words = [w.strip() for w in jieba.cut(kw_clean) if w.strip()]
                else:
                    k_words = kw_clean.split()
                safe_words = [re.sub(r'[\"\*\:\(\)\^\{\}]', '', w) for w in k_words if w]
                safe_words = [w for w in safe_words if w]
                if safe_words:
                    fts_expr = " AND ".join(f'"{w}"' for w in safe_words)
                    with sqlite3.connect(DB_FILE_PATH) as fts_conn:
                        fts_cursor = fts_conn.cursor()
                        fts_cursor.execute(
                            "SELECT id, bm25(twitter_tweets_fts) as rank FROM twitter_tweets_fts WHERE twitter_tweets_fts MATCH ? ORDER BY rank LIMIT 300",
                            (fts_expr,)
                        )
                        rows = fts_cursor.fetchall()
                        if rows:
                            fts_matched_ids = [r[0] for r in rows]
                            used_fts = True
            except Exception as fts_ex:
                logger.debug(f"FTS5 全文检索降级为常规 LIKE: {fts_ex}")
                used_fts = False

        if used_fts and fts_matched_ids:
            ph = ",".join(["?"] * len(fts_matched_ids))
            where_clauses.append(f"id IN ({ph})")
            params.extend(fts_matched_ids)
        elif keyword and keyword.strip():
            kw = f"%{keyword.strip()}%"
            where_clauses.append("(text_raw LIKE ? OR text_translated LIKE ? OR related_concept LIKE ? OR mentioned_stocks LIKE ? OR author_name LIKE ? OR author_handle LIKE ?)")
            params.extend([kw, kw, kw, kw, kw, kw])

        where_sql = " AND ".join(where_clauses)

        total_count = 0
        tweets_list = []
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # 1. 统计满足条件的总数
                cursor.execute(f"SELECT COUNT(*) as cnt FROM twitter_tweets WHERE {where_sql}", params)
                row = cursor.fetchone()
                total_count = row["cnt"] if row else 0

                # 2. 分页查询列表，按重要性评分降序 + 发布时间倒序
                query_sql = f"""
                    SELECT * FROM twitter_tweets
                    WHERE {where_sql}
                    ORDER BY importance_score DESC, created_timestamp DESC
                    LIMIT ? OFFSET ?
                """
                cursor.execute(query_sql, params + [page_size, offset])
                rows = cursor.fetchall()

                for r in rows:
                    rel_stocks = []
                    try:
                        rel_stocks = json.loads(r["related_stocks"] or "[]")
                    except Exception:
                        pass
                    ment_stocks = []
                    try:
                        ment_stocks = json.loads(r["mentioned_stocks"] or "[]")
                    except Exception:
                        pass

                    author_prof = resolve_author_profile(r["author_handle"], r["author_name"])

                    src_val = "following"
                    try:
                        src_val = r["source_type"] if "source_type" in r.keys() and r["source_type"] else author_prof.get("source_type", "following")
                    except Exception:
                        src_val = author_prof.get("source_type", "following")

                    tweets_list.append({
                        "id": r["id"],
                        "author_name": r["author_name"],
                        "author_handle": r["author_handle"],
                        "author_avatar": r["author_avatar"],
                        "author_profile": author_prof,
                        "source_type": src_val,
                        "source_type_name": "我关注的" if src_val == "following" else "系统精选",
                        "created_at": r["created_at"],
                        "relative_time": r["relative_time"],
                        "text_raw": r["text_raw"],
                        "text_translated": r["text_translated"],
                        "likes": r["likes"],
                        "retweets": r["retweets"],
                        "tweet_url": r["tweet_url"],
                        "related_concept": r["related_concept"],
                        "related_stocks": rel_stocks,
                        "sentiment": r["sentiment"],
                        "has_stock_mention": bool(r["has_stock_mention"]),
                        "mentioned_stocks": ment_stocks,
                        "importance_score": r["importance_score"],
                        "is_demo": bool(r["is_demo"]),
                        "fetched_at": r["fetched_at"]
                    })
        except Exception as e:
            logger.error(f"查询 SQLite 推特数据库异常: {e}", exc_info=True)

        total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1

        # 统计各来源数量
        source_type_counts = {"ALL": 0, "FOLLOWING": 0, "CURATED": 0}
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM twitter_tweets")
                source_type_counts["ALL"] = cursor.fetchone()[0] or 0
                cursor.execute("SELECT COUNT(*) FROM twitter_tweets WHERE source_type = 'curated'")
                source_type_counts["CURATED"] = cursor.fetchone()[0] or 0
                source_type_counts["FOLLOWING"] = max(0, source_type_counts["ALL"] - source_type_counts["CURATED"])
        except Exception:
            pass

        return {
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "tweets": tweets_list,
            "source_type_counts": source_type_counts
        }

    def save_config(self, auth_token: Optional[str] = None, ct0: Optional[str] = None,
                    full_cookie: Optional[str] = None, monitored_users: Optional[List[str]] = None,
                    proxy_url: Optional[str] = None) -> Dict[str, Any]:
        """更新推特凭据与监控设置并立即探活自愈"""
        if auth_token is not None:
            self.config["auth_token"] = auth_token.strip()
        if ct0 is not None:
            self.config["ct0"] = ct0.strip()
        if full_cookie is not None:
            self.config["full_cookie"] = full_cookie.strip()
            # 若提供了完整 Cookie 且未显式指定 auth_token/ct0，尝试从 Cookie 智能解析提炼
            if not auth_token and "auth_token=" in full_cookie:
                import re
                atm = re.search(r'auth_token=([^;\s]+)', full_cookie)
                if atm:
                    self.config["auth_token"] = atm.group(1)
            if not ct0 and "ct0=" in full_cookie:
                import re
                ctm = re.search(r'ct0=([^;\s]+)', full_cookie)
                if ctm:
                    self.config["ct0"] = ctm.group(1)

        if monitored_users is not None:
            clean_users = [u.strip().lstrip("@") for u in monitored_users if u.strip()]
            if clean_users:
                self.config["monitored_users"] = clean_users
        if proxy_url is not None and proxy_url.strip():
            self.config["proxy_url"] = proxy_url.strip()

        self._save_config_file(self.config)
        self._last_fetch_time = 0.0  # 强制刷新缓存
        
        # 配置更新后立即执行一次轻量探活，自愈连接状态
        self.keep_alive_heartbeat()
        return self.get_status()

    def get_status(self) -> Dict[str, Any]:
        """获取推特监控引擎运行状态 (对齐东方财富系统设计)"""
        raw_token = self.config.get("auth_token", "")
        masked_token = (raw_token[:6] + "..." + raw_token[-4:]) if len(raw_token) > 10 else ("" if not raw_token else "***")
        has_auth = bool(raw_token and self.config.get("ct0", ""))

        # 状态文本与说明
        if self.auth_state == "online":
            status_text = "🟢 实时关注流在线 (Cookie 有效，正常轮询)"
            color_theme = "green"
        elif self.auth_state == "expired":
            status_text = "🔴 推特凭据已失效 (Cookie/auth_token 过期，需重新填入)"
            color_theme = "red"
        elif self.auth_state == "network_error":
            status_text = "🟠 代理或网络不可达 (请检查本地代理 127.0.0.1:7897)"
            color_theme = "orange"
        else:
            status_text = "⚪ 待配置推特凭证 (填入 Cookie 即可实时同步关注流)"
            color_theme = "gray"

        now_ts = time.time()
        sync_delay = int(now_ts - self._last_fetch_time) if self._last_fetch_time else 999999

        # 查询本地数据库中累计归档的情报总数与真实博主分布
        db_total_count = 0
        db_stock_count = 0
        active_authors = []
        category_counts = {
            "ALL": 0,
            "STOCKS_ONLY": 0,
            "A_STOCK": 0,
            "MACRO_GLOBAL": 0,
            "TECH_INDUSTRY": 0,
            "NON_STOCK": 0
        }
        categories_summary = {}
        for cat_k, cat_meta in AUTHOR_CATEGORIES_METADATA.items():
            categories_summary[cat_k] = {
                "key": cat_k,
                "name": cat_meta["name"],
                "short_name": cat_meta["short_name"],
                "badge": cat_meta["badge"],
                "color": cat_meta["color"],
                "icon": cat_meta["icon"],
                "desc": cat_meta["desc"],
                "is_stock_related": cat_meta["is_stock_related"],
                "tweet_count": 0,
                "author_count": 0,
                "authors": []
            }

        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*), SUM(has_stock_mention) FROM twitter_tweets")
                row = cursor.fetchone()
                if row:
                    db_total_count = int(row[0] or 0)
                    db_stock_count = int(row[1] or 0)
                    category_counts["ALL"] = db_total_count
                
                cursor.execute("""
                    SELECT author_name, author_handle, COUNT(*) as cnt 
                    FROM twitter_tweets 
                    GROUP BY author_handle 
                    ORDER BY cnt DESC 
                """)
                for a_row in cursor.fetchall():
                    a_name = a_row[0] or "推特博主"
                    a_handle = a_row[1] or ""
                    a_cnt = int(a_row[2] or 0)
                    prof = resolve_author_profile(a_handle, a_name)
                    cat_k = prof.get("category", "NON_STOCK")

                    author_obj = {
                        "name": a_name,
                        "handle": a_handle,
                        "count": a_cnt,
                        "profile": prof
                    }
                    active_authors.append(author_obj)

                    # 分类累加
                    if cat_k in categories_summary:
                        categories_summary[cat_k]["tweet_count"] += a_cnt
                        categories_summary[cat_k]["author_count"] += 1
                        categories_summary[cat_k]["authors"].append(author_obj)
                        category_counts[cat_k] += a_cnt

                    if prof.get("is_stock_related"):
                        category_counts["STOCKS_ONLY"] += a_cnt

        except Exception as e:
            logger.error(f"获取推特博主分类统计异常: {e}", exc_info=True)

        source_type_counts = {"ALL": db_total_count, "FOLLOWING": db_total_count, "CURATED": 0}
        try:
            with sqlite3.connect(DB_FILE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM twitter_tweets WHERE source_type = 'curated'")
                cur_cnt = cursor.fetchone()[0] or 0
                source_type_counts["CURATED"] = cur_cnt
                source_type_counts["FOLLOWING"] = max(0, db_total_count - cur_cnt)
        except Exception:
            pass

        return {
            "has_auth": has_auth,
            "auth_state": self.auth_state,
            "is_session_alive": self.is_session_alive,
            "status_text": status_text,
            "color_theme": color_theme,
            "auth_token_masked": masked_token,
            "ct0_configured": bool(self.config.get("ct0", "")),
            "proxy_url": self.config.get("proxy_url", DEFAULT_PROXY_URL),
            "monitored_users": self.config.get("monitored_users", []),
            "active_authors": active_authors,
            "author_categories_metadata": AUTHOR_CATEGORIES_METADATA,
            "categories_summary": categories_summary,
            "category_counts": category_counts,
            "source_type_counts": source_type_counts,
            "cached_tweet_count": len(self._cached_tweets),
            "db_total_count": db_total_count,
            "db_stock_count": db_stock_count,
            "db_path": str(DB_FILE_PATH),
            "last_fetch_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self._last_fetch_time)) if self._last_fetch_time else "尚未拉取",
            "last_success_time": self.last_success_time or "尚未拉取",
            "last_heartbeat_time": self.last_heartbeat_time or "尚未探活",
            "last_heartbeat_status": self.last_heartbeat_status,
            "latest_tweet_time": self.latest_tweet_time or "暂无数据",
            "latest_tweet_relative": self.latest_tweet_relative or "暂无数据",
            "data_freshness_desc": self.data_freshness_desc,
            "sync_delay_seconds": sync_delay,
            "consecutive_failures": self.consecutive_failures,
            "last_error": self.last_error,
            "daily_sync_enabled": self.daily_sync_enabled,
            "last_daily_sync_time": self.last_daily_sync_time or "尚未触发",
            "today_added_count": self.today_added_count,
            "next_scheduled_sync": "每日 08:30 / 15:30 / 21:00 自动定时日更"
        }

    def keep_alive_heartbeat(self) -> Dict[str, Any]:
        """轻量级主动探活 (对标东方财富 keep_alive_heartbeat 机制)"""
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.last_heartbeat_time = now_str

        auth_token = self.config.get("auth_token", "").strip()
        ct0 = self.config.get("ct0", "").strip()
        if not auth_token or not ct0:
            self.auth_state = "unconfigured"
            self.is_session_alive = False
            self.last_heartbeat_status = "未配置推特 auth_token 或 ct0"
            return {"status": "unconfigured", "auth_state": "unconfigured", "message": self.last_heartbeat_status, "time": now_str}

        proxy = self.config.get("proxy_url", DEFAULT_PROXY_URL)
        proxies = {"http": proxy, "https": proxy}
        headers = self._build_request_headers()

        # 发送极轻量的 1 条推文请求探测凭据活性
        test_url = "https://x.com/i/api/2/timeline/home.json?tweet_mode=extended&count=1"
        try:
            resp = requests.get(test_url, headers=headers, proxies=proxies, timeout=6)
            if resp.status_code == 200:
                self.auth_state = "online"
                self.is_session_alive = True
                self.consecutive_failures = 0
                self.last_heartbeat_status = "凭据有效 (关注流通道在线)"
                self.last_error = ""
                return {"status": "alive", "auth_state": "online", "message": self.last_heartbeat_status, "time": now_str}
            elif resp.status_code in [401, 403]:
                self.auth_state = "expired"
                self.is_session_alive = False
                self.consecutive_failures += 1
                self.last_error = f"推特认证失败 (HTTP {resp.status_code})：Cookie 或 auth_token 已过期/被注销"
                self.last_heartbeat_status = "Cookie 已失效"
                logger.warning(f"⚠️ [TwitterMonitor] 探活捕获到凭据失效 (HTTP {resp.status_code})")
                return {"status": "expired", "auth_state": "expired", "message": self.last_error, "time": now_str}
            else:
                self.consecutive_failures += 1
                self.last_heartbeat_status = f"HTTP {resp.status_code}"
                return {"status": "error", "auth_state": self.auth_state, "message": self.last_heartbeat_status, "time": now_str}
        except requests.exceptions.ProxyError:
            self.auth_state = "network_error"
            self.is_session_alive = False
            self.consecutive_failures += 1
            self.last_error = f"本地代理无法连接 ({proxy})"
            self.last_heartbeat_status = "代理连接失败"
            return {"status": "network_error", "auth_state": "network_error", "message": self.last_error, "time": now_str}
        except Exception as e:
            self.consecutive_failures += 1
            self.last_heartbeat_status = f"网络波动: {str(e)[:30]}"
            return {"status": "network_error", "auth_state": self.auth_state, "message": self.last_heartbeat_status, "time": now_str}

    def _build_request_headers(self) -> Dict[str, str]:
        """构建推特官方 Web 客户端请求头"""
        auth_token = self.config.get("auth_token", "").strip()
        ct0 = self.config.get("ct0", "").strip()
        full_cookie = self.config.get("full_cookie", "").strip()

        # 优先拼装完整的 Cookie 串，确保推特验证通过
        if full_cookie and "auth_token=" in full_cookie:
            cookie_str = full_cookie
        else:
            cookie_str = f"auth_token={auth_token}; ct0={ct0};"

        bearer = self.config.get("bearer_token", TWITTER_BEARER_TOKEN).strip() or TWITTER_BEARER_TOKEN

        headers = {
            "authorization": bearer,
            "cookie": cookie_str,
            "x-csrf-token": ct0,
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-client-language": "zh-cn",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "accept": "*/*",
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
        }
        return headers

    def test_connection(self) -> Dict[str, Any]:
        """测试推特代理连通性及登录凭证的有效性"""
        proxy = self.config.get("proxy_url", DEFAULT_PROXY_URL)
        proxies = {"http": proxy, "https": proxy}
        result = {
            "proxy_connected": False,
            "twitter_reachable": False,
            "auth_valid": False,
            "tweet_count": 0,
            "message": "",
            "details": ""
        }

        # 1. 测试网络是否能穿透推特
        try:
            resp = requests.get(
                "https://x.com",
                proxies=proxies,
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
                timeout=6
            )
            if resp.status_code in [200, 301, 302]:
                result["proxy_connected"] = True
                result["twitter_reachable"] = True
            else:
                result["message"] = f"推特网络访问返回异常码: {resp.status_code}"
                return result
        except Exception as e:
            result["message"] = f"通过本地代理 [{proxy}] 访问推特失败: {str(e)}"
            return result

        # 2. 测试凭证是否有效
        auth_token = self.config.get("auth_token", "").strip()
        ct0 = self.config.get("ct0", "").strip()
        if not auth_token or not ct0:
            result["message"] = "推特网络通畅，但尚未配置凭证 (auth_token/ct0)。"
            return result

        try:
            headers = self._build_request_headers()
            test_url = "https://x.com/i/api/2/timeline/home.json?tweet_mode=extended&count=5"
            r = requests.get(test_url, headers=headers, proxies=proxies, timeout=10)
            if r.status_code == 200:
                data = r.json()
                tweets = data.get("globalObjects", {}).get("tweets", {})
                result["auth_valid"] = True
                result["tweet_count"] = len(tweets)
                result["message"] = f"🎉 凭证验证成功！成功抓取到您关注的 {len(tweets)} 条最新推文，关注流监控已上线！"
            elif r.status_code == 401 or r.status_code == 403:
                result["message"] = f"❌ 凭据认证失败 ({r.status_code})：auth_token 或 ct0 不匹配或已过期。"
            else:
                result["message"] = f"推特接口返回 HTTP {r.status_code}，详情: {r.text[:100]}"
        except Exception as e:
            result["message"] = f"请求推特关注流时发生异常: {str(e)}"

        return result

    def translate_to_chinese(self, text: str) -> str:
        """自动翻译英文推文为简体中文 (带内存缓存与极速 1.5s 超时防卡死)"""
        if not text or not self.config.get("auto_translate", True):
            return text

        # 1. 优先命中内存缓存
        cache_key = text.strip()[:100]
        if cache_key in self._translation_cache:
            return self._translation_cache[cache_key]

        # 2. 若已包含较多汉字则无需翻译
        chinese_count = sum(1 for ch in text if '\u4e00' <= ch <= '\u9fff')
        if chinese_count > len(text) * 0.35:
            self._translation_cache[cache_key] = text
            return text

        proxy = self.config.get("proxy_url", DEFAULT_PROXY_URL)
        proxies = {"http": proxy, "https": proxy}
        try:
            # 清除推文中无意义的末尾短链 (https://t.co/...)
            clean_text = " ".join([w for w in text.split() if not w.startswith("https://t.co/")])
            if not clean_text:
                clean_text = text

            encoded_query = urllib.parse.quote(clean_text)
            url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q={encoded_query}"
            resp = requests.get(url, proxies=proxies, timeout=1.8)
            if resp.status_code == 200:
                data = resp.json()
                translated = "".join([segment[0] for segment in data[0] if segment and segment[0]])
                if translated:
                    res_str = translated.strip()
                    self._translation_cache[cache_key] = res_str
                    return res_str
        except Exception as e:
            logger.debug(f"翻译服务调用异常或超时，降级展示原文: {e}")

        # 翻译失败降级为原文并做短缓存，防止同一推文反复打超时请求
        self._translation_cache[cache_key] = text
        return text

    def batch_translate_texts(self, texts: List[str]) -> Dict[str, str]:
        """使用线程池多并发极速批量翻译，杜绝串行逐条累积阻塞"""
        import concurrent.futures
        results = {}
        to_translate = []
        for t in texts:
            if not t:
                continue
            ck = t.strip()[:100]
            if ck in self._translation_cache:
                results[t] = self._translation_cache[ck]
            else:
                to_translate.append(t)

        if not to_translate:
            return results

        # 并发最多 6 个子线程同时翻译，总耗时控制在 2 秒内
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(to_translate), 6)) as executor:
            future_to_text = {executor.submit(self.translate_to_chinese, txt): txt for txt in to_translate}
            for future in concurrent.futures.as_completed(future_to_text, timeout=3.5):
                txt = future_to_text[future]
                try:
                    results[txt] = future.result()
                except Exception:
                    results[txt] = txt

        for t in texts:
            if t not in results:
                results[t] = t
        return results

    def map_a_share_concepts(self, text: str) -> tuple[str, List[Dict[str, str]], str]:
        """根据推文内容与翻译，智能打标关联的 A 股题材板块与核心股票"""
        lower_text = text.lower()
        for item in A_SHARE_CONCEPT_MAPPING:
            for kw in item["keywords"]:
                if kw in lower_text:
                    return item["concept"], item["stocks"], "利好催化"

        return "海外科技综合动态", [
            {"symbol": "510300", "name": "沪深300ETF", "desc": "市场基准大盘指数"},
            {"symbol": "159915", "name": "创业板ETF", "desc": "成长科技风向标"}
        ], "日常动态"

    def _parse_relative_time(self, created_at_str: str) -> str:
        """将推特 UTC 时间转换为人类友好的相对时间 (如 3分钟前)"""
        try:
            # 推特格式: 'Fri Sep 04 06:12:44 +0000 2026'
            dt = datetime.strptime(created_at_str, "%a %b %d %H:%M:%S %z %Y")
            now = datetime.now(timezone.utc)
            delta_seconds = int((now - dt).total_seconds())

            if delta_seconds < 60:
                return "刚刚"
            elif delta_seconds < 3600:
                return f"{delta_seconds // 60}分钟前"
            elif delta_seconds < 86400:
                return f"{delta_seconds // 3600}小时前"
            else:
                return f"{delta_seconds // 86400}天前"
        except Exception:
            return created_at_str

    def fetch_intel_stream(self, limit: int = 20, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """获取最新推特情报流 (自动中英翻译 + A 股龙头标的关联 + 优雅容灾降级)"""
        now = time.time()
        # 若未强制刷新且在缓存有效期内，直接返回缓存
        if not force_refresh and self._cached_tweets and (now - self._last_fetch_time < self._cache_ttl_seconds):
            return [asdict(t) for t in self._cached_tweets[:limit]]

        # 尝试非阻塞获取锁，若已有工作线程正在抓取外网，本线程绝不排队等待，直接返回最新缓存（防卡死核心设计）
        acquired = self._fetch_lock.acquire(blocking=False)
        if not acquired:
            if self._cached_tweets:
                return [asdict(t) for t in self._cached_tweets[:limit]]
            if not self._fetch_lock.acquire(timeout=3.0):
                # 若无缓存但本地数据库有历史推文，优先从数据库回显永久数据
                db_res = self.query_tweets_from_db(page=1, page_size=limit)
                if db_res.get("tweets"):
                    return db_res["tweets"]
                return [asdict(t) for t in self._get_fallback_demo_tweets()[:limit]]

        try:
            auth_token = self.config.get("auth_token", "").strip()
            ct0 = self.config.get("ct0", "").strip()
            has_auth = bool(auth_token and ct0)

            tweets: List[TwitterTweetItem] = []

            # 1. 优先使用用户凭证拉取真实关注流 (自动增量去重)
            if has_auth:
                try:
                    db_count = self._get_db_total_count()
                    is_initial = (db_count == 0)
                    tweets, new_cnt, dup_cnt = self._fetch_live_tweets_with_auth(limit=limit, is_initial=is_initial)
                except requests.exceptions.ProxyError as pe:
                    self.auth_state = "network_error"
                    self.is_session_alive = False
                    self.last_error = f"推特本地代理不可用 ({self.config.get('proxy_url', DEFAULT_PROXY_URL)})"
                    logger.warning(f"⚠️ 推特代理连接异常: {pe}")
                except Exception as e:
                    self.last_error = f"抓取推特实时关注流异常: {str(e)[:50]}"
                    logger.error(f"抓取推特实时关注流异常: {e}", exc_info=True)
        finally:
            self._fetch_lock.release()

        # 2. 容灾与永久数据回显：若本次抓取未产生新推文或网络抖动，优先从已有缓存或 SQLite 库提取永久历史
        if not tweets:
            if self._cached_tweets:
                self._last_fetch_time = now
                return [asdict(t) for t in self._cached_tweets[:limit]]
            db_res = self.query_tweets_from_db(page=1, page_size=limit)
            if db_res.get("tweets"):
                self._last_fetch_time = now
                return db_res["tweets"]
            # 仅在库内完全无数据且无凭证时展示精选样本
            tweets = self._get_fallback_demo_tweets()
            if self.auth_state == "online":
                self.data_freshness_desc = "关注流在线，当前博主暂无新推文"
            elif self.auth_state == "expired":
                self.data_freshness_desc = "凭据失效，当前处于演示模式"

        self._cached_tweets = tweets
        self._last_fetch_time = now
        return [asdict(t) for t in self._cached_tweets[:limit]]

    def _fetch_live_tweets_with_auth(self, limit: int = 40, is_initial: bool = False) -> Tuple[List[TwitterTweetItem], int, int]:
        """
        调用推特官方 API 获取关注流推文 (严格基于推文 ID 查重，不更新重复数据)
        返回: (new_items, new_count, duplicate_count)
        """
        proxy = self.config.get("proxy_url", DEFAULT_PROXY_URL)
        proxies = {"http": proxy, "https": proxy}
        headers = self._build_request_headers()

        fetch_count = 60 if is_initial else max(limit, 35)
        url = f"https://x.com/i/api/2/timeline/home.json?tweet_mode=extended&count={fetch_count}"
        resp = requests.get(url, headers=headers, proxies=proxies, timeout=12)

        # 状态捕获：判断 Cookie 是否失效或网络被拦截
        if resp.status_code in [401, 403]:
            self.auth_state = "expired"
            self.is_session_alive = False
            self.consecutive_failures += 1
            self.last_error = f"推特认证失败 (HTTP {resp.status_code})：auth_token 或 Cookie 已失效/已注销，请更新"
            logger.warning(f"⚠️ [TwitterMonitor] 推特 Cookie 已过期 (HTTP {resp.status_code})")
            return [], 0, 0

        if resp.status_code != 200:
            self.consecutive_failures += 1
            self.last_error = f"推特关注流接口返回异常 HTTP {resp.status_code}"
            logger.warning(f"推特关注流接口返回异常: {resp.status_code} - {resp.text[:200]}")
            return [], 0, 0

        # 成功响应：更新存活状态
        self.auth_state = "online"
        self.is_session_alive = True
        self.consecutive_failures = 0
        self.last_error = ""
        self.last_success_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        data = resp.json()
        global_objects = data.get("globalObjects", {})
        raw_tweets = global_objects.get("tweets", {})
        raw_users = global_objects.get("users", {})

        if not raw_tweets:
            self.data_freshness_desc = "关注流在线，当前博主暂无新推文"
            return [], 0, 0

        # 按推文创建时间倒序排序 (最新推文排在最前)
        def parse_tweet_timestamp(t_dict):
            try:
                dt = datetime.strptime(t_dict.get("created_at", ""), "%a %b %d %H:%M:%S %z %Y")
                return dt.timestamp()
            except Exception:
                return 0.0

        sorted_tweets = sorted(raw_tweets.values(), key=parse_tweet_timestamp, reverse=True)

        # 记录最新推文时间与时效性评级
        if sorted_tweets:
            newest_raw_time = sorted_tweets[0].get("created_at", "")
            self.latest_tweet_relative = self._parse_relative_time(newest_raw_time)
            try:
                dt = datetime.strptime(newest_raw_time, "%a %b %d %H:%M:%S %z %Y")
                local_dt = dt.astimezone()
                self.latest_tweet_time = local_dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                self.latest_tweet_time = newest_raw_time
            self.data_freshness_desc = f"关注流同步正常，最新推文于 {self.latest_tweet_relative} 发布"

        # ==================== 核心关键：基于推文 ID 严格去重判定 ====================
        all_tweet_ids = [str(tw.get("id_str", tw.get("id", ""))) for tw in sorted_tweets if str(tw.get("id_str", tw.get("id", "")))]

        if not is_initial:
            existing_ids = self._get_existing_tweet_ids(all_tweet_ids)
            new_raw_tweets = [tw for tw in sorted_tweets if str(tw.get("id_str", tw.get("id", ""))) not in existing_ids]
            duplicate_count = len(sorted_tweets) - len(new_raw_tweets)
            target_tweets = new_raw_tweets[:limit]
        else:
            # 第一次入库初始化模式：入库全部拉取推文
            existing_ids = set()
            target_tweets = sorted_tweets[:limit]
            duplicate_count = 0

        # 若经过查重后没有任何新推文，立即返回！杜绝无意义的翻译和数据库操作！
        if not target_tweets:
            logger.info(f"推特关注流已去重：拉取的 {len(sorted_tweets)} 条推文均已存在于本地数据库，无需重复更新与翻译")
            return [], 0, duplicate_count

        # 仅对【纯新增推文】进行并发批量翻译
        raw_texts = [tw.get("full_text", tw.get("text", "")) for tw in target_tweets]
        translated_map = self.batch_translate_texts(raw_texts)

        items: List[TwitterTweetItem] = []
        for tw in target_tweets:
            tweet_id = str(tw.get("id_str", tw.get("id", "")))
            text_raw = tw.get("full_text", tw.get("text", ""))

            # 提取作者信息
            user_id = str(tw.get("user_id_str", tw.get("user_id", "")))
            user_obj = raw_users.get(user_id, {})
            author_name = user_obj.get("name", "推特博主")
            author_handle = "@" + user_obj.get("screen_name", "unknown")
            author_avatar = user_obj.get("profile_image_url_https", "")

            created_at_raw = tw.get("created_at", "")
            relative_time = self._parse_relative_time(created_at_raw)

            # 命中极速并发翻译结果
            text_translated = translated_map.get(text_raw, text_raw)

            # 智能匹配 A 股概念与标的
            concept, stocks, sentiment = self.map_a_share_concepts(text_raw + " " + text_translated)

            # 智能提取直接提及的具体股票与重要性加权 (结合作者权重与实战词库)
            has_stock, ment_stocks, importance = self._extract_stocks_and_importance(
                text_raw, text_translated, author_handle=author_handle, author_name=author_name
            )
            if ment_stocks:
                existing_symbols = {s["symbol"] for s in stocks}
                for ms in ment_stocks:
                    if ms["symbol"] not in existing_symbols:
                        stocks.insert(0, {"symbol": ms["symbol"], "name": ms["name"], "desc": f"直接提及标的 ({ms.get('market','US')})"})

            screen_name_clean = user_obj.get("screen_name", "")
            tweet_url = f"https://x.com/{screen_name_clean}/status/{tweet_id}" if screen_name_clean else f"https://x.com/i/web/status/{tweet_id}"

            item = TwitterTweetItem(
                id=tweet_id,
                author_name=author_name,
                author_handle=author_handle,
                author_avatar=author_avatar,
                created_at=created_at_raw,
                relative_time=relative_time,
                text_raw=text_raw,
                text_translated=text_translated,
                likes=tw.get("favorite_count", 0),
                retweets=tw.get("retweet_count", 0),
                tweet_url=tweet_url,
                related_concept=concept,
                related_stocks=stocks,
                sentiment=sentiment,
                has_stock_mention=has_stock,
                mentioned_stocks=ment_stocks,
                importance_score=importance,
                is_demo=False
            )
            items.append(item)

        # ⭐️ 自动持久化归档至 SQLite 数据库 (确保推文数据永久留存，永不丢失)
        if items:
            self._upsert_tweets_to_db(items)

        logger.info(f"✅ 推特关注流增量更新完成：新增入库 {len(items)} 条，过滤重复 {duplicate_count} 条！")
        return items, len(items), duplicate_count

    def sync_incremental(self, force_first_init: bool = False) -> Dict[str, Any]:
        """
        核心增量更新通道 (严格去重不更重复数据 + 首次入库初始化 + 永久本地保存)
        - 若本地数据库总数为 0 或显式指定 force_first_init: 执行首次入库初始化
        - 若本地已有数据: 仅拉取最新推文，通过推文 ID 严格去重，仅对纯新增推文执行翻译、概念打标并永久入库
        """
        auth_token = self.config.get("auth_token", "").strip()
        ct0 = self.config.get("ct0", "").strip()
        if not auth_token or not ct0:
            return {
                "success": False,
                "is_first_sync": False,
                "new_count": 0,
                "duplicate_count": 0,
                "total_db_count": self._get_db_total_count(),
                "message": "尚未配置推特 Cookie (auth_token / ct0)，请点击齿轮完成配置"
            }

        with self._fetch_lock:
            current_total = self._get_db_total_count()
            is_initial = (current_total == 0) or force_first_init

            try:
                limit = 60 if is_initial else 40
                new_items, new_count, dup_count = self._fetch_live_tweets_with_auth(limit=limit, is_initial=is_initial)

                total_db = self._get_db_total_count()

                # 更新内存缓存置顶展示
                if new_items:
                    self._cached_tweets = new_items + [t for t in self._cached_tweets if t.id not in {x.id for x in new_items}]
                    self._cached_tweets = self._cached_tweets[:50]
                elif is_initial and not new_items:
                    # 首次入库若网络偶发返回空，尝试预热已有数据
                    self._preload_cache_from_db()

                # 构造直观的人性化反馈信息
                if is_initial:
                    msg = f"🎉 首次入库初始化成功！已永久沉淀 {new_count} 条关注流推文至本地数据库"
                elif new_count > 0:
                    msg = f"🎉 成功增量更新 {new_count} 条最新推文，已自动去重过滤 {dup_count} 条重复数据"
                else:
                    msg = f"👌 当前已是最新状态，已去重过滤 {dup_count} 条历史推文，无重复推文更新"

                result_dict = {
                    "success": True,
                    "is_first_sync": is_initial,
                    "new_count": new_count,
                    "duplicate_count": dup_count,
                    "total_db_count": total_db,
                    "message": msg
                }
                self.last_sync_result = result_dict
                return result_dict
            except Exception as e:
                logger.error(f"执行增量同步异常: {e}", exc_info=True)
                return {
                    "success": False,
                    "is_first_sync": is_initial,
                    "new_count": 0,
                    "duplicate_count": 0,
                    "total_db_count": self._get_db_total_count(),
                    "message": f"同步发生异常: {str(e)}"
                }

    def _start_daily_scheduler(self):
        """启动后台常驻每日定时增量更新调度线程 (每日定时自动增量查缺补漏，严格去重)"""
        def _daily_worker():
            logger.info("⏰ Twitter 增量定时日更守护线程已启动 (每日多频次自动增量查缺补漏)")
            last_sync_date_slot = ""
            while True:
                try:
                    now = datetime.now()
                    now_str = now.strftime("%Y-%m-%d %H:%M")
                    current_hour = now.hour
                    current_minute = now.minute

                    # 预设每日定时自动增量日更时间窗口：
                    # 1. 08:30 (A 股开盘前海外隔夜动态)
                    # 2. 15:30 (A 股收盘后全球科技与宏观情报)
                    # 3. 21:00 (美股开盘前海外大 V 动态)
                    is_sync_window = (
                        (current_hour == 8 and current_minute == 30) or
                        (current_hour == 15 and current_minute == 30) or
                        (current_hour == 21 and current_minute == 0)
                    )

                    slot_key = f"{now.strftime('%Y-%m-%d')}_{current_hour}"
                    if is_sync_window and slot_key != last_sync_date_slot:
                        last_sync_date_slot = slot_key
                        if self.config.get("auth_token") and self.config.get("ct0"):
                            logger.info(f"⏰ 触发推特关注流定时日更自动同步 [{now_str}]...")
                            res = self.sync_incremental(force_first_init=False)
                            self.last_daily_sync_time = now_str
                            if res.get("success"):
                                self.today_added_count += res.get("new_count", 0)
                                logger.info(f"✅ 定时日更执行完毕: {res.get('message')}")
                    time.sleep(40)
                except Exception as ex:
                    logger.error(f"Twitter 定时日更守护异常: {ex}")
                    time.sleep(60)

        t = threading.Thread(target=_daily_worker, daemon=True, name="TwitterDailySchedulerThread")
        t.start()

    def fetch_deep_history(self, max_pages: int = 3, count_per_page: int = 40) -> Dict[str, Any]:
        """向后兼容历史别名，内部转为执行安全增量去重更新"""
        return self.sync_incremental(force_first_init=False)

    def _get_fallback_demo_tweets(self) -> List[TwitterTweetItem]:
        """备用精选雷达样本 (当网络受阻或无凭证时使用)"""
        demo_data = [
            {
                "id": "demo_1",
                "name": "Elon Musk",
                "handle": "@elonmusk",
                "avatar": "https://pbs.twimg.com/profile_images/2053244804520427520/m8mdWZCG_200x200.jpg",
                "time": "刚刚",
                "raw": "Tesla Cybercab & Robotaxi production is scaling rapidly. Unsupervised FSD will roll out to customers in Texas and California soon.",
                "trans": "特斯拉 Cybercab 与 Robotaxi 量产进程正在极速扩张。无人监督版完全自动驾驶 (FSD) 即将在德克萨斯州和加利福尼亚州面向公众推送。",
                "likes": 48200,
                "retweets": 9300
            },
            {
                "id": "demo_2",
                "name": "Sam Altman",
                "handle": "@sama",
                "avatar": "https://pbs.twimg.com/profile_images/1655979505842880512/oE6f5Gf9_200x200.jpg",
                "time": "15分钟前",
                "raw": "Compute clusters are growing 10x per generation. The bottleneck is energy and advanced interconnect, not algorithmic limits.",
                "trans": "算力集群的规模正在以每代 10 倍的速度暴增。当前核心瓶颈是能源供应与先进互联网络，而非算法层面的极限。",
                "likes": 32100,
                "retweets": 5200
            }
        ]

        items = []
        for d in demo_data:
            concept, stocks, sentiment = self.map_a_share_concepts(d["raw"] + " " + d["trans"])
            items.append(TwitterTweetItem(
                id=d["id"],
                author_name=d["name"],
                author_handle=d["handle"],
                author_avatar=d["avatar"],
                created_at=d["time"],
                relative_time=d["time"],
                text_raw=d["raw"],
                text_translated=d["trans"],
                likes=d["likes"],
                retweets=d["retweets"],
                tweet_url=f"https://x.com/{d['handle'].lstrip('@')}",
                related_concept=concept,
                related_stocks=stocks,
                sentiment=sentiment,
                is_demo=True
            )
        )
        return items


# 全局单例
global_twitter_monitor = TwitterMonitorEngine()
