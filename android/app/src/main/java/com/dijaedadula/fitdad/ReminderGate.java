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
        long now = System.currentTimeMillis();
        if (oldIds != null) for (int i = 0; i < oldIds.length(); i++) {
            String id = oldIds.getString(i);
            if (next.has(id)) continue;
            int n = Integer.parseInt(id);
            JSONObject o = old.optJSONObject(id);
            // keep one-off reminders (snooze 5000–5999, test 9000–9999, car snooze 21000–21999) that are still ahead
            boolean oneOff = (n >= 5000 && n < 6000) || (n >= 9000 && n < 10000) || (n >= 21000 && n < 22000);
            if (oneOff && o != null && o.optLong("at") > now) { next.put(id, o); continue; }
            cancelAlarm(ctx, n);
        }
        saveItems(ctx, next);
        armAll(ctx, next);
        FitDadWidget.updateAll(ctx);   // widget countdown follows the new plan
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
        FitDadWidget.updateAll(ctx);
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
        boolean main = !it.optBoolean("follow", false) || it.optBoolean("snooze", false);
        // Main reminders (and snoozes) use the alarm-clock path: exact even in deep sleep, never batched
        // or rate-limited by battery saving — so they can't arrive late together with their follow-up.
        if (main && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent show = PendingIntent.getActivity(ctx, 777, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
                return;
            } catch (Exception ignored) { /* fall back below */ }
        }
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

    // ---------- water re-plan after a glass logged outside the app (widget / notification) ----------
    // Same rule as the app: glasses still needed, spaced evenly from your last glass to 1 h before bedtime,
    // never faster than ~0.8 L per hour. So a tap never leaves an old reminder ringing too soon.
    static void replanWater(Context ctx) {
        try {
            JSONObject root = FitDadWidget.load(ctx);
            JSONObject st = root.optJSONObject("settings");
            if (st != null) {
                JSONObject f = st.optJSONObject("features");
                if (f != null && !f.optBoolean("water", true)) return;
                if ("fixed".equals(st.optString("waterMode", "auto"))) return; // fixed interval: keep the grid
            }
            JSONObject r = FitDadWidget.today(root);
            int goal = FitDadWidget.setting(root, "waterGoal", 3000), glass = FitDadWidget.setting(root, "glass", 250);
            int water = r.optInt("water", 0);
            int left = Math.max(0, (int) Math.ceil((goal - water) / (double) glass));
            long now = System.currentTimeMillis();

            // bedtime for today's (4 AM → 4 AM) day
            String key = FitDadWidget.logicalKey();
            String bed = r.optString("bedtime", st != null ? st.optString("bedTime", "23:00") : "23:00");
            int lastBefore = st != null ? st.optInt("lastGlassBefore", 60) : 60;
            java.util.Calendar cal = java.util.Calendar.getInstance();
            String[] ymd = key.split("-"), hm = bed.split(":");
            cal.set(Integer.parseInt(ymd[0]), Integer.parseInt(ymd[1]) - 1, Integer.parseInt(ymd[2]), 0, 0, 0);
            cal.set(java.util.Calendar.MILLISECOND, 0);
            long base = cal.getTimeInMillis();
            cal.set(java.util.Calendar.HOUR_OF_DAY, Integer.parseInt(hm[0])); cal.set(java.util.Calendar.MINUTE, Integer.parseInt(hm[1]));
            long bedAt = cal.getTimeInMillis();
            if (bedAt <= base + 4 * 3600000L) bedAt += 86400000L;
            long end = bedAt - lastBefore * 60000L;

            long lastDrink = lastAnswer(r.optJSONArray("log"), new String[] { "water" });
            long dayStart = r.optLong("dayStart", 0);
            long anchor = Math.max(lastDrink > 0 ? lastDrink : (dayStart > 0 ? dayStart : now), dayStart);
            long minGap = Math.max(20, Math.round(glass / 800.0 * 60)) * 60000L;

            java.util.List<Long> times = new java.util.ArrayList<>();
            if (left > 0 && end > now) {
                double step = Math.max(minGap, (end - anchor) / (double) left);
                if (anchor + step >= now + 60000) {
                    for (int k = 1; k <= left; k++) times.add(Math.round(anchor + k * step));
                } else {
                    long first = now + Math.min(15 * 60000L, Math.max(60000L, (end - now) / left));
                    times.add(first);
                    if (left > 1) { step = Math.max(minGap, (end - first) / (double) (left - 1)); for (int k = 1; k < left; k++) times.add(Math.round(first + k * step)); }
                }
            }
            // swap the planned water reminders (2000–2099) for the new ones
            JSONObject all = loadItems(ctx);
            JSONArray ids = all.names();
            if (ids != null) for (int i = 0; i < ids.length(); i++) {
                int id = Integer.parseInt(ids.getString(i));
                if (id >= 2000 && id < 2100) { all.remove(ids.getString(i)); cancelAlarm(ctx, id); }
            }
            int total = (int) Math.ceil(goal / (double) glass);
            JSONArray add = new JSONArray();
            for (int k = 0; k < times.size() && k < 40; k++) {
                long t = times.get(k);
                if (t > end + 1000) break;
                long gap = k > 0 ? t - times.get(k - 1) : (times.size() > 1 ? times.get(1) - times.get(0) : 3600000L);
                JSONObject it = new JSONObject();
                it.put("id", 2000 + k); it.put("at", t);
                it.put("title", "Drink water 💧 Glass " + (total - left + k + 1) + " of " + total);
                it.put("body", glass + " ml now");
                it.put("channel", "fitdad-water"); it.put("type", "WATER"); it.put("kind", "water");
                it.put("follow", false); it.put("of", 0); it.put("gap", gap);
                add.put(it);
            }
            saveItems(ctx, all);
            addItems(ctx, add);
        } catch (Exception ignored) { }
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
        try { FitDadWidget.updateAll(ctx); } catch (Exception ignored) { } // countdown moves on to the next one
        try {
            JSONObject root = FitDadWidget.load(ctx);
            if (!stillNeeded(ctx, root, it)) return;
            show(ctx, root, it);
            ringThroughSilent(ctx, root, it, goAsync());
            String k = it.optString("kind");
            if (!it.optBoolean("follow", false) && ("stand".equals(k) || "water".equals(k))) markShown(ctx, "water".equals(k) ? "water" : "stand", it.optLong("at"));
        } catch (Exception ignored) { }
    }

    // ---------- Ring even when the phone is on Silent / Vibrate ----------
    // On Silent the notification sound is muted by Android, so we play the same sound on the ALARM stream
    // (which Silent mode doesn't mute, and Do Not Disturb allows by default) and vibrate like an alarm.
    // On normal ring mode the notification's own sound plays, so nothing extra happens.
    static void ringThroughSilent(Context ctx, JSONObject root, JSONObject it, PendingResult pr) {
        boolean done = false;
        try {
            JSONObject st = root.optJSONObject("settings");
            if (st != null && !st.optBoolean("ringOnSilent", true)) return;
            android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            int mode = am.getRingerMode();
            boolean dnd = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                dnd = nm.getCurrentInterruptionFilter() > NotificationManager.INTERRUPTION_FILTER_ALL;
            }
            if (mode == android.media.AudioManager.RINGER_MODE_NORMAL && !dnd) { android.util.Log.i("UpkeepGate", "normal ring mode — notification sound plays"); return; }
            String kind = it.optString("kind");
            int raw = ("water".equals(kind) || "check".equals(kind)) ? R.raw.fitdad_water : R.raw.fitdad_alarm;
            android.media.AudioAttributes attrs = new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            // vibrate (Silent mode turns off notification vibration)
            try {
                android.os.Vibrator v = (android.os.Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
                long[] pattern = { 0, 400, 200, 400, 200, 600 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1), attrs);
                else v.vibrate(pattern, -1);
            } catch (Exception ignored) { }
            final android.media.MediaPlayer mp = new android.media.MediaPlayer();
            mp.setAudioAttributes(attrs);
            mp.setDataSource(ctx, android.net.Uri.parse("android.resource://" + ctx.getPackageName() + "/" + raw));
            mp.setOnCompletionListener(m -> { m.release(); if (pr != null) pr.finish(); });
            mp.setOnErrorListener((m, w, e) -> { m.release(); if (pr != null) pr.finish(); return true; });
            mp.prepare();
            mp.start();
            android.util.Log.i("UpkeepGate", "ringing on alarm stream (ringerMode=" + mode + ", dnd=" + dnd + ") for " + kind);
            done = true;
        } catch (Exception e) { android.util.Log.w("UpkeepGate", "silent-mode ring failed: " + e);
        } finally {
            if (!done && pr != null) pr.finish();
        }
    }

    /** The core rule: look at what you actually did (anywhere) before bothering you. */
    // Remember when a main reminder actually appeared, so a follow-up never shows for one that was skipped
    static void markShown(Context ctx, String kind, long at) {
        ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putLong("shown_" + kind, at).apply();
    }
    static boolean mainShown(Context ctx, String kind, long of, JSONObject it) {
        if (it.optBoolean("snooze", false)) return true;
        long shown = ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE).getLong("shown_" + kind, 0);
        return shown > 0 && Math.abs(shown - of) <= 5 * 60000;
    }

    static boolean stillNeeded(Context ctx, JSONObject root, JSONObject it) throws Exception {
        String kind = it.optString("kind");
        if ("test".equals(kind)) return true;
        // feature switched off in Settings → never ring for it
        JSONObject feats = root.optJSONObject("settings") != null ? root.optJSONObject("settings").optJSONObject("features") : null;
        if (feats != null) {
            if (("water".equals(kind) || "check".equals(kind)) && !feats.optBoolean("water", true)) return false;
            if (("stand".equals(kind) || "nudge".equals(kind)) && !feats.optBoolean("stand", true)) return false;
            if (kind.startsWith("car") && !feats.optBoolean("car", true)) return false;
        }
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
                if (follow) return mainShown(ctx, "stand", of, it) && last < of - 60000; // only after a main that really rang
                if (gap > 0 && last > now - gap / 2) return false;               // stood up recently (app/widget/notification)
                return true;
            }
            case "water": case "check": {
                int goal = FitDadWidget.setting(root, "waterGoal", 3000);
                int water = r.optInt("water", 0);
                if (water >= goal) return false;                                 // goal reached
                if ("check".equals(kind)) return goal - water > goal * 0.4;      // only if really behind
                long last = lastAnswer(log, new String[] { "water", "skip_w", "snooze_w" });
                if (follow) return mainShown(ctx, "water", of, it) && last < of - 60000;
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

    private static PendingIntent inPlaceAction(Context ctx, JSONObject it, String actionId, int req) {
        Intent i = new Intent(ctx, NotifActionReceiver.class)
                .setAction(NotifActionReceiver.ACTION + "." + it.optInt("id") + "." + actionId)
                .putExtra("id", it.optInt("id"))
                .putExtra("action", actionId)
                .putExtra("kind", it.optString("kind"));
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

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
        for (int k = 0; k < actions.length; k++) {
            String act = actions[k][0];
            // wellness buttons are saved in place (app stays closed); car "log it" / "update km" need the app's form
            boolean inPlace = NotifActionReceiver.handlesInPlace(act) && !it.optString("kind").startsWith("car");
            b.addAction(0, actions[k][1], inPlace ? inPlaceAction(ctx, it, act, id * 10 + k + 1) : openWith(ctx, it, act, id * 10 + k + 1));
        }

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
