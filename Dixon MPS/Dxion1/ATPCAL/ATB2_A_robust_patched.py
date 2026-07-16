#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ATB2_A_robust_patched.py — 符合“库存优先，其次 ETA（ETA=OpenPO 拆分）”的稳健版
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

def norm_col(s: str) -> str:
    return (
        s.strip().replace("\n", " ").replace("\r", " ")
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
    df.columns = [norm_col(str(c)) for c in df.columns]
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

def find_eta_date_cols(df_net: pd.DataFrame) -> List[str]:
    date_cols = []
    for c in df_net.columns:
        try:
            if len(c) >= 8 and c[4] == '-' and c[7] == '-':
                pd.to_datetime(c, errors='raise')
                date_cols.append(c)
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

def build_sub_group_key(df: pd.DataFrame) -> pd.Series:
    if 'combo_key' in df.columns:
        return df['combo_key'].fillna('')
    keys = []
    for _, r in df.iterrows():
        items = []
        base = str(r.get('child', '')).strip()
        if base and base.lower() != 'nan':
            items.append(base)
        for c in df.columns:
            if c.startswith('substitute'):
                v = str(r.get(c, '')).strip()
                if v and v.lower() != 'nan':
                    items.append(v)
        items = sorted(set(items))
        keys.append(','.join(items))
    return pd.Series(keys, index=df.index, name='combo_key')

def build_supply_pool(df_net: pd.DataFrame, cols: Dict[str, str], cfg: Config, warn: Warn) -> pd.DataFrame:
    work = df_net.copy()
    if 'combo_key' not in work.columns:
        work['combo_key'] = build_sub_group_key(work)

    inv = as_num(work[cols['net_inv']])
    opo = as_num(work[cols['net_opo']])

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

    # 维持你的口径：ETA 分布等于 Open PO 拆分，先用库存，再用 ETA
    if eta_sum is not None:
        work['inv_available'] = inv
        work['eta_available'] = eta_sum
        work['supply_total'] = work['inv_available'] + work['eta_available']
    else:
        # 无 ETA 可用时，用 OpenPO 代表在途
        work['inv_available'] = inv
        work['eta_available'] = opo
        work['supply_total'] = work['inv_available'] + work['eta_available']
        if cols['net_dates']:
            warn.add('[NET] 发现 ETA 列但均超出 cutoff 或无法解析，回退用 OpenPO 代表在途。')

    pool = (
        work.groupby('combo_key', dropna=False, as_index=False)
            [['inv_available','eta_available','supply_total']]
            .sum()
    )
    return pool

def build_unit_demand(df_bom: pd.DataFrame, cols: Dict[str, str], cfg: Config) -> pd.DataFrame:
    b = df_bom.copy()
    if 'combo_key' not in b.columns:
        tmp = []
        for _, r in b.iterrows():
            items = []
            base = str(r.get(cols['bom_child'], '')).strip()
            if base and base.lower() != 'nan':
                items.append(base)
            for c in b.columns:
                if c.startswith('substitute'):
                    v = str(r.get(c, '')).strip()
                    if v and v.lower() != 'nan':
                        items.append(v)
            items = sorted(set(items))
            tmp.append(','.join(items))
        b['combo_key'] = tmp

    menge = as_num(b[cols['bom_menge']]) * float(cfg.unit_build_qty)
    b['unit_need'] = menge

    sbb_col = cols['bom_root']
    unit_dmd = (
        b.groupby([sbb_col, 'combo_key'], dropna=False, as_index=False)[['unit_need']]
         .sum()
    )
    return unit_dmd.rename(columns={sbb_col: 'sbb'})

def calc_atb_sbb(unit_dmd: pd.DataFrame, pool: pd.DataFrame, cfg: Config) -> Tuple[pd.DataFrame, pd.DataFrame]:
    df = unit_dmd.merge(pool, on='combo_key', how='left')
    for c in ['supply_total','inv_available','eta_available']:
        df[c] = df.get(c, 0).fillna(0)
    df['unit_need'] = df['unit_need'].replace(0, np.nan)
    df['constraint_atb'] = np.floor(df['supply_total'] / df['unit_need'])
    df['constraint_atb'] = df['constraint_atb'].replace([np.inf, -np.inf], 0).fillna(0)

    atb_sbb = df.groupby('sbb', dropna=False, as_index=False)[['constraint_atb']].min()
    atb_sbb = atb_sbb.rename(columns={'constraint_atb': 'ATB_units'})

    # 库存优先、其后 ETA 的消耗拆分（在 ATB 台数下）
    df = df.merge(atb_sbb, on='sbb', how='left')
    df['demand_at_ATB'] = df['unit_need'] * df['ATB_units']
    df['inv_used_at_ATB'] = np.minimum(df['inv_available'], df['demand_at_ATB'])
    df['eta_used_at_ATB'] = np.minimum(df['eta_available'], np.maximum(0, df['demand_at_ATB'] - df['inv_used_at_ATB']))

    # 下一台缺口（ATB+1 台）
    df['next_unit_target'] = (df['ATB_units'] + 1) * df['unit_need']
    df['Next_Unit_Shortage'] = (df['next_unit_target'] - (df['inv_available'] + df['eta_available'])).clip(lower=0)
    shortage = df.loc[df['Next_Unit_Shortage'] > 0, ['sbb', 'combo_key', 'unit_need', 'inv_available', 'eta_available', 'ATB_units', 'Next_Unit_Shortage']]

    # SBB 汇总（附带供给分项，便于复核；供给分项可改为 sum，这里用 sum 更直观）
    sum_cols = df.groupby('sbb', dropna=False)[['inv_available','eta_available','supply_total']].sum().reset_index()
    atb_sbb = atb_sbb.merge(sum_cols, on='sbb', how='left')

    return atb_sbb, shortage

def attach_mtm(atb_sbb: pd.DataFrame, df_mtm: pd.DataFrame, cols: Dict[str, str]) -> pd.DataFrame:
    m = df_mtm[[cols['mtm_mtm'], cols['mtm_sbb'], cols['mtm_qty']]].drop_duplicates()
    m = m.rename(columns={cols['mtm_mtm']: 'MTM', cols['mtm_sbb']: 'sbb', cols['mtm_qty']: 'MTM_SBB_Qty'})
    m['MTM_SBB_Qty'] = as_num(m['MTM_SBB_Qty']).replace(0, np.nan).fillna(1)

    joined = m.merge(atb_sbb, on='sbb', how='left')
    joined['ATB_units'] = as_num(joined['ATB_units'])
    joined['MTM_SBB_Qty'] = as_num(joined['MTM_SBB_Qty']).replace(0, np.nan)

    joined['SBB_to_MTM_ATB'] = np.floor(joined['ATB_units'] / joined['MTM_SBB_Qty'])
    mtm_atb = joined.groupby('MTM', dropna=False, as_index=False)[['SBB_to_MTM_ATB']].min()
    mtm_atb = mtm_atb.rename(columns={'SBB_to_MTM_ATB': 'MTM_ATB_units'})
    detail = joined[['MTM','sbb','MTM_SBB_Qty','ATB_units','SBB_to_MTM_ATB']]
    return mtm_atb, detail

def run(bom_path: str, mtm_path: str, net_path: str, cfg: Config) -> Dict[str, str]:
    os.makedirs(cfg.outdir, exist_ok=True)
    warn = Warn()

    df_bom = read_excel_any(bom_path, warn)
    df_mtm = read_excel_any(mtm_path, warn)
    df_net = read_excel_any(net_path, warn)

    cols = unify_columns(df_bom, df_mtm, df_net, warn)

    pool = build_supply_pool(df_net, cols, cfg, warn)
    unit_dmd = build_unit_demand(df_bom, cols, cfg)
    atb_sbb, shortage = calc_atb_sbb(unit_dmd, pool, cfg)
    mtm_atb, mtm_detail = attach_mtm(atb_sbb, df_mtm, cols)

    p_sbb = os.path.join(cfg.outdir, 'ATB_SBB.xlsx')
    p_mtm = os.path.join(cfg.outdir, 'ATB_MTM.xlsx')
    p_mtm_detail = os.path.join(cfg.outdir, 'ATB_MTM_detail.xlsx')
    p_warn = os.path.join(cfg.outdir, '_warnings.log')

    with pd.ExcelWriter(p_sbb, engine='openpyxl') as w:
        unit_dmd.to_excel(w, index=False, sheet_name='Unit_Demand')
        pool.to_excel(w, index=False, sheet_name='Supply_Pool')
        atb_sbb.to_excel(w, index=False, sheet_name='ATB_SBB')
        shortage.to_excel(w, index=False, sheet_name='Next_Unit_Shortage')

    mtm_atb.to_excel(p_mtm, index=False)
    mtm_detail.to_excel(p_mtm_detail, index=False)
    warn.dump(p_warn)

    return {'ATB_SBB': p_sbb, 'ATB_MTM': p_mtm, 'ATB_MTM_detail': p_mtm_detail, 'WARN': p_warn}

def parse_args(argv: Optional[List[str]] = None):
    p = argparse.ArgumentParser(description='ATB2 方案A 稳健版（库存优先→ETA）')
    p.add_argument('--bom', required=True, help='DIXON+BOM+all_bom_leaf.xlsx')
    p.add_argument('--mtm', required=True, help='MTM_SBB_mapping.xlsx')
    p.add_argument('--net', required=True, help='Net_BPSONS_ETA_*.xlsx')
    p.add_argument('--eta_cutoff', default=None, help='ETA 截止日期（YYYY-MM-DD），默认None=包含所有在途列')
    p.add_argument('--unit_build_qty', type=float, default=1.0, help='单位构建基数，默认1台（用于推导ATB）')
    p.add_argument('--outdir', default='output', help='输出目录')
    args = p.parse_args(argv)

    eta_cutoff = None
    if args.eta_cutoff not in (None, '', 'None', 'null'):
        try:
            eta_cutoff = pd.to_datetime(args.eta_cutoff)
        except Exception:
            print(f"[WARN] 无法解析 --eta_cutoff={args.eta_cutoff}，将使用默认全部在途列")
            eta_cutoff = None

    cfg = Config(eta_cutoff=eta_cutoff, unit_build_qty=args.unit_build_qty, outdir=args.outdir)
    return args, cfg

if __name__ == '__main__':
    args, cfg = parse_args()
    paths = run(args.bom, args.mtm, args.net, cfg)
    print(json.dumps(paths, ensure_ascii=False, indent=2))
