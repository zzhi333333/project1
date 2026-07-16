# -*- coding: utf-8 -*-
"""
driver_helper.py
统一 Selenium driver 管理（企业级稳定版）
"""

import os
import sys
import io
import time
from pathlib import Path
from typing import Optional

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options

from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.core.driver_cache import DriverCacheManager



# ======================================
# 默认配置
# ======================================
DEFAULT_CACHE_ROOT = r"D:\selenium_cache\common"
DEFAULT_DOWNLOAD_DIR = r"D:\Download"


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
        print(f"✅ driver获取成功: {driver_path}")
        return Service(driver_path)

    except Exception as e:
        print(f"⚠️ install失败，尝试使用缓存driver: {e}")

        fallback = find_latest_driver(cache_root)
        if fallback:
            print(f"✅ 使用缓存driver: {fallback}")
            return Service(fallback)

        raise RuntimeError("❌ 无可用driver")


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

    if headless:
        options.add_argument("--headless=new")

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

    options = build_options(download_dir, headless, user_data_dir, extra_prefs)
    service = build_chrome_service(cache_root)

    driver = webdriver.Chrome(service=service, options=options)

    # ✅ headless 下载修复
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