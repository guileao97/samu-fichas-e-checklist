package br.gov.sp.orlandia.samu192;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * ContentProvider leve (zero dependências externas) para compartilhar os PDFs
 * gerados offline no celular diretamente com WhatsApp, Gmail, Drive ou Arquivos.
 */
public class PdfShareProvider extends ContentProvider {

    public static final String AUTHORITY = "br.gov.sp.orlandia.samu192.pdfprovider";

    @Override
    public boolean onCreate() {
        return true;
    }

    private File resolveFile(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("..") || name.contains("/")) {
            return null;
        }
        File dir = new File(getContext().getCacheDir(), "shared_pdfs");
        return new File(dir, name);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file = resolveFile(uri);
        if (file == null || !file.exists()) return null;

        String[] cols = (projection != null) ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) {
                row[i] = file.getName();
            } else if (OpenableColumns.SIZE.equals(cols[i])) {
                row[i] = file.length();
            } else {
                row[i] = null;
            }
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        String seg = (uri != null && uri.getLastPathSegment() != null)
                ? uri.getLastPathSegment().toLowerCase()
                : "";
        if (seg.endsWith(".apk")) {
            return "application/vnd.android.package-archive";
        }
        if (seg.endsWith(".jpg") || seg.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (seg.endsWith(".png")) {
            return "image/png";
        }
        return "application/pdf";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = resolveFile(uri);
        if (file == null || !file.exists()) {
            throw new FileNotFoundException("PDF não encontrado.");
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
