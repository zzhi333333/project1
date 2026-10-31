package com.zz333.legalassistant;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Map;

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
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>(); /* 进行中的请求，支持「⏹ 停止」 */
    private long lastBackAt = 0;

    private static final int REQ_EXPORT = 1001;   /* 数据备份另存为 */
    private static final int REQ_PICK_FILE = 1002; /* 数据备份导入选择 */
    private String pendingExportCb = null;
    private String pendingExportContent = null;
    private ValueCallback<Uri[]> pendingFileChooser = null;

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

            /* 数据备份导入：<input type="file"> */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    String[] types = params.getAcceptTypes();
                    if (types != null && types.length > 0 && types[0] != null && !types[0].trim().isEmpty()) {
                        i.setType(types[0].split(",")[0].trim());
                    }
                    startActivityForResult(Intent.createChooser(i, "选择备份文件"), REQ_PICK_FILE);
                } catch (Exception e) {
                    pendingFileChooser = null;
                    return false;
                }
                return true;
            }

            /* window.alert / window.confirm（导入备份前的覆盖确认） */
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                showJsDialog(message, result, false);
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                showJsDialog(message, result, true);
                return true;
            }

            private void showJsDialog(String message, final JsResult result, boolean confirm) {
                AlertDialog.Builder b = new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(confirm ? "确定" : "知道了", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel());
                if (confirm) b.setNegativeButton("取消", (d, w) -> result.cancel());
                b.show();
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
            pool.execute(() -> emit(cbId, doRequest(cbId, method, url, headersJson, body, null, 30000)));
        }

        /** 流式 HTTP 请求（SSE）：每个文本块回调 __brChunk，结束时 __brResolve */
        @JavascriptInterface
        public void stream(String method, String url, String headersJson, String body, String cbId) {
            pool.execute(() -> emit(cbId, doRequest(cbId, method, url, headersJson, body, chunk -> {
                ui.post(() -> {
                    if (web == null) return;
                    web.evaluateJavascript(
                            "window.__brChunk&&window.__brChunk(" + JSONObject.quote(cbId) + "," +
                                    JSONObject.quote(chunk) + ");", null);
                });
            }, 180000)));
        }

        /** 「⏹ 停止」：断开指定请求的连接 */
        @JavascriptInterface
        public void cancel(String cbId) {
            HttpURLConnection conn = active.remove(cbId);
            if (conn != null) conn.disconnect();
        }

        /** 数据备份导出：系统「另存为」选择器（ACTION_CREATE_DOCUMENT），写入后回调 */
        @JavascriptInterface
        public void exportFile(String filename, String content, String cbId) {
            ui.post(() -> {
                pendingExportCb = cbId;
                pendingExportContent = content;
                try {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/json");
                    i.putExtra(Intent.EXTRA_TITLE, filename == null ? "legal-assistant-backup.json" : filename);
                    startActivityForResult(i, REQ_EXPORT);
                } catch (Exception e) {
                    Result r = new Result();
                    r.error = "无法打开保存选择器：" + e.getMessage();
                    emit(cbId, r);
                }
            });
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

    private Result doRequest(String cbId, String method, String url, String headersJson, String body, ChunkSink sink, int readTimeout) {
        Result r = new Result();
        HttpURLConnection conn = null;
        try {
            URL u = new URL(url);
            conn = (HttpURLConnection) u.openConnection();
            if (cbId != null) active.put(cbId, conn);
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
            if (conn != null && cbId != null) active.remove(cbId);
            if (conn != null) conn.disconnect();
        }
        return r;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_EXPORT) {
            String cbId = pendingExportCb;
            String content = pendingExportContent;
            pendingExportCb = null;
            pendingExportContent = null;
            if (cbId == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                Result r = new Result();
                r.error = "cancelled: 用户取消保存";
                emit(cbId, r);
                return;
            }
            final Uri uri = data.getData();
            final String body = content == null ? "" : content;
            pool.execute(() -> {
                Result r = new Result();
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                    os.flush();
                } catch (Exception e) {
                    r.error = "写入文件失败：" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                }
                emit(cbId, r);
            });
            return;
        }
        if (requestCode == REQ_PICK_FILE) {
            ValueCallback<Uri[]> cb = pendingFileChooser;
            pendingFileChooser = null;
            if (cb == null) return;
            Uri[] out = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                out = new Uri[]{ data.getData() };
            }
            cb.onReceiveValue(out);
        }
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
