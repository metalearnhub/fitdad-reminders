package com.dijaedadula.fitdad;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
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
            } else if ("drank".equals(action) && ("water".equals(kind) || "check".equals(kind))) {
                FitDadWidget.log(this, true, "notif");
            }
            // Queue every action for the web app (it drains this on start/resume), so nothing is lost on a cold start
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
}
