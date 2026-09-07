"""
股票与ETF智能搜索与联想引擎 (Stock & ETF Suggest Engine)
支持：
- A 股主板 / 创业板 / 科创板 / 北交所 (代码、中文、拼音缩写)
- 全市场核心主流 ETF 与场内基金 (易方达、华夏、华宝、国泰、广发、南方、富国等)
- 港股 / 美股 (1810.HK, AAPL, TSLA, NVDA 等)
- 严格权重排序：完全命中/包含 > 代码前缀 > 拼音缩写 > 模糊相关 (彻底杜绝盲猜错配)
"""

import re
import requests
from typing import Optional

# 核心主流 ETF 与常用场内基金字典 (权威对齐)
ETF_DATABASE: dict[str, dict] = {
    "512570": {"name": "证券ETF易方达", "market": "sh", "type": "ETF"},
    "159020": {"name": "养殖ETF易方达", "market": "sz", "type": "ETF"},
    "159278": {"name": "机器人ETF鹏华", "market": "sz", "type": "ETF"},
    "159915": {"name": "创业板ETF易方达", "market": "sz", "type": "ETF"},
    "510300": {"name": "沪深300ETF华泰柏瑞", "market": "sh", "type": "ETF"},
    "510310": {"name": "沪深300ETF易方达", "market": "sh", "type": "ETF"},
    "510500": {"name": "中证500ETF南方", "market": "sh", "type": "ETF"},
    "512880": {"name": "证券ETF国泰", "market": "sh", "type": "ETF"},
    "562500": {"name": "机器人ETF华夏", "market": "sh", "type": "ETF"},
    "159865": {"name": "养殖ETF国泰", "market": "sz", "type": "ETF"},
    "512690": {"name": "酒ETF鹏华", "market": "sh", "type": "ETF"},
    "512010": {"name": "医药ETF易方达", "market": "sh", "type": "ETF"},
    "512660": {"name": "军工ETF国泰", "market": "sh", "type": "ETF"},
    "512480": {"name": "半导体ETF国联安", "market": "sh", "type": "ETF"},
    "512760": {"name": "芯片ETF华宝", "market": "sh", "type": "ETF"},
    "159995": {"name": "芯片ETF华夏", "market": "sz", "type": "ETF"},
    "515050": {"name": "5G通信ETF华夏", "market": "sh", "type": "ETF"},
    "515790": {"name": "光伏ETF华泰柏瑞", "market": "sh", "type": "ETF"},
    "159825": {"name": "农业ETF富国", "market": "sz", "type": "ETF"},
    "518880": {"name": "黄金ETF华安", "market": "sh", "type": "ETF"},
    "159937": {"name": "黄金ETF易方达", "market": "sz", "type": "ETF"},
    "513050": {"name": "中概互联ETF易方达", "market": "sh", "type": "QDII"},
    "513180": {"name": "恒生科技ETF华夏", "market": "sh", "type": "QDII"},
    "159920": {"name": "恒生ETF华夏", "market": "sz", "type": "QDII"},
    "588000": {"name": "科创50ETF华夏", "market": "sh", "type": "ETF"},
    "588080": {"name": "科创板50ETF易方达", "market": "sh", "type": "ETF"},
    "512000": {"name": "券商ETF华宝", "market": "sh", "type": "ETF"},
    "515880": {"name": "通信ETF国泰", "market": "sh", "type": "ETF"},
    "512400": {"name": "有色金属ETF南方", "market": "sh", "type": "ETF"},
    "512170": {"name": "医疗ETF华宝", "market": "sh", "type": "ETF"},
    "159992": {"name": "创新药ETF银华", "market": "sz", "type": "ETF"},
    "515000": {"name": "科技ETF华宝", "market": "sh", "type": "ETF"},
    "512980": {"name": "传媒ETF广发", "market": "sh", "type": "ETF"},
    "512290": {"name": "生物医药ETF国泰", "market": "sh", "type": "ETF"},
}

# 核心常用 A 股与实盘标的映射
STOCK_DATABASE: dict[str, dict] = {
    "600519": {"name": "贵州茅台", "market": "sh", "type": "A股"},
    "000858": {"name": "五粮液", "market": "sz", "type": "A股"},
    "000568": {"name": "泸州老窖", "market": "sz", "type": "A股"},
    "601318": {"name": "中国平安", "market": "sh", "type": "A股"},
    "600036": {"name": "招商银行", "market": "sh", "type": "A股"},
    "000001": {"name": "平安银行", "market": "sz", "type": "A股"},
    "601398": {"name": "工商银行", "market": "sh", "type": "A股"},
    "300750": {"name": "宁德时代", "market": "sz", "type": "A股"},
    "002594": {"name": "比亚迪", "market": "sz", "type": "A股"},
    "002415": {"name": "海康威视", "market": "sz", "type": "A股"},
    "603501": {"name": "韦尔股份", "market": "sh", "type": "A股"},
    "688981": {"name": "中芯国际", "market": "sh", "type": "A股"},
    "002230": {"name": "科大讯飞", "market": "sz", "type": "A股"},
    "600276": {"name": "恒瑞医药", "market": "sh", "type": "A股"},
    "300760": {"name": "迈瑞医疗", "market": "sz", "type": "A股"},
    "601888": {"name": "中国中免", "market": "sh", "type": "A股"},
    "000333": {"name": "美的集团", "market": "sz", "type": "A股"},
    "600887": {"name": "伊利股份", "market": "sh", "type": "A股"},
    "300059": {"name": "东方财富", "market": "sz", "type": "A股"},
    "601012": {"name": "隆基绿能", "market": "sh", "type": "A股"},
    "001330": {"name": "博纳影业", "market": "sz", "type": "A股"},
    "300179": {"name": "四方达", "market": "sz", "type": "A股"},
    "688256": {"name": "寒武纪", "market": "sh", "type": "A股"},
    "300308": {"name": "中际旭创", "market": "sz", "type": "A股"},
    "603986": {"name": "兆易创新", "market": "sh", "type": "A股"},
    "603259": {"name": "药明康德", "market": "sh", "type": "A股"},
    "688611": {"name": "杭州柯林", "market": "sh", "type": "A股"},
    "430047": {"name": "诺思兰德", "market": "bj", "type": "北交所"},
    "872925": {"name": "锦好医疗", "market": "bj", "type": "北交所"},
    "1810.HK": {"name": "小米集团-W", "market": "hk", "type": "港股"},
    "0700.HK": {"name": "腾讯控股", "market": "hk", "type": "港股"},
    "AAPL": {"name": "苹果公司", "market": "us", "type": "美股"},
    "TSLA": {"name": "特斯拉", "market": "us", "type": "美股"},
    "NVDA": {"name": "英伟达", "market": "us", "type": "美股"},
}

# 导出供自然语言解析器 (nl_parser) 使用的全局股票代码与全称字典
_STOCK_NAMES: dict[str, str] = {
    k: v["name"] for k, v in {**STOCK_DATABASE, **ETF_DATABASE}.items()
}


def get_stock_name(symbol: str) -> str:

    """查询股票或ETF名称"""
    sym = symbol.strip().upper()
    if sym in ETF_DATABASE:
        return ETF_DATABASE[sym]["name"]
    if sym in STOCK_DATABASE:
        return STOCK_DATABASE[sym]["name"]
    results = search_stock_sina(symbol, limit=1)
    if results and results[0]["code"].upper() == sym:
        return results[0]["name"]
    return symbol


def get_stock_names(symbols: list[str]) -> dict[str, str]:
    """批量查询股票名称"""
    return {s: get_stock_name(s) for s in symbols}


def search_stock_sina(keyword: str, limit: int = 15) -> list[dict]:
    """智能搜索与精准联想 (严格加权排序)"""
    if not keyword or len(keyword.strip()) < 1:
        return []

    kw = keyword.strip()
    kw_upper = kw.upper()
    kw_lower = kw.lower()

    exact_matches = []
    name_contain_matches = []
    code_prefix_matches = []
    seen_codes = set()

    # 1. 优先扫描 ETF 数据库 (解决搜“易方达”、“华夏”等出来的 ETF 联想)
    for code, info in ETF_DATABASE.items():
        name = info["name"]
        item = {"code": code, "name": name, "market": info["market"], "type": info["type"]}
        if code == kw_upper or name == kw:
            if code not in seen_codes:
                exact_matches.append(item)
                seen_codes.add(code)
        elif kw in name:
            if code not in seen_codes:
                name_contain_matches.append(item)
                seen_codes.add(code)
        elif code.startswith(kw_upper):
            if code not in seen_codes:
                code_prefix_matches.append(item)
                seen_codes.add(code)

    # 2. 扫描常用股票数据库
    for code, info in STOCK_DATABASE.items():
        name = info["name"]
        item = {"code": code, "name": name, "market": info["market"], "type": info["type"]}
        if code == kw_upper or name == kw:
            if code not in seen_codes:
                exact_matches.append(item)
                seen_codes.add(code)
        elif kw in name:
            if code not in seen_codes:
                name_contain_matches.append(item)
                seen_codes.add(code)
        elif code.startswith(kw_upper):
            if code not in seen_codes:
                code_prefix_matches.append(item)
                seen_codes.add(code)

    # 3. 针对 6 位纯数字代码，直连行情专线兜底
    if len(kw) == 6 and kw.isdigit() and kw not in seen_codes:
        from utils.realtime import get_sina_realtime_quote
        q = get_sina_realtime_quote(kw)
        if q and q.get("name") and q.get("name") != kw:
            clean_sym = kw.replace(".SH", "").replace(".SZ", "")
            mkt = "sh" if clean_sym.startswith(("6", "9", "5", "688")) else "sz"
            item = {"code": clean_sym, "name": q["name"], "market": mkt, "type": "A股/ETF"}
            exact_matches.insert(0, item)
            seen_codes.add(clean_sym)

    # 4. 新浪 Suggest 全网联想补齐
    remote_matches = []
    try:
        session = requests.Session()
        session.trust_env = False
        url = f"https://suggest3.sinajs.cn/suggest/type=11,12,13,14,31,41&key={kw}&name=suggest"
        resp = session.get(url, timeout=3.5, headers={
            "Referer": "https://finance.sina.com.cn",
            "User-Agent": "Mozilla/5.0",
        })
        resp.encoding = "gbk"
        text = resp.text
        if "=" in text and '=""' not in text:
            data = text.split('"')[1]
            items = data.split(";")
            for raw in items:
                parts = raw.split(",")
                if len(parts) < 5:
                    continue
                full_code = parts[0].strip()
                type_id = parts[1].strip()
                code = parts[2].strip()
                name = parts[4].strip()

                market = "sz"
                st_type = "A股"
                if type_id in ("11", "12"):
                    market = "sh" if full_code.startswith("sh") else "sz"
                elif type_id == "31":
                    market = "hk"
                    st_type = "港股"
                    clean_num = str(int(code)) if code.isdigit() else code
                    code = f"{clean_num}.HK" if not code.endswith(".HK") else code
                elif type_id == "41":
                    market = "us"
                    st_type = "美股"
                    code = code.upper()
                elif type_id in ("13", "14"):
                    market = "sh" if full_code.startswith("sh") else "sz"
                    st_type = "ETF"

                if code in seen_codes:
                    continue
                seen_codes.add(code)

                it = {"code": code, "name": name, "market": market, "type": st_type}
                # 如果名称完全包含关键字，优先加入
                if kw in name:
                    name_contain_matches.append(it)
                else:
                    remote_matches.append(it)
    except Exception:
        pass

    # 最终严格按权重合并
    final_results = exact_matches + name_contain_matches + code_prefix_matches + remote_matches
    return final_results[:limit]


def get_popular_stocks() -> list[dict]:
    """获取热门股票与核心标的"""
    return [
        {"code": "600519", "name": "贵州茅台", "market": "sh", "sector": "白酒"},
        {"code": "000858", "name": "五粮液", "market": "sz", "sector": "白酒"},
        {"code": "300750", "name": "宁德时代", "market": "sz", "sector": "新能源"},
        {"code": "002594", "name": "比亚迪", "market": "sz", "sector": "新能源"},
        {"code": "001330", "name": "博纳影业", "market": "sz", "sector": "影视"},
        {"code": "512570", "name": "证券ETF易方达", "market": "sh", "sector": "券商"},
        {"code": "159278", "name": "机器人ETF鹏华", "market": "sz", "sector": "机器人"},
        {"code": "159020", "name": "养殖ETF易方达", "market": "sz", "sector": "养殖"},
        {"code": "1810.HK", "name": "小米集团-W", "market": "hk", "sector": "科技"},
        {"code": "AAPL", "name": "苹果公司", "market": "us", "sector": "消费电子"},
    ]


# 统一函数别名导出
search_symbol = search_stock_sina
search_stocks = search_stock_sina

