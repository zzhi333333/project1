import pandas as pd

# Load the BOM data
df = pd.read_csv("D:\Python projects\Dixon MPS\DIXON+BOM+all.csv")

# Filter only rows with WERKS = 'DIXON'
df = df[df['WERKS'] == 'DIXON']

# 按 NAME 分组，方便递归时查找
name_to_rows = {name: group for name, group in df.groupby('NAME')}

# 递归函数（方向修正：SQL 是 name = prior idnrk）
def expand_tree(root, level, visited, top_sbb):
    if root in visited:
        return []
    visited.add(root)
    result = []
    # 找到 NAME = root 的所有行
    children_rows = name_to_rows.get(root, pd.DataFrame())
    for _, child_row in children_rows.iterrows():
        child_name = child_row['IDNRK']
        child_data = child_row.to_dict()
        child_data['bomroot'] = top_sbb
        child_data['level'] = level
        result.append(child_data)
        result.extend(expand_tree(child_name, level + 1, visited.copy(), top_sbb))
    return result

# 批量匹配所有 SBB 根节点
roots = df['NAME'].dropna().unique()
sbb_roots = [r for r in roots if str(r).startswith('SBB')]

# 递归展开所有根节点
expanded_rows = []
for root in sbb_roots:
    expanded_rows.extend(expand_tree(root, 1, set(), root))

# 转 DataFrame
expanded_df = pd.DataFrame(expanded_rows)

# 列顺序：bomroot、level 放最前
cols = ['bomroot', 'level'] + [col for col in expanded_df.columns if col not in ['bomroot', 'level']]
expanded_df = expanded_df[cols]

# 按 level, ALPGR 排序（SQL 对应）
if 'ALPGR' in expanded_df.columns:
    expanded_df = expanded_df.sort_values(by=['level', 'ALPGR']).reset_index(drop=True)

# 保存
expanded_df.to_csv("expanded_bom_tree_sbb_roots.csv", index=False)
