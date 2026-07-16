import pandas as pd

# ----------------- 参数区 -----------------
python_input_csv = "DIXON+BOM+all.csv"      # 原始 BOM 数据（DIXON+BOM+all.csv）
sql_result_csv   = "sql_result.csv"         # 数据库 SQL 导出的结果 CSV（用于对比）
python_output_csv = "expanded_bom_tree_sbb_roots.csv"  # Python 生成的结果 CSV
werks_filter = "DIXON"                      # WERKS 筛选值
root_prefix = "SBB"                         # 根节点前缀
# -------------------------------------------

# 读取 BOM 数据
df = pd.read_csv(python_input_csv)
df = df[df['WERKS'] == werks_filter]

# 按 NAME 分组（递归方向修正：name = prior idnrk）
name_to_rows = {name: group for name, group in df.groupby('NAME')}

# 递归展开函数
def expand_tree(root, level, visited, top_sbb):
    if root in visited:
        return []
    visited.add(root)
    result = []
    children_rows = name_to_rows.get(root, pd.DataFrame())
    for _, child_row in children_rows.iterrows():
        child_name = child_row['IDNRK']
        child_data = child_row.to_dict()
        child_data['bomroot'] = top_sbb
        child_data['level'] = level
        result.append(child_data)
        result.extend(expand_tree(child_name, level + 1, visited.copy(), top_sbb))
    return result

# 找所有根节点
roots = df['NAME'].dropna().unique()
sbb_roots = [r for r in roots if str(r).startswith(root_prefix)]

# 展开所有树
expanded_rows = []
for root in sbb_roots:
    expanded_rows.extend(expand_tree(root, 1, set(), root))

# 转 DataFrame
expanded_df = pd.DataFrame(expanded_rows)

# 调整列顺序
cols = ['bomroot', 'level'] + [col for col in expanded_df.columns if col not in ['bomroot', 'level']]
expanded_df = expanded_df[cols]

# 排序
if 'ALPGR' in expanded_df.columns:
    expanded_df = expanded_df.sort_values(by=['level', 'ALPGR']).reset_index(drop=True)

# 保存 Python 结果
expanded_df.to_csv(python_output_csv, index=False)
print(f"✅ Python 结果已保存: {python_output_csv}")

# ----------------- 验证部分 -----------------
try:
    sql_df = pd.read_csv(sql_result_csv)

    # 按相同规则排序
    if 'ALPGR' in sql_df.columns:
        sql_df = sql_df.sort_values(by=['level', 'ALPGR']).reset_index(drop=True)

    # 对比
    same = expanded_df.equals(sql_df)
    if same:
        print("🎉 验证通过：Python 结果与 SQL 结果完全一致！")
    else:
        print("⚠️ 验证失败：Python 结果与 SQL 结果不一致")
        # 找出不同点
        diff = expanded_df.compare(sql_df, keep_shape=True, keep_equal=False)
        diff.to_csv("diff.csv", index=False)
        print("⚠️ 差异已保存到 diff.csv")
except FileNotFoundError:
    print(f"⚠️ 未找到 SQL 结果文件 {sql_result_csv}，跳过验证。")
