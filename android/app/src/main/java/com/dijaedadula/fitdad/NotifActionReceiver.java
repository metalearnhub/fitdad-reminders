package com.dijaedadula.fitdad;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Notification buttons handled in place — the app does NOT open.
 * The tap is saved immediately, the notification closes, the widget refreshes (showing "x min ago"),
 * and the app — if it's open in the background — reloads right away.
 */
public class NotifActionReceiver extends BroadcastReceiver {

    static final String ACTION = "com.dijaedadula.fitdad.NOTIF_ACTION";

    /** Buttons that can be completed without opening the app. */
    static boolean handlesInPlace(String actionId) {
        switch (actionId) {
            case "done": case "drank": case "snooze": case "endwork": case "pause": case "dayoff": case "later": return true;
            default: return false;
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        int id = intent.getIntExtra("id", -1);
        String action = intent.getStringExtra("action");
        String kind = intent.getStringExtra("kind");
        if (action == null || kind == null) return;
        String msg = null;
        try {
            switch (action) {
                case "done":
                    if ("stand".equals(kind)) { FitDadWidget.log(ctx, false, "notif"); ReminderGate.clearDelivered(ctx, "stand"); msg = "🧍 Stand-up logged"; }
                    break;
                case "drank":
                    FitDadWidget.log(ctx, true, "notif"); ReminderGate.clearDelivered(ctx, "water");
                    msg = "💧 Glass logged";
                    break;
                case "endwork":
                    FitDadWidget.endWork(ctx, "notif"); ReminderGate.clearDelivered(ctx, "stand");
                    msg = "✅ Done working — stand-ups off";
                    break;
                case "pause":
                    FitDadWidget.pauseWork(ctx, "notif"); ReminderGate.clearDelivered(ctx, "stand");
                    msg = "⏸ Paused — stand-ups on hold. Tap Start when you're back";
                    break;
                case "snooze":
                    msg = snooze(ctx, kind);
                    break;
                case "dayoff":
                    dayOff(ctx); ReminderGate.clearDelivered(ctx, "nudge");
                    msg = "Day off — no stand-up reminders today";
                    break;
                case "later":
                    msg = "OK — I'll ask again later";
                    break;
            }
        } catch (Exception ignored) { }
        if (id >= 0) ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id);
        FitDadWidget.updateAll(ctx);
        WidgetBridgePlugin.emitChanged();
        if (msg != null) Toast.makeText(ctx.getApplicationContext(), msg, Toast.LENGTH_SHORT).show();
    }

    private static String snooze(Context ctx, String kind) throws Exception {
        boolean stand = "stand".equals(kind);
        JSONObject root = FitDadWidget.load(ctx);
        JSONObject r = FitDadWidget.today(root);
        long now = System.currentTimeMillis();
        JSONObject ev = new JSONObject(); ev.put("t", now); ev.put("k", stand ? "snooze_s" : "snooze_w"); ev.put("src", "notif");
        r.getJSONArray("log").put(ev);
        FitDadWidget.save(ctx, root);
        int glass = FitDadWidget.setting(root, "glass", 250);
        int mins = stand ? 5 : 10;
        JSONObject it = new JSONObject();
        it.put("id", (stand ? 5000 : 5500) + (int) (Math.random() * 400));
        it.put("at", now + mins * 60000L);
        it.put("title", stand ? "Stand up now 🧍" : "Drink water 💧");
        it.put("body", stand ? "Snooze is over. Get up and move for 2 minutes." : "Have a " + glass + " ml glass.");
        it.put("channel", stand ? "fitdad-alarm" : "fitdad-water");
        it.put("type", stand ? "STAND" : "WATER");
        it.put("kind", kind);
        it.put("follow", true);
        it.put("snooze", true);
        it.put("of", now + 90000);   // stays quiet if you answer anywhere before it rings
        JSONArray a = new JSONArray(); a.put(it);
        ReminderGate.addItems(ctx, a);
        return "Snoozed " + mins + " min";
    }

    private static void dayOff(Context ctx) throws Exception {
        JSONObject root = FitDadWidget.load(ctx);
        JSONObject r = FitDadWidget.today(root);
        long now = System.currentTimeMillis();
        r.put("status", "off");
        if (!r.has("dayStart") || r.isNull("dayStart")) r.put("dayStart", now);
        JSONObject ev = new JSONObject(); ev.put("t", now); ev.put("k", "dayoff"); ev.put("src", "notif");
        r.getJSONArray("log").put(ev);
        FitDadWidget.save(ctx, root);
    }
}
