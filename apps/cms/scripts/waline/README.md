# Waline 评论服务

服务端 `@waline/vercel` 以进程内方式挂在 CMS 的 `/api/waline`（桥接层 `src/lib/waline-bridge.ts`，路由 `src/app/api/waline/[[...path]]/route.ts`），复用同一个 Postgres 实例。

## 本地（已就绪，无需重复）

`schema.sql` 建表语句写的是裸表名，落在连接角色的 `search_path` 上：

```sql
CREATE SCHEMA IF NOT EXISTS waline AUTHORIZATION postgres;
CREATE ROLE waline_user LOGIN PASSWORD 'waline_dev_pw';
ALTER ROLE waline_user IN DATABASE blog_dev SET search_path = 'waline, public';
GRANT ALL ON SCHEMA waline TO waline_user;
```

然后用 `waline_user` 执行 `schema.sql`。因为 Payload 的 dev force-push 只 introspect `public`，看不见 `waline.wl_*`，不会再出现「一次 force-push 把评论表删掉」。

## 生产（Supabase + EdgeOne）

1. Supabase **SQL Editor** 整段执行 `schema.sql`（生产 Payload 从不 push，直接建在 `public` 即可）。
2. EdgeOne 环境变量新增下面这组。**只加拆分变量，不要动 Payload 用的 `POSTGRES_URL`**——两套连接各读各的：

   ```
   POSTGRES_DATABASE / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT
   POSTGRES_PREFIX=wl_
   POSTGRES_SSL=true          # Supabase 直连 5432 需要；pooler 6543 亦可用
   JWT_TOKEN=<openssl rand -hex 32 的结果，勿与本地相同>
   COMMENT_AUDIT=true         # 先审后发
   IPQPS=60                   # 同一 IP 两次提交最小间隔（秒）
   FORBIDDEN_WORDS=词1,词2     # 命中即标 spam，不进公开列表
   ```

3. 博客侧地址由 blog 的 `PUBLIC_WALINE_URL` 决定：同域名部署留空即用同域 `/api/waline`，前后台分域时填 `https://cms.iceuu.com/api/waline`。

## 审核 / 管理

Waline 自带的管理面板在子路径挂载下拿不到 `serverURL`（且 JS 走 unpkg CDN），**不用它**，直接打 REST：

```bash
S=https://cms.iceuu.com/api/waline          # 本地用 http://localhost:9527/api/waline

# 1) 注册管理员：users 为空时第一个注册者直接成为 administrator，无需邮箱验证
curl -X POST $S/api/user -H 'content-type: application/json' \
  -d '{"type":"register","email":"you@example.com","password":"……"}'

# 2) 登录取 JWT
TOKEN=$(curl -s -X POST $S/api/token -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"……"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')

# 3) 待审列表
curl -s -H "Authorization: Bearer $TOKEN" "$S/api/comment?type=list&status=waiting&page=1&pageSize=50"

# 4) 批准 / 删除（id 取上一步的 objectId）
curl -s -X PUT $S/api/comment/ID -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"approved","objectId":ID}'
curl -s -X DELETE $S/api/comment/ID -H "Authorization: Bearer $TOKEN"
```

## 已知坑

- **提交必须带 `mail` 字符串**：服务端头像模板对缺失/NULL 的 `mail` 直接抛 500；匿名评论发 `mail: ''` 走 `md5('')` 默认头像。已落库的 NULL-mail 行会让该路径的列表接口一起崩。
- **`ua` 走请求体**，不是请求头；浏览器/系统徽章由服务端解析 `ua` 得出。
- **IP 不外泄**：格式化时删掉 `ip`/`mail`，前端只拿 `addr`（ip2region 属地）+ `browser` + `os`。
- `patches/@waline+vercel+1.43.4++@waline+core+0.1.0.patch`：上游匿名点赞分支把 `comment: undefined` 塞进更新对象，回读后 markdown 渲染收到 undefined → 500（DB 其实已加数）。补丁改为仅在有值时带上该键。
