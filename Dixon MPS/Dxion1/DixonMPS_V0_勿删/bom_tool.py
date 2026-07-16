import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox
import os

# ---------- GUI 文件选择 ----------
def select_file() -> str:
    root = tk.Tk()
    root.withdraw()
    return filedialog.askopenfilename(
        title="请选择 BOM 文件",
        filetypes=[("Excel files", "*.xlsx;*.xls"), ("CSV files", "*.csv")]
    )

# ---------- 读取文件 ----------
def load_bom_file(file_path: str) -> pd.DataFrame:
    ext = os.path.splitext(file_path)[-1].lower()
    if ext == ".csv":
        return pd.read_csv(file_path)
    elif ext == ".xlsx":
        return pd.read_excel(file_path, engine="openpyxl")
    elif ext == ".xls":
        return pd.read_excel(file_path, engine="xlrd")
    else:
        raise ValueError("Unsupported file type")

# ---------- 递归展开 BOM ----------
def expand_bom_tree(df: pd.DataFrame) -> pd.DataFrame:
    df = df[df['WERKS'] == 'DIXON']
    parent_to_children = {}
    for _, row in df.iterrows():
        parent = row['NAME']
        child = row['IDNRK']
        if pd.notna(parent) and pd.notna(child):
            parent_to_children.setdefault(parent, []).append(row)

    def expand_tree(root, level, visited, top_sbb, parent_name, menge_path, path_list):
        if root in visited:
            return []
        visited.add(root)
        result = []
        children = parent_to_children.get(root, [])
        for child_row in children:
            child_name = child_row['IDNRK']
            child_data = child_row.to_dict()
            child_data['bomroot'] = top_sbb
            child_data['level'] = level
            child_data['NAME'] = parent_name
            child_data['MENGE_PATH'] = menge_path * (child_row['MENGE'] if pd.notna(child_row['MENGE']) else 1)
            child_data['path'] = " → ".join(path_list + [parent_name, child_name])
            result.append(child_data)
            result.extend(
                expand_tree(
                    child_name,
                    level + 1,
                    visited.copy(),
                    top_sbb,
                    child_data['IDNRK'],
                    child_data['MENGE_PATH'],
                    path_list + [parent_name]
                )
            )
        return result

    roots = df['NAME'].dropna().unique()
    sbb_roots = [r for r in roots if str(r).startswith('SBB')]
    expanded_rows = []
    for root in sbb_roots:
        expanded_rows.extend(expand_tree(root, 1, set(), root, root, 1, [])) # [root] from bomroot, []:from layer0

    expanded_df = pd.DataFrame(expanded_rows)
    cols = ['bomroot', 'level'] + [c for c in expanded_df.columns if c not in ['bomroot', 'level']]
    return expanded_df[cols]


# ---------- 新版 generate_leaf_bom ----------
def generate_leaf_bom(expanded_df: pd.DataFrame) -> pd.DataFrame:
    # 找出真正的叶子（没有任何子件的物料）
    all_names = set(expanded_df['NAME'])
    leaf_df = expanded_df[~expanded_df['IDNRK'].isin(all_names)].copy()

    # 无替代组（ALPGR 为 NaN 或空）
    leaf_df['ALPGR'] = leaf_df['ALPGR'].fillna('')
    no_alt_mask = leaf_df['ALPGR'] == ''
    no_alt_df = leaf_df[no_alt_mask].copy()
    no_alt_df = no_alt_df.rename(columns={'IDNRK': 'CHILD'})
    no_alt_df['path'] = no_alt_df['path'].astype(str)
    no_alt_df = no_alt_df[['bomroot', 'level', 'NAME', 'CHILD',
                           'MENGE_PATH', 'path']] \
                .rename(columns={'MENGE_PATH': 'MENGE'})

    # ---------- 处理有替代组 ----------
    alt_df = leaf_df[~no_alt_mask].copy()
    alt_df['grp_key'] = (
            alt_df['bomroot'].astype(str) + '_' +
            alt_df['NAME'].astype(str) + '_' +
            alt_df['ALPGR'].astype(str)
    )

    # 计算最长替代组长度，确定列数
    max_alt = alt_df.groupby('grp_key')['IDNRK'].count().max()
    if pd.isna(max_alt):
        max_alt = 0

    def flatten_substitutes(group: pd.DataFrame) -> dict:
        items = group['IDNRK'].tolist()
        rec = {
            'bomroot': group['bomroot'].iloc[0],
            'level': group['level'].iloc[0],
            'NAME': group['NAME'].iloc[0],
            'MENGE': group['MENGE_PATH'].iloc[0],
            'path': group['path'].iloc[0]
        }
        # 先把所有可能出现的列填上空字符串
        for i in range(max_alt):
            col = 'CHILD' if i == 0 else f'substitute_{i}'
            rec[col] = ''
        # 再按顺序填入实际料号
        for idx, val in enumerate(items):
            col = 'CHILD' if idx == 0 else f'substitute_{idx}'
            rec[col] = val
        return rec

    alt_result = (alt_df.groupby('grp_key', as_index=False)
                  .apply(lambda g: pd.Series(flatten_substitutes(g)))
                  ) if max_alt else pd.DataFrame()

    # 合并无替代与有替代
    final = pd.concat([no_alt_df, alt_result], ignore_index=True)

    # 按列名排序，使输出顺序美观（bomroot, level, NAME, CHILD, substitute_1...）
    cols_order = ['bomroot', 'level', 'NAME', 'CHILD']
    max_sub = final.filter(regex=r'^substitute_\d+$').shape[1]
    cols_order += [f'substitute_{i}' for i in range(1, max_sub + 1)]
    cols_order += ['MENGE', 'path']
    # 只保留实际存在的列
    final = final[[c for c in cols_order if c in final.columns]]
    return final

# ---------- 主函数 ----------
def main():
    file_path = select_file()
    if not file_path:
        messagebox.showerror("错误", "未选择文件")
        return

    try:
        df_bom = load_bom_file(file_path)
        expanded_df = expand_bom_tree(df_bom)
        leaf_df = generate_leaf_bom(expanded_df)

        base_name = os.path.splitext(file_path)[0]
        expanded_df.to_csv(base_name + "_expanded_bom_tree_sbb_roots.csv", index=False, encoding="utf-8-sig")
        leaf_df.to_csv(base_name + "_bom_leaf.csv", index=False, encoding="utf-8-sig")

        messagebox.showinfo(
            "完成",
            f"BOM 展开已完成，文件已保存到：\n{base_name}_expanded_bom_tree_sbb_roots.csv\n{base_name}_bom_leaf.csv"
        )
    except Exception as e:
        messagebox.showerror("执行失败", str(e))

if __name__ == "__main__":
    main()
