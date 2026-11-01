package br.gov.sp.orlandia.samu192;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
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
import android.util.TypedValue;
import android.view.Gravity;
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
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

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

    private WebView webView;
    private SamuSqliteDb sqliteDb;
    private ConnectivityManager.NetworkCallback networkCallback;
    private File pendingApkInstallFile;
    private AlertDialog unknownSourcesDialog;
    private AlertDialog whatsAppPickerDialog;

    private final Object nativeWsLock = new Object();
    private volatile int nativeWsGen = 0;
    private volatile Socket nativeWsSocket = null;
    private volatile OutputStream nativeWsOut = null;
    private final Object nativeWsWriteLock = new Object();
    private final SecureRandom nativeWsRandom = new SecureRandom();

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
        webView.setVerticalScrollBarEnabled(true);
        webView.setHorizontalScrollBarEnabled(false);
        setContentView(
                webView,
                new android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT
                )
        );

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSaveFormData(false);
        settings.setAllowFileAccess(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

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
                    .setNegativeButton("Depois", null)
                    .create();
                unknownSourcesDialog.show();
            } catch (Exception e) {
                openUnknownAppSourcesSettingsScreen();
            }
        });
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
                "  var ids = ['samu-dialog-modal','crew-invite-modal','samu-sig-modal','drafts-modal','regulacao-photo-modal','pdf-preview-modal','server-explorer-modal','drive-explorer-modal'];" +
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
        closeNativeWebSocketInternal();
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

    private void closeNativeWebSocketInternal() {
        Socket toClose;
        synchronized (nativeWsLock) {
            nativeWsGen++;
            toClose = nativeWsSocket;
            nativeWsSocket = null;
            nativeWsOut = null;
        }
        if (toClose != null) {
            try { toClose.close(); } catch (Exception ignored) {}
        }
    }

    private void emitWsEventToJs(final int gen, final String eventType, final String payload) {
        runOnUiThread(() -> {
            if (gen != nativeWsGen || webView == null || isFinishing()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed()) return;
            String js = "window.__onAndroidWsEvent && window.__onAndroidWsEvent('"
                    + jsEscape(eventType) + "', '" + jsEscape(payload) + "');";
            webView.evaluateJavascript(js, null);
        });
    }

    private void sendNativeWsMaskedFrame(final OutputStream out, final int opcode, final byte[] payload) throws Exception {
        byte[] data = payload != null ? payload : new byte[0];
        byte[] mask = new byte[4];
        nativeWsRandom.nextBytes(mask);
        synchronized (nativeWsWriteLock) {
            out.write(0x80 | (opcode & 0x0F));
            int len = data.length;
            if (len <= 125) {
                out.write(0x80 | len);
            } else if (len <= 65535) {
                out.write(0x80 | 126);
                out.write((len >>> 8) & 0xFF);
                out.write(len & 0xFF);
            } else {
                out.write(0x80 | 127);
                long l = len;
                for (int shift = 56; shift >= 0; shift -= 8) {
                    out.write((int) ((l >>> shift) & 0xFFL));
                }
            }
            out.write(mask);
            if (len > 0) {
                byte[] masked = new byte[len];
                for (int i = 0; i < len; i++) {
                    masked[i] = (byte) (data[i] ^ mask[i & 3]);
                }
                out.write(masked);
            }
            out.flush();
        }
    }

    private static byte[] readExactWsBytes(InputStream ins, int count) throws Exception {
        byte[] buf = new byte[count];
        int off = 0;
        while (off < count) {
            int r = ins.read(buf, off, count - off);
            if (r == -1) throw new EOFException("WS EOF");
            off += r;
        }
        return buf;
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

    /* ===================== DESCOBERTA E SELETOR DE WHATSAPP (BUSINESS vs NORMAL / DUAL) ===================== */

    private static final class WhatsAppShareTarget {
        final String packageName;
        final String activityName;
        final String label;
        final String subtitle;
        final String kind; // "business", "normal", "other"
        final Drawable icon;

        WhatsAppShareTarget(String packageName, String activityName, String label, String subtitle, String kind, Drawable icon) {
            this.packageName = packageName;
            this.activityName = activityName;
            this.label = label;
            this.subtitle = subtitle;
            this.kind = kind;
            this.icon = icon;
        }
    }

    private int dpToPx(final int dp) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                dp,
                getResources().getDisplayMetrics()
        ));
    }

    private static String safeCharSequence(final CharSequence cs) {
        return (cs == null) ? "" : cs.toString().trim();
    }

    @SuppressWarnings("deprecation")
    private List<ResolveInfo> queryImageSendActivitiesCompat(final PackageManager pm, final String optionalPackage) {
        try {
            Intent probe = new Intent(Intent.ACTION_SEND);
            probe.setType("image/jpeg");
            if (optionalPackage != null && !optionalPackage.isEmpty()) {
                probe.setPackage(optionalPackage);
            }
            List<ResolveInfo> res;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                res = pm.queryIntentActivities(probe, PackageManager.ResolveInfoFlags.of(0));
            } else {
                res = pm.queryIntentActivities(probe, 0);
            }
            return (res != null) ? res : Collections.emptyList();
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    @SuppressWarnings("deprecation")
    private ApplicationInfo getEnabledAppInfoCompat(final PackageManager pm, final String pkg) {
        try {
            ApplicationInfo ai;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ai = pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0));
            } else {
                ai = pm.getApplicationInfo(pkg, 0);
            }
            return (ai != null && ai.enabled) ? ai : null;
        } catch (Exception e) {
            return null;
        }
    }

    private Drawable loadBestWhatsAppIcon(final PackageManager pm, final ResolveInfo ri,
                                          final ApplicationInfo appInfo, final boolean preferResolveIcon) {
        if (preferResolveIcon && ri != null) {
            try {
                Drawable d = ri.loadIcon(pm);
                if (d != null) return d;
            } catch (Exception ignored) {}
        }
        if (appInfo != null) {
            try {
                Drawable d = appInfo.loadIcon(pm);
                if (d != null) return d;
            } catch (Exception ignored) {}
        }
        if (ri != null) {
            try {
                if (ri.activityInfo != null && ri.activityInfo.applicationInfo != null) {
                    Drawable d = ri.activityInfo.applicationInfo.loadIcon(pm);
                    if (d != null) return d;
                }
            } catch (Exception ignored) {}
            try {
                Drawable d = ri.loadIcon(pm);
                if (d != null) return d;
            } catch (Exception ignored) {}
        }
        return null;
    }

    private String loadBestWhatsAppAppLabel(final PackageManager pm, final ResolveInfo ri, final ApplicationInfo appInfo) {
        if (appInfo != null) {
            try {
                String lbl = safeCharSequence(pm.getApplicationLabel(appInfo));
                if (!lbl.isEmpty()) return lbl;
            } catch (Exception ignored) {}
        }
        if (ri != null && ri.activityInfo != null && ri.activityInfo.applicationInfo != null) {
            try {
                String lbl = safeCharSequence(pm.getApplicationLabel(ri.activityInfo.applicationInfo));
                if (!lbl.isEmpty()) return lbl;
            } catch (Exception ignored) {}
        }
        if (ri != null) {
            try {
                String lbl = safeCharSequence(ri.loadLabel(pm));
                if (!lbl.isEmpty()) return lbl;
            } catch (Exception ignored) {}
        }
        return "";
    }

    /**
     * Descobre todos os WhatsApps instalados no aparelho, priorizando:
     * 1º) WhatsApp Business (com.whatsapp.w4b) — geralmente utilizado para a Regulação Médica;
     * 2º) WhatsApp Normal (com.whatsapp);
     * 3º) Qualquer outro WhatsApp clonado / Dual Messenger (Samsung / Xiaomi / Motorola).
     */
    private List<WhatsAppShareTarget> discoverInstalledWhatsAppTargets() {
        List<WhatsAppShareTarget> targets = new ArrayList<>();
        PackageManager pm = getPackageManager();
        if (pm == null) return targets;

        Set<String> seenKeys = new LinkedHashSet<>();
        Set<String> seenPrimaryPackages = new LinkedHashSet<>();

        // 1º: WhatsApp Business (com.whatsapp.w4b)
        List<ResolveInfo> w4bMatches = queryImageSendActivitiesCompat(pm, "com.whatsapp.w4b");
        ApplicationInfo w4bAppInfo = getEnabledAppInfoCompat(pm, "com.whatsapp.w4b");
        if (!w4bMatches.isEmpty() || w4bAppInfo != null) {
            ResolveInfo ri = !w4bMatches.isEmpty() ? w4bMatches.get(0) : null;
            String actName = (ri != null && ri.activityInfo != null && ri.activityInfo.name != null)
                    ? ri.activityInfo.name
                    : "";
            Drawable icon = loadBestWhatsAppIcon(pm, ri, w4bAppInfo, false);
            targets.add(new WhatsAppShareTarget(
                    "com.whatsapp.w4b",
                    actName,
                    "WhatsApp Business",
                    "Usado geralmente p/ Regulação",
                    "business",
                    icon
            ));
            seenPrimaryPackages.add("com.whatsapp.w4b");
            seenKeys.add("com.whatsapp.w4b/" + actName);
        }

        // 2º: WhatsApp Normal (com.whatsapp)
        List<ResolveInfo> waMatches = queryImageSendActivitiesCompat(pm, "com.whatsapp");
        ApplicationInfo waAppInfo = getEnabledAppInfoCompat(pm, "com.whatsapp");
        if (!waMatches.isEmpty() || waAppInfo != null) {
            ResolveInfo ri = !waMatches.isEmpty() ? waMatches.get(0) : null;
            String actName = (ri != null && ri.activityInfo != null && ri.activityInfo.name != null)
                    ? ri.activityInfo.name
                    : "";
            Drawable icon = loadBestWhatsAppIcon(pm, ri, waAppInfo, false);
            targets.add(new WhatsAppShareTarget(
                    "com.whatsapp",
                    actName,
                    "WhatsApp Normal",
                    "WhatsApp padrão / pessoal",
                    "normal",
                    icon
            ));
            seenPrimaryPackages.add("com.whatsapp");
            seenKeys.add("com.whatsapp/" + actName);
        }

        // 3º: Varredura geral para WhatsApp Dual Messenger / Dual Apps / variantes
        for (ResolveInfo ri : queryImageSendActivitiesCompat(pm, null)) {
            if (ri == null || ri.activityInfo == null || ri.activityInfo.packageName == null) continue;
            String pkg = ri.activityInfo.packageName;
            String act = (ri.activityInfo.name != null) ? ri.activityInfo.name : "";
            String key = pkg + "/" + act;
            if (seenKeys.contains(key) || seenPrimaryPackages.contains(pkg)) continue;

            String actLbl = "";
            try { actLbl = safeCharSequence(ri.loadLabel(pm)); } catch (Exception ignored) {}
            String appLbl = loadBestWhatsAppAppLabel(pm, ri, null);
            String combinedLower = (pkg + " " + actLbl + " " + appLbl).toLowerCase(Locale.ROOT);
            if (!combinedLower.contains("whatsapp")) continue;

            String displayLbl = !actLbl.isEmpty() ? actLbl : (!appLbl.isEmpty() ? appLbl : "WhatsApp (Secundário)");
            if ("whatsapp".equalsIgnoreCase(displayLbl) && seenPrimaryPackages.contains("com.whatsapp")) {
                displayLbl = "WhatsApp (Dual / Clone)";
            } else if ("whatsapp business".equalsIgnoreCase(displayLbl) && seenPrimaryPackages.contains("com.whatsapp.w4b")) {
                displayLbl = "WhatsApp Business (Dual / Clone)";
            }
            Drawable icon = loadBestWhatsAppIcon(pm, ri, null, true);
            targets.add(new WhatsAppShareTarget(
                    pkg,
                    act,
                    displayLbl,
                    "Conta secundária instalada no aparelho",
                    "other",
                    icon
            ));
            seenKeys.add(key);
        }

        return targets;
    }

    private static String sanitizeSharedJpegName(final String fileName) {
        String safeName = (fileName == null || fileName.trim().isEmpty())
                ? "Cabecalho_Regulacao_SAMU.jpg"
                : fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
        String lower = safeName.toLowerCase(Locale.ROOT);
        if (!lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) {
            safeName += ".jpg";
        }
        return safeName;
    }

    private Uri writeSharedJpegToCache(final String base64Image, final String safeName) throws Exception {
        String cleanB64 = base64Image;
        int commaIdx = (cleanB64 != null) ? cleanB64.indexOf(',') : -1;
        if (commaIdx >= 0) {
            cleanB64 = cleanB64.substring(commaIdx + 1);
        }
        byte[] imgBytes = Base64.decode(cleanB64, Base64.DEFAULT);
        File dir = new File(getCacheDir(), "shared_pdfs");
        if (!dir.exists()) dir.mkdirs();
        File outFile = new File(dir, safeName);
        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            fos.write(imgBytes);
        }
        return Uri.parse("content://" + PdfShareProvider.AUTHORITY + "/" + safeName);
    }

    private Intent buildImageSendIntent(final Uri contentUri, final String safeName, final String captionText) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("image/jpeg");
        intent.putExtra(Intent.EXTRA_STREAM, contentUri);
        intent.setClipData(ClipData.newRawUri(safeName, contentUri));
        if (captionText != null && !captionText.trim().isEmpty()) {
            intent.putExtra(Intent.EXTRA_TEXT, captionText);
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }

    private void launchSystemImageShareChooser(final Uri contentUri, final String safeName, final String captionText) {
        Intent fallback = buildImageSendIntent(contentUri, safeName, captionText);
        startActivity(Intent.createChooser(fallback, "Enviar Foto do Cabeçalho p/ Regulação"));
    }

    private boolean launchTargetedWhatsAppShare(final Uri contentUri, final String safeName, final String captionText,
                                                final String targetPkg, final String targetActivity) {
        if (targetPkg == null || targetPkg.trim().isEmpty()) return false;
        String pkg = targetPkg.trim();
        String act = (targetActivity != null) ? targetActivity.trim() : "";
        boolean isStandardWaPkg = "com.whatsapp.w4b".equals(pkg) || "com.whatsapp".equals(pkg);

        if (isStandardWaPkg) {
            try {
                Intent waIntent = buildImageSendIntent(contentUri, safeName, captionText);
                waIntent.setPackage(pkg);
                startActivity(waIntent);
                return true;
            } catch (Exception ignored) {}
            if (!act.isEmpty()) {
                try {
                    Intent waCompIntent = buildImageSendIntent(contentUri, safeName, captionText);
                    waCompIntent.setClassName(pkg, act);
                    startActivity(waCompIntent);
                    return true;
                } catch (Exception ignored) {}
            }
            return false;
        }

        if (!act.isEmpty()) {
            try {
                Intent customCompIntent = buildImageSendIntent(contentUri, safeName, captionText);
                customCompIntent.setClassName(pkg, act);
                startActivity(customCompIntent);
                return true;
            } catch (Exception ignored) {}
        }
        try {
            Intent customPkgIntent = buildImageSendIntent(contentUri, safeName, captionText);
            customPkgIntent.setPackage(pkg);
            startActivity(customPkgIntent);
            return true;
        } catch (Exception ignored) {}
        return false;
    }

    private void showWhatsAppChooserDialog(final List<WhatsAppShareTarget> targets,
                                           final Uri contentUri,
                                           final String safeName,
                                           final String captionText) {
        if (isFinishing()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed()) return;
        try {
            if (whatsAppPickerDialog != null && whatsAppPickerDialog.isShowing()) {
                whatsAppPickerDialog.dismiss();
            }
        } catch (Exception ignored) {}

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int padH = dpToPx(18);
        int padTop = dpToPx(18);
        int padBottom = dpToPx(8);
        root.setPadding(padH, padTop, padH, padBottom);
        scrollView.addView(root);

        TextView titleTv = new TextView(this);
        titleTv.setText("📲 Escolher WhatsApp p/ Regulação");
        titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17.5f);
        titleTv.setTypeface(null, Typeface.BOLD);
        titleTv.setTextColor(Color.parseColor("#0f172a"));
        root.addView(titleTv);

        TextView subTv = new TextView(this);
        subTv.setText("Toque no WhatsApp instalado que deseja utilizar para enviar a foto do cabeçalho:");
        subTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f);
        subTv.setTextColor(Color.parseColor("#475569"));
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        subLp.topMargin = dpToPx(5);
        subLp.bottomMargin = dpToPx(14);
        root.addView(subTv, subLp);

        for (final WhatsAppShareTarget target : targets) {
            boolean isBusiness = "business".equals(target.kind);

            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.HORIZONTAL);
            card.setGravity(Gravity.CENTER_VERTICAL);
            card.setClickable(true);
            card.setFocusable(true);
            int cardPadH = dpToPx(14);
            int cardPadV = dpToPx(12);
            card.setPadding(cardPadH, cardPadV, cardPadH, cardPadV);

            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.RECTANGLE);
            bg.setCornerRadius(dpToPx(14));
            bg.setColor(Color.parseColor(isBusiness ? "#ecfdf5" : "#f8fafc"));
            bg.setStroke(dpToPx(isBusiness ? 2 : 1), Color.parseColor(isBusiness ? "#059669" : "#cbd5e1"));
            card.setBackground(bg);

            LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
            );
            cardLp.bottomMargin = dpToPx(10);

            if (target.icon != null) {
                ImageView iconIv = new ImageView(this);
                iconIv.setImageDrawable(target.icon);
                iconIv.setScaleType(ImageView.ScaleType.FIT_CENTER);
                int iconPx = dpToPx(42);
                LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(iconPx, iconPx);
                iconLp.rightMargin = dpToPx(12);
                card.addView(iconIv, iconLp);
            }

            LinearLayout textCol = new LinearLayout(this);
            textCol.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams textColLp = new LinearLayout.LayoutParams(
                    0,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    1.0f
            );

            TextView nameTv = new TextView(this);
            nameTv.setText(target.label);
            nameTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15.5f);
            nameTv.setTypeface(null, Typeface.BOLD);
            nameTv.setTextColor(Color.parseColor(isBusiness ? "#064e3b" : "#0f172a"));
            textCol.addView(nameTv);

            if (target.subtitle != null && !target.subtitle.isEmpty()) {
                TextView hintTv = new TextView(this);
                hintTv.setText(target.subtitle);
                hintTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.2f);
                hintTv.setTextColor(Color.parseColor(isBusiness ? "#047857" : "#64748b"));
                textCol.addView(hintTv);
            }
            card.addView(textCol, textColLp);

            TextView actionTv = new TextView(this);
            actionTv.setText("Abrir ›");
            actionTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f);
            actionTv.setTypeface(null, Typeface.BOLD);
            actionTv.setTextColor(Color.parseColor(isBusiness ? "#059669" : "#2563eb"));
            LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
            );
            actionLp.leftMargin = dpToPx(8);
            card.addView(actionTv, actionLp);

            card.setOnClickListener(v -> {
                try {
                    if (whatsAppPickerDialog != null) whatsAppPickerDialog.dismiss();
                } catch (Exception ignored) {}
                boolean ok = launchTargetedWhatsAppShare(
                        contentUri, safeName, captionText, target.packageName, target.activityName
                );
                if (!ok) {
                    launchSystemImageShareChooser(contentUri, safeName, captionText);
                }
            });

            root.addView(card, cardLp);
        }

        // Botão auxiliar p/ abrir a gaveta geral de compartilhamento do Android (caso usem outro app)
        TextView otherAppsBtn = new TextView(this);
        otherAppsBtn.setText("📤 Outros aplicativos do celular...");
        otherAppsBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.2f);
        otherAppsBtn.setTypeface(null, Typeface.BOLD);
        otherAppsBtn.setTextColor(Color.parseColor("#334155"));
        otherAppsBtn.setGravity(Gravity.CENTER);
        otherAppsBtn.setClickable(true);
        otherAppsBtn.setFocusable(true);
        otherAppsBtn.setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10));
        GradientDrawable otherBg = new GradientDrawable();
        otherBg.setShape(GradientDrawable.RECTANGLE);
        otherBg.setCornerRadius(dpToPx(10));
        otherBg.setColor(Color.parseColor("#f1f5f9"));
        otherBg.setStroke(dpToPx(1), Color.parseColor("#e2e8f0"));
        otherAppsBtn.setBackground(otherBg);
        LinearLayout.LayoutParams otherLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        otherLp.topMargin = dpToPx(2);
        otherAppsBtn.setOnClickListener(v -> {
            try {
                if (whatsAppPickerDialog != null) whatsAppPickerDialog.dismiss();
            } catch (Exception ignored) {}
            launchSystemImageShareChooser(contentUri, safeName, captionText);
        });
        root.addView(otherAppsBtn, otherLp);

        whatsAppPickerDialog = new AlertDialog.Builder(this)
                .setView(scrollView)
                .setNegativeButton("Cancelar", null)
                .create();
        whatsAppPickerDialog.show();
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
                    shareIntent.setClipData(ClipData.newRawUri(safeName, contentUri));
                    shareIntent.putExtra(Intent.EXTRA_SUBJECT, safeName);
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                    startActivity(Intent.createChooser(shareIntent, "Enviar ou Salvar PDF SAMU 192"));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Erro ao compartilhar PDF: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public String getInstalledWhatsAppsJson() {
            try {
                List<WhatsAppShareTarget> targets = discoverInstalledWhatsAppTargets();
                JSONArray arr = new JSONArray();
                for (WhatsAppShareTarget t : targets) {
                    JSONObject obj = new JSONObject();
                    obj.put("pkg", t.packageName);
                    obj.put("activity", t.activityName != null ? t.activityName : "");
                    obj.put("label", t.label != null ? t.label : "WhatsApp");
                    obj.put("subtitle", t.subtitle != null ? t.subtitle : "");
                    obj.put("kind", t.kind != null ? t.kind : "other");
                    arr.put(obj);
                }
                return arr.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public void shareImageToWhatsAppTarget(final String base64Image,
                                               final String fileName,
                                               final String captionText,
                                               final String targetPkg,
                                               final String targetActivity) {
            runOnUiThread(() -> {
                try {
                    String safeName = sanitizeSharedJpegName(fileName);
                    Uri contentUri = writeSharedJpegToCache(base64Image, safeName);
                    String cleanTargetPkg = (targetPkg != null) ? targetPkg.trim() : "";

                    if ("__chooser__".equals(cleanTargetPkg)) {
                        launchSystemImageShareChooser(contentUri, safeName, captionText);
                        return;
                    }

                    if (!cleanTargetPkg.isEmpty()) {
                        boolean ok = launchTargetedWhatsAppShare(
                                contentUri, safeName, captionText, cleanTargetPkg, targetActivity
                        );
                        if (!ok) {
                            launchSystemImageShareChooser(contentUri, safeName, captionText);
                        }
                        return;
                    }

                    List<WhatsAppShareTarget> targets = discoverInstalledWhatsAppTargets();
                    if (targets.size() >= 2) {
                        // Permite escolher qual dos WhatsApps instalados usar (WhatsApp Business vs Normal / Dual)
                        showWhatsAppChooserDialog(targets, contentUri, safeName, captionText);
                        return;
                    }
                    if (targets.size() == 1) {
                        WhatsAppShareTarget only = targets.get(0);
                        boolean ok = launchTargetedWhatsAppShare(
                                contentUri, safeName, captionText, only.packageName, only.activityName
                        );
                        if (ok) return;
                    }

                    launchSystemImageShareChooser(contentUri, safeName, captionText);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Erro ao enviar foto p/ WhatsApp: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void shareImageToWhatsApp(final String base64Image, final String fileName, final String captionText) {
            shareImageToWhatsAppTarget(base64Image, fileName, captionText, null, null);
        }

        @JavascriptInterface
        public void shareText(final String text, final String chooserTitle) {
            if (text == null || text.trim().isEmpty()) return;
            runOnUiThread(() -> {
                try {
                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    shareIntent.setType("text/plain");
                    shareIntent.putExtra(Intent.EXTRA_SUBJECT, "SAMU 192 – Orlândia-SP (Versão Web)");
                    shareIntent.putExtra(Intent.EXTRA_TEXT, text);
                    String title = (chooserTitle == null || chooserTitle.trim().isEmpty())
                            ? "Compartilhar Link da Versão Web SAMU 192"
                            : chooserTitle;
                    startActivity(Intent.createChooser(shareIntent, title));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Erro ao compartilhar link: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public boolean copyText(final String text) {
            if (text == null) return false;
            runOnUiThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(ClipData.newPlainText("SAMU 192 Web", text));
                    }
                } catch (Exception ignored) {}
            });
            return true;
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
            return true;
        }

        @JavascriptInterface
        public void requestIgnoreBatteryOptimizations() {
            // Mantém o otimizador de bateria padrão do Android ativo para economizar bateria
        }

        @JavascriptInterface
        public void ensureBatteryOptimizationDisabled() {
            // Mantém o otimizador de bateria padrão do Android ativo para economizar bateria
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

        /* ===================== WEBSOCKET NATIVO TEMPO REAL (LAN WS:// + 4G WSS://) ===================== */

        @JavascriptInterface
        public boolean hasNativeWebSocket() {
            return true;
        }

        @JavascriptInterface
        public void discoverLocalServer(final String reqId) {
            SamuSyncForegroundService.HTTP_POOL.execute(() -> {
                try {
                    List<String> localIpv4s = new ArrayList<>();
                    Enumeration<NetworkInterface> nets = NetworkInterface.getNetworkInterfaces();
                    while (nets != null && nets.hasMoreElements()) {
                        NetworkInterface nif = nets.nextElement();
                        if (nif == null || !nif.isUp() || nif.isLoopback()) continue;
                        String nName = nif.getName() != null ? nif.getName().toLowerCase(Locale.US) : "";
                        if (nName.startsWith("rmnet") || nName.startsWith("ccmni") || nName.startsWith("tun") || nName.startsWith("ppp") || nName.startsWith("dummy")) {
                            continue;
                        }
                        Enumeration<InetAddress> addrs = nif.getInetAddresses();
                        while (addrs != null && addrs.hasMoreElements()) {
                            InetAddress addr = addrs.nextElement();
                            if (!(addr instanceof Inet4Address) || addr.isLoopbackAddress()) continue;
                            String ip = addr.getHostAddress();
                            if (ip == null) continue;
                            if (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.matches("^172\\.(1[6-9]|2\\d|3[0-1])\\..*")) {
                                if (!localIpv4s.contains(ip)) {
                                    localIpv4s.add(ip);
                                }
                            }
                        }
                    }

                    if (localIpv4s.isEmpty()) {
                        deliverHttpResult(reqId, true, "{\"ok\":false,\"reason\":\"no_wifi_lan\"}");
                        return;
                    }

                    final AtomicReference<String> foundHealthJson = new AtomicReference<>(null);
                    for (String selfIp : localIpv4s) {
                        if (foundHealthJson.get() != null) break;
                        int lastDot = selfIp.lastIndexOf('.');
                        if (lastDot <= 0) continue;
                        final String prefix = selfIp.substring(0, lastDot + 1);
                        int selfHost = -1;
                        try {
                            selfHost = Integer.parseInt(selfIp.substring(lastDot + 1));
                        } catch (Exception ignored) {}

                        ExecutorService scanPool = Executors.newFixedThreadPool(42);
                        for (int h = 1; h <= 254; h++) {
                            if (h == selfHost) continue;
                            final String candidateIp = prefix + h;
                            scanPool.execute(() -> {
                                if (foundHealthJson.get() != null) return;
                                Socket s = new Socket();
                                try {
                                    s.connect(new InetSocketAddress(candidateIp, 18920), 210);
                                    if (foundHealthJson.get() != null) return;
                                    s.setSoTimeout(1200);
                                    OutputStream os = s.getOutputStream();
                                    String pingReq = "GET /api/ping HTTP/1.1\r\nHost: " + candidateIp + ":18920\r\nConnection: close\r\n\r\n";
                                    os.write(pingReq.getBytes(StandardCharsets.US_ASCII));
                                    os.flush();

                                    String rawResp = readStreamUtf8(s.getInputStream());
                                    int bodyIdx = rawResp.indexOf("\r\n\r\n");
                                    String jsonBody = bodyIdx >= 0 ? rawResp.substring(bodyIdx + 4).trim() : rawResp.trim();
                                    int braceStart = jsonBody.indexOf('{');
                                    int braceEnd = jsonBody.lastIndexOf('}');
                                    if (braceStart >= 0 && braceEnd > braceStart) {
                                        jsonBody = jsonBody.substring(braceStart, braceEnd + 1);
                                        JSONObject obj = new JSONObject(jsonBody);
                                        if (obj.optBoolean("ok", false) && (obj.optInt("lanPort", 0) == 18920 || obj.has("sdCard") || obj.optString("service", "").contains("SAMU"))) {
                                            obj.put("lanUrl", "http://" + candidateIp + ":18920");
                                            foundHealthJson.compareAndSet(null, obj.toString());
                                        }
                                    }
                                } catch (Exception ignored) {
                                } finally {
                                    try { s.close(); } catch (Exception ignored) {}
                                }
                            });
                        }
                        scanPool.shutdown();
                        try {
                            scanPool.awaitTermination(2200, TimeUnit.MILLISECONDS);
                        } catch (InterruptedException ignored) {}
                        scanPool.shutdownNow();
                    }

                    String winner = foundHealthJson.get();
                    if (winner != null) {
                        deliverHttpResult(reqId, true, winner);
                    } else {
                        deliverHttpResult(reqId, true, "{\"ok\":false,\"reason\":\"not_found_on_lan\"}");
                    }
                } catch (Exception e) {
                    deliverHttpResult(reqId, true, "{\"ok\":false}");
                }
            });
        }

        @JavascriptInterface
        public void wsDisconnect() {
            closeNativeWebSocketInternal();
        }

        @JavascriptInterface
        public boolean wsSend(final String text) {
            final OutputStream out = nativeWsOut;
            final Socket sock = nativeWsSocket;
            if (out == null || sock == null || sock.isClosed()) return false;
            final byte[] bytes = (text != null ? text : "").getBytes(StandardCharsets.UTF_8);
            SamuSyncForegroundService.HTTP_POOL.execute(() -> {
                try {
                    sendNativeWsMaskedFrame(out, 0x1, bytes);
                } catch (Exception e) {
                    try { sock.close(); } catch (Exception ignored) {}
                }
            });
            return true;
        }

        @JavascriptInterface
        public void wsConnect(final String wsUrl) {
            final int myGen;
            Socket oldSock;
            synchronized (nativeWsLock) {
                nativeWsGen++;
                myGen = nativeWsGen;
                oldSock = nativeWsSocket;
                nativeWsSocket = null;
                nativeWsOut = null;
            }
            if (oldSock != null) {
                try { oldSock.close(); } catch (Exception ignored) {}
            }
            if (wsUrl == null || wsUrl.trim().isEmpty()) return;

            new Thread(() -> {
                Socket sock = null;
                try {
                    URI uri = URI.create(wsUrl.trim());
                    String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "ws";
                    boolean secure = "wss".equals(scheme) || "https".equals(scheme);
                    String host = uri.getHost();
                    if (host == null || host.isEmpty()) throw new Exception("Host WS inválido");
                    int port = uri.getPort() > 0 ? uri.getPort() : (secure ? 443 : 80);
                    String rawPath = (uri.getRawPath() == null || uri.getRawPath().isEmpty()) ? "/ws" : uri.getRawPath();
                    String target = uri.getRawQuery() != null && !uri.getRawQuery().isEmpty()
                            ? (rawPath + "?" + uri.getRawQuery())
                            : rawPath;

                    Socket tcp = new Socket();
                    tcp.connect(new InetSocketAddress(host, port), 5500);
                    if (secure) {
                        SSLSocketFactory sf = (SSLSocketFactory) SSLSocketFactory.getDefault();
                        SSLSocket ssl = (SSLSocket) sf.createSocket(tcp, host, port, true);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !host.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+$")) {
                            try {
                                SSLParameters sslParams = ssl.getSSLParameters();
                                sslParams.setServerNames(Collections.singletonList(new SNIHostName(host)));
                                ssl.setSSLParameters(sslParams);
                            } catch (Exception ignored) {}
                        }
                        ssl.startHandshake();
                        sock = ssl;
                    } else {
                        sock = tcp;
                    }
                    sock.setTcpNoDelay(true);
                    sock.setSoTimeout(95000);

                    synchronized (nativeWsLock) {
                        if (myGen != nativeWsGen) {
                            try { sock.close(); } catch (Exception ignored) {}
                            return;
                        }
                        nativeWsSocket = sock;
                    }

                    InputStream ins = sock.getInputStream();
                    OutputStream out = sock.getOutputStream();

                    byte[] keyNonce = new byte[16];
                    nativeWsRandom.nextBytes(keyNonce);
                    String secKey = Base64.encodeToString(keyNonce, Base64.NO_WRAP);
                    String hostHdr = ((secure && port == 443) || (!secure && port == 80)) ? host : (host + ":" + port);

                    String req = "GET " + target + " HTTP/1.1\r\n"
                            + "Host: " + hostHdr + "\r\n"
                            + "Upgrade: websocket\r\n"
                            + "Connection: Upgrade\r\n"
                            + "Sec-WebSocket-Key: " + secKey + "\r\n"
                            + "Sec-WebSocket-Version: 13\r\n"
                            + "User-Agent: SAMU192-Fichas-WS/1.0\r\n\r\n";
                    out.write(req.getBytes(StandardCharsets.US_ASCII));
                    out.flush();

                    ByteArrayOutputStream hdrBuf = new ByteArrayOutputStream(512);
                    int st = 0;
                    boolean gotEnd = false;
                    while (hdrBuf.size() < 16384) {
                        int b = ins.read();
                        if (b == -1) break;
                        hdrBuf.write(b);
                        if (b == '\r' && (st == 0 || st == 2)) st++;
                        else if (b == '\n' && st == 1) st = 2;
                        else if (b == '\n' && st == 3) { gotEnd = true; break; }
                        else st = 0;
                    }
                    String hdrStr = hdrBuf.toString("UTF-8");
                    String hdrUpper = hdrStr.toUpperCase(Locale.US);
                    if (!gotEnd || (!hdrUpper.startsWith("HTTP/1.1 101") && !hdrUpper.startsWith("HTTP/1.0 101"))) {
                        throw new Exception("Handshake WS recusado");
                    }

                    synchronized (nativeWsLock) {
                        if (myGen != nativeWsGen) {
                            try { sock.close(); } catch (Exception ignored) {}
                            return;
                        }
                        nativeWsOut = out;
                    }
                    emitWsEventToJs(myGen, "open", wsUrl);

                    ByteArrayOutputStream textAsm = new ByteArrayOutputStream();
                    boolean assembling = false;
                    while (myGen == nativeWsGen && !sock.isClosed()) {
                        int b0 = ins.read();
                        if (b0 == -1) break;
                        int b1 = ins.read();
                        if (b1 == -1) break;

                        boolean fin = (b0 & 0x80) != 0;
                        int opcode = b0 & 0x0F;
                        boolean masked = (b1 & 0x80) != 0;
                        long pLen = (b1 & 0x7F);
                        if (pLen == 126L) {
                            byte[] ext = readExactWsBytes(ins, 2);
                            pLen = (((ext[0] & 0xFF) << 8) | (ext[1] & 0xFF));
                        } else if (pLen == 127L) {
                            byte[] ext = readExactWsBytes(ins, 8);
                            pLen = 0L;
                            for (int i = 0; i < 8; i++) pLen = (pLen << 8) | (ext[i] & 0xFFL);
                        }
                        if (pLen < 0L || pLen > 8L * 1024L * 1024L) break;

                        byte[] mKey = masked ? readExactWsBytes(ins, 4) : null;
                        byte[] payload = pLen > 0L ? readExactWsBytes(ins, (int) pLen) : new byte[0];
                        if (masked && mKey != null) {
                            for (int i = 0; i < payload.length; i++) {
                                payload[i] = (byte) (payload[i] ^ mKey[i & 3]);
                            }
                        }

                        if (opcode == 0x8) {
                            break;
                        } else if (opcode == 0x9) {
                            sendNativeWsMaskedFrame(out, 0xA, payload);
                        } else if (opcode == 0x1) {
                            if (fin) {
                                emitWsEventToJs(myGen, "message", new String(payload, StandardCharsets.UTF_8));
                            } else {
                                textAsm.reset();
                                textAsm.write(payload);
                                assembling = true;
                            }
                        } else if (opcode == 0x0 && assembling) {
                            textAsm.write(payload);
                            if (fin) {
                                assembling = false;
                                emitWsEventToJs(myGen, "message", new String(textAsm.toByteArray(), StandardCharsets.UTF_8));
                                textAsm.reset();
                            }
                        }
                    }
                } catch (Exception e) {
                    emitWsEventToJs(myGen, "error", e.getMessage() != null ? e.getMessage() : "ws_err");
                } finally {
                    if (sock != null) {
                        try { sock.close(); } catch (Exception ignored) {}
                    }
                    synchronized (nativeWsLock) {
                        if (myGen == nativeWsGen) {
                            nativeWsSocket = null;
                            nativeWsOut = null;
                        }
                    }
                    emitWsEventToJs(myGen, "close", "");
                }
            }, "SamuFichasRealtimeWS").start();
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
