---
title: Tips for Julia
publish: 2025-01-01
lastUpdate: 2025-05-06
---

## 構文解析

正体が分からない記号が使われているとき、`Meta.@lower`を使えば実際に呼び出される関数や行われる処理が分かる。演算子をオーバーロードしたいときに役に立つ。

```julia
julia> Meta.@lower [1,2][[1,2]]
:($(Expr(:thunk, CodeInfo(
    @ none within `top-level scope`
1 ─ %1 = Base.vect(1, 2)
│   %2 = Base.vect(1, 2)
│   %3 = Base.getindex(%1, %2)
└──      return %3
))))
```

```julia
julia> Meta.@lower [1,2][1] = 2
:($(Expr(:thunk, CodeInfo(
    @ none within `top-level scope`
1 ─ %1 = Base.vect(1, 2)
│        Base.setindex!(%1, 2, 1)
└──      return 2
))))
```

配列の要素取得は`getindex`を、代入は`setindex!`をオーバーロードすればよいと分かる。

`@which`でもその記号が呼び出している関数名を教えてくれるが、具体的にどう用いられているかは`Meta.@lower`を見る方が分かりやすい。


## Dictのブロードキャスト

`Vector`ならスライスで`v[1:3]`のように部分列を取り出せる。Dictで同じように書くと`1:3`がkeyだと思われてしまってうまくいかない。Dictではブロードキャストを利用して同じことができる（[参考](https://discourse.julialang.org/t/how-to-get-values-of-dictionary-by-using-array-of-keys/73650/11)）。

```julia
d = Dict(:a=>1,:b=>2)
v = get.(Ref(d), [:a,:b], missing)
@assert v == [1, 2]
```


## 置換群

配列`s=[1,3,2]`は作用`v -> v[s]`によって置換と見なせる。特に`v`もまた`[1,2,3]`の並べ替えなら（つまり`isperm(v)`かつ`length(v)==3`なら）、`v[s]`は置換群の積になる。逆元は`invperm`あるいは`sortperm`で得られる。積の結合律が成り立つことは、3次の置換群に限れば以下のコードで証明できる。

```julia
perms(l) = isempty(l) ? [l] : [[x; y] for x in l for y in perms(setdiff(l, x))]

begin
  perm123 = perms([1, 2, 3])
  for (p, q, r) in Iterators.product(fill(perm123, 3)...)
    @assert p[q[r]] == p[q][r]
  end
end
```

順列を生成する関数`perms`の出典は[ここ](https://zenn.dev/ohno/articles/03e65bfa028baa)あるいは[ここ](https://rosettacode.org/wiki/Permutations#Julia)。


## 引数の分解

引数に渡されるTupleやPairやVectorを分解して受け取ることができる。

```julia
d((a, b)::Tuple) = a / b
d((a, b)::Pair) = b / a
d((a, b)) = a // b
@assert d((5, 2)) == 2.5
@assert d(5 => 2) == 0.4
@assert d([5, 2]) == 5//2
```

無名関数で引数を分解するときは`((a, b),) -> a / b`のように`,`を入れる（か引数の組の型を明示する）。


## 高次元配列の生成

for文でイテレータを複数書けばそれらはより高次の`axes`を走る。
またブロードキャストも引数の`AbstractArray`の`axes`の方向に準拠する。

```julia
v = [i * j for i in 1:3, j in 1:3]
@assert v == [1 2 3; 2 4 6; 3 6 9]
v = (1:3) .* (1:3)'
@assert v == [1 2 3; 2 4 6; 3 6 9]
```
2つ目の例では`.`なしでも行列のかけ算と見なされて同じ結果になる。


高階のKronecker delta \(\delta_{i_1\dots i_n}\ (i_j \in \{1,\dots,d_j\})\)は以下のように生成できる。

```julia
dims = [2, 4, 2, 4]
map(t -> Int(all(==(t[1]), t)),
    Iterators.product(Base.OneTo.(dims)...))
```

## 同値類への分割

[Juliaで集合を同値類に分割する](https://zenn.dev/ohno/articles/b83defa73d7e7c)という記事に触発されて実装してみた。`R`を呼び出す回数をなるべく減らしてある。

```julia
function classify(S, R)
  isempty(S) && return ([], [])
  indices = zeros(Int, length(S))
  j = 1
  while !isnothing(j)
    indices[j] = j
    Rj = filter(k -> indices[k] == 0 && R(S[j], S[k]), j+1:lastindex(S))
    indices[Rj] .= j
    j = findnext(iszero, indices, j + 1)
  end
  reprinds = unique(indices)
  [S[filter(j -> indices[j] == r, eachindex(S))] for r in reprinds], S[reprinds]
end

begin
  A = [1, 7, 3, 6, 10, 9]
  f(i, j) = iseven(i) == iseven(j)
  @assert classify(A, f) == ([[1, 7, 3, 9], [6, 10]], [1, 6])
end
```

`Set`や`unique`といった重複を取り除く関数も用意されているが、これらを同値類への分割に利用するには、商の型を用意してその上への`hash`を定義するか、元の型に対して`isequal`をオーバーロードするかしなければいけない（`isequal`をオーバーロードしたら`hash`もオーバーロードする必要がある[らしい](https://zenn.dev/kurusugawa/articles/hash_on_julia)）。`sort`関数が`lt`や`by`をで比較関数やハッシュ関数を設定できるのとは大違いである。`hash`や`isequal`を引数で受け取って同値類へ分割するには以下のようにする。

```julia
function classify(S; hash=identity, isequal=isequal)
  isempty(S) && return ([], [])
  indices = zeros(Int, length(S))
  reprs = hash.(S)
  j = 1
  while !isnothing(j)
    indices[j] = j
    Rj = filter(k -> iszero(indices[k]) && isequal(reprs[j], reprs[k]), j+1:lastindex(S))
    indices[Rj] .= j
    j = findnext(iszero, indices, j + 1)
  end
  reprinds = unique(indices)
  [S[filter(j -> indices[j] == r, eachindex(S))] for r in reprinds], S[reprinds]
end

begin
  A = [1, 7, 3, 6, 10, 9]
  @assert classify(A; hash=iseven) == ([[1, 7, 3, 9], [6, 10]], [1, 6])
end
```

## SVGの生成

[Luxor.jl](https://github.com/JuliaGraphics/Luxor.jl)が便利。以下にこのサイトのアイコンを生成するコードを載せる。

```julia
using Luxor, Colors, LinearAlgebra
using Curry

function rodrig(n, θ)
  K = mapslices(curry(cross)(n), I(3); dims=2)
  I + sin(θ) * K + (1 - cos(θ)) * K^2
end

function main()
  Drawing(256, 256, "favicon.svg")

  n = 7
  R = (rodrig([1, 0, 0], π / 7)*rodrig([0, 1, 0], π / 7))[1:2, 1:2]'
  p = Point.(Tuple.(eachcol(R * hcat(collect.(sincos.((1:n) * 2π / n))...))))

  origin(112, 146)

  sethue("white")
  poly(p * 120, :fillstroke)

  setmode("clear")
  poly(p * 80, :fillstroke)

  n = 4
  s(r) = [Point((iseven(i) ? 1 : r) .* sincos(i * π / n)) for i in 1:2n]

  origin(150, 110)
  setmode("clear")
  poly(s(0.25) * 140, :fillstroke)

  origin(160, 100)
  setmode("over")
  sethue("white")
  poly(s(0.16) * 100, :fillstroke)

  finish()
end

main()
```

上記のコードを実行すると`favicon.svg`が生成されるのでInkscapeを用いてPNGに変換し、ImageMagickを用いてICOに変換する。

```sh
for size in 16 32 48 64 128 256; do
  inkscape favicon.svg -o icon-${size}.png -w ${size} -h ${size}
done

magick icon-16.png icon-32.png icon-48.png icon-64.png icon-128.png icon-256.png favicon.ico

rm icon-*.png
```

## Eratosthenesの篩

特に工夫をしなければ以下のような実装になるはず。`m`が`p^2`から動き始めるのは、`p^2`より小さい合成数は`p`より小さい素数ですでに割られているはずだからである。

```julia
function sieve(x)
  flags = fill(true, x)
  flags[1] = false
  sqrtx = floor(Int, sqrt(x))
  for p in 2:sqrtx
    !flags[p] && continue
    for m in p^2:p:x
      flags[m] = false
    end
  end
  findall(flags)
end

begin
  @assert sieve(10) == [2, 3, 5, 7]
end
```

2の倍数判定を省略すると以下のようになる。`flags[j]`に`2j+1`が素数かどうかのフラグが格納されている。`(2j+1)^2 == 2(2j*(j+1)) + 1`なので、`m`は`2j*(j+1)`から動き始める。

```julia
function sieve1(x)
  flags = fill(true, (x - 1) ÷ 2)
  sqrtx = floor(Int, sqrt(x))
  for j in 1:sqrtx÷2
    !flags[j] && continue
    for m in (2j*(j+1)):(2j+1):lastindex(flags)
      flags[m] = false
    end
  end
  v = 2findall(flags) .+ 1
  pushfirst!(v, 2)
end
```

2,3,5の倍数まであらかじめ除いておくと、30でわった余りが1,7,11,13,17,19,23,29の8通りだけ気にすればよい（[参考](https://qiita.com/peria/items/54499b9ce9d5c1e93e5a)）。\(2^8\)は十分整数型で表せるので、各数が合成数かどうかのフラグをbit列として整数型に格納して処理できる（つまり30でわった商それぞれに`UInt8`型の値が1つずつ対応する。例えば`[0b00001000, 0b01000000]`は`13`と`53`にフラグが立っている）。

1. **篩い始めの位置** \
素数\(p\)で篩にかけていく際、

$$p = 30q + r_j,\quad r_j \in \{1, 7, 11, 13, 17, 19, 23, 29\}$$

に対して篩い始めの\(p^2\)が格納されている場所は
$p^2 = 30(30q^2 + 2q r_j + \lfloor r_j^2 / 30 \rfloor) + (r_j^2 \mod 30)$
から`30q^2 + 2q * r[j] + r[j]^2 ÷ 30`番目の`UInt8`の`r[j]^2 % 30`ビット目と分かる。

2. **篩う処理** \
素数\(p = 30q + r_j\)に\(n = 30q_n + r_k\)をかけた合成数\(pn\)を篩うことを考える。\(pn = 30q_{pn} + (r_j r_k \mod 30)\)となる（ただし\(q_{pn} = \lfloor pn / 30 \rfloor\)）ので、`flags[q_pn]`の`r[j] * r[k] % 30`に対応するビットを`0`にすればよい（`r[j] * r[k] % 30`が再び`r`に含まれることは\(\mathbb{Z}_{30}\)の乗法群の構造が保証してくれる）。`r[j] * r[k] % 30`を\(8\times 8\)行列`r_rr[j,k]`で取り出せるようにしておくと同じ計算を何度もせずに済む。

3. **次に篩う位置** \
\(pn\)を篩ったら次は\(pn'\)を篩いたい。ここで\(n' = 30q_n + r_{k+1}\)は\(30q + \{1,7,11,13,17,19,23,29\}\)で表される整数で\(n\)の次に小さいものである（ただし\(r_{k+1} \in \{7,11,13,17,19,23,29,31\}\)）。そのためには\(q_{pn'} = \lfloor pn' / 30 \rfloor\)を得る必要があるが、これは差分を計算するとよい：

$$\begin{aligned}
\lfloor pn'/30 \rfloor - \lfloor pn/30 \rfloor &= \left\lfloor \dfrac{(30q + r_j)(30q_n + r_{k+1})}{30} \right\rfloor - \left\lfloor \dfrac{(30q + r_j)(30q_n + r_{k})}{30} \right\rfloor \\[5pt]
& = q(r_{k+1} - r_k) + \left\lfloor \dfrac{r_j r_{k+1}}{30} \right\rfloor - \left\lfloor \dfrac{r_j r_k}{30} \right\rfloor.
\end{aligned}$$

\(r_{k+1} - r_k\)を`dr[k]`に、\(\left\lfloor \dfrac{r_j r_{k+1}}{30} \right\rfloor - \left\lfloor \dfrac{r_j r_k}{30} \right\rfloor\)を`dqrr[j,k]`にそれぞれ格納しておくとやはり計算を節約できる。ビット位置については`k = (k+1) % 8`でよい。

以上の内容をコードに落とすと以下のようになる（Juliaが1-indexedであるため上の疑似コードからインデックスが若干ずれる）。また`r,dr,dqrr,r_rr`は長さが決まっていて頻繁にアクセスするので`StaticArrays.SArray`として定義することで大幅に高速化できる。
```julia
using StaticArrays

function pow2_ind(x)
  for j in 0:7
    if x == 1 << j
      return j
    end
  end
end

function sieve2(x)
  r = @SVector [1, 7, 11, 13, 17, 19, 23, 29]
  all1::UInt8 = (1 << length(r)) - 1 # 0b11111111
  dr = @SVector [mod(r[mod1(j + 1, end)] - r[j], 30) for j in 1:8] # if we replace `1:8` with `eachindex(r)`, the code somehow fails
  r1 = r .+ dr
  dqrr = @SMatrix [
    fld(r[j] * r1[k], 30) - fld(r[j] * r[k], 30)
    for j in 1:8, k in 1:8
  ]

  r_ind = Dict([r[j] => (j - 1) for j in eachindex(r)]...)
  r_rr = @SMatrix [
    UInt8(all1 ⊻ (1 << r_ind[r[j]*r[k]%30]))
    for j in 1:8, k in 1:8
  ]

  flags = fill(all1, cld(x, 30))
  rx = x % 30
  if rx != 0
    for j in eachindex(r)
      rx >= r[j] && continue
      flags[end] = UInt8((1 << (j - 1)) - 1)
      break
    end
  end
  flags[1] ⊻= 0b00000001 # 1 is not a prime

  q_sqrtx = floor(Int, sqrt(x)) ÷ 30
  l_flags = length(flags)
  for q in 0:q_sqrtx
    flag = flags[q+1]

    while flag != 0
      j = pow2_ind(flag & (-flag)) # p == 30q + r[j+1]
      m = r[j+1]
      q_pn = q * (30q + 2m) + m^2 ÷ 30 # initially q_pn == p^2 ÷ 30
      k = j

      while q_pn < l_flags
        flags[q_pn+1] &= r_rr[j+1, k+1]
        q_pn += q * dr[k+1] + dqrr[j+1, k+1]
        k = (k + 1) & 7 # coincidentally(?), the order of the multiplicative group of Z30 is 2^3-1
      end

      flag &= flag - 1 # eliminate the right-most 1 in flag
    end
  end

  primes = [2, 3, 5]
  for q in eachindex(flags), j in eachindex(r)
    if flags[q] & (1 << (j - 1)) != 0
      push!(primes, 30(q - 1) + r[j])
    end
  end
  primes
end
```

## 継続渡し

Juliaで継続渡しをするときはdo文を使うとシナジーを感じられる（けど`k`を第一引数に置かないといけないのでラッパー関数をdefault引数で済ませるというのがちょっとやりづらい）。以下は階乗を継続渡しで計算するコード。

```julia
factorial(k=identity; n) =
  if n == 0
    k(1)
  else
    factorial(; n=n - 1) do x
      k(n * x)
    end
  end

begin
  @assert factorial(n=6) == 720
end
```

## フィボナッチ数

関数型言語的に書くと引数でやりくりすることになる。
```julia
fib(n, a=0, b=1) = n == 0 ? a : fib(n - 1, b, a + b)

begin
  @assert fib.(1:5) == [1,1,2,3,5]
end
```

## Ricciスカラーの計算

計量$g_{ij}$が与えられれば定義に従ってChristoffel記号

$$\Gamma^i_{\;jk} = \frac{1}{2}g^{il}(g_{lj,k}+g_{kl,j}-g_{jk,l})$$

が得られる（手計算の場合は作用$S = \int \dd{t} g_{ij} \dot{x}^i \dot{x}^j$から測地線方程式を導き、その係数からChristoffel記号を読み取る方が幾分か楽 [参考](https://mathlog.info/articles/S3DLwaHTMpkp3lf1qtZu)）。以下定義を列挙する。

- Riemann曲率テンソル : $R^i{}_{jkl} = \partial_k {\Gamma^i}_{jl} - \partial_l {\Gamma^i}_{jk} + {\Gamma^i}_{mk} {\Gamma^m}_{jl} - {\Gamma^i}_{ml} {\Gamma^m}_{jk}$

- Ricciテンソル : $R_{ij} = {R^k}_{ikj}$

- Ricciスカラー : $S = \tr R$


Symbolics.jlを使えば形式的な計算が可能になる。

```julia
using Symbolics
using LinearAlgebra

D = Symbolics.derivative

function curvature(xi, g)
  ginv = inv(g)

  Gamma(k, i, j) =
    (1 // 2) * sum([ginv[k, n] * (
      D(g[n, i], xi[j]) +
      D(g[n, j], xi[i]) -
      D(g[i, j], xi[n])
    ) for n in 1:2])

  R(i, j, k, l) =
    D(Gamma(i, j, l), xi[k]) -
    D(Gamma(i, j, k), xi[l]) +
    sum([Gamma(n, j, l) * Gamma(i, n, k) -
         Gamma(n, j, k) * Gamma(i, n, l)
         for n in 1:2])

  Ricc(j, k) = sum([R(n, j, n, k) for n in 1:2])
  RiccM = [Ricc(i, j) for i in 1:2, j in 1:2] |> simplify

  simplify(tr(ginv * RiccM))
end

@variables L θ ϕ ρ τ r u t

println("curvature of S^2: ", curvature([θ, ϕ], Diagonal([L^2, L^2 * sin(θ)^2])))
println("curvature of H^2: ", curvature([ρ, ϕ], Diagonal([L^2, L^2 * sinh(ρ)^2])))
println("curvature of AdS_2: ", curvature([ρ, τ], Diagonal([-L^2 * cosh(ρ)^2, L^2])))
println("curvature of dS_2: ", curvature([ρ, τ], Diagonal([-L^2, L^2 * cosh(τ)^2])))
println("curvature of AdS_2 (static coord.): ", curvature([τ, r], Diagonal([-L^2 * (r^2 + 1), L^2 / (r^2 + 1)])))
println("curvature of AdS_2 (conformal coord.): ", curvature([τ, θ], Diagonal([-L^2 / cos(θ)^2, L^2 / cos(θ)^2])))
println("curvature of AdS_2 (poincare coord.): ", curvature([t, u], Diagonal([-L^2 * u^2, L^2 / u^2])))
```