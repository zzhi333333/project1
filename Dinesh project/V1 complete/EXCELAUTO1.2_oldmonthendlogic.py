import os
import zipfile
import pandas as pd
import tkinter as tk
from tkinter import filedialog
from datetime import datetime, timedelta
from openpyxl import load_workbook
from openpyxl.styles import PatternFill

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
def generate_date_range(start_date, end_date):
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
                last_week_dates.append(last_monday.strftime("%Y/%m/%d"))
            current_month = date_obj.month
        last_monday = date_obj

    # Add the last Monday of the last month
    if last_monday is not None:
        last_week_dates.append(last_monday.strftime("%Y/%m/%d"))

    return last_week_dates

# Function to modify the combined DataFrame and save it to Excel
def modify_excel_file(df, output_filename):
    # Generate the last week dates
    start_date = datetime(2024, 6, 1)  # Starting from June 1, 2024
    end_date = datetime(2035, 12, 31)  # Ending on December 31, 2035
    date_list = generate_date_range(start_date, end_date)
    last_week_dates = extract_last_week_dates(date_list)

    # List to store columns that will be highlighted
    columns_to_highlight = []

    # Iterate through each column label and modify the DataFrame
    for header in df.columns:
        if header in last_week_dates:
            date_obj = datetime.strptime(header, "%Y/%m/%d")
            new_column_name = f"{date_obj.month:02}/{date_obj.year}"
            new_column_idx = df.columns.get_loc(header) + 1
            df.insert(new_column_idx, new_column_name, '')

            # Sum the columns within each month and store in the new column
            columns_to_sum = [col for col in df.columns if col.startswith(str(date_obj.year)) and col[5:7] == str(date_obj.month).zfill(2)]
            df[new_column_name] = df[columns_to_sum].sum(axis=1)

            # Add the new column name to the list of columns to highlight
            columns_to_highlight.append(new_column_name)

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

# Main script
if __name__ == "__main__":
    folder_path = select_folder()

    if not folder_path:
        print("No folder selected. Exiting program.")
        exit()

    # Read and unzip all files in the selected folder
    files = os.listdir(folder_path)
    for file in files:
        if file.endswith('.zip'):  # Ensure only ZIP files are processed
            file_path = os.path.join(folder_path, file)
            with zipfile.ZipFile(file_path, 'r') as zip_ref:
                zip_ref.extractall(folder_path)
                print(f'{file} Unzip Complete.')

    all_data = []

    # Iterate through all files in the folder and read CSV files
    for file in os.listdir(folder_path):
        if file.endswith('.csv'):  # Ensure only .csv files are processed
            file_path = os.path.join(folder_path, file)
            data = read_csv_file(file_path)
            if data is not None:
                all_data.append(data)

    # Combine all data
    combined_data = pd.concat(all_data, ignore_index=True)

    # Modify the combined_data DataFrame and save to Excel
    output_excel_file = os.path.join(folder_path, 'modified_combined_data.xlsx')
    modify_excel_file(combined_data, output_excel_file)