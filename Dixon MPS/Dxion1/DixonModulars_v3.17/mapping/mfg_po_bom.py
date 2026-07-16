import pandas as pd
from utils.common import find_col

def build_mfg_po_bom_mapping(bom_leaf_df, sbb_order_update_df):
    bom = bom_leaf_df.copy()
    order = sbb_order_update_df.copy()
    col_sbb = find_col(order, ["SBB"])
    col_need = find_col(order, ["订单用量", "订单 用量", "订单数量"])
    order_agg = order.groupby(col_sbb, as_index=False)[col_need].sum()
    sbb_qty_map = dict(zip(order_agg[col_sbb].astype(str), order_agg[col_need].astype(float)))
    bom["MFG_PO_Qty"] = bom["bomroot"].astype(str).map(sbb_qty_map).fillna(0)
    bom["MENGE"] = pd.to_numeric(bom["MENGE"], errors="coerce").fillna(0)
    bom["MENGE_times_MFG_PO_Qty"] = bom["MENGE"] * bom["MFG_PO_Qty"]
    return bom