package com.zz333.legalassistant;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 法律咨询助手（移动版）—— WebView 壳 + 原生网络桥
 *
 * 网页资源打包于 assets/www（竖屏重设计的移动端 UI，引擎逻辑与桌面版同源）。
 * 电脑版依赖的本地代理（server.js / server.py）在手机上不存在，
 * 因此提供 AndroidBridge：js/bridge.js 通过它完成
 *   ① AI 模型 SSE 流式请求（直连 OpenAI 兼容接口）
 *   ② flk.npc.gov.cn 官方法条库 / 案例公开检索（带桌面 UA 与必要请求头）
 *   ③ 外链交给系统浏览器打开（Word/PDF 下载、数据库原文页等）
 */
public class MainActivity extends Activity {

    private static final String TAG = "LegalAssistant";
    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private long lastBackAt = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          /* localStorage：AI 配置 + 对话历史 */
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        /* file:// 下直接 fetch/XHR 的双保险；正常联网都走 AndroidBridge */
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE); /* 允许 http 自定义端点/Ollama */
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                /* 应用内只有 file:// 页面；主框架试图导航到 http(s) 时交给系统浏览器 */
                if (scheme.equals("http") || scheme.equals("https")) {
                    openExternal(u.toString());
                    return true;
                }
                return false;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage msg) {
                Log.d(TAG, "[js] " + msg.message() + " (" + msg.sourceId() + ":" + msg.lineNumber() + ")");
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web.canGoBack()) {
                web.goBack();
                return true;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackAt > 2000) {
                lastBackAt = now;
                Toast.makeText(this, "再按一次返回键退出", Toast.LENGTH_SHORT).show();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    private void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "无法打开链接：" + url, Toast.LENGTH_SHORT).show();
        }
    }

    /* =====================================================
     * 原生网络桥：JS → Java（@JavascriptInterface，异步回调）
     * 回调约定（见 assets/www/js/bridge.js）：
     *   window.__brChunk(cbId, textChunk)   流式过程中反复调用
     *   window.__brResolve(cbId, ok, payload) 结束时调用一次
     * ===================================================== */
    private class Bridge {

        /** 一次性 HTTP 请求（GET/POST，返回完整文本） */
        @JavascriptInterface
        public void http(String method, String url, String headersJson, String body, String cbId) {
            pool.execute(() -> emit(cbId, doRequest(method, url, headersJson, body, null, 30000)));
        }

        /** 流式 HTTP 请求（SSE）：每个文本块回调 __brChunk，结束时 __brResolve */
        @JavascriptInterface
        public void stream(String method, String url, String headersJson, String body, String cbId) {
            pool.execute(() -> emit(cbId, doRequest(method, url, headersJson, body, chunk -> {
                ui.post(() -> {
                    if (web == null) return;
                    web.evaluateJavascript(
                            "window.__brChunk&&window.__brChunk(" + JSONObject.quote(cbId) + "," +
                                    JSONObject.quote(chunk) + ");", null);
                });
            }, 180000)));
        }

        /** 用系统浏览器/下载器打开外链（官方原文页、Word/PDF 下载等） */
        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> openExternal(url));
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public String version() { return "1.0"; }
    }

    private interface ChunkSink { void accept(String chunk); }

    private void emit(String cbId, Result r) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("status", r.status);
            payload.put("text", r.text);
            if (r.error != null) payload.put("msg", r.error);
        } catch (Exception ignored) {}
        String ok = r.error == null ? "true" : "false";
        String js = "window.__brResolve&&window.__brResolve(" + JSONObject.quote(cbId) + "," + ok + "," +
                payload.toString() + ");";
        ui.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    private static class Result {
        int status = 0;
        String text = "";
        String error;
    }

    private Result doRequest(String method, String url, String headersJson, String body, ChunkSink sink, int readTimeout) {
        Result r = new Result();
        HttpURLConnection conn = null;
        try {
            URL u = new URL(url);
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(readTimeout);
            conn.setRequestMethod(method == null || method.isEmpty() ? "GET" : method.toUpperCase());
            /* 默认桌面 UA（flk / 搜索引擎更友好），JS 侧可覆盖 */
            conn.setRequestProperty("User-Agent", DESKTOP_UA);
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
            if (headersJson != null && !headersJson.isEmpty() && !"null".equals(headersJson)) {
                JSONObject hs = new JSONObject(headersJson);
                Iterator<String> it = hs.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    String v = hs.optString(k, "");
                    if (!k.isEmpty() && !v.isEmpty()) conn.setRequestProperty(k, v);
                }
            }
            boolean hasBody = body != null && !body.isEmpty()
                    && !"GET".equalsIgnoreCase(conn.getRequestMethod());
            if (hasBody) {
                conn.setDoOutput(true);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                    os.flush();
                }
            }
            r.status = conn.getResponseCode();
            java.io.InputStream in = r.status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in != null) {
                /* InputStreamReader 自带多字节 UTF-8 断裂缓冲，适合 SSE 流式 */
                BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                char[] buf = new char[2048];
                StringBuilder full = new StringBuilder();
                int n;
                while ((n = br.read(buf)) > 0) {
                    String piece = new String(buf, 0, n);
                    if (full.length() < 4_000_000) full.append(piece);
                    if (sink != null) sink.accept(piece);
                }
                br.close();
                r.text = full.toString();
            }
        } catch (Exception e) {
            r.error = (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
        return r;
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        pool.shutdownNow();
        super.onDestroy();
    }
}
