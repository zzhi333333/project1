import os
import pandas as pd
import tkinter as tk
from tkinter import filedialog
from openpyxl import load_workbook
from datetime import datetime, timedelta
import win32com.client as win32

def select_folder():
    root = tk.Tk()
    root.withdraw()
    folder_path = filedialog.askdirectory(title="Select Folder Containing Files")
    return folder_path

def generate_next_6_months():
    today = datetime.today()
    last_month = today.replace(day=1) - timedelta(days=1)
    next_6_months = [(last_month + timedelta(days=30*i)).strftime('%m/%Y') for i in range(6)]
    return next_6_months

def create_pivot_table(workbook, sheet_name, start_row, measure_filter, next_6_months_columns, source_range, bu_value, brand_filters, include_only=False):
    sheet = workbook.Sheets(sheet_name)
    pivot_cache = workbook.PivotCaches().Create(SourceType=1, SourceData=source_range)
    pivot_table = pivot_cache.CreatePivotTable(TableDestination=sheet.Cells(start_row + 5, 1), TableName=f'PivotTable_{measure_filter}_{sheet_name}')

    pivot_table.PivotFields('Family').Orientation = 1
    pivot_table.PivotFields('Channel').Orientation = 1
    pivot_table.RowAxisLayout(1)
    pivot_table.PivotFields('Family').Subtotals = [False] * 12
    pivot_table.PivotFields('Channel').Subtotals = [False] * 12
    pivot_table.ColumnGrand = True
    pivot_table.RowGrand = True
    pivot_table.PivotFields('Family').RepeatLabels = True

    for col in next_6_months_columns:
        try:
            pivot_field = pivot_table.PivotFields(col)
            pivot_table.AddDataField(pivot_field, f"Sum of {col}", -4157)
            print(f"Successfully added data field: {col}")
        except Exception as e:
            print(f"Error adding data field {col}: {str(e)}")

    filter_values = {
        'Sbb': 'X',
        'Measure': measure_filter,
        'BU': bu_value
    }

    for filter_field, filter_value in filter_values.items():
        try:
            pivot_field = pivot_table.PivotFields(filter_field)
            pivot_field.Orientation = 3
            pivot_field.CurrentPage = filter_value
            print(f"Successfully set filter for {filter_field}: {filter_value}")
        except Exception as e:
            print(f"Error setting filter for {filter_field}: {str(e)}")

    try:
        brand_field = pivot_table.PivotFields('Brand')
        brand_field.Orientation = 3
        brand_field.ClearAllFilters()
        if include_only:
            for item in brand_field.PivotItems():
                if item.Name in brand_filters:
                    item.Visible = True
                else:
                    item.Visible = False
        else:
            for item in brand_field.PivotItems():
                if item.Name in brand_filters:
                    item.Visible = False
                else:
                    item.Visible = True
        print(f"Successfully set brand filter for {sheet_name} with exclusions: {brand_filters}")
    except Exception as e:
        print(f"Error setting brand filter for {sheet_name}: {str(e)}")

    pivot_table.TableStyle2 = "PivotStyleLight16"
    sheet.Columns.AutoFit()
    return pivot_table.TableRange2.Row + pivot_table.TableRange2.Rows.Count + 7

def main():
    folder_path = select_folder()

    if not folder_path:
        print("No folder selected. Exiting program.")
        return

    input_file = os.path.join(folder_path, 'modified_combined.xlsx')

    if not os.path.isfile(input_file):
        print(f"{input_file} does not exist. Exiting program.")
        return

    wb = load_workbook(input_file)
    df = pd.read_excel(input_file, sheet_name='Sheet1')

    sheet_names = ['LDT', 'LNB', 'TDT', 'TNB']
    for sheet_name in sheet_names:
        if sheet_name in wb.sheetnames:
            del wb[sheet_name]
        wb.create_sheet(sheet_name)
    wb.save(input_file)

    next_6_months_columns = generate_next_6_months()
    print("Selected months:", next_6_months_columns)

    excel = win32.Dispatch('Excel.Application')
    excel.Visible = False
    workbook = excel.Workbooks.Open(input_file)
    df.to_excel("filtered_data.xlsx", index=False, engine='openpyxl')
    source_data = os.path.abspath("filtered_data.xlsx")
    workbook_filtered = excel.Workbooks.Open(source_data)
    sheet_filtered = workbook_filtered.Sheets(1)
    source_range = sheet_filtered.UsedRange

    measure_filters = ['04.Factory Forecast', '06.Geo Forecast', '07.MFG Order by RSD', '08.To Go Forecast']
    
    for sheet_name in ['TNB', 'TDT', 'LNB', 'LDT']:
        last_row = 1
        for measure_filter in measure_filters:
            if sheet_name == 'TNB':
                last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, next_6_months_columns, source_range, 'TNB', ['THINKPAD'], include_only=True)
            elif sheet_name == 'TDT':
                last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, next_6_months_columns, source_range, 'TDT', ['THINKMONITOR'])
            elif sheet_name == 'LNB':
                last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, next_6_months_columns, source_range, 'LNB', ['IDEAPAD'], include_only=True)
            elif sheet_name == 'LDT':
                last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, next_6_months_columns, source_range, 'LDT', ['THINKMONITOR', 'IDEAMONITOR'])

    workbook.Save()
    workbook.Close()
    workbook_filtered.Close()
    os.remove("filtered_data.xlsx")
    excel.Quit()

    print(f'Modified Excel file saved to {input_file}.')

if __name__ == "__main__":
    main()
