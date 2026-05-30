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
            r'(卖出|清仓|止损|止盈|减仓|出货|落袋|买进|建仓|抄底|买入|卖掉|卖|买|就|则|那么|那就|的话)$',
            '', clean_seg)
        clean_seg = clean_seg.strip()

        if cls == "buy":
            buy_clauses.append(clean_seg)
        elif cls == "sell":
            sell_clauses.append(clean_seg)
        else:
            # 没有明确买卖关键词，尝试从上下文推断
            if re.search(r'止损|亏|跌|下[跌穿]|低于|超卖|死叉|缩量', seg):
                sell_clauses.append(clean_seg)
            elif re.search(r'涨|突破|站上|高于|金叉|超买|放量|上穿', seg):
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
            for c in conds:
                explanations.append(f"买入: {_explain_condition(c)}")
        else:
            unmatched.append(clause)

    # 解析卖出子句
    for clause in sell_clauses:
        conds = _parse_clause(clause)
        if conds:
            sell_conds.extend(conds)
            for c in conds:
                explanations.append(f"卖出: {_explain_condition(c)}")
        else:
            unmatched.append(clause)

    source = "regex"

    # 正则解析失败且有LLM配置时，尝试LLM
    if not buy_conds and not sell_conds:
        llm_result = _llm_parse(text)
        if llm_result:
            buy_conds = llm_result.get("buy_conditions", [])
            sell_conds = llm_result.get("sell_conditions", [])
            unmatched = []
            source = "llm"
            for c in buy_conds:
                explanations.append(f"买入: {_explain_condition(c)}")
            for c in sell_conds:
                explanations.append(f"卖出: {_explain_condition(c)}")

    return {
        "buy_conditions": buy_conds,
        "sell_conditions": sell_conds,
        "explanation": "；".join(explanations) if explanations else "未能识别任何条件",
        "unmatched": unmatched,
        "source": source,
    }
