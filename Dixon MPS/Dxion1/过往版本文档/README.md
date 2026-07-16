# DixonMPS1.0 使用说明

## 简介
该文档是一个集成化的物料需求计划（MRP）计算脚本。  
它支持 **GUI 分步导入手工文件**，自动 **内存传递中间结果**，可选择 **保存中间文件**，并可选启用 **最大流分配**。

该脚本基于以下模块整合：
1. `bom_tool.py` - 展开 BOM 树并生成叶子料号
2. `MTM_SBB_mapping.py` - 解析 Multi Product Raw BOM 中 MTM 与 SBB 的映射
3. `SBB_MFG_PO_Qty_Mapping.py` - 计算 SBB 订单用量
4. `MRP3.1SFGdeduct.py` - SFG 库存扣减
5. `MFG_PO_BOM_mapping.py` - 生成 MFG_PO_BOM_mapping
6. `MRP5.1.py` - 库存匹配计算（可选最大流）
7. `MRP5.2.py` - 合并 Open PO 并计算 BPS / net demand

---

## 系统要求

- Python 3.8+
- 必要库：
  ```bash
  pip install pandas openpyxl


可选库（启用最大流分配需要）：
pip install networkx


使用步骤

1. 准备输入文件

需要手工选择的文件：

DIXON+BOM+all.xlsx 或 .csv
（用于 Step1: 展开 BOM）

Multi Product Raw Bill of Materials Export.xlsx
（用于 Step2: MTM->SBB 映射）

Dixon MFG PO.xlsx
（用于 Step3: SBB 订单用量）

ODM_INVERTORY.xlsx
（用于 Step3.1: SFG 库存扣减）

SFG_SBB_Mapping.xlsx
（用于 Step3.1: SFG 映射）

LNV Dixon Open PO.xlsx
（用于 Step5.2: 合并 Open PO）

2. 运行脚本
python DXIONMPS1.0.py

脚本会弹窗提示用户选择每一步对应的手工输入文件，并显示当前进度：
[STEP1] 展开 BOM ...
[STEP2] 解析 MTM->SBB 映射 ...
[STEP3] 计算 SBB 订单用量...
[STEP3.1] SFG 库存扣减 ...
[STEP4] 生成 MFG_PO_BOM_mapping ...
[STEP5.1] 进行组合级库存匹配 ...
[STEP5.2] 合并 Open PO 并计算 BPS/net demand ...

3. 中间结果文件

默认情况下，所有中间结果文件都会保存到 output/ 文件夹：

DIXON+BOM+all_expanded_bom_tree_sbb_roots.xlsx

DIXON+BOM+all_bom_leaf.xlsx

MTM_SBB_mapping.xlsx

SBB_订单用量汇总.xlsx

SBB_订单用量汇总_update.xlsx

MFG_PO_BOM_mapping.xlsx

Final_BOM_ODM_Mapping.xlsx

如果不需要保存中间文件，可以在脚本中设置
SAVE_INTERMEDIATE = False

4. 最终结果文件
Step5.2 计算完成后，最终结果文件会保存在 output/ 文件夹，默认命名格式：
Net_dmd_BPS_result_YYYYMMDD.xlsx
文件包含以下关键字段：
CHILD / substitute_1~N：BOM 子料号及替代料号
MENGE_times_MFG_PO_Qty：按订单数量计算的需求量
Dixon_inv_Qty：ODM 库存匹配量
Dixon_Open_PO_Qty：LNV Open PO 数量
BPS：未交付数量 = 需求量 - 库存
net_dmd_result：净需求 = BPS - Open PO

5. 可选设置
最大分流分配: 
ENABLE_MAXFLOW = True
需要安装 networkx，可在 Step5.1 对库存分配做最大流优化。
中间文件保存
SAVE_INTERMEDIATE = False

注意事项
如果运行时报列找不到，请检查 Excel 文件列名与示例列名是否匹配。
如果 Multi Product Raw BOM 工作簿的 MTM 不在 C6 或表头不在第 7 行，需要调整 parse_mtm_sbb_mapping_from_workbook 中的行号。
文件路径中不要包含中文或特殊字符，以避免兼容性问题。



## 流程图示

```
Step1: BOM 展开
Input (手工) ──────────────> DIXON+BOM+all.xlsx/csv
                             │
                             ▼
                   DIXON+BOM+all_expanded_bom_tree_sbb_roots
                   DIXON+BOM+all_bom_leaf
                             │
                             ▼
Step2: MTM->SBB 映射
Input (手工) ──────────────> Multi Product Raw BOM.xlsx
                             │
                             ▼
                        MTM_SBB_mapping
                             │
                             ▼
Step3: SBB 订单用量
Input (手工) ──────────────> Dixon MFG PO.xlsx
MTM_SBB_mapping ────────────┘
                             │
                             ▼
                        SBB_订单用量汇总
                             │
                             ▼
Step3.1: SFG 库存扣减
Input (手工) ──────────────> ODM_INVERTORY.xlsx
Input (手工) ──────────────> SFG_SBB_Mapping.xlsx
SBB_订单用量汇总 ───────────┘
                             │
                             ▼
                  SBB_订单用量汇总_update
                             │
                             ▼
Step4: MFG_PO_BOM_mapping
DIXON+BOM+all_bom_leaf ─────┐
SBB_订单用量汇总_update ────┘
                             │
                             ▼
                  MFG_PO_BOM_mapping
                             │
                             ▼
Step5.1: 库存匹配计算
Input (手工) ──────────────> ODM_INVERTORY.xlsx
MFG_PO_BOM_mapping ─────────┘
                             │
                             ▼
                  Final_BOM_ODM_Mapping
                             │
                             ▼
Step5.2: 合并 Open PO / 计算 BPS & Net Demand
Input (手工) ──────────────> LNV Dixon Open PO.xlsx
Final_BOM_ODM_Mapping ──────┘
                             │
                             ▼
                  Net_dmd_BPS_result.xlsx
```

---

这个图示展示了：

1. **每步的手工输入文件**  
2. **每步的中间文件**（内存传递，不必手动导入）  
3. **最终输出文件**  


