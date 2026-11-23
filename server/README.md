# 联机服务器（Cloudflare Workers + Durable Objects）

负责房间和快速匹配：只转发玩家之间的消息，不保存对局。

- `GET /health` → `ok`
- `wss://…/room/123456?game=doudizhu&max=3&name=…&cid=…` 进房间
- `wss://…/match?game=doudizhu&max=3&min=2&name=…&cid=…` 快速匹配

## 部署

```bash
cd server
npx wrangler deploy        # 需要 Cloudflare 账号（免费版即可）
```

部署后得到 `https://dango-games.<你的子域>.workers.dev`，把它写进 `lib/net-config.js`：

```js
window.NET_SERVER = 'wss://dango-games.<你的子域>.workers.dev';
```

本地测试：`npx wrangler dev --local --port 8787`，然后打开游戏地址加 `?server=ws://127.0.0.1:8787`。
