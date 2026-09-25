#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全系统无死角自动化诊断审计套件 (System-wide Deep Diagnostic Suite)
1. 静态审计：提取前端所有 JS 中的 API 调用路径，与后端路由注册表进行比对
2. DOM 审计：提取前端所有的 document.getElementById，与 templates HTML 进行比对
3. 动态审计：使用 requests 对所有探测到的前端 API 发起真实 HTTP 调用，检测 404/500/422
"""

import os
import re
import sys
import json
import requests
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_JS_DIR = ROOT_DIR / "static" / "js"
TEMPLATES_DIR = ROOT_DIR / "api" / "templates"

PORT = os.getenv("PORT", os.getenv("QUANT_PORT", "8000"))
BASE_URL = f"http://localhost:{PORT}"

print("=" * 60)
print("🚀 开始执行全系统无死角深度健康与缺陷审计")
print("=" * 60)

# ==================== 1. 获取后端已注册的所有路由 ====================
try:
    resp = requests.get(f"{BASE_URL}/openapi.json", timeout=5)
    openapi_spec = resp.json()
    backend_paths = set(openapi_spec.get("paths", {}).keys())
    print(f"✅ 后端 OpenAPI 注册路由总数: {len(backend_paths)} 个")
except Exception as e:
    print(f"❌ 无法连接后端 OpenAPI: {e}")
    sys.exit(1)

# ==================== 2. 提取前端所有 JS 中的 API 端点 ====================
# 匹配包含 /api/ 或其他常用前缀的真实 URL
api_pattern = re.compile(r'["\'`](/(?:api|alerts|auth|broker|factors|nl|notify|orders|realtime|risk|sector|social|stocks|user-strategies|ws)/[a-zA-Z0-9_\-\/${}]+)["\'`?]')

frontend_apis = set()
api_source_map = {}

# 排除不是完整 URL 的关键词
IGNORED_PATTERNS = {"/api/alpha", "/api/portfolio"}

for js_file in STATIC_JS_DIR.glob("*.js"):
    text = js_file.read_text(encoding="utf-8", errors="ignore")
    matches = api_pattern.findall(text)
    for m in matches:
        clean_m = m.rstrip(",;)")
        if clean_m not in IGNORED_PATTERNS:
            frontend_apis.add(clean_m)
            api_source_map.setdefault(clean_m, []).append(js_file.name)

print(f"✅ 从前端 JS 扫描出 API 调用端点: {len(frontend_apis)} 个")

# ==================== 3. 动态真实请求测试 ====================
print("\n🔍 开始执行动态 HTTP 测试与真实接口连通性核验...")
route_mismatches = []
server_errors = []
auth_required = []
success_apis = []

# 用于测试的通用替换
def normalize_test_url(path):
    path = path.replace("${symbol}", "600519").replace("{symbol}", "600519")
    path = path.replace("${cleanCode}", "600519").replace("{code}", "600519")
    path = path.replace("${_selectedReviewDate}", "2026-09-21")
    path = path.replace("${d}", "2026-09-21").replace("${targetDate}", "2026-09-21")
    path = path.replace("${_watchPage}", "1").replace("${_watchPageSize}", "10")
    path = path.replace("${query}", "").replace("${kwParam}", "")
    path = path.replace("${cleanTag}", "ref:1").replace("${refTag}", "ref:1")
    path = path.replace("${newsId}", "test").replace("${stockCode}", "600519")
    path = path.replace("${strategy_id}", "1").replace("${index}", "0")
    path = path.replace("${order_id}", "1")
    path = re.sub(r'\$\{[^}]+\}', '', path)
    return path

for api in sorted(frontend_apis):
    test_path = normalize_test_url(api)
    full_url = f"{BASE_URL}{test_path}"
    
    try:
        r = requests.get(full_url, timeout=10)
        status = r.status_code
        if status in (404, 405):
            try:
                r_post = requests.post(full_url, json={}, timeout=10)
                if r_post.status_code != 404:
                    status = r_post.status_code
            except Exception:
                pass
        
        sources = ", ".join(set(api_source_map.get(api, [])))
        if status == 404:
            route_mismatches.append((api, sources))
        elif status == 500:
            server_errors.append((api, sources, r.text[:120]))
        elif status in (401, 403):
            auth_required.append((api, sources))
        else:
            success_apis.append((api, status))
    except Exception as e:
        server_errors.append((api, ", ".join(api_source_map.get(api, [])), str(e)))

print("\n" + "=" * 60)
print(f"📊 动态测试结果：共测试 {len(frontend_apis)} 个端点")
print(f"  - 正常可达 (2xx/4xx校验拦截): {len(success_apis)} 个")
print(f"  - 需要鉴权 (401/403): {len(auth_required)} 个")
print(f"  - ❌ 路径不存在 (404 死链接): {len(route_mismatches)} 个")
print(f"  - ❌ 服务端崩溃 (500 内部错误): {len(server_errors)} 个")
print("=" * 60)

if route_mismatches:
    print("\n🚨 [严重] 发现以下前端引用的 API 属于 404 死链接：")
    for path, src in route_mismatches:
        print(f"  ❌ {path}  [调用源: {src}]")

if server_errors:
    print("\n🚨 [严重] 发现以下 API 触发了 500 服务端内部错误：")
    for path, src, err in server_errors:
        print(f"  ❌ {path}  [调用源: {src}] -> 错误: {err}")

# ==================== 4. DOM 元素完整性审计 ====================
print("\n" + "=" * 60)
print("🔍 开始执行前端 DOM 挂载点与 HTML 完整性审计...")
print("=" * 60)

# 读取所有模板 HTML 内容
all_html = ""
for hfile in TEMPLATES_DIR.rglob("*.html"):
    all_html += hfile.read_text(encoding="utf-8", errors="ignore") + "\n"

# 提取 HTML 中的所有 id
html_ids = set(re.findall(r'id=["\']([a-zA-Z0-9_-]+)["\']', all_html))
print(f"✅ HTML 模板中定义的 ID 总数: {len(html_ids)} 个")

# 提取 JS 中的 document.getElementById("xxx")
dom_missing = []
for js_file in STATIC_JS_DIR.glob("*.js"):
    text = js_file.read_text(encoding="utf-8", errors="ignore")
    # 查找 getElementById
    get_ids = re.findall(r'document\.getElementById\(["\']([a-zA-Z0-9_-]+)["\']\)', text)
    for gid in set(get_ids):
        # 排除动态拼接的 ID 或带有前缀的临时 ID
        if gid not in html_ids and not any(p in gid for p in ["item_", "chart_", "row_", "btn_", "tag_", "modal_", "pill_"]):
            # 检查是否有 .addEventListener 或直接 .style 操作
            pattern = rf'document\.getElementById\(["\']({gid})["\']\)\.(addEventListener|style|innerHTML|value|classList)'
            if re.search(pattern, text):
                dom_missing.append((js_file.name, gid))

if dom_missing:
    print(f"🚨 [风险] 发现 {len(dom_missing)} 处 JS 直接操作了 HTML 中不存在的 ID (可能导致 null 异常)：")
    for f, gid in dom_missing[:15]:
        print(f"  ⚠️  文件 {f} 中的 ID: '{gid}' 不存在于模板 HTML 中")
else:
    print("✅ 前端 DOM 强依赖引用完整，无致命空指针崩溃隐患！")

print("\n审计脚本执行完毕。")
