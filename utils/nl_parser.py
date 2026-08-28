"""自然语言策略解析器

将普通股民的大白话转换为策略条件JSON。
免费正则引擎 + 可选LLM备选。
"""
import re
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ==================== 中文数字转换 ====================

_CN_DIGITS = {
    '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '百': 100,
}


def _cn_to_num(text: str) -> Optional[float]:
    """中文数字/阿拉伯数字混合 → 浮点数

    支持: "二十"→20, "二十五"→25, "20"→20, "3.5"→3.5
    """
    text = text.strip()
    if not text:
        return None

    # 纯阿拉伯数字
    try:
        return float(text)
    except ValueError:
        pass

    # 中文数字转换
    result = 0
    current = 0
    for ch in text:
        if ch in _CN_DIGITS:
            val = _CN_DIGITS[ch]
            if val >= 10:  # 十、百 是乘数
                if current == 0:
                    current = 1  # "十" 前面没数字 = 1
                result += current * val
                current = 0
            else:
                current = val
        else:
            continue
    result += current
    return float(result) if result > 0 else None


def _extract_number(text: str) -> Optional[float]:
    """从文本中提取数字（支持中文和阿拉伯数字混合）"""
    # 先尝试匹配阿拉伯数字（含小数）
    m = re.search(r'(\d+(?:\.\d+)?)', text)
    if m:
        return float(m.group(1))

    # 尝试中文数字
    m = re.search(r'([零一二两三四五六七八九十百]+)', text)
    if m:
        return _cn_to_num(m.group(1))

    return None


# ==================== 预处理 ====================

def _preprocess(text: str) -> str:
    """标准化中文输入"""
    text = text.strip()
    # 全角→半角
    text = text.replace('，', ',').replace('。', '.').replace('；', ';')
    text = text.replace('！', '!').replace('？', '?')
    text = text.replace('％', '%').replace('（', '(').replace('）', ')')
    # "百分之N" → "N%"（支持阿拉伯数字和中文数字）
    text = re.sub(r'百分之\s*(\d+(?:\.\d+)?)', lambda m: m.group(1) + '%', text)
    text = re.sub(r'百分之\s*([零一二两三四五六七八九十百]+)',
                  lambda m: str(int(_cn_to_num(m.group(1)) or 10)) + '%', text)
    # 统一空格
    text = re.sub(r'\s+', ' ', text)
    return text


# ==================== 条件构建器 ====================

def _ind(name: str, params: dict = None) -> dict:
    """构建 indicator 类型的操作数"""
    return {"type": "indicator", "indicator": name, "params": params or {}}


def _fixed(value: float) -> dict:
    """构建 fixed 类型的操作数"""
    return {"type": "fixed", "value": value}


def _cond(left: dict, op: str, right: dict) -> dict:
    """构建完整条件"""
    return {"left": left, "op": op, "right": right}


# ==================== 单句正则匹配 ====================

# 模式表：(正则, 处理函数)  按优先级排列
# 处理函数接收 match 对象，返回 condition dict

def _try_patterns(text: str) -> list:
    """对单个子句尝试所有正则模式，返回匹配到的条件列表"""

    # ========== 涨跌幅类（含"跌破"） ==========
    # "跌了20%" / "跌破20%" / "跌幅超过20%" / "亏了10%"
    m = re.search(r'(?:下跌|跌幅|跌[了过破]?|亏[了过]?|亏损)[了过]?\s*[超过]?(\d+(?:\.\d+)?)\s*[%％]', text)
    if m:
        return [_cond(_ind("return", {"period": 1}), "<", _fixed(-float(m.group(1))))]

    # "涨了5%" / "涨幅超过5%" / "盈利10%"
    m = re.search(r'(?:上涨|涨幅|涨[了过]?|盈利)[了过]?\s*[超过]?(\d+(?:\.\d+)?)\s*[%％]', text)
    if m:
        return [_cond(_ind("return", {"period": 1}), ">", _fixed(float(m.group(1))))]

    # "跌X个点"
    m = re.search(r'(?:跌|亏)[了过]?(\d+(?:\.\d+)?)\s*个点', text)
    if m:
        return [_cond(_ind("return", {"period": 1}), "<", _fixed(-float(m.group(1))))]

    # "涨X个点"
    m = re.search(r'(?:涨|赚)[了过]?(\d+(?:\.\d+)?)\s*个点', text)
    if m:
        return [_cond(_ind("return", {"period": 1}), ">", _fixed(float(m.group(1))))]

    # "比昨天/前天 涨/跌 X%"
    m = re.search(r'比\s*前?(\d*)[天日]\s*(涨|跌)[了过]?\s*(\d+(?:\.\d+)?)\s*[%％点]?', text)
    if m:
        period_str, direction, val = m.group(1), m.group(2), float(m.group(3))
        period = int(period_str) if period_str else 1
        if "前天" in text or "前日" in text:
            period = 2
        op = ">" if direction == "涨" else "<"
        bound = val if direction == "涨" else -val
        return [_cond(_ind("return", {"period": period}), op, _fixed(bound))]

    # "连跌N天" / "连涨N天"
    m = re.search(r'连续?\s*(下跌|跌|上涨|涨)\s*(\d+)\s*[天日]', text)
    if m:
        n = int(m.group(2))
        if "跌" in m.group(1):
            return [_cond(_ind("return", {"period": n}), "<", _fixed(0))]
        else:
            return [_cond(_ind("return", {"period": n}), ">", _fixed(0))]

    # ========== 均线类 ==========
    # "N日线上穿M日线" / "N日均线金叉M日线"
    m = re.search(r'(\d+)\s*日(?:均线|线)\s*(?:上穿|金叉)\s*(\d+)\s*日(?:均线|线)?', text)
    if m:
        return [_cond(_ind("ma", {"period": int(m.group(1))}), "cross_above", _ind("ma", {"period": int(m.group(2))}))]

    # "N日线下穿M日线"
    m = re.search(r'(\d+)\s*日(?:均线|线)\s*(?:下穿|死叉)\s*(\d+)\s*日(?:均线|线)?', text)
    if m:
        return [_cond(_ind("ma", {"period": int(m.group(1))}), "cross_below", _ind("ma", {"period": int(m.group(2))}))]

    # "站上/突破N日线"
    m = re.search(r'(?:站上|突破|上穿)\s*(\d+)\s*日(?:均线|线)', text)
    if m:
        return [_cond(_ind("close"), "cross_above", _ind("ma", {"period": int(m.group(1))}))]

    # "跌破/下穿N日线"
    m = re.search(r'(?:跌破|下穿)\s*(\d+)\s*日(?:均线|线)', text)
    if m:
        return [_cond(_ind("close"), "cross_below", _ind("ma", {"period": int(m.group(1))}))]

    # "在N日线之上/之下"
    m = re.search(r'(?:在|高于)\s*(\d+)\s*日(?:均线|线)\s*(?:之上|以上|上方)', text)
    if m:
        return [_cond(_ind("close"), ">", _ind("ma", {"period": int(m.group(1))}))]

    m = re.search(r'(?:在|低于)\s*(\d+)\s*日(?:均线|线)\s*(?:之下|以下|下方)', text)
    if m:
        return [_cond(_ind("close"), "<", _ind("ma", {"period": int(m.group(1))}))]

    # 中文数字均线
    _cn = r'([零一二两三四五六七八九十百]+)'
    m = re.search(rf'{_cn}\s*日(?:均线|线)\s*(?:上穿|金叉)\s*{_cn}\s*日(?:均线|线)?', text)
    if m:
        return [_cond(_ind("ma", {"period": int(_cn_to_num(m.group(1)) or 20)}), "cross_above",
                       _ind("ma", {"period": int(_cn_to_num(m.group(2)) or 20)}))]

    m = re.search(rf'{_cn}\s*日(?:均线|线)\s*(?:下穿|死叉)\s*{_cn}\s*日(?:均线|线)?', text)
    if m:
        return [_cond(_ind("ma", {"period": int(_cn_to_num(m.group(1)) or 20)}), "cross_below",
                       _ind("ma", {"period": int(_cn_to_num(m.group(2)) or 20)}))]

    m = re.search(rf'(?:站上|突破|上穿)\s*{_cn}\s*日(?:均线|线)', text)
    if m:
        return [_cond(_ind("close"), "cross_above", _ind("ma", {"period": int(_cn_to_num(m.group(1)) or 20)}))]

    m = re.search(rf'(?:跌破|下穿)\s*{_cn}\s*日(?:均线|线)', text)
    if m:
        return [_cond(_ind("close"), "cross_below", _ind("ma", {"period": int(_cn_to_num(m.group(1)) or 20)}))]

    # ========== 量能类 ==========
    if re.search(r'放量|成交量翻[一两]倍|成交量放大', text):
        m = re.search(r'量比[大于超过]+\s*(\d+(?:\.\d+)?)', text)
        return [_cond(_ind("vol_ratio", {"period": 20}), ">", _fixed(float(m.group(1)) if m else 2.0))]

    if re.search(r'缩量|成交量缩[一小]|成交量减半', text):
        m = re.search(r'量比[小于低于不足]+\s*(\d+(?:\.\d+)?)', text)
        return [_cond(_ind("vol_ratio", {"period": 20}), "<", _fixed(float(m.group(1)) if m else 0.5))]

    m = re.search(r'量比\s*[大于超过]+\s*(\d+(?:\.\d+)?)', text)
    if m:
        return [_cond(_ind("vol_ratio", {"period": 20}), ">", _fixed(float(m.group(1))))]

    # ========== RSI 类 ==========
    if re.search(r'RSI\s*超买', text, re.IGNORECASE):
        return [_cond(_ind("rsi", {"period": 14}), ">", _fixed(70))]
    if re.search(r'RSI\s*超卖', text, re.IGNORECASE):
        return [_cond(_ind("rsi", {"period": 14}), "<", _fixed(30))]

    m = re.search(r'RSI\s*[大于超过]+\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
    if m:
        return [_cond(_ind("rsi", {"period": 14}), ">", _fixed(float(m.group(1))))]
    m = re.search(r'RSI\s*[低于小于不足]+\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
    if m:
        return [_cond(_ind("rsi", {"period": 14}), "<", _fixed(float(m.group(1))))]

    # ========== MACD 类 ==========
    if re.search(r'MACD\s*金叉|DIF\s*上穿\s*DEA', text, re.IGNORECASE):
        return [_cond(_ind("macd", {"field": "dif"}), "cross_above", _ind("macd", {"field": "dea"}))]
    if re.search(r'MACD\s*死叉|DIF\s*下穿\s*DEA', text, re.IGNORECASE):
        return [_cond(_ind("macd", {"field": "dif"}), "cross_below", _ind("macd", {"field": "dea"}))]

    # ========== KDJ 类 ==========
    if re.search(r'KDJ\s*超买', text, re.IGNORECASE):
        return [_cond(_ind("kdj", {"field": "k"}), ">", _fixed(80))]
    if re.search(r'KDJ\s*超卖', text, re.IGNORECASE):
        return [_cond(_ind("kdj", {"field": "k"}), "<", _fixed(20))]

    m = re.search(r'K\s*值?\s*[大于超过]+\s*(\d+)', text, re.IGNORECASE)
    if m:
        return [_cond(_ind("kdj", {"field": "k"}), ">", _fixed(float(m.group(1))))]
    m = re.search(r'K\s*值?\s*[低于小于不足]+\s*(\d+)', text, re.IGNORECASE)
    if m:
        return [_cond(_ind("kdj", {"field": "k"}), "<", _fixed(float(m.group(1))))]

    # ========== 突破类 ==========
    m = re.search(r'创新高|突破\s*(\d+)\s*日?高点', text)
    if m:
        return [_cond(_ind("close"), ">", _ind("highest", {"period": int(m.group(1)) if m.group(1) else 20}))]

    m = re.search(r'创新低|跌破?\s*(\d+)\s*日?低点', text)
    if m:
        return [_cond(_ind("close"), "<", _ind("lowest", {"period": int(m.group(1)) if m.group(1) else 20}))]

    # ========== 布林带类 ==========
    if re.search(r'突破\s*布林(?:带)?上轨', text):
        return [_cond(_ind("close"), ">", _ind("boll", {"period": 20, "std": 2, "field": "upper"}))]
    if re.search(r'跌破\s*布林(?:带)?下轨', text):
        return [_cond(_ind("close"), "<", _ind("boll", {"period": 20, "std": 2, "field": "lower"}))]
    if re.search(r'(?:突破|站上|高于|超过)\s*(?:布林(?:带)?|中)轨', text):
        if re.search(r'上轨', text):
            return [_cond(_ind("close"), ">", _ind("boll", {"period": 20, "std": 2, "field": "upper"}))]
        if re.search(r'中轨', text):
            return [_cond(_ind("close"), ">", _ind("boll", {"period": 20, "std": 2, "field": "middle"}))]
    if re.search(r'(?:跌破|低于|下穿)\s*(?:布林(?:带)?|中)轨', text):
        if re.search(r'下轨', text):
            return [_cond(_ind("close"), "<", _ind("boll", {"period": 20, "std": 2, "field": "lower"}))]
        if re.search(r'中轨', text):
            return [_cond(_ind("close"), "<", _ind("boll", {"period": 20, "std": 2, "field": "middle"}))]

    # ========== 绝对价格类（放最后，避免和百分比/均线冲突） ==========
    # "涨到X块"
    m = re.search(r'(?:涨到|价格到|超过|达到)\s*(\d+(?:\.\d+)?)\s*(?:块|元)?', text)
    if m and '%' not in text and '日' not in text:
        return [_cond(_ind("close"), ">", _fixed(float(m.group(1))))]

    # "跌破X块"（排除有%的，已在上面处理）
    m = re.search(r'(?:跌破|低于|不到|跌到)\s*(\d+(?:\.\d+)?)\s*(?:块|元)', text)
    if m:
        return [_cond(_ind("close"), "<", _fixed(float(m.group(1))))]

    m = re.search(r'(?:价格?在|高于)\s*(\d+(?:\.\d+)?)\s*(?:块|元|以上)', text)
    if m:
        return [_cond(_ind("close"), ">=", _fixed(float(m.group(1))))]

    m = re.search(r'(?:价格?在|低于)\s*(\d+(?:\.\d+)?)\s*(?:块|元|以下)', text)
    if m:
        return [_cond(_ind("close"), "<=", _fixed(float(m.group(1))))]

    # ========== 简写模式（供上下文继承使用） ==========
    # 纯"死叉"/"金叉" —— 不含具体指标，由外层上下文继承补全
    if re.search(r'^死叉$', text):
        return [{"_loose": "cross_below"}]
    if re.search(r'^金叉$', text):
        return [{"_loose": "cross_above"}]

    # "KDJ死叉"/"MACD死叉"/"KDJ金叉"/"MACD金叉"
    if re.search(r'KDJ\s*死叉', text, re.IGNORECASE):
        return [_cond(_ind("kdj", {"field": "k"}), "cross_below", _ind("kdj", {"field": "d"}))]
    if re.search(r'KDJ\s*金叉', text, re.IGNORECASE):
        return [_cond(_ind("kdj", {"field": "k"}), "cross_above", _ind("kdj", {"field": "d"}))]

    # "超买"/"超卖" 简写（不含 RSI/KDJ 前缀）
    if re.search(r'超买', text) and not re.search(r'RSI|KDJ', text, re.IGNORECASE):
        return [_cond(_ind("rsi", {"period": 14}), ">", _fixed(70))]
    if re.search(r'超卖', text) and not re.search(r'RSI|KDJ', text, re.IGNORECASE):
        return [_cond(_ind("rsi", {"period": 14}), "<", _fixed(30))]

    # "高于N" / "低于N" 简写 —— 数值型阈值（供 RSI/KDJ 上下文继承）
    m = re.match(r'^高于\s*(\d+(?:\.\d+)?)$', text)
    if m:
        return [{"_loose": "above", "value": float(m.group(1))}]
    m = re.match(r'^低于\s*(\d+(?:\.\d+)?)$', text)
    if m:
        return [{"_loose": "below", "value": float(m.group(1))}]

    # ========== 散户口语化模式 ==========

    # "涨到头了" / "涨到顶了" / "见顶了"
    if re.search(r'涨到头|涨到顶|见顶|到头了|到顶了', text):
        return [{"_loose": "above", "value": 80}]  # 继承RSI/KDJ超买

    # "跌到底了" / "见底了" / "到底了"
    if re.search(r'跌到底|见底|到底了', text):
        return [{"_loose": "below", "value": 20}]  # 继承RSI/KDJ超卖

    # "涨疯了" / "暴涨" / "大涨" — 趋势过热信号
    if re.search(r'涨疯|暴涨|大涨|疯涨', text):
        return [{"_loose": "above", "value": 80}]

    # "跌麻了" / "暴跌" / "大跌" / "崩了" — 趋势过冷信号
    if re.search(r'跌麻|暴跌|大跌|崩了|狂跌', text):
        return [{"_loose": "below", "value": 20}]

    # "涨了" / "涨了点" — 裸涨（无百分比），默认1%
    m = re.search(r'^涨[了过]?点?$', text)
    if m:
        return [_cond(_ind("return", {"period": 1}), ">", _fixed(1.0))]

    # "跌了" / "跌了点" — 裸跌（无百分比），默认-1%
    m = re.search(r'^跌[了过]?点?$', text)
    if m:
        return [_cond(_ind("return", {"period": 1}), "<", _fixed(-1.0))]

    # "回本了" / "回本" — 盈利刚好回到0%
    if re.search(r'回本', text):
        return [_cond(_ind("return", {"period": 1}), ">=", _fixed(0))]

    # "少亏点" / "少亏一些" — 盈亏平衡但亏损较小
    if re.search(r'少亏', text):
        return [_cond(_ind("return", {"period": 1}), "<", _fixed(-3))]

    # "赚够N" / "赚够了" — 盈利达标
    m = re.search(r'赚够\s*(\d+(?:\.\d+)?)\s*[%％]?', text)
    if m:
        return [_cond(_ind("return", {"period": 1}), ">", _fixed(float(m.group(1))))]
    # "赚够了" / "赚够" — 没说具体数字，默认10%
    if re.search(r'赚够', text):
        return [_cond(_ind("return", {"period": 1}), ">", _fixed(10))]

    # "亏大了" / "亏麻了" — 大额亏损
    if re.search(r'亏大了|亏麻了|亏惨了', text):
        return [_cond(_ind("return", {"period": 1}), "<", _fixed(-20))]

    # "割肉" — 止损（默认-5%）
    if re.search(r'割肉', text):
        return [_cond(_ind("return", {"period": 1}), "<", _fixed(-5))]

    # "反弹了" / "反弹"
    if re.search(r'反弹', text):
        return [_cond(_ind("return", {"period": 3}), ">", _fixed(3))]

    # "冲高回落" / "冲高了"
    if re.search(r'冲高回落|冲高', text):
        return [_cond(_ind("return", {"period": 1}), ">", _fixed(5))]

    # "站上XXXX" / "跌破XXXX"（不带"块/元"，纯数字 = 整数关口）
    m = re.search(r'(?:站上|突破|涨到|涨过)\s*(\d{3,})\b', text)
    if m and '%' not in text and '日' not in text:
        return [_cond(_ind("close"), ">", _fixed(float(m.group(1))))]

    m = re.search(r'(?:跌破|低于|跌到)\s*(\d{3,})\b', text)
    if m and '%' not in text and '日' not in text:
        return [_cond(_ind("close"), "<", _fixed(float(m.group(1))))]

    return []


def _split_compound(text: str) -> list[str]:
    """拆分复合子句，如 '放量突破10日高点' → ['放量', '突破10日高点']

    在关键词边界处切分，让每个子句只含一个条件。
    """
    # 在量能关键词和其他关键词之间切分
    _boundaries = [
        r'(?<=量)(?=突破|站上|跌破|上穿|下穿|创新)',
        r'(?<=量)(?=RSI|MACD|KDJ)',
        r'(?<=轨)(?=站上|跌破|突破)',
        r'(?<=点)(?=站上|跌破|突破)',
        r'(?<=天)(?=站上|跌破|突破)',
    ]
    parts = [text]
    for pattern in _boundaries:
        new_parts = []
        for part in parts:
            new_parts.extend(re.split(pattern, part))
        parts = new_parts
    return [p.strip() for p in parts if p.strip()]


def _parse_clause(text: str) -> list:
    """解析单个条件子句，返回条件列表

    支持复合子句（如"放量突破10日高点"会拆分为两个条件）
    """
    text = text.strip()
    if not text:
        return []

    # 移除开头的连接词和假设词
    text = re.sub(r'^(如果|若|假如|当|只要)', '', text).strip()
    text = re.sub(r'(就|则|那么|那就|的话)$', '', text).strip()

    # 先尝试拆分复合子句
    parts = _split_compound(text)
    all_results = []

    for part in parts:
        conds = _try_patterns(part)
        if conds:
            all_results.extend(conds)

    # 如果拆分后都没匹配到，用整体再试一次
    if not all_results:
        all_results = _try_patterns(text)

    return all_results


# ==================== 句子拆分与分类 ====================

_BUY_KEYWORDS = re.compile(r'买[入仓]?|建仓|抄底|加仓|补仓')
_SELL_KEYWORDS = re.compile(r'卖[出仓]?|清[仓仓]|止[损盈]|减仓|出货|落袋')

# "超卖买入" / "超买卖出" 等复合词中的方向修正
_DIRECTION_OVERRIDE = re.compile(r'超卖.*买|超买.*卖')


def _classify_clause(text: str) -> str:
    """判断子句属于买入还是卖出"""
    # 先处理"超卖买入"/"超买卖出"等复合方向词
    if _DIRECTION_OVERRIDE.search(text):
        if "超卖" in text and "买" in text:
            return "buy"
        if "超买" in text and "卖" in text:
            return "sell"
    if _SELL_KEYWORDS.search(text):
        return "sell"
    if _BUY_KEYWORDS.search(text):
        return "buy"
    return "unknown"


def _split_and_classify(text: str) -> tuple[list[str], list[str]]:
    """将完整输入拆分为买入子句和卖出子句

    返回: (buy_clauses, sell_clauses)
    """
    # 先按逗号、分号、句号、换行拆分
    segments = re.split(r'[,;。\n]|(?:并且|而且|同时|且(?=\s))', text)
    segments = [s.strip() for s in segments if s.strip()]

    buy_clauses = []
    sell_clauses = []

    for seg in segments:
        cls = _classify_clause(seg)
        clean_seg = re.sub(r'(如果|若|当|只要)', '', seg)
        # 一次性移除所有尾部动词（长词优先，避免"卖出"→"卖"导致误删）
        clean_seg = re.sub(
            r'(卖出|清仓|止损|止盈|减仓|出货|落袋|买进|建仓|抄底|买入|卖掉|割肉|回本|跑路|跑|卖|买|就|则|那么|那就|的话)$',
            '', clean_seg)
        clean_seg = clean_seg.strip()

        if cls == "buy":
            buy_clauses.append(clean_seg)
        elif cls == "sell":
            sell_clauses.append(clean_seg)
        else:
            # 没有明确买卖关键词，尝试从上下文推断
            if re.search(r'止损|亏|跌|下[跌穿]|低于|超卖|死叉|缩量|割肉|少亏|跌麻|暴跌|大跌|崩了|到底|见底', seg):
                sell_clauses.append(clean_seg)
            elif re.search(r'涨|突破|站上|高于|金叉|超买|放量|上穿|反弹|涨疯|暴涨|大涨|冲高|到头|见顶', seg):
                buy_clauses.append(clean_seg)
            # 使用预分类结果兜底（当清理后的文本无法推断时）
            elif cls == "sell":
                sell_clauses.append(clean_seg)
            elif cls == "buy":
                buy_clauses.append(clean_seg)
            else:
                buy_clauses.append(clean_seg)

    return buy_clauses, sell_clauses


# ==================== 生成中文说明 ====================

def _explain_condition(cond: dict) -> str:
    """将条件dict翻译成中文说明"""
    left = cond["left"]
    right = cond["right"]
    op = cond["op"]

    # 左侧描述
    if left["type"] == "fixed":
        left_desc = str(left["value"])
    else:
        ind = left["indicator"]
        p = left.get("params", {})
        names = {
            "close": "收盘价", "open": "开盘价", "high": "最高价", "low": "最低价",
            "volume": "成交量", "ma": f"{p.get('period', 20)}日均线",
            "ema": f"EMA{p.get('period', 20)}", "rsi": "RSI",
            "macd": f"MACD {p.get('field', 'dif').upper()}",
            "kdj": f"KDJ {p.get('field', 'k').upper()}",
            "boll": f"布林{p.get('field', 'upper')}",
            "highest": f"{p.get('period', 20)}日最高价",
            "lowest": f"{p.get('period', 20)}日最低价",
            "vol_ratio": "量比", "return": f"{p.get('period', 1)}日收益率",
            "cci": "CCI", "atr": "ATR", "obv": "OBV",
            "donchian": f"唐奇安{p.get('field', 'upper')}",
        }
        left_desc = names.get(ind, ind)

    # 算子描述
    op_names = {
        ">": "大于", "<": "小于", ">=": "大于等于", "<=": "小于等于",
        "==": "等于", "cross_above": "上穿", "cross_below": "下穿",
    }
    op_desc = op_names.get(op, op)

    # 右侧描述
    if right["type"] == "fixed":
        right_desc = str(right["value"])
    else:
        ind = right["indicator"]
        p = right.get("params", {})
        names = {
            "close": "收盘价", "ma": f"{p.get('period', 20)}日均线",
            "ema": f"EMA{p.get('period', 20)}", "rsi": "RSI",
            "macd": f"MACD {p.get('field', 'dif').upper()}",
            "kdj": f"KDJ {p.get('field', 'k').upper()}",
            "boll": f"布林{p.get('field', 'upper')}",
            "highest": f"{p.get('period', 20)}日最高价",
            "lowest": f"{p.get('period', 20)}日最低价",
            "vol_ratio": "量比", "return": f"{p.get('period', 1)}日收益率",
        }
        right_desc = names.get(ind, ind)

    return f"{left_desc} {op_desc} {right_desc}"


# ==================== LLM 备选解析 ====================

_LLM_PROMPT = """你是一个量化策略翻译器。将用户的自然语言策略描述转换为JSON格式的买卖条件。

## 可用指标
close, open, high, low, volume (价格/成交量)
ma(period), ema(period), wma(period) (均线)
rsi(period), macd(field=dif/dea/macd), kdj(field=k/d/j) (技术指标)
boll(field=upper/middle/lower, period, std), atr(period), cci(period) (通道/波动)
highest(period), lowest(period), donchian(field, period) (高低点)
vol_ma(period), vol_ratio(period), obv (量能)
return(period) (N日收益率%)

## 可用算子
> < >= <= == cross_above cross_below

## 输出格式（严格JSON，不要任何解释文字）
{
  "buy_conditions": [
    {"left": {"type":"indicator","indicator":"xxx","params":{}}, "op":"xxx", "right":{"type":"fixed","value":xxx}}
  ],
  "sell_conditions": [...]
}

## 用户输入"""


def _llm_parse(text: str) -> Optional[dict]:
    """调用LLM解析自然语言（仅在配置了API key时可用）"""
    try:
        from config.settings import LLM_API_KEY, LLM_API_URL, LLM_MODEL
    except ImportError:
        return None

    if not LLM_API_KEY:
        return None

    try:
        import urllib.request
        import urllib.error

        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": f"{_LLM_PROMPT}\n{text}"}],
            "temperature": 0.1,
            "max_tokens": 1000,
        }).encode("utf-8")

        req = urllib.request.Request(
            LLM_API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            # 提取JSON部分
            m = re.search(r'\{[\s\S]*\}', content)
            if m:
                result = json.loads(m.group(0))
                if _validate_result(result):
                    return result
    except Exception as e:
        logger.warning(f"LLM解析失败: {e}")

    return None


def _validate_result(result: dict) -> bool:
    """验证解析结果是否合法"""
    valid_indicators = {
        "close", "open", "high", "low", "volume",
        "ma", "ema", "wma", "rsi", "macd", "boll", "kdj", "atr", "cci",
        "highest", "lowest", "donchian", "vol_ma", "vol_ratio", "obv", "return",
    }
    valid_ops = {">", "<", ">=", "<=", "==", "cross_above", "cross_below"}

    for key in ("buy_conditions", "sell_conditions"):
        for cond in result.get(key, []):
            if not isinstance(cond, dict):
                return False
            for side in ("left", "right"):
                ref = cond.get(side, {})
                if ref.get("type") == "indicator":
                    if ref.get("indicator") not in valid_indicators:
                        return False
            if cond.get("op") not in valid_ops:
                return False
    return True


# ==================== 顶层入口 ====================

def _inherit_context(buy_conds: list, sell_conds: list) -> list:
    """上下文继承：将简写条件（如"死叉"、"涨到头了"）从另一侧继承指标参数。

    例如买入条件是 5日均线 cross_above 20日均线，
    卖出条件 "死叉" → 5日均线 cross_below 20日均线。

    当买卖双方都是简写时，默认使用RSI。
    """
    # 从所有明确条件中提取可用于继承的上下文
    ctx_cross = None  # (left, right) - 均线交叉对
    ctx_indicator = None  # 指标名（rsi/kdj）

    all_conds = [c for c in buy_conds + sell_conds if isinstance(c, dict) and "_loose" not in c]
    for c in all_conds:
        op = c.get("op", "")
        left = c.get("left", {})
        if op in ("cross_above", "cross_below"):
            ctx_cross = (c.get("left"), c.get("right"))
        if left.get("type") == "indicator":
            ind = left.get("indicator", "")
            if ind in ("rsi", "kdj"):
                ctx_indicator = ind

    # 如果全是简写，没有明确指标，默认用RSI
    all_items = buy_conds + sell_conds
    if not ctx_indicator:
        all_loose = all(isinstance(c, dict) and "_loose" in c for c in all_items if isinstance(c, dict))
        if all_loose and all_items:
            ctx_indicator = "rsi"

    def _resolve(conds):
        resolved = []
        for c in conds:
            if not isinstance(c, dict) or "_loose" not in c:
                resolved.append(c)
                continue
            loose = c["_loose"]
            val = c.get("value", 50)
            if loose in ("cross_above", "cross_below") and ctx_cross:
                left, right = ctx_cross
                resolved.append(_cond(left, loose, right))
            elif loose == "above":
                if ctx_indicator == "kdj":
                    resolved.append(_cond(_ind("kdj", {"field": "k"}), ">", _fixed(val)))
                else:
                    resolved.append(_cond(_ind("rsi", {"period": 14}), ">", _fixed(val)))
            elif loose == "below":
                if ctx_indicator == "kdj":
                    resolved.append(_cond(_ind("kdj", {"field": "k"}), "<", _fixed(val)))
                else:
                    resolved.append(_cond(_ind("rsi", {"period": 14}), "<", _fixed(val)))
            else:
                resolved.append(c)
        return resolved

    return _resolve(buy_conds), _resolve(sell_conds)


# ==================== 多股票识别 ====================

def _build_stock_pattern() -> tuple[re.Pattern, dict]:
    """从内置股票名称构建正则，支持全名+简称（如"茅台"→"贵州茅台"）。

    返回 (pattern, {匹配文本: code})
    """
    try:
        from utils.stock_search import _STOCK_NAMES
    except ImportError:
        _STOCK_NAMES = {}

    # {匹配文本: 股票代码} 包含全名和简称
    match_to_code: dict[str, str] = {}
    all_full_names: list[str] = []

    for code, name in _STOCK_NAMES.items():
        match_to_code[name] = code
        all_full_names.append(name)

    # 生成简称：去掉常见前缀（省份/中国），取剩余部分作为简称
    _PREFIXES = ['中国', '贵州', '上海', '深圳', '北京', '杭州', '苏州',
                 '南京', '广州', '重庆', '天津', '四川', '山东', '浙江',
                 '江苏', '广东', '湖南', '湖北', '河南', '河北', '安徽',
                 '福建', '云南', '陕西', '甘肃', '吉林', '辽宁', '黑龙江']

    for code, name in _STOCK_NAMES.items():
        short = name
        for prefix in _PREFIXES:
            if short.startswith(prefix) and len(short) > len(prefix):
                short = short[len(prefix):]
                break
        # 简称至少2字，且不能和已有的全名冲突
        if len(short) >= 2 and short not in match_to_code:
            # 检查是否与其他全名有歧义
            ambiguous = False
            for other_name in all_full_names:
                if other_name != name and short in other_name:
                    ambiguous = True
                    break
            if not ambiguous:
                match_to_code[short] = code

    if not match_to_code:
        return None, {}

    # 按长度降序排列，优先匹配长名称
    names = sorted(match_to_code.keys(), key=len, reverse=True)
    pattern = re.compile('|'.join(re.escape(n) for n in names))
    return pattern, match_to_code


_STOCK_PATTERN, _NAME_TO_CODE = _build_stock_pattern()


def _try_sina_search(name: str) -> str | None:
    """通过新浪搜索API查找股票代码（离线缓存）"""
    try:
        from utils.stock_search import search_stock_sina
        results = search_stock_sina(name, limit=3)
        for r in results:
            if r["name"] == name or name in r["name"]:
                return r["code"]
    except Exception:
        pass
    return None


def _extract_stock_segments(text: str) -> list[tuple[str, str]]:
    """从文本中提取 (股票名, 对应规则) 片段列表。

    输入: "茅台亏百分之十就卖 杭州柯林涨到150就卖"
    输出: [("贵州茅台", "亏百分之十就卖"), ("杭州柯林", "涨到150就卖")]

    没有识别到股票名时返回 [("unknown", text)]。
    """
    global _STOCK_PATTERN, _NAME_TO_CODE

    # 懒加载：首次调用时构建映射
    if _STOCK_PATTERN is None:
        _STOCK_PATTERN, _NAME_TO_CODE = _build_stock_pattern()

    if not _STOCK_PATTERN:
        return [("unknown", text)]

    matches = list(_STOCK_PATTERN.finditer(text))
    if not matches:
        return _fallback_stock_search(text)

    # 先用内置匹配提取已知股票
    raw_segments = []
    for i, m in enumerate(matches):
        stock_name = m.group()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        rule_text = text[start:end].strip()
        if rule_text:
            raw_segments.append((stock_name, rule_text))

    # 对每段 rule_text，检查是否还包含未识别的股票名
    final_segments = []
    for stock_name, rule_text in raw_segments:
        sub_matches = list(_STOCK_PATTERN.finditer(rule_text))
        if sub_matches:
            # rule_text 中还有其他已知股票，继续拆分
            pos = 0
            for sm in sub_matches:
                sub_rule = rule_text[pos:sm.start()].strip()
                if sub_rule:
                    final_segments.append((stock_name, sub_rule))
                stock_name = sm.group()
                pos = sm.end()
            remaining = rule_text[pos:].strip()
            if remaining:
                final_segments.append((stock_name, remaining))
        else:
            # 没有已知股票，尝试新浪搜索
            fb = _fallback_stock_search(rule_text)
            if fb and fb[0][0] != "unknown":
                # fallback 找到了新股票，第一段归当前股票，其余归新股票
                # 找到第一个新股票名在 rule_text 中的位置
                first_fb_name = fb[0][0]
                idx = rule_text.find(first_fb_name)
                if idx > 0:
                    my_rule = rule_text[:idx].strip()
                    if my_rule:
                        final_segments.append((stock_name, my_rule))
                final_segments.extend(fb)
            else:
                final_segments.append((stock_name, rule_text))

    return final_segments if final_segments else [("unknown", text)]


def _fallback_stock_search(text: str) -> list[tuple[str, str]]:
    """内置映射未命中时，尝试从文本中提取可能的股票名并用新浪API查找。"""
    parts = re.split(r'\s+|[,，]', text)
    parts = [p for p in parts if p]

    global _NAME_TO_CODE
    segments = []
    used_names = set()

    for part in parts:
        # 提取开头的中文字符（最长6个），从长到短尝试匹配
        m = re.match(r'^([\u4e00-\u9fff]{2,6})', part)
        if not m:
            continue
        full_candidate = m.group(1)

        code = None
        candidate = None
        EXCLUDE_STOCK_WORDS = {
            "突破", "跌破", "站上", "下穿", "金叉", "死叉", "买入", "卖出", "买进", "卖掉",
            "止损", "止盈", "减仓", "加仓", "放量", "缩量", "均线", "布林", "超买", "超卖",
            "涨幅", "跌幅", "如果", "那么", "连续", "连跌", "连涨", "创新", "日线", "月线", "周线"
        }

        # 从长到短尝试，找到第一个匹配的股票名
        for length in range(len(full_candidate), 1, -1):
            test_name = full_candidate[:length]
            if test_name in used_names or test_name in EXCLUDE_STOCK_WORDS:
                continue
            found = _try_sina_search(test_name)
            if found:
                code = found
                candidate = test_name
                break


        if code and candidate:
            _NAME_TO_CODE[candidate] = code
            rule_text = part[len(candidate):].strip()
            if rule_text:
                segments.append((candidate, rule_text))
                used_names.add(candidate)

    return segments if segments else [("unknown", text)]


def parse_nl_multi(text: str) -> list[dict]:
    """解析可能包含多只股票的自然语言策略。

    输入: "茅台亏百分之十就卖 杭州柯林涨到150就卖"
    输出: [
        {"stock_name": "贵州茅台", "stock_code": "600519", "buy_conditions": [], "sell_conditions": [...], ...},
        {"stock_name": "杭州柯林", "stock_code": "...", ...},
    ]

    没有识别到股票名时，返回单条 unknown 规则。
    """
    text = _preprocess(text)
    segments = _extract_stock_segments(text)

    results = []
    for stock_name, rule_text in segments:
        # 查找股票代码
        stock_code = "unknown"
        if stock_name != "unknown" and _NAME_TO_CODE:
            stock_code = _NAME_TO_CODE.get(stock_name, "unknown")

        # 如果是 unknown 股票且规则文本很短，可能是股票名本身（如"茅台"后面没有规则）
        if not rule_text:
            continue

        parsed = parse_nl_strategy(rule_text)
        parsed["stock_name"] = stock_name
        parsed["stock_code"] = stock_code
        results.append(parsed)

    # 如果没有识别出任何股票，返回一条 unknown
    if not results:
        parsed = parse_nl_strategy(text)
        parsed["stock_name"] = "unknown"
        parsed["stock_code"] = "unknown"
        results.append(parsed)

    return results


def parse_nl_strategy(text: str) -> dict:
    """解析自然语言策略描述

    返回:
    {
        "buy_conditions": [...],
        "sell_conditions": [...],
        "explanation": "中文说明",
        "unmatched": ["未识别的片段"],
        "source": "regex" | "llm",
    }
    """
    text = _preprocess(text)
    buy_clauses, sell_clauses = _split_and_classify(text)

    buy_conds = []
    sell_conds = []
    unmatched = []
    explanations = []

    # 解析买入子句
    for clause in buy_clauses:
        conds = _parse_clause(clause)
        if conds:
            buy_conds.extend(conds)
        else:
            unmatched.append(clause)

    # 解析卖出子句
    for clause in sell_clauses:
        conds = _parse_clause(clause)
        if conds:
            sell_conds.extend(conds)
        else:
            unmatched.append(clause)

    # 上下文继承：简写条件从另一侧继承指标参数
    buy_conds, sell_conds = _inherit_context(buy_conds, sell_conds)

    # 过滤掉无法解析的 _loose 条件，加入 unmatched
    final_buy = []
    for c in buy_conds:
        if isinstance(c, dict) and "_loose" in c:
            unmatched.append(c["_loose"])
        else:
            final_buy.append(c)
            explanations.append(f"买入: {_explain_condition(c)}")
    buy_conds = final_buy

    final_sell = []
    for c in sell_conds:
        if isinstance(c, dict) and "_loose" in c:
            unmatched.append(c["_loose"])
        else:
            final_sell.append(c)
            explanations.append(f"卖出: {_explain_condition(c)}")
    sell_conds = final_sell

    source = "regex"

    # 有未匹配片段时，尝试 LLM 补全
    if unmatched:
        llm_result = _llm_parse(text)
        if llm_result:
            llm_buy = llm_result.get("buy_conditions", [])
            llm_sell = llm_result.get("sell_conditions", [])
            # 合并 LLM 结果到正则结果
            if not buy_conds and llm_buy:
                buy_conds = llm_buy
                for c in buy_conds:
                    explanations.append(f"买入: {_explain_condition(c)}")
            if llm_sell:
                for c in llm_sell:
                    if c not in sell_conds:
                        sell_conds.append(c)
                        explanations.append(f"卖出: {_explain_condition(c)}")
            unmatched = []
            source = "llm"

    return {
        "buy_conditions": buy_conds,
        "sell_conditions": sell_conds,
        "explanation": "；".join(explanations) if explanations else "未能识别任何条件",
        "unmatched": unmatched,
        "source": source,
    }
