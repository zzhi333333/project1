"""
Dixon MRP V3 ‑ 全流程入口
步骤：1.BOM → 2.MTM→SBB → 3.SBB订单 → 3.1SFG扣减 → 4.MFG_PO_BOM →
      5.1库存匹配 → 5.2OpenPO → 5.3ETA到料&回写
"""
import os
from pathlib import Path
from datetime import datetime
import pandas as pd
from tkinter import messagebox

from config import ENABLE_MAXFLOW
from utils.common import save_df, select_file_gui, ensure_output_dir
from bom.expand import expand_bom_tree
from bom.leaf import generate_leaf_bom
from mapping.mtm_sbb import parse_mtm_sbb_mapping_from_workbook
from mapping.sbb_order import compute_sbb_order_qty
from mapping.mfg_po_bom import build_mfg_po_bom_mapping
from inventory.sfg_deduct import sfg_deduct
from inventory.mrp5 import mrp5_1_compute, mrp5_2_compute
from eta_enrich import run_eta_enrich


def main():
    try:
        print("==== Dixon MRP V3 开始 ====")
        today_str = datetime.now().strftime("%Y%m%d")

        # ---------- STEP 1 ----------
        bom_file = select_file_gui("请选择 BOM 文件 (DIXON+BOM+all)", "DIXON+BOM+all.csv/xlsx")
        ext = os.path.splitext(bom_file)[1].lower()
        raw_bom = pd.read_csv(bom_file) if ext == ".csv" else pd.read_excel(bom_file, engine="openpyxl")
        print("[STEP1] 展开 BOM ...")
        expanded = expand_bom_tree(raw_bom)
        leaf = generate_leaf_bom(expanded)
        save_df(expanded, "DIXON+BOM+all_expanded_bom_tree_sbb_roots.xlsx")
        save_df(leaf, "DIXON+BOM+all_bom_leaf.xlsx")

        # ---------- STEP 2 ----------
        mtm_workbook = select_file_gui("请选择 Multi Product Raw Bill of Materials Export 工作簿",
                                       "Multi Product Raw Bill of Materials Export.xlsx")
        print("[STEP2] 解析 MTM->SBB 映射 ...")
        mtm_map = parse_mtm_sbb_mapping_from_workbook(mtm_workbook)
        save_df(mtm_map, "MTM_SBB_mapping.xlsx")

        # ---------- STEP 3 ----------
        dixon_po_file = select_file_gui("请选择 Dixon MFG PO 文件", "Dixon MFG PO.xlsx")
        print("[STEP3] 计算 SBB 订单用量...")
        dixon_po_df = pd.read_excel(dixon_po_file, engine="openpyxl")
        sbb_order = compute_sbb_order_qty(dixon_po_df, mtm_map)
        save_df(sbb_order, "SBB_订单用量汇总.xlsx")

        # ---------- STEP 3.1 ----------
        odm_inv_file = select_file_gui("请选择 ODM_INVERTORY 文件", "ODM_INVERTORY.xlsx")
        sfg_map_file = select_file_gui("请选择 SFG_SBB_Mapping 文件", "SFG_SBB_Mapping.xlsx")
        odm_inv_df = pd.read_excel(odm_inv_file, engine="openpyxl")
        sfg_map_df = pd.read_excel(sfg_map_file, engine="openpyxl")
        print("[STEP3.1] SFG 库存扣减 ...")
        sbb_order_update = sfg_deduct(sbb_order, odm_inv_df, sfg_map_df)
        save_df(sbb_order_update, "SBB_订单用量汇总_update.xlsx")

        # ---------- STEP 4 ----------
        print("[STEP4] 生成 MFG_PO_BOM_mapping ...")
        mfg_po_bom_map = build_mfg_po_bom_mapping(leaf, sbb_order_update)
        save_df(mfg_po_bom_map, "MFG_PO_BOM_mapping.xlsx")

        # ---------- STEP 5.1 ----------
        print("[STEP5.1] 进行组合级库存匹配 ...")
        final_bom_agg = mrp5_1_compute(mfg_po_bom_map, odm_inv_df, enable_maxflow=ENABLE_MAXFLOW)
        save_df(final_bom_agg, "Final_BOM_ODM_Mapping.xlsx")

        # ---------- STEP 5.2 ----------
        lnv_po_file = select_file_gui("请选择 LNV Dixon Open PO 文件", "LNV Dixon Open PO.xlsx")
        lnv_po_df = pd.read_excel(lnv_po_file, engine="openpyxl")
        print("[STEP5.2] 合并 Open PO 并计算 BPS/net demand ...")
        final_df = mrp5_2_compute(final_bom_agg, lnv_po_df)
        bps_result_path = Path("output") / f"Net_dmd_BPS_result_{today_str}.xlsx"
        ensure_output_dir()
        final_df.to_excel(bps_result_path, index=False)
        print(f"[STEP5.2] 完成 -> {bps_result_path}")

        # ---------- 5）把 MENGE_times_MFG_PO_Qty 挪到 Dixon_inv_Qty 之前 ----------
        print("[STEP5.3] ETA 到料 & Description/Model 回写 ...")
        run_eta_enrich(
            bps_path=bps_result_path,
            openpo_path=Path(lnv_po_file),
            today_str=today_str
        )

        
        print("==== 全部流程完成 ====")
        messagebox.showinfo("完成", "Dixon MRP V3 已全部执行完毕！")

    except Exception as e:
        import traceback
        traceback.print_exc()
        messagebox.showerror("执行失败", str(e))
        raise


if __name__ == "__main__":
    main()