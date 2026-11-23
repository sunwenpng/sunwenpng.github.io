/*
 * 联机服务器地址。
 *
 * 现在用的是 EMQX 免费公共 MQTT 中转（不用注册任何账号）：
 *   https://www.emqx.com/en/mqtt/public-mqtt5-broker
 * 它是公共测试服务，不保证一直稳定，传的只有昵称和出牌/落子，不涉及个人信息。
 *
 * 以后想换成自己的服务器：部署 server/ 里的 Cloudflare Worker，然后改成
 *   window.NET_SERVER = 'wss://dango-games.你的子域名.workers.dev';
 */
// 联机暂时关闭（所有“联机”按钮都会隐藏）。要打开时把下面一行改成：
//   window.NET_SERVER = 'mqtt:wss://broker.emqx.io:8084/mqtt';
window.NET_SERVER = '';
