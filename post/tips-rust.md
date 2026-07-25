---
title: Tips for Rust
publish: 2025-02-03
---

[The Rust Programming Language 日本語版](https://doc.rust-jp.rs/book-ja/title-page.html)を読めばすべて書いてある。

## 環境周り

```sh
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
rustc --version
rust update
rust self uninstall
```

## ビルド

単一のファイルをコンパイルしたり、プロジェクトを作成してビルドしたりできる。
```sh
rustc main.rs
cargo new hello-world && cd $_
cargo build
cargo run
cargo check
```

## 入出力

入力の際は例外処理も行う。
```rust
use std::io;

fn main() {
    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .expect("Failed to read line");
    println!("{}", input);
}
```

## 乱数

```rust
use rand::Rng;

fn main() {
    let secret_number = rand::thread_rng().gen_range(1..101);
    println!("{}", secret_number);
}
```

## 比較

```rust
use std::cmp::Ordering;

fn main() {
    let a = 1;
    let b = 2;
    match a.cmp(&b) {
        Ordering::Less => println!("a is lesser than b"),
        Ordering::Equal => println!("a is equal to b"),
        Ordering::Greater => println!("a is greater than b"),
    }
}
```

## 所有権

不変なデータは`let`を、可変なデータは`let mut`を用いて束縛する。

`let b = a;`と書くと`a`が束縛していたデータの所有権が`b`に移り、以降`a`は無効となる。`let mut`でも同様。

`let b = &a;`と書くと`a`の不変な参照を渡すことになる。この場合`b`は`a`の所有権を借用しているだけなので、`b`も`a`も有効である。また不変な参照はいくつでも作れる。

`let b = &mut a;`と書くと`a`の可変な参照を渡すことになる。そもそも`a`が可変な変数でなければならない。可変な参照は同時に1つしか存在できず、また不変な参照は存在を許されない。