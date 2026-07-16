import pandas as pd

# Load the files
inventory_df = pd.read_excel("ODM_INVERTORY_20250813180820 1.xlsx", engine="openpyxl")
mapping_df = pd.read_excel("SFG_SBB_Mapping.xlsx", engine="openpyxl")
order_df = pd.read_excel("SBB_订单用量汇总.xlsx", engine="openpyxl")

# Filter inventory for Material Type == 'SFG'
sfg_inventory = inventory_df[inventory_df['Material Type'] == 'SFG']

# Map ODM PN to SBB using SMT Planner
sfg_inventory = sfg_inventory.merge(mapping_df[['SMT Planner', 'SBB']], left_on='ODM PN', right_on='SMT Planner', how='left')

# Drop rows without SBB mapping
sfg_inventory = sfg_inventory.dropna(subset=['SBB'])

# Group by SBB and sum ODM QTY
sbb_odm_qty = sfg_inventory.groupby('SBB')['ODM QTY'].sum().to_dict()

# Create a copy of the order dataframe to update
updated_order_df = order_df.copy()

# Apply deduction logic
for sbb, total_odm_qty in sbb_odm_qty.items():
    # Get indices of rows with matching SBB
    matching_indices = updated_order_df[updated_order_df['SBB'] == sbb].index

    for idx in matching_indices:
        current_qty = updated_order_df.at[idx, '订单用量']
        if total_odm_qty >= current_qty:
            updated_order_df.at[idx, '订单用量'] = 0
            total_odm_qty -= current_qty
        else:
            updated_order_df.at[idx, '订单用量'] = current_qty - total_odm_qty
            total_odm_qty = 0
            break  # Stop deduction if no more ODM QTY left

# Save the updated file
updated_order_df.to_excel("SBB_订单用量汇总_update.xlsx", index=False)

print("Updated file 'SBB_订单用量汇总_update.xlsx' has been created successfully.")

