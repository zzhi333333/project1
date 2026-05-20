import os
import zipfile
import pandas as pd
import tkinter as tk
from tkinter import filedialog
from datetime import datetime, timedelta
from openpyxl import load_workbook
from openpyxl.styles import PatternFill
import win32com.client as win32
from dateutil.relativedelta import relativedelta

# Function to select folder using tkinter
def select_folder():
    root = tk.Tk()
    root.withdraw()  # Hide the main window
    folder_path = filedialog.askdirectory(title="Select Folder Containing Files")
    return folder_path

# Function to read and handle errors for individual CSV files
def read_csv_file(file_path):
    try:
        data = pd.read_csv(file_path, encoding='utf-16', sep='\t')
        return data
    except UnicodeDecodeError:
        print(f"UnicodeDecodeError: Failed to decode {file_path} with 'utf-16' encoding.")
        return None

# Function to generate a list of Mondays within a date range
def generate_date_range():
    start_date = datetime(2024, 6, 1)  # Starting from June 2024, 1st day
    end_date = datetime(2035, 12, 31)  # Ending on December 2035, last day

    current_date = start_date
    date_list = []

    while current_date <= end_date:
        if current_date.isoweekday() == 1:  # Check if it's a Monday
            date_list.append(current_date.strftime("%Y/%m/%d"))
        current_date += timedelta(days=1)

    return date_list

# Function to extract the last Monday of each month from a date list
def extract_last_week_dates(date_list):
    last_week_dates = []
    current_month = None
    last_monday = None

    for date_str in date_list:
        date_obj = datetime.strptime(date_str, "%Y/%m/%d")
        if current_month is None or date_obj.month != current_month:
            if last_monday is not None:
                # Check if the Thursday of the last Monday's week belongs to the same month
                thursday_of_week = last_monday + timedelta(days=3)
                if thursday_of_week.month != last_monday.month:
                    last_monday = last_monday - timedelta(days=7)
                last_week_dates.append(last_monday.strftime("%Y/%m/%d"))

            current_month = date_obj.month

        last_monday = date_obj

    # Add the last Monday of the last month
    if last_monday is not None:
        thursday_of_week = last_monday + timedelta(days=3)
        if thursday_of_week.month != last_monday.month:
            last_monday = last_monday - timedelta(days=7)
        last_week_dates.append(last_monday.strftime("%Y/%m/%d"))

    return last_week_dates

# Function to modify the combined DataFrame and save it to Excel
def modify_excel_file(df, output_filename):
    # Generate the last week dates
    date_list = generate_date_range()
    last_week_dates = extract_last_week_dates(date_list)

    # List to store columns that will be highlighted
    columns_to_highlight = []

    # Dictionary to keep track of columns by month and year
    monthly_columns = {}

    # Iterate through each column label and categorize the columns
    for header in df.columns:
        try:
            date_obj = datetime.strptime(header, "%Y/%m/%d")
            month_year = f"{date_obj.month:02}/{date_obj.year}"

            # Initialize monthly columns list if not already
            if month_year not in monthly_columns:
                monthly_columns[month_year] = []

            # Check if the Thursday of the date belongs to the same month
            thursday_of_week = date_obj + timedelta(days=3)
            if thursday_of_week.month != date_obj.month:
                next_month_year = f"{thursday_of_week.month:02}/{thursday_of_week.year}"
                if next_month_year not in monthly_columns:
                    monthly_columns[next_month_year] = []
                monthly_columns[next_month_year].append(header)
            else:
                monthly_columns[month_year].append(header)
        except ValueError:
            # If the column header is not a date, skip it
            continue

    # Iterate over the monthly columns to calculate the sum
    for month_year, columns in monthly_columns.items():
        if columns:
            # Insert the sum column after the last week date of the month
            insert_pos = df.columns.get_loc(columns[-1]) + 1
            df.insert(insert_pos, month_year, df[columns].sum(axis=1))

            # Add to the list of columns to highlight
            columns_to_highlight.append(month_year)

    # Save the modified DataFrame to Excel without formatting
    df.to_excel(output_filename, index=False)

    # Open the saved Excel file with openpyxl
    wb = load_workbook(output_filename)
    ws = wb.active

    # Define a yellow fill for highlighting
    yellow_fill = PatternFill(start_color="FFFF00", end_color="FFFF00", fill_type="solid")

    # Apply the yellow fill to the appropriate columns
    for col in ws.iter_cols(min_col=1, max_col=ws.max_column, min_row=1, max_row=ws.max_row):
        if col[0].value in columns_to_highlight:
            for cell in col:
                cell.fill = yellow_fill

    # Save the formatted Excel file
    wb.save(output_filename)
    print(f'Modified Excel file saved to {output_filename}.')
    print("Monthly Columns:")
    for month_year, columns in monthly_columns.items():
        print(f"{month_year}: {columns}")

# Function to generate the next 6 non-empty months
from dateutil.relativedelta import relativedelta

def generate_next_6_months(df):
    today = datetime.today()
    last_month = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    
    next_months = []
    current_month = last_month
    max_iterations = 24  # safe checking for deadlock
    
    while len(next_months) < 6 and max_iterations > 0:
        month_str = current_month.strftime('%m/%Y')
        if month_str in df.columns and not df[month_str].empty:
            next_months.append(month_str)
        current_month += relativedelta(months=1)
        max_iterations -= 1
    
    if len(next_months) < 6:
        print(f"Warning:only find {len(next_months)} non-empty months, please check your data.")
    
    return next_months

# Function to create pivot table
def create_pivot_table(workbook, sheet_name, start_row, measure_filter, bu_value, brand_filter, brand_exclude=False):
    sheet = workbook.Sheets(sheet_name)
    # Create pivot cache and table
    pivot_cache = workbook.PivotCaches().Create(SourceType=1, SourceData=source_range)
    
    # Leave space for filters (4 rows for filters, 1 empty row)
    pivot_table = pivot_cache.CreatePivotTable(TableDestination=sheet.Cells(start_row + 5, 1), TableName=f'PivotTable_{measure_filter}')

    # Set rows for pivot table
    pivot_table.PivotFields('Family').Orientation = 1  # 1 represents xlRowField
    pivot_table.PivotFields('Channel').Orientation = 1  # 1 represents xlRowField

    # Set classic PivotTable layout
    pivot_table.RowAxisLayout(1)  # 1 represents xlTabularRow

    # Disable subtotals for both Family and Channel
    pivot_table.PivotFields('Family').Subtotals = [False] * 12
    pivot_table.PivotFields('Channel').Subtotals = [False] * 12

    # Enable grand totals for both rows and columns
    pivot_table.ColumnGrand = True
    pivot_table.RowGrand = True

    # Repeat item labels for Family
    pivot_table.PivotFields('Family').RepeatLabels = True

    # Add data fields
    for col in next_6_months_columns:
        try:
            pivot_field = pivot_table.PivotFields(col)
            data_field = pivot_table.AddDataField(pivot_field, f"Sum of {col}", -4157)  # -4157 represents xlSum
            data_field.NumberFormat = "#,##0"  # Format as number with thousands separator
            print(f"Successfully added data field: {col}")
        except Exception as e:
            print(f"Error adding data field {col}: {str(e)}")

    # Set filters
    filter_values = {
        'Sbb': 'X',
        'Measure': measure_filter,
        'BU': bu_value
    }

    for filter_field, filter_value in filter_values.items():
        try:
            pivot_field = pivot_table.PivotFields(filter_field)
            pivot_field.Orientation = 3  # 3 represents xlPageField
            pivot_field.CurrentPage = filter_value
            print(f"Successfully set filter for {filter_field}: {filter_value}")
        except Exception as e:
            print(f"Error setting filter for {filter_field}: {str(e)}")

    # Set Brand filter
    try:
        brand_field = pivot_table.PivotFields('Brand')
        brand_field.Orientation = 3  # 3 represents xlPageField
        if brand_exclude:
            brand_field.ClearAllFilters()
            if isinstance(brand_filter, list):
                for item in brand_field.PivotItems():
                    item.Visible = item.Name not in brand_filter
            else:
                for item in brand_field.PivotItems():
                    item.Visible = item.Name != brand_filter
        else:
            brand_field.CurrentPage = brand_filter
        print(f"Successfully set brand filter for {sheet.Name}: {brand_filter}")
    except Exception as e:
        print(f"Error setting brand filter for {sheet.Name}: {str(e)}")

    # Remove the "Values" field from the row area
    for field in pivot_table.RowFields:
        if field.SourceName == "Values":
            field.Orientation = 0  # 0 represents xlHidden

    # Format the pivot table
    pivot_table.TableStyle2 = "PivotStyleLight16"

    # Autofit columns
    sheet.Columns.AutoFit()

    # Return the last row of the pivot table plus space for the next filter area
    return pivot_table.TableRange2.Row + pivot_table.TableRange2.Rows.Count + 7

# Main script
if __name__ == "__main__":
    folder_path = select_folder()

    if not folder_path:
        print("No folder selected. Exiting program.")
        exit()

    # Read and unzip all files in the selected folder
    files = os.listdir(folder_path)
    all_dataframes = []

    for file in files:
        if file.endswith('.zip'):  # Ensure only ZIP files are processed
            file_path = os.path.join(folder_path, file)
            with zipfile.ZipFile(file_path, 'r') as zip_ref:
                zip_ref.extractall(folder_path)
                print(f'{file} Unzipped.')

    # Read all CSV files and concatenate into a single DataFrame
    for file in os.listdir(folder_path):
        if file.endswith('.csv'):
            file_path = os.path.join(folder_path, file)
            df = read_csv_file(file_path)
            if df is not None:
                all_dataframes.append(df)

    # Combine all DataFrames into one
    if all_dataframes:
        combined_df = pd.concat(all_dataframes, ignore_index=True)
        
        # Define output filename
        output_filename = os.path.join(folder_path, 'modified_combined.xlsx')

        # Modify the combined DataFrame and save to Excel
        modify_excel_file(combined_df, output_filename)

        # Process the generated Excel file with pivot tables
        input_file = output_filename

        if not os.path.isfile(input_file):
            print(f"{input_file} does not exist. Exiting program.")
            exit()

        wb = load_workbook(input_file)
        df = pd.read_excel(input_file, sheet_name='Sheet1')

        sheet_names = ['LDT', 'LNB', 'TDT', 'TNB']
        for sheet_name in sheet_names:
            if sheet_name in wb.sheetnames:
                del wb[sheet_name]
            wb.create_sheet(sheet_name)
        wb.save(input_file)

        next_6_months_columns = generate_next_6_months(combined_df)
        print("Selected months:", next_6_months_columns)

        excel = win32.Dispatch('Excel.Application')
        excel.Visible = False
        workbook = excel.Workbooks.Open(input_file)
        df.to_excel("filtered_data.xlsx", index=False, engine='openpyxl')
        source_data = os.path.abspath("filtered_data.xlsx")
        workbook_filtered = excel.Workbooks.Open(source_data)
        sheet_filtered = workbook_filtered.Sheets(1)
        source_range = sheet_filtered.UsedRange

        measure_filters = ['04.Factory Forecast','05.Roll Order','06.Geo Forecast', '07.MFG Order by RSD', '08.To Go Forecast']
        
        for sheet_name in ['TNB', 'TDT', 'LNB', 'LDT']:
            last_row = 1
            for measure_filter in measure_filters:
                if sheet_name == 'TNB':
                    last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, 'TNB', 'THINKPAD')
                elif sheet_name == 'TDT':
                    last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, 'TDT', 'THINKMONITOR', brand_exclude=True)
                elif sheet_name == 'LNB':
                    last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, 'LNB', 'IDEAPAD')
                elif sheet_name == 'LDT':
                    last_row = create_pivot_table(workbook, sheet_name, last_row, measure_filter, 'LDT', ['THINKMONITOR', 'IDEAMONITOR'], brand_exclude=True)

        workbook.Save()
        workbook.Close()
        workbook_filtered.Close()
        os.remove("filtered_data.xlsx")
        excel.Quit()

        print(f'Modified Excel file saved to {input_file}.')
    else:
        print("No valid CSV files found.")