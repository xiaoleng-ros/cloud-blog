#!/usr/bin/env node
// 用指定的 env 文件跑命令：node scripts/with-env.mjs .env.supabase <cmd...>
// 解析出来的键会覆盖进程里已有的同名变量（与 dotenv 默认行为相反，
// 目的是让「临时换一套 env」真的生效）。
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [envFile, ...cmd] = process.argv.slice(2);
if (!envFile || cmd.length === 0) {
  console.error('用法: node scripts/with-env.mjs <env文件> <命令> [参数...]');
  process.exit(1);
}

const p = path.resolve(process.cwd(), envFile);
if (!existsSync(p)) { console.error(`找不到 env 文件: ${p}`); process.exit(1); }

for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!m || m[2].trim().startsWith('#')) continue;
  let v = m[2].trim();
  if (v.startsWith('"') || v.startsWith("'")) {
    // 引号值：引号内井号原样保留；仅剥离收尾引号之后的行尾注释（KEY="a#b" # 注释）
    const close = v.lastIndexOf(v[0]);
    if (close > 0 && /^\s+#/.test(v.slice(close + 1))) v = v.slice(1, close);
    else if (v.length > 1 && v.endsWith(v[0])) v = v.slice(1, -1);
  } else {
    // 未引号值：` #`（空格+井号）起视为行尾注释
    const c = v.indexOf(' #');
    if (c !== -1) v = v.slice(0, c).trimEnd();
  }
  process.env[m[1]] = v;
}

const isWin = process.platform === 'win32';
const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: isWin });
process.exit(r.status ?? 1);
