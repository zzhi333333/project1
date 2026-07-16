

# -*- coding: utf-8 -*-
"""
PSD Diff Analyzer v2
A端: MFG_BACKLOG_DETAIL xlsx  |  B端: NB_MAIN_RPT_FINAL_PSD csv
按 KEY_PO 聚合级匹配，输出多 sheet Excel 差异报告
"""

import os
import re
import glob
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import tkinter as tk
from tkinter import ttk

pd.set_option("future.no_silent_downcasting", True)

# =========================================================
# 0) 参数
# =========================================================
BASE_DIR = r"D:\Py projects\onereport\downloads"
OUTPUT_FILE = os.path.join(BASE_DIR, "PSD_DIFF_RESULT_FINAL.xlsx")
QTY_TOL = 0.0001

# Site 筛选：交互式，运行时弹出选择
# 设为 None 表示运行时交互选择；设为空列表 [] 表示不过滤（全量跑）
# 也可预配置，例如：SITE_FILTER = {"A": ["ODM_Compal", "ODM_Compal VN"], "B": ["Compal", "Compal VN"]}
SITE_FILTER = None

# A端逻辑字段候选（完全免维护：字段自动识别）
A_FIELD_CANDIDATES = {
    "PO_RAW": ["MFG PO"],
    "PO_ITEM_RAW": ["MFG PO Item"],
    "SO_RAW": ["SO", "MFG SO"],
    "SO_ITEM_RAW": ["SO Item", "MFG SO Item"],
    "QTY_RAW": ["Line Qty"],
    "HOLD_CODE_RAW": ["Hold Code"],
    "CP_HOLD_RAW": ["CP Hold"],
    "MFG_SHIP_DATE": ["MFG Ship Date"],
    "SITE": ["Site"],
}

# B端逻辑字段候选
B_FIELD_CANDIDATES = {
    "PO_RAW": ["PO"],
    "PO_ITEM_RAW": ["PO Item", "PO ITEM", "PO_ITEM", "POITEM"],
    "SO_RAW": ["SO"],
    "SO_ITEM_RAW": ["SO Item", "SO ITEM", "SO_ITEM", "SOITEM"],
    "QTY_RAW": ["Planned QTY", "PLANNED_QTY", "Planned_QTY"],
    "LENOVO_HOLD_RAW": ["Lenovo Hold", "LENOVO HOLD", "Lenovo_Hold", "HOLD", "Hold"],
    "SITE": ["SiteID", "Site"],
}

BLANKS = {"", "nan", "none", "null", "NaN", "None", "NAN", "NONE", "NULL"}


# =========================================================
# 1) 打印日志
# =========================================================
def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


# =========================================================
# 2) 文件发现
# =========================================================
def find_latest_file(base_dir: str, pattern: str) -> Optional[str]:
    files = glob.glob(os.path.join(base_dir, pattern))
    # 排除 Excel 锁文件（~$ 开头）
    files = [f for f in set(files) if not os.path.basename(f).startswith("~$")]
    files = sorted(files)
    return files[-1] if files else None


# =========================================================
# 3) 通用清洗函数
# =========================================================
def clean_text(x) -> str:
    if pd.isna(x):
        return ""
    v = str(x).strip()
    return "" if v in BLANKS else v


def normalize_hold_text(x) -> str:
    v = clean_text(x)
    return "" if v == "" else v.upper()


def strip_leading_zeros_keep_zero(x) -> str:
    """
    构建匹配键时使用：
    - "" -> ""
    - "0001" -> "1"
    - "000" -> "0"
    """
    v = clean_text(x)
    if v == "":
        return ""
    s = v.lstrip("0")
    return s if s != "" else "0"


def normalize_po_for_match(x) -> str:
    """
    B端PO仅用于匹配键：
    7202033344@1 -> 7202033344
    """
    v = clean_text(x)
    if v == "":
        return ""
    return re.sub(r"@\d+$", "", v)


def normalize_hold_raw(x) -> str:
    """
    将例如 991.0 / 995.0 这种值规范成 991 / 995
    """
    v = clean_text(x)
    if v == "":
        return ""
    try:
        f = float(v)
        if f == int(f):
            return str(int(f))
    except Exception:
        pass
    return v


def first_non_blank(a, b) -> str:
    a = clean_text(a)
    b = clean_text(b)
    return a if a != "" else b


def qty_match(a, b, tol=QTY_TOL):
    if pd.isna(a) or pd.isna(b):
        return pd.NA
    return bool(abs(float(a) - float(b)) <= tol)


def hold_std_a(x) -> str:
    v = normalize_hold_text(normalize_hold_raw(x))
    if v in {"E30", "E11"}:
        return "OTHERS"
    return v


def hold_std_b(x) -> str:
    v = normalize_hold_text(normalize_hold_raw(x))
    if v in {"OTHER", "OTHERS"}:
        return "OTHERS"
    return v


# =========================================================
# 4) Excel读取工具（优先 calamine，失败回退 openpyxl）
# =========================================================
def read_excel_fast(file_path: str, sheet_name=0, dtype=str, usecols=None, nrows=None) -> pd.DataFrame:
    """
    优先尝试 calamine（快），失败自动回退 openpyxl
    """
    try:
        return pd.read_excel(
            file_path,
            sheet_name=sheet_name,
            dtype=dtype,
            usecols=usecols,
            nrows=nrows,
            engine="calamine"
        )
    except Exception:
        return pd.read_excel(
            file_path,
            sheet_name=sheet_name,
            dtype=dtype,
            usecols=usecols,
            nrows=nrows,
            engine="openpyxl"
        )


# =========================================================
# 5) 字段解析（完全免维护核心）
# =========================================================
def resolve_columns(columns: List[str], candidates: Dict[str, List[str]], side_name: str) -> Dict[str, str]:
    resolved = {}
    for logical_name, alias_list in candidates.items():
        found = None
        for c in alias_list:
            if c in columns:
                found = c
                break
        if found is None:
            raise KeyError(f"{side_name} 缺少必要列（逻辑字段 {logical_name}），候选列名：{alias_list}")
        resolved[logical_name] = found
    return resolved


def detect_sheet_name(file_path: str) -> str:
    xl = pd.ExcelFile(file_path, engine="calamine")
    candidates = [
        s for s in xl.sheet_names
        if ("backlog" in str(s).lower()) or ("detail" in str(s).lower()) or ("mfg" in str(s).lower())
    ]
    return candidates[0] if candidates else xl.sheet_names[0]


# =========================================================
# 6) 加载必要列
# =========================================================
def load_sources_minimal(base_dir: str):
    file_a = find_latest_file(base_dir, "*MFG_BACKLOG_DETAIL*.xlsx")
    file_b = find_latest_file(base_dir, "*NB_MAIN_RPT_FINAL_PSD*.csv")

    if not file_a:
        raise FileNotFoundError(f"未找到 A 端文件：{os.path.join(base_dir, '*MFG_BACKLOG_DETAIL*.xlsx')}")
    if not file_b:
        raise FileNotFoundError(f"未找到 B 端文件：{os.path.join(base_dir, '*NB_MAIN_RPT_FINAL_PSD*.csv')}")

    sheet_a = detect_sheet_name(file_a)

    # A端表头
    a_header = read_excel_fast(file_a, sheet_name=sheet_a, nrows=0).columns.tolist()
    a_resolved = resolve_columns(a_header, A_FIELD_CANDIDATES, "A端")

    # B端表头
    b_header = pd.read_csv(file_b, nrows=0).columns.tolist()
    b_resolved = resolve_columns(b_header, B_FIELD_CANDIDATES, "B端")

    # 只读必要列
    df_a = read_excel_fast(file_a, sheet_name=sheet_a, dtype=str, usecols=list(a_resolved.values()))
    df_b = pd.read_csv(file_b, dtype=str, low_memory=False, usecols=list(b_resolved.values()))

    return file_a, sheet_a, file_b, df_a, df_b, a_resolved, b_resolved


# =========================================================
# 7) 标准化视图
# =========================================================
def build_standard_views(df_a: pd.DataFrame, df_b: pd.DataFrame,
                         a_resolved: Dict[str, str], b_resolved: Dict[str, str]) -> Tuple[pd.DataFrame, pd.DataFrame]:
    # A端原始逻辑字段
    a = pd.DataFrame({
        "A_PO_RAW": df_a[a_resolved["PO_RAW"]],
        "A_PO_ITEM_RAW": df_a[a_resolved["PO_ITEM_RAW"]],
        "A_SO_RAW": df_a[a_resolved["SO_RAW"]],
        "A_SO_ITEM_RAW": df_a[a_resolved["SO_ITEM_RAW"]],
        "A_QTY_RAW": df_a[a_resolved["QTY_RAW"]],
        "A_HOLD_CODE_RAW": df_a[a_resolved["HOLD_CODE_RAW"]],
        "A_CP_HOLD_RAW": df_a[a_resolved["CP_HOLD_RAW"]],
        "A_MFG_SHIP_DATE_RAW": df_a[a_resolved["MFG_SHIP_DATE"]],
    })

    # A端日期过滤：仅保留 MFG Ship Date >= 当月1号 的行
    a["A_MFG_SHIP_DATE"] = pd.to_datetime(a["A_MFG_SHIP_DATE_RAW"], errors="coerce")
    month_start = pd.Timestamp.now().replace(day=1)
    before_filter = len(a)
    a = a[(a["A_MFG_SHIP_DATE"].isna()) | (a["A_MFG_SHIP_DATE"] >= month_start)].copy()
    after_filter = len(a)
    log(f"  A端 MFG Ship Date 过滤: {before_filter} -> {after_filter} (删除 {before_filter - after_filter} 行, 阈值={month_start.strftime('%Y-%m-%d')})")
    a = a.drop(columns=["A_MFG_SHIP_DATE", "A_MFG_SHIP_DATE_RAW"])

    # B端原始逻辑字段
    b = pd.DataFrame({
        "B_PO_RAW": df_b[b_resolved["PO_RAW"]],
        "B_PO_ITEM_RAW": df_b[b_resolved["PO_ITEM_RAW"]],
        "B_SO_RAW": df_b[b_resolved["SO_RAW"]],
        "B_SO_ITEM_RAW": df_b[b_resolved["SO_ITEM_RAW"]],
        "B_QTY_RAW": df_b[b_resolved["QTY_RAW"]],
        "B_LENOVO_HOLD_RAW": df_b[b_resolved["LENOVO_HOLD_RAW"]],
    })

    # 清洗原始文本
    for col in ["A_PO_RAW", "A_PO_ITEM_RAW", "A_SO_RAW", "A_SO_ITEM_RAW", "A_HOLD_CODE_RAW", "A_CP_HOLD_RAW"]:
        a[col] = a[col].apply(clean_text)

    for col in ["B_PO_RAW", "B_PO_ITEM_RAW", "B_SO_RAW", "B_SO_ITEM_RAW", "B_LENOVO_HOLD_RAW"]:
        b[col] = b[col].apply(clean_text)

    # 数值
    a["A_QTY"] = pd.to_numeric(a["A_QTY_RAW"], errors="coerce")
    b["B_QTY"] = pd.to_numeric(b["B_QTY_RAW"], errors="coerce")

    # Hold原始优先级：Hold Code 优先，空/NaN 时回退 CP Hold
    # 注意：必须在 clean_text 之前用原始 NaN 判断，否则空字符串无法区分"原始为空"和"值为空白"
    a["HOLD_RAW_A"] = [
        normalize_hold_raw(hc) if (not pd.isna(raw_hc) and str(raw_hc).strip() not in BLANKS)
        else normalize_hold_raw(cp)
        for raw_hc, hc, cp in zip(df_a[a_resolved["HOLD_CODE_RAW"]], a["A_HOLD_CODE_RAW"], a["A_CP_HOLD_RAW"])
    ]
    b["HOLD_RAW_B"] = b["B_LENOVO_HOLD_RAW"].apply(normalize_hold_raw)

    # 匹配专用字段（不覆盖原始值）
    a["PO_MATCH"] = a["A_PO_RAW"].apply(clean_text)
    a["PO_ITEM_MATCH"] = a["A_PO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)
    a["SO_MATCH"] = a["A_SO_RAW"].apply(clean_text)
    a["SO_ITEM_MATCH"] = a["A_SO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)

    b["PO_MATCH"] = b["B_PO_RAW"].apply(normalize_po_for_match)
    b["PO_ITEM_MATCH"] = b["B_PO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)
    b["SO_MATCH"] = b["B_SO_RAW"].apply(clean_text)
    b["SO_ITEM_MATCH"] = b["B_SO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)

    # 键
    a["KEY_PO"] = a["PO_MATCH"] + "|" + a["PO_ITEM_MATCH"]
    b["KEY_PO"] = b["PO_MATCH"] + "|" + b["PO_ITEM_MATCH"]

    a["KEY_SO"] = a["SO_MATCH"] + "|" + a["SO_ITEM_MATCH"]
    b["KEY_SO"] = b["SO_MATCH"] + "|" + b["SO_ITEM_MATCH"]

    a["KEY_PO_SO_XREF"] = (
        a["SO_MATCH"] + "|" + a["SO_ITEM_MATCH"] + "|" + a["PO_MATCH"] + "|" + a["PO_ITEM_MATCH"]
    )
    b["KEY_PO_SO_XREF"] = (
        b["SO_MATCH"] + "|" + b["SO_ITEM_MATCH"] + "|" + b["PO_MATCH"] + "|" + b["PO_ITEM_MATCH"]
    )

    # 行号（用于回填）
    a["A_ROW"] = np.arange(len(a))
    b["B_ROW"] = np.arange(len(b))

    return a, b


# =========================================================
# 8) Qty聚合
# =========================================================
def build_qty_aggregates(a: pd.DataFrame, b: pd.DataFrame):
    qty_a = a.groupby("KEY_PO", dropna=False, sort=False)["A_QTY"].sum(min_count=1).reset_index()
    qty_a = qty_a.rename(columns={"A_QTY": "PLANNED_QTY_A"})

    qty_b = b.groupby("KEY_PO", dropna=False, sort=False)["B_QTY"].sum(min_count=1).reset_index()
    qty_b = qty_b.rename(columns={"B_QTY": "PLANNED_QTY_B"})

    map_a = dict(zip(qty_a["KEY_PO"], qty_a["PLANNED_QTY_A"]))
    map_b = dict(zip(qty_b["KEY_PO"], qty_b["PLANNED_QTY_B"]))

    return qty_a, qty_b, map_a, map_b


# =========================================================
# 9) KEY_PO 聚合级匹配（向量化，避免 groupby.apply）
# =========================================================
def _join_sorted_unique(series: pd.Series) -> str:
    vals = sorted(set(series.dropna()) - {""})
    return "/".join(vals) if vals else ""


def match_by_key_po(a: pd.DataFrame, b: pd.DataFrame) -> pd.DataFrame:
    """
    按 KEY_PO 做 full outer merge（聚合级，一对一）。
    向量化聚合，避免逐组 apply。
    """
    # --- A端聚合 ---
    log("  Aggregating A by KEY_PO...")
    # Qty sum
    agA_qty = a.groupby("KEY_PO", sort=False)["A_QTY"].sum(min_count=1).reset_index()
    agA_qty.columns = ["KEY_PO", "PLANNED_QTY_A"]

    # Hold std: 逐行标准化后按 KEY_PO 聚合去重
    a["HOLD_STD_A_ROW"] = a["HOLD_RAW_A"].apply(hold_std_a)
    agA_hold_std = a.groupby("KEY_PO", sort=False)["HOLD_STD_A_ROW"].agg(_join_sorted_unique).reset_index()
    agA_hold_std.columns = ["KEY_PO", "HOLD_STD_A"]

    agA_hold_raw = a.groupby("KEY_PO", sort=False)["HOLD_RAW_A"].agg(_join_sorted_unique).reset_index()
    agA_hold_raw.columns = ["KEY_PO", "HOLD_RAW_A"]

    # KEY_SO / XREF 聚合
    agA_so = a.groupby("KEY_PO", sort=False)["KEY_SO"].agg(_join_sorted_unique).reset_index()
    agA_so.columns = ["KEY_PO", "KEY_SO_A"]

    agA_xref = a.groupby("KEY_PO", sort=False)["KEY_PO_SO_XREF"].agg(_join_sorted_unique).reset_index()
    agA_xref.columns = ["KEY_PO", "KEY_PO_SO_XREF_A"]

    # A端代表行号 + 计数
    agA_row = a.groupby("KEY_PO", sort=False)["A_ROW"].first().reset_index()
    agA_row.columns = ["KEY_PO", "A_ROW"]
    agA_cnt = a.groupby("KEY_PO", sort=False).size().reset_index(name="CNT_A")

    # 合并 A 端聚合结果
    agA = agA_qty
    for df_part in [agA_hold_raw, agA_hold_std, agA_so, agA_xref, agA_row, agA_cnt]:
        agA = agA.merge(df_part, on="KEY_PO", how="left")
    log(f"  A aggregated: {len(agA)} keys")

    # --- B端聚合 ---
    log("  Aggregating B by KEY_PO...")
    agB_qty = b.groupby("KEY_PO", sort=False)["B_QTY"].sum(min_count=1).reset_index()
    agB_qty.columns = ["KEY_PO", "PLANNED_QTY_B"]

    b["HOLD_STD_B_ROW"] = b["HOLD_RAW_B"].apply(hold_std_b)
    agB_hold_std = b.groupby("KEY_PO", sort=False)["HOLD_STD_B_ROW"].agg(_join_sorted_unique).reset_index()
    agB_hold_std.columns = ["KEY_PO", "HOLD_STD_B"]

    agB_hold_raw = b.groupby("KEY_PO", sort=False)["HOLD_RAW_B"].agg(_join_sorted_unique).reset_index()
    agB_hold_raw.columns = ["KEY_PO", "HOLD_RAW_B"]

    agB_so = b.groupby("KEY_PO", sort=False)["KEY_SO"].agg(_join_sorted_unique).reset_index()
    agB_so.columns = ["KEY_PO", "KEY_SO_B"]

    agB_xref = b.groupby("KEY_PO", sort=False)["KEY_PO_SO_XREF"].agg(_join_sorted_unique).reset_index()
    agB_xref.columns = ["KEY_PO", "KEY_PO_SO_XREF_B"]

    agB_row = b.groupby("KEY_PO", sort=False)["B_ROW"].first().reset_index()
    agB_row.columns = ["KEY_PO", "B_ROW"]
    agB_cnt = b.groupby("KEY_PO", sort=False).size().reset_index(name="CNT_B")

    agB = agB_qty
    for df_part in [agB_hold_raw, agB_hold_std, agB_so, agB_xref, agB_row, agB_cnt]:
        agB = agB.merge(df_part, on="KEY_PO", how="left")
    log(f"  B aggregated: {len(agB)} keys")

    # --- Full outer merge ---
    log("  Merging A & B...")
    m = agA.merge(agB, on="KEY_PO", how="outer", indicator=True)

    m["PLANNED_QTY_A"] = pd.to_numeric(m["PLANNED_QTY_A"], errors="coerce")
    m["PLANNED_QTY_B"] = pd.to_numeric(m["PLANNED_QTY_B"], errors="coerce")

    # 填充 NaN
    for col in ["HOLD_RAW_A", "HOLD_STD_A", "KEY_SO_A", "KEY_PO_SO_XREF_A"]:
        m[col] = m[col].fillna("")
    for col in ["HOLD_RAW_B", "HOLD_STD_B", "KEY_SO_B", "KEY_PO_SO_XREF_B"]:
        m[col] = m[col].fillna("")
    m["CNT_A"] = m["CNT_A"].fillna(0).astype(int)
    m["CNT_B"] = m["CNT_B"].fillna(0).astype(int)
    m["A_ROW"] = m["A_ROW"].fillna(-1).astype(int)
    m["B_ROW"] = m["B_ROW"].fillna(-1).astype(int)

    # MATCH_STATUS
    matched = m[m["_merge"] == "both"].copy()
    left_only = m[m["_merge"] == "left_only"].copy()   # only in A
    right_only = m[m["_merge"] == "right_only"].copy()  # only in B

    matched["MATCH_STATUS"] = "MATCHED_BY_PO"
    left_only["MATCH_STATUS"] = "UNMATCHED_IN_A"   # exists in A (Backlog) but not in B (PSD)
    right_only["MATCH_STATUS"] = "UNMATCHED_IN_B"  # exists in B (PSD) but not in A (Backlog)

    result = pd.concat([matched, left_only, right_only], ignore_index=True)
    return result


# =========================================================
# 10) 比较层（直接在聚合结果上比较）
# =========================================================
def build_comparison_result(agg_result: pd.DataFrame) -> pd.DataFrame:
    result = agg_result.copy()

    # 展示用 KEY_SO：优先 A，否则 B
    result["KEY_SO"] = result["KEY_SO_A"].fillna("")
    mask_empty = result["KEY_SO"] == ""
    result.loc[mask_empty, "KEY_SO"] = result.loc[mask_empty, "KEY_SO_B"].fillna("")

    # Qty 对比（已在聚合时计算好 PLANNED_QTY_A / PLANNED_QTY_B）
    result["PLANNED_QTY_DIFF"] = result["PLANNED_QTY_A"] - result["PLANNED_QTY_B"]
    result["PLANNED_QTY_MATCH"] = [
        qty_match(a1, b1) for a1, b1 in zip(result["PLANNED_QTY_A"], result["PLANNED_QTY_B"])
    ]
    result["PLANNED_QTY_DIFF_PCT"] = result["PLANNED_QTY_DIFF"] / result["PLANNED_QTY_A"]
    result["PLANNED_QTY_DIFF_PCT"] = result["PLANNED_QTY_DIFF_PCT"].replace([np.inf, -np.inf], np.nan)

    # Hold 对比（已在聚合时做好 HOLD_STD_A / HOLD_STD_B）
    result["HOLD_MATCH"] = pd.NA
    mask_matched = result["MATCH_STATUS"] == "MATCHED_BY_PO"
    result.loc[mask_matched, "HOLD_MATCH"] = (
        result.loc[mask_matched, "HOLD_STD_A"] == result.loc[mask_matched, "HOLD_STD_B"]
    )

    # PO-SO 关系对比（已在聚合时做好 XREF）
    result["PO_SO_REL_MATCH"] = pd.NA

    # SO 级别 set 对比：区分 Missing / Extra
    so_a_sets = result["KEY_SO_A"].fillna("").apply(lambda x: set(x.split("/")) - {""})
    so_b_sets = result["KEY_SO_B"].fillna("").apply(lambda x: set(x.split("/")) - {""})

    result["SO_MISSING_IN_PSD"] = ""
    result["SO_EXTRA_IN_PSD"] = ""

    po_so_match = pd.NA
    for idx in result.index:
        if result.loc[idx, "MATCH_STATUS"] != "MATCHED_BY_PO":
            continue
        sa = so_a_sets[idx]
        sb = so_b_sets[idx]
        result.loc[idx, "PO_SO_REL_MATCH"] = (sa == sb)
        missing = sorted(sa - sb)
        extra = sorted(sb - sa)
        if missing:
            result.loc[idx, "SO_MISSING_IN_PSD"] = ", ".join(missing)
        if extra:
            result.loc[idx, "SO_EXTRA_IN_PSD"] = ", ".join(extra)

    # 技术原因
    def build_diff_reason(row):
        reasons = []
        if row["MATCH_STATUS"] in ("UNMATCHED_IN_A", "UNMATCHED_IN_B"):
            reasons.append("UNMATCHED")
        if row["PLANNED_QTY_MATCH"] is False:
            reasons.append("PLANNED_QTY")
        if row["HOLD_MATCH"] is False:
            reasons.append("HOLD")
        if row["PO_SO_REL_MATCH"] is False:
            reasons.append("PO_SO_REL")
        return ";".join(reasons)

    # 业务原因
    def build_diff_reason_biz(row):
        reasons = []

        if row["MATCH_STATUS"] == "UNMATCHED_IN_A":
            reasons.append("Missing in PSD")
        elif row["MATCH_STATUS"] == "UNMATCHED_IN_B":
            reasons.append("Extra in PSD")

        if row["PLANNED_QTY_MATCH"] is False:
            a_val = row["PLANNED_QTY_A"]
            b_val = row["PLANNED_QTY_B"]
            if pd.notna(a_val) and pd.notna(b_val):
                if a_val > b_val:
                    reasons.append("Qty mismatch (Backlog > PSD)")
                elif a_val < b_val:
                    reasons.append("Qty mismatch (PSD > Backlog)")
                else:
                    reasons.append("Qty mismatch")
            else:
                reasons.append("Qty mismatch")

        if row["HOLD_MATCH"] is False:
            reasons.append("Hold mismatch")

        if row["PO_SO_REL_MATCH"] is False:
            reasons.append("PO-SO mapping error")

        return "; ".join(reasons)

    result["DIFF_REASON"] = result.apply(build_diff_reason, axis=1)
    result["DIFF_REASON_BIZ"] = result.apply(build_diff_reason_biz, axis=1)
    result["PRIMARY_ISSUE"] = result["DIFF_REASON_BIZ"].str.split("; ").str[0]
    result["IS_DIFF"] = result["DIFF_REASON"] != ""

    return result


# =========================================================
# 11) 回填全量字段（仅差异行，按行号索引取数）
# =========================================================
def backfill_full_fields(diff_df: pd.DataFrame, file_a: str, sheet_a: str, file_b: str):
    """只读取全量源文件，用 iloc 取差异行的字段，避免加载全部 310+ 列到内存"""
    # A端：按行号取差异行
    a_rows = diff_df.loc[diff_df["A_ROW"] >= 0, "A_ROW"].astype(int).tolist()
    if a_rows:
        df_a_full = read_excel_fast(file_a, sheet_name=sheet_a, dtype=str)
        a_subset = df_a_full.iloc[a_rows].reset_index(drop=True)
        a_subset.columns = ["A__" + c for c in a_subset.columns]
        a_subset["A_ROW"] = [a_rows[i] for i in range(len(a_subset))]
    else:
        a_subset = pd.DataFrame()

    # B端：按行号取差异行
    b_rows = diff_df.loc[diff_df["B_ROW"] >= 0, "B_ROW"].astype(int).tolist()
    if b_rows:
        df_b_full = pd.read_csv(file_b, dtype=str, low_memory=False)
        b_subset = df_b_full.iloc[b_rows].reset_index(drop=True)
        b_subset.columns = ["B__" + c for c in b_subset.columns]
        b_subset["B_ROW"] = [b_rows[i] for i in range(len(b_subset))]
    else:
        b_subset = pd.DataFrame()

    # 合并回 diff_df
    result = diff_df.copy()
    if not a_subset.empty:
        result = result.merge(a_subset, on="A_ROW", how="left")
    if not b_subset.empty:
        result = result.merge(b_subset, on="B_ROW", how="left")

    return result, (df_a_full.columns.tolist() if a_rows else []), (df_b_full.columns.tolist() if b_rows else [])


# =========================================================
# 12) Site 勾选对话框 (tkinter)
# =========================================================
def site_selection_dialog(a_sites: List[str], b_sites: List[str]) -> Tuple[List[str], List[str]]:
    """
    弹出 tkinter 勾选窗口，让用户选择 A/B 端要筛选的 Site。
    返回 (selected_a, selected_b)，空列表表示全量不过滤。
    """
    result = {"a": [], "b": []}

    root = tk.Tk()
    root.title("PSD Diff — Site 筛选")
    root.resizable(False, False)

    # 居中
    root.update_idletasks()
    w, h = 480, 420
    x = (root.winfo_screenwidth() - w) // 2
    y = (root.winfo_screenheight() - h) // 2
    root.geometry(f"{w}x{h}+{x}+{y}")

    # --- A端 ---
    frame_a = ttk.LabelFrame(root, text="A端 Site (MFG_BACKLOG_DETAIL)", padding=8)
    frame_a.pack(fill="both", expand=True, padx=10, pady=(10, 2))

    a_vars = {}
    for i, site in enumerate(a_sites):
        var = tk.BooleanVar(value=True)  # 默认全选
        a_vars[site] = var
        cb = ttk.Checkbutton(frame_a, text=site, variable=var)
        cb.grid(row=i, column=0, sticky="w", padx=4, pady=1)

    # A端全选/全不选
    a_ctrl = ttk.Frame(frame_a)
    a_ctrl.grid(row=len(a_sites), column=0, sticky="w", pady=(4, 0))
    ttk.Button(a_ctrl, text="全选", width=6, command=lambda: [v.set(True) for v in a_vars.values()]).pack(side="left", padx=2)
    ttk.Button(a_ctrl, text="全不选", width=6, command=lambda: [v.set(False) for v in a_vars.values()]).pack(side="left", padx=2)

    # --- B端 ---
    frame_b = ttk.LabelFrame(root, text="B端 Site (NB_MAIN_RPT_FINAL_PSD)", padding=8)
    frame_b.pack(fill="both", expand=True, padx=10, pady=2)

    b_vars = {}
    for i, site in enumerate(b_sites):
        var = tk.BooleanVar(value=True)  # 默认全选
        b_vars[site] = var
        cb = ttk.Checkbutton(frame_b, text=site, variable=var)
        cb.grid(row=i, column=0, sticky="w", padx=4, pady=1)

    b_ctrl = ttk.Frame(frame_b)
    b_ctrl.grid(row=len(b_sites), column=0, sticky="w", pady=(4, 0))
    ttk.Button(b_ctrl, text="全选", width=6, command=lambda: [v.set(True) for v in b_vars.values()]).pack(side="left", padx=2)
    ttk.Button(b_ctrl, text="全不选", width=6, command=lambda: [v.set(False) for v in b_vars.values()]).pack(side="left", padx=2)

    # --- 底部按钮 ---
    btn_frame = ttk.Frame(root)
    btn_frame.pack(fill="x", padx=10, pady=(4, 10))

    def on_confirm():
        result["a"] = [s for s, v in a_vars.items() if v.get()]
        result["b"] = [s for s, v in b_vars.items() if v.get()]
        root.destroy()

    def on_skip():
        result["a"] = []
        result["b"] = []
        root.destroy()

    ttk.Button(btn_frame, text="确认选择", command=on_confirm).pack(side="left", padx=4)
    ttk.Button(btn_frame, text="全量跑（不过滤）", command=on_skip).pack(side="left", padx=4)

    root.protocol("WM_DELETE_WINDOW", on_skip)
    root.mainloop()

    return result["a"], result["b"]


# =========================================================
# 13) 主流程
# =========================================================
def main():
    log("Starting PSD diff production script...")

    # 读取必要列
    file_a, sheet_a, file_b, df_a, df_b, a_resolved, b_resolved = load_sources_minimal(BASE_DIR)

    log(f"A file  : {os.path.basename(file_a)}")
    log(f"A sheet : {sheet_a}")
    log(f"B file  : {os.path.basename(file_b)}")
    log(f"A rows(minimal): {len(df_a)}")
    log(f"B rows(minimal): {len(df_b)}")

    log("Resolved A fields:")
    for k, v in a_resolved.items():
        log(f"  {k} <- {v}")

    log("Resolved B fields:")
    for k, v in b_resolved.items():
        log(f"  {k} <- {v}")

    # Site 筛选（交互式：列出两端 Site，用户手动选择）
    a_site_col = a_resolved.get("SITE")
    b_site_col = b_resolved.get("SITE")

    a_sites = sorted(df_a[a_site_col].astype(str).str.strip().unique()) if a_site_col else []
    b_sites = sorted(df_b[b_site_col].astype(str).str.strip().unique()) if b_site_col else []

    if SITE_FILTER is not None:
        # 预配置模式
        filter_a = SITE_FILTER.get("A", []) if isinstance(SITE_FILTER, dict) else []
        filter_b = SITE_FILTER.get("B", []) if isinstance(SITE_FILTER, dict) else []
    else:
        # 交互模式：弹出 tkinter 勾选对话框
        filter_a, filter_b = site_selection_dialog(a_sites, b_sites)

    # 应用 A 端 Site 过滤
    if filter_a and a_site_col:
        before_a = len(df_a)
        df_a = df_a[df_a[a_site_col].astype(str).str.strip().isin(filter_a)]
        log(f"  A端 Site 过滤: {before_a} -> {len(df_a)} (保留 {filter_a})")
    elif a_sites:
        log(f"  A端 Site 未过滤 (共 {len(a_sites)} 个 Site)")

    # 应用 B 端 Site 过滤
    if filter_b and b_site_col:
        before_b = len(df_b)
        df_b = df_b[df_b[b_site_col].astype(str).str.strip().isin(filter_b)]
        log(f"  B端 Site 过滤: {before_b} -> {len(df_b)} (保留 {filter_b})")
    elif b_sites:
        log(f"  B端 Site 未过滤 (共 {len(b_sites)} 个 Site)")

    # 标准化视图
    log("Building normalized views...")
    a, b = build_standard_views(df_a, df_b, a_resolved, b_resolved)

    invalid_po_a = ((a["PO_MATCH"] == "") | (a["PO_ITEM_MATCH"] == "")).sum()
    invalid_so_a = ((a["SO_MATCH"] == "") | (a["SO_ITEM_MATCH"] == "")).sum()
    invalid_po_b = ((b["PO_MATCH"] == "") | (b["PO_ITEM_MATCH"] == "")).sum()
    invalid_so_b = ((b["SO_MATCH"] == "") | (b["SO_ITEM_MATCH"] == "")).sum()

    log(f"A invalid KEY_PO count: {invalid_po_a}")
    log(f"A invalid KEY_SO count: {invalid_so_a}")
    log(f"B invalid KEY_PO count: {invalid_po_b}")
    log(f"B invalid KEY_SO count: {invalid_so_b}")

    # Qty聚合（仅日志用，实际聚合在 match_by_key_po 中完成）
    log("Counting unique KEY_PO...")
    qty_a_cnt = a["KEY_PO"].nunique()
    qty_b_cnt = b["KEY_PO"].nunique()
    log(f"A unique KEY_PO count: {qty_a_cnt}")
    log(f"B unique KEY_PO count: {qty_b_cnt}")

    # KEY_PO 聚合级匹配
    log("Matching by KEY_PO (aggregated)...")
    agg_result = match_by_key_po(a, b)

    log(f"MATCHED_BY_PO  : {(agg_result['MATCH_STATUS'] == 'MATCHED_BY_PO').sum()}")
    log(f"UNMATCHED_IN_A : {(agg_result['MATCH_STATUS'] == 'UNMATCHED_IN_A').sum()}")
    log(f"UNMATCHED_IN_B : {(agg_result['MATCH_STATUS'] == 'UNMATCHED_IN_B').sum()}")

    # 对比
    log("Comparing Qty / Hold / PO-SO relationships...")
    result = build_comparison_result(agg_result)
    diff = result[result["IS_DIFF"]].copy()

    log(f"DIFF_LINES = {len(diff)}")

    # 回填全量字段（仅差异行）
    log("Backfilling full source fields for diff rows...")
    diff, a_col_names, b_col_names = backfill_full_fields(diff, file_a, sheet_a, file_b)

    # 组织输出列
    fixed_cols = [
        "MATCH_STATUS", "KEY_PO", "KEY_SO", "DIFF_REASON", "DIFF_REASON_BIZ", "PRIMARY_ISSUE"
    ]

    compare_cols = [
        "PLANNED_QTY_A", "PLANNED_QTY_B", "PLANNED_QTY_DIFF", "PLANNED_QTY_DIFF_PCT", "PLANNED_QTY_MATCH",
        "HOLD_RAW_A", "HOLD_STD_A", "HOLD_RAW_B", "HOLD_STD_B", "HOLD_MATCH",
        "KEY_PO_SO_XREF_A", "KEY_PO_SO_XREF_B", "PO_SO_REL_MATCH",
        "SO_MISSING_IN_PSD", "SO_EXTRA_IN_PSD",
        "CNT_A", "CNT_B"
    ]

    a_all_cols = ["A__" + c for c in a_col_names]
    b_all_cols = ["B__" + c for c in b_col_names]

    final_cols = fixed_cols + compare_cols + a_all_cols + b_all_cols
    final_out = diff.reindex(columns=final_cols).copy()

    if "PLANNED_QTY_DIFF" in final_out.columns:
        final_out["PLANNED_QTY_DIFF"] = final_out["PLANNED_QTY_DIFF"].round(4)
    if "PLANNED_QTY_DIFF_PCT" in final_out.columns:
        final_out["PLANNED_QTY_DIFF_PCT"] = final_out["PLANNED_QTY_DIFF_PCT"].round(4)

    # 分页sheet（不输出ALL_DIFF）
    diff_po = final_out.copy()

    diff_so = final_out[
        final_out["KEY_SO"].fillna("") != ""
    ].copy()

    diff_po_so = final_out[
        final_out["PO_SO_REL_MATCH"] == False
    ].copy()

    diff_qty = final_out[
        final_out["PLANNED_QTY_MATCH"] == False
    ].copy()

    diff_hold = final_out[
        final_out["HOLD_MATCH"] == False
    ].copy()

    summary = pd.DataFrame([
        ["Source A", os.path.basename(file_a)],
        ["Source B", os.path.basename(file_b)],
        ["A rows", len(df_a)],
        ["B rows", len(df_b)],
        ["A aggregated KEY_PO", qty_a_cnt],
        ["B aggregated KEY_PO", qty_b_cnt],
        ["", ""],
        ["Total Compared Keys", len(result)],
        ["Diff Rows", len(diff)],
        ["Match Rate", f"{(1 - len(diff)/len(result)):.2%}" if len(result) > 0 else "N/A"],
        ["", ""],
        ["MATCHED_BY_PO", int((result["MATCH_STATUS"] == "MATCHED_BY_PO").sum())],
        ["UNMATCHED_IN_A (Missing in PSD)", int((result["MATCH_STATUS"] == "UNMATCHED_IN_A").sum())],
        ["UNMATCHED_IN_B (Extra in PSD)", int((result["MATCH_STATUS"] == "UNMATCHED_IN_B").sum())],
        ["", ""],
        ["Qty mismatch", int((final_out["PLANNED_QTY_MATCH"] == False).sum())],
        ["Hold mismatch", int((final_out["HOLD_MATCH"] == False).sum())],
        ["PO-SO mapping error", int((final_out["PO_SO_REL_MATCH"] == False).sum())],
    ], columns=["Metric", "Value"])

    # 写出Excel
    log("Writing Excel...")
    with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl") as writer:
        diff_po.to_excel(writer, sheet_name="DIFF_PO", index=False)
        diff_so.to_excel(writer, sheet_name="DIFF_SO", index=False)
        diff_po_so.to_excel(writer, sheet_name="DIFF_PO_SO", index=False)
        diff_qty.to_excel(writer, sheet_name="DIFF_QTY", index=False)
        diff_hold.to_excel(writer, sheet_name="DIFF_HOLD", index=False)
        summary.to_excel(writer, sheet_name="SUMMARY", index=False)

    log(f"输出完成：{OUTPUT_FILE}")
    log(f"DIFF_PO rows={len(diff_po)}, cols={len(diff_po.columns)}")
    log(f"DIFF_SO rows={len(diff_so)}, cols={len(diff_so.columns)}")
    log(f"DIFF_PO_SO rows={len(diff_po_so)}, cols={len(diff_po_so.columns)}")
    log(f"DIFF_QTY rows={len(diff_qty)}, cols={len(diff_qty.columns)}")
    log(f"DIFF_HOLD rows={len(diff_hold)}, cols={len(diff_hold.columns)}")

    # QA
    log("Running QA checks...")
    assert len(final_out.columns) == len(set(final_out.columns)), "存在重复输出列名"
    assert (final_out["DIFF_REASON"].fillna("") != "").all(), "存在空 DIFF_REASON 的差异行"

    a_e30 = result[result["HOLD_RAW_A"].str.upper().str.strip() == "E30"]
    a_e11 = result[result["HOLD_RAW_A"].str.upper().str.strip() == "E11"]
    if len(a_e30) > 0:
        assert (a_e30["HOLD_STD_A"] == "OTHERS").all(), "A端 E30 未正确映射为 OTHERS"
    if len(a_e11) > 0:
        assert (a_e11["HOLD_STD_A"] == "OTHERS").all(), "A端 E11 未正确映射为 OTHERS"

    b_other = result[result["HOLD_RAW_B"].str.upper().str.strip().isin(["OTHER", "OTHERS"])]
    if len(b_other) > 0:
        assert (b_other["HOLD_STD_B"] == "OTHERS").all(), "B端 OTHER/OTHERS 未正确映射为 OTHERS"

    log("All QA checks passed.")


if __name__ == "__main__":
    main()