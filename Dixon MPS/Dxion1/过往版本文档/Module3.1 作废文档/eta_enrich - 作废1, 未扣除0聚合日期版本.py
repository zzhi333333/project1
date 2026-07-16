"""
STEP 5.3  ETA 到料 & Description / Model 回写
输入:
    Net_dmd_BPS_result_<date>.xlsx   (来自 mrp5_2_compute 输出)
    LNV Dixon Open PO.xlsx           (同 STEP 5.2 选择文件)
输出:
    Net_BPSONS_ETA_<date>.xlsx
"""

import pandas as pd
from datetime import timedelta
from pathlib import Path
from utils.common import save_df

# ------------- 常量 -------------
MOT_2_WEEKS = {"air": 2, "sea": 6}

def _calc_eta(etd, mot):
    """
    根据 ETD 和 MOT 返回 ETA 日期字符串或 'TBC'
    """
    if pd.isna(etd):
        return "TBC"
    mot = str(mot).strip().lower()
    weeks = MOT_2_WEEKS.get(mot)
    if weeks is None:
        return "TBC"
    return (etd + timedelta(weeks=weeks)).date()


def run_eta_enrich(bps_path: Path, openpo_path: Path, today_str: str) -> pd.DataFrame:
    """
    主流程：读文件 → 计算 → 回写 → 返回最终 DataFrame
    """
    # 1. 读取文件
    bps_df = pd.read_excel(bps_path, engine="openpyxl")
    openpo = pd.read_excel(openpo_path, sheet_name="Combined", engine="openpyxl")

    # 2. 清理字段
    openpo["ALT Customer PN"] = openpo["ALT Customer PN"].astype(str).str.strip()
    openpo["Confirm ETD"] = pd.to_datetime(openpo["Confirm ETD"], errors="coerce")
    openpo["MOT"] = openpo["MOT"].astype(str).str.strip().str.lower()

    # 3. 计算 ETA（空 ETD → "TBC"）
    openpo["ETA"] = openpo.apply(lambda r: _calc_eta(r["Confirm ETD"], r["MOT"]), axis=1)

    # 4. 构建映射
    desc_map = (
        openpo.dropna(subset=["Description"])
        .drop_duplicates(subset=["ALT Customer PN"])
        .set_index("ALT Customer PN")["Description"]
    )
    model_map = (
        openpo.dropna(subset=["Model"])
        .groupby("ALT Customer PN")["Model"]
        .apply(lambda x: ", ".join(sorted(set(x))))
    )

    # 5. Description / Model 回写
    pn_cols = [c for c in bps_df.columns if c.startswith(("CHILD", "substitute_"))]
    bps_df["Description"] = None
    bps_df["Model"] = ""
    for idx, row in bps_df.iterrows():
        pns = {str(row[c]).strip() for c in pn_cols if pd.notna(row[c])}
        desc = next((desc_map[pn] for pn in pns if pn in desc_map), None)
        models = sorted({model_map[pn] for pn in pns if pn in model_map})
        bps_df.at[idx, "Description"] = desc
        bps_df.at[idx, "Model"] = ", ".join(models)

    # 6. 聚合 ETA（含 "TBC"）到料, 增加删除全0
    eta_pivot = (
        openpo.groupby(["ALT Customer PN", "ETA"])["Total"]
        .sum()
        .unstack(fill_value=0)
    )


    for eta_key in eta_pivot.columns:
        col_name = str(eta_key)  # 日期或 "TBC"
        bps_df[col_name] = bps_df[pn_cols].apply(
            lambda row: sum(
                eta_pivot.at[pn, eta_key] if pn in eta_pivot.index else 0
                for pn in row.dropna().astype(str)
            ),
            axis=1,
        )



    # 7. 保存最终文件
    out_name = f"Net_BPSONS_ETA_{today_str}.xlsx"
    save_df(bps_df, out_name)
    print(f"[STEP 5.3] ETA 到料处理完成 -> output/{out_name}")
    return bps_df