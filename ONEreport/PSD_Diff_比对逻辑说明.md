# Compare PSD Diff V3.2 — 比对逻辑说明

## 一、数据源

| 端 | 文件模式 | 格式 |
|----|---------|------|
| A端 | `MFG_BACKLOG_DETAIL*.xlsx` | Lenovo 内部 Backlog |
| B端 | `NB_MAIN_RPT_FINAL_PSD*.csv` | PSD 报表 |

---

## 二、数据预处理与对齐

### 2.1 字段映射（自动识别）

两端列名不同，通过候选列表自动映射：

| 逻辑字段 | A端候选 | B端候选 |
|---------|---------|---------|
| PO | `MFG PO` | `PO` |
| PO Item | `MFG PO Item` | `PO Item` / `PO_ITEM` |
| SO | `SO` / `MFG SO` | `SO` |
| SO Item | `SO Item` / `MFG SO Item` | `SO Item` / `SO_ITEM` |
| QTY | `Line Qty` | `Planned QTY` / `PLANNED_QTY` |
| Hold | `Hold Code` → `CP Hold`（fallback） | `Lenovo Hold` / `HOLD` |
| Site | `Site` | `SiteID` / `Site` |

### 2.2 匹配键构造

```
KEY_PO         = PO  | PO_ITEM     （去前导零；B端额外去除 @\d{1,3} 后缀）
KEY_SO         = SO  | SO_ITEM     （去前导零）
KEY_PO_SO_XREF = KEY_SO | KEY_PO
```

**关键清洗规则**：

- **PO Item 去前导零**：`0010` → `10`，但纯零保留 `000` → `0`
- **B端 PO 去后缀**：去除末尾的 `@数字`（如 `PO123@2` → `PO123`），因为 PSD 中 PO 可能带行号后缀

### 2.3 聚合方式

按 `KEY_PO` 做 `groupby`，将同一 PO 下的多行合并：

- **QTY** → 求和
- **Hold** → 去重排序拼接（如 `"1/OTHERS"`）
- **SO** → 收集为 set（用于 PO-SO 关系比对）

A/B 两端做 **outer merge**，产生三种匹配状态：

| 匹配状态 | 含义 | 业务语义 |
|---------|------|---------|
| `MATCHED_BY_PO` | 两端都有 | PO 匹配成功 |
| `UNMATCHED_IN_B` | A有B无 | Missing in PSD |
| `UNMATCHED_IN_A` | B有A无 | Extra in PSD |

---

## 三、三大比对维度

匹配上的 PO，逐维度判定是否一致：

### 3.1 数量比对（QTY）

```
PLANNED_QTY_MATCH = |PLANNED_QTY_A - PLANNED_QTY_B| ≤ 0.0001
```

- 容差 `QTY_TOL = 0.0001`，避免浮点精度误报
- 差异方向 `QTY_DIRECTION`：`BACKLOG_GT_PSD` / `PSD_GT_BACKLOG`
- 差异百分比 = `DIFF / QTY_A`

### 3.2 Hold 状态比对

采用 **三层标准化** 逐步收敛：

| 层级 | 处理 | 示例 |
|------|------|------|
| 第1层 `clean_text` | 去空、去 NaN 别名 | `None` → `""` |
| 第2层 `hold_normalize_raw` | 数值格式统一 | `"1.0"` → `"1"` |
| 第3层 `hold_normalize_final` | 大写 + 别名映射 | `E30/E11/OTHER/OTHERS` → `OTHERS` |

**A端 Hold 取值优先级**：`Hold Code` 优先，为空时 fallback 到 `CP Hold`。

比对时用第3层标准化结果：`HOLD_A_STD == HOLD_B_STD`

### 3.3 PO-SO 关系比对

同一 PO 下的 SO 集合是否一致：

```
PO_SO_REL_MATCH = (SO_SET_A == SO_SET_B)
```

并输出差异明细：

- `SO_MISSING_IN_PSD`：A端有但B端没有的 SO（集合差 A − B）
- `SO_EXTRA_IN_PSD`：B端有但A端没有的 SO（集合差 B − A）

---

## 四、差异分类与输出

### 4.1 ISSUE_TYPE 派生

每个匹配上的 PO 统计有几个维度不匹配（0~3），然后按优先级分派：

| 优先级 | ISSUE_TYPE | 判定条件 | 业务含义 |
|-------|-----------|---------|---------|
| 1 | `DATA_MISSING` | `UNMATCHED_IN_B` | A端有，PSD 中不存在 |
| 2 | `DATA_EXTRA` | `UNMATCHED_IN_A` | PSD 中多出的 PO |
| 3 | `MULTI` | `ISSUE_COUNT ≥ 2` | 两个及以上维度同时不匹配 |
| 4 | `MAPPING` | 仅 PO-SO 关系不匹配 | PO-SO 关系错误 |
| 5 | `QUANTITY` | 仅数量不匹配 | 纯数量差异 |
| 6 | `STATUS` | 仅 Hold 不匹配 | 纯 Hold 状态差异 |

### 4.2 输出 Sheet

| Sheet | 含义 | 分类规则 |
|-------|------|---------|
| SUMMARY | 总览统计 | 汇总各分类行数 + Breakdown 分布 |
| MISSING_IN_PSD | A有B无 | `MATCH_STATUS == UNMATCHED_IN_B` |
| EXTRA_IN_PSD | B有A无 | `MATCH_STATUS == UNMATCHED_IN_A` |
| DIFF_QTY | 仅数量不匹配 | QTY✗ 且 Hold✓ 且 PO-SO✓ |
| DIFF_HOLD | 仅 Hold 不匹配 | Hold✗ 且 QTY✓ 且 PO-SO✓ |
| DIFF_PO_SO | 仅 PO-SO 关系不匹配 | PO-SO✗ 且 QTY✓ 且 Hold✓ |
| DIFF_MULTI | 两维度以上不匹配 | 不匹配维度数 ≥ 2 |
| TOP_PO_ISSUES | TOP 100 问题 PO | 按 SCORE 降序排列 |

**分类互斥性**：`MISSING + EXTRA + DIFF_QTY + DIFF_HOLD + DIFF_PO_SO + DIFF_MULTI = 总差异行数`（QA 断言验证）

### 4.3 SUMMARY 表结构

SUMMARY 包含以下指标分组：

| 分组 | 指标 |
|------|------|
| 文件信息 | A file / B file |
| 总量统计 | Total KEY_PO / Diff KEY_PO / Match Rate |
| Breakdown（与 Sheet 名一致） | Breakdown MISSING_IN_PSD / EXTRA_IN_PSD / DIFF_QTY / DIFF_HOLD / DIFF_PO_SO / DIFF_MULTI |
| 汇总维度 | Missing in PSD / Extra in PSD / Qty mismatch (any) / Hold mismatch (any) / PO-SO mapping error (any) |
| 过滤信息 | A rows filtered by MFG Ship Date |
| QTY 总量 | A qty total / B qty total / A/B qty total diff |

---

## 五、TOP_PO_ISSUES 排序逻辑

SCORE 公式：

```
SCORE = |QTY_DIFF| + ISSUE_COUNT × 100 + (未匹配) × 1000
```

| 权重因子 | 分值 | 含义 |
|---------|------|------|
| 未匹配（Missing / Extra） | +1000 | PO 端缺失，问题最严重 |
| 多维度不匹配 | 每维度 +100 | 维度越多问题越复杂 |
| 数量差异绝对值 | +\|QTY_DIFF\| | 数量偏差作为基数 |

取 TOP 100 按 SCORE 降序输出，输出列包含：

| 列 | 说明 |
|----|------|
| KEY_PO | PO + PO Item 复合索引 |
| KEY_SO | SO + SO Item 复合索引 |
| SITE_A / SITE_B | 两端 Site |
| PRIMARY_ISSUE / DIFF_REASON | 业务/技术差异原因 |
| ISSUE_TYPE / QTY_DIRECTION | 差异类型与数量方向 |
| PLANNED_QTY_A / B / DIFF / DIFF_PCT | 数量明细 |
| HOLD_A_STD / HOLD_B_STD | 标准化 Hold |
| SO_MISSING_IN_PSD / SO_EXTRA_IN_PSD | SO 集合差异 |
| ISSUE_COUNT / SCORE | 严重度评分 |
| A_ROW_FIRST / B_ROW_FIRST | 原始行号定位 |

---

## 六、预过滤

比对前有两层过滤：

1. **多维度筛选**：运行时弹窗选择 Site / Product Group / Brand / Geo（也可通过 `SITE_FILTER` 预配置），**必须经过筛选确认后才会执行比对**
2. **MFG Ship Date 过滤**：`ENABLE_MFG_SHIPDATE_FILTER=True` 时，剔除 A端 Ship Date 早于当月1日的行（历史数据不入比对）

---

## 七、QA 验证

QA 共 6 项断言，均为**逻辑自洽性校验**——不验证业务对错，而是确保代码产出的各列之间没有矛盾：

| 验证项 | 核心关注 | 说明 |
|-------|---------|------|
| DIFF_REASON 非空 | 差异可追溯 | 每条 `IS_DIFF=True` 的行必须标注差异原因 |
| Hold 别名映射 | 标准化逻辑正确 | E30/E11/OTHER/OTHERS 必须统一映射为 OTHERS |
| Unmatched 维度标记为 NA | 比对范围不越界 | 未匹配 PO 的 HOLD_MATCH 和 PO_SO_REL_MATCH 只能为 NA |
| Sheet 分区求和 | 分类互斥且穷尽 | 6 类差异行数之和 = 总差异行数 |
| IS_DIFF 一致性 | 标记无矛盾 | 从原始匹配结果重算 IS_DIFF，与实际值一致 |
| ISSUE_TYPE 一致性 | 派生逻辑无矛盾 | 按相同优先级规则重推 ISSUE_TYPE，与实际值一致 |
