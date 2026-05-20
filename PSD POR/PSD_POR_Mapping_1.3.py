import pandas as pd
from PyQt5.QtWidgets import QApplication, QWidget, QPushButton, QLabel, QFileDialog, QMessageBox, QGridLayout


class MergeData(QWidget):
    def __init__(self):
        super().__init__()

        self.initUI()

    def initUI(self):
        # Set window title, size and position
        self.setWindowTitle('Merge Data')
        self.setMinimumSize(500, 300)

        # Create main layout and sub-layouts
        main_layout = QGridLayout(self)
        self.top_layout = QGridLayout()
        self.bottom_layout = QGridLayout()

        # Create label texts
        font = self.font()
        font.setPointSize(10)

        self.label1 = QLabel('LNB_PSD', self)
        self.label1.setFont(font)
        self.top_layout.addWidget(self.label1, 0, 0)

        self.label2 = QLabel('POR', self)
        self.label2.setFont(font)
        self.top_layout.addWidget(self.label2, 1, 0)

        self.label3 = QLabel('Merge', self)
        self.label3.setFont(font)
        self.bottom_layout.addWidget(self.label3, 0, 0)

        # Create select file buttons
        for i in range(2):
            button = QPushButton(self)
            button.setText('Select File')
            button.setFont(font)
            button.setStyleSheet(self.button_style_sheet())
            button.setFixedHeight(max(30, int(self.size().height() / 20)))
            if i == 0:
                self.button1 = button
                self.top_layout.addWidget(self.button1, 0, 1)
                self.button1.clicked.connect(self.get_LNB_PSD_file)
            else:
                self.button2 = button
                self.top_layout.addWidget(self.button2, 1, 1)
                self.button2.clicked.connect(self.get_LNB_POR_file)

        # Create save file button
        self.button3 = QPushButton('Create', self)
        self.button3.setFont(font)
        self.button3.setStyleSheet(self.button_style_sheet())
        self.button3.setFixedHeight(max(30, int(self.size().height() / 20)))
        self.bottom_layout.addWidget(self.button3, 0, 1)
        self.button3.clicked.connect(self.save_result_file)

        main_layout.addLayout(self.top_layout, 0, 0)
        main_layout.addLayout(self.bottom_layout, 1, 0)

        # Create message box
        self.message_box = QMessageBox(self)

    def resizeEvent(self, event):
        # Dynamically adjust control size and position
        font = self.font()
        font.setPointSize(max(10, int(event.size().height() / 30)))
        max_height = max(30, int(event.size().height() / 20))

        for label in [self.label1, self.label2, self.label3]:
            label.setFont(font)

        for button in [self.button1, self.button2, self.button3]:
            button.setFont(font)
            button.setFixedHeight(max_height)

    def get_LNB_PSD_file(self):
        # Open LNB_PSD.xlsx file
        options = QFileDialog.Options()
        options |= QFileDialog.DontUseNativeDialog
        file_name, _ = QFileDialog.getOpenFileName(self, 'Select LNB_PSD.xlsx', '', 'Excel Files (*.xlsx)',
                                                   options=options)
        if file_name:
            self.LNB_PSD_file = file_name
            self.message_box.information(self, 'Notice', 'LNB_PSD.xlsx file is selected!')

    def get_LNB_POR_file(self):
        # Open POR.csv file
        options = QFileDialog.Options()
        options |= QFileDialog.DontUseNativeDialog
        file_name, _ = QFileDialog.getOpenFileName(self, 'Select POR.csv', '', 'CSV Files (*.csv)', options=options)
        if file_name:
            self.LNB_POR_file = file_name
            self.message_box.information(self, 'Notice', 'POR.csv file is selected!')

    def save_result_file(self):
        # Read and merge data from LNB_PSD.xlsx and POR.csv files
        try:
            df1 = pd.read_excel(self.LNB_PSD_file, sheet_name='PSD', keep_default_na=False)
            df1.rename(columns={'MTM': 'PN'}, inplace=True)
            df1['GEO'].replace('APMM', 'AP', inplace=True)
            df1['GEO'].replace('APEM', 'AP', inplace=True)
            df1['GEO'].replace('AG', 'LAS', inplace=True)
            df1['GEO'].loc[df1['Sub GEO'] == 'NA'] = 'NA'

            df2 = pd.read_csv(self.LNB_POR_file, low_memory=False, encoding='ANSI')
            df3 = df2.drop(labels=['Model Number', 'NUMBER', 'STATE', 'Code_Name', 'DESC_EN', 'Series', 'sub_geo', 'CSPN',
                                   'sub_series'], axis=1)

            result = pd.merge(df1, df3[['PN', 'Battery', 'Camera', 'Hard_Drive', 'SSD', 'Display_Type', 'VGA',
                                        'EMMC', 'Wireless_LAN', 'Wireless_Wan', 'Language',
                                        'Real Qualification Date',
                                        '2nd pen', 'Other2', 'Processor_AMD', 'Processor_CP']], how='left', on='PN',
                              suffixes=('', '_y'))
            result.drop(result.filter(regex='_y$').columns.tolist(), axis=1, inplace=True)
            file_name, _ = QFileDialog.getSaveFileName(self, 'Save Result', '', 'Excel Files (*.xlsx)')
            if file_name:
                result.to_excel(file_name, index=False)
                self.message_box.information(self, 'Notice', 'Result is saved!')
        except Exception as e:
            self.message_box.critical(self, 'Error', str(e))

    @staticmethod
    def button_style_sheet():
        return '''QPushButton {
                        background-color: #f7f7f7;
                        border: 1px solid #cfcfcf;
                        border-radius: 3px;
                        color: #333;
                        padding: 4px;
                        }
                  QPushButton:hover {
                        background-color: #fafafa;
                        }
                  QPushButton:pressed {
                        background-color: #f0f0f0;
                        }'''
if __name__ == '__main__':
    app = QApplication([])
    merge_data = MergeData()
    merge_data.show()
    app.exec_()