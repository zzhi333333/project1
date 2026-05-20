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
# Function to update 'PSD status' field for PSD data
def update_psd_status(df):
    df['PSD status'] = 'ONS'  # Initialize with default status

    # Ensure there are no NaN values in the columns used for masking
    df['Level 1 Code'] = df['Level 1 Code'].fillna('')
    df['Order classification'] = df['Order classification'].fillna('')
    df['Ship date'] = df['Ship date'].fillna(pd.Timestamp.max)
    df['RSD'] = df['RSD'].fillna(pd.Timestamp.max)

    # Iterate over rows to update 'PSD status'
    for index, row in df.iterrows():
        if row['Hold Code'] == '999':
            df.at[index, 'PSD status'] = 'Hold shipt'
        elif row['Hold Code'] in ['995', '997', '998']:
            df.at[index, 'PSD status'] = 'Hold input'
        elif 'E30' in row['Hold Code']:
            df.at[index, 'PSD status'] = 'Early Order'
        elif row['Level 1 Code'] == 'Shipped':
            df.at[index, 'PSD status'] = 'Shipped'
        elif row['RSD'] > current_month_end:
            df.at[index, 'PSD status'] = 'Future'
        elif row['Level 1 Code'] == 'NPI':
            df.at[index, 'PSD status'] = 'NPI'
        elif row['Order classification'] == 'Pre build':
            df.at[index, 'PSD status'] = 'BA'
        elif 'NEW' in row['Level 1 Code'] or 'New' in row['Level 1 Code']:
            df.at[index, 'PSD status'] = 'New PO'
        elif 'Self' in row['Level 1 Code'] or 'Tie' in row['Level 1 Code']:
            df.at[index, 'PSD status'] = 'Self&Tie'
        elif row['Ship date'] <= current_month_end:
            df.at[index, 'PSD status'] = 'ROL'

# Call the function
update_psd_status(df_merged)



# Save the file
# Add current date to the filename
current_date = datetime.now().strftime("%Y%m%d")
filename = filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], defaultextension='.xlsx',
                                        initialdir='D:\\', initialfile=f'df_merged_{current_date}.xlsx')
df_merged.to_excel(filename, index=False)


print('df_merged is successfully exported!')

