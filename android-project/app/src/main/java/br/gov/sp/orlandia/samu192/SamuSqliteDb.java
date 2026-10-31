package br.gov.sp.orlandia.samu192;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/**
 * Banco de Dados Nativo Android SQLite (samu_orlandia_192.db).
 * Garante persistência offline blindada no sistema de arquivos interno do APK
 * (usuários, aprovações, COREN, recebedores do hospital, CPFs, rascunhos e fichas),
 * imune à limpeza de cache e sincronizado com o GitHub/Google Drive quando online.
 */
public class SamuSqliteDb extends SQLiteOpenHelper {

    private static final String DB_NAME = "samu_orlandia_192.db";
    private static final int DB_VERSION = 1;

    public SamuSqliteDb(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        try {
            db.enableWriteAheadLogging();
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS kv_store (" +
            "  k TEXT PRIMARY KEY," +
            "  v TEXT NOT NULL," +
            "  updated_at INTEGER" +
            ")"
        );

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS records (" +
            "  id TEXT PRIMARY KEY," +
            "  rec_type TEXT," +
            "  created_by TEXT," +
            "  created_at TEXT," +
            "  sync_status TEXT," +
            "  patient_name TEXT," +
            "  patient_cpf TEXT," +
            "  json_payload TEXT NOT NULL" +
            ")"
        );
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_records_created_by ON records(created_by)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_records_sync_status ON records(sync_status)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at)");

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS drafts (" +
            "  draft_key TEXT PRIMARY KEY," +
            "  username TEXT," +
            "  draft_type TEXT," +
            "  updated_at TEXT," +
            "  json_payload TEXT NOT NULL" +
            ")"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        onCreate(db);
    }

    /* ===================== TABELA CHAVE-VALOR (USUÁRIOS, RECEBEDORES, CPFs, CONFIG) ===================== */

    public synchronized String getKv(String key) {
        if (key == null) return null;
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.query("kv_store", new String[]{"v"}, "k = ?", new String[]{key}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return c.getString(0);
            }
        } catch (Exception ignored) {}
        return null;
    }

    public synchronized void setKv(String key, String value) {
        if (key == null) return;
        if (value == null) {
            removeKv(key);
            return;
        }
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("k", key);
        cv.put("v", value);
        cv.put("updated_at", System.currentTimeMillis());
        db.insertWithOnConflict("kv_store", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public synchronized void removeKv(String key) {
        if (key == null) return;
        SQLiteDatabase db = getWritableDatabase();
        db.delete("kv_store", "k = ?", new String[]{key});
    }

    /* ===================== TABELA DE FICHAS E CHECK LISTS ===================== */

    public synchronized void putRecord(String id, String recType, String createdBy, String createdAt,
                                       String syncStatus, String patientName, String patientCpf,
                                       String jsonPayload) {
        if (id == null || jsonPayload == null) return;
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("id", id);
        cv.put("rec_type", recType != null ? recType : "");
        cv.put("created_by", createdBy != null ? createdBy : "");
        cv.put("created_at", createdAt != null ? createdAt : "");
        cv.put("sync_status", syncStatus != null ? syncStatus : "");
        cv.put("patient_name", patientName != null ? patientName : "");
        cv.put("patient_cpf", patientCpf != null ? patientCpf : "");
        cv.put("json_payload", jsonPayload);
        db.insertWithOnConflict("records", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public synchronized String getRecordJson(String id) {
        if (id == null) return null;
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.query("records", new String[]{"json_payload"}, "id = ?", new String[]{id}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return c.getString(0);
            }
        } catch (Exception ignored) {}
        return null;
    }

    public synchronized void deleteRecord(String id) {
        if (id == null) return;
        SQLiteDatabase db = getWritableDatabase();
        db.delete("records", "id = ?", new String[]{id});
    }

    public synchronized String getAllRecordsJsonArray() {
        SQLiteDatabase db = getReadableDatabase();
        java.util.ArrayList<String> ids = new java.util.ArrayList<>();
        try (Cursor c = db.query("records", new String[]{"id"}, null, null, null, null, "created_at DESC")) {
            if (c != null) {
                while (c.moveToNext()) {
                    String id = c.getString(0);
                    if (id != null && !id.isEmpty()) {
                        ids.add(id);
                    }
                }
            }
        } catch (Exception ignored) {}

        StringBuilder sb = new StringBuilder();
        sb.append('[');
        boolean first = true;
        for (int i = 0; i < ids.size(); i++) {
            try {
                String payload = getRecordJson(ids.get(i));
                if (payload != null && !payload.isEmpty()) {
                    if (!first) sb.append(',');
                    sb.append(payload);
                    first = false;
                }
            } catch (Exception ignored) {}
        }
        sb.append(']');
        return sb.toString();
    }

    /* ===================== TABELA DE RASCUNHOS EM ANDAMENTO ===================== */

    public synchronized void putDraft(String draftKey, String username, String draftType,
                                      String updatedAt, String jsonPayload) {
        if (draftKey == null || jsonPayload == null) return;
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("draft_key", draftKey);
        cv.put("username", username != null ? username : "");
        cv.put("draft_type", draftType != null ? draftType : "");
        cv.put("updated_at", updatedAt != null ? updatedAt : "");
        cv.put("json_payload", jsonPayload);
        db.insertWithOnConflict("drafts", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public synchronized String getDraftJson(String draftKey) {
        if (draftKey == null) return null;
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.query("drafts", new String[]{"json_payload"}, "draft_key = ?", new String[]{draftKey}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return c.getString(0);
            }
        } catch (Exception ignored) {}
        return null;
    }

    public synchronized void deleteDraft(String draftKey) {
        if (draftKey == null) return;
        SQLiteDatabase db = getWritableDatabase();
        db.delete("drafts", "draft_key = ?", new String[]{draftKey});
    }
}
