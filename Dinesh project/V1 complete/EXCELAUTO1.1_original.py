import os
import zipfile
import pandas as pd
import tkinter as tk
from tkinter import filedialog
from datetime import datetime, timedelta

# Function to select folder using tkinter
def select_folder():
    root = tk.Tk()
    root.withdraw()  # Hide the main window

    folder_path = filedialog.askdirectory(title="Select Folder Containing Files")
    return folder_path

# Get folder path interactively
folder_path = select_folder()

# Ensure a folder path is selected
if not folder_path:
    print("No folder selected. Exiting program.")
    exit()

# Read all files in the selected folder
files = os.listdir(folder_path)

# Traverse all Zip files
for file in files:
    if file.endswith('.zip'):  # Ensure only ZIP files are processed
        file_path = os.path.join(folder_path, file)
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            zip_ref.extractall(folder_path)
            print(f'{file} Unzip Complete.')

# Function to read and handle errors for individual CSV files
def read_csv_file(file_path):
    try:
        data = pd.read_csv(file_path, encoding='utf-16', sep='\t')
    except UnicodeDecodeError:
        print(f"UnicodeDecodeError: Failed to decode {file_path} with 'utf-16' encoding.")
        data = None
    return data

all_data = []

# Iterate through all files in the folder
for file in os.listdir(folder_path):
    if file.endswith('.csv'):  # Ensure only .csv files are processed
        file_path = os.path.join(folder_path, file)
        # Use the read_csv_file function for file reading and error handling
        data = read_csv_file(file_path)
        if data is not None:
            all_data.append(data)

# Combine all data
combined_data = pd.concat(all_data, ignore_index=True)


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

def modify_excel_file(input_filename, output_filename):
    # Load Excel file into pandas DataFrame
    df = combined_data

    # Generate the last week dates
    date_list = generate_date_range()
    last_week_dates = extract_last_week_dates(date_list)

    # Iterate through each column label
    for header in df.columns:
        if header in last_week_dates:
            date_obj = datetime.strptime(header, "%Y/%m/%d")
            new_column_name = f"{date_obj.month:02}/{date_obj.year}"
            new_column_idx = df.columns.get_loc(header) + 1
            df.insert(new_column_idx, new_column_name, '')

            # Sum the columns within each month and store in the new column
            columns_to_sum = [col for col in df.columns if col.startswith(str(date_obj.year)) and col[5:7] == str(date_obj.month).zfill(2)]
            df[new_column_name] = df[columns_to_sum].sum(axis=1)

    # Save the modified DataFrame back to Excel
    df.to_excel(output_filename, index=False)
    print(f'Modified Excel file saved to {output_filename}.')

# Modify the combined_data.xlsx file
input_excel_file = combined_data  # Assuming this is the combined_data.xlsx file
output_excel_file = os.path.join(folder_path, 'modified_combined_data.xlsx')
modify_excel_file(input_excel_file, output_excel_file)
