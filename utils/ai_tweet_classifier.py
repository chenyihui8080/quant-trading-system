#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
推特金融情报智能过滤器 (AI Tweet Classifier) - 重构版

核心设计思路：
  分三层处理，绝不用同一把尺子量所有推文：

  第1层 - 博主类型感知（最重要）
    - A股实盘博主（爱玩股票、大策复盘、证势交易）：只要不是明显广告，全部放行。
      这些人发的每一条基本都和股票有关。
    - 宏观/科技博主（亚洲金融、超级财经、Vincent、Berryxia等）：
      过滤掉明显的八卦闹剧，其余放行。
    - 非股票博主（李老师、韩跑跑、孙宇晨等）：
      只有明确带股票代码才放行，其余过滤。

  第2层 - 硬性扑杀（不论是谁发的）
    - 社群引流、打卡广告、色情内容、黑客攻击威胁等

  第3层 - 股票代码直通
    - 只要出现 $NVDA / 300308 等明确股票代码，直接放行，不问出处
"""

import re
import json
import logging
import requests
from typing import Dict, Any, List

logger = logging.getLogger("AITweetClassifier")

# 本地 Ollama 地址
OLLAMA_API_URL = "http://127.0.0.1:11434/api/generate"

# ─── 博主分类：从 twitter_monitor.py 的 AUTHOR_PROFILE_MAP 映射过来 ───
# A股实盘博主：全放行（除广告外）
A_STOCK_AUTHORS = {
    "snake_w", "dacefupan", "aiwangupiao", "xiajingfa8"
}

# 宏观全球/商业财经博主（发文多为资本市场、利率、汇率、财报）
MACRO_FINANCE_AUTHORS = {
    "asiafinance", "supfin", "ifinance", "globalmoney", "ceobriefing", "caijingtianxia"
}

# 科技产业/数码供应链博主（需过滤纯数码生活闲聊与魔术娱乐，只保留产业供应链）
TECH_HARDWARE_AUTHORS = {
    "stanleysobest", "weiyux2021", "vincent_ainotes", "berryxia",
    "aleabitoreddit", "brand", "dilumsanjaya", "_forab"
}

# 非股票博主（严控）：只有明确带股票代码或专业复盘才放行
NON_STOCK_AUTHORS = {
    "whyyoutouzhele", "hanpaoao", "sunyuchentron", "justinsuntron",
    "huobiglobal", "baby__btc", "wolfyxbt", "0xmoon", "akokoi1",
    "shanghaojin", "realpurenomad", "ring_hyacinth"
}

# 科技产业必须具备的产业/投研实体关键词（无则视为生活杂谈扑杀）
TECH_INDUSTRY_REQUIRED_KEYWORDS = [
    # 芯片与硬件
    "芯片", "半导体", "台积电", "英伟达", "黄仁勋", "GPU", "算力", "光模块",
    "Blackwell", "B200", "B100", "华强北", "现货", "现货价", "元器件", "内存", "闪存",
    "DDR", "NAND", "固态", "SSD", "显卡", "代工", "晶圆", "刻蚀", "光刻",
    # 消费电子与果链
    "苹果", "iPhone", "果链", "立讯", "歌尔", "蓝思", "华为", "小米", "折叠屏",
    "出货量", "供应链", "富士康", "手机市场", "订单", "供应商",
    # AI与软件生态投资
    "OpenAI", "Anthropic", "Claude", "ChatGPT", "DeepSeek", "Sora",
    "AI Agent", "智能体", "大模型", "算力集群", "数据中心",
    # 智能汽车与新能源
    "特斯拉", "马斯克", "Robotaxi", "FSD", "智驾", "自动驾驶", "比亚迪", "人形机器人",
    # 金融资本
    "股票", "上市", "财报", "市值", "营收", "估值", "融资", "IPO", "收购"
]

# 科技博主明确的无意义生活闲聊词（命中必杀）
TECH_CASUAL_NOISE_KEYWORDS = [
    "口喷珠子", "喷珠子", "做 PPT", "做PPT", "PPT 吗", "PPT吗",
    "魔术", "吃什么", "今天吃", "猪脚饭", "看半天了愣是", "连续口喷"
]

# ─── A股实盘必须具备的盘面/个股/交易核心关键词（无则视为私人碎碎念/动图杂谈扑杀）───
A_STOCK_REQUIRED_KEYWORDS = [
    # 市场行情与节奏
    "大盘", "指数", "走势", "板块", "题材", "主线", "轮动", "行情", "反弹", "回调", "震荡",
    "收评", "午评", "早评", "盘前", "盘中", "盘后", "复盘", "高开", "低开", "连板",
    "涨停", "跌停", "涨跌", "跌幅", "涨幅", "成交额", "缩量", "放量", "资金流", "微走强", "配资",
    # 宏观政策与利率汇率（实盘大V常做的宏观推演）
    "美联储", "降息", "加息", "降准", "央行", "美元", "汇率", "日元", "人民币", "通胀", "CPI", "宏观", "流动性", "外资", "关税",
    # 操作与策略
    "仓位", "买入", "卖出", "加仓", "减仓", "建仓", "清仓", "止损", "止盈", "做多", "做空",
    "低吸", "追高", "打板", "抄底", "逢高", "逢低", "持股", "标的", "个股", "选股", "持仓",
    "ETF", "科创50", "创业板", "沪深300", "上证", "深证", "北向", "主力", "机构", "主力资金",
    # 常见核心板块
    "养殖", "半导体", "消费电子", "锂电", "电池", "光伏", "储能", "算力", "光模块",
    "机器人", "低空经济", "医药", "军工", "汽车", "证券", "银行", "保险", "地产", "海南", "农业", "种业", "化肥", "粮食", "电力",
    # 知名龙头股与公司实体
    "宁德时代", "比亚迪", "中际旭创", "新易盛", "天孚通信", "中芯国际", "浪潮信息", "赛力斯",
    "寒武纪", "北方华创", "三花智控", "立讯精密", "贵州茅台", "五粮液", "英伟达", "特斯拉", "苹果",
    "爱普", "亨王", "亨迪", "亨通"
]

# ─── A股博主典型私人情绪碎碎念/文艺抒情/微信吐槽（命中必杀）───
A_STOCK_CASUAL_NOISE_KEYWORDS = [
    "听懂了么", "可笑吧", "破防了", "刷平台的", "拉拢了", "反倒态差",
    "心中不灭的理想", "追光而行", "抵达梦想的彼岸", "不负风雨", "一路同行",
    "换脸普通话", "女装一路", "生崖篇", "配额从哪里", "等妈妈", "捏心啊"
]

# ─── 绝对垃圾：不论谁发，一票否决 ───
ABSOLUTE_SPAM_KEYWORDS = [
    # 引流广告与软件福利薅羊毛 (非金融投资)
    "打卡戒色", "赠送独家指标", "独家通达信指标", "社群内部打卡", "进群打卡",
    "入群打卡", "打卡满", "打卡送", "指标以及用法", "源码分享", "社群里打卡",
    "打卡功能", "独家指标", "会员购买", "被黑客", "黑客威胁",
    "羊毛", "送Credits", "送1,250", "1250 Credits", "安装指定插件", "免费额度", "兑换码",
    # 故事随笔与个人经商鸡汤 (非证券产业数据)
    "我最近发现一个挺魔幻的事", "我认识一个人", "跑本地装修公司", "他不卖课", "哪里麻烦，就去哪里收费",
    # 明星娱乐八卦与二手房中介房产
    "景甜", "豪宅仅仅跌", "豪宅价格跌去", "占地5亩", "诚意要转出", "原价6000万", "豪华套房",
    # 历史政治非市场旧闻
    "孟晚舟", "在加拿大被捕时", "乘坐中国政府包机", "四年前，孟",
    # 社会八卦（之前频繁污染的内容）
    "拉裤兜", "裸奔", "撞破护栏", "试驾车撞", "神秘死亡",
    "赵一鸣", "好想来", "牛肉干", "复秤", "住户调查",
    "赚够三千万", "猪脚饭", "日本职场", "高额彩礼", "彩礼"
]

# ─── A股实盘博主例外黑名单（不放行的特殊情况）───
A_STOCK_AUTHOR_EXCEPTIONS = [
    "打卡戒色", "进群", "入群", "加微信", "微信群", "打卡功能",
    "打卡满", "独家指标", "社群打卡", "会员购买", "被黑客"
]

# ─── 宏观财经博主过滤词 ───
MACRO_FINANCE_SPAM_KEYWORDS = [
    "拉裤兜", "裸奔", "撞破护栏", "试驾车撞", "神秘死亡",
    "赵一鸣", "好想来", "牛肉干", "住户调查", "猪脚饭", "彩礼",
    "景甜", "豪宅仅仅跌", "豪宅价格跌去", "孟晚舟", "在加拿大被捕时"
]

# ─── 缓存 ───
_CLASSIFIER_CACHE: Dict[str, Dict[str, Any]] = {}


def extract_explicit_stock_codes(text: str) -> List[str]:
    """提取文本中的股票代码：美股 $TICKER 和 A股 6位数字代码"""
    if not text:
        return []
    found = []

    # 美股 $TICKER
    us_matches = re.findall(r'\$([A-Za-z]{1,6})\b', text)
    ignore_us = {"USD", "USDT", "BTC", "ETH", "SOL", "AI", "CEO", "IPO",
                 "FED", "CPI", "SEC", "GDP", "LLM", "API", "ETF", "RT"}
    for sym in us_matches:
        u = sym.upper()
        if u not in ignore_us and u not in found:
            found.append(u)

    # A股 6位数字代码
    cn_matches = re.findall(
        r'(?<!\d)(?:60\d{4}|00\d{4}|30\d{4}|68\d{4}|15\d{4}|51\d{4}|56\d{4}|58\d{4}|92\d{4})(?!\d)',
        text
    )
    for code in cn_matches:
        if code not in found:
            found.append(code)

    return found


def classify_tweet(tweet_text: str, author_handle: str = "", tweet_id: str = "") -> Dict[str, Any]:
    """
    三层分类策略：
      层1 - 绝对垃圾词：一票否决
      层2 - 股票代码直通：一票通过
      层3 - 按博主类型差异化过滤
    """
    text = (tweet_text or "").strip()
    if not text:
        return _make_result(False, True, [], "内容为空", "rule")

    # 缓存命中直接返回
    cache_key = tweet_id if tweet_id else text[:80]
    if cache_key in _CLASSIFIER_CACHE:
        return _CLASSIFIER_CACHE[cache_key]

    # 规范化博主 handle
    handle = author_handle.lower().lstrip("@").strip()

    # ══════════════════════════════════════════
    # 层1：绝对垃圾关键词，不论谁发，一票否决
    # ══════════════════════════════════════════
    if any(kw in text for kw in ABSOLUTE_SPAM_KEYWORDS):
        res = _make_result(False, True, [], "命中绝对垃圾词", "hard_spam")
        _CLASSIFIER_CACHE[cache_key] = res
        return res

    # ══════════════════════════════════════════
    # 层2：明确股票代码直通，不问出处
    # ══════════════════════════════════════════
    explicit_codes = extract_explicit_stock_codes(text)
    if explicit_codes:
        res = _make_result(True, False, explicit_codes,
                           f"含股票代码: {', '.join(explicit_codes)}", "code_pass")
        _CLASSIFIER_CACHE[cache_key] = res
        return res

    # ══════════════════════════════════════════
    # 层3：按博主类型差异化精准处理
    # ══════════════════════════════════════════

    # ── 1. A股实盘博主：必须是真正的盘面/板块/操作/个股研判，严禁动图梗、文艺鸡汤与微信碎碎念 ──
    if handle in A_STOCK_AUTHORS:
        # (1) 违规引流广告一票否决
        if any(kw in text for kw in A_STOCK_AUTHOR_EXCEPTIONS):
            res = _make_result(False, True, [], "A股博主发布引流广告", "a_stock_spam")
            _CLASSIFIER_CACHE[cache_key] = res
            return res

        # (2) 文艺抒情鸡汤/私人吐槽碎碎念一票否决
        if any(kw in text for kw in A_STOCK_CASUAL_NOISE_KEYWORDS):
            res = _make_result(False, True, [], "A股博主私人碎碎念/鸡汤文艺抒情/微信吐槽", "a_stock_casual_noise")
            _CLASSIFIER_CACHE[cache_key] = res
            return res

        # (3) 极短无实质内容动图梗（如去除URL后不足5个汉字且无股票词）
        text_without_url = re.sub(r'https?://\S+', '', text).strip()
        chinese_count = len(re.findall(r'[\u4e00-\u9fa5]', text_without_url))
        if chinese_count < 5:
            res = _make_result(False, True, [], "A股博主极短无实质内容动图梗", "a_stock_too_short")
            _CLASSIFIER_CACHE[cache_key] = res
            return res

        # (4) 核心实质准入：必须包含大盘、板块、走势、仓位、个股或复盘专业术语
        has_stock_entity = any(kw.lower() in text.lower() for kw in A_STOCK_REQUIRED_KEYWORDS)
        if has_stock_entity:
            res = _make_result(True, False, [], "A股实盘盘面/板块/个股专业研判放行", "a_stock_pass")
        else:
            res = _make_result(False, True, [], "A股博主未提及任何股市盘面/板块/个股实体(日常随笔)", "a_stock_non_financial")
        _CLASSIFIER_CACHE[cache_key] = res
        return res

    # ── 2. 宏观全球/商业财经博主：过滤八卦和生活闹剧，其余宏观研判放行 ──
    if handle in MACRO_FINANCE_AUTHORS:
        if any(kw in text for kw in MACRO_FINANCE_SPAM_KEYWORDS):
            res = _make_result(False, True, [], "宏观财经博主八卦内容", "macro_spam")
        else:
            res = _make_result(True, False, [], "宏观全球/商业财经放行", "macro_pass")
        _CLASSIFIER_CACHE[cache_key] = res
        return res

    # ── 3. 科技数码/供应链博主：必须具备科技产业/投研实体关键词，杜绝生活闲聊与魔术娱乐 ──
    if handle in TECH_HARDWARE_AUTHORS:
        # 命中生活闲聊必杀词
        if any(kw in text for kw in TECH_CASUAL_NOISE_KEYWORDS):
            res = _make_result(False, True, [], "科技博主数码生活闲聊/魔术娱乐", "tech_casual_noise")
            _CLASSIFIER_CACHE[cache_key] = res
            return res

        # 检查是否包含科技产业/芯片/果链/算力/投研实体
        has_tech_industry = any(kw.lower() in text.lower() for kw in TECH_INDUSTRY_REQUIRED_KEYWORDS)
        if has_tech_industry:
            res = _make_result(True, False, [], "科技产业与供应链情报放行", "tech_industry_pass")
        else:
            res = _make_result(False, True, [], "科技博主未提及任何产业/投资实体(日常闲聊)", "tech_non_investment")
        _CLASSIFIER_CACHE[cache_key] = res
        return res

    # ── 4. 非股票博主（李老师/韩跑跑/币圈等）：严格过滤，仅偶发专业复盘放行 ──
    if handle in NON_STOCK_AUTHORS:
        has_pro_header = any(h in text for h in [
            "盘前梳理", "盘前热点", "午评", "收评", "大盘复盘",
            "龙虎榜", "新股申购", "新股新债申购", "板块"
        ])
        if has_pro_header:
            res = _make_result(True, False, [], "非股票博主偶发专业研判", "non_stock_stock_pass")
        else:
            res = _make_result(False, True, [], "非股票博主的非金融内容", "non_stock_filter")
        _CLASSIFIER_CACHE[cache_key] = res
        return res

    # ── 5. 未知博主（推送/时间线出现的陌生人）：必须有股票投资关键词且无纯私人闲聊 ──
    stock_keywords = [
        "股票", "A股", "板块", "涨停", "跌停", "大盘", "盘前", "盘后", "复盘",
        "买点", "卖点", "仓位", "加仓", "减仓", "ETF", "指数", "美股", "港股",
        "半导体", "芯片", "算力", "光模块", "机器人", "新能源", "智驾",
        "美联储", "降息", "央行", "财报", "业绩", "营收"
    ]
    has_stock_kw = any(kw in text for kw in stock_keywords)
    non_stock_personal = ["日常", "生活", "感悟", "打卡", "今天天气", "吃饭", "猪脚饭", "住户", "彩礼"]
    has_non_stock = any(kw in text for kw in non_stock_personal)

    if has_stock_kw and not has_non_stock:
        res = _make_result(True, False, [], "未知博主含股票投资关键词", "unknown_stock_pass")
    else:
        res = _make_result(False, True, [], "未知博主无股票相关内容", "unknown_filter")
    _CLASSIFIER_CACHE[cache_key] = res
    return res


def _make_result(is_relevant: bool, is_spam: bool, symbols: List[str],
                 reason: str, model_used: str) -> Dict[str, Any]:
    return {
        "is_stock_relevant": is_relevant,
        "is_spam": is_spam,
        "stock_symbols": symbols,
        "reason": reason,
        "model_used": model_used
    }


def _call_local_ollama_classifier(text: str) -> Dict[str, Any]:
    """调用本地 Ollama 模型进行语义裁决（备用，当前主逻辑不调用）"""
    prompt = f"""你是证券投资情报审查官。判断以下推文是否与【A股/美股/宏观金融/科技产业投资】相关。
推文："{text}"
返回JSON：{{"is_stock_relevant": true或false, "reason": "简短理由"}}"""

    for model_name in ["qwen2.5:1.5b"]:
        try:
            resp = requests.post(OLLAMA_API_URL, json={
                "model": model_name,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 80}
            }, timeout=3.0)
            if resp.status_code == 200:
                raw = resp.json().get("response", "").strip()
                m = re.search(r'\{.*\}', raw, re.DOTALL)
                if m:
                    parsed = json.loads(m.group(0))
                    is_rel = bool(parsed.get("is_stock_relevant", False))
                    return _make_result(is_rel, not is_rel, [],
                                        parsed.get("reason", "AI判定"),
                                        f"ollama_{model_name}")
        except Exception as ex:
            logger.debug(f"Ollama {model_name} 失败: {ex}")

    # 兜底关键词
    has_kw = any(k in text for k in ["板块", "大盘", "涨停", "跌停", "ETF", "机器人", "算力", "半导体"])
    return _make_result(has_kw, not has_kw, [], "AI离线关键词兜底", "fallback_rule")
