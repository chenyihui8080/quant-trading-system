# -*- coding: utf-8 -*-
"""
智能多浏览器唤起与防无限狂弹守护器 (Smart Multi-Browser Launcher & Anti-Spam Guard)
支持 Chrome / Firefox / Safari 自动降级与防抖熔断，彻底解决浏览器狂开与死循环问题。
"""

import os
import time
import logging
import subprocess

logger = logging.getLogger(__name__)

# 全局防狂弹防抖锁：记录上次打开时间和打开的 URL，防止死循环无限弹窗
_LAST_OPEN_TIMESTAMP = 0.0
_LAST_OPEN_URL = ""
_MIN_INTERVAL_SECONDS = 8.0  # 8 秒内同一 URL 严禁重复弹窗狂开

INSTALLED_BROWSERS = [
    ("Google Chrome", "/Applications/Google Chrome.app"),
    ("Firefox", "/Applications/Firefox.app"),
    ("Safari", "/Applications/Safari.app")
]

def open_browser_with_fallback(url: str = "http://127.0.0.1:8000/", preferred: str = "chrome") -> dict:
    """
    智能唤起本地浏览器：
    1. 防死循环狂弹：8秒内不重复弹相同URL；
    2. 优先尝试 preferred 浏览器；
    3. 若 Chrome 异常或未安装，自动无缝降级到本地 Firefox 或 Safari。
    """
    global _LAST_OPEN_TIMESTAMP, _LAST_OPEN_URL
    now = time.time()

    # 1. 严格防狂弹熔断检查
    if url == _LAST_OPEN_URL and (now - _LAST_OPEN_TIMESTAMP) < _MIN_INTERVAL_SECONDS:
        logger.warning(f"[防狂弹拦截] 距上次打开仅 {now - _LAST_OPEN_TIMESTAMP:.1f} 秒，已拦截重复弹窗: {url}")
        return {"success": True, "action": "blocked_by_anti_spam", "message": "已成功拦截频繁重复弹窗，保护您的屏幕不被抢占"}

    # 2. 确定候选浏览器优先级列表
    order = []
    if preferred.lower() in ["chrome", "google chrome"]:
        order = [("Google Chrome", "/Applications/Google Chrome.app"),
                 ("Firefox", "/Applications/Firefox.app"),
                 ("Safari", "/Applications/Safari.app")]
    elif preferred.lower() == "firefox":
        order = [("Firefox", "/Applications/Firefox.app"),
                 ("Google Chrome", "/Applications/Google Chrome.app"),
                 ("Safari", "/Applications/Safari.app")]
    elif preferred.lower() == "safari":
        order = [("Safari", "/Applications/Safari.app"),
                 ("Google Chrome", "/Applications/Google Chrome.app"),
                 ("Firefox", "/Applications/Firefox.app")]
    else:
        order = INSTALLED_BROWSERS

    # 3. 逐个尝试启动
    for b_name, b_path in order:
        if not os.path.exists(b_path):
            continue
        try:
            logger.info(f"正在尝试使用 [{b_name}] 打开: {url}")
            res = subprocess.run(["open", "-a", b_name, url], check=True, capture_output=True, text=True, timeout=5)
            _LAST_OPEN_TIMESTAMP = now
            _LAST_OPEN_URL = url
            return {"success": True, "browser": b_name, "url": url, "message": f"已成功通过本地 {b_name} 打开界面"}
        except Exception as e:
            logger.warning(f"使用 [{b_name}] 打开失败，尝试降级下一个浏览器: {e}")
            continue

    # 4. 兜底系统默认浏览器
    try:
        subprocess.run(["open", url], check=True, timeout=5)
        _LAST_OPEN_TIMESTAMP = now
        _LAST_OPEN_URL = url
        return {"success": True, "browser": "system_default", "url": url}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    print("Testing browser launcher...")
    # 测试检测逻辑，不直接弹开
    print("Available browsers:")
    for name, path in INSTALLED_BROWSERS:
        print(f" - {name}: {'Installed' if os.path.exists(path) else 'Missing'}")
