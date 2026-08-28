#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
炒股知识库批量构建与索引脚本
以纯只读模式扫描 /Volumes/Chen外接盘/炒股知识库 下的所有书籍与讲义，生成本地全文检索引擎
"""

import os
import sys
import time
import sqlite3
from pathlib import Path

# 将项目根目录加入系统路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.knowledge_base_engine import (
    KB_DB_PATH,
    KB_SRC_DIR,
    init_kb_db,
    extract_text_from_file,
    get_kb_stats
)

SUPPORTED_EXTS = {".pdf", ".docx", ".txt", ".md"}

def build_all_knowledge():
    if not KB_SRC_DIR.exists():
        print(f"❌ 知识库目录不存在: {KB_SRC_DIR}")
        return

    print("="*60)
    print("🚀 正在启动【炒股知识库】只读扫描与向量全文索引构建...")
    print(f"📂 扫描源目录: {KB_SRC_DIR}")
    print(f"💾 本地索引库: {KB_DB_PATH}")
    print("="*60)

    init_kb_db()

    # 1. 搜集所有支持的文件
    target_files = []
    for root, dirs, files in os.walk(KB_SRC_DIR):
        for f in files:
            if f.startswith("."):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in SUPPORTED_EXTS:
                fp = Path(root) / f
                target_files.append(fp)

    total_files = len(target_files)
    print(f"📚 共发现 {total_files} 份可索引的核心战法与名著文档，开始逐步解析...")

    total_chunks_added = 0
    success_books = 0
    start_time = time.time()

    conn = sqlite3.connect(str(KB_DB_PATH))
    cursor = conn.cursor()

    for idx, fp in enumerate(target_files, 1):
        rel_path = fp.relative_to(KB_SRC_DIR)
        parts = rel_path.parts
        category = parts[0] if len(parts) > 1 else "基础实战"
        book_title = fp.stem

        # 检查该书是否已建立索引 (增量模式)
        cursor.execute("SELECT COUNT(*) FROM knowledge_chunks WHERE file_rel_path = ?", (str(rel_path),))
        if cursor.fetchone()[0] > 0:
            continue

        try:
            chunks = extract_text_from_file(fp)
            if chunks:
                for c in chunks:
                    txt = c["content"]
                    cursor.execute("""
                        INSERT INTO knowledge_chunks (book_title, category, file_rel_path, page_or_section, content, char_count)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (book_title, category, str(rel_path), c["page_or_section"], txt, len(txt)))
                    
                    # 插入 FTS 索引
                    last_id = cursor.lastrowid
                    cursor.execute("""
                        INSERT INTO knowledge_fts (rowid, book_title, category, content)
                        VALUES (?, ?, ?, ?)
                    """, (last_id, book_title, category, txt))

                total_chunks_added += len(chunks)
                success_books += 1

            if idx % 20 == 0 or idx == total_files:
                conn.commit()
                elapsed = time.time() - start_time
                pct = (idx / total_files) * 100
                print(f"   [{pct:5.1f}%] 已处理 {idx}/{total_files} 份资料 | 已生成 {total_chunks_added} 条知识切片 | 用时: {elapsed:.1f}s")

        except Exception as e:
            print(f"   ⚠️ 解析异常 [{book_title}]: {e}")

    conn.commit()
    conn.close()

    total_time = time.time() - start_time
    stats = get_kb_stats()

    print("\n" + "="*60)
    print("🎉【炒股知识库】只读索引构建圆满完成！")
    print(f"📖 成功收录名著/战法: {stats.get('total_books', success_books)} 部")
    print(f"🧩 生成高精度知识切片: {stats.get('total_chunks', total_chunks_added)} 条")
    print(f"⏱️ 耗时: {total_time:.1f} 秒")
    print(f"💾 数据库体积: {KB_DB_PATH.stat().st_size / (1024**2):.2f} MB (轻量高效)")
    print("="*60)


if __name__ == "__main__":
    build_all_knowledge()
