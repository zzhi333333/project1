# step4_query_and_download_toips.py
# 复用 OneReportdownload_refined_v2.py 的登录、页面等待、树节点展开与下载校验逻辑。
# 下载 TO IPS Order Sequence 和 NB_MAIN_Order_Plan_Summary，解压后复制到 OneDrive 目录。

from datetime import datetime, timedelta
import argparse
import logging
import os
import re
import shutil
import time
import traceback
import zipfile

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from selenium.common.exceptions import (
    NoSuchElementException,
    TimeoutException,
    ElementNotInteractableException,
    StaleElementReferenceException,
)

from driver_helper import safe_quit
import OneReportdownload_refined_v2 as base

# TO IPS 解压后目标路径
TOIPS_DEST_DIR = r"D:\OneDrive - Lenovo\Documents - July-9\16-PBI auto report source\19-UAT data"
TOIPS_QUERY_KEYWORD = "TO IPS"
TOIPS_TREE_PATH = ("NB", "TOIPS")
TOIPS_FILE_PREFIX = "NB OPLN To IPS - Order Sequence"
ORDER_PLAN_QUERY_KEYWORD = "NB_MAIN_Order_Plan"
ORDER_PLAN_TREE_PATH = ("NB", "MAIN")
ORDER_PLAN_FILE_PREFIX = "NB_MAIN_Order_Plan_Summary"

logger = logging.getLogger(__name__)

_download_log_file = os.path.join(base.LOG_DIR, f"toips_download_{datetime.now().strftime('%Y%m%d')}.log")
if not any(isinstance(h, logging.FileHandler) and h.baseFilename == _download_log_file for h in logging.getLogger().handlers):
    logging.getLogger().addHandler(logging.FileHandler(_download_log_file, encoding="utf-8"))


def query_files(driver, keyword, title):
    logger.info(f"=== 查询 {title} 文件 ===")
    wait = WebDriverWait(driver, 15)

    try:
        file_name_input = wait.until(
            EC.element_to_be_clickable((By.XPATH, "//input[@placeholder='请输入']"))
        )
        logger.info("找到 File Name 输入框（精确定位）")
    except TimeoutException:
        inputs = driver.find_elements(By.TAG_NAME, "input")
        file_name_input = None
        for inp in inputs:
            try:
                if inp.is_displayed() and inp.get_attribute("placeholder"):
                    file_name_input = inp
                    logger.info("找到 File Name 输入框（兜底遍历）")
                    break
            except StaleElementReferenceException:
                continue
        if not file_name_input:
            logger.error("无法找到 File Name 输入框")
            return False

    file_name_input.click()
    file_name_input.send_keys(Keys.CONTROL, "a")
    file_name_input.send_keys(Keys.DELETE)
    remaining = file_name_input.get_attribute("value") or ""
    if remaining.strip():
        logger.info(f"输入框残留值 '{remaining}'，使用 JS 强制清空")
        driver.execute_script("arguments[0].value = '';", file_name_input)
        driver.execute_script(
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));", file_name_input
        )
    file_name_input.send_keys(keyword)
    logger.info(f"已输入 '{keyword}'")

    try:
        query_btn = wait.until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), '查询')]"))
        )
        logger.info("找到查询按钮（精确定位）")
    except TimeoutException:
        buttons = driver.find_elements(By.TAG_NAME, "button")
        query_btn = None
        for btn in buttons:
            try:
                if btn.is_displayed() and ("查询" in btn.text or "搜索" in btn.text):
                    query_btn = btn
                    logger.info("找到查询按钮（兜底遍历）")
                    break
            except StaleElementReferenceException:
                continue
        if not query_btn:
            logger.error("无法找到查询按钮")
            return False

    query_btn.click()
    logger.info("已点击查询按钮")

    time.sleep(2)
    try:
        wait.until(
            EC.presence_of_all_elements_located((By.XPATH, "//tr | //div[@role='row']"))
        )
        logger.info("查询结果已加载")
    except TimeoutException:
        logger.warning("未检测到结果行出现，继续执行")

    time.sleep(2)
    return True


def query_toips_files(driver):
    return query_files(driver, TOIPS_QUERY_KEYWORD, "TO IPS")


def query_order_plan_files(driver):
    return query_files(driver, ORDER_PLAN_QUERY_KEYWORD, "NB_MAIN_Order_Plan")


def expand_nb_toips(driver):
    """展开 NB -> TOIPS 路径。"""
    logger.info("=== 展开 NB -> TOIPS ===")

    for idx, keyword in enumerate(TOIPS_TREE_PATH, start=1):
        try:
            if not base._try_expand_tree_node(driver, keyword, label=str(idx)):
                return False
        except StaleElementReferenceException as e:
            logger.error(f"展开 {keyword} 时元素持续失效: {e}")
            return False

    logger.info("  NB -> TOIPS 展开完成")
    return True


def expand_nb_main(driver):
    """展开 NB -> MAIN 路径。"""
    logger.info("=== 展开 NB -> MAIN ===")

    for idx, keyword in enumerate(ORDER_PLAN_TREE_PATH, start=1):
        try:
            if not base._try_expand_tree_node(driver, keyword, label=str(idx)):
                return False
        except StaleElementReferenceException as e:
            logger.error(f"展开 {keyword} 时元素持续失效: {e}")
            return False

    logger.info("  NB -> MAIN 展开完成")
    return True


def _normalize_spaces(value):
    return re.sub(r"\s+", " ", value or "").strip()


def _extract_zip_name(text, file_prefix):
    prefix_re = re.escape(file_prefix).replace(r"\ ", r"\s+")
    pattern = re.compile(rf"({prefix_re}[_\s-]*\d{{8}}\d*.*?\.zip)", re.IGNORECASE)
    match = pattern.search(text or "")
    if match:
        return _normalize_spaces(match.group(1))

    for line in (text or "").splitlines():
        line = _normalize_spaces(line)
        if line.lower().startswith(file_prefix.lower()) and ".zip" in line.lower():
            return line[: line.lower().find(".zip") + 4]
    return ""


def _zip_file_sort_key(file_name, file_prefix):
    prefix_re = re.escape(file_prefix).replace(r"\ ", r"\s+")
    match = re.search(rf"{prefix_re}[_\s-]*(\d{{8}}\d*)", file_name, re.IGNORECASE)
    if match:
        return match.group(1)

    match = re.search(r"(\d{8}\d*)", file_name)
    return match.group(1) if match else ""


def _find_latest_zip_row(driver, date_tag, file_prefix, description):
    wait = WebDriverWait(driver, 15)
    wait.until(
        EC.presence_of_all_elements_located(
            (By.XPATH, "//tr[contains(., '.zip')] | //div[contains(., '.zip') and @role='row']")
        )
    )

    rows = driver.find_elements(
        By.XPATH, "//tr[contains(., '.zip')] | //div[contains(., '.zip') and @role='row']"
    )
    candidates = []
    for row_index, row in enumerate(rows):
        try:
            if not row.is_displayed():
                continue
            file_name = _extract_zip_name(row.text, file_prefix)
            if not file_name:
                continue
            if date_tag not in file_name:
                continue
            sort_key = _zip_file_sort_key(file_name, file_prefix)
            candidates.append((sort_key, row_index, file_name, row))
        except StaleElementReferenceException:
            continue

    if not candidates:
        logger.error(f"未找到日期 {date_tag} 的 {description} ZIP 文件")
        return None, ""

    candidates.sort(key=lambda item: (item[0], item[1]))
    sort_key, _row_index, file_name, row = candidates[-1]
    logger.info(f"选择最新 {description} 文件: {file_name} (sequence={sort_key})")
    return row, file_name


def _find_download_button(row):
    try:
        return row.find_element(
            By.XPATH,
            ".//button[contains(text(), 'Download')] | "
            ".//a[contains(text(), 'Download')] | "
            ".//span[contains(text(), 'Download')]/parent::button",
        )
    except NoSuchElementException:
        buttons = row.find_elements(By.TAG_NAME, "button")
        return buttons[-1] if buttons else None


def download_latest_zip(driver, download_dir, date_tag, file_prefix, description):
    logger.info(f"=== 下载最新 {description} ZIP 文件 ===")

    try:
        row, file_name = _find_latest_zip_row(driver, date_tag, file_prefix, description)
    except TimeoutException:
        logger.error("未找到任何 .zip 文件行")
        return None

    if row is None or not file_name:
        return None

    download_btn = _find_download_button(row)
    if not download_btn or not download_btn.is_displayed():
        logger.error(f"下载按钮不可见: {file_name}")
        return None

    base.prepare_download_target(download_dir, file_name)
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", download_btn)
    time.sleep(0.5)
    try:
        driver.execute_script("arguments[0].click();", download_btn)
    except Exception:
        try:
            ActionChains(driver).move_to_element(download_btn).click(download_btn).perform()
        except (ElementNotInteractableException, StaleElementReferenceException):
            driver.execute_script("arguments[0].click();", download_btn)

    logger.info(f"已点击下载: {file_name}")
    if not base.wait_for_download_complete(download_dir, file_name, timeout=120):
        logger.warning(f"文件下载未确认: {file_name}")
        return None

    zip_path = os.path.join(download_dir, file_name)
    logger.info(f"{description} ZIP 下载完成: {zip_path}")
    return zip_path


def download_latest_toips_zip(driver, download_dir, date_tag):
    return download_latest_zip(
        driver,
        download_dir,
        date_tag,
        TOIPS_FILE_PREFIX,
        "TO IPS Order Sequence",
    )


def download_latest_order_plan_zip(driver, download_dir, date_tag):
    return download_latest_zip(
        driver,
        download_dir,
        date_tag,
        ORDER_PLAN_FILE_PREFIX,
        "NB_MAIN_Order_Plan_Summary",
    )


def get_today_and_d_minus_1_dates():
    today = datetime.now()
    return [today.strftime("%Y%m%d"), (today - timedelta(days=1)).strftime("%Y%m%d")]


def download_latest_toips_zip_for_date(driver, download_dir, date_tag):
    logger.info(f"=== 尝试 TO IPS 日期版本: {date_tag} ===")

    if not base.run_with_retry(base.expand_date_folder, f"展开日期({date_tag})", driver, date_tag):
        logger.warning(f"无法展开日期文件夹: {date_tag}")
        return None

    if not base.run_with_retry(expand_nb_toips, f"展开NB/TOIPS({date_tag})", driver):
        logger.warning(f"日期 {date_tag} 下展开 NB/TOIPS 失败")
        return None

    return download_latest_toips_zip(driver, download_dir, date_tag)


def download_latest_order_plan_zip_for_date(driver, download_dir, date_tag):
    logger.info(f"=== 尝试 NB_MAIN_Order_Plan_Summary 日期版本: {date_tag} ===")

    if not base.run_with_retry(base.expand_date_folder, f"展开日期({date_tag})", driver, date_tag):
        logger.warning(f"无法展开日期文件夹: {date_tag}")
        return None

    if not base.run_with_retry(expand_nb_main, f"展开NB/MAIN({date_tag})", driver):
        logger.warning(f"日期 {date_tag} 下展开 NB/MAIN 失败")
        return None

    return download_latest_order_plan_zip(driver, download_dir, date_tag)


def extract_and_copy_toips(zip_path, download_dir, dest_dir=TOIPS_DEST_DIR):
    """解压 TO IPS ZIP，并将解压出的文件复制到 CPSP PLAN SUMMARY 目录。"""
    return extract_and_copy_zip(zip_path, download_dir, dest_dir, description="TO IPS")


def extract_and_copy_zip(zip_path, download_dir, dest_dir=TOIPS_DEST_DIR, description="ZIP"):
    """解压 ZIP，并将解压出的文件复制到 OneDrive 目标目录。"""
    logger.info(f"=== 解压并复制 {description} 文件到 OneDrive 目录 ===")

    if not zip_path or not os.path.exists(zip_path):
        logger.error(f"ZIP 文件不存在: {zip_path}")
        return []

    os.makedirs(dest_dir, exist_ok=True)
    copied_files = []

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            members = [info for info in zf.infolist() if not info.is_dir()]
            if not members:
                logger.error("ZIP 内没有可复制的文件")
                return []

            for info in members:
                file_name = os.path.basename(info.filename)
                if not file_name:
                    continue

                extracted_path = os.path.join(download_dir, file_name)
                with zf.open(info, "r") as source, open(extracted_path, "wb") as target:
                    shutil.copyfileobj(source, target)

                dest_path = os.path.join(dest_dir, file_name)
                shutil.copy2(extracted_path, dest_path)
                copied_files.append(dest_path)
                logger.info(f"已复制到: {dest_path} ({os.path.getsize(dest_path):,} bytes)")

    except zipfile.BadZipFile as e:
        logger.error(f"ZIP 文件损坏: {e}")
        return []
    except Exception as e:
        logger.error(f"解压/复制失败: {e}")
        return []

    return copied_files


def _download_and_extract(driver, download_dir, date_tags, query_name,
                          query_fn, download_fn, extract_fn, file_desc):
    """通用下载流程：查询 → 等待加载 → 按日期回退下载 → 解压复制。"""
    if not base.run_with_retry(query_fn, query_name, driver):
        logger.error(f"{file_desc} 查询失败")
        return

    base.wait_for_grid_loading_done(driver)

    for idx, date_tag in enumerate(date_tags):
        if idx == 1:
            logger.warning(f"当天 {file_desc} 未下载成功，回退查找 D-1 日期: {date_tag}")
        zip_path = download_fn(driver, download_dir, date_tag)
        if zip_path:
            logger.info(f"最终使用 {file_desc} 日期版本: {date_tag}")
            copied = extract_fn(zip_path, download_dir)
            if copied:
                logger.info(f"{file_desc} 文件已保存到目标目录:")
                for f in copied:
                    logger.info(f"  - {f}")
            else:
                logger.warning(f"{file_desc} 解压/复制未完成，请手动处理")
            return

    logger.error(f"未下载 {file_desc} 文件，已尝试日期: {date_tags}")


def main():
    parser = argparse.ArgumentParser(description="OneReport TO IPS & Order Plan 下载脚本")
    parser.add_argument("--headless", action="store_true", help="无头模式：不显示浏览器窗口（适用于定时任务）")
    args = parser.parse_args()

    headless = args.headless
    date_tags = get_today_and_d_minus_1_dates()

    driver = None
    try:
        logger.info(f"=== 查询并下载 TO IPS & Order Plan 报表 === (headless={headless}, dates={date_tags})")

        logger.info("启动浏览器...")
        driver, download_dir = base.setup_driver(headless=headless)

        logger.info("访问首页...")
        driver.get("https://planning.lenovo.com/portal/home")
        base.wait_for_js_render(driver)

        base.ensure_logged_in(driver)

        logger.info("点击 PCG Planning UI...")
        base.click_pcg_ui(driver)

        target_url = "https://planning.lenovo.com/pcg/one-plan/reporting"
        logger.info(f"访问 Reporting 页面: {target_url}")
        driver.get(target_url)
        base.wait_for_js_render(driver)
        base.wait_for_grid_loading_done(driver)

        # --- TO IPS ---
        _download_and_extract(
            driver, download_dir, date_tags,
            "查询TOIPS", query_toips_files,
            download_latest_toips_zip_for_date,
            extract_and_copy_toips, "TO IPS",
        )

        # --- NB_MAIN_Order_Plan_Summary ---
        _download_and_extract(
            driver, download_dir, date_tags,
            "查询NB_MAIN_Order_Plan", query_order_plan_files,
            download_latest_order_plan_zip_for_date,
            lambda zp, dd: extract_and_copy_zip(zp, dd, description="NB_MAIN_Order_Plan_Summary"),
            "NB_MAIN_Order_Plan_Summary",
        )

        if not headless:
            input("\n按 Enter 关闭浏览器...")

    except Exception as e:
        logger.error(f"发生错误: {e}")
        traceback.print_exc()
        if not headless:
            input("按 Enter 退出...")

    finally:
        if driver:
            safe_quit(driver)
            logger.info("浏览器已关闭")


if __name__ == "__main__":
    main()
