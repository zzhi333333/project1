# -*- coding: utf-8 -*-
"""
driver_helper.py
统一 Selenium driver 管理（企业级稳定版）
"""

import os
import subprocess
import time
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import SessionNotCreatedException, WebDriverException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options

from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.core.driver_cache import DriverCacheManager


# ======================================
# 默认配置
# ======================================
DEFAULT_CACHE_ROOT = r"D:\selenium_cache\common"
DEFAULT_DOWNLOAD_DIR = r"D:\Download"
HEADLESS_PROFILE_SUFFIX = "_headless"


# ======================================
# 工具函数
# ======================================
def ensure_dir(path: str):
    if path:
        os.makedirs(path, exist_ok=True)


def kill_chromedriver():
    """避免 driver 被占用"""
    try:
        os.system("taskkill /f /im chromedriver.exe >nul 2>&1")
    except:
        pass


def _cleanup_profile_locks(user_data_dir: str):
    """删除 Chrome profile 锁文件，避免因上次异常退出导致 Chrome 启动崩溃"""
    if not user_data_dir:
        return
    profile_root = Path(user_data_dir)
    if not profile_root.exists():
        return
    # 删除根目录 lockfile（Chrome 150+ 的进程锁）
    lockfile = profile_root / "lockfile"
    if lockfile.exists():
        try:
            lockfile.unlink()
            print(f"[lockfile cleaned]: {lockfile}")
        except OSError:
            pass
    # 删除子目录下的 Singleton 锁文件
    for lock_name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        for lock_path in profile_root.rglob(lock_name):
            try:
                lock_path.unlink()
                print(f"[lock cleaned]: {lock_path}")
            except OSError:
                pass


def kill_chrome_by_profile(user_data_dir):
    """仅清理占用指定 Selenium profile 的 Chrome 残留进程。"""
    if not user_data_dir or os.name != "nt":
        return

    profile = os.path.abspath(user_data_dir).replace("'", "''")
    command = (
        "$profile = '" + profile + "'; "
        "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | "
        "Where-Object { $_.CommandLine -and $_.CommandLine -like \"*$profile*\" } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass


def find_latest_driver(cache_root):
    root = Path(cache_root)
    if not root.exists():
        return None

    drivers = list(root.rglob("chromedriver.exe"))
    if not drivers:
        return None

    drivers.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return str(drivers[0])


# ======================================
# driver service 构建
# ======================================
def build_chrome_service(cache_root=DEFAULT_CACHE_ROOT, valid_range=7):
    ensure_dir(cache_root)

    kill_chromedriver()
    time.sleep(2)

    cache = DriverCacheManager(
        root_dir=cache_root,
        valid_range=valid_range
    )

    try:
        driver_path = ChromeDriverManager(cache_manager=cache).install()
        print(f"[OK] driver: {driver_path}")
        return Service(driver_path)

    except Exception as e:
        print(f"[WARN] install failed, fallback to cached driver: {e}")

        fallback = find_latest_driver(cache_root)
        if fallback:
            print(f"[OK] using cached driver: {fallback}")
            return Service(fallback)

        raise RuntimeError("[FATAL] No available ChromeDriver")


# ======================================
# Options 构建
# ======================================
def build_options(download_dir=DEFAULT_DOWNLOAD_DIR, headless=True, user_data_dir=None, extra_prefs=None):

    ensure_dir(download_dir)
    ensure_dir(user_data_dir)

    options = Options()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--remote-allow-origins=*")
    # 以下 flags 防止 headless Chrome 在启动时崩溃
    options.add_argument("--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints,TranslateUI")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-sync")
    options.add_argument("--disable-default-apps")
    options.add_argument("--disable-component-update")
    options.add_argument("--metrics-recording-only")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--password-store=basic")

    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--disable-extensions")

    if user_data_dir:
        options.add_argument(f"--user-data-dir={user_data_dir}")

    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    prefs = {
        "download.default_directory": download_dir,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
    }
    if extra_prefs:
        prefs.update(extra_prefs)

    options.add_experimental_option("prefs", prefs)

    return options


def _is_chrome_startup_crash(exc):
    message = str(exc)
    return (
        "DevToolsActivePort file doesn't exist" in message
        or "Chrome failed to start" in message
        or "session not created" in message
    )


def _headless_profile_dir(user_data_dir):
    return f"{user_data_dir}{HEADLESS_PROFILE_SUFFIX}"


# ======================================
# 创建 driver（最常用）
# ======================================
def create_chrome_driver(
    download_dir=DEFAULT_DOWNLOAD_DIR,
    cache_root=DEFAULT_CACHE_ROOT,
    headless=True,
    user_data_dir=None,
    extra_prefs=None,
):
    # headless 模式下默认使用独立 profile，避免与正常 Chrome 窗口冲突
    effective_user_data_dir = user_data_dir
    if headless and user_data_dir:
        effective_user_data_dir = _headless_profile_dir(user_data_dir)

    # 清理残留进程和锁文件
    kill_chrome_by_profile(effective_user_data_dir)
    _cleanup_profile_locks(effective_user_data_dir)

    options = build_options(download_dir, headless, effective_user_data_dir, extra_prefs)
    service = build_chrome_service(cache_root)

    try:
        driver = webdriver.Chrome(service=service, options=options)
    except (SessionNotCreatedException, WebDriverException) as exc:
        if not headless or not effective_user_data_dir or not _is_chrome_startup_crash(exc):
            raise

        # 重试：再次清理并尝试
        print("[WARN] headless Chrome 首次启动失败，重试清理后重试...")
        kill_chrome_by_profile(effective_user_data_dir)
        _cleanup_profile_locks(effective_user_data_dir)
        time.sleep(3)

        try:
            driver = webdriver.Chrome(service=service, options=options)
        except (SessionNotCreatedException, WebDriverException):
            raise RuntimeError(
                f"[FATAL] headless Chrome 无法创建 session。"
                f"profile={effective_user_data_dir}"
            ) from exc

    # headless 下载修复
    try:
        driver.execute_cdp_cmd(
            "Page.setDownloadBehavior",
            {"behavior": "allow", "downloadPath": download_dir}
        )
    except:
        pass

    return driver


# ======================================
# 安全关闭
# ======================================
def safe_quit(driver):
    try:
        if driver:
            driver.quit()
    except:
        pass