#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ATB2_A_robust_patched.py

新增/关键口径
------------
1) combo_key 强制规范化（BOM/Net 双侧）：CHILD + substitute_1..14 → 去空→去重→排序→拼接。
2) 供给：库存优先 → ETA（有 ETA 时不再叠加 OpenPO；无有效 ETA 回退 OpenPO）。
3) ATB（总量版）：含 inv/eta 分项与 ATB+1 台缺口。
4) ATB（按日期展开）：
   - 库存 inv 从 start_date（默认=今天）起即可用；
   - 每个 ETA 列数量从（列日期 + 1 天）起计入累计供给；
   - 【本次新增】SBB/MTM 的按日 ATB表采用“增量投放（drop-once）”：
       只在首次达到或提升 ATB 的当天投放该增量，后续不重复。

输入
----
- BOM: DIXON+BOM+all_bom_leaf.xlsx（含 bomroot/SBB、CHILD、substitute_1..14、MENGE）
- MTM: MTM_SBB_mapping.xlsx（含 MTM、SBB、Qty）
- Net: Net_BPSONS_ETA_*.xlsx（含 CHILD、substitute_1..14、Dixon_inv_Qty、Dixon_Open_PO_Qty、若干 ETA 列：YYYY-MM-DD）

输出
----
- output/ATB_SBB.xlsx：
  - Unit_Demand / Supply_Pool / ATB_SBB / Next_Unit_Shortage
  - ATB_SBB_byDate（按日“增量投放”）
  - ATB_SBB_byDate_cum（按日“累计能力”，用于复核）
  - Key_Coverage / Unmatched_Keys
- output/ATB_MTM.xlsx：MTM 总量 ATB
- output/ATB_MTM_detail.xlsx：MTM-SBB 折算明细（总量）
- output/ATB_MTM_byDate.xlsx：
  - ATB_MTM_byDate（按日“增量投放”）
  - ATB_MTM_byDate_cum（按日“累计能力”）
- output/_warnings.log：清洗/兼容性告警

CLI
---
python ATB2_A_robust_patched.py \
  --bom "DIXON+BOM+all_bom_leaf.xlsx" \
  --mtm "MTM_SBB_mapping.xlsx" \
  --net "Net_BPSONS_ETA_20250910.xlsx" \
  --start_date 2025-09-23 \
  --end_date 2025-10-31 \
  --eta_cutoff 2099-12-31 \
  --unit_build_qty 1 \
  --outdir output
"""

from __future__ import annotations
import argparse
import os
import json
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
import pandas as pd
import numpy as np

pd.set_option('display.max_columns', 200)

# 工具
# -------------------------------
def norm_col(s: str) -> str:
    return (
        str(s).strip().replace("\n", " ").replace("\r", " ")
        .replace(" ", "_").replace("/", "_").replace("\\", "_")
        .lower()
    )

class Warn:
    def __init__(self):
        self._buf: List[str] = []
    def add(self, msg: str):
        self._buf.append(msg)
    def dump(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write("\n".join(self._buf))

def read_excel_any(path: str, warn: Warn) -> pd.DataFrame:
    df = pd.read_excel(path, dtype=str)
    df.columns = [norm_col(c) for c in df.columns]
    df = df.loc[:, ~df.columns.duplicated()]
    return df

def pick_col(cols: List[str], candidates: List[str]) -> Optional[str]:
    cset = set(cols)
    for c in candidates:
        if c in cset:
            return c
    return None

def as_num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors='coerce').fillna(0)

@dataclass
class Config:
    eta_cutoff: Optional[pd.Timestamp] = None
    unit_build_qty: float = 1.0
    outdir: str = "output"
    start_date: Optional[pd.Timestamp] = None
    end_date: Optional[pd.Timestamp] = None

# -------------------------------
# combo_key 规范化（核心）
# -------------------------------
def normalize_combo_key(s: str) -> str:
    items = [x.strip() for x in str(s or "").split(",")]
    items = [x for x in items if x]
    items = sorted(set(items))
    return ",".join(items)

def rebuild_combo_key_for_df(df: pd.DataFrame, child_col: str) -> pd.Series:
    subs_cols = [c for c in df.columns if c.startswith('substitute')]
    keys = []
    for _, r in df.iterrows():
        alts = []
        base = str(r.get(child_col, "")).strip()
        if base and base.lower() != "nan":
            alts.append(base)
        for c in subs_cols:
            v = str(r.get(c, "")).strip()
            if v and v.lower() != "nan":
                alts.append(v)
        keys.append(normalize_combo_key(",".join(alts)))
    return pd.Series(keys, index=df.index, name='combo_key')

# -------------------------------
# 列统一 & 识别 ETA 列
# -------------------------------
def find_eta_date_cols(df_net: pd.DataFrame) -> List[str]:
    date_cols = []
    for c in df_net.columns:
        try:
            cs = str(c)
            if len(cs) >= 8 and cs[4] == '-' and cs[7] == '-':
                pd.to_datetime(cs, errors='raise')
                date_cols.append(cs)
        except Exception:
            pass
    return sorted(date_cols)

def unify_columns(df_bom: pd.DataFrame, df_mtm: pd.DataFrame, df_net: pd.DataFrame, warn: Warn):
    bom_root_col = pick_col(df_bom.columns, ['bomroot', 'sbb', 'root', 'sbb_root'])
    if bom_root_col is None:
        warn.add('[BOM] 未找到 SBB/bomroot 列，创建占位列')
        bom_root_col = 'bomroot_missing'
        df_bom[bom_root_col] = np.nan

    child_col = pick_col(df_bom.columns, ['child', 'leaf', 'component', 'pn', 'material'])
    if child_col is None:
        raise ValueError('BOM 缺少 CHILD/叶子料列')

    menge_col = pick_col(df_bom.columns, ['menge', 'qty_per', 'usage', 'quantity'])
    if menge_col is None:
        warn.add('[BOM] 未找到 MENGE（每台用量），默认按1处理')
        menge_col = 'menge_fallback'
        df_bom[menge_col] = 1

    mtm_col = pick_col(df_mtm.columns, ['mtm'])
    sbb_col = pick_col(df_mtm.columns, ['sbb'])
    if sbb_col is None:
        warn.add('[MTM] 未找到 SBB 列，创建占位列')
        sbb_col = 'sbb_missing'
        df_mtm[sbb_col] = np.nan

    mtm_qty_col = pick_col(df_mtm.columns, ['qty', 'mtm_qty'])
    if mtm_qty_col is None:
        warn.add('[MTM] 未找到 Qty 列（MTM使用SBB数量），默认=1')
        mtm_qty_col = 'qty_fallback'
        df_mtm[mtm_qty_col] = 1

    net_child_col = pick_col(df_net.columns, ['child'])
    if net_child_col is None:
        warn.add('[NET] 未找到 CHILD 列，创建占位列')
        net_child_col = 'child_missing'
        df_net[net_child_col] = np.nan

    inv_col = pick_col(df_net.columns, ['dixon_inv_qty', 'inv', 'inventory', 'onhand'])
    if inv_col is None:
        df_net['dixon_inv_qty'] = 0
        inv_col = 'dixon_inv_qty'
        warn.add('[NET] 未找到库存列，按0处理')

    opo_col = pick_col(df_net.columns, ['dixon_open_po_qty', 'open_po', 'openpo', 'open_po_qty'])
    if opo_col is None:
        df_net['dixon_open_po_qty'] = 0
        opo_col = 'dixon_open_po_qty'
        warn.add('[NET] 未找到Open PO列，按0处理')

    date_cols = find_eta_date_cols(df_net)

    return {
        'bom_root': bom_root_col,
        'bom_child': child_col,
        'bom_menge': menge_col,
        'mtm_mtm': mtm_col,
        'mtm_sbb': sbb_col,
        'mtm_qty': mtm_qty_col,
        'net_child': net_child_col,
        'net_inv': inv_col,
        'net_opo': opo_col,
        'net_dates': date_cols,
    }

# -------------------------------
# 供给池（总量）
# -------------------------------
def build_supply_pool(df_net: pd.DataFrame, cols: Dict[str, str], cfg: Config, warn: Warn) -> pd.DataFrame:
    work = df_net.copy()
    work['combo_key'] = rebuild_combo_key_for_df(work, cols['net_child'])
    work['_inv'] = as_num(work[cols['net_inv']])
    work['_opo'] = as_num(work[cols['net_opo']])

    eta_cols = cols['net_dates']
    eta_sum = None
    if eta_cols:
        eta_list = []
        for dc in eta_cols:
            try:
                d = pd.to_datetime(dc)
                if cfg.eta_cutoff is not None and d > cfg.eta_cutoff:
                    continue
            except Exception:
                pass
            eta_list.append(as_num(work[dc]))
        if eta_list:
            eta_sum = sum(eta_list)

    if eta_sum is not None:
        work['inv_available'] = work['_inv']
        work['eta_available'] = eta_sum
        work['supply_total'] = work['inv_available'] + work['eta_available']
    else:
        work['inv_available'] = work['_inv']
        work['eta_available'] = work['_opo']
        work['supply_total'] = work['inv_available'] + work['eta_available']
        if cols['net_dates']:
            warn.add('[NET] 发现 ETA 列但均超出 cutoff 或无法解析，回退用 OpenPO 代表在途。')

    pool = (
        work.groupby('combo_key', as_index=False)[['inv_available','eta_available','supply_total']]
            .sum()
    )
    return pool

# -------------------------------
# 供给池（按日期）
# -------------------------------
def build_supply_pool_timeseries(
    df_net: pd.DataFrame,
    cols: Dict[str, str],
    cfg: Config,
    start_date: Optional[pd.Timestamp] = None,
    end_date: Optional[pd.Timestamp] = None,
    warn: Optional[Warn] = None,
) -> pd.DataFrame:
    work = df_net.copy()
    work['combo_key'] = rebuild_combo_key_for_df(work, cols['net_child'])

    if start_date is None:
        start_date = pd.Timestamp.today().normalize()

    work['_inv'] = as_num(work[cols['net_inv']])
    work['_opo'] = as_num(work[cols['net_opo']])

    eta_cols = cols['net_dates']
    eta_long = []
    if eta_cols:
        for dc in eta_cols:
            try:
                d = pd.to_datetime(dc)
            except Exception:
                continue
            if cfg.eta_cutoff is not None and d > cfg.eta_cutoff:
                continue
            qty = as_num(work[dc])
            if (qty > 0).any():
                tmp = pd.DataFrame({
                    'combo_key': work['combo_key'],
                    'date': d + pd.Timedelta(days=1),  # ETA+1
                    'qty': qty
                })
                eta_long.append(tmp)
    if eta_long:
        eta = pd.concat(eta_long, ignore_index=True)
        eta = eta.groupby(['combo_key','date'], as_index=False)['qty'].sum()
    else:
        if warn is not None and cols['net_dates']:
            warn.add('[NET] 未发现有效 ETA（均超 cutoff 或为空），将 OpenPO 视为 start_date+1 到货。')
        eta = pd.DataFrame({
            'combo_key': work['combo_key'],
            'date': start_date + pd.Timedelta(days=1),
            'qty': work['_opo']
        })
        eta = eta.groupby(['combo_key','date'], as_index=False)['qty'].sum()

    if end_date is None:
        end_date = max(start_date, eta['date'].max() if not eta.empty else start_date)

    all_keys = pd.Index(sorted(work['combo_key'].unique()), name='combo_key')
    date_index = pd.date_range(start_date, end_date, freq='D', name='date')
    base = pd.MultiIndex.from_product([all_keys, date_index], names=['combo_key','date'])
    ts = pd.DataFrame(index=base).reset_index()

    inv_df = work.groupby('combo_key', as_index=False)['_inv'].sum().rename(columns={'_inv':'inv'})
    ts = ts.merge(inv_df, on='combo_key', how='left').fillna({'inv': 0})
    ts['inv_cum'] = np.where(ts['date'] >= start_date, ts['inv'], 0)

    if not eta.empty:
        ts = ts.merge(eta, on=['combo_key','date'], how='left').fillna({'qty': 0})
    else:
        ts['qty'] = 0
    ts['eta_cum'] = ts.groupby('combo_key', sort=False)['qty'].cumsum()

    ts['supply_cum'] = ts['inv_cum'] + ts['eta_cum']
    return ts[['combo_key','date','supply_cum']]

# -------------------------------
# 单台需求
# -------------------------------
def build_unit_demand(df_bom: pd.DataFrame, cols: Dict[str, str], cfg: Config) -> pd.DataFrame:
    b = df_bom.copy()
    b['combo_key'] = rebuild_combo_key_for_df(b, cols['bom_child'])
    menge = as_num(b[cols['bom_menge']]) * float(cfg.unit_build_qty)
    b['unit_need'] = menge

    sbb_col = cols['bom_root']
    unit_dmd = (
        b.groupby([sbb_col, 'combo_key'], as_index=False)[['unit_need']]
         .sum()
    )
    return unit_dmd.rename(columns={sbb_col: 'sbb'})

# -------------------------------
# ATB（总量）
# -------------------------------
def calc_atb_sbb(unit_dmd: pd.DataFrame, pool: pd.DataFrame, cfg: Config) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    df = unit_dmd.merge(pool, on='combo_key', how='left')
    for c in ['supply_total','inv_available','eta_available']:
        df[c] = df.get(c, 0).fillna(0)

    df['unit_need'] = df['unit_need'].replace(0, np.nan)
    df['constraint_atb'] = np.floor(df['supply_total'] / df['unit_need'])
    df['constraint_atb'] = df['constraint_atb'].replace([np.inf, -np.inf], 0).fillna(0)

    atb_sbb = df.groupby('sbb', as_index=False)[['constraint_atb']].min()
    atb_sbb = atb_sbb.rename(columns={'constraint_atb': 'ATB_units'})

    df = df.merge(atb_sbb, on='sbb', how='left')
    df['demand_at_ATB'] = df['unit_need'] * df['ATB_units']
    df['inv_used_at_ATB'] = np.minimum(df['inv_available'], df['demand_at_ATB'])
    df['eta_used_at_ATB'] = np.minimum(df['eta_available'], np.maximum(0, df['demand_at_ATB'] - df['inv_used_at_ATB']))

    df['next_unit_target'] = (df['ATB_units'] + 1) * df['unit_need']
    df['Next_Unit_Shortage'] = (df['next_unit_target'] - (df['inv_available'] + df['eta_available'])).clip(lower=0)
    shortage = df.loc[
        df['Next_Unit_Shortage'] > 0,
        ['sbb', 'combo_key', 'unit_need', 'inv_available', 'eta_available', 'ATB_units', 'Next_Unit_Shortage']
    ]

    sum_cols = df.groupby('sbb', as_index=False)[['inv_available','eta_available','supply_total']].sum()
    atb_sbb = atb_sbb.merge(sum_cols, on='sbb', how='left')

    unit_keys = set(df['combo_key'].astype(str))
    pool_keys = set(pool['combo_key'].astype(str))
    matched = len(unit_keys & pool_keys)
    coverage = matched / max(1, len(unit_keys))
    diag_metrics = pd.DataFrame({
        'metric': ['unit_groups','pool_groups','matched','coverage'],
        'value': [len(unit_keys), len(pool_keys), matched, round(coverage,4)]
    })
    diag_misses = pd.DataFrame({'unmatched_combo_key_sample': list(unit_keys - pool_keys)[:50]})

    return atb_sbb, shortage, diag_metrics, diag_misses

# -------------------------------
# ATB（按日期 → 增量投放）
# -------------------------------
def calc_atb_sbb_by_date(
    unit_dmd: pd.DataFrame,
    pool_ts: pd.DataFrame,
    cfg: Config
) -> pd.DataFrame:
    """
    返回列：
      - sbb / date / ATB_units（增量投放，drop-once）
      - ATB_cum（累计能力，便于复核）
    """
    df = unit_dmd.merge(pool_ts, on='combo_key', how='left')
    df['supply_cum'] = df['supply_cum'].fillna(0)
    df['unit_need'] = df['unit_need'].replace(0, np.nan)
    df['constraint_atb'] = np.floor(df['supply_cum'] / df['unit_need'])
    df['constraint_atb'] = df['constraint_atb'].replace([np.inf,-np.inf], 0).fillna(0)

    sbb_cum = (
        df.groupby(['sbb','date'], as_index=False)[['constraint_atb']]
          .min()
          .rename(columns={'constraint_atb':'ATB_cum'})
    )
    # 增量投放：当日投放 = 当日累计 - 昨日累计（首日直接等于当日累计），后续不重复
    sbb_cum = sbb_cum.sort_values(['sbb','date'])
    sbb_cum['ATB_units'] = sbb_cum.groupby('sbb')['ATB_cum'].diff().fillna(sbb_cum['ATB_cum'])
    sbb_cum['ATB_units'] = sbb_cum['ATB_units'].clip(lower=0)
    # 转为整数
    sbb_cum['ATB_cum'] = sbb_cum['ATB_cum'].astype(int)
    sbb_cum['ATB_units'] = sbb_cum['ATB_units'].astype(int)
    return sbb_cum[['sbb','date','ATB_units','ATB_cum']]

# -------------------------------
# MTM 折算（总量/按日）
# -------------------------------
def attach_mtm(atb_sbb: pd.DataFrame, df_mtm: pd.DataFrame, cols: Dict[str, str]) -> Tuple[pd.DataFrame, pd.DataFrame]:
    m = df_mtm[[cols['mtm_mtm'], cols['mtm_sbb'], cols['mtm_qty']]].drop_duplicates()
    m = m.rename(columns={cols['mtm_mtm']: 'MTM', cols['mtm_sbb']: 'sbb', cols['mtm_qty']: 'MTM_SBB_Qty'})
    m['MTM_SBB_Qty'] = as_num(m['MTM_SBB_Qty']).replace(0, np.nan).fillna(1)

    joined = m.merge(atb_sbb, on='sbb', how='left')
    joined['ATB_units'] = as_num(joined['ATB_units'])
    joined['MTM_SBB_Qty'] = as_num(joined['MTM_SBB_Qty']).replace(0, np.nan)

    joined['SBB_to_MTM_ATB'] = np.floor(joined['ATB_units'] / joined['MTM_SBB_Qty'])
    mtm_atb = joined.groupby('MTM', as_index=False)[['SBB_to_MTM_ATB']].min()
    mtm_atb = mtm_atb.rename(columns={'SBB_to_MTM_ATB': 'MTM_ATB_units'})
    detail = joined[['MTM','sbb','MTM_SBB_Qty','ATB_units','SBB_to_MTM_ATB']]
    return mtm_atb, detail

def attach_mtm_by_date(
    sbb_by_date: pd.DataFrame,   # 包含 ATB_units(增量) 与 ATB_cum
    df_mtm: pd.DataFrame,
    cols: Dict[str, str]
) -> pd.DataFrame:
    """
    输出：
      - MTM / date / MTM_ATB_units（增量投放，drop-once） / MTM_ATB_cum（累计能力）
    """
    m = df_mtm[[cols['mtm_mtm'], cols['mtm_sbb'], cols['mtm_qty']]].drop_duplicates()
    m = m.rename(columns={cols['mtm_mtm']: 'MTM', cols['mtm_sbb']: 'sbb', cols['mtm_qty']: 'MTM_SBB_Qty'})
    m['MTM_SBB_Qty'] = as_num(m['MTM_SBB_Qty']).replace(0, np.nan).fillna(1)

    # 用 SBB 的“累计能力”来折算 MTM 的累计能力，再转为增量投放
    joined_cum = sbb_by_date.merge(m, on='sbb', how='left')
    joined_cum['ATB_cum'] = as_num(joined_cum['ATB_cum'])
    joined_cum['MTM_SBB_Qty'] = as_num(joined_cum['MTM_SBB_Qty']).replace(0, np.nan)
    joined_cum['SBB_to_MTM_ATB_cum'] = np.floor(joined_cum['ATB_cum'] / joined_cum['MTM_SBB_Qty'])

    mtm_cum = (
        joined_cum.groupby(['MTM','date'], as_index=False)[['SBB_to_MTM_ATB_cum']]
                  .min()
                  .rename(columns={'SBB_to_MTM_ATB_cum':'MTM_ATB_cum'})
    )
    mtm_cum = mtm_cum.sort_values(['MTM','date'])
    mtm_cum['MTM_ATB_units'] = mtm_cum.groupby('MTM')['MTM_ATB_cum'].diff().fillna(mtm_cum['MTM_ATB_cum'])
    mtm_cum['MTM_ATB_units'] = mtm_cum['MTM_ATB_units'].clip(lower=0)
    mtm_cum['MTM_ATB_cum'] = mtm_cum['MTM_ATB_cum'].astype(int)
    mtm_cum['MTM_ATB_units'] = mtm_cum['MTM_ATB_units'].astype(int)
    return mtm_cum[['MTM','date','MTM_ATB_units','MTM_ATB_cum']]

# -------------------------------
# 主流程
# -------------------------------
def run(bom_path: str, mtm_path: str, net_path: str, cfg: Config) -> Dict[str, str]:
    os.makedirs(cfg.outdir, exist_ok=True)
    warn = Warn()

    df_bom = read_excel_any(bom_path, warn)
    df_mtm = read_excel_any(mtm_path, warn)
    df_net = read_excel_any(net_path, warn)

    cols = unify_columns(df_bom, df_mtm, df_net, warn)

    # 总量版
    pool = build_supply_pool(df_net, cols, cfg, warn)
    unit_dmd = build_unit_demand(df_bom, cols, cfg)
    atb_sbb, shortage, diag_metrics, diag_misses = calc_atb_sbb(unit_dmd, pool, cfg)
    mtm_atb, mtm_detail = attach_mtm(atb_sbb, df_mtm, cols)

    # 按日期版（库存从 start_date 起可用；ETA 从(日期+1)起可用）
    pool_ts = build_supply_pool_timeseries(
        df_net, cols, cfg,
        start_date=cfg.start_date, end_date=cfg.end_date, warn=warn
    )
    sbb_by_date = calc_atb_sbb_by_date(unit_dmd, pool_ts, cfg)           # 含 ATB_units(增量) 与 ATB_cum
    mtm_by_date = attach_mtm_by_date(sbb_by_date, df_mtm, cols)          # 含 MTM_ATB_units(增量) 与 MTM_ATB_cum

    # 输出路径
    p_sbb = os.path.join(cfg.outdir, 'ATB_SBB.xlsx')
    p_mtm = os.path.join(cfg.outdir, 'ATB_MTM.xlsx')
    p_mtm_detail = os.path.join(cfg.outdir, 'ATB_MTM_detail.xlsx')
    p_mtm_bydate = os.path.join(cfg.outdir, 'ATB_MTM_byDate.xlsx')
    p_warn = os.path.join(cfg.outdir, '_warnings.log')

    # 写 SBB 汇总与诊断 + 按日
    with pd.ExcelWriter(p_sbb, engine='openpyxl') as w:
        unit_dmd.to_excel(w, index=False, sheet_name='Unit_Demand')
        pool.to_excel(w, index=False, sheet_name='Supply_Pool')
        atb_sbb.to_excel(w, index=False, sheet_name='ATB_SBB')
        shortage.to_excel(w, index=False, sheet_name='Next_Unit_Shortage')

        # 按日：增量投放与累计能力
        sbb_by_date[['sbb','date','ATB_units']].to_excel(w, index=False, sheet_name='ATB_SBB_byDate')
        #sbb_by_date[['sbb','date','ATB_cum']].to_excel(w, index=False, sheet_name='ATB_SBB_byDate_cum')

        # 诊断
        diag_metrics.to_excel(w, index=False, sheet_name='Key_Coverage')
        diag_misses.to_excel(w, index=False, sheet_name='Unmatched_Keys')

    # 写 MTM 层（总量 + 按日）
    mtm_atb.to_excel(p_mtm, index=False)
    mtm_detail.to_excel(p_mtm_detail, index=False)

    with pd.ExcelWriter(p_mtm_bydate, engine='openpyxl') as w:
        mtm_by_date[['MTM','date','MTM_ATB_units']].to_excel(w, index=False, sheet_name='ATB_MTM_byDate')
        #mtm_by_date[['MTM','date','MTM_ATB_cum']].to_excel(w, index=False, sheet_name='ATB_MTM_byDate_cum')

    warn.dump(p_warn)

    return {
        'ATB_SBB': p_sbb,
        'ATB_MTM': p_mtm,
        'ATB_MTM_detail': p_mtm_detail,
        'ATB_MTM_byDate': p_mtm_bydate,
        'WARN': p_warn
    }

# -------------------------------
# CLI
# -------------------------------
def parse_args(argv: Optional[List[str]] = None):
    p = argparse.ArgumentParser(description='ATB2 方案A 稳健版（库存优先→ETA + combo_key 规范化 + 按日增量投放）')
    p.add_argument('--bom', required=True, help='DIXON+BOM+all_bom_leaf.xlsx')
    p.add_argument('--mtm', required=True, help='MTM_SBB_mapping.xlsx')
    p.add_argument('--net', required=True, help='Net_BPSONS_ETA_*.xlsx')
    p.add_argument('--start_date', default=None, help='按日展开起始日（YYYY-MM-DD），默认=今天')
    p.add_argument('--end_date', default=None, help='按日展开截止日（YYYY-MM-DD），默认=max(ETA)+1')
    p.add_argument('--eta_cutoff', default=None, help='ETA 截止日期（YYYY-MM-DD），默认None=包含所有在途列')
    p.add_argument('--unit_build_qty', type=float, default=1.0, help='单位构建基数，默认1台（用于推导ATB）')
    p.add_argument('--outdir', default='output', help='输出目录')
    args = p.parse_args(argv)

    # 解析日期窗口
    start_date = None
    end_date = None
    if args.start_date not in (None, '', 'None', 'null'):
        try:
            start_date = pd.to_datetime(args.start_date).normalize()
        except Exception:
            print(f"[WARN] 无法解析 --start_date={args.start_date}，将使用今天")
            start_date = pd.Timestamp.today().normalize()
    if args.end_date not in (None, '', 'None', 'null'):
        try:
            end_date = pd.to_datetime(args.end_date).normalize()
        except Exception:
            print(f"[WARN] 无法解析 --end_date={args.end_date}，将使用 max(ETA)+1")
            end_date = None

    # eta_cutoff
    eta_cutoff = None
    if args.eta_cutoff not in (None, '', 'None', 'null'):
        try:
            eta_cutoff = pd.to_datetime(args.eta_cutoff)
        except Exception:
            print(f"[WARN] 无法解析 --eta_cutoff={args.eta_cutoff}，将使用默认全部在途列")
            eta_cutoff = None

    cfg = Config(
        eta_cutoff=eta_cutoff,
        unit_build_qty=args.unit_build_qty,
        outdir=args.outdir,
        start_date=start_date,
        end_date=end_date
    )
    return args, cfg

# -------------------------------
# Main
# -------------------------------

if __name__ == '__main__':
    # 1. 真实文件路径
    BOM_FILE = r"D:\Python projects\Dixon MPS\ATPCAL\DIXON+BOM+all_bom_leaf.xlsx"
    MTM_FILE = r"D:\Python projects\Dixon MPS\ATPCAL\MTM_SBB_mapping.xlsx"
    NET_FILE = r"D:\Python projects\Dixon MPS\ATPCAL\Net_BPSONS_ETA_20251017.xlsx"

    # 2. 可选参数
    ETA_CUTOFF      = "2099-12-31"   # 想截断在途日期就改
    UNIT_BUILD_QTY  = 1.0            # 计算 ATB 的基准台数
    OUTDIR          = "output"       # 输出文件夹

    # 3. 组装成 Config
    cfg = Config(
        eta_cutoff=pd.to_datetime(ETA_CUTOFF) if ETA_CUTOFF else None,
        unit_build_qty=UNIT_BUILD_QTY,
        outdir=OUTDIR
    )

    # 4. Run
    paths = run(BOM_FILE, MTM_FILE, NET_FILE, cfg)
    print(json.dumps(paths, ensure_ascii=False, indent=2))
# ------------------------------------------------------------------