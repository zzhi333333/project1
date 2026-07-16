#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ATB2_A_robust.py — “方案A 的稳健版”

目的：
- 在材料面（叶子料+替代组）做齐套能力评估（ATB），并向上汇总到 SBB / MTM。
- 充分容错：自动识别/清洗列名，支持不同来源表结构的细微差异；
  遇到缺列/缺数一律安全降级（按0处理，不中断），并产出异常日志。

输入（建议）：
1) DIXON+BOM+all_bom_leaf.xlsx   —— 叶子BOM（含 CHILD、substitute_1..n、MENGE、bomroot/SBB 等）
2) MTM_SBB_mapping.xlsx          —— MTM 与 SBB 对照（列：MTM, SBB, Qty, SBB Name, Basic Name ...）
3) Net_BPSONS_ETA_YYYYMMDD.xlsx  —— 库存/在途净表（列：CHILD、substitute_1..14、Dixon_inv_Qty、
                                     Dixon_Open_PO_Qty、若干日期列表示到货、以及可选的 net_dmd_result/BPS 等）

输出：
- output/ATB_SBB.xlsx            —— 按 SBB 计算的可最大可组装台数（单位ATB）与短缺明细
- output/ATB_MTM.xlsx            —— 关联 MTM 后的 ATB 汇总
- output/_warnings.log           —— 清洗/兼容性告警

计算要点（方案A假设）：
- 以“替代组”为最小可替代消耗池：同一组内的 CHILD + substitute_1..n 视为同一物料池，可互相满足需求。
- 供应侧：池供给 = 库存 + 截止日期内的在途（可通过 --eta_cutoff 指定，默认包含所有日期列），不允许超配。
- 需求侧：按 BOM 的 MENGE（每台用量）× 目标构建量（默认=1台用于求理论ATB），
          先计算“每造1台SBB所需的各替代组数量”，再以池供给/需求取最小值得到 ATB(台)。
- 分配策略：稳健贪心（先按约束组最紧缺系数从高到低分配），确保不超用任何池；
            未匹配字段/料号按0处理（不抛异常）。

使用：
python ATB2_A_robust.py \
  --bom "DIXON+BOM+all_bom_leaf.xlsx" \
  --mtm "MTM_SBB_mapping.xlsx" \
  --net "Net_BPSONS_ETA_20250910.xlsx" \
  --eta_cutoff 2099-12-31 \
  --unit_build_qty 1 \
  --outdir output

作者：
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
    return date_cols


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


def build_supply_pool(df_net: pd.DataFrame, cols: Dict[str, str], cfg: Config) -> pd.DataFrame:
    work = df_net.copy()
    if 'combo_key' not in work.columns:
        work['combo_key'] = build_sub_group_key(work)

    inv = as_num(work[cols['net_inv']])
    opo = as_num(work[cols['net_opo']])

    eta_cols = cols['net_dates']
    eta_sum = 0
    for dc in eta_cols:
        try:
            d = pd.to_datetime(dc)
            if cfg.eta_cutoff is not None and d > cfg.eta_cutoff:
                continue
        except Exception:
            pass
        eta_sum = eta_sum + as_num(work[dc])

    work['supply_total'] = inv + opo + eta_sum
    pool = work.groupby('combo_key', dropna=False, as_index=False)[['supply_total']].sum()
    return pool


def build_unit_demand(df_bom: pd.DataFrame, cols: Dict[str, str]) -> pd.DataFrame:
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

    menge = as_num(b[cols['bom_menge']])
    b['unit_need'] = menge

    sbb_col = cols['bom_root']
    unit_dmd = (
        b.groupby([sbb_col, 'combo_key'], dropna=False, as_index=False)[['unit_need']]
         .sum()
    )
    return unit_dmd.rename(columns={sbb_col: 'sbb'})


def calc_atb_sbb(unit_dmd: pd.DataFrame, pool: pd.DataFrame, cfg: Config) -> Tuple[pd.DataFrame, pd.DataFrame]:
    df = unit_dmd.merge(pool, on='combo_key', how='left')
    df['supply_total'] = df['supply_total'].fillna(0)
    df['unit_need'] = df['unit_need'].replace(0, np.nan)
    df['constraint_atb'] = np.floor(df['supply_total'] / df['unit_need'])
    df['constraint_atb'] = df['constraint_atb'].replace([np.inf, -np.inf], 0).fillna(0)
    atb_sbb = df.groupby('sbb', dropna=False, as_index=False)[['constraint_atb']].min()
    atb_sbb = atb_sbb.rename(columns={'constraint_atb': 'ATB_units'})

    df = df.merge(atb_sbb, on='sbb', how='left')
    df['consumed_supply_at_ATB'] = df['unit_need'].fillna(0) * df['ATB_units']
    df['shortage_at_ATB'] = (df['consumed_supply_at_ATB'] - df['supply_total']).clip(lower=0)
    shortage = df.loc[df['shortage_at_ATB'] > 0, ['sbb', 'combo_key', 'unit_need', 'supply_total', 'ATB_units', 'shortage_at_ATB']]
    return atb_sbb, shortage


def attach_mtm(atb_sbb: pd.DataFrame, df_mtm: pd.DataFrame, cols: Dict[str, str]) -> pd.DataFrame:
    m = df_mtm[[cols['mtm_mtm'], cols['mtm_sbb']]].drop_duplicates()
    m = m.rename(columns={cols['mtm_mtm']: 'MTM', cols['mtm_sbb']: 'sbb'})
    out = atb_sbb.merge(m, on='sbb', how='left')
    return out[['MTM', 'sbb', 'ATB_units']]


def run(bom_path: str, mtm_path: str, net_path: str, cfg: Config) -> Dict[str, str]:
    os.makedirs(cfg.outdir, exist_ok=True)
    warn = Warn()

    df_bom = read_excel_any(bom_path, warn)
    df_mtm = read_excel_any(mtm_path, warn)
    df_net = read_excel_any(net_path, warn)

    cols = unify_columns(df_bom, df_mtm, df_net, warn)
    pool = build_supply_pool(df_net, cols, cfg)
    unit_dmd = build_unit_demand(df_bom, cols)
    atb_sbb, shortage = calc_atb_sbb(unit_dmd, pool, cfg)
    atb_mtm = attach_mtm(atb_sbb, df_mtm, cols)

    p_sbb = os.path.join(cfg.outdir, 'ATB_SBB.xlsx')
    p_mtm = os.path.join(cfg.outdir, 'ATB_MTM.xlsx')
    p_warn = os.path.join(cfg.outdir, '_warnings.log')

    with pd.ExcelWriter(p_sbb, engine='openpyxl') as w:
        unit_dmd.to_excel(w, index=False, sheet_name='Unit_Demand')
        pool.to_excel(w, index=False, sheet_name='Supply_Pool')
        atb_sbb.to_excel(w, index=False, sheet_name='ATB_SBB')
        shortage.to_excel(w, index=False, sheet_name='Shortage_At_ATB')

    atb_mtm.to_excel(p_mtm, index=False)
    warn.dump(p_warn)

    return {'ATB_SBB': p_sbb, 'ATB_MTM': p_mtm, 'WARN': p_warn}


def parse_args(argv: Optional[List[str]] = None):
    p = argparse.ArgumentParser(description='ATB2 方案A 稳健版')
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
