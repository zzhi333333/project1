# inventory/mrp5.py
from __future__ import annotations
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

# ========== Active Location 白名单 ==========
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
    """去掉纯数字 PN 的前导 0"""
    pn = str(pn).strip()
    if pn.isdigit():
        return re.sub(r"^0+(?=\d+$)", "", pn)
    return pn


def _strip_cols(df: pd.DataFrame) -> None:
    """一次性把 CHILD 和所有 substitute_* 列去掉前导 0"""
    cols = ["CHILD"] + [c for c in df.columns if str(c).startswith("substitute")]
    for col in cols:
        if col in df.columns:
            df[col] = df[col].astype(str).apply(normalize_odm_pn)

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

    # 2. 过滤 + 汇总库存（仅 Active Location）
    inv_filt = inv[
        inv[col_loc_desc].astype(str).str.strip().isin(ACTIVE_LOCATIONS)
    ].copy()
    # 统一去掉库存端 ODM PN 前导 0
    inv_filt[col_odm_pn] = inv_filt[col_odm_pn].astype(str).apply(normalize_odm_pn)
    inv_filt[col_odm_qty] = pd.to_numeric(inv_filt[col_odm_qty], errors="coerce").fillna(0)
    inv_agg = inv_filt.groupby(col_odm_pn, as_index=False)[col_odm_qty].sum()
    inv_lookup = dict(zip(inv_agg[col_odm_pn], inv_agg[col_odm_qty]))

    # 3. 需求端统一去 0
    _strip_cols(bom)

    # 4. 组合键
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

    # 5. 计算 Dixon_inv_Qty
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

    # 6. （可选）最大流
    if enable_maxflow and HAVE_NETWORKX:
        G = nx.DiGraph()
        SRC, SNK = "SRC", "SNK"
        for pn, qty in inv_lookup.items():
            if qty > 0:
                G.add_edge(SRC, pn, capacity=float(qty))
        for _, r in agg.iterrows():
            demand = r["MENGE_times_MFG_PO_Qty"]
            combo = r["combo_key"]
            if demand > 0:
                G.add_edge(combo, SNK, capacity=float(demand))
        for _, r in agg.iterrows():
            combo = r["combo_key"]
            candidates = [normalize_odm_pn(str(r[c]))
                          for c in all_match_cols if c in r and pd.notna(r[c])]
            for pn in candidates:
                if pn in inv_lookup:
                    G.add_edge(pn, combo, capacity=float("inf"))
        flow_value, _ = nx.maximum_flow(G, SRC, SNK)
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

    # 1) 建立 ALT Customer PN → Total 映射
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
    # 库存端统一去 0
    opo[col_alt] = opo[col_alt].apply(normalize_odm_pn)
    po_lookup = opo.groupby(col_alt)[col_total].sum().to_dict()

    # 2) 需求端统一去 0
    _strip_cols(df)

    # 3) 扫描 CHILD + substitute_* 累加 Total
    sub_cols = [c for c in df.columns if str(c).startswith("substitute")]
    all_match_cols = ["CHILD"] + sub_cols

    def _sum_total(row):
        total = 0.0
        for col in all_match_cols:
            if col in row and pd.notna(row[col]):
                pn = str(row[col]).strip()
                total += float(po_lookup.get(normalize_odm_pn(pn), 0.0))
        return total

    df["Dixon_Open_PO_Qty"] = df.apply(_sum_total, axis=1)

    # 4) 计算 BPS / net_demand
    df["BPS"] = (
        pd.to_numeric(df["MENGE_times_MFG_PO_Qty"], errors="coerce").fillna(0)
        - pd.to_numeric(df["Dixon_inv_Qty"], errors="coerce").fillna(0)
    )
    df["net_dmd_result"] = (
        df["BPS"]
        - pd.to_numeric(df["Dixon_Open_PO_Qty"], errors="coerce").fillna(0)
    )
    return df