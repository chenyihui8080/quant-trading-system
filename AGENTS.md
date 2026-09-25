# Quant Trading System - Agent 协作与开发规约 (AGENTS.md)

## 1. 前端 UI 绝对铁律 (所有样式必须 100% 经过 Element Plus)
- **全站全控件 Element Plus 化**: 全栈所有页面（Alpha 系统、复盘工作台、穿透实验室、策略配置）的**全部输入框、下拉框、复选框、单选框、日期选择器、按钮、标签、表格、卡片与弹窗**，必须无一例外全量过 Element Plus 浅色工业级标准。
- **严禁粗糙原生与暗黑孤岛**: 
  - **Checkbox 复选框**: 必须是纯白底色（`#ffffff`）、浅灰细边框（`#dcdfe6`），严禁操作系统暗黑方块；选中态必须为品牌蓝（`#409eff`）配纯白标准对勾；
  - **Radio 单选框**: 纯白圆底配品牌蓝同心圆；
  - **Select 下拉框**: 纯白底、细边框、Element Plus 专属 Chevron-down 浅灰箭头，彻底抹平粗糙原生三角；
  - **DatePicker 日历**: 胶囊容器与纯白下拉浮层，禁止原生 outline 和任何黑底弹窗；
  - **Table 表格**: 表头 `#fafafa`，行悬停 `#f5f7fa`，边框 `#ebeef5`。
- **缓存规约**: 修改 CSS/JS 样式后，必须同步在模板（`index.html`）中递增资源版本号（`?v=...`）。

完整规则详见规约中心：[.agents/rules/element_plus_ui_rules.md](file:///Users/chen/Desktop/MyProject/量化/.agents/rules/element_plus_ui_rules.md)。

## 2. 后端规范 (Python / FastAPI)
- 保持接口轻量、高内聚，数据回测引擎必须经过严格边界验证。
- 遵循统一 JSON 返回结构：`{"success": true, "result": ...}` 或 `{"success": false, "error": ...}`。

## 3. 语言与交互
- 全中文交互与代码注释。
