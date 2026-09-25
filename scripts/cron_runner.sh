#!/bin/bash
# ==============================================================================
# 量化决策中枢 定时飞轮触发器 (Hermes / Crontab 调度适配)
# 支持动作: premarket (08:30) | morning (09:15) | tail (14:30) | review (15:05) | tune (15:30)
# ==============================================================================

ACTION=$1
TARGET_PORT="${PORT:-${QUANT_PORT:-8000}}"
SERVER_URL="http://127.0.0.1:${TARGET_PORT}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/cron_trigger.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Hermes Cron] Triggering action: $ACTION on port $TARGET_PORT" >> "$LOG_FILE"

# 1. 检查 FastAPI 量化服务是否存活
HEALTH_CHECK=$(curl -s --max-time 3 "$SERVER_URL/api/health" 2>/dev/null)
if [[ -z "$HEALTH_CHECK" ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [CRITICAL] Quant server on port $TARGET_PORT is down! Auto reviving via start_server.py..." >> "$LOG_FILE"
    cd "$PROJECT_ROOT"
    nohup python3 start_server.py >> "$LOG_DIR/quant_supervisor.log" 2>&1 &
    sleep 5
fi

# 2. 根据不同时间节点触发对应飞轮端点
case "$ACTION" in
    premarket)
        # 08:30 盘前博弈预案
        RESP=$(curl -s -X POST "$SERVER_URL/api/prediction/force_premarket")
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Premarket Response: $RESP" >> "$LOG_FILE"
        echo "08:30 Premarket Completed: $RESP"
        ;;
    morning)
        # 09:15 早盘战法自动扫描入库
        RESP=$(curl -s -X POST "$SERVER_URL/api/prediction/force_morning_scan")
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Morning Scan Response: $RESP" >> "$LOG_FILE"
        echo "09:15 Morning Scan Completed: $RESP"
        ;;
    tail)
        # 14:30 尾盘决战选股与预测建档
        RESP=$(curl -s -X POST "$SERVER_URL/api/prediction/force_tail_scan")
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Tail Scan Response: $RESP" >> "$LOG_FILE"
        echo "14:30 Tail Scan Completed: $RESP"
        ;;
    review)
        # 15:05 盘后打脸对账核算
        RESP=$(curl -s -X POST "$SERVER_URL/api/prediction/force_review_all")
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Review All Response: $RESP" >> "$LOG_FILE"
        echo "15:05 Review All Completed: $RESP"
        ;;
    tune)
        # 15:30 战法胜率自适应调优
        RESP=$(curl -s -X POST "$SERVER_URL/api/prediction/force_tuning")
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Tuning Response: $RESP" >> "$LOG_FILE"
        echo "15:30 Tuning Completed: $RESP"
        ;;
    *)
        echo "Usage: $0 {premarket|morning|tail|review|tune}"
        exit 1
        ;;
esac
