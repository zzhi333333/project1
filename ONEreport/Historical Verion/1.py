import requests
import os

def download_video(url, save_path='video.mp4'):
    """
    下载视频文件
    :param url: 视频URL
    :param save_path: 保存路径
    """
    try:
        # 发送GET请求获取视频内容
        print("开始下载视频...")
        response = requests.get(url, stream=True)
        response.raise_for_status()  # 检查请求是否成功
        
        # 获取文件大小
        file_size = int(response.headers.get('content-length', 0))
        
        # 以二进制写入模式打开文件
        with open(save_path, 'wb') as file:
            # 如果知道文件大小，显示进度
            if file_size:
                downloaded = 0
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file.write(chunk)
                        downloaded += len(chunk)
                        # 计算下载进度
                        progress = int((downloaded / file_size) * 100)
                        print(f"\r下载进度: {progress}%", end='')
            else:
                # 如果不知道文件大小，直接写入
                file.write(response.content)
                
        print("\n下载完成！")
        print(f"视频已保存至: {os.path.abspath(save_path)}")
        
    except requests.exceptions.RequestException as e:
        print(f"下载失败: {e}")
    except IOError as e:
        print(f"文件写入失败: {e}")

# 视频URL
video_url = "https://f.video.weibocdn.com/ELrkZJg9lx07QfGMIYXe01041200GEZ10E010.mp4?label=mp4_1080p&template=1920x1080.25.0&trans_finger=d88af6227b88881484d2b59dfbafa136&media_id=4687488468582479&tp=8x8A3El:YTkl0eM8&us=0&ori=1&bf=3&ot=h&ps=3lckmu&uid=3ZoTIp&ab=,1493-g0,1192-g0,1191-g0,3601-g18,1258-g0&Expires=1732377501&ssig=%2FgGRcJAbnX&KID=unistore,video"

# 下载视频
download_video(video_url)