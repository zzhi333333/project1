
# Dixon_Remotesite_BPSONS_ATS_Project_Dev_Doc 项目开发文档MD

> **目标**：以统一的 **combo_key** 与 **跨行去重扣减**策略，串联 BOM→订单→库存→Open PO→ETA→ATB 全链路，输出可审计、可复核、可演进的供需结果。

---

## 1. 架构与模块职责

![architecture](architecture_diagram.png)

**模块分层**：
- **utils.common**：文件选择、保存开关、列名容错。
- **bom**：`expand`（DFS展开，路径乘积）、`leaf`（叶子识别与替代料扁平）。
- **mapping**：`mtm_sbb`（工作簿解析）、`sbb_order`（订单用量）、`mfg_po_bom`（组合级需求）。
- **inventory**：`sfg_deduct`（SFG白名单库位扣减）、`mrp5_1`（库存匹配）、`mrp5_2`（Open PO合并+BPS/净需求）。
- **eta_enrich**：ETA按MOT规则计算、去重分配并回写描述/机型。
- **ATB_Dixon**：SBB/MTM ATB（总量 & 按日增量投放）与诊断。
- **Main.py**：GUI入口与分步执行，自动落盘中间与最终结果。

---

## 2. 数据流与产出

![dataflow](dataflow_diagram.png)

| 步骤 | 输入 | 关键处理 | 输出文件 |
|---|---|---|---|
|Step1|BOM|DFS展开、MENGE路径乘积、叶子/替代料扁平|expanded、leaf|
|Step2|Multi Product Raw BOM|解析 C6/第7行表头，形成 MTM→SBB 映射|MTM_SBB_mapping.xlsx|
|Step3|Dixon MFG PO + MTM_SBB|按 MTM 聚合、与 Qty 相乘|SBB_订单用量汇总.xlsx|
|Step3.1|ODM_INVERTORY + SFG_SBB_Mapping|白名单库位过滤、映射后顺序扣减|SBB_订单用量汇总_update.xlsx|
|Step4|leaf + SBB_订单更新|计算 MENGE×订单量|MFG_PO_BOM_mapping.xlsx|
|Step5.1|MFG_PO_BOM + ODM_INVERTORY|combo_key去空去重排序、跨行去重扣减|Final_BOM_ODM_Mapping.xlsx|
|Step5.2|Final_BOM_ODM + Open PO|按 ALT PN 聚合、used_pns 去重|Net_dmd_BPS_result_YYYYMMDD.xlsx|
|Step5.3|Net_dmd_BPS + Open PO|ETA=ETD+周数、过期ETA扣减Open PO、回写描述/机型|Net_BPSONS_ETA_YYYYMMDD.xlsx|
|ATB|leaf + MTM_SBB + Net_BPSONS_ETA|最短板约束（总量），按日增量差分|ATB_SBB/MTM/明细/诊断|

**字段数据字典（Excel 附录）**：详见 `DataDictionary.xlsx`（Inputs/Intermediate/Outputs 三表）。

---

## 3. 核心算法亮点

- **DFS 展开**：按 `NAME→IDNRK` 建邻接表，路径乘积 `MENGE_PATH`，`visited` 路径级拦环，确保无死循环。
- **替代料扁平**：按 `(bomroot, NAME, ALPGR)` 分组，一行承载 `CHILD + substitute_i`，为库存/PO对齐提供组合键。
- **SFG 扣减**：仅计入 **ACTIVE_LOCATIONS** 白名单库位；提供映射兜底，缺映射则直接按 SBB 汇总扣减。
- **库存匹配（MRP5.1）**：
  - **combo_key规范化**：去空→去重→排序→拼接；
  - **跨行去重扣减**：维护可变 `remaining_inv` 字典，匹配到的 PN 一次性扣到 0，避免重复使用；
  - 仅聚合白名单库位的 `ODM QTY`。
- **Open PO 合并（MRP5.2）**：用 `used_pns` 集合做跨行去重，避免同一 PN 的 `Total` 被多次计入；`BPS=需求-库存`，`净需求=BPS-OpenPO`。
- **ETA 增强（5.3）**：`air=+2周 / sea=+6周`；对 ETA 列维护 `used_qty` 逐一分配，防重复；过期ETA先扣减到 Open PO 再重算净需求；回写 `Description/Model`。
- **ATB（总量 & 按日）**：
  - 总量池优先 `inv + eta_sum`，无效则回退 `inv + open_po`；
  - SBB层台数取各 `combo_key` 的 `floor(supply_total/unit_need)` **最小值**（最短板原则）；
  - 按日：先算 `ATB_cum`，再做逐日差分得到 `ATB_units`（**drop-once 增量投放**）；支持折算至 MTM 层。

---

## 4. 配置与运行方式

**config.py**：`SAVE_INTERMEDIATE`（是否保存中间文件），`ENABLE_MAXFLOW`（是否启用最大流分配）。

**GUI**：运行 `Main.py`，按弹窗顺序选择文件，自动生成全部中间/最终结果。

**CLI（ATB）**：
```bash
python ATB_Dixon.py   --bom DIXON+BOM+all_bom_leaf.xlsx   --mtm MTM_SBB_mapping.xlsx   --net Net_BPSONS_ETA_YYYYMMDD.xlsx   --start_date 2025-09-23 --end_date 2025-10-31   --eta_cutoff 2099-12-31 --unit_build_qty 1 --outdir output
```

---

## 5. 测试与校验清单

- 结构：`level` 单调递增；`path` 包含完整父→子链；叶子判定 `IDNRK ∉ NAME集`。
- 用量：抽样核对 `MENGE_PATH` 与叶子 `MENGE` 一致。
- 扣减：SFG 扣减顺序与剩余量计算正确。
- 去重：`remaining_inv` 与 `used_pns` 行为正确（同一 PN 不重复使用/累加）。
- ETA：`air/sea` 周数规则正确；过期 ETA 扣减生效；净需求回算正确。
- ATB：总量最短板原则 & 按日差分逻辑正确；MTM折算正确。

---

## 6. 性能与风险

- **性能**：深层BOM建议迭代改写；聚合尽量向量化；根据 `SAVE_INTERMEDIATE` 控制I/O以降开销。
- **风险**：源数据列名/质量；替代料覆盖率；口径一致性（BPS/净需求）；ETA 可靠性；白名单库位维护。

---

## 7. 未来路线

- 最大流分配结果对比（启/停）可视化；
- 引入 RSD/TTL 月度口径；
- 异常断言报表与日志；
- ATB 可视化（曲线图/仪表盘）。

## 8.核心算法方式记录
8.1 BOM 展开与叶子识别

- **父子索引与 DFS 展开**：按 `NAME→IDNRK` 关系构建映射，递归展开，从以 `SBB` 开头的根开始；`visited` 集合**路径级拦环**避免死循环。`MENGE_PATH` 为沿路径的乘积（缺失按 1）。
- **叶子识别**：`叶子 = IDNRK ∉ 所有 NAME 集合`；若存在 `MENGE_PATH`，则将其作为叶子层 `MENGE`。
- **替代料扁平化（ALPGR）**：以 `(bomroot, NAME, ALPGR)` 分组，将同组多个 `IDNRK` 扁平到同一行：第一个为 `CHILD`，其他依次命名 `substitute_i`。

8.2 SBB 订单与 SFG 扣减

- **订单聚合**：将 Dixon MFG PO 按 MTM 汇总，再与 `MTM_SBB_mapping` 的数量相乘得到 `订单用量`。
- **SFG 扣减逻辑**：
  - 仅保留 **ACTIVE_LOCATIONS** 白名单的 SFG 库存；
  - 若提供 `SFG_SBB_Mapping`，则以该映射将 SFG 库存归集到 SBB；否则尝试直接按 SBB 列汇总；
  - 对同一 SBB 的订单行**顺序扣减**剩余 SFG 数量，直到耗尽或订单清零。 

8.3 组合级需求与库存匹配（MRP5.1）

- **需求计算**：`MENGE_times_MFG_PO_Qty = 叶子MENGE × SBB订单量`。
- **combo_key 规范化**：将 `CHILD + substitute_i` 去空→去重→排序→拼接为键，支持跨行聚合与去重。
- **白名单库位聚合**：仅统计 `ACTIVE_LOCATIONS` 的 `ODM QTY`。
- **跨行去重扣减**：为避免同一 PN 被多个需求行重复使用，构建**可变“剩余库存”字典**，对每个需求键顺序扣减相关 PN 的库存，并将被使用的 PN 库存置零。输出 `Dixon_inv_Qty`。
8.4 Open PO 合并与净需求（MRP5.2）

- **Open PO 聚合**：按 `ALT Customer PN` 汇总 `Total`；在组合键的遍历中引入 `used_pns` 集合，**跨行去重**避免重复加总。
- **BPS 与净需求**：`BPS = MENGE_times_MFG_PO_Qty - Dixon_inv_Qty`；`net_dmd_result = BPS - Dixon_Open_PO_Qty`。

8.5 ETA 增强与回写

- **ETA 规则**：`air → +2 weeks`、`sea → +6 weeks`（无法识别则 `TBC`）。  
- **描述/机型回写**：每条 `ALT Customer PN` 的 `Description` 取第一条非空；`Model` 去重后拼接。  
- **防重复分配**：构建 `eta_pivot` 后对每个 ETA 列维护 `used_qty`，确保在遍历组合键时**不重复分配**。对过期 ETA 列的数量先行扣减至 `Dixon_Open_PO_Qty` 再重算净需求。  

8.6 ATB（总量 & 按日增量投放）

- **总量池**：根据是否存在有效 ETA 列，优先使用 `inv + eta_sum` 构成总量供给池；若全部 ETA 超出截止或无效，则**回退**为 `inv + open_po`。按 combo_key 聚合。  
- **单位需求**：从 BOM 叶子表得到每个（SBB, combo_key）在单位构建量下的需求 `unit_need = MENGE × unit_build_qty`。  
- **约束 ATB**：对每个 SBB 的所有 combo_key 计算 `floor(supply_total / unit_need)` 的**最小值**作为 SBB 的 ATB 台数（整体受最短板约束）。  
- **下一台缺口**：`Next_Unit_Shortage = max(0, next_unit_target - (inv_available + eta_available))`。并输出诊断表（覆盖率与未匹配键样本）。  
- **按日增量投放**：库存自 `start_date` 起可用，ETA 自（列日期+1天）起计入累积供给，先计算 `ATB_cum` 再取逐日差分得到 `ATB_units`（drop-once 增量）。可进一步折算到 MTM 层。  


**附录**：完整字段字典请见 `DataDictionary.xlsx`。
