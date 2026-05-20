import pandas as pd
import dask.dataframe as dd
import numpy as np
import tkinter as tk
from tkinter import filedialog, messagebox
from datetime import datetime, timedelta
from pandas.tseries.offsets import MonthEnd
from holidays import China
from concurrent.futures import ThreadPoolExecutor

# Initialize Tkinter
root = tk.Tk()
root.withdraw()

# File selection function
def select_file(title):
    messagebox.showinfo("Notice", title)
    return filedialog.askopenfilename()

# Select files
LNB_PSD = select_file("Please select LNB_PSD.xlsx file!")
LNB_POR = select_file("Please select POR.xlsx file!")

# Load data with specified columns and types
usecols_psd = ['MTM', 'GEO', 'Sub GEO']
dtypes_psd = {'MTM': 'category', 'GEO': 'category', 'Sub GEO': 'category'}
df_psd = pd.read_excel(LNB_PSD, sheet_name='PSD', usecols=usecols_psd, dtype=dtypes_psd, keep_default_na=False)

usecols_por = ['PN', 'Battery', 'Camera', 'Hard_Drive', 'SSD', 'Display_Type', 'VGA', 'EMMC', 'Wireless_LAN', 'Wireless_Wan', 'Language', 'Real Qualification Date', '2nd pen', 'Other2', 'Processor_AMD', 'Processor_CP']
df_por = pd.read_excel(LNB_POR, engine='pyxlsb', usecols=usecols_por)

# Rename and modify columns in df_psd
df_psd.rename(columns={'MTM': 'PN'}, inplace=True)
df_psd['GEO'] = df_psd['GEO'].cat.set_categories(['LAS', 'NA'])  # Predefined categories for memory efficiency
df_psd.loc[df_psd['Sub GEO'] == 'NA', 'GEO'] = 'NA'

# Merge dataframes
df_merged = pd.merge(df_psd, df_por, how='left', on='PN', sort=False)

# Convert date columns to datetime format
date_columns = ['Order Date', 'RSD', 'FG Ready Day', 'Ship date']
df_merged[date_columns] = df_merged[date_columns].apply(pd.to_datetime, errors='coerce')

# Convert large DataFrame to Dask DataFrame for parallel processing
ddf = dd.from_pandas(df_merged, npartitions=4)

# Get Chinese holidays for all years in the dataset
years = range(int(ddf['Order Date'].min().compute().year), int(ddf['Order Date'].max().compute().year) + 1)
holidays = list(China(years=list(years)).keys())

# Function to get the last day of the month
def get_last_day_of_month(date):
    return date + MonthEnd(0)

# Function to calculate the next workday after a given number of days, considering holidays
def get_workday_after(date, days, holidays):
    current_date = date
    while days > 0:
        current_date += timedelta(days=1)
        if current_date.weekday() < 5 and current_date not in holidays:
            days -= 1
    return current_date

# Function to update 'PSD status' based on conditions
def update_psd_status(row):
    if row['PSD status']:
        return row['PSD status']

    conditions_statuses = [
        (row['Level 1 Code'] == 'shipped', 'shipped'),
        (row['RSD'] > get_last_day_of_month(datetime.now().replace(day=1) - timedelta(days=1)), 'Future'),
        (pd.notnull(row['Hold Code']), 'Hold PO'),
        (row['Level 1 Code'] == 'NPI', 'NPI'),
        (str(row['LV SO#'])[:3] == '413', 'BA'),
        ((row['Order Date'] + timedelta(days=2)) <= get_workday_after(row['Order Date'], 2, holidays), 'New PO'),
        ('Self' in row['Level 1 Code'] or 'Tie' in row['Level 1 Code'], 'Self&Tie'),
        (row['Ship date'] <= get_last_day_of_month(row['Ship date']) or pd.isna(row['Ship date']), 'ROL'),
        (True, 'ONS')
    ]

    for condition, status in conditions_statuses:
        if condition:
            return status

# Parallelize the update_psd_status function using Dask
ddf['PSD status'] = ddf.apply(update_psd_status, axis=1, meta=('PSD status', 'O'))

# Compute the result and convert back to a Pandas DataFrame
df_merged = ddf.compute()

# Save the file
save_title = "Please save as"
filename = filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], defaultextension='.xlsx', initialdir='D:\\')
df_merged.to_excel(filename, index=False)

print('PSD_with_POR is successfully exported!')
messagebox.showinfo('Notice', 'PSD_with_POR is successfully exported!')