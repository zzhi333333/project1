import pandas as pd
import tkinter as tk
from tkinter import filedialog
from tkinter import messagebox

# module1 PSD匹配POR #

root = tk.Tk()
root.withdraw()


messagebox.showinfo("Notice", "Please select LNB_PSD.xlsx file!")
LNB_PSD = filedialog.askopenfilename()

messagebox.showinfo("Notice", "Please select POR.xlsx file!")
LNB_POR = filedialog.askopenfilename()

# 读取PSD,更Geo字段
df1=pd.read_excel(LNB_PSD, sheet_name='PSD',keep_default_na=False)
df1.rename(columns={'MTM': 'PN'}, inplace=True)
df1['GEO'].replace('APMM', 'AP', inplace=True)
df1['GEO'].replace('APEM', 'AP', inplace=True)
df1['GEO'].replace('AG', 'LAS', inplace=True)
df1['GEO'].loc[df1['Sub GEO']=='NA']='NA'

#读取POR, csv文档，默认unicode为ANSI
df2=pd.read_csv(LNB_POR, low_memory=False, encoding='ANSI')
#删除POR里部分字段
df3=df2.drop(labels=['Model Number', 'NUMBER', 'STATE', 'Code_Name', 'DESC_EN', 'Series', 'sub_geo', 'CSPN',
                     'sub_series'], axis=1)

#合并PSD和选择的POR字段
result = pd.merge(df1, df3[['PN', 'Battery', 'Camera', 'Hard_Drive', 'SSD', 'Display_Type', 'VGA',
                             'EMMC', 'Wireless_LAN_Adapters', 'Wireless_Wan', 'Language', 'Real Qualification Date',
                            'Second Pen', 'Other2', 'Processor_AMD', 'Processor_CP']], how='left', on='PN', sort=False)


#输出保存XLSX文档
messagebox.showinfo("Notice", "Please save as")
filename = tk.filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], initialdir='D:\\')
filename = filename + '.xlsx'
result.to_excel(filename, index=False)

print('PSD_with_POR is successfully exported!')

messagebox.showinfo('Notice', 'PSD_with_POR is successfully exported!')

