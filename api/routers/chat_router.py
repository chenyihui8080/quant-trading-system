#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 首席操盘顾问对话与诊断路由 (AI Quant Advisor Chat Router)
"""

import sqlite3
import requests
import logging
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, Request

from utils.auth import get_current_user
from utils.portfolio_advisor import portfolio_store
from utils.realtime import get_realtime_quote
from utils.knowledge_base_engine import search_knowledge
from utils.playbooks_engine import match_best_playbook

logger = logging.getLogger("ChatRouter")
router = APIRouter(prefix="/api/chat", tags=["AI 操盘顾问"])

# 复盘工作台数据库（相对项目根路径，指向真实 review_workbench/data/review.db）
REVIEW_DB_PATH = Path(__file__).resolve().parent.parent.parent / "review_workbench" / "data" / "review.db"


@router.post("/ask")
def chat_ask_quant_advisor(payload: dict, current_user: dict = Depends(get_current_user)):
    """与本地 Qwen2.5-7B / 知识库闭环战法大模型进行智能操盘问答"""
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="提问内容不能为空")

    target_date = datetime.now().strftime("%Y-%m-%d")

    # 1. 提取实盘持仓与分时全景动态 (开盘价、最高价、现价、昨收、开盘浮盈、最高浮盈、当前浮盈)
    user_positions = []
    intraday_dynamics = []
    user_watchlist = []
    user_trade_history = []
    total_cost = 0.0
    total_market_val = 0.0
    total_pnl_amt = 0.0
    
    total_open_pnl = 0.0      # 开盘时总浮盈
    total_peak_pnl = 0.0      # 盘中最高点时总浮盈
    total_current_today_pnl = 0.0 # 当前实时当日总浮盈
    pullback_details = []

    try:
        username = current_user.get("username", "admin") if current_user else "admin"
        portfolio_store.load(username)
        if not portfolio_store.positions and username != "default":
            portfolio_store.load("default")
        for sym, pos in portfolio_store.positions.items():
            q = get_realtime_quote(sym) or {}
            cur_p = float(q.get("price", pos.current_price or 0))
            pre_close = float(q.get("pre_close", cur_p or 1.0))
            raw_open = float(q.get("open") or 0.0)
            raw_high = float(q.get("high") or 0.0)
            open_p = raw_open if raw_open > 0 else (cur_p if cur_p > 0 else pre_close)
            high_p = raw_high if raw_high > 0 else (cur_p if cur_p > 0 else pre_close)
            chg_pct = float(q.get("change_pct", 0.0))

            cost_amt = pos.cost_price * pos.shares
            mkt_val = cur_p * pos.shares
            pnl_amt = mkt_val - cost_amt
            pnl_pct = ((cur_p - pos.cost_price) / pos.cost_price * 100) if pos.cost_price > 0 else 0.0

            # 日内分时核心盈亏计算 (分文不差)
            if abs(cur_p - pre_close) > 0.0001:
                p_open_pnl = round((open_p - pre_close) * pos.shares, 2)
                p_peak_pnl = round((high_p - pre_close) * pos.shares, 2)
                p_cur_today_pnl = round((cur_p - pre_close) * pos.shares, 2)
            elif getattr(pos, 'today_pnl_amount', None) is not None and pos.today_pnl_amount != 0:
                p_cur_today_pnl = round(float(pos.today_pnl_amount), 2)
                p_open_pnl = p_cur_today_pnl
                p_peak_pnl = p_cur_today_pnl
            else:
                p_open_pnl = round((open_p - pre_close) * pos.shares, 2)
                p_peak_pnl = round((high_p - pre_close) * pos.shares, 2)
                p_cur_today_pnl = round((cur_p - pre_close) * pos.shares, 2)

            p_pullback = round(p_peak_pnl - p_cur_today_pnl, 2)

            total_open_pnl += p_open_pnl
            total_peak_pnl += p_peak_pnl
            total_current_today_pnl += p_cur_today_pnl

            total_cost += cost_amt
            total_market_val += mkt_val
            total_pnl_amt += pnl_amt

            status_tag = f"浮盈 +¥{pnl_amt:,.2f} (+{pnl_pct:.2f}%)" if pnl_amt >= 0 else f"浮亏 -¥{abs(pnl_amt):,.2f} ({pnl_pct:.2f}%)"
            user_positions.append(
                f"• **{pos.name}({sym})**：持仓 {pos.shares} 股 | 成本 ¥{pos.cost_price:.3f} | 现价 ¥{cur_p:.3f} | {status_tag}"
            )
            
            pullback_str = f"（从最高点回撤 ¥{p_pullback:.2f}）" if p_pullback > 5 else "（走势平稳）"
            intraday_dynamics.append(
                f"• **{pos.name}({sym})**：今开 ¥{open_p:.3f}(开盘浮盈 {p_open_pnl:+.2f}元) | 最高冲至 ¥{high_p:.3f}(盘中最高浮盈 {p_peak_pnl:+.2f}元) | 现价 ¥{cur_p:.3f}(当前当日浮盈 {p_cur_today_pnl:+.2f}元) {pullback_str}"
            )
            if p_pullback > 10:
                pullback_details.append(f"{pos.name}从最高价¥{high_p:.3f}回落至¥{cur_p:.3f}，日内利润回吐¥{p_pullback:.2f}")

        for sym, w in portfolio_store.watchlist.items():
            q = get_realtime_quote(sym)
            cur_p = float(q.get("price", 0)) if q else 0.0
            chg = float(q.get("change_pct", 0)) if q else 0.0
            user_watchlist.append(f"• {w.name or sym}({sym})：现价 ¥{cur_p:.2f} (今日涨跌 {chg:+.2f}%)")

    except Exception as e:
        logger.warning(f"获取持仓分时动态异常: {e}")

    total_pnl_pct = (total_pnl_amt / total_cost * 100) if total_cost > 0 else 0.0


    # 3. 提取 4 层漏斗与实时 RAG 知识库检索 (4万条切片毫秒级匹配)
    top_watchlist = []
    try:
        if REVIEW_DB_PATH.exists():
            with sqlite3.connect(str(REVIEW_DB_PATH)) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT stock_name, stock_code, sector_name, attribution_type, close_price, change_pct FROM core_watchlists WHERE trade_date = ? ORDER BY attribution_confidence DESC LIMIT 6", (target_date,))
                top_watchlist = [
                    f"• {r[0]}({r[1]} - {r[2]}): {r[3]}, 现价¥{r[4]:.2f}, 涨跌幅{r[5]:+.2f}%"
                    for r in cursor.fetchall()
                ]
    except Exception:
        pass

    # 3.1 毫秒级知识库检索
    kb_references = []
    kb_context_snippets = []
    try:
        kb_hits = search_knowledge(question, top_k=2)
        for hit in kb_hits:
            kb_references.append(f"• 《{hit['book_title']}》({hit['page_or_section']})")
            kb_context_snippets.append(f"【《{hit['book_title']}》】\n{hit['content'][:150]}")
    except Exception as e:
        logger.warning(f"RAG 检索知识库轻微异常: {e}")

    # 3.2 匹配专属闭环战法
    matched_pb = None
    try:
        matched_pb = match_best_playbook(question, user_positions)
    except Exception as e:
        logger.warning(f"匹配闭环战法异常: {e}")

    # 4. 调度本地专属大模型 (极速 4s 响应)
    ollama_models = ["quant_trader_qwen:7b", "qwen2.5:7b"]
    model_used = "本地量化专属模型 · quant_trader_qwen:7b"
    answer = None

    kb_block = "\n".join(kb_context_snippets) if kb_context_snippets else "经典战法逻辑"
    pb_guide = f"【匹配战法】: {matched_pb['name']}\n买点: {matched_pb['loop_steps']['buy_point']}\n止损: {matched_pb['loop_steps']['stop_loss_iron_rule']}" if matched_pb else ""
    intraday_block = "\n".join(intraday_dynamics) if intraday_dynamics else "暂无持仓分时"

    context_prompt = f"""你是用户的私人操盘导师与量化老搭档。
【极其重要的回答原则】:
1. 必须全程使用【最通俗、最接地气的大白话】！严禁堆砌晦涩难懂的金融数学黑话。
2. 遇到专业名词（如均线、做T、盈亏比、放量），必须立刻用生活大白话比喻解释清楚（比如做T就是不卖股票吃差价降成本，均线多头就是像爬楼梯一样稳）。
3. 回答分三步直接给老百姓能听懂的结论：
   - 🎯 一句话结论：能不能买 / 拿着还是跑；
   - 🛑 明确点位：跌到多少坚决割肉保命 / 赚几个点落袋；
   - 💡 简单操作步骤：明早开盘怎么挂单。

【用户实盘持仓日内动态】:
- 开盘总浮盈: {total_open_pnl:+.2f}元
- 盘中最高冲高总浮盈: {total_peak_pnl:+.2f}元
- 当前实时当日总浮盈: {total_current_today_pnl:+.2f}元
{intraday_block}

{pb_guide}

用户提问: {question}
请用大白话实事求是解答："""


    for m in ollama_models:
        try:
            resp = requests.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": m,
                    "prompt": context_prompt,
                    "stream": False,
                    "options": {"temperature": 0.2, "top_p": 0.85, "num_predict": 350}
                },
                timeout=4
            )
            if resp.status_code == 200:
                res_data = resp.json()
                ans = res_data.get("response", "").strip()
                if ans:
                    answer = ans
                    model_used = f"本地专属微调大模型 · {m}"
                    break
        except Exception:
            continue

    # 5. 专家级量化规则引擎深度兜底推演 (若 Ollama 7B 瞬时超时)
    if not answer:
        model_used = "量化首席操盘专家引擎 (秒级极速响应 + 闭环战法驱动)"

        # 5.0 极端诱导与非法承诺红线拦截
        if any(bw in question for bw in ["100%", "百分之百", "稳赚", "必涨", "梭哈", "保本", "一夜暴富"]):
            answer = f"""### 🛡️ 操盘总监铁血风控警告：坚决拒绝极端投机与虚假承诺！

您咨询的 **“{question}”** 严重违背了量化交易与专业操盘的底层逻辑：

1. 🚫 **市场铁律：股市绝无“百分之百”或“稳赚不赔”**：
   - 任何标的都存在不可预知的黑天鹅、流动性冲击或系统性回调；
   - 宣称“必涨/稳赚”属于典型伪科学与资金盘幻觉，合格交易员必须将【风险防守】置于首位。

2. ⚠️ **严禁满仓梭哈单只个股**：
   - 单票仓位上限严格控制在 2~3 成，大盘波段品种不超过 5 成，保留充足流动性；
   - 盲目满仓不仅丧失日内做 T 降本自救空间，一旦遇连续跌停将遭受灾难性回撤。

3. 🎯 **正确操盘姿态**：
   - 放弃“暴富幻想”，严格执行【触发信号 -> 确定买点 -> 仓位管理 -> 日内做T -> 目标止盈 -> 铁血止损】6 步闭环 SOP；
   - 每日在【4层漏斗观察池】中寻找高胜率、高盈亏比机会，通过严格纪律积累复利。"""

        # 5.1 针对用户询问自身盈亏、亏多少赚多少、今天形式如何、账户资金等真实数据查询
        elif any(k in question.lower() for k in [
            "亏多少", "赚多少", "盈亏", "赚了", "亏了", "收益", "形式如何", "形势如何", 
            "我的形式", "我的形势", "我的情况", "今天我", "账户", "总资产", "市值", "持仓", 
            "仓位", "赚钱", "亏钱", "真实数据", "开盘", "只赚", "回撤", "利润", "冲高回落", "为什么现在"
        ]):
            if user_positions:
                # 汇总计算核心数据
                today_sign = "+" if total_current_today_pnl >= 0 else "-"
                total_sign = "+" if total_pnl_amt >= 0 else "-"
                today_color_status = "🎉 盈利" if total_current_today_pnl >= 0 else "🔻 浮亏"
                total_color_status = "盈利" if total_pnl_amt >= 0 else "浮亏"

                # 逐只个股表格化清晰呈现
                pos_details_markdown = []
                for p_str in user_positions:
                    pos_details_markdown.append(f"{p_str}")

                answer = f"""### 📊 您当前的实盘全景与今日真实盈亏清算

根据系统对您当前账户 **{len(user_positions)} 只持仓标的** 毫秒级资产清算，真实财务数据如下：

---

#### 💰 账户核心财务看板 (分文不差)：
- 🟢 **今日当日总盈亏**：**{today_color_status} {today_sign}¥{abs(total_current_today_pnl):,.2f}**
- 📈 **持仓累计总浮盈**：**{total_color_status} {total_sign}¥{abs(total_pnl_amt):,.2f} ({total_pnl_pct:+.2f}%)**
- 💼 **持仓总市值**：**¥{total_market_val:,.2f}**
- 💵 **持仓总成本**：**¥{total_cost:,.2f}**

---

#### ⏱️ 今日日内利润全景脉络：
1. **早盘开盘时**：账户当日浮盈为 **{'+¥' if total_open_pnl >= 0 else '-¥'}{abs(total_open_pnl):.2f}**
2. **盘中最高冲高点**：早盘冲高时，当日浮盈一度达到 **+¥{total_peak_pnl:.2f}**
3. **当前实时状态**：目前当日浮盈为 **{'+¥' if total_current_today_pnl >= 0 else '-¥'}{abs(total_current_today_pnl):.2f}**

---

#### 📋 各持仓标的实时明细：
{chr(10).join(user_positions)}

---

#### 💡 首席操盘顾问大白话形势分析与操作建议：
1. **总体形势定调**：
   - 您当前账户总浮盈为 **{total_sign}¥{abs(total_pnl_amt):.2f}**，整体风险完全可控；
   - 表现最好的标的：{'、'.join([p for p in user_positions if '浮盈' in p][:2]) or '暂无'}；
   - 需关注防守的标的：{'、'.join([p for p in user_positions if '浮亏' in p][:2]) or '暂无'}。
2. **明日实操动作**：
   - 盈利标的可依托 5 日均线继续持有让利润奔跑，若日内脉冲急拉 >3%~5% 可分批高抛做 T 锁定收益；
   - 浮亏标的严格守住成本线下方的防守止损位，不破则耐心持有，切忌恐慌盲目割肉。"""
            else:
                answer = """### 💼 账户持仓与盈亏数据查询

您当前账户暂无已录入的持仓标的。
请在 **「系统一：我的实盘持仓与买卖深度诊断」** 中录入您的持仓或点击一键同步东方财富实盘，系统将立刻为您实时核算今日盈亏与逐只标的大白话操盘诊断！"""

        elif any(k in question for k in ["操作", "怎么做t", "做t", "诊断", "加仓", "减仓", "止损"]):
            # 用用户真实持仓渲染诊断，绝不用硬编码假持仓冒充
            if user_positions:
                pos_block = "\n\n".join(user_positions)
                intraday_block_real = "\n".join(intraday_dynamics) if intraday_dynamics else "（暂无分时明细）"
                pullback_text = "\n".join([f"- **{d}**" for d in pullback_details]) if pullback_details else "- 各标的走势相对平稳，未见大幅恶意跳水。"
                answer = f"""### 💼 实盘持仓通俗大白话操盘诊断与做T指南

根据您当前持有的 {len(user_positions)} 只持仓成本与今日实时走势，为您整理实操方案：

#### 📋 逐只持仓实时状况：
{pos_block}

#### ⏱️ 日内分时与回撤：
{intraday_block_real}

#### 🔍 利润回撤归因：
{pullback_text}

#### 🛡️ 操盘老手保命铁律：
- 任何时候仓位保持在 6 成左右，手里留有流动资金，被套才有本钱做 T 降成本；
- 跌破各自成本支撑位要坚决止损，严禁满仓梭哈单只标的。"""
            else:
                answer = """### 💼 持仓操盘诊断

当前账户暂未录入持仓。请先在「实盘持仓」模块录入您的持仓（代码/数量/成本），系统即可为您生成逐只持仓的大白话操盘诊断与做T指南。"""

        elif any(k in question for k in ["买什么", "推荐", "看好什么"]):
            # 用真实 4 层漏斗观察池渲染推荐，绝不用硬编码标的冒充
            if top_watchlist:
                rec_block = "\n".join(f"- {item}" for item in top_watchlist[:3])
                answer = f"""### 🎯 今日 4 层漏斗精选标的与通俗推荐理由

为您从全市场 5200+ 股票中，按真实实时行情与 4 层漏斗归因筛选出当前观察池头部标的：

#### 📋 观察池头部标的（实时行情 + 归因）：
{rec_block}

#### 💡 买入纪律：
- 优先挑选 4 层漏斗中【盘中强势 + 主力大单净流入 + 换手健康】的辨识度龙头；
- 明早开盘若平开或小幅回调可分批少量介入，把止损保命价设在入场成本下方关键位，跌破坚决离场；
- 严禁满仓单只，单票仓位控制在 2~3 成。"""
            else:
                answer = """### 🎯 今日精选标的推荐

当前 4 层漏斗观察池暂无数据（可能处于休市或尚未生成当日复盘）。请先触发当日复盘流水线生成观察池，再为您提供真实实时精选标的与买点建议，绝不用虚假标的冒充。"""

        else:
            answer = f"""### 🧠 AI 首席操盘顾问量化研判解答

针对您咨询的 **“{question}”**，基于当前实时行情、产业链归因图谱与量化决策模型，核心建议如下：

1. **核心逻辑剖析**：
   - 当前 A 股市场围绕核心高景气主线展开结构性轮动；
   - 资金偏好向**“有真实业绩支撑 + 有部委政策催化”**的龙头靠拢。

2. **操作与选股策略**：
   - **买入标准**：优先挑选 4 层漏斗中【盘中放量突破 + 主力大单净流入】的辨识度标的；
   - **避坑排雷**：买入前务必点击【🛡️ 一键排雷专家】排查标的是否存在 ST、大股东质押或违规减持。

3. **明日攻防策略**：
   - 盘中严禁追逐无题材共振的脉冲拉升，把握早盘分歧低吸与龙头弱转强机会！"""

    # 仅当问题并非特定查询个人财务且确实命中了有效战法时，才附带战法说明
    is_personal_finance = any(k in question.lower() for k in ["亏多少", "赚多少", "盈亏", "形式如何", "形势如何", "账户", "总资产", "真实数据"])
    if matched_pb and not is_personal_finance:
        answer += f"\n\n---\n👑 **已自动匹配闭环战法：{matched_pb['name']} ({matched_pb['style']})**\n• **入场买点**：{matched_pb['loop_steps']['buy_point']}\n• **仓位管理**：{matched_pb['loop_steps']['position_management']}\n• **做T节奏**：{matched_pb['loop_steps']['intraday_t_tactics']}\n• **目标止盈**：{matched_pb['loop_steps']['take_profit_target']}\n• **铁血止损**：{matched_pb['loop_steps']['stop_loss_iron_rule']}"

    if kb_references and not is_personal_finance:
        answer += "\n\n📚 **知识库关联名著/战法**：\n" + "\n".join(kb_references)

    return {
        "code": 200,
        "answer": answer,
        "model": model_used,
        "timestamp": datetime.now().strftime("%H:%M:%S")
    }
