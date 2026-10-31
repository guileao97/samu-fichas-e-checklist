package br.gov.sp.orlandia.samu192;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Serviço em Primeiro Plano (Foreground Service) do SAMU 192 – Orlândia-SP.
 * Garante que envios de PDFs ao Google Drive, fila da Impressora da Base e
 * sincronizações da base operacional NUNCA parem mesmo se o socorrista minimizar
 * a tela, bloquear o celular ou fechar o APK, exibindo o progresso na barra de
 * notificações do Android quando o usuário estiver fora do aplicativo.
 */
public class SamuSyncForegroundService extends Service {

    private static final String CHANNEL_PROGRESS_ID = "samu_bg_sync_progress";
    private static final String CHANNEL_DONE_ID = "samu_bg_sync_done";
    private static final int NOTIF_ID_PROGRESS = 19201;
    private static final int NOTIF_ID_DONE = 19202;

    private static final String ACTION_START_OR_UPDATE = "br.gov.sp.orlandia.samu192.BG_SYNC_UPDATE";
    private static final String ACTION_STOP_IF_IDLE = "br.gov.sp.orlandia.samu192.BG_SYNC_STOP_IDLE";

    public static final ExecutorService HTTP_POOL = Executors.newCachedThreadPool();
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());

    private static final AtomicInteger sActiveNativeJobs = new AtomicInteger(0);
    private static volatile boolean sJsWorkActive = false;
    private static volatile String sCurrentTitle = "SAMU 192 • Sincronizando...";
    private static volatile String sCurrentDetail = "Enviando dados em segundo plano...";
    private static volatile int sCurrentPercent = -1;

    private static PowerManager.WakeLock sWakeLock;
    private static Runnable sJsSafetyTimeoutRunnable;
    private static volatile boolean sChannelsCreated = false;

    public static boolean hasActiveWork() {
        return sJsWorkActive || sActiveNativeJobs.get() > 0;
    }

    public static boolean isJsWorkActive() {
        return sJsWorkActive;
    }

    private static synchronized void acquireWakeLock(Context appCtx) {
        try {
            if (sWakeLock == null) {
                PowerManager pm = (PowerManager) appCtx.getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    sWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "samu192:BgSyncWakeLock");
                    sWakeLock.setReferenceCounted(false);
                }
            }
            if (sWakeLock != null) {
                sWakeLock.acquire(10 * 60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    private static synchronized void releaseWakeLockIfIdle() {
        if (hasActiveWork()) return;
        try {
            if (sWakeLock != null && sWakeLock.isHeld()) {
                sWakeLock.release();
            }
        } catch (Exception ignored) {}
    }

    public static void ensureChannels(Context ctx) {
        if (sChannelsCreated || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel progCh = new NotificationChannel(
                CHANNEL_PROGRESS_ID,
                "Envio e Sincronização em Segundo Plano",
                NotificationManager.IMPORTANCE_LOW
            );
            progCh.setDescription("Progresso de envio de fichas/PDFs ao Google Drive e Impressora da Base");
            progCh.setShowBadge(false);
            nm.createNotificationChannel(progCh);

            NotificationChannel doneCh = new NotificationChannel(
                CHANNEL_DONE_ID,
                "Confirmação de Envio Concluído",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            doneCh.setDescription("Avisa quando um envio ao Google Drive termina com o aplicativo fechado ou em segundo plano");
            doneCh.setShowBadge(true);
            nm.createNotificationChannel(doneCh);

            sChannelsCreated = true;
        } catch (Exception ignored) {}
    }

    private static PendingIntent buildOpenAppPendingIntent(Context ctx) {
        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, 192, openIntent, flags);
    }

    private static Notification buildProgressNotification(Context ctx) {
        ensureChannels(ctx);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(ctx, CHANNEL_PROGRESS_ID);
        } else {
            @SuppressWarnings("deprecation")
            Notification.Builder legacy = new Notification.Builder(ctx);
            builder = legacy;
        }

        String title = (sCurrentTitle != null && !sCurrentTitle.isEmpty())
                ? sCurrentTitle
                : "SAMU 192 • Enviando em segundo plano...";
        String detail = (sCurrentDetail != null && !sCurrentDetail.isEmpty())
                ? sCurrentDetail
                : "Sincronizando dados com o Google Drive...";
        int pct = sCurrentPercent;

        builder.setSmallIcon(android.R.drawable.stat_sys_upload)
               .setContentTitle(title)
               .setContentText(detail)
               .setStyle(new Notification.BigTextStyle().bigText(detail))
               .setOngoing(true)
               .setOnlyAlertOnce(true)
               .setContentIntent(buildOpenAppPendingIntent(ctx));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.setColor(0xFFC8102E);
            builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        }

        if (pct >= 0 && pct <= 100) {
            builder.setProgress(100, pct, false);
        } else {
            builder.setProgress(100, 0, true);
        }

        return builder.build();
    }

    public static void postCompletionNotificationIfBackground(Context ctx, String title, String detail, boolean success) {
        if (MainActivity.isAppInForeground()) return;
        Context appCtx = ctx.getApplicationContext();
        ensureChannels(appCtx);
        try {
            NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder = new Notification.Builder(appCtx, CHANNEL_DONE_ID);
            } else {
                @SuppressWarnings("deprecation")
                Notification.Builder legacy = new Notification.Builder(appCtx);
                builder = legacy;
            }

            int icon = success ? android.R.drawable.stat_sys_upload_done : android.R.drawable.stat_notify_sync;
            builder.setSmallIcon(icon)
                   .setContentTitle(title)
                   .setContentText(detail)
                   .setStyle(new Notification.BigTextStyle().bigText(detail))
                   .setAutoCancel(true)
                   .setOngoing(false)
                   .setContentIntent(buildOpenAppPendingIntent(appCtx));

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                builder.setColor(success ? 0xFF15803D : 0xFFD97706);
                builder.setVisibility(Notification.VISIBILITY_PUBLIC);
            }

            nm.notify(NOTIF_ID_DONE, builder.build());
        } catch (Exception ignored) {}
    }

    public static void cancelCompletionNotification(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIF_ID_DONE);
            }
        } catch (Exception ignored) {}
    }

    public static void onAppForegroundChanged(Context ctx, boolean inForeground) {
        Context appCtx = ctx.getApplicationContext();
        if (inForeground) {
            cancelCompletionNotification(appCtx);
        }
        if (hasActiveWork()) {
            refreshProgressNotification(appCtx);
        }
    }

    public static void onMainActivityDestroyed(Context ctx) {
        Context appCtx = ctx.getApplicationContext();
        sJsWorkActive = false;
        if (sJsSafetyTimeoutRunnable != null) {
            MAIN_HANDLER.removeCallbacks(sJsSafetyTimeoutRunnable);
            sJsSafetyTimeoutRunnable = null;
        }
        if (hasActiveWork()) {
            acquireWakeLock(appCtx);
            refreshProgressNotification(appCtx);
        } else {
            checkAndStopIfIdle(appCtx);
        }
    }

    private static void refreshProgressNotification(Context appCtx) {
        try {
            NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && hasActiveWork()) {
                nm.notify(NOTIF_ID_PROGRESS, buildProgressNotification(appCtx));
            }
        } catch (Exception ignored) {}
    }

    private static void startOrUpdateService(Context ctx) {
        Context appCtx = ctx.getApplicationContext();
        acquireWakeLock(appCtx);
        try {
            Intent svc = new Intent(appCtx, SamuSyncForegroundService.class);
            svc.setAction(ACTION_START_OR_UPDATE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appCtx.startForegroundService(svc);
            } else {
                appCtx.startService(svc);
            }
        } catch (Exception e) {
            // Caso o Android 12+ restrinja início de FGS já em segundo plano, mantém WakeLock + notificação normal
            refreshProgressNotification(appCtx);
        }
    }

    private static void checkAndStopIfIdle(Context ctx) {
        final Context appCtx = ctx.getApplicationContext();
        MAIN_HANDLER.postDelayed(() -> {
            if (!hasActiveWork()) {
                releaseWakeLockIfIdle();
                try {
                    Intent svc = new Intent(appCtx, SamuSyncForegroundService.class);
                    svc.setAction(ACTION_STOP_IF_IDLE);
                    appCtx.startService(svc);
                } catch (Exception ignored) {
                    try {
                        NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
                        if (nm != null) nm.cancel(NOTIF_ID_PROGRESS);
                    } catch (Exception ignored2) {}
                }
            }
        }, 450);
    }

    public static void updateJsBackgroundState(Context ctx, boolean active, String title, String detail, int percent,
                                               String doneTitle, String doneDetail, boolean doneSuccess) {
        final Context appCtx = ctx.getApplicationContext();
        sJsWorkActive = active;
        if (sJsSafetyTimeoutRunnable != null) {
            MAIN_HANDLER.removeCallbacks(sJsSafetyTimeoutRunnable);
            sJsSafetyTimeoutRunnable = null;
        }

        if (active) {
            if (title != null && !title.isEmpty()) sCurrentTitle = title;
            if (detail != null && !detail.isEmpty()) sCurrentDetail = detail;
            sCurrentPercent = percent;
            startOrUpdateService(appCtx);
            refreshProgressNotification(appCtx);

            // Timeout de segurança de 3 minutos caso a WebView pare de reportar estado
            sJsSafetyTimeoutRunnable = () -> {
                sJsWorkActive = false;
                checkAndStopIfIdle(appCtx);
            };
            MAIN_HANDLER.postDelayed(sJsSafetyTimeoutRunnable, 180000L);
        } else {
            if (doneTitle != null && !doneTitle.trim().isEmpty() && sActiveNativeJobs.get() <= 0) {
                postCompletionNotificationIfBackground(
                    appCtx,
                    doneTitle,
                    (doneDetail != null && !doneDetail.trim().isEmpty()) ? doneDetail : doneTitle,
                    doneSuccess
                );
            }
            if (hasActiveWork()) {
                refreshProgressNotification(appCtx);
            } else {
                checkAndStopIfIdle(appCtx);
            }
        }
    }

    /**
     * Executa o upload completo do PDF + registro ao Google Apps Script dentro do ForegroundService
     * e grava o resultado diretamente no SQLite Nativo (samu_orlandia_192.db), garantindo conclusão
     * mesmo se o usuário fechar o APK imediatamente após tocar em Salvar e Enviar.
     */
    public static void enqueueNativeRecordUpload(Context ctx, final String reqId, final String scriptUrl,
                                                 final String jsonPayload, final String recordId,
                                                 final String jobTitle) {
        final Context appCtx = ctx.getApplicationContext();
        sActiveNativeJobs.incrementAndGet();
        boolean hasAutoPrint = (jsonPayload != null && jsonPayload.contains("\"autoPrintOpts\":{"));
        sCurrentTitle = (jobTitle != null && !jobTitle.trim().isEmpty())
                ? jobTitle
                : "☁️ Enviando PDF ao Google Drive...";
        sCurrentDetail = hasAutoPrint
                ? "Transmitindo PDF oficial e acionando fila da Impressora da Base..."
                : "Transmitindo PDF oficial para o Google Drive da Central SAMU...";
        if (sCurrentPercent < 45) sCurrentPercent = 55;
        startOrUpdateService(appCtx);
        refreshProgressNotification(appCtx);

        HTTP_POOL.execute(() -> {
            boolean notifiedDone = false;
            try {
                String responseBody;
                try {
                    responseBody = executeHttpRequest(scriptUrl, "POST", null, jsonPayload);
                } catch (Exception firstErr) {
                    // 1ª tentativa falhou por oscilação rápida de antena: aguarda 1.2s e tenta novamente
                    try { Thread.sleep(1200); } catch (InterruptedException ignored) {}
                    responseBody = executeHttpRequest(scriptUrl, "POST", null, jsonPayload);
                }

                boolean uploadedOk = false;
                boolean printQueued = false;
                try {
                    JSONObject res = new JSONObject(responseBody);
                    if (res.optBoolean("ok", false)) {
                        uploadedOk = true;
                        printQueued = res.optBoolean("printQueued", false);
                        persistUploadedRecordInSqlite(appCtx, recordId, res);
                    }
                } catch (Exception ignoredParse) {}

                MainActivity.deliverHttpResultToActiveWebView(reqId, true, responseBody);

                if (uploadedOk && !MainActivity.isAppInForeground()) {
                    notifiedDone = true;
                    String cleanLabel = (jobTitle != null && !jobTitle.isEmpty()) ? jobTitle : "PDF Oficial SAMU 192";
                    postCompletionNotificationIfBackground(
                        appCtx,
                        printQueued
                            ? "✅ Enviado ao Drive e Impressora da Base!"
                            : "✅ PDF enviado ao Google Drive!",
                        cleanLabel + (printQueued
                            ? " • Arquivado no Google Drive e colocado na fila de impressão da Base."
                            : " • Arquivado com sucesso no Google Drive da Central."),
                        true
                    );
                }
            } catch (Exception e) {
                String errMsg = e.getMessage() != null ? e.getMessage() : e.toString();
                MainActivity.deliverHttpResultToActiveWebView(reqId, false, errMsg);
                if (!notifiedDone && !MainActivity.isAppInForeground()) {
                    postCompletionNotificationIfBackground(
                        appCtx,
                        "⏳ SAMU 192 • Aguardando sinal para reenviar",
                        "Registro salvo com segurança no aparelho. Será reenviado ao Google Drive assim que o sinal estabilizar.",
                        false
                    );
                }
            } finally {
                int remaining = sActiveNativeJobs.decrementAndGet();
                if (remaining < 0) sActiveNativeJobs.set(0);
                if (!hasActiveWork()) {
                    checkAndStopIfIdle(appCtx);
                } else {
                    refreshProgressNotification(appCtx);
                }
            }
        });
    }

    /**
     * Executa a sincronização da base operacional (syncDatabase) protegida pelo ForegroundService,
     * impedindo interrupção caso o usuário saia ou feche o APK no meio da sincronização.
     */
    public static void enqueueNativeDatabaseSync(Context ctx, final String reqId, final String scriptUrl,
                                                 final String jsonPayload, final boolean isPush) {
        final Context appCtx = ctx.getApplicationContext();
        sActiveNativeJobs.incrementAndGet();
        if (!sJsWorkActive) {
            sCurrentTitle = "🔄 SAMU 192 • Sincronizando com a Central";
            sCurrentDetail = "Atualizando base operacional com o Google Drive em segundo plano...";
            sCurrentPercent = -1;
        }
        startOrUpdateService(appCtx);
        refreshProgressNotification(appCtx);

        HTTP_POOL.execute(() -> {
            try {
                String responseBody;
                try {
                    responseBody = executeHttpRequest(scriptUrl, "POST", null, jsonPayload);
                } catch (Exception firstErr) {
                    try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
                    responseBody = executeHttpRequest(scriptUrl, "POST", null, jsonPayload);
                }

                boolean deliveredToWebView = MainActivity.deliverHttpResultToActiveWebView(reqId, true, responseBody);
                if (!deliveredToWebView && isPush) {
                    // Se o APK foi fechado antes do retorno, marca dirty=false no SQLite caso o push tenha sido confirmado
                    try {
                        JSONObject res = new JSONObject(responseBody);
                        if (res.optBoolean("ok", false)) {
                            SamuSqliteDb db = SamuSqliteDb.getInstance(appCtx);
                            String rawMeta = db.getKv("samu_github_meta_v1");
                            JSONObject meta = (rawMeta != null && !rawMeta.isEmpty()) ? new JSONObject(rawMeta) : new JSONObject();
                            meta.put("dirty", false);
                            meta.put("lastSyncAt", nowIsoUtc());
                            db.setKv("samu_github_meta_v1", meta.toString());
                        }
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                String errMsg = e.getMessage() != null ? e.getMessage() : e.toString();
                MainActivity.deliverHttpResultToActiveWebView(reqId, false, errMsg);
            } finally {
                int remaining = sActiveNativeJobs.decrementAndGet();
                if (remaining < 0) sActiveNativeJobs.set(0);
                if (!hasActiveWork()) {
                    checkAndStopIfIdle(appCtx);
                } else {
                    refreshProgressNotification(appCtx);
                }
            }
        });
    }

    private static void persistUploadedRecordInSqlite(Context appCtx, String recordId, JSONObject res) {
        if (recordId == null || recordId.trim().isEmpty() || res == null) return;
        try {
            SamuSqliteDb db = SamuSqliteDb.getInstance(appCtx);
            String existingRaw = db.getRecordJson(recordId);
            if (existingRaw != null && !existingRaw.isEmpty()) {
                JSONObject recObj = new JSONObject(existingRaw);
                String driveUrl = res.optString("driveUrl", recObj.optString("driveUrl", ""));
                String driveFileId = res.optString("driveFileId", recObj.optString("driveFileId", ""));
                String syncedAt = res.optString("syncedAt", "");
                if (syncedAt.isEmpty()) {
                    syncedAt = nowIsoUtc();
                }
                recObj.put("syncStatus", "synced");
                recObj.put("driveUrl", driveUrl);
                recObj.put("driveFileId", driveFileId);
                recObj.put("syncedAt", syncedAt);
                if (res.optBoolean("serverStored", false) || res.optBoolean("storedOnServer", false)) {
                    recObj.put("serverStored", true);
                    recObj.put("storedOnServer", true);
                }
                String srvFolder = res.optString("serverFolder", "");
                if (!srvFolder.isEmpty()) {
                    recObj.put("serverFolder", srvFolder);
                }
                String drvBackupSt = res.optString("driveBackupStatus", "");
                if (!drvBackupSt.isEmpty()) {
                    recObj.put("driveBackupStatus", drvBackupSt);
                }
                recObj.remove("pendingPdfBase64");
                recObj.remove("pendingAutoPrint");
                recObj.remove("lastSyncError");

                db.putRecord(
                    recordId,
                    recObj.optString("type", ""),
                    recObj.optString("createdBy", ""),
                    recObj.optString("createdAt", ""),
                    "synced",
                    recObj.optString("patientName", ""),
                    recObj.optString("patientCpf", ""),
                    recObj.toString()
                );
            }

            if (res.optBoolean("printQueued", false)) {
                JSONObject pJob = res.optJSONObject("printJob");
                if (pJob != null) {
                    String slotKey = pJob.optString("slotKey", "");
                    if (!slotKey.isEmpty()) {
                        String rawAv = db.getKv("samu_viatura_avarias_v1");
                        JSONObject avMap = (rawAv != null && !rawAv.isEmpty()) ? new JSONObject(rawAv) : new JSONObject();
                        avMap.put(slotKey, pJob);
                        db.setKv("samu_viatura_avarias_v1", avMap.toString());
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private static String nowIsoUtc() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    public static String executeHttpRequest(String targetUrl, String initialMethod, String headersJson, String body) throws Exception {
        String currentUrl = targetUrl;
        String method = (initialMethod != null && !initialMethod.isEmpty()) ? initialMethod.toUpperCase(Locale.US) : "GET";
        byte[] payloadBytes = (body != null) ? body.getBytes(StandardCharsets.UTF_8) : new byte[0];

        for (int hop = 0; hop < 6; hop++) {
            URL parsedUrl = new URL(currentUrl);
            String hostLow = (parsedUrl.getHost() != null) ? parsedUrl.getHost().toLowerCase(Locale.US) : "";
            boolean isPrivateLan = hostLow.startsWith("192.168.")
                || hostLow.startsWith("10.")
                || hostLow.startsWith("127.")
                || "localhost".equals(hostLow)
                || hostLow.matches("^172\\.(1[6-9]|2[0-9]|3[0-1])\\..*");
            boolean isFastPing = currentUrl.contains("/api/ping");

            int connectTimeoutMs = isPrivateLan ? (isFastPing ? 1200 : 2200) : (isFastPing ? 2600 : 25000);
            int readTimeoutMs = isPrivateLan ? (isFastPing ? 1800 : 35000) : (isFastPing ? 3500 : 75000);

            HttpURLConnection conn = (HttpURLConnection) parsedUrl.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod(method);
            conn.setRequestProperty("User-Agent", "SAMU192-Orlandia-APK/1.1");
            conn.setRequestProperty("Accept", "application/json, text/plain, */*");

            boolean hasCustomContentType = false;
            if (headersJson != null && !headersJson.trim().isEmpty()) {
                JSONObject hdrs = new JSONObject(headersJson);
                Iterator<String> keys = hdrs.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String v = hdrs.optString(k, "");
                    if ("x-samu-connect-timeout-ms".equalsIgnoreCase(k)) {
                        try { connectTimeoutMs = Math.max(400, Integer.parseInt(v.trim())); } catch (Exception ignored) {}
                        continue;
                    }
                    if ("x-samu-read-timeout-ms".equalsIgnoreCase(k)) {
                        try { readTimeoutMs = Math.max(600, Integer.parseInt(v.trim())); } catch (Exception ignored) {}
                        continue;
                    }
                    if (!v.isEmpty()) {
                        conn.setRequestProperty(k, v);
                        if ("content-type".equalsIgnoreCase(k)) hasCustomContentType = true;
                    }
                }
            }
            conn.setConnectTimeout(connectTimeoutMs);
            conn.setReadTimeout(readTimeoutMs);

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
                currentUrl = new URL(new URL(currentUrl), loc).toString();
                method = "GET"; // Google Apps Script retorna o JSON via GET no Location 302
                continue;
            }
            if (status == 307 || status == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) throw new Exception("Redirecionamento 307 sem destino.");
                currentUrl = new URL(new URL(currentUrl), loc).toString();
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

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = (intent != null) ? intent.getAction() : null;
        if (ACTION_STOP_IF_IDLE.equals(action) && !hasActiveWork()) {
            stopForegroundCompat();
            releaseWakeLockIfIdle();
            stopSelf();
            return START_NOT_STICKY;
        }

        Notification notif = buildProgressNotification(this);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID_PROGRESS, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIF_ID_PROGRESS, notif);
            }
        } catch (Exception ignored) {}

        if (!hasActiveWork()) {
            stopForegroundCompat();
            releaseWakeLockIfIdle();
            stopSelf();
            return START_NOT_STICKY;
        }

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Quando o socorrista fecha/desliza o APK da lista de recentes, NÃO interrompe envios nativos ativos!
        sJsWorkActive = false;
        if (hasActiveWork()) {
            acquireWakeLock(getApplicationContext());
            refreshProgressNotification(getApplicationContext());
        } else {
            stopForegroundCompat();
            releaseWakeLockIfIdle();
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                @SuppressWarnings("deprecation")
                boolean remove = true;
                stopForeground(remove);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        releaseWakeLockIfIdle();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
