import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox
import numpy as np

# Initialize Tkinter
root = tk.Tk()
root.withdraw()

def select_file(title):
    messagebox.showinfo("Notice", title)
    return filedialog.askopenfilename()

# Select PSD_Merged file
df_merged = select_file("Please select LNB_PSD_Merged.xlsx file!")
df_merged = pd.read_excel(df_merged)


#pivot 1 PSD ONS late reason report

df_ONS=pd.pivot_table(df_merged,index =[], valuse= ,aggfunc=np.sum)

#pivot 2 Current Month MR status report



#pivot3 Future Month MR status report


# Save the file
save_title = "Please save as"
filename = filedialog.asksaveasfilename(filetypes=[('Excel文档', '*.xlsx')], defaultextension='.xlsx',
                                        initialdir='D:\\')
df_merged.to_excel(filename, index=False)

print('df_merged is successfully exported!')

