#!/bin/sh
# A/B: injected `will-change: translate` on the column contents, alternating.
cd "$(dirname "$0")/.."
B=http://localhost:4336/dispositif/
D=.measure-inp
echo "start willchange $(date +%T) $(uptime)" >> $D/load.log
for round in 1 2; do
  for v in base wc; do
    css=""; [ $v = wc ] && css=".cl-content { will-change: translate; }"
    EXTRA_CSS="$css" ENGINES=chromium THROTTLE=1 ARTICLES=symmetric-polynomial VIEWPORTS=desktop OPS=main KEY_DELAY=80 \
      RECORD_OPS=toc-multi,key-Home,key-PageDown,key-ArrowRight,key-ArrowLeft,key-End,key-Home2 \
      node $D/measure.mjs $B 6 >> $D/wc-$v.jsonl 2>> $D/wc-err.log
  done
done
echo "end   willchange $(date +%T) $(uptime)" >> $D/load.log
