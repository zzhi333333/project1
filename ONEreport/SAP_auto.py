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

# 每个系统对应动作
T_CODE_MAP = {
    "EGP": "ZOFR005",
    "SHP": "SE16",              # 特殊处理（需要加表名）
    "SUP": "ZETD_ZTOEMXLOG"
}


# =====================================
# 获取凭据
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
# 获取 Session
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

    print(f"[INFO] 登录 {system}...")

    session.findById("wnd[0]/usr/txtRSYST-MANDT").text = client
    session.findById("wnd[0]/usr/txtRSYST-BNAME").text = user
    session.findById("wnd[0]/usr/pwdRSYST-BCODE").text = pwd
    session.findById("wnd[0]/usr/txtRSYST-LANGU").text = "EN"

    session.findById("wnd[0]").sendVKey(0)
    time.sleep(2)

    print(f"[OK] 登录完成: {system}")


# =====================================
# 打开 Tcode（通用）
# =====================================
def open_tcode(session, tcode):
    print(f"[INFO] 打开 Tcode: {tcode}")

    session.findById("wnd[0]/tbar[0]/okcd").text = f"/n{tcode}"
    session.findById("wnd[0]").sendVKey(0)

    time.sleep(2)

    print(f"[OK] 已进入 {tcode}")


# =====================================
# SHP 专用：SE16 + 表名
# =====================================
def open_se16_with_table(session, table_name):
    print("[INFO] 打开 SE16...")

    session.findById("wnd[0]/tbar[0]/okcd").text = "/nSE16"
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(2)

    try:
        field = session.findById("wnd[0]/usr/ctxtDATABROWSE-TABLENAME")
    except:
        raise RuntimeError("未找到 SE16 表名输入框")

    print(f"[INFO] 输入表名: {table_name}")

    field.text = table_name
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(2)

    print(f"[OK] 已进入 SE16 + 表 {table_name}")


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

            # 👉 核心分支逻辑
            if system == "SHP":
                open_se16_with_table(session, "ZTOEMXLOG")
            else:
                open_tcode(session, T_CODE_MAP[system])

            sessions[system] = session

        except Exception as e:
            print(f"[ERROR] {system}: {e}")

    print("\n✅ 所有系统已打开对应界面（不会关闭）")
    print(f"当前打开: {list(sessions.keys())}")

    input("\n按 Enter 结束脚本（SAP窗口保持打开）...")


# =====================================
# 运行
# =====================================
if __name__ == "__main__":
    main()