# Codex に依頼する作業案

この Chrome 拡張機能を改善してください。

## 目的

Google Calendar の予定をトリガーにして、予定開始時刻に指定 URL を新しいタブで開く Chrome 拡張です。

## 現在の実装

- Manifest V3
- background service worker
- chrome.identity で Google OAuth
- Google Calendar API の events.list を使用
- chrome.alarms で次回予定を予約
- 予定名に `[OPEN]` が含まれる予定だけ対象
- 説明欄・場所欄・タイトルから URL を抽出
- URL がない場合はデフォルト URL を開く

## やってほしいこと

優先順位順に対応してください。

1. バグがないか確認する。
2. Manifest V3 の service worker と chrome.alarms の使い方が適切か確認する。
3. Google OAuth 周りのエラー処理を改善する。
4. popup / options のUIを少し使いやすくする。
5. 予定一覧をポップアップに最大5件表示する。
6. URL抽出ロジックを改善する。
7. READMEを最新の実装に合わせて更新する。

## 変更時の方針

- 外部ライブラリは使わない。
- まずは個人利用を想定する。
- 権限は最小限にする。
- カレンダーの編集権限は不要。
- コードは短く保つが、脆い実装にはしない。
