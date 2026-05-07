# Calendar Site Opener

Google Calendar の予定をトリガーにして、Chrome で任意の URL を新しいタブとして開く拡張機能です。

## 使い方

Google カレンダーの予定名に `[OPEN]` を入れます。

例:

```text
[OPEN] 勉強開始
```

予定の説明欄・場所欄・タイトルのどこかに URL を入れます。

```text
https://chatgpt.com/
```

予定開始時刻になると、その URL が新しいタブで開きます。

URL が見つからない場合は、設定画面のデフォルト URL を開きます。

## インストール手順・開発用

1. このリポジトリをローカルに置く。
2. Chrome で `chrome://extensions/` を開く。
3. デベロッパーモードを ON にする。
4. 「パッケージ化されていない拡張機能を読み込む」を押す。
5. このフォルダを選択する。
6. 表示された拡張機能 ID をコピーする。
7. Google Cloud Console でプロジェクトを作る。
8. Google Calendar API を有効化する。
9. OAuth 同意画面を設定する。
10. OAuth クライアント ID を作成する。種類は Chrome Extension。
11. Item ID に Chrome 拡張機能 ID を入れる。
12. 発行された Client ID を `manifest.json` の `YOUR_CLIENT_ID.apps.googleusercontent.com` と差し替える。
13. Chrome 拡張機能画面で再読み込みする。
14. 拡張機能のポップアップから「Googleカレンダーに接続」を押す。

## 設定

拡張機能ポップアップの「設定を開く」から変更できます。

- カレンダーID: 一覧から対象カレンダーを選択（`primary` 以外も可）
- 予定名の目印: 初期値は `[OPEN]`
- デフォルトURL: 予定内にURLがない場合に開くURL
- URLがない予定は開かない
- Chromeウィンドウ名: 同じ名前なら同じウィンドウに開く（初回は自動作成）
- 何時間先まで予定を取得するか
- 再同期間隔
- 予定時刻を過ぎても開く猶予
- 新しいタブをアクティブにするか

## 現在の仕様

- Manifest V3
- Google Calendar API で予定一覧取得・予定作成
- `chrome.identity` による Google OAuth
- `chrome.alarms` による予定時刻トリガー
- 予定の説明欄・場所欄・タイトルから最初の URL を抽出
- 一度開いた予定は `fired` として記録し、同じ予定を何度も開かない
- 14日より古い fired 記録は削除

## 注意

Chrome が閉じている、PC がスリープしている、ネット接続がない場合は予定時刻ぴったりには動きません。
復帰後、猶予時間内なら開きます。

自分用ならこのまま開発できます。公開配布する場合は、Google OAuth の審査や Chrome Web Store の審査を考慮してください。
