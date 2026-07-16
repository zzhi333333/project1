import pandas as pd

# 读取文件
dixon_df = pd.read_excel("Dixon MFG PO.xlsx", engine="openpyxl")
mapping_df = pd.read_excel("MTM_SBB_mapping.xlsx", engine="openpyxl")

# Step 1: 透视汇总 Dixon 表格中的 MTM 总订单数量
pivot_df = dixon_df.groupby("MTM", as_index=False)["Qty"].sum()
pivot_df.rename(columns={"Qty": "MTM Qty"}, inplace=True)

# Step 2: 标准化 MTM 字段，确保匹配成功
pivot_df["MTM"] = pivot_df["MTM"].astype(str).str.strip().str.upper()
mapping_df["MTM"] = mapping_df["MTM"].astype(str).str.strip().str.upper()

# Step 3: 合并两个表格
merged_df = pd.merge(mapping_df, pivot_df, on="MTM", how="left")

# Step 4: 计算订单用量 = SBB Qty × MTM Qty
merged_df["订单用量"] = merged_df["Qty"] * merged_df["MTM Qty"]

# Step 5: 整理输出列顺序
final_df = merged_df[["MTM", "SBB", "Qty", "SBB Name", "Basic Name", "MTM Qty", "订单用量"]]

# Step 6: 保存为 Excel 文件
final_df.to_excel("SBB_订单用量汇总.xlsx", index=False)

# 可选：打印前几行用于验证
print(final_df.head())
