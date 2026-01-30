# CXDB Docker Compose Deployment

This directory contains Docker Compose configuration for running CXDB locally or in production.

## Architecture

The deployment consists of two services:

1. **cxdb-server**: Rust server providing:
   - Binary protocol (port 9009)
   - HTTP/JSON gateway (port 9010)
   - Persistent storage in `/data`

2. **cxdb-gateway**: Go proxy providing:
   - Google OAuth authentication
   - React UI (embedded at build time)
   - Proxies API requests to cxdb-server
   - Exposed on port 8080 (configurable)

```
Internet → [cxdb-gateway :8080] → [cxdb-server :9010 HTTP]
                                 ↘ [cxdb-server :9009 Binary]
```

## Prerequisites

- Docker 20.10+ or Docker Desktop
- Docker Compose v2.0+

Check your versions:

```bash
docker --version
docker compose version
```

## Quick Start

### 1. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

**Required:**
- `GOOGLE_CLIENT_ID` - OAuth client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `GOOGLE_ALLOWED_DOMAIN` - Email domain for access control (e.g., "example.com")
- `SESSION_SECRET` - 64-character hex string (generate with `openssl rand -hex 32`)
- `PUBLIC_BASE_URL` - Public URL for OAuth redirect (e.g., "http://localhost:8080")

**Optional:**
- `GATEWAY_PORT` - Change the gateway port (default: 8080)
- `CXDB_LOG_LEVEL` - Set to "debug" for verbose logging
- `CXDB_ENABLE_METRICS` - Set to "true" to enable Prometheus metrics

### 2. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable "Google+ API"
4. Navigate to **APIs & Services** → **Credentials**
5. Click **Create Credentials** → **OAuth 2.0 Client ID**
6. Application type: **Web application**
7. Authorized redirect URIs:
   - For local: `http://localhost:8080/auth/callback`
   - For production: `https://your-domain.com/auth/callback`
8. Save the **Client ID** and **Client Secret** to your `.env` file

### 3. Generate Session Secret

```bash
openssl rand -hex 32
```

Copy the output to `SESSION_SECRET` in your `.env` file.

### 4. Start Services

```bash
docker compose up -d
```

This will:
- Build both container images (first time only)
- Start cxdb-server and cxdb-gateway
- Create persistent volumes for data storage

### 5. Verify Deployment

Check that services are running:

```bash
docker compose ps
```

Expected output:
```
NAME            IMAGE               STATUS         PORTS
cxdb-gateway    cxdb/gateway:latest Up (healthy)   0.0.0.0:8080->8080/tcp
cxdb-server     cxdb/cxdb:latest    Up (healthy)   0.0.0.0:9009-9010->9009-9010/tcp
```

Check logs:

```bash
docker compose logs -f
```

### 6. Access the UI

Open your browser to:
- **Local:** http://localhost:8080
- **Production:** https://your-domain.com

You'll be redirected to Google OAuth. Sign in with an email from your allowed domain.

## Common Commands

### Start services
```bash
docker compose up -d
```

### Stop services
```bash
docker compose down
```

### View logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f cxdb-server
docker compose logs -f cxdb-gateway
```

### Restart services
```bash
docker compose restart
```

### Rebuild images after code changes
```bash
docker compose build
docker compose up -d
```

### Access server directly (bypass gateway)
```bash
# HTTP API
curl http://localhost:9010/v1/contexts?limit=10

# Binary protocol (requires client SDK)
# See docs/getting-started.md for client examples
```

## Data Persistence

Data is stored in Docker volumes:

- `cxdb-data`: CXDB storage (turns, blobs, registry)
- `gateway-data`: Session database

### Backup

```bash
# Backup CXDB data
docker run --rm \
  -v cxdb_cxdb-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/cxdb-backup-$(date +%Y%m%d).tar.gz -C /data .

# Backup gateway sessions
docker run --rm \
  -v cxdb_gateway-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/gateway-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### Restore

```bash
# Stop services
docker compose down

# Restore CXDB data
docker run --rm \
  -v cxdb_cxdb-data:/data \
  -v $(pwd)/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/cxdb-backup-20250130.tar.gz -C /data"

# Restart services
docker compose up -d
```

### Clean up volumes
```bash
# WARNING: This deletes all data
docker compose down -v
```

## Troubleshooting

### Services won't start

Check logs for errors:
```bash
docker compose logs
```

Common issues:
- **Port conflicts:** Change `GATEWAY_PORT` in `.env` if 8080 is in use
- **Permission errors:** Ensure Docker has access to the current directory
- **Build errors:** Try `docker compose build --no-cache`

### OAuth redirect errors

Verify in `.env`:
1. `PUBLIC_BASE_URL` matches the URL in your browser
2. The redirect URI in Google Cloud Console matches exactly
3. Google+ API is enabled in your GCP project

### Gateway can't connect to server

The gateway depends on `cxdb-server:9010` being accessible. Check:
```bash
docker compose exec cxdb-gateway curl http://cxdb-server:9010/health
```

If this fails, restart services:
```bash
docker compose restart
```

### Session errors or login loops

1. Verify `SESSION_SECRET` is exactly 64 hex characters
2. Clear browser cookies for localhost:8080
3. Check that `GOOGLE_ALLOWED_DOMAIN` matches your email domain

### Binary protocol connection refused

The binary protocol port (9009) is exposed but requires a client SDK:

```bash
# Test with netcat
nc -zv localhost 9009
```

See [docs/getting-started.md](../../docs/getting-started.md) for client examples.

## Production Considerations

### TLS/HTTPS

For production, put the gateway behind a reverse proxy with TLS:

**nginx example:**

```nginx
server {
    listen 443 ssl http2;
    server_name cxdb.example.com;

    ssl_certificate /etc/ssl/certs/cxdb.crt;
    ssl_certificate_key /etc/ssl/private/cxdb.key;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Update `.env`:
```bash
PUBLIC_BASE_URL=https://cxdb.example.com
```

### Resource Limits

Add resource limits for production:

```yaml
services:
  cxdb-server:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '2'
          memory: 2G

  cxdb-gateway:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### Monitoring

Enable metrics in `.env`:
```bash
CXDB_ENABLE_METRICS=true
```

Metrics are exposed on port 9011 (not published by default). To access:

```yaml
services:
  cxdb-server:
    ports:
      - "9011:9011"  # Prometheus metrics
```

Or add a Prometheus scrape config:
```yaml
scrape_configs:
  - job_name: 'cxdb'
    static_configs:
      - targets: ['cxdb-server:9011']
```

### Backup Strategy

Implement automated backups:

```bash
#!/bin/bash
# backup-cxdb.sh
set -e

BACKUP_DIR="/backups/cxdb"
DATE=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

docker run --rm \
  -v cxdb_cxdb-data:/data \
  -v "$BACKUP_DIR:/backup" \
  alpine tar czf "/backup/cxdb-$DATE.tar.gz" -C /data .

# Keep last 7 days
find "$BACKUP_DIR" -name "cxdb-*.tar.gz" -mtime +7 -delete
```

Add to crontab:
```
0 2 * * * /usr/local/bin/backup-cxdb.sh
```

## Development Mode

For development without OAuth:

```bash
# .env
DEV_MODE=true
PUBLIC_BASE_URL=http://localhost:8080
```

This bypasses authentication. **Never use in production.**

## Next Steps

- [Getting Started Guide](../../docs/getting-started.md) - Create your first context
- [Architecture](../../docs/architecture.md) - Understand the system design
- [HTTP API Reference](../../docs/http-api.md) - API documentation
- [Kubernetes Deployment](../kubernetes/README.md) - Deploy to Kubernetes
- [Type Registry](../../docs/type-registry.md) - Define custom types
- [Renderers](../../docs/renderers.md) - Create custom visualizations

## Support

For issues and questions:
- GitHub Issues: https://github.com/strongdm/cxdb/issues
- Documentation: https://github.com/strongdm/cxdb/tree/main/docs
