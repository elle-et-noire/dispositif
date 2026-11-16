#!/bin/sh
# Runs every condition in sequence, recording the load average around each.
cd "$(dirname "$0")/.."
B=http://localhost:4336/dispositif/
D=.measure-inp
for cond in "chromium 1" "chromium 4" "firefox 1"; do
  set -- $cond
  echo "start $1 x$2 $(date +%T) $(uptime)" >> $D/load.log
  ENGINES=$1 THROTTLE=$2 node $D/measure.mjs $B 12 > $D/out-$1-$2.jsonl 2> $D/err-$1-$2.log
  echo "end   $1 x$2 $(date +%T) $(uptime)" >> $D/load.log
done
