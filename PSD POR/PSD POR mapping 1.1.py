import pandas as pd
import tkinter as tk
from tkinter import filedialog
from tkinter import messagebox

# module1 PSD匹配POR #

root = tk.Tk()
root.withdraw()


messagebox.showinfo("Notice", "Please select LNB_PSD.xlsx file!")
Filepath = filedialog.askopenfilename()

messagebox.showinfo("Notice", "Please select POR.xlsx file!")
Filepath1 = filedialog.askopenfilename()


LNB_PSD = Filepath
LNB_POR = Filepath1

df1=pd.read_excel(LNB_PSD,sheet_name='PSD',keep_default_na=False) # 读取PSD #
df1.rename(columns={'MTM':'PN'}, inplace=True)

df2=pd.read_csv(LNB_POR, low_memory=False, encoding='ANSI') #读取POR, csv文档，默认unicode为ANSI
df3=df2.drop(labels=['Model Number','NUMBER','STATE','Code_Name','DESC_EN','Series','sub_geo','CSPN',
                     'sub_series',],axis=1) #删除POR里部分字段

result = pd.merge(df1, df3[['PN', 'Battery', 'Camera', 'Hard_Drive', 'SSD', 'Display_Type', \
                                  'EMMC', 'Processor_AMD', 'Processor_CP']], \
                  how='left', on = 'PN', sort = False)

messagebox.showinfo("Notice", "Please save as")
filename = tk.filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], initialdir='D:\\')
filename = filename + '.xlsx'
result.to_excel(filename, index=False)

print('CPL_PSD_with_POR is successfully exported!')

