"""推送通知：飞书 / 钉钉 / 企业微信 / Server酱 / 邮件"""
import requests
import smtplib
import hashlib
import hmac
import base64
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class PushConfig:
    """推送配置"""
    # 飞书机器人（https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot）
    feishu_webhook: str = ""
    feishu_secret: str = ""  # 签名校验密钥（可选）

    # Server酱（https://sct.ftqq.com/）
    serverchan_key: str = ""

    # 邮件 SMTP
    smtp_host: str = ""         # 如 smtp.qq.com
    smtp_port: int = 465
    smtp_user: str = ""         # 发件邮箱
    smtp_pass: str = ""         # 授权码（不是登录密码）
    email_to: str = ""          # 收件邮箱

    # 钉钉机器人
    dingtalk_url: str = ""

    # 企业微信机器人
    wechat_url: str = ""


class PushNotifier:
    """统一推送管理器"""

    def __init__(self, config: PushConfig = None):
        self.config = config or PushConfig()

    def update_config(self, **kwargs):
        """更新配置"""
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)

    def send(self, title: str, content: str, priority: str = "normal") -> dict:
        """发送推送（同时发送到所有已配置渠道）

        Args:
            title: 标题
            content: 内容
            priority: low/normal/high
        Returns:
            {"feishu": True/False, "serverchan": True/False, "email": True/False, ...}
        """
        results = {}

        # 飞书（优先，最稳定）
        if self.config.feishu_webhook:
            results["feishu"] = self._send_feishu(title, content)

        # Server酱
        if self.config.serverchan_key:
            results["serverchan"] = self._send_serverchan(title, content)

        # 邮件
        if self.config.smtp_host and self.config.email_to:
            results["email"] = self._send_email(title, content)

        # 钉钉
        if self.config.dingtalk_url:
            results["dingtalk"] = self._send_dingtalk(title, content)

        # 企业微信
        if self.config.wechat_url:
            results["wechat"] = self._send_wechat(title, content)

        if not results:
            logger.warning("未配置任何推送渠道")
            return {"error": "未配置推送渠道"}

        return results

    def _send_serverchan(self, title: str, content: str) -> bool:
        """Server酱推送到微信

        注册地址：https://sct.ftqq.com/
        获取 SendKey 后填入配置即可
        """
        try:
            url = f"https://sctapi.ftqq.com/{self.config.serverchan_key}.send"
            data = {"title": title, "desp": content}
            resp = requests.post(url, data=data, timeout=10)
            result = resp.json()
            if result.get("code") == 0:
                logger.info(f"Server酱推送成功: {title}")
                return True
            else:
                logger.error(f"Server酱推送失败: {result}")
                return False
        except Exception as e:
            logger.error(f"Server酱推送异常: {e}")
            return False

    def _send_email(self, title: str, content: str) -> bool:
        """邮件推送"""
        try:
            msg = MIMEMultipart()
            msg["From"] = self.config.smtp_user
            msg["To"] = self.config.email_to
            msg["Subject"] = f"[量化系统] {title}"
            msg.attach(MIMEText(content, "html", "utf-8"))

            with smtplib.SMTP_SSL(self.config.smtp_host, self.config.smtp_port) as server:
                server.login(self.config.smtp_user, self.config.smtp_pass)
                server.sendmail(self.config.smtp_user, self.config.email_to, msg.as_string())

            logger.info(f"邮件推送成功: {title}")
            return True
        except Exception as e:
            logger.error(f"邮件推送异常: {e}")
            return False

    def _send_dingtalk(self, title: str, content: str) -> bool:
        """钉钉机器人推送"""
        try:
            data = {
                "msgtype": "markdown",
                "markdown": {"title": title, "text": f"### {title}\n\n{content}"},
            }
            resp = requests.post(self.config.dingtalk_url, json=data, timeout=10)
            result = resp.json()
            return result.get("errcode") == 0
        except Exception as e:
            logger.error(f"钉钉推送异常: {e}")
            return False

    def _send_wechat(self, title: str, content: str) -> bool:
        """企业微信机器人推送"""
        try:
            data = {
                "msgtype": "markdown",
                "markdown": {"content": f"### {title}\n\n{content}"},
            }
            resp = requests.post(self.config.wechat_url, json=data, timeout=10)
            result = resp.json()
            return result.get("errcode") == 0
        except Exception as e:
            logger.error(f"企业微信推送异常: {e}")
            return False

    def _feishu_sign(self, timestamp: str) -> str:
        """飞书机器人签名校验（HMAC-SHA256）"""
        string_to_sign = f"{timestamp}\n{self.config.feishu_secret}"
        hmac_code = hmac.new(
            string_to_sign.encode("utf-8"), digestmod=hashlib.sha256
        ).digest()
        return base64.b64encode(hmac_code).decode("utf-8")

    def _send_feishu(self, title: str, content: str) -> bool:
        """飞书自定义机器人推送（富文本卡片）

        配置方式：
        1. 飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人
        2. 复制 Webhook 地址填入配置
        3. （可选）开启签名校验，把密钥填入 feishu_secret
        """
        try:
            timestamp = str(int(time.time()))

            # 构建富文本卡片消息
            card = {
                "header": {
                    "title": {"tag": "plain_text", "content": title},
                    "template": "red",
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": content,  # 飞书 lark_md 支持 **加粗**
                        },
                    },
                    {
                        "tag": "hr",
                    },
                    {
                        "tag": "note",
                        "elements": [
                            {
                                "tag": "plain_text",
                                "content": "量化交易系统 · 自动推送",
                            }
                        ],
                    },
                ],
            }

            payload: dict = {
                "msg_type": "interactive",
                "card": card,
            }

            # 如果配置了签名密钥，加上签名
            if self.config.feishu_secret:
                payload["timestamp"] = timestamp
                payload["sign"] = self._feishu_sign(timestamp)

            resp = requests.post(
                self.config.feishu_webhook, json=payload, timeout=10
            )
            result = resp.json()

            if result.get("code") == 0 or result.get("StatusCode") == 0:
                logger.info(f"飞书推送成功: {title}")
                return True
            else:
                logger.error(f"飞书推送失败: {result}")
                return False
        except Exception as e:
            logger.error(f"飞书推送异常: {e}")
            return False


# 全局推送实例
notifier = PushNotifier()


def send_price_alert(
    symbol: str,
    name: str,
    current_price: float,
    target_price: float,
    direction: str,
) -> dict:
    """价格告警推送

    Args:
        symbol: 股票代码
        name: 股票名称
        current_price: 当前价格
        target_price: 目标价格
        direction: "above" 或 "below"
    """
    if direction == "above":
        title = f"{name}({symbol}) 价格突破 ¥{target_price}"
        content = (
            f"**{name}**（{symbol}）\n\n"
            f"- 当前价格：**¥{current_price}**\n"
            f"- 目标价格：¥{target_price}\n"
            f"- 触发条件：价格 **高于** 目标价\n"
            f"- 时间：{__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        )
    else:
        title = f"{name}({symbol}) 价格跌破 ¥{target_price}"
        content = (
            f"**{name}**（{symbol}）\n\n"
            f"- 当前价格：**¥{current_price}**\n"
            f"- 目标价格：¥{target_price}\n"
            f"- 触发条件：价格 **低于** 目标价\n"
            f"- 时间：{__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        )

    return notifier.send(title, content, priority="high")


def send_trade_signal(
    strategy: str,
    symbol: str,
    action: str,
    price: float,
    volume: int,
) -> dict:
    """交易信号推送"""
    title = f"[{strategy}] {symbol} {action} ¥{price} x {volume}股"
    content = (
        f"**策略**: {strategy}\n\n"
        f"**股票**: {symbol}\n\n"
        f"**操作**: {action}\n\n"
        f"**价格**: ¥{price}\n\n"
        f"**数量**: {volume}股\n\n"
        f"**时间**: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
    )
    return notifier.send(title, content)
