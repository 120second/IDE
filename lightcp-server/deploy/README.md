# Ubuntu 22.04 deployment

本文只部署独立的 LightCP API，不修改 Nginx，也不读取或修改
`/root/vphelpr` 及服务器上的其他项目。

固定路径与进程参数：

- 程序目录：`/opt/lightcp-server`
- 数据目录：`/var/lib/lightcp-server`
- 环境文件：`/etc/lightcp-server.env`
- Linux 用户：`lightcp`
- 虚拟环境：`/opt/lightcp-server/.venv`
- systemd 服务：`lightcp-server`
- 监听地址：`127.0.0.1:8100`

Ubuntu 22.04 自带 Python 3.10，当前服务已保持 Python 3.10 兼容，
不需要添加第三方 Python PPA。

## 1. 在本地生成部署包

在 Windows PowerShell 的 LightCP 仓库根目录执行：

```powershell
Set-Location D:\LightCP
tar -czf lightcp-server-0.1.0.tar.gz `
  --exclude='lightcp-server/.venv' `
  --exclude='lightcp-server/.pytest_cache' `
  --exclude='*/__pycache__' `
  --exclude='*.py[co]' `
  --exclude='lightcp-server/data/*.db*' `
  lightcp-server
```

将生成的包上传到服务器的 `/tmp`。以下是需要由你手动执行的示例，
不是部署脚本的一部分：

```powershell
scp .\lightcp-server-0.1.0.tar.gz root@114.55.109.162:/tmp/
```

## 2. 首次部署

下面的命令全部在 Ubuntu 服务器执行。它们只创建上述 LightCP 路径、
用户和 systemd 服务。

### 2.1 安装系统依赖并创建服务用户

```bash
set -euo pipefail

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip sqlite3 curl openssl rsync

if ! getent passwd lightcp >/dev/null; then
  sudo useradd \
    --system \
    --user-group \
    --home-dir /nonexistent \
    --shell /usr/sbin/nologin \
    lightcp
fi

sudo install -d -o root -g root -m 0755 /opt/lightcp-server
sudo install -d -o lightcp -g lightcp -m 0700 /var/lib/lightcp-server
```

### 2.2 安装应用和 Python 依赖

```bash
set -euo pipefail

test -f /tmp/lightcp-server-0.1.0.tar.gz
sudo tar -xzf /tmp/lightcp-server-0.1.0.tar.gz \
  -C /opt/lightcp-server \
  --strip-components=1
sudo chown -R root:root /opt/lightcp-server

sudo python3 -m venv /opt/lightcp-server/.venv
sudo /opt/lightcp-server/.venv/bin/python -m pip install --upgrade pip setuptools wheel
sudo /opt/lightcp-server/.venv/bin/python -m pip install \
  --requirement /opt/lightcp-server/requirements-prod.txt
sudo /opt/lightcp-server/.venv/bin/python -m pip install \
  --no-deps /opt/lightcp-server
```

### 2.3 创建生产环境文件

```bash
set -euo pipefail

sudo install \
  -o root -g lightcp -m 0640 \
  /opt/lightcp-server/deploy/.env.example \
  /etc/lightcp-server.env

LIGHTCP_JWT_VALUE="$(openssl rand -hex 32)"
LIGHTCP_RESET_VALUE="$(openssl rand -hex 32)"

sudo sed -i \
  "s|^LIGHTCP_JWT_SECRET_KEY=.*|LIGHTCP_JWT_SECRET_KEY=${LIGHTCP_JWT_VALUE}|" \
  /etc/lightcp-server.env
sudo sed -i \
  "s|^LIGHTCP_RESET_CODE_SECRET=.*|LIGHTCP_RESET_CODE_SECRET=${LIGHTCP_RESET_VALUE}|" \
  /etc/lightcp-server.env

unset LIGHTCP_JWT_VALUE LIGHTCP_RESET_VALUE
sudo chmod 0640 /etc/lightcp-server.env
sudo chown root:lightcp /etc/lightcp-server.env
```

SMTP 字段现在可以保持为空。不要把 `/etc/lightcp-server.env` 提交到 Git，
也不要在后续更新时覆盖其中的密钥。

### 2.4 初始化 SQLite 和 Alembic

手动初始化命令如下。systemd 服务也会在每次启动前执行同一个
`alembic upgrade head`，重复执行是安全的。

```bash
sudo -u lightcp bash -c '
  set -a
  . /etc/lightcp-server.env
  set +a
  cd /opt/lightcp-server
  exec .venv/bin/python -m alembic upgrade head
'

sudo -u lightcp bash -c '
  set -a
  . /etc/lightcp-server.env
  set +a
  cd /opt/lightcp-server
  exec .venv/bin/python -m alembic current
'

sudo test -f /var/lib/lightcp-server/lightcp.db
sudo chown lightcp:lightcp /var/lib/lightcp-server/lightcp.db
sudo chmod 0600 /var/lib/lightcp-server/lightcp.db
```

### 2.5 安装并启动 systemd 服务

```bash
set -euo pipefail

sudo install \
  -o root -g root -m 0644 \
  /opt/lightcp-server/deploy/lightcp-server.service \
  /etc/systemd/system/lightcp-server.service

sudo systemctl daemon-reload
sudo systemctl enable --now lightcp-server
sudo systemctl status lightcp-server --no-pager
```

本机验证：

```bash
curl --fail --show-error http://127.0.0.1:8100/api/health
sudo ss -ltnp | grep '127.0.0.1:8100'
sudo journalctl -u lightcp-server -n 100 --no-pager
```

SMTP 未配置时，下面的请求应返回 `503` 和
`EMAIL_SERVICE_UNAVAILABLE`；这不会影响其他 API：

```bash
curl -i \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com"}' \
  http://127.0.0.1:8100/api/auth/forgot-password
```

## 3. 更新部署

先在本地用与首次部署相同的 `tar` 命令生成新包并上传为
`/tmp/lightcp-server-update.tar.gz`。然后在 Ubuntu 上执行：

```bash
set -euo pipefail

test "$(realpath /opt/lightcp-server)" = /opt/lightcp-server
test "$(realpath /var/lib/lightcp-server)" = /var/lib/lightcp-server
test -f /tmp/lightcp-server-update.tar.gz

LIGHTCP_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
LIGHTCP_BACKUP_DIR="/var/backups/lightcp-server/${LIGHTCP_RELEASE_ID}"
LIGHTCP_STAGE_DIR="$(mktemp -d /tmp/lightcp-server-update.XXXXXX)"

sudo install -d -o root -g root -m 0700 "${LIGHTCP_BACKUP_DIR}"
tar -xzf /tmp/lightcp-server-update.tar.gz \
  -C "${LIGHTCP_STAGE_DIR}" \
  --strip-components=1
test -f "${LIGHTCP_STAGE_DIR}/pyproject.toml"
test -f "${LIGHTCP_STAGE_DIR}/migrations/versions/0001_initial_schema.py"

sudo systemctl stop lightcp-server

sudo sqlite3 /var/lib/lightcp-server/lightcp.db \
  ".backup '${LIGHTCP_BACKUP_DIR}/lightcp.db'"
sudo tar --exclude='./.venv' \
  -czf "${LIGHTCP_BACKUP_DIR}/application.tar.gz" \
  -C /opt/lightcp-server .
sudo /opt/lightcp-server/.venv/bin/python -m pip freeze \
  | sudo tee "${LIGHTCP_BACKUP_DIR}/pip-freeze.txt" >/dev/null

sudo rsync -a --delete \
  --exclude='.venv' \
  --exclude='data/' \
  "${LIGHTCP_STAGE_DIR}/" /opt/lightcp-server/
sudo chown -R root:root /opt/lightcp-server

sudo /opt/lightcp-server/.venv/bin/python -m pip install --upgrade pip setuptools wheel
sudo /opt/lightcp-server/.venv/bin/python -m pip install \
  --requirement /opt/lightcp-server/requirements-prod.txt
sudo /opt/lightcp-server/.venv/bin/python -m pip install \
  --no-deps --force-reinstall /opt/lightcp-server

sudo install \
  -o root -g root -m 0644 \
  /opt/lightcp-server/deploy/lightcp-server.service \
  /etc/systemd/system/lightcp-server.service
sudo systemctl daemon-reload

sudo -u lightcp bash -c '
  set -a
  . /etc/lightcp-server.env
  set +a
  cd /opt/lightcp-server
  exec .venv/bin/python -m alembic upgrade head
'

sudo systemctl start lightcp-server
sudo systemctl status lightcp-server --no-pager
curl --fail --show-error http://127.0.0.1:8100/api/health

printf 'Rollback backup: %s\n' "${LIGHTCP_BACKUP_DIR}"
rm -rf -- "${LIGHTCP_STAGE_DIR}"
```

更新命令不会覆盖 `/etc/lightcp-server.env` 或数据目录。请保存最后输出的
`Rollback backup` 路径。

## 4. 回滚

优先使用更新前生成的代码和 SQLite 成对备份。这样不需要猜测某个迁移
是否能安全降级。将下面的目录替换为更新命令输出的实际目录：

```bash
set -euo pipefail

LIGHTCP_BACKUP_DIR=/var/backups/lightcp-server/20260101T000000Z
test -f "${LIGHTCP_BACKUP_DIR}/application.tar.gz"
test -f "${LIGHTCP_BACKUP_DIR}/lightcp.db"
test -f "${LIGHTCP_BACKUP_DIR}/pip-freeze.txt"

LIGHTCP_ROLLBACK_STAGE="$(mktemp -d /tmp/lightcp-server-rollback.XXXXXX)"
tar -xzf "${LIGHTCP_BACKUP_DIR}/application.tar.gz" \
  -C "${LIGHTCP_ROLLBACK_STAGE}"
test -f "${LIGHTCP_ROLLBACK_STAGE}/pyproject.toml"

sudo systemctl stop lightcp-server

sudo rsync -a --delete \
  --exclude='.venv' \
  --exclude='data/' \
  "${LIGHTCP_ROLLBACK_STAGE}/" /opt/lightcp-server/
sudo chown -R root:root /opt/lightcp-server

sudo /opt/lightcp-server/.venv/bin/python -m pip install \
  --requirement "${LIGHTCP_BACKUP_DIR}/pip-freeze.txt"
sudo /opt/lightcp-server/.venv/bin/python -m pip install \
  --no-deps --force-reinstall /opt/lightcp-server

sudo sqlite3 /var/lib/lightcp-server/lightcp.db \
  ".restore '${LIGHTCP_BACKUP_DIR}/lightcp.db'"
sudo chown lightcp:lightcp /var/lib/lightcp-server/lightcp.db
sudo chmod 0600 /var/lib/lightcp-server/lightcp.db

sudo install \
  -o root -g root -m 0644 \
  /opt/lightcp-server/deploy/lightcp-server.service \
  /etc/systemd/system/lightcp-server.service
sudo systemctl daemon-reload
sudo systemctl start lightcp-server

sudo systemctl status lightcp-server --no-pager
curl --fail --show-error http://127.0.0.1:8100/api/health
rm -rf -- "${LIGHTCP_ROLLBACK_STAGE}"
```

如果只是需要检查或手动改变迁移版本，可使用：

```bash
sudo -u lightcp bash -c '
  set -a
  . /etc/lightcp-server.env
  set +a
  cd /opt/lightcp-server
  .venv/bin/python -m alembic history
  .venv/bin/python -m alembic current
'
```

不要在没有数据库备份的情况下直接执行 `alembic downgrade`。SQLite 数据库
回滚应始终与对应版本的应用代码一起完成。
