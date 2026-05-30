#!/bin/bash
# 全量 UI 自动化测试一键运行脚本
# 用法: ./run_ui_tests.sh [--report] [--headed] [--no-shot] [--parallel N]
#   --report     生成 HTML 测试报告
#   --headed     有头模式运行浏览器（调试用）
#   --no-shot    禁用截图（提速 20-50 秒）
#   --parallel N 多进程并行测试（默认 4，推荐 2-4）

set -e

PORT=8000
VENV_PYTHON="venv/bin/python"
REPORT_DIR="test-reports"
SCREENSHOT_DIR="screenshots"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $1"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $1"; }

# ---- 参数解析 ----
GENERATE_REPORT=false
PARALLEL_WORKERS=0
while [ $# -gt 0 ]; do
  case $1 in
    --report) GENERATE_REPORT=true; shift ;;
    --headed) export HEADED=1; shift ;;
    --no-shot) export UI_SHOT=0; shift ;;
    --parallel) PARALLEL_WORKERS=$2; shift 2 ;;
    *) shift ;;
  esac
done

# ---- 前置检查 ----
if [ ! -f "$VENV_PYTHON" ]; then
  err "未找到 venv，请先创建虚拟环境: python -m venv venv && venv/bin/pip install -r requirements.txt"
  exit 1
fi

# 检查 playwright
$VENV_PYTHON -c "from playwright.sync_api import sync_playwright" 2>/dev/null || {
  err "Playwright 未安装，正在安装..."
  venv/bin/pip install playwright
  venv/bin/playwright install chromium
}

# ---- 清理函数 ----
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    log "停止服务 (PID: $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---- 杀掉占用端口的进程 ----
if lsof -ti:$PORT >/dev/null 2>&1; then
  warn "端口 $PORT 被占用，正在释放..."
  kill $(lsof -ti:$PORT) 2>/dev/null || true
  sleep 1
fi

# ---- 启动服务 ----
log "启动 FastAPI 服务 (端口 $PORT)..."
$VENV_PYTHON -m uvicorn api.main:app --port $PORT --host 0.0.0.0 &
SERVER_PID=$!

# 等待服务就绪
log "等待服务就绪..."
for i in $(seq 1 15); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/ 2>/dev/null | grep -q "200"; then
    log "服务就绪"
    break
  fi
  if [ "$i" -eq 15 ]; then
    err "服务启动超时"
    exit 1
  fi
  sleep 1
done

# ---- 清理旧截图 ----
mkdir -p "$SCREENSHOT_DIR"

# ---- 运行测试 ----
log "开始运行 UI 测试..."
echo ""

PYTEST_ARGS="-v --tb=short tests/test_ui_full.py"

if [ "$PARALLEL_WORKERS" -gt 0 ]; then
  PYTEST_ARGS="$PYTEST_ARGS -n $PARALLEL_WORKERS --dist=loadgroup"
  log "并行模式: $PARALLEL_WORKERS workers"
fi

if [ "$GENERATE_REPORT" = true ]; then
  mkdir -p "$REPORT_DIR"
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  REPORT_FILE="$REPORT_DIR/ui_report_${TIMESTAMP}.html"
  PYTEST_ARGS="$PYTEST_ARGS --html=$REPORT_FILE --self-contained-html"
  log "报告将保存到: $REPORT_FILE"
fi

set +e
$VENV_PYTHON -m pytest $PYTEST_ARGS
TEST_EXIT=$?
set -e

echo ""

# ---- 结果汇总 ----
SCREENSHOT_COUNT=$(ls -1 "$SCREENSHOT_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')

if [ $TEST_EXIT -eq 0 ]; then
  log "全部测试通过"
else
  err "存在失败的测试 (exit code: $TEST_EXIT)"
fi

log "截图数量: $SCREENSHOT_COUNT 张 ($SCREENSHOT_DIR/)"

if [ "$GENERATE_REPORT" = true ] && [ -f "$REPORT_FILE" ]; then
  log "HTML 报告: $REPORT_FILE"
fi

exit $TEST_EXIT
