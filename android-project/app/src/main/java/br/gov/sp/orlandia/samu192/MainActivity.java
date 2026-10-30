package br.gov.sp.orlandia.samu192;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Activity Principal do Aplicativo SAMU 192 – Orlândia-SP.
 * Roda 100% offline servindo os assets internos sob origem segura HTTPS local,
 * oferece impressão nativa via PrintManager, compartilhamento de PDF via WhatsApp/Drive
 * e ponte HTTP nativa com suporte completo aos redirecionamentos 302 do Google Apps Script.
 */
public class MainActivity extends Activity {

    private static final String APP_ORIGIN = "https://samu-orlandia.local";
    private WebView webView;
    private SamuSqliteDb sqliteDb;
    private ConnectivityManager.NetworkCallback networkCallback;
    private File pendingApkInstallFile;
    private final ExecutorService httpPool = Executors.newCachedThreadPool();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        sqliteDb = new SamuSqliteDb(this);
        reconcileOtaFolderWithApkAssets();

        Window window = getWindow();
        if (window != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(Color.parseColor("#990B22"));
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                return super.onJsAlert(view, url, message, result);
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                return super.onJsConfirm(view, url, message, result);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "samu-orlandia.local".equalsIgnoreCase(uri.getHost())) {
                    String path = uri.getPath();
                    if (path == null || path.isEmpty() || "/".equals(path)) {
                        path = "/index.html";
                    }
                    if (!path.contains("..")) {
                        File otaFile = new File(new File(getFilesDir(), "ota_www"), path.startsWith("/") ? path.substring(1) : path);
                        if (otaFile.exists() && otaFile.isFile()) {
                            try {
                                InputStream otaIs = new FileInputStream(otaFile);
                                WebResourceResponse resp = new WebResourceResponse(guessMimeType(path), "UTF-8", otaIs);
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                    Map<String, String> hdrs = new HashMap<>();
                                    hdrs.put("Cache-Control", "no-store, no-cache, must-revalidate");
                                    resp.setResponseHeaders(hdrs);
                                }
                                return resp;
                            } catch (Exception ignored) {}
                        }
                    }
                    String assetPath = "www" + path;
                    try {
                        InputStream is = getAssets().open(assetPath);
                        WebResourceResponse resp = new WebResourceResponse(guessMimeType(assetPath), "UTF-8", is);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            Map<String, String> hdrs = new HashMap<>();
                            hdrs.put("Cache-Control", "no-store, no-cache, must-revalidate");
                            resp.setResponseHeaders(hdrs);
                        }
                        return resp;
                    } catch (Exception e) {
                        return null;
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && !"samu-orlandia.local".equalsIgnoreCase(uri.getHost())) {
                    try {
                        Intent ext = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(ext);
                        return true;
                    } catch (Exception ignored) {}
                }
                return false;
            }
        });

        registerNativeNetworkMonitor();
        webView.loadUrl(APP_ORIGIN + "/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingApkInstallFile != null && pendingApkInstallFile.exists()) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls()) {
                File f = pendingApkInstallFile;
                pendingApkInstallFile = null;
                launchApkInstaller(f);
            }
        }
        if (webView != null) {
            webView.evaluateJavascript("window.__onAndroidAppResume && window.__onAndroidAppResume();", null);
        }
    }

    private static String readStreamUtf8(InputStream is) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString().trim();
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursive(c);
            }
        }
        try { f.delete(); } catch (Exception ignored) {}
    }

    private JSONObject readApkBundledVersion() {
        try (InputStream is = getAssets().open("www/version.json")) {
            return new JSONObject(readStreamUtf8(is));
        } catch (Exception e) {
            JSONObject fallback = new JSONObject();
            try {
                fallback.put("apkVersionCode", 1);
                fallback.put("apkVersionName", "1.0.0");
                fallback.put("otaRevision", 1);
            } catch (Exception ignored) {}
            return fallback;
        }
    }

    private void reconcileOtaFolderWithApkAssets() {
        try {
            File otaDir = new File(getFilesDir(), "ota_www");
            File otaVerFile = new File(otaDir, "version.json");
            if (!otaDir.exists() || !otaVerFile.exists()) return;

            JSONObject apkVer = readApkBundledVersion();
            JSONObject otaVer;
            try (InputStream ois = new FileInputStream(otaVerFile)) {
                otaVer = new JSONObject(readStreamUtf8(ois));
            }
            int apkCode = apkVer.optInt("apkVersionCode", 1);
            int otaApkCode = otaVer.optInt("apkVersionCode", 1);
            int apkRev = apkVer.optInt("otaRevision", 1);
            int otaRev = otaVer.optInt("otaRevision", 1);

            // Se o APK instalado é mais novo ou igual ao pacote OTA salvo, limpa o OTA antigo
            if (apkCode > otaApkCode || apkRev >= otaRev) {
                deleteRecursive(otaDir);
            }
        } catch (Exception e) {
            deleteRecursive(new File(getFilesDir(), "ota_www"));
        }
    }

    private void launchApkInstaller(File apkFile) {
        runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                    pendingApkInstallFile = apkFile;
                    Toast.makeText(
                        MainActivity.this,
                        "Ative 'Permitir desta fonte' para concluir a atualização automática do SAMU 192.",
                        Toast.LENGTH_LONG
                    ).show();
                    Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())
                    );
                    startActivity(permIntent);
                    return;
                }

                Uri contentUri = Uri.parse("content://" + PdfShareProvider.AUTHORITY + "/" + apkFile.getName());
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(installIntent);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Erro ao abrir instalador de atualização: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private void registerNativeNetworkMonitor() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    networkCallback = new ConnectivityManager.NetworkCallback() {
                        @Override
                        public void onAvailable(Network network) {
                            runOnUiThread(() -> {
                                if (webView != null) {
                                    webView.evaluateJavascript(
                                        "window.__onAndroidNetworkOnline && window.__onAndroidNetworkOnline();",
                                        null
                                    );
                                }
                            });
                        }
                    };
                    cm.registerDefaultNetworkCallback(networkCallback);
                }
            } catch (Exception ignored) {}
        }
    }

    private String guessMimeType(String path) {
        String low = path.toLowerCase();
        if (low.endsWith(".html")) return "text/html";
        if (low.endsWith(".css")) return "text/css";
        if (low.endsWith(".js")) return "application/javascript";
        if (low.endsWith(".json")) return "application/json";
        if (low.endsWith(".png")) return "image/png";
        if (low.endsWith(".gif")) return "image/gif";
        if (low.endsWith(".jpg") || low.endsWith(".jpeg")) return "image/jpeg";
        if (low.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                "(function(){ " +
                "  var ids = ['samu-dialog-modal','samu-sig-modal','drafts-modal','regulacao-photo-modal','pdf-preview-modal'];" +
                "  for (var i = 0; i < ids.length; i++) {" +
                "    var el = document.getElementById(ids[i]);" +
                "    if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); return 'closed'; }" +
                "  }" +
                "  return 'none';" +
                "})()",
                value -> {
                    if (value == null || !value.contains("closed")) {
                        if (webView.canGoBack()) webView.goBack();
                        else MainActivity.super.onBackPressed();
                    }
                }
            );
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && networkCallback != null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {}
        }
        httpPool.shutdownNow();
        if (sqliteDb != null) {
            try { sqliteDb.close(); } catch (Exception ignored) {}
        }
    }

    private static String jsEscape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
    }

    public class AndroidBridge {

        /* ===================== BANCO DE DADOS SQLITE NATIVO ANDROID ===================== */

        @JavascriptInterface
        public boolean hasNativeSqlite() {
            return sqliteDb != null;
        }

        @JavascriptInterface
        public String dbGetKv(final String key) {
            if (sqliteDb == null) return null;
            return sqliteDb.getKv(key);
        }

        @JavascriptInterface
        public void dbSetKv(final String key, final String value) {
            if (sqliteDb != null) {
                sqliteDb.setKv(key, value);
            }
        }

        @JavascriptInterface
        public void dbRemoveKv(final String key) {
            if (sqliteDb != null) {
                sqliteDb.removeKv(key);
            }
        }

        @JavascriptInterface
        public void dbPutRecord(final String id, final String recType, final String createdBy,
                                final String createdAt, final String syncStatus,
                                final String patientName, final String patientCpf,
                                final String jsonPayload) {
            if (sqliteDb != null) {
                sqliteDb.putRecord(id, recType, createdBy, createdAt, syncStatus, patientName, patientCpf, jsonPayload);
            }
        }

        @JavascriptInterface
        public String dbGetRecord(final String id) {
            if (sqliteDb == null) return null;
            return sqliteDb.getRecordJson(id);
        }

        @JavascriptInterface
        public void dbDeleteRecord(final String id) {
            if (sqliteDb != null) {
                sqliteDb.deleteRecord(id);
            }
        }

        @JavascriptInterface
        public String dbGetAllRecordsJson() {
            if (sqliteDb == null) return "[]";
            return sqliteDb.getAllRecordsJsonArray();
        }

        @JavascriptInterface
        public void dbPutDraft(final String draftKey, final String username,
                               final String draftType, final String updatedAt,
                               final String jsonPayload) {
            if (sqliteDb != null) {
                sqliteDb.putDraft(draftKey, username, draftType, updatedAt, jsonPayload);
            }
        }

        @JavascriptInterface
        public String dbGetDraft(final String draftKey) {
            if (sqliteDb == null) return null;
            return sqliteDb.getDraftJson(draftKey);
        }

        @JavascriptInterface
        public void dbDeleteDraft(final String draftKey) {
            if (sqliteDb != null) {
                sqliteDb.deleteDraft(draftKey);
            }
        }

        @JavascriptInterface
        public void sharePdf(final String base64Pdf, final String fileName) {
            runOnUiThread(() -> {
                try {
                    byte[] pdfBytes = Base64.decode(base64Pdf, Base64.DEFAULT);
                    String safeName = (fileName == null || fileName.trim().isEmpty())
                            ? "Ficha_SAMU_192.pdf"
                            : fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
                    if (!safeName.toLowerCase().endsWith(".pdf")) safeName += ".pdf";

                    File dir = new File(getCacheDir(), "shared_pdfs");
                    if (!dir.exists()) dir.mkdirs();
                    File outFile = new File(dir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(pdfBytes);
                    }

                    Uri contentUri = Uri.parse("content://" + PdfShareProvider.AUTHORITY + "/" + safeName);
                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    shareIntent.setType("application/pdf");
                    shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    shareIntent.putExtra(Intent.EXTRA_SUBJECT, safeName);
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                    startActivity(Intent.createChooser(shareIntent, "Enviar ou Salvar PDF SAMU 192"));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Erro ao compartilhar PDF: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void shareImageToWhatsApp(final String base64Image, final String fileName, final String captionText) {
            runOnUiThread(() -> {
                try {
                    String cleanB64 = base64Image;
                    int commaIdx = (cleanB64 != null) ? cleanB64.indexOf(',') : -1;
                    if (commaIdx >= 0) {
                        cleanB64 = cleanB64.substring(commaIdx + 1);
                    }
                    byte[] imgBytes = Base64.decode(cleanB64, Base64.DEFAULT);
                    String safeName = (fileName == null || fileName.trim().isEmpty())
                            ? "Cabecalho_Regulacao_SAMU.jpg"
                            : fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
                    if (!safeName.toLowerCase().endsWith(".jpg") && !safeName.toLowerCase().endsWith(".jpeg")) {
                        safeName += ".jpg";
                    }

                    File dir = new File(getCacheDir(), "shared_pdfs");
                    if (!dir.exists()) dir.mkdirs();
                    File outFile = new File(dir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(imgBytes);
                    }

                    Uri contentUri = Uri.parse("content://" + PdfShareProvider.AUTHORITY + "/" + safeName);

                    // Tenta abrir o WhatsApp direto com a foto anexada (ou WhatsApp Business, ou seletor do Android)
                    String[] waPackages = new String[]{"com.whatsapp", "com.whatsapp.w4b"};
                    for (String pkg : waPackages) {
                        try {
                            Intent waIntent = new Intent(Intent.ACTION_SEND);
                            waIntent.setType("image/jpeg");
                            waIntent.setPackage(pkg);
                            waIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                            if (captionText != null && !captionText.trim().isEmpty()) {
                                waIntent.putExtra(Intent.EXTRA_TEXT, captionText);
                            }
                            waIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            startActivity(waIntent);
                            return;
                        } catch (Exception ignored) {}
                    }

                    Intent fallback = new Intent(Intent.ACTION_SEND);
                    fallback.setType("image/jpeg");
                    fallback.putExtra(Intent.EXTRA_STREAM, contentUri);
                    if (captionText != null && !captionText.trim().isEmpty()) {
                        fallback.putExtra(Intent.EXTRA_TEXT, captionText);
                    }
                    fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(fallback, "Enviar Foto do Cabeçalho p/ Regulação"));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Erro ao enviar foto p/ WhatsApp: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void printPdf(final String base64Pdf, final String jobName, final boolean isLandscape) {
            runOnUiThread(() -> {
                try {
                    final byte[] pdfBytes = Base64.decode(base64Pdf, Base64.DEFAULT);
                    final String safeJob = (jobName == null || jobName.isEmpty()) ? "SAMU_192_Orlandia" : jobName;

                    PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (printManager == null) {
                        Toast.makeText(MainActivity.this, "Serviço de impressão indisponível.", Toast.LENGTH_LONG).show();
                        return;
                    }

                    PrintAttributes.Builder attrBuilder = new PrintAttributes.Builder()
                            .setMediaSize(isLandscape
                                    ? PrintAttributes.MediaSize.ISO_A4.asLandscape()
                                    : PrintAttributes.MediaSize.ISO_A4)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS);

                    printManager.print(safeJob, new PrintDocumentAdapter() {
                        @Override
                        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                             CancellationSignal cancellationSignal,
                                             LayoutResultCallback callback, Bundle extras) {
                            if (cancellationSignal.isCanceled()) {
                                callback.onLayoutCancelled();
                                return;
                            }
                            PrintDocumentInfo info = new PrintDocumentInfo.Builder(safeJob)
                                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                                    .setPageCount(2)
                                    .build();
                            callback.onLayoutFinished(info, true);
                        }

                        @Override
                        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                            CancellationSignal cancellationSignal,
                                            WriteResultCallback callback) {
                            try (OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                                out.write(pdfBytes);
                                callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                            } catch (Exception err) {
                                callback.onWriteFailed(err.getMessage());
                            }
                        }
                    }, attrBuilder.build());
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Erro ao imprimir: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void postJson(final String reqId, final String urlStr, final String jsonPayload) {
            httpPool.execute(() -> {
                try {
                    String responseBody = executeHttpRequest(urlStr, "POST", null, jsonPayload);
                    deliverHttpResult(reqId, true, responseBody);
                } catch (Exception e) {
                    deliverHttpResult(reqId, false, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        @JavascriptInterface
        public void getJson(final String reqId, final String urlStr) {
            httpPool.execute(() -> {
                try {
                    String responseBody = executeHttpRequest(urlStr, "GET", null, null);
                    deliverHttpResult(reqId, true, responseBody);
                } catch (Exception e) {
                    deliverHttpResult(reqId, false, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        @JavascriptInterface
        public void httpRequest(final String reqId, final String method, final String urlStr,
                                final String headersJson, final String body) {
            httpPool.execute(() -> {
                try {
                    String responseBody = executeHttpRequest(urlStr, method, headersJson, body);
                    deliverHttpResult(reqId, true, responseBody);
                } catch (Exception e) {
                    deliverHttpResult(reqId, false, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        private void deliverHttpResult(final String reqId, final boolean ok, final String text) {
            runOnUiThread(() -> {
                if (webView != null) {
                    String js = "window.__onAndroidHttpResult('" + jsEscape(reqId) + "', "
                            + (ok ? "true" : "false") + ", '" + jsEscape(text) + "');";
                    webView.evaluateJavascript(js, null);
                }
            });
        }

        private String executeHttpRequest(String targetUrl, String initialMethod, String headersJson, String body) throws Exception {
            String currentUrl = targetUrl;
            String method = (initialMethod != null && !initialMethod.isEmpty()) ? initialMethod.toUpperCase() : "GET";
            byte[] payloadBytes = (body != null) ? body.getBytes(StandardCharsets.UTF_8) : new byte[0];

            for (int hop = 0; hop < 6; hop++) {
                HttpURLConnection conn = (HttpURLConnection) new URL(currentUrl).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(25000);
                conn.setReadTimeout(45000);
                conn.setRequestMethod(method);
                conn.setRequestProperty("User-Agent", "SAMU192-Orlandia-APK/1.0");
                conn.setRequestProperty("Accept", "application/json, text/plain, */*");

                boolean hasCustomContentType = false;
                if (headersJson != null && !headersJson.trim().isEmpty()) {
                    JSONObject hdrs = new JSONObject(headersJson);
                    Iterator<String> keys = hdrs.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        String v = hdrs.optString(k, "");
                        if (!v.isEmpty()) {
                            conn.setRequestProperty(k, v);
                            if ("content-type".equalsIgnoreCase(k)) hasCustomContentType = true;
                        }
                    }
                }

                if ("POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method)) {
                    conn.setDoOutput(true);
                    if (!hasCustomContentType) {
                        conn.setRequestProperty("Content-Type", "PUT".equals(method) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
                    }
                    conn.setFixedLengthStreamingMode(payloadBytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payloadBytes);
                    }
                }

                int status = conn.getResponseCode();
                if (status == 301 || status == 302 || status == 303) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null) throw new Exception("Redirecionamento sem destino.");
                    currentUrl = loc;
                    method = "GET"; // Google Apps Script retorna o JSON via GET no Location 302
                    continue;
                }
                if (status == 307 || status == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null) throw new Exception("Redirecionamento 307 sem destino.");
                    currentUrl = loc;
                    continue;
                }

                InputStream is = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (is != null) {
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = br.readLine()) != null) {
                            sb.append(line).append('\n');
                        }
                    }
                }
                conn.disconnect();
                if (status >= 400) {
                    throw new Exception("HTTP " + status + ": " + sb.toString().trim());
                }
                return sb.toString().trim();
            }
            throw new Exception("Muitos redirecionamentos HTTP.");
        }

        /* ===================== AUTO-UPDATE NATIVO VIA GITHUB (LIVE OTA + APK) ===================== */

        @JavascriptInterface
        public String getInstalledVersionJson() {
            try {
                JSONObject apkVer = readApkBundledVersion();
                int apkCode = apkVer.optInt("apkVersionCode", 1);
                String apkName = apkVer.optString("apkVersionName", "1.0.0");
                int activeRev = apkVer.optInt("otaRevision", 1);
                boolean otaActive = false;

                File otaVerFile = new File(new File(getFilesDir(), "ota_www"), "version.json");
                if (otaVerFile.exists()) {
                    try (InputStream ois = new FileInputStream(otaVerFile)) {
                        JSONObject otaVer = new JSONObject(readStreamUtf8(ois));
                        int oRev = otaVer.optInt("otaRevision", activeRev);
                        if (oRev > activeRev) {
                            activeRev = oRev;
                            otaActive = true;
                        }
                    } catch (Exception ignored) {}
                }

                JSONObject out = new JSONObject();
                out.put("apkVersionCode", apkCode);
                out.put("apkVersionName", apkName);
                out.put("otaRevision", activeRev);
                out.put("otaActive", otaActive);
                return out.toString();
            } catch (Exception e) {
                return "{\"apkVersionCode\":1,\"apkVersionName\":\"1.0.0\",\"otaRevision\":1,\"otaActive\":false}";
            }
        }

        @JavascriptInterface
        public boolean applyOtaBundleJson(final String versionJsonStr, final String filesMapJsonStr) {
            try {
                JSONObject verObj = new JSONObject(versionJsonStr);
                JSONObject filesMap = new JSONObject(filesMapJsonStr);

                File tmpDir = new File(getFilesDir(), "ota_www_tmp");
                deleteRecursive(tmpDir);
                tmpDir.mkdirs();

                Iterator<String> keys = filesMap.keys();
                while (keys.hasNext()) {
                    String relPath = keys.next();
                    if (relPath == null || relPath.isEmpty() || relPath.contains("..")) continue;
                    String cleanRel = relPath.startsWith("/") ? relPath.substring(1) : relPath;
                    String content = filesMap.optString(relPath, "");
                    if (content.isEmpty()) continue;

                    File targetFile = new File(tmpDir, cleanRel);
                    File parent = targetFile.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                        fos.write(content.getBytes(StandardCharsets.UTF_8));
                    }
                }

                File verFile = new File(tmpDir, "version.json");
                try (FileOutputStream fos = new FileOutputStream(verFile)) {
                    fos.write(verObj.toString(2).getBytes(StandardCharsets.UTF_8));
                }

                File liveDir = new File(getFilesDir(), "ota_www");
                File oldDir = new File(getFilesDir(), "ota_www_old");
                deleteRecursive(oldDir);
                if (liveDir.exists()) {
                    liveDir.renameTo(oldDir);
                }
                boolean moved = tmpDir.renameTo(liveDir);
                deleteRecursive(oldDir);
                if (!moved) {
                    deleteRecursive(tmpDir);
                    return false;
                }
                return true;
            } catch (Exception e) {
                deleteRecursive(new File(getFilesDir(), "ota_www_tmp"));
                return false;
            }
        }

        @JavascriptInterface
        public void reloadOtaApp() {
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.clearCache(true);
                    webView.loadUrl(APP_ORIGIN + "/index.html?ota=" + System.currentTimeMillis());
                }
            });
        }

        @JavascriptInterface
        public void downloadAndInstallApk(final String downloadUrl, final String githubToken) {
            httpPool.execute(() -> {
                try {
                    notifyApkProgress(2, "Conectando ao GitHub Releases...");
                    String currentUrl = downloadUrl;
                    boolean sendAuth = (githubToken != null && !githubToken.trim().isEmpty());
                    boolean isApiAsset = currentUrl != null && currentUrl.contains("api.github.com/");

                    for (int hop = 0; hop < 8; hop++) {
                        URL u = new URL(currentUrl);
                        HttpURLConnection conn = (HttpURLConnection) u.openConnection();
                        conn.setInstanceFollowRedirects(false);
                        conn.setConnectTimeout(25000);
                        conn.setReadTimeout(90000);
                        conn.setRequestMethod("GET");
                        conn.setRequestProperty("User-Agent", "SAMU192-Orlandia-APK/1.0");
                        if (isApiAsset) {
                            conn.setRequestProperty("Accept", "application/octet-stream");
                        } else {
                            conn.setRequestProperty("Accept", "*/*");
                        }
                        String host = u.getHost() != null ? u.getHost().toLowerCase() : "";
                        boolean isGitHubAuthHost = "github.com".equals(host)
                                || "api.github.com".equals(host)
                                || "raw.githubusercontent.com".equals(host);
                        if (sendAuth && isGitHubAuthHost) {
                            conn.setRequestProperty("Authorization", "Bearer " + githubToken.trim());
                        }

                        int status = conn.getResponseCode();
                        if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                            String loc = conn.getHeaderField("Location");
                            conn.disconnect();
                            if (loc == null) throw new Exception("Redirecionamento sem destino no download do APK.");
                            currentUrl = loc;
                            isApiAsset = false; // URL redirecionada (S3/CDN) não usa Accept octet-stream da API
                            continue;
                        }
                        if (status < 200 || status >= 300) {
                            conn.disconnect();
                            throw new Exception("HTTP " + status + " ao baixar novo APK.");
                        }

                        int totalBytes = conn.getContentLength();
                        File dir = new File(getCacheDir(), "shared_pdfs");
                        if (!dir.exists()) dir.mkdirs();
                        File apkOut = new File(dir, "SAMU_192_Orlandia_Update.apk");

                        try (InputStream is = conn.getInputStream();
                             FileOutputStream fos = new FileOutputStream(apkOut)) {
                            byte[] buf = new byte[16384];
                            long downloaded = 0;
                            int lastReportedPct = -1;
                            int n;
                            while ((n = is.read(buf)) != -1) {
                                fos.write(buf, 0, n);
                                downloaded += n;
                                int pct = (totalBytes > 0)
                                        ? (int) Math.min(99, (downloaded * 100L) / totalBytes)
                                        : 50;
                                if (pct != lastReportedPct && (pct % 4 == 0 || pct >= 98)) {
                                    lastReportedPct = pct;
                                    double mb = downloaded / (1024.0 * 1024.0);
                                    notifyApkProgress(pct, String.format("Baixando atualização (%.1f MB)...", mb));
                                }
                            }
                        }
                        conn.disconnect();

                        if (apkOut.length() < 50000) {
                            throw new Exception("Arquivo APK baixado parece incompleto.");
                        }

                        notifyApkProgress(100, "Download concluído! Abrindo instalador...");
                        launchApkInstaller(apkOut);
                        return;
                    }
                    throw new Exception("Muitos redirecionamentos ao baixar o APK.");
                } catch (Exception e) {
                    notifyApkProgress(-1, "Erro ao baixar APK: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
                }
            });
        }

        private void notifyApkProgress(final int percent, final String message) {
            runOnUiThread(() -> {
                if (webView != null) {
                    String js = "window.__onApkDownloadProgress && window.__onApkDownloadProgress("
                            + percent + ", '" + jsEscape(message) + "');";
                    webView.evaluateJavascript(js, null);
                }
            });
        }
    }
}
