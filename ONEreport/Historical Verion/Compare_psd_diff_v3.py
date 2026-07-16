# -*- coding: utf-8 -*-
"""
PSD Diff Analyzer V3 (Industrial Version)
-----------------------------------------
A端: MFG_BACKLOG_DETAIL*.xlsx
B端: NB_MAIN_RPT_FINAL_PSD*.csv

核心能力：
1) 自动发现文件
2) A/B 字段自动识别（免维护）
3) 仅加载必要列，提升大文件性能
4) 按 KEY_PO 聚合级做主比对
5) 输出多 sheet：
   - SUMMARY
   - DIFF_PO
   - DIFF_SO
   - DIFF_PO_SO
   - DIFF_QTY
   - DIFF_HOLD
   - TOP_PO_ISSUES
6) 支持可选的差异行原始字段回填
7) tkinter Site 勾选对话框
8) A端 MFG Ship Date 预过滤
"""

import os
import re
import glob
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import tkinter as tk
from tkinter import ttk

pd.set_option("future.no_silent_downcasting", True)

# =========================
# 0) 全局参数
# =========================
BASE_DIR = r"D:\Py projects\onereport\downloads"
OUTPUT_FILE = os.path.join(BASE_DIR, "PSD_DIFF_RESULT_V3.xlsx")
QTY_TOL = 0.0001

# 是否对差异行回填全量原始字段（大文件场景建议默认 False）
ENABLE_BACKFILL_FULL_FIELDS = False

# 是否在 SUMMARY 中输出额外统计
ENABLE_EXTRA_SUMMARY = True

# Site 筛选：None=交互式对话框，dict=预配置，空dict=不过滤
SITE_FILTER = None

BLANKS = {"", "nan", "none", "null", "NaN", "None", "NAN", "NONE", "NULL"}

# =========================
# 1) 字段候选（自动识别）
# =========================
A_FIELD_CANDIDATES = {
    "PO_RAW": ["MFG PO"],
    "PO_ITEM_RAW": ["MFG PO Item"],
    "SO_RAW": ["SO", "MFG SO"],
    "SO_ITEM_RAW": ["SO Item", "MFG SO Item"],
    "QTY_RAW": ["Line Qty"],
    "HOLD_CODE_RAW": ["Hold Code"],
    "CP_HOLD_RAW": ["CP Hold"],
    "SITE": ["Site"],
    "MFG_SHIP_DATE": ["MFG Ship Date"],
}

B_FIELD_CANDIDATES = {
    "PO_RAW": ["PO"],
    "PO_ITEM_RAW": ["PO Item", "PO ITEM", "PO_ITEM", "POITEM"],
    "SO_RAW": ["SO"],
    "SO_ITEM_RAW": ["SO Item", "SO ITEM", "SO_ITEM", "SOITEM"],
    "QTY_RAW": ["Planned QTY", "PLANNED_QTY", "Planned_QTY"],
    "LENOVO_HOLD_RAW": ["Lenovo Hold", "LENOVO HOLD", "Lenovo_Hold", "HOLD", "Hold"],
    "SITE": ["SiteID", "Site"],
}

# =========================
# 2) 日志
# =========================
def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

# =========================
# 3) 文件发现
# =========================
def find_latest_file(base_dir: str, pattern: str) -> Optional[str]:
    files = glob.glob(os.path.join(base_dir, pattern))
    files = [f for f in set(files) if not os.path.basename(f).startswith("~$") and not os.path.basename(f).startswith("$")]
    files = sorted(files, key=lambda x: os.path.getmtime(x))
    return files[-1] if files else None

# =========================
# 4) 通用清洗
# =========================
def clean_text(x) -> str:
    if pd.isna(x):
        return ""
    v = str(x).strip()
    return "" if v in BLANKS else v

def normalize_hold_text(x) -> str:
    v = clean_text(x)
    return "" if v == "" else v.upper()

def strip_leading_zeros_keep_zero(x) -> str:
    v = clean_text(x)
    if v == "":
        return ""
    s = v.lstrip("0")
    return s if s != "" else "0"

def normalize_po_for_match(x) -> str:
    v = clean_text(x)
    if v == "":
        return ""
    return re.sub(r"@\d+$", "", v)

def normalize_hold_raw(x) -> str:
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

def _join_sorted_unique(series: pd.Series) -> str:
    vals = sorted(set(series.dropna()) - {""})
    return "/".join(vals) if vals else ""

# =========================
# 5) Excel 读取（优先 calamine）
# =========================
def read_excel_fast(file_path: str, sheet_name=0, dtype=str, usecols=None, nrows=None) -> pd.DataFrame:
    last_err = None
    for engine in ["calamine", "openpyxl"]:
        try:
            return pd.read_excel(
                file_path,
                sheet_name=sheet_name,
                dtype=dtype,
                usecols=usecols,
                nrows=nrows,
                engine=engine
            )
        except Exception as e:
            last_err = e
    raise last_err

# =========================
# 6) 字段解析
# =========================
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

# =========================
# 7) 加载源文件（仅必要列）
# =========================
def load_sources_minimal(base_dir: str):
    file_a = find_latest_file(base_dir, "*MFG_BACKLOG_DETAIL*.xlsx")
    file_b = find_latest_file(base_dir, "*NB_MAIN_RPT_FINAL_PSD*.csv")

    if not file_a:
        raise FileNotFoundError(f"未找到 A 端文件：{os.path.join(base_dir, '*MFG_BACKLOG_DETAIL*.xlsx')}")
    if not file_b:
        raise FileNotFoundError(f"未找到 B 端文件：{os.path.join(base_dir, '*NB_MAIN_RPT_FINAL_PSD*.csv')}")

    log(f"A file found: {os.path.basename(file_a)}")
    log(f"B file found: {os.path.basename(file_b)}")

    sheet_a = detect_sheet_name(file_a)
    log(f"A sheet detected: {sheet_a}")

    # 先读表头
    a_header = read_excel_fast(file_a, sheet_name=sheet_a, dtype=str, nrows=0)
    b_header = pd.read_csv(file_b, nrows=0)

    a_resolved = resolve_columns(list(a_header.columns), A_FIELD_CANDIDATES, "A端")
    b_resolved = resolve_columns(list(b_header.columns), B_FIELD_CANDIDATES, "B端")

    a_usecols = list(dict.fromkeys(a_resolved.values()))
    b_usecols = list(dict.fromkeys(b_resolved.values()))

    log(f"A usecols: {a_usecols}")
    log(f"B usecols: {b_usecols}")

    df_a = read_excel_fast(file_a, sheet_name=sheet_a, dtype=str, usecols=a_usecols)
    df_b = pd.read_csv(file_b, dtype=str, low_memory=False, usecols=b_usecols)

    return file_a, sheet_a, file_b, df_a, df_b, a_resolved, b_resolved

# =========================
# 8) 标准化视图（含 MFG Ship Date 过滤）
# =========================
def build_standard_views(
    df_a: pd.DataFrame,
    df_b: pd.DataFrame,
    a_resolved: Dict[str, str],
    b_resolved: Dict[str, str]
) -> Tuple[pd.DataFrame, pd.DataFrame]:

    # A端
    a = pd.DataFrame({
        "A_PO_RAW": df_a[a_resolved["PO_RAW"]],
        "A_PO_ITEM_RAW": df_a[a_resolved["PO_ITEM_RAW"]],
        "A_SO_RAW": df_a[a_resolved["SO_RAW"]],
        "A_SO_ITEM_RAW": df_a[a_resolved["SO_ITEM_RAW"]],
        "A_QTY_RAW": df_a[a_resolved["QTY_RAW"]],
        "A_HOLD_CODE_RAW": df_a[a_resolved["HOLD_CODE_RAW"]],
        "A_CP_HOLD_RAW": df_a[a_resolved["CP_HOLD_RAW"]],
        "A_SITE_RAW": df_a[a_resolved["SITE"]],
        "A_MFG_SHIP_DATE_RAW": df_a[a_resolved["MFG_SHIP_DATE"]],
    })

    # A端 MFG Ship Date 过滤：仅保留 >= 当月1号 或无法解析的行
    a["A_MFG_SHIP_DATE"] = pd.to_datetime(a["A_MFG_SHIP_DATE_RAW"], errors="coerce")
    month_start = pd.Timestamp.now().replace(day=1)
    before = len(a)
    a = a[(a["A_MFG_SHIP_DATE"].isna()) | (a["A_MFG_SHIP_DATE"] >= month_start)].copy()
    after = len(a)
    log(f"  A端 MFG Ship Date 过滤: {before} -> {after} (删除 {before - after} 行, 阈值={month_start.strftime('%Y-%m-%d')})")
    a = a.drop(columns=["A_MFG_SHIP_DATE", "A_MFG_SHIP_DATE_RAW"])

    # B端
    b = pd.DataFrame({
        "B_PO_RAW": df_b[b_resolved["PO_RAW"]],
        "B_PO_ITEM_RAW": df_b[b_resolved["PO_ITEM_RAW"]],
        "B_SO_RAW": df_b[b_resolved["SO_RAW"]],
        "B_SO_ITEM_RAW": df_b[b_resolved["SO_ITEM_RAW"]],
        "B_QTY_RAW": df_b[b_resolved["QTY_RAW"]],
        "B_HOLD_RAW": df_b[b_resolved["LENOVO_HOLD_RAW"]],
        "B_SITE_RAW": df_b[b_resolved["SITE"]],
    })

    # 清洗
    for c in ["A_PO_RAW", "A_PO_ITEM_RAW", "A_SO_RAW", "A_SO_ITEM_RAW", "A_HOLD_CODE_RAW", "A_CP_HOLD_RAW", "A_SITE_RAW"]:
        a[c] = a[c].apply(clean_text)

    for c in ["B_PO_RAW", "B_PO_ITEM_RAW", "B_SO_RAW", "B_SO_ITEM_RAW", "B_HOLD_RAW", "B_SITE_RAW"]:
        b[c] = b[c].apply(clean_text)

    # Qty
    a["A_QTY"] = pd.to_numeric(a["A_QTY_RAW"], errors="coerce")
    b["B_QTY"] = pd.to_numeric(b["B_QTY_RAW"], errors="coerce")

    # Hold 优先级：Hold Code 优先，空/NaN 时回退 CP Hold
    # 必须在 clean_text 之前用原始 NaN 判断
    a["HOLD_RAW_A"] = [
        normalize_hold_raw(hc) if (not pd.isna(raw_hc) and str(raw_hc).strip() not in BLANKS)
        else normalize_hold_raw(cp)
        for raw_hc, hc, cp in zip(df_a[a_resolved["HOLD_CODE_RAW"]], a["A_HOLD_CODE_RAW"], a["A_CP_HOLD_RAW"])
    ]
    b["HOLD_RAW_B"] = b["B_HOLD_RAW"].apply(normalize_hold_raw)

    # 匹配键专用字段
    a["PO_MATCH"] = a["A_PO_RAW"].apply(clean_text)
    a["PO_ITEM_MATCH"] = a["A_PO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)
    a["SO_MATCH"] = a["A_SO_RAW"].apply(clean_text)
    a["SO_ITEM_MATCH"] = a["A_SO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)

    b["PO_MATCH"] = b["B_PO_RAW"].apply(normalize_po_for_match)
    b["PO_ITEM_MATCH"] = b["B_PO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)
    b["SO_MATCH"] = b["B_SO_RAW"].apply(clean_text)
    b["SO_ITEM_MATCH"] = b["B_SO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)

    # 关键 key
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

    # 原始行号（如需回填）
    a["A_ROW"] = np.arange(len(a))
    b["B_ROW"] = np.arange(len(b))

    return a, b

# =========================
# 9) Site 勾选对话框
# =========================
def site_selection_dialog(a_sites: List[str], b_sites: List[str]) -> Tuple[List[str], List[str]]:
    result = {"a": [], "b": []}

    root = tk.Tk()
    root.title("PSD Diff V3 — Site 筛选")
    root.resizable(False, False)

    root.update_idletasks()
    w, h = 480, 420
    x = (root.winfo_screenwidth() - w) // 2
    y = (root.winfo_screenheight() - h) // 2
    root.geometry(f"{w}x{h}+{x}+{y}")

    # A端
    frame_a = ttk.LabelFrame(root, text="A端 Site (MFG_BACKLOG_DETAIL)", padding=8)
    frame_a.pack(fill="both", expand=True, padx=10, pady=(10, 2))

    a_vars = {}
    for i, site in enumerate(a_sites):
        var = tk.BooleanVar(value=True)
        a_vars[site] = var
        ttk.Checkbutton(frame_a, text=site, variable=var).grid(row=i, column=0, sticky="w", padx=4, pady=1)

    a_ctrl = ttk.Frame(frame_a)
    a_ctrl.grid(row=len(a_sites), column=0, sticky="w", pady=(4, 0))
    ttk.Button(a_ctrl, text="全选", width=6, command=lambda: [v.set(True) for v in a_vars.values()]).pack(side="left", padx=2)
    ttk.Button(a_ctrl, text="全不选", width=6, command=lambda: [v.set(False) for v in a_vars.values()]).pack(side="left", padx=2)

    # B端
    frame_b = ttk.LabelFrame(root, text="B端 Site (NB_MAIN_RPT_FINAL_PSD)", padding=8)
    frame_b.pack(fill="both", expand=True, padx=10, pady=2)

    b_vars = {}
    for i, site in enumerate(b_sites):
        var = tk.BooleanVar(value=True)
        b_vars[site] = var
        ttk.Checkbutton(frame_b, text=site, variable=var).grid(row=i, column=0, sticky="w", padx=4, pady=1)

    b_ctrl = ttk.Frame(frame_b)
    b_ctrl.grid(row=len(b_sites), column=0, sticky="w", pady=(4, 0))
    ttk.Button(b_ctrl, text="全选", width=6, command=lambda: [v.set(True) for v in b_vars.values()]).pack(side="left", padx=2)
    ttk.Button(b_ctrl, text="全不选", width=6, command=lambda: [v.set(False) for v in b_vars.values()]).pack(side="left", padx=2)

    # 底部按钮
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

# =========================
# 10) 核心聚合匹配（KEY_PO级）
# =========================
def match_by_key_po(a: pd.DataFrame, b: pd.DataFrame) -> pd.DataFrame:
    log("Aggregating by KEY_PO ...")

    # --- A端聚合 ---
    log("  Aggregating A by KEY_PO...")
    agA_qty = a.groupby("KEY_PO", sort=False)["A_QTY"].sum(min_count=1).reset_index()
    agA_qty.columns = ["KEY_PO", "PLANNED_QTY_A"]

    # Hold: 逐行标准化后按 KEY_PO 聚合去重
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

    # Site + 计数 + 代表行号
    agA_site = a.groupby("KEY_PO", sort=False)["A_SITE_RAW"].first().reset_index()
    agA_site.columns = ["KEY_PO", "SITE_A"]
    agA_cnt = a.groupby("KEY_PO", sort=False).size().reset_index(name="CNT_A")
    agA_row = a.groupby("KEY_PO", sort=False)["A_ROW"].first().reset_index()
    agA_row.columns = ["KEY_PO", "A_ROW"]

    agA = agA_qty
    for df_part in [agA_hold_raw, agA_hold_std, agA_so, agA_xref, agA_site, agA_row, agA_cnt]:
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

    agB_site = b.groupby("KEY_PO", sort=False)["B_SITE_RAW"].first().reset_index()
    agB_site.columns = ["KEY_PO", "SITE_B"]
    agB_cnt = b.groupby("KEY_PO", sort=False).size().reset_index(name="CNT_B")
    agB_row = b.groupby("KEY_PO", sort=False)["B_ROW"].first().reset_index()
    agB_row.columns = ["KEY_PO", "B_ROW"]

    agB = agB_qty
    for df_part in [agB_hold_raw, agB_hold_std, agB_so, agB_xref, agB_site, agB_row, agB_cnt]:
        agB = agB.merge(df_part, on="KEY_PO", how="left")
    log(f"  B aggregated: {len(agB)} keys")

    # --- Full outer merge ---
    log("  Merging A & B ...")
    m = agA.merge(agB, on="KEY_PO", how="outer", indicator=True)

    m["PLANNED_QTY_A"] = pd.to_numeric(m["PLANNED_QTY_A"], errors="coerce")
    m["PLANNED_QTY_B"] = pd.to_numeric(m["PLANNED_QTY_B"], errors="coerce")

    # 填充 NaN
    for col in ["HOLD_RAW_A", "HOLD_STD_A", "KEY_SO_A", "KEY_PO_SO_XREF_A", "SITE_A"]:
        m[col] = m[col].fillna("")
    for col in ["HOLD_RAW_B", "HOLD_STD_B", "KEY_SO_B", "KEY_PO_SO_XREF_B", "SITE_B"]:
        m[col] = m[col].fillna("")
    m["CNT_A"] = m["CNT_A"].fillna(0).astype(int)
    m["CNT_B"] = m["CNT_B"].fillna(0).astype(int)
    m["A_ROW"] = m["A_ROW"].fillna(-1).astype(int)
    m["B_ROW"] = m["B_ROW"].fillna(-1).astype(int)

    # MATCH_STATUS（V2语义：left_only=存在于A但B缺失=UNMATCHED_IN_A，right_only=存在于B但A缺失=UNMATCHED_IN_B）
    matched = m[m["_merge"] == "both"].copy()
    left_only = m[m["_merge"] == "left_only"].copy()
    right_only = m[m["_merge"] == "right_only"].copy()

    matched["MATCH_STATUS"] = "MATCHED_BY_PO"
    left_only["MATCH_STATUS"] = "UNMATCHED_IN_A"   # A有B无 → Missing in PSD
    right_only["MATCH_STATUS"] = "UNMATCHED_IN_B"   # B有A无 → Extra in PSD

    df = pd.concat([matched, left_only, right_only], ignore_index=True)
    df = df.drop(columns=["_merge"])

    return df

# =========================
# 11) 比较层
# =========================
def build_comparison_result(agg_result: pd.DataFrame) -> pd.DataFrame:
    result = agg_result.copy()

    # 展示用 KEY_SO：优先 A，否则 B
    result["KEY_SO"] = result["KEY_SO_A"].fillna("")
    mask_empty = result["KEY_SO"] == ""
    result.loc[mask_empty, "KEY_SO"] = result.loc[mask_empty, "KEY_SO_B"].fillna("")

    # Qty 对比
    result["PLANNED_QTY_DIFF"] = result["PLANNED_QTY_A"] - result["PLANNED_QTY_B"]
    result["PLANNED_QTY_MATCH"] = [
        qty_match(a1, b1) for a1, b1 in zip(result["PLANNED_QTY_A"], result["PLANNED_QTY_B"])
    ]
    result["PLANNED_QTY_DIFF_PCT"] = result["PLANNED_QTY_DIFF"] / result["PLANNED_QTY_A"]
    result["PLANNED_QTY_DIFF_PCT"] = result["PLANNED_QTY_DIFF_PCT"].replace([np.inf, -np.inf], np.nan)

    # Hold 对比（仅 MATCHED 行）
    result["HOLD_MATCH"] = pd.NA
    mask_matched = result["MATCH_STATUS"] == "MATCHED_BY_PO"
    result.loc[mask_matched, "HOLD_MATCH"] = (
        result.loc[mask_matched, "HOLD_STD_A"] == result.loc[mask_matched, "HOLD_STD_B"]
    )

    # PO-SO 关系对比（仅 MATCHED 行，set 级对比区分 Missing/Extra）
    result["PO_SO_REL_MATCH"] = pd.NA
    result["SO_MISSING_IN_PSD"] = ""
    result["SO_EXTRA_IN_PSD"] = ""

    for idx in result.index:
        if result.loc[idx, "MATCH_STATUS"] != "MATCHED_BY_PO":
            continue
        sa = set(result.loc[idx, "KEY_PO_SO_XREF_A"].split("/")) - {""}
        sb = set(result.loc[idx, "KEY_PO_SO_XREF_B"].split("/")) - {""}
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

# =========================
# 12) 分类 sheet
# =========================
def build_diff_sheets(df: pd.DataFrame):
    diff = df[df["IS_DIFF"]].copy()

    diff_po = diff.copy()

    diff_so = diff[
        diff["KEY_SO"].fillna("") != ""
    ].copy()

    diff_po_so = diff[
        diff["PO_SO_REL_MATCH"] == False
    ].copy()

    diff_qty = diff[
        diff["PLANNED_QTY_MATCH"] == False
    ].copy()

    diff_hold = diff[
        diff["HOLD_MATCH"] == False
    ].copy()

    return diff_po, diff_so, diff_po_so, diff_qty, diff_hold

# =========================
# 13) Summary / Top issues
# =========================
def build_summary(df: pd.DataFrame, file_a: str, file_b: str, diff_po, diff_so, diff_po_so, diff_qty, diff_hold):
    total = len(df)
    diff_cnt = len(df[df["IS_DIFF"]])

    rows = [
        ["Source A", os.path.basename(file_a)],
        ["Source B", os.path.basename(file_b)],
        ["", ""],
        ["Total KEY_PO", total],
        ["Diff KEY_PO", diff_cnt],
        ["Match Rate", f"{(1 - diff_cnt / total):.2%}" if total > 0 else "N/A"],
        ["", ""],
        ["MATCHED_BY_PO", int((df["MATCH_STATUS"] == "MATCHED_BY_PO").sum())],
        ["UNMATCHED_IN_A (Missing in PSD)", int((df["MATCH_STATUS"] == "UNMATCHED_IN_A").sum())],
        ["UNMATCHED_IN_B (Extra in PSD)", int((df["MATCH_STATUS"] == "UNMATCHED_IN_B").sum())],
        ["", ""],
        ["DIFF_PO rows", len(diff_po)],
        ["DIFF_SO rows", len(diff_so)],
        ["DIFF_PO_SO rows", len(diff_po_so)],
        ["DIFF_QTY rows", len(diff_qty)],
        ["DIFF_HOLD rows", len(diff_hold)],
        ["", ""],
        ["Qty mismatch", int((df["PLANNED_QTY_MATCH"] == False).sum())],
        ["Hold mismatch", int((df["HOLD_MATCH"] == False).sum())],
        ["PO-SO mapping error", int((df["PO_SO_REL_MATCH"] == False).sum())],
    ]

    if ENABLE_EXTRA_SUMMARY:
        rows.extend([
            ["A qty total", df["PLANNED_QTY_A"].sum(skipna=True)],
            ["B qty total", df["PLANNED_QTY_B"].sum(skipna=True)],
            ["A/B qty total diff", df["PLANNED_QTY_DIFF"].sum(skipna=True)],
        ])

    summary = pd.DataFrame(rows, columns=["Metric", "Value"])

    top_po = df[df["IS_DIFF"]].copy()
    top_po["ABS_QTY_DIFF"] = top_po["PLANNED_QTY_DIFF"].abs()
    top_po = top_po.sort_values(
        by=["ABS_QTY_DIFF", "PRIMARY_ISSUE"],
        ascending=[False, True]
    )[[
        "KEY_PO", "KEY_SO", "SITE_A", "SITE_B", "PRIMARY_ISSUE",
        "PLANNED_QTY_A", "PLANNED_QTY_B", "PLANNED_QTY_DIFF",
        "HOLD_STD_A", "HOLD_STD_B",
        "SO_MISSING_IN_PSD", "SO_EXTRA_IN_PSD",
    ]].head(100)

    return summary, top_po

# =========================
# 14) 差异行全量回填
# =========================
def backfill_full_fields(diff_df: pd.DataFrame, file_a: str, sheet_a: str, file_b: str):
    """用 iloc 取差异行的全量源字段"""
    a_rows = diff_df.loc[diff_df["A_ROW"] >= 0, "A_ROW"].astype(int).tolist()
    if a_rows:
        df_a_full = read_excel_fast(file_a, sheet_name=sheet_a, dtype=str)
        a_subset = df_a_full.iloc[a_rows].reset_index(drop=True)
        a_subset.columns = ["A__" + c for c in a_subset.columns]
        a_subset["A_ROW"] = [a_rows[i] for i in range(len(a_subset))]
    else:
        df_a_full = pd.DataFrame()
        a_subset = pd.DataFrame()

    b_rows = diff_df.loc[diff_df["B_ROW"] >= 0, "B_ROW"].astype(int).tolist()
    if b_rows:
        df_b_full = pd.read_csv(file_b, dtype=str, low_memory=False)
        b_subset = df_b_full.iloc[b_rows].reset_index(drop=True)
        b_subset.columns = ["B__" + c for c in b_subset.columns]
        b_subset["B_ROW"] = [b_rows[i] for i in range(len(b_subset))]
    else:
        b_subset = pd.DataFrame()

    result = diff_df.copy()
    if not a_subset.empty:
        result = result.merge(a_subset, on="A_ROW", how="left")
    if not b_subset.empty:
        result = result.merge(b_subset, on="B_ROW", how="left")

    a_col_names = df_a_full.columns.tolist() if not a_subset.empty else []
    b_col_names = df_b_full.columns.tolist() if not b_subset.empty else []

    return result, a_col_names, b_col_names

# =========================
# 15) 输出
# =========================
def write_output(
    file_path: str,
    summary: pd.DataFrame,
    diff_po: pd.DataFrame,
    diff_so: pd.DataFrame,
    diff_po_so: pd.DataFrame,
    diff_qty: pd.DataFrame,
    diff_hold: pd.DataFrame,
    top_po: pd.DataFrame
):
    with pd.ExcelWriter(file_path, engine="openpyxl") as writer:
        summary.to_excel(writer, sheet_name="SUMMARY", index=False)
        diff_po.to_excel(writer, sheet_name="DIFF_PO", index=False)
        diff_so.to_excel(writer, sheet_name="DIFF_SO", index=False)
        diff_po_so.to_excel(writer, sheet_name="DIFF_PO_SO", index=False)
        diff_qty.to_excel(writer, sheet_name="DIFF_QTY", index=False)
        diff_hold.to_excel(writer, sheet_name="DIFF_HOLD", index=False)
        top_po.to_excel(writer, sheet_name="TOP_PO_ISSUES", index=False)

# =========================
# 16) 主流程
# =========================
def main():
    start = time.time()
    log("Starting PSD Diff Analyzer V3 ...")

    # 1. load
    file_a, sheet_a, file_b, df_a, df_b, a_resolved, b_resolved = load_sources_minimal(BASE_DIR)
    log(f"A rows loaded: {len(df_a):,}")
    log(f"B rows loaded: {len(df_b):,}")

    log("Resolved A fields:")
    for k, v in a_resolved.items():
        log(f"  {k} <- {v}")
    log("Resolved B fields:")
    for k, v in b_resolved.items():
        log(f"  {k} <- {v}")

    # 2. Site 筛选
    a_site_col = a_resolved.get("SITE")
    b_site_col = b_resolved.get("SITE")

    a_sites = sorted(df_a[a_site_col].astype(str).str.strip().unique()) if a_site_col else []
    b_sites = sorted(df_b[b_site_col].astype(str).str.strip().unique()) if b_site_col else []

    if SITE_FILTER is not None:
        filter_a = SITE_FILTER.get("A", []) if isinstance(SITE_FILTER, dict) else []
        filter_b = SITE_FILTER.get("B", []) if isinstance(SITE_FILTER, dict) else []
    else:
        filter_a, filter_b = site_selection_dialog(a_sites, b_sites)

    if filter_a and a_site_col:
        before_a = len(df_a)
        df_a = df_a[df_a[a_site_col].astype(str).str.strip().isin(filter_a)]
        log(f"  A端 Site 过滤: {before_a} -> {len(df_a)} (保留 {filter_a})")
    elif a_sites:
        log(f"  A端 Site 未过滤 (共 {len(a_sites)} 个 Site)")

    if filter_b and b_site_col:
        before_b = len(df_b)
        df_b = df_b[df_b[b_site_col].astype(str).str.strip().isin(filter_b)]
        log(f"  B端 Site 过滤: {before_b} -> {len(df_b)} (保留 {filter_b})")
    elif b_sites:
        log(f"  B端 Site 未过滤 (共 {len(b_sites)} 个 Site)")

    # 3. standardize（含 MFG Ship Date 过滤）
    log("Building normalized views...")
    a, b = build_standard_views(df_a, df_b, a_resolved, b_resolved)
    log(f"A standardized rows: {len(a):,}")
    log(f"B standardized rows: {len(b):,}")

    invalid_po_a = ((a["PO_MATCH"] == "") | (a["PO_ITEM_MATCH"] == "")).sum()
    invalid_so_a = ((a["SO_MATCH"] == "") | (a["SO_ITEM_MATCH"] == "")).sum()
    invalid_po_b = ((b["PO_MATCH"] == "") | (b["PO_ITEM_MATCH"] == "")).sum()
    invalid_so_b = ((b["SO_MATCH"] == "") | (b["SO_ITEM_MATCH"] == "")).sum()

    log(f"A invalid KEY_PO count: {invalid_po_a}")
    log(f"A invalid KEY_SO count: {invalid_so_a}")
    log(f"B invalid KEY_PO count: {invalid_po_b}")
    log(f"B invalid KEY_SO count: {invalid_so_b}")

    # 4. aggregate + compare
    log("Matching by KEY_PO (aggregated) ...")
    agg_result = match_by_key_po(a, b)
    log(f"MATCHED_BY_PO  : {(agg_result['MATCH_STATUS'] == 'MATCHED_BY_PO').sum()}")
    log(f"UNMATCHED_IN_A : {(agg_result['MATCH_STATUS'] == 'UNMATCHED_IN_A').sum()}")
    log(f"UNMATCHED_IN_B : {(agg_result['MATCH_STATUS'] == 'UNMATCHED_IN_B').sum()}")

    log("Comparing Qty / Hold / PO-SO relationships ...")
    result = build_comparison_result(agg_result)
    diff = result[result["IS_DIFF"]].copy()
    log(f"DIFF_LINES = {len(diff)}")

    # 5. split sheets
    diff_po, diff_so, diff_po_so, diff_qty, diff_hold = build_diff_sheets(result)
    log(f"DIFF_PO rows: {len(diff_po):,}")
    log(f"DIFF_SO rows: {len(diff_so):,}")
    log(f"DIFF_PO_SO rows: {len(diff_po_so):,}")
    log(f"DIFF_QTY rows: {len(diff_qty):,}")
    log(f"DIFF_HOLD rows: {len(diff_hold):,}")

    # 6. optional backfill
    a_col_names = []
    b_col_names = []
    if ENABLE_BACKFILL_FULL_FIELDS:
        log("Backfilling full source fields for diff rows ...")
        diff_po, a_col_names, b_col_names = backfill_full_fields(diff_po, file_a, sheet_a, file_b)
        diff_so, _, _ = backfill_full_fields(diff_so, file_a, sheet_a, file_b)
        diff_po_so, _, _ = backfill_full_fields(diff_po_so, file_a, sheet_a, file_b)
        diff_qty, _, _ = backfill_full_fields(diff_qty, file_a, sheet_a, file_b)
        diff_hold, _, _ = backfill_full_fields(diff_hold, file_a, sheet_a, file_b)

    # 7. summary
    summary, top_po = build_summary(result, file_a, file_b, diff_po, diff_so, diff_po_so, diff_qty, diff_hold)

    # 8. output
    log("Writing Excel ...")
    write_output(OUTPUT_FILE, summary, diff_po, diff_so, diff_po_so, diff_qty, diff_hold, top_po)

    log(f"输出完成：{OUTPUT_FILE}")
    log(f"DIFF_PO    rows={len(diff_po)}, cols={len(diff_po.columns)}")
    log(f"DIFF_SO    rows={len(diff_so)}, cols={len(diff_so.columns)}")
    log(f"DIFF_PO_SO rows={len(diff_po_so)}, cols={len(diff_po_so.columns)}")
    log(f"DIFF_QTY   rows={len(diff_qty)}, cols={len(diff_qty.columns)}")
    log(f"DIFF_HOLD  rows={len(diff_hold)}, cols={len(diff_hold.columns)}")

    # 9. QA
    log("Running QA checks ...")
    assert len(diff.columns) == len(set(diff.columns)), "存在重复输出列名"
    assert (diff["DIFF_REASON"].fillna("") != "").all(), "存在空 DIFF_REASON 的差异行"

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

    elapsed = time.time() - start
    log(f"Elapsed seconds: {elapsed:.2f}")

if __name__ == "__main__":
    main()
