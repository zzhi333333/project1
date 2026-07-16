# -*- coding: utf-8 -*-
"""
PSD Diff Analyzer V3.1 + Excel ehancement
---------------------------------------
A端: MFG_BACKLOG_DETAIL*.xlsx
B端: NB_MAIN_RPT_FINAL_PSD*.csv

输出：
- SUMMARY
- MISSING_IN_PSD (A有B无)
- EXTRA_IN_PSD (B有A无)
- DIFF_QTY (仅QTY不匹配)
- DIFF_HOLD (仅Hold不匹配)
- DIFF_PO_SO (仅PO-SO关系不匹配)
- DIFF_MULTI (两个及以上维度不匹配)
- TOP_PO_ISSUES

增强：
- Excel （冻结首行 / 自动筛选 / 表头着色 / 列宽自适应 / 百分比格式 / 关键列高亮）
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

from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter

pd.set_option("future.no_silent_downcasting", True)

# =========================================================
# 0) 全局参数
# =========================================================
BASE_DIR = r"D:\Py projects\onereport\downloads"
OUTPUT_FILE = os.path.join(BASE_DIR, "PSD_DIFF_RESULT_V3_1.xlsx")
QTY_TOL = 0.0001

ENABLE_BACKFILL_FULL_FIELDS = False
ENABLE_EXTRA_SUMMARY = True

# Site 筛选：
# None = 运行时弹窗选择
# {}   = 不过滤
# {"A": ["ODM_Compal"], "B": ["Compal"]} = 预配置过滤
SITE_FILTER = None

ENABLE_MFG_SHIPDATE_FILTER = True

BLANKS = {"", "nan", "none", "null", "NaN", "None", "NAN", "NONE", "NULL"}

# =========================================================
# 1) 字段候选（自动识别）
# =========================================================
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
    "PRODUCT_GROUP": ["Product Group", "MFG Production Group"],
    "BRAND": ["Brand"],
    "GEO": ["Geo"],
}

B_FIELD_CANDIDATES = {
    "PO_RAW": ["PO"],
    "PO_ITEM_RAW": ["PO Item", "PO ITEM", "PO_ITEM", "POITEM"],
    "SO_RAW": ["SO"],
    "SO_ITEM_RAW": ["SO Item", "SO ITEM", "SO_ITEM", "SOITEM"],
    "QTY_RAW": ["Planned QTY", "PLANNED_QTY", "Planned_QTY"],
    "LENOVO_HOLD_RAW": ["Lenovo Hold", "LENOVO HOLD", "Lenovo_Hold", "HOLD", "Hold"],
    "SITE": ["SiteID", "Site"],
    "BRAND": ["Brand"],
    "GEO": ["Geo"],
}

# =========================================================
# 2) 日志
# =========================================================
def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

# =========================================================
# 3) 文件发现
# =========================================================
def find_latest_file(base_dir: str, pattern: str) -> Optional[str]:
    files = glob.glob(os.path.join(base_dir, pattern))
    files = [
        f for f in set(files)
        if not os.path.basename(f).startswith("~$")
        and not os.path.basename(f).startswith("$")
    ]
    files = sorted(files, key=lambda x: os.path.getmtime(x))
    return files[-1] if files else None

# =========================================================
# 4) 通用清洗 / 规范化
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
        return False
    try:
        return abs(float(a) - float(b)) <= tol
    except Exception:
        return False

OTHERS_MAP = {"E30", "E11", "OTHER", "OTHERS"}

def normalize_hold(x) -> str:
    v = normalize_hold_text(normalize_hold_raw(x))
    return "OTHERS" if v in OTHERS_MAP else v

def _join_sorted_unique(values) -> str:
    vals = sorted({clean_text(v) for v in values if clean_text(v) != ""})
    return "/".join(vals) if vals else ""

def _safe_set(series: pd.Series) -> set:
    return {v for v in series if isinstance(v, str) and v != ""}

def _safe_join_list(x: list) -> str:
    if not x:
        return ""
    return ", ".join(x)

def is_false(v) -> bool:
    return pd.notna(v) and (v == False)

# =========================================================
# 5) Excel 读取（优先 calamine）
# =========================================================
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

# =========================================================
# 6) 字段解析
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
    for engine in ["calamine", "openpyxl"]:
        try:
            xl = pd.ExcelFile(file_path, engine=engine)
            candidates = [
                s for s in xl.sheet_names
                if ("backlog" in str(s).lower()) or ("detail" in str(s).lower()) or ("mfg" in str(s).lower())
            ]
            return candidates[0] if candidates else xl.sheet_names[0]
        except ImportError:
            continue
    raise ImportError("No available Excel engine (tried calamine, openpyxl)")

# =========================================================
# 7) 多维度筛选对话框（Site / Product Group / Brand / Geo）
# =========================================================
# 筛选维度配置：(逻辑名, 显示标签, 适用于哪端)
FILTER_DIMENSIONS = [
    ("SITE",           "Site",          "AB"),
    ("PRODUCT_GROUP",  "Product Group", "A"),
    ("BRAND",          "Brand",         "AB"),
    ("GEO",            "Geo",           "AB"),
]


def _extract_unique_values(df: pd.DataFrame, resolved: Dict[str, str], dim_name: str) -> List[str]:
    col = resolved.get(dim_name)
    if not col or col not in df.columns:
        return []
    return sorted([clean_text(x) for x in df[col].dropna().unique().tolist() if clean_text(x) != ""])


def _build_checkblock(parent, title, values, all_vars):
    """在 parent 中创建一个 LabelFrame + checkbox 列表。"""
    frame = ttk.LabelFrame(parent, text=title, padding=4)
    frame.pack(fill="x", padx=4, pady=(2, 6))

    # 全选 / 全不选
    ctrl = ttk.Frame(frame)
    ctrl.pack(fill="x", pady=(0, 2))
    dim_key = title  # 用 title 作为 vars 字典的 key

    ttk.Button(ctrl, text="全选", width=5,
               command=lambda: [v.set(True) for v in all_vars[dim_key].values()]).pack(side="left", padx=2)
    ttk.Button(ctrl, text="清空", width=5,
               command=lambda: [v.set(False) for v in all_vars[dim_key].values()]).pack(side="left", padx=2)

    # Checkbox（如果值多于 8 个，用 Canvas + Scrollbar）
    if len(values) > 8:
        canvas = tk.Canvas(frame, height=min(150, len(values) * 22))
        sb = ttk.Scrollbar(frame, orient="vertical", command=canvas.yview)
        inner = ttk.Frame(canvas)
        inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=sb.set)
        canvas.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
    else:
        inner = frame

    all_vars[dim_key] = {}
    for val in values:
        v = tk.BooleanVar(value=True)
        all_vars[dim_key][val] = v
        ttk.Checkbutton(inner, text=val, variable=v).pack(anchor="w")


def filter_selection_dialog(
    a_values: Dict[str, List[str]],
    b_values: Dict[str, List[str]]
) -> Dict[str, Dict[str, List[str]]]:
    """
    弹出多维度筛选对话框。
    返回 {"A": {dim: [selected]}, "B": {dim: [selected]}}，空列表 = 不过滤。
    """
    result = {"A": {}, "B": {}}
    all_vars_a = {}
    all_vars_b = {}

    root = tk.Tk()
    root.title("PSD Diff V3.1 — 数据筛选")
    root.geometry("960x720")

    # 主体 Notebook：A端 / B端 两个 tab
    notebook = ttk.Notebook(root)
    notebook.pack(fill="both", expand=True, padx=8, pady=(8, 4))

    # A端 tab
    tab_a = ttk.Frame(notebook)
    notebook.add(tab_a, text="  A端 (MFG_BACKLOG_DETAIL)  ")

    canvas_a = tk.Canvas(tab_a)
    sb_a = ttk.Scrollbar(tab_a, orient="vertical", command=canvas_a.yview)
    scroll_a = ttk.Frame(canvas_a)
    scroll_a.bind("<Configure>", lambda e: canvas_a.configure(scrollregion=canvas_a.bbox("all")))
    canvas_a.create_window((0, 0), window=scroll_a, anchor="nw")
    canvas_a.configure(yscrollcommand=sb_a.set)
    canvas_a.pack(side="left", fill="both", expand=True)
    sb_a.pack(side="right", fill="y")

    for dim_name, label, sides in FILTER_DIMENSIONS:
        if "A" in sides and a_values.get(dim_name):
            _build_checkblock(scroll_a, f"A: {label}", a_values[dim_name], all_vars_a)

    # B端 tab
    tab_b = ttk.Frame(notebook)
    notebook.add(tab_b, text="  B端 (NB_MAIN_RPT_FINAL_PSD)  ")

    canvas_b = tk.Canvas(tab_b)
    sb_b = ttk.Scrollbar(tab_b, orient="vertical", command=canvas_b.yview)
    scroll_b = ttk.Frame(canvas_b)
    scroll_b.bind("<Configure>", lambda e: canvas_b.configure(scrollregion=canvas_b.bbox("all")))
    canvas_b.create_window((0, 0), window=scroll_b, anchor="nw")
    canvas_b.configure(yscrollcommand=sb_b.set)
    canvas_b.pack(side="left", fill="both", expand=True)
    sb_b.pack(side="right", fill="y")

    for dim_name, label, sides in FILTER_DIMENSIONS:
        if "B" in sides and b_values.get(dim_name):
            _build_checkblock(scroll_b, f"B: {label}", b_values[dim_name], all_vars_b)

    # 底部按钮
    btn_frame = ttk.Frame(root)
    btn_frame.pack(fill="x", padx=8, pady=(4, 8))

    def on_ok():
        for dim_key, var_dict in all_vars_a.items():
            selected = [k for k, v in var_dict.items() if v.get()]
            # 还原 dim_key "A: Label" → dim_name
            dim_name = dim_key.replace("A: ", "")
            result["A"][dim_name] = selected
        for dim_key, var_dict in all_vars_b.items():
            selected = [k for k, v in var_dict.items() if v.get()]
            dim_name = dim_key.replace("B: ", "")
            result["B"][dim_name] = selected
        root.destroy()

    def on_skip():
        root.destroy()

    ttk.Button(btn_frame, text="确认选择", command=on_ok).pack(side="left", padx=6)
    ttk.Button(btn_frame, text="全量跑（不过滤）", command=on_skip).pack(side="left", padx=6)

    root.protocol("WM_DELETE_WINDOW", on_skip)
    root.mainloop()
    return result

# =========================================================
# 8) 加载源文件（仅必要列）
# =========================================================
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

# =========================================================
# 9) 标准化视图（含 Site / MFG Ship Date 过滤）
# =========================================================
def build_standard_views(
    df_a: pd.DataFrame,
    df_b: pd.DataFrame,
    a_resolved: Dict[str, str],
    b_resolved: Dict[str, str],
    dim_filter: Optional[Dict[str, Dict[str, List[str]]]] = None
) -> Tuple[pd.DataFrame, pd.DataFrame, int]:

    a_data = {
        "A_PO_RAW": df_a[a_resolved["PO_RAW"]],
        "A_PO_ITEM_RAW": df_a[a_resolved["PO_ITEM_RAW"]],
        "A_SO_RAW": df_a[a_resolved["SO_RAW"]],
        "A_SO_ITEM_RAW": df_a[a_resolved["SO_ITEM_RAW"]],
        "A_QTY_RAW": df_a[a_resolved["QTY_RAW"]],
        "A_HOLD_CODE_RAW": df_a[a_resolved["HOLD_CODE_RAW"]],
        "A_CP_HOLD_RAW": df_a[a_resolved["CP_HOLD_RAW"]],
        "A_SITE_RAW": df_a[a_resolved["SITE"]],
        "A_MFG_SHIP_DATE_RAW": df_a[a_resolved["MFG_SHIP_DATE"]],
        "A_ORIG_ROW": np.arange(len(df_a)),
    }
    # 可选维度列（仅当字段存在时才加入）
    if "PRODUCT_GROUP" in a_resolved:
        a_data["A_PRODUCT_GROUP_RAW"] = df_a[a_resolved["PRODUCT_GROUP"]]
    if "BRAND" in a_resolved:
        a_data["A_BRAND_RAW"] = df_a[a_resolved["BRAND"]]
    if "GEO" in a_resolved:
        a_data["A_GEO_RAW"] = df_a[a_resolved["GEO"]]
    a = pd.DataFrame(a_data)

    # 保存原始 Hold Code（clean_text 前的 NaN 信息，用于 fallback 判断）
    a["A_HOLD_CODE_ORIG"] = a["A_HOLD_CODE_RAW"].values

    b_data = {
        "B_PO_RAW": df_b[b_resolved["PO_RAW"]],
        "B_PO_ITEM_RAW": df_b[b_resolved["PO_ITEM_RAW"]],
        "B_SO_RAW": df_b[b_resolved["SO_RAW"]],
        "B_SO_ITEM_RAW": df_b[b_resolved["SO_ITEM_RAW"]],
        "B_QTY_RAW": df_b[b_resolved["QTY_RAW"]],
        "B_HOLD_RAW": df_b[b_resolved["LENOVO_HOLD_RAW"]],
        "B_SITE_RAW": df_b[b_resolved["SITE"]],
        "B_ORIG_ROW": np.arange(len(df_b)),
    }
    if "BRAND" in b_resolved:
        b_data["B_BRAND_RAW"] = df_b[b_resolved["BRAND"]]
    if "GEO" in b_resolved:
        b_data["B_GEO_RAW"] = df_b[b_resolved["GEO"]]
    b = pd.DataFrame(b_data)

    # 清洗所有 RAW 列
    for c in a.columns:
        if c.endswith("_RAW"):
            a[c] = a[c].apply(clean_text)
    for c in b.columns:
        if c.endswith("_RAW"):
            b[c] = b[c].apply(clean_text)

    # 多维度过滤（Site / Product Group / Brand / Geo）
    _DIM_COL_MAP_A = {
        "Site": "A_SITE_RAW",
        "Product Group": "A_PRODUCT_GROUP_RAW",
        "Brand": "A_BRAND_RAW",
        "Geo": "A_GEO_RAW",
    }
    _DIM_COL_MAP_B = {
        "Site": "B_SITE_RAW",
        "Brand": "B_BRAND_RAW",
        "Geo": "B_GEO_RAW",
    }

    if dim_filter:
        for dim_label, col_name in _DIM_COL_MAP_A.items():
            selected = dim_filter.get("A", {}).get(dim_label, [])
            if selected and col_name in a.columns:
                before = len(a)
                a = a[a[col_name].isin(selected)].copy()
                log(f"  A端 {dim_label} 过滤: {before} -> {len(a)} (保留 {selected})")
        for dim_label, col_name in _DIM_COL_MAP_B.items():
            selected = dim_filter.get("B", {}).get(dim_label, [])
            if selected and col_name in b.columns:
                before = len(b)
                b = b[b[col_name].isin(selected)].copy()
                log(f"  B端 {dim_label} 过滤: {before} -> {len(b)} (保留 {selected})")

    # MFG Ship Date 过滤
    filtered_out_count = 0
    if ENABLE_MFG_SHIPDATE_FILTER:
        month_start = pd.Timestamp(datetime.now().year, datetime.now().month, 1)
        ship_dt = pd.to_datetime(a["A_MFG_SHIP_DATE_RAW"], errors="coerce")
        mask_keep = ship_dt.isna() | (ship_dt >= month_start)
        filtered_out_count = int((~mask_keep).sum())
        a = a[mask_keep].copy()

    a["A_QTY"] = pd.to_numeric(a["A_QTY_RAW"], errors="coerce")
    b["B_QTY"] = pd.to_numeric(b["B_QTY_RAW"], errors="coerce")

    # Hold 优先级：Hold Code 优先，空/NaN 时回退 CP Hold
    # 用 A_HOLD_CODE_ORIG（过滤前已存入 a，过滤后仍对齐）判断原始 NaN
    a["HOLD_RAW_A"] = [
        normalize_hold_raw(hc) if (not pd.isna(orig) and str(orig).strip() not in BLANKS)
        else normalize_hold_raw(cp)
        for orig, hc, cp in zip(a["A_HOLD_CODE_ORIG"], a["A_HOLD_CODE_RAW"], a["A_CP_HOLD_RAW"])
    ]
    a.drop(columns=["A_HOLD_CODE_ORIG"], inplace=True)
    b["HOLD_RAW_B"] = b["B_HOLD_RAW"].apply(normalize_hold_raw)

    a["PO_MATCH"] = a["A_PO_RAW"].apply(clean_text)
    a["PO_ITEM_MATCH"] = a["A_PO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)
    a["SO_MATCH"] = a["A_SO_RAW"].apply(clean_text)
    a["SO_ITEM_MATCH"] = a["A_SO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)

    b["PO_MATCH"] = b["B_PO_RAW"].apply(normalize_po_for_match)
    b["PO_ITEM_MATCH"] = b["B_PO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)
    b["SO_MATCH"] = b["B_SO_RAW"].apply(clean_text)
    b["SO_ITEM_MATCH"] = b["B_SO_ITEM_RAW"].apply(strip_leading_zeros_keep_zero)

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

    a["A_ROW"] = a["A_ORIG_ROW"]
    b["B_ROW"] = b["B_ORIG_ROW"]

    return a, b, filtered_out_count

# =========================================================
# 10) 聚合匹配
# =========================================================
def match_by_key_po(a: pd.DataFrame, b: pd.DataFrame) -> pd.DataFrame:
    log("Aggregating by KEY_PO ...")

    # A端：逐行 Hold 标准化（聚合前）
    a["HOLD_STD_A_ROW"] = a["HOLD_RAW_A"].apply(normalize_hold)

    ag_a = a.groupby("KEY_PO", sort=False).agg(
        PLANNED_QTY_A=("A_QTY", lambda s: s.sum(min_count=1)),
        HOLD_A_RAW=("HOLD_RAW_A", _join_sorted_unique),
        HOLD_A_STD=("HOLD_STD_A_ROW", _join_sorted_unique),
        SITE_A=("A_SITE_RAW", _join_sorted_unique),
        KEY_SO_A=("KEY_SO", _join_sorted_unique),
        KEY_PO_SO_XREF_A=("KEY_PO_SO_XREF", _join_sorted_unique),
        A_ROW_FIRST=("A_ROW", "first"),
        A_ROW_COUNT=("A_ROW", "count"),
    ).reset_index()

    so_set_a = a.groupby("KEY_PO", sort=False)["KEY_SO"].agg(_safe_set).reset_index().rename(columns={"KEY_SO": "SO_SET_A"})
    ag_a = ag_a.merge(so_set_a, on="KEY_PO", how="left")

    # B端：逐行 Hold 标准化
    b["HOLD_STD_B_ROW"] = b["HOLD_RAW_B"].apply(normalize_hold)

    ag_b = b.groupby("KEY_PO", sort=False).agg(
        PLANNED_QTY_B=("B_QTY", lambda s: s.sum(min_count=1)),
        HOLD_B_RAW=("HOLD_RAW_B", _join_sorted_unique),
        HOLD_B_STD=("HOLD_STD_B_ROW", _join_sorted_unique),
        SITE_B=("B_SITE_RAW", _join_sorted_unique),
        KEY_SO_B=("KEY_SO", _join_sorted_unique),
        KEY_PO_SO_XREF_B=("KEY_PO_SO_XREF", _join_sorted_unique),
        B_ROW_FIRST=("B_ROW", "first"),
        B_ROW_COUNT=("B_ROW", "count"),
    ).reset_index()

    so_set_b = b.groupby("KEY_PO", sort=False)["KEY_SO"].agg(_safe_set).reset_index().rename(columns={"KEY_SO": "SO_SET_B"})
    ag_b = ag_b.merge(so_set_b, on="KEY_PO", how="left")

    df = ag_a.merge(ag_b, on="KEY_PO", how="outer", indicator=True)

    # 语义：left_only=A有B无=UNMATCHED_IN_B → Missing in PSD; right_only=B有A无=UNMATCHED_IN_A → Extra in PSD
    df["MATCH_STATUS"] = "MATCHED_BY_PO"
    df.loc[df["_merge"] == "left_only", "MATCH_STATUS"] = "UNMATCHED_IN_B"   # A有B无 -> Missing in PSD
    df.loc[df["_merge"] == "right_only", "MATCH_STATUS"] = "UNMATCHED_IN_A"  # B有A无 -> Extra in PSD
    df = df.drop(columns=["_merge"])

    # 填充 NaN
    for col in ["HOLD_A_RAW", "HOLD_A_STD", "KEY_SO_A", "KEY_PO_SO_XREF_A", "SITE_A"]:
        df[col] = df[col].fillna("")
    for col in ["HOLD_B_RAW", "HOLD_B_STD", "KEY_SO_B", "KEY_PO_SO_XREF_B", "SITE_B"]:
        df[col] = df[col].fillna("")
    df["A_ROW_FIRST"] = df["A_ROW_FIRST"].fillna(-1).astype(int)
    df["B_ROW_FIRST"] = df["B_ROW_FIRST"].fillna(-1).astype(int)
    df["A_ROW_COUNT"] = df["A_ROW_COUNT"].fillna(0).astype(int)
    df["B_ROW_COUNT"] = df["B_ROW_COUNT"].fillna(0).astype(int)

    # Qty
    df["PLANNED_QTY_MATCH"] = [
        qty_match(a1, b1)
        for a1, b1 in zip(df["PLANNED_QTY_A"], df["PLANNED_QTY_B"])
    ]
    df["PLANNED_QTY_DIFF"] = df["PLANNED_QTY_A"] - df["PLANNED_QTY_B"]
    df["PLANNED_QTY_DIFF_PCT"] = np.where(
        df["PLANNED_QTY_A"].notna() & (df["PLANNED_QTY_A"] != 0),
        df["PLANNED_QTY_DIFF"] / df["PLANNED_QTY_A"],
        np.nan
    )

    # Hold（仅 matched 比，已在聚合时逐行标准化）
    df["HOLD_MATCH"] = pd.NA
    mask_matched = df["MATCH_STATUS"] == "MATCHED_BY_PO"
    df.loc[mask_matched, "HOLD_MATCH"] = df.loc[mask_matched, "HOLD_A_STD"] == df.loc[mask_matched, "HOLD_B_STD"]

    # SO set
    df["SO_SET_A"] = df["SO_SET_A"].apply(lambda x: x if isinstance(x, set) else set())
    df["SO_SET_B"] = df["SO_SET_B"].apply(lambda x: x if isinstance(x, set) else set())

    matched_idx = df.index[mask_matched]

    df["PO_SO_REL_MATCH"] = pd.NA
    df.loc[matched_idx, "PO_SO_REL_MATCH"] = [
        a == b for a, b in zip(df.loc[matched_idx, "SO_SET_A"], df.loc[matched_idx, "SO_SET_B"])
    ]

    df["SO_MISSING_IN_PSD"] = ""
    df.loc[matched_idx, "SO_MISSING_IN_PSD"] = [
        _safe_join_list(sorted(list(a - b))) for a, b in zip(df.loc[matched_idx, "SO_SET_A"], df.loc[matched_idx, "SO_SET_B"])
    ]

    df["SO_EXTRA_IN_PSD"] = ""
    df.loc[matched_idx, "SO_EXTRA_IN_PSD"] = [
        _safe_join_list(sorted(list(b - a))) for a, b in zip(df.loc[matched_idx, "SO_SET_A"], df.loc[matched_idx, "SO_SET_B"])
    ]

    # KEY_SO 展示
    df["KEY_SO"] = np.where(
        df["KEY_SO_A"].fillna("") != "",
        df["KEY_SO_A"].fillna(""),
        df["KEY_SO_B"].fillna("")
    )

    # 业务原因
    def build_reason(row):
        reasons = []
        if row["MATCH_STATUS"] == "UNMATCHED_IN_B":
            reasons.append("Missing in PSD")
        elif row["MATCH_STATUS"] == "UNMATCHED_IN_A":
            reasons.append("Extra in PSD")

        if row["MATCH_STATUS"] == "MATCHED_BY_PO" and is_false(row["PLANNED_QTY_MATCH"]):
            if pd.notna(row["PLANNED_QTY_A"]) and pd.notna(row["PLANNED_QTY_B"]):
                if row["PLANNED_QTY_A"] > row["PLANNED_QTY_B"]:
                    reasons.append("Qty mismatch (Backlog > PSD)")
                elif row["PLANNED_QTY_A"] < row["PLANNED_QTY_B"]:
                    reasons.append("Qty mismatch (PSD > Backlog)")
                else:
                    reasons.append("Qty mismatch")
            else:
                reasons.append("Qty mismatch")

        if row["MATCH_STATUS"] == "MATCHED_BY_PO" and is_false(row["HOLD_MATCH"]):
            reasons.append("Hold mismatch")

        if row["MATCH_STATUS"] == "MATCHED_BY_PO" and is_false(row["PO_SO_REL_MATCH"]):
            reasons.append("PO-SO mapping error")

        return "; ".join(reasons)

    def build_diff_reason_tech(row):
        reasons = []
        if row["MATCH_STATUS"] in ("UNMATCHED_IN_A", "UNMATCHED_IN_B"):
            reasons.append("UNMATCHED")
        if is_false(row["PLANNED_QTY_MATCH"]):
            reasons.append("PLANNED_QTY")
        if is_false(row["HOLD_MATCH"]):
            reasons.append("HOLD")
        if is_false(row["PO_SO_REL_MATCH"]):
            reasons.append("PO_SO_REL")
        return ";".join(reasons)

    df["DIFF_REASON"] = df.apply(build_diff_reason_tech, axis=1)
    df["DIFF_REASON_BIZ"] = df.apply(build_reason, axis=1)
    df["PRIMARY_ISSUE"] = df["DIFF_REASON_BIZ"].str.split("; ").str[0]
    df["IS_DIFF"] = df["DIFF_REASON"] != ""

    return df

# =========================================================
# 11) 分类 sheet
# =========================================================
def build_diff_sheets(df: pd.DataFrame):
    diff = df[df["IS_DIFF"]].copy()

    # UNMATCHED 拆分
    missing_in_psd = diff[diff["MATCH_STATUS"] == "UNMATCHED_IN_B"].copy()
    extra_in_psd = diff[diff["MATCH_STATUS"] == "UNMATCHED_IN_A"].copy()

    # 仅 matched 行做维度拆分
    matched_diff = diff[diff["MATCH_STATUS"] == "MATCHED_BY_PO"].copy()
    m_qty = matched_diff["PLANNED_QTY_MATCH"].apply(is_false)
    m_hold = matched_diff["HOLD_MATCH"].apply(is_false)
    m_poso = matched_diff["PO_SO_REL_MATCH"].apply(is_false)

    # 统计每行有几个维度不匹配
    mismatch_count = m_qty.astype(int) + m_hold.astype(int) + m_poso.astype(int)

    # 纯维度（仅该维度不匹配）
    diff_qty = matched_diff[m_qty & ~m_hold & ~m_poso].copy()
    diff_hold = matched_diff[m_hold & ~m_qty & ~m_poso].copy()
    diff_po_so = matched_diff[m_poso & ~m_qty & ~m_hold].copy()

    # 多维度同时不匹配
    diff_multi = matched_diff[mismatch_count >= 2].copy()

    return missing_in_psd, extra_in_psd, diff_qty, diff_hold, diff_po_so, diff_multi

# =========================================================
# 12) Summary / Top issues
# =========================================================
def build_summary(df: pd.DataFrame, file_a: str, file_b: str,
                  missing_in_psd, extra_in_psd, diff_qty, diff_hold, diff_po_so, diff_multi,
                  filtered_out_count: int):
    total = len(df)
    diff_cnt = len(df[df["IS_DIFF"]])

    matched_diff = df[(df["IS_DIFF"]) & (df["MATCH_STATUS"] == "MATCHED_BY_PO")]
    m_qty = matched_diff["PLANNED_QTY_MATCH"].apply(is_false)
    m_hold = matched_diff["HOLD_MATCH"].apply(is_false)
    m_poso = matched_diff["PO_SO_REL_MATCH"].apply(is_false)

    rows = [
        ["A file", os.path.basename(file_a)],
        ["B file", os.path.basename(file_b)],
        ["Total KEY_PO", total],
        ["Diff KEY_PO", diff_cnt],
        ["Match Rate", (1 - diff_cnt / total) if total > 0 else None],
        ["MISSING_IN_PSD rows", len(missing_in_psd)],
        ["EXTRA_IN_PSD rows", len(extra_in_psd)],
        ["DIFF_QTY rows (pure)", len(diff_qty)],
        ["DIFF_HOLD rows (pure)", len(diff_hold)],
        ["DIFF_PO_SO rows (pure)", len(diff_po_so)],
        ["DIFF_MULTI rows", len(diff_multi)],
        ["Missing in PSD", int((df["MATCH_STATUS"] == "UNMATCHED_IN_B").sum())],
        ["Extra in PSD", int((df["MATCH_STATUS"] == "UNMATCHED_IN_A").sum())],
        ["Qty mismatch (any)", int(m_qty.sum())],
        ["Hold mismatch (any)", int(m_hold.sum())],
        ["PO-SO mapping error (any)", int(m_poso.sum())],
        ["A rows filtered by MFG Ship Date", filtered_out_count],
    ]

    if ENABLE_EXTRA_SUMMARY:
        rows.extend([
            ["A qty total", df["PLANNED_QTY_A"].sum(skipna=True)],
            ["B qty total", df["PLANNED_QTY_B"].sum(skipna=True)],
            ["A/B qty total diff", df["PLANNED_QTY_DIFF"].sum(skipna=True)],
        ])

    summary = pd.DataFrame(rows, columns=["Metric", "Value"])

    top_po = df[df["IS_DIFF"]].copy()
    top_po["ABS_QTY_DIFF"] = top_po["PLANNED_QTY_DIFF"].abs().fillna(0)
    top_po["ISSUE_COUNT"] = (
        top_po["PLANNED_QTY_MATCH"].apply(is_false).astype(int) +
        top_po["HOLD_MATCH"].apply(is_false).astype(int) +
        top_po["PO_SO_REL_MATCH"].apply(is_false).astype(int)
    )
    top_po["SCORE"] = (
        top_po["ABS_QTY_DIFF"]
        + top_po["ISSUE_COUNT"] * 100
        + (top_po["MATCH_STATUS"] != "MATCHED_BY_PO").astype(int) * 1000
    )
    top_po = top_po.sort_values(
        by=["SCORE", "ABS_QTY_DIFF"],
        ascending=[False, False]
    )[[
        "KEY_PO", "SITE_A", "SITE_B", "PRIMARY_ISSUE", "DIFF_REASON",
        "PLANNED_QTY_A", "PLANNED_QTY_B", "PLANNED_QTY_DIFF", "PLANNED_QTY_DIFF_PCT",
        "HOLD_A_STD", "HOLD_B_STD",
        "SO_MISSING_IN_PSD", "SO_EXTRA_IN_PSD",
        "ISSUE_COUNT", "SCORE",
        "A_ROW_FIRST", "B_ROW_FIRST"
    ]].head(100)

    return summary, top_po

# =========================================================
# 13) 差异行全量回填（代表性首行）
# =========================================================
def backfill_full_fields(diff_df: pd.DataFrame, file_a: str, sheet_a: str, file_b: str):
    diff_df = diff_df.copy()

    a_rows = diff_df.loc[diff_df["A_ROW_FIRST"].notna(), "A_ROW_FIRST"].astype(int).unique().tolist()
    if a_rows:
        df_a_full = read_excel_fast(file_a, sheet_name=sheet_a, dtype=str)
        a_subset = df_a_full.iloc[a_rows].copy()
        a_subset["A_ROW_FIRST"] = a_rows
        a_subset = a_subset.add_prefix("A__")
        a_subset = a_subset.rename(columns={"A__A_ROW_FIRST": "A_ROW_FIRST"})
        diff_df = diff_df.merge(a_subset, on="A_ROW_FIRST", how="left")

    b_rows = diff_df.loc[diff_df["B_ROW_FIRST"].notna(), "B_ROW_FIRST"].astype(int).unique().tolist()
    if b_rows:
        df_b_full = pd.read_csv(file_b, dtype=str, low_memory=False)
        b_subset = df_b_full.iloc[b_rows].copy()
        b_subset["B_ROW_FIRST"] = b_rows
        b_subset = b_subset.add_prefix("B__")
        b_subset = b_subset.rename(columns={"B__B_ROW_FIRST": "B_ROW_FIRST"})
        diff_df = diff_df.merge(b_subset, on="B_ROW_FIRST", how="left")

    return diff_df

# =========================================================
# 14) Excel 自动美化
# =========================================================
def auto_fit_columns(ws, min_width=10, max_width=40, max_scan_rows=200):
    for col_cells in ws.columns:
        col_letter = get_column_letter(col_cells[0].column)
        max_len = 0
        for cell in col_cells[:max_scan_rows]:
            val = "" if cell.value is None else str(cell.value)
            val_len = len(val)
            if val_len > max_len:
                max_len = val_len
        width = min(max(max_len + 2, min_width), max_width)
        ws.column_dimensions[col_letter].width = width

def style_header(ws, fill_color="1F4E78", font_color="FFFFFF"):
    header_fill = PatternFill("solid", fgColor=fill_color)
    header_font = Font(color=font_color, bold=True)
    thin = Side(border_style="thin", color="D9D9D9")

    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)

def freeze_and_filter(ws):
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

def highlight_columns(ws, header_names, fill_color):
    target_cols = []
    header_row = [c.value for c in ws[1]]
    for i, h in enumerate(header_row, start=1):
        if h in header_names:
            target_cols.append(i)

    fill = PatternFill("solid", fgColor=fill_color)
    for col_idx in target_cols:
        for row in range(2, ws.max_row + 1):
            ws.cell(row=row, column=col_idx).fill = fill

def apply_number_formats(ws):
    header_row = [c.value for c in ws[1]]
    pct_cols = []
    num_cols = []
    for i, h in enumerate(header_row, start=1):
        if h in ["PLANNED_QTY_DIFF_PCT", "Match Rate"]:
            pct_cols.append(i)
        if h in ["PLANNED_QTY_A", "PLANNED_QTY_B", "PLANNED_QTY_DIFF", "A qty total", "B qty total", "A/B qty total diff"]:
            num_cols.append(i)

    for col_idx in pct_cols:
        for row in range(2, ws.max_row + 1):
            ws.cell(row=row, column=col_idx).number_format = "0.00%"

    for col_idx in num_cols:
        for row in range(2, ws.max_row + 1):
            ws.cell(row=row, column=col_idx).number_format = "#,##0.0000"

def beautify_summary(ws):
    style_header(ws, fill_color="44546A", font_color="FFFFFF")
    freeze_and_filter(ws)
    auto_fit_columns(ws, min_width=18, max_width=35)

    # Metric 列加深
    metric_fill = PatternFill("solid", fgColor="D9E1F2")
    for row in range(2, ws.max_row + 1):
        ws.cell(row=row, column=1).fill = metric_fill
        ws.cell(row=row, column=1).font = Font(bold=True)

    apply_number_formats(ws)

def beautify_top_po_sheet(ws):
    style_header(ws, fill_color="7030A0", font_color="FFFFFF")
    freeze_and_filter(ws)
    auto_fit_columns(ws, min_width=10, max_width=36)
    highlight_columns(ws, ["PRIMARY_ISSUE"], "FCE4D6")
    highlight_columns(ws, ["PLANNED_QTY_DIFF", "PLANNED_QTY_DIFF_PCT"], "DDEBF7")
    apply_number_formats(ws)

def beautify_workbook(file_path: str):
    wb = load_workbook(file_path)

    sheet_colors = {
        "MISSING_IN_PSD": "C00000",
        "EXTRA_IN_PSD": "ED7D31",
        "DIFF_QTY": "4472C4",
        "DIFF_HOLD": "70AD47",
        "DIFF_PO_SO": "7030A0",
        "DIFF_MULTI": "FF0000",
    }

    for ws in wb.worksheets:
        if ws.title == "SUMMARY":
            beautify_summary(ws)
        elif ws.title == "TOP_PO_ISSUES":
            beautify_top_po_sheet(ws)
        elif ws.title in sheet_colors:
            style_header(ws, fill_color=sheet_colors[ws.title], font_color="FFFFFF")
            freeze_and_filter(ws)
            auto_fit_columns(ws, min_width=10, max_width=36)
            highlight_columns(ws, ["MATCH_STATUS"], "FFF2CC")
            highlight_columns(ws, ["PRIMARY_ISSUE"], "FCE4D6")
            highlight_columns(ws, ["PLANNED_QTY_MATCH", "HOLD_MATCH", "PO_SO_REL_MATCH"], "E2F0D9")
            highlight_columns(ws, ["PLANNED_QTY_DIFF", "PLANNED_QTY_DIFF_PCT"], "DDEBF7")
            highlight_columns(ws, ["SO_MISSING_IN_PSD", "SO_EXTRA_IN_PSD"], "F4CCCC")
            apply_number_formats(ws)

    wb.save(file_path)

# =========================================================
# 15) 输出
# =========================================================
def write_output(
    file_path: str,
    summary: pd.DataFrame,
    missing_in_psd: pd.DataFrame,
    extra_in_psd: pd.DataFrame,
    diff_qty: pd.DataFrame,
    diff_hold: pd.DataFrame,
    diff_po_so: pd.DataFrame,
    diff_multi: pd.DataFrame,
    top_po: pd.DataFrame
):
    with pd.ExcelWriter(file_path, engine="openpyxl") as writer:
        summary.to_excel(writer, sheet_name="SUMMARY", index=False)
        missing_in_psd.to_excel(writer, sheet_name="MISSING_IN_PSD", index=False)
        extra_in_psd.to_excel(writer, sheet_name="EXTRA_IN_PSD", index=False)
        diff_qty.to_excel(writer, sheet_name="DIFF_QTY", index=False)
        diff_hold.to_excel(writer, sheet_name="DIFF_HOLD", index=False)
        diff_po_so.to_excel(writer, sheet_name="DIFF_PO_SO", index=False)
        diff_multi.to_excel(writer, sheet_name="DIFF_MULTI", index=False)
        top_po.to_excel(writer, sheet_name="TOP_PO_ISSUES", index=False)

    beautify_workbook(file_path)

# =========================================================
# 16) QA
# =========================================================
def run_qa(df: pd.DataFrame, summary: pd.DataFrame):
    diff = df[df["IS_DIFF"]]
    assert (diff["DIFF_REASON"].fillna("") != "").all(), "存在空 DIFF_REASON 的差异行"

    # Both sides: E30/E11/OTHER/OTHERS → OTHERS
    for side, raw_col, std_col in [("A", "HOLD_A_RAW", "HOLD_A_STD"), ("B", "HOLD_B_RAW", "HOLD_B_STD")]:
        for code in ["E30", "E11", "OTHER", "OTHERS"]:
            mask = df[raw_col].fillna("").str.upper().str.contains(rf"\b{code}\b", regex=True)
            subset = df[mask]
            if len(subset) > 0:
                assert subset[std_col].str.contains("OTHERS").all(), f"{side}端 {code} 未正确映射为 OTHERS"

    unmatched = df[df["MATCH_STATUS"] != "MATCHED_BY_PO"]
    if len(unmatched) > 0:
        assert unmatched["HOLD_MATCH"].isna().all(), "unmatched 行 HOLD_MATCH 不应为 False"
        assert unmatched["PO_SO_REL_MATCH"].isna().all(), "unmatched 行 PO_SO_REL_MATCH 不应为 False"

    # Sheet partition integrity: MISSING + EXTRA + pure QTY + pure HOLD + pure PO_SO + MULTI = total diff
    matched_diff = diff[diff["MATCH_STATUS"] == "MATCHED_BY_PO"]
    m_qty = matched_diff["PLANNED_QTY_MATCH"].apply(is_false)
    m_hold = matched_diff["HOLD_MATCH"].apply(is_false)
    m_poso = matched_diff["PO_SO_REL_MATCH"].apply(is_false)
    mismatch_count = m_qty.astype(int) + m_hold.astype(int) + m_poso.astype(int)
    n_missing = int((diff["MATCH_STATUS"] == "UNMATCHED_IN_B").sum())
    n_extra = int((diff["MATCH_STATUS"] == "UNMATCHED_IN_A").sum())
    n_pure_qty = int((m_qty & ~m_hold & ~m_poso).sum())
    n_pure_hold = int((m_hold & ~m_qty & ~m_poso).sum())
    n_pure_poso = int((m_poso & ~m_qty & ~m_hold).sum())
    n_multi = int((mismatch_count >= 2).sum())
    sheet_total = n_missing + n_extra + n_pure_qty + n_pure_hold + n_pure_poso + n_multi
    assert sheet_total == len(diff), f"Sheet partition mismatch: {sheet_total} != {len(diff)}"

    assert len(summary) > 0, "SUMMARY 为空"

    # IS_DIFF 一致性校验
    expected_is_diff = (
        (df["MATCH_STATUS"] != "MATCHED_BY_PO")
        | df["PLANNED_QTY_MATCH"].apply(is_false)
        | df["HOLD_MATCH"].apply(is_false)
        | df["PO_SO_REL_MATCH"].apply(is_false)
    )
    assert (df["IS_DIFF"] == expected_is_diff.fillna(False)).all(), \
        "IS_DIFF 与实际差异条件不一致"

# =========================================================
# 17) 主流程
# =========================================================
def main():
    start = time.time()
    log("Starting PSD Diff Analyzer V3.1 + Excel Beautify ...")

    file_a, sheet_a, file_b, df_a, df_b, a_resolved, b_resolved = load_sources_minimal(BASE_DIR)

    # 多维度筛选
    effective_filter = {}
    if SITE_FILTER is None:
        # 交互式：弹出多维度选择对话框
        a_dim_values = {}
        b_dim_values = {}
        for dim_name, _label, sides in FILTER_DIMENSIONS:
            if "A" in sides:
                vals = _extract_unique_values(df_a, a_resolved, dim_name)
                if vals:
                    a_dim_values[dim_name] = vals
            if "B" in sides:
                vals = _extract_unique_values(df_b, b_resolved, dim_name)
                if vals:
                    b_dim_values[dim_name] = vals
        log("Opening filter selection dialog...")
        effective_filter = filter_selection_dialog(a_dim_values, b_dim_values)
    elif isinstance(SITE_FILTER, dict):
        # 预配置：仅 Site 维度
        effective_filter = {"A": {"Site": SITE_FILTER.get("A", [])}, "B": {"Site": SITE_FILTER.get("B", [])}}
    else:
        effective_filter = {}

    for side in ("A", "B"):
        for dim, vals in effective_filter.get(side, {}).items():
            if vals:
                log(f"  {side}端 {dim} filter: {vals}")

    a, b, filtered_out_count = build_standard_views(
        df_a, df_b, a_resolved, b_resolved, effective_filter
    )
    log(f"A standardized rows: {len(a):,}")
    log(f"B standardized rows: {len(b):,}")
    log(f"A rows filtered by MFG Ship Date: {filtered_out_count:,}")

    result = match_by_key_po(a, b)
    log(f"Aggregated KEY_PO rows: {len(result):,}")

    missing_in_psd, extra_in_psd, diff_qty, diff_hold, diff_po_so, diff_multi = build_diff_sheets(result)
    log(f"MISSING_IN_PSD rows: {len(missing_in_psd):,}")
    log(f"EXTRA_IN_PSD rows: {len(extra_in_psd):,}")
    log(f"DIFF_QTY rows (pure): {len(diff_qty):,}")
    log(f"DIFF_HOLD rows (pure): {len(diff_hold):,}")
    log(f"DIFF_PO_SO rows (pure): {len(diff_po_so):,}")
    log(f"DIFF_MULTI rows: {len(diff_multi):,}")

    summary, top_po = build_summary(result, file_a, file_b, missing_in_psd, extra_in_psd, diff_qty, diff_hold, diff_po_so, diff_multi, filtered_out_count)

    if ENABLE_BACKFILL_FULL_FIELDS:
        log("Backfilling representative original fields...")
        missing_in_psd = backfill_full_fields(missing_in_psd, file_a, sheet_a, file_b)
        extra_in_psd = backfill_full_fields(extra_in_psd, file_a, sheet_a, file_b)
        diff_qty = backfill_full_fields(diff_qty, file_a, sheet_a, file_b)
        diff_hold = backfill_full_fields(diff_hold, file_a, sheet_a, file_b)
        diff_po_so = backfill_full_fields(diff_po_so, file_a, sheet_a, file_b)
        diff_multi = backfill_full_fields(diff_multi, file_a, sheet_a, file_b)

    log("Running QA checks...")
    run_qa(result, summary)
    log("QA passed.")

    log("Writing Excel output with beautification...")
    write_output(OUTPUT_FILE, summary, missing_in_psd, extra_in_psd, diff_qty, diff_hold, diff_po_so, diff_multi, top_po)

    elapsed = time.time() - start
    log(f"Done. Output file: {OUTPUT_FILE}")
    log(f"Elapsed seconds: {elapsed:.2f}")

if __name__ == "__main__":
    main()