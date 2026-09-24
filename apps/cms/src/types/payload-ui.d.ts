/**
 * @payloadcms/ui 的类型声明
 *
 * Payload CMS 的 UI 包未提供 TypeScript 声明文件，统一声明为 any。
 * 实际类型由 Payload 运行时保证，不影响开发体验。
 *
 * 注意：此文件不能有顶层 import/export，否则 declare module 会被当作
 * 模块增强（augmentation）而非新模块声明（declaration），导致不生效。
 */
declare module '@payloadcms/ui'
