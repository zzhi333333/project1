# step4_query_and_download_refined_v2.py
# 基于 OneReportdownload_refined.py 的优化版本，修复成功率问题。
# 支持 --auto（无人值守）和 --headless（无头浏览器）模式，适用于定时任务调度。

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import (
    NoSuchElementException,
    TimeoutException,
    ElementNotInteractableException,
    StaleElementReferenceException,
)
from datetime import datetime, timedelta
import argparse
import json
import logging
import os
import pickle
import time
import traceback
import zipfile
import shutil
import glob

# -----------------------------------------------------------------------------
# 日志配置（同时输出到控制台和文件）
# -----------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(SCRIPT_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

_log_file = os.path.join(LOG_DIR, f"psd_download_{datetime.now().strftime('%Y%m%d')}.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_log_file, encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# 常量 / 配置
# -----------------------------------------------------------------------------
CHROME_DRIVER_PATH = r"D:\driver\chromedriver-win64\chromedriver.exe"
USE_WEBDRIVER_MANAGER = True
DEBUG_PRINT_TREE_ROWS = False
STALE_ELEMENT_RETRIES = 3
STEP_MAX_RETRIES = 2  # 单个步骤失败后的重试次数

# PSD 解压后目标路径
PSD_UAT_DEST_DIR = r"D:\OneDrive - Lenovo\Documents - July-9\16-PBI auto report source\19-UAT data"


# -----------------------------------------------------------------------------
# 辅助装饰器：自动重试 StaleElementReferenceException
# -----------------------------------------------------------------------------
def retry_on_stale(func):
    def wrapper(*args, **kwargs):
        last_exc = None
        for attempt in range(STALE_ELEMENT_RETRIES):
            try:
                return func(*args, **kwargs)
            except StaleElementReferenceException as e:
                last_exc = e
                logger.warning(f"[retry_on_stale] {func.__name__} 遇到 StaleElement，第 {attempt + 1} 次重试...")
                time.sleep(1)
        raise last_exc
    return wrapper


# -----------------------------------------------------------------------------
# 1. Driver 初始化
# -----------------------------------------------------------------------------
def setup_driver(headless=False):
    chrome_options = Options()
    if headless:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    download_dir = os.path.join(script_dir, "downloads")
    os.makedirs(download_dir, exist_ok=True)

    prefs = {
        "download.default_directory": download_dir,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    }
    chrome_options.add_experimental_option("prefs", prefs)

    if USE_WEBDRIVER_MANAGER:
        try:
            from webdriver_manager.chrome import ChromeDriverManager
            service = Service(ChromeDriverManager().install())
            logger.info("使用 webdriver-manager 自动管理 ChromeDriver")
        except Exception as e:
            logger.warning(f"webdriver-manager 加载失败: {e}，回退到硬编码路径")
            service = Service(CHROME_DRIVER_PATH)
    else:
        service = Service(CHROME_DRIVER_PATH)

    driver = webdriver.Chrome(service=service, options=chrome_options)
    return driver, download_dir


# -----------------------------------------------------------------------------
# 2. 页面渲染与 iframe 切换
# -----------------------------------------------------------------------------
def wait_for_js_render(driver, timeout=30):
    wait = WebDriverWait(driver, timeout)
    wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
    time.sleep(0.5)


def check_and_switch_iframes(driver, max_depth=2):
    """递归查找包含 PCG_UI 的 iframe（支持嵌套），确保每层回退正确。"""

    def _search(depth):
        if depth > max_depth:
            return False
        iframes = driver.find_elements(By.TAG_NAME, "iframe")
        for iframe in iframes:
            try:
                driver.switch_to.frame(iframe)
                driver.find_element(By.ID, "PCG_UI")
                return True
            except NoSuchElementException:
                if _search(depth + 1):
                    return True
                # 修复：递归失败后回到上一层而非 default_content
                driver.switch_to.parent_frame()
            except StaleElementReferenceException:
                driver.switch_to.parent_frame()
        return False

    driver.switch_to.default_content()
    found = _search(1)
    if not found:
        driver.switch_to.default_content()
    return found


def click_pcg_ui(driver):
    """点击 PCG Planning UI 链接，并安全切换到新窗口。"""
    wait = WebDriverWait(driver, 10)
    try:
        pcg_link = wait.until(EC.element_to_be_clickable((By.ID, "PCG_UI")))
    except TimeoutException:
        if check_and_switch_iframes(driver):
            pcg_link = wait.until(EC.element_to_be_clickable((By.ID, "PCG_UI")))
        else:
            raise NoSuchElementException("无法找到 PCG_UI 元素")

    pcg_link.click()
    wait.until(EC.number_of_windows_to_be(2))

    original = driver.current_window_handle
    for handle in driver.window_handles:
        if handle == original:
            continue
        driver.switch_to.window(handle)
        # 修复：用 /pcg/ 和 /one-plan 精确匹配，避免首页 planning.lenovo.com 误匹配
        if "/pcg/" in driver.current_url or "/one-plan" in driver.current_url:
            logger.info(f"已切换到新窗口: {driver.current_url}")
            return
    # 兜底：切到最后一个非原始窗口
    for handle in driver.window_handles:
        if handle != original:
            driver.switch_to.window(handle)
            logger.info(f"兜底切换到窗口: {driver.current_url}")
            return


# -----------------------------------------------------------------------------
# 3. 登录态检查
# -----------------------------------------------------------------------------
def ensure_logged_in(driver, timeout=120):
    """检查是否需要登录，如果需要则等待用户手动完成登录。"""
    current = driver.current_url.lower()
    if "login" not in current and "sso" not in current and "auth" not in current:
        # 检查页面上是否有登录表单
        try:
            login_form = driver.find_element(By.XPATH,
                "//input[@type='password'] | //form[contains(@class, 'login')]"
            )
            if not login_form.is_displayed():
                return
        except NoSuchElementException:
            return

    logger.info("检测到需要登录，请在浏览器中完成登录...")
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: ("planning.lenovo.com" in d.current_url
                       and "login" not in d.current_url.lower()
                       and "sso" not in d.current_url.lower())
        )
        logger.info("登录成功，继续执行")
    except TimeoutException:
        raise TimeoutException(f"登录超时（{timeout}s），当前 URL: {driver.current_url}")


# -----------------------------------------------------------------------------
# 4. 日期工具
# -----------------------------------------------------------------------------
def get_yesterday_date():
    yesterday = datetime.now() - timedelta(days=1)
    return yesterday.strftime("%Y%m%d")


def get_last_workday_date():
    """获取上一个工作日（排除周六日）。"""
    dt = datetime.now() - timedelta(days=1)
    while dt.weekday() >= 5:
        dt -= timedelta(days=1)
    return dt.strftime("%Y%m%d")


def get_workday_with_fallback(max_fallback_days=7):
    """获取当天日期，如果当天文件不存在则往前找工作日。"""
    dt = datetime.now()
    for _ in range(max_fallback_days):
        while dt.weekday() >= 5:
            dt -= timedelta(days=1)
        yield dt.strftime("%Y%m%d")
        dt -= timedelta(days=1)


# -----------------------------------------------------------------------------
# 5. 查询 PSD
# -----------------------------------------------------------------------------
def query_psd_files(driver):
    logger.info("=== 查询 PSD 文件 ===")
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

    # 安全清空输入框（兼容 React/Vue）+ 清空后验证
    file_name_input.click()
    file_name_input.send_keys(Keys.CONTROL, "a")
    file_name_input.send_keys(Keys.DELETE)
    remaining = file_name_input.get_attribute("value") or ""
    if remaining.strip():
        logger.info(f"输入框残留值 '{remaining}'，使用 JS 强制清空")
        driver.execute_script("arguments[0].value = '';", file_name_input)
        # 触发 input 事件让 React/Vue 感知变化
        driver.execute_script(
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));", file_name_input
        )
    file_name_input.send_keys("PSD")
    logger.info("已输入 'PSD'")

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
            EC.presence_of_all_elements_located(
                (By.XPATH, "//tr | //div[@role='row']")
            )
        )
        logger.info("查询结果已加载")
    except TimeoutException:
        logger.warning("未检测到结果行出现，继续执行")

    time.sleep(2)
    return True


# -----------------------------------------------------------------------------
# 6. 展开日期文件夹（安全 XPath + StaleElement 重试）
# -----------------------------------------------------------------------------
def safe_xpath_literal(value):
    if "'" not in value:
        return f"'{value}'"
    parts = value.split("'")
    return "concat(" + ",'".join(parts) + ")"


@retry_on_stale
def _try_click_date_row(driver, date_str):
    safe_date = safe_xpath_literal(date_str)
    xpath = (
        f"//tr[contains(., {safe_date})] | "
        f"//div[contains(., {safe_date}) and @role='row'] | "
        f"//span[contains(text(), {safe_date})]/ancestor::tr"
    )

    wait = WebDriverWait(driver, 10)
    date_row = wait.until(EC.element_to_be_clickable((By.XPATH, xpath)))
    logger.info(f"找到日期行: {date_str}")

    row_class = date_row.get_attribute("class") or ""
    if "expanded" in row_class or "open" in row_class:
        logger.info("  日期文件夹已展开")
        return True

    clicked = _click_expand_icon(driver, date_row)
    if not clicked:
        try:
            date_row.click()
            clicked = True
        except ElementNotInteractableException:
            driver.execute_script("arguments[0].click();", date_row)
            clicked = True

    if clicked:
        time.sleep(1)
        # 修复：重新定位验证展开状态，避免 stale element
        try:
            new_row = driver.find_element(By.XPATH, xpath)
            new_class = new_row.get_attribute("class") or ""
            if "expanded" in new_class or "open" in new_class:
                logger.info("  日期文件夹展开成功")
                return True
        except StaleElementReferenceException:
            pass
        logger.info("  已点击展开日期文件夹")
        return True
    else:
        logger.error("  无法展开日期文件夹")
        return False


def expand_date_folder(driver, date_str):
    logger.info(f"=== 展开日期文件夹: {date_str} ===")
    try:
        return _try_click_date_row(driver, date_str)
    except StaleElementReferenceException as e:
        logger.error(f"展开日期文件夹时元素持续失效: {e}")
        return False
    except TimeoutException:
        logger.warning(f"无法找到日期行 {date_str}，该日期可能无文件")
        return False


# -----------------------------------------------------------------------------
# 7. 通用树节点展开逻辑
# -----------------------------------------------------------------------------
def _find_tree_row_by_keyword(driver, keyword, timeout=10):
    wait = WebDriverWait(driver, timeout)
    wait.until(EC.presence_of_all_elements_located((By.XPATH, "//tr | //div[@role='row']")))

    all_rows = driver.find_elements(By.XPATH, "//tr | //div[@role='row']")
    for row in all_rows:
        try:
            if not row.is_displayed():
                continue
            text = row.text.strip()
            first_line = text.split("\n")[0].strip() if text else ""
            arrows = ("▶", "▼", "▸", "▾")
            clean_first = first_line
            for a in arrows:
                clean_first = clean_first.replace(a, "").strip()

            if clean_first == keyword or first_line.startswith(keyword):
                return row
        except StaleElementReferenceException:
            continue
    return None


def _click_expand_icon(driver, row):
    arrow_xpath = (
        ".//i[contains(@class, 'arrow')] | "
        ".//span[contains(@class, 'arrow')] | "
        ".//div[contains(@class, 'arrow')] | "
        ".//i[contains(@class, 'caret')] | "
        ".//span[contains(@class, 'caret')] | "
        ".//i[contains(@class, 'expand')] | "
        ".//span[contains(text(), '▶')] | "
        ".//span[contains(text(), '▸')]"
    )
    try:
        arrow = row.find_element(By.XPATH, arrow_xpath)
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", arrow)
        arrow.click()
        return True
    except (NoSuchElementException, ElementNotInteractableException):
        pass

    try:
        first_icon = row.find_element(By.XPATH, ".//i[1] | .//button[1] | .//span[1]")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", first_icon)
        first_icon.click()
        return True
    except (NoSuchElementException, ElementNotInteractableException):
        pass

    try:
        first_elem = driver.execute_script(
            """
            var row = arguments[0];
            var elems = row.querySelectorAll('i, button, span, div');
            for (var i = 0; i < elems.length; i++) {
                var r = elems[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    return elems[i];
                }
            }
            return null;
            """,
            row,
        )
        if first_elem:
            driver.execute_script("arguments[0].click();", first_elem)
            return True
    except Exception:
        pass

    return False


def _try_expand_tree_node(driver, keyword, label):
    """通用树节点展开，点击后重新定位验证。"""
    logger.info(f"[{label}] 查找并展开 {keyword}...")

    row = _find_tree_row_by_keyword(driver, keyword)
    if not row:
        logger.error(f"  未找到 {keyword} 行")
        return False

    logger.info(f"  找到 {keyword} 行")

    text = row.text
    is_expanded = "▼" in text or "▾" in text or "expanded" in (row.get_attribute("class") or "")

    if is_expanded:
        logger.info(f"  {keyword} 已展开")
        return True

    clicked = _click_expand_icon(driver, row)
    if not clicked:
        try:
            row.click()
            clicked = True
        except ElementNotInteractableException:
            driver.execute_script("arguments[0].click();", row)
            clicked = True

    if not clicked:
        logger.error(f"  所有点击方式都失败（{keyword}）")
        return False

    time.sleep(1.5)

    # 修复：重新定位元素验证展开状态，而非使用可能 stale 的 row 引用
    new_row = _find_tree_row_by_keyword(driver, keyword)
    if new_row:
        try:
            new_text = new_row.text
            new_class = new_row.get_attribute("class") or ""
            if "▼" in new_text or "▾" in new_text or "expanded" in new_class:
                logger.info(f"  {keyword} 展开成功")
                return True
        except StaleElementReferenceException:
            pass

    logger.warning(f"  {keyword} 展开状态未确认，继续执行")
    time.sleep(1)
    return True


def expand_nb_main_fixed(driver):
    """展开 NB -> MAIN 路径。"""
    logger.info("=== 展开 NB -> MAIN ===")

    try:
        if not _try_expand_tree_node(driver, "NB", label="1"):
            return False
    except StaleElementReferenceException as e:
        logger.error(f"展开 NB 时元素持续失效: {e}")
        return False

    if DEBUG_PRINT_TREE_ROWS:
        logger.debug("调试：NB 展开后的所有行...")
        all_rows = driver.find_elements(By.XPATH, "//tr | //div[@role='row']")
        for i, row in enumerate(all_rows[:20]):
            try:
                if row.is_displayed():
                    text = row.text.strip()
                    if text and len(text) < 100:
                        logger.debug(f"  [{i}] {text[:70]}")
            except Exception:
                pass

    try:
        if not _try_expand_tree_node(driver, "MAIN", label="2"):
            return False
    except StaleElementReferenceException as e:
        logger.error(f"展开 MAIN 时元素持续失效: {e}")
        return False

    logger.info("  MAIN 展开完成")
    return True


# -----------------------------------------------------------------------------
# 8. 下载 ZIP 文件（含完成校验 + .crdownload 处理）
# -----------------------------------------------------------------------------
def wait_for_download_complete(download_dir, file_name, timeout=120):
    """等待文件下载完成，正确处理 .crdownload 中间文件和旧文件干扰。"""
    target = os.path.join(download_dir, file_name)
    crdownload = target + ".crdownload"

    # 先备份/移走旧文件
    if os.path.exists(target):
        backup = target + f".bak_{int(time.time())}"
        os.rename(target, backup)
        logger.info(f"  旧文件已备份: {os.path.basename(backup)}")

    deadline = time.time() + timeout

    # 阶段1: 等待下载开始（.crdownload 或最终文件出现）
    while time.time() < deadline:
        if os.path.exists(crdownload) or os.path.exists(target):
            logger.info(f"  下载已开始: {file_name}")
            break
        time.sleep(1)
    else:
        logger.warning(f"  下载未在 {timeout}s 内开始: {file_name}")
        return False

    # 阶段2: 等待 .crdownload 消失 && 最终文件稳定
    stable_count = 0
    last_size = -1
    while time.time() < deadline:
        cr_exists = os.path.exists(crdownload)
        target_exists = os.path.exists(target)

        if target_exists and not cr_exists:
            current_size = os.path.getsize(target)
            if current_size == last_size and current_size > 0:
                stable_count += 1
                if stable_count >= 2:  # 连续2次大小一致才确认
                    logger.info(f"  下载完成: {file_name} ({current_size} bytes)")
                    return True
            else:
                stable_count = 0
            last_size = current_size
        time.sleep(1)

    logger.warning(f"  文件下载超时: {file_name}")
    return False


def download_all_zip_files(driver, download_dir):
    logger.info("=== 下载所有 ZIP 文件 ===")
    wait = WebDriverWait(driver, 15)

    try:
        wait.until(
            EC.presence_of_all_elements_located(
                (By.XPATH, "//tr[contains(., '.zip')] | //div[contains(., '.zip') and @role='row']")
            )
        )
        zip_rows = driver.find_elements(
            By.XPATH, "//tr[contains(., '.zip')] | //div[contains(., '.zip') and @role='row']"
        )
    except TimeoutException:
        logger.error("未找到任何 .zip 文件行")
        return []

    logger.info(f"找到 {len(zip_rows)} 个 .zip 文件行")
    downloaded_files = []

    for i, row in enumerate(zip_rows):
        try:
            file_name_elem = row.find_element(
                By.XPATH,
                ".//span[contains(., '.zip')] | .//div[contains(., '.zip')] | .//a[contains(., '.zip')]",
            )
            file_name = file_name_elem.text.strip()
            logger.info(f"[{i + 1}] 处理文件: {file_name[:50]}...")
        except (NoSuchElementException, StaleElementReferenceException):
            logger.warning(f"[{i + 1}] 无法提取文件名，跳过")
            continue

        download_btn = None
        try:
            download_btn = row.find_element(
                By.XPATH,
                ".//button[contains(text(), 'Download')] | "
                ".//a[contains(text(), 'Download')] | "
                ".//span[contains(text(), 'Download')]/parent::button",
            )
        except NoSuchElementException:
            buttons = row.find_elements(By.TAG_NAME, "button")
            if buttons:
                download_btn = buttons[-1]

        if not download_btn or not download_btn.is_displayed():
            logger.warning(f"    下载按钮不可见，跳过: {file_name[:30]}")
            continue

        # 修复：JS 点击优先，避免被遮挡；ActionChains 作为 fallback
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", download_btn)
        time.sleep(0.5)
        try:
            driver.execute_script("arguments[0].click();", download_btn)
        except Exception:
            try:
                ActionChains(driver).move_to_element(download_btn).click(download_btn).perform()
            except (ElementNotInteractableException, StaleElementReferenceException):
                driver.execute_script("arguments[0].click();", download_btn)

        logger.info(f"    已点击下载: {file_name[:30]}...")

        # 等待文件真正落盘完成
        if wait_for_download_complete(download_dir, file_name, timeout=120):
            downloaded_files.append(file_name)
        else:
            logger.warning(f"    文件下载未确认: {file_name}")

        # 两次下载之间稍作缓冲
        time.sleep(2)

    logger.info(f"=== 下载完成，成功确认 {len(downloaded_files)} 个文件 ===")
    for f in downloaded_files:
        logger.info(f"  - {f}")

    return downloaded_files


# -----------------------------------------------------------------------------
# 9. 主流程（含步骤重试 + 日期回退）
# -----------------------------------------------------------------------------
def run_with_retry(step_func, step_name, *args, max_retries=STEP_MAX_RETRIES, **kwargs):
    """对单个步骤执行重试。"""
    for attempt in range(max_retries + 1):
        try:
            result = step_func(*args, **kwargs)
            if result:
                return result
            if attempt < max_retries:
                logger.warning(f"[{step_name}] 第 {attempt + 1} 次尝试失败，重试...")
                time.sleep(3)
            else:
                logger.error(f"[{step_name}] {max_retries + 1} 次尝试均失败")
                return result
        except Exception as e:
            if attempt < max_retries:
                logger.warning(f"[{step_name}] 第 {attempt + 1} 次异常: {e}，重试...")
                time.sleep(3)
            else:
                logger.error(f"[{step_name}] {max_retries + 1} 次尝试均异常: {e}")
                raise
    return False


def extract_and_copy_psd(download_dir, dest_dir=PSD_UAT_DEST_DIR):
    """在 downloads 目录中找到 NB_MAIN_RPT_FINAL_PSD_20*.zip，解压并将 CSV 复制到目标目录。"""
    logger.info("=== 解压并复制 PSD 文件到 UAT 目录 ===")

    # 查找匹配的 ZIP 文件（排除 _BA_ 变体）
    pattern = os.path.join(download_dir, "NB_MAIN_RPT_FINAL_PSD_20*.zip")
    zip_files = sorted(glob.glob(pattern))
    # 排除 _BA_ 变体
    zip_files = [f for f in zip_files if "_BA_" not in os.path.basename(f)]

    if not zip_files:
        logger.warning(f"未找到匹配的 ZIP 文件: {pattern}")
        return None

    # 取最新的一个
    zip_path = zip_files[-1]
    zip_name = os.path.basename(zip_path)
    logger.info(f"找到 ZIP 文件: {zip_name}")

    # 解压到 downloads 目录
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(download_dir)
            extracted_names = zf.namelist()
        logger.info(f"解压完成: {extracted_names}")
    except zipfile.BadZipFile as e:
        logger.error(f"ZIP 文件损坏: {e}")
        return None
    except Exception as e:
        logger.error(f"解压失败: {e}")
        return None

    # 取解压出的 CSV 文件路径
    csv_name = extracted_names[0] if extracted_names else None
    if not csv_name or not csv_name.endswith(".csv"):
        logger.error(f"解压结果不是 CSV 文件: {extracted_names}")
        return None

    csv_src = os.path.join(download_dir, csv_name)

    # 复制到目标目录
    os.makedirs(dest_dir, exist_ok=True)
    csv_dest = os.path.join(dest_dir, csv_name)

    try:
        shutil.copy2(csv_src, csv_dest)
        dest_size = os.path.getsize(csv_dest)
        logger.info(f"已复制到: {csv_dest} ({dest_size:,} bytes)")
    except Exception as e:
        logger.error(f"复制到目标目录失败: {e}")
        return None

    return csv_dest


def main():
    driver = None
    try:
        logger.info("=== 第四步：查询并下载 PSD 报表 ===")

        logger.info("启动 ChromeDriver...")
        driver, download_dir = setup_driver(headless=False)

        logger.info("访问首页...")
        driver.get("https://planning.lenovo.com/portal/home")
        wait_for_js_render(driver)

        # 登录态检查
        ensure_logged_in(driver)

        logger.info("点击 PCG Planning UI...")
        click_pcg_ui(driver)

        target_url = "https://planning.lenovo.com/pcg/one-plan/reporting"
        logger.info(f"访问 Reporting 页面: {target_url}")
        driver.get(target_url)
        wait_for_js_render(driver)

        if not run_with_retry(query_psd_files, "查询PSD", driver):
            logger.error("查询失败")
            input("按 Enter 退出...")
            return

        # 修复：使用工作日日期 + 回退机制
        date_expanded = False
        for date_str in get_workday_with_fallback(max_fallback_days=7):
            logger.info(f"尝试日期: {date_str}")
            if run_with_retry(expand_date_folder, f"展开日期({date_str})", driver, date_str):
                date_expanded = True
                logger.info(f"成功展开日期文件夹: {date_str}")
                break
            else:
                logger.warning(f"日期 {date_str} 无文件，尝试更早日期...")

        if not date_expanded:
            logger.error("最近 7 个工作日均无 PSD 文件")
            input("按 Enter 退出...")
            return

        if not run_with_retry(expand_nb_main_fixed, "展开NB/MAIN", driver):
            logger.error("展开 NB/MAIN 失败")
            input("按 Enter 退出...")
            return

        downloaded = download_all_zip_files(driver, download_dir)
        if downloaded:
            logger.info(f"成功下载 {len(downloaded)} 个文件到: {download_dir}")

            # 解压 NB_MAIN_RPT_FINAL_PSD ZIP 并复制到 UAT 目录
            psd_dest = extract_and_copy_psd(download_dir)
            if psd_dest:
                logger.info(f"PSD CSV 已保存到: {psd_dest}")
            else:
                logger.warning("PSD 解压/复制未完成，请手动处理")
        else:
            logger.error("未下载任何文件")

        input("\n按 Enter 关闭浏览器...")

    except Exception as e:
        logger.error(f"发生错误: {e}")
        traceback.print_exc()
        input("按 Enter 退出...")

    finally:
        if driver:
            driver.quit()
            logger.info("浏览器已关闭")


if __name__ == "__main__":
    main()
