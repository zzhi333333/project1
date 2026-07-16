import pandas as pd
from datetime import timedelta

# 读取数据
bps_df = pd.read_excel("Net_dmd_BPS_result_20250826.xlsx", sheet_name=0, engine="openpyxl")
openpo_df = pd.read_excel("LNV Dixon Open PO + 0826.xlsx", sheet_name="Combined", engine="openpyxl")

# 清理字段
openpo_df['ALT Customer PN'] = openpo_df['ALT Customer PN'].astype(str).str.strip()
openpo_df['Confirm ETD'] = pd.to_datetime(openpo_df['Confirm ETD'], errors='coerce').dt.date

# 计算 ETA 日期
openpo_df['MOT'] = openpo_df['MOT'].astype(str).str.lower().str.strip()
def calc_eta(row):
    if pd.isna(row['Confirm ETD']):
        return None
    if row['MOT'] == 'air':
        return row['Confirm ETD'] + timedelta(weeks=2)
    elif row['MOT'] == 'sea':
        return row['Confirm ETD'] + timedelta(weeks=6)
    return None
openpo_df['ETA'] = openpo_df.apply(calc_eta, axis=1)

# 构建 PN 到 Description 和 Model 的映射（去重）
desc_map = openpo_df.dropna(subset=['Description']).drop_duplicates(subset=['ALT Customer PN'])[['ALT Customer PN', 'Description']].set_index('ALT Customer PN')['Description']
model_map = openpo_df.groupby('ALT Customer PN')['Model'].apply(lambda x: ', '.join(sorted(set(x.dropna()))))

# 遍历 CHILD 和 substitute_n 字段，匹配 Description 和 Model
pn_columns = [col for col in bps_df.columns if col.startswith('CHILD') or col.startswith('substitute_')]
bps_df['Description'] = None
bps_df['Model'] = None
for idx, row in bps_df.iterrows():
    pns = [str(row[col]).strip() for col in pn_columns if pd.notna(row[col])]
    matched_desc = next((desc_map[pn] for pn in pns if pn in desc_map), None)
    matched_models = sorted(set(model_map[pn] for pn in pns if pn in model_map))
    bps_df.at[idx, 'Description'] = matched_desc
    bps_df.at[idx, 'Model'] = ', '.join(matched_models) if matched_models else None

# 聚合 ETA 到料
eta_pivot = openpo_df.dropna(subset=['ETA']).groupby(['ALT Customer PN', 'ETA'])['Total'].sum().unstack(fill_value=0)
for eta_date in eta_pivot.columns:
    bps_df[str(eta_date)] = bps_df[pn_columns].apply(lambda row: sum(eta_pivot.at[pn, eta_date] if pn in eta_pivot.index else 0 for pn in row if pd.notna(pn)), axis=1)

# 验证 SA00007HR00 的 ETA 到料
sa_eta = openpo_df[openpo_df['ALT Customer PN'] == 'SA00007HR00'].groupby('ETA')['Total'].sum()
print("SA00007HR00 的 ETA 到料如下：")
print(sa_eta)

# 输出更新后的文件
bps_df.to_excel("Net_dmd_BPS_result_final.xlsx", index=False)
print("已修复并保存为 Net_dmd_BPS_result_final.xlsx")
