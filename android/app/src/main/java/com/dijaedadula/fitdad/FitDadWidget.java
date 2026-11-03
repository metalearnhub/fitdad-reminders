package com.dijaedadula.fitdad;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.Build;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/**
 * Home-screen widget: today's water + stand-ups, one-tap logging, and the week summary.
 * Reads/writes the same JSON the app stores via @capacitor/preferences (SharedPreferences "CapacitorStorage", key "fitdad").
 */
public class FitDadWidget extends AppWidgetProvider {

    static final String ACTION_WATER = "com.dijaedadula.fitdad.WIDGET_WATER";
    static final String ACTION_STAND = "com.dijaedadula.fitdad.WIDGET_STAND";
    static final String PREFS = "CapacitorStorage";
    static final String KEY = "fitdad";
    static final String KEY_WEEK = "fitdad_week";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (ACTION_WATER.equals(a) || ACTION_STAND.equals(a)) {
            log(ctx, ACTION_WATER.equals(a), "widget");
            updateAll(ctx);
        }
    }

    /** Refresh every placed widget (called by the app after each save, and after widget taps). */
    public static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, FitDadWidget.class));
        RemoteViews v = build(ctx);
        for (int id : ids) mgr.updateAppWidget(id, v);
    }

    // A "day" runs 4 AM → 4 AM, same as the app.
    static String logicalKey() {
        Calendar c = Calendar.getInstance();
        c.add(Calendar.HOUR_OF_DAY, -4);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
    }

    static JSONObject load(Context ctx) {
        try {
            String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
            return raw != null ? new JSONObject(raw) : new JSONObject();
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static JSONObject today(JSONObject root) throws Exception {
        if (!root.has("days")) root.put("days", new JSONObject());
        JSONObject days = root.getJSONObject("days");
        String k = logicalKey();
        if (!days.has(k)) {
            JSONObject r = new JSONObject();
            r.put("status", "idle"); r.put("water", 0); r.put("stands", 0); r.put("pausedMs", 0);
            r.put("log", new JSONArray()); r.put("segments", new JSONArray());
            days.put(k, r);
        }
        JSONObject r = days.getJSONObject(k);
        if (!r.has("log")) r.put("log", new JSONArray());
        return r;
    }

    static int setting(JSONObject root, String name, int def) {
        JSONObject s = root.optJSONObject("settings");
        return s != null ? s.optInt(name, def) : def;
    }

    /** Log a glass or a stand-up from the widget, exactly like a confirmation in the app. */
    static void log(Context ctx, boolean water, String src) {
        try {
            JSONObject root = load(ctx);
            JSONObject r = today(root);
            long now = System.currentTimeMillis();
            JSONObject ev = new JSONObject();
            ev.put("t", now);
            ev.put("src", src);
            if (water) {
                int glass = setting(root, "glass", 250);
                r.put("water", r.optInt("water", 0) + glass);
                if (!r.has("dayStart") || r.isNull("dayStart")) r.put("dayStart", now);
                ev.put("k", "water"); ev.put("ml", glass);
            } else {
                r.put("stands", r.optInt("stands", 0) + 1);
                ev.put("k", "stand");
            }
            r.getJSONArray("log").put(ev);
            // flag so the app re-plans reminders next time it opens
            root.put("widgetDirty", true);
            SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            ed.putString(KEY, root.toString());
            ed.apply();
            cancelFollowUps(ctx, water, r.optJSONArray("follows"));
        } catch (Exception ignored) { }
    }

    /**
     * Confirmed from the widget → cancel pending "did you really…?" follow-ups for that kind
     * and clear its reminders from the notification shade (same IDs the app uses).
     */
    static void cancelFollowUps(Context ctx, boolean water, JSONArray follows) {
        String kind = water ? "water" : "stand";
        int remindBase = water ? 2000 : 1000;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        SharedPreferences.Editor store = ctx.getSharedPreferences("NOTIFICATION_STORE", Context.MODE_PRIVATE).edit();
        int flags = PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        Intent publisher = new Intent().setComponent(new ComponentName(ctx.getPackageName(),
                "com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher"));
        long now = System.currentTimeMillis();
        // only follow-ups for reminders that already rang; future reminders keep theirs
        if (follows != null) for (int i = 0; i < follows.length(); i++) {
            JSONObject f = follows.optJSONObject(i);
            if (f == null || !kind.equals(f.optString("k")) || f.optLong("of") > now + 60000) continue;
            int id = f.optInt("id");
            PendingIntent pi = PendingIntent.getBroadcast(ctx, id, publisher, flags);
            if (pi != null) { am.cancel(pi); pi.cancel(); }
            store.remove(String.valueOf(id));
            nm.cancel(id);
        }
        store.apply();
        for (int id = remindBase; id < remindBase + 100; id++) nm.cancel(id);
    }

    static PendingIntent broadcast(Context ctx, String action, int req) {
        Intent i = new Intent(ctx, FitDadWidget.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openApp(Context ctx, String deepLink, int req) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(deepLink), ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.fitdad_widget);
        try {
            JSONObject root = load(ctx);
            JSONObject r = today(root);
            int goal = setting(root, "waterGoal", 3000);
            int glass = setting(root, "glass", 250);
            int water = r.optInt("water", 0);
            int stands = r.optInt("stands", 0);
            int total = (int) Math.ceil(goal / (double) glass);
            int left = Math.max(0, (int) Math.ceil((goal - water) / (double) glass));
            String status = r.optString("status", "idle");

            String st;
            switch (status) {
                case "active": st = "Working"; break;
                case "paused": st = "Paused"; break;
                case "ended": st = "Day done"; break;
                case "off": st = "Day off"; break;
                default: st = "Not started";
            }
            v.setTextViewText(R.id.w_status, st);
            v.setTextViewText(R.id.w_water, String.format(Locale.US, "%.2f / %.2f L", water / 1000.0, goal / 1000.0));
            v.setTextViewText(R.id.w_water_sub, left > 0
                    ? String.format(Locale.US, "Glass %d of %d · %.2f L to go", total - left + 1, total, (goal - water) / 1000.0)
                    : "Goal reached 🎉");
            v.setProgressBar(R.id.w_progress, 100, Math.min(100, goal > 0 ? water * 100 / goal : 0), false);
            v.setTextViewText(R.id.w_stands, String.valueOf(stands));
            v.setTextViewText(R.id.w_btn_water, "+ " + glass + " ml");

            String week = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_WEEK, null);
            v.setTextViewText(R.id.w_week, week != null ? week : "Week stats appear after you use the app");

            boolean idle = "idle".equals(status) || "ended".equals(status) || "off".equals(status);
            v.setTextViewText(R.id.w_btn_main, idle ? "Start" : "Open");
            v.setOnClickPendingIntent(R.id.w_btn_main, openApp(ctx, idle ? "fitdad://start" : "fitdad://today", 3));
        } catch (Exception e) {
            v.setTextViewText(R.id.w_status, "FitDad");
        }
        v.setOnClickPendingIntent(R.id.w_btn_water, broadcast(ctx, ACTION_WATER, 1));
        v.setOnClickPendingIntent(R.id.w_btn_stand, broadcast(ctx, ACTION_STAND, 2));
        v.setOnClickPendingIntent(R.id.w_stats_area, openApp(ctx, "fitdad://stats", 4));
        return v;
    }
}
