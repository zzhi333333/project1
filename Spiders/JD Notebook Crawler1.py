import requests
import csv
import openpyxl
from bs4 import BeautifulSoup
from PyQt5.QtWidgets import QApplication, QLineEdit, QPushButton, QLabel, QVBoxLayout, QHBoxLayout, QWidget, QFileDialog
import sys

class JDNotebookCrawler(QWidget):
    def __init__(self):
        super().__init__()

        # 初始化界面和布局
        self.initUI()

    def initUI(self):
        # 创建搜索框和按钮，并设置默认搜索关键词
        self.search_box = QLineEdit('笔记本电脑')
        self.search_btn = QPushButton('搜索')
        self.search_btn.clicked.connect(self.crawl)

        # 创建输出区域
        self.output_label = QLabel('')

        # 创建界面布局
        vbox = QVBoxLayout()
        hbox = QHBoxLayout()
        hbox.addWidget(self.search_box)
        hbox.addWidget(self.search_btn)
        vbox.addLayout(hbox)
        vbox.addWidget(self.output_label)
        self.setLayout(vbox)

        # 设置界面标题和大小
        self.setWindowTitle('京东笔记本电脑抓取器')
        self.resize(400, 300)

    def crawl(self):
        # 获取搜索关键词
        keyword = self.search_box.text()

        # 构造请求URL，发送 GET 请求
        url = 'https://search.jd.com/Search?keyword={}&enc=utf-8&wq={}'.format(keyword, keyword)
        r = requests.get(url)

        # 使用 BeautifulSoup 对返回的 HTML 进行解析
        soup = BeautifulSoup(r.text, 'html.parser')

        # 遍历每个商品，提取名称和价格信息
        items = soup.find_all('div', class_='gl-i-wrap')
        result = []
        for item in items:
            try:
                name = item.find('div', class_='p-name').find('a').text.strip()
                price = item.find('div', class_='p-price').strong.i.text.strip()
                result.append([name, price])
            except:
                continue

        # 弹出文件对话框，选择保存路径和文件类型
        options = QFileDialog.Options()
        file_type = "CSV (*.csv);;Excel (*.xlsx)"
        save_path, _ = QFileDialog.getSaveFileName(self, "保存文件", "", file_type, options=options)
        if save_path.endswith('.xlsx'):
            # 创建 xlsx 文件并写入数据
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = 'Notebook'
            for row in result:
                ws.append(row)
            wb.save(save_path)
        else:
            # 将结果保存为 csv 文件
            with open(save_path, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                writer.writerow(['名称', '价格'])
                writer.writerows(result)

        # 显示输出结果
        output_str = '已将搜索结果保存到文件：{}'.format(save_path)
        self.output_label.setText(output_str)

        # 退出程序
        sys.exit(app.exec_())


if __name__ == '__main__':
    app = QApplication(sys.argv)
    crawler = JDNotebookCrawler()
    crawler.show()
    sys.exit(app.exec_())