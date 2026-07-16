# mrp_engine.py
import pandas as pd
import bom_network  # 直接调用已实现的 BOM 展开接口

def run_mrp(bom_file, demand_file, stock_file, po_file, output_file="mrp_result.xlsx"):
    # 1. 展开BOM
    df_bom = bom_network.process_bom_file(bom_file)

    # 2. 读取需求、库存、采购订单
    df_demand = pd.read_excel(demand_file)  # 列：Material, Demand
    df_stock = pd.read_excel(stock_file)    # 列：Material, Stock
    df_po = pd.read_excel(po_file)          # 列：Material, POQty

    # 3. 合并需求/库存/在途到BOM结果
    df = df_bom.merge(df_demand, how="left", left_on="Child", right_on="Material")
    df = df.merge(df_stock, how="left", left_on="Child", right_on="Material")
    df = df.merge(df_po, how="left", left_on="Child", right_on="Material")

    # 4. 填充缺失值
    df["Demand"] = df["Demand"].fillna(0)
    df["Stock"] = df["Stock"].fillna(0)
    df["POQty"] = df["POQty"].fillna(0)

    # 5. 计算净需求
    df["NetReq"] = (df["TotalQty"] + df["Demand"] - df["Stock"] - df["POQty"]).clip(lower=0)

    # 6. 输出结果
    df_out = df[["BOMROOT", "Parent", "Child", "TotalQty", "Demand", "Stock", "POQty", "NetReq", "AltGroup", "IsSubstitute"]]
    df_out.to_excel(output_file, index=False)
    print(f"MRP计算完成，结果已保存到 {output_file}")

if __name__ == "__main__":
    run_mrp(
        bom_file="BOM.xlsx",
        demand_file="demand.xlsx",
        stock_file="stock.xlsx",
        po_file="po.xlsx"
    )
