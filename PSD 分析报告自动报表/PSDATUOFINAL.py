import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox
from datetime import datetime, timedelta
from pandas.tseries.offsets import MonthEnd
from holidays import China
import numpy as np
from openpyxl import load_workbook
import win32com.client as win32
import os
import time
import calendar

# Initialize Tkinter
root = tk.Tk()
root.withdraw()

# File selection function
def select_file(title):
    messagebox.showinfo("Notice", title)
    return filedialog.askopenfilename()

# Select PSD file
LNB_PSD = select_file("Please select LNB_PSD.xlsx file!")

# Load PSD data
df_psd = pd.read_excel(LNB_PSD, sheet_name='PSD')
df_psd.fillna({'Series': 'Option', 'GEO': 'NA', 'Sub GEO': 'NA'}, inplace=True)

# Rename and modify columns in df_psd
df_psd.rename(columns={'MTM': 'PN'}, inplace=True)
df_psd['GEO'] = df_psd['GEO'].replace({'AG': 'LAS'})
df_psd.loc[df_psd['Sub GEO'] == 'NA', 'GEO'] = 'NA'

# Convert date columns to datetime format
date_columns = ['Order Date', 'RSD', 'FG Ready Day', 'Ship date']
for col in date_columns:
    df_psd[col] = pd.to_datetime(df_psd[col], errors='coerce')

# Convert Hold Code to string (ensuring no floating point)
df_psd['Hold Code'] = df_psd['Hold Code'].fillna('').astype(str).str.replace('.0', '', regex=False)

# Function to get the last day of the month
def get_last_day_of_month(date):
    return date + MonthEnd(0)

# Get Chinese holidays for all years in the dataset
years = range(int(df_psd['Order Date'].dt.year.min()), int(df_psd['Order Date'].dt.year.max()) + 1)
holidays = China(years=list(years))

# Define current_month_end
current_month_end = get_last_day_of_month(datetime.now())

# Precompute workdays for PSD data
start_date_psd = df_psd['Order Date'].min()
end_date_psd = df_psd['Order Date'].max() + timedelta(days=10)
workdays_psd = pd.date_range(start=start_date_psd, end=end_date_psd, freq='B')
workdays_psd = workdays_psd.difference(pd.to_datetime(list(holidays)))

# Function to calculate the next workday after a given number of days, considering holidays
def get_workday_after(date, days, workdays):
    if pd.isna(date):
        return date
    workdays_after = workdays[workdays > date]
    if len(workdays_after) < days:
        return workdays_after[-1]
    return workdays_after[days - 1]

# Select POR file
LNB_POR = select_file("Please select POR.xlsb file!")

# Load POR data
df_por = pd.read_excel(LNB_POR, engine='pyxlsb')

# Merge PSD and POR dataframes
df_merged = pd.merge(df_psd, df_por[['PN', 'Battery', 'Camera', 'Hard_Drive', 'SSD', 'Display_Type', 'VGA',
                                     'EMMC', 'Wireless_LAN', 'Wireless_Wan', 'Language', 'Real Qualification Date',
                                     '2nd pen', 'Other2', 'Processor_AMD', 'Processor_CP']], how='left', on='PN',
                      sort=False)

# Function to update 'PSD status' field for PSD data
def update_psd_status(df):
    # Initialize with default status
    df['PSD status'] = 'ONS'

    # Ensure there are no NaN values in the columns used for masking
    df['Level 1 Code'] = df['Level 1 Code'].fillna('')
    df['Order classification'] = df['Order classification'].fillna('')
    df['Ship date'] = df['Ship date'].fillna(pd.Timestamp.max)
    df['RSD'] = df['RSD'].fillna(pd.Timestamp.max)

    # Apply conditions to update 'PSD status'
    conditions = [
        df['Hold Code'] == '999',
        df['Hold Code'].isin(['995', '997', '998']),
        df['Hold Code'].str.contains('E30', na=False),
        df['Level 1 Code'] == 'Shipped',
        df['RSD'] > current_month_end,
        df['Level 1 Code'] == 'NPI',
        df['Order classification'] == 'Pre build',
        df['Level 1 Code'].str.contains('NEW|New', na=False),
        df['Level 1 Code'].str.contains('Self|Tie', na=False),
        df['Ship date'] <= current_month_end
    ]
    choices = [
        'Hold shipt', 'Hold input', 'Early Order', 'Shipped', 'Future', 
        'NPI', 'BA', 'New PO', 'Self&Tie', 'ROL'
    ]

    df['PSD status'] = np.select(conditions, choices, default='ONS')

# Call the function
update_psd_status(df_merged)

# Move columns function with error handling for column existence
def move_column(df, col_name, target_col_name):
    if col_name in df.columns and target_col_name in df.columns:
        popped_col = df.pop(col_name)
        df.insert(df.columns.get_loc(target_col_name) + 1, col_name, popped_col)
    else:
        print(f"Warning: One or both of '{col_name}' or '{target_col_name}' columns not found.")

# Drop columns function with error handling for column existence
def drop_columns(df, columns_to_drop):
    columns_existing = [col for col in columns_to_drop if col in df.columns]
    df.drop(columns=columns_existing, inplace=True, errors='ignore')

# Columns to move to the left
cols_to_move_left = ['Urgent', 'Web order', 'Shortage ODM  P/N', 'MR date', 'Earlier PO', 'Series']
for col in reversed(cols_to_move_left):
    move_column(df_merged, col, df_merged.columns[0])

# Move 'SO item' to the right of 'LV SO#'
move_column(df_merged, 'SO item', 'LV SO#')

# Columns to move to the right of 'Qty'
cols_to_move_right = ['un-output', 'output', 'un-input', 'input']
for col in cols_to_move_right:
    move_column(df_merged, col, 'Qty')

# Columns to drop with error handling
cols_to_drop = ['Order Source', 'Division', '59 PN', 'Cancel(Y/blank)']
drop_columns(df_merged, cols_to_drop)

# Insert new column "MR Status"
df_merged['MR Status'] = None

# Get current date and this month's end
now = datetime.now()
end_of_month = datetime(now.year, now.month, calendar.monthrange(now.year, now.month)[1])
start_of_late_mr = end_of_month - timedelta(days=5)

# Function to fill "MR Status" column
def fill_mr_status(row):
    if row['Level 1 Code'] == 'Shipped':
        return 'Shipped'
    if pd.isna(row['MR date']) or row['MR date'] == 'TBD':
        return 'MR Date Blank'
    mr_date = pd.to_datetime(row['MR date'], errors='coerce')
    if pd.isna(mr_date):
        return 'MR Date Blank'
    if start_of_late_mr <= mr_date <= end_of_month:
        return f'MR_{mr_date.strftime("%m%d")}'
    if mr_date <= now:
        return 'MR by today'
    if now < mr_date <= (now + timedelta(days=(6 - now.weekday()))):
        return 'WK01'
    week_num = 1
    while (now + timedelta(days=(6 - now.weekday()) + 7 * week_num)) < start_of_late_mr:
        if (now + timedelta(days=(6 - now.weekday()) + 7 * (week_num - 1))) < mr_date <= (now + timedelta(days=(6 - now.weekday()) + 7 * week_num)):
            return f'WK{str(week_num).zfill(2)}'
        week_num += 1
    if mr_date > end_of_month:
        return f'MR_{mr_date.strftime("%m")}'
    return None
  

# Fill "MR Status" column
df_merged['MR Status'] = df_merged.apply(fill_mr_status, axis=1)

# Add current date to the filename
current_date = datetime.now().strftime("%Y%m%d")
filename = filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], defaultextension='.xlsx',
                                        initialdir='D:\\', initialfile=f'df_merged_{current_date}.xlsx')

# Close possible opened Excel instances before saving
def close_excel_by_filename(filename):
    try:
        excel = win32.GetObject(Class="Excel.Application")
        for workbook in excel.Workbooks:
            if os.path.abspath(workbook.FullName) == os.path.abspath(filename):
                workbook.Close(SaveChanges=False)
        excel.Quit()
    except:
        pass  # If no opened Excel instances, just pass

# Save the filled Excel file
def save_excel_file(df, file_name, max_attempts=5, delay=2):
    for attempt in range(max_attempts):
        try:
            close_excel_by_filename(file_name)
            df.to_excel(file_name, index=False)
            print(f"Excel file saved successfully: {file_name}")
            return
        except PermissionError:
            if attempt < max_attempts - 1:
                print(f"Unable to save file, retrying in {delay} seconds...")
                time.sleep(delay)
            else:
                print(f"Failed to save file after {max_attempts} attempts.")
                raise

# Use the save function
save_excel_file(df_merged, filename)

# Open Excel application
excel = win32.gencache.EnsureDispatch('Excel.Application')
excel.Visible = False  # Run in background

# Open workbook
wb = excel.Workbooks.Open(filename)

# Get data range
ws_data = wb.Sheets[1]
last_row = ws_data.Cells(ws_data.Rows.Count, 1).End(win32.constants.xlUp).Row
last_col = ws_data.Cells(1, ws_data.Columns.Count).End(win32.constants.xlToLeft).Column
data_range = ws_data.Range(ws_data.Cells(1, 1), ws_data.Cells(last_row, last_col))

# Ensure data range has at least two rows
if last_row < 2:
    raise ValueError("Data range must have at least two rows.")

# Add new worksheet for pivot tables
ws_pv = wb.Sheets.Add()
ws_pv.Name = 'PV'

# Function to create pivot table
def create_pivot_table(workbook, sheet_name, start_row, filter_area=None, filter_value=None, rows_area=None, cols_area=None, values_area=None):
    sheet = workbook.Sheets(sheet_name)
    try:
        pivot_cache = workbook.PivotCaches().Create(SourceType=win32.constants.xlDatabase, SourceData=data_range)
    except Exception as e:
        print(f"Error creating pivot cache: {e}")
        return start_row + 20

    # Check if pivot table already exists, if so, delete it
    for pt in sheet.PivotTables():
        if pt.TableRange2.Row == start_row:
            pt.TableRange2.Clear()
            break

    table_destination = sheet.Cells(start_row, 1)
    try:
        pivot_table = pivot_cache.CreatePivotTable(
            TableDestination=table_destination,
            TableName=f"PivotTable{start_row}"
        )
    except Exception as e:
        print(f"Error creating pivot table: {e}")
        return start_row + 20

    try:
        if filter_area and filter_area in [field.Name for field in pivot_table.PivotFields()]:
            pf = pivot_table.PivotFields(filter_area)
            pf.Orientation = win32.constants.xlPageField
            if filter_value is not None:
                try:
                    if isinstance(filter_value, list):
                        for item in pf.PivotItems():
                            item.Visible = item.Name in filter_value
                    elif filter_value == 'ALL_EXCEPT_FUTURE':
                        for item in pf.PivotItems():
                            item.Visible = item.Name != "Future"
                    else:
                        pf.CurrentPage = filter_value
                except Exception as e:
                    print(f"Error setting filter value '{filter_value}' for '{filter_area}': {e}")
        
        if rows_area:
            if isinstance(rows_area, list):
                for i, field in enumerate(rows_area):
                    if field in [f.Name for f in pivot_table.PivotFields()]:
                        pivot_table.PivotFields(field).Orientation = win32.constants.xlRowField
                        pivot_table.PivotFields(field).Position = i + 1
            elif rows_area in [field.Name for field in pivot_table.PivotFields()]:
                pivot_table.PivotFields(rows_area).Orientation = win32.constants.xlRowField
        
        if cols_area and cols_area in [field.Name for field in pivot_table.PivotFields()]:
            pivot_table.PivotFields(cols_area).Orientation = win32.constants.xlColumnField
        
        if values_area and values_area in [field.Name for field in pivot_table.PivotFields()]:
            value_field = pivot_table.AddDataField(pivot_table.PivotFields(values_area))
            value_field.Function = win32.constants.xlSum
    
        # Set pivot table style
        pivot_table.TableStyle2 = "PivotStyleLight16"
    
        # Auto adjust column width
        sheet.Columns.AutoFit()
    except Exception as e:
        print(f"Error configuring pivot table: {e}")
        print("Continuing with partial configuration...")

    try:
        last_row = pivot_table.TableRange2.Row + pivot_table.TableRange2.Rows.Count
    except:
        last_row = start_row + 20  # Default value if actual size cannot be obtained

    return last_row + 20  # Leave 20 rows space after pivot table

# Generate pivot tables
start_row = 1
pivot_tables_config = [
    ("GEO", None, "Series", "PSD status", "Qty"),
    ("PSD status", "ONS", ["Series", "Late Reason Detail"], "GEO", "Qty"),
    ("PSD status", "ALL_EXCEPT_FUTURE", "Series", "MR Status", "Qty"),
    ("PSD status", "Future", "Series", "MR Status", "Qty")
]

for i, (filter_area, filter_value, rows_area, cols_area, values_area) in enumerate(pivot_tables_config, 1):
    try:
        print(f"\nCreating pivot table {i} with parameters:")
        print(f"  filter_area: {filter_area}")
        print(f"  filter_value: {filter_value}")
        print(f"  rows_area: {rows_area}")
        print(f"  cols_area: {cols_area}")
        print(f"  values_area: {values_area}")
        
        end_row = create_pivot_table(wb, "PV", start_row, filter_area, filter_value, rows_area, cols_area, values_area)
        print(f"Pivot table {i} created at row {start_row}")
        start_row = end_row
    except Exception as e:
        print(f"Error creating pivot table {i}: {e}")
        start_row += 50  # If creation fails, still move to next position

# Save and close workbook
try:
    wb.Save()
    wb.Close()
    excel.Quit()
except Exception as e:
    print(f"Error saving and closing workbook: {e}")

# Ensure all Excel instances are closed
def close_all_excel_instances():
    try:
        excel = win32.GetObject(Class="Excel.Application")
        excel.Quit()
    except:
        pass

# Call at the end of the main program
if __name__ == "__main__":
    try:
        # Your main code logic here
        pass
    finally:
        close_all_excel_instances()
