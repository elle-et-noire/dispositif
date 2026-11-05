"""Pick the least busy physical cores (both hardware threads) for pinning.

Usage: python3 scripts/experiments/reading-pick-idle-cores.py [SECONDS] [CORES]
Prints one JSON object: per-CPU utilisation over the window, the chosen cores
and a taskset-style CPU list. It only reads /proc and /sys.
"""
import json
import sys
import time


def snapshot():
    result = {}
    with open('/proc/stat') as f:
        for line in f:
            name, *values = line.split()
            if name.startswith('cpu') and name != 'cpu':
                v = list(map(int, values))
                busy = v[0] + v[1] + v[2] + v[5] + v[6] + v[7]
                result[int(name[3:])] = (busy, busy + v[3] + v[4])
    return result


def siblings(cpu):
    with open(f'/sys/devices/system/cpu/cpu{cpu}/topology/thread_siblings_list') as f:
        text = f.read().strip()
    cpus = []
    for part in text.split(','):
        a, _, b = part.partition('-')
        cpus.extend(range(int(a), int(b or a) + 1))
    return tuple(sorted(cpus))


def compact(cpus):
    cpus = sorted(cpus)
    parts, start = [], cpus[0]
    for prev, cur in zip(cpus, cpus[1:] + [None]):
        if cur != prev + 1:
            parts.append(str(start) if start == prev else f'{start}-{prev}')
            start = cur
    return ','.join(parts)


if __name__ == '__main__':
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 5
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    a = snapshot()
    time.sleep(seconds)
    b = snapshot()
    util = {cpu: (b[cpu][0] - a[cpu][0]) / max(1, b[cpu][1] - a[cpu][1]) for cpu in a}
    cores = sorted({siblings(cpu) for cpu in util})
    ranked = sorted(cores, key=lambda core: (sum(util[c] for c in core), core))
    chosen = sorted(ranked[:count])
    cpus = sorted(c for core in chosen for c in core)
    print(json.dumps({
        'window_s': seconds, 'measured_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'util': {str(k): round(v, 3) for k, v in sorted(util.items())},
        'core_util': {'+'.join(map(str, core)): round(sum(util[c] for c in core), 3) for core in ranked},
        'chosen_cores': ['+'.join(map(str, core)) for core in chosen],
        'cpus': compact(cpus),
    }))
