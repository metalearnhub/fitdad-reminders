package com.dijaedadula.fitdad;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import android.app.NotificationManager;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    // Extras the local-notifications plugin puts on notification action intents
    static final String EXTRA_ACTION = "LocalNotificationUserAction";
    static final String EXTRA_OBJ = "LocalNotficationObject";
    static final String EXTRA_HANDLED = "fitdadHandled";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        if (savedInstanceState == null) recordNotificationAction(getIntent());
        super.onCreate(savedInstanceState);
        cancelLegacyAlarms();
        ReminderGate.safeChannel(this, "fitdad-alarm");   // make sure the reminder channels (with their vibration patterns) exist
    }

    @Override
    protected void onNewIntent(Intent intent) {
        recordNotificationAction(intent);
        super.onNewIntent(intent);
    }

    /**
     * "Done ✓" / "Drank a glass" tapped on a notification: save it natively right away, so it is
     * recorded even if the app was closed and the web layer misses the event. The web app reloads on
     * resume, re-plans reminders and cancels follow-ups.
     */
    private void recordNotificationAction(Intent i) {
        try {
            if (i == null || i.getBooleanExtra(EXTRA_HANDLED, false)) return;
            String action = i.getStringExtra(EXTRA_ACTION);
            String obj = i.getStringExtra(EXTRA_OBJ);
            if (action == null || obj == null) return;
            JSONObject extra = new JSONObject(obj).optJSONObject("extra");
            String kind = extra != null ? extra.optString("kind") : "";
            if ("done".equals(action) && "stand".equals(kind)) {
                FitDadWidget.log(this, false, "notif");
                ReminderGate.clearDelivered(this, "stand");
            } else if ("drank".equals(action) && ("water".equals(kind) || "check".equals(kind))) {
                FitDadWidget.log(this, true, "notif");
                ReminderGate.clearDelivered(this, "water");
            } else if ("endwork".equals(action)) {
                FitDadWidget.endWork(this, "notif");
                ReminderGate.clearDelivered(this, "stand");
            }
            int nid = i.getIntExtra("LocalNotificationId", -1);
            if (nid >= 0) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(nid);
            // Queue every action for the web app (drained on start/resume), so nothing is lost on a cold start
            SharedPreferences sp = getSharedPreferences(FitDadWidget.PREFS, MODE_PRIVATE);
            JSONArray q;
            try { q = new JSONArray(sp.getString("upkeep_actions", "[]")); } catch (Exception e) { q = new JSONArray(); }
            JSONObject entry = new JSONObject();
            entry.put("action", action);
            entry.put("obj", obj);
            entry.put("t", System.currentTimeMillis());
            q.put(entry);
            sp.edit().putString("upkeep_actions", q.toString()).apply();
            i.putExtra(EXTRA_HANDLED, true);
            FitDadWidget.updateAll(this);
        } catch (Exception ignored) { }
    }

    /**
     * Older builds scheduled reminders through the notification library, which rings without checking
     * whether you're paused, off for the day, or already did it ("zombie" alerts). Cancel any of those once.
     */
    private void cancelLegacyAlarms() {
        SharedPreferences flags = getSharedPreferences("upkeep_sched", MODE_PRIVATE);
        if (flags.getBoolean("legacy_cleared_v2", false)) return;
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(ALARM_SERVICE);
            int f = android.app.PendingIntent.FLAG_NO_CREATE | (android.os.Build.VERSION.SDK_INT >= 31 ? android.app.PendingIntent.FLAG_MUTABLE : 0);
            Intent pub = new Intent().setComponent(new android.content.ComponentName(getPackageName(),
                    "com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher"));
            java.util.Set<Integer> ids = new java.util.HashSet<>();
            SharedPreferences store = getSharedPreferences("NOTIFICATION_STORE", MODE_PRIVATE);
            for (String k : store.getAll().keySet()) { try { ids.add(Integer.parseInt(k)); } catch (Exception ignored) { } }
            int[][] ranges = { { 1000, 1200 }, { 2000, 2200 }, { 3000, 3100 }, { 4000, 4100 }, { 5000, 6000 }, { 9000, 9100 }, { 10000, 10700 }, { 20000, 22000 } };
            for (int[] r : ranges) for (int id = r[0]; id < r[1]; id++) ids.add(id);
            int n = 0;
            for (int id : ids) {
                android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(this, id, pub, f);
                if (pi != null) { am.cancel(pi); pi.cancel(); n++; }
            }
            store.edit().clear().apply();
            android.util.Log.i("UpkeepGate", "cancelled " + n + " legacy library alarms");
        } catch (Exception e) { android.util.Log.w("UpkeepGate", "legacy cleanup failed: " + e); }
        flags.edit().putBoolean("legacy_cleared_v2", true).apply();
    }
}
