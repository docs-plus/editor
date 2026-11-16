#!/usr/bin/env bash
# Launch a Linux build under the current DISPLAY (run inside xvfb-run) with
# no --no-sandbox, then record whether it started, the renderer's Seccomp
# value and the window's WM_CLASS.
#   linux-probe.sh <label> <executable>
set -u
label="$1"
exe="$2"
work="${S3_OUT:-$PWD/out}/probe-$label"
rm -rf "$work"
mkdir -p "$work/userData"

echo "=== probe $label: $exe"
echo "kernel.apparmor_restrict_unprivileged_userns=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)"
TINYDOCY_MODE=hold TINYDOCY_USER_DATA="$work/userData" TINYDOCY_TIMEOUT_MS=60000 \
  setsid "$exe" >"$work/stdout.log" 2>"$work/stderr.log" &
pid=$!
sleep 12

if kill -0 "$pid" 2>/dev/null; then
  echo "started without --no-sandbox: yes (pid $pid alive after 12 s)"
else
  wait "$pid"
  echo "started without --no-sandbox: no (exit code $?)"
fi
echo "--- stderr (first 15 lines)"
head -n 15 "$work/stderr.log"

renderer=$(pgrep -f -- '--type=renderer' | head -n 1)
if [ -n "$renderer" ]; then
  echo "renderer pid $renderer: $(grep -E '^Seccomp:' "/proc/$renderer/status")"
  echo "renderer cmdline: $(tr '\0' ' ' <"/proc/$renderer/cmdline" | grep -oE -- '--(no-sandbox|disable-seccomp-filter-sandbox|enable-sandbox)[^ ]*' | tr '\n' ' ')"
else
  echo "renderer: none running"
fi

win=$(xwininfo -root -tree 2>/dev/null | grep -i '"TinyDocy"' | head -n 1 | awk '{print $1}')
if [ -n "$win" ]; then
  echo "window $win: $(xprop -id "$win" WM_CLASS)"
else
  echo "window: none found"
fi
grep -E 'start mode|window shown' "$work/userData/probe.log" 2>/dev/null | cut -c1-220

# setsid made $pid a process-group leader: stop the runtime and Electron.
kill -TERM -- "-$pid" 2>/dev/null
sleep 2
kill -KILL -- "-$pid" 2>/dev/null
pkill -KILL -x tinydocy 2>/dev/null
true
