#!/usr/bin/env bash
# Installs the debug APK, launches it, taps around, and captures screenshots + console logs.
set -x
mkdir -p smoke
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell wm size | tee smoke/size.txt
adb logcat -c
adb shell am start -n com.dijaedadula.fitdad/.MainActivity
sleep 8
adb exec-out screencap -p > smoke/01-launch.png
adb shell uiautomator dump /sdcard/ui1.xml && adb pull /sdcard/ui1.xml smoke/ui1.xml
# If the notification permission dialog is up, tap Allow
adb shell uiautomator dump /sdcard/ui.xml >/dev/null; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null
ALLOW=$(grep -o 'text="Allow"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' /tmp/ui.xml | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1)
if [ -n "$ALLOW" ]; then
  read X1 Y1 X2 Y2 <<<"$(echo "$ALLOW" | tr -d '[]' | tr ',' ' ' | sed 's/\]\[/ /')"
  adb shell input tap $(( (X1+X2)/2 )) $(( (Y1+Y2)/2 )); sleep 4
fi
adb exec-out screencap -p > smoke/02-after-permission.png
adb shell uiautomator dump /sdcard/ui2.xml && adb pull /sdcard/ui2.xml smoke/ui2.xml
read W H <<<"$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1 | tr 'x' ' ')"
# Tap "Settings" tab (bottom-right) and "Start day" (left button in first card ~ y 22%)
adb shell input tap $(( W*5/6 )) $(( H-60 )); sleep 2
adb exec-out screencap -p > smoke/03-tap-settings.png
adb shell input tap $(( W/6 )) $(( H-60 )); sleep 2
adb exec-out screencap -p > smoke/04-tap-today.png
adb logcat -d > smoke/logcat-full.txt
grep -iE "Capacitor|chromium|Console|FitDad|AndroidRuntime|FATAL" smoke/logcat-full.txt > smoke/logcat-app.txt || true
exit 0
