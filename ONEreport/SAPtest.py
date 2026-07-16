# -*- coding: utf-8 -*-
import time
import subprocess
import win32com.client
import keyring

# =====================================
# 配置
# =====================================
SAP_PATH = r"C:\Program Files (x86)\SAP\FrontEnd\SAPgui\saplogon.exe"

SYSTEM_LIST = ["EGP", "SHP", "SUP"]

CLIENT_MAP = {
    "SHP": "100",
    "EGP": "301",
    "SUP": "200"
}

T_CODE_MAP = {
    "EGP": "ZOFR005",
    "SHP": "SE16",
    "SUP": "ZETD_ZTOEMXLOG"
}


# =====================================
# 凭据
# =====================================
def get_credentials(system):
    user = keyring.get_password(f"SAP_{system}", "username")
    pwd = keyring.get_password(f"SAP_{system}", "password")

    if not user or not pwd:
        raise RuntimeError(f"未找到 keyring 凭据 SAP_{system}")

    return user, pwd


# =====================================
# 启动 SAP
# =====================================
def open_sap():
    try:
        win32com.client.GetObject("SAPGUI")
        print("[INFO] SAP 已启动")
    except:
        print("[INFO] 启动 SAP...")
        subprocess.Popen(SAP_PATH)
        time.sleep(8)


# =====================================
# 获取 session
# =====================================
def get_session(system):
    SapGuiAuto = win32com.client.GetObject("SAPGUI")
    app = SapGuiAuto.GetScriptingEngine

    for i in range(app.Connections.Count):
        conn = app.Connections(i)
        if system in conn.Description:
            if conn.Children.Count > 0:
                print(f"[OK] 复用连接: {system}")
                return conn.Children(0)

    print(f"[INFO] 新建连接: {system}")
    connection = app.OpenConnection(system, True)
    time.sleep(3)
    return connection.Children(0)


# =====================================
# 登录
# =====================================
def login(session, system):
    try:
        session.findById("wnd[0]/usr/txtRSYST-MANDT")
    except:
        print(f"[INFO] {system} 已登录")
        return

    user, pwd = get_credentials(system)
    client = CLIENT_MAP.get(system, "100")

    print(f"[INFO] 登录 {system}")

    session.findById("wnd[0]/usr/txtRSYST-MANDT").text = client
    session.findById("wnd[0]/usr/txtRSYST-BNAME").text = user
    session.findById("wnd[0]/usr/pwdRSYST-BCODE").text = pwd
    session.findById("wnd[0]/usr/txtRSYST-LANGU").text = "EN"

    session.findById("wnd[0]").sendVKey(0)
    time.sleep(2)

    print(f"[OK] 登录完成: {system}")


# =====================================
# 打开 Tcode
# =====================================
def open_tcode(session, tcode):
    print(f"[INFO] 打开 {tcode}")
    session.findById("wnd[0]/tbar[0]/okcd").text = f"/n{tcode}"
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(2)


# =====================================
# SHP：SE16 + 表
# =====================================
def open_se16_with_table(session, table_name):
    open_tcode(session, "SE16")

    field = session.findById("wnd[0]/usr/ctxtDATABROWSE-TABLENAME")
    field.text = table_name
    session.findById("wnd[0]").sendVKey(0)

    time.sleep(2)
    print(f"[OK] SE16 → {table_name}")


# =====================================
# 工具：查找字段（支持subscreen）
# =====================================
def find_control_by_suffix(session, suffix_list):
    root = session.findById("wnd[0]/usr")
    stack = [root]

    while stack:
        obj = stack.pop()

        try:
            cid = obj.Id
        except:
            continue

        for suffix in suffix_list:
            if suffix in cid:
                return cid

        try:
            for i in range(obj.Children.Count):
                stack.append(obj.Children(i))
        except:
            pass

    return None


# =====================================
# 调试：扫描当前屏幕所有可输入控件
# =====================================
def debug_dump_controls(session):
    print("\n--- 扫描当前屏幕所有控件 ---")
    root = session.findById("wnd[0]/usr")
    stack = [root]

    while stack:
        obj = stack.pop()
        try:
            cid = obj.Id
            ctype = type(obj).__name__
            # 只打印可输入/日期类控件
            if any(t in ctype for t in ["TextField", "CTextField", "ComboBox"]):
                text_val = ""
                try:
                    text_val = obj.text
                except:
                    pass
                print(f"  {cid}  ({ctype})  = \"{text_val}\"")
            try:
                for i in range(obj.Children.Count):
                    stack.append(obj.Children(i))
            except:
                pass
        except:
            continue

    print("--- 扫描完成 ---\n")


# =====================================
# EGP：ZOFR005 自动填 + 执行
# =====================================
def run_egp_zofr005(session):
    print("[INFO] 填写 Ship Date")

    today = time.strftime("%d.%m.%Y")

    # 字段 ID 来自 SAP Script Recording
    low_id = "wnd[0]/usr/ctxtS_ZERDAT-LOW"
    high_id = "wnd[0]/usr/ctxtS_ZERDAT-HIGH"

    session.findById(low_id).text = today
    print(f"[OK] LOW = {today}")

    session.findById(high_id).text = today
    print(f"[OK] HIGH = {today}")

    # 执行
    print("[INFO] 执行 F8")
    session.findById("wnd[0]").sendVKey(8)

    time.sleep(3)

    print("[✅] 报表执行完成")


# =====================================
# 主流程
# =====================================
def main():
    open_sap()

    sessions = {}

    for system in SYSTEM_LIST:
        print("\n==============================")
        print(f"[START] {system}")
        print("==============================")

        try:
            session = get_session(system)
            login(session, system)

            if system == "EGP":
                open_tcode(session, "ZOFR005")
                run_egp_zofr005(session)

            elif system == "SHP":
                open_se16_with_table(session, "ZTOEMXLOG")

            else:
                open_tcode(session, T_CODE_MAP[system])

            sessions[system] = session

        except Exception as e:
            print(f"[ERROR] {system}: {e}")

    print("\n✅ 所有系统已打开并执行完成")
    print(f"当前打开: {list(sessions.keys())}")

    input("\n按 Enter 结束（SAP窗口保持打开）...")


# =====================================
# 启动
# =====================================
if __name__ == "__main__":
    main()