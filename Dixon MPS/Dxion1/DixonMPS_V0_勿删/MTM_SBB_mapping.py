import openpyxl
import pandas as pd

# Load the workbook
input_file = "D:\Python projects\Dixon MPS\Multi Product Raw Bill of Materials Export 2025-08-15 075516.xlsx"
wb = openpyxl.load_workbook(input_file, data_only=True)

# Define the target columns
target_columns = ['SBB', 'Qty', 'SBB Name', 'Basic Name']

# Initialize a list to collect all data
all_data = []

# Process each sheet
for sheet_name in wb.sheetnames:
    sheet = wb[sheet_name]
    
    # Get MTM value from cell C6
    mtm_value = sheet['C6'].value
    
    # Read header from row 7 (Excel row 7, index 6)
    header = [cell.value.strip() if isinstance(cell.value, str) else cell.value for cell in sheet[7]]
    
    # Map column indices for target columns
    col_indices = {}
    for idx, col_name in enumerate(header):
        if col_name and col_name.strip() in target_columns:
            col_indices[col_name.strip()] = idx

    # Skip sheet if not all target columns are found
    if len(col_indices) < len(target_columns):
        continue

    # Read data from row 8 onwards
    for row in sheet.iter_rows(min_row=8, values_only=True):
        row_data = {'MTM': mtm_value}
        for col in target_columns:
            index = col_indices.get(col)
            row_data[col] = row[index] if index is not None and index < len(row) else None
        all_data.append(row_data)

# Convert to DataFrame
df = pd.DataFrame(all_data)

# Drop rows where all of the specified columns are empty
df_cleaned = df.dropna(subset=target_columns, how='all')

# Save the cleaned DataFrame to a new Excel file
output_file = "MTM_SBB_mapping.xlsx"
df_cleaned.to_excel(output_file, index=False)

# Show the first few rows of the cleaned data
print(df_cleaned.head())

