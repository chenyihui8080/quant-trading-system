# 量化交易回测系统 v2.0

全栈量化交易平台，支持 A 股 / 港股 / 美股回测、自然语言策略编辑、模拟盘、实盘下单。

---

## 目录

- [一、系统概览](#一系统概览)
- [二、环境要求](#二环境要求)
- [三、安装部署（本地）](#三安装部署本地)
- [四、安装部署（Docker）](#四安装部署docker)
- [五、启动与访问](#五启动与访问)
- [六、用户注册与登录](#六用户注册与登录)
- [七、功能详解 — 回测](#七功能详解--回测)
- [八、功能详解 — 实时行情](#八功能详解--实时行情)
- [九、功能详解 — 我的策略（自然语言 + 条件编辑器）](#九功能详解--我的策略)
- [十、功能详解 — 策略对比](#十功能详解--策略对比)
- [十一、功能详解 — 组合回测](#十一功能详解--组合回测)
- [十二、功能详解 — 参数优化](#十二功能详解--参数优化)
- [十三、功能详解 — 风控配置与通知](#十三功能详解--风控配置与通知)
- [十四、功能详解 — 数据质量检测](#十四功能详解--数据质量检测)
- [十五、功能详解 — 模拟盘](#十五功能详解--模拟盘)
- [十六、功能详解 — 实盘交易](#十六功能详解--实盘交易)
- [十七、内置策略说明](#十七内置策略说明)
- [十八、风控体系说明](#十八风控体系说明)
- [十九、API 接口文档](#十九api-接口文档)
- [二十、测试说明](#二十测试说明)
- [二十一、配置说明](#二十一配置说明)
- [二十二、目录结构](#二十二目录结构)
- [二十三、常见问题 FAQ](#二十三常见问题-faq)

---

## 一、系统概览

本系统是一个基于 **FastAPI + vnpy + ECharts** 的量化交易平台，主要能力：

| 能力 | 说明 |
|------|------|
| **11 种内置 CTA 策略** | 双均线、MACD、布林带、RSI、KDJ、海龟、网格、动量、均值回归、ATR、ML |
| **自然语言策略** | 输入中文如「茅台跌破1500就买，涨到1800就卖」自动生成策略规则 |
| **分钟级回测** | 支持 5/15/30/60 分钟 K 线回测，数据来自新浪财经 |
| **多市场** | A 股（22 只预置）、港股（腾讯等）、美股（AAPL/TSLA） |
| **参数优化** | 网格搜索 + 热力图可视化，点击格子自动跳转回测 |
| **组合回测** | 多策略 × 多股票等权组合 |
| **三层风控** | 策略层 → 账户层 → 平台层，实时拦截 |
| **模拟盘** | WebSocket 推送实时信号，对接新浪行情 |
| **实盘交易** | 对接银河/华泰/雪球券商客户端 |
| **推送通知** | 飞书/钉钉/微信/Server酱/邮件 5 通道 |
| **432 项测试** | 78 单元 + 115 API + 239 UI，Playwright 浏览器自动化 |

---

## 二、环境要求

### 本地运行

| 项目 | 要求 |
|------|------|
| Python | 3.12+ |
| 操作系统 | macOS / Linux / Windows（WSL） |
| 内存 | ≥ 2GB |
| 磁盘 | ≥ 500MB（含依赖 + 数据） |
| 浏览器 | Chrome / Edge / Firefox（最新版） |
| 网络 | 需要访问新浪财经、baostock（首次下载股票数据） |

### Docker 运行

| 项目 | 要求 |
|------|------|
| Docker | 20.10+ |
| Docker Compose | 2.0+ |
| 内存 | ≥ 2GB（vnpy + numpy 依赖较重） |

---

## 三、安装部署（本地）

### 第 1 步：克隆项目

```bash
git clone https://github.com/chenyihui8080/quant-trading-system.git
cd quant-trading-system
```

### 第 2 步：创建虚拟环境

```bash
python3.12 -m venv venv
source venv/bin/activate        # macOS / Linux
# 或
venv\Scripts\activate           # Windows
```

### 第 3 步：安装 Python 依赖

```bash
# 使用国内镜像（推荐，速度更快）
pip install -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com -r requirements.txt

# 或直接使用官方源
pip install -r requirements.txt
```

**依赖清单（18 个包）：**

| 包名 | 版本 | 用途 |
|------|------|------|
| fastapi | 0.136.1 | Web 框架 |
| uvicorn | 0.47.0 | ASGI 服务器 |
| pydantic | 2.13.4 | 数据校验 |
| bcrypt | 5.0.0 | 密码加密 |
| PyJWT | 2.13.0 | JWT 令牌 |
| numpy | 2.4.6 | 数值计算 |
| pandas | 3.0.3 | 数据处理 |
| requests | 2.34.2 | HTTP 客户端 |
| httpx | 0.28.1 | 异步 HTTP |
| websockets | 16.0 | WebSocket |
| vnpy | 4.4.0 | 量化引擎 |
| vnpy_ctastrategy | 1.4.1 | CTA 策略模块 |
| vnpy_ctabacktester | 1.3.0 | 回测引擎 |
| vnpy_sqlite | 1.1.3 | SQLite 数据服务 |
| baostock | 0.9.1 | A 股数据源 |
| akshare | 1.18.63 | 多市场数据源 |
| easytrader | 0.23.7 | 券商接口 |

### 第 4 步：下载股票数据（可选）

首次启动时系统会自动从 baostock 下载数据，也可以手动执行：

```bash
python data/download_akshare.py
```

预置数据包括：

- **A 股（22 只）**：600519 贵州茅台、000001 平安银行、601318 中国平安、600036 招商银行、601398 工商银行、000858 五粮液、300750 宁德时代、600276 恒瑞医药、600887 伊利股份、601012 隆基绿能、002594 比亚迪、000333 美的集团、600000 浦发银行、300059 东方财富、300760 迈瑞医疗、601857 中国石油、603501 韦尔股份、002027 翰森制药、002230 科大讯飞、002415 海康威视、002050 三花智控、000568 泸州老窖
- **港股（1 只）**：0700.HK 腾讯控股
- **美股（2 只）**：AAPL 苹果、TSLA 特斯拉

### 第 5 步：启动服务

```bash
# 方式 1：直接启动（推荐开发环境）
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# 方式 2：生产环境启动（不带热重载）
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
```

### 第 6 步：打开浏览器

访问 http://localhost:8000 ，看到登录页面即启动成功。

---

## 四、安装部署（Docker）

### 方式 1：docker-compose（推荐）

```bash
# 克隆项目
git clone https://github.com/chenyihui8080/quant-trading-system.git
cd quant-trading-system

# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

`docker-compose.yml` 内容：

```yaml
services:
  quant:
    build: .
    container_name: quant-backtest
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data     # 持久化股票数据，避免每次重建都重新下载
      - ./logs:/app/logs     # 持久化日志
    environment:
      - LLM_API_KEY=${LLM_API_KEY:-}     # 可选：LLM API 密钥（自然语言 fallback）
      - LLM_API_URL=${LLM_API_URL:-}     # 可选：LLM API 地址
      - LLM_MODEL=${LLM_MODEL:-}         # 可选：LLM 模型名
    restart: unless-stopped
```

### 方式 2：手动 Docker 命令

```bash
# 构建镜像
docker build -t quant-system .

# 运行容器
docker run -d \
  --name quant-backtest \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  quant-system

# 查看日志
docker logs -f quant-backtest

# 进入容器（调试用）
docker exec -it quant-backtest bash
```

### 环境变量配置（可选）

创建 `.env` 文件（Docker 会自动读取）：

```bash
# LLM 自然语言 fallback（可选，不配则使用纯正则解析）
LLM_API_KEY=sk-your-api-key-here
LLM_API_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# JWT 密钥（生产环境务必修改）
JWT_SECRET=your-very-secret-key
```

---

## 五、启动与访问

启动成功后访问地址：

| 地址 | 说明 |
|------|------|
| http://localhost:8000 | Web 界面 |
| http://localhost:8000/docs | FastAPI 自动生成的 Swagger API 文档 |
| http://localhost:8000/redoc | ReDoc API 文档 |
| ws://localhost:8000/ws | WebSocket 连接地址 |

**首次启动自动执行：**
1. 创建 SQLite 数据库（`data/quant.db`）
2. 创建默认管理员账户（admin / admin123）
3. 从 baostock 下载/更新股票数据
4. 启动 WebSocket 行情推送循环（每 30 秒）

---

## 六、用户注册与登录

### 登录页面

打开 http://localhost:8000 后会看到登录界面。

**默认管理员账户：**
- 用户名：`admin`
- 密码：`admin123`

### 注册新用户

1. 点击登录页面下方的「注册」链接
2. 输入用户名（至少 3 个字符）和密码（至少 6 个字符）
3. 点击「注册」按钮
4. 注册成功后自动跳转到主界面

### 修改密码

1. 登录后，右上角显示当前用户名
2. 点击用户名 → 修改密码
3. 输入旧密码和新密码 → 提交

---

## 七、功能详解 — 回测

### 操作步骤

1. 点击顶部导航栏 **「回测」** 标签页
2. 左侧面板选择策略（共 11 种，点击选中高亮）
3. 顶部表单填写参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| 股票代码 | 支持代码/名称/拼音搜索，下拉选择 | 600519（贵州茅台） |
| 初始资金 | 回测起始资金 | 1,000,000 |
| 回测天数 | 历史数据天数 | 365 |
| K 线周期 | 5min / 15min / 30min / 60min（分钟级） | 日线 |

4. 点击 **「开始回测」** 按钮
5. 等待 2-5 秒，查看结果

### 回测结果说明

回测完成后显示以下内容：

**12 项统计指标（卡片展示）：**

| 指标 | 说明 |
|------|------|
| 总收益率 | (期末资金 - 初始资金) / 初始资金 × 100% |
| 总盈亏 | 期末资金 - 初始资金（元） |
| 期末资金 | 初始资金 + 总盈亏 |
| 年化收益 | 年化后的收益率 |
| 夏普比率 | 超额收益 / 收益标准差（>1 为佳） |
| 最大回撤 | 从最高点到最低点的最大跌幅 |
| 回撤天数 | 最大回撤持续的天数 |
| 交易次数 | 回测期间总交易次数 |
| 盈利天数 | 日收益为正的天数 |
| 亏损天数 | 日收益为负的天数 |
| 日均盈亏 | 平均每日盈亏金额 |
| 手续费 | 总手续费 |

**3 个图表：**

1. **资金曲线图**：展示账户权益随时间变化，可缩放拖动
2. **K 线图**：展示价格走势 + 买入点（红色上箭头）+ 卖出点（绿色下箭头）
3. **持仓区域**：K 线图上的阴影区域表示持仓期间

### 快捷键

- `Ctrl/Cmd + Enter`：在回测页面直接运行回测

---

## 八、功能详解 — 实时行情

### 操作步骤

1. 点击顶部 **「实时行情」** 标签页
2. 选择或搜索股票
3. 点击 **「查看行情」** 获取实时价格
4. 点击 **「刷新行情」** 更新数据

### 功能详情

- **K 线图**：带 MA5 / MA10 / MA20 均线叠加，下方成交量柱状图
- **时间范围**：60 天 / 120 天 / 1 年 / 2 年 / 全部
- **股票搜索**：支持代码（600519）、名称（贵州茅台）、拼音（gzmt）模糊搜索
- **添加股票**：输入代码后点击「添加股票」下载历史数据到本地

### 数据源自动降级

系统按优先级依次尝试：
1. **新浪财经**（实时，A 股/港股/美股）
2. **baostock**（T+1 日延迟，A 股）
3. **yfinance**（Yahoo Finance，全球市场）
4. **本地 CSV**（已下载的历史数据）

---

## 九、功能详解 — 我的策略

点击 **「我的策略」** 标签页，包含 3 个子区域：

### 9.1 自然语言输入（最左侧）

在文本框中用中文描述买卖规则，系统自动解析为策略条件。

**7 个快捷示例按钮：**

| 按钮 | 输入示例 | 解析结果 |
|------|----------|----------|
| 涨买跌卖 | 涨3%就买，跌2%就卖 | 买入：涨幅 > 3%；卖出：跌幅 > 2% |
| 止盈止损 | 赚够10%就卖，亏5%割肉 | 止盈：+10%；止损：-5% |
| 抄底逃顶 | 跌到底就买，涨到顶就卖 | 买入：价格创 N 日新低；卖出：创 N 日新高 |
| 整数关口 | 跌到3000就买，涨到3500就卖 | 买入：价格 < 3000；卖出：价格 > 3500 |
| 均线交叉 | 5日均线上穿20日均线买，死叉卖 | 金叉买入，死叉卖出 |
| RSI高低 | RSI低于30买，高于70卖 | RSI < 30 买入，RSI > 70 卖出 |
| MACD | MACD金叉买，死叉卖 | MACD > Signal 且 MACD > 0 买入 |

**支持的自然语言模式（30+ 种）：**

```
# 百分比类
涨5%就买           # 涨幅 > 5% 买入
跌3%就卖           # 跌幅 > 3% 卖出
亏10%割肉          # 止损 -10%
赚够20%就跑        # 止盈 +20%

# 均线类
5日均线上穿20日均线买   # MA 金叉
均线死叉就卖           # MA 死叉
突破60日均线买入       # 价格 > MA60

# 指标类
RSI低于20买入        # RSI < 20
MACD金叉买入         # MACD 上穿信号线
KDJ的J值低于0买      # KDJ J < 0
布林带下轨买入       # 价格 < 布林下轨

# 价格类
跌到1500就买         # 价格 < 1500
涨过2000就卖         # 价格 > 2000

# 成交量类
放量突破买入         # 成交量 > 均量 × 2
缩量下跌卖出         # 成交量 < 均量 × 0.5

# 复合类
放量突破10日高点买入   # 拆分为成交量 + 突破两个条件

# 口语化表达
涨疯了就卖           # 涨幅很大时卖出
跌麻了就补仓         # 大跌时买入
回本了就卖           # 回到成本价卖出
```

**多股票规则（进阶）：**

```
茅台跌破1500就买，涨到1800就卖
比亚迪涨5%就卖
宁德时代亏8%割肉
```

系统自动识别股票名称并分别生成策略。

**LLM 降级**：正则无法解析时（如非常口语化的描述），可配置 LLM API 进行智能解析。

### 9.2 条件编辑器（中间区域）

可视化编辑买入/卖出条件，无需写代码。

**操作步骤：**

1. 点击 **「添加买入条件」** 或 **「添加卖出条件」**
2. 每个条件行由以下部分组成：
   - **左侧类型**：指标（如 MA、RSI）或固定值
   - **指标选择**：下拉选择 21 种技术指标之一
   - **参数设置**：如 MA 周期 = 20
   - **运算符**：>、<、>=、<=、==、上穿（cross_above）、下穿（cross_below）
   - **右侧类型**：指标或固定数值
   - **右侧值**：另一个指标或输入数字
3. 可添加多个条件（AND 关系）
4. 点击 **「应用规则」** 将自然语言解析结果填入编辑器

**21 种可用指标：**

| 指标 | 说明 | 参数 |
|------|------|------|
| close | 收盘价 | 无 |
| open | 开盘价 | 无 |
| high | 最高价 | 无 |
| low | 最低价 | 无 |
| ma | 简单移动平均线 | period（默认 20） |
| ema | 指数移动平均线 | period（默认 20） |
| wma | 加权移动平均线 | period（默认 20） |
| rsi | 相对强弱指标 | period（默认 14） |
| macd | MACD 指标 | fast=12, slow=26, signal=9 |
| boll | 布林带（上轨/中轨/下轨） | period=20, dev=2.0 |
| kdj | KDJ 随机指标 | period=9 |
| atr | 平均真实波幅 | period=14 |
| cci | 商品通道指数 | period=14 |
| volume | 成交量 | 无 |
| vol_ma | 成交量均线 | period（默认 20） |
| vol_ratio | 量比（当前量/均量） | period（默认 5） |
| obv | 能量潮指标 | 无 |
| highest | N 日最高价 | period（默认 20） |
| lowest | N 日最低价 | period（默认 20） |
| donchian | 唐奇安通道（上/中/下） | period（默认 20） |
| return | 收益率（%） | period（默认 1） |

**7 种运算符：**

| 运算符 | 说明 |
|--------|------|
| > | 大于 |
| < | 小于 |
| >= | 大于等于 |
| <= | 小于等于 |
| == | 等于 |
| cross_above | 上穿（从下方突破上方） |
| cross_below | 下穿（从上方跌破下方） |

### 9.3 策略列表（右侧）

显示所有已创建的策略，每个策略卡片包含：

- **策略名称** + 股票代码 + 市场标签
- 买入/卖出条件数量
- 启用/禁用开关
- **「评估」** 按钮：用最新数据运行策略，显示当前信号（买入/卖出/观望）
- **「删除」** 按钮

### 9.4 预设模板（底部）

8 种一键加载的策略模板：

| 模板名 | 说明 |
|--------|------|
| 海龟交易 | 唐奇安通道突破策略 |
| 布林带突破 | 价格突破布林带上/下轨 |
| 量价突破 | 成交量放大 + 价格突破 N 日高点 |
| 动量策略 | N 日收益率动量 |
| MACD 金叉 | MACD 线上穿信号线 |
| CCI 超买超卖 | CCI > 100 卖出，CCI < -100 买入 |
| 均线多头排列 | MA5 > MA10 > MA20 > MA60 |
| 跌幅反弹 | 连续下跌 N 天后买入 |

**使用方法：**
1. 在模板卡片的股票代码输入框填写目标股票
2. 点击「加载模板」
3. 条件自动填入编辑器，可在此基础上修改
4. 点击「保存策略」

---

## 十、功能详解 — 策略对比

### 操作步骤

1. 点击顶部 **「策略对比」** 标签页
2. 选择股票代码（默认 600519）
3. 设置回测天数（默认 365 天）
4. 点击 **「运行对比」**
5. 等待系统依次运行全部 11 种策略

### 结果说明

表格展示每种策略的：

| 列 | 说明 |
|----|------|
| 策略名称 | 双均线 / MACD / 布林带 / ... |
| 总收益率 | 最高 = 绿色，最低 = 红色 |
| 夏普比率 | 最高 = 绿色，最低 = 红色 |
| 最大回撤 | 最小 = 绿色，最大 = 红色 |
| 期末资金 | 最高 = 绿色，最低 = 红色 |
| 交易次数 | 该策略的交易频率 |
| 年化收益 | 年化后的收益率 |

**颜色含义：** 绿色 = 该列最优，红色 = 该列最差，方便快速识别最佳策略。

---

## 十一、功能详解 — 组合回测

### 操作步骤

1. 点击顶部 **「组合回测」** 标签页
2. 勾选多个策略（可选 1-11 个）
3. 输入多个股票代码（逗号分隔，如 `600519,000001,601318`）
4. 设置初始资金
5. 点击 **「运行组合回测」**

### 结果说明

- **策略 × 股票矩阵表**：每个策略在每只股票上的收益率
- **组合权益曲线**：双 Y 轴图表（左轴资金，右轴收益率%），等权分配

---

## 十二、功能详解 — 参数优化

### 操作步骤

1. 点击顶部 **「参数优化」** 标签页
2. 选择策略（下拉列表，10 种可优化策略）
3. 选择股票代码
4. 设置回测天数
5. 点击 **「运行优化」**

### 结果说明

- **Top 10 排名表**：按夏普比率排序，显示参数组合 + 收益率 + 回撤
- **热力图**：可视化参数搜索空间
  - X 轴 / Y 轴 = 两个关键参数
  - 颜色深浅 = 夏普比率或总收益率（可切换）
  - **点击热力图格子** → 自动跳转到回测页面，填入对应参数并运行

### 各策略优化参数范围

| 策略 | 参数 1 | 参数 2 |
|------|--------|--------|
| 双均线 | fast_window: 5-20 | slow_window: 20-60 |
| MACD | fast: 8-16 | slow: 20-35 |
| 布林带 | window: 15-30 | dev: 1.5-3.0 |
| RSI | period: 10-20 | oversold: 20-40 |
| KDJ | period: 7-14 | oversold: 15-30 |
| 海龟 | entry: 15-30 | exit: 8-15 |
| 网格 | grid_pct: 2-5 | max_grids: 3-8 |
| 动量 | lookback: 10-30 | threshold: 3-8 |
| 均值回归 | entry_std: 1.5-3.0 | exit_std: 0.3-1.0 |
| ATR | multiplier: 1.5-3.0 | ma_period: 30-60 |

---

## 十三、功能详解 — 风控配置与通知

### 13.1 风控参数

点击 **「风控配置」** 标签页，设置 6 个风控参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| 止损百分比 | 亏损达到此比例强制平仓 | -5% |
| 止盈百分比 | 盈利达到此比例强制平仓 | +15% |
| 追踪止损 | 从最高点回落此比例平仓 | -8% |
| 最大回撤 | 账户回撤达到此比例停止交易 | -20% |
| 单笔仓位 | 单笔交易最大资金占比 | 30% |
| 初始资金 | 回测初始资金 | 1,000,000 |

**保存方式：** 点击「保存」，数据存储在浏览器 localStorage，下次打开自动加载。

### 13.2 推送通知配置

同一页面下方，配置 5 种推送通道：

**飞书机器人：**
1. 在飞书群组中添加自定义机器人
2. 复制 Webhook URL 填入「飞书 Webhook」
3. 如设置了签名校验，填入「飞书签名密钥」

**Server酱：**
1. 登录 https://sct.ftqq.com/ 获取 SendKey
2. 填入「Server酱 Key」

**钉钉机器人：**
1. 在钉钉群组中添加自定义机器人
2. 复制 Webhook URL 填入

**企业微信机器人：**
1. 在企业微信群组中添加 Webhook 机器人
2. 复制 Webhook URL 填入

**邮件通知（SMTP）：**
1. 填写 SMTP 服务器地址（如 smtp.qq.com）
2. 填写端口（465 或 587）
3. 填写发件邮箱和授权码
4. 填写收件邮箱

配置完成后点击 **「测试通知」** 发送测试消息到所有已配置通道。

---

## 十四、功能详解 — 数据质量检测

### 操作步骤

1. 点击 **「数据质量」** 标签页
2. 点击 **「检测数据质量」**
3. 等待系统扫描所有 CSV 数据文件

### 检测项目（8 项）

| 检测项 | 严重度 | 说明 |
|--------|--------|------|
| 缺少日期列 | 严重（-20 分） | CSV 文件中无 date 列 |
| 空值 | 警告（-5 分） | 存在 NaN / null 数据 |
| 日期间隔过大 | 警告（-5 分） | 两个交易日间隔 > 3 天（排除节假日） |
| 负价格 | 严重（-20 分） | 开/高/低/收出现负数 |
| OHLC 逻辑错误 | 严重（-20 分） | 最高价 < 最低价 |
| 收盘价越界 | 警告（-5 分） | 收盘价不在最高-最低区间内 |
| 单日涨跌幅 > 11% | 提示（-1 分） | 可能是异常数据（A 股涨跌停限制 10%） |
| 零成交量 | 提示（-1 分） | 当日成交量为 0 |
| 重复日期 | 严重（-20 分） | 同一日期出现多条记录 |

**质量评分：** 满分 100，根据发现问题扣分。颜色标识：绿色 ≥ 80 分，橙色 ≥ 60 分，红色 < 60 分。

点击 **「详情」** 查看每个问题的具体位置和说明。

---

## 十五、功能详解 — 模拟盘

### 操作步骤

1. 点击顶部 **「模拟盘」** 标签页
2. 选择策略（11 种内置策略）
3. 输入股票代码（如 `600519`）
4. 设置刷新间隔（秒，默认 10 秒）
5. 点击 **「启动模拟盘」**
6. 实时信号表格自动更新

### 信号表格说明

| 列 | 说明 |
|----|------|
| 时间 | 信号产生时间 |
| 操作 | 买入（红色）/ 卖出（绿色）|
| 价格 | 当时价格 |
| 涨跌幅 | 相对上一次信号的价格变化 |
| 持仓 | 当前持仓状态（持仓/空仓）|
| 盈亏% | 持仓期间盈亏百分比 |

### 工作原理

1. 系统每 N 秒从新浪财经获取最新行情
2. 将行情转换为 vnpy BarData
3. 用策略引擎处理 bar，生成交易信号
4. 通过 WebSocket 实时推送到前端
5. 最多保留最近 50 条信号记录

### 停止模拟盘

点击 **「停止模拟盘」**，信号推送停止。

---

## 十六、功能详解 — 实盘交易

> ⚠️ **风险提示：实盘交易涉及真金白银，请务必充分了解风险后再操作。建议先用模拟盘验证策略。**

### 前置准备

实盘交易通过 `easytrader` 库对接券商客户端，需要：

1. **安装券商客户端**（仅 Windows 支持 easytrader）：
   - 银河证券：双子星客户端
   - 华泰证券：网上交易系统
   - 雪球：雪球组合客户端

2. **登录券商客户端**并保持运行

3. **在本系统中连接券商**：
   - 点击 **「实盘交易」** 标签页
   - 选择券商类型（银河证券 / 华泰证券 / 雪球）
   - 填写客户端 exe 路径（可选）
   - 点击 **「连接券商」**

### 交易操作

**买入：**
1. 输入股票代码（自动填充实时价格）
2. 输入/修改价格
3. 输入数量（必须为 100 的整数倍）
4. 点击 **「买入」** → 确认对话框 → 下单

**卖出：**
1. 输入股票代码
2. 输入价格和数量
3. 点击 **「卖出」** → 确认对话框 → 下单

**撤单：**
- 在当前委托列表中找到要撤销的订单
- 点击 **「撤单」**

### 账户信息

- **资金余额**：可用资金、总资产、持仓市值
- **当前持仓**：股票代码、持仓数量、成本价、盈亏
- **当日委托**：委托编号、买卖方向、价格、数量、状态

---

## 十七、内置策略说明

### 17.1 双均线策略（dual_ma）

| 项目 | 说明 |
|------|------|
| 原理 | 短期均线上穿长期均线（金叉）买入，下穿（死叉）卖出 |
| 参数 | fast_window=10（短期均线周期）、slow_window=30（长期均线周期）|
| 适用 | 趋势行情，震荡行情效果差 |
| 代码 | `strategies/dual_ma.py` |

### 17.2 MACD 策略（macd）

| 项目 | 说明 |
|------|------|
| 原理 | MACD 线上穿信号线且 MACD > 0 时买入，下穿信号线卖出 |
| 参数 | fast_period=12、slow_period=26、signal_period=9 |
| 适用 | 中期趋势判断 |
| 代码 | `strategies/macd.py` |

### 17.3 布林带策略（bollinger）

| 项目 | 说明 |
|------|------|
| 原理 | 价格突破上轨买入（强势突破），跌破中轨卖出（趋势反转）|
| 参数 | boll_window=20、boll_dev=2.0 |
| 适用 | 波动率较高的品种 |
| 代码 | `strategies/bollinger.py` |

### 17.4 RSI 策略（rsi）

| 项目 | 说明 |
|------|------|
| 原理 | RSI 低于 oversold 买入（超卖反弹），高于 overbought 卖出（超买回落）|
| 参数 | rsi_period=14、oversold=30、overbought=70 |
| 适用 | 震荡行情，趋势行情可能频繁止损 |
| 代码 | `strategies/rsi.py` |

### 17.5 KDJ 策略（kdj）

| 项目 | 说明 |
|------|------|
| 原理 | J 值 < oversold 且 K > D 买入；J > overbought 且 K < D 卖出 |
| 参数 | kdj_period=9、oversold=20、overbought=80 |
| 适用 | 短线超买超卖判断 |
| 代码 | `strategies/kdj.py` |

### 17.6 海龟策略（turtle）

| 项目 | 说明 |
|------|------|
| 原理 | 价格突破 N 日最高价买入（唐奇安通道突破），跌破 M 日最低价卖出 |
| 参数 | entry_window=20、exit_window=10 |
| 适用 | 强趋势行情，大周期交易 |
| 代码 | `strategies/turtle.py` |

### 17.7 网格策略（grid）

| 项目 | 说明 |
|------|------|
| 原理 | 在基准价上下按百分比设置网格，下跌一格买入一份，上涨一格卖出一份 |
| 参数 | grid_pct=3.0（网格间距%）、max_grids=5（最大网格层数）|
| 适用 | 震荡行情，不适合单边趋势 |
| 代码 | `strategies/grid.py` |

### 17.8 动量策略（momentum）

| 项目 | 说明 |
|------|------|
| 原理 | 计算 N 日收益率，高于阈值买入（追涨），低于负阈值卖出（止损）|
| 参数 | lookback=20、buy_threshold=5%、sell_threshold=-3% |
| 适用 | 强趋势品种 |
| 代码 | `strategies/momentum.py` |

### 17.9 均值回归策略（mean_reversion）

| 项目 | 说明 |
|------|------|
| 原理 | Z-score 低于 -entry_std 买入（价格偏低），高于 entry_std 卖出（价格偏高）|
| 参数 | lookback=20、entry_std=2.0、exit_std=0.5 |
| 适用 | 有均值回归特性的品种 |
| 代码 | `strategies/mean_reversion.py` |

### 17.10 ATR 突破策略（atr_breakout）

| 项目 | 说明 |
|------|------|
| 原理 | 价格突破 MA + multiplier × ATR 且在趋势线上方时买入，跌破 MA - multiplier × ATR 卖出 |
| 参数 | atr_period=14、multiplier=2.0、ma_period=50 |
| 适用 | 波动率突破交易 |
| 代码 | `strategies/atr_breakout.py` |

### 17.11 ML 策略（ml_strategy）

| 项目 | 说明 |
|------|------|
| 原理 | 基于加权 KNN 机器学习模型（FreqAI 风格），提取 MA 比率/RSI/波动率/ATR 比率作为特征，每 20 根 bar 重新训练 |
| 参数 | lookback=50、k=15、confidence_threshold=0.55 |
| 适用 | 有足够历史数据（>100 天）的品种 |
| 特点 | 纯 numpy 实现，无 sklearn 依赖，训练速度快 |
| 代码 | `strategies/ml_strategy.py` |

---

## 十八、风控体系说明

系统采用三层风控架构，按顺序执行：

### 第一层：平台级风控（PlatformRiskGuard）

| 规则 | 说明 | 默认值 |
|------|------|--------|
| 黑名单 | ST、*ST、退市股票禁止交易 | — |
| 异常价格偏离 | 单笔价格偏离市场价超过此比例，拒绝 | 5% |
| 涨跌停限制 | A 股涨跌停 ±10%，创业板 ±20% | 10% |
| 频率限制 | 每分钟最多下单次数 | 30 次 |
| T+1 规则 | 当日买入不可当日卖出 | 启用 |

### 第二层：账户级风控（AccountRiskGuard）

| 规则 | 说明 | 默认值 |
|------|------|--------|
| 最大回撤 | 账户从最高点回撤达到此比例，停止交易 | -20% |
| 单一标的集中度 | 单只股票持仓不超过总资产的此比例 | 30% |
| 总仓位上限 | 总持仓不超过总资产的此比例 | 80% |
| 最大杠杆 | 最大杠杆倍数（A 股无杠杆，保持 1.0）| 1.0 |

### 第三层：策略级风控（StrategyRiskGuard）

| 规则 | 说明 | 默认值 |
|------|------|--------|
| 止损 | 从买入价下跌此比例强制平仓 | -5% |
| 止盈 | 从买入价上涨此比例强制平仓 | +15% |
| 追踪止损 | 从持仓最高点回落此比例强制平仓 | -8% |
| 当日最大亏损 | 当日累计亏损达到此比例停止交易 | -5% |
| 单笔最大仓位 | 单笔交易最大资金占比 | 30% |

**执行顺序：** 平台层 → 账户层 → 策略层，任何一层触发则拦截交易。

---

## 十九、API 接口文档

系统提供 57+ 个 RESTful API 端点。完整的交互式文档在 http://localhost:8000/docs 。

### 认证方式

除 `/strategies`、`/data`、`/auth/*` 外，所有端点需要 JWT Bearer Token：

```bash
# 1. 登录获取 Token
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

# 响应：{"token": "eyJhbGci...", "username": "admin"}

# 2. 使用 Token 访问受保护端点
curl http://localhost:8000/data/quality \
  -H "Authorization: Bearer eyJhbGci..."
```

### 主要端点速览

```bash
# 回测
POST /backtest              # 运行回测（返回统计摘要）
POST /backtest-detail       # 运行回测（返回 K 线 + 交易明细）

# 策略
POST /compare               # 对比所有策略
POST /optimize              # 参数优化（返回热力图数据）
POST /portfolio             # 组合回测

# 实时行情
GET  /realtime/{symbol}     # 实时报价
GET  /realtime-kline/{symbol}  # K 线数据
GET  /minute-data/{symbol}  # 分钟级 K 线

# 自然语言策略
POST /nl/parse              # 解析中文 → 策略条件
POST /nl/create-strategy    # 解析 + 创建策略一步完成

# 用户策略
GET    /user-strategies           # 列出所有策略
POST   /user-strategies           # 创建策略
POST   /user-strategies/{id}/evaluate  # 评估策略信号

# 模拟盘
POST /paper-trade/start     # 启动模拟盘
POST /paper-trade/stop      # 停止模拟盘

# 实盘交易
POST /broker/connect        # 连接券商
POST /broker/buy            # 买入下单
POST /broker/sell           # 卖出下单
POST /broker/disconnect     # 断开券商

# 数据管理
GET  /stocks/search?q=茅台   # 搜索股票
POST /stocks/add             # 添加新股票
POST /refresh-data           # 更新所有数据

# 风控
GET  /risk/config            # 获取风控配置
POST /risk/config            # 保存风控配置
POST /risk/check             # 风控检查（不下单）

# 导出
POST /export-report          # 导出 HTML 回测报告

# 数据质量
GET  /data/quality           # 检查所有股票数据质量
GET  /data/quality/{symbol}  # 检查单只股票

# 多因子
GET  /factors               # 列出 13 个因子
POST /factors/compute        # 计算单只股票因子
POST /factors/ranking        # 多因子排名
```

### WebSocket 实时推送

```javascript
// 连接
const ws = new WebSocket('ws://localhost:8000/ws');

// 订阅主题
ws.send(JSON.stringify({
  action: 'subscribe',
  topics: ['market.600519', 'paper-trade']
}));

// 接收消息
ws.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log(data);  // {topic: "market.600519", data: {...}}
};
```

**可用主题：**

| 主题 | 说明 |
|------|------|
| `market.{symbol}` | 实时行情推送（每 30 秒）|
| `strategy.signal` | 策略信号推送 |
| `risk.alert` | 风控警报推送 |
| `paper-trade` | 模拟盘信号推送 |

---

## 二十、测试说明

### 测试规模

| 测试文件 | 测试数量 | 说明 |
|----------|----------|------|
| `tests/test_unit.py` | 78 | 纯 Python 单元测试（不启动 HTTP 服务）|
| `tests/test_all_endpoints.py` | 115 | API 端点集成测试 |
| `tests/test_ui.py` | ~100 | Playwright 浏览器自动化测试（基础）|
| `tests/test_ui_full.py` | 239 | Playwright 浏览器自动化测试（全面）|
| **合计** | **432+** | |

### 运行测试

```bash
# 激活虚拟环境
source venv/bin/activate

# 运行全部单元测试 + API 测试
pytest tests/test_unit.py tests/test_all_endpoints.py -v

# 运行 UI 测试（需要先安装 Playwright）
pip install pytest-playwright
playwright install chromium
python -m pytest tests/test_ui_full.py -v

# 运行 UI 测试的快捷脚本
bash run_ui_tests.sh

# 带参数运行
bash run_ui_tests.sh --report     # 生成 HTML 报告
bash run_ui_tests.sh --headed     # 显示浏览器窗口（调试用）
bash run_ui_tests.sh --parallel   # 并行运行（更快但需要更多内存）

# 只运行某个测试类
pytest tests/test_unit.py::TestMlFeatures -v

# 只运行某个测试方法
pytest tests/test_unit.py::TestMlFeatures::test_feature_matrix_shape -v
```

### 测试覆盖范围

**单元测试（test_unit.py）：**
- ML 特征计算和 KNN 预测（8 项）
- 三层风控：止损/止盈/追踪止损/最大回撤/黑名单/频率/T+1（19 项）
- 数据质量检测（4 项）
- 推送通知（4 项）
- 自然语言解析：16 种中文模式 + 多股票解析 + 边界情况（27 项）
- 分钟数据获取（4 项）
- 券商操作（5 项）

**API 测试（test_all_endpoints.py）：**
- 认证注册/登录/profile/改密（4 项）
- 回测/详情/对比/优化/组合/导出（6 项）
- 推送通知配置 + 测试（2 项）
- 价格预警 CRUD + 触发（3 项）
- 风控配置保存/读取/检查（3 项）
- 股票管理：搜索/添加/收藏/刷新（6 项）
- 实时行情/分钟数据（3 项）
- 13 因子计算/评分/排名（4 项）
- 历史记录查询（4 项）
- WebSocket 状态（1 项）
- 订单生命周期：创建→提交→成交→取消→拒绝（7 项）
- 用户策略：CRUD + 评估 + 预设模板（8 项）
- 自然语言解析（16 种模式 + 多股票）
- 券商连接/余额/买入/卖出/撤单（8 项）

**UI 测试（test_ui_full.py）：**
- 登录/注册流程（9 项）
- 标签页导航（9 项）
- 回测页面交互（14 项）
- 实时行情页面（13 项）
- 策略编辑器（30+ 项）
- 策略对比（5 项）
- 参数优化 + 热力图点击（7 项）
- 风控配置（10 项）
- 推送通知配置（12 项）
- Toast 通知（4 项）
- 下拉菜单关闭（4 项）
- 响应式布局（4 项）
- 端到端跨页面流程（8 项）
- 图表渲染（8 项）
- 股票搜索完整流程（5 项）
- 自然语言到回测跨页面（7 项）
- 加载状态（4 项）
- 错误恢复（3 项）
- 边界值测试（10 项）
- 跨标签页同步（2 项）
- 组合回测（3 项）
- 数据质量（3 项）
- 模拟盘（5 项）
- 热力图交互（1 项）
- 分钟数据回测（3 项）
- 券商标签页（6 项）
- 多股票自然语言（3 项）

---

## 二十一、配置说明

### config/settings.py

```python
# 策略注册表（11 种）
STRATEGIES = {
    "dual_ma": { "module": "strategies.dual_ma", "class": "DualMaStrategy", "name": "双均线", ... },
    "macd":    { "module": "strategies.macd",    "class": "MacdStrategy",   "name": "MACD", ... },
    # ... 共 11 种
}

# 回测默认配置
BACKTEST_CONFIG = {
    "rate":      0.0003,   # 手续费率
    "slippage":  0.2,      # 滑点（元）
    "size":      1,        # 合约乘数
    "pricetick": 0.01,     # 最小变动价位
    "capital":   1_000_000 # 默认初始资金
}
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 签名密钥（生产环境必须修改）| 内置硬编码默认值 |
| `LLM_API_KEY` | LLM API 密钥（自然语言 fallback）| 空（不使用 LLM）|
| `LLM_API_URL` | LLM API 地址 | https://api.openai.com/v1 |
| `LLM_MODEL` | LLM 模型名 | gpt-4o-mini |
| `API_HOST` | 服务监听地址 | 0.0.0.0 |
| `API_PORT` | 服务端口 | 8000 |

### 数据库

SQLite 文件位于 `data/quant.db`，使用 WAL 模式，包含 6 张表：

```sql
-- 用户表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',    -- 'user' 或 'admin'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 回测记录
CREATE TABLE backtest_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    strategy TEXT NOT NULL,
    symbol TEXT NOT NULL,
    stats TEXT,                  -- JSON 格式统计数据
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 订单记录
CREATE TABLE order_records (...);
-- 因子记录
CREATE TABLE factor_records (...);
-- 审计日志
CREATE TABLE audit_log (...);
-- 收藏股票
CREATE TABLE user_favorites (...);
```

---

## 二十二、目录结构

```
quant-trading-system/
├── api/                          # 后端 API 模块
│   ├── main.py                   # 主入口，57+ 个 FastAPI 端点（2035 行）
│   ├── websocket.py              # WebSocket 发布/订阅管理器
│   └── templates/
│       └── index.html            # 前端单页应用（2895 行，深色主题）
│
├── config/
│   └── settings.py               # 策略注册表、回测默认参数、API 配置
│
├── data/                         # 数据目录
│   ├── *.csv                     # 25 只股票历史 K 线数据
│   ├── quant.db                  # SQLite 数据库
│   ├── stock_list.json           # baostock 股票列表缓存
│   ├── user_strategies.json      # 用户自定义策略规则
│   ├── strategy_versions.json    # 策略版本历史
│   └── download_akshare.py       # 数据下载脚本
│
├── strategies/                   # CTA 策略模块
│   ├── base.py                   # RiskStrategy 基类（集成三层风控）
│   ├── dual_ma.py                # 双均线
│   ├── macd.py                   # MACD
│   ├── bollinger.py              # 布林带
│   ├── rsi.py                    # RSI
│   ├── kdj.py                    # KDJ
│   ├── turtle.py                 # 海龟（唐奇安通道）
│   ├── grid.py                   # 网格交易
│   ├── momentum.py               # 动量
│   ├── mean_reversion.py         # 均值回归
│   ├── atr_breakout.py           # ATR 突破
│   └── ml_strategy.py            # ML KNN 机器学习策略
│
├── utils/                        # 工具模块
│   ├── auth.py                   # JWT + bcrypt 认证
│   ├── broker.py                 # 券商接口（银河/华泰/雪球）
│   ├── comparison.py             # 策略对比 + 网格搜索优化
│   ├── data_generator.py         # 合成数据 + CSV 加载器
│   ├── data_quality.py           # 数据质量 8 项检测
│   ├── database.py               # SQLite 数据库（WAL 模式，6 张表）
│   ├── factors.py                # 13 因子框架 + 加权评分
│   ├── minute_data.py            # 新浪财经分钟 K 线
│   ├── nl_parser.py              # 中文自然语言策略解析器（1020 行）
│   ├── notifier.py               # Webhook 通知（钉钉/飞书/微信）
│   ├── order_manager.py          # 订单状态机（242 行）
│   ├── push_notifier.py          # 5 通道推送系统（293 行）
│   ├── realtime.py               # 多数据源实时行情（自动降级）
│   ├── risk_manager.py           # 三层风控体系（356 行）
│   ├── stock_search.py           # 股票搜索（代码/名称/拼音）
│   ├── stock_list.py             # 多市场股票列表管理
│   └── strategy_rules.py         # 用户策略规则引擎（15 个技术指标）
│
├── tests/                        # 测试目录
│   ├── conftest.py               # pytest fixtures（临时数据库、认证头）
│   ├── test_unit.py              # 78 个单元测试
│   ├── test_all_endpoints.py     # 115 个 API 测试
│   ├── test_ui.py                # Playwright 浏览器测试（基础）
│   └── test_ui_full.py           # Playwright 浏览器测试（全面，239 个）
│
├── static/
│   └── echarts.min.js            # ECharts 按需打包版（644KB）
│
├── simnow/                       # SimNow 期货模拟盘（独立模块）
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── config.json
│   ├── simnow_trader.py
│   └── README.md
│
├── echarts-entry.js              # ECharts tree-shake 入口文件
├── package.json                  # Node.js 依赖（echarts、esbuild）
├── run_backtest.py               # 命令行回测入口
├── run_ui_tests.sh               # UI 测试启动脚本
├── Dockerfile                    # Docker 镜像定义（Python 3.12-slim）
├── docker-compose.yml            # Docker Compose 服务编排
├── requirements.txt              # Python 依赖（18 个包）
├── .dockerignore                 # Docker 构建排除规则
└── README.md                     # 本文件
```

---

## 二十三、常见问题 FAQ

### Q1：首次启动很慢？

首次启动时系统会自动从 baostock 下载 A 股数据，耗时 1-5 分钟（取决于网络）。后续启动会检查数据日期，只更新缺失的天数，几秒即可完成。

### Q2：Docker 构建 pip 超时？

项目使用阿里云镜像源（`mirrors.aliyun.com`）解决国内网络问题。如果仍然超时，检查 VPN/代理设置，或在 Dockerfile 中更换其他镜像源：

```dockerfile
# 清华源
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple/ --trusted-host pypi.tuna.tsinghua.edu.cn -r requirements.txt
```

### Q3：Docker 容器启动后 curl 返回 000？

容器启动需要几秒初始化时间（导入 vnpy + 创建数据库），等待 5-10 秒后重试：

```bash
docker-compose up -d
sleep 10
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/  # 应返回 200
```

### Q4：自然语言解析不准确？

系统使用 30+ 种正则表达式进行解析，覆盖常见中文表述。对于无法解析的输入：

1. 换一种表述方式重试（参考第九章的示例）
2. 配置 LLM API 作为降级方案（在 `.env` 中设置 `LLM_API_KEY`）
3. 直接使用条件编辑器手动添加规则

### Q5：模拟盘信号延迟？

信号延迟取决于「刷新间隔」设置（默认 10 秒）+ 新浪行情 API 响应时间（通常 0.5-2 秒）。建议设置 5-15 秒间隔，太频繁可能被限流。

### Q6：实盘交易只支持 Windows？

`easytrader` 库需要通过 COM 接口操控券商客户端 GUI，仅支持 Windows。Linux/macOS 用户可通过模拟盘验证策略，或使用 SimNow 期货模拟盘（`simnow/` 目录，仅限期货）。

### Q7：如何添加新的股票数据？

**方式 1（UI）：** 实时行情页面 → 输入股票代码 → 点击「添加股票」

**方式 2（API）：**
```bash
curl -X POST http://localhost:8000/stocks/add \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["601888", "300274"]}'
```

**方式 3（脚本）：**
```bash
python data/download_akshare.py
```

### Q8：如何只运行特定测试？

```bash
# 只运行单元测试
pytest tests/test_unit.py -v

# 只运行某个测试类
pytest tests/test_unit.py::TestNlParser -v

# 只运行匹配关键字的测试
pytest tests/ -k "broker" -v

# 运行并显示覆盖率（需安装 pytest-cov）
pytest tests/test_unit.py --cov=utils --cov=strategies -v
```

### Q9：如何修改默认管理员密码？

登录后通过 API 修改：

```bash
curl -X POST http://localhost:8000/auth/change-password \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"old_password": "admin123", "new_password": "新密码"}'
```

### Q10：如何查看 API 文档？

启动服务后访问：
- Swagger UI：http://localhost:8000/docs （可直接在页面测试 API）
- ReDoc：http://localhost:8000/redoc

### Q11：如何部署到生产环境？

1. 修改 `JWT_SECRET` 环境变量为强随机字符串
2. 不要使用默认管理员密码
3. 使用 `--host 127.0.0.1` 仅监听本地，配合 Nginx 反向代理
4. 使用 Docker Compose 部署并开启 `restart: unless-stopped`
5. 定期备份 `data/quant.db` 和 `data/*.csv`

### Q12：支持哪些市场和股票代码格式？

| 市场 | 格式 | 示例 |
|------|------|------|
| A 股沪市 | 6 位数字 | 600519、601318 |
| A 股深市 | 6 位数字 | 000001、002594 |
| A 股创业板 | 6 位数字 | 300750、300059 |
| 港股 | 数字.HK | 0700.HK、9988.HK |
| 美股 | 大写字母 | AAPL、TSLA、GOOGL |

---

## 项目链接

- **GitHub 仓库**：https://github.com/chenyihui8080/quant-trading-system
- **FastAPI 文档**：https://fastapi.tiangolo.com
- **vnpy 文档**：https://www.vnpy.com/docs
- **ECharts 文档**：https://echarts.apache.org/zh/index.html
