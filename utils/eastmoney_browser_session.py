"""
东方财富 Playwright 无头浏览器自动会话管理与断线自愈引擎
======================================================
核心能力：
1. 自动启动无头/交互式 Chromium 会话直连东方财富交易端
2. 捕获真实登录 Session/Cookie 并自动同步至东财凭证库
3. 拦截交易接口 JSON 数据流并实现持仓与交割单自动对账
"""

import asyncio
import logging
import json
from pathlib import Path
from typing import Dict, Any, Optional, List
import asyncio
import logging
import json
import re
import time
from pathlib import Path
from typing import Dict, Any, Optional, List
from utils.eastmoney_daemon import eastmoney_auth, eastmoney_daemon
from utils.eastmoney_crypto import encrypt_text, decrypt_text

logger = logging.getLogger("EastMoneyBrowser")

DATA_DIR = Path(__file__).parent.parent / "data"
BROWSER_CONFIG_FILE = DATA_DIR / "eastmoney_browser_config.json"
USER_DATA_DIR = DATA_DIR / "eastmoney_browser_profile"


class EastMoneyBrowserSessionManager:
    """东方财富 Playwright 浏览器会话与断线自愈管理器"""

    def __init__(self):
        self.is_running = False
        self.last_login_time: Optional[str] = None
        self.last_error: Optional[str] = None
        self.last_silent_reauth_ts: float = 0.0

    def save_account_credentials(self, account: str, password: str, broker: str = "东方财富"):
        """安全加密保存账号与密码"""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        config = {
            "account": account,
            "enc_password": encrypt_text(password),
            "broker": broker,
            "auto_reconnect": True,
        }
        with open(BROWSER_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return {"status": "saved", "account": account}

    def load_account_credentials(self) -> Optional[Dict[str, Any]]:
        """读取已加密保存的凭证"""
        if not BROWSER_CONFIG_FILE.exists():
            return None
        try:
            with open(BROWSER_CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {
                    "account": data.get("account", ""),
                    "password": decrypt_text(data.get("enc_password", "")),
                    "broker": data.get("broker", "东方财富"),
                    "auto_reconnect": data.get("auto_reconnect", True),
                }
        except Exception as e:
            logger.warning(f"读取浏览器凭证配置失败: {e}")
            return None

    async def launch_interactive_capture(self, timeout_sec: int = 180) -> Dict[str, Any]:
        """
        🚀 一键拉起东财登录轻量窗口，持久化用户 Profile，用户扫码或登录后，全自动捕获 Cookie 与 ValidateKey 并存入系统
        """
        if self.is_running:
            return {"code": 409, "message": "已有自动捕获任务正在运行中，请在打开的窗口中完成登录"}

        self.is_running = True
        USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as p:
                # 采用持久化 User Data Dir，保留所有设备指纹、LocalStorage 及历史会话
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=str(USER_DATA_DIR),
                    headless=False,
                    args=[
                        "--window-size=1020,760",
                        "--window-position=180,80",
                        "--ignore-certificate-errors",
                        "--allow-insecure-localhost",
                        "--disable-blink-features=AutomationControlled"
                    ],
                    ignore_https_errors=True,
                    viewport={"width": 1000, "height": 720},
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
                
                page = context.pages[0] if context.pages else await context.new_page()

                captured_data = {
                    "cookie_str": "",
                    "validatekey": "",
                    "found": False
                }

                # 监听所有网络请求，一旦发现包含东财交易接口与凭证，立即提取
                async def on_request(req):
                    try:
                        headers = req.headers
                        cookie = headers.get("cookie", "")
                        url = req.url
                        
                        vkey = ""
                        if "validatekey=" in url.lower():
                            m = re.search(r"validatekey=([^&]+)", url, re.IGNORECASE)
                            if m:
                                vkey = m.group(1).strip()
                        elif "validatekey" in cookie.lower():
                            m = re.search(r"validatekey=([^;]+)", cookie, re.IGNORECASE)
                            if m:
                                vkey = m.group(1).strip()

                        # 检查交易核心接口
                        if "eastmoney.com" in url and ("Search" in url or "Trade" in url or "Holding" in url or "Position" in url or "Margin" in url):
                            if len(cookie) > 30:
                                captured_data["cookie_str"] = cookie
                                if vkey:
                                    captured_data["validatekey"] = vkey
                                    captured_data["found"] = True

                        if vkey and len(cookie) > 30:
                            captured_data["cookie_str"] = cookie
                            captured_data["validatekey"] = vkey
                            captured_data["found"] = True
                    except Exception as e:
                        logger.debug(f"Req intercept error: {e}")

                context.on("request", on_request)

                # 打开东财网页交易端登录首页
                await page.goto("https://jy.sc.eastmoney.com/", timeout=30000)
                logger.info("已拉起东方财富网页交易端窗口，等待用户登录 (持久化Profile生效中)...")

                start_time = asyncio.get_event_loop().time()
                last_jump_try = 0

                while (asyncio.get_event_loop().time() - start_time) < timeout_sec:
                    await asyncio.sleep(0.8)

                    # 1. 优先检查网络拦截是否已抓取到完整凭证
                    if captured_data["found"] and captured_data["cookie_str"] and captured_data["validatekey"]:
                        logger.info("⚡ 网络请求拦截器已成功捕获 validatekey 与 Cookie！")
                        break

                    now_ts = asyncio.get_event_loop().time()
                    cur_url = page.url

                    # 2. 智能自动跳转：如果在 passport 或 eastmoney 主站已完成登录，自动跳转到交易持仓页
                    if "jy.sc.eastmoney.com" not in cur_url and (now_ts - last_jump_try > 3.0):
                        try:
                            cookies = await context.cookies()
                            cookie_names = {c["name"] for c in cookies}
                            if "uidal" in cookie_names or "ct" in cookie_names or "ut" in cookie_names or "pi" in cookie_names:
                                logger.info(f"⚡ 检测到已完成东财账号登录 (当前URL: {cur_url})，正在自动跳转进入证券交易端持仓页面...")
                                last_jump_try = now_ts
                                await page.goto("https://jy.sc.eastmoney.com/Search/Position", timeout=25000)
                                await asyncio.sleep(1.5)
                        except Exception as nav_e:
                            logger.debug(f"自动导航至交易页重试: {nav_e}")

                    # 3. 如果已经在交易端页面，提取页面内 validatekey
                    if "jy.sc.eastmoney.com" in cur_url:
                        try:
                            found_vk = await page.evaluate("""() => {
                                var vk = '';
                                var m = (location.search + location.hash + location.href).match(/validatekey=([^&#\\s]+)/i);
                                if (m) return m[1];
                                if (window.validatekey) return window.validatekey;
                                if (window.ValidateKey) return window.ValidateKey;
                                try {
                                    vk = sessionStorage.getItem('validatekey') || localStorage.getItem('validatekey') || '';
                                } catch(e){}
                                return vk;
                            }""")
                            if found_vk:
                                captured_data["validatekey"] = found_vk
                        except Exception:
                            pass

                    # 4. 备用方案：主动从 context 中读取 cookies
                    try:
                        cookies = await context.cookies()
                        cookie_dict = {c["name"]: c["value"] for c in cookies}
                        cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
                        
                        vkey = captured_data.get("validatekey") or cookie_dict.get("validatekey") or cookie_dict.get("ValidateKey") or ""

                        if len(cookies) >= 5 and (vkey or "jy.sc.eastmoney.com" in cur_url):
                            captured_data["cookie_str"] = cookie_str
                            if vkey:
                                captured_data["validatekey"] = vkey
                                logger.info(f"⚡ 成功捕获完整交易凭证 (Cookie长度: {len(cookie_str)}, validatekey: {vkey[:6]}...)")
                                break
                    except Exception as loop_e:
                        logger.debug(f"轮询凭证探测中: {loop_e}")

                # 抓取结束，优雅关闭浏览器持久化上下文
                try:
                    await context.close()
                except Exception:
                    pass

                final_cookie = captured_data["cookie_str"]
                final_vkey = captured_data["validatekey"]

                if final_cookie:
                    info = eastmoney_auth.set_full_credentials(
                        cookie_str=final_cookie,
                        validatekey=final_vkey or "",
                        user_name="陈一辉 (自动捕获/续期)"
                    )
                    eastmoney_daemon.keep_alive_heartbeat()
                    return {
                        "code": 200,
                        "message": "🎉 Cookie 与会话凭证捕获成功！已自动完成实盘直连与持仓同步",
                        "data": {
                            "user_name": info["user_name"],
                            "cookie_len": len(final_cookie),
                            "validatekey": bool(final_vkey)
                        }
                    }
                else:
                    return {"code": 408, "message": "在超时时间内未检测到登录完成，请重试"}

        except Exception as e:
            logger.error(f"交互式抓取 Cookie 异常: {e}")
            return {"code": 500, "message": f"自动抓取发生错误: {str(e)}"}
        finally:
            self.is_running = False

    async def attempt_silent_reauth(self, timeout_sec: int = 35) -> bool:
        """
        ⚡ 后台无头（Headless）静默自愈续期：利用已持久化的 Browser Profile 快速刷新并提取新凭证
        若由于东财闲置导致 session 失效，此方法可在用户完全无感知的情况下自动恢复在线状态
        """
        # 冷却控制：避免 10 分钟内高频重试
        now_ts = time.time()
        if now_ts - self.last_silent_reauth_ts < 600:
            logger.info("⏳ 静默自愈处于冷却周期中 (600s)，跳过本次静默重试")
            return False
        if self.is_running:
            return False

        if not USER_DATA_DIR.exists():
            return False

        self.last_silent_reauth_ts = now_ts
        self.is_running = True
        logger.info("🔄 启动后台无头静默自愈引擎，正在通过持久化Profile刷新东财会话...")

        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as p:
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=str(USER_DATA_DIR),
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled", "--ignore-certificate-errors"],
                    ignore_https_errors=True,
                    viewport={"width": 1000, "height": 720},
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )

                page = context.pages[0] if context.pages else await context.new_page()

                captured = {"cookie_str": "", "validatekey": ""}

                async def on_req(req):
                    url = req.url
                    cookie = req.headers.get("cookie", "")
                    if "eastmoney.com" in url:
                        if len(cookie) > 30:
                            captured["cookie_str"] = cookie
                        if "validatekey=" in url.lower():
                            m = re.search(r"validatekey=([^&]+)", url, re.IGNORECASE)
                            if m:
                                captured["validatekey"] = m.group(1).strip()

                context.on("request", on_req)

                try:
                    await page.goto("https://jy.sc.eastmoney.com/Search/Position", timeout=20000)
                    await asyncio.sleep(2.0)
                except Exception as go_e:
                    logger.debug(f"静默导航持仓页: {go_e}")

                # 提取 cookies 和 validatekey
                cookies = await context.cookies()
                cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
                if len(cookie_str) > len(captured["cookie_str"]):
                    captured["cookie_str"] = cookie_str

                if not captured["validatekey"]:
                    try:
                        vk = await page.evaluate("""() => {
                            var m = (location.search + location.hash + location.href).match(/validatekey=([^&#\\s]+)/i);
                            return m ? m[1] : (window.validatekey || '');
                        }""")
                        if vk:
                            captured["validatekey"] = vk
                    except Exception:
                        pass

                await context.close()

                if captured["cookie_str"] and len(captured["cookie_str"]) > 50:
                    eastmoney_auth.set_full_credentials(
                        cookie_str=captured["cookie_str"],
                        validatekey=captured["validatekey"] or "",
                        user_name=eastmoney_auth.get_user_name()
                    )
                    eastmoney_daemon.keep_alive_heartbeat()
                    logger.info("🎉 后台无头静默自愈成功！东财凭证与会话已自动续期！")
                    return True
                else:
                    logger.warning("后台静默自愈未捕获到有效凭证，需用户下一次交互登录")
                    return False

        except Exception as e:
            logger.warning(f"后台静默自愈过程异常: {e}")
            return False
        finally:
            self.is_running = False


# 全局单例
eastmoney_browser_session = EastMoneyBrowserSessionManager()

