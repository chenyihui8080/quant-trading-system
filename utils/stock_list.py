"""全量股票列表：A 股（baostock） + 港股/美股（内置热门）"""
import json
from pathlib import Path
from datetime import datetime, timedelta

CACHE_FILE = Path(__file__).parent.parent / "data" / "stock_list.json"
_CACHE: list[dict] | None = None

# ==================== 港股热门 ====================
HK_STOCKS = [
    {"code": "0700.HK", "name": "腾讯控股", "market": "hk"},
    {"code": "9988.HK", "name": "阿里巴巴-W", "market": "hk"},
    {"code": "9618.HK", "name": "京东集团-SW", "market": "hk"},
    {"code": "3690.HK", "name": "美团-W", "market": "hk"},
    {"code": "9999.HK", "name": "网易-S", "market": "hk"},
    {"code": "1810.HK", "name": "小米集团-W", "market": "hk"},
    {"code": "9888.HK", "name": "百度集团-SW", "market": "hk"},
    {"code": "0388.HK", "name": "香港交易所", "market": "hk"},
    {"code": "0005.HK", "name": "汇丰控股", "market": "hk"},
    {"code": "1299.HK", "name": "友邦保险", "market": "hk"},
    {"code": "0941.HK", "name": "中国移动", "market": "hk"},
    {"code": "0883.HK", "name": "中国海洋石油", "market": "hk"},
    {"code": "2318.HK", "name": "中国平安", "market": "hk"},
    {"code": "0001.HK", "name": "长和", "market": "hk"},
    {"code": "0002.HK", "name": "中电控股", "market": "hk"},
    {"code": "0003.HK", "name": "香港中华煤气", "market": "hk"},
    {"code": "0011.HK", "name": "恒生银行", "market": "hk"},
    {"code": "0016.HK", "name": "新鸿基地产", "market": "hk"},
    {"code": "0027.HK", "name": "银河娱乐", "market": "hk"},
    {"code": "0066.HK", "name": "港铁公司", "market": "hk"},
    {"code": "0101.HK", "name": "恒隆集团", "market": "hk"},
    {"code": "0175.HK", "name": "吉利汽车", "market": "hk"},
    {"code": "0241.HK", "name": "阿里健康", "market": "hk"},
    {"code": "0267.HK", "name": "中信股份", "market": "hk"},
    {"code": "0288.HK", "name": "万洲国际", "market": "hk"},
    {"code": "0386.HK", "name": "中国石油化工", "market": "hk"},
    {"code": "0669.HK", "name": "创科实业", "market": "hk"},
    {"code": "0762.HK", "name": "中国联通", "market": "hk"},
    {"code": "0823.HK", "name": "领展房产基金", "market": "hk"},
    {"code": "0857.HK", "name": "中国石油股份", "market": "hk"},
    {"code": "0939.HK", "name": "建设银行", "market": "hk"},
    {"code": "0960.HK", "name": "龙湖集团", "market": "hk"},
    {"code": "1038.HK", "name": "长江基建集团", "market": "hk"},
    {"code": "1044.HK", "name": "恒安国际", "market": "hk"},
    {"code": "1093.HK", "name": "石药集团", "market": "hk"},
    {"code": "1109.HK", "name": "华润置地", "market": "hk"},
    {"code": "1113.HK", "name": "长实集团", "market": "hk"},
    {"code": "1177.HK", "name": "中国生物制药", "market": "hk"},
    {"code": "1211.HK", "name": "比亚迪股份", "market": "hk"},
    {"code": "1378.HK", "name": "中国宏桥", "market": "hk"},
    {"code": "1398.HK", "name": "工商银行", "market": "hk"},
    {"code": "1928.HK", "name": "金沙中国有限公司", "market": "hk"},
    {"code": "1929.HK", "name": "周大福", "market": "hk"},
    {"code": "1997.HK", "name": "九龙仓置业", "market": "hk"},
    {"code": "2007.HK", "name": "碧桂园", "market": "hk"},
    {"code": "2018.HK", "name": "瑞声科技", "market": "hk"},
    {"code": "2020.HK", "name": "安踏体育", "market": "hk"},
    {"code": "2269.HK", "name": "药明生物", "market": "hk"},
    {"code": "2313.HK", "name": "申洲国际", "market": "hk"},
    {"code": "2319.HK", "name": "蒙牛乳业", "market": "hk"},
    {"code": "2382.HK", "name": "舜宇光学科技", "market": "hk"},
    {"code": "2388.HK", "name": "中银香港", "market": "hk"},
    {"code": "2628.HK", "name": "中国人寿", "market": "hk"},
    {"code": "3328.HK", "name": "交通银行", "market": "hk"},
    {"code": "3968.HK", "name": "招商银行", "market": "hk"},
    {"code": "3988.HK", "name": "中国银行", "market": "hk"},
    {"code": "6098.HK", "name": "碧桂园服务", "market": "hk"},
    {"code": "6618.HK", "name": "京东健康", "market": "hk"},
    {"code": "6862.HK", "name": "海底捞", "market": "hk"},
    {"code": "9626.HK", "name": "哔哩哔哩-W", "market": "hk"},
    {"code": "9698.HK", "name": "万国数据-SW", "market": "hk"},
    {"code": "9868.HK", "name": "小鹏汽车-W", "market": "hk"},
    {"code": "9866.HK", "name": "蔚来-SW", "market": "hk"},
    {"code": "2518.HK", "name": "汽车之家-S", "market": "hk"},
    {"code": "0285.HK", "name": "比亚迪电子", "market": "hk"},
    {"code": "6690.HK", "name": "海尔智家", "market": "hk"},
    {"code": "1288.HK", "name": "农业银行", "market": "hk"},
    {"code": "0981.HK", "name": "中芯国际", "market": "hk"},
    {"code": "2400.HK", "name": "心动公司", "market": "hk"},
    {"code": "9961.HK", "name": "携程集团-S", "market": "hk"},
    {"code": "1024.HK", "name": "快手-W", "market": "hk"},
    {"code": "2015.HK", "name": "理想汽车-W", "market": "hk"},
]

# ==================== 美股热门 ====================
US_STOCKS = [
    {"code": "AAPL", "name": "苹果 Apple", "market": "us"},
    {"code": "MSFT", "name": "微软 Microsoft", "market": "us"},
    {"code": "GOOGL", "name": "谷歌 Alphabet", "market": "us"},
    {"code": "AMZN", "name": "亚马逊 Amazon", "market": "us"},
    {"code": "NVDA", "name": "英伟达 NVIDIA", "market": "us"},
    {"code": "META", "name": "Meta Platforms", "market": "us"},
    {"code": "TSLA", "name": "特斯拉 Tesla", "market": "us"},
    {"code": "BRK-B", "name": "伯克希尔 Berkshire", "market": "us"},
    {"code": "JPM", "name": "摩根大通 JPMorgan", "market": "us"},
    {"code": "V", "name": "维萨 Visa", "market": "us"},
    {"code": "JNJ", "name": "强生 Johnson&Johnson", "market": "us"},
    {"code": "WMT", "name": "沃尔玛 Walmart", "market": "us"},
    {"code": "MA", "name": "万事达 Mastercard", "market": "us"},
    {"code": "PG", "name": "宝洁 Procter&Gamble", "market": "us"},
    {"code": "UNH", "name": "联合健康 UnitedHealth", "market": "us"},
    {"code": "HD", "name": "家得宝 Home Depot", "market": "us"},
    {"code": "DIS", "name": "迪士尼 Disney", "market": "us"},
    {"code": "BAC", "name": "美国银行 BofA", "market": "us"},
    {"code": "XOM", "name": "埃克森美孚 ExxonMobil", "market": "us"},
    {"code": "KO", "name": "可口可乐 Coca-Cola", "market": "us"},
    {"code": "PFE", "name": "辉瑞 Pfizer", "market": "us"},
    {"code": "NFLX", "name": "奈飞 Netflix", "market": "us"},
    {"code": "ADBE", "name": "Adobe", "market": "us"},
    {"code": "CRM", "name": "赛富时 Salesforce", "market": "us"},
    {"code": "AMD", "name": "AMD", "market": "us"},
    {"code": "INTC", "name": "英特尔 Intel", "market": "us"},
    {"code": "CSCO", "name": "思科 Cisco", "market": "us"},
    {"code": "ORCL", "name": "甲骨文 Oracle", "market": "us"},
    {"code": "QCOM", "name": "高通 Qualcomm", "market": "us"},
    {"code": "AVGO", "name": "博通 Broadcom", "market": "us"},
    {"code": "TXN", "name": "德州仪器 TI", "market": "us"},
    {"code": "NIO", "name": "蔚来 NIO", "market": "us"},
    {"code": "BABA", "name": "阿里巴巴 Alibaba", "market": "us"},
    {"code": "JD", "name": "京东 JD.com", "market": "us"},
    {"code": "PDD", "name": "拼多多 PDD Holdings", "market": "us"},
    {"code": "BIDU", "name": "百度 Baidu", "market": "us"},
    {"code": "LI", "name": "理想汽车 Li Auto", "market": "us"},
    {"code": "XPEV", "name": "小鹏汽车 XPeng", "market": "us"},
    {"code": "TME", "name": "腾讯音乐 TME", "market": "us"},
    {"code": "BILI", "name": "哔哩哔哩 Bilibili", "market": "us"},
    {"code": "ZH", "name": "知乎 Zhihu", "market": "us"},
    {"code": "MNSO", "name": "名创优品 MINISO", "market": "us"},
    {"code": "FUTU", "name": "富途 Futu", "market": "us"},
    {"code": "TAL", "name": "好未来 TAL Education", "market": "us"},
    {"code": "VNET", "name": "世纪互联 21Vianet", "market": "us"},
    {"code": "TSM", "name": "台积电 TSMC", "market": "us"},
    {"code": "SOFI", "name": "SoFi Technologies", "market": "us"},
    {"code": "SQ", "name": "Block (Square)", "market": "us"},
    {"code": "UBER", "name": "优步 Uber", "market": "us"},
    {"code": "ABNB", "name": "爱彼迎 Airbnb", "market": "us"},
    {"code": "COIN", "name": "Coinbase", "market": "us"},
    {"code": "PLTR", "name": "Palantir", "market": "us"},
    {"code": "SNOW", "name": "Snowflake", "market": "us"},
    {"code": "SHOP", "name": "Shopify", "market": "us"},
    {"code": "SPOT", "name": "Spotify", "market": "us"},
    {"code": "PYPL", "name": "PayPal", "market": "us"},
    {"code": "SQ", "name": "Block Inc", "market": "us"},
    {"code": "MRVL", "name": "Marvell", "market": "us"},
    {"code": "MU", "name": "美光 Micron", "market": "us"},
    {"code": "MRNA", "name": "Moderna", "market": "us"},
]


def _load_cache() -> list[dict]:
    """从本地缓存加载 A 股列表"""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE) as f:
                data = json.load(f)
            if data.get("updated"):
                updated = datetime.fromisoformat(data["updated"])
                if datetime.now() - updated > timedelta(days=7):
                    return []
            _CACHE = data.get("stocks", [])
            return _CACHE
        except Exception:
            pass
    return []


def refresh_stock_list() -> int:
    """从 baostock 下载全量 A 股列表并缓存"""
    import baostock as bs

    bs.login()
    rs = bs.query_stock_basic()
    rows = []
    while rs.next():
        rows.append(rs.get_row_data())
    bs.logout()

    stocks = []
    for r in rows:
        if r[4] != "1" or r[5] != "1":
            continue
        code_full = r[0]
        code = code_full.split(".")[1]
        name = r[1]
        market = "sh" if code_full.startswith("sh") else "sz"
        stocks.append({"code": code, "name": name, "market": market})

    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump({"updated": datetime.now().isoformat(), "stocks": stocks}, f, ensure_ascii=False)

    global _CACHE
    _CACHE = stocks
    return len(stocks)


def ensure_stock_list() -> list[dict]:
    """确保 A 股列表可用"""
    stocks = _load_cache()
    if not stocks:
        refresh_stock_list()
        stocks = _load_cache()
    return stocks


def search_stocks_local(keyword: str, limit: int = 50, market: str = "") -> list[dict]:
    """本地搜索股票（A 股 + 港股 + 美股）

    Args:
        keyword: 搜索关键词（代码、名称）
        limit: 最大返回条数
        market: 过滤市场 a/hk/us，空=全部
    """
    keyword = keyword.strip().upper()
    if not keyword:
        return []

    all_stocks = []

    # A 股（从缓存加载）
    if not market or market == "a":
        all_stocks.extend(ensure_stock_list())

    # 港股
    if not market or market == "hk":
        all_stocks.extend(HK_STOCKS)

    # 美股
    if not market or market == "us":
        all_stocks.extend(US_STOCKS)

    exact = []
    starts = []
    contains = []

    for s in all_stocks:
        code = s["code"].upper()
        name = s["name"].upper()

        if code == keyword or name == keyword:
            exact.append(s)
        elif code.startswith(keyword) or name.startswith(keyword):
            starts.append(s)
        elif keyword in code or keyword in name:
            contains.append(s)

    # A 股没结果时，用新浪搜索拼音
    if not exact and not starts and not contains and (not market or market == "a"):
        from utils.stock_search import search_stock_sina
        sina_results = search_stock_sina(keyword, limit=limit)
        if sina_results:
            return sina_results

    results = exact + starts + contains
    return results[:limit]
