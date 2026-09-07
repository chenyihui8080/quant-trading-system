"""
数据质量清洗脚本：清理 prediction.db 中反常识回溯的虚假垃圾数据
清洗原则：
1. 先全量备份原始数据库为 .bak 文件；
2. 识别并删除 tags 包含 '4层漏斗,量化选股' 的批量机械生成假数据（这部分数据造成了高位接盘、低位割肉的严重失真）；
3. 严格保留真实实盘交易记录（'实盘交易,执行记录'）及真实的量化策略选股单；
4. 验证清理后的胜率与数据完整性。
"""

import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


def clean_prediction_db():
    db_path = Path("data/prediction.db")
    if not db_path.exists():
        print(f"❌ 数据库文件不存在: {db_path}")
        return

    # 1. 自动备份
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = Path(f"data/prediction.db.bak_{timestamp}")
    shutil.copy2(db_path, backup_path)
    print(f"✅ 数据库已安全备份至: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 查询清洗前的总条数
        cursor.execute("SELECT COUNT(*) FROM prediction_records")
        total_before = cursor.fetchone()[0]

        # 查询待清洗的垃圾数据条数 (从 core_watchlists 机械硬灌的 4 层漏斗假数据)
        cursor.execute("""
            SELECT COUNT(*) FROM prediction_records 
            WHERE tags LIKE '%4层漏斗,量化选股%'
        """)
        dirty_count = cursor.fetchone()[0]

        print(f"📊 清洗前总记录数: {total_before} 条，检测到机械回溯垃圾记录目: {dirty_count} 条")

        # 2. 执行安全清洗
        cursor.execute("""
            DELETE FROM prediction_records 
            WHERE tags LIKE '%4层漏斗,量化选股%'
        """)
        conn.commit()

        # 3. 查询清洗后的分布
        cursor.execute("SELECT COUNT(*) FROM prediction_records")
        total_after = cursor.fetchone()[0]

        cursor.execute("""
            SELECT record_date, tags, count(*) as cnt,
                   SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as win,
                   SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as loss,
                   SUM(CASE WHEN is_correct IS NULL THEN 1 ELSE 0 END) as pending
            FROM prediction_records
            GROUP BY record_date, tags
            ORDER BY record_date DESC
        """)
        rows = cursor.fetchall()

        print(f"\n🎉 清洗完成！当前剩余高质量有效记录: {total_after} 条 (已清除 {dirty_count} 条垃圾数据)")
        print("-" * 60)
        for r in rows:
            print(f"📅 日期: {r[0]} | 标签: {r[1]} | 总数: {r[2]} | 胜: {r[3]} | 负: {r[4]} | 待结算: {r[5]}")
        print("-" * 60)

    except Exception as e:
        conn.rollback()
        print(f"❌ 清洗过程出现异常，已回滚: {e}")
    finally:
        conn.close()


if __name__ == "__main__":
    clean_prediction_db()
