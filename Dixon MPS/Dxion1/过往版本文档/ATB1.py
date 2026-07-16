# -*- coding: utf-8 -*-
"""
ATP 回算（方案 A：逐级齐套约束 / 最小侵入改造）
基准日 = 今天（Asia/Shanghai）；跨行去重；Hard-Miss 规则；
底层 → SBB → MTM 逐日 ATP（贪心认领、真打孔）
Author: adapted from Zhi1 Zeng code
"""

import re
import numpy as np
import pandas as pd
from datetime import datetime

# =========================
# 配置区（可按需调整）
# =========================
INPUT_NET = "D:/Python projects/Dixon MPS/ATPCAL/Net_BPSONS_ETA_20250910.xlsx"       # Net + 分日到料 + Dixon_inv_Qty
INPUT_BOM = "D:/Python projects/Dixon MPS/ATPCAL/DIXON+BOM+all_bom_leaf.xlsx"        # 全叶子BOM（含 bomroot/SBB, CHILD, MENGE）
INPUT_MTM = "D:/Python projects/Dixon MPS/ATPCAL/MTM_SBB_mapping.xlsx"               # MTM ↔ SBB 映射（含 MTM, SBB, Qty）
ASSIGN_TBC_TO_FAR_FUTURE = True                  # TBC 是否指派到远期（2099-12-31）
FAR_FUTURE_DATE = "2099-12-31"
ENABLE_HARD_MISS = True                          # 启用 Hard-Miss 规则：Net 未出现的叶子→供给为0
ENABLE_SUGGEST_SHEET = False                     # 是否额外输出“日级回写建议”页（仅 Delta>0）

# =========================
# 工具函数
# =========================
def normalize_odm_pn(pn: object) -> str:
    s = str(pn).strip()
    return s.lstrip("0") if s.isdigit() else s

def today_str_asia_shanghai() -> str:
    # 以东八区为准的“今天”，并输出 YYYY-MM-DD 字符串
    t = pd.Timestamp.now(tz="Asia/Shanghai").normalize().tz_localize(None)
    return t.strftime("%Y-%m-%d")

def find_net_date_cols(df: pd.DataFrame) -> list:
    pat = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    cols = [c for c in df.columns if pat.match(str(c))]
    return sorted(cols)

def row_candidates(row: pd.Series, cand_cols: list) -> list:
    cands = []
    for c in cand_cols:
        if c in row and pd.notna(row[c]):
            v = str(row[c]).strip()
            if v and v.lower() != "nan":
                cands.append(normalize_odm_pn(v))
    # 去重但保序
    seen, ordered = set(), []
    for x in cands:
        if x not in seen:
            ordered.append(x)
            seen.add(x)
    return ordered

def add_delta(df: pd.DataFrame, key_col: str, val_col: str) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.sort_values([key_col, "date"]).reset_index(drop=True).copy()
    out["Delta"] = out.groupby(key_col)[val_col].diff().fillna(out[val_col])
    return out

# =========================
# 主流程
# =========================
def main():
    # 1) 读取数据 & 预处理
    df_net = pd.read_excel(INPUT_NET, sheet_name=0)
    df_bom = pd.read_excel(INPUT_BOM, sheet_name=0)
    df_mtm = pd.read_excel(INPUT_MTM, sheet_name=0)

    # 统一列名去空格
    df_net.columns = [str(c).strip() for c in df_net.columns]
    df_bom.columns = [str(c).strip() for c in df_bom.columns]
    df_mtm.columns = [str(c).strip() for c in df_mtm.columns]

    # Net 的日期列、数值列
    net_date_cols = find_net_date_cols(df_net)
    numeric_cols = ["Dixon_inv_Qty"] + net_date_cols + (["TBC"] if "TBC" in df_net.columns else [])
    for col in numeric_cols:
        if col in df_net.columns:
            df_net[col] = pd.to_numeric(df_net[col], errors="coerce").fillna(0)

    # 候选列（CHILD + substitutes）
    sub_cols = [c for c in df_net.columns if str(c).startswith("substitute")]
    cand_cols = ["CHILD"] + sub_cols
    for col in cand_cols:
        if col in df_net.columns:
            df_net[col] = df_net[col].astype(str).apply(normalize_odm_pn)

    # 基准日=今天
    base_date_str = today_str_asia_shanghai()

    # 2) 构建“Net”的候选PN集合（用于 Hard-Miss 判断）
    known_candidate_pns = set()
    for _, r in df_net.iterrows():
        known_candidate_pns.update(row_candidates(r, cand_cols))

    # 3) 生成 PN→按日供给（跨行去重 + 真打孔）
    #    规则：每行的库存+到料只归属给该行候选里第一个“未被使用”的 PN
    # 注意：如果有 TBC 且需要分配到 FAR_FUTURE_DATE，应把 FAR_FUTURE_DATE 加入 all_dates BEFORE 构造 supply dict
    all_dates = sorted(set(net_date_cols + [base_date_str]))
    if ASSIGN_TBC_TO_FAR_FUTURE and ("TBC" in df_net.columns):
        if FAR_FUTURE_DATE not in all_dates:
            all_dates = all_dates + [FAR_FUTURE_DATE]  # ensure FAR_FUTURE_DATE at the end

    used_pns = set()
    pn_supply_rows = []

    sort_key = "combo_key" if "combo_key" in df_net.columns else "CHILD"
    df_net_sorted = df_net.sort_values(by=[sort_key, "CHILD"], kind="mergesort").reset_index(drop=True)

    for _, row in df_net_sorted.iterrows():
        cands = row_candidates(row, cand_cols)

        # 构建当前行的“日供给”字典（确保包含 FAR_FUTURE_DATE）
        supply = {d: 0.0 for d in all_dates}
        onhand = float(row["Dixon_inv_Qty"]) if "Dixon_inv_Qty" in row else 0.0
        if onhand > 0:
            supply[base_date_str] += onhand
        for d in net_date_cols:
            val = float(row[d]) if d in row and pd.notna(row[d]) else 0.0
            if val != 0:
                supply[d] = supply.get(d, 0.0) + val

        if ASSIGN_TBC_TO_FAR_FUTURE and ("TBC" in df_net.columns):
            tbc = float(row["TBC"]) if pd.notna(row["TBC"]) else 0.0
            if tbc != 0:
                supply[FAR_FUTURE_DATE] = supply.get(FAR_FUTURE_DATE, 0.0) + tbc

        # 贪心算法认领（真打孔）
        assigned_pn = None
        for pn in cands:
            if pn not in used_pns:
                assigned_pn = pn
                break
        if assigned_pn is None:
            continue  # 全部候选已被认领，跳过

        used_pns.add(assigned_pn)
        rec = {"PN": assigned_pn}
        rec.update(supply)
        pn_supply_rows.append(rec)

    if not pn_supply_rows:
        raise RuntimeError("未生成任何 PN 供给记录，请检查 Net 文件。")

    pn_supply_df = pd.DataFrame(pn_supply_rows)
    # 补齐所有日期列（以 all_dates 为准）
    for d in all_dates:
        if d not in pn_supply_df.columns:
            pn_supply_df[d] = 0.0

    # 同一 PN 多次认领（极少），合并（只保留日期列）
    date_cols_all = [c for c in pn_supply_df.columns if re.match(r"^\d{4}-\d{2}-\d{2}$", str(c)) or c == FAR_FUTURE_DATE]
    pn_supply_df = pn_supply_df.groupby("PN", as_index=False)[date_cols_all].sum()

    # 4) BOM 预处理（SBB + CHILD + MENGE）
    df_bom = df_bom.rename(columns={"bomroot": "SBB"})  # 统一列名
    if "CHILD" not in df_bom.columns or "MENGE" not in df_bom.columns:
        raise RuntimeError("BOM 文件必须包含列：bomroot/SBB, CHILD, MENGE")

    df_bom["CHILD"] = df_bom["CHILD"].astype(str).apply(normalize_odm_pn)
    bom_agg = df_bom.groupby(["SBB", "CHILD"], as_index=False)["MENGE"].sum()

    # 5) 逐日累计供给（用于 floor(累计供给 / 用量)）
    #    注意：把 FAR_FUTURE_DATE 放在最后，以免干扰近端累积
    date_cols_sorted = sorted([d for d in date_cols_all if d != FAR_FUTURE_DATE]) + (
        [FAR_FUTURE_DATE] if FAR_FUTURE_DATE in date_cols_all else []
    )
    pn_supply_cum = pn_supply_df.copy()
    # ensure all date cols exist in pn_supply_cum
    for d in date_cols_sorted:
        if d not in pn_supply_cum.columns:
            pn_supply_cum[d] = 0.0
    pn_supply_cum[date_cols_sorted] = pn_supply_cum[date_cols_sorted].cumsum(axis=1)
    pn_to_cum = pn_supply_cum.set_index("PN")[date_cols_sorted]
    zero_series = pd.Series([0.0] * len(date_cols_sorted), index=date_cols_sorted)

    # 6) 计算 SBB 级逐日 ATP（含 Hard-Miss）
    sbb_atp_records = []
    bottleneck_records = []
    for sbb, grp in bom_agg.groupby("SBB"):
        leaf_kits_list = []
        for _, r in grp.iterrows():
            pn = r["CHILD"]
            menge = float(r["MENGE"]) if pd.notna(r["MENGE"]) else 0.0
            if menge <= 0:
                continue

            # Hard-Miss：若 Net 候选集里也没有这个 CHILD（及其替代），其供给按0
            if ENABLE_HARD_MISS and (pn not in pn_to_cum.index) and (pn not in known_candidate_pns):
                cum = zero_series
            else:
                # 若 Net 有这个 PN 供给记录则取累计；否则零供给
                cum = pn_to_cum.loc[pn] if pn in pn_to_cum.index else zero_series

            kits = np.floor(cum / max(menge, 1e-9))
            leaf_kits_list.append(pd.DataFrame({
                "date": date_cols_sorted, "kits": kits.values, "PN": pn, "MENGE": menge
            }))

        if not leaf_kits_list:
            continue

        leaf_all = pd.concat(leaf_kits_list, ignore_index=True)
        sbb_min = leaf_all.groupby("date")["kits"].min().reset_index()
        sbb_min["SBB"] = sbb
        sbb_atp_records.append(sbb_min[["SBB", "date", "kits"]])

        # 找出造成该日期 SBB 齐套的一个（按 PN 排序，取第一个）瓶颈料号（用于审计）
        merged = leaf_all.merge(sbb_min, on=["date"], suffixes=("", "_sbb"))
        merged = merged[merged["kits"] == merged["kits_sbb"]]
        merged = merged.sort_values(["date", "PN"]).drop_duplicates(["date"])
        merged["SBB"] = sbb
        bottleneck_records.append(
            merged[["SBB", "date", "PN", "MENGE", "kits"]].rename(columns={"kits": "sbb_kits_at_bottleneck"})
        )

    sbb_atp_df = (pd.concat(sbb_atp_records, ignore_index=True)
                  if sbb_atp_records else pd.DataFrame(columns=["SBB", "date", "kits"]))
    sbb_atp_df = add_delta(sbb_atp_df, "SBB", "kits").rename(columns={"kits": "ATP"})
    sbb_bottleneck_df = (pd.concat(bottleneck_records, ignore_index=True)
                         if bottleneck_records else pd.DataFrame(columns=["SBB", "date", "PN", "MENGE", "sbb_kits_at_bottleneck"]))

    # 7) SBB → MTM 映射（MTM 逐日 ATP）
    col_mtm = "MTM" if "MTM" in df_mtm.columns else ("mtm" if "mtm" in df_mtm.columns else None)
    col_sbb = "SBB" if "SBB" in df_mtm.columns else ("sbb" if "sbb" in df_mtm.columns else None)
    col_qty = "Qty" if "Qty" in df_mtm.columns else ("QTY" if "QTY" in df_mtm.columns else ("qty" if "qty" in df_mtm.columns else None))
    if col_mtm is None or col_sbb is None:
        raise RuntimeError("MTM 映射表必须包含列 MTM / SBB")
    if col_qty is None:
        df_mtm["Qty"] = 1.0
        col_qty = "Qty"

    sbb_pivot = sbb_atp_df.pivot(index="SBB", columns="date", values="ATP").fillna(0)

    mtm_records = []
    if not sbb_pivot.empty:
        for mtm, g in df_mtm.groupby(col_mtm):
            rows = []
            for _, rr in g.iterrows():
                sbb = rr[col_sbb]
                need = float(rr[col_qty]) if pd.notna(rr[col_qty]) else 1.0
                if sbb in sbb_pivot.index:
                    # 逐 SBB 按需计算 contribution（整套数）
                    contrib = np.floor(sbb_pivot.loc[sbb].values / need)
                    rows.append(contrib)
                else:
                    rows.append(np.zeros(len(sbb_pivot.columns)))
            if rows:
                arr = np.vstack(rows)
                # MTM 在每个日期的 ATP 由其所需 SBB 的最小可用套数决定
                mtm_vals = np.min(arr, axis=0)
                mtm_records.append(pd.DataFrame({"MTM": mtm, "date": sbb_pivot.columns, "ATP": mtm_vals}))

    mtm_atp_df = pd.concat(mtm_records, ignore_index=True) if mtm_records else pd.DataFrame(columns=["MTM", "date", "ATP"])
    mtm_atp_df = add_delta(mtm_atp_df, "MTM", "ATP")

    # 8) 可选：日级建议（仅保留 Delta>0）
    daily_suggest_df = pd.DataFrame()
    if ENABLE_SUGGEST_SHEET and not mtm_atp_df.empty:
        daily_suggest_df = (mtm_atp_df[mtm_atp_df["Delta"] > 0]
                            .sort_values(["date", "MTM"])
                            .reset_index(drop=True))

    # 9) 输出 Excel
    out_path = f"D:/Python projects/Dixon MPS/ATPCAL/MTM_ATP_suggestion_HARDMISS_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        # 输出 PN 供给（按日）用于审计
        pn_supply_df.sort_values("PN").to_excel(writer, index=False, sheet_name="PN_Supply_ByDate")
        sbb_atp_df.to_excel(writer, index=False, sheet_name="SBB_ATP_Daily")
        sbb_bottleneck_df.to_excel(writer, index=False, sheet_name="SBB_Bottleneck")
        mtm_atp_df.to_excel(writer, index=False, sheet_name="MTM_ATP_Daily")
        if ENABLE_SUGGEST_SHEET and not daily_suggest_df.empty:
            daily_suggest_df.to_excel(writer, index=False, sheet_name="Daily_MTM_Suggest")

    print(f"[OK] 输出完成：{out_path}")


if __name__ == "__main__":
    main()
