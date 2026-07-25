---
title: Tips for Haskell
publish: 2025-02-18
lastUpdate: 2025-02-18
---

## フィボナッチ数列

遅延評価のおかげで無限のフィボナッチ数列の先頭からn個取るという書き方ができる。
```haskell
fibs n = take n $ f 0 1
  where f a b = a : f b (a + b)

-- fibs 7 == [0,1,1,2,3,5,8]
```