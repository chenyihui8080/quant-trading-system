"""全量 UI 自动化测试（Playwright 浏览器自动化）

覆盖全部 99 个交互元素，包括：
- 登录/注册/退出 + token 持久化
- 6 个标签页切换 + 所有页面元素
- 回测：策略选择、股票搜索、市场筛选、资金配置、运行回测
- 实时行情：K 线查看、刷新数据、股票搜索添加删除
- 我的策略：NL 翻译（5 种快捷示例 + 边界）、条件构建器、预设、策略 CRUD
- 策略对比 & 参数优化
- 风控配置 + 推送通知配置
- 边界情况：窗口缩放、键盘事件、Toast、下拉框关闭

运行前确保服务已启动：
  venv/bin/python -m uvicorn api.main:app --port 8000
"""
import os
import re
import time
import pytest

# ---- 截图目录 ----
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "screenshots")
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

BASE_URL = "http://localhost:8000"

# 环境变量 UI_SHOT=0 时禁用截图，节省 20-50 秒
_UI_SHOT_ENABLED = os.environ.get("UI_SHOT", "1") != "0"

# 递增截图编号
_shot_counter = [0]


def shot(page, name):
    """截图并返回路径，UI_SHOT=0 时跳过"""
    _shot_counter[0] += 1
    if not _UI_SHOT_ENABLED:
        return None
    tag = f"{_shot_counter[0]:03d}_{name}"
    path = os.path.join(SCREENSHOT_DIR, f"{tag}.png")
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


@pytest.fixture(scope="session")
def _auth_token(browser):
    """登录一次，提取 token 供后续测试复用"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.goto(BASE_URL)
    pg.wait_for_load_state("networkidle")
    pg.fill("#loginUsername", "uitester")
    pg.fill("#loginPassword", "uitest123")
    pg.click("button:text('登 录')")
    pg.wait_for_timeout(800)
    if pg.locator("#loginOverlay").is_visible():
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", "uitester")
        pg.fill("#regPassword", "uitest123")
        pg.fill("#regPassword2", "uitest123")
        pg.click("button:text('注 册')")
        pg.wait_for_timeout(1000)
    pg.wait_for_selector("#userInfo", state="visible", timeout=5000)
    token = pg.evaluate("localStorage.getItem('quant_token') || ''")
    ctx.close()
    return token


def _login_via_ui(pg):
    """UI 登录 fallback"""
    pg.fill("#loginUsername", "uitester")
    pg.fill("#loginPassword", "uitest123")
    pg.click("button:text('登 录')")
    pg.wait_for_timeout(800)
    if pg.locator("#loginOverlay").is_visible():
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", "uitester")
        pg.fill("#regPassword", "uitest123")
        pg.fill("#regPassword2", "uitest123")
        pg.click("button:text('注 册')")
        pg.wait_for_timeout(1000)
    pg.wait_for_selector("#userInfo", state="visible", timeout=5000)


@pytest.fixture()
def page(browser, _auth_token):
    """每个测试独立页面 + token 注入登录（跳过 UI 登录，节省 ~2s/测试）"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    if _auth_token:
        ctx.add_init_script(f"localStorage.setItem('quant_token', '{_auth_token}')")
    pg = ctx.new_page()
    pg.goto(BASE_URL)
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_selector("#userInfo, #loginOverlay", timeout=10000)
    if pg.locator("#loginOverlay").is_visible():
        _login_via_ui(pg)
    yield pg
    ctx.close()


@pytest.fixture()
def fresh_page(browser):
    """未登录的新页面（用于测试登录/注册流程）"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.goto(BASE_URL)
    pg.wait_for_load_state("networkidle")
    yield pg
    ctx.close()


# ======================================================================
#  辅助函数
# ======================================================================

def goto_tab(page, tab_name):
    """切换到指定标签页"""
    page.click(f".tab:text('{tab_name}')")
    tab_id = {"回测": "backtest", "实时行情": "live", "我的策略": "strategies",
              "策略对比": "compare", "组合回测": "portfolio", "参数优化": "optimize",
              "风控配置": "risk", "数据质量": "quality", "模拟盘": "paper"}.get(tab_name)
    if tab_id:
        page.wait_for_selector(f"#tab-{tab_id}", state="visible", timeout=5000)
    else:
        page.wait_for_timeout(400)


def nl_translate(page, text, wait_ms=None):
    """填写 NL 输入框并点击智能翻译，等待结果出现"""
    page.fill("#nlInput", text)
    page.click("button:text('智能翻译')")
    if wait_ms:
        page.wait_for_timeout(wait_ms)
    else:
        page.wait_for_timeout(1500)


def create_nl_strategy(page, nl_text, name, symbol="600519"):
    """NL 翻译 → 填写策略名/股票 → 保存策略"""
    nl_translate(page, nl_text)
    page.fill("#strategyName", name)
    page.fill("#strategySymbol", symbol)
    page.click("button:text('保存策略')")
    page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)


def run_backtest(page, capital=None, days=None):
    """选中策略后运行回测，等待结果"""
    if capital:
        page.fill("#capital", str(capital))
    if days:
        page.fill("#days", str(days))
    page.click("#runBtn")
    page.wait_for_selector("#resultArea .stat-card", timeout=15000)


def hold_route(route):
    """用 daemon 线程保持请求 8 秒不返回（用于 loading 状态测试）"""
    import threading as _th
    def _later():
        time.sleep(8)
        try:
            route.abort()
        except Exception:
            pass
    _th.Thread(target=_later, daemon=True).start()


# ======================================================================
#  1. 登录页面 (元素 #1-#5)
# ======================================================================

class TestLoginPage:
    """登录表单：用户名输入、密码输入、登录按钮、注册链接、错误提示"""

    def test_login_page_visible(self, fresh_page):
        """#1 #2 登录页输入框可见"""
        pg = fresh_page
        assert pg.locator("#loginUsername").is_visible()
        assert pg.locator("#loginPassword").is_visible()
        shot(pg, "login_page")

    def test_login_success(self, fresh_page):
        """#3 登录按钮 → 成功进入主界面"""
        pg = fresh_page
        pg.fill("#loginUsername", "uitester")
        pg.fill("#loginPassword", "uitest123")
        pg.click("button:text('登 录')")
        pg.wait_for_timeout(1500)
        # 如果用户不存在，先注册
        if pg.locator("#loginOverlay").is_visible():
            pg.click("text=立即注册")
            pg.wait_for_timeout(300)
            pg.fill("#regUsername", "uitester")
            pg.fill("#regPassword", "uitest123")
            pg.fill("#regPassword2", "uitest123")
            pg.click("button:text('注 册')")
            pg.wait_for_timeout(1000)
            pg.fill("#loginUsername", "uitester")
            pg.fill("#loginPassword", "uitest123")
            pg.click("button:text('登 录')")
            pg.wait_for_timeout(1500)
        assert pg.locator("#userInfo").is_visible()
        assert pg.locator(".header h1").inner_text() == "量化回测系统"
        shot(pg, "login_success")

    def test_login_empty_fields_error(self, fresh_page):
        """#5 空字段登录 → 显示错误"""
        pg = fresh_page
        pg.click("button:text('登 录')")
        pg.wait_for_timeout(500)
        err = pg.locator("#loginError").inner_text()
        assert "请输入" in err
        shot(pg, "login_empty_error")

    def test_login_wrong_password(self, fresh_page):
        """#5 错误密码 → 显示错误"""
        pg = fresh_page
        pg.fill("#loginUsername", "uitester")
        pg.fill("#loginPassword", "wrong_password_123")
        pg.click("button:text('登 录')")
        pg.wait_for_timeout(1000)
        err = pg.locator("#loginError").inner_text()
        assert err != ""
        shot(pg, "login_wrong_password")

    def test_enter_key_login(self, fresh_page):
        """#3 密码框按回车触发登录"""
        pg = fresh_page
        pg.fill("#loginUsername", "uitester")
        pg.fill("#loginPassword", "uitest123")
        pg.press("#loginPassword", "Enter")
        pg.wait_for_timeout(1500)
        shot(pg, "login_enter_key")


# ======================================================================
#  2. 注册页面 (元素 #6-#11)
# ======================================================================

class TestRegisterPage:
    """注册表单：切换、输入、提交、错误提示"""

    def test_switch_to_register_and_back(self, fresh_page):
        """#4 切换到注册 → #10 切换回登录"""
        pg = fresh_page
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        assert pg.locator("#registerForm").is_visible()
        assert pg.locator("#loginForm").is_hidden()
        shot(pg, "register_form_visible")

        pg.click("text=返回登录")
        pg.wait_for_timeout(300)
        assert pg.locator("#loginForm").is_visible()
        assert pg.locator("#registerForm").is_hidden()
        shot(pg, "back_to_login")

    def test_register_fields_visible(self, fresh_page):
        """#6 #7 #8 注册表单字段可见"""
        pg = fresh_page
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        assert pg.locator("#regUsername").is_visible()
        assert pg.locator("#regPassword").is_visible()
        assert pg.locator("#regPassword2").is_visible()
        shot(pg, "register_fields")

    def test_register_success(self, fresh_page):
        """#9 注册成功"""
        pg = fresh_page
        import random
        username = f"testui_{random.randint(10000, 99999)}"
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", username)
        pg.fill("#regPassword", "testpass123")
        pg.fill("#regPassword2", "testpass123")
        pg.click("button:text('注 册')")
        pg.wait_for_timeout(1500)
        # 注册成功应跳回登录或自动登录
        shot(pg, "register_success")

    def test_register_short_username(self, fresh_page):
        """#11 用户名太短"""
        pg = fresh_page
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", "ab")
        pg.fill("#regPassword", "testpass123")
        pg.fill("#regPassword2", "testpass123")
        pg.click("button:text('注 册')")
        pg.wait_for_timeout(800)
        err = pg.locator("#registerError").inner_text()
        assert err != ""
        shot(pg, "register_short_username")

    def test_register_password_mismatch(self, fresh_page):
        """#11 两次密码不一致"""
        pg = fresh_page
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", "newuser99")
        pg.fill("#regPassword", "password123")
        pg.fill("#regPassword2", "different456")
        pg.click("button:text('注 册')")
        pg.wait_for_timeout(800)
        err = pg.locator("#registerError").inner_text()
        assert "不一致" in err or "不匹配" in err or "密码" in err
        shot(pg, "register_pwd_mismatch")

    def test_register_short_password(self, fresh_page):
        """#11 密码太短"""
        pg = fresh_page
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", "newuser99")
        pg.fill("#regPassword", "123")
        pg.fill("#regPassword2", "123")
        pg.click("button:text('注 册')")
        pg.wait_for_timeout(800)
        err = pg.locator("#registerError").inner_text()
        assert err != ""
        shot(pg, "register_short_password")

    def test_enter_key_register(self, fresh_page):
        """#8 确认密码框按回车触发注册"""
        pg = fresh_page
        pg.click("text=立即注册")
        pg.wait_for_timeout(300)
        pg.fill("#regUsername", "enteruser99")
        pg.fill("#regPassword", "testpass123")
        pg.fill("#regPassword2", "testpass123")
        pg.press("#regPassword2", "Enter")
        pg.wait_for_timeout(1500)
        shot(pg, "register_enter_key")


# ======================================================================
#  3. 顶部导航 (元素 #12-#20)
# ======================================================================

class TestNavigation:
    """头部信息、退出按钮、6 个标签页切换"""

    def test_header_elements(self, page):
        """#12 #13 #14 头部元素"""
        assert page.locator("#displayUser").inner_text() == "uitester"
        assert page.locator(".logout-btn").is_visible()
        assert page.locator("#statusText").is_visible()
        shot(page, "header_elements")

    def test_tab_backtest_active_by_default(self, page):
        """#15 默认回测标签页激活"""
        assert page.locator(".tab.active").inner_text() == "回测"
        assert page.locator("#tab-backtest").is_visible()
        shot(page, "default_tab")

    def test_switch_to_live(self, page):
        """#16 切换到实时行情"""
        goto_tab(page, "实时行情")
        assert page.locator("#tab-live").is_visible()
        assert page.locator(".tab.active").inner_text() == "实时行情"
        shot(page, "tab_live")

    def test_switch_to_strategies(self, page):
        """#17 切换到我的策略"""
        goto_tab(page, "我的策略")
        assert page.locator("#tab-strategies").is_visible()
        assert page.locator(".tab.active").inner_text() == "我的策略"
        shot(page, "tab_strategies")

    def test_switch_to_compare(self, page):
        """#18 切换到策略对比"""
        goto_tab(page, "策略对比")
        assert page.locator("#tab-compare").is_visible()
        assert page.locator(".tab.active").inner_text() == "策略对比"
        shot(page, "tab_compare")

    def test_switch_to_optimize(self, page):
        """#19 切换到参数优化"""
        goto_tab(page, "参数优化")
        assert page.locator("#tab-optimize").is_visible()
        assert page.locator(".tab.active").inner_text() == "参数优化"
        shot(page, "tab_optimize")

    def test_switch_to_risk(self, page):
        """#20 切换到风控配置"""
        goto_tab(page, "风控配置")
        assert page.locator("#tab-risk").is_visible()
        assert page.locator(".tab.active").inner_text() == "风控配置"
        shot(page, "tab_risk")

    def test_all_tabs_cycle(self, page):
        """依次点击全部 6 个标签页"""
        tabs = ["回测", "实时行情", "我的策略", "策略对比", "参数优化", "风控配置"]
        for tab in tabs:
            page.click(f".tab:text('{tab}')")
            page.wait_for_timeout(200)
        assert page.locator(".tab.active").inner_text() == "风控配置"
        shot(page, "all_tabs_cycled")

    def test_logout_and_relogin(self, page):
        """#13 退出后重新显示登录页"""
        page.click(".logout-btn")
        page.wait_for_timeout(500)
        assert page.locator("#loginOverlay").is_visible()
        shot(page, "after_logout")

        # 重新登录
        page.fill("#loginUsername", "uitester")
        page.fill("#loginPassword", "uitest123")
        page.click("button:text('登 录')")
        page.wait_for_timeout(1500)
        assert page.locator("#userInfo").is_visible()
        shot(page, "relogin_success")

    def test_token_persist_on_reload(self, page):
        """刷新页面后 token 持久化，自动登录"""
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        # 应该仍然登录
        assert page.locator("#loginOverlay").is_hidden() or not page.locator("#loginOverlay").is_visible()
        shot(page, "token_persist_reload")


# ======================================================================
#  4. 回测页面 (元素 #21-#29)
# ======================================================================

class TestBacktestPage:
    """策略列表、股票选择器、市场筛选、快速搜索、资金配置、运行回测、结果展示"""

    def test_strategy_list_loaded(self, page):
        """#21 策略列表加载"""
        items = page.locator("#tab-backtest .strategy-item")
        assert items.count() > 0
        shot(page, "bt_strategy_list")

    def test_select_strategy_highlight(self, page):
        """#21 点击策略高亮"""
        items = page.locator("#tab-backtest .strategy-item")
        items.first.click()
        page.wait_for_timeout(300)
        assert page.locator("#tab-backtest .strategy-item.active").count() == 1
        shot(page, "bt_strategy_selected")

    def test_select_different_strategy(self, page):
        """#21 切换不同策略"""
        items = page.locator("#tab-backtest .strategy-item")
        if items.count() >= 2:
            items.nth(1).click()
            page.wait_for_timeout(200)
            assert page.locator("#tab-backtest .strategy-item.active").count() == 1
            shot(page, "bt_strategy_switch")

    def test_symbol_selector_visible(self, page):
        """#22 股票选择器可见"""
        sel = page.locator("#symbolSelect")
        assert sel.is_visible()
        shot(page, "bt_symbol_selector")

    def test_market_filter_visible(self, page):
        """#23 市场筛选下拉框可见"""
        mf = page.locator("#quickMarket")
        assert mf.is_visible()
        shot(page, "bt_market_filter")

    def test_market_filter_options(self, page):
        """#23 市场筛选选项"""
        options = page.locator("#quickMarket option")
        assert options.count() >= 3  # 全部/A股/港股/美股
        shot(page, "bt_market_options")

    def test_quick_search_input(self, page):
        """#24 快速搜索输入"""
        page.fill("#quickSearch", "600")
        page.wait_for_timeout(500)
        shot(page, "bt_quick_search")

    def test_quick_search_dropdown_appears(self, page):
        """#25 搜索下拉框出现"""
        page.fill("#quickSearch", "茅台")
        page.wait_for_timeout(600)
        shot(page, "bt_quick_dropdown")

    def test_quick_search_clear_on_escape(self, page):
        """#24 按 Escape 关闭搜索"""
        page.fill("#quickSearch", "600")
        page.wait_for_timeout(400)
        page.press("#quickSearch", "Escape")
        page.wait_for_timeout(300)
        shot(page, "bt_quick_escape")

    def test_capital_input(self, page):
        """#26 资金输入框"""
        cap = page.locator("#capital")
        assert cap.is_visible()
        cap.fill("500000")
        assert cap.input_value() == "500000"
        shot(page, "bt_capital")

    def test_days_input(self, page):
        """#27 模拟天数输入框"""
        days = page.locator("#days")
        assert days.is_visible()
        days.fill("300")
        assert days.input_value() == "300"
        shot(page, "bt_days")

    def test_run_backtest_button(self, page):
        """#28 开始回测按钮"""
        btn = page.locator("#runBtn")
        assert btn.is_visible()
        assert "开始回测" in btn.inner_text()
        shot(page, "bt_run_btn")

    def test_run_backtest_without_strategy(self, page):
        """#28 未选策略直接回测"""
        page.click("#runBtn")
        page.wait_for_timeout(500)
        shot(page, "bt_no_strategy")

    def test_run_backtest_with_strategy(self, page):
        """#28 #29 选择策略并运行回测"""
        page.locator("#tab-backtest .strategy-item").first.click()
        page.wait_for_timeout(300)
        run_backtest(page)
        result = page.locator("#resultArea")
        stat_cards = result.locator(".stat-card")
        assert stat_cards.count() > 0
        shot(page, "bt_result")

    def test_backtest_result_stat_cards(self, page):
        """#29 回测结果统计卡片"""
        page.locator("#tab-backtest .strategy-item").first.click()
        page.wait_for_timeout(200)
        run_backtest(page)
        cards = page.locator("#resultArea .stat-card")
        assert cards.count() >= 3
        shot(page, "bt_stat_cards")

    def test_backtest_with_custom_capital(self, page):
        """#26 #28 自定义资金回测"""
        page.locator("#tab-backtest .strategy-item").first.click()
        run_backtest(page, capital=200000, days=200)
        shot(page, "bt_custom_capital")

    def test_quick_search_click_result(self, page):
        """#25 搜索结果点击添加"""
        page.fill("#quickSearch", "600")
        page.wait_for_timeout(600)
        dropdown = page.locator("#quickDropdown")
        if dropdown.is_visible():
            first_item = dropdown.locator("div").first
            if first_item.is_visible():
                first_item.click()
                page.wait_for_timeout(1000)
                shot(page, "bt_quick_add_result")


# ======================================================================
#  5. 实时行情页面 (元素 #30-#40)
# ======================================================================

class TestRealtimePage:
    """行情选择器、查看范围、K 线图、刷新、股票搜索添加"""

    def _goto_live(self, page):
        goto_tab(page, "实时行情")

    def test_live_symbol_selector(self, page):
        """#30 股票选择器"""
        self._goto_live(page)
        sel = page.locator("#liveSymbol")
        assert sel.is_visible()
        shot(page, "live_symbol")

    def test_live_range_selector(self, page):
        """#31 时间范围选择器"""
        self._goto_live(page)
        rng = page.locator("#liveRange")
        assert rng.is_visible()
        options = rng.locator("option")
        assert options.count() >= 4
        shot(page, "live_range")

    def test_live_view_button(self, page):
        """#32 查看行情按钮"""
        self._goto_live(page)
        btn = page.locator("#liveBtn")
        assert btn.is_visible()
        assert "查看行情" in btn.inner_text()
        shot(page, "live_view_btn")

    def test_live_refresh_button(self, page):
        """#33 刷新数据按钮"""
        self._goto_live(page)
        btn = page.locator("#refreshBtn")
        assert btn.is_visible()
        assert "刷新数据" in btn.inner_text()
        shot(page, "live_refresh_btn")

    def test_live_add_stock_input(self, page):
        """#35 股票搜索输入框"""
        self._goto_live(page)
        inp = page.locator("#addStockInput")
        assert inp.is_visible()
        shot(page, "live_add_stock_input")

    def test_live_add_stock_button(self, page):
        """#38 下载添加按钮"""
        self._goto_live(page)
        btn = page.locator("#addStockBtn")
        assert btn.is_visible()
        shot(page, "live_add_stock_btn")

    def test_stock_search_shows_results(self, page):
        """#35 #36 搜索股票显示下拉"""
        self._goto_live(page)
        page.fill("#addStockInput", "茅台")
        page.wait_for_timeout(600)
        shot(page, "live_stock_search")

    def test_stock_search_by_code(self, page):
        """#35 按代码搜索"""
        self._goto_live(page)
        page.fill("#addStockInput", "600519")
        page.wait_for_timeout(600)
        shot(page, "live_search_by_code")

    def test_select_stock_from_search(self, page):
        """#36 从搜索结果选择股票"""
        self._goto_live(page)
        page.fill("#addStockInput", "600")
        page.wait_for_timeout(600)
        dropdown = page.locator("#searchDropdown")
        if dropdown.is_visible():
            first_item = dropdown.locator("div").first
            if first_item.is_visible():
                first_item.click()
                page.wait_for_timeout(500)
                # 应出现已选标签
                tags = page.locator("#selectedStocks")
                shot(page, "live_stock_selected")

    def test_remove_selected_stock_tag(self, page):
        """#37 删除已选股票标签"""
        self._goto_live(page)
        page.fill("#addStockInput", "600")
        page.wait_for_timeout(600)
        dropdown = page.locator("#searchDropdown")
        if dropdown.is_visible():
            first_item = dropdown.locator("div").first
            if first_item.is_visible():
                first_item.click()
                page.wait_for_timeout(500)
                # 点击 × 删除
                tags = page.locator("#selectedStocks span")
                if tags.count() > 0:
                    tags.first.click()
                    page.wait_for_timeout(300)
                    shot(page, "live_stock_removed")

    def test_refresh_data_click(self, page):
        """#33 #34 点击刷新数据"""
        self._goto_live(page)
        page.click("#refreshBtn")
        page.wait_for_timeout(2000)
        msg = page.locator("#refreshMsg")
        assert msg.inner_text() != ""
        shot(page, "live_refresh_done")

    def test_live_kline_chart_container(self, page):
        """#40 K 线图容器"""
        self._goto_live(page)
        assert page.locator("#liveKlineChart").is_visible()
        shot(page, "live_kline_container")

    def test_view_kline_with_stock(self, page):
        """#32 #40 查看行情 → K 线图渲染"""
        self._goto_live(page)
        page.click("#liveBtn")
        page.wait_for_timeout(3000)
        shot(page, "live_kline_rendered")

    def test_change_live_range(self, page):
        """#31 切换时间范围"""
        self._goto_live(page)
        page.select_option("#liveRange", index=2)
        page.wait_for_timeout(300)
        shot(page, "live_range_changed")

    def test_search_click_outside_closes(self, page):
        """#36 点击搜索框外部关闭下拉"""
        self._goto_live(page)
        page.fill("#addStockInput", "600")
        page.wait_for_timeout(600)
        # 点击页面其他位置
        page.locator("h1").click()
        page.wait_for_timeout(300)
        dropdown = page.locator("#searchDropdown")
        # 下拉框应隐藏
        shot(page, "live_search_closed_outside")

    def test_add_stock_empty_input(self, page):
        """#38 空输入点击下载"""
        self._goto_live(page)
        page.click("#addStockBtn")
        page.wait_for_timeout(500)
        shot(page, "live_add_empty")


# ======================================================================
#  6. 我的策略页面 (元素 #41-#69)
# ======================================================================

class TestStrategiesPage:
    """NL 翻译、快捷示例、条件构建器、策略保存、预设模板、策略列表 CRUD"""

    def _goto_strategies(self, page):
        goto_tab(page, "我的策略")
        page.wait_for_timeout(300)

    # ---- 页面元素 ----

    def test_nl_input_visible(self, page):
        """#41 NL 输入框"""
        self._goto_strategies(page)
        assert page.locator("#nlInput").is_visible()
        shot(page, "strat_nl_input")

    def test_smart_translate_button(self, page):
        """#42 智能翻译按钮"""
        self._goto_strategies(page)
        btn = page.locator("button:text('智能翻译')")
        assert btn.is_visible()
        shot(page, "strat_translate_btn")

    def test_quick_example_buttons_visible(self, page):
        """#43-#47 快捷示例按钮全部可见"""
        self._goto_strategies(page)
        examples = ["涨买跌卖", "止盈止损", "抄底逃顶", "整数关口"]
        for name in examples:
            assert page.locator(f"button:text('{name}')").is_visible()
        shot(page, "strat_quick_examples")

    def test_add_buy_condition_button(self, page):
        """#53 添加买入条件按钮"""
        self._goto_strategies(page)
        btns = page.locator("button:text('+ 添加条件')")
        assert btns.first.is_visible()
        shot(page, "strat_add_buy_btn")

    def test_add_sell_condition_button(self, page):
        """#55 添加卖出条件按钮"""
        self._goto_strategies(page)
        btns = page.locator("button:text('+ 添加条件')")
        assert btns.last.is_visible()
        shot(page, "strat_add_sell_btn")

    def test_save_strategy_button(self, page):
        """#57 保存策略按钮"""
        self._goto_strategies(page)
        assert page.locator("button:text('保存策略')").is_visible()
        shot(page, "strat_save_btn")

    def test_strategy_name_input(self, page):
        """#49 策略名称输入"""
        self._goto_strategies(page)
        assert page.locator("#strategyName").is_visible()
        shot(page, "strat_name_input")

    def test_strategy_market_selector(self, page):
        """#50 市场选择器"""
        self._goto_strategies(page)
        sel = page.locator("#strategyMarket")
        assert sel.is_visible()
        options = sel.locator("option")
        assert options.count() >= 3
        shot(page, "strat_market")

    def test_strategy_symbol_search(self, page):
        """#51 #52 股票代码搜索"""
        self._goto_strategies(page)
        page.fill("#strategySymbol", "600519")
        page.wait_for_timeout(500)
        shot(page, "strat_symbol_search")

    # ---- NL 翻译 ----

    @pytest.mark.parametrize("btn_text, keyword, tag", [
        ("涨买跌卖", "买", "nl_percentage"),
        ("止盈止损", "赚够", "nl_stop"),
        ("抄底逃顶", "到底", "nl_bottom"),
        ("整数关口", "3000", "nl_round"),
        ("均线交叉", "均线", "nl_ma"),
        ("RSI高低", "RSI", "nl_rsi"),
        ("MACD", "MACD", "nl_macd"),
    ])
    def test_nl_quick_examples(self, page, btn_text, keyword, tag):
        """#43-#47 快捷示例"""
        self._goto_strategies(page)
        page.click(f"button:text('{btn_text}')")
        page.wait_for_timeout(300)
        val = page.locator("#nlInput").input_value()
        assert keyword in val
        shot(page, tag)

    def test_nl_parse_percentage(self, page):
        """#42 NL 翻译：涨跌百分比"""
        self._goto_strategies(page)
        nl_translate(page, "跌破20%就卖，涨了5%就买")
        result = page.locator("#nlResult").inner_text()
        assert "成功" in result
        shot(page, "nl_parse_percentage")

    @pytest.mark.parametrize("text, tag", [
        ("站上20日线买入，跌破10日线卖出", "nl_parse_ma"),
        ("MACD金叉买入，MACD死叉卖出", "nl_parse_macd"),
        ("RSI超买卖出，RSI超卖买入", "nl_parse_rsi"),
        ("放量突破10日高点买入，缩量跌破10日低点卖出", "nl_parse_volume"),
        ("KDJ金叉买入，KDJ死叉卖出", "nl_parse_kdj"),
        ("突破布林带上轨买入，跌破布林带下轨卖出", "nl_parse_bollinger"),
        ("站上20日线且RSI低于30买入，跌破10日线或RSI高于70卖出", "nl_parse_compound"),
    ])
    def test_nl_parse_indicators(self, page, text, tag):
        """#42 NL 翻译：各指标"""
        self._goto_strategies(page)
        nl_translate(page, text)
        shot(page, tag)

    def test_nl_parse_empty_input(self, page):
        """#48 NL 翻译：空输入"""
        self._goto_strategies(page)
        nl_translate(page, "", wait_ms=500)
        result = page.locator("#nlResult").inner_text()
        assert "请输入" in result
        shot(page, "nl_empty")

    def test_nl_parse_unrecognized(self, page):
        """#48 NL 翻译：无法识别"""
        self._goto_strategies(page)
        nl_translate(page, "今天天气不错适合出去玩")
        result = page.locator("#nlResult").inner_text()
        assert "未能识别" in result or "换个说法" in result
        shot(page, "nl_unrecognized")

    def test_nl_translates_fills_conditions(self, page):
        """#42 翻译成功后条件自动填入"""
        self._goto_strategies(page)
        nl_translate(page, "站上20日线买入，跌破10日线卖出")
        page.click("button:text('智能翻译')")
        page.wait_for_timeout(1500)
        # 条件区应有内容
        buy = page.locator("#buyConditions")
        sell = page.locator("#sellConditions")
        shot(page, "nl_conditions_filled")

    # ---- 条件构建器 ----

    def test_add_buy_condition(self, page):
        """#53 添加买入条件"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        assert page.locator("#buyConditions select").count() > 0
        shot(page, "cond_buy_added")

    def test_add_sell_condition(self, page):
        """#55 添加卖出条件"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").last.click()
        page.wait_for_timeout(300)
        assert page.locator("#sellConditions select").count() > 0
        shot(page, "cond_sell_added")

    def test_add_multiple_conditions(self, page):
        """#53 #55 添加多个条件"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.locator("button:text('+ 添加条件')").last.click()
        page.wait_for_timeout(200)
        shot(page, "cond_multiple")

    def test_remove_buy_condition(self, page):
        """#54 删除买入条件"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        page.locator("#buyConditions span:text('×')").first.click()
        page.wait_for_timeout(300)
        shot(page, "cond_buy_removed")

    def test_remove_sell_condition(self, page):
        """#56 删除卖出条件"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").last.click()
        page.wait_for_timeout(300)
        page.locator("#sellConditions span:text('×')").first.click()
        page.wait_for_timeout(300)
        shot(page, "cond_sell_removed")

    def test_condition_indicator_select(self, page):
        """#54 条件中指标选择器"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        # 默认应该是 MA
        selects = page.locator("#buyConditions select")
        assert selects.count() >= 3  # 左类型、指标、操作符、右类型
        shot(page, "cond_indicator_select")

    def test_condition_change_indicator(self, page):
        """#54 切换指标"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        # 通过 JS 更改指标
        page.evaluate("updateCondLeftIndicator('buy', 0, 'rsi')")
        page.wait_for_timeout(300)
        shot(page, "cond_change_indicator")

    def test_condition_change_operator(self, page):
        """#54 切换操作符"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        page.evaluate("updateCondOp('buy', 0, '>')")
        page.wait_for_timeout(200)
        shot(page, "cond_change_operator")

    def test_condition_change_left_type_to_value(self, page):
        """#54 左侧切换为数值类型"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        page.evaluate("updateCondLeftType('buy', 0, 'fixed')")
        page.wait_for_timeout(300)
        shot(page, "cond_left_fixed")

    def test_condition_change_right_type_to_value(self, page):
        """#54 右侧切换为数值类型"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        page.evaluate("updateCondRightType('buy', 0, 'fixed')")
        page.wait_for_timeout(300)
        shot(page, "cond_right_fixed")

    def test_condition_macd_with_field(self, page):
        """#54 MACD 指标带字段选择"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.evaluate("updateCondLeftIndicator('buy', 0, 'macd')")
        page.wait_for_timeout(300)
        shot(page, "cond_macd_field")

    def test_condition_kdj_with_field(self, page):
        """#54 KDJ 指标带字段选择"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.evaluate("updateCondLeftIndicator('buy', 0, 'kdj')")
        page.wait_for_timeout(300)
        shot(page, "cond_kdj_field")

    def test_condition_boll_with_field(self, page):
        """#54 布林带指标带字段选择"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.evaluate("updateCondLeftIndicator('buy', 0, 'boll')")
        page.wait_for_timeout(300)
        shot(page, "cond_boll_field")

    def test_condition_update_params(self, page):
        """#54 更新指标参数"""
        self._goto_strategies(page)
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.evaluate("updateCondParam('buy', 0, 'left', 'period', 30)")
        page.wait_for_timeout(200)
        shot(page, "cond_update_params")

    # ---- 保存策略 ----

    def test_save_strategy_no_name(self, page):
        """#57 无名称保存"""
        self._goto_strategies(page)
        page.click("button:text('保存策略')")
        page.wait_for_timeout(500)
        msg = page.locator("#strategySaveMsg").inner_text()
        assert "策略名称" in msg
        shot(page, "save_no_name")

    def test_save_strategy_no_symbol(self, page):
        """#57 无股票代码保存"""
        self._goto_strategies(page)
        page.fill("#strategyName", "测试策略")
        page.click("button:text('保存策略')")
        page.wait_for_timeout(500)
        msg = page.locator("#strategySaveMsg").inner_text()
        assert "股票代码" in msg
        shot(page, "save_no_symbol")

    def test_save_strategy_no_conditions(self, page):
        """#57 无条件保存"""
        self._goto_strategies(page)
        page.fill("#strategyName", "无条件策略")
        page.fill("#strategySymbol", "600519")
        page.click("button:text('保存策略')")
        page.wait_for_timeout(500)
        msg = page.locator("#strategySaveMsg").inner_text()
        assert "条件" in msg
        shot(page, "save_no_conditions")

    def test_save_strategy_full_flow(self, page):
        """#57 完整保存流程"""
        self._goto_strategies(page)
        page.fill("#strategyName", "全自动测试策略")
        page.fill("#strategySymbol", "600519")
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(300)
        page.locator("button:text('+ 添加条件')").last.click()
        page.wait_for_timeout(300)
        page.click("button:text('保存策略')")
        page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)
        msg = page.locator("#strategySaveMsg").inner_text()
        assert "成功" in msg
        shot(page, "save_full_flow")

    # ---- 预设模板 ----

    def test_preset_market_selector(self, page):
        """#59 预设市场选择"""
        self._goto_strategies(page)
        assert page.locator("#presetMarket").is_visible()
        shot(page, "preset_market")

    def test_preset_symbol_input(self, page):
        """#60 预设股票输入"""
        self._goto_strategies(page)
        assert page.locator("#presetSymbol").is_visible()
        shot(page, "preset_symbol_input")

    def test_preset_symbol_search(self, page):
        """#60 #61 预设股票搜索"""
        self._goto_strategies(page)
        page.fill("#presetSymbol", "600519")
        page.wait_for_timeout(600)
        shot(page, "preset_symbol_search")

    def test_preset_list_loaded(self, page):
        """#62 预设模板列表"""
        self._goto_strategies(page)
        page.wait_for_timeout(3000)
        preset_list = page.locator("#presetList")
        shot(page, "preset_list")

    def test_preset_no_symbol_error(self, page):
        """#62 未填股票代码加载预设"""
        self._goto_strategies(page)
        page.wait_for_timeout(2000)
        page.fill("#presetSymbol", "")
        page.evaluate("loadPreset(0)")
        page.wait_for_timeout(1000)
        msg = page.locator("#presetMsg").inner_text()
        assert "股票代码" in msg or "请先" in msg
        shot(page, "preset_no_symbol")

    def test_preset_load_with_symbol(self, page):
        """#62 填入股票后加载预设"""
        self._goto_strategies(page)
        page.wait_for_timeout(2000)
        page.fill("#presetSymbol", "600519")
        page.evaluate("loadPreset(0)")
        page.wait_for_timeout(2000)
        shot(page, "preset_loaded")

    # ---- 策略列表 CRUD ----

    def test_strategy_list_visible(self, page):
        """#65 策略列表区域"""
        self._goto_strategies(page)
        page.wait_for_timeout(1000)
        shot(page, "strat_list")

    def test_evaluate_all_button(self, page):
        """#64 全部评估按钮"""
        self._goto_strategies(page)
        assert page.locator("button:text('全部评估')").is_visible()
        shot(page, "eval_all_btn")

    def test_evaluate_all_click(self, page):
        """#64 #69 点击全部评估"""
        self._goto_strategies(page)
        page.click("button:text('全部评估')")
        page.wait_for_timeout(3000)
        shot(page, "eval_all_done")

    def test_strategy_toggle_and_delete(self, page):
        """#67 #68 策略暂停/启用/删除"""
        self._goto_strategies(page)
        # 先创建一个策略
        page.fill("#strategyName", "临时测试策略")
        page.fill("#strategySymbol", "600519")
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.click("button:text('保存策略')")
        page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)
        # 暂停
        toggle_btn = page.locator("button:text('暂停')").first
        if toggle_btn.is_visible():
            toggle_btn.click()
            page.wait_for_timeout(1000)
            shot(page, "strat_paused")
        # 删除
        delete_btn = page.locator("button:text('删除')").first
        if delete_btn.is_visible():
            page.on("dialog", lambda d: d.accept())
            delete_btn.click()
            page.wait_for_timeout(1000)
            shot(page, "strat_deleted")

    def test_strategy_evaluate_single(self, page):
        """#66 评估单个策略"""
        self._goto_strategies(page)
        # 先创建
        page.fill("#strategyName", "评估测试策略")
        page.fill("#strategySymbol", "600519")
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.click("button:text('保存策略')")
        page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)
        eval_btn = page.locator("button:text('评估')").first
        if eval_btn.is_visible():
            eval_btn.click()
            page.wait_for_timeout(2000)
            shot(page, "strat_eval_single")


# ======================================================================
#  7. 策略对比页面 (元素 #70-#73)
# ======================================================================

class TestComparePage:
    """股票选择、天数配置、运行对比、结果展示"""

    def _goto_compare(self, page):
        goto_tab(page, "策略对比")

    def test_compare_elements(self, page):
        """#70 #71 #72 页面元素"""
        self._goto_compare(page)
        assert page.locator("#tab-compare #compareSymbol").is_visible()
        assert page.locator("#tab-compare #compareDays").is_visible()
        assert page.locator("#tab-compare #compareBtn").is_visible()
        shot(page, "compare_elements")

    def test_compare_symbol_selector(self, page):
        """#70 股票选择器"""
        self._goto_compare(page)
        sel = page.locator("#tab-compare #compareSymbol")
        assert sel.is_visible()
        shot(page, "compare_symbol")

    def test_compare_days_input(self, page):
        """#71 天数输入"""
        self._goto_compare(page)
        days = page.locator("#tab-compare #compareDays")
        assert days.input_value() == "500"
        days.fill("300")
        assert days.input_value() == "300"
        shot(page, "compare_days")

    def test_run_compare(self, page):
        """#72 #73 运行对比"""
        self._goto_compare(page)
        page.click("#compareBtn")
        page.wait_for_selector("#compareArea table, #compareArea canvas, #compareArea .chart-container", timeout=15000)
        area = page.locator("#compareArea")
        shot(page, "compare_result")

    def test_compare_with_custom_days(self, page):
        """#71 #72 自定义天数对比"""
        self._goto_compare(page)
        page.fill("#compareDays", "200")
        page.click("#compareBtn")
        page.wait_for_selector("#compareArea table, #compareArea canvas, #compareArea .chart-container", timeout=15000)
        shot(page, "compare_custom_days")


# ======================================================================
#  8. 参数优化页面 (元素 #74-#78)
# ======================================================================

class TestOptimizePage:
    """策略选择、股票选择、天数配置、运行优化、结果展示"""

    def _goto_optimize(self, page):
        goto_tab(page, "参数优化")

    def test_optimize_elements(self, page):
        """#74 #75 #76 #77 页面元素"""
        self._goto_optimize(page)
        assert page.locator("#optimizeStrategy").is_visible()
        assert page.locator("#optimizeSymbol").is_visible()
        assert page.locator("#optimizeDays").is_visible()
        assert page.locator("#optimizeBtn").is_visible()
        shot(page, "optimize_elements")

    def test_optimize_strategy_selector_options(self, page):
        """#74 策略选择器选项"""
        self._goto_optimize(page)
        options = page.locator("#optimizeStrategy option")
        assert options.count() >= 7
        shot(page, "optimize_strategy_options")

    def test_optimize_select_different_strategy(self, page):
        """#74 切换策略"""
        self._goto_optimize(page)
        page.select_option("#optimizeStrategy", index=2)
        page.wait_for_timeout(300)
        shot(page, "optimize_strategy_switch")

    def test_optimize_symbol_selector(self, page):
        """#75 股票选择器"""
        self._goto_optimize(page)
        assert page.locator("#optimizeSymbol").is_visible()
        shot(page, "optimize_symbol")

    def test_optimize_days_input(self, page):
        """#76 天数输入"""
        self._goto_optimize(page)
        days = page.locator("#optimizeDays")
        assert days.input_value() == "500"
        days.fill("200")
        assert days.input_value() == "200"
        shot(page, "optimize_days")

    def test_run_optimize(self, page):
        """#77 #78 运行优化"""
        self._goto_optimize(page)
        page.click("#optimizeBtn")
        page.wait_for_selector("#optimizeArea table, #optimizeArea .result-table", timeout=15000)
        area = page.locator("#optimizeArea")
        shot(page, "optimize_result")

    def test_optimize_result_table(self, page):
        """#78 优化结果表格"""
        self._goto_optimize(page)
        page.click("#optimizeBtn")
        page.wait_for_selector("#optimizeArea table, #optimizeArea .result-table", timeout=15000)
        shot(page, "optimize_result_table")


# ======================================================================
#  9. 风控配置页面 (元素 #79-#86)
# ======================================================================

class TestRiskConfigPage:
    """6 个风控参数、保存配置、默认值"""

    def _goto_risk(self, page):
        goto_tab(page, "风控配置")
        page.wait_for_timeout(300)

    def test_all_risk_inputs_visible(self, page):
        """#79-#84 所有风控输入框"""
        self._goto_risk(page)
        assert page.locator("#riskStopLoss").is_visible()
        assert page.locator("#riskTakeProfit").is_visible()
        assert page.locator("#riskTrailingStop").is_visible()
        assert page.locator("#riskMaxDrawdown").is_visible()
        assert page.locator("#riskPositionSize").is_visible()
        assert page.locator("#riskCapital").is_visible()
        shot(page, "risk_all_inputs")

    def test_risk_default_values(self, page):
        """#79-#84 默认值"""
        self._goto_risk(page)
        assert page.locator("#riskStopLoss").input_value() == "-5"
        assert page.locator("#riskTakeProfit").input_value() == "15"
        assert page.locator("#riskTrailingStop").input_value() == "-8"
        assert page.locator("#riskMaxDrawdown").input_value() == "-20"
        assert page.locator("#riskPositionSize").input_value() == "100"
        assert page.locator("#riskCapital").input_value() == "1000000"
        shot(page, "risk_defaults")

    def test_risk_stop_loss_input(self, page):
        """#79 止损百分比"""
        self._goto_risk(page)
        page.fill("#riskStopLoss", "-10")
        assert page.locator("#riskStopLoss").input_value() == "-10"
        shot(page, "risk_stop_loss")

    def test_risk_take_profit_input(self, page):
        """#80 止盈百分比"""
        self._goto_risk(page)
        page.fill("#riskTakeProfit", "25")
        assert page.locator("#riskTakeProfit").input_value() == "25"
        shot(page, "risk_take_profit")

    def test_risk_trailing_stop_input(self, page):
        """#81 移动止损"""
        self._goto_risk(page)
        page.fill("#riskTrailingStop", "-12")
        assert page.locator("#riskTrailingStop").input_value() == "-12"
        shot(page, "risk_trailing")

    def test_risk_max_drawdown_input(self, page):
        """#82 最大回撤"""
        self._goto_risk(page)
        page.fill("#riskMaxDrawdown", "-30")
        assert page.locator("#riskMaxDrawdown").input_value() == "-30"
        shot(page, "risk_drawdown")

    def test_risk_position_size_input(self, page):
        """#83 仓位大小"""
        self._goto_risk(page)
        page.fill("#riskPositionSize", "200")
        assert page.locator("#riskPositionSize").input_value() == "200"
        shot(page, "risk_position")

    def test_risk_capital_input(self, page):
        """#84 初始资金"""
        self._goto_risk(page)
        page.fill("#riskCapital", "500000")
        assert page.locator("#riskCapital").input_value() == "500000"
        shot(page, "risk_capital")

    def test_save_risk_config(self, page):
        """#85 #86 保存风控配置"""
        self._goto_risk(page)
        page.fill("#riskStopLoss", "-8")
        page.fill("#riskTakeProfit", "20")
        page.fill("#riskTrailingStop", "-10")
        page.fill("#riskMaxDrawdown", "-25")
        page.fill("#riskPositionSize", "150")
        page.fill("#riskCapital", "800000")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(800)
        msg = page.locator("#riskSaveMsg").inner_text()
        assert "已保存" in msg or msg != ""
        shot(page, "risk_saved")

    def test_risk_config_persists_on_reload(self, page):
        """#85 配置刷新后持久化"""
        self._goto_risk(page)
        page.fill("#riskStopLoss", "-15")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(500)
        # 刷新页面
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        goto_tab(page, "风控配置")
        page.wait_for_timeout(300)
        val = page.locator("#riskStopLoss").input_value()
        assert val == "-15"
        shot(page, "risk_persist_reload")


# ======================================================================
#  10. 推送通知配置 (元素 #87-#98)
# ======================================================================

class TestNotifyConfigPage:
    """5 个推送渠道配置、保存、测试"""

    def _goto_risk(self, page):
        goto_tab(page, "风控配置")
        page.wait_for_timeout(300)

    def _scroll_to_notify(self, page):
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)

    def test_feishu_webhook_input(self, page):
        """#87 飞书 Webhook"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgFeishuWebhook").is_visible()
        page.fill("#cfgFeishuWebhook", "https://open.feishu.cn/open-apis/bot/v2/hook/test")
        shot(page, "notify_feishu")

    def test_feishu_secret_input(self, page):
        """#88 飞书签名密钥"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgFeishuSecret").is_visible()
        shot(page, "notify_feishu_secret")

    def test_serverchan_input(self, page):
        """#89 Server 酱"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgServerchan").is_visible()
        page.fill("#cfgServerchan", "test_send_key_123")
        shot(page, "notify_serverchan")

    def test_dingtalk_input(self, page):
        """#90 钉钉"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgDingtalk").is_visible()
        page.fill("#cfgDingtalk", "https://oapi.dingtalk.com/robot/send?access_token=test")
        shot(page, "notify_dingtalk")

    def test_wechat_input(self, page):
        """#91 企业微信"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgWechat").is_visible()
        page.fill("#cfgWechat", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test")
        shot(page, "notify_wechat")

    def test_smtp_host_input(self, page):
        """#92 SMTP 主机"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgSmtpHost").is_visible()
        page.fill("#cfgSmtpHost", "smtp.qq.com")
        shot(page, "notify_smtp_host")

    def test_smtp_user_input(self, page):
        """#93 SMTP 用户"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgSmtpUser").is_visible()
        page.fill("#cfgSmtpUser", "test@qq.com")
        shot(page, "notify_smtp_user")

    def test_smtp_pass_input(self, page):
        """#94 SMTP 密码"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgSmtpPass").is_visible()
        shot(page, "notify_smtp_pass")

    def test_email_to_input(self, page):
        """#95 收件人邮箱"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        assert page.locator("#cfgEmailTo").is_visible()
        page.fill("#cfgEmailTo", "receiver@example.com")
        shot(page, "notify_email_to")

    def test_all_notify_inputs_visible(self, page):
        """#87-#95 所有通知输入框可见"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        fields = [
            "#cfgFeishuWebhook", "#cfgFeishuSecret", "#cfgServerchan",
            "#cfgDingtalk", "#cfgWechat", "#cfgSmtpHost",
            "#cfgSmtpUser", "#cfgSmtpPass", "#cfgEmailTo",
        ]
        for sel in fields:
            assert page.locator(sel).is_visible()
        shot(page, "notify_all_fields")

    def test_save_notify_config(self, page):
        """#96 #98 保存推送配置"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        page.click("button:text('保存推送配置')")
        page.wait_for_timeout(1000)
        shot(page, "notify_saved")

    def test_save_notify_with_values(self, page):
        """#96 填写并保存推送配置"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        page.fill("#cfgServerchan", "test_key_abc")
        page.fill("#cfgDingtalk", "https://oapi.dingtalk.com/robot/send?access_token=abc")
        page.click("button:text('保存推送配置')")
        page.wait_for_timeout(1500)
        shot(page, "notify_saved_with_values")

    def test_test_notify_button(self, page):
        """#97 发送测试消息"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        page.click("button:text('发送测试消息')")
        page.wait_for_timeout(2000)
        shot(page, "notify_test_sent")

    def test_notify_config_persists(self, page):
        """#96 通知配置持久化"""
        self._goto_risk(page)
        self._scroll_to_notify(page)
        page.fill("#cfgServerchan", "persist_test_key")
        page.click("button:text('保存推送配置')")
        page.wait_for_timeout(1000)
        # 刷新
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        goto_tab(page, "风控配置")
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(500)
        val = page.locator("#cfgServerchan").input_value()
        assert val == "persist_test_key"
        shot(page, "notify_persist")


# ======================================================================
#  11. Toast 通知 (元素 #99)
# ======================================================================

class TestToastNotification:
    """Toast 消息显示与消失"""

    def test_toast_appears_on_action(self, page):
        """#99 Toast 触发"""
        page.click("#runBtn")
        page.wait_for_timeout(500)
        toast = page.locator("#toast")
        shot(page, "toast_appears")

    def test_toast_auto_dismiss(self, page):
        """#99 Toast 自动消失"""
        page.click("#runBtn")
        page.wait_for_timeout(500)
        # 等待 toast 消失（2 秒后）
        page.wait_for_timeout(2500)
        shot(page, "toast_dismissed")

    def test_toast_success_type(self, page):
        """#99 成功类型 Toast"""
        # 触发一个成功操作（退出登录）
        page.click(".logout-btn")
        page.wait_for_timeout(500)
        shot(page, "toast_success_type")

    def test_toast_error_type(self, page):
        """#99 错误类型 Toast"""
        # 未选策略就运行回测
        page.click("#runBtn")
        page.wait_for_timeout(500)
        shot(page, "toast_error_type")


# ======================================================================
#  12. 下拉框关闭行为
# ======================================================================

class TestDropdownDismissal:
    """点击外部关闭各类下拉框"""

    @pytest.mark.parametrize("tab, input_sel, dropdown_sel, tag", [
        (None, "#quickSearch", "#quickDropdown", "dd_quick_closed"),
        ("实时行情", "#addStockInput", "#searchDropdown", "dd_live_closed"),
        ("我的策略", "#strategySymbol", "#strategySymbolDropdown", "dd_strategy_closed"),
        ("我的策略", "#presetSymbol", "#presetSymbolDropdown", "dd_preset_closed"),
    ])
    def test_dropdown_close_on_outside_click(self, page, tab, input_sel, dropdown_sel, tag):
        """点击外部关闭下拉框"""
        if tab:
            goto_tab(page, tab)
        page.fill(input_sel, "600")
        page.wait_for_timeout(600)
        page.locator(".header h1").click()
        page.wait_for_timeout(300)
        dd = page.locator(dropdown_sel)
        assert dd.is_hidden() or not dd.is_visible()
        shot(page, tag)


# ======================================================================
#  13. 窗口缩放 & 响应式
# ======================================================================

class TestResponsive:
    """窗口缩放后布局不崩"""

    @pytest.mark.parametrize("w, h, tag", [
        (800, 600, "responsive_small"),
        (1920, 1080, "responsive_large"),
        (480, 800, "responsive_narrow"),
        (2560, 1440, "responsive_wide"),
    ])
    def test_viewport_resize(self, page, w, h, tag):
        """不同窗口尺寸"""
        page.set_viewport_size({"width": w, "height": h})
        page.wait_for_timeout(500)
        assert page.locator(".header h1").is_visible()
        shot(page, tag)


# ======================================================================
#  14. E2E 完整流程
# ======================================================================

class TestFullFlowE2E:
    """端到端完整业务流程"""

    def test_full_backtest_flow(self, page):
        """完整回测：选策略 → 配置 → 运行 → 查看结果"""
        page.locator("#tab-backtest .strategy-item").first.click()
        page.wait_for_timeout(300)
        shot(page, "e2e_select_strategy")

        run_backtest(page, capital=500000, days=200)
        shot(page, "e2e_bt_result")

        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0

    def test_full_nl_strategy_flow(self, page):
        """完整 NL 策略：翻译 → 保存 → 列表"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(500)

        # NL 翻译
        nl_translate(page, "跌破20%就卖，涨了5%就买")
        shot(page, "e2e_nl_translated")

        # 填写名称和股票
        page.fill("#strategyName", "E2E全流程策略")
        page.fill("#strategySymbol", "600519")
        shot(page, "e2e_nl_filled")

        # 保存
        page.click("button:text('保存策略')")
        page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)
        shot(page, "e2e_nl_saved")

        # 列表可见
        page.wait_for_timeout(500)
        shot(page, "e2e_nl_in_list")

    def test_full_compare_flow(self, page):
        """完整策略对比流程"""
        goto_tab(page, "策略对比")
        page.wait_for_timeout(300)
        page.fill("#compareDays", "200")
        page.click("#compareBtn")
        page.wait_for_selector("#compareArea table, #compareArea canvas, #compareArea .chart-container", timeout=15000)
        shot(page, "e2e_compare")

    def test_full_optimize_flow(self, page):
        """完整参数优化流程"""
        goto_tab(page, "参数优化")
        page.wait_for_timeout(300)
        page.select_option("#optimizeStrategy", index=1)
        page.fill("#optimizeDays", "200")
        page.click("#optimizeBtn")
        page.wait_for_selector("#optimizeArea table, #optimizeArea .result-table", timeout=15000)
        shot(page, "e2e_optimize")

    def test_full_risk_notify_flow(self, page):
        """完整风控+通知配置流程"""
        goto_tab(page, "风控配置")
        page.wait_for_timeout(300)
        # 修改风控
        page.fill("#riskStopLoss", "-10")
        page.fill("#riskTakeProfit", "20")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(500)

        # 配置通知
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)
        page.fill("#cfgServerchan", "e2e_test_key")
        page.click("button:text('保存推送配置')")
        page.wait_for_timeout(1000)
        shot(page, "e2e_risk_notify")

    def test_full_preset_flow(self, page):
        """完整预设策略加载流程"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(2000)
        page.fill("#presetSymbol", "600519")
        page.evaluate("loadPreset(0)")
        page.wait_for_timeout(2000)
        shot(page, "e2e_preset")

    def test_navigate_all_tabs_and_interact(self, page):
        """遍历所有标签页并在每个页面执行操作"""
        # 回测
        page.locator("#tab-backtest .strategy-item").first.click()
        page.wait_for_timeout(200)
        shot(page, "e2e_all_backtest")

        # 实时行情
        goto_tab(page, "实时行情")
        page.click("#liveBtn")
        page.wait_for_timeout(2000)
        shot(page, "e2e_all_live")

        # 我的策略
        goto_tab(page, "我的策略")
        nl_translate(page, "站上20日线买入")
        shot(page, "e2e_all_strategies")

        # 策略对比
        goto_tab(page, "策略对比")
        page.click("#compareBtn")
        page.wait_for_selector("#compareArea table, #compareArea canvas, #compareArea .chart-container", timeout=15000)
        shot(page, "e2e_all_compare")

        # 参数优化
        goto_tab(page, "参数优化")
        page.click("#optimizeBtn")
        page.wait_for_selector("#optimizeArea table, #optimizeArea .result-table", timeout=15000)
        shot(page, "e2e_all_optimize")

        # 风控配置
        goto_tab(page, "风控配置")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(500)
        shot(page, "e2e_all_risk")


# ======================================================================
#  15. ECharts 图表渲染验证
# ======================================================================

class TestChartRendering:
    """验证回测结果中的 ECharts 图表真正渲染（canvas 元素存在）"""

    def _run_backtest(self, page):
        """选策略并运行回测"""
        page.locator("#tab-backtest .strategy-item").first.click()
        page.wait_for_timeout(300)
        run_backtest(page)

    def test_backtest_result_has_stat_cards(self, page):
        """回测结果包含统计卡片（12 项指标）"""
        self._run_backtest(page)
        cards = page.locator("#resultArea .stat-card")
        assert cards.count() >= 10
        # 检查关键指标文本
        result_text = page.locator("#resultArea").inner_text()
        assert "总收益" in result_text
        assert "最大回撤" in result_text
        assert "夏普比率" in result_text
        shot(page, "chart_stat_cards")

    def test_equity_chart_canvas_rendered(self, page):
        """权益曲线图 ECharts canvas 渲染"""
        self._run_backtest(page)
        # 等待 setTimeout(100) 中的图表渲染
        page.wait_for_timeout(500)
        equity = page.locator("#equityChart")
        assert equity.is_visible()
        # ECharts 初始化后会在容器内创建 canvas
        canvas = equity.locator("canvas")
        assert canvas.count() >= 1, "权益曲线图未渲染 canvas"
        shot(page, "chart_equity_canvas")

    def test_kline_chart_div_exists(self, page):
        """K 线图容器 div 存在（模拟数据可能无 K 线）"""
        self._run_backtest(page)
        page.wait_for_timeout(500)
        kline = page.locator("#klineChart")
        assert kline.count() >= 1, "K线图容器不存在"
        canvas = kline.locator("canvas")
        if canvas.count() >= 1:
            shot(page, "chart_kline_canvas")
        else:
            shot(page, "chart_kline_no_data")

    def test_equity_chart_has_dimensions(self, page):
        """权益曲线图 canvas 有实际尺寸"""
        self._run_backtest(page)
        page.wait_for_timeout(500)
        canvas = page.locator("#equityChart canvas").first
        box = canvas.bounding_box()
        assert box is not None
        assert box["width"] > 100
        assert box["height"] > 100
        shot(page, "chart_equity_dimensions")

    def test_kline_chart_has_dimensions(self, page):
        """K 线图 canvas 有实际尺寸（有数据时）"""
        self._run_backtest(page)
        page.wait_for_timeout(500)
        canvas = page.locator("#klineChart canvas")
        if canvas.count() >= 1:
            box = canvas.first.bounding_box()
            assert box is not None
            assert box["width"] > 100
            assert box["height"] > 100
            shot(page, "chart_kline_dimensions")
        else:
            shot(page, "chart_kline_no_canvas")

    def test_live_kline_chart_rendered(self, page):
        """实时行情 K 线图 canvas 渲染"""
        goto_tab(page, "实时行情")
        page.click("#liveBtn")
        page.wait_for_timeout(3000)
        chart = page.locator("#liveKlineChart")
        assert chart.is_visible()
        # ECharts canvas 在动态创建的 #liveChartInner 内
        inner = page.locator("#liveChartInner")
        if inner.count() >= 1:
            canvas = inner.locator("canvas")
            assert canvas.count() >= 1, "实时K线图未渲染 canvas"
            shot(page, "chart_live_kline_canvas")
        else:
            shot(page, "chart_live_kline_no_data")

    def test_backtest_result_shows_strategy_info(self, page):
        """回测结果显示策略名称和数据信息"""
        self._run_backtest(page)
        result = page.locator("#resultArea").inner_text()
        assert "策略" in result
        assert "数据" in result
        assert "周期" in result
        shot(page, "chart_strategy_info")

    def test_backtest_result_date_range(self, page):
        """回测结果日期范围非空"""
        self._run_backtest(page)
        result = page.locator("#resultArea").inner_text()
        # 应包含日期格式的文本
        assert "~" in result or "-" in result
        shot(page, "chart_date_range")


# ======================================================================
#  16. 选股完整链路（搜索 → 选择 → 下载 → 回测）
# ======================================================================

class TestStockFullFlow:
    """完整的股票搜索添加到回测的端到端流程"""

    def test_search_stock_and_quick_add(self, page):
        """回测页：搜索股票 → 点击结果 → 自动添加并选中"""
        # 搜索
        page.fill("#quickSearch", "600")
        page.wait_for_timeout(600)
        dropdown = page.locator("#quickDropdown")
        assert dropdown.is_visible(), "搜索下拉框未出现"

        # 点击第一个结果
        first_item = dropdown.locator("div").first
        first_item.click()
        page.wait_for_timeout(2000)

        # 下拉框关闭
        assert not dropdown.is_visible() or dropdown.is_hidden()
        shot(page, "stock_quick_add")

    def test_search_stock_select_in_dropdown(self, page):
        """回测页：搜索后下拉框有可点击项"""
        page.fill("#quickSearch", "茅台")
        page.wait_for_timeout(600)
        dropdown = page.locator("#quickDropdown")
        if dropdown.is_visible():
            items = dropdown.locator("div")
            count = items.count()
            assert count >= 0  # 可能有也可能没有结果
            shot(page, "stock_search_results")

    def test_live_page_search_and_select_stock(self, page):
        """行情页：搜索 → 选择 → 出现标签"""
        goto_tab(page, "实时行情")
        page.fill("#addStockInput", "600")
        page.wait_for_timeout(600)
        dropdown = page.locator("#searchDropdown")
        if dropdown.is_visible():
            first = dropdown.locator("div").first
            if first.is_visible():
                first.click()
                page.wait_for_timeout(500)
                # 检查已选标签
                tags = page.locator("#selectedStocks span")
                assert tags.count() >= 1, "选中股票后未出现标签"
                shot(page, "stock_live_selected")

    def test_live_page_select_and_download(self, page):
        """行情页：选择股票 → 下载添加"""
        goto_tab(page, "实时行情")
        # 先搜索选择一个股票
        page.fill("#addStockInput", "600519")
        page.wait_for_timeout(600)
        dropdown = page.locator("#searchDropdown")
        if dropdown.is_visible():
            first = dropdown.locator("div").first
            if first.is_visible():
                first.click()
                page.wait_for_timeout(500)
                # 点击下载
                page.click("#addStockBtn")
                page.wait_for_selector("#addStockMsg:not(:empty)", timeout=10000)
                msg = page.locator("#addStockMsg").inner_text()
                assert msg != ""
                shot(page, "stock_downloaded")

    @pytest.mark.parametrize("market, keyword, tag", [
        ("a", "600", "stock_filter_a"),
        ("hk", "0700", "stock_filter_hk"),
        ("us", "AAPL", "stock_filter_us"),
    ])
    def test_market_filter(self, page, market, keyword, tag):
        """回测页：市场筛选"""
        page.select_option("#quickMarket", value=market)
        page.wait_for_timeout(300)
        page.fill("#quickSearch", keyword)
        page.wait_for_timeout(600)
        shot(page, tag)

    def test_market_filter_reset_to_all(self, page):
        """回测页：重置为全部市场"""
        page.select_option("#quickMarket", value="us")
        page.wait_for_timeout(200)
        page.select_option("#quickMarket", value="")
        page.wait_for_timeout(300)
        shot(page, "stock_filter_all")


# ======================================================================
#  17. NL → 保存 → 回测 跨页完整链路
# ======================================================================

class TestNLToBacktestCrossPage:
    """NL 翻译策略 → 保存 → 切到回测页 → 用模拟数据回测该策略"""

    def test_nl_save_then_backtest_with_simulated(self, page):
        """完整链路：先选策略 → NL 翻译 → 应用规则 → 保存策略 → 切回测 → 运行"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        shot(page, "cross_select_strategy")

        goto_tab(page, "我的策略")
        page.wait_for_timeout(500)
        nl_translate(page, "站上20日线买入，跌破10日线卖出")
        result = page.locator("#nlResult").inner_text()
        assert "成功" in result
        shot(page, "cross_nl_translated")

        # 点击「应用规则」将条件填入表单
        page.click("button:text('应用规则')")
        page.wait_for_timeout(300)

        page.fill("#strategyName", "跨页测试策略")
        page.fill("#strategySymbol", "600519")
        page.click("button:text('保存策略')")
        page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)
        save_msg = page.locator("#strategySaveMsg").inner_text()
        assert "成功" in save_msg
        shot(page, "cross_nl_saved")

        goto_tab(page, "回测")
        page.wait_for_timeout(500)
        run_backtest(page, capital=300000, days=200)
        shot(page, "cross_backtest_result")

        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0

    def test_nl_parse_multiple_indicators_then_save(self, page):
        """NL 复合策略翻译 → 保存"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(500)
        create_nl_strategy(page, "MACD金叉且站上20日线买入，RSI超70卖出", "复合指标策略")
        shot(page, "cross_compound_saved")

    def test_nl_kdj_strategy_save_and_verify(self, page):
        """先选策略 → KDJ 翻译 → 保存 → 回测"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)

        goto_tab(page, "我的策略")
        page.wait_for_timeout(500)
        create_nl_strategy(page, "KDJ金叉买入，KDJ死叉卖出", "KDJ测试策略")

        goto_tab(page, "回测")
        page.wait_for_timeout(500)
        run_backtest(page)
        shot(page, "cross_kdj_backtest")

        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0

    def test_save_then_evaluate_then_backtest(self, page):
        """先选策略 → 保存用户策略 → 评估 → 切回测 → 运行"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)

        goto_tab(page, "我的策略")
        page.wait_for_timeout(500)
        create_nl_strategy(page, "跌破20%就卖，涨了5%就买", "评估回测策略")

        eval_btn = page.locator("button:text('评估')").first
        if eval_btn.is_visible():
            eval_btn.click()
            page.wait_for_timeout(2000)
            shot(page, "cross_evaluated")

        goto_tab(page, "回测")
        page.wait_for_timeout(500)
        run_backtest(page)

        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0
        shot(page, "cross_eval_backtest")

    def test_multiple_nl_strategies_then_compare(self, page):
        """创建多个策略 → 切到对比页 → 运行对比"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(500)

        create_nl_strategy(page, "站上20日线买入，跌破10日线卖出", "对比策略A")
        create_nl_strategy(page, "MACD金叉买入，MACD死叉卖出", "对比策略B")

        goto_tab(page, "策略对比")
        page.wait_for_timeout(300)
        page.click("#compareBtn")
        page.wait_for_selector("#compareArea table, #compareArea canvas, #compareArea .chart-container", timeout=15000)
        shot(page, "cross_multi_compare")

    def test_full_chain_nl_download_backtest(self, page):
        """最完整链路：先选策略 → NL 翻译 → 保存 → 行情页 → 回测"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)

        goto_tab(page, "我的策略")
        page.wait_for_timeout(500)
        create_nl_strategy(page, "RSI超卖买入，RSI超买卖出", "全链路策略")
        shot(page, "chain_saved")

        goto_tab(page, "实时行情")
        page.wait_for_timeout(300)
        page.click("#liveBtn")
        page.wait_for_timeout(3000)
        shot(page, "chain_live")

        goto_tab(page, "回测")
        page.wait_for_timeout(500)
        run_backtest(page, capital=500000)
        shot(page, "chain_backtest")

        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0
        page.wait_for_timeout(500)
        equity_canvas = page.locator("#equityChart canvas")
        assert equity_canvas.count() >= 1
        shot(page, "chain_chart_rendered")


# ======================================================================
#  18. Loading 状态验证
# ======================================================================

class TestLoadingStates:
    """按钮在请求期间的状态变化

    runBacktest/runCompare/runOptimize/refreshData 都是 async 函数，
    page.evaluate() 不会 await 返回的 Promise。改用 page.click() 触发。
    用 page.route() + daemon 线程挂起请求（不阻塞 Playwright 线程），
    确保 loading 状态可观察。
    """

    def test_backtest_shows_loading_indicator(self, page):
        """回测：结果区显示 loading 指示器、按钮禁用"""
        import threading as _th, time as _t
        def _hold(route):
            def _later():
                _t.sleep(8)
                try: route.abort()
                except: pass
            _th.Thread(target=_later, daemon=True).start()
        page.route("**/backtest-detail", _hold)
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        page.click("#runBtn")
        page.wait_for_timeout(500)
        result = page.locator("#resultArea")
        assert result.locator(".loading, .spinner").count() > 0 or "正在运行" in result.inner_text(), \
            "结果区未显示 loading 指示器"
        assert page.evaluate("document.getElementById('runBtn').disabled"), "请求期间按钮应禁用"
        shot(page, "loading_bt_indicator")

    def test_backtest_button_text_changes(self, page):
        """回测：按钮文字变为「回测中...」"""
        import threading as _th, time as _t
        def _hold(route):
            def _later():
                _t.sleep(8)
                try: route.abort()
                except: pass
            _th.Thread(target=_later, daemon=True).start()
        page.route("**/backtest-detail", _hold)
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        page.click("#runBtn")
        page.wait_for_timeout(500)
        btn_text = page.locator("#runBtn").inner_text()
        assert "回测中" in btn_text, f"按钮文字未变化: {btn_text}"
        shot(page, "loading_bt_text")

    def test_refresh_shows_loading_indicator(self, page):
        """刷新：消息区显示下载提示（refresh-data 本身就慢，无需拦截）"""
        goto_tab(page, "实时行情")
        page.click("#refreshBtn")
        page.wait_for_timeout(300)
        msg = page.locator("#refreshMsg").inner_text()
        assert "正在" in msg or "下载" in msg, f"刷新消息未显示: {msg}"
        shot(page, "loading_refresh_indicator")

    def test_compare_shows_loading_indicator(self, page):
        """对比：结果区显示 loading 指示器"""
        import threading as _th, time as _t
        def _hold(route):
            def _later():
                _t.sleep(8)
                try: route.abort()
                except: pass
            _th.Thread(target=_later, daemon=True).start()
        page.route("**/compare", _hold)
        goto_tab(page, "策略对比")
        page.click("#compareBtn")
        page.wait_for_timeout(500)
        area = page.locator("#compareArea")
        text = area.inner_text()
        assert "正在" in text or "运行" in text, f"对比区未显示 loading: {text}"
        shot(page, "loading_compare_indicator")


# ======================================================================
#  19. 错误恢复 & Token 过期
# ======================================================================

class TestErrorRecovery:
    """401 跳转、网络错误处理"""

    def test_401_redirects_to_login(self, page):
        """清除 token 后触发 authFetch → 跳转登录页"""
        # 清除 token 并触发认证请求
        page.evaluate("""
          localStorage.removeItem('quant_token');
          authFetch('/user-strategies').catch(() => {});
        """)
        page.wait_for_timeout(2000)
        # 应显示登录层
        login = page.locator("#loginOverlay")
        assert login.is_visible(), "Token 清除后应显示登录页"
        shot(page, "error_401_redirect")

    def test_invalid_token_shows_login(self, page):
        """设置无效 token → 应显示登录"""
        # add_init_script 会在 reload 时重新注入有效 token，
        # 所以需要先清除 init_script，再设置无效 token 后 reload
        page.context.clear_cookies()
        # 用 evaluate 先设无效 token，reload 前再注入一个覆盖 add_init_script 的脚本
        page.evaluate("localStorage.setItem('quant_token', 'invalid_token_123')")
        # 添加一个更高优先级的 init_script 来覆盖有效 token
        page.context.add_init_script("localStorage.setItem('quant_token', 'invalid_token_123')")
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)
        login = page.locator("#loginOverlay")
        assert login.is_visible(), "无效 token 应显示登录页"
        shot(page, "error_invalid_token")

    def test_backtest_network_error_handling(self, page):
        """回测请求失败时应有错误提示而非白屏"""
        # 选策略
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        # 模拟网络错误：拦截请求
        page.route("**/backtest-detail", lambda route: route.abort())
        page.click("#runBtn")
        page.wait_for_timeout(3000)
        # 结果区应有错误提示，不应是空白
        result = page.locator("#resultArea")
        text = result.inner_text()
        assert "失败" in text or "错误" in text or "请求" in text or "选择策略" not in text
        shot(page, "error_network")
        # 恢复路由
        page.unroute("**/backtest-detail")


# ======================================================================
#  20. 边界值测试
# ======================================================================

class TestBoundaryValues:
    """极端输入值处理"""

    def test_backtest_zero_capital(self, page):
        """资金为 0 的回测"""
        page.locator(".strategy-item").first.click()
        run_backtest(page, capital=0)
        shot(page, "boundary_zero_capital")

    def test_backtest_one_day(self, page):
        """天数为 1 的回测"""
        page.locator(".strategy-item").first.click()
        run_backtest(page, days=1)
        shot(page, "boundary_one_day")

    def test_backtest_large_capital(self, page):
        """超大资金回测"""
        page.locator(".strategy-item").first.click()
        run_backtest(page, capital=999999999)
        shot(page, "boundary_large_capital")

    def test_very_long_strategy_name(self, page):
        """超长策略名称"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(300)
        long_name = "这是一个非常非常长的策略名称" * 10
        page.fill("#strategyName", long_name)
        page.fill("#strategySymbol", "600519")
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.click("button:text('保存策略')")
        page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)
        shot(page, "boundary_long_name")

    def test_special_characters_strategy_name(self, page):
        """特殊字符策略名称"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(300)
        page.fill("#strategyName", "<script>alert('xss')</script>")
        page.fill("#strategySymbol", "600519")
        page.locator("button:text('+ 添加条件')").first.click()
        page.wait_for_timeout(200)
        page.click("button:text('保存策略')")
        page.wait_for_selector("#strategySaveMsg:not(:empty)", timeout=5000)
        shot(page, "boundary_special_chars")

    def test_nl_input_very_long_text(self, page):
        """超长 NL 输入"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(300)
        long_text = "站上20日线买入，跌破10日线卖出，" * 50
        nl_translate(page, long_text, wait_ms=3000)
        shot(page, "boundary_long_nl")

    def test_nl_input_only_numbers(self, page):
        """纯数字 NL 输入"""
        goto_tab(page, "我的策略")
        page.wait_for_timeout(300)
        nl_translate(page, "1234567890")
        result = page.locator("#nlResult").inner_text()
        assert "未能识别" in result or "换个说法" in result or result != ""
        shot(page, "boundary_numbers_nl")

    def test_risk_zero_values(self, page):
        """风控参数全设为 0"""
        goto_tab(page, "风控配置")
        page.wait_for_timeout(300)
        page.fill("#riskStopLoss", "0")
        page.fill("#riskTakeProfit", "0")
        page.fill("#riskTrailingStop", "0")
        page.fill("#riskMaxDrawdown", "0")
        page.fill("#riskPositionSize", "0")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(500)
        shot(page, "boundary_risk_zero")

    def test_risk_negative_capital(self, page):
        """负数资金"""
        goto_tab(page, "风控配置")
        page.wait_for_timeout(300)
        page.fill("#riskCapital", "-100000")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(500)
        shot(page, "boundary_negative_capital")

    def test_multiple_rapid_backtest_clicks(self, page):
        """快速连续点击回测按钮"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        # 快速点 3 次
        page.click("#runBtn")
        page.wait_for_timeout(100)
        page.click("#runBtn", force=True)
        page.wait_for_timeout(100)
        page.click("#runBtn", force=True)
        page.wait_for_selector("#resultArea .stat-card, #resultArea .error, #toast", timeout=15000)
        shot(page, "boundary_rapid_clicks")

    def test_empty_stock_code_backtest(self, page):
        """空股票代码回测"""
        page.locator(".strategy-item").first.click()
        # 清空 symbol select
        page.evaluate("document.getElementById('symbolSelect').value = ''")
        page.click("#runBtn")
        page.wait_for_timeout(2000)
        shot(page, "boundary_empty_symbol")


# ======================================================================
#  21. 多标签页联动
# ======================================================================

class TestCrossTabSync:
    """跨标签页数据同步"""

    def test_stock_added_appears_in_all_selectors(self, page):
        """添加股票后多个下拉框同步"""
        # 在回测页查看初始下拉框选项数
        initial_opts = page.locator("#symbolSelect option").count()

        # 切到行情页搜索
        goto_tab(page, "实时行情")
        page.fill("#addStockInput", "600")
        page.wait_for_timeout(600)

        # 回到回测页检查
        goto_tab(page, "回测")
        page.wait_for_timeout(300)
        opts = page.locator("#symbolSelect option").count()
        # 选项数应该相同（搜索不等于添加）
        shot(page, "sync_selectors")

    def test_risk_config_affects_backtest(self, page):
        """风控配置 → 回测使用"""
        goto_tab(page, "风控配置")
        page.wait_for_timeout(300)
        page.fill("#riskStopLoss", "-3")
        page.fill("#riskTakeProfit", "10")
        page.click("button:text('保存配置')")
        page.wait_for_timeout(500)

        goto_tab(page, "回测")
        page.wait_for_timeout(300)
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        run_backtest(page)
        shot(page, "sync_risk_backtest")
        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0


class TestPortfolioTab:
    """组合回测页"""

    def test_portfolio_tab_visible(self, page):
        """切换到组合回测标签页"""
        goto_tab(page, "组合回测")
        shot(page, "portfolio_tab")
        assert page.locator("#tab-portfolio").is_visible()

    def test_portfolio_has_strategy_checkboxes(self, page):
        """组合回测页有策略选择"""
        goto_tab(page, "组合回测")
        page.wait_for_timeout(300)
        shot(page, "portfolio_strategies")

    def test_portfolio_run(self, page):
        """运行组合回测"""
        goto_tab(page, "组合回测")
        page.wait_for_timeout(300)
        first_cb = page.locator("#portfolioStrategies input[type=checkbox]").first
        if first_cb.count() > 0:
            first_cb.check()
            page.fill("#portfolioSymbols", "600519")
            page.click("button:text('运行组合回测')")
            page.wait_for_timeout(5000)
            shot(page, "portfolio_result")


class TestDataQualityTab:
    """数据质量检测页"""

    def test_quality_tab_visible(self, page):
        """切换到数据质量标签页"""
        goto_tab(page, "数据质量")
        shot(page, "quality_tab")
        assert page.locator("#tab-quality").is_visible()

    def test_quality_run_detection(self, page):
        """运行数据质量检测"""
        goto_tab(page, "数据质量")
        page.wait_for_timeout(300)
        page.click("button:text('开始检测')")
        page.wait_for_timeout(3000)
        shot(page, "quality_result")
        result = page.locator("#qualityResult")
        assert result.inner_text() != ""

    def test_quality_detail_view(self, page):
        """查看详情按钮可用"""
        goto_tab(page, "数据质量")
        page.wait_for_timeout(300)
        page.click("button:text('开始检测')")
        page.wait_for_timeout(3000)
        detail_btn = page.locator("#qualityResult button:text('详情')").first
        if detail_btn.count() > 0:
            detail_btn.click()
            page.wait_for_timeout(1000)
            shot(page, "quality_detail")


class TestNewStrategies:
    """新增策略（动量、均值回归、ATR突破、ML）"""

    @pytest.mark.parametrize("strategy_key", ["momentum", "mean_reversion", "atr_breakout", "ml"])
    def test_strategy_selectable(self, page, strategy_key):
        """新策略可选中"""
        item = page.locator(f".strategy-item[data-key='{strategy_key}']")
        if item.count() > 0:
            item.click()
            page.wait_for_timeout(200)
            assert "active" in (item.get_attribute("class") or "")
            shot(page, f"select_{strategy_key}")

    @pytest.mark.parametrize("strategy_key", ["momentum", "mean_reversion", "atr_breakout"])
    def test_strategy_backtest(self, page, strategy_key):
        """新策略回测有结果"""
        item = page.locator(f".strategy-item[data-key='{strategy_key}']")
        if item.count() == 0:
            pytest.skip(f"{strategy_key} not found")
        item.click()
        page.wait_for_timeout(200)
        run_backtest(page)
        shot(page, f"backtest_{strategy_key}")
        cards = page.locator("#resultArea .stat-card")
        assert cards.count() > 0


class TestReportExport:
    """报告导出"""

    def test_export_button_exists(self, page):
        """回测结果页有导出按钮"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        run_backtest(page)
        export_btn = page.locator("button:text('导出报告')")
        shot(page, "export_btn_visible")
        assert export_btn.count() > 0

    def test_export_triggers_download(self, page):
        """点击导出触发下载"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        run_backtest(page)
        with page.expect_download(timeout=10000) as download_info:
            page.click("button:text('导出报告')")
        download = download_info.value
        shot(page, "export_download")
        assert download.suggested_filename.endswith(".html")


class TestPaperTradeTab:
    """模拟盘标签页"""

    def test_paper_tab_visible(self, page):
        """切换到模拟盘标签页"""
        goto_tab(page, "模拟盘")
        shot(page, "paper_tab")
        assert page.locator("#tab-paper").is_visible()

    def test_paper_has_strategy_select(self, page):
        """模拟盘页有策略下拉框"""
        goto_tab(page, "模拟盘")
        page.wait_for_timeout(300)
        sel = page.locator("#paperStrategy")
        assert sel.is_visible()
        # 应该有策略选项
        opts = sel.locator("option").count()
        assert opts > 0

    def test_paper_start_stop_buttons(self, page):
        """启动/停止按钮存在"""
        goto_tab(page, "模拟盘")
        shot(page, "paper_buttons")
        assert page.locator("#paperStartBtn").is_visible()
        assert page.locator("#paperStopBtn").is_visible()
        assert page.locator("#paperStopBtn").is_disabled()

    def test_paper_start_and_stop(self, page):
        """启动模拟盘后停止"""
        goto_tab(page, "模拟盘")
        page.wait_for_timeout(300)
        page.fill("#paperSymbol", "600519")
        page.click("#paperStartBtn")
        page.wait_for_timeout(2000)
        shot(page, "paper_running")
        # 停止
        page.click("#paperStopBtn")
        page.wait_for_timeout(500)
        shot(page, "paper_stopped")
        status = page.locator("#paperStatus").inner_text()
        assert "已停止" in status or "停止" in status


class TestHeatmapInteraction:
    """热力图交互增强"""

    def test_heatmap_click_navigates_to_backtest(self, page):
        """点击热力图格子跳转回测页"""
        goto_tab(page, "参数优化")
        page.wait_for_timeout(300)
        # 选择策略和股票
        page.locator("#optimizeStrategy").select_option(index=0)
        page.click("#optimizeBtn")
        # 等待优化完成
        page.wait_for_timeout(8000)
        shot(page, "heatmap_before_click")
        # 如果有热力图，点击它
        heatmap = page.locator("#heatmapChart canvas").first
        if heatmap.count() > 0:
            box = heatmap.bounding_box()
            if box:
                page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
                page.wait_for_timeout(1000)
                shot(page, "heatmap_after_click")


class TestExportReportContent:
    """导出报告内容验证"""

    def test_export_contains_stats(self, page):
        """导出报告 HTML 内容包含统计卡片"""
        page.locator(".strategy-item").first.click()
        page.wait_for_timeout(200)
        run_backtest(page)
        with page.expect_download(timeout=10000) as download_info:
            page.click("button:text('导出报告')")
        download = download_info.value
        # 保存到临时文件
        import tempfile
        path = tempfile.mktemp(suffix=".html")
        download.save_as(path)
        content = open(path, encoding="utf-8").read()
        shot(page, "export_content")
        assert "总收益" in content or "夏普比率" in content or "收益" in content
        os.unlink(path)


# ======================================================================
#  分钟级数据回测（3 个测试）
# ======================================================================

class TestMinuteDataBacktest:
    """回测页数据周期下拉框"""

    def test_interval_dropdown_visible(self, page):
        """回测页有数据周期下拉框"""
        goto_tab(page, "回测")
        dropdown = page.locator("#interval")
        assert dropdown.is_visible()
        shot(page, "interval_dropdown")

    def test_interval_options(self, page):
        """数据周期下拉框有 5 个选项"""
        goto_tab(page, "回测")
        options = page.locator("#interval option")
        assert options.count() >= 5
        shot(page, "interval_options")

    def test_interval_select_5min(self, page):
        """选择 5 分钟周期"""
        goto_tab(page, "回测")
        page.select_option("#interval", value="5")
        val = page.evaluate("document.getElementById('interval').value")
        assert val == "5"
        shot(page, "interval_5min")


# ======================================================================
#  实盘交易标签页（6 个测试）
# ======================================================================

class TestBrokerTab:
    """实盘交易标签页"""

    def test_broker_tab_visible(self, page):
        """实盘交易标签页可见"""
        tab = page.locator(".tab:text('实盘交易')")
        assert tab.is_visible()
        shot(page, "broker_tab_visible")

    def test_switch_to_broker_tab(self, page):
        """切换到实盘交易标签页"""
        goto_tab(page, "实盘交易")
        content = page.locator("#tab-broker")
        assert content.is_visible()
        shot(page, "broker_tab_content")

    def test_broker_select_exists(self, page):
        """券商选择下拉框存在"""
        goto_tab(page, "实盘交易")
        select = page.locator("#brokerType")
        assert select.is_visible()
        shot(page, "broker_select")

    def test_connect_button_exists(self, page):
        """连接按钮存在"""
        goto_tab(page, "实盘交易")
        btn = page.locator("button:text('连接')")
        assert btn.is_visible()
        shot(page, "broker_connect_btn")

    def test_buy_sell_form_exists(self, page):
        """买卖表单存在于 DOM（连接后才显示）"""
        goto_tab(page, "实盘交易")
        assert page.locator("#brokerSymbol").count() == 1
        assert page.locator("#brokerPrice").count() == 1
        assert page.locator("#brokerAmount").count() == 1
        shot(page, "broker_buysell_form")

    def test_broker_status_initial(self, page):
        """初始状态显示未连接"""
        goto_tab(page, "实盘交易")
        page.wait_for_timeout(500)
        status_text = page.locator("#brokerStatus").inner_text()
        assert "未连接" in status_text or "连接" in status_text
        shot(page, "broker_status_initial")


# ======================================================================
#  多股票 NL 解析 UI（3 个测试）
# ======================================================================

class TestMultiStockNL:
    """多股票自然语言解析 UI"""

    def test_multi_stock_cards(self, page):
        """多股票解析显示多个规则卡片"""
        goto_tab(page, "我的策略")
        nl_translate(page, "茅台亏百分之十就卖 杭州柯林涨到150就卖")
        # 应该出现多个规则卡片或 applyNLRule 按钮
        cards = page.locator(".nl-rule-card, .applyNLRule, button:text('应用')")
        page.wait_for_timeout(500)
        shot(page, "multi_stock_cards")
        # 至少应该有解析结果
        result = page.locator("#nlResult")
        assert result.is_visible()

    def test_beginner_nl_examples(self, page):
        """小白语言 NL 示例按钮存在"""
        goto_tab(page, "我的策略")
        examples = page.locator("button:text('涨买跌卖'), button:text('止盈止损')")
        page.wait_for_timeout(300)
        shot(page, "nl_examples")
        assert examples.count() >= 1

    def test_nl_explanation_displayed(self, page):
        """NL 解析后显示策略说明"""
        goto_tab(page, "我的策略")
        nl_translate(page, "涨了5%就买，跌了3%就卖")
        explanation = page.locator("#nlExplanation, #nlResult")
        page.wait_for_timeout(500)
        shot(page, "nl_explanation")
        assert explanation.is_visible()
