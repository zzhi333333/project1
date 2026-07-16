import re
import pandas as pd
from utils.common import find_col, norm

ACTIVE_LOCATIONS = {
    "LNV-FA STORE", "LNV-FA-PROD-LINE", "LNV-FG STORE",
    "LNV-PACKING KIT", "LNV-PAKG STORE", "LNV-PKGING LINE",
    "LNV-SMT KIT", "LNV-SMT STORE", "LNV-SMT-PROD"
}

def sfg_deduct(sbb_order_df, odm_inv_df, sfg_map_df=None):
    out = sbb_order_df.copy()

    # 1. 只保留白名单内的 SFG 库存
    inv = odm_inv_df.copy()
    inv.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in inv.columns]

    col_mat_type = find_col(inv, ["Material Type", "Material_Type", "MaterialType"])
    col_odm_pn   = find_col(inv, ["ODM PN", "ODM_PN", "PN", "Part Number"])
    col_odm_qty  = find_col(inv, ["ODM QTY", "ODM_QTY", "ODMQTY", "ODM QTY", "QTY", "Quantity"])
    col_loc_desc = find_col(inv, ["Location Desc", "Location", "Loc Desc"])

    sfg_inv = inv[
        (inv[col_mat_type].astype(str).str.upper() == "SFG") &
        (inv[col_loc_desc].astype(str).str.strip().isin(ACTIVE_LOCATIONS))
    ].copy()

    sfg_inv[col_odm_pn]  = sfg_inv[col_odm_pn].astype(str).str.strip()
    sfg_inv[col_odm_qty] = pd.to_numeric(sfg_inv[col_odm_qty], errors="coerce").fillna(0)

    # 2. 建立 SBB → 可扣减总量字典
    sbb_odm_qty = {}
    if sfg_map_df is not None:
        mp = sfg_map_df.copy()
        mp.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in mp.columns]
        try:
            col_key = find_col(mp, ["SMT Planner", "ODM PN", "PN", "Part Number"])
            col_val = find_col(mp, ["SBB"])
            sfg_inv = sfg_inv.merge(mp[[col_key, col_val]], left_on=col_odm_pn, right_on=col_key, how="left")
            sfg_inv = sfg_inv.dropna(subset=[col_val])
            sbb_odm_qty = sfg_inv.groupby(col_val)[col_odm_qty].sum().to_dict()
        except KeyError:
            pass  # 无映射时走兜底

    # 兜底：直接按 SBB 字段汇总
    if not sbb_odm_qty:
        for colname in sfg_inv.columns:
            if norm(colname) == 'sbb':
                sbb_col = colname
                sbb_odm_qty = sfg_inv.groupby(sbb_col)[col_odm_qty].sum().to_dict()
                break

    if not sbb_odm_qty:
        return out  # 无 SFG 可扣减

    # 3. 扣减逻辑（与原一致）
    try:
        col_sbb  = find_col(out, ["SBB"])
        col_need = find_col(out, ["订单用量", "订单 用量", "订单数量", "order_qty", "order qty"])
    except KeyError:
        col_sbb  = out.columns[0] if "SBB" not in out.columns else "SBB"
        col_need = out.columns[-1]

    for sbb, total_odm_qty in sbb_odm_qty.items():
        mask = out[col_sbb].astype(str) == str(sbb)
        indices = out[mask].index
        rem = float(total_odm_qty)
        for idx in indices:
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