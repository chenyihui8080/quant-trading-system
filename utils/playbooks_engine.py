#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A股多流派全天候闭环战法军火库 (Trading Playbook Arsenal Engine)
基于 1000+ 部名著与课程知识库提炼的六大实战闭环战法：
1. 集合竞价爆量弱转强战法 (短线情绪)
2. 长红破箱体一红定江山战法 (中线主升)
3. 龙头首阴与二波龙回头战法 (游资龙回头)
4. 大容量中军回踩20日均线战法 (机构波段)
5. 筹码单峰密集向上突破战法 (主力控盘)
6. 存量震荡日内做T降本解套战法 (防守自救)

每套战法均严格包含：触发信号 -> 确定买点 -> 仓位管理 -> 日内做T -> 止盈目标 -> 铁血止损 6大闭环环节！
"""

import json
from typing import List, Dict, Any, Optional

PLAYBOOKS_CATALOG = [
    {
        "id": "playbook_01_auction_breakout",
        "name": "⚡ 集合竞价爆量弱转强战法",
        "style": "短线情绪 · 激进爆发流",
        "applicable_market": "情绪主升浪、短线赚钱效应爆发期、连板梯队活跃期",
        "source_references": ["《流沙河之集合竞价》", "《炒股秘技100招》", "《游资短线操盘精要》"],
        "loop_steps": {
            "trigger_signal": "前一日曾出现烂板、大阴洗盘或冲高回落；次日 09:15~09:25 集合竞价不仅未低开，反而高开 +1.0% ~ +3.8%；竞价量比 > 3.0，9:25 分成交金额 > 2000万元，大单抢筹迹象明显。",
            "buy_point": "【买点1（激进）】09:25:00 竞价直接按现价买入 1/3 底仓；【买点2（稳健）】09:30 开盘秒拉放量站稳分时均价线上方时，追加 1/3 仓位。",
            "position_management": "单票仓位上限严格控制在 2.5 ~ 3.0 成，保留充足流动性，绝不满仓单只高标。",
            "intraday_t_tactics": "次日若早盘快速封涨停，锁仓不动；若早盘冲高无量或炸板且 10 分钟内未回封，果断在分时均线附近分批卖出，锁定利润。",
            "take_profit_target": "首日封板 +10%；次日早盘享有高开冲高 +4% ~ +8% 的超额溢价，总预期收益 12% ~ 18%。",
            "stop_loss_iron_rule": "【铁血止损】开盘若跌破分时均线且 5 分钟内无法收复，或日内亏损达到 -3.5%，必须果断止损离场，绝不犹豫！"
        }
    },
    {
        "id": "playbook_02_box_breakout",
        "name": "🚀 长红破箱体·一红定江山主升战法",
        "style": "经典波段 · 中线主升流",
        "applicable_market": "大盘中级反弹、底部横盘充分、行业催化启动期",
        "source_references": ["《一红定江山》", "《股市趋势技术分析》", "《量价分析》"],
        "loop_steps": {
            "trigger_signal": "标的经历 20 ~ 60 个交易日的缩量箱体震荡筑底；当日以放量长阳（涨幅 > 6.0% 或涨停）强势突破箱体上轨；成交量达到盘整期日均成交量的 2.0 倍以上（倍量突破）。",
            "buy_point": "【买点1】突破箱体上轨并伴随大单放量瞬间追入半仓；【买点2】次日或第三日缩量回踩箱体上轨（确认为支撑线）时不破，逢低加仓至标准仓位。",
            "position_management": "中线波段品种，总仓位可分配 4.0 ~ 5.0 成，分 2 次建仓完毕。",
            "intraday_t_tactics": "依托 5 日均线为中线生命线，回踩 5 日线不破继续持股；日内若脉冲拉升偏离 5 日线 > 5%，可高抛 1/3 仓位，尾盘回落接回做 T+0。",
            "take_profit_target": "波段目标涨幅 20% ~ 35%；当高位出现连续放量滞涨大阴线或跌破 10 日线时分批清仓。",
            "stop_loss_iron_rule": "【铁血止损】若突破后再次跌回箱体内部超 -2.0%（假突破），无条件在收盘前止损出局！"
        }
    },
    {
        "id": "playbook_03_dragon_first_drop",
        "name": "🎯 龙头首阴与二波龙回头战法",
        "style": "游资接力 · 龙头博弈流",
        "applicable_market": "主线板块总龙头连续 3~5 连板后首次出现分歧调整",
        "source_references": ["《流沙河操盘体系》", "《短线交易秘笈》", "《涨停板战法》"],
        "loop_steps": {
            "trigger_signal": "全市场公认的主线总龙头，经历 3~5 连板后收出第一根放量分歧大阴线（首阴）；换手充分但主力未全线出逃，板块其他标的依然保持热度。",
            "buy_point": "首阴次日早盘低开 -3% ~ -6% 快速下探 5 日均线或 10 日均线处，分时出现企稳拐点时分批低吸半仓，博弈日内地天反包板或次日反抽。",
            "position_management": "单票仓位控制在 2.0 ~ 3.0 成，属于高风险高赔率博弈仓。",
            "intraday_t_tactics": "买入后若日内反抽冲高 +4% ~ +7% 但无力封死涨停，日内必须逢高锁定利润；若封死涨停则持股享受次日高开溢价。",
            "take_profit_target": "预期反包涨停 +10% 或二波冲高 +15% ~ +25%。",
            "stop_loss_iron_rule": "【铁血止损】次日收盘跌破 10 日生命线且无资金承接，坚决按纪律割肉离场，绝不补仓抗单！"
        }
    },
    {
        "id": "playbook_04_core_ma20_pullback",
        "name": "🌊 大容量中军·20日均线回踩做T战法",
        "style": "机构趋势 · 核心资产稳健流",
        "applicable_market": "牛市或结构性牛市、大容量科技中军、公募与外资重仓品种",
        "source_references": ["《股票大作手回忆录》", "《日本蜡烛图技术》", "《巴菲特致股东的信》"],
        "loop_steps": {
            "trigger_signal": "日均成交额 > 20 亿元的大市值中军龙头；中长期均线（20日、60日线）保持多头向上排列；股价自高位正常缩量回撤 8% ~ 15%，首次触碰 20 日生命线支撑。",
            "buy_point": "触及 20 日均线且分时成交量出现明显底背离企稳信号时，分批建仓 3 成底仓；若收出带长下影线的阳线，次日加仓 2 成。",
            "position_management": "核心底仓可给到 4.0 ~ 6.0 成，是账户资金的定海神针。",
            "intraday_t_tactics": "保留 1/3 仓位作为机动做 T 仓：早盘缩量急跌 1.5%~2% 补入，日内反抽冲高 2%~3% 立即卖出底仓，不断降低持仓成本。",
            "take_profit_target": "波段收益目标 15% ~ 30%，直至股价加速拉升偏离 20 日线过远时逢高获利了结。",
            "stop_loss_iron_rule": "【铁血止损】有效放量跌破 20 日均线超 2 个交易日无法收复，坚决减仓防守！"
        }
    },
    {
        "id": "playbook_05_chip_density_breakout",
        "name": "📊 筹码单峰密集向上发散战法",
        "style": "主力控盘 · 筹码分布流",
        "applicable_market": "个股底部筹码高度沉淀、主力完成吸筹拉升初期",
        "source_references": ["《筹码分布准确测算》", "《庄家操盘手法解密》", "《分形几何在股市中的应用》"],
        "loop_steps": {
            "trigger_signal": "个股在某个狭窄价格区间内，筹码密集度超过 70%，形成极度清晰的单峰密集形态；获利盘比例从 <20% 快速攀升至 >80%，股价放量向上跳空越过密集峰顶。",
            "buy_point": "股价放量突破筹码主峰最高上沿时直接买入 1/2 仓位；若有盘中回踩筹码峰顶不破，立刻加满目标仓位。",
            "position_management": "单票仓位可给 3.0 ~ 4.0 成。",
            "intraday_t_tactics": "只要底部单峰筹码未向上大面积转移，表明主力仍在锁仓，一路坚定持有；盘中出现急杀不用慌，反而是做 T 低吸良机。",
            "take_profit_target": "当底部筹码峰彻底消失、并在股价高位形成新的密集分散峰时，表明主力派发完毕，全线清仓出局。",
            "stop_loss_iron_rule": "【铁血止损】若股价重回筹码密集峰下沿下方超 -3.0%，判定为主力诱多出逃，坚决止损！"
        }
    },
    {
        "id": "playbook_06_grid_t0_relief",
        "name": "🛡️ 存量震荡·日内T+0降本解套战法",
        "style": "防守反击 · 逆境自救流",
        "applicable_market": "持仓被套浮亏、大盘存量震荡无明显主线、震荡筑底期",
        "source_references": ["《分时图做T实战图解》", "《战胜庄家做T秘诀》", "《资金管理与风控圣经》"],
        "loop_steps": {
            "trigger_signal": "手中持有被套标的，当前处于分时急跌、日线远离 5 日均线、分时 KDJ/RSI 严重超卖（< 15）的超跌状态。",
            "buy_point": "早盘 09:30 ~ 10:00 趁分时出现非理性缩量恐慌急跌考验支撑时，用 1/3 机动可用资金逢低补入等量股份；",
            "position_management": "严格遵守【对冲闭环铁律】：日内买入多少股，当日必须卖出同等数量的老仓股票，隔夜总持股数量绝对不增加！",
            "intraday_t_tactics": "买入后待日内反抽冲高 +2.0% ~ +3.5% 触及分时均线压力位时，立即将原本的底仓卖出，实现日内无风险套利并将成本摊薄。",
            "take_profit_target": "单次做 T 降低持仓成本 1.5% ~ 2.5%，通过 3 ~ 5 次成功做 T 彻底将被套标的转化为盈利出局！",
            "stop_loss_iron_rule": "【铁血止损】若单只标的累计浮亏触及 **-5.0%** 且放量跌破历史最低支撑，坚决按纪律分批止损，绝不无底线抗单！"
        }
    }
]


def match_best_playbook(question: str, positions: List[str] = None) -> Dict[str, Any]:
    """根据用户问题或当前持仓形态，自动匹配最契合的闭环战法"""
    q = question.lower()
    
    if any(k in q for k in ["竞价", "集合竞价", "抢筹", "弱转强", "开盘"]):
        return PLAYBOOKS_CATALOG[0]
    elif any(k in q for k in ["箱体", "突破", "长红", "主升", "一红定江山", "倍量"]):
        return PLAYBOOKS_CATALOG[1]
    elif any(k in q for k in ["首阴", "龙头", "龙回头", "二波", "反包", "连板"]):
        return PLAYBOOKS_CATALOG[2]
    elif any(k in q for k in ["中军", "回踩", "20日", "大市值", "核心资产", "稳健"]):
        return PLAYBOOKS_CATALOG[3]
    elif any(k in q for k in ["筹码", "筹码峰", "单峰", "密集", "主力建仓"]):
        return PLAYBOOKS_CATALOG[4]
    elif any(k in q for k in ["做t", "解套", "被套", "亏损", "摊薄", "降成本", "持仓怎么操作"]):
        return PLAYBOOKS_CATALOG[5]
    else:
        return PLAYBOOKS_CATALOG[1] # 默认主升突破


def get_all_playbooks_summary() -> str:
    """获取六大闭环战法完整大纲与核心逻辑摘要"""
    lines = ["### 🏛️ A股六大闭环战法军火库核心大纲 (基于1000+名著知识库提炼)\n"]
    for pb in PLAYBOOKS_CATALOG:
        lines.append(f"#### {pb['name']} ({pb['style']})")
        lines.append(f"- **适用行情**：{pb['applicable_market']}")
        lines.append(f"- **原著出处**：{' · '.join(pb['source_references'])}")
        lines.append(f"- **1. 触发信号**：{pb['loop_steps']['trigger_signal']}")
        lines.append(f"- **2. 确定买点**：{pb['loop_steps']['buy_point']}")
        lines.append(f"- **3. 仓位管理**：{pb['loop_steps']['position_management']}")
        lines.append(f"- **4. 做T节奏**：{pb['loop_steps']['intraday_t_tactics']}")
        lines.append(f"- **5. 止盈目标**：{pb['loop_steps']['take_profit_target']}")
        lines.append(f"- **6. 铁血止损**：{pb['loop_steps']['stop_loss_iron_rule']}\n")
    return "\n".join(lines)
