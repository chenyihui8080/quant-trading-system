"""信号推送：钉钉/企业微信 Webhook"""
import requests
import json
from datetime import datetime


class Notifier:
    """消息推送器"""

    def __init__(self, dingtalk_url: str = None, wechat_url: str = None):
        self.dingtalk_url = dingtalk_url
        self.wechat_url = wechat_url

    def send(self, title: str, content: str):
        """发送消息到所有配置的渠道"""
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        full_content = f"[{ts}] {content}"

        if self.dingtalk_url:
            self._send_dingtalk(title, full_content)
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
        msg = f"{emoji} **{action}信号**\n\n- 策略: {strategy_name}\n- 股票: {symbol}\n- 价格: ¥{price:.2f}\n- 持仓: {pos}"
        self.notifier.send(f"{strategy_name} - {action}", msg)
