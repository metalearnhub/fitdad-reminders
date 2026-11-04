#!/usr/bin/env bash
# Installs the debug APK, launches it, taps through the main flow, captures screenshots + logs.
set -x
mkdir -p smoke
tap_text() {  # tap the first UI element whose text/content-desc matches $1
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null
  B=$(grep -oE "(text|content-desc)=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/ui.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
  [ -z "$B" ] && { echo "NOT FOUND: $1"; return 1; }
  read X1 Y1 X2 Y2 <<<"$(echo "$B" | tr '[],' '   ')"
  adb shell input tap $(( (X1+X2)/2 )) $(( (Y1+Y2)/2 )); sleep 3; echo "TAPPED: $1"
}
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant com.dijaedadula.fitdad android.permission.POST_NOTIFICATIONS
adb shell wm size | tee smoke/size.txt
adb logcat -c
adb shell am start -n com.dijaedadula.fitdad/.MainActivity
sleep 20
adb exec-out screencap -p > smoke/01-launch.png
tap_text "Allow" | tee -a smoke/steps.txt
adb exec-out screencap -p > smoke/02-after-permission.png
tap_text "Start day" | tee -a smoke/steps.txt
adb exec-out screencap -p > smoke/03-started.png
tap_text "+ 250 ml" | tee -a smoke/steps.txt
tap_text "Settings" | tee -a smoke/steps.txt
adb exec-out screencap -p > smoke/04-settings.png
tap_text "Test alarm (10s)" | tee -a smoke/steps.txt
adb shell input keyevent KEYCODE_HOME
sleep 15
adb exec-out screencap -p > smoke/05-test-alarm.png
adb shell dumpsys notification --noredact | grep -iE "fitdad|pkg=com.dijaedadula" | head -40 > smoke/notifications.txt
adb shell dumpsys alarm | grep -iE "com.dijaedadula.fitdad" | head -60 > smoke/alarms.txt
# Widget: log a glass + stand-up via the widget receiver, then read stored data
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_WATER | tee -a smoke/steps.txt
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_STAND | tee -a smoke/steps.txt
sleep 2
adb shell run-as com.dijaedadula.fitdad cat shared_prefs/CapacitorStorage.xml > smoke/prefs.xml
# Deep link from widget → Stats tab
adb shell am start -a android.intent.action.VIEW -d fitdad://stats com.dijaedadula.fitdad
sleep 5
adb exec-out screencap -p > smoke/06-deeplink-stats.png
# Notification action "Done" with the app killed (cold start), then "Drank" while running
adb shell am force-stop com.dijaedadula.fitdad
adb shell "am start -n com.dijaedadula.fitdad/.MainActivity --ei LocalNotificationId 1000 --es LocalNotificationUserAction done --es LocalNotficationObject '{\"id\":1000,\"extra\":{\"kind\":\"stand\"}}'"
sleep 12
adb shell "am start -n com.dijaedadula.fitdad/.MainActivity --ei LocalNotificationId 2000 --es LocalNotificationUserAction drank --es LocalNotficationObject '{\"id\":2000,\"extra\":{\"kind\":\"water\"}}'"
sleep 6
adb exec-out screencap -p > smoke/07-after-notif-actions.png
# "Done working" from the widget
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_ENDWORK | tee -a smoke/steps.txt
sleep 3
adb shell "am start -n com.dijaedadula.fitdad/.MainActivity"
sleep 5
adb exec-out screencap -p > smoke/08-done-working.png
adb shell run-as com.dijaedadula.fitdad cat shared_prefs/CapacitorStorage.xml > smoke/prefs2.xml
# ---- Reminder gate test: jump the clock and check which reminders actually show ----
jump() { # jump device clock to T0 + $1 minutes
  NEW=$(( T0 + $1 * 60 ))
  adb shell cmd alarm set-time $(( NEW * 1000 )) 2>&1 | tee -a smoke/gate.txt
  adb shell "date @$NEW" >/dev/null 2>&1 || true
  echo "clock -> $(adb shell date)" | tee -a smoke/gate.txt
  sleep 12
}
shade() { echo "== $1" >> smoke/gate.txt; adb shell dumpsys notification --noredact | grep -oE "pkg=com.dijaedadula.fitdad[^ ]* id=[0-9]+" | sort -u >> smoke/gate.txt; adb shell dumpsys notification --noredact | grep -E "android.title=" | grep -iE "stand|water|start|did you" >> smoke/gate.txt; }
adb root >/dev/null 2>&1; adb wait-for-device; sleep 3
adb shell am force-stop com.dijaedadula.fitdad
adb shell "am start -n com.dijaedadula.fitdad/.MainActivity"; sleep 12
tap_text "Back to work" || tap_text "Start day" || true
sleep 4
adb shell input keyevent KEYCODE_HOME; sleep 2
adb shell cmd notification cancel_all >/dev/null 2>&1 || true
T0=$(adb shell date +%s | tr -d '\r')
echo "T0=$T0" | tee -a smoke/gate.txt
adb shell run-as com.dijaedadula.fitdad cat shared_prefs/upkeep_sched.xml | head -c 1500 > smoke/sched.txt
jump 20
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_STAND >/dev/null
echo "widget: stood up at +20" >> smoke/gate.txt
jump 31
shade "+31 min (stand reminder due; stood up 11 min ago via widget -> expect NO stand)"
jump 40
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_ENDWORK >/dev/null
echo "widget: done working at +40" >> smoke/gate.txt
jump 95
shade "+95 min (stand reminders due but work ended -> expect NO stand; water not answered -> expect water)"
adb logcat -d > smoke/logcat-full.txt
grep -iE "Capacitor/Console|JavaScript Error|AndroidRuntime|FATAL|LocalNotification" smoke/logcat-full.txt > smoke/logcat-app.txt || true
exit 0
