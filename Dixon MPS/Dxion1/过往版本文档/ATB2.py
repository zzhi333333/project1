# -*- coding: utf-8 -*-
"""
AT P 回算 — C 方案（轮询 / 单套逐个分配）
- 底层->SBB->MTM 逐日 ATP 回算
- 保持跨行去重（Net -> PN 认领）逻辑（真打孔）
- SBB/MTM 层采用 round-robin 单套分配，避免某一 SBB / MTM 独占料
Author: assistant (adapted to user's framework)
"""
import re
import numpy as np
import pandas as pd
from datetime import datetime

# ========== 配置区（修改路径 & 开关） ==========
INPUT_NET = "D:/Python projects/Dixon MPS/ATPCAL/Net_BPSONS_ETA_20250910.xlsx"
INPUT_BOM = "D:/Python projects/Dixon MPS/ATPCAL/DIXON+BOM+all_bom_leaf.xlsx"
INPUT_MTM = "D:/Python projects/Dixon MPS/ATPCAL/MTM_SBB_mapping.xlsx"

ASSIGN_TBC_TO_FAR_FUTURE = True
FAR_FUTURE_DATE = "2099-12-31"
ENABLE_HARD_MISS = True          # Net 中完全未出现的 PN 视为无供给
ENABLE_SUGGEST_SHEET = False     # 保留建议页（增量>0）
# =================================================

# ---------- 工具 ----------
def normalize_odm_pn(pn):
    """标准化 PN（去前导0、strip）"""
    if pd.isna(pn):
        return ""
    s = str(pn).strip()
    # 如果是纯数字，去前导0
    if s.isdigit():
        return re.sub(r"^0+(?=\d+$)", "", s)
    return s

def find_date_cols(df):
    pat = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    return sorted([c for c in df.columns if isinstance(c, str) and pat.match(c)])

def row_candidates(row, cand_cols):
    """从一行提取 CHILD + substitutes 的候选 PN，保序去重"""
    cands = []
    for c in cand_cols:
        if c in row and pd.notna(row[c]):
            v = normalize_odm_pn(row[c])
            if v:
                cands.append(v)
    seen = set(); out=[]
    for x in cands:
        if x not in seen:
            out.append(x); seen.add(x)
    return out

def add_delta(df, key_col, val_col):
    if df.empty: return df
    out = df.sort_values([key_col, "date"]).reset_index(drop=True).copy()
    out["Delta"] = out.groupby(key_col)[val_col].diff().fillna(out[val_col])
    return out

# ---------- 主流程 ----------
# ---------- 主流程（一次性解决 Series 歧义） ----------
# ---------- 主流程（完整替换） ----------
def main():
    print("[START] ATP 回算（C 方案 - Round Robin）")
    # 1. 读数
    df_net = pd.read_excel(INPUT_NET, engine="openpyxl", sheet_name=0)
    df_bom_leaf = pd.read_excel(INPUT_BOM, engine="openpyxl", sheet_name=0)
    df_mtm = pd.read_excel(INPUT_MTM, engine="openpyxl", sheet_name=0)

    for df in (df_net, df_bom_leaf, df_mtm):
        df.columns = [str(c).strip() for c in df.columns]

    # 日期列
    net_date_cols = find_date_cols(df_net)
    base_date = pd.Timestamp.now(tz="Asia/Shanghai").normalize().tz_localize(None).strftime("%Y-%m-%d")
    all_dates = sorted(set(net_date_cols + [base_date]))

    # 数值化
    num_cols = ["Dixon_inv_Qty"] + net_date_cols + (["TBC"] if "TBC" in df_net.columns else [])
    for col in num_cols:
        if col in df_net.columns:
            df_net[col] = pd.to_numeric(df_net[col], errors="coerce").fillna(0)

    # 标准化候选PN
    sub_cols = [c for c in df_net.columns if str(c).startswith("substitute")]
    cand_cols = ["CHILD"] + sub_cols
    for c in cand_cols:
        if c in df_net.columns:
            df_net[c] = df_net[c].astype(str).apply(normalize_odm_pn)

    # 2. Net行级greedy认领
    used = set()
    pn_supply_rows = []
    for _, row in df_net.sort_values(["CHILD"], kind="mergesort").itertuples(index=False):
        cands = row_candidates(row, cand_cols)
        if not cands:
            continue
        supply = {d: 0.0 for d in all_dates}
        supply[base_date] += getattr(row, "Dixon_inv_Qty", 0)
        for d in net_date_cols:
            supply[d] += float(getattr(row, d, 0))
        if ASSIGN_TBC_TO_FAR_FUTURE and "TBC" in df_net.columns:
            tbc = float(getattr(row, "TBC", 0))
            if tbc:
                supply[FAR_FUTURE_DATE] = supply.get(FAR_FUTURE_DATE, 0) + tbc
                if FAR_FUTURE_DATE not in all_dates:
                    all_dates.append(FAR_FUTURE_DATE)

        assign = next((p for p in cands if p not in used), None)
        if assign is None:
            continue
        used.add(assign)
        rec = {"PN": assign.upper().strip()}
        rec.update(supply)
        pn_supply_rows.append(rec)

    if not pn_supply_rows:
        raise RuntimeError("未生成任何PN供给记录，请检查Net文件。")

    # 3. 生成PN供给表——保证唯一
    pn_supply_df = pd.DataFrame(pn_supply_rows)
    date_cols_all = ([c for c in pn_supply_df.columns if re.match(r"^\d{4}-\d{2}-\d{2}$", str(c))] +
                     ([FAR_FUTURE_DATE] if FAR_FUTURE_DATE in pn_supply_df.columns else []))

    pn_supply_df = (pn_supply_df
                    .groupby("PN", as_index=False)[date_cols_all]
                    .sum())
    assert not pn_supply_df["PN"].duplicated().any(), "PN仍存在重复！"

    # 4. 累计供给->字典，彻底避开.loc布尔歧义
    date_cols_sorted = sorted(date_cols_all, key=lambda x: (x == FAR_FUTURE_DATE, x))
    pn_supply_cum = pn_supply_df.set_index("PN")[date_cols_sorted].cumsum(axis=1)
    cum_dict = pn_supply_cum.to_dict("index")   # {pn: {date: qty}}

    # 5. BOM需求
    b = df_bom_leaf.copy()
    if "bomroot" in b.columns:
        b = b.rename(columns={"bomroot": "SBB"})
    if "SBB" not in b.columns:
        b = b.rename(columns={c: "SBB" for c in b.columns if c.lower() in {"sbb", "parent"}})
    sub_cols_bom = [c for c in b.columns if str(c).startswith("substitute")]

    def make_comp(r):
        cands = [normalize_odm_pn(r.get("CHILD", ""))]
        for sc in sub_cols_bom:
            v = normalize_odm_pn(r.get(sc, ""))
            if v and v not in cands:
                cands.append(v)
        return [c for c in cands if c], float(r.get("MENGE", 0))

    sbb_req = {}
    for _, r in b.iterrows():
        sbb = str(r["SBB"])
        cands, qty = make_comp(r)
        if cands and qty > 0:
            sbb_req.setdefault(sbb, []).append({"cands": cands, "qty": qty})

    # 6. SBB轮询分配
    sbb_atp_rec, sbb_bottleneck_rec = [], []
    for d in date_cols_sorted:
        rem = {pn: float(cum_dict[pn][d]) for pn in cum_dict}
        alloc = {s: 0 for s in sbb_req}
        bottleneck = []
        while True:
            any_alloc = False
            for sbb, comps in sbb_req.items():
                kit = []
                ok = True
                for cp in comps:
                    q = cp["qty"]
                    best = max(
                        [(c, rem.get(c, 0)) for c in cp["cands"] if rem.get(c, 0) >= q],
                        key=lambda x: x[1], default=(None, 0)
                    )[0]
                    if best is None:
                        ok = False
                        break
                    kit.append((best, q))
                if ok:
                    for best, q in kit:
                        rem[best] -= q
                    alloc[sbb] += 1
                    any_alloc = True
                    if alloc[sbb] == 1:
                        bottleneck.append(
                            {"SBB": sbb, "date": d, "PN": min(kit, key=lambda x: rem[x[0]] + x[1])[0],
                             "sbb_kits_at_bottleneck": 1})
            if not any_alloc:
                break
        for s, cnt in alloc.items():
            sbb_atp_rec.append({"SBB": s, "date": d, "ATP": cnt})
        sbb_bottleneck_rec += bottleneck

    sbb_atp_df = add_delta(pd.DataFrame(sbb_atp_rec), "SBB", "ATP")
    sbb_bottleneck_df = pd.DataFrame(sbb_bottleneck_rec)

    # 7. MTM轮询分配
    mm = df_mtm.copy()
    if "MTM" not in mm.columns:
        mm = mm.rename(columns={c: "MTM" for c in mm.columns if c.lower() == "mtm"})
    if "SBB" not in mm.columns:
        mm = mm.rename(columns={c: "SBB" for c in mm.columns if c.lower() == "sbb"})
    if "Qty" not in mm.columns:
        mm["Qty"] = 1.0

    mtm_req = {}
    for _, r in mm.iterrows():
        mtm_req.setdefault(r["MTM"], []).append((r["SBB"], float(r["Qty"])))

    # SBB可用量透视
    sbb_pivot = (sbb_atp_df.pivot(index="SBB", columns="date", values="ATP")
                 .reindex(columns=date_cols_sorted, fill_value=0)
                 .fillna(0)
                 .astype(int))
    sbb_avail = sbb_pivot.to_dict("index")   # {sbb: {date: qty}}

    mtm_rec = []
    for d in date_cols_sorted:
        rem_sbb = {s: sbb_avail[s][d] for s in sbb_avail}
        mtm_cnt = {m: 0 for m in mtm_req}
        while True:
            any_alloc = False
            for mtm, needs in mtm_req.items():
                if all(rem_sbb[s] >= int(q) for s, q in needs):
                    for s, q in needs:
                        rem_sbb[s] -= int(q)
                    mtm_cnt[mtm] += 1
                    any_alloc = True
            if not any_alloc:
                break
        for m, c in mtm_cnt.items():
            mtm_rec.append({"MTM": m, "date": d, "ATP": c})

    mtm_atp_df = add_delta(pd.DataFrame(mtm_rec), "MTM", "ATP")

    # 8. 输出
    out_name = f"MTM_ATP_RR_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    with pd.ExcelWriter(out_name, engine="openpyxl") as writer:
        pn_supply_df.sort_values("PN").to_excel(writer, index=False, sheet_name="PN_Supply_ByDate")
        sbb_atp_df.to_excel(writer, index=False, sheet_name="SBB_ATP_Daily")
        sbb_bottleneck_df.to_excel(writer, index=False, sheet_name="SBB_Bottleneck")
        mtm_atp_df.to_excel(writer, index=False, sheet_name="MTM_ATP_Daily")
    print(f"[DONE] 输出 -> {out_name}")
    return pn_supply_df, sbb_atp_df, sbb_bottleneck_df, mtm_atp_df


if __name__ == "__main__":
    main()