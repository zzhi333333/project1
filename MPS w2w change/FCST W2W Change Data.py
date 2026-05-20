import pandas as pd
import numpy as np
import tkinter as tk
from tkinter import filedialog
from tkinter import messagebox

# module1 MPS 文档导入生成透视表， W2跟W1比对差值，需要注意填充空值部分 #
root = tk.Tk()
root.withdraw()

messagebox.showinfo("Notice", "Please select MPS_version1.xls! file")
Filepath = filedialog.askopenfilename()

messagebox.showinfo("Notice", "Please select MPS_version2.xls file!")
Filepath1 = filedialog.askopenfilename()

LNB_MPS1 = Filepath
LNB_MPS2 = Filepath1

a=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

#keep_default_na=False， 关闭NA为空值的默认开关，因为有Geo字段名北美为NA
df1=pd.read_excel(LNB_MPS1, sheet_name=0, header=1, keep_default_na=False)

b=[column for column in df1]
c=[x for x in a if x in b]#a和b交集，就是MPS中汇总的月份字段
d=[y for y in a if y not in c]#a和c两个列表中的差集，就是MPS中缺少的月份字段, 如果c没有包含在a中， 就要写y for y in (a+c)...

#f填入0值，并赋值到d列表的字段中,然后放入df1中
f=[]
for i in range(len(d)):
    f.append(0)

df1[d]=f

df2=pd.read_excel(LNB_MPS2, sheet_name=0, header=1, keep_default_na=False)

b1=[column for column in df2]
c1=[x for x in a if x in b1]#a1和b1交集，就是MPS中汇总的月份字段
d1=[y for y in a if y not in c1]#a和c1两个列表中的差集，就是MPS中缺少的月份字段

#f1填入0值，并赋值到d1列表的字段中，然后放入df2中
f1=[]
for i in range(len(d1)):
    f1.append(0)

df2[d1]=f1


MPS1_Pivot=pd.pivot_table(df1, index = ['odm','subgeo','series'],
                       values = a, aggfunc = np.sum)
MPS1_Pivot_flat=MPS1_Pivot.reset_index()
MPS1_Pivot_flat=MPS1_Pivot_flat.reindex(['odm','subgeo','series',
                                         'Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
'Jan','Feb','Mar'], axis=1)


MPS2_Pivot=pd.pivot_table(df2, index = ['odm','subgeo','series'],
                       values = a, aggfunc = np.sum)
MPS2_Pivot_flat=MPS2_Pivot.reset_index()
MPS2_Pivot_flat=MPS2_Pivot_flat.reindex(['odm','subgeo','series',
                                         'Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
'Jan','Feb','Mar'], axis=1)


# MPS1_Pivot_flat.to_excel('D:\Python\W2W FCST\MPS1_Piovt.xlsx', index=False) 验证文档，不输出
# MPS2_Pivot_flat.to_excel('D:\Python\W2W FCST\MPS2_Piovt.xlsx', index=False) 验证文档，不输出

W2W_result = pd.merge(MPS2_Pivot_flat, MPS1_Pivot_flat[['odm','subgeo', 'series',
                                                        'Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
'Jan','Feb','Mar']],
                  how='outer', on = ['odm','subgeo', 'series'], sort = False)

W2W_result=W2W_result.fillna(0) #空值NAN填充为0


for month in a: #a是前面定义的一个list，放了整年月份的Str文本#
    W2W_result['%s_w2w'%(month)] = W2W_result['%s_x'%(month)] - W2W_result['%s_y'%(month)]


W2W_result.to_excel('D:\Python\W2W FCST\W2W_result.xlsx',index=False)


