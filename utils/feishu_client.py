# -*- coding: utf-8 -*-
"""
飞书应用开放平台消息推送核心引擎
复用 Hermes通知中心 机器人凭证，支持发送富文本与高级互动卡片
"""
import os
import json
import logging
import requests
from typing import Optional, Dict, Any

logger = logging.getLogger("FeishuBot")

APP_ID = os.getenv("FEISHU_APP_ID", "")
APP_SECRET = os.getenv("FEISHU_APP_SECRET", "")
DEFAULT_CHAT_ID = os.getenv("FEISHU_CHAT_ID", "")

_cached_token = None
_token_expire_at = 0

def get_tenant_access_token() -> Optional[str]:
    """获取飞书应用 tenant_access_token (自动缓存与刷新)"""
    global _cached_token, _token_expire_at
    if not APP_ID or not APP_SECRET:
        logger.debug("未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET，跳过飞书通知")
        return None

    import time
    now = time.time()
    if _cached_token and now < _token_expire_at:
        return _cached_token

    try:
        url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        resp = requests.post(url, json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=10)
        data = resp.json()
        if data.get("code") == 0:
            _cached_token = data.get("tenant_access_token")
            # 提前 5 分钟刷新
            _token_expire_at = now + data.get("expire", 7200) - 300
            return _cached_token
        else:
            logger.error(f"获取飞书 token 失败: {data}")
    except Exception as e:
        logger.error(f"获取飞书 token 异常: {e}")
    return None

def send_feishu_text(text: str, chat_id: str = DEFAULT_CHAT_ID) -> bool:
    """向飞书群发送纯文本消息"""
    token = get_tenant_access_token()
    if not token:
        return False
    try:
        url = f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {
            "receive_id": chat_id,
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False)
        }
        res = requests.post(url, headers=headers, json=payload, timeout=10)
        return res.status_code == 200 and res.json().get("code") == 0
    except Exception as e:
        logger.error(f"发送飞书文本消息异常: {e}")
        return False

def send_feishu_card(title: str, elements_markdown: str, header_color: str = "blue", chat_id: str = DEFAULT_CHAT_ID) -> bool:
    """
    向飞书群发送精美互动卡片
    header_color: blue, green, orange, red, turquoise, purple, carmine
    """
    token = get_tenant_access_token()
    if not token:
        return False
    try:
        url = f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        
        card_content = {
            "config": {
                "wide_screen_mode": True
            },
            "header": {
                "title": {
                    "tag": "plain_text",
                    "content": title
                },
                "template": header_color
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": elements_markdown
                    }
                },
                {
                    "tag": "hr"
                },
                {
                    "tag": "note",
                    "elements": [
                        {
                            "tag": "plain_text",
                            "content": "来自 VNPY 量化决策高可用中枢 · 自动复盘飞轮"
                        }
                    ]
                }
            ]
        }
        
        payload = {
            "receive_id": chat_id,
            "msg_type": "interactive",
            "content": json.dumps(card_content, ensure_ascii=False)
        }
        res = requests.post(url, headers=headers, json=payload, timeout=10)
        return res.status_code == 200 and res.json().get("code") == 0
    except Exception as e:
        logger.error(f"发送飞书卡片异常: {e}")
        return False
