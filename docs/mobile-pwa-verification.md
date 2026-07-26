# Mobile PWA verification / モバイルPWA検証

## Production presence URL / 本番の気配通信URL

The recommended deployment serves the PWA and WebSocket endpoint from the same HTTPS host. Leave `VITE_PRESENCE_URL` unset and the production build connects to `wss://<current-host>/ws`.

推奨構成は、PWAとWebSocketを同じHTTPSホストから配信する形です。`VITE_PRESENCE_URL`を未設定にすると、本番ビルドは自動的に`wss://<current-host>/ws`へ接続します。

For a separate WebSocket host, set the build-time variable explicitly:

WebSocketを別ホストにする場合は、ビルド時に明示します。

```sh
VITE_PRESENCE_URL=wss://presence.example.com/ws npm run build
```

Only `ws:` and `wss:` URLs are accepted. The VPS `ALLOWED_ORIGIN` must exactly match the PWA origin, such as `https://app.example.com`.

`ws:`と`wss:`以外は無効です。VPS側の`ALLOWED_ORIGIN`には、`https://app.example.com`のようなPWAのOriginを完全一致で指定します。

## iOS Safari

1. Open the HTTPS production URL in Safari.
2. Select Share → Add to Home Screen.
3. Launch from the new icon and confirm no Safari toolbar is visible.
4. Tap the paper intro and confirm ambience starts.
5. Long-press, release, cancel a gesture, rotate the device, and confirm later taps still emit sparks.
6. Move Safari to the background for 30 seconds, return, and confirm sound and rendering recover.
7. Enable airplane mode, relaunch the installed PWA, and confirm intro, canvas, sparks, mood switching, countdown, and cached audio remain available.
8. Disable airplane mode and confirm remote presence reconnects.

日本語確認: SafariでHTTPS本番URLを開き、共有メニューから「ホーム画面に追加」します。追加したアイコンから起動してブラウザUIが出ないこと、イントロタップで音が始まること、長押しの完了・キャンセル後も入力が固まらないことを確認します。端末回転、30秒のバックグラウンド往復、機内モードでの再起動、通信復帰後の気配再接続まで順に確認してください。

## Android Chrome

1. Open the HTTPS production URL in Chrome.
2. Select Install app / Add to Home screen and launch the installed app.
3. Repeat the interaction, rotation, background recovery, airplane-mode, and reconnection checks above.
4. Confirm the maskable icon is not clipped by the launcher shape.

日本語確認: Chromeの「アプリをインストール」または「ホーム画面に追加」から起動し、iOSと同じ入力・回転・バックグラウンド・機内モード・再接続の確認を行います。ランチャー形状によってmaskableアイコンが欠けないことも確認してください。

## Two-device presence

1. Open the installed PWA on two devices using different networks where possible.
2. Keep “誰かの気配” enabled on both.
3. Tap a visually identifiable position on device A and confirm a restrained remote spark appears at the corresponding scene position on device B.
4. Repeat from B to A and across portrait/landscape orientations.
5. Disable presence on one device and confirm local sparks continue while remote delivery pauses.

日本語確認: 可能なら異なるネットワークの2端末で「誰かの気配」を有効にし、A→BとB→Aの両方向、縦横表示それぞれで同じシーン位置に控えめな火花が届くことを確認します。片方の気配を無効にした場合も、ローカル火花は継続し、遠隔配送だけが止まることを確認してください。

Record device model, OS/browser version, install result, offline result, audio recovery result, and two-device result for the release checklist.
