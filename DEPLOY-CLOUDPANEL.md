# Deploying SolarNexus on a CloudPanel VPS (git-based, no SCP)

These are the **exact commands** to deploy this monorepo on a fresh
CloudPanel VPS by pulling from your git repository. You'll run them
inside CloudPanel's built-in **Terminal** (Sites → your site → Terminal)
or via SSH as the site user.

> Replace placeholders:
> - `YOUR_DOMAIN.com` — your site's domain in CloudPanel
> - `YOUR_SITE_USER` — the Linux user CloudPanel created (e.g. `solarnexus`)
> - `YOUR_GIT_URL` — `https://github.com/youraccount/your-repo.git`
>   (use HTTPS + a personal access token, or add a deploy SSH key)
> - `YOUR_DB_PASSWORD` — pick a strong password
> - `YOUR_INGEST_TOKEN` / `YOUR_ADMIN_TOKEN` — long random strings
>   (generate with `openssl rand -hex 32`)

---

## 1. Create the site in CloudPanel UI

1. CloudPanel → **+ Add Site** → **Create a Node.js Site**.
2. Domain: `YOUR_DOMAIN.com`
3. Node.js version: **24** (Node 22 also works)
4. App Port: `8080` (we'll bind the API to this)
5. Site User: take note of the auto-generated user name.
6. After creation: **Databases** tab → **+ Add Database**
   - DB name: `solarnexus`
   - User: `solarnexus`
   - Password: `YOUR_DB_PASSWORD`
   - Engine: **PostgreSQL** (if PG isn't installed, run
     `sudo clpctl db:add-postgresql` first; CloudPanel ships MariaDB by
     default).

---

## 2. SSH/Terminal — install runtime tooling (one-time, as root)

```bash
# Node 24 (CloudPanel uses NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git zip unzip postgresql-client

# pnpm + pm2 globally (pm2 keeps the API alive across reboots)
sudo npm install -g pnpm@10 pm2
```

---

## 3. Clone the repo as the site user

```bash
sudo -iu YOUR_SITE_USER

cd ~/htdocs/YOUR_DOMAIN.com
# Wipe the placeholder index.html CloudPanel generated:
rm -rf ./* ./.[!.]* 2>/dev/null || true

git clone YOUR_GIT_URL app
cd app
```

If your repo is private use either:
- **HTTPS + token** (simplest): `git clone https://USER:TOKEN@github.com/you/repo.git app`
- **Deploy key**: `ssh-keygen -t ed25519 -f ~/.ssh/deploy -N ""`,
  then add `~/.ssh/deploy.pub` as a read-only deploy key in your repo.

---

## 4. Configure environment

```bash
cd ~/htdocs/YOUR_DOMAIN.com/app

cat > .env <<'EOF'
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://solarnexus:YOUR_DB_PASSWORD@127.0.0.1:5432/solarnexus
MODBUS_INGEST_TOKEN=YOUR_INGEST_TOKEN
ADMIN_API_TOKEN=YOUR_ADMIN_TOKEN
DEFAULT_ADMIN_EMAIL=admin@YOUR_DOMAIN.com
DEFAULT_ADMIN_PASSWORD=change-me-on-first-login
AUTH_SESSION_TTL_HOURS=168
BASE_PATH=/
EOF
chmod 600 .env
```

---

## 5. Install, build, push DB schema

```bash
cd ~/htdocs/YOUR_DOMAIN.com/app

# All workspace deps + build everything
pnpm install --frozen-lockfile
pnpm run build

# Create the tables in PostgreSQL
set -a; . ./.env; set +a
pnpm --filter @workspace/db run push
```

---

## 6. Start the services with pm2

The API runs on `:8080` (bound to localhost). The dashboard is just
static files we'll serve through CloudPanel's nginx.

```bash
cd ~/htdocs/YOUR_DOMAIN.com/app

# Build the dashboard's static bundle (output in artifacts/trb246-dashboard/dist)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/trb246-dashboard run build

# Start the API server under pm2 (loads .env automatically with --update-env)
pm2 start "pnpm --filter @workspace/api-server run start" \
  --name solarnexus-api \
  --update-env \
  --time

pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
# (Run the line pm2 prints, then `pm2 save` again.)
```

Verify:

```bash
curl -s http://127.0.0.1:8080/api/healthz       # -> {"status":"ok"}
curl -s http://127.0.0.1:8080/api/auth/ping     # -> {"ok":true,...}
```

---

## 7. Wire up nginx in CloudPanel UI

CloudPanel → **Sites → YOUR_DOMAIN.com → Vhost**, replace the body with:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN.com;

    root /home/YOUR_SITE_USER/htdocs/YOUR_DOMAIN.com/app/artifacts/trb246-dashboard/dist;
    index index.html;

    # Increase for the 100+ MB Agent_relay download
    client_max_body_size 200m;
    proxy_read_timeout 300s;

    # Proxy /api/* to the Node API
    location /api/ {
        proxy_pass http://127.0.0.1:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;     # let big zip downloads stream
    }

    # SPA fallback for the React dashboard
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Save → CloudPanel reloads nginx automatically. Then **SSL/TLS tab → Issue
Let's Encrypt Certificate** to enable HTTPS. CloudPanel will rewrite the
vhost to add the 443 block — keep the `location /api/` and
`client_max_body_size` lines intact.

---

## 8. (Optional) Build the Windows desktop client on the server

The 108 MB `AgentRelay-win-x64.zip` is **not** in git. Build it on the
VPS so the dashboard's "Windows client" download button works:

```bash
# .NET 8 SDK
curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/ms.deb
sudo dpkg -i /tmp/ms.deb
sudo apt-get update && sudo apt-get install -y dotnet-sdk-8.0

cd ~/htdocs/YOUR_DOMAIN.com/app/clients/agent-relay
bash publish.sh
ls -lh dist/AgentRelay-win-x64.zip   # -> ~108 MB
```

The API auto-discovers the zip at
`clients/agent-relay/dist/AgentRelay-win-x64.zip` — no restart needed.

---

## 9. Pulling future updates from git

```bash
cd ~/htdocs/YOUR_DOMAIN.com/app
git pull
pnpm install --frozen-lockfile
pnpm run build
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/trb246-dashboard run build
set -a; . ./.env; set +a
pnpm --filter @workspace/db run push   # only if schema changed
pm2 restart solarnexus-api --update-env
```

You can drop this in a script `~/deploy.sh` and run `bash ~/deploy.sh`
on every release. For full automation, add a GitHub Actions workflow
that SSHes in and runs the script — but that's optional; the manual
`git pull && bash ~/deploy.sh` flow is reliable.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `502 Bad Gateway` on `/api/...` | `pm2 logs solarnexus-api` — usually a DB connection error. Check `.env` `DATABASE_URL`. |
| Dashboard loads but `/api/...` calls return HTML | nginx isn't proxying. Re-check the `location /api/` block. |
| Windows client download is `404` | You skipped Step 8. Run `bash clients/agent-relay/publish.sh`. |
| `pnpm: command not found` after reboot | pnpm was installed for root only. Run `sudo npm install -g pnpm@10` again or install per-user via `corepack enable`. |
| Login returns `401` even with the seeded admin | The seed only runs on first boot. Reset by deleting the row: `psql $DATABASE_URL -c "DELETE FROM users WHERE email='admin@YOUR_DOMAIN.com';"` then `pm2 restart solarnexus-api`. |
| TRB246 / Modbus device sends data but it doesn't appear | Confirm device's `x-device-key` header equals `MODBUS_INGEST_TOKEN`. Check `pm2 logs solarnexus-api` for `device-auth` warnings. |
