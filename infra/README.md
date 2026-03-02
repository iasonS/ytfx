# ytfx Infrastructure

This directory contains infrastructure-as-code and service documentation for ytfx.

## Files

### services.yaml
**Canonical service registry** for all managed infrastructure.

Tracks:
- **Domains**: Registrar, DNS, custom domain setup
- **Hosting**: Provider, plan, region, persistent storage, environment variables
- **Source Control**: GitHub repository, branch protection, CI/CD workflows
- **IaC**: Dockerfile, render.yaml, infrastructure config files
- **Monitoring**: Health checks and alerts
- **Future Plans**: Planned infrastructure changes

**Important**: Update `services.yaml` whenever you:
- Add or remove a domain
- Change hosting provider or plan
- Update environment variable configuration
- Modify branch protection rules
- Plan infrastructure changes

## Deployment

### Current: Render (Docker)
The application is deployed via Render using the `Dockerfile`:
```bash
docker build -t ytfx .
docker run -p 3000:3000 -v /data:/data ytfx
```

Environment variables required:
- `PORT=3000`
- `NODE_ENV=production`
- `DB_PATH=/data/ytfx.db`
- `YOUTUBE_COOKIES` (optional)
- `STATS_TOKEN` (optional)

### Future: Self-Hosted
The Dockerfile is ready for self-hosted deployment via Docker or Kubernetes.

Recommended approach:
1. Build Docker image
2. Setup persistent volume for `/data`
3. Configure environment variables
4. Deploy using your infrastructure orchestration tool

## CI/CD

### GitHub Actions
Two workflows configured:

1. **ci.yml** - Runs on PR to master
   - Installs dependencies
   - Runs test suite
   - All tests must pass before merge

2. **deploy.yml** - Triggers on master push
   - Sends webhook to Render
   - Initiates automatic deployment
   - Requires `RENDER_DEPLOY_HOOK_URL` secret in GitHub

### Branch Protection
Master branch is protected and requires:
- PRs for all changes
- CI checks passing
- No stale branch policies
- Can force push only with repository permissions

## Monitoring

Current health check:
```bash
curl https://xyyoutube.com/health
```

Returns:
```json
{
  "status": "ok",
  "uptime": 12345,
  "cache": { "size": 42, "ttl_ms": 1800000 },
  "timestamp": "2026-03-02T12:34:56.789Z"
}
```

## Database

Located at: `/data/ytfx.db`

Tables:
- `requests` - Request logs with analytics data
- Indices on: `timestamp`, `video_id`, `type`, `ref`

Database is persisted to Render's 1GB persistent disk, backed up locally.
