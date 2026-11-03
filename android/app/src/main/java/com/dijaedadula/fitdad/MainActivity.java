package com.dijaedadula.fitdad;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
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
            } else if ("endwork".equals(action)) {
                FitDadWidget.endWork(this, "notif");
            } else {
                return;
            }
            i.putExtra(EXTRA_HANDLED, true);
            FitDadWidget.updateAll(this);
        } catch (Exception ignored) { }
    }
}
