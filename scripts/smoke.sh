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
adb shell cmd alarm set-timezone Asia/Manila 2>/dev/null || adb shell setprop persist.sys.timezone Asia/Manila
sleep 2; echo "tz: $(adb shell date)" | tee -a smoke/gate.txt
adb shell am force-stop com.dijaedadula.fitdad
adb shell "am start -n com.dijaedadula.fitdad/.MainActivity"; sleep 12
adb shell "am start -a android.intent.action.VIEW -d fitdad://start com.dijaedadula.fitdad"
sleep 8
adb shell input keyevent KEYCODE_HOME; sleep 2
adb shell cmd notification cancel_all >/dev/null 2>&1 || true
T0=$(adb shell date +%s | tr -d '\r')
echo "T0=$T0" | tee -a smoke/gate.txt
adb shell run-as com.dijaedadula.fitdad cat shared_prefs/upkeep_sched.xml > smoke/sched.txt
echo "alarm-clock alarms armed: $(adb shell dumpsys alarm | grep -c 'ALARM_CLOCK\|alarmClock')" | tee -a smoke/gate.txt
adb shell cmd audio set-ringer-mode silent 2>&1 | tee -a smoke/gate.txt
adb shell settings put global mode_ringer 0
adb shell cmd audio set-ringer-mode 0 2>/dev/null
echo "ringer: $(adb shell settings get global mode_ringer) (0 = silent)" | tee -a smoke/gate.txt
adb logcat -c
jump 31
shade "+31 min (stand reminder due, not answered -> expect STAND shown)"
echo "ringer now: $(adb shell settings get global mode_ringer)" | tee -a smoke/gate.txt
adb logcat -d | grep -E "UpkeepGate" | head -3 | tee -a smoke/gate.txt
adb shell dumpsys audio | grep -iE "usage=USAGE_ALARM|AUDIO_USAGE_ALARM" | head -3 >> smoke/gate.txt
adb logcat -d | grep -iE "MediaPlayer|AudioTrack|fitdad_alarm" | grep -i "fitdad\|alarm" | head -5 >> smoke/gate.txt
adb shell settings put global mode_ringer 2
jump 37
shade "+37 min (follow-up 5 min after an unanswered stand-up -> expect 'Did you stand up?')"
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_STAND >/dev/null
shade "+31 after widget Stood up (expect stand notification cleared)"
jump 50
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_STAND >/dev/null
echo "widget: stood up at +50" >> smoke/gate.txt
adb shell cmd notification cancel_all >/dev/null 2>&1 || true
jump 61
shade "+61 min (stand due; stood up 11 min ago via widget -> expect NO stand)"
adb shell am broadcast -n com.dijaedadula.fitdad/.FitDadWidget -a com.dijaedadula.fitdad.WIDGET_ENDWORK >/dev/null
echo "widget: done working at +61" >> smoke/gate.txt
adb shell cmd notification cancel_all >/dev/null 2>&1 || true
jump 125
shade "+125 min (stand reminders due but work ended -> expect NO stand)"
# ---- Notification buttons handled in place (app must stay closed) ----
adb shell input keyevent KEYCODE_HOME; sleep 2
adb shell am force-stop com.dijaedadula.fitdad; sleep 1
B0=$(adb shell run-as com.dijaedadula.fitdad cat shared_prefs/CapacitorStorage.xml | grep -o '&quot;k&quot;:&quot;water&quot;' | wc -l)
adb shell am broadcast -n com.dijaedadula.fitdad/.NotifActionReceiver -a com.dijaedadula.fitdad.NOTIF_ACTION.2001.drank --ei id 2001 --es action drank --es kind water | tail -1 | tee -a smoke/inplace.txt
adb shell am broadcast -n com.dijaedadula.fitdad/.NotifActionReceiver -a com.dijaedadula.fitdad.NOTIF_ACTION.1001.snooze --ei id 1001 --es action snooze --es kind stand | tail -1 | tee -a smoke/inplace.txt
sleep 3
B1=$(adb shell run-as com.dijaedadula.fitdad cat shared_prefs/CapacitorStorage.xml | grep -o '&quot;k&quot;:&quot;water&quot;' | wc -l)
echo "water events before=$B0 after=$B1" | tee -a smoke/inplace.txt
NOWS=$(adb shell date +%s | tr -d '\r')
echo "now=$NOWS; water plan after notification glass (id:at):" | tee -a smoke/inplace.txt
adb shell run-as com.dijaedadula.fitdad cat shared_prefs/upkeep_sched.xml | grep -oE '&quot;20[0-9]{2}&quot;:\{&quot;id&quot;:20[0-9]{2},&quot;at&quot;:[0-9]+' | sed -E 's/.*id&quot;:([0-9]+),&quot;at&quot;:([0-9]+)/\1:\2/' | head -4 | tee -a smoke/inplace.txt
echo "resumed: $(adb shell dumpsys activity activities | grep -m1 -E 'mResumedActivity|ResumedActivity')" | tee -a smoke/inplace.txt
echo "snooze armed: $(adb shell run-as com.dijaedadula.fitdad cat shared_prefs/upkeep_sched.xml | grep -oE '&quot;5[0-9]{3}&quot;:' | head -3 | tr '\n' ' ')" | tee -a smoke/inplace.txt
adb exec-out screencap -p > smoke/09-inplace-home.png
adb logcat -d > smoke/logcat-full.txt
grep -iE "Capacitor/Console|JavaScript Error|AndroidRuntime|FATAL|LocalNotification" smoke/logcat-full.txt > smoke/logcat-app.txt || true
exit 0
