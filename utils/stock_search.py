"""股票搜索：新浪搜索API（支持代码/名称联想）"""
import requests
import re

# 缓存热门股票（避免频繁请求）
_POPULAR_STOCKS: list[dict] | None = None


def search_stock_sina(keyword: str, limit: int = 10) -> list[dict]:
    """通过新浪搜索接口查找股票（支持代码/名称/拼音）

    Args:
        keyword: 搜索关键词，如 "茅台"、"600519"、"maotai"
        limit: 返回条数
    Returns:
        [{"code": "600519", "name": "贵州茅台", "market": "sh"}, ...]
    """
    if not keyword or len(keyword) < 1:
        return []

    try:
        session = requests.Session()
        session.trust_env = False
        url = "https://suggest3.sinajs.cn/suggest/type=&key={}&name=suggest"
        resp = session.get(url.format(keyword), timeout=5, headers={
            "Referer": "https://finance.sina.com.cn"
        })
        resp.encoding = "gbk"

        # 格式: var suggest="market_code,type,code,market_code,name,...;..."
        text = resp.text
        if '=""' in text or "=" not in text:
            return []

        data = text.split('"')[1]
        items = data.split(";")

        results = []
        for item in items:
            parts = item.split(",")
            if len(parts) < 5:
                continue

            # 新浪格式: [sh600519, 11, 600519, sh600519, 贵州茅台, ...]
            full_code = parts[0]  # sh600519 或 sz000001
            code = parts[2]       # 600519
            name = parts[4]       # 贵州茅台

            # 只保留 6 位数字代码的 A 股
            if not re.match(r'^[03689]\d{5}$', code):
                continue

            market = "sh" if full_code.startswith("sh") else "sz"

            results.append({
                "code": code,
                "name": name,
                "market": market,
            })
            if len(results) >= limit:
                break

        return results
    except Exception:
        return []


def get_popular_stocks() -> list[dict]:
    """获取热门股票列表（内置，不依赖网络）"""
    return [
        {"code": "600519", "name": "贵州茅台", "market": "sh", "sector": "白酒"},
        {"code": "000858", "name": "五粮液", "market": "sz", "sector": "白酒"},
        {"code": "000568", "name": "泸州老窖", "market": "sz", "sector": "白酒"},
        {"code": "601318", "name": "中国平安", "market": "sh", "sector": "保险"},
        {"code": "600036", "name": "招商银行", "market": "sh", "sector": "银行"},
        {"code": "000001", "name": "平安银行", "market": "sz", "sector": "银行"},
        {"code": "601398", "name": "工商银行", "market": "sh", "sector": "银行"},
        {"code": "300750", "name": "宁德时代", "market": "sz", "sector": "新能源"},
        {"code": "002594", "name": "比亚迪", "market": "sz", "sector": "新能源"},
        {"code": "002415", "name": "海康威视", "market": "sz", "sector": "安防"},
        {"code": "603501", "name": "韦尔股份", "market": "sh", "sector": "半导体"},
        {"code": "688981", "name": "中芯国际", "market": "sh", "sector": "半导体"},
        {"code": "002230", "name": "科大讯飞", "market": "sz", "sector": "AI"},
        {"code": "600276", "name": "恒瑞医药", "market": "sh", "sector": "医药"},
        {"code": "300760", "name": "迈瑞医疗", "market": "sz", "sector": "医疗器械"},
        {"code": "601888", "name": "中国中免", "market": "sh", "sector": "旅游"},
        {"code": "000333", "name": "美的集团", "market": "sz", "sector": "家电"},
        {"code": "600887", "name": "伊利股份", "market": "sh", "sector": "食品"},
        {"code": "300059", "name": "东方财富", "market": "sz", "sector": "券商"},
        {"code": "601857", "name": "中国石油", "market": "sh", "sector": "能源"},
    ]
