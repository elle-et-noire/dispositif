---
title: 対称多項式環
publish: 2026-04-27
lastUpdate: 2026-04-28
tags:
- math
---

## 対称多項式環

$X = (x_1,\ldots,x_N)$のなす整数係数多項式であって、$N$次対称群の元による変数の置換の元で不変なもののなす環（対称多項式環）$\Lambda_N \subset \mathbf{Z}[X]$を導入する。この環を生成する多項式の集まりとして以下のような形のものが知られている。

- 冪和対称多項式 : $p_n = \sum_{i=1}^N x_i^n$

	- 冪和対称多項式は有理数係数において対称多項式環を（代数的に）生成する:$\Lambda_N\otimes \mathbf{Q} = \mathbf{Q}[p_1,p_2,\ldots].$

- 基本対称多項式 : $e_r = \sum_{1\le i_1 < \cdots < i_r\le N} x_{i_1}\cdots x_{i_r}$

	- 整数係数において対称多項式環を代数的に生成する
	- $e_0 = 1,\ e_1 = p_1,\ e_N = \det X$

	- $e_{r<0} = e_{r>N} = 0$

- 完全対称多項式 : $h_r = \sum_{1\le i_1 \le \cdots \le i_r\le N} x_{i_1}\cdots x_{i_r}$

	- 整数係数において対称多項式環を代数的に生成する
	- $h_0 = 1,\ h_1=p_1$

	- $h_{r<0} = 0$

## Schur多項式

以下のようにしてSchur多項式を定める:
$$s_\lambda(X) \coloneqq s_\lambda(x_1,\ldots,x_N) = \frac{\det_{1\le i,j\le N}(x_i^{\lambda_j+N-j})}{\det_{1\le i,j\le N} (x_i^{N-j})}.$$
ただし$\lambda = (\lambda_1,\ldots,\lambda_N)$は分割で、非増加非負整数列で表される:$\lambda_1\ge \lambda_2\ge \cdots\ge \lambda_N \ge 0.$長さが$N$未満の分割についても、ゼロ埋めによって長さ$N$の分割と見なして同様に定義される。長さが$N$より大きい分割については$0$と定義される。分母は（符号を除いて）Vandermonde行列式であり、差積として表される:
$$\Delta(X) \coloneqq \prod_{1\le i<j\le N} (x_j-x_i) = \det_{1\le i,j\le N} (x_i^{j-1}).$$Schur多項式は対称多項式環の$\mathbf{Z}\hspace{-0.3em}$-加群としての基底をなす。

## 母函数による関係式

基本対称多項式は
$$E(t) = \sum_{k=0}^\infty e_k t^k = \prod_i (1+x_it)$$
を母函数とする。また完全対称多項式の母函数は
$$H(t) = \sum_{k=0}^\infty h_kt^k = \prod_i (1-x_it)^{-1}$$
である。母函数の表示から
$$E(-t)H(t) = 1$$
となり、一方で$t$の係数をつぶさに見れば
$$(\mathrm{LHS}) = \sum_{n=0}^\infty \qty(\sum_{i=0}^n(-1)^i e_i h_{n-i}) t^n$$
となるから
$$\sum_{i=0}^n (-1)^ie_i h_{n-i} = \delta_{n,0}$$
が成り立つ。$e_0=h_0=1$と合わせて、基本対称多項式を与えることと完全対称多項式を与えることは同値であることが分かる。

## Newton恒等式

基本対称多項式と冪和対称多項式の間に
$$k e_k = \sum_{i=1}^k (-1)^{i-1} e_{k-i} p_i$$
という関係が成り立つことが以下のようにして分かる。基本対称多項式の母函数を展開すると冪和対称多項式が現れる:
$$\log E(t) = \sum_i \log(1 + x_i t) = \sum_i \sum_{k=1}^\infty (-1)^{k-1} \frac{(x_i t)^k}{k} = \sum_{k=1}^\infty (-1)^{k-1} \frac{p_k}{k} t^k.$$
両辺を$t$で微分すると
$$\frac{E'(t)}{E(t)} = \sum_{k=1}^\infty (-1)^{k-1} p_k t^{k-1}$$
となり、分母を払って$E(t)$の定義を開くと
$$\sum_{j=1}^\infty j e_j t^{j-1} = \qty( \sum_{m=0}^\infty e_m t^m ) \qty( \sum_{i=1}^\infty (-1)^{i-1} p_i t^{i-1} )$$
となる。この式の両辺で$t^{k-1}$の係数を比較すると、右辺では$m=k-i$のところが$t^{k-1}$の係数に寄与するから、Newton恒等式が成り立つことが分かる。

## Jacobi-Trudi公式

Schur多項式は完全対称多項式の線形結合で表される:
$$s_\lambda = \det_{1 \le i,j \le \mathrm{length}(\lambda)}(h_{\lambda_i - i + j}).$$
このことは以下のようにして分かる。変数を$X=(x_1,\ldots,x_N)$とし、分割は（ゼロ埋めによって）一般性を失わずに$\lambda = (\lambda_1,\ldots,\lambda_N)$とおける。すると$N$次正方行列$H,E$を以下のように定義できる:
- $H_{i,k} = h_{\lambda_i - i + k}(X)$

- $E_{k,j} = (-1)^{N-k} e_{N-k}(X \setminus \{x_j\})$

また$A=HE$とおく。$A_{ij}$が具体的にどうなるか考えたい。そこで完全対称多項式と基本対称多項式の母函数の積を考える:
$$\left( \sum_{p=0}^\infty h_p(X) t^p \right) \left( \sum_{q=0}^{N-1} (-1)^q e_q(X \setminus \{x_j\}) t^q \right) = \frac{\prod_{m \ne j} (1 - x_m t)}{\prod_{m=1}^N (1 - x_m t)} = \frac{1}{1 - x_j t} = \sum_{m=0}^\infty x_j^m t^m.$$
両辺の$t^m$の係数を比較し、また左辺で$q = N-k$とおくと
$$\sum_{k=1}^N h_{m - N + k}(X) (-1)^{N-k} e_{N-k}(X \setminus \{x_j\}) = x_j^m$$
となることが分かる。$m=\lambda_i-i+N$の場合を考えると
$$A_{i,j} = \sum_{k=1}^N H_{i,k} E_{k,j} = \sum_{k=1}^N h_{\lambda_i - i + k}(X) (-1)^{N-k} e_{N-k}(X \setminus \{x_j\}) = x_j^{\lambda_i-i+N}$$
となり、これはまさにSchur多項式の定義における分子の行列式の$(i, j)$成分に他ならない。ここで$\lambda$は任意だったので、特に$\lambda=(0,\ldots,0)$の場合について考えると、
- $\det A = \det (x_i^{N-j})$

- $H_{i,k} = h_{k-i}(X)$となり、$h_0=1$および$h_{r<0} = 0$より$H$は対角成分がすべて$1$の上三角行列となって$\det H = 1$

より
$$\det E = \det_{1\le i,j\le N}(x_j^{N-j})$$
となることが分かる。結局$\det A = \det H \cdot \det E$は
$$\det_{1 \le i,j \le N} (x_i^{\lambda_j + N - j}) = \det_{1 \le i,j \le N}(h_{\lambda_i - i + j}) \cdot \det_{1 \le i,j \le N}(x_i^{N-j})$$
に落とし込まれ、Jacobi-Trudi公式が成り立つことが分かった。

## Jacobiの小行列式定理

$n \times n$の正則行列$A$とその逆行列$B = A^{-1}$を考える。要素数$k$の集合$I,J \subset \{1, \dots, n\}$に対して、全体集合$\{1,\ldots,n\}$からの補集合をそれぞれ$I^\mathrm{c}, J^\mathrm{c}$とし、$I,J,I^\mathrm{c},J^\mathrm{c}$はそれぞれ昇順とする。このとき
$$\det(B_{I, J}) = (-1)^{\sum I + \sum J} \frac{\det(A_{J^\mathrm{c}, I^\mathrm{c}})}{\det(A)}$$
が成り立つ。このことは以下のようにして分かる。まず$I = J = \{1, 2, \dots, k\}$の場合を考える。このとき、補集合は$I^\mathrm{c} = J^\mathrm{c} = \{k+1, \dots, n\}$となる。また行列$A$と$B$を、サイズ$k$および$n-k$のブロックに分割する:
$$A = \begin{pmatrix} A_{11} & A_{12} \\ A_{21} & A_{22} \end{pmatrix}, \quad B = \begin{pmatrix} B_{11} & B_{12} \\ B_{21} & B_{22} \end{pmatrix}.$$
つまり$B_{11} = B_{I,J}$および$A_{22} = A_{J^\mathrm{c},I^\mathrm{c}}$である。$A B = I_n$より
- $A_{11}B_{11} + A_{12}B_{21} = I_k$

- $A_{21}B_{11} + A_{22}B_{21} = 0$

となる。これを用いると
$$\begin{pmatrix} A_{11} & A_{12} \\ A_{21} & A_{22} \end{pmatrix} \begin{pmatrix} B_{11} & 0 \\ B_{21} & I_{n-k} \end{pmatrix} = \begin{pmatrix} I_k & A_{12} \\ 0 & A_{22} \end{pmatrix}$$
が成り立つことが分かる。上式の両辺の行列式を取ると
$$\det(A) \cdot \det(B_{11}) \cdot 1 = 1 \cdot \det(A_{22})$$
となり、$I=J=\{1,2,\ldots,k\}$の場合にJacobiの小行列式定理が成り立つことが分かった。

一般の場合については行や列の入れ替えを考えればよい。
- $P_I$：行を入れ替えて$I$を上部$k$行に集める置換行列
- $P_J$：列を入れ替えて$J$を左部$k$列に集める置換行列

をそれぞれ定める。$\tilde{B} = P_I B P_J^\mathrm{T}$とすると$\tilde{B}_{11}=B_{I,J}$となる。このとき
$$\tilde{A} = \tilde{B}^{-1} = (P_I B P_J^\mathrm{T})^{-1} = P_J B^{-1} P_I^\mathrm{T} = P_J A P_I^\mathrm{T}$$
となるから、$\tilde{A}_{22}$に対応するのは$A_{J^\mathrm{c},I^\mathrm{c}}$である。符号について、$i_1$行目を$1$行目に移動するには$i_1-1$回の置換が必要と考えると、$I$を$\{1,\ldots,k\}$に移すには
$$\sum_{r=1}^k (i_r - r) = \sum I - \frac{k(k+1)}{2}$$
回の置換が必要である。$J$についても同様なので、結局$\sum I+\sum J$が置換の偶奇となり、一般の場合にもJacobiの小行列式定理が成り立つことが分かった。

## 双対Jacobi-Trudi公式

Schur多項式は基本対称多項式の線形結合でも表される:
$$s_\lambda = \det_{1 \le j,k \le \lambda_1}(e_{\lambda^\mathrm{T}_k - k + j}).$$
ここで$\lambda$は$\lambda_1+\lambda_1^\mathrm{T} = N$を満たすものとする（必要なら変数の数$N$を$\lambda_1+\lambda_1^\mathrm{T}$となるように増やし、あとから増やした変数に$0$を代入すればよい）。このことは以下のようにして分かる。$N$次正方行列
- $H_{i,j} = h_{i-j}$

- $E_{i,j} = (-1)^{i-j}e_{i-j}$

を定める。ただし$i,j\in \{0,1,\ldots,N-1\}$とする。関係式$\sum_{k=0}^n (-1)^ke_k h_{n-k} = \delta_{n,0}$は
$$HE = I_N$$
を意味する。また$H,E$の対角成分はすべて$1$なので$\det H = \det E = 1$である。

分割$\lambda = (\lambda_1,\ldots,\lambda_n)$に対して
- $U = (\lambda_i + n - i)_{1 \le i \le n}$

	- 下の方からYoung図形の縁に沿って進んでいくことを考えると、$\lambda_i$は何回横に進んだか、$n-i$は何度縦に進んだかを表し、$\lambda_i-i+n$は$i$行目の腕を縦に進む道が全体の経路の何番目に位置するかを表す。
- $V = (n - i)_{1 \le i \le n}$

を定める。このときJacobi-Trudi公式からSchur多項式は
$$s_\lambda = \det_{1\le i,j\le n} (h_{\lambda_i-i+j}) = \det_{i,j} (H_{U_i,V_j})$$
と表される。ところで全体集合$\{0,\ldots,N-1\}$における$U,V$の補集合は以下のようになる:
- $V^\mathrm{c} = (n+j-1)_{1\le j\le N-n}$

- $U^\mathrm{c} = (n+k-1-\lambda_k^\mathrm{T})_{1\le k\le N-n}$

	- 同じく分割$\lambda$を表すYoung図形の縁を下からたどる経路において、$n-\lambda_k^\mathrm{T}$が何度縦に進んだか、$k-1$が何度横に進んだかを表し、$k$番目の足を横に進む道が全体の経路の何番目に位置するかを表す。また$U_{i+1}^\mathrm{c}-U_i^\mathrm{c} = 1-\lambda_{i+1}^\mathrm{T}+\lambda_i^\mathrm{T}\ge 1$より$U^\mathrm{c}$は狭義単調増加列である。

Jacobiの小行列式定理と$\det H=1$から
$$\det(H_{U, V}) = (-1)^{\sum U + \sum V} \det(E_{V^\mathrm{c}, U^\mathrm{c}})$$
となる（$U,V$は昇順ではないが、どちらも昇順になるように並べ直すと$(-1)^{\frac{n(n-1)}{2}}$の符号がそれぞれ出てきて打ち消すので結局上式が成り立つ）。ここで
$$E_{V^\mathrm{c}_j,U^\mathrm{c}_k} = (-1)^{\lambda_k^\mathrm{T}-k+j} e_{\lambda_k^\mathrm{T}-k+j}$$
となり、符号を前に出せば
$$\det(E_{V^\mathrm{c}, U^\mathrm{c}}) = (-1)^{\sum V^\mathrm{c} - \sum U^\mathrm{c}} \det_{1 \le j,k \le \lambda_1}(e_{\lambda^\mathrm{T}_k - k + j})$$
となる。これをJacobiの小行列式定理の式に代入し、$\sum U+\sum U^\mathrm{c} = \sum V+\sum V^\mathrm{c}$から符号が消えることに気をつければ双対Jacobi-Trudi公式が成り立つことが分かる。

## 基本対合

### 定義

基本対合$\omega$は環$\Lambda_N$の代数としての自己準同型
$$\omega(e_k) = h_k$$
として定義される。関係式$\sum_{i=0}^n (-1)^i e_i h_{n-i} = 0$から$\omega(h_k)=e_k$も成り立ち（というのは、帰納的に
$$\begin{aligned}\omega(h_n) &= \sum_{i=1}^n (-1)^{i+1} \omega(e_i)\omega(h_{n-i}) \\
&= \sum_{j=0}^{n-1}(-1)^{n-j+1} h_{n-j} e_j \quad (j=n-i)\\
&= e_n\end{aligned}$$
となることから分かる）、$\omega^2 = \operatorname{id}$が保証される。つまり$\omega$は代数としての自己同型である。

### 冪和対称多項式への作用

基本対合は冪和対称多項式に対して
$$\omega(p_k) = (-1)^{k-1} p_k$$
のように作用する。このことは以下のようにして分かる。完全対称多項式の母函数の対数を取ると
$$\log H(t) = -\sum_i \log(1 - x_i t) = \sum_i \sum_{k=1}^\infty \frac{(x_i t)^k}{k} = \sum_{k=1}^\infty \frac{p_k}{k} t^k$$
となり、また基本対称多項式の母函数の対数を取ると
$$\log E(t) = \sum_i \log(1 + x_i t) = \sum_i \sum_{k=1}^\infty (-1)^{k-1} \frac{(x_i t)^k}{k} = \sum_{k=1}^\infty (-1)^{k-1} \frac{p_k}{k} t^k$$
となる。ところで$\omega(E(t)) = H(t)$から$\omega(\log E(t)) = \log H(t)$が成り立つため、冪和対称多項式に対する作用が分かる。

### Schur多項式への作用

基本対合はSchur多項式に対して
$$\omega(s_\lambda) = s_{\lambda^\mathrm{T}}$$
のように作用する。このことは以下のようにして分かる。まずそもそもSchur多項式は、分割$\lambda = (\lambda_1,\ldots,\lambda_n)$に対してJacobi-Trudi公式により
$$s_\lambda = \det_{1 \le i,j \le n}(h_{\lambda_i - i + j})$$
と表される。ここへ基本対合が作用すると
$$\omega(s_\lambda) = \det_{1 \le i,j \le n}(\omega(h_{\lambda_i - i + j})) = \det_{1 \le i,j \le n}(e_{\lambda_i - i + j})$$
となる。上式の右辺は双対Jacobi-Trudi公式
$$s_{\mu} = \det_{1 \le i,j \le \mu_1}(e_{\mu^\mathrm{T}_i - i + j})$$
において$\mu = \lambda^\mathrm{T}$とおいたものであり、こうしてSchur多項式への基本対合の作用が分かる。

## 双対Newton恒等式

Newton恒等式の両辺で基本対合を取れば
$$k h_k = \sum_{i=1}^k h_{k-i} p_i$$
が成り立つことが分かる。

## Cauchy和公式

$X = (x_1,\ldots,x_N), Y=(y_1,\ldots,y_M)$について
$$\prod_{i=1}^N \prod_{j=1}^M (1-x_iy_j)^{-1} = \sum_\lambda s_\lambda(X) s_\lambda(Y)$$
が成り立つ。このことは以下のようにして分かる。まず一般性を失わずに（ゼロ埋めによって）$N=M$として正方行列の公式を使えるようにする。左辺に関連するCauchy行列式は差積$\Delta$を用いて
$$\det_{1\le i,j\le N}\left(\frac{1}{1-x_iy_j}\right) = \frac{\prod_{i<j}(x_j-x_i)(y_j-y_i)}{\prod_{i,j}(1-x_iy_j)} = \frac{\Delta(X)\Delta(Y)}{\prod_{i,j}(1-x_iy_j)}$$
となることが、$x_iy_j=1$は極を与えること、$x_i=x_j$は零点を与えること、および次数、係数の比較から分かる。一方でこのCauchy行列の各成分を
$$\frac{1}{1-x_iy_j} = \sum_{k=0}^\infty x_i^k y_j^k$$
のように級数展開する。たとえば上式は$A=(x_i^k)$と$B=(y_j^k)$の積$AB^\mathrm{T}$の$(i,j)$成分とみなせる。ここでCauchy-Binetの公式を使って$\det AB^\mathrm{T}$を$N$次小行列の行列式の積の和に展開すると
$$\det_{1\le i,j\le N}\left(\frac{1}{1-x_iy_j}\right) = \sum_{k_1 > \cdots > k_N \ge 0} \det(x_i^{k_j}) \det(y_i^{k_j})$$
となる。ここで$\lambda_j = k_j-N+j$によって分割$\lambda = (\lambda_1,\ldots,\lambda_N)$を定めると、この小行列式はSchur多項式に他ならないことが分かる:
$$\det_{i,j}(x_i^{k_j}) = \det(x_i^{\lambda_j+N-j}) = (-1)^{\frac{N(N-1)}{2}}s_\lambda(X)\Delta(X).$$
従って
$$\frac{\Delta(X)\Delta(Y)}{\prod_{i,j}(1-x_iy_j)} = \sum_\lambda \bigl(s_\lambda(X)\Delta(X)\bigr) \bigl(s_\lambda(Y)\Delta(Y)\bigr)$$
となり、両辺を$\Delta(X)\Delta(Y)$で割ればCauchy和公式が得られる。

## 双対Cauchy和公式

$X = (x_1,\ldots,x_N), Y=(y_1,\ldots,y_M)$について
$$\prod_{i=1}^N \prod_{j=1}^M(1+x_iy_j) = \sum_\lambda s_\lambda(X) s_{\lambda^\mathrm{T}}(Y)$$
が成り立つ。このことは以下のようにして分かる。ここでも一般性を失わずに（ゼロ埋めによって）$N=M$とできるのでしておく。まずCauchy和公式の左辺の対数を取って展開すると冪和対称多項式が登場する:
$$\log \prod_{i,j}(1-x_iy_j)^{-1} = \sum_{i,j} \sum_{k=1}^\infty \frac{(x_iy_j)^k}{k} = \sum_{k=1}^\infty \frac{p_k(X)p_k(Y)}{k}.$$
つまりCauchy和公式は
$$\exp\left( \sum_{k=1}^\infty \frac{p_k(X)p_k(Y)}{k} \right) = \sum_\lambda s_\lambda(X) s_\lambda(Y)$$
が成り立つと言っている。ここで$Y$のなす対称多項式環に関する基本対合$\omega$を両辺に作用させると
$$\exp\left( \sum_{k=1}^\infty (-1)^{k-1}\frac{p_k(X)p_k(Y)}{k} \right) = \sum_\lambda s_\lambda(X) s_{\lambda^\mathrm{T}}(Y)$$
となる。この左辺の指数関数の中身は
$$\sum_{i,j} \sum_{k=1}^\infty (-1)^{k-1}\frac{(x_iy_j)^k}{k} = -\log \prod_{i,j}(1+x_iy_j)^{-1} = \log \prod_{i,j} (1+x_iy_j)$$
であるから、双対Cauchy和公式が示された。
