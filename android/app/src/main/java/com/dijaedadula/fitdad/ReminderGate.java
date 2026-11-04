package com.dijaedadula.fitdad;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Upkeep's own reminder scheduler.
 *
 * The app hands over the planned reminders (stand-up, water, nudges, follow-ups). Each one is an exact
 * alarm. When an alarm fires, BEFORE showing anything, this receiver re-reads your latest data — taps in
 * the app, the widget or a notification, "Done working", glasses drunk — and stays silent if the reminder
 * is no longer needed. So nothing depends on the app having been opened since your last action.
 */
public class ReminderGate extends BroadcastReceiver {

    static final String STORE = "upkeep_sched";      // SharedPreferences file
    static final String KEY_ITEMS = "items";           // JSON object: id -> item
    static final String ACTION_FIRE = "com.dijaedadula.fitdad.REMINDER_FIRE";

    // ---------- scheduling (called from WidgetBridgePlugin) ----------

    /** Replace the whole plan: cancel what is no longer planned, arm the rest. */
    static void replaceAll(Context ctx, JSONArray items) throws Exception {
        JSONObject old = loadItems(ctx);
        JSONObject next = new JSONObject();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            next.put(String.valueOf(it.getInt("id")), it);
        }
        JSONArray oldIds = old.names();
        if (oldIds != null) for (int i = 0; i < oldIds.length(); i++) {
            String id = oldIds.getString(i);
            if (!next.has(id)) cancelAlarm(ctx, Integer.parseInt(id));
        }
        saveItems(ctx, next);
        armAll(ctx, next);
    }

    /** Add (or replace) a few one-off reminders, e.g. a snooze or a test. */
    static void addItems(Context ctx, JSONArray items) throws Exception {
        JSONObject all = loadItems(ctx);
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            all.put(String.valueOf(it.getInt("id")), it);
            arm(ctx, it);
        }
        saveItems(ctx, all);
    }

    /** Re-arm everything still in the future (after reboot / app update). */
    static void rearm(Context ctx) {
        try { armAll(ctx, loadItems(ctx)); } catch (Exception ignored) { }
    }

    private static void armAll(Context ctx, JSONObject all) throws Exception {
        JSONArray ids = all.names();
        if (ids == null) return;
        long now = System.currentTimeMillis();
        for (int i = 0; i < ids.length(); i++) {
            JSONObject it = all.getJSONObject(ids.getString(i));
            if (it.optLong("at") > now - 60000) arm(ctx, it);
        }
    }

    private static PendingIntent firePI(Context ctx, int id, int flags) {
        Intent i = new Intent(ctx, ReminderGate.class).setAction(ACTION_FIRE + "." + id).putExtra("id", id);
        return PendingIntent.getBroadcast(ctx, id, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void arm(Context ctx, JSONObject it) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        long at = Math.max(it.optLong("at"), System.currentTimeMillis() + 1000);
        PendingIntent pi = firePI(ctx, it.optInt("id"), PendingIntent.FLAG_UPDATE_CURRENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    private static void cancelAlarm(Context ctx, int id) {
        PendingIntent pi = firePI(ctx, id, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            ((AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE)).cancel(pi);
            pi.cancel();
        }
    }

    static JSONObject loadItems(Context ctx) {
        try {
            return new JSONObject(ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString(KEY_ITEMS, "{}"));
        } catch (Exception e) { return new JSONObject(); }
    }

    static void saveItems(Context ctx, JSONObject all) {
        ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putString(KEY_ITEMS, all.toString()).apply();
    }

    // ---------- firing ----------

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (a == null) return;
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                || "android.intent.action.QUICKBOOT_POWERON".equals(a)) {
            rearm(ctx);
            return;
        }
        if (!a.startsWith(ACTION_FIRE)) return;
        int id = intent.getIntExtra("id", -1);
        JSONObject all = loadItems(ctx);
        JSONObject it = all.optJSONObject(String.valueOf(id));
        if (it == null) return;              // no longer planned → silent
        all.remove(String.valueOf(id));
        saveItems(ctx, all);
        try {
            JSONObject root = FitDadWidget.load(ctx);
            if (!stillNeeded(root, it)) return;
            show(ctx, root, it);
        } catch (Exception ignored) { }
    }

    /** The core rule: look at what you actually did (anywhere) before bothering you. */
    static boolean stillNeeded(JSONObject root, JSONObject it) throws Exception {
        String kind = it.optString("kind");
        if ("test".equals(kind)) return true;
        JSONObject r = FitDadWidget.today(root);
        String status = r.optString("status", "idle");
        JSONArray log = r.optJSONArray("log");
        long now = System.currentTimeMillis();
        boolean follow = it.optBoolean("follow", false);
        long of = it.optLong("of", 0);
        long gap = it.optLong("gap", 0);

        switch (kind) {
            case "stand": {
                if (!"active".equals(status)) return false;                      // paused, done working, day off
                long last = lastAnswer(log, new String[] { "stand", "skip_s", "snooze_s", "endwork" });
                if (follow) return last < of - 60000;                            // answered since it rang? stay quiet
                if (gap > 0 && last > now - gap / 2) return false;               // stood up recently (app/widget/notification)
                return true;
            }
            case "water": case "check": {
                int goal = FitDadWidget.setting(root, "waterGoal", 3000);
                int water = r.optInt("water", 0);
                if (water >= goal) return false;                                 // goal reached
                if ("check".equals(kind)) return goal - water > goal * 0.4;      // only if really behind
                long last = lastAnswer(log, new String[] { "water", "skip_w", "snooze_w" });
                if (follow) return last < of - 60000;
                if (gap > 0 && last > now - gap / 2) return false;               // drank recently
                return true;
            }
            case "nudge": {
                // only if you haven't started, taken a day off, or logged anything today
                return "idle".equals(status) && (!r.has("dayStart") || r.isNull("dayStart"));
            }
            default:
                return true;
        }
    }

    static long lastAnswer(JSONArray log, String[] kinds) {
        long last = 0;
        if (log == null) return 0;
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e == null) continue;
            String k = e.optString("k");
            for (String want : kinds) if (want.equals(k)) { last = Math.max(last, e.optLong("t")); break; }
        }
        return last;
    }

    // ---------- showing ----------

    private static PendingIntent openWith(Context ctx, JSONObject it, String actionId, int req) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("upkeep." + it.optInt("id") + "." + actionId);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("LocalNotificationId", it.optInt("id"));
        i.putExtra(MainActivity.EXTRA_ACTION, actionId);
        try {
            JSONObject obj = new JSONObject();
            obj.put("id", it.optInt("id"));
            obj.put("title", it.optString("title"));
            obj.put("body", it.optString("body"));
            JSONObject extra = it.optJSONObject("extra") != null ? new JSONObject(it.optJSONObject("extra").toString()) : new JSONObject();
            extra.put("kind", it.optString("kind"));
            extra.put("follow", it.optBoolean("follow", false));
            extra.put("of", it.optLong("of", 0));
            obj.put("extra", extra);
            i.putExtra(MainActivity.EXTRA_OBJ, obj.toString());
        } catch (Exception ignored) { }
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void show(Context ctx, JSONObject root, JSONObject it) throws Exception {
        int id = it.getInt("id");
        String kind = it.optString("kind");
        String title = it.optString("title");
        String body = it.optString("body");

        // water text is rebuilt from the real count, so widget/app glasses are reflected
        if ("water".equals(kind) && !it.optBoolean("follow", false)) {
            JSONObject r = FitDadWidget.today(root);
            int goal = FitDadWidget.setting(root, "waterGoal", 3000), glass = FitDadWidget.setting(root, "glass", 250);
            int water = r.optInt("water", 0);
            int total = (int) Math.ceil(goal / (double) glass);
            int left = Math.max(1, (int) Math.ceil((goal - water) / (double) glass));
            title = "Drink water 💧 Glass " + (total - left + 1) + " of " + total;
            body = glass + " ml now · " + String.format(Locale.US, "%.2f", (goal - water) / 1000.0) + " L left to reach "
                    + String.format(Locale.US, "%.2f", goal / 1000.0) + " L";
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, it.optString("channel", "fitdad-alarm"))
                .setSmallIcon(R.drawable.ic_stat_fitdad)
                .setColor(Color.parseColor("#F59E0B"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(openWith(ctx, it, "tap", id * 10));

        String type = it.optString("type");
        String[][] actions;
        switch (type) {
            case "STAND": actions = new String[][] { { "done", "Done ✓" }, { "snooze", "Snooze 5 min" }, { "endwork", "Done working" } }; break;
            case "WATER": actions = new String[][] { { "drank", "Drank a glass" }, { "snooze", "Snooze 10 min" } }; break;
            case "NUDGE": actions = new String[][] { { "start", "Start now" }, { "later", "Later" }, { "dayoff", "Day off" } }; break;
            case "CAR": actions = new String[][] { { "done", "Done — log it" }, { "snooze", "Remind tomorrow" } }; break;
            case "CARODO": actions = new String[][] { { "update", "Update km" } }; break;
            default: actions = new String[0][];
        }
        for (int k = 0; k < actions.length; k++) b.addAction(0, actions[k][1], openWith(ctx, it, actions[k][0], id * 10 + k + 1));

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        // one stand-up and one water notification at a time: a newer one replaces an older one in the shade
        clearSameKind(nm, kind, id);
        nm.notify(id, b.build());
    }

    private static void clearSameKind(NotificationManager nm, String kind, int keep) {
        int[][] ranges;
        if ("stand".equals(kind)) ranges = new int[][] { { 1000, 1100 }, { 5000, 5500 }, { 10000, 10300 } };
        else if ("water".equals(kind) || "check".equals(kind)) ranges = new int[][] { { 2000, 2100 }, { 4000, 4001 }, { 5500, 6000 }, { 10300, 10600 } };
        else if ("nudge".equals(kind)) ranges = new int[][] { { 3000, 3100 } };
        else return;
        for (int[] rg : ranges) for (int id = rg[0]; id < rg[1]; id++) if (id != keep) nm.cancel(id);
    }

    /** Clear stand-up or water notifications already in the shade (after you answered somewhere). */
    static void clearDelivered(Context ctx, String kind) {
        clearSameKind((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE), kind, -1);
    }
}
