#!/usr/bin/env bash
# One pinned before/after measurement (48 trials by default).
# Usage: scripts/experiments/reading-no-iframe-pinned-run.sh BUILD_BEFORE BUILD_AFTER OUT_PREFIX
#   BUILD_*    production builds (Astro dist directories) made from separate sources
#   OUT_PREFIX e.g. docs/reading-no-iframe-comparison-pinned-20261105 (adds .jsonl)
# Optional: RM_CORES (default 8), RM_PICK_SECONDS (default 5), RM_SAMPLES_OUT, RM_ENV_OUT,
#   RM_BUILD_INFO (a JSON file identifying both builds, embedded in the record).
#
# Only the measuring side is pinned and weighted: the two servers and the Node
# measurement (with the browsers it launches) each run in their own transient
# user scope with CPUWeight=1000 on the chosen idle physical cores. Other jobs
# on the machine are neither stopped, delayed nor moved.
set -euo pipefail
before=$(realpath "$1"); after=$(realpath "$2"); prefix=$3
here=$(cd "$(dirname "$0")" && pwd)
cores=${RM_CORES:-8}
env_out=${RM_ENV_OUT:-${prefix%comparison*}environment${prefix#*comparison}.json}
for port in 4597 4598; do
  if ss -ltn "sport = :$port" | grep -q LISTEN; then echo "port $port is busy" >&2; exit 1; fi
done

pick=$(python3 "$here/reading-pick-idle-cores.py" "${RM_PICK_SECONDS:-5}" "$cores")
cpus=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["cpus"])' "$pick")
echo "pinned CPUs: $cpus" >&2
scope=(systemd-run --user --scope --quiet -p CPUWeight=1000 taskset -c "$cpus")

"${scope[@]}" python3 "$here/reading-comparison-server.py" 4597 "$before" >/dev/null 2>&1 &
server_before=$!
"${scope[@]}" python3 "$here/reading-comparison-server.py" 4598 "$after" >/dev/null 2>&1 &
server_after=$!
cleanup() {
  kill "$server_before" "$server_after" 2>/dev/null || true
  wait "$server_before" "$server_after" 2>/dev/null || true
  for port in 4597 4598; do
    if ss -ltn "sport = :$port" | grep -q LISTEN; then echo "port $port still in use" >&2; fi
  done
}
trap cleanup EXIT
for _ in $(seq 50); do
  curl -sf -o /dev/null http://127.0.0.1:4597/dispositif/ && curl -sf -o /dev/null http://127.0.0.1:4598/dispositif/ && break
  sleep 0.1
done

python3 - "$env_out" "$pick" "$before" "$after" "$server_before" "$server_after" "${RM_BUILD_INFO:-}" <<'PY'
import json, os, platform, subprocess, sys, time
out, pick, before, after, sb, sa, info = sys.argv[1:]
def run(*args):
    try: return subprocess.run(args, capture_output=True, text=True, check=False).stdout.strip()
    except OSError as e: return f'unavailable: {e}'
def affinity(pid):
    with open(f'/proc/{pid}/status') as f:
        return next(l.split(':', 1)[1].strip() for l in f if l.startswith('Cpus_allowed_list'))
def cgroup(pid):
    with open(f'/proc/{pid}/cgroup') as f: return f.read().strip()
def weight(pid):
    path = '/sys/fs/cgroup' + cgroup(pid).split('::', 1)[1] + '/cpu.weight'
    try:
        with open(path) as f: return f.read().strip()
    except OSError: return None
cpu = json.loads(pick)
record = {
    'recorded_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    'os': run('lsb_release', '-ds'), 'kernel': platform.release(),
    'cpu_model': next((l.split(':', 1)[1].strip() for l in open('/proc/cpuinfo') if l.startswith('model name')), None),
    'logical_cpus': os.cpu_count(), 'clock_ticks': os.sysconf('SC_CLK_TCK'),
    'governor': open('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor').read().strip(),
    'memory_kib': int(next(l.split()[1] for l in open('/proc/meminfo') if l.startswith('MemTotal'))),
    'node': run('node', '-v'), 'python': platform.python_version(),
    'loadavg_at_start': open('/proc/loadavg').read().split()[:3],
    'core_selection': cpu,
    'servers': {name: {'pid': int(pid), 'affinity': affinity(pid), 'cgroup': cgroup(pid), 'cpu_weight': weight(pid)}
                for name, pid in (('before_4597', sb), ('after_4598', sa))},
    'builds': {'before': before, 'after': after, **(json.load(open(info)) if info else {})},
    'top_processes_at_start': run('ps', '-eo', 'comm,pcpu', '--sort=-pcpu').splitlines()[:12],
    'playwright_core': json.load(open('node_modules/playwright-core/package.json'))['version'],
}
with open(out, 'w') as f: json.dump(record, f, indent=1)
PY

RM_SERVER_PIDS="$server_before,$server_after" RM_PINNED_CPUS="$cpus" \
  "${scope[@]}" node "$here/reading-no-iframe-pinned-comparison.mjs" > "$prefix.jsonl"
echo "wrote $prefix.jsonl and $env_out" >&2
