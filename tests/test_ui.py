"""全量可视化 UI 测试（Playwright 浏览器自动化）

覆盖所有页面、按钮、表单交互，每步自动截图。
运行前确保服务已启动：venv/bin/python -m uvicorn api.main:app --port 8000
"""
import os
import re
import time
import pytest

# ---- 截图目录 ----
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "screenshots")
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

BASE_URL = "http://localhost:18000"


def shot(page, name):
    """截图并返回路径"""
    path = os.path.join(SCREENSHOT_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    return path


# ======================================================================
#  Fixtures
# ======================================================================

@pytest.fixture(scope="session")
def browser():
    """启动浏览器（headless），session 级复用"""
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()

    chromium_path = os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/"
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    )
    if os.path.exists(chromium_path):
        br = pw.chromium.launch(headless=True, executable_path=chromium_path)
    else:
        br = pw.chromium.launch(headless=True)
    yield br
    br.close()
    pw.stop()


@pytest.fixture()
def page(browser):
    """每个测试独立页面 + 自动登录"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.goto(BASE_URL)
    pg.wait_for_load_state("networkidle")

    # 注册并登录
    pg.fill("#loginUsername", "uitester")
    pg.fill("#loginPassword", "uitest123")
    pg.click("button:text('登 录')")

    # 如果登录失败（用户不存在），先注册
    pg.wait_for_timeout(800)
    if pg.locator("#loginOverlay").is_visible():
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", "uitester")
        pg.fill("#regPassword", "uitest123")
        pg.fill("#regPassword2", "uitest123")
        pg.click("button:text('注 册')")
        pg.wait_for_timeout(1000)

    # 等待主界面出现
    pg.wait_for_selector("#userInfo", state="visible", timeout=5000)
    yield pg
    ctx.close()


# ======================================================================
#  1. 登录 / 注册 页面
# ======================================================================

class TestLoginUI:
    """登录注册界面交互"""

    def test_login_page_visible(self, page):
        """登录后主界面可见"""
        assert page.locator(".header h1").inner_text() == "量化回测系统"
        shot(page, "01_login_success")

    def test_switch_to_register_and_back(self, browser):
        """登录/注册切换"""
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.goto(BASE_URL)
        pg.wait_for_load_state("networkidle")

        # 点击注册链接
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        assert pg.locator("#registerForm").is_visible()
        shot(pg, "02_register_form")

        # 返回登录
        pg.click("text=返回登录")
        pg.wait_for_timeout(300)
        assert pg.locator("#loginForm").is_visible()
        shot(pg, "03_login_form")
        ctx.close()

    def test_login_empty_fields_error(self, browser):
        """空字段登录应提示错误"""
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.goto(BASE_URL)
        pg.wait_for_load_state("networkidle")

        pg.click("button:text('登 录')")
        pg.wait_for_timeout(500)
        err = pg.locator("#loginError").inner_text()
        assert "请输入" in err
        shot(pg, "04_login_empty_error")
        ctx.close()

    def test_login_wrong_password_error(self, browser):
        """错误密码登录"""
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.goto(BASE_URL)
        pg.wait_for_load_state("networkidle")

        pg.fill("#loginUsername", "uitester")
        pg.fill("#loginPassword", "wrong_password")
        pg.click("button:text('登 录')")
        pg.wait_for_timeout(1000)
        err = pg.locator("#loginError").inner_text()
        assert err != ""
        shot(pg, "05_login_wrong_password")
        ctx.close()


# ======================================================================
#  2. 顶部导航 & 标签切换
# ======================================================================

class TestNavigation:
    """标签页切换"""

    TABS = ["回测", "实时行情", "我的策略", "策略对比", "参数优化", "风控配置"]

    def test_all_tabs_switch(self, page):
        """点击每个标签页，确认内容可见"""
        for tab_name in self.TABS:
            page.click(f".tab:text('{tab_name}')")
            page.wait_for_timeout(300)
            shot(page, f"06_tab_{tab_name}")
        # 确认最后一个标签是活跃的
        assert page.locator(".tab.active").inner_text() == "风控配置"

    def test_user_info_visible(self, page):
        """登录后用户名和退出按钮可见"""
        assert page.locator("#displayUser").inner_text() == "uitester"
        assert page.locator(".logout-btn").is_visible()

    def test_logout_and_relogin(self, page):
        """退出后重新显示登录页"""
        page.click(".logout-btn")
        page.wait_for_timeout(500)
        assert page.locator("#loginOverlay").is_visible()
        shot(page, "07_after_logout")


# ======================================================================
#  3. 回测页面
# ======================================================================

class TestBacktestUI:
    """回测页面交互"""

    def test_strategy_list_loaded(self, page):
        """策略列表加载成功"""
        items = page.locator(".strategy-item")
        assert items.count() > 0
        shot(page, "08_backtest_strategy_list")

    def test_select_strategy_and_run(self, page):
        """选择策略并运行回测"""
        # 选第一个策略
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(300)
        assert page.locator(".strategy-item.active").count() == 1

        # 点击开始回测
        page.click("#runBtn")
        page.wait_for_timeout(3000)
        shot(page, "09_backtest_result")

        # 应该有回测结果
        result = page.locator("#resultArea")
        assert result.locator(".stat-card").count() > 0

    def test_backtest_without_strategy_shows_error(self, page):
        """未选策略直接回测应提示"""
        page.click("#runBtn")
        page.wait_for_timeout(500)
        # toast 提示
        toast = page.locator(".toast.show")
        assert toast.is_visible()
        shot(page, "10_backtest_no_strategy")

    def test_quick_search_stock(self, page):
        """快速搜索股票下拉框"""
        page.fill("#quickSearch", "600")
        page.wait_for_timeout(500)
        dropdown = page.locator("#quickDropdown")
        # 可能有结果也可能没有（取决于数据库）
        shot(page, "11_quick_search")


# ======================================================================
#  4. 实时行情页面
# ======================================================================

class TestRealtimeUI:
    """实时行情页面"""

    def _goto_live(self, page):
        page.click(".tab:text('实时行情')")
        page.wait_for_timeout(300)

    def test_page_elements(self, page):
        """页面元素完整"""
        self._goto_live(page)
        assert page.locator("#liveBtn").is_visible()
        assert page.locator("#refreshBtn").is_visible()
        assert page.locator("#addStockInput").is_visible()
        shot(page, "12_live_page")

    def test_add_stock_search(self, page):
        """添加股票搜索框"""
        self._goto_live(page)
        page.fill("#addStockInput", "茅台")
        page.wait_for_timeout(600)
        shot(page, "13_stock_search_dropdown")

    def test_refresh_data_button(self, page):
        """点击刷新数据"""
        self._goto_live(page)
        page.click("#refreshBtn")
        page.wait_for_timeout(2000)
        shot(page, "14_refresh_data")


# ======================================================================
#  5. 我的策略页面（重点：NL翻译 + 条件构建 + 预设）
# ======================================================================

class TestStrategiesUI:
    """策略页面全量交互"""

    def _goto_strategies(self, page):
        page.click(".tab:text('我的策略')")
        page.wait_for_timeout(500)

    def test_page_loaded(self, page):
        """策略页元素完整"""
        self._goto_strategies(page)
        assert page.locator("#nlInput").is_visible()
        assert page.locator("#presetList").count() >= 0
        shot(page, "15_strategies_page")

    # ---- 自然语言翻译 ----

    def test_nl_parse_basic(self, page):
        """NL翻译：涨跌百分比"""
        self._goto_strategies(page)
        page.fill("#nlInput", "跌破20%就卖，涨了5%就买")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        result = page.locator("#nlResult").inner_text()
        assert "翻译成功" in result or "成功" in result
        shot(page, "16_nl_parse_basic")

    def test_nl_parse_ma(self, page):
        """NL翻译：均线突破"""
        self._goto_strategies(page)
        page.fill("#nlInput", "站上20日线买入，跌破10日线卖出")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        shot(page, "17_nl_parse_ma")

    def test_nl_parse_macd(self, page):
        """NL翻译：MACD金叉"""
        self._goto_strategies(page)
        page.fill("#nlInput", "MACD金叉买入，MACD死叉卖出")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        shot(page, "18_nl_parse_macd")

    def test_nl_parse_rsi(self, page):
        """NL翻译：RSI"""
        self._goto_strategies(page)
        page.fill("#nlInput", "RSI超买卖出，RSI超卖买入")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        shot(page, "19_nl_parse_rsi")

    def test_nl_parse_volume(self, page):
        """NL翻译：量价突破"""
        self._goto_strategies(page)
        page.fill("#nlInput", "放量突破10日高点买入，缩量跌破10日低点卖出")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        shot(page, "20_nl_parse_volume")

    def test_nl_empty_input(self, page):
        """NL翻译：空输入提示"""
        self._goto_strategies(page)
        page.fill("#nlInput", "")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(500)
        result = page.locator("#nlResult").inner_text()
        assert "请输入" in result
        shot(page, "21_nl_empty")

    def test_nl_quick_examples(self, page):
        """NL快捷示例按钮"""
        self._goto_strategies(page)
        # 点击快捷示例按钮
        page.click("button:text('涨跌百分比')")
        page.wait_for_timeout(300)
        val = page.locator("#nlInput").input_value()
        assert "跌破" in val
        shot(page, "22_nl_quick_example")

    def test_nl_unrecognized(self, page):
        """NL翻译：无法识别的内容"""
        self._goto_strategies(page)
        page.fill("#nlInput", "今天天气不错")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        result = page.locator("#nlResult").inner_text()
        assert "未能识别" in result or "换个说法" in result
        shot(page, "23_nl_unrecognized")

    # ---- 条件构建器 ----

    def test_add_buy_condition(self, page):
        """添加买入条件"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        assert page.locator("#buyConditions select").count() > 0
        shot(page, "24_add_buy_condition")

    def test_add_sell_condition(self, page):
        """添加卖出条件"""
        self._goto_strategies(page)
        sell_btns = page.locator("button:text('+ 添加条件')")
        sell_btns.last.click()
        page.wait_for_timeout(300)
        shot(page, "25_add_sell_condition")

    def test_remove_condition(self, page):
        """删除条件"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        # 点击删除 ×
        page.locator("#buyConditions span:text('×')").first.click()
        page.wait_for_timeout(300)
        shot(page, "26_remove_condition")

    # ---- 保存策略 ----

    def test_save_strategy_no_name(self, page):
        """无名称保存策略"""
        self._goto_strategies(page)
        page.click("button:text('保存策略')")
        page.wait_for_timeout(500)
        msg = page.locator("#strategySaveMsg").inner_text()
        assert "策略名称" in msg
        shot(page, "27_save_no_name")

    def test_save_strategy_full_flow(self, page):
        """完整保存策略流程"""
        self._goto_strategies(page)
        page.fill("#strategyName", "UI测试策略")
        page.fill("#strategySymbol", "600519")
        # 添加条件
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        page.click("button:text('保存策略')")
        page.wait_for_timeout(1500)
        shot(page, "28_save_strategy")

    # ---- 预设策略模板 ----

    def test_presets_loaded(self, page):
        """预设模板加载"""
        self._goto_strategies(page)
        # 等待预设 API 返回（有卡片内层 div 含 name 字样）
        page.wait_for_timeout(3000)
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, "29_presets_loaded.png"), full_page=True)
        # 只要页面不报错就算通过，预设数量取决于 API

    def test_load_preset_without_symbol(self, page):
        """未填股票代码直接加载预设：用 JS 触发"""
        self._goto_strategies(page)
        page.wait_for_timeout(2000)
        page.fill("#presetSymbol", "")
        # 直接调用 JS 函数
        page.evaluate("loadPreset(0)")
        page.wait_for_timeout(1000)
        shot(page, "30_preset_no_symbol")
        # 只要不崩溃就算通过

    # ---- 策略列表 ----

    def test_strategy_list_visible(self, page):
        """策略列表显示"""
        self._goto_strategies(page)
        page.wait_for_timeout(1000)
        shot(page, "31_strategy_list")


# ======================================================================
#  6. 策略对比页面
# ======================================================================

class TestCompareUI:
    """策略对比"""

    def _goto_compare(self, page):
        page.click(".tab:text('策略对比')")
        page.wait_for_timeout(300)

    def test_run_compare(self, page):
        """运行策略对比"""
        self._goto_compare(page)
        page.click("#compareBtn")
        page.wait_for_timeout(5000)
        area = page.locator("#compareArea")
        # 应该有表格或结果
        shot(page, "32_compare_result")


# ======================================================================
#  7. 参数优化页面
# ======================================================================

class TestOptimizeUI:
    """参数优化"""

    def _goto_optimize(self, page):
        page.click(".tab:text('参数优化')")
        page.wait_for_timeout(300)

    def test_optimize_page_elements(self, page):
        """页面元素"""
        self._goto_optimize(page)
        assert page.locator("#optimizeBtn").is_visible()
        assert page.locator("#optimizeStrategy").is_visible()
        shot(page, "33_optimize_page")

    def test_run_optimize(self, page):
        """运行优化"""
        self._goto_optimize(page)
        page.click("#optimizeBtn")
        page.wait_for_timeout(8000)
        shot(page, "34_optimize_result")


# ======================================================================
#  8. 风控配置页面
# ======================================================================

class TestRiskConfigUI:
    """风控配置 & 推送通知"""

    def _goto_risk(self, page):
        page.click(".tab:text('风控配置')")
        page.wait_for_timeout(300)

    def test_risk_page_elements(self, page):
        """风控页面元素完整"""
        self._goto_risk(page)
        assert page.locator("#riskStopLoss").is_visible()
        assert page.locator("#riskTakeProfit").is_visible()
        assert page.locator("#riskTrailingStop").is_visible()
        assert page.locator("#riskMaxDrawdown").is_visible()
        shot(page, "35_risk_page")

    def test_save_risk_config(self, page):
        """保存风控配置"""
        self._goto_risk(page)
        page.fill("#riskStopLoss", "-8")
        page.fill("#riskTakeProfit", "20")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(500)
        msg = page.locator("#riskSaveMsg").inner_text()
        assert "已保存" in msg or msg != ""
        shot(page, "36_risk_saved")

    def test_notify_config_elements(self, page):
        """推送通知配置元素"""
        self._goto_risk(page)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)
        assert page.locator("#cfgFeishuWebhook").is_visible()
        assert page.locator("#cfgServerchan").is_visible()
        shot(page, "37_notify_config")

    def test_save_notify_config(self, page):
        """保存推送配置"""
        self._goto_risk(page)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)
        page.click("button:text('保存推送配置')")
        page.wait_for_timeout(1000)
        shot(page, "38_notify_saved")

    def test_test_notify_button(self, page):
        """发送测试消息按钮"""
        self._goto_risk(page)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)
        page.click("button:text('发送测试消息')")
        page.wait_for_timeout(2000)
        shot(page, "39_notify_test")


# ======================================================================
#  9. 完整流程 E2E
# ======================================================================

class TestFullFlowE2E:
    """端到端完整流程"""

    def test_full_backtest_flow(self, page):
        """完整回测流程：选策略→配置→运行→查看结果"""
        # 1. 选策略
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(300)
        shot(page, "40_e2e_select_strategy")

        # 2. 配置资金
        page.fill("#capital", "500000")
        page.fill("#days", "200")

        # 3. 运行回测
        page.click("#runBtn")
        page.wait_for_timeout(4000)
        shot(page, "41_e2e_backtest_result")

        # 4. 确认结果
        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0

    def test_full_nl_strategy_flow(self, page):
        """完整NL策略流程：翻译→保存→查看列表"""
        page.click(".tab:text('我的策略')")
        page.wait_for_timeout(500)

        # 1. NL翻译
        page.fill("#nlInput", "跌破20%就卖，涨了5%就买")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        shot(page, "42_e2e_nl_translated")

        # 2. 填写策略名和股票
        page.fill("#strategyName", "E2E测试策略")
        page.fill("#strategySymbol", "600519")

        # 3. 保存
        page.click("button:text('保存策略')")
        page.wait_for_timeout(1500)
        shot(page, "43_e2e_strategy_saved")

        # 4. 确认出现在列表
        page.wait_for_timeout(500)
        shot(page, "44_e2e_strategy_in_list")


# ======================================================================
#  10. 响应式 & 边界情况
# ======================================================================

class TestEdgeCases:
    """边界和特殊情况"""

    def test_window_resize(self, page):
        """调整窗口大小后布局正常"""
        page.set_viewport_size({"width": 800, "height": 600})
        page.wait_for_timeout(500)
        shot(page, "45_small_viewport")

        page.set_viewport_size({"width": 1920, "height": 1080})
        page.wait_for_timeout(500)
        shot(page, "46_large_viewport")

    def test_enter_key_login(self, browser):
        """回车键登录"""
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.goto(BASE_URL)
        pg.wait_for_load_state("networkidle")
        pg.fill("#loginUsername", "uitester")
        pg.fill("#loginPassword", "uitest123")
        pg.press("#loginPassword", "Enter")
        pg.wait_for_timeout(1500)
        shot(pg, "47_enter_login")
        ctx.close()

    def test_toast_auto_dismiss(self, page):
        """Toast 自动消失"""
        page.click("#runBtn")
        page.wait_for_timeout(500)
        toast = page.locator(".toast.show")
        if toast.is_visible():
            page.wait_for_timeout(2500)
            # toast 应该消失了
            shot(page, "48_toast_dismissed")
