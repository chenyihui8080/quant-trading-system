#!/bin/bash
# 量化交易系统 - 启动脚本
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=18000

kill_port() {
    local port=$1
    local pid=$(lsof -ti :$port)
    if [ -n "$pid" ]; then
        echo "端口 $port 被占用 (PID: $pid)，正在释放..."
        kill -9 $pid 2>/dev/null
        sleep 1
    fi
}

echo "=========================================="
echo "   量化交易系统 - 启动脚本"
echo "=========================================="

# 清理端口
kill_port $PORT

# 激活虚拟环境并启动
echo "正在启动量化交易系统..."
cd "$PROJECT_DIR"
source venv/bin/activate
python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT

echo "✅ 量化交易系统已启动: http://localhost:$PORT"
