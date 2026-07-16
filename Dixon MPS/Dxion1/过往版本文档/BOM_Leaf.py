import pandas as pd

# Load BOM data and expanded tree data
bom_df = pd.read_csv("DIXON+BOM+all.csv")
expanded_df = pd.read_csv("expanded_bom_tree_sbb_roots.csv")

# Filter BOM data for WERKS = 'DIXON'
bom_df = bom_df[bom_df['WERKS'] == 'DIXON']

# Build parent-to-children mapping
parent_to_children = {}
for _, row in bom_df.iterrows():
    parent = row['NAME']
    child = row['IDNRK']
    if pd.notna(parent) and pd.notna(child):
        parent_to_children.setdefault(parent, []).append(row)

# Recursive tree expansion
def expand_tree(root, level, visited, top_sbb, parent_name):
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
        result.append(child_data)
        result.extend(expand_tree(child_name, level + 1, visited.copy(), top_sbb, child_data['IDNRK']))
    return result

# Get all SBB root items
roots = bom_df['NAME'].dropna().unique()
sbb_roots = [r for r in roots if str(r).startswith('SBB')]

# Expand all trees
expanded_rows = []
for root in sbb_roots:
    expanded_rows.extend(expand_tree(root, 1, set(), root, root))

expanded_tree_df = pd.DataFrame(expanded_rows)

# Identify leaf nodes (those not appearing as NAME)
all_names = set(expanded_tree_df['NAME'])
leaf_df = expanded_tree_df[~expanded_tree_df['IDNRK'].isin(all_names)].copy()

# Substitute logic
def extract_substitutes(group):
    result = {
        'bomroot': group['bomroot'].iloc[0],
        'level': group['level'].iloc[0],
        'NAME': group['NAME'].iloc[0],
        'CHILD': '',
        'substitute_1': '',
        'substitute_2': '',
        'substitute_3': ''
    }
    substitute_gt3 = []
    for _, row in group.iterrows():
        alprf = row['ALPRF']
        idnrk = row['IDNRK']
        if alprf == 1:
            result['CHILD'] = idnrk
        elif alprf == 2:
            result['substitute_1'] = idnrk
        elif alprf == 3:
            result['substitute_2'] = idnrk
        elif alprf > 3:
            substitute_gt3.append(idnrk)
    result['substitute_3'] = ','.join(substitute_gt3)
    return pd.Series(result)

# Group by NAME + ALPGR to identify substitute groups
leaf_df['ALPGR'] = leaf_df['ALPGR'].fillna('')
leaf_df['group_key'] = leaf_df['NAME'] + '_' + leaf_df['ALPGR'].astype(str)
grouped = leaf_df.groupby('group_key').apply(extract_substitutes).reset_index(drop=True)

# Match MENGE from expanded_bom_tree_sbb_roots.csv
expanded_df['key'] = expanded_df['bomroot'].astype(str) + '_' + expanded_df['NAME'].astype(str) + '_' + expanded_df['IDNRK'].astype(str)
grouped['key'] = grouped['bomroot'].astype(str) + '_' + grouped['NAME'].astype(str) + '_' + grouped['CHILD'].astype(str)
grouped = grouped.merge(expanded_df[['key', 'MENGE']], on='key', how='left')
grouped.drop(columns=['key'], inplace=True)

# Save final result
grouped.to_csv("bom_leaf.csv", index=False)

