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

    
    df['PSD status'] = 'ONS'  # Initialize with default status

    # Create a mask to track the changes
    status_mask = df['PSD status'] == 'ONS'

    early_order_mask = (status_mask) & (df['Hold Code'].astype(str).str.contains('E30')) & (df['PSD status'] == 'ONS')
    df.loc[early_order_mask, 'PSD status'] = 'Early Order'
    status_mask &= ~early_order_mask

    df.loc[df['Level 1 Code'] == 'Shipped', 'PSD status'] = 'Shipped'
    status_mask &= df['PSD status'] == 'ONS'

    future_mask = (status_mask) & (df['RSD'] > current_month_end)
    df.loc[future_mask, 'PSD status'] = 'Future'
    status_mask &= ~future_mask

    hold_mask_999 = (status_mask) & (df['Hold Code'].astype(str) == '999') & (df['PSD status'] == 'ONS')
    df.loc[hold_mask_999, 'PSD status'] = 'Hold shipt'
    status_mask &= ~hold_mask_999

    hold_mask_995_997_998 = (status_mask) & (df['Hold Code'].astype(str).isin(['995', '997', '998'])) & (df['PSD status'] == 'ONS')
    df.loc[hold_mask_995_997_998, 'PSD status'] = 'Hold input'
    status_mask &= ~hold_mask_995_997_998

    # Add this line to ensure the conditions are not affected by subsequent ones
    status_mask &= df['PSD status'] == 'ONS'

    npi_mask = (status_mask) & (df['Level 1 Code'] == 'NPI')
    df.loc[npi_mask, 'PSD status'] = 'NPI'
    status_mask &= ~npi_mask

    ba_mask = (status_mask) & (df['LV SO#'].str.startswith('413'))
    df.loc[ba_mask, 'PSD status'] = 'BA'
    status_mask &= ~ba_mask

    new_po_mask = (status_mask) & (df['Level 1 Code'].str.contains('NEW|New', regex=True))
    df.loc[new_po_mask, 'PSD status'] = 'New PO'
    status_mask &= ~new_po_mask

    self_tie_mask = (status_mask) & (df['Level 1 Code'].str.contains('Self|Tie', regex=True))
    df.loc[self_tie_mask, 'PSD status'] = 'Self&Tie'
    status_mask &= ~self_tie_mask

    rol_mask = (status_mask) & (df['Ship date'] <= current_month_end)
    df.loc[rol_mask, 'PSD status'] = 'ROL'
    status_mask &= ~rol_mask

    df.loc[status_mask, 'PSD status'] = 'ONS'
    

# Call the function
update_psd_status(df_merged)




# Save the file
save_title = "Please save as"
filename = filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], defaultextension='.xlsx',
                                        initialdir='D:\\')
df_merged.to_excel(filename, index=False)  #保存为df_merged filename

print('df_merged is successfully exported!')

