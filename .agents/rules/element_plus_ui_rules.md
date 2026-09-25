# Element Plus 全栈设计系统与强制规约 (element_plus_ui_rules.md)

> **最高纲领**：本项目全站【所有页面、所有组件、所有交互控件】必须 100% 全面遵循 Element Plus (Vue 3 官方工业级组件库) 浅色规范。**严禁任何未经 Element Plus 过滤的原生浏览器粗糙控件或暗黑孤岛！**

---

## 一、全局色盘与变量基准 (Element Plus Design Tokens)

| 类别 | 官方 Hex 颜色 | 对应场景 | 悬停/激活反馈 |
| :--- | :--- | :--- | :--- |
| **品牌主色 (Primary)** | `#409eff` | 主按钮、选中态、聚焦光晕、核心高亮 | Hover: `#66b1ff`, Active: `#3a8ee6`, 浅底: `#ecf5ff` |
| **成功色 (Success)** | `#67c23a` | 盈利标签、正向达标、成功提示 | Hover: `#85ce61`, 浅底: `#f0f9eb` |
| **警告色 (Warning)** | `#e6a23c` | 风险预警、注意提示、待处理状态 | Hover: `#ebb563`, 浅底: `#fdf6ec` |
| **危险色 (Danger)** | `#f56c6c` | 亏损标签、止损触发、删除与错误 | Hover: `#f78989`, 浅底: `#fef0f0` |
| **信息色 (Info)** | `#909399` | 次要文字、未激活标签、辅助图标 | Hover: `#a6a9ad`, 浅底: `#f4f4f5` |
| **主要标题文字** | `#303133` | 页面大标题、卡片核心数字、关键字段 | 饱满沉稳、高对比度 |
| **常规正文字** | `#606266` | 表单标签、选项文字、表格常规内容 | 优雅舒适 |
| **辅助说明文字** | `#909399` | 表头文字、副标题、单位、占位符 | 柔和浅灰 |
| **基础边框** | `#dcdfe6` | 所有 Input、Select、Checkbox 默认框线 | Hover: `#c0c4cc`, Focus: `#409eff` |
| **面板浅边框** | `#e4e7ed` | Card 卡片、Dialog 弹窗、Popover 浮层 | 细腻分割 |
| **表格分割线** | `#ebeef5` | Table 内部横线、列表分界线 | 极浅细线 |
| **核心容器底色** | `#ffffff` | 纯白卡片、纯白输入框、纯白浮层 | 严禁使用暗黑背景 |
| **页面大底色** | `#f5f7fa` | 全局背景 | 浅灰明亮工业质感 |

---

## 二、所有表单控件 (Form Controls) 全量规约

### 1. Checkbox 复选框 (`.el-checkbox` / `input[type="checkbox"]`)
- **强制要求**：全部经过 `appearance: none !important; -webkit-appearance: none !important;` 彻底剥离系统原生样式；
- **未选中态**：`16px * 16px`，纯白底色（`#ffffff`），浅灰边框（`#dcdfe6`），`3px` 微圆角。**严禁呈现任何操作系统深灰/黑色色块！**
- **选中态 (`:checked`)**：底色与边框统一变为品牌蓝（`#409eff`），中心渲染 45° 纯白精致对勾；
- **交互动效**：悬停微蓝边框，获焦时微弱柔和蓝晕（`box-shadow: 0 0 0 2px rgba(64,158,255,0.2)`）。

### 2. Radio 单选框 (`.el-radio` / `input[type="radio"]`)
- **未选中态**：`16px * 16px` 纯白圆形，细边框 `#dcdfe6`；
- **选中态**：品牌蓝底色 `#409eff`，中心内嵌纯白微型同心圆点（`5px * 5px`）。

### 3. Date Picker 日期选择器 (`.el-date-editor` / `.el-date-picker-dropdown`)
- **双日期胶囊 (DateRange)**：统一药丸外框，纯白背景，左侧精致浅灰日历图标，中间浅灰「至」，内部 input 必须 `border: none; outline: none; box-shadow: none;`；
- **弹出面板**：100% 纯白底色（`#ffffff`），边框 `#e4e7ed`，多层轻质立体阴影；
  - 表头年月居中加粗（`#303133`），箭头按钮悬浮浅蓝底；
  - 星期表头浅灰 `#909399`，底部分割线 `#ebeef5`；
  - 选中日期必须是品牌蓝实心圆（`#409eff`）配白字，今天带蓝色边框；
  - 底部操作栏「清除」与「今天」对齐排版。**绝对严禁弹出黑色终端风格浮层！**

### 4. Select 下拉选择器 (`select` / `.el-select`)
- 纯白背景 `#ffffff`，边框 `#dcdfe6`，圆角 `4px`，高度 `38px`，字号 `13px`；
- 自定义 Element Plus 官方标准 Chevron-down 浅灰向下箭头，**彻底抹平原生丑陋三角**；
- `option` 统一白底黑字。

### 5. Input 文本输入框 (`input[type="text|number|password|search"]`)
- 纯白背景 `#ffffff`，边框 `#dcdfe6`，圆角 `4px`，高度 `38px`，文字 `#303133`；
- 悬停边框变 `#c0c4cc`；
- 获焦统一触发官方发光特效：`border-color: #409eff !important; box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2) !important;`。

---

## 三、按钮与标签体系 (Button & Tag)

### 1. 按钮 (`.el-button` / `.btn`)
- 高度统一度量：标准 `38px`，小型 `32px`，迷你 `26px`；
- 默认按钮：白底 `#ffffff`，浅灰框 `#dcdfe6`，字色 `#606266`，hover 变浅蓝 `#ecf5ff` + 蓝字 `#409eff`；
- 品牌主按钮：`#409eff`，白字，hover `#66b1ff`；
- 成功/危险/警告按钮：严格匹配对应 Token。

### 2. 标签 (`.el-tag` / `.badge`)
- 默认采用 Element Plus 经典浅底风格：
  - Primary: 底色 `#ecf5ff`，边框 `#d9ecff`，字色 `#409eff`
  - Success: 底色 `#f0f9eb`，边框 `#e1f3d8`，字色 `#67c23a`
  - Warning: 底色 `#fdf6ec`，边框 `#faecd8`，字色 `#e6a23c`
  - Danger: 底色 `#fef0f0`，边框 `#fde2e2`，字色 `#f56c6c`
  - Info: 底色 `#f4f4f5`，边框 `#e9e9eb`，字色 `#909399`

---

## 四、卡片、表格与弹窗体系 (Card, Table & Dialog)

1. **卡片 (`.panel` / `.el-card`)**：白底 `#ffffff`，浅边框 `#e4e7ed`，圆角 `8px`，柔和轻质阴影；
2. **表格 (`.el-table` / `table.data-table`)**：
   - 表头背景 `#fafafa`，加粗文字 `#606266`，下划线 `#ebeef5`；
   - 单元格纯白底，悬停整行呈现柔和灰底 `#f5f7fa`，行高舒适（`40px~48px`）；
3. **弹窗与遮罩 (`.el-dialog` / `.el-overlay`)**：
   - 遮罩层半透明 `rgba(0,0,0,0.5)`；
   - 对话框白底 `#ffffff`，浅灰边框 `#e4e7ed`，圆角 `8px`，多层优雅投影。

---

## 五、资源缓存与开发守则 (Cache Busting)
- 任何 CSS 或 JS 样式变更，**必须同步在 `index.html` 递增版本号（`?v=20260909_vXX`）**，确保用户端跳过浏览器强缓存，立即可见最新 Element Plus 样式。
