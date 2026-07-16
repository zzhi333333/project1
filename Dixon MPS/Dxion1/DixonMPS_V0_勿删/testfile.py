import pandas as pd
import re
import networkx as nx

# ========== 全局参数开关 ==========
enable_maxflow = False   # True=启用最大流分配（精确），False=仅用简单匹配（快速）

# ========== 1. 数据读取 ==========
bom_df = pd.read_excel("D:\Python projects\Dixon MPS\MFG_PO_BOM_mapping.xlsx", engine="openpyxl")
inv_df = pd.read_excel("D:\Python projects\Dixon MPS\maual_input\ODM_INVERTORY_20250813180820.xlsx", engine="openpyxl")

# 获取替代料字段
substitute_cols = [col for col in bom_df.columns if col.startswith("substitute")]
all_match_cols = ["CHILD"] + substitute_cols

# ========== 2. 创建标准化组合键 ==========
def create_sorted_key(row):
    parts = [row[col] for col in all_match_cols if pd.notna(row[col])]
    sorted_parts = sorted(set(parts))
    return ",".join(sorted_parts)

bom_df["combo_key"] = bom_df.apply(create_sorted_key, axis=1)

# ========== 3. 汇总 BOM 数据 ==========
bom_df["MENGE_times_MFG_PO_Qty"] = bom_df["MENGE_times_MFG_PO_Qty"].fillna(0)
bom_agg = bom_df.groupby("combo_key", as_index=False).agg({
    "MENGE_times_MFG_PO_Qty": "sum"
})

# 保留代表性字段
first_rows = bom_df.drop_duplicates("combo_key").set_index("combo_key")
for col in all_match_cols:
    bom_agg[col] = bom_agg["combo_key"].map(first_rows[col])

# ========== 4. 标准化 ODM PN ==========
def normalize_odm_pn(pn):
    if isinstance(pn, str) and re.fullmatch(r"0+\d+", pn):
        return str(int(pn))  # 去除前导零
    return pn  # 保留原样

inv_df["ODM PN"] = inv_df["ODM PN"].apply(normalize_odm_pn)
inv_df["ODM QTY"] = inv_df["ODM QTY"].fillna(0)

# 汇总库存数据
inv_agg = inv_df.groupby("ODM PN", as_index=False).agg({"ODM QTY": "sum"})
inv_lookup = dict(zip(inv_agg["ODM PN"], inv_agg["ODM QTY"]))

# ========== 5. 避免重复计算的库存分配 ==========
used_odm_pns = set()

def compute_dixon_qty(row):
    candidates = [row[col] for col in all_match_cols if pd.notna(row[col])]
    matched_parts = set()
    for part in candidates:
        norm_part = normalize_odm_pn(part)
        if norm_part in inv_lookup and norm_part not in used_odm_pns:
            matched_parts.add(norm_part)
    used_odm_pns.update(matched_parts)
    return sum(inv_lookup[part] for part in matched_parts)

bom_agg["Dixon_inv_Qty"] = bom_agg.apply(compute_dixon_qty, axis=1)

# ========== 6. 保存主结果 ==========
bom_agg.to_excel("Final_BOM_ODM_Mapping.xlsx", index=False)
print("已保存主结果 Final_BOM_ODM_Mapping.xlsx")

# ========== 7. 最大流分配函数 ==========
def run_maxflow(bom_df, inv_df, all_match_cols):
    """
    根据 BOM 组合和库存，计算最大流分配，避免交叉组合重复消耗库存
    """
    G = nx.DiGraph()

    # 源点和汇点
    source = "SRC"
    sink = "SNK"

    # 库存节点
    for _, row in inv_df.iterrows():
        pn = row["ODM PN"]
        qty = row["ODM QTY"]
        if qty > 0:
            G.add_edge(source, pn, capacity=qty)

    # 需求节点
    for _, row in bom_df.iterrows():
        combo = row["combo_key"]
        demand = row["MENGE_times_MFG_PO_Qty"]
        if demand > 0:
            G.add_edge(combo, sink, capacity=demand)

    # 连接关系：BOM 组合 ↔ ODM PN
    for _, row in bom_df.iterrows():
        combo = row["combo_key"]
        candidates = [row[col] for col in all_match_cols if pd.notna(row[col])]
        for part in candidates:
            norm_part = normalize_odm_pn(part)
            if norm_part in inv_lookup:
                # 无限大容量，约束在 supply/demand 上
                G.add_edge(norm_part, combo, capacity=float("inf"))

    # 求最大流
    flow_value, flow_dict = nx.maximum_flow(G, source, sink)

    # 提取分配结果
    allocation = []
    for pn in inv_lookup.keys():
        if pn in flow_dict:
            for combo, flow in flow_dict[pn].items():
                if flow > 0 and combo != sink:
                    allocation.append({
                        "combo_key": combo,
                        "ODM PN": pn,
                        "Allocated_Qty": flow
                    })

    return pd.DataFrame(allocation)

# ========== 8. 可选：运行最大流 ==========
if enable_maxflow:
    print("启用最大流计算，正在进行库存分配...")
    allocation_detail = run_maxflow(bom_agg, inv_agg, all_match_cols)
    allocation_detail.to_excel("Allocation_Detail.xlsx", index=False)
    print("最大流分配结果已保存到 Allocation_Detail.xlsx")
