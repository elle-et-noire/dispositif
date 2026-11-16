#!/bin/sh
# Re-measures the n段 key operations with the key held for 80 ms.
cd "$(dirname "$0")/.."
B=http://localhost:4336/dispositif/
D=.measure-inp
for cond in "chromium 1" "chromium 4" "firefox 1"; do
  set -- $cond
  echo "start keys $1 x$2 $(date +%T) $(uptime)" >> $D/load.log
  ENGINES=$1 THROTTLE=$2 OPS=main KEY_DELAY=80 RECORD_OPS=key-Home,key-PageDown,key-ArrowRight,key-ArrowLeft,key-End,key-Home2 \
    node $D/measure.mjs $B 12 > $D/keys-$1-$2.jsonl 2> $D/keys-err-$1-$2.log
  echo "end   keys $1 x$2 $(date +%T) $(uptime)" >> $D/load.log
done
