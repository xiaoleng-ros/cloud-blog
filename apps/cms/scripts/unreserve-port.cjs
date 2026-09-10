/**
 * 预加载脚本：解除 Next.js 对 6666 端口的保留限制
 *
 * 背景：Next.js 15.x 在 next dev 启动时会检查端口是否在 WHATWG 保留端口白名单中，
 * 6666 被标记为 "ircu" 保留端口，会直接报错退出，且环境变量无法放行。
 *
 * 原理：本脚本通过 NODE_OPTIONS=--require 在 next CLI 加载之前执行，
 * 与 next 共享 require 缓存，直接删除 KNOWN_RESERVED_PORTS 中 6666 的键，
 * 使 isPortIsReserved(6666) 返回 false，从而正常启动。
 */
const { KNOWN_RESERVED_PORTS } = require('next/dist/lib/helpers/get-reserved-port.js')

if (KNOWN_RESERVED_PORTS && typeof KNOWN_RESERVED_PORTS === 'object') {
  // 允许 6666 端口作为开发服务器端口
  delete KNOWN_RESERVED_PORTS[6666]
}