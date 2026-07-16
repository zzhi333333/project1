import pandas as pd

# Load BOM data
bom_df = pd.read_csv("DIXON+BOM+all_bom_leaf.csv")

# Load order quantity data
order_df = pd.read_excel("SBB_订单用量汇总_update.xlsx", engine="openpyxl")

# Aggregate order quantities by SBB
order_agg = order_df.groupby("SBB", as_index=False)["订单用量"].sum()

# Create mapping from SBB to total order quantity
sbb_qty_map = dict(zip(order_agg["SBB"], order_agg["订单用量"]))

# Map MFG_PO_Qty from bomroot
bom_df["MFG_PO_Qty"] = bom_df["bomroot"].map(sbb_qty_map).fillna(0)

# Ensure MENGE is numeric
bom_df["MENGE"] = pd.to_numeric(bom_df["MENGE"], errors="coerce").fillna(0)

# Calculate MENGE_times_MFG_PO_Qty
bom_df["MENGE_times_MFG_PO_Qty"] = bom_df["MENGE"] * bom_df["MFG_PO_Qty"]

# Save to Excel
bom_df.to_excel("MFG_PO_BOM_mapping.xlsx", index=False)

print("File MFG_PO_BOM_mapping.xlsx has been generated successfully.")

