import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox
from datetime import datetime, timedelta
from pandas.tseries.offsets import MonthEnd
from holidays import China
import numpy as np

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


# Define current_month_end
current_month_end = get_last_day_of_month(datetime.now())

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
update_psd_status(df_psd)

def move_column(df, col_name, target_col_name):
    if col_name in df.columns and target_col_name in df.columns:
        popped_col = df.pop(col_name)
        df.insert(df.columns.get_loc(target_col_name) + 1, col_name, popped_col)
    else:
        print(f"Warning: One or both of '{col_name}' or '{target_col_name}' columns not found.")

# drop function with error handling for column existence
def drop_columns(df, columns_to_drop):
    columns_existing = [col for col in columns_to_drop if col in df.columns]
    df.drop(columns=columns_existing, inplace=True, errors='ignore')

# columns to move to the left
cols_to_move_left = ['Urgent', 'Web order', 'Shortage ODM  P/N', 'MR date', 'Earlier PO', 'Series']
for col in reversed(cols_to_move_left):
    move_column(df_psd, col, df_psd.columns[0])

# move 'SO item' to the right of 'LV SO#'
move_column(df_psd, 'SO item', 'LV SO#')

# columns to move to the right of 'Qty'
cols_to_move_right = ['un-output', 'output', 'un-input', 'input']
for col in cols_to_move_right:
    move_column(df_psd, col, 'Qty')

# columns to drop with error handling
cols_to_drop = ['Order Source', 'Division', '59 PN', 'Cancel(Y/blank)']
drop_columns(df_psd, cols_to_drop)



# Save the file
# Add current date to the filename
current_date = datetime.now().strftime("%Y%m%d")
filename = filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], defaultextension='.xlsx',
                                        initialdir='D:\\', initialfile=f'df_merged_{current_date}.xlsx')
df_psd.to_excel(filename, index=False)

print('df_merged is successfully exported!')