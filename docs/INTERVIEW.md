# 面接・説明用メモ / Interview narrative

## 60秒で説明

RegDeckは、Modbusのレジスタマップと記録済みの生データを、独立した期待値と照合するローカルツールです。アドレスの0始まり・1始まりやバイト順を間違えても、もっともらしい値になることがあります。そこで、期待値をデコード結果から生成せず、仕様書や別の基準から入力して固定します。マップを変更しても期待値が変わらないため、回帰が見えます。

ブラウザではマップ・重複・照合結果を確認でき、JSONと標準ライブラリだけで動くPython検証器を持ち出せます。計算器・通信クライアント・シミュレーターには既存製品があります。この作品では「独立した期待値を残した、再実行できるレビュー記録」に範囲を絞りました。実機接続や制御・安全認証は行いません。

## 技術上の判断

1. **期待値をデータモデル上で分離**: fieldsとcases.expectedは別。マップ変更で期待値を再生成しない。削除・空間変更で整合性が崩れる場合は拒否する
2. **厳密な整数スケーリング**: JavaScriptのBigIntによる有理数計算と、Python Decimalで別実装。0.1などを二進浮動小数に変換してから計算しない
3. **float32の限界を隠さない**: 正負のゼロ・非有限値・生ビットを保持。実際の二進値を厳密な十進展開として表示し、許容差を明示する
4. **構造の曖昧さを見せる**: PDU範囲を明示。HoldingとInputを分離。重複は別名の可能性があるため自動失敗にせず、レビュー警告として残す
5. **エクスポートを実行して検証**: ブラウザ側のコードをPythonに機械変換しない。独立実装で比較し、コピーした検証器をpass/fail/invalidで実行する
6. **入力はコードにしない**: evalや任意式なし。厳密な型、重複キー拒否、サイズ上限、CSV対策、HTMLエスケープ、固定の検証器ソース

## Trade-offs to discuss

- Exact float expansions are verbose; they reveal genuine representation differences instead of hiding them in rounded display. v1 deliberately omits float scaling and raw-bit assertion mode
- Evaluating every field in a snapshot's space makes coverage explicit but can be noisy for partial captures. A future version could add explicit per-case field scope without silently dropping checks
- Strict unknown-key rejection prevents accidental ignored settings but makes forward compatibility explicit: new schemas must be migrated deliberately
- No persistence or account removes a data-handling surface; it means users must save JSON before reloading
- Independent implementations reduce shared algorithm mistakes, but matching implementations still cannot validate a wrong external register map or a wrong human expectation

## English summary

“I built an offline register-decoding regression workbench. The important design choice is that recorded words and human-supplied expectations remain unchanged when the interpretation map changes. Address-base, signedness and byte-order mistakes therefore produce visible regressions. I used exact integer decimal arithmetic, explicit float32 bit semantics, bounded strict input validation, and an independently implemented Python verifier. Existing clients and simulators already solve live communication, so this project focuses on a portable review-and-regression artifact. Its tests establish software behavior within scope, not device safety or market demand.”

## Honesty at the initial freeze

The recorded local unit and differential tests are executed. Browser/mobile/print tests are authored but unexecuted until the designated sandboxed CI/browser review. Do not present unrun checks as passed, or synthetic reference cases as real device data. No users, sales, savings, patents or product superiority have been demonstrated.
