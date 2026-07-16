# step4_query_and_download_fixed.py
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from datetime import datetime, timedelta
import time
import os

def setup_driver(headless=False):
    chrome_options = Options()
    if headless:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")
    
    # 设置下载目录
    download_dir = os.path.join(os.getcwd(), "downloads")
    if not os.path.exists(download_dir):
        os.makedirs(download_dir)
    
    prefs = {
        "download.default_directory": download_dir,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True
    }
    chrome_options.add_experimental_option("prefs", prefs)
    
    driver_path = r"D:\driver\chromedriver-win64\chromedriver.exe"
    service = Service(driver_path)
    driver = webdriver.Chrome(service=service, options=chrome_options)
    return driver, download_dir

def wait_for_js_render(driver, timeout=30):
    """等待 JavaScript 渲染完成"""
    wait = WebDriverWait(driver, timeout)
    wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
    time.sleep(3)

def check_and_switch_iframes(driver):
    """检查并切换到包含 PCG_UI 的 iframe"""
    iframes = driver.find_elements(By.TAG_NAME, "iframe")
    for i, iframe in enumerate(iframes):
        try:
            driver.switch_to.frame(iframe)
            driver.find_element(By.ID, "PCG_UI")
            return True
        except:
            driver.switch_to.default_content()
    driver.switch_to.default_content()
    return False

def click_pcg_ui(driver):
    """点击 PCG Planning UI 链接"""
    try:
        pcg_link = driver.find_element(By.ID, "PCG_UI")
    except:
        check_and_switch_iframes(driver)
        pcg_link = driver.find_element(By.ID, "PCG_UI")
    
    pcg_link.click()
    time.sleep(3)
    
    if len(driver.window_handles) > 1:
        driver.switch_to.window(driver.window_handles[-1])

def get_yesterday_date():
    """获取昨天的日期（YYYYMMDD格式）"""
    yesterday = datetime.now() - timedelta(days=1)
    return yesterday.strftime("%Y%m%d")

def query_psd_files(driver):
    """在 File Name 框输入 PSD 并查询"""
    print("\n=== 查询 PSD 文件 ===")
    
    try:
        file_name_input = driver.find_element(By.XPATH, "//input[@placeholder='请输入']")
        print("✓ 找到 File Name 输入框")
    except:
        try:
            inputs = driver.find_elements(By.TAG_NAME, "input")
            for inp in inputs:
                if inp.is_displayed() and inp.get_attribute("placeholder"):
                    file_name_input = inp
                    print("✓ 找到 File Name 输入框")
                    break
        except Exception as e:
            print(f"✗ 无法找到 File Name 输入框: {e}")
            return False
    
    file_name_input.clear()
    file_name_input.send_keys("PSD")
    print("✓ 已输入 'PSD'")
    
    try:
        query_btn = driver.find_element(By.XPATH, "//button[contains(text(), '查询')]")
        print("✓ 找到查询按钮")
    except:
        try:
            buttons = driver.find_elements(By.TAG_NAME, "button")
            for btn in buttons:
                if btn.is_displayed() and ("查询" in btn.text or "搜索" in btn.text):
                    query_btn = btn
                    print("✓ 找到查询按钮")
                    break
        except Exception as e:
            print(f"✗ 无法找到查询按钮: {e}")
            return False
    
    query_btn.click()
    print("✓ 已点击查询按钮")
    time.sleep(5)
    print("✓ 等待查询结果加载完成")
    
    return True

def expand_date_folder(driver, date_str):
    """展开指定日期的文件夹"""
    print(f"\n=== 展开日期文件夹: {date_str} ===")
    
    try:
        date_row = driver.find_element(By.XPATH, f"//tr[contains(., '{date_str}')] | //div[contains(., '{date_str}') and @role='row'] | //span[contains(text(), '{date_str}')]/ancestor::tr")
        print(f"✓ 找到日期行: {date_str}")
        
        try:
            expand_btn = date_row.find_element(By.XPATH, ".//i[contains(@class, 'arrow')] | .//span[contains(@class, 'expand')] | .//button[contains(@class, 'expand')] | .//div[contains(@class, 'tree')]//i")
        except:
            expand_btn = date_row
        
        row_class = date_row.get_attribute("class") or ""
        if "expanded" in row_class or "open" in row_class:
            print(f"  日期文件夹已展开")
        else:
            print(f"  点击展开日期文件夹...")
            expand_btn.click()
            time.sleep(2)
        
        return True
    except Exception as e:
        print(f"✗ 无法展开日期文件夹 {date_str}: {e}")
        return False

def expand_nb_main_fixed(driver):
    """展开 NB -> MAIN 路径（修正点击逻辑）"""
    print("\n=== 展开 NB -> MAIN ===")
    
    # 等待 NB 行加载
    time.sleep(3)
    
    # 1. 展开 NB
    print("1. 查找并展开 NB...")
    
    # 查找 NB 行（使用更精确的匹配）
    nb_row = None
    try:
        all_rows = driver.find_elements(By.XPATH, "//tr | //div[@role='row']")
        for i, row in enumerate(all_rows):
            try:
                text = row.text.strip()
                lines = text.split('\n')
                first_line = lines[0].strip() if lines else ""
                
                # 匹配条件：第一行是 NB（可能带箭头）
                if first_line in ['NB', '▶ NB', '▼ NB', '▸ NB', '▾ NB'] or \
                   (first_line.startswith('NB') and len(first_line) <= 5):
                    nb_row = row
                    print(f"  ✓ 找到 NB 行 [{i}]: {repr(text[:50])}")
                    break
            except:
                continue
        
        if not nb_row:
            raise Exception("未找到 NB 行")
            
    except Exception as e:
        print(f"  ✗ 无法找到 NB 行: {e}")
        return False
    
    # 检查 NB 是否已展开
    nb_text = nb_row.text
    is_expanded = '▼' in nb_text or '▾' in nb_text
    
    if is_expanded:
        print("  NB 已展开")
    else:
        print(f"  NB 未展开，准备点击...")
        
        # 尝试多种点击方式
        clicked = False
        
        # 方式1: 查找并点击箭头图标
        try:
            arrow = nb_row.find_element(By.XPATH, 
                ".//i[contains(@class, 'arrow')] | " +
                ".//span[contains(@class, 'arrow')] | " +
                ".//div[contains(@class, 'arrow')] | " +
                ".//i[contains(@class, 'caret')] | " +
                ".//span[contains(@class, 'caret')] | " +
                ".//i[contains(@class, 'expand')] | " +
                ".//span[contains(text(), '▶')] | " +
                ".//span[contains(text(), '▸')]"
            )
            print(f"    找到箭头图标，点击...")
            arrow.click()
            clicked = True
        except Exception as e:
            print(f"    未找到箭头图标: {e}")
        
        # 方式2: 点击行首的图标/按钮
        if not clicked:
            try:
                first_icon = nb_row.find_element(By.XPATH, ".//i[1] | .//button[1] | .//span[1]")
                print(f"    点击行首图标...")
                first_icon.click()
                clicked = True
            except Exception as e:
                print(f"    未找到行首图标: {e}")
        
        # 方式3: 使用 JavaScript 点击行内的第一个可见元素
        if not clicked:
            try:
                first_elem = driver.execute_script("""
                    var row = arguments[0];
                    var elems = row.querySelectorAll('i, button, span, div');
                    for (var i = 0; i < elems.length; i++) {
                        if (elems[i].offsetWidth > 0 && elems[i].offsetHeight > 0) {
                            return elems[i];
                        }
                    }
                    return null;
                """, nb_row)
                if first_elem:
                    print(f"    使用 JavaScript 点击第一个可见元素...")
                    driver.execute_script("arguments[0].click();", first_elem)
                    clicked = True
            except Exception as e:
                print(f"    JavaScript 点击失败: {e}")
        
        # 方式4: 直接点击整行
        if not clicked:
            try:
                print(f"    点击整行...")
                nb_row.click()
                clicked = True
            except Exception as e:
                print(f"    点击整行失败: {e}")
        
        if not clicked:
            print(f"  ✗ 所有点击方式都失败")
            return False
        
        # 等待展开动画完成
        print(f"  等待 3 秒让 NB 展开...")
        time.sleep(3)
    
    # 验证 NB 是否展开成功
    print(f"\n2. 验证 NB 展开状态...")
    try:
        nb_row = driver.find_element(By.XPATH, "//tr[contains(., 'NB')] | //div[contains(., 'NB') and @role='row']")
        nb_text_after = nb_row.text
        
        if '▼' in nb_text_after or '▾' in nb_text_after or 'MAIN' in nb_text_after:
            print(f"  ✓ NB 展开成功")
        else:
            print(f"  ⚠ NB 可能未展开，当前文本: {repr(nb_text_after[:50])}")
    except:
        print(f"  ⚠ 无法重新获取 NB 行")
    
    # 调试：打印展开后的所有行
    print(f"\n3. 调试：NB 展开后的所有行...")
    all_rows = driver.find_elements(By.XPATH, "//tr | //div[@role='row']")
    print(f"  总共 {len(all_rows)} 行:")
    for i, row in enumerate(all_rows[:20]):
        try:
            if row.is_displayed():
                text = row.text.strip()
                if text and len(text) < 100:
                    print(f"    [{i}] {repr(text[:70])}")
        except:
            pass
    
    # 4. 展开 MAIN
    print(f"\n4. 查找并展开 MAIN...")
    time.sleep(2)
    
    main_row = None
    try:
        all_rows = driver.find_elements(By.XPATH, "//tr | //div[@role='row']")
        for i, row in enumerate(all_rows):
            try:
                text = row.text.strip()
                lines = text.split('\n')
                first_line = lines[0].strip() if lines else ""
                
                # 匹配 MAIN（可能带箭头）
                if first_line in ['MAIN', '▶ MAIN', '▼ MAIN', '▸ MAIN', '▾ MAIN'] or \
                   (first_line.startswith('MAIN') and len(first_line) <= 8):
                    main_row = row
                    print(f"  ✓ 找到 MAIN 行 [{i}]: {repr(text[:50])}")
                    break
            except:
                continue
        
        if not main_row:
            raise Exception("未找到 MAIN 行")
            
    except Exception as e:
        print(f"  ✗ 无法找到 MAIN 行: {e}")
        return False
    
    # 检查 MAIN 是否已展开
    main_text = main_row.text
    is_main_expanded = '▼' in main_text or '▾' in main_text
    
    if is_main_expanded:
        print("  MAIN 已展开")
    else:
        print(f"  点击展开 MAIN...")
        
        clicked = False
        
        # 方式1: 点击箭头
        try:
            arrow = main_row.find_element(By.XPATH, 
                ".//i[contains(@class, 'arrow')] | " +
                ".//span[contains(@class, 'arrow')] | " +
                ".//span[contains(text(), '▶')] | " +
                ".//span[contains(text(), '▸')]"
            )
            arrow.click()
            clicked = True
            print(f"    点击箭头成功")
        except:
            pass
        
        # 方式2: 点击行首图标
        if not clicked:
            try:
                first_icon = main_row.find_element(By.XPATH, ".//i[1] | .//button[1] | .//span[1]")
                first_icon.click()
                clicked = True
                print(f"    点击行首图标成功")
            except:
                pass
        
        # 方式3: 点击整行
        if not clicked:
            try:
                main_row.click()
                clicked = True
                print(f"    点击整行成功")
            except:
                pass
        
        if not clicked:
            print(f"  ✗ 无法展开 MAIN")
            return False
        
        time.sleep(3)
    
    print(f"  ✓ MAIN 展开完成")
    return True

def download_all_zip_files(driver, download_dir):
    """下载所有 .zip 文件"""
    print("\n=== 下载所有 ZIP 文件 ===")
    
    try:
        zip_rows = driver.find_elements(By.XPATH, "//tr[contains(., '.zip')] | //div[contains(., '.zip') and @role='row']")
        print(f"✓ 找到 {len(zip_rows)} 个 .zip 文件行")
        
        downloaded_files = []
        
        for i, row in enumerate(zip_rows):
            try:
                file_name_elem = row.find_element(By.XPATH, ".//span[contains(., '.zip')] | .//div[contains(., '.zip')] | .//a[contains(., '.zip')]")
                file_name = file_name_elem.text.strip()
                print(f"\n  [{i+1}] 处理文件: {file_name[:50]}...")
                
                try:
                    download_btn = row.find_element(By.XPATH, ".//button[contains(text(), 'Download')] | .//a[contains(text(), 'Download')] | .//span[contains(text(), 'Download')]/parent::button")
                except:
                    buttons = row.find_elements(By.TAG_NAME, "button")
                    download_btn = buttons[-1] if buttons else None
                
                if download_btn and download_btn.is_displayed():
                    driver.execute_script("arguments[0].scrollIntoView(true);", download_btn)
                    time.sleep(1)
                    download_btn.click()
                    print(f"    ✓ 已点击下载: {file_name[:30]}...")
                    downloaded_files.append(file_name)
                    time.sleep(3)
                else:
                    print(f"    ✗ 下载按钮不可见")
                    
            except Exception as e:
                print(f"    ✗ 下载失败: {str(e)[:100]}")
                continue
        
        print(f"\n=== 下载完成 ===")
        print(f"成功下载 {len(downloaded_files)} 个文件:")
        for f in downloaded_files:
            print(f"  - {f}")
        
        time.sleep(10)
        print(f"\n文件下载目录: {download_dir}")
        
        return downloaded_files
        
    except Exception as e:
        print(f"✗ 查找 .zip 文件失败: {e}")
        return []

def main():
    try:
        print("=== 第四步：查询并下载 PSD 报表 ===\n")
        
        # 1. 启动浏览器
        print("启动 ChromeDriver...")
        driver, download_dir = setup_driver(headless=False)
        
        # 2. 访问首页并进入 PCG UI
        print("\n访问首页...")
        driver.get("https://planning.lenovo.com/portal/home")
        wait_for_js_render(driver)
        
        print("点击 PCG Planning UI...")
        click_pcg_ui(driver)
        
        # 3. 进入 Reporting 页面
        target_url = "https://planning.lenovo.com/pcg/one-plan/reporting"
        print(f"\n访问 Reporting 页面: {target_url}")
        driver.get(target_url)
        wait_for_js_render(driver)
        
        # 4. 查询 PSD
        if not query_psd_files(driver):
            print("✗ 查询失败")
            input("按 Enter 退出...")
            return
        
        # 5. 获取昨天日期并展开文件夹
        yesterday = get_yesterday_date()
        print(f"\n昨天日期: {yesterday}")
        
        if not expand_date_folder(driver, yesterday):
            print("✗ 展开日期文件夹失败")
            input("按 Enter 退出...")
            return
        
        # 6. 展开 NB -> MAIN（使用修正版函数）
        if not expand_nb_main_fixed(driver):
            print("✗ 展开 NB/MAIN 失败")
            input("按 Enter 退出...")
            return
        
        # 7. 下载所有 ZIP 文件
        downloaded = download_all_zip_files(driver, download_dir)
        
        if downloaded:
            print(f"\n✓ 成功下载 {len(downloaded)} 个文件到: {download_dir}")
        else:
            print("\n✗ 未下载任何文件")
        
        input("\n按 Enter 关闭浏览器...")
        
    except Exception as e:
        print(f"\n✗ 发生错误: {e}")
        import traceback
        traceback.print_exc()
        input("按 Enter 退出...")
        
    finally:
        if 'driver' in locals():
            driver.quit()
            print("浏览器已关闭")

if __name__ == "__main__":
    main()