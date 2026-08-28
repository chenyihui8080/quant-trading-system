#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
炒股实战知识库引擎 (Stock Knowledge Base RAG Engine)
特点：
1. 纯只读提取外接盘上的 PDF、Word、TXT 战法书籍内容；
2. 构建高性能 SQLite FTS5 全文索引 + 金融关键词语义匹配；
3. 毫秒级命中名著与课程原文，为 AI 操盘顾问提供权威战法支撑。
"""

import os
import re
import sqlite3
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger("KnowledgeBase")
logger.setLevel(logging.INFO)

KB_DB_PATH = Path("/Users/chen/Desktop/MyProject/量化/data/stock_knowledge_base.db")
KB_SRC_DIR = Path("/Volumes/Chen外接盘/炒股知识库")


def init_kb_db():
    """初始化知识库数据库表与全文检索引擎"""
    KB_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(KB_DB_PATH)) as conn:
        cursor = conn.cursor()
        # 1. 基础文档切片表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_title TEXT,
                category TEXT,
                file_rel_path TEXT,
                page_or_section TEXT,
                content TEXT,
                char_count INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 2. FTS5 全文检索虚拟表
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                book_title,
                category,
                content,
                content='knowledge_chunks',
                content_rowid='id'
            )
        """)

        # 3. 统计索引
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_chunks(category)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_kb_title ON knowledge_chunks(book_title)")
        conn.commit()


def extract_text_from_file(file_path: Path) -> List[Dict[str, Any]]:
    """安全只读解析单个文件内容 (支持 PDF, Word docx, TXT, MD)"""
    ext = file_path.suffix.lower()
    chunks = []

    try:
        if ext == ".txt" or ext == ".md":
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
            chunks = _split_text_to_chunks(text, page_prefix="全文")

        elif ext == ".docx":
            try:
                import docx
                doc = docx.Document(str(file_path))
                full_text = []
                for p in doc.paragraphs:
                    if p.text.strip():
                        full_text.append(p.text.strip())
                text = "\n".join(full_text)
                chunks = _split_text_to_chunks(text, page_prefix="讲义章节")
            except Exception as e:
                logger.warning(f"解析 DOCX 失败 {file_path.name}: {e}")

        elif ext == ".pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(str(file_path))
                total_pages = len(reader.pages)
                # 为保证效率与质量，逐页或合并提取
                page_buffer = []
                buf_len = 0
                start_page = 1

                for idx, page in enumerate(reader.pages):
                    page_text = page.extract_text() or ""
                    clean_text = page_text.strip()
                    if not clean_text:
                        continue
                    page_buffer.append(clean_text)
                    buf_len += len(clean_text)

                    if buf_len >= 600:
                        merged = "\n".join(page_buffer)
                        sec_name = f"第 {start_page}~{idx+1} 页" if start_page != idx+1 else f"第 {start_page} 页"
                        chunks.append({"page_or_section": sec_name, "content": merged})
                        page_buffer = []
                        buf_len = 0
                        start_page = idx + 2

                if page_buffer:
                    merged = "\n".join(page_buffer)
                    sec_name = f"第 {start_page}~{total_pages} 页"
                    chunks.append({"page_or_section": sec_name, "content": merged})

            except Exception as e:
                logger.warning(f"解析 PDF 失败 {file_path.name}: {e}")

    except Exception as e:
        logger.warning(f"读取文件发生异常 {file_path}: {e}")

    return chunks


def _split_text_to_chunks(text: str, page_prefix: str = "段落", chunk_size: int = 600) -> List[Dict[str, Any]]:
    """将长文本按自然段落切片"""
    paragraphs = re.split(r"\n\s*\n|\r\n\r\n", text)
    chunks = []
    current_chunk = []
    current_len = 0
    chunk_idx = 1

    for p in paragraphs:
        p_clean = p.strip()
        if not p_clean:
            continue
        current_chunk.append(p_clean)
        current_len += len(p_clean)

        if current_len >= chunk_size:
            chunks.append({
                "page_or_section": f"{page_prefix} {chunk_idx}",
                "content": "\n".join(current_chunk)
            })
            current_chunk = []
            current_len = 0
            chunk_idx += 1

    if current_chunk:
        chunks.append({
            "page_or_section": f"{page_prefix} {chunk_idx}",
            "content": "\n".join(current_chunk)
        })

    return chunks


def search_knowledge(query: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """在炒股知识库中执行高精度全文与语义检索"""
    if not KB_DB_PATH.exists():
        return []

    q_clean = query.strip()
    if not q_clean:
        return []

    results = []
    try:
        import jieba
        words = [w for w in jieba.cut(q_clean) if len(w.strip()) > 1 and w not in ["怎么", "如何", "什么", "这个", "那个", "一下", "现在"]]
        if not words:
            words = [q_clean]

        # 构造 FTS 查询词 (MATCH 'word1 OR word2')
        fts_query = " OR ".join(f'"{w}"' for w in words[:6])

        with sqlite3.connect(str(KB_DB_PATH)) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # 1. 优先使用 FTS5 毫秒级全文检索
            sql = """
                SELECT k.id, k.book_title, k.category, k.page_or_section, k.content,
                       rank
                FROM knowledge_fts f
                JOIN knowledge_chunks k ON f.rowid = k.id
                WHERE knowledge_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            """
            cursor.execute(sql, (fts_query, top_k * 2))
            rows = cursor.fetchall()

            if not rows:
                # 备用：标准 LIKE 匹配
                like_clauses = " OR ".join(["content LIKE ?"] * len(words))
                params = [f"%{w}%" for w in words]
                params.append(top_k)
                sql_fallback = f"""
                    SELECT id, book_title, category, page_or_section, content, 0 as rank
                    FROM knowledge_chunks
                    WHERE {like_clauses}
                    LIMIT ?
                """
                cursor.execute(sql_fallback, params)
                rows = cursor.fetchall()

            for r in rows[:top_k]:
                content_snippet = r["content"][:350].strip()
                results.append({
                    "book_title": r["book_title"],
                    "category": r["category"],
                    "page_or_section": r["page_or_section"],
                    "content": content_snippet
                })

    except Exception as e:
        logger.warning(f"检索知识库异常: {e}")

    return results


def get_kb_stats() -> Dict[str, Any]:
    """获取当前知识库的收录统计"""
    if not KB_DB_PATH.exists():
        return {"total_chunks": 0, "total_books": 0, "categories": []}

    try:
        with sqlite3.connect(str(KB_DB_PATH)) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*), COUNT(DISTINCT book_title) FROM knowledge_chunks")
            row = cursor.fetchone()
            total_chunks = row[0] if row else 0
            total_books = row[1] if row else 0

            cursor.execute("SELECT category, COUNT(DISTINCT book_title), COUNT(*) FROM knowledge_chunks GROUP BY category")
            cat_rows = cursor.fetchall()
            categories = [{"category": r[0], "book_count": r[1], "chunk_count": r[2]} for r in cat_rows]

            return {
                "total_chunks": total_chunks,
                "total_books": total_books,
                "categories": categories
            }
    except Exception:
        return {"total_chunks": 0, "total_books": 0, "categories": []}
