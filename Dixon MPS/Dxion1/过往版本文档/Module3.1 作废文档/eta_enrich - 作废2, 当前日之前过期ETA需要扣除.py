import pandas as pd
from datetime import timedelta
from pathlib import Path
from utils.common import save_df

MOT_2_WEEKS = {"air": 2, "sea": 6}

def _calc_eta(etd, mot):
    if pd.isna(etd):
        return "TBC"
    mot = str(mot).strip().lower()
    weeks = MOT_2_WEEKS.get(mot)
    if weeks is None:
        return "TBC"
    return (etd + timedelta(weeks=weeks)).date()

def run_eta_enrich(bps_path: Path, openpo_path: Path, today_str: str) -> pd.DataFrame:
    bps_df = pd.read_excel(bps_path, engine="openpyxl")
    openpo = pd.read_excel(openpo_path, sheet_name="Combined", engine="openpyxl")

    openpo["ALT Customer PN"] = openpo["ALT Customer PN"].astype(str).str.strip()
    openpo["Confirm ETD"] = pd.to_datetime(openpo["Confirm ETD"], errors="coerce")
    openpo["MOT"] = openpo["MOT"].astype(str).str.strip().str.lower()
    openpo["ETA"] = openpo.apply(lambda r: _calc_eta(r["Confirm ETD"], r["MOT"]), axis=1)

    desc_map = openpo.dropna(subset=["Description"]).drop_duplicates(subset=["ALT Customer PN"]).set_index("ALT Customer PN")["Description"]
    model_map = openpo.dropna(subset=["Model"]).groupby("ALT Customer PN")["Model"].apply(lambda x: ", ".join(sorted(set(x))))

    pn_cols = [c for c in bps_df.columns if c.startswith(("CHILD", "substitute_"))]
    bps_df["Description"] = None
    bps_df["Model"] = ""

    for idx, row in bps_df.iterrows():
        pns = {str(row[c]).strip() for c in pn_cols if pd.notna(row[c])}
        desc = next((desc_map[pn] for pn in pns if pn in desc_map), None)
        models = sorted({model_map[pn] for pn in pns if pn in model_map})
        bps_df.at[idx, "Description"] = desc
        bps_df.at[idx, "Model"] = ", ".join(models)

    eta_pivot = openpo.groupby(["ALT Customer PN", "ETA"])["Total"].sum().unstack(fill_value=0)

    # 修正逻辑：防止重复分配 ETA 数量
    used_qty = {pn: {eta: 0 for eta in eta_pivot.columns} for pn in eta_pivot.index}

    for eta_key in eta_pivot.columns:
        col_name = str(eta_key)
        def sum_eta(row):
            total = 0
            pns = [str(row[c]).strip() for c in pn_cols if pd.notna(row[c])]
            for pn in pns:
                if pn in eta_pivot.index:
                    available = eta_pivot.at[pn, eta_key] - used_qty[pn][eta_key]
                    if available > 0:
                        total += available
                        used_qty[pn][eta_key] += available
            return total
        bps_df[col_name] = bps_df[pn_cols].apply(sum_eta, axis=1)

    original_columns = set(["Description", "Model"] + pn_cols)
    eta_cols = [col for col in bps_df.columns if col not in original_columns]
    eta_sums = bps_df[eta_cols].sum()
    drop_cols = eta_sums[eta_sums == 0].index.tolist()
    bps_df.drop(columns=drop_cols, inplace=True)

    out_name = f"Net_BPSONS_ETA_{today_str}.xlsx"
    save_df(bps_df, out_name)
    print(f"[STEP 5.3] ETA 到料处理完成 -> output/{out_name}")
    return bps_df