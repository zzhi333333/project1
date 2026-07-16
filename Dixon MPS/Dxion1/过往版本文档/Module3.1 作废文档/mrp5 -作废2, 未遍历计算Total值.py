import re
import pandas as pd
from utils.common import find_col, norm
from config import ENABLE_MAXFLOW

# 运行时检测 networkx
try:
    import networkx as nx
    HAVE_NETWORKX = True
except Exception:
    HAVE_NETWORKX = False

if ENABLE_MAXFLOW and HAVE_NETWORKX:
    import networkx as nx

# ========== 新增：Active Location 白名单 ==========
ACTIVE_LOCATIONS = {
    "LNV-FA STORE",
    "LNV-FA-PROD-LINE",
    "LNV-FG STORE",
    "LNV-PACKING KIT",
    "LNV-PAKG STORE",
    "LNV-PKGING LINE",
    "LNV-SMT KIT",
    "LNV-SMT STORE",
    "LNV-SMT-PROD"
}

# ---------- 工具 ----------
def normalize_odm_pn(pn):
    if isinstance(pn, str) and re.fullmatch(r"0+\d+", pn):
        return str(int(pn))
    return str(pn).strip()

# ---------- 主函数 ----------
def mrp5_1_compute(mfg_po_bom_mapping_df, odm_inv_df, enable_maxflow=False):
    """
    Enhancement：仅对 Location Desc 在 ACTIVE_LOCATIONS 中的 ODM PN 汇总库存
    """
    bom = mfg_po_bom_mapping_df.copy()
    inv = odm_inv_df.copy()

    # 1. 列名统一
    inv.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in inv.columns]
    col_odm_pn = find_col(inv, ["ODM PN", "PN", "Part Number"])
    col_odm_qty = find_col(inv, ["ODM QTY", "QTY", "Quantity"])
    col_loc_desc = find_col(inv, ["Location Desc", "Location", "Loc Desc"])

    # 2. 过滤 + 汇总库存（只保留 Active Location）
    inv_filt = inv[
        inv[col_loc_desc].astype(str).str.strip().isin(ACTIVE_LOCATIONS)
    ].copy()
    inv_filt[col_odm_pn] = inv_filt[col_odm_pn].apply(normalize_odm_pn)
    inv_filt[col_odm_qty] = pd.to_numeric(inv_filt[col_odm_qty], errors="coerce").fillna(0)
    inv_agg = inv_filt.groupby(col_odm_pn, as_index=False)[col_odm_qty].sum()
    inv_lookup = dict(zip(inv_agg[col_odm_pn], inv_agg[col_odm_qty]))

    # 3. 组合键（与原逻辑一致）
    sub_cols = [c for c in bom.columns if str(c).startswith("substitute")]
    all_match_cols = ["CHILD"] + sub_cols

    def create_sorted_key(row):
        parts = [normalize_odm_pn(str(row[c]))
                 for c in all_match_cols
                 if c in row and pd.notna(row[c])]
        return ",".join(sorted(set(parts)))

    bom["combo_key"] = bom.apply(create_sorted_key, axis=1)
    bom["MENGE_times_MFG_PO_Qty"] = (
        pd.to_numeric(bom["MENGE_times_MFG_PO_Qty"], errors="coerce").fillna(0)
    )
    agg = bom.groupby("combo_key", as_index=False).agg({"MENGE_times_MFG_PO_Qty": "sum"})

    first_rows = bom.drop_duplicates("combo_key").set_index("combo_key")
    for col in all_match_cols:
        if col in first_rows.columns:
            agg[col] = agg["combo_key"].map(first_rows[col])

    # 4. 计算 Dixon_inv_Qty（仅来自 Active Location）
    used_odm_pns = set()

    def compute_dixon_qty(row):
        candidates = [normalize_odm_pn(str(row[c]))
                      for c in all_match_cols
                      if c in row and pd.notna(row[c])]
        matched_parts = {pn for pn in candidates
                         if pn in inv_lookup and pn not in used_odm_pns}
        used_odm_pns.update(matched_parts)
        return sum(inv_lookup[p] for p in matched_parts)

    agg["Dixon_inv_Qty"] = agg.apply(compute_dixon_qty, axis=1)

    # 5. （可选）最大流逻辑保持不变
    if enable_maxflow and HAVE_NETWORKX:
        G = nx.DiGraph()
        SRC, SNK = "SRC", "SNK"
        # 供应节点
        for pn, qty in inv_lookup.items():
            if qty > 0:
                G.add_edge(SRC, pn, capacity=float(qty))
        # 需求节点
        for _, r in agg.iterrows():
            demand = r["MENGE_times_MFG_PO_Qty"]
            combo = r["combo_key"]
            if demand > 0:
                G.add_edge(combo, SNK, capacity=float(demand))
        # 连接
        for _, r in agg.iterrows():
            combo = r["combo_key"]
            candidates = [normalize_odm_pn(str(r[c]))
                          for c in all_match_cols if c in r and pd.notna(r[c])]
            for pn in candidates:
                if pn in inv_lookup:
                    G.add_edge(pn, combo, capacity=float("inf"))
        flow_value, _ = nx.maximum_flow(G, SRC, SNK)
        # 如需要可在此处把 flow_value 写入结果

    return agg

def mrp5_2_compute(final_bom_agg_df, open_po_df):
    df = final_bom_agg_df.copy()
    cols = list(df.columns)
    if "MENGE_times_MFG_PO_Qty" in cols and "Dixon_inv_Qty" in cols:
        i_menge = cols.index("MENGE_times_MFG_PO_Qty")
        i_inv = cols.index("Dixon_inv_Qty")
        cols.insert(i_inv, cols.pop(i_menge))
        df = df[cols]
    opo = open_po_df.copy()
    opo.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in opo.columns]
    try:
        col_alt = find_col(opo, ["ALT Customer PN", "Alt Customer PN", "ALT_PN", "ALT PN"])
    except KeyError:
        possible = [c for c in opo.columns if "alt" in norm(c) and "pn" in norm(c)]
        if possible:
            col_alt = possible[0]
        else:
            raise KeyError("Open PO 表未找到 ALT Customer PN 列")
    col_total = find_col(opo, ["Total", "Qty", "Quantity"])
    opo[col_alt] = opo[col_alt].astype(str).str.strip()
    po_agg = opo.groupby(col_alt, as_index=False)[col_total].sum()
    po_map = dict(zip(po_agg[col_alt], po_agg[col_total]))

    def match_total(row):
        for c in row.index:
            if str(c).startswith("CHILD") or str(c).startswith("substitute"):
                pn = str(row[c]).strip()
                if pn in po_map:
                    return float(po_map[pn])
        return 0.0

    df["Dixon_Open_PO_Qty"] = df.apply(match_total, axis=1)
    df["BPS"] = pd.to_numeric(df["MENGE_times_MFG_PO_Qty"], errors="coerce").fillna(0) - pd.to_numeric(df["Dixon_inv_Qty"], errors="coerce").fillna(0)
    df["net_dmd_result"] = df["BPS"] - pd.to_numeric(df["Dixon_Open_PO_Qty"], errors="coerce").fillna(0)
    return df