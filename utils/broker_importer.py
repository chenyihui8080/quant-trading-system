"""
券商股票账户持仓直连与多源智能解析导入引擎 (Broker Account Importer)
支持以下免交易、纯只读的持仓数据获取方式：
1. 券商 Excel / CSV 导出的持仓表一键解析 (智能匹配同花顺/东财/华泰/中信/银河等所有券商格式)
2. 自由文本 / 微信持仓信息智能语义解析 (NLP 文本提取)
3. 雪球 / 同花顺实盘投资组合 (Cube / Portfolio) 公开 API 只读直连
"""

import io
import json
import logging
import re
from typing import List, Dict, Any
import pandas as pd
import requests

from utils.stock_search import search_stock_sina

logger = logging.getLogger("BrokerImporter")



class BrokerImporter:
    """券商账户持仓数据解析器"""

    # 常见券商表格表头同义词词典
    COL_SYMBOL_SYNONYMS = ["证券代码", "股票代码", "代码", "标的代码", "合约代码", "Symbol", "Code", "sec_code"]
    COL_NAME_SYNONYMS = ["证券名称", "股票名称", "名称", "标的名称", "Name", "sec_name"]
    COL_SHARES_SYNONYMS = ["股票余额", "证券数量", "持仓数量", "当前持仓", "可用数量", "总股份", "股数", "数量", "Shares", "Holdings", "vol"]
    COL_COST_SYNONYMS = ["成本价", "买入均价", "持仓成本", "保本价", "参考成本价", "成本", "均价", "Cost", "Price", "cost_price"]

    def parse_excel_or_csv(self, file_bytes: bytes, filename: str) -> List[Dict[str, Any]]:
        """智能解析券商导出的 Excel 或 CSV 文件"""
        df = None
        try:
            if filename.endswith(".csv"):
                try:
                    df = pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8")
                except Exception:
                    df = pd.read_csv(io.BytesIO(file_bytes), encoding="gbk")
            else:
                df = pd.read_excel(io.BytesIO(file_bytes))
        except Exception as e:
            logger.error(f"读取表格文件失败: {e}")
            raise ValueError(f"无法读取文件，请确认是否为有效的 Excel 或 CSV 文件: {e}")

        if df is None or df.empty:
            raise ValueError("上传的文件内容为空")

        # 查找匹配的列名
        columns = [str(c).strip() for c in df.columns]
        sym_col = self._match_column(columns, self.COL_SYMBOL_SYNONYMS)
        name_col = self._match_column(columns, self.COL_NAME_SYNONYMS)
        shares_col = self._match_column(columns, self.COL_SHARES_SYNONYMS)
        cost_col = self._match_column(columns, self.COL_COST_SYNONYMS)

        if not shares_col:
            raise ValueError(f"未识别到持仓数量列，表格包含列为: {columns}")

        parsed_items = []
        for idx, row in df.iterrows():
            try:
                raw_sym = str(row[sym_col]).strip() if sym_col else ""
                raw_name = str(row[name_col]).strip() if name_col else ""
                raw_shares = row[shares_col]
                raw_cost = row[cost_col] if cost_col else 0.0

                # 清洗代码
                clean_sym = re.sub(r"[^\w\.]", "", raw_sym)
                # 补全 6 位代码
                if clean_sym.isdigit() and len(clean_sym) < 6:
                    clean_sym = clean_sym.zfill(6)

                # 股数与成本数值转换
                shares = int(float(str(raw_shares).replace(",", "")))
                if shares <= 0:
                    continue

                cost = float(str(raw_cost).replace(",", "").replace("¥", "").replace("$", "")) if raw_cost else 0.0

                # 若无名称尝试检索
                if not raw_name or raw_name == "nan":
                    s_res = search_stock_sina(clean_sym, limit=1)
                    raw_name = s_res[0]["name"] if s_res else clean_sym

                parsed_items.append({
                    "symbol": clean_sym,
                    "name": raw_name,
                    "shares": shares,
                    "cost_price": round(cost, 3),
                })
            except Exception:
                continue

        if not parsed_items:
            raise ValueError("未从表格中提取出有效的股票持仓数据")

        return parsed_items

    def parse_free_text(self, text: str) -> List[Dict[str, Any]]:
        """从自由文本、券商App持仓截图或对账单中智能提取持仓数据"""
        if not text or not text.strip():
            return []

        # 优先检测券商手机 App 持仓表格特征 (如 东方财富 / 同花顺 / 华泰 / 招商 等)
        if any(kw in text for kw in ["持仓", "股票/市值", "场内基金", "当日盈亏", "买入均", "买入均价"]):
            app_results = self._parse_app_portfolio_screenshot(text)
            if app_results:
                return app_results

        lines = [line.strip() for line in text.split("\n") if line.strip()]
        results = []


        # 常用国内知名标的简写字典
        COMMON_MAPPINGS = {
            "证券ETF": ("512880", "证券ETF"),
            "机器人ETF": ("562500", "机器人ETF"),
            "养殖ETF": ("159865", "养殖ETF"),
            "芯片ETF": ("159995", "芯片ETF"),
            "半导体ETF": ("512480", "半导体ETF"),
            "医疗ETF": ("512170", "医疗ETF"),
            "小米": ("1810.HK", "小米集团-W"),
            "小米集团": ("1810.HK", "小米集团-W"),
            "腾讯": ("0700.HK", "腾讯控股"),
            "美团": ("3690.HK", "美团-W"),
            "阿里": ("9988.HK", "阿里巴巴-W"),
        }

        for line in lines:
            line_str = line.strip()
            name = ""
            symbol = ""
            shares = 100
            cost = 0.0

            # 1. 优先查常见标的名词表
            for k, (c, n) in COMMON_MAPPINGS.items():
                if k in line_str:
                    symbol = c
                    name = n
                    break

            # 2. 正则提取标准股票代码 (优先 A 股 6 位数字与港股 .HK)
            if not symbol:
                a_stock_match = re.search(r"(00\d{4}|30\d{4}|60\d{4}|68\d{4}|15\d{4}|51\d{4}|56\d{4}|58\d{4})", line_str)
                if a_stock_match:
                    symbol = a_stock_match.group(1)
                else:
                    hk_match = re.search(r"(\d{4,5}\.HK)", line_str, re.IGNORECASE)
                    if hk_match:
                        symbol = hk_match.group(1).upper()
                    else:
                        us_match = re.search(r"\b([A-Z]{2,5})\b", line_str)
                        if us_match:
                            cand_us = us_match.group(1)
                            if cand_us not in ["THE", "AND", "FOR", "HOLD", "COST", "BUY", "SELL", "TOTAL", "OPEN", "HIGH", "LOW", "CLOSE", "VOL", "OCR", "CSV", "PDF"]:
                                s_us = search_stock_sina(cand_us, limit=1)
                                if s_us and s_us[0]["code"].upper() == cand_us:
                                    symbol = cand_us
                                    name = s_us[0]["name"]


            # 3. 提取中文名称并校验真实性
            if not name:
                cn_matches = re.findall(r"[\u4e00-\u9fa5]{2,8}", line_str)
                for cn in cn_matches:
                    if cn not in ["持仓", "成本", "数量", "可用", "股票", "证券", "买入", "均价", "总资产", "市值", "手", "股", "份", "元", "项目", "告吹", "截图", "同步", "操作"]:
                        s_res = search_stock_sina(cn, limit=1)
                        if s_res and (cn in s_res[0]["name"] or s_res[0]["name"] in cn):
                            name = s_res[0]["name"]
                            if not symbol:
                                symbol = s_res[0]["code"]
                            break

            # 4. 若有代码但无名称，通过三方接口获取真实公司名
            if symbol and not name:
                s_res = search_stock_sina(symbol, limit=1)
                if s_res:
                    name = s_res[0]["name"]
                else:
                    # 无法查询到真实股票信息的代码予以剔除
                    symbol = ""

            # 5. 精确提取股数与成本 (先剥离股票代码，避免粘连)
            clean_line = line_str
            if symbol:
                clean_line = clean_line.replace(symbol, " ")

            unit_match = re.search(r"(\d+(?:\.\d+)?)\s*(万股|手|股|份)", clean_line)
            if unit_match:
                num = float(unit_match.group(1))
                unit = unit_match.group(2)
                if unit == "手":
                    shares = int(num * 100)
                elif unit == "万股":
                    shares = int(num * 10000)
                else:
                    shares = int(num)
            else:
                all_ints = [int(x) for x in re.findall(r"\d+", clean_line)]
                valid_shares = [x for x in all_ints if x >= 10]
                if valid_shares:
                    shares = valid_shares[0]

            cost_match = re.search(r"(?:成本|均价|买入价|价格|¥|\$)\s*[:：=]?\s*(\d+\.?\d*)", clean_line)
            if cost_match:
                cost = float(cost_match.group(1))
            else:
                dec_match = re.search(r"(\d+\.\d+)", clean_line)
                if dec_match:
                    cost = float(dec_match.group(1))
                else:
                    yuan_match = re.search(r"(\d+)\s*(?:元|块)", clean_line)
                    if yuan_match:
                        cost = float(yuan_match.group(1))

                dec_match = re.search(r"(\d+\.\d+)", line_str)
                if dec_match:
                    cost = float(dec_match.group(1))
                else:
                    yuan_match = re.search(r"(\d+)\s*(?:元|块)", line_str)
                    if yuan_match:
                        cost = float(yuan_match.group(1))

            # 严格保障：只有提取出有效合法 symbol 和真实公司 name 时才采纳
            if symbol and name and len(symbol) >= 3:
                results.append({
                    "symbol": symbol,
                    "name": name,
                    "shares": shares if shares > 0 else 100,
                    "cost_price": round(cost, 3),
                })


        return results

    def _parse_app_portfolio_screenshot(self, raw_text: str) -> List[Dict[str, Any]]:
        """东方财富/同花顺等主流手机 App 持仓截屏高精度结构化解析 (结合实时行情量化反推)"""
        # 1. 精准定位持仓表格起始点 (过滤顶部菜单与总资产汇总)
        header_patterns = ["股票/市值", "场内基金/市值", "持仓 委托成交", "持仓”委托成交", "股票名称", "证券代码"]
        start_pos = -1
        for hp in header_patterns:
            idx = raw_text.find(hp)
            if idx != -1 and (start_pos == -1 or idx < start_pos):
                start_pos = idx

        content = raw_text[start_pos:] if start_pos != -1 else raw_text
        for b_kw in ["首页", "社区", "自选", "行情", "理财", "交易"]:
            b_idx = content.find(b_kw)
            if b_idx != -1 and b_idx > 30:
                content = content[:b_idx]

        lines = [l.strip() for l in content.split("\n") if l.strip()]
        results = []

        STOP_WORDS = {"持仓", "委托成交", "分时", "股票", "市值", "场内基金", "持仓盈亏", "当日盈亏", "买入均", "买入均价", "买入", "盈亏", "股票/市值", "场内基金/市值", "可用", "总资产", "证券市值"}
        
        ETF_NAME_MAP = {
            "中证证券": ("512880", "证券ETF"),
            "证券ETF": ("512880", "证券ETF"),
            "机器人": ("562500", "机器人ETF"),
            "机器人PH": ("159278", "机器人ETF鹏华"),
            "养殖ETF": ("159865", "养殖ETF"),
            "芯片ETF": ("159995", "芯片ETF"),
            "半导体ETF": ("512480", "半导体ETF"),
            "医疗ETF": ("512170", "医疗ETF"),
        }

        i = 0
        while i < len(lines):
            line = lines[i]
            
            match_name = re.match(r"^([\u4e00-\u9fa5A-Za-z0-9]{2,10})", line)
            if not match_name:
                i += 1
                continue

            raw_name = match_name.group(1)
            if raw_name in STOP_WORDS or any(sw in raw_name for sw in ["可用", "总资产", "盈亏", "分时", "委托"]):
                i += 1
                continue

            symbol = ""
            name = ""
            
            if raw_name in ETF_NAME_MAP:
                symbol, name = ETF_NAME_MAP[raw_name]
            else:
                clean_name = re.sub(r"(PH|ETF|LOF)$", "", raw_name).strip()
                if clean_name in ETF_NAME_MAP:
                    symbol, name = ETF_NAME_MAP[clean_name]
                else:
                    s_res = search_stock_sina(clean_name if clean_name else raw_name, limit=1)
                    if s_res and s_res[0]["name"] not in ["健康160"]:
                        symbol = s_res[0]["code"]
                        name = s_res[0]["name"]

            if not symbol or not name:
                i += 1
                continue

            # 提取当前行与下一行数据
            line2 = lines[i+1] if i+1 < len(lines) else ""
            
            # 1. 尝试提取市值 (通常位于第二行首个数字，如 960.00, 4917.40, 4987.30)
            market_val = 0.0
            line2_floats = re.findall(r"(\d+(?:\.\d+)?)", line2)
            if line2_floats and float(line2_floats[0]) > 50:
                market_val = float(line2_floats[0])
            elif not line2_floats:
                line1_floats = re.findall(r"(\d+(?:\.\d+)?)", line)
                if line1_floats and float(line1_floats[0]) > 50:
                    market_val = float(line1_floats[0])

            # 2. 提取持仓盈亏额 (通常位于第一行首个负数或第二数，如 -81.00, -520.62, -503.77)
            pnl_amount = 0.0
            line1_signed = [float(x) for x in re.findall(r"[-+]?\d+(?:\.\d+)?", line)]
            for s_val in line1_signed:
                if s_val < 0:
                    pnl_amount = s_val
                    break

            # 3. 核心：通过实时现价计算整百持股数，并通过 (市值 - 盈亏) / 股数 严格数学闭环倒推买入均价
            shares = 100
            cost = 0.0
            try:
                prefix = "sh" if symbol.startswith(("60", "68", "51", "56", "58")) else "sz"
                qt_url = f"https://qt.gtimg.cn/q={prefix}{symbol}"
                qt_resp = requests.get(qt_url, timeout=2)
                if qt_resp.status_code == 200 and "~" in qt_resp.text:
                    parts = qt_resp.text.split("~")
                    if len(parts) > 3 and float(parts[3]) > 0:
                        curr_p = float(parts[3])
                        if market_val > 0:
                            shares = max(100, int(round((market_val / curr_p) / 100)) * 100)
                        
                        # 严格金融数学倒推：总成本 = 市值 - 持仓盈亏，买入均价 = 总成本 / 股数
                        if market_val > 0 and shares > 0 and pnl_amount != 0.0:
                            cost = round((market_val - pnl_amount) / shares, 3)
                        elif market_val > 0 and shares > 0:
                            cost = round(market_val / shares, 3)
            except Exception:
                pass

            if cost == 0.0 and market_val > 0 and shares > 0:
                cost = round(market_val / shares, 3)

            results.append({
                "symbol": symbol,
                "name": name,
                "shares": max(shares, 100),
                "cost_price": round(cost, 3) if cost > 0 else 0.0
            })

            i += 2

        return results





    def sync_xueqiu_cube(self, cube_symbol: str, total_capital: float = 1_000_000.0) -> List[Dict[str, Any]]:
        """通过雪球公开投资组合代码 (如 ZH123456) 获取持仓分布 (修复 Bug 8 & Bug 9)"""
        cube_symbol = cube_symbol.strip().upper()
        if not cube_symbol.startswith("ZH"):
            cube_symbol = f"ZH{cube_symbol}"

        url = f"https://xueqiu.com/cubes/rebalancing/history.json?cube_symbol={cube_symbol}&count=1&page=1"
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Referer": "https://xueqiu.com",
        }
        try:
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code != 200:
                raise ValueError(f"无法访问雪球组合 {cube_symbol}，请确认组合代码是否正确且为公开组合")
            data = resp.json()
        except Exception as e:
            raise ValueError(f"雪球组合网络请求失败: {e}")

        # 修复 Bug 8: 防御 IndexError
        cube_list = data.get("list", [])
        if not cube_list or not isinstance(cube_list, list):
            raise ValueError(f"雪球组合 {cube_symbol} 暂无持仓或调仓记录")

        holdings = cube_list[0].get("rebalancing_histories", [])
        if not holdings:
            return []

        results = []
        for h in holdings:
            sym = h.get("stock_symbol", "")
            clean_sym = sym.replace("SH", "").replace("SZ", "")
            weight = float(h.get("weight", 0.0))
            name = h.get("stock_name", sym)
            price = float(h.get("price", 10.0))
            
            # 修复 Bug 9: 根据用户账户资金联动推算持仓股数
            cap = float(total_capital or 1_000_000.0)
            target_amount = cap * (weight / 100.0)
            shares = int((target_amount / (price or 10.0)) // 100 * 100) if price > 0 else 100
            if shares < 100:
                shares = 100
                
            results.append({
                "symbol": clean_sym,
                "name": name,
                "shares": shares,
                "cost_price": price,
                "weight": weight,
            })
        return results

    def _match_column(self, columns: List[str], synonyms: List[str]) -> str:
        for c in columns:
            for s in synonyms:
                if s.lower() in c.lower():
                    return c
        return ""


class ImageParser:
    """图片持仓与交割单 OCR 智能提取引擎 (0.1s 极速高并发驱动)"""

    @staticmethod
    def extract_text_from_image(image_bytes: bytes) -> str:
        """从图片二进制流中提取文字 (带高清预处理与自适应加速)"""
        try:
            import io
            import os
            from PIL import Image, ImageEnhance, ImageOps
            
            img = Image.open(io.BytesIO(image_bytes))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

            # 1. 自适应尺寸限制 (大图等比缩放加速，小图保持原样)
            max_size = 1800
            if max(img.size) > max_size:
                ratio = max_size / max(img.size)
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img = img.resize(new_size, Image.Resampling.LANCZOS)

            # 2. 图像增强：转灰度 + 提升对比度提升字形清晰度
            gray = ImageOps.grayscale(img)
            enhancer = ImageEnhance.Contrast(gray)
            enhanced_img = enhancer.enhance(1.8)
            
            # 3. 极速 Tesseract 识别
            try:
                import pytesseract
                for t_path in ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "/usr/bin/tesseract"]:
                    if os.path.exists(t_path):
                        pytesseract.pytesseract.tesseract_cmd = t_path
                        break
                
                # 优先增强图识别
                text = pytesseract.image_to_string(enhanced_img, lang="chi_sim+eng")
                if not text or len(text.strip()) < 2:
                    # 备用原图识别
                    text = pytesseract.image_to_string(img, lang="chi_sim+eng")
                
                if text and len(text.strip()) > 2:
                    return text.strip()
            except Exception as ocr_err:
                print(f"[OCR] 识别异常: {ocr_err}")

            return ""
        except Exception as e:
            print(f"[OCR] 图像预处理异常: {e}")
            return ""



    @staticmethod
    def parse_holding_text(raw_text: str) -> List[Dict[str, Any]]:
        """从 OCR 文本中解析持仓条目"""
        if not raw_text or not raw_text.strip():
            return []
        return broker_importer.parse_free_text(raw_text)



# 全局单例
broker_importer = BrokerImporter()
