# Skill: BOM Leaf 展开 —— 基于 Path 的 Where-Use 表处理

## 背景

当 Source BOM 表以 **扁平化 Path** 形式提供（如 `/SBB001/M100/M200`），而非传统的 `Parent-Child` 两行式结构时，需要一套适配逻辑来完成：

1. **Leaf 节点识别**（过滤中间节点）
2. **用量保留**
3. **替代料横向展开**（Alt Group 扁平化）
4. **跨 BU / Site 隔离**

本 Skill 记录从 `leaf.py` 复用核心逻辑、适配新表结构的完整方法论。

---

## 输入数据特征

| 列名 | 含义 | 示例 |
|---|---|---|
| `Path` | 层级路径，以 `/` 分隔 | `/SBB1M86676/SG11N50928/SB11M64612` |
| `Item` | 当前行对应的子件（通常是路径末级） | `SB11M64612` |
| `Item Usage` | 当前节点的用量 | `1.0` |
| `Alter Native Group` | 替代组标识 | `SINGLE` 或 `2_119` |
| `BU` | 业务单元 | `IdeaNB` / `ThinkNB` |
| `Site` | 工厂/站点 | `DIXON` |
| `SBB` | 顶层根件 | `SBB1M86676` |

**关键约束**：
- 无显式 `Parent` 列，需从 `Path` 提取倒数第二级。
- `SINGLE` 表示**无替代料**，不可直接作为分组键。
- 数据存在重复行（相同 `Path + Item`）。
- **跨 BU 同名料号可能角色不同**（在 BU-A 是叶子，在 BU-B 是父件）。

---

## 核心处理流程

```python
import pandas as pd
from utils.common import find_col, norm

def generate_leaf_where_use(df):
    # 1. 基础清洗
    df = df.drop_duplicates().copy()

    # 2. 动态字段识别（不硬编码）
    path_col = find_col(df, ['path'])
    item_col = find_col(df, ['item'])
    qty_col  = find_col(df, ['item usage', 'usage', 'qty', 'menge'])
    alt_col  = find_col(df, ['alter native group', 'alpgr', 'alt group'])
    bu_col   = find_col(df, ['bu'])
    site_col = find_col(df, ['site'])

    # 3. 从 Path 提取父子关系
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

    # 4. 字段标准化
    df['IDNRK'] = df[item_col]
    df['MENGE'] = df[qty_col]
    df['path']  = df[path_col]

    # ⚠️ 关键转换：SINGLE → 空字符串，否则 leaf.py 会把它当成一个巨大替代组
    df['ALPGR'] = df[alt_col].apply(
        lambda x: '' if pd.isna(x) or str(x).strip().upper() == 'SINGLE' else str(x).strip()
    )

    # 5. BU + Site 隔离 Key（防止跨 BU 同名料号互相干扰）
    df['scope'] = df[bu_col].astype(str) + '|' + df[site_col].astype(str)
    df['parent_scope_key'] = df['scope'] + '|' + df['NAME'].astype(str)
    df['child_scope_key']  = df['scope'] + '|' + df['IDNRK'].astype(str)

    # 6. 叶子节点筛选（集合差写法，Pythonic 且高效）
    parent_keys = set(df['parent_scope_key'])
    child_keys  = set(df['child_scope_key'])
    leaf_keys   = child_keys - parent_keys   # 只在 child 中出现，没在 parent 中出现 = 真叶子

    df['is_leaf'] = df['child_scope_key'].isin(leaf_keys)
    leaf_df = df[df['is_leaf']].copy()

    # 7. 替代料扁平化（复用 leaf.py 核心逻辑）
    # 7.1 无替代料子集
    leaf_df['ALPGR'] = leaf_df['ALPGR'].fillna('')
    no_alt_mask = leaf_df['ALPGR'] == ''
    no_alt_df = leaf_df[no_alt_mask].copy().rename(columns={'IDNRK': 'CHILD'})

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
        items = group['IDNRK'].astype(str).tolist()
        first = group.iloc[0]
        rec = {
            'bomroot': first['bomroot'],
            'level':   first['level'],
            'NAME':    first['NAME'],
            'MENGE':   first['MENGE'],
            'path':    first['path'],
        }
        # ⚠️ 必须保留原始业务字段，否则扁平化后 BU/Site 会丢失
        skip_cols = {'bomroot', 'level', 'NAME', 'MENGE', 'path', 'IDNRK',
                     'ALPGR', 'grp_key', 'scope', 'parent_scope_key',
                     'child_scope_key', 'is_leaf'}
        for col in group.columns:
            if col not in skip_cols:
                rec[col] = first[col]
        # 横向铺平替代料槽位
        for i in range(int(max_alt)):
            col = 'CHILD' if i == 0 else f'substitute_{i}'
            rec[col] = ''
        for idx, val in enumerate(items):
            col = 'CHILD' if idx == 0 else f'substitute_{idx}'
            rec[col] = val
        return rec

    alt_result = pd.DataFrame()
    if max_alt and len(alt_df):
        alt_result = alt_df.groupby('grp_key', as_index=False).apply(
            lambda g: pd.Series(flatten_substitutes(g)),
            include_groups=False          # 修复 Pandas 2.x DeprecationWarning
        )

    # 8. 合并输出
    final = pd.concat([no_alt_df, alt_result], ignore_index=True, sort=False)
    final = final.rename(columns={'NAME': 'Parent'})
    return final
```

---

## 关键陷阱与修复记录

### Trap 1: `SINGLE` 被误判为替代组

**现象**：未做转换时，`Alter Native Group = 'SINGLE'` 被当成一个非空替代组，导致所有 SINGLE 行被聚合为一个巨大替代组，生成 200+ 列 `substitute_xxx`。

**修复**：
```python
df['ALPGR'] = df['Alter Native Group'].apply(
    lambda x: '' if pd.isna(x) or str(x).strip().upper() == 'SINGLE' else str(x).strip()
)
```

---

### Trap 2: 跨 BU 同名料号导致叶子误判

**现象**：料号 `GX21J75547` 在 **ThinkNB** 下是叶子（只有 Child 记录），在 **IdeaNB** 下是父件（有 `/SBB1K85478/GX21J75547/SA11J62099`）。

**未隔离时**：ThinkNB 的 3 行 `GX21J75547` 被错误过滤（因为看到了 IdeaNB 下的 Parent 记录）。

**修复**：引入 `scope = BU|Site`，叶子判定基于 `child_scope_key - parent_scope_key`。

| 版本 | 过滤非叶子行数 | 是否正确 |
|---|---|---|
| v2（无 BU 隔离） | 17 行 | ❌ 跨 BU 误判 |
| v3（BU 隔离） | 0 行 | ✅ |

---

### Trap 3: 替代料扁平化后丢失业务字段

**现象**：`flatten_substitutes` 只返回 `bomroot, level, NAME, MENGE, path` 和替代料子列，`BU` / `Site` 等字段变为 NaN。

**修复**：在 `flatten_substitutes` 中显式遍历 `group.columns`，将第一行的业务字段附加到 `rec`。

| 字段 | 修复前非空率 | 修复后 |
|---|---|---|
| `BU` | 76.9% | 100.0% |
| `Site` | 76.9% | 100.0% |

---

### Trap 4: `groupby.apply` DeprecationWarning

**修复**：
```python
alt_result = alt_df.groupby('grp_key', as_index=False).apply(
    lambda g: pd.Series(flatten_substitutes(g)),
    include_groups=False
)
```

---

## 验证清单（Checklist）

每次修改后必须跑以下验证：

| # | 验证项 | 通过标准 |
|---|---|---|
| 1 | 字段完整性 | `bomroot, Parent, CHILD, MENGE, path, BU, Site` 非空率 100% |
| 2 | 叶子隔离 | 各 BU 内 `CHILD` 集合与 `Parent` 集合交集为 ∅ |
| 3 | 替代料合并 | 同一 `(BU, bomroot, Parent, AltGroup)` 的多个 Item 已合并为一行 |
| 4 | 路径一致性 | `Path` 末级 ≡ `CHILD`，无差异行 |
| 5 | 用量合理性 | `MENGE` 无 NaN，范围符合业务预期 |
| 6 | 重复检查 | 按 BU 分组后，`Path + CHILD` 无组内重复 |
| 7 | 边界案例 | 跨 BU 同名料号（如 `GX21J75547`）在各 BU 下角色正确 |

---

## 复用提示词（Prompt Template）

```
任务：复用 leaf.py 的 Leaf 展开逻辑，处理新的 Where-Use 表。

输入表特征：
- 字段：Path（/分隔）、Item（子件）、Item Usage（用量）、Alter Native Group（替代组）、BU、Site、SBB
- 无显式 Parent 列，需从 Path 提取
- Alter Native Group = 'SINGLE' 表示无替代料
- 数据可能跨 BU，同名料号在不同 BU 下角色可能不同

要求：
1. 使用 find_col 动态识别字段，不硬编码
2. BU + Site 隔离，防止跨 BU 误判
3. 从 Path 提取 bomroot、Parent、level
4. SINGLE → 空串转换
5. 复用 leaf.py 的替代料横向扁平化逻辑
6. flatten_substitutes 必须保留原始业务字段（BU/Site等）
7. 包含完整验证：字段完整性、叶子隔离、替代料合并、路径一致性、重复检查
```

---

## 文件位置

| 文件 | 路径 |
|---|---|
| 输入数据 | `D:\Py projects\Dixon MPS\Dxion2\WHERE_USE_INHOUSE_SITE20251107145222.xlsx` |
| 输出结果 | `D:\Py projects\Dixon MPS\Dxion2\WHERE_USE_LEAF.xlsx` |
| 处理脚本 | `D:\Py projects\Dixon MPS\Dxion2\leaf_expand_where_use.py` |
| 本 Skill | `D:\Py projects\Dixon MPS\Dxion2\SKILL_leaf_expand_where_use.md` |
