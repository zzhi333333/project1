import re
import pandas as pd
from utils.common import find_col, norm

### 需要更新: 更新内容, SFG 从Dixon PO 中映射选择需要跟MRP5.py中一样,需要考虑库存白名单

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

def sfg_deduct(sbb_order_df, odm_inv_df, sfg_map_df=None):
    out = sbb_order_df.copy()
    inv = odm_inv_df.copy()
    col_mat_type = find_col(inv, ["Material Type", "Material_Type", "MaterialType"])
    col_odm_pn = find_col(inv, ["ODM PN", "ODM_PN", "PN", "Part Number", "PartNumber"])
    col_odm_qty = find_col(inv, ["ODM QTY", "ODM_QTY", "ODMQTY", "ODM QTY", "QTY", "Quantity"])
    sfg_inv = inv[inv[col_mat_type].astype(str).str.upper() == "SFG"].copy()
    sbb_odm_qty = {}
    if sfg_map_df is not None:
        mp = sfg_map_df.copy()
        mp.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in mp.columns]
        try:
            col_key = find_col(mp, ["SMT Planner", "ODM PN", "PN", "Part Number"])
            col_val = find_col(mp, ["SBB"])
        except KeyError:
            col_key = None
            col_val = None
        if col_key and col_val:
            sfg_inv = sfg_inv.merge(mp[[col_key, col_val]], left_on=col_odm_pn, right_on=col_key, how='left')
            sfg_inv = sfg_inv.dropna(subset=[col_val])
            sbb_odm_qty = sfg_inv.groupby(col_val)[col_odm_qty].sum().to_dict()
    if not sbb_odm_qty:
        for colname in sfg_inv.columns:
            if norm(colname) == 'sbb':
                sbb_col = colname
                sbb_odm_qty = sfg_inv.groupby(sbb_col)[col_odm_qty].sum().to_dict()
                break
    if not sbb_odm_qty:
        return out
    try:
        col_sbb = find_col(out, ["SBB"])
        col_need = find_col(out, ["订单用量", "订单 用量", "order_qty", "order qty", "订单数量"])
    except KeyError:
        if "SBB" in out.columns:
            col_sbb = "SBB"
        else:
            col_sbb = out.columns[0]
        col_need = out.columns[-1]
    for sbb, total_odm_qty in sbb_odm_qty.items():
        matching_indices = out[out[col_sbb].astype(str) == str(sbb)].index
        rem = float(total_odm_qty)
        for idx in matching_indices:
            cur = float(out.at[idx, col_need]) if pd.notna(out.at[idx, col_need]) else 0.0
            if rem <= 0:
                break
            if rem >= cur:
                out.at[idx, col_need] = 0.0
                rem -= cur
            else:
                out.at[idx, col_need] = cur - rem
                rem = 0.0
                break
    return out