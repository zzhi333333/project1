import pandas as pd
import re
from utils.common import find_col, norm

def generate_leaf_bom(expanded_df):
    if expanded_df.empty:
        return expanded_df
    name_col = find_col(expanded_df, ["NAME"])
    id_col = find_col(expanded_df, ["IDNRK"])
    alp_col = None
    for c in expanded_df.columns:
        if norm(c) == "alpgr":
            alp_col = c
            break
    all_names = set(expanded_df[name_col].astype(str))
    idvals = expanded_df[id_col].astype(str)
    leaf_df = expanded_df[~idvals.isin(all_names)].copy()
    if 'MENGE_PATH' in leaf_df.columns:
        leaf_df['MENGE'] = leaf_df['MENGE_PATH']
    elif 'MENGE' not in leaf_df.columns:
        leaf_df['MENGE'] = 1

    if alp_col is None:
        out = leaf_df.rename(columns={id_col: 'CHILD'})
        out['path'] = out['path'].astype(str)
        return out[['bomroot', 'level', name_col, 'CHILD', 'MENGE', 'path']].rename(columns={name_col: 'NAME'})

    leaf_df[alp_col] = leaf_df[alp_col].fillna('')
    no_alt_mask = leaf_df[alp_col] == ''
    no_alt_df = leaf_df[no_alt_mask].copy()
    no_alt_df = no_alt_df.rename(columns={id_col: 'CHILD'})
    no_alt_df['path'] = no_alt_df['path'].astype(str)
    no_alt_df = no_alt_df[['bomroot', 'level', name_col, 'CHILD', 'MENGE', 'path']].rename(columns={name_col: 'NAME'})

    alt_df = leaf_df[~no_alt_mask].copy()
    alt_df['grp_key'] = alt_df['bomroot'].astype(str) + '_' + alt_df[name_col].astype(str) + '_' + alt_df[alp_col].astype(str)
    max_alt = alt_df.groupby('grp_key')[id_col].count().max() if len(alt_df) > 0 else 0
    if pd.isna(max_alt):
        max_alt = 0

    def flatten_substitutes(group):
        items = group[id_col].astype(str).tolist()
        rec = {
            'bomroot': group['bomroot'].iloc[0],
            'level': group['level'].iloc[0],
            'NAME': group[name_col].iloc[0],
            'MENGE': group['MENGE'].iloc[0],
            'path': group['path'].iloc[0]
        }
        for i in range(int(max_alt)):
            col = 'CHILD' if i == 0 else f'substitute_{i}'
            rec[col] = ''
        for idx, val in enumerate(items):
            col = 'CHILD' if idx == 0 else f'substitute_{idx}'
            rec[col] = val
        return rec

    alt_result = pd.DataFrame()
    if max_alt and len(alt_df):
        alt_result = alt_df.groupby('grp_key', as_index=False).apply(lambda g: pd.Series(flatten_substitutes(g)))

    final = pd.concat([no_alt_df, alt_result], ignore_index=True, sort=False)
    cols_order = ['bomroot', 'level', 'NAME', 'CHILD']
    max_sub = final.filter(regex=r'^substitute_\d+$').shape[1]
    cols_order += [f'substitute_{i}' for i in range(1, max_sub + 1)]
    cols_order += ['MENGE', 'path']
    final = final[[c for c in cols_order if c in final.columns]]
    return final