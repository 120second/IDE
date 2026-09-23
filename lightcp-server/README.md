# LightCP Server

LightCP 的独立 FastAPI 服务。当前版本提供账号、密码重置和按用户隔离的模板 CRUD。

## 本地运行

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8100 --reload
```

Swagger UI 在开发环境位于 `http://127.0.0.1:8100/docs`。生产环境会关闭文档入口。

## 配置

所有配置使用 `LIGHTCP_` 前缀环境变量。生产环境必须设置：

- `LIGHTCP_ENVIRONMENT=production`
- `LIGHTCP_DATABASE_URL`
- `LIGHTCP_JWT_SECRET_KEY`
- `LIGHTCP_RESET_CODE_SECRET`

JWT 密钥和验证码 HMAC 密钥必须不同，且不得提交到 Git。

SMTP 配置可以暂时留空。此时服务器仍可启动，注册、登录和模板 API
均可使用；`POST /api/auth/forgot-password` 会返回 HTTP 503 和
`EMAIL_SERVICE_UNAVAILABLE`。配置 SMTP 后无需修改代码。

## 数据库迁移

```bash
python -m alembic upgrade head
python -m alembic current
```

SQLite 数据文件应放在持久化目录中。生产部署示例使用 `/var/lib/lightcp-server/lightcp.db`。

Ubuntu 22.04 的首次部署、更新和回滚命令见
[`deploy/README.md`](deploy/README.md)。部署过程不会修改 Nginx。

## 测试

```bash
python -m pytest
```

## 客户端地址

开发版客户端默认通过 SSH tunnel 访问 `http://127.0.0.1:18100/api`。
如果需要让客户端直接连接本机 8100 端口，可以在启动前设置
`LIGHTCP_API_BASE_URL=http://127.0.0.1:8100/api`。发布构建必须在构建时提供 HTTPS 地址：

```powershell
$env:LIGHTCP_API_BASE_URL = "https://example.com/api"
npm run tauri build
```
