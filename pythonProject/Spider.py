import requests

url='https://f.video.weibocdn.com/o0/CJebjtQFlx08gJ5EGZP2010412030Bpb0E020.mp4?label=mp4_1080p&template=1080x1920.24.0&media_id=5060411494694942&tp=8x8A3El:YTkl0eM8&us=0&ori=1&bf=4&ot=v&ps=3lckmu&uid=3ZoTIp&ab=,8013-g0,3601-g29&Expires=1722012522&ssig=oFCrVx7lx%2B&KID=unistore,video'

res=requests.get(url)
print(res.status_code)
open("video.mp4", 'wb').write(res.content)

