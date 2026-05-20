import requests
from bs4 import BeautifulSoup
import os
from datetime import datetime
import win32com.client as win32

#pywin32 module

def fetch_and_send_reports():
    # 登录页面的URL
    login_url = 'https://aps.lenovo.com/portal/api/login'  # 假设实际的API登录URL

    # 登录数据
    login_data = {
        'username': 'zengzhi1',  # 替换为实际用户名
        'password': 'anneFYzz111'  # 替换为实际密码
    }

    # 创建一个会话对象
    session = requests.Session()

    # 发送登录请求
    response = session.post(login_url, json=login_data)  # 使用json参数发送数据

    # 检查登录是否成功
    if response.status_code == 200:
        print('登录成功！')

        # 获取当天日期
        today = datetime.now().strftime('%Y%m%d')

        # 构建包含当天日期的URL
        browser_url = f'https://aps.lenovo.com/abpp_ui_global/lenovo/browser.jsp?dir=/lenovo/reportsRepository/PR/{today}#/'
        response = session.get(browser_url)

        # 解析页面内容
        soup = BeautifulSoup(response.text, 'html.parser')

        # 查找文件名包含RPT_PR_EXPANSION_TO_PARTS、RPT_PR_ORDER_EXECUTION_STATUS和RPT_PR_REQUEST_TRK的ZIP文件链接
        file_links = []
        for text in ['RPT_PR_EXPANSION_TO_PARTS', 'RPT_PR_ORDER_EXECUTION_STATUS', 'RPT_PR_REQUEST_TRK']:
            link = soup.find('a', href=True, string=lambda x: x and text in x)
            if link:
                file_url = link['href']
                file_name = link.text.strip()
                file_links.append((file_url, file_name))

        if file_links:
            download_paths = []
            for file_url, file_name in file_links:
                # 构建完整的文件下载URL
                full_file_url = f'https://aps.lenovo.com{file_url}'
                file_response = session.get(full_file_url)

                # 保持原文件名并附加.zip后缀
                if not file_name.endswith('.zip'):
                    file_name += '.zip'

                # 保存文件到指定目录
                download_path = os.path.join('C:\\Users\\zengzhi1\\Downloads', file_name)
                with open(download_path, 'wb') as file:
                    file.write(file_response.content)

                print(f'文件已下载并保存到: {download_path}')
                download_paths.append(download_path)

            # 使用win32com发送邮件
            outlook = win32.Dispatch('outlook.application')
            mail = outlook.CreateItem(0)
            mail.To = 'zengzhi1@lenovo.com'
            mail.Subject = 'PR report packages: Expansion, Execution_status, Request_TRK'
            mail.Body = 'Please find the attached reports.'

            # 添加附件
            for download_path in download_paths:
                mail.Attachments.Add(download_path)

            # 发送邮件
            mail.Send()

            print("邮件发送成功！")
        else:
            print('未找到符合条件的文件链接。')
    else:
        print('登录失败，状态码:', response.status_code)
        print('响应内容:', response.text)  # 打印详细的响应内容
fetch_and_send_reports()