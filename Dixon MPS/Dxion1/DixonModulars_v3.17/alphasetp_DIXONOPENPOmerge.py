# -*- coding: utf-8 -*-
"""
LNV Dixon 三文件自动合并（Open PO / TNB PSD / PSD）
字段映射已按最新需求固定
"""

import tkinter as tk
from tkinter import filedialog, messagebox
import pandas as pd
from pathlib import Path
from datetime import datetime

# ---------- 通用：根据字段候选自动选表 ---------- #
def pick_sheet_by_cols(xls_dict, candidates):
    best_name, best_score, best_df = None, -1, None
    for name, df in xls_dict.items():
        cols = [str(c).strip() for c in df.columns]
        score = sum(1 for cand in candidates if cand.lower() in [c.lower() for c in cols])
        if score > best_score:
            best_name, best_score, best_df = name, score, df
    return best_name, best_df

# ---------- 识别文件类型并返回映射 ---------- #
def detect_role_and_mapper(xlsx_path: Path):
    try:
        xls = pd.read_excel(xlsx_path, sheet_name=None)
    except Exception as e:
        raise RuntimeError(f"读取失败：{xlsx_path}\n{e}")

    # 三套字段候选（Open PO 这里额外补 DESCRIÇÃO）
    cands_open = ['ALT Customer PN', 'ALT Compal PN', 'Total', 'MOT', 'ATD', 'Model', 'DESCRIÇÃO']
    cands_tnb  = ['MTM', 'Material PN', 'Qty', 'Description', 'MOT', 'SCP/PSD Commit', 'Model']
    cands_psd  = ['MTM', 'Material PN', 'Qty', 'Description', 'MOT', 'PSD', 'Model']

    name_o, df_o = pick_sheet_by_cols(xls, cands_open)
    name_t, df_t = pick_sheet_by_cols(xls, cands_tnb)
    name_p, df_p = pick_sheet_by_cols(xls, cands_psd)

    score_o = 0 if df_o is None else sum(1 for c in cands_open if c in df_o.columns)
    score_t = 0 if df_t is None else sum(1 for c in cands_tnb  if c in df_t.columns)
    score_p = 0 if df_p is None else sum(1 for c in cands_psd  if c in df_p.columns)

    best_score = max(score_o, score_t, score_p)
    if best_score == 0:
        raise RuntimeError(f"无法识别文件类型：{xlsx_path}")

    if best_score == score_o and df_o is not None:
        return 'open', name_o, df_o, {
            "ALT Customer PN": "ALT Customer PN",
            "ALT Compal PN":   "ALT Compal PN",
            "Total":           "Total",
            "MOT":             "MOT",
            "ATD":     "Confirm ETD",
            "Model":           "Model",
            "DESCRIÇÃO":       "Description",
        }
    elif best_score == score_t and df_t is not None:
        return 'tnb', name_t, df_t, {
            "MTM":             "ALT Customer PN",
            "Material PN":     "ALT Compal PN",
            "Qty":             "Total",
            "Description":     "Description",
            "MOT":             "MOT",
            "SCP/PSD Commit":  "Confirm ETD",
            "Model":           "Model",
        }
    else:  # PSD
        return 'psd', name_p, df_p, {
            "MTM":             "ALT Customer PN",
            "Material PN":     "ALT Compal PN",
            "Qty":             "Total",
            "Description":     "Description",
            "MOT":             "MOT",
            "PSD":             "Confirm ETD",
            "Model":           "Model",
        }

# ---------- 统一列名并提取子集 ---------- #
def extract_common(df: pd.DataFrame, mapper: dict) -> pd.DataFrame:
    df.columns = [str(c).strip() for c in df.columns]
    sel = df[[c for c in mapper if c in df.columns]].rename(columns=mapper)

    final_cols = ["ALT Customer PN", "ALT Compal PN", "Total",
                  "Description", "MOT", "Confirm ETD", "Model"]
    for col in final_cols:
        if col not in sel.columns:
            sel[col] = pd.NA

    sel["Total"] = pd.to_numeric(sel["Total"], errors="coerce")
    sel["Confirm ETD"] = pd.to_datetime(sel["Confirm ETD"], errors="coerce")
    sel.dropna(how="all", subset=["ALT Customer PN", "ALT Compal PN", "Total"], inplace=True)

    return sel[final_cols]

# ---------- GUI ---------- #
def run_gui():
    root = tk.Tk()
    root.withdraw()

    files = filedialog.askopenfilenames(
        title="请选择 2-N 个 Excel 文件（Open PO / TNB PSD / PSD）",
        filetypes=[("Excel files", "*.xlsx;*.xlsm;*.xls")],
    )
    if not files or len(files) < 2:
        messagebox.showwarning("提示", "请至少选择两个文件（支持 2 个以上）")
        return

    all_dfs = []

    for f in [Path(p) for p in files]:
        try:
            role, sheet, df, mapper = detect_role_and_mapper(f)
            clean_df = extract_common(df, mapper)
            all_dfs.append(clean_df)
        except Exception as e:
            messagebox.showerror("错误", f"{f.name}\n{e}")
            return

    if not all_dfs:
        messagebox.showerror("错误", "未识别到任何有效数据")
        return

    # 合并
    combined = pd.concat(all_dfs, ignore_index=True)
    combined = combined.sort_values(
        by=["Model", "ALT Customer PN", "ALT Compal PN"],
        kind="stable", na_position="last"
    )

    # 输出
    out_dir = Path(files[0]).parent
    mmdd = datetime.now().strftime("%m%d")
    out_path = out_dir / f"LNV Dixon Open PO_{mmdd}.xlsx"
    try:
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            combined.to_excel(writer, index=False, sheet_name="Combined")
    except Exception as e:
        messagebox.showerror("错误", f"导出失败：\n{e}")
        return

    messagebox.showinfo("完成", f"已生成：\n{out_path}\n\n总行数：{len(combined)}")

if __name__ == "__main__":
    run_gui()