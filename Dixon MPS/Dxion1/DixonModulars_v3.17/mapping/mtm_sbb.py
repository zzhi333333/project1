import openpyxl
import pandas as pd
import re
from utils.common import norm

def parse_mtm_sbb_mapping_from_workbook(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    target_columns = ['SBB', 'Qty', 'SBB Name', 'Basic Name']
    all_rows = []
    for sheet_name in wb.sheetnames:
        sh = wb[sheet_name]
        try:
            mtm_value = sh['C6'].value
        except Exception:
            mtm_value = None
        try:
            header_row = sh[7]
        except Exception:
            continue
        header = [(cell.value.strip() if isinstance(cell.value, str) else cell.value) for cell in header_row]
        idx_map = {}
        for idx, name in enumerate(header):
            if name is None:
                continue
            name_norm = norm(name)
            for tgt in target_columns:
                if norm(tgt) == name_norm:
                    idx_map[tgt] = idx
        if len(idx_map) < len(target_columns):
            continue
        for row in sh.iter_rows(min_row=8, values_only=True):
            rec = {'MTM': (mtm_value if mtm_value is not None else None)}
            for col in target_columns:
                idx = idx_map.get(col)
                rec[col] = (row[idx] if (idx is not None and idx < len(row)) else None)
            all_rows.append(rec)
    df = pd.DataFrame(all_rows)
    if df.empty:
        raise ValueError("从 Multi Product Raw BOM 工作簿未解析到 MTM->SBB 数据，请检查表头（应在第7行）和 C6 是否存在 MTM")
    df_clean = df.dropna(subset=target_columns, how='all').copy()
    df_clean['MTM'] = df_clean['MTM'].astype(str).str.strip().str.upper()
    return df_clean