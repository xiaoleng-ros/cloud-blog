#!/usr/bin/env node
// 本地开发用 PostgreSQL 的按需启停（绿色版 zip 解压在 D:\pglocal，不注册 Windows 服务）。
//   node scripts/pg.mjs start | stop | status | init
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PG_HOME = process.env.PG_HOME || 'D:\\pglocal\\pgsql';
const DATA_DIR = process.env.PG_DATA || 'D:\\pglocal\\data';
const LOG_FILE = path.join(DATA_DIR, 'pg.log');
const PORT = process.env.PG_DEV_PORT || '5433';
const BIN = process.env.PG_BIN || path.join(PG_HOME, 'bin');

const run = (exe, args) => spawnSync(path.join(BIN, `${exe}.exe`), args, { encoding: 'utf8' });

// 预检二进制：D:\pglocal 未解压/缺文件时 spawnSync 只会返回 status=null 且无任何输出，
// 不预检就会静默 exit(1)，报错不可读。
const missing = ['pg_ctl', 'initdb', 'psql'].filter((e) => !existsSync(path.join(BIN, `${e}.exe`)));
if (missing.length) {
  console.error(
    `[pg] 缺少 PostgreSQL 可执行文件：${missing.map((e) => `${e}.exe`).join('、')}\n` +
    `     期望目录：${BIN}\n` +
    `     修复指引：将 Windows 绿色版 PostgreSQL 解压到 D:\\pglocal\\pgsql（使 bin\\pg_ctl.exe 等就位），\n` +
    `     或设置环境变量 PG_HOME 指向实际安装目录后重试。`
  );
  process.exit(1);
}

function ensureInit() {
  if (existsSync(path.join(DATA_DIR, 'PG_VERSION'))) return;
  mkdirSync(DATA_DIR, { recursive: true });
  // --auth=trust 的实际作用域：initdb 只在 pg_hba.conf 里生成 local / 127.0.0.1 / ::1 三条规则，
  // 即 trust 仅对本机回环连接生效；对外不监听由下方 start 的 listen_addresses=127.0.0.1 固化。
  console.log(`[pg] initdb → ${DATA_DIR}（trust 认证，仅 pg_hba 本机回环规则）`);
  const r = run('initdb', ['-D', DATA_DIR, '-E', 'UTF8', '--auth=trust', '--no-locale', '-U', 'postgres']);
  if (r.status !== 0) { console.error(r.stdout || '', r.stderr || ''); process.exit(1); }
}

function dbCreated() {
  const r = run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres',
    '-Atqc', "SELECT 1 FROM pg_database WHERE datname='blog_dev'"]);
  return (r.stdout || '').trim() === '1';
}

function ensureDb() {
  if (dbCreated()) return;
  const r = run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-c', 'CREATE DATABASE blog_dev']);
  if (r.status !== 0) { console.error(r.stderr || ''); process.exit(1); }
  console.log('[pg] 已创建 blog_dev');
}

const cmd = process.argv[2] || 'status';
const st = run('pg_ctl', ['-D', DATA_DIR, 'status']);
const running = st.status === 0;

if (cmd === 'init') ensureInit();
if (cmd === 'start') {
  ensureInit();
  if (running) { console.log(`[pg] 已在运行（端口 ${PORT}）`); process.exit(0); }
  // listen_addresses 固化为 127.0.0.1：即使 postgresql.conf 被手改也不会监听外部网卡
  const r = run('pg_ctl', ['-D', DATA_DIR, '-l', LOG_FILE, '-w', '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`, 'start']);
  if (r.status !== 0) { console.error(r.stdout || '', r.stderr || ''); process.exit(1); }
  ensureDb();
  console.log(`[pg] 已启动，端口 ${PORT}，日志 ${LOG_FILE}`);
} else if (cmd === 'stop') {
  if (!running) { console.log('[pg] 未在运行'); process.exit(0); }
  run('pg_ctl', ['-D', DATA_DIR, '-m', 'fast', '-w', 'stop']);
  console.log('[pg] 已停止');
} else if (cmd === 'status') {
  console.log(running ? `[pg] 运行中（端口 ${PORT}）` : '[pg] 未运行');
} else {
  console.error('用法: node scripts/pg.mjs start | stop | status | init');
  process.exit(1);
}
