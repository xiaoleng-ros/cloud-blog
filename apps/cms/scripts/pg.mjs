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

function ensureInit() {
  if (existsSync(path.join(DATA_DIR, 'PG_VERSION'))) return;
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[pg] initdb → ${DATA_DIR}（仅信任本机连接）`);
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
  const r = run('pg_ctl', ['-D', DATA_DIR, '-l', LOG_FILE, '-w', '-o', `-p ${PORT}`, 'start']);
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
