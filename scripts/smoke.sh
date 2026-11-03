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
adb shell run-as com.dijaedadula.fitdad cat shared_prefs/CapacitorStorage.xml > smoke/prefs2.xml
adb logcat -d > smoke/logcat-full.txt
grep -iE "Capacitor/Console|JavaScript Error|AndroidRuntime|FATAL|LocalNotification" smoke/logcat-full.txt > smoke/logcat-app.txt || true
exit 0
