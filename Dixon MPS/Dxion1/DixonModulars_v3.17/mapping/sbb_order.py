import pandas as pd
from utils.common import find_col

def compute_sbb_order_qty(dixon_po_df, mtm_map_df):
    ddf = dixon_po_df.copy()
    col_mtm = find_col(ddf, ["MTM"])
    col_qty = find_col(ddf, ["Qty", "QTY", "Quantity"])
    pivot = ddf.groupby(col_mtm, as_index=False)[col_qty].sum().rename(columns={col_qty: "MTM Qty"})
    pivot[col_mtm] = pivot[col_mtm].astype(str).str.strip().str.upper()
    mtm_map_df['MTM'] = mtm_map_df['MTM'].astype(str).str.strip().str.upper()
    merged = pd.merge(mtm_map_df, pivot, on="MTM", how="left")
    map_qty_col = find_col(merged, ["Qty", "QTY", "Qty "])
    merged["MTM Qty"] = merged["MTM Qty"].fillna(0)
    merged["订单用量"] = pd.to_numeric(merged[map_qty_col], errors='coerce').fillna(0) * pd.to_numeric(merged["MTM Qty"], errors='coerce').fillna(0)
    final = merged.rename(columns={map_qty_col: "Qty"})
    cols = [c for c in ["MTM", "SBB", "Qty", "SBB Name", "Basic Name", "MTM Qty", "订单用量"] if c in final.columns]
    return final[cols]