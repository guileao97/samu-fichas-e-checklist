package br.gov.sp.orlandia.samu192;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import android.util.SparseArray;
import android.view.View;
import android.view.ViewStructure;
import android.view.Window;
import android.view.autofill.AutofillManager;
import android.view.autofill.AutofillValue;
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
    private static volatile MainActivity sActiveInstance;
    private static volatile boolean sIsAppInForeground = false;
    private static volatile boolean sPromptedNotifThisProcess = false;
    private static volatile boolean sPromptedUnknownSourcesThisProcess = false;
    private static volatile boolean sWaitingUnknownSourcesSettingsReturn = false;
    private static volatile boolean sPromptedBatteryOptThisProcess = false;
    private static volatile long sLastBatteryPromptMs = 0L;

    private WebView webView;
    private SamuSqliteDb sqliteDb;
    private ConnectivityManager.NetworkCallback networkCallback;
    private File pendingApkInstallFile;
    private AlertDialog unknownSourcesDialog;

    public static boolean isAppInForeground() {
        return sIsAppInForeground;
    }

    public static boolean deliverHttpResultToActiveWebView(final String reqId, final boolean ok, final String text) {
        final MainActivity act = sActiveInstance;
        if (act == null || act.webView == null || act.isFinishing()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && act.isDestroyed()) return false;
        act.runOnUiThread(() -> {
            if (act.webView != null) {
                String js = "window.__onAndroidHttpResult && window.__onAndroidHttpResult('" + jsEscape(reqId) + "', "
                        + (ok ? "true" : "false") + ", '" + jsEscape(text) + "');";
                act.webView.evaluateJavascript(js, null);
            }
        });
        return true;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sActiveInstance = this;

        sqliteDb = SamuSqliteDb.getInstance(this);
        SamuSyncForegroundService.ensureChannels(this);
        reconcileOtaFolderWithApkAssets();

        Window window = getWindow();
        if (window != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(Color.parseColor("#990B22"));
        }

        // Bloqueia completamente Samsung Pass / Google Autofill no WebView para não sugerir nem colar
        // endereços, CEPs ou telefones pessoais dos socorristas dentro das fichas de atendimento.
        webView = new WebView(this) {
            @Override
            public int getImportantForAutofill() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    return View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS;
                }
                return super.getImportantForAutofill();
            }

            @Override
            public void onProvideAutofillVirtualStructure(ViewStructure structure, int flags) {
                // Não expõe campos virtuais HTML ao Samsung Pass / AutofillManager
            }

            @Override
            public void autofill(SparseArray<AutofillValue> values) {
                // Ignora preenchimento externo automático de endereços/dados pessoais
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            if (window != null && window.getDecorView() != null) {
                window.getDecorView().setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            }
            try {
                AutofillManager afm = getSystemService(AutofillManager.class);
                if (afm != null) {
                    afm.cancel();
                }
            } catch (Exception ignored) {}
        }
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSaveFormData(false);
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
        webView.setNetworkAvailable(isDeviceNetworkConnected());
        webView.loadUrl(APP_ORIGIN + "/index.html");

        scheduleStartupPermissionsCheck(1100L);
    }

    private void scheduleStartupPermissionsCheck(final long delayMs) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (sActiveInstance != this || !sIsAppInForeground || isFinishing()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed()) return;
            if (unknownSourcesDialog != null && unknownSourcesDialog.isShowing()) return;

            // 1) Permissão de Notificações no Android 13+ (p/ barra de envio em 2º plano fora do APK)
            if (Build.VERSION.SDK_INT >= 33 && !sPromptedNotifThisProcess) {
                try {
                    if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                        sPromptedNotifThisProcess = true;
                        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1921);
                        return;
                    }
                } catch (Exception ignored) {}
            }

            // 2) Permissão de Instalar Apps Desconhecidos ("Permitir desta fonte") logo ao instalar/abrir o APK
            if (!sPromptedUnknownSourcesThisProcess && !canInstallUnknownPackagesInternal()) {
                sPromptedUnknownSourcesThisProcess = true;
                promptEnableUnknownAppSourcesDialog();
                return;
            }

            // 3) Isenção de Otimização de Bateria (p/ nunca interromper envio ou sincronização em 2º plano)
            if (!sPromptedBatteryOptThisProcess && !isBatteryOptimizationIgnored()) {
                sPromptedBatteryOptThisProcess = true;
                sLastBatteryPromptMs = System.currentTimeMillis();
                requestIgnoreBatteryOptimizationInternal(false);
            }
        }, delayMs);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1921) {
            scheduleStartupPermissionsCheck(500L);
        }
    }

    private boolean canInstallUnknownPackagesInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                return getPackageManager().canRequestPackageInstalls();
            } catch (Exception e) {
                return true;
            }
        }
        return true;
    }

    private void openUnknownAppSourcesSettingsScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            runOnUiThread(() -> {
                sWaitingUnknownSourcesSettingsReturn = true;
                Toast.makeText(
                    MainActivity.this,
                    "Ative 'Permitir desta fonte' e volte para o aplicativo SAMU 192.",
                    Toast.LENGTH_LONG
                ).show();
                try {
                    Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())
                    );
                    startActivity(permIntent);
                } catch (Exception e1) {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES));
                    } catch (Exception e2) {
                        try {
                            startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
                        } catch (Exception ignored) {}
                    }
                }
            });
        }
    }

    private void promptEnableUnknownAppSourcesDialog() {
        runOnUiThread(() -> {
            if (isFinishing() || canInstallUnknownPackagesInternal()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed()) return;
            if (unknownSourcesDialog != null && unknownSourcesDialog.isShowing()) return;
            try {
                unknownSourcesDialog = new AlertDialog.Builder(MainActivity.this)
                    .setTitle("📲 Permitir Atualizações do SAMU 192")
                    .setMessage(
                        "Para facilitar as próximas atualizações automáticas direto por dentro do aplicativo, " +
                        "ative a opção \"Permitir desta fonte\" (Instalar apps desconhecidos) na tela a seguir."
                    )
                    .setCancelable(false)
                    .setPositiveButton("Habilitar Agora", (dialog, which) -> openUnknownAppSourcesSettingsScreen())
                    .setNegativeButton("Depois", (dialog, which) -> scheduleStartupPermissionsCheck(500L))
                    .create();
                unknownSourcesDialog.show();
            } catch (Exception e) {
                openUnknownAppSourcesSettingsScreen();
            }
        });
    }

    private boolean isBatteryOptimizationIgnored() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                return pm == null || pm.isIgnoringBatteryOptimizations(getPackageName());
            } catch (Exception e) {
                return true;
            }
        }
        return true;
    }

    @SuppressLint("BatteryLife")
    private void requestIgnoreBatteryOptimizationInternal(final boolean allowSettingsFallback) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            runOnUiThread(() -> {
                try {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    }
                } catch (Exception e) {
                    if (allowSettingsFallback) {
                        try {
                            Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                            startActivity(fallback);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        sActiveInstance = this;
        sIsAppInForeground = true;
        SamuSyncForegroundService.onAppForegroundChanged(this, true);
        if (sWaitingUnknownSourcesSettingsReturn) {
            sWaitingUnknownSourcesSettingsReturn = false;
            if (canInstallUnknownPackagesInternal() && (pendingApkInstallFile == null || !pendingApkInstallFile.exists())) {
                Toast.makeText(
                    MainActivity.this,
                    "✅ Permissão para instalar atualizações futuras ativada!",
                    Toast.LENGTH_SHORT
                ).show();
            }
        }
        if (pendingApkInstallFile != null && pendingApkInstallFile.exists()) {
            if (canInstallUnknownPackagesInternal()) {
                File f = pendingApkInstallFile;
                pendingApkInstallFile = null;
                launchApkInstaller(f);
            }
        }
        if (webView != null) {
            webView.setNetworkAvailable(isDeviceNetworkConnected());
            webView.evaluateJavascript("window.__onAndroidAppResume && window.__onAndroidAppResume();", null);
        }
        scheduleStartupPermissionsCheck(750L);
    }

    @Override
    protected void onPause() {
        sIsAppInForeground = false;
        SamuSyncForegroundService.onAppForegroundChanged(this, false);
        super.onPause();
    }

    private boolean isDeviceNetworkConnected() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Network active = cm.getActiveNetwork();
                if (active == null) return false;
                NetworkCapabilities caps = cm.getNetworkCapabilities(active);
                return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            } else {
                @SuppressWarnings("deprecation")
                NetworkInfo info = cm.getActiveNetworkInfo();
                return info != null && info.isConnected();
            }
        } catch (Exception e) {
            return true;
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
                installIntent.setClipData(ClipData.newRawUri("SAMU_192_Orlandia", contentUri));
                installIntent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
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
                                    webView.setNetworkAvailable(true);
                                    webView.evaluateJavascript(
                                        "window.__onAndroidNetworkOnline && window.__onAndroidNetworkOnline();",
                                        null
                                    );
                                }
                            });
                        }

                        @Override
                        public void onLost(Network network) {
                            runOnUiThread(() -> {
                                if (webView != null) {
                                    webView.setNetworkAvailable(isDeviceNetworkConnected());
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
        try {
            if (unknownSourcesDialog != null && unknownSourcesDialog.isShowing()) {
                unknownSourcesDialog.dismiss();
            }
        } catch (Exception ignored) {}
        unknownSourcesDialog = null;
        if (sIsAppInForeground) {
            sIsAppInForeground = false;
            SamuSyncForegroundService.onAppForegroundChanged(this, false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && networkCallback != null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {}
        }
        // NÃO interrompe HTTP_POOL nem fecha SamuSqliteDb singleton para que envios e sincronizações
        // em segundo plano continuem até o fim mesmo após fechar o APK!
        if (sActiveInstance == this) {
            sActiveInstance = null;
        }
        SamuSyncForegroundService.onMainActivityDestroyed(this);
        super.onDestroy();
    }

    private static String jsEscape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029");
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
        public boolean isNetworkConnected() {
            return isDeviceNetworkConnected();
        }

        @JavascriptInterface
        public boolean isIgnoringBatteryOptimizations() {
            return isBatteryOptimizationIgnored();
        }

        @JavascriptInterface
        public void requestIgnoreBatteryOptimizations() {
            sLastBatteryPromptMs = System.currentTimeMillis();
            requestIgnoreBatteryOptimizationInternal(true);
        }

        @JavascriptInterface
        public void ensureBatteryOptimizationDisabled() {
            if (!isBatteryOptimizationIgnored()) {
                long now = System.currentTimeMillis();
                if (now - sLastBatteryPromptMs > 180000L) {
                    sLastBatteryPromptMs = now;
                    requestIgnoreBatteryOptimizationInternal(false);
                }
            }
        }

        @JavascriptInterface
        public boolean canInstallUnknownApps() {
            return canInstallUnknownPackagesInternal();
        }

        @JavascriptInterface
        public void requestInstallUnknownAppsPermission() {
            openUnknownAppSourcesSettingsScreen();
        }

        @JavascriptInterface
        public void setBackgroundSyncProgress(final boolean active, final String title, final String detail,
                                              final int percent, final String doneTitle,
                                              final String doneDetail, final boolean doneSuccess) {
            SamuSyncForegroundService.updateJsBackgroundState(
                getApplicationContext(),
                active,
                title,
                detail,
                percent,
                doneTitle,
                doneDetail,
                doneSuccess
            );
        }

        @JavascriptInterface
        public void postRecordUploadNative(final String reqId, final String scriptUrl, final String jsonPayload,
                                           final String recordId, final String jobTitle) {
            SamuSyncForegroundService.enqueueNativeRecordUpload(
                getApplicationContext(),
                reqId,
                scriptUrl,
                jsonPayload,
                recordId,
                jobTitle
            );
        }

        @JavascriptInterface
        public void postDatabaseSyncNative(final String reqId, final String scriptUrl,
                                           final String jsonPayload, final boolean isPush) {
            SamuSyncForegroundService.enqueueNativeDatabaseSync(
                getApplicationContext(),
                reqId,
                scriptUrl,
                jsonPayload,
                isPush
            );
        }

        @JavascriptInterface
        public void postJson(final String reqId, final String urlStr, final String jsonPayload) {
            SamuSyncForegroundService.HTTP_POOL.execute(() -> {
                try {
                    String responseBody = SamuSyncForegroundService.executeHttpRequest(urlStr, "POST", null, jsonPayload);
                    deliverHttpResult(reqId, true, responseBody);
                } catch (Exception e) {
                    deliverHttpResult(reqId, false, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        @JavascriptInterface
        public void getJson(final String reqId, final String urlStr) {
            SamuSyncForegroundService.HTTP_POOL.execute(() -> {
                try {
                    String responseBody = SamuSyncForegroundService.executeHttpRequest(urlStr, "GET", null, null);
                    deliverHttpResult(reqId, true, responseBody);
                } catch (Exception e) {
                    deliverHttpResult(reqId, false, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        @JavascriptInterface
        public void httpRequest(final String reqId, final String method, final String urlStr,
                                final String headersJson, final String body) {
            SamuSyncForegroundService.HTTP_POOL.execute(() -> {
                try {
                    String responseBody = SamuSyncForegroundService.executeHttpRequest(urlStr, method, headersJson, body);
                    deliverHttpResult(reqId, true, responseBody);
                } catch (Exception e) {
                    deliverHttpResult(reqId, false, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        private void deliverHttpResult(final String reqId, final boolean ok, final String text) {
            if (!deliverHttpResultToActiveWebView(reqId, ok, text)) {
                runOnUiThread(() -> {
                    if (webView != null) {
                        String js = "window.__onAndroidHttpResult && window.__onAndroidHttpResult('" + jsEscape(reqId) + "', "
                                + (ok ? "true" : "false") + ", '" + jsEscape(text) + "');";
                        webView.evaluateJavascript(js, null);
                    }
                });
            }
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
            SamuSyncForegroundService.HTTP_POOL.execute(() -> {
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
