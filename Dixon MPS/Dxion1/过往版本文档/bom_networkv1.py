import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox
from openpyxl import load_workbook
from openpyxl.styles import PatternFill

#调用示例
## import bom_network
## df_bom = bom_network.load_bom_file("xxx.xlsx")
## df_result = bom_network.generate_bom_network(df_bom)
## bom_network.save_bom_result(df_result, "xxx_BOM展开结果.xlsx")

# 注意替代料逻辑需要确认更新, NAME==ALPGR, IDNRK？

def load_bom_file(file_path: str) -> pd.DataFrame:
    """读取 BOM 文件为 DataFrame"""
    if file_path.lower().endswith(".csv"):
        df = pd.read_csv(file_path)
    else:
        df = pd.read_excel(file_path, engine="openpyxl")
    return df


def save_bom_result(df_result: pd.DataFrame, output_path: str):
    """保存展开结果到 Excel 并进行高亮"""
    df_result.to_excel(output_path, index=False)

    # 加颜色高亮
    wb = load_workbook(output_path)
    ws = wb.active
    fill_color = PatternFill(start_color="FFEEDD", end_color="FFEEDD", fill_type="solid")

    highlight_col_index = list(df_result.columns).index('Highlight') + 1
    for row in range(2, ws.max_row + 1):
        if ws.cell(row=row, column=highlight_col_index).value == "Yes":
            for col in range(1, ws.max_column + 1):
                ws.cell(row=row, column=col).fill = fill_color

    wb.save(output_path)


def explode_bom(df_bom: pd.DataFrame, parent, qty_multiplier=1, visited=None, bomroot=None):
    """递归展开 BOM 结构"""
    if visited is None:
        visited = set()

    children = df_bom[df_bom['NAME'] == parent]
    results = []

    for _, row in children.iterrows():
        child = row['IDNRK']
        qty = row['MENGE'] * qty_multiplier
        alpgr = row['ALPGR']

        current_bomroot = row.get('BOMROOT', bomroot) if 'BOMROOT' in df_bom.columns else bomroot

        is_leaf = child not in set(df_bom['NAME'])

        if is_leaf:
            # 检查替代关系
            group_items = df_bom[(df_bom['NAME'] == parent) & (df_bom['ALPGR'] == alpgr)]
            idnrk_counts = group_items['IDNRK'].value_counts()
            is_substitute = (idnrk_counts > 1).any()

            results.append({
                'BOMROOT': current_bomroot,
                'Parent': parent,
                'Child': child,
                'TotalQty': qty,
                'AltGroup': alpgr,
                'IsSubstitute': is_substitute
            })

            if is_substitute:
                duplicate_idnrks = idnrk_counts[idnrk_counts > 1].index.tolist()
                for alt in duplicate_idnrks:
                    if alt != child:
                        results.append({
                            'BOMROOT': current_bomroot,
                            'Parent': parent,
                            'Child': alt,
                            'TotalQty': qty,
                            'AltGroup': alpgr,
                            'IsSubstitute': True
                        })
        else:
            results.extend(explode_bom(df_bom, child, qty, visited, current_bomroot))

        if child not in visited:
            visited.add(child)

    return results


def generate_bom_network(df_bom: pd.DataFrame) -> pd.DataFrame:
    """生成 BOM 展开结果，返回 DataFrame"""
    df_bom['MENGE'] = pd.to_numeric(df_bom['MENGE'], errors='coerce').fillna(0)
    if 'ALPGR' not in df_bom.columns:
        df_bom['ALPGR'] = ""
    if 'BOMROOT' not in df_bom.columns:
        df_bom['BOMROOT'] = ""

    top_items = set(df_bom['NAME']) - set(df_bom['IDNRK'])

    all_results = []
    for top in top_items:
        top_bomroot = df_bom[df_bom['NAME'] == top]['BOMROOT'].iloc[0] if len(df_bom[df_bom['NAME'] == top]) > 0 else ""
        all_results.extend(explode_bom(df_bom, top, 1, bomroot=top_bomroot))

    df_result = pd.DataFrame(all_results)

    # 去重：仅对 ALPGR 不为空的记录
    mask_alt_notnull = df_result['AltGroup'].notna() & (df_result['AltGroup'] != "")
    df_result = pd.concat([
        df_result[mask_alt_notnull].drop_duplicates(subset=['Parent', 'Child', 'AltGroup', 'TotalQty']),
        df_result[~mask_alt_notnull]
    ], ignore_index=True)

    df_result['Highlight'] = df_result['IsSubstitute'].apply(lambda x: "Yes" if x else "")

    if 'BOMROOT' in df_result.columns:
        cols = ['BOMROOT'] + [col for col in df_result.columns if col != 'BOMROOT']
        df_result = df_result[cols]

    return df_result


def select_file() -> str:
    """弹出文件选择窗口"""
    root = tk.Tk()
    root.withdraw()
    file_path = filedialog.askopenfilename(
        title="选择BOM文件",
        filetypes=[("Excel files", "*.xlsx;*.xls"), ("CSV files", "*.csv")]
    )
    return file_path


def main():
    """GUI 运行入口"""
    file_path = select_file()
    if not file_path:
        messagebox.showerror("错误", "未选择文件")
        return

    df_bom = load_bom_file(file_path)
    df_result = generate_bom_network(df_bom)

    output_path = file_path.rsplit('.', 1)[0] + "_BOM展开结果.xlsx"
    save_bom_result(df_result, output_path)

    messagebox.showinfo("完成", f"BOM 展开已完成，文件已保存到：\n{output_path}")


if __name__ == "__main__":
    main()
