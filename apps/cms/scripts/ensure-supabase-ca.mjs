#!/usr/bin/env node
// 构建后保证 Supabase CA 证书落到函数包里。
//
// 为什么需要这个脚本（而不是只靠 next.config 的 outputFileTracingIncludes）：
//   payload.config.ts 用 readFileSync 读 certs/supabase-ca.pem 注入 pg 的 ssl.ca。
//   该路径在运行时才确定，Next 文件追踪看不见它；outputFileTracingIncludes 虽然能兜住，
//   但 EdgeOne 的打包器（@edgeone/opennextjs-pages）会再走一层 realpath/挑选，
//   standalone 里最终落点与本地 .next 不一定一致。
//   2026-10-12 线上事故就是这个链路断掉的表现：
//   证书缺失 → 严格 TLS 报 self-signed certificate in certificate chain → Payload 初始化失败
//   → /api/* 与 /admin/login 全站 500。
//
// 做法：把证书复制到已知的若干候选位置，宁可多几份（每份 ~1.6KB）也不赌路径。
// payload.config.ts 的探测顺序覆盖了这里的全部落点，任一份命中即可。
//
// 幂等：可重复执行；目标已存在且内容一致时跳过。

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(APP_DIR, 'certs', 'supabase-ca.pem');

if (!existsSync(SOURCE)) {
  console.error(`[ca] 找不到源证书 ${SOURCE}，中止（生产严格 TLS 会连不上数据库）`);
  process.exit(1);
}

const pem = readFileSync(SOURCE, 'utf-8');
if (!pem.includes('BEGIN CERTIFICATE')) {
  console.error('[ca] 源证书内容不含 PEM 块，中止');
  process.exit(1);
}

// 与 payload.config.ts 的 loadSupabaseCa() 候选一一对应（该文件优先读相对 cwd 的 certs/）。
// 只投「运行时会读」的落点：
//   - 不投 public/：那是 Next 静态托管目录，.pem 会被当公开静态资源对外可下载，
//     等于把内部基础设施信息暴露出去；且 public/* 基本被 .gitignore 忽略。
//   - 不投 src/：那是源码目录，投进去会污染工作区且可能被误提交。
const TARGET_DIRS = [
  path.join(APP_DIR, 'certs'),                                  // cwd=apps/cms
  path.join(APP_DIR, '.next', 'certs'),                         // cwd=apps/cms 且有 .next
  path.join(APP_DIR, '.next', 'standalone', 'apps', 'cms', 'certs'),
  path.join(APP_DIR, '.next', 'standalone', 'certs'),
  path.join('/var/user', 'apps', 'cms', 'certs'),               // EdgeOne 容器实际 cwd（探针实测）
];

let copied = 0;
let skipped = 0;
const failures = [];

for (const dir of TARGET_DIRS) {
  const target = path.join(dir, 'supabase-ca.pem');
  try {
    if (existsSync(target) && readFileSync(target, 'utf-8') === pem) {
      skipped += 1;
      continue;
    }
    mkdirSync(dir, { recursive: true });
    copyFileSync(SOURCE, target);
    copied += 1;
    console.log(`[ca] → ${target}`);
  } catch (error) {
    // 只对源目录之外的目标记录警告：容器路径在本机不存在属正常。
    failures.push(`${target} (${error.code ?? error.message})`);
  }
}

const hardFailures = failures.filter((f) => f.includes(APP_DIR));
console.log(`[ca] 完成：复制 ${copied} 份，跳过 ${skipped} 份`);
if (failures.length > 0) {
  console.log(`[ca] 以下目标不可达（容器路径在本机不存在属正常）：\n  ${failures.join('\n  ')}`);
}
if (hardFailures.length > 0) {
  console.error(`[ca] 项目目录内复制失败，构建中止：\n  ${hardFailures.join('\n  ')}`);
  process.exit(1);
}