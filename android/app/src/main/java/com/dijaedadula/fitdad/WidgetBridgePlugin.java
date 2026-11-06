package com.dijaedadula.fitdad;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.ContentValues;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Widget refresh + backup file download/upload through Android's system file picker. */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    private static WidgetBridgePlugin instance;

    @Override
    public void load() { instance = this; }

    /** Tell the app (if it's running) that data changed outside it — notification button or widget. */
    static void emitChanged() {
        try { if (instance != null) instance.notifyListeners("dataChanged", new JSObject(), true); } catch (Exception ignored) { }
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        FitDadWidget.updateAll(getContext());
        call.resolve(new JSObject());
    }

    /** Replace the planned wellness reminders (checked against your latest actions when they fire). */
    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            ReminderGate.replaceAll(getContext(), call.getArray("items", new com.getcapacitor.JSArray()));
            call.resolve(new JSObject());
        } catch (Exception e) { call.reject("schedule failed: " + e.getMessage()); }
    }

    /** Add one-off reminders (snooze, test) without touching the plan. */
    @PluginMethod
    public void scheduleExtra(PluginCall call) {
        try {
            ReminderGate.addItems(getContext(), call.getArray("items", new com.getcapacitor.JSArray()));
            call.resolve(new JSObject());
        } catch (Exception e) { call.reject("schedule failed: " + e.getMessage()); }
    }

    @PluginMethod
    public void clearDelivered(PluginCall call) {
        ReminderGate.clearDelivered(getContext(), call.getString("kind", ""));
        call.resolve(new JSObject());
    }

    // ---------- Car receipts: stored as files inside the app ----------

    private File receiptFile(String id) {
        File d = new File(getContext().getFilesDir(), "receipts");
        if (!d.exists()) d.mkdirs();
        return new File(d, id);
    }

    /** Save a receipt (base64 data URL) under an id like "r_abc123.jpg". */
    @PluginMethod
    public void receiptSave(PluginCall call) {
        String id = call.getString("id"), data = call.getString("data");
        if (id == null || data == null || id.contains("/")) { call.reject("bad id/data"); return; }
        try {
            String b64 = data.contains(",") ? data.substring(data.indexOf(',') + 1) : data;
            byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(receiptFile(id))) { out.write(bytes); }
            call.resolve(new JSObject());
        } catch (Exception e) { call.reject("Could not save receipt: " + e.getMessage()); }
    }

    @PluginMethod
    public void receiptRead(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.contains("/")) { call.reject("bad id"); return; }
        File f = receiptFile(id);
        if (!f.exists()) { call.reject("missing"); return; }
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            String mime = id.endsWith(".pdf") ? "application/pdf" : id.endsWith(".png") ? "image/png" : "image/jpeg";
            JSObject ret = new JSObject();
            ret.put("data", "data:" + mime + ";base64," + android.util.Base64.encodeToString(buf.toByteArray(), android.util.Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) { call.reject("Could not read receipt: " + e.getMessage()); }
    }

    @PluginMethod
    public void receiptDelete(PluginCall call) {
        String id = call.getString("id");
        if (id != null && !id.contains("/")) receiptFile(id).delete();
        call.resolve(new JSObject());
    }

    /** Open a receipt (e.g. a PDF) in the phone's viewer. */
    @PluginMethod
    public void receiptOpen(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.contains("/") || !receiptFile(id).exists()) { call.reject("missing"); return; }
        try {
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", receiptFile(id));
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, id.endsWith(".pdf") ? "application/pdf" : "image/*");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(new JSObject());
        } catch (Exception e) { call.reject("No app can open this file: " + e.getMessage()); }
    }

    // ---------- Restore points: kept inside the app AND copied to Downloads/Upkeep ----------

    private File backupDir() {
        File d = new File(getContext().getFilesDir(), "backups");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Save a restore point. Always stored in the app; with downloads=true also copied to Download/Upkeep/. */
    @PluginMethod
    public void backupSave(PluginCall call) {
        String name = call.getString("name"), data = call.getString("data"), b64 = call.getString("b64");
        if (name == null || (data == null && b64 == null) || name.contains("/")) { call.reject("bad name/data"); return; }
        byte[] bytes = b64 != null ? android.util.Base64.decode(b64, android.util.Base64.DEFAULT) : data.getBytes(StandardCharsets.UTF_8);
        JSObject ret = new JSObject();
        try {
            try (FileOutputStream out = new FileOutputStream(new File(backupDir(), name))) { out.write(bytes); }
            // keep the 30 newest restore points inside the app
            File[] all = backupDir().listFiles();
            if (all != null && all.length > 20) {
                Arrays.sort(all, (x, y) -> Long.compare(y.lastModified(), x.lastModified()));
                for (int i = 20; i < all.length; i++) all[i].delete();
            }
            ret.put("saved", true);
        } catch (Exception e) { call.reject("Could not save restore point: " + e.getMessage()); return; }
        if (Boolean.TRUE.equals(call.getBoolean("downloads", false))) {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, name.endsWith(".zip") ? "application/zip" : "application/json");
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Upkeep");
                    Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) { out.write(bytes); }
                    ret.put("downloads", "Download/Upkeep/" + name);
                } else {
                    File d = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Upkeep");
                    d.mkdirs();
                    try (FileOutputStream out = new FileOutputStream(new File(d, name))) { out.write(bytes); }
                    ret.put("downloads", d.getAbsolutePath() + "/" + name);
                }
            } catch (Exception e) { ret.put("downloadsError", e.getMessage()); }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void backupList(PluginCall call) {
        JSArray arr = new JSArray();
        File[] all = backupDir().listFiles();
        if (all != null) {
            Arrays.sort(all, (x, y) -> Long.compare(y.lastModified(), x.lastModified()));
            for (File f : all) {
                JSObject o = new JSObject();
                o.put("name", f.getName()); o.put("size", f.length()); o.put("mtime", f.lastModified());
                arr.put(o);
            }
        }
        JSObject ret = new JSObject(); ret.put("items", arr); call.resolve(ret);
    }

    @PluginMethod
    public void backupRead(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.contains("/")) { call.reject("bad name"); return; }
        try (FileInputStream in = new FileInputStream(new File(backupDir(), name))) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            JSObject ret = new JSObject();
            if (name.endsWith(".zip")) ret.put("b64", android.util.Base64.encodeToString(buf.toByteArray(), android.util.Base64.NO_WRAP));
            else ret.put("data", buf.toString("UTF-8"));
            call.resolve(ret);
        } catch (Exception e) { call.reject("Could not read: " + e.getMessage()); }
    }

    /** Opens "Save as…" (Downloads, Drive, etc.) and writes the backup JSON there. */
    @PluginMethod
    public void exportBackup(PluginCall call) {
        if (call.getString("data") == null) { call.reject("No data"); return; }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "fitdad-backup.json"));
        startActivityForResult(call, i, "onExport");
    }

    @ActivityCallback
    private void onExport(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            ret.put("saved", false); call.resolve(ret); return;
        }
        Uri uri = result.getData().getData();
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            out.write(call.getString("data").getBytes(StandardCharsets.UTF_8));
            ret.put("saved", true);
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save backup: " + e.getMessage());
        }
    }

    /** Opens the file picker and returns the chosen backup file's text. */
    @PluginMethod
    public void importBackup(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/zip", "application/x-zip-compressed", "application/json", "text/plain", "application/octet-stream" });
        startActivityForResult(call, i, "onImport");
    }

    @ActivityCallback
    private void onImport(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            ret.put("cancelled", true); call.resolve(ret); return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(result.getData().getData())) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) {
                buf.write(b, 0, n);
                if (buf.size() > 80 * 1024 * 1024) throw new Exception("File too large");
            }
            ret.put("b64", android.util.Base64.encodeToString(buf.toByteArray(), android.util.Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read file: " + e.getMessage());
        }
    }
}
