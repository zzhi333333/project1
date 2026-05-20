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

#keep_default_na=False， 关闭NA为空值的默认开关
df1=pd.read_excel(LNB_MPS1, sheet_name=0, header=1, keep_default_na=False)

b=[column for column in df1]
c=[x for x in a if x in b]#两个列表都有
d=[y for y in (a+c) if y not in c]#两个列表中的不同元素

f=[]
for i in range(len(d)):
    f.append(0)

df1[d]=f

print(b)
print(c)
print(d)
print(f)
