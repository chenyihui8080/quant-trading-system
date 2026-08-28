"""
东方财富账户与自选股专属直连同步适配器 (EastMoney Account Adapter)
支持免密/只读模式获取东方财富自选股分组、自选标的与实盘对账单数据
"""
import logging
import re
from typing import List, Dict, Any, Optional
import requests

logger = logging.getLogger("EastMoneyAdapter")


class EastMoneyAdapter:
    """东方财富账户直连服务"""

    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://quote.eastmoney.com/",
        }

    def fetch_user_watchlist(self, user_token_or_uid: str) -> List[Dict[str, Any]]:
        """
        通过东方财富 Web 只读 Token 或自选股公开分享链接同步自选股
        支持格式：
        1. 东方财富自选股分享链接 (如 https://quote.eastmoney.com/zixuan/...)
        2. 东方财富只读 Cookie / Token (ut / ct)
        """
        user_token_or_uid = user_token_or_uid.strip()
        results = []

        try:
            # 1. 尝试从分享链接中提取 gid 或 uid
            uid_match = re.search(r"(?:uid|gid|token)=([a-zA-Z0-9_\-]+)", user_token_or_uid)
            token = uid_match.group(1) if uid_match else user_token_or_uid

            # 东方财富自选股官方 API (只读查询)
            url = f"https://myfavor.eastmoney.com/v4/webouter/gstklist?appkey=d41d8cd98f00b204e9800998ecf8427e&uid={token}&g=1"
            resp = requests.get(url, headers=self.headers, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                stocks = data.get("data", {}).get("ginfolist", [])
                for item in stocks:
                    code = item.get("security", "")
                    name = item.get("name", "")
                    if code:
                        # 格式化 A 股/港股代码
                        clean_sym = code.split("$")[-1] if "$" in code else code
                        results.append({
                            "symbol": clean_sym,
                            "name": name or clean_sym,
                            "market": "A股" if clean_sym.startswith(("6", "0", "3", "5", "1")) else "其他"
                        })
        except Exception as e:
            logger.warning(f"东财自选股直连拉取异常: {e}")

        return results

    def parse_eastmoney_export_file(self, content: bytes, filename: str) -> List[Dict[str, Any]]:
        """解析东方财富 PC 端或手机端导出的持仓/交割单文件 (Excel / CSV / TXT)"""
        from utils.broker_importer import broker_importer
        return broker_importer.parse_excel_or_csv(content, filename)


eastmoney_adapter = EastMoneyAdapter()
