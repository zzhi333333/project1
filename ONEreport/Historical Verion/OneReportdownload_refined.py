# step4_query_and_download_refactored.py
# 本文件为 OneReportdownload.py 的优化参考版本，供调试和对比使用。
# 优化点：显式等待替代 time.sleep、精确异常捕获、下载完成校验、日志化、提取公共展开逻辑、
#        webdriver-manager 自动管理驱动、XPath 安全性增强、StaleElement 重试机制等。

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
import logging
import os
import time
import traceback

# -----------------------------------------------------------------------------
# 日志配置
# -----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        # 如需持久化可取消下面注释：
        # logging.FileHandler("one_report_download.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# 常量 / 配置
# -----------------------------------------------------------------------------
CHROME_DRIVER_PATH = r"D:\driver\chromedriver-win64\chromedriver.exe"
USE_WEBDRIVER_MANAGER = True  # 设为 False 可回退到硬编码路径
DEBUG_PRINT_TREE_ROWS = False  # 控制是否打印展开后的树行调试信息
STALE_ELEMENT_RETRIES = 3


# -----------------------------------------------------------------------------
# 辅助装饰器：自动重试 StaleElementReferenceException
# -----------------------------------------------------------------------------
def retry_on_stale(func):
    """对可能遭遇 DOM 刷新的操作自动重试。"""

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

    # 下载目录：以脚本所在目录为基准，避免依赖当前工作目录(cwd)
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
    """等待 document.readyState == 'complete'，并额外等待可交互元素出现。"""
    wait = WebDriverWait(driver, timeout)
    wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
    # 再额外给一个极短缓冲，让前端框架完成首屏渲染
    time.sleep(0.5)


def check_and_switch_iframes(driver, max_depth=2):
    """递归查找包含 PCG_UI 的 iframe（支持嵌套）。"""

    def _search(current_depth):
        if current_depth > max_depth:
            return False
        iframes = driver.find_elements(By.TAG_NAME, "iframe")
        for iframe in iframes:
            try:
                driver.switch_to.frame(iframe)
                driver.find_element(By.ID, "PCG_UI")
                return True
            except NoSuchElementException:
                # 递归进入下一层
                if _search(current_depth + 1):
                    return True
                driver.switch_to.parent_frame()
            except StaleElementReferenceException:
                continue
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

    # 等待新窗口出现
    wait.until(EC.number_of_windows_to_be(2))

    # 切换到包含 pcg/one-plan 的窗口
    original = driver.current_window_handle
    for handle in driver.window_handles:
        if handle == original:
            continue
        driver.switch_to.window(handle)
        if "pcg" in driver.current_url or "planning" in driver.current_url:
            logger.info(f"已切换到新窗口: {driver.current_url}")
            return
    # 兜底：切到最后一个
    driver.switch_to.window(driver.window_handles[-1])


# -----------------------------------------------------------------------------
# 3. 日期工具
# -----------------------------------------------------------------------------
def get_yesterday_date():
    yesterday = datetime.now() - timedelta(days=1)
    return yesterday.strftime("%Y%m%d")


def get_last_workday_date():
    """获取上一个工作日（排除周六日）。"""
    dt = datetime.now() - timedelta(days=1)
    while dt.weekday() >= 5:  # 5=周六, 6=周日
        dt -= timedelta(days=1)
    return dt.strftime("%Y%m%d")


# -----------------------------------------------------------------------------
# 4. 查询 PSD
# -----------------------------------------------------------------------------
def query_psd_files(driver):
    logger.info("=== 查询 PSD 文件 ===")
    wait = WebDriverWait(driver, 15)

    # 定位 File Name 输入框
    try:
        file_name_input = wait.until(
            EC.element_to_be_clickable((By.XPATH, "//input[@placeholder='请输入']"))
        )
        logger.info("✓ 找到 File Name 输入框（精确定位）")
    except TimeoutException:
        inputs = driver.find_elements(By.TAG_NAME, "input")
        file_name_input = None
        for inp in inputs:
            try:
                if inp.is_displayed() and inp.get_attribute("placeholder"):
                    file_name_input = inp
                    logger.info("✓ 找到 File Name 输入框（兜底遍历）")
                    break
            except StaleElementReferenceException:
                continue
        if not file_name_input:
            logger.error("✗ 无法找到 File Name 输入框")
            return False

    # 安全清空输入框（兼容 React/Vue）
    file_name_input.click()
    file_name_input.send_keys(Keys.CONTROL, "a")
    file_name_input.send_keys(Keys.DELETE)
    file_name_input.send_keys("PSD")
    logger.info("✓ 已输入 'PSD'")

    # 定位查询按钮
    try:
        query_btn = wait.until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), '查询')]"))
        )
        logger.info("✓ 找到查询按钮（精确定位）")
    except TimeoutException:
        buttons = driver.find_elements(By.TAG_NAME, "button")
        query_btn = None
        for btn in buttons:
            try:
                if btn.is_displayed() and ("查询" in btn.text or "搜索" in btn.text):
                    query_btn = btn
                    logger.info("✓ 找到查询按钮（兜底遍历）")
                    break
            except StaleElementReferenceException:
                continue
        if not query_btn:
            logger.error("✗ 无法找到查询按钮")
            return False

    query_btn.click()
    logger.info("✓ 已点击查询按钮")

    # 显式等待结果加载：先等旧行消失或新行出现，避免后续拿到 stale element
    # 策略：先短暂 sleep 让前端开始渲染，再等待至少有一行结果出现
    time.sleep(2)
    try:
        wait.until(
            EC.presence_of_all_elements_located(
                (By.XPATH, "//tr | //div[@role='row']")
            )
        )
        logger.info("✓ 查询结果已加载")
    except TimeoutException:
        logger.warning("⚠ 未检测到结果行出现，继续执行")

    # 额外缓冲，让 DOM 稳定下来，这对减少 StaleElement 至关重要
    time.sleep(2)
    return True


# -----------------------------------------------------------------------------
# 5. 展开日期文件夹（安全 XPath + StaleElement 重试）
# -----------------------------------------------------------------------------
def safe_xpath_literal(value):
    """对 XPath 字符串中的单引号做安全转义。"""
    if "'" not in value:
        return f"'{value}'"
    parts = value.split("'")
    return "concat(" + ",'"  .join(parts) + ")"


@retry_on_stale
def _try_click_date_row(driver, date_str):
    """内部函数：尝试定位并点击日期行（会被 retry_on_stale 包裹重试）。"""
    safe_date = safe_xpath_literal(date_str)
    xpath = f"//tr[contains(., {safe_date})] | //div[contains(., {safe_date}) and @role='row'] | //span[contains(text(), {safe_date})]/ancestor::tr"

    wait = WebDriverWait(driver, 10)
    date_row = wait.until(EC.element_to_be_clickable((By.XPATH, xpath)))
    logger.info(f"✓ 找到日期行: {date_str}")

    row_class = date_row.get_attribute("class") or ""
    if "expanded" in row_class or "open" in row_class:
        logger.info("  日期文件夹已展开")
        return True

    # 尝试点击箭头，否则点击整行
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
        logger.info("  已点击展开日期文件夹")
        return True
    else:
        logger.error("  ✗ 无法展开日期文件夹")
        return False


def expand_date_folder(driver, date_str):
    logger.info(f"=== 展开日期文件夹: {date_str} ===")
    try:
        return _try_click_date_row(driver, date_str)
    except StaleElementReferenceException as e:
        logger.error(f"✗ 展开日期文件夹时元素持续失效: {e}")
        return False
    except TimeoutException as e:
        logger.error(f"✗ 无法找到日期行 {date_str}: {e}")
        return False


# -----------------------------------------------------------------------------
# 6. 通用树节点展开逻辑（提取 NB / MAIN 的公共部分）
# -----------------------------------------------------------------------------
def _find_tree_row_by_keyword(driver, keyword, timeout=10):
    """在可见行中查找第一行文本匹配 keyword 的行元素。"""
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
    """尝试点击行内的展开箭头/图标。"""
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
    except NoSuchElementException:
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


@retry_on_stale
def _try_expand_tree_node(driver, keyword, label):
    """通用树节点展开：会被 retry_on_stale 包裹自动重试。"""
    logger.info(f"[{label}] 查找并展开 {keyword}...")

    row = _find_tree_row_by_keyword(driver, keyword)
    if not row:
        logger.error(f"  ✗ 未找到 {keyword} 行")
        return False

    logger.info(f"  ✓ 找到 {keyword} 行")

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
        logger.error(f"  ✗ 所有点击方式都失败（{keyword}）")
        return False

    # 显式等待展开动画完成：再次获取行文本，验证包含展开箭头或子内容
    wait = WebDriverWait(driver, 10)
    try:
        wait.until(
            lambda d: "▼" in row.text
            or "▾" in row.text
            or "expanded" in (row.get_attribute("class") or "")
        )
        logger.info(f"  ✓ {keyword} 展开成功")
    except TimeoutException:
        logger.warning(f"  ⚠ {keyword} 展开状态未在预期时间内确认")

    time.sleep(1)  # 给子节点渲染留一点缓冲
    return True


def expand_nb_main_fixed(driver):
    """展开 NB -> MAIN 路径（基于通用展开逻辑的重构版）。"""
    logger.info("=== 展开 NB -> MAIN ===")

    try:
        if not _try_expand_tree_node(driver, "NB", label="1"):
            return False
    except StaleElementReferenceException as e:
        logger.error(f"✗ 展开 NB 时元素持续失效: {e}")
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
        logger.error(f"✗ 展开 MAIN 时元素持续失效: {e}")
        return False

    logger.info("  ✓ MAIN 展开完成")
    return True


# -----------------------------------------------------------------------------
# 7. 下载 ZIP 文件（含完成校验）
# -----------------------------------------------------------------------------
def wait_for_file_stable(file_path, timeout=60, poll_interval=1):
    """轮询文件出现且大小不再变化，返回是否成功。"""
    elapsed = 0
    while elapsed < timeout:
        if os.path.exists(file_path):
            size = os.path.getsize(file_path)
            time.sleep(poll_interval)
            if os.path.exists(file_path) and os.path.getsize(file_path) == size:
                return True
        else:
            time.sleep(poll_interval)
        elapsed += poll_interval
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
        logger.error("✗ 未找到任何 .zip 文件行")
        return []

    logger.info(f"✓ 找到 {len(zip_rows)} 个 .zip 文件行")
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

        # 定位下载按钮
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
            logger.warning(f"    ✗ 下载按钮不可见，跳过: {file_name[:30]}")
            continue

        # 滚动到可见并使用 ActionChains 点击（避免被固定表头遮挡）
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", download_btn)
        time.sleep(0.5)
        try:
            ActionChains(driver).move_to_element(download_btn).click(download_btn).perform()
        except (ElementNotInteractableException, StaleElementReferenceException):
            driver.execute_script("arguments[0].click();", download_btn)

        logger.info(f"    ✓ 已点击下载: {file_name[:30]}...")

        # 校验文件是否真正落盘
        target_path = os.path.join(download_dir, file_name)
        if wait_for_file_stable(target_path, timeout=60):
            logger.info(f"    ✓ 文件下载完成: {file_name}")
            downloaded_files.append(file_name)
        else:
            logger.warning(f"    ⚠ 文件未在 60s 内确认下载完成: {file_name}")

        # 两次下载之间稍作缓冲，避免触发限流
        time.sleep(2)

    logger.info(f"=== 下载完成，成功确认 {len(downloaded_files)} 个文件 ===")
    for f in downloaded_files:
        logger.info(f"  - {f}")

    return downloaded_files


# -----------------------------------------------------------------------------
# 8. 主流程
# -----------------------------------------------------------------------------
def main():
    driver = None
    try:
        logger.info("=== 第四步：查询并下载 PSD 报表 ===")

        logger.info("启动 ChromeDriver...")
        driver, download_dir = setup_driver(headless=False)

        logger.info("访问首页...")
        driver.get("https://planning.lenovo.com/portal/home")
        wait_for_js_render(driver)

        logger.info("点击 PCG Planning UI...")
        click_pcg_ui(driver)

        target_url = "https://planning.lenovo.com/pcg/one-plan/reporting"
        logger.info(f"访问 Reporting 页面: {target_url}")
        driver.get(target_url)
        wait_for_js_render(driver)

        if not query_psd_files(driver):
            logger.error("✗ 查询失败")
            input("按 Enter 退出...")
            return

        yesterday = get_yesterday_date()
        logger.info(f"昨天日期: {yesterday}")

        if not expand_date_folder(driver, yesterday):
            logger.error("✗ 展开日期文件夹失败")
            input("按 Enter 退出...")
            return

        if not expand_nb_main_fixed(driver):
            logger.error("✗ 展开 NB/MAIN 失败")
            input("按 Enter 退出...")
            return

        downloaded = download_all_zip_files(driver, download_dir)
        if downloaded:
            logger.info(f"✓ 成功下载 {len(downloaded)} 个文件到: {download_dir}")
        else:
            logger.error("✗ 未下载任何文件")

        input("\n按 Enter 关闭浏览器...")

    except Exception as e:
        logger.error(f"✗ 发生错误: {e}")
        traceback.print_exc()
        input("按 Enter 退出...")

    finally:
        if driver:
            driver.quit()
            logger.info("浏览器已关闭")


if __name__ == "__main__":
    main()
