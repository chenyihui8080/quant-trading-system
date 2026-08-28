#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
炒股知识库目录重组与空间释放脚本
功能：
1. 将 /Volumes/Chen外接盘/股票炒股理财实战课程 下的全部文档（PDF/Word/PPT/Excel/TXT等）按原始目录层级结构剪切移动到 /Volumes/Chen外接盘/炒股知识库/
2. 删除所有视频文件（.mp4, .avi, .mkv, .ts等），释放 420+ GB 巨大存储空间
3. 清理原始空文件夹，保持外接盘整洁
"""

import os
import shutil
import sys

SRC_BASE = "/Volumes/Chen外接盘/股票炒股理财实战课程"
DST_BASE = "/Volumes/Chen外接盘/炒股知识库"

VIDEO_EXTS = {".mp4", ".avi", ".mkv", ".ts", ".mov", ".flv", ".rmvb", ".wmv", ".m4v"}

def organize_and_clean():
    if not os.path.exists(SRC_BASE):
        print(f"❌ 源路径不存在: {SRC_BASE}")
        return

    os.makedirs(DST_BASE, exist_ok=True)
    print(f"🚀 开始执行【炒股知识库】目录重构与视频清理...")
    print(f"📂 源目录: {SRC_BASE}")
    print(f"🎯 目标目录: {DST_BASE}")

    moved_docs = 0
    deleted_videos = 0
    freed_bytes = 0

    # 1. 递归扫描并处理文件
    for root, dirs, files in os.walk(SRC_BASE, topdown=False):
        for f in files:
            if f.startswith(".DS_Store"):
                try:
                    os.remove(os.path.join(root, f))
                except Exception:
                    pass
                continue

            src_file_path = os.path.join(root, f)
            rel_path = os.path.relpath(src_file_path, SRC_BASE)
            ext = os.path.splitext(f)[1].lower()

            if ext in VIDEO_EXTS:
                # 视频文件：直接删除释放空间
                try:
                    sz = os.path.getsize(src_file_path)
                    os.remove(src_file_path)
                    deleted_videos += 1
                    freed_bytes += sz
                    if deleted_videos % 50 == 0:
                        print(f"   [清理视频] 已清理 {deleted_videos} 个视频，释放 {freed_bytes / (1024**3):.2f} GB...")
                except Exception as e:
                    print(f"   ⚠️ 删除视频失败 {f}: {e}")
            else:
                # 知识文档：保持原始目录层级结构剪切移动到目标目录
                dst_file_path = os.path.join(DST_BASE, rel_path)
                dst_dir = os.path.dirname(dst_file_path)
                os.makedirs(dst_dir, exist_ok=True)
                try:
                    shutil.move(src_file_path, dst_file_path)
                    moved_docs += 1
                    if moved_docs % 100 == 0:
                        print(f"   [迁移文档] 已按原层级归档 {moved_docs} 份核心资料...")
                except Exception as e:
                    print(f"   ⚠️ 移动文档失败 {f}: {e}")

    # 2. 清理源目录残留的空文件夹
    for root, dirs, files in os.walk(SRC_BASE, topdown=False):
        for d in dirs:
            dir_path = os.path.join(root, d)
            try:
                if not os.listdir(dir_path):
                    os.rmdir(dir_path)
            except Exception:
                pass

    # 3. 检查源目录是否完全为空，若为空可安全移除
    try:
        if os.path.exists(SRC_BASE) and not os.listdir(SRC_BASE):
            os.rmdir(SRC_BASE)
            print(f"🧹 原源目录已完全为空并自动移除清理！")
    except Exception:
        pass

    print("\n" + "="*50)
    print("🎉【炒股知识库】整理与空间释放全部大功告成！")
    print(f"📚 成功归档并保持原结构文档：{moved_docs} 份")
    print(f"🎬 成功清理视频文件：{deleted_videos} 个")
    print(f"💾 为外接盘成功释放空间：{freed_bytes / (1024**3):.2f} GB")
    print(f"📂 全新纯净知识库路径：{DST_BASE}")
    print("="*50)

if __name__ == "__main__":
    organize_and_clean()
