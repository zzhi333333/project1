DixonMRP/
├── Main.py                 入口 + 全流程 5 步 + 5.3 ETA 增强
├── config.py               全局开关：SAVE_INTERMEDIATE / ENABLE_MAXFLOW
├── eta_enrich.py           STEP 5.3：ETA 到料、Description/Model 回写
├── bom/
│   ├── expand.py           STEP 1 BOM 展开
│   └── leaf.py             STEP 1 叶子表生成
├── mapping/
│   ├── mtm_sbb.py          STEP 2 MTM→SBB
│   ├── sbb_order.py        STEP 3 SBB 订单用量
│   └── mfg_po_bom.py       STEP 4 MFG_PO_BOM 映射
├── inventory/
│   ├── sfg_deduct.py       STEP 3.1 SFG 扣减
│   └── mrp5.py             STEP 5.1 库存匹配 + STEP 5.2 Open PO 合并
└── utils/
    ├── common.py           公共工具（文件选择、保存、列匹配等）

    选 BOM → 2. MTM 映射 → 3. SBB 订单 → 3.1 SFG 扣减 → 4. MFG_PO_BOM →
5.1 库存匹配 → 5.2 合并 Open PO → 5.3 ETA 到料 & 回写


步骤	           输入文件	             输出文件	                            关键逻辑
1	BOM (csv/xlsx)	DIXON+BOM+all_expanded_bom_tree_sbb_roots.xlsx
BOM 展开 + 叶子
2	Multi Product Raw BOM	MTM_SBB_mapping.xlsx	MTM→SBB
3	Dixon MFG PO	SBB_订单用量汇总.xlsx	订单总量
3.1	ODM_INVENTORY + SFG_SBB_Mapping	SBB_订单用量汇总_update.xlsx	SFG 库存扣减
4	叶子表 + 更新后订单	MFG_PO_BOM_mapping.xlsx	组合级需求
5.1	MFG_PO_BOM_mapping	Final_BOM_ODM_Mapping.xlsx	库存匹配
5.2	LNV Dixon Open PO	Net_dmd_BPS_result_YYYYMMDD.xlsx	合并 Open PO
5.3	5.2 结果 + 同一张 Open PO	Net_BPSONS_ETA_YYYYMMDD.xlsx

新增/增强功能
库存匹配 仅汇总 ACTIVE_LOCATIONS 白名单的 ODM QTY。
ETA 计算
• MOT=air → ETD+2 周
• MOT=sea → ETD+6 周
• 仅保留日期（无 00:00:00）。
回写字段
• Description：每条 ALT Customer PN 第一条非空。
• Model：去重后用逗号拼接。
聚合 按 ETA 日期列输出 ALT Customer PN 的 Total 值。

ATB 计算回写
