import pandas as pd
import sys

sys.path.insert(0, r'D:\Py projects\Dixon MPS\Dxion1\DixonModulars_v3.17')
from utils.common import find_col, norm


def generate_leaf_where_use(df):
    """
    复用 leaf.py 的"叶子筛选 + 替代料扁平化"核心逻辑，
    适配 WHERE_USE 表结构（含 Path、Item、Alter Native Group 等字段）。

    融合优化点：
    1. find_col 动态识别字段，不硬编码列名；
    2. BU + Site 双维度隔离，防止跨工厂/跨 BU 同料号误判；
    3. 集合差写法识别叶子（child_keys - parent_keys），更 Pythonic；
    4. 替代料分组加入 scope（BU|Site），多 BU 场景不会混组；
    5. 修复 Pandas 2.x groupby.apply DeprecationWarning。
    """
    if df.empty:
        return df

    # =========================
    # 1. 动态字段识别
    # =========================
    path_col = find_col(df, ['path'])
    item_col = find_col(df, ['item'])          # 对应 IDNRK / child
    qty_col  = find_col(df, ['item usage', 'usage', 'qty', 'menge'])
    alt_col  = find_col(df, ['alter native group', 'alpgr', 'alt group'])
    bu_col   = find_col(df, ['bu'])
    site_col = find_col(df, ['site'])          # 新表有 Site，和 BU 一起做隔离

    # =========================
    # 2. 基础清洗
    # =========================
    df = df.drop_duplicates().copy()

    # =========================
    # 3. 从 Path 提取父子关系与层级
    # =========================
    # Path 示例: /SBB1M86676/SG11N50928/SB11M64612
    def parse_path(path_val):
        nodes = [x for x in str(path_val).split('/') if x]
        depth = len(nodes)
        return {
            'bomroot': nodes[0] if depth > 0 else None,
            'parent':  nodes[-2] if depth > 1 else (nodes[0] if depth > 0 else None),
            'level':   depth - 1 if depth > 1 else 1,
        }

    parsed = df[path_col].apply(parse_path)
    df['bomroot'] = [p['bomroot'] for p in parsed]
    df['NAME']    = [p['parent']  for p in parsed]   # 直接父件
    df['level']   = [p['level']   for p in parsed]

    # =========================
    # 4. 字段标准化 + BU/Site 隔离
    # =========================
    df['IDNRK'] = df[item_col]
    df['MENGE'] = df[qty_col]
    df['path']  = df[path_col]

    # 替代组：SINGLE 视为空（无替代料），否则 leaf.py 会把所有 SINGLE 当成同一巨大替代组
    df['ALPGR'] = df[alt_col].apply(
        lambda x: '' if pd.isna(x) or str(x).strip().upper() == 'SINGLE' else str(x).strip()
    )

    # BU + Site 隔离 Key：防止跨工厂/跨 BU 同料号互相干扰
    df['scope'] = df[bu_col].astype(str) + '|' + df[site_col].astype(str)
    df['parent_scope_key'] = df['scope'] + '|' + df['NAME'].astype(str)
    df['child_scope_key']  = df['scope'] + '|' + df['IDNRK'].astype(str)

    # =========================
    # 5. 叶子节点筛选（集合差写法）
    # =========================
    parent_keys = set(df['parent_scope_key'])
    child_keys  = set(df['child_scope_key'])
    leaf_keys   = child_keys - parent_keys           # 只在 child 中出现，没在 parent 中出现 = 真叶子

    df['is_leaf'] = df['child_scope_key'].isin(leaf_keys)
    leaf_df = df[df['is_leaf']].copy()

    print(f"[Info] 原始行数: {len(df)}, 叶子行数: {len(leaf_df)}, 过滤非叶子: {len(df) - len(leaf_df)}")

    # =========================
    # 6. 用量处理
    # =========================
    if 'MENGE' not in leaf_df.columns:
        leaf_df['MENGE'] = 1
    else:
        leaf_df['MENGE'] = leaf_df['MENGE'].fillna(1)

    # =========================
    # 7. 无替代料 vs 有替代料 分离
    # =========================
    leaf_df['ALPGR'] = leaf_df['ALPGR'].fillna('')
    no_alt_mask = leaf_df['ALPGR'] == ''
    no_alt_df = leaf_df[no_alt_mask].copy()

    # 7.1 无替代料子集：直接改名输出
    no_alt_df = no_alt_df.rename(columns={'IDNRK': 'CHILD'})
    no_alt_df['path'] = no_alt_df['path'].astype(str)

    # 7.2 有替代料子集：按 (scope + bomroot + 父件 + 替代组) 分组，横向展开
    alt_df = leaf_df[~no_alt_mask].copy()
    alt_df['grp_key'] = (
        alt_df['scope'].astype(str) + '_' +
        alt_df['bomroot'].astype(str) + '_' +
        alt_df['NAME'].astype(str) + '_' +
        alt_df['ALPGR'].astype(str)
    )

    max_alt = alt_df.groupby('grp_key')['IDNRK'].count().max() if len(alt_df) > 0 else 0
    if pd.isna(max_alt):
        max_alt = 0

    def flatten_substitutes(group):
        """把同一替代组内的多个子件横向铺平：CHILD / substitute_1 / substitute_2 ..."""
        items = group['IDNRK'].astype(str).tolist()
        first = group.iloc[0]
        rec = {
            'bomroot': first['bomroot'],
            'level':   first['level'],
            'NAME':    first['NAME'],
            'MENGE':   first['MENGE'],
            'path':    first['path'],
        }
        # 保留原始业务字段（取每组第一行的值，避免替代料扁平化后丢失 BU/Site 等）
        skip_cols = {'bomroot', 'level', 'NAME', 'MENGE', 'path', 'IDNRK',
                     'ALPGR', 'grp_key', 'scope', 'parent_scope_key',
                     'child_scope_key', 'is_leaf'}
        for col in group.columns:
            if col not in skip_cols:
                rec[col] = first[col]
        # 先全部初始化为空字符串（保证列对齐）
        for i in range(int(max_alt)):
            col = 'CHILD' if i == 0 else f'substitute_{i}'
            rec[col] = ''
        # 再按顺序填入
        for idx, val in enumerate(items):
            col = 'CHILD' if idx == 0 else f'substitute_{idx}'
            rec[col] = val
        return rec

    alt_result = pd.DataFrame()
    if max_alt and len(alt_df):
        # 修复 Pandas 2.x DeprecationWarning：显式排除分组列
        alt_result = alt_df.groupby('grp_key', as_index=False).apply(
            lambda g: pd.Series(flatten_substitutes(g)),
            include_groups=False
        )

    # =========================
    # 8. 合并并整理列序
    # =========================
    final = pd.concat([no_alt_df, alt_result], ignore_index=True, sort=False)

    cols_order = ['bomroot', 'level', 'NAME', 'CHILD']
    max_sub = final.filter(regex=r'^substitute_\d+$').shape[1]
    cols_order += [f'substitute_{i}' for i in range(1, max_sub + 1)]
    cols_order += ['MENGE', 'path']

    existing = [c for c in cols_order if c in final.columns]
    biz_left = [c for c in final.columns if c not in existing and c not in [
        'IDNRK', 'ALPGR', 'grp_key', 'scope', 'parent_scope_key', 'child_scope_key', 'is_leaf'
    ]]
    final = final[existing + biz_left]

    # 把 NAME 改名为 Parent，语义更清晰
    if 'NAME' in final.columns:
        final = final.rename(columns={'NAME': 'Parent'})

    return final


if __name__ == '__main__':
    input_path  = r'D:\Py projects\Dixon MPS\Dxion2\WHERE_USE_INHOUSE_SITE20251107145222.xlsx'
    output_path = r'D:\Py projects\Dixon MPS\Dxion2\WHERE_USE_LEAF.xlsx'

    print(f"读取: {input_path}")
    df = pd.read_excel(input_path)
    print(f"原始数据 shape: {df.shape}")

    result = generate_leaf_where_use(df)
    print(f"Leaf 结果 shape: {result.shape}")

    result.to_excel(output_path, index=False)
    print(f"已输出: {output_path}")
