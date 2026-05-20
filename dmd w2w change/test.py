import pandas as pd
import tkinter as tk
import datetime
from tkinter import filedialog
from tkinter import messagebox
import openpyxl as op



root = tk.Tk()
root.withdraw()

now = datetime.datetime.now()
year=now.year
year2=now.year+1

Q1=['APR','MAY','JUN']
Q2=['JUL','AUG','SEP']
Q3=['OCT','NOV','DEC']
Q4=['JAN','FEB','MAR']

#Q1 字段名
Q1_data_fiexed_field=['Site','Subgeo', 'FAMILY']
Q1_Month_DMD=[str(year)+i+'DMD' for i in Q1]
Q1_Month_SUP=[str(year)+i+'SUP' for i in Q1]
Q1_fileds=Q1_Month_SUP+Q1_Month_DMD
Q1_data_fiexed_field.extend(Q1_fileds)
#Q2 字段名
Q2_data_fiexed_field=['Site','Subgeo', 'FAMILY']
Q2_Month_DMD=[str(year)+i+'DMD' for i in Q2]
Q2_Month_SUP=[str(year)+i+'SUP' for i in Q2]
Q2_fileds=Q2_Month_SUP+Q2_Month_DMD
Q2_data_fiexed_field.extend(Q2_fileds)
#Q3 字段名
Q3_data_fiexed_field=['Site','Subgeo', 'FAMILY']
Q3_Month_DMD=[str(year)+i+'DMD' for i in Q3]
Q3_Month_SUP=[str(year)+i+'SUP' for i in Q3]
Q3_fileds=Q3_Month_SUP+Q3_Month_DMD
Q3_data_fiexed_field.extend(Q3_fileds)
#Q4 字段名
Q4_data_fiexed_field=['Site','Subgeo', 'FAMILY']
Q4_Month_DMD=[str(year2)+i+'DMD' for i in Q4]
Q4_Month_SUP=[str(year2)+i+'SUP' for i in Q4]
Q4_fileds=Q4_Month_SUP+Q4_Month_DMD
Q4_data_fiexed_field.extend(Q4_fileds)


for Q in Q1:
    print(str(year)+'%s_DMD'%(Q))
