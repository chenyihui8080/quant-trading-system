#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
炒股知识库与六大闭环战法大典路由 (Knowledge Base & Playbooks Router)
"""

from fastapi import APIRouter, Depends, Query
from utils.auth import get_current_user
from utils.knowledge_base_engine import get_kb_stats, search_knowledge
from utils.playbooks_engine import PLAYBOOKS_CATALOG

router = APIRouter(prefix="/api/knowledge-base", tags=["知识库与战法大典"])


@router.get("/stats")
def get_knowledge_base_stats():
    """获取炒股知识库整体收录统计与六大闭环战法大纲"""
    try:
        stats = get_kb_stats()
        return {
            "code": 200,
            "stats": stats,
            "playbooks": PLAYBOOKS_CATALOG
        }
    except Exception as e:
        return {"code": 500, "message": str(e)}


@router.get("/search")
def search_knowledge_base(q: str = Query(..., description="搜索关键词")):
    """在 40,474 条战法切片中执行全文检索"""
    try:
        results = search_knowledge(q, top_k=6)
        return {
            "code": 200,
            "query": q,
            "count": len(results),
            "results": results
        }
    except Exception as e:
        return {"code": 500, "message": str(e)}
