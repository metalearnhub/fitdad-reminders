#!/usr/bin/env bash
# Screenshots the real widget (rendered by WidgetPreviewActivity) in two modes: water+stand, then water only.
set -x
mkdir -p smoke
P=com.dijaedadula.fitdad
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant $P android.permission.POST_NOTIFICATIONS
adb root >/dev/null 2>&1; adb wait-for-device; sleep 3
adb shell cmd alarm set-timezone Asia/Manila 2>/dev/null || true
adb shell am start -n $P/.MainActivity; sleep 20
adb shell "am start -a android.intent.action.VIEW -d fitdad://start $P"; sleep 8
adb shell am broadcast -n $P/.FitDadWidget -a $P.WIDGET_WATER >/dev/null; sleep 3
adb shell input keyevent KEYCODE_HOME; sleep 2
adb shell am start -n $P/.WidgetPreviewActivity; sleep 4
adb exec-out screencap -p > smoke/w1-water-and-stand.png
sleep 5; adb exec-out screencap -p > smoke/w1b-5s-later.png
adb shell run-as $P cat shared_prefs/upkeep_sched.xml > smoke/sched.txt
# water only: switch Stand-ups off in the saved settings
adb shell am force-stop $P; sleep 1
adb shell run-as $P cat shared_prefs/CapacitorStorage.xml > /tmp/cs.xml
python3 - <<'PY'
import json, re, html
s = open('/tmp/cs.xml').read()
m = re.search(r'(<string name="fitdad">)(.*?)(</string>)', s, re.S)
d = json.loads(html.unescape(m.group(2)))
d.setdefault('settings', {})['features'] = {'water': True, 'stand': False, 'car': True}
s = s[:m.start(2)] + html.escape(json.dumps(d), quote=True) + s[m.end(2):]
open('/tmp/cs2.xml', 'w').write(s)
PY
F=/data/data/$P/shared_prefs/CapacitorStorage.xml
OWN=$(adb shell stat -c %u:%g $F | tr -d '\r')
adb push /tmp/cs2.xml $F
adb shell chown $OWN $F; adb shell restorecon $F
grep -o 'features[^}]*' /tmp/cs2.xml | head -1 | tee smoke/features.txt
adb shell am start -n $P/.WidgetPreviewActivity; sleep 4
adb exec-out screencap -p > smoke/w2-water-only.png
adb logcat -d | grep -iE "AndroidRuntime|FATAL" > smoke/crash.txt || true
exit 0
