#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server.py —— 法律咨询助手 本地服务（Python 3.7+ 标准库，零依赖）

用法：
    python server.py            （默认端口 8080）
    set PORT=3000 && python server.py

与 server.js 功能一致：
    1. 静态托管当前目录
    2. /api/ping           存活探测
    3. /api/flk/search     国家法律法规数据库（flk.npc.gov.cn）检索
    4. /api/flk/detail     法规正文（含 Word/PDF/网页版链接）
    5. /api/cases/search   经公开搜索引擎定位 裁判文书网/最高法官网 案例
"""
import json
import os
import re
import sys
import time
import zlib
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# ---------------- 简易缓存（30 分钟） ----------------
_CACHE = {}
_TTL = 30 * 60


def cached(key, fn):
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    v = fn()
    _CACHE[key] = (time.time(), v)
    return v


# ---------------- 通用请求 ----------------
def http_request(url, method="GET", data=None, headers=None):
    """data 为 bytes 时按原样发送；返回 (status, bytes)。"""
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "zh-CN,zh;q=0.9"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # 自动处理重定向/gzip/deflate
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def html_to_text(html):
    html = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    html = re.sub(r"<style[\s\S]*?</style>", "", html, flags=re.I)
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    html = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", html, flags=re.I)
    html = re.sub(r"<[^>]+>", "", html)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
                 ("&gt;", ">"), ("&quot;", '"')):
        html = html.replace(a, b)
    html = re.sub(r"[ \t]+", " ", html)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", html).strip()


# ---------------- flk.npc.gov.cn（2026 新版 SPA 接口） ----------------
def _flk_headers(extra=None):
    h = {"Referer": "https://flk.npc.gov.cn/", "Origin": "https://flk.npc.gov.cn",
         "X-Requested-With": "XMLHttpRequest"}
    if extra:
        h.update(extra)
    return h


def _flk_get(path):
    status, body = http_request("https://flk.npc.gov.cn" + path,
                                headers=_flk_headers())
    if status != 200:
        raise RuntimeError("flk 返回状态 %s，可能被限流，请稍后重试" % status)
    return json.loads(body.decode("utf-8"))


def _flk_get(path):
    status, body = http_request("https://flk.npc.gov.cn" + path,
                                headers=_flk_headers())
    if status != 200:
        raise RuntimeError("flk 返回状态 %s，可能被限流，请稍后重试" % status)
    return json.loads(body.decode("utf-8"))


def flk_text(lid):
    """官方 docx 下载 → ZIP 解析 → 提取 word/document.xml 纯文本"""
    import io
    import zipfile
    d = flk_detail(lid)
    word_url = (d.get("links") or {}).get("word")
    if not word_url:
        raise RuntimeError("官方未提供 Word 文本或链接获取失败")
    status, buf = http_request(word_url, headers={"Referer": "https://flk.npc.gov.cn/"})
    if status != 200:
        raise RuntimeError("docx 下载失败（%s）" % status)
    zf = zipfile.ZipFile(io.BytesIO(buf))
    xml = zf.read("word/document.xml").decode("utf-8", "ignore")
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    xml = re.sub(r"</w:p>", "\n", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&apos;", "'")):
        text = text.replace(a, b)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) < 50:
        raise RuntimeError("docx 正文提取失败")
    return {"title": d.get("title"), "text": text, "chars": len(text)}


def flk_search(q, page=1):
    """POST /law-search/search/list —— 2026 新版接口（旧 POST /api/ 已下线）"""
    payload = json.dumps({
        "searchContent": q, "searchRange": 1, "searchType": 2,
        "sxx": [], "gbrq": [], "sxrq": [],
        "pageNum": page, "pageSize": 10,
    }).encode("utf-8")
    status, body = http_request(
        "https://flk.npc.gov.cn/law-search/search/list", method="POST", data=payload,
        headers=_flk_headers({"Content-Type": "application/json;charset=UTF-8"}))
    if status != 200:
        raise RuntimeError("flk 返回状态 %s，可能被限流，请稍后重试" % status)
    data = json.loads(body.decode("utf-8"))
    if data.get("code") != 200:
        raise RuntimeError("flk 检索失败：" + str(data.get("msg")))
    rows = data.get("rows") or []
    out = []
    for it in rows:
        out.append({
            "id": it.get("bbbs"),
            "title": re.sub(r"<[^>]+>", "", str(it.get("title") or "")),  # 去掉高亮标记
            "office": it.get("zdjgName"),
            "publish": it.get("gbrq") or "",
            "expiry": it.get("sxrq") or "",
            "type": it.get("flxz"),
            "status": str(it.get("sxx")),  # 1=已废止 2=已被修改 3=有效 4=尚未生效
        })
    return {"total": data.get("total") or len(out), "list": out}


def flk_detail(lid):
    """GET /law-search/search/flfgDetails → 元数据 + 官方文件签名直链"""
    data = _flk_get("/law-search/search/flfgDetails?bbbs=" + urllib.parse.quote(lid))
    if data.get("code") != 200 or not data.get("data"):
        raise RuntimeError("flk 详情获取失败：" + str(data.get("msg")))
    d = data["data"]
    xgzl = d.get("xgzl") or []

    def signed_download(fmt):
        try:
            j = _flk_get("/law-search/download/pc?format=%s&bbbs=%s"
                         % (fmt, urllib.parse.quote(lid)))
            if j.get("code") == 200 and j.get("data") and j["data"].get("url"):
                return j["data"]["url"]
        except Exception:
            pass
        return None

    links = {"relatedCount": len(xgzl)}
    if d.get("ossFile") and d["ossFile"].get("ossWordPath"):
        try:
            j = _flk_get("/law-search/amazonFile/previewLink?filePath="
                         + urllib.parse.quote(d["ossFile"]["ossWordPath"]))
            if j.get("code") == 200 and j.get("data") and j["data"].get("url"):
                links["preview"] = j["data"]["url"]
        except Exception:
            pass
    links["word"] = signed_download("docx")
    links["pdf"] = signed_download("pdf")    return {"title": d.get("title"), "links": links, "text": "",
            "meta": {"flxz": d.get("flxz"), "office": d.get("zdjgName"),
                     "publish": d.get("gbrq"), "expiry": d.get("sxrq"),
                     "status": str(d.get("sxx"))}}


# ---------------- 案例：经必应 site: 定位 ----------------
def bing_search(query):
    url = "https://cn.bing.com/search?q=" + urllib.parse.quote(query) + "&count=12&mkt=zh-CN"
    status, body = http_request(url)
    if status != 200:
        raise RuntimeError("搜索引擎返回状态 %s" % status)
    html = body.decode("utf-8", "ignore")
    out = []
    for m in re.finditer(r'<li class="b_algo"[^>]*>([\s\S]*?)</li>', html):
        block = m.group(1)
        tm = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', block)
        if not tm:
            continue
        url0 = tm.group(1).replace("&amp;", "&")
        title = html_to_text(tm.group(2))
        sm = re.search(r'<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)</p>', block) or \
             re.search(r"<p[^>]*>([\s\S]*?)</p>", block)
        snippet = html_to_text(sm.group(1)) if sm else ""
        if title and url0.startswith("http"):
            out.append({"title": title, "url": url0, "snippet": snippet})
        if len(out) >= 10:
            break
    return out


def case_search(q, site="wenshu"):
    site_filter = "site:www.court.gov.cn" if site == "court" else "site:wenshu.court.gov.cn"
    extra = "指导案例" if site == "court" else ""
    lst = bing_search(("%s %s %s" % (site_filter, q, extra)).strip())
    if not lst:
        lst = [x for x in bing_search("%s 裁判文书 %s" % (q, "指导性案例" if site == "court" else ""))
               if re.search(r"court\.gov\.cn|chinacourt|wenshu", x["url"], re.I)]
    return lst


# ---------------- HTTP Handler ----------------
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
        ".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # 静默访问日志

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        """AI 模型转发（OpenAI 兼容 chat/completions，支持 SSE 流式透传）"""
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/ai/chat":
            return self._json({"ok": False, "msg": "不支持的 POST 接口"}, 404)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            b = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json({"ok": False, "msg": "请求体不是合法 JSON"}, 400)
        base = (b.get("baseUrl") or "").rstrip("/")
        if not base.startswith(("http://", "https://")):
            return self._json({"ok": False, "msg": "baseUrl 无效"})
        import http.client
        u = urllib.parse.urlparse(base)
        port = u.port or (80 if u.scheme == "http" else 443)
        payload = json.dumps({
            "model": b.get("model"), "messages": b.get("messages"),
            "temperature": b.get("temperature"), "stream": bool(b.get("stream")),
        }, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + (b.get("apiKey") or ""),
            "Content-Length": str(len(payload)),
            "Accept": "text/event-stream, application/json",
        }
        try:
            cls = http.client.HTTPConnection if u.scheme == "http" else http.client.HTTPSConnection
            conn = cls(u.hostname, port, timeout=120)
            path = (u.path or "/chat/completions") + (("?" + u.query) if u.query else "")
            conn.request("POST", path, body=payload, headers=headers)
            resp = conn.getresponse()
        except Exception as e:
            return self._json({"ok": False, "msg": "连接模型服务失败：%s" % e})
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.getheader("Content-Type") or "application/json")
        self._cors()
        self.send_header("Cache-Control", "no-store")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            while True:
                chunk = resp.read(1024)
                if not chunk:
                    break
                self.wfile.write(("%x\r\n" % len(chunk)).encode("ascii") + chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        except Exception:
            pass
        finally:
            self.close_connection = True
            try:
                conn.close()
            except Exception:
                pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        p, params = parsed.path, urllib.parse.parse_qs(parsed.query)

        if p == "/api/ping":
            return self._json({"ok": True, "name": "legal-assistant-server", "ts": int(time.time() * 1000)})        if p == "/api/flk/search":
            q = (params.get("q") or [""])[0]
            page = int((params.get("page") or ["1"])[0])
            if not q:
                return self._json({"ok": False, "msg": "缺少参数 q"})
            try:
                v = cached("flk:%s:%s" % (q, page), lambda: flk_search(q, page))
                return self._json({"ok": True, "q": q, "total": v["total"], "results": v["list"]})
            except Exception as e:
                return self._json({"ok": False, "msg": str(e)})

        if p == "/api/flk/detail":
            lid = (params.get("id") or [""])[0]
            if not lid:
                return self._json({"ok": False, "msg": "缺少参数 id"})
            try:
                v = cached("flkd:%s" % lid, lambda: flk_detail(lid))
                return self._json({"ok": True, "title": v["title"], "text": v["text"],
                                   "links": v["links"], "meta": v.get("meta")})
            except Exception as e:
                return self._json({"ok": False, "msg": str(e)})

        if p == "/api/flk/text":
            lid = (params.get("bbbs") or [""])[0]
            if not lid:
                return self._json({"ok": False, "msg": "缺少参数 bbbs"})
            try:
                v = cached("flkt:%s" % lid, lambda: flk_text(lid))
                return self._json({"ok": True, "bbbs": lid, "title": v["title"],
                                   "text": v["text"], "chars": v["chars"]})
            except Exception as e:
                return self._json({"ok": False, "msg": str(e)})

        if p == "/api/cases/search":
            q = (params.get("q") or [""])[0]
            site = (params.get("site") or ["wenshu"])[0]
            if not q:
                return self._json({"ok": False, "msg": "缺少参数 q"})
            try:
                v = cached("case:%s:%s" % (site, q), lambda: case_search(q, site))
                return self._json({"ok": True, "q": q, "site": site, "results": v})
            except Exception as e:
                return self._json({"ok": False, "msg": str(e)})

        self._static(p)

    def _static(self, pathname):
        if pathname == "/":
            pathname = "/index.html"
        target = os.path.abspath(os.path.join(ROOT, urllib.parse.unquote(pathname)))
        if not target.startswith(ROOT):
            self.send_response(403)
            self.send_header("Content-Length", "0")
            return self.end_headers()
        try:
            with open(target, "rb") as f:
                data = f.read()
        except OSError:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            msg = ("404 Not Found: " + pathname).encode("utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            return self.wfile.write(msg)
        ext = os.path.splitext(target)[1].lower()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("=====================================================")
    print("  法律咨询助手 已启动")
    print("  本地访问:   http://127.0.0.1:%d" % PORT)
    print("  联网检索:   国家法律法规数据库 / 中国裁判文书网")
    print("  按 Ctrl+C 停止")
    print("=====================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    if sys.version_info < (3, 7):
        print("需要 Python 3.7+")
        sys.exit(1)
    main()
