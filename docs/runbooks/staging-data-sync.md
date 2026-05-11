# Staging Data Sync

## 目的

dev preview は Supabase staging を参照する。staging で本番に近いデータを使って確認したい時だけ、本番から staging へデータを手動同期する。

この同期は **dev への push / Cloudflare deploy では自動実行しない**。実行タイミングは、下記 npm script を手元で実行した時だけ。

## 同期するもの

### 1. Global master data

全ユーザー共通の設定・マスター。staging を本番に近い表示条件にするために同期する。

- `opponent_deck_master`: 対面デッキ候補。`category` に `major` / `minor` / `other` を持つ。
- `opponent_deck_settings`: 対面デッキ分類の設定。閾値、固定件数、Limitless 同期状態など。
- `detection_rules`: 不正検知ルール。
- `quality_scoring_rules`: 品質スコア計算ルール。
- `quality_scoring_settings`: 品質スコアのグローバル設定。

### 2. Specific user battle data

指定した本番ユーザー1人分だけを、staging の指定ユーザーに移植する。`user_id` は staging 側のユーザーIDへ置き換える。`decks` / `deck_tunings` / `battles` の `id` も staging 用に新しく採番し、参照関係だけ保ってコピーする。

- `decks`: 自分のデッキ一覧。
- `deck_tunings`: デッキの型・調整名。
- `battles`: 対戦履歴。

## 同期しないもの

- `auth.users`: Supabase Auth のユーザー本体。staging では staging の Auth ユーザーを使う。
- `profiles` 全量: staging のログインで作成された target profile を使う。
- `discord_connections`: Discord access token / refresh token を含むためコピーしない。
- `discord_oauth_states`: OAuth 中の一時 nonce。コピー不要。
- `shares` / `share-images`: 通常の戦績確認には不要。共有機能の検証時だけ別途検討する。
- 他ユーザーの `decks` / `battles`: 個人データなのでコピーしない。

## 必要な環境変数

秘密情報はチャットに貼らない。ターミナルで環境変数として設定する。

```bash
export PROD_SUPABASE_URL='https://<production-ref>.supabase.co'
export PROD_SUPABASE_SERVICE_ROLE_KEY='...'
export STAGING_SUPABASE_URL='https://uqndrkaxmbfjuiociuns.supabase.co'
export STAGING_SUPABASE_SERVICE_ROLE_KEY='...'
```

ユーザーデータをコピーする時だけ、以下も設定する。

```bash
export PROD_SOURCE_USER_ID='本番側のコピー元 user_id'
export STAGING_TARGET_USER_ID='staging側のコピー先 user_id'
```

`user_id` は Supabase Dashboard の Authentication > Users で確認する。

## 実行方法

デフォルトは dry-run。staging には書き込まない。

```bash
npm run staging:sync:globals
npm run staging:copy:user
npm run staging:refresh
```

実際に staging へ書き込む時だけ `-- --apply` を付ける。

```bash
npm run staging:sync:globals -- --apply
npm run staging:copy:user -- --apply
npm run staging:refresh -- --apply
```

`staging:refresh` は global master data と specific user battle data の両方を同期する。

## 安全設計

- dry-run がデフォルト。
- `--apply` がない限り staging を変更しない。
- production URL と staging URL が同一なら停止する。
- target Supabase project ref が `uqndrkaxmbfjuiociuns` でなければ停止する。
- staging 側の対象ユーザーの既存 `decks` / `deck_tunings` / `battles` は、コピー前に置き換える。
- コピー時に `decks` / `deck_tunings` / `battles` の `id` は staging 用に作り直す。prod の UUID を staging に固定で持ち込まない。
- Discord token や Supabase Auth ユーザー本体はコピーしない。

## いつコピーされるか

自動コピーはしない。

コピーされるのは、誰かが明示的に以下のようなコマンドを実行した時だけ。

```bash
npm run staging:refresh -- --apply
```

dev に push しただけ、Cloudflare preview がデプロイされただけ、migration を適用しただけでは、データコピーは走らない。
