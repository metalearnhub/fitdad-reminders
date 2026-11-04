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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Widget refresh + backup file download/upload through Android's system file picker. */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

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
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "application/octet-stream" });
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
                if (buf.size() > 10 * 1024 * 1024) throw new Exception("File too large");
            }
            ret.put("data", buf.toString("UTF-8"));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read file: " + e.getMessage());
        }
    }
}
