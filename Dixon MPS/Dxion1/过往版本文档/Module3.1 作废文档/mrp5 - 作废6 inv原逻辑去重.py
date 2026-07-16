# inventory/mrp5.py 库存去重原逻辑: 同一 PN 的库存只能给一次需求, used_odm_pns 只在“单行内部”生效，无法阻止同一个 PN 在 不同 combo_key 之间
# 被重复分配库存——也就是说，旧代码本质上是“无跨行去重”, 全局集合去重，不打孔，只贴封条 —— 一颗料一旦被任何行“碰过”，后面再出现就彻底失效。
from __future__ import annotations
import re
import pandas as pd
from utils.common import find_col, norm
from config import ENABLE_MAXFLOW

ACTIVE_LOCATIONS = {
    "LNV-FA STORE", "LNV-FA-PROD-LINE", "LNV-FG STORE", "LNV-PACKING KIT",
    "LNV-PAKG STORE", "LNV-PKGING LINE", "LNV-SMT KIT", "LNV-SMT STORE", "LNV-SMT-PROD"
}

def normalize_odm_pn(pn):
    pn = str(pn).strip()
    return pn.lstrip("0") if pn.isdigit() else pn

def _strip_cols(df):
    cols = ["CHILD"] + [c for c in df.columns if str(c).startswith("substitute")]
    for col in cols:
        if col in df.columns:
            df[col] = df[col].astype(str).apply(normalize_odm_pn)

def mrp5_1_compute(mfg_po_bom_mapping_df, odm_inv_df, enable_maxflow=False):
    bom = mfg_po_bom_mapping_df.copy()
    inv = odm_inv_df.copy()

    inv.columns = [str(c).strip() for c in inv.columns]
    col_odm_pn = find_col(inv, ["ODM PN", "PN", "Part Number"])
    col_odm_qty = find_col(inv, ["ODM QTY", "QTY", "Quantity"])
    col_loc_desc = find_col(inv, ["Location Desc", "Location", "Loc Desc"])

    inv_filt = inv[inv[col_loc_desc].astype(str).str.strip().isin(ACTIVE_LOCATIONS)].copy()
    inv_filt[col_odm_pn] = inv_filt[col_odm_pn].astype(str).apply(normalize_odm_pn)
    inv_filt[col_odm_qty] = pd.to_numeric(inv_filt[col_odm_qty], errors="coerce").fillna(0)
    inv_agg = inv_filt.groupby(col_odm_pn, as_index=False)[col_odm_qty].sum()
    inv_lookup = dict(zip(inv_agg[col_odm_pn], inv_agg[col_odm_qty]))

    _strip_cols(bom)
    sub_cols = [c for c in bom.columns if str(c).startswith("substitute")]
    all_match_cols = ["CHILD"] + sub_cols

    def create_sorted_key(row):
        parts = [normalize_odm_pn(str(row[c])) for c in all_match_cols if c in row and pd.notna(row[c])]
        return ",".join(sorted(set(parts)))

    bom["combo_key"] = bom.apply(create_sorted_key, axis=1)
    bom["MENGE_times_MFG_PO_Qty"] = pd.to_numeric(bom["MENGE_times_MFG_PO_Qty"], errors="coerce").fillna(0)

    agg = bom.groupby("combo_key", as_index=False).agg({"MENGE_times_MFG_PO_Qty": "sum"})
    first_rows = bom.drop_duplicates("combo_key").set_index("combo_key")
    for col in all_match_cols:
        if col in first_rows.columns:
            agg[col] = agg["combo_key"].map(first_rows[col])

    used_odm_pns = set()
    def compute_dixon_qty(row):
        candidates = [normalize_odm_pn(str(row[c])) for c in all_match_cols if c in row and pd.notna(row[c])]
        matched_parts = {pn for pn in candidates if pn in inv_lookup and pn not in used_odm_pns}
        used_odm_pns.update(matched_parts)
        return sum(inv_lookup[p] for p in matched_parts)

    agg["Dixon_inv_Qty"] = agg.apply(compute_dixon_qty, axis=1)

    return agg

def mrp5_2_compute(final_bom_agg_df, open_po_df):
    df = final_bom_agg_df.copy()
    opo = open_po_df.copy()

    opo.columns = [str(c).strip() for c in opo.columns]
    col_alt = find_col(opo, ["ALT Customer PN", "Alt Customer PN", "ALT_PN", "ALT PN"])
    col_total = find_col(opo, ["Total", "Qty", "Quantity"])

    opo[col_alt] = opo[col_alt].astype(str).str.strip().apply(normalize_odm_pn)
    po_lookup = opo.groupby(col_alt)[col_total].sum().to_dict()

    _strip_cols(df)
    sub_cols = [c for c in df.columns if str(c).startswith("substitute")]
    all_match_cols = ["CHILD"] + sub_cols

    used_pns = set()
    def _sum_total(row):
        total = 0.0
        for col in all_match_cols:
            if col in row and pd.notna(row[col]):
                pn = normalize_odm_pn(str(row[col]))
                if pn not in used_pns:
                    total += po_lookup.get(pn, 0.0)
                    used_pns.add(pn)
        return total

    df["Dixon_Open_PO_Qty"] = df.apply(_sum_total, axis=1)
    df["BPS"] = pd.to_numeric(df["MENGE_times_MFG_PO_Qty"], errors="coerce").fillna(0) - \
                pd.to_numeric(df["Dixon_inv_Qty"], errors="coerce").fillna(0)
    df["net_dmd_result"] = df["BPS"] - pd.to_numeric(df["Dixon_Open_PO_Qty"], errors="coerce").fillna(0)

    return df