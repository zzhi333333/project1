import pandas as pd
import os
from datetime import datetime

# =========================
# 1. 路径
# =========================
input_path = r"D:\OneDrive - Lenovo\08-HQ PSD report\HQ WIP.xlsx"

output_dir = r"D:\OneDrive - Lenovo\08-HQ PSD report"
output_path = os.path.join(output_dir, "HQ WIP analysis.xlsx")

# =========================
# 2. 读取数据
# =========================
df = pd.read_excel(input_path, engine='openpyxl', keep_default_na=False, na_values=[''])

# 清洗列名
df.columns = df.columns.str.strip()

# =========================
# 3. PO过滤（自动识别）
# =========================
po_col = None
for col in df.columns:
    if col.replace(" ", "").upper() in ["LVPO", "PO"]:
        po_col = col
        break

if po_col is None:
    raise ValueError(f"未找到PO列: {df.columns.tolist()}")

df = df[df[po_col].notna() & (df[po_col].astype(str).str.strip() != '')]

# =========================
# 4. Gen8分类
# =========================
def classify(x):
    if isinstance(x, str):
        s = x.strip().upper()
        if s.startswith('J13'):
            return 'J13'
        if ('G8' in s) or ('X7' in s):
            return 'Gen8'
    return 'Non Gen 8'

df['Gen8 type'] = df['Model'].apply(classify)

# =========================
# 5. 日期字段（白名单）
# =========================
DATE_COLUMNS = [
    'PSD Version',
    'Order Date',
    'Ship date',
    'Input Date',
    'MR date'
]

for col in DATE_COLUMNS:
    if col in df.columns:
        df[col] = pd.to_datetime(df[col], errors='coerce')

# =========================
# 6. WIP Analysis 计算 ⭐
# =========================

# 当前时间（自动识别当前月份）
today = datetime.today()
current_month = today.month
current_year = today.year

month_map = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr",
    5: "May", 6: "June", 7: "July", 8: "Aug",
    9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"
}

def wip_analysis(row):
    input_date = row.get('Input Date')
    aging = row.get('WIP aging days')

    # 容错
    if pd.isna(input_date):
        return "Unknown"

    # 计算真实月份差（跨年安全）
    month_diff = (current_year - input_date.year) * 12 + (current_month - input_date.month)
    input_month = input_date.month

    # M-2及更早
    if month_diff >= 2:
        return f"{month_map[input_month]} WIP"

    # M-1（上个月）
    elif month_diff == 1:
        if pd.notna(aging) and aging > 14:
            return f"{month_map[input_month]} WIP>14D"
        else:
            return f"{month_map[input_month]} WIP≤14D"

    # M0（当月）
    elif month_diff == 0:
        if pd.notna(aging) and aging > 14:
            return f"{month_map[input_month]} WIP>14D"
        else:
            return f"{month_map[input_month]} WIP≤14D"

    else:
        return "Future"

df['WIP Analysis'] = df.apply(wip_analysis, axis=1)

# =========================
# 7. 日期输出格式
# =========================
DATE_FMT = '%Y-%m-%d'
for col in DATE_COLUMNS:
    if col in df.columns:
        df[col] = df[col].dt.strftime(DATE_FMT)

# =========================
# 8. 输出结果
# =========================
df.to_excel(output_path, index=False, engine='openpyxl')
print(f"✅ 已输出: {output_path}")
