#!/usr/bin/env bash
# Verifies "Ring even on Silent": OFF must follow the phone's Silent/DND for every reminder; ON rings on the alarm stream.
set -x
mkdir -p smoke; R=smoke/silent.txt; : > $R
P=com.dijaedadula.fitdad
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant $P android.permission.POST_NOTIFICATIONS
adb root >/dev/null 2>&1; adb wait-for-device; sleep 3
adb shell am start -n $P/.MainActivity; sleep 20
adb shell "am start -a android.intent.action.VIEW -d fitdad://start $P"; sleep 8
adb shell input keyevent KEYCODE_HOME; sleep 2

setring() {  # $1 = true|false
  adb shell am force-stop $P; sleep 1
  F=/data/data/$P/shared_prefs/CapacitorStorage.xml
  adb shell cat $F > /tmp/cs.xml
  python3 - "$1" <<'PY'
import json, re, html, sys
s = open('/tmp/cs.xml').read()
m = re.search(r'(<string name="fitdad">)(.*?)(</string>)', s, re.S)
d = json.loads(html.unescape(m.group(2)))
d.setdefault('settings', {})['ringOnSilent'] = (sys.argv[1] == 'true')
s = s[:m.start(2)] + html.escape(json.dumps(d), quote=True) + s[m.end(2):]
open('/tmp/cs2.xml', 'w').write(s)
PY
  OWN=$(adb shell stat -c %u:%g $F | tr -d '\r')
  adb push /tmp/cs2.xml $F >/dev/null; adb shell chown $OWN $F; adb shell restorecon $F
  echo "ringOnSilent set to $1: $(adb shell cat $F | grep -o 'ringOnSilent&quot;: [a-z]*')" | tee -a $R
}
ringer() {  # silent | normal
  if [ "$1" = silent ]; then adb shell cmd audio set-ringer-mode silent >/dev/null 2>&1; adb shell settings put global mode_ringer 0
  else adb shell cmd audio set-ringer-mode normal >/dev/null 2>&1; adb shell settings put global mode_ringer 2; fi
}
fire() {  # fires the next planned main stand-up or water reminder right now; $1 = label
  echo "==== $1" | tee -a $R
  echo "ringer=$(adb shell settings get global mode_ringer) zen=$(adb shell settings get global zen_mode)" | tee -a $R
  adb shell cmd notification cancel_all >/dev/null 2>&1 || true
  # plant one real reminder (stand or water) in the app's own schedule, then fire it
  KIND=${2:-stand}; ID=$((9300 + RANDOM % 500))
  SF=/data/data/$P/shared_prefs/upkeep_sched.xml
  adb shell cat $SF > /tmp/sc.xml; cp /tmp/sc.xml smoke/sched-before-$ID.xml
  python3 - "$ID" "$KIND" <<'PY'
import json, re, html, sys, time
s = open('/tmp/sc.xml').read()
m = re.search(r'(<string name="items">)(.*?)(</string>)', s, re.S)
d = json.loads(html.unescape(m.group(2))) if m else {}
i, k = int(sys.argv[1]), sys.argv[2]
d[str(i)] = {"id": i, "at": int(time.time()*1000) + 3600000, "title": "Stand up now 🧍" if k == "stand" else "Drink water 💧", "body": "silent test",
             "channel": "fitdad-alarm" if k == "stand" else "fitdad-water", "type": "STAND" if k == "stand" else "WATER", "kind": k, "follow": False, "of": 0, "gap": 0}
x = '<string name="items">' + html.escape(json.dumps(d), quote=True) + '</string>'
s = s[:m.start()] + x + s[m.end():] if m else s.replace('</map>', x + '\n</map>')
open('/tmp/sc2.xml', 'w').write(s)
PY
  OWN=$(adb shell stat -c %u:%g $SF | tr -d '\r')
  adb shell am force-stop $P; sleep 1
  adb push /tmp/sc2.xml $SF >/dev/null; adb shell chown $OWN $SF; adb shell restorecon $SF
  echo "firing reminder id=$ID" | tee -a $R
  adb logcat -c
  adb shell am broadcast -n $P/.ReminderGate -a com.dijaedadula.fitdad.REMINDER_FIRE.$ID --ei id $ID >/dev/null
  sleep 1
  adb shell dumpsys audio | grep -E "AudioPlaybackConfiguration.*(USAGE_ALARM|usage=4)" | grep -v "state:released" | head -3 | sed 's/^/  alarm-stream playback: /' | tee -a $R
  sleep 2
  adb logcat -d | grep -E "UpkeepGate" | sed 's/^/  log: /' | tee -a $R
  adb shell dumpsys notification --noredact | grep -E "pkg=com.dijaedadula.fitdad.*id=" | head -2 | sed 's/^/  posted: /' | tee -a $R
}

echo "---- our channels (must be usage=USAGE_NOTIFICATION, bypassDnd=false) ----" | tee -a $R
adb shell dumpsys notification | grep -oE "NotificationChannel\{mId='(fitdad-alarm|fitdad-water|upkeep-car|default)'[^}]*" | grep -oE "mId='[^']*'|mBypassDnd=[a-z]*|mAudioAttributes=[^,]*, ?usage=[A-Z_]*|usage=[A-Z_]*" | paste -sd' ' | tee -a $R

setring false
ringer silent;  adb shell cmd notification set_dnd off >/dev/null 2>&1
fire "A1: toggle OFF + SILENT, stand-up -> expect NO alarm-stream ring" stand
fire "A2: toggle OFF + SILENT, water -> expect NO alarm-stream ring" water
ringer normal; adb shell cmd notification set_dnd on >/dev/null 2>&1
fire "B: toggle OFF + Do Not Disturb ON, stand-up -> expect NO alarm-stream ring" stand
adb shell cmd notification set_dnd off >/dev/null 2>&1
setring true
ringer silent
fire "C (control): toggle ON + SILENT, stand-up -> expect alarm-stream ring" stand
ringer normal
echo "---- channels after test ----" | tee -a $R
adb shell dumpsys notification | grep -oE "NotificationChannel\{mId='(fitdad-alarm|fitdad-water|upkeep-car)'[^}]*" | grep -oE "mId='[^']*'|mBypassDnd=[a-z]*|usage=[A-Z_]*" | paste -sd' ' | tee -a $R
exit 0
