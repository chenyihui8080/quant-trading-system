"""信号推送：钉钉/飞书/企业微信 Webhook"""
import requests
import json
import hashlib
import hmac
import base64
import time
import urllib.parse
from datetime import datetime


class Notifier:
    """消息推送器（支持钉钉/飞书/企业微信）"""

    def __init__(self, dingtalk_url: str = None, feishu_webhook: str = None,
                 feishu_secret: str = None, wechat_url: str = None):
        self.dingtalk_url = dingtalk_url
        self.feishu_webhook = feishu_webhook
        self.feishu_secret = feishu_secret
        self.wechat_url = wechat_url

    def send(self, title: str, content: str):
        """发送消息到所有配置的渠道"""
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        full_content = f"[{ts}] {content}"

        if self.dingtalk_url:
            self._send_dingtalk(title, full_content)
        if self.feishu_webhook:
            self._send_feishu(title, full_content)
        if self.wechat_url:
            self._send_wechat(title, full_content)

        print(f"[信号] {title}: {content}")

    def _send_dingtalk(self, title: str, content: str):
        """钉钉机器人"""
        try:
            data = {
                "msgtype": "markdown",
                "markdown": {"title": title, "text": f"### {title}\n\n{content}"},
            }
            requests.post(self.dingtalk_url, json=data, timeout=5)
        except Exception as e:
            print(f"钉钉推送失败: {e}")

    def _send_feishu(self, title: str, content: str):
        """飞书机器人"""
        try:
            url = self.feishu_webhook
            # 签名（如果配置了 secret）
            if self.feishu_secret:
                ts = str(int(time.time()))
                string_to_sign = f"{ts}\n{self.feishu_secret}"
                hmac_code = hmac.new(
                    string_to_sign.encode("utf-8"), digestmod=hashlib.sha256
                ).digest()
                sign = base64.b64encode(hmac_code).decode("utf-8")
                url += f"&timestamp={ts}&sign={urllib.parse.quote(sign)}"

            data = {
                "msg_type": "interactive",
                "card": {
                    "header": {
                        "title": {"content": title, "tag": "plain_text"},
                        "template": "blue",
                    },
                    "elements": [
                        {"tag": "div", "text": {"content": content, "tag": "lark_md"}},
                    ],
                },
            }
            requests.post(url, json=data, timeout=5)
        except Exception as e:
            print(f"飞书推送失败: {e}")

    def _send_wechat(self, title: str, content: str):
        """企业微信机器人"""
        try:
            data = {
                "msgtype": "markdown",
                "markdown": {"content": f"### {title}\n\n{content}"},
            }
            requests.post(self.wechat_url, json=data, timeout=5)
        except Exception as e:
            print(f"微信推送失败: {e}")

    def send_backtest_result(self, strategy: str, symbol: str, stats: dict):
        """推送回测结果摘要"""
        ret = stats.get("total_return", 0)
        sharpe = stats.get("sharpe_ratio", 0)
        dd = stats.get("max_ddpercent", 0)
        win = stats.get("win_rate", 0)
        emoji = "🟢" if ret > 0 else "🔴"
        content = (
            f"{emoji} **回测完成**\n\n"
            f"- 策略: {strategy}\n"
            f"- 股票: {symbol}\n"
            f"- 收益: {ret:.2f}%\n"
            f"- Sharpe: {sharpe:.2f}\n"
            f"- 最大回撤: {dd:.2f}%\n"
            f"- 胜率: {win:.1f}%"
        )
        self.send(f"回测报告 - {strategy}", content)


class SignalGenerator:
    """策略信号生成器"""

    def __init__(self, notifier: Notifier = None):
        self.notifier = notifier or Notifier()
        self.positions: dict[str, int] = {}

    def check_signal(self, strategy_name: str, symbol: str, signal: str, price: float, pos: int):
        """检查并推送交易信号"""
        old_pos = self.positions.get(symbol, 0)

        if pos > old_pos:
            action = "买入"
            emoji = "🟢"
        elif pos < old_pos:
            action = "卖出"
            emoji = "🔴"
        else:
            return

        self.positions[symbol] = pos
        msg = (
            f"{emoji} **{action}信号**\n\n"
            f"- 策略: {strategy_name}\n"
            f"- 股票: {symbol}\n"
            f"- 价格: ¥{price:.2f}\n"
            f"- 持仓: {pos}"
        )
        self.notifier.send(f"{strategy_name} - {action}", msg)
