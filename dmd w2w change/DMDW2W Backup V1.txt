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

messagebox.showinfo("Notice", "Please select DMD_version1.xlsx! file")
Filepath1 = filedialog.askopenfilename()

messagebox.showinfo("Notice", "Please select DMD_version2.xlsx! file")
Filepath2 = filedialog.askopenfilename()

LNB_DMD1 = Filepath1
LNB_DMD2 = Filepath2

df1=pd.read_excel(LNB_DMD1,sheet_name=0,keep_default_na=False)

df1=pd.read_excel(LNB_DMD1,sheet_name=0,keep_default_na=False)
df1=df1[~df1['Product Group'].isin(['TBG'])]
df1=df1[df1['Brand'].isin(['Notebook'])]

df2=pd.read_excel(LNB_DMD2,sheet_name=0,keep_default_na=False)

df2=pd.read_excel(LNB_DMD1,sheet_name=0,keep_default_na=False)
df2=df2[~df2['Product Group'].isin(['TBG'])]
df2=df2[df2['Brand'].isin(['Notebook'])]

import tkinter.simpledialog
root = tk.Tk()
root.withdraw()

Quater_Checking=tkinter.simpledialog.askstring('Quater','请选择导入表格的时间维度：Q1/Q2/Q3/Q4:')

#print(Quater_Checking)


if Quater_Checking == 'Q1':
    for i in Q1: #第1个季度合并

        DMDW2W_result = pd.merge(df1[Q1_data_fiexed_field], df2[Q1_data_fiexed_field],
                  how='outer', on = ['Site','Subgeo', 'FAMILY'], sort = False)

elif Quater_Checking == 'Q2':
    for j in Q2: #第2个季度合并

        DMDW2W_result = pd.merge(df1[Q2_data_fiexed_field], df2[Q2_data_fiexed_field],
                  how='outer', on = ['Site','Subgeo', 'FAMILY'], sort = False)

elif Quater_Checking == 'Q3':
    for k in Q3: #第3个季度合并

        DMDW2W_result = pd.merge(df1[Q3_data_fiexed_field], df2[Q3_data_fiexed_field],
                  how='outer', on = ['Site','Subgeo', 'FAMILY'], sort = False)


elif Quater_Checking == 'Q4':
    for l in Q4: #第4个季度合并

        DMDW2W_result = pd.merge(df1[Q4_data_fiexed_field], df2[Q4_data_fiexed_field],
                  how='outer', on = ['Site','Subgeo', 'FAMILY'], sort = False)

else:
    print('请输入正确的季度值，注意大写:Q1/Q2/Q3/Q4!')

DMDW2W_result.to_excel('D:\Python\W2W FCST\dmd w2w change\DMDW2W_result.xlsx',index=False)



# 笨办法填充空白单元格，后面再优化
DMDW2W_result=op.load_workbook('D:\Python\W2W FCST\dmd w2w change\DMDW2W_result.xlsx')
sheet = DMDW2W_result['Sheet1']  #打开该Excel里对应的sheet
for k in range(1,sheet.max_column+1):    #对第1至X列单元格遍历
    for i in range(1,sheet.max_row+1):   #对第1至X行单元格遍历
        if sheet.cell(row=i, column=k).value is None:    #如果该单元格为空
            sheet.cell(i, k, 0)     #填入0

DMDW2W_result.save('D:\Python\W2W FCST\dmd w2w change\DMDW2W_result.xlsx')

DMDW2W_result=pd.read_excel('D:\Python\W2W FCST\dmd w2w change\DMDW2W_result.xlsx')

if Quater_Checking == 'Q1':

    for Q in Q1:
        #print(str(year) + '%s_DMD' % (Q))

        DMDW2W_result[str(year)+'%sDMD_w2w'%(Q)] = DMDW2W_result[str(year)+'%sDMD_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sDMD_y'%(Q)]
        DMDW2W_result[str(year)+'%sSUP_w2w'%(Q)] = DMDW2W_result[str(year)+'%sSUP_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sSUP_y'%(Q)]

elif Quater_Checking == 'Q2':
    for Q in Q2:
        #print(str(year) + '%s_DMD' % (Q))

        DMDW2W_result[str(year)+'%sDMD_w2w'%(Q)] = DMDW2W_result[str(year)+'%sDMD_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sDMD_y'%(Q)]
        DMDW2W_result[str(year)+'%sSUP_w2w'%(Q)] = DMDW2W_result[str(year)+'%sSUP_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sSUP_y'%(Q)]
elif Quater_Checking == 'Q3':
    for Q in Q3:
        #print(str(year) + '%s_DMD' % (Q))

        DMDW2W_result[str(year)+'%sDMD_w2w'%(Q)] = DMDW2W_result[str(year)+'%sDMD_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sDMD_y'%(Q)]
        DMDW2W_result[str(year)+'%sSUP_w2w'%(Q)] = DMDW2W_result[str(year)+'%sSUP_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sSUP_y'%(Q)]

elif Quater_Checking == 'Q4':
    for Q in Q4:
        #print(str(year) + '%s_DMD' % (Q))

        DMDW2W_result[str(year)+'%sDMD_w2w'%(Q)] = DMDW2W_result[str(year)+'%sDMD_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sDMD_y'%(Q)]
        DMDW2W_result[str(year)+'%sSUP_w2w'%(Q)] = DMDW2W_result[str(year)+'%sSUP_x'%(Q)] \
                                                - DMDW2W_result[str(year)+'%sSUP_y'%(Q)]


DMDW2W_result.to_excel('D:\Python\W2W FCST\dmd w2w change\DMDW2W_result.xlsx',index=False)
