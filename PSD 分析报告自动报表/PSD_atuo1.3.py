import pandas as pd
from datetime import datetime, timedelta
import calendar
import win32com.client as win32
import os
import time

# 获取当前日期和文件名
current_date = datetime.now().strftime("%Y%m%d")
file_name = 'D:\\Python projects\\PSD 分析报告自动报表\\df_merged_20240807.xlsx'
# 读取 Excel 文件
df = pd.read_excel(file_name)

# 插入新列 "MR Status"
df['MR Status'] = None

# 获取当前日期和本月最后一天
now = datetime.now()
end_of_month = datetime(now.year, now.month, calendar.monthrange(now.year, now.month)[1])
start_of_late_mr = end_of_month - timedelta(days=5)

# 定义填充 "MR Status" 列的函数
def fill_mr_status(row):
    if row['Level 1 Code'] == 'Shipped':
        return 'Shipped'
    if pd.isna(row['MR date']) or row['MR date'] == 'TBD':
        return 'MR Date Blank'
    mr_date = pd.to_datetime(row['MR date'], errors='coerce')
    if pd.isna(mr_date):
        return 'MR Date Blank'
    if start_of_late_mr <= mr_date <= end_of_month:
        return 'Late MR date'
    if mr_date <= now:
        return 'MR by today'
    if now < mr_date <= (now + timedelta(days=(6 - now.weekday()))):
        return 'WK01'
    week_num = 1
    while (now + timedelta(days=(6 - now.weekday()) + 7 * week_num)) < start_of_late_mr:
        if (now + timedelta(days=(6 - now.weekday()) + 7 * (week_num - 1))) < mr_date <= (now + timedelta(days=(6 - now.weekday()) + 7 * week_num)):
            return f'WK{str(week_num).zfill(2)}'
        week_num += 1
    if mr_date > end_of_month:
        return 'MR Date Future'
    return None

# 填充 "MR Status" 列
df['MR Status'] = df.apply(fill_mr_status, axis=1)

# 在保存Excel文件之前，先尝试关闭可能打开的Excel实例
def close_excel_by_filename(filename):
    try:
        excel = win32.GetObject(Class="Excel.Application")
        for workbook in excel.Workbooks:
            if os.path.abspath(workbook.FullName) == os.path.abspath(filename):
                workbook.Close(SaveChanges=False)
        excel.Quit()
    except:
        pass  # 如果没有打开的Excel实例，就跳过

# 保存填充后的 Excel 文件
def save_excel_file(df, file_name, max_attempts=5, delay=2):
    for attempt in range(max_attempts):
        try:
            close_excel_by_filename(file_name)
            df.to_excel(file_name, index=False)
            print(f"Excel file saved successfully: {file_name}")
            return
        except PermissionError:
            if attempt < max_attempts - 1:
                print(f"Unable to save file, retrying in {delay} seconds...")
                time.sleep(delay)
            else:
                print(f"Failed to save file after {max_attempts} attempts.")
                raise

# 使用新的保存函数
save_excel_file(df, file_name)

# 打开Excel应用程序
excel = win32.gencache.EnsureDispatch('Excel.Application')
excel.Visible = False  # 在后台运行

# 打开工作簿
wb = excel.Workbooks.Open(file_name)

# 获取数据范围
ws_data = wb.Sheets[1]
last_row = ws_data.Cells(ws_data.Rows.Count, 1).End(win32.constants.xlUp).Row
last_col = ws_data.Cells(1, ws_data.Columns.Count).End(win32.constants.xlToLeft).Column
data_range = ws_data.Range(ws_data.Cells(1, 1), ws_data.Cells(last_row, last_col))

# 确保数据范围至少有两行
if last_row < 2:
    raise ValueError("数据源区域至少需要两行数据。")

# 添加新的工作表
ws_pv = wb.Sheets.Add()
ws_pv.Name = 'PV'

def create_pivot_table(workbook, sheet_name, start_row, filter_area=None, filter_value=None, rows_area=None, cols_area=None, values_area=None):
    sheet = workbook.Sheets(sheet_name)
    try:
        pivot_cache = workbook.PivotCaches().Create(SourceType=win32.constants.xlDatabase, SourceData=data_range)
    except Exception as e:
        print(f"Error creating pivot cache: {e}")
        return start_row + 20

    # 检查是否已存在透视表，如果存在则删除
    for pt in sheet.PivotTables():
        if pt.TableRange2.Row == start_row:
            pt.TableRange2.Clear()
            break

    table_destination = sheet.Cells(start_row, 1)
    try:
        pivot_table = pivot_cache.CreatePivotTable(
            TableDestination=table_destination,
            TableName=f"PivotTable{start_row}"
        )
    except Exception as e:
        print(f"Error creating pivot table: {e}")
        return start_row + 20

    try:
        if filter_area and filter_area in [field.Name for field in pivot_table.PivotFields()]:
            pf = pivot_table.PivotFields(filter_area)
            pf.Orientation = win32.constants.xlPageField
            if filter_value is not None:
                try:
                    if isinstance(filter_value, list):
                        for item in pf.PivotItems():
                            item.Visible = item.Name in filter_value
                    elif filter_value == 'ALL_EXCEPT_FUTURE':
                        for item in pf.PivotItems():
                            item.Visible = item.Name != "Future RSD"
                    else:
                        pf.CurrentPage = filter_value
                except Exception as e:
                    print(f"Error setting filter value '{filter_value}' for '{filter_area}': {e}")
        
        if rows_area:
            if isinstance(rows_area, list):
                for i, field in enumerate(rows_area):
                    if field in [f.Name for f in pivot_table.PivotFields()]:
                        pivot_table.PivotFields(field).Orientation = win32.constants.xlRowField
                        pivot_table.PivotFields(field).Position = i + 1
            elif rows_area in [field.Name for field in pivot_table.PivotFields()]:
                pivot_table.PivotFields(rows_area).Orientation = win32.constants.xlRowField
        
        if cols_area and cols_area in [field.Name for field in pivot_table.PivotFields()]:
            pivot_table.PivotFields(cols_area).Orientation = win32.constants.xlColumnField
        
        if values_area and values_area in [field.Name for field in pivot_table.PivotFields()]:
            value_field = pivot_table.AddDataField(pivot_table.PivotFields(values_area))
            value_field.Function = win32.constants.xlSum
    
        # 设置透视表样式
        pivot_table.TableStyle2 = "PivotStyleLight16"
    
        # 自动调整列宽
        sheet.Columns.AutoFit()
    except Exception as e:
        print(f"Error configuring pivot table: {e}")
        print("Continuing with partial configuration...")

    try:
        last_row = pivot_table.TableRange2.Row + pivot_table.TableRange2.Rows.Count
    except:
        last_row = start_row + 20  # 如果无法获取实际大小，使用默认值

    return last_row + 20  # 在透视表之后留出20行空间

# 修改生成透视表的代码
start_row = 1
pivot_tables_config = [
    ("GEO", None, "Series", "PSD status", "Qty"),
    ("PSD status", "ONS", ["Series", "Late Reason Detail"], "GEO", "Qty"),
    ("PSD status", "ALL_EXCEPT_FUTURE", "Series", "MR Status", "Qty"),
    ("PSD status", "Future RSD", "Series", "MR Status", "Qty")
]

for i, (filter_area, filter_value, rows_area, cols_area, values_area) in enumerate(pivot_tables_config, 1):
    try:
        print(f"\nCreating pivot table {i} with parameters:")
        print(f"  filter_area: {filter_area}")
        print(f"  filter_value: {filter_value}")
        print(f"  rows_area: {rows_area}")
        print(f"  cols_area: {cols_area}")
        print(f"  values_area: {values_area}")
        
        end_row = create_pivot_table(wb, "PV", start_row, filter_area, filter_value, rows_area, cols_area, values_area)
        print(f"Pivot table {i} created at row {start_row}")
        start_row = end_row
    except Exception as e:
        print(f"Error creating pivot table {i}: {e}")
        start_row += 50  # 如果创建失败，仍然移动到下一个位置

# 修改生成透视表的代码
start_row = 1
pivot_tables_config = [
    ("GEO", None, "Series", "PSD status", "Qty"),
    ("PSD status", "ONS", ["Series", "Late Reason Detail"], "GEO", "Qty"),
    ("PSD status", ["ONS", "Late MR date", "MR by today", "WK01", "WK02", "WK03", "WK04"], "Series", "MR Status", "Qty"),
    ("PSD status", "Future RSD", "Series", "MR Status", "Qty")
]

for i, (filter_area, filter_value, rows_area, cols_area, values_area) in enumerate(pivot_tables_config, 1):
    try:
        print(f"\nCreating pivot table {i} with parameters:")
        print(f"  filter_area: {filter_area}")
        print(f"  filter_value: {filter_value}")
        print(f"  rows_area: {rows_area}")
        print(f"  cols_area: {cols_area}")
        print(f"  values_area: {values_area}")
        
        end_row = create_pivot_table(wb, "PV", start_row, filter_area, filter_value, rows_area, cols_area, values_area)
        print(f"Pivot table {i} created at row {start_row}")
        start_row = end_row
    except Exception as e:
        print(f"Error creating pivot table {i}: {e}")
        start_row += 50  # 如果创建失败，仍然移动到下一个位置

# 修改生成透视表的代码
start_row = 1
pivot_tables_config = [
    ("GEO", None, "Series", "PSD status", "Qty"),
    ("PSD status", "ONS", "Series", "GEO", "Qty"),
    ("PSD status", None, "Series", "MR Status", "Qty"),
    ("PSD status", "Future RSD", "Series", "MR Status", "Qty")
]

for i, (filter_area, filter_value, rows_area, cols_area, values_area) in enumerate(pivot_tables_config, 1):
    try:
        print(f"\nCreating pivot table {i} with parameters:")
        print(f"  filter_area: {filter_area}")
        print(f"  filter_value: {filter_value}")
        print(f"  rows_area: {rows_area}")
        print(f"  cols_area: {cols_area}")
        print(f"  values_area: {values_area}")
        
        end_row = create_pivot_table(wb, "PV", start_row, filter_area, filter_value, rows_area, cols_area, values_area)
        print(f"Pivot table {i} created at row {start_row}")
        start_row = end_row
    except Exception as e:
        print(f"Error creating pivot table {i}: {e}")
        start_row += 50  # 如果创建失败，仍然移动到下一个位置

# 隐藏 "Future RSD" 项
pv_sheet = wb.Sheets["PV"]
for pt in pv_sheet.PivotTables():
    try:
        if "PSD status" in [field.Name for field in pt.PivotFields()]:
            for item in pt.PivotFields("PSD status").PivotItems():
                if item.Name == "Future RSD":
                    item.Visible = False
    except Exception as e:
        print(f"Error hiding 'Future RSD' item: {e}")

# 保存并关闭工作簿
try:
    wb.Save()
    wb.Close()
    excel.Quit()
except Exception as e:
    print(f"Error saving and closing workbook: {e}")

# 在代码结束时，确保关闭所有Excel实例
def close_all_excel_instances():
    try:
        excel = win32.GetObject(Class="Excel.Application")
        excel.Quit()
    except:
        pass

# 在主程序结束时调用
if __name__ == "__main__":
    try:
        # ... your main code ...
        pass
    finally:
        close_all_excel_instances()