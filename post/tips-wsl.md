---
title: Tips for WSL
publish: 2024-12-19
lastUpdate: 2025-04-17
tags:
- terminal
---

いくつかはWSLに特有であり、いくつかは普遍的にLinuxで使える。

## npmパッケージアップデート

[参考](https://qiita.com/sugurutakahashi12345/items/df736ddaf65c244e1b4f)

```sh
npx -p npm-check-updates -c "ncu" # check for updates
npx -p npm-check-updates -c "ncu -u" # update package.json
npm i
```

## サーバーを立てる / 切る

```sh
npm run dev &
```
とすることでサーバーを立てたまま作業できる。

サーバーを切る際には
```sh
ps aux | grep next
```
から該当のプロセスを探して
```sh
kill -9 000000
```
で切る。プロセス名が分かっている場合は`pkill`を用いる。

立てたプロセスとは違うプロセスでサーバーが動いている場合もある。Next.jsの場合は`next-server (v15.1.1)`のような名前のプロセスを切る。


## 直前のフォルダへ移動

直前のフォルダへ戻るだけなら以下のコマンドが簡単。
```sh
cd -
```
文字通り直前のフォルダへ戻る。つまりこの操作は対合である。

`alias`コマンドでエイリアスに`-=cd -`などと登録されていることが確認できる場合は`-`だけでよい。

2つ以上前へ戻るには`cd -2`としたり`popd`を用いたりする。


## 作ったフォルダへ移動

```sh
mkdir uouo
cd $_
```
で`uouo`へ移動できる。フォルダ名が特殊文字を含む場合は`cd "$_"`とする。

## 画像の確認

ターミナルで作業していて画像を確認したくなった際は[sxiv](https://manpages.ubuntu.com/manpages/xenial/man1/sxiv.1.html)を用いる。
```sh
sudo apt install sxiv
sxiv uo.png
```

PDFをターミナルから確認したくなったとき、WSLならWindowsのPDFビューワーを起動するという選択肢がある。SumatraPDFならPDFの変更を検知してくれるため、TeXなどで資料を作る際の見た目の確認が容易である。以下の文言を起動時に読み込まれるファイル（`.bashrc`とか`.zshrc`とか）に書いておくと便利。
```sh
alias sumatra="/mnt/c/Users/lomega/AppData/Local/SumatraPDF/SumatraPDF.exe"
```

Ubuntu上で使えるPDFビューワーとして[zathura](https://pwmt.org/projects/zathura/)がある。
```sh
sudo apt install zathura
zathura uo.pdf
```
SumatraPDFと同じくPDFの変更を検知してくれる。
よい点として、VimのキーバインドでPDFをスクロールできる（SumatraPDFは`j`,`k`によるスクロールには対応している）。`q`で抜けられる。`--fork`オプションでバックグラウンドで起動できる。ファイル名をTabで補完するときにPDFしか候補に現れないのが地味に便利（LaTeXで作業しているときの`out`の中などはごちゃごちゃしがちなので）。

## SSH接続でXを転送する

- sshのconfigで`ForwardX11 yes`を設定する
- 接続時にX転送を許可する: `ssh -X uouo`

のいずれかを行う（[参考](https://kazuhira-r.hatenablog.com/entry/2021/01/14/234921)）。前者を設定しておく方が便利。

なお、手元の環境では、WSLからSSH接続する分には`ForwardX11 yes`だけで十分だが、Windows TerminalからSSH接続する際には加えて`ForwardX11Trusted yes`も設定する必要があった（[参考](https://obel.hatenablog.jp/entry/20230207/1675713600)）。これを設定しておいてWindows Terminal上で`code --folder-uri vscode-remote://ssh-remote+uouo/home/lomega/`のように接続すると、VSCodeをRemote SSH経由で起動でき、ターミナルでX11を利用した操作（主にgnuplot）も可能となる。


## 解凍

`tar.gz`ファイルを解凍する場合：
```sh
tar -zxvf xxxx.tar.gz
```

[参考](https://qiita.com/supersaiakujin/items/c6b54e9add21d375161f)


## カーネルのバージョン確認

[参考](https://qiita.com/h_tyokinuhata/items/0683e0132645bc36d9d3)

`uname`(unix name?)コマンドでハードウェア、カーネル、OSの情報を得られる。
```sh
uname -a
```

OSの情報を詳しく確認するには`/etc/os-release`を確認する。
```sh
cat /etc/os-release
```

## ファイルの種類

`file`コマンドを用いることで、例えば実行ファイルがどのような環境（OS、CPU）で実行できるかを表示できる。

## WSL2のディスクサイズ最適化

[参考](https://zenn.dev/anko/articles/976d904e53d87e#wsl2-%E3%81%AE%E3%83%87%E3%82%A3%E3%82%B9%E3%82%AF%E3%82%B5%E3%82%A4%E3%82%BA%E3%82%92%E6%9C%80%E9%81%A9%E5%8C%96%E3%81%99%E3%82%8B)

WSL上でファイルを削除してもエクスプローラーで確認すると容量が解放されていないことが分かります。ディスクイメージを最適化するには以下のようにします。
```sh
wsl --shutdown
diskpart
```
でdiskpartのウィンドウが出るので移動します。以下の1行目で入力するディスクイメージのパスは、例えばWizTreeなどで一番容量を食っているファイルを見つけることですばやく確認できます。
```sh
select vdisk file="C:\Users\lomega\AppData\Local\Packages\CanonicalGroupLimited.Ubuntu_xxxxxxxxxxxxx\LocalState\ext4.vhdx"
attach vdisk readonly
compact vdisk
detach vdisk
exit
```

## 画面を消去する

Windowsのコマンドプロンプトの`cls`に対応するものはLinuxの`clear`または`Ctrl+L`である。`reset`はシェルの初期化を行うと説明されるが、例えばPATHなどの変数は`reset`前のまま保持される。

## Windowsのブラウザで開く

`wslu`というユーティリティ群の中にある`wslview`が使える。
```sh
sudo apt install wslu
export BROWSER=/usr/bin/wslview
```

## Marp

PDF、PPTXのビルドにはchromeかedgeが必要らしいので入れておく。
```sh
sudo apt install software-properties-common apt-transport-https wget
sudo apt install chromium-browser
```

```sh
sudo apt install curl build-essential
```

nvmを入れて、そこから最新のNode.jsを入れる
```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.zshrc
command -v nvm # nvmの存在を確認

nvm install --lts
nvm install node
nvm install-latest-npm
nvm ls # インストールされたバージョンを確認
node --version # インストールされたバージョンを確認
npm --version # インストールされたバージョンを確認
```

プロジェクトフォルダを作りmarp cliを入れる（[参考](https://qiita.com/vpkaerun/items/ca8a26e92b8cc9b0cece)）。
```sh
mkdir marp-slides $$ cd $_
npm init -y
npm install --save-dev @marp-team/marp-cli
npx marp --version
```

`package.json`にレシピを追加する。
```json
{
  "scripts": {
    "pdf": "marp --pdf",
    "pptx": "marp --pptx",
    "html": "marp --html"
  }
}
```

```sh
npm run pdf slide.md
npm run html slide.md
npm run pptx slide.md
```
で変換できる。



