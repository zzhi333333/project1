import os
import re
import tkinter as tk
from tkinter import filedialog, messagebox
import pandas as pd

def norm(s):
    return re.sub(r"\s+", " ", str(s)).strip().lower()

def find_col(df, candidates):
    """宽松匹配列名；返回第一个匹配的实际列名；找不到则抛 KeyError"""
    cols = list(df.columns)
    cnorm = {norm(c): c for c in cols}
    for cand in candidates:
        k = norm(cand)
        if k in cnorm:
            return cnorm[k]
    # 尝试包含匹配（更宽松）
    for c in cols:
        for cand in candidates:
            if norm(c).find(norm(cand)) >= 0 or norm(cand).find(norm(c)) >= 0:
                return c
    raise KeyError(f"未找到列匹配: {candidates}；实际列: {cols}")

def ensure_output_dir():
    if not os.path.exists("output"):
        os.makedirs("output")

def save_df(df, filename):
    from config import SAVE_INTERMEDIATE
    if not SAVE_INTERMEDIATE:
        return
    ensure_output_dir()
    path = os.path.join("output", filename)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xls"):
        df.to_excel(path, index=False)
    else:
        df.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"[INFO] 已保存: {path}")

def select_file_gui(title, example, filetypes=(("Excel/CSV", "*.xlsx;*.xls;*.csv"),)):
    root = tk.Tk()
    root.withdraw()
    messagebox.showinfo("请选择文件", f"{title}\n示例文件名：{example}")
    path = filedialog.askopenfilename(title=title, filetypes=filetypes)
    if not path:
        raise FileNotFoundError(f"未选择文件: {title}")
    print(f"[INPUT] 选择文件 ({title}): {path}")
    return path