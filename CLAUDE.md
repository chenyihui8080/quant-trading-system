# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

基于 **FastAPI + vnpy + ECharts + SQLite** 的全栈量化交易平台，支持 A 股/港股/美股回测、自然语言策略编辑、模拟盘、实盘下单，以及一个独立的「交易复盘工作台」子系统。

**两个相互独立的 FastAPI 服务：**

| 服务 | 入口 | 端口 | 说明 |
|------|------|------|------|
| 量化主系统 | `api.main:app` | 8000（`start.command`/Docker 用 18000） | 回测、行情、策略、风控、模拟/实盘交易 |
| 复盘工作台 | `review_workbench.api.main:app` | 8001 | 盘后复盘流水线（Pipeline A/B），独立运行 |

> 注意端口不一致：`config/settings.py` 和 README 写 8000，但 `start.command`、`Dockerfile`、`docker-compose.yml`、`run_ui_tests.sh` 都用 18000。开发时以 18000 为准（`start.command` 会自动杀掉占用端口的进程）。

## 常用命令

```bash
# 依赖安装（国内镜像）
pip install -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

# 启动主系统（开发，热重载）
python -m uvicorn api.main:app --host 0.0.0.0 --port 18000 --reload

# 启动复盘工作台
python -m uvicorn review_workbench.api.main:app --port 8001

# 单元 + API 测试（不启动服务，用 TestClient）
python -m pytest tests/test_unit.py tests/test_all_endpoints.py -v

# 运行单个测试
python -m pytest tests/test_unit.py::TestClassName::test_method -v

# UI 测试（Playwright，自动起服务+截图）
./run_ui_tests.sh                     # 默认无头
./run_ui_tests.sh --headed --report   # 有头 + HTML 报告

# 命令行回测
python run_backtest.py dual_ma        # 用 strategies/ 里的策略 key

# Docker
docker-compose up -d
```

## 架构

### 主系统 `api/main.py`

单文件约 100KB，集中了全部 REST/WebSocket 路由（`@app.*` 装饰器是查找端点的入口）。业务逻辑几乎都在 `utils/` 下，`main.py` 只做路由编排和参数校验。端点按业务前缀分组：`/backtest`、`/optimize`、`/portfolio`、`/risk`、`/realtime`、`/orders`、`/user-strategies`、`/broker`、`/nl`（自然语言）、`/paper-trade`、`/api/alpha`、`/api/portfolio`、`/api/review`、`/api/social` 等。

### 策略体系（`strategies/`）

- 每个策略是 `strategies/` 下独立模块，继承 `RiskStrategy`（`strategies/base.py`，继承自 vnpy 的 `CtaTemplate`）。
- 策略通过 `config/settings.py` 的 `STRATEGIES` 字典注册（key → module + class + 中文名）。**新增策略必须在此注册**。
- `RiskStrategy` 在 vnpy 基础上叠加三层风控（策略层/账户层/平台层，`utils/risk_manager.py`），子类只需实现信号逻辑，用 `buy_with_risk`/`sell_with_risk` 下单、`check_risk` 检查平仓。

### 数据层

- **SQLite**：`utils/database.py`（`data/quant.db`），提供 `get_db()` 上下文管理器 + `init_db()` 建表。表：users、backtest_records、order_records 等。
- **JSON 文件**（`data/`）：`user_strategies.json`、`stock_list.json`、`user_portfolio.json`、`strategy_versions.json` 等，保存用户自定义策略、自选股、持仓。
- **行情数据**：`data/*.csv`（每只股票一个 CSV），由 `data/download_akshare.py` 拉取（baostock/akshare）。实时行情在 `utils/realtime.py`（新浪源）。

### 前端

无构建框架，纯静态 HTML + 原生 JS + ECharts。入口 `api/templates/index.html`，按系统切分为模块：`api/templates/modules/`（header、auth_overlay、system_quant/system_alpha/system_review 三个子系统）。JS 在 `static/js/`，ECharts 通过 `echarts-entry.js` 按需 tree-shake 后用 esbuild 打包成 `static/echarts.min.js`。系统切换由 `static/js/system_switcher.js` 控制。

### 复盘工作台（`review_workbench/`）

独立于主系统的后端，用 SQLite（`data/review.db`）。核心是 `pipeline/graph.py` 的状态机有向图编排：`run_pipeline_a`（盘后复盘）/`run_pipeline_b`（盘前简报），串联 `agents/` 下的多个 agent（波动筛选、新闻搜集、因果配对、漏斗过滤、定调），节点级容错与降级跟踪在 `pipeline/degradation.py`。定时触发由 `pipeline/scheduler.py` 负责。

## 关键约定

- **认证**：JWT（`utils/auth.py`），密码 bcrypt。需登录的端点走 Bearer Token。
- **自然语言策略**：`utils/nl_parser.py`（约 40KB），正则优先解析，`LLM_API_KEY`/`LLM_API_URL`/`LLM_MODEL` 环境变量作为可选 fallback。
- **测试**：`tests/conftest.py` 用 `monkeypatch` 把 `utils.database.DB_PATH` 和 `utils.strategy_rules.STRATEGIES_FILE` 指向临时目录，保证测试隔离。`test_ui.py`/`test_ui_full.py` 是 Playwright 测试，`test_all_endpoints.py` 用 FastAPI TestClient。
- 数据库访问统一走 `utils/database.py`，禁止在 `main.py` 里直接 `sqlite3.connect`。
