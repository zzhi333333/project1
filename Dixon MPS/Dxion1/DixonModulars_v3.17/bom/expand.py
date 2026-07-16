import pandas as pd
from utils.common import find_col, norm

def expand_bom_tree(df):
    # 与原文件完全一致，仅 import 调整
    df = df.copy()
    try:
        wcol = find_col(df, ["WERKS"])
        df = df[df[wcol] == "DIXON"]
    except KeyError:
        pass

    name_col = find_col(df, ["NAME"])
    id_col = find_col(df, ["IDNRK"])
    menge_col = None
    try:
        menge_col = find_col(df, ["MENGE"])
    except KeyError:
        menge_col = None

    parent_to_children = {}
    for _, row in df.iterrows():
        parent = row[name_col]
        child = row[id_col]
        if pd.notna(parent) and pd.notna(child):
            parent_to_children.setdefault(str(parent), []).append(row)

    def expand_tree(root, level, visited, top_sbb, parent_name, menge_path, path_list):
        root = str(root)
        if root in visited:
            return []
        visited.add(root)
        result = []
        children = parent_to_children.get(root, [])
        for child_row in children:
            child_name = str(child_row[id_col])
            child_data = child_row.to_dict()
            child_data['bomroot'] = top_sbb
            child_data['level'] = level
            child_data[name_col] = parent_name
            qty = child_row[menge_col] if menge_col and pd.notna(child_row[menge_col]) else 1
            child_data['MENGE_PATH'] = menge_path * qty
            child_data['path'] = " → ".join(path_list + [str(parent_name), child_name])
            result.append(child_data)
            result.extend(
                expand_tree(
                    child_name,
                    level + 1,
                    visited.copy(),
                    top_sbb,
                    child_data[id_col],
                    child_data['MENGE_PATH'],
                    path_list + [str(parent_name)]
                )
            )
        return result

    roots = df[name_col].dropna().astype(str).unique()
    sbb_roots = [r for r in roots if str(r).startswith('SBB')]
    expanded_rows = []
    for root in sbb_roots:
        expanded_rows.extend(expand_tree(root, 1, set(), root, root, 1, []))

    expanded_df = pd.DataFrame(expanded_rows)
    if expanded_df.empty:
        return expanded_df
    cols_front = ['bomroot', 'level']
    rest = [c for c in expanded_df.columns if c not in cols_front]
    return expanded_df[cols_front + rest]