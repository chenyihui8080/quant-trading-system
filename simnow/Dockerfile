FROM python:3.10-slim

WORKDIR /app

# 安装编译工具（vnpy-ctp 需要 C++ 编译器）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential g++ && \
    rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖（使用清华镜像加速）
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
    vnpy vnpy-ctp vnpy-sqlite

COPY simnow_trader.py .
COPY config.json .

# 环境变量覆盖凭证（可选）
ENV SIMNOW_USER=""
ENV SIMNOW_PASS=""

CMD ["python", "simnow_trader.py"]
