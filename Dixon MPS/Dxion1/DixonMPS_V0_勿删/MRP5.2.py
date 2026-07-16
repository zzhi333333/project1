import pandas as pd

# Load the Excel files
final_bom_df = pd.read_excel("Final_BOM_ODM_Mapping.xlsx", engine="openpyxl")
open_po_df = pd.read_excel("LNV Dixon Open PO 0813.xlsx", sheet_name=0, engine="openpyxl")

# Step 1: Move 'MENGE_times_MFG_PO_Qty' before 'Dixon_inv_Qty'
cols = list(final_bom_df.columns)
if 'MENGE_times_MFG_PO_Qty' in cols and 'Dixon_inv_Qty' in cols:
    menge_index = cols.index('MENGE_times_MFG_PO_Qty')
    dixon_inv_index = cols.index('Dixon_inv_Qty')
    cols.insert(dixon_inv_index, cols.pop(menge_index))
    final_bom_df = final_bom_df[cols]

# Step 2: Clean ' ALT Customer PN' and aggregate 'Total'
open_po_df.columns = open_po_df.columns.str.strip()
open_po_df['ALT Customer PN'] = open_po_df['ALT Customer PN'].str.strip()
po_aggregated = open_po_df.groupby('ALT Customer PN')['Total'].sum().to_dict()

# Step 3: Match CHILD and substitute_1 to substitute_n against ALT Customer PN
def match_total(row):
    for col in row.index:
        if col.startswith('CHILD') or col.startswith('substitute'):
            pn = str(row[col]).strip()
            if pn in po_aggregated:
                return po_aggregated[pn]
    return 0

final_bom_df['Dixon_Open_PO_Qty'] = final_bom_df.apply(match_total, axis=1)

# Step 4: Add BPS and net_dmd_result columns
final_bom_df['BPS'] = final_bom_df['MENGE_times_MFG_PO_Qty'] - final_bom_df['Dixon_inv_Qty']
final_bom_df['net_dmd_result'] = final_bom_df['BPS'] - final_bom_df['Dixon_Open_PO_Qty']

# Save the modified DataFrame to a new Excel file
final_bom_df.to_excel("Net_dmd_BPS_result.xlsx", index=False)

print("Mapping and calculations completed. Output saved to 'Net_dmd_BPS_result.xlsx'.")

