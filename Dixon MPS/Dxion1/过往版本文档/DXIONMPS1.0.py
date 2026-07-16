# main.py - Dixon MRP V3 one-file integrator
import os
import re
import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox
import openpyxl
from datetime import datetime

# optional heavy algorithm
try:
    import networkx as nx
    HAVE_NETWORKX = True
except Exception:
    HAVE_NETWORKX = False

# ========== 配置开关 ==========
SAVE_INTERMEDIATE = True    # 默认开启中间文件保存
ENABLE_MAXFLOW = False      # 默认不启用最大流分配（如要启用请改为 True 并确保已安装 networkx）

# ========== 小工具 ==========
def norm(s):
    return re.sub(r"\s+", " ", str(s)).strip().lower()

def find_col(df, candidates):
    """宽松匹配列名；返回第一个匹配的实际列名；找不到则抛 KeyError"""
    cols = list(df.columns)
    cnorm = {norm(c): c for c in cols}
    for cand in candidates:
        k = norm(cand)
        if k in cnorm:
            return cnorm[k]
    # 尝试包含匹配（更宽松）
    for c in cols:
        for cand in candidates:
            if norm(c).find(norm(cand)) >= 0 or norm(cand).find(norm(c)) >= 0:
                return c
    raise KeyError(f"未找到列匹配: {candidates}；实际列: {cols}")

def ensure_output_dir():
    if not os.path.exists("output"):
        os.makedirs("output")

def save_df(df, filename):
    if not SAVE_INTERMEDIATE:
        return
    ensure_output_dir()
    path = os.path.join("output", filename)
    # choose excel or csv by extension
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xls"):
        df.to_excel(path, index=False)
    else:
        df.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"[INFO] 已保存: {path}")

def select_file_gui(title, example, filetypes=(("Excel/CSV","*.xlsx;*.xls;*.csv"),)):
    root = tk.Tk()
    root.withdraw()
    messagebox.showinfo("请选择文件", f"{title}\n示例文件名：{example}")
    path = filedialog.askopenfilename(title=title, filetypes=filetypes)
    if not path:
        raise FileNotFoundError(f"未选择文件: {title}")
    print(f"[INPUT] 选择文件 ({title}): {path}")
    return path

# ========== Step1: bom_tool (展开 BOM + 生成叶子) ==========
def expand_bom_tree(df):
    # 采用你原始实现，宽松处理列名
    df = df.copy()
    # 规范列名暂不改动，只用 find_col when needed
    # 过滤 DIXON
    try:
        wcol = find_col(df, ["WERKS"])
        df = df[df[wcol] == "DIXON"]
    except KeyError:
        # 如果没有 WERKS 列，尝试不过滤
        pass

    # build parent->children list using NAME and IDNRK and MENGE and ALPGR maybe
    name_col = find_col(df, ["NAME"])
    id_col = find_col(df, ["IDNRK"])
    menge_col = None
    try:
        menge_col = find_col(df, ["MENGE"])
    except KeyError:
        menge_col = None

    parent_to_children = {}
    for _, row in df.iterrows():
        parent = row[name_col]
        child = row[id_col]
        if pd.notna(parent) and pd.notna(child):
            parent_to_children.setdefault(str(parent), []).append(row)

    def expand_tree(root, level, visited, top_sbb, parent_name, menge_path, path_list):
        root = str(root)
        if root in visited:
            return []
        visited.add(root)
        result = []
        children = parent_to_children.get(root, [])
        for child_row in children:
            child_name = str(child_row[id_col])
            child_data = child_row.to_dict()
            child_data['bomroot'] = top_sbb
            child_data['level'] = level
            child_data[name_col] = parent_name
            qty = child_row[menge_col] if menge_col and pd.notna(child_row[menge_col]) else 1
            child_data['MENGE_PATH'] = menge_path * qty
            child_data['path'] = " → ".join(path_list + [str(parent_name), child_name])
            result.append(child_data)
            result.extend(
                expand_tree(
                    child_name,
                    level + 1,
                    visited.copy(),
                    top_sbb,
                    child_data[id_col],
                    child_data['MENGE_PATH'],
                    path_list + [str(parent_name)]
                )
            )
        return result

    # roots: NAME fields
    roots = df[name_col].dropna().astype(str).unique()
    sbb_roots = [r for r in roots if str(r).startswith('SBB')]
    expanded_rows = []
    for root in sbb_roots:
        expanded_rows.extend(expand_tree(root, 1, set(), root, root, 1, []))

    expanded_df = pd.DataFrame(expanded_rows)
    if expanded_df.empty:
        return expanded_df
    cols_front = ['bomroot','level']
    rest = [c for c in expanded_df.columns if c not in cols_front]
    return expanded_df[cols_front + rest]

def generate_leaf_bom(expanded_df):
    if expanded_df.empty:
        return expanded_df
    # identify columns
    name_col = find_col(expanded_df, ["NAME"])
    id_col = find_col(expanded_df, ["IDNRK"]) if "IDNRK" in expanded_df.columns else find_col(expanded_df, ["IDNRK","CHILD"],)
    # choose ALPGR if exists
    alp_col = None
    for c in expanded_df.columns:
        if norm(c) == "alpgr":
            alp_col = c
            break
    # leaf rows = those whose IDNRK not in NAME set
    all_names = set(expanded_df[name_col].astype(str))
    idvals = expanded_df[id_col].astype(str)
    leaf_df = expanded_df[~idvals.isin(all_names)].copy()
    # ensure MENGE exists
    if 'MENGE_PATH' in leaf_df.columns:
        leaf_df['MENGE'] = leaf_df['MENGE_PATH']
    elif 'MENGE' not in leaf_df.columns:
        leaf_df['MENGE'] = 1

    # no alt
    if alp_col is None:
        out = leaf_df.rename(columns={id_col: 'CHILD'})
        out['path'] = out['path'].astype(str)
        return out[['bomroot','level',name_col,'CHILD','MENGE','path']].rename(columns={name_col:'NAME'})

    leaf_df[alp_col] = leaf_df[alp_col].fillna('')
    no_alt_mask = leaf_df[alp_col] == ''
    no_alt_df = leaf_df[no_alt_mask].copy()
    no_alt_df = no_alt_df.rename(columns={id_col: 'CHILD'})
    no_alt_df['path'] = no_alt_df['path'].astype(str)
    no_alt_df = no_alt_df[['bomroot','level',name_col,'CHILD','MENGE','path']].rename(columns={name_col:'NAME'})

    alt_df = leaf_df[~no_alt_mask].copy()
    alt_df['grp_key'] = alt_df['bomroot'].astype(str) + '_' + alt_df[name_col].astype(str) + '_' + alt_df[alp_col].astype(str)
    max_alt = alt_df.groupby('grp_key')[id_col].count().max() if len(alt_df)>0 else 0
    if pd.isna(max_alt):
        max_alt = 0

    def flatten_substitutes(group):
        items = group[id_col].astype(str).tolist()
        rec = {
            'bomroot': group['bomroot'].iloc[0],
            'level': group['level'].iloc[0],
            'NAME': group[name_col].iloc[0],
            'MENGE': group['MENGE'].iloc[0],
            'path': group['path'].iloc[0]
        }
        for i in range(int(max_alt)):
            col = 'CHILD' if i==0 else f'substitute_{i}'
            rec[col] = ''
        for idx, val in enumerate(items):
            col = 'CHILD' if idx==0 else f'substitute_{idx}'
            rec[col] = val
        return rec

    alt_result = pd.DataFrame()
    if max_alt and len(alt_df):
        alt_result = alt_df.groupby('grp_key', as_index=False).apply(lambda g: pd.Series(flatten_substitutes(g)))

    final = pd.concat([no_alt_df, alt_result], ignore_index=True, sort=False)
    cols_order = ['bomroot','level','NAME','CHILD']
    max_sub = final.filter(regex=r'^substitute_\d+$').shape[1]
    cols_order += [f'substitute_{i}' for i in range(1, max_sub+1)]
    cols_order += ['MENGE','path']
    final = final[[c for c in cols_order if c in final.columns]]
    return final

# ========== Step2: parse MTM->SBB mapping from Multi Product workbook ==========
def parse_mtm_sbb_mapping_from_workbook(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    target_columns = ['SBB','Qty','SBB Name','Basic Name']
    all_rows = []
    for sheet_name in wb.sheetnames:
        sh = wb[sheet_name]
        # MTM in C6
        try:
            mtm_value = sh['C6'].value
        except Exception:
            mtm_value = None
        # header at row 7 (1-indexed)
        try:
            header_row = sh[7]
        except Exception:
            continue
        header = [(cell.value.strip() if isinstance(cell.value, str) else cell.value) for cell in header_row]
        # map indices
        idx_map = {}
        for idx, name in enumerate(header):
            if name is None:
                continue
            name_norm = norm(name)
            for tgt in target_columns:
                if norm(tgt) == name_norm:
                    idx_map[tgt] = idx
        if len(idx_map) < len(target_columns):
            continue
        for row in sh.iter_rows(min_row=8, values_only=True):
            rec = {'MTM': (mtm_value if mtm_value is not None else None)}
            for col in target_columns:
                idx = idx_map.get(col)
                rec[col] = (row[idx] if (idx is not None and idx < len(row)) else None)
            all_rows.append(rec)
    df = pd.DataFrame(all_rows)
    if df.empty:
        raise ValueError("从 Multi Product Raw BOM 工作簿未解析到 MTM->SBB 数据，请检查表头（应在第7行）和 C6 是否存在 MTM")
    df_clean = df.dropna(subset=target_columns, how='all').copy()
    df_clean['MTM'] = df_clean['MTM'].astype(str).str.strip().str.upper()
    return df_clean

# ========== Step3: SBB order quantity mapping (uses Dixon MFG PO + MTM mapping) ==========
def compute_sbb_order_qty(dixon_po_df, mtm_map_df):
    # pivot MTM qty
    # tolerant column names
    ddf = dixon_po_df.copy()
    # find MTM & Qty columns
    try:
        col_mtm = find_col(ddf, ["MTM"])
    except KeyError:
        # try some guesses
        raise KeyError("Dixon MFG PO 缺少 'MTM' 列，请检查文件")
    try:
        col_qty = find_col(ddf, ["Qty","QTY","Quantity"])
    except KeyError:
        raise KeyError("Dixon MFG PO 缺少 'Qty' 列，请检查文件")
    pivot = ddf.groupby(col_mtm, as_index=False)[col_qty].sum().rename(columns={col_qty:"MTM Qty"})
    pivot[col_mtm] = pivot[col_mtm].astype(str).str.strip().str.upper()
    mtm_map_df['MTM'] = mtm_map_df['MTM'].astype(str).str.strip().str.upper()
    # merge
    merged = pd.merge(mtm_map_df, pivot, on="MTM", how="left")
    # 'Qty' in mapping is SBB qty per MTM; tolerant find
    try:
        map_qty_col = find_col(merged, ["Qty","QTY","Qty "])
    except KeyError:
        raise KeyError("MTM_SBB_mapping 缺少 'Qty' 列（SBB 每台用量），请检查解析结果")
    merged["MTM Qty"] = merged["MTM Qty"].fillna(0)
    merged["订单用量"] = pd.to_numeric(merged[map_qty_col], errors='coerce').fillna(0) * pd.to_numeric(merged["MTM Qty"], errors='coerce').fillna(0)
    final = merged.rename(columns={map_qty_col:"Qty"})
    # select columns preferred order
    cols = []
    for c in ["MTM","SBB","Qty","SBB Name","Basic Name","MTM Qty","订单用量"]:
        if c in final.columns:
            cols.append(c)
    return final[cols]

# ========== Step3.1: SFG deduct ==========
def sfg_deduct(sbb_order_df, odm_inv_df, sfg_map_df=None):
    # sbb_order_df has column SBB and 订单用量
    out = sbb_order_df.copy()
    # prepare odm inventory
    inv = odm_inv_df.copy()
    # find Material Type, ODM PN, ODM QTY
    try:
        col_mat_type = find_col(inv, ["Material Type","Material_Type","MaterialType"])
        col_odm_pn = find_col(inv, ["ODM PN","ODM_PN","PN","Part Number","PartNumber"])
        col_odm_qty= find_col(inv, ["ODM QTY","ODM_QTY","ODMQTY","ODM QTY","QTY","Quantity"])
    except KeyError:
        raise KeyError("ODM_INVERTORY 表必须包含 Material Type / ODM PN / ODM QTY 等列")
    sfg_inv = inv[inv[col_mat_type].astype(str).str.upper() == "SFG"].copy()
    # prefer sfg_map_df mapping if given
    sbb_odm_qty = {}
    if sfg_map_df is not None:
        mp = sfg_map_df.copy()
        mp.columns = [re.sub(r"\s+"," ", str(c)).strip() for c in mp.columns]
        try:
            col_key = find_col(mp, ["SMT Planner","ODM PN","PN","Part Number"])
            col_val = find_col(mp, ["SBB"])
        except KeyError:
            # fallback
            col_key = None
            col_val = None
        if col_key and col_val:
            sfg_inv = sfg_inv.merge(mp[[col_key, col_val]], left_on=col_odm_pn, right_on=col_key, how='left')
            sfg_inv = sfg_inv.dropna(subset=[col_val])
            sbb_odm_qty = sfg_inv.groupby(col_val)[col_odm_qty].sum().to_dict()
    # if no mapping, try map by child bom leaf if passed earlier (we require caller to pass sfg_map_df or leaf mapping)
    if not sbb_odm_qty:
        # try best-effort: if sfg_inv has field SBB already
        for colname in sfg_inv.columns:
            if norm(colname) == 'sbb':
                sbb_col = colname
                sbb_odm_qty = sfg_inv.groupby(sbb_col)[col_odm_qty].sum().to_dict()
                break
    # apply deduction
    if not sbb_odm_qty:
        # nothing to deduct
        return out
    # adjust out by sbb key (SBB column may named differently)
    try:
        col_sbb = find_col(out, ["SBB"])
        col_need = find_col(out, ["订单用量","订单 用量","order_qty","order qty","订单数量"])
    except KeyError:
        # Try guessed names
        if "SBB" in out.columns:
            col_sbb = "SBB"
        else:
            col_sbb = out.columns[0]
        col_need = out.columns[-1]
    for sbb, total_odm_qty in sbb_odm_qty.items():
        matching_indices = out[out[col_sbb].astype(str)==str(sbb)].index
        rem = float(total_odm_qty)
        for idx in matching_indices:
            cur = float(out.at[idx, col_need]) if pd.notna(out.at[idx, col_need]) else 0.0
            if rem <= 0:
                break
            if rem >= cur:
                out.at[idx, col_need] = 0.0
                rem -= cur
            else:
                out.at[idx, col_need] = cur - rem
                rem = 0.0
                break
    return out

# ========== Step4: MFG_PO_BOM_mapping ==========
def build_mfg_po_bom_mapping(bom_leaf_df, sbb_order_update_df):
    # bom_leaf_df: columns include 'bomroot' and 'MENGE' and CHILD/substitute...
    bom = bom_leaf_df.copy()
    order = sbb_order_update_df.copy()
    # aggregate order by SBB
    try:
        col_sbb = find_col(order, ["SBB"])
        col_need = find_col(order, ["订单用量","订单 用量","订单数量"])
    except KeyError:
        raise KeyError("SBB_订单用量汇总_update 缺少 SBB / 订单用量 列")
    order_agg = order.groupby(col_sbb, as_index=False)[col_need].sum()
    sbb_qty_map = dict(zip(order_agg[col_sbb].astype(str), order_agg[col_need].astype(float)))
    bom["MFG_PO_Qty"] = bom["bomroot"].astype(str).map(sbb_qty_map).fillna(0)
    bom["MENGE"] = pd.to_numeric(bom["MENGE"], errors="coerce").fillna(0)
    bom["MENGE_times_MFG_PO_Qty"] = bom["MENGE"] * bom["MFG_PO_Qty"]
    return bom

# ========== Step5.1: MRP5.1 compute (inventory matching & optional maxflow) ==========
def normalize_odm_pn(pn):
    if isinstance(pn, str) and re.fullmatch(r"0+\d+", pn):
        return str(int(pn))
    return pn

def mrp5_1_compute(mfg_po_bom_mapping_df, odm_inv_df, enable_maxflow=False):
    bom = mfg_po_bom_mapping_df.copy()
    inv = odm_inv_df.copy()
    # find substitute columns
    sub_cols = [c for c in bom.columns if str(c).startswith("substitute")]
    all_match_cols = ["CHILD"] + sub_cols
    # create combo key
    def create_sorted_key(row):
        parts = [str(row[c]) for c in all_match_cols if c in row and pd.notna(row[c])]
        return ",".join(sorted(set(parts)))
    bom["combo_key"] = bom.apply(create_sorted_key, axis=1)
    bom["MENGE_times_MFG_PO_Qty"] = bom["MENGE_times_MFG_PO_Qty"].fillna(0)
    agg = bom.groupby("combo_key", as_index=False).agg({"MENGE_times_MFG_PO_Qty":"sum"})
    # attach representative fields
    first_rows = bom.drop_duplicates("combo_key").set_index("combo_key")
    for col in all_match_cols:
        if col in first_rows.columns:
            agg[col] = agg["combo_key"].map(first_rows[col])
    # prepare inv lookup
    inv.columns = [re.sub(r"\s+"," ", str(c)).strip() for c in inv.columns]
    col_odm_pn = find_col(inv, ["ODM PN","PN","Part Number"])
    col_odm_qty = find_col(inv, ["ODM QTY","QTY","Quantity"])
    inv[col_odm_pn] = inv[col_odm_pn].apply(lambda x: normalize_odm_pn(str(x)) if pd.notna(x) else x)
    inv[col_odm_qty] = pd.to_numeric(inv[col_odm_qty], errors="coerce").fillna(0)
    inv_agg = inv.groupby(col_odm_pn, as_index=False)[col_odm_qty].sum()
    inv_lookup = dict(zip(inv_agg[col_odm_pn].astype(str), inv_agg[col_odm_qty].astype(float)))
    used_odm_pns = set()
    def compute_dixon_qty(row):
        candidates = [str(row[c]) for c in all_match_cols if c in row and pd.notna(row[c])]
        matched_parts = set()
        for part in candidates:
            pn = normalize_odm_pn(str(part))
            if pn in inv_lookup and pn not in used_odm_pns:
                matched_parts.add(pn)
        used_odm_pns.update(matched_parts)
        return sum(inv_lookup[p] for p in matched_parts)
    agg["Dixon_inv_Qty"] = agg.apply(compute_dixon_qty, axis=1)
    # optional maxflow
    if enable_maxflow:
        if not HAVE_NETWORKX:
            print("[WARN] 请求启用最大流分配但未安装 networkx，跳过最大流")
        else:
            # build flow network: SRC -> pn (supply) -> combo -> SNK (demand)
            G = nx.DiGraph()
            SRC, SNK = "SRC", "SNK"
            for pn, qty in inv_lookup.items():
                if qty>0:
                    G.add_edge(SRC, pn, capacity=float(qty))
            for _, r in agg.iterrows():
                demand = r["MENGE_times_MFG_PO_Qty"]
                combo = r["combo_key"]
                if demand>0:
                    G.add_edge(combo, SNK, capacity=float(demand))
            # add edges pn -> combo if pn matches any candidate
            inv_pns = set(inv_agg[col_odm_pn].astype(str))
            for _, r in agg.iterrows():
                combo = r["combo_key"]
                candidates = [str(r[c]) for c in all_match_cols if c in r and pd.notna(r[c])]
                for part in candidates:
                    pn = normalize_odm_pn(str(part))
                    if pn in inv_pns:
                        G.add_edge(pn, combo, capacity=float("inf"))
            flow_value, flow_dict = nx.maximum_flow(G, SRC, SNK)
            # optionally record allocation details (omitted for brevity)
    return agg

# ========== Step5.2: merge Open PO and compute BPS/net demand ==========
def mrp5_2_compute(final_bom_agg_df, open_po_df):
    df = final_bom_agg_df.copy()
    # reorder if needed
    cols = list(df.columns)
    if "MENGE_times_MFG_PO_Qty" in cols and "Dixon_inv_Qty" in cols:
        i_menge = cols.index("MENGE_times_MFG_PO_Qty")
        i_inv = cols.index("Dixon_inv_Qty")
        cols.insert(i_inv, cols.pop(i_menge))
        df = df[cols]
    opo = open_po_df.copy()
    opo.columns = [re.sub(r"\s+"," ", str(c)).strip() for c in opo.columns]
    # find ALT Customer PN and Total
    try:
        col_alt = find_col(opo, ["ALT Customer PN","Alt Customer PN","ALT_PN","ALT PN"])
    except KeyError:
        # fallback try common names
        possible = [c for c in opo.columns if "alt" in norm(c) and "pn" in norm(c)]
        if possible:
            col_alt = possible[0]
        else:
            raise KeyError("Open PO 表未找到 ALT Customer PN 列")
    col_total = find_col(opo, ["Total","Qty","Quantity"])
    opo[col_alt] = opo[col_alt].astype(str).str.strip()
    po_agg = opo.groupby(col_alt, as_index=False)[col_total].sum()
    po_map = dict(zip(po_agg[col_alt], po_agg[col_total]))
    def match_total(row):
        for c in row.index:
            if str(c).startswith("CHILD") or str(c).startswith("substitute"):
                pn = str(row[c]).strip()
                if pn in po_map:
                    return float(po_map[pn])
        return 0.0
    df["Dixon_Open_PO_Qty"] = df.apply(match_total, axis=1)
    df["BPS"] = pd.to_numeric(df["MENGE_times_MFG_PO_Qty"], errors="coerce").fillna(0) - pd.to_numeric(df["Dixon_inv_Qty"], errors="coerce").fillna(0)
    df["net_dmd_result"] = df["BPS"] - pd.to_numeric(df["Dixon_Open_PO_Qty"], errors="coerce").fillna(0)
    return df

# ========== 主流程 ==========
def main():
    try:
        print("==== Dixon MRP V3 开始 ====")
        # STEP 1: BOM 展开 (手工)
        bom_file = select_file_gui("请选择 BOM 文件 (DIXON+BOM+all)", "DIXON+BOM+all.csv/xlsx")
        ext = os.path.splitext(bom_file)[1].lower()
        if ext == ".csv":
            raw_bom = pd.read_csv(bom_file)
        else:
            raw_bom = pd.read_excel(bom_file, engine="openpyxl")
        print("[STEP1] 展开 BOM ...")
        expanded = expand_bom_tree(raw_bom)
        leaf = generate_leaf_bom(expanded)
        save_df(expanded, "DIXON+BOM+all_expanded_bom_tree_sbb_roots.xlsx")
        save_df(leaf, "DIXON+BOM+all_bom_leaf.xlsx")

        # STEP 2: MTM_SBB_mapping (手工: Multi Product Raw Bill of Materials Export)
        mtm_workbook = select_file_gui("请选择 Multi Product Raw Bill of Materials Export 工作簿", "Multi Product Raw Bill of Materials Export.xlsx")
        print("[STEP2] 解析 MTM->SBB 映射 ...")
        mtm_map = parse_mtm_sbb_mapping_from_workbook(mtm_workbook)
        save_df(mtm_map, "MTM_SBB_mapping.xlsx")

        # STEP 3: SBB_MFG_PO_Qty_Mapping (手工: Dixon MFG PO + mtm_map)
        dixon_mfg_po_file = select_file_gui("请选择 Dixon MFG PO 文件", "Dixon MFG PO.xlsx")
        print("[STEP3] 计算 SBB 订单用量...")
        dixon_po_df = pd.read_excel(dixon_mfg_po_file, engine="openpyxl")
        sbb_order = compute_sbb_order_qty(dixon_po_df, mtm_map)
        save_df(sbb_order, "SBB_订单用量汇总.xlsx")

        # STEP 3.1: MRP3.1SFGdeduct (手工: ODM_INVERTORY + SFG_SBB_Mapping)
        odm_inv_file = select_file_gui("请选择 ODM_INVERTORY 文件", "ODM_INVERTORY.xlsx")
        sfg_map_file = select_file_gui("请选择 SFG_SBB_Mapping 文件", "SFG_SBB_Mapping.xlsx")
        odm_inv_df = pd.read_excel(odm_inv_file, engine="openpyxl")
        sfg_map_df = pd.read_excel(sfg_map_file, engine="openpyxl")
        print("[STEP3.1] SFG 库存扣减 ...")
        sbb_order_update = sfg_deduct(sbb_order, odm_inv_df, sfg_map_df)
        save_df(sbb_order_update, "SBB_订单用量汇总_update.xlsx")

        # STEP 4: MFG_PO_BOM_mapping
        print("[STEP4] 生成 MFG_PO_BOM_mapping ...")
        mfg_po_bom_map = build_mfg_po_bom_mapping(leaf, sbb_order_update)
        save_df(mfg_po_bom_map, "MFG_PO_BOM_mapping.xlsx")

        # STEP 5.1: MRP5.1 (手工: ODM_INVERTORY) - use same odm_inv_df as above
        print("[STEP5.1] 进行组合级库存匹配 ...")
        final_bom_agg = mrp5_1_compute(mfg_po_bom_map, odm_inv_df, enable_maxflow=ENABLE_MAXFLOW)
        save_df(final_bom_agg, "Final_BOM_ODM_Mapping.xlsx")

        # STEP 5.2: MRP5.2 (手工: LNV Dixon Open PO)
        lnv_po_file = select_file_gui("请选择 LNV Dixon Open PO 文件", "LNV Dixon Open PO.xlsx")
        lnv_po_df = pd.read_excel(lnv_po_file, engine="openpyxl")
        print("[STEP5.2] 合并 Open PO 并计算 BPS/net demand ...")
        final_df = mrp5_2_compute(final_bom_agg, lnv_po_df)
        # Output final with date suffix
        today = datetime.now().strftime("%Y%m%d")
        out_name = f"Net_dmd_BPS_result_{today}.xlsx"
        ensure_output_dir()
        final_df.to_excel(os.path.join("output", out_name), index=False)
        print(f"[DONE] 最终结果保存为 output/{out_name}")
        messagebox.showinfo("完成", f"流程完成，最终文件：output/{out_name}")

    except Exception as e:
        # show error
        import traceback
        traceback.print_exc()
        messagebox.showerror("执行失败", str(e))
        raise

if __name__ == "__main__":
    main()
