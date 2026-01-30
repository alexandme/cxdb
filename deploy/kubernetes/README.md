# CXDB Kubernetes Deployment

This directory contains Kubernetes manifests for deploying CXDB to any Kubernetes cluster.

## Architecture

The deployment consists of:

1. **cxdb-server** (StatefulSet):
   - Single replica (v0.1.0 limitation)
   - Binary protocol (port 9009)
   - HTTP gateway (port 9010)
   - Persistent volume for data storage (10Gi default)

2. **cxdb-gateway** (Deployment):
   - 2 replicas (horizontally scalable)
   - Google OAuth authentication
   - React UI (embedded)
   - Proxies API requests to cxdb-server

3. **Ingress**:
   - HTTPS termination
   - Routes traffic to gateway
   - Uses cert-manager for TLS certificates

```
Internet
   ↓
[Ingress HTTPS]
   ↓
[cxdb-gateway Service :80] → [cxdb-gateway Pod :8080] ×2
   ↓
[cxdb-server Service :9010] → [cxdb-server Pod :9009/:9010]
   ↓
[PersistentVolume /data]
```

## Prerequisites

- Kubernetes cluster 1.20+ (any distribution: GKE, EKS, AKS, k3s, etc.)
- kubectl configured for your cluster
- Storage provisioner (for PersistentVolumeClaim)
- Ingress controller (nginx, traefik, etc.)
- cert-manager (recommended for TLS)

### Verify Prerequisites

```bash
# Check kubectl access
kubectl cluster-info

# Check storage classes
kubectl get storageclass

# Check ingress controller
kubectl get pods -n ingress-nginx  # or your ingress namespace

# Check cert-manager
kubectl get pods -n cert-manager
```

## Quick Start

### 1. Create Namespace

```bash
kubectl apply -f namespace.yaml
```

### 2. Configure Secrets

Copy the example secret:

```bash
cp secret.yaml.example secret.yaml
```

Edit `secret.yaml` and fill in:

**Required:**
- `GOOGLE_CLIENT_ID` - OAuth client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `SESSION_SECRET` - Generate with `openssl rand -hex 32`

**Optional:**
- `GOOGLE_ALLOWED_EMAILS` - Comma-separated list of allowed emails

Apply the secret:

```bash
kubectl apply -f secret.yaml
```

**Important:** Do NOT commit `secret.yaml` to version control!

### 3. Configure Settings

Edit `configmap.yaml` and update:

- `PUBLIC_BASE_URL` - Your public domain (e.g., "https://cxdb.example.com")
- `GOOGLE_ALLOWED_DOMAIN` - Email domain for access control (e.g., "example.com")
- `CXDB_LOG_LEVEL` - Set to "debug" for verbose logging (optional)
- `CXDB_ENABLE_METRICS` - Set to "true" to enable Prometheus (optional)

Apply the ConfigMap:

```bash
kubectl apply -f configmap.yaml
```

### 4. Update Container Images

Edit `statefulset.yaml` and update the image references:

```yaml
# cxdb-server
image: your-registry.io/cxdb:v0.1.0

# cxdb-gateway
image: your-registry.io/cxdb-gateway:v0.1.0
```

### 5. Configure Storage

Edit `statefulset.yaml` and set your storage class:

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      storageClassName: standard  # Update this
      resources:
        requests:
          storage: 10Gi  # Adjust size as needed
```

Common storage classes:
- **GKE:** `standard-rwo` or `premium-rwo`
- **EKS:** `gp2` or `gp3`
- **AKS:** `default` or `managed-premium`
- **k3s/local:** `local-path`

### 6. Configure Ingress

Edit `ingress.yaml` and update:

- `host` - Your domain (e.g., "cxdb.example.com")
- `ingressClassName` - Your ingress controller (e.g., "nginx", "traefik")
- Annotations for your specific ingress controller

### 7. Deploy

```bash
# Apply all manifests
kubectl apply -f service.yaml
kubectl apply -f statefulset.yaml
kubectl apply -f ingress.yaml

# Check deployment status
kubectl get all -n cxdb

# Watch pods come up
kubectl get pods -n cxdb -w
```

### 8. Verify Deployment

```bash
# Check pod status
kubectl get pods -n cxdb

# Expected output:
# NAME                            READY   STATUS    RESTARTS   AGE
# cxdb-gateway-xxx                1/1     Running   0          2m
# cxdb-gateway-yyy                1/1     Running   0          2m
# cxdb-server-0                   1/1     Running   0          2m

# Check services
kubectl get svc -n cxdb

# Check ingress
kubectl get ingress -n cxdb

# View logs
kubectl logs -n cxdb -l app.kubernetes.io/component=server -f
kubectl logs -n cxdb -l app.kubernetes.io/component=gateway -f
```

### 9. Access the Application

Get the ingress address:

```bash
kubectl get ingress cxdb -n cxdb
```

If using a domain, create a DNS record pointing to the ingress address:
- **Type:** A or CNAME
- **Name:** cxdb
- **Value:** Ingress external IP or hostname

Access your deployment:
- **URL:** https://cxdb.example.com
- Sign in with Google OAuth (domain-restricted)

## Google OAuth Setup

### 1. Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable "Google+ API"
4. Navigate to **APIs & Services** → **Credentials**
5. Click **Create Credentials** → **OAuth 2.0 Client ID**
6. Application type: **Web application**
7. Authorized redirect URIs:
   - `https://cxdb.example.com/auth/callback` (replace with your domain)
8. Save the **Client ID** and **Client Secret**

### 2. Update Kubernetes Secret

```bash
kubectl edit secret cxdb-secrets -n cxdb
```

Or re-create from `secret.yaml` with updated values.

## TLS Setup

### Option 1: cert-manager (Recommended)

Install cert-manager:

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

Create a ClusterIssuer for Let's Encrypt:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com  # Update this
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx  # Update for your ingress
```

Apply:

```bash
kubectl apply -f clusterissuer.yaml
```

cert-manager will automatically provision and renew certificates for your ingress.

### Option 2: Manual TLS Certificate

Create a secret with your certificate:

```bash
kubectl create secret tls cxdb-tls \
  --cert=path/to/tls.crt \
  --key=path/to/tls.key \
  -n cxdb
```

Remove the cert-manager annotation from `ingress.yaml`:

```yaml
# Remove this line:
# cert-manager.io/cluster-issuer: letsencrypt-prod
```

## Storage Management

### Backup

Create a backup of CXDB data:

```bash
# Create a backup job
kubectl run cxdb-backup \
  --image=alpine \
  --restart=Never \
  --rm -it \
  --overrides='
{
  "apiVersion": "v1",
  "spec": {
    "containers": [{
      "name": "backup",
      "image": "alpine",
      "command": ["tar", "czf", "/backup/cxdb-backup.tar.gz", "-C", "/data", "."],
      "volumeMounts": [
        {"name": "data", "mountPath": "/data"},
        {"name": "backup", "mountPath": "/backup"}
      ]
    }],
    "volumes": [
      {"name": "data", "persistentVolumeClaim": {"claimName": "data-cxdb-server-0"}},
      {"name": "backup", "hostPath": {"path": "/tmp"}}
    ]
  }
}' -n cxdb

# Copy backup from pod
kubectl cp cxdb-backup:/backup/cxdb-backup.tar.gz ./cxdb-backup.tar.gz -n cxdb
```

### Restore

```bash
# Scale down the StatefulSet
kubectl scale statefulset cxdb-server --replicas=0 -n cxdb

# Wait for pod to terminate
kubectl wait --for=delete pod/cxdb-server-0 -n cxdb --timeout=60s

# Restore data
kubectl run cxdb-restore \
  --image=alpine \
  --restart=Never \
  --rm -it \
  --overrides='
{
  "apiVersion": "v1",
  "spec": {
    "containers": [{
      "name": "restore",
      "image": "alpine",
      "command": ["sh", "-c", "rm -rf /data/* && tar xzf /backup/cxdb-backup.tar.gz -C /data"],
      "volumeMounts": [
        {"name": "data", "mountPath": "/data"},
        {"name": "backup", "mountPath": "/backup"}
      ]
    }],
    "volumes": [
      {"name": "data", "persistentVolumeClaim": {"claimName": "data-cxdb-server-0"}},
      {"name": "backup", "hostPath": {"path": "/tmp"}}
    ]
  }
}' -n cxdb

# Scale back up
kubectl scale statefulset cxdb-server --replicas=1 -n cxdb
```

### Expand Storage

If your storage class supports volume expansion:

```bash
# Edit the PVC
kubectl edit pvc data-cxdb-server-0 -n cxdb

# Change spec.resources.requests.storage to the new size
# Example: 50Gi

# The volume will expand automatically (may require pod restart)
```

## Monitoring

### Prometheus Metrics

Enable metrics in `configmap.yaml`:

```yaml
CXDB_ENABLE_METRICS: "true"
```

Update the StatefulSet annotation:

```yaml
prometheus.io/scrape: "true"
prometheus.io/port: "9011"
prometheus.io/path: "/metrics"
```

Apply changes and restart the server:

```bash
kubectl apply -f configmap.yaml
kubectl apply -f statefulset.yaml
kubectl delete pod cxdb-server-0 -n cxdb
```

### Grafana Dashboard

Import the CXDB dashboard:

```bash
# Get the dashboard JSON
curl -o cxdb-dashboard.json \
  https://raw.githubusercontent.com/strongdm/cxdb/main/deploy/grafana-dashboard.json

# Import via Grafana UI: Dashboards → Import
```

### Logs

View logs with kubectl:

```bash
# Server logs
kubectl logs -n cxdb -l app.kubernetes.io/component=server -f

# Gateway logs
kubectl logs -n cxdb -l app.kubernetes.io/component=gateway -f

# All logs
kubectl logs -n cxdb -l app.kubernetes.io/name=cxdb -f --all-containers

# JSON logs can be queried with jq
kubectl logs -n cxdb cxdb-server-0 | jq 'select(.level == "error")'
```

## Scaling

### Vertical Scaling (Server)

Update resource limits in `statefulset.yaml`:

```yaml
resources:
  requests:
    cpu: 2000m
    memory: 2Gi
  limits:
    cpu: 4000m
    memory: 4Gi
```

Apply and restart:

```bash
kubectl apply -f statefulset.yaml
kubectl delete pod cxdb-server-0 -n cxdb
```

### Horizontal Scaling (Gateway)

Scale the gateway deployment:

```bash
kubectl scale deployment cxdb-gateway --replicas=5 -n cxdb
```

Or update `statefulset.yaml` and apply.

### Server Scaling

CXDB v0.1.0 is single-process and **does not support horizontal scaling**. Keep `replicas: 1` for the StatefulSet.

Future versions may support:
- Read replicas (read-only secondaries)
- Sharding (partitioned data)

## Troubleshooting

### Pods not starting

Check events:

```bash
kubectl describe pod cxdb-server-0 -n cxdb
kubectl get events -n cxdb --sort-by='.lastTimestamp'
```

Common issues:
- **ImagePullBackOff:** Update image reference in `statefulset.yaml`
- **CrashLoopBackOff:** Check logs with `kubectl logs`
- **Pending:** Check PVC status with `kubectl get pvc -n cxdb`

### PVC not binding

```bash
kubectl get pvc -n cxdb
kubectl describe pvc data-cxdb-server-0 -n cxdb
```

Fixes:
- Verify storage class exists: `kubectl get storageclass`
- Check storage provisioner is running
- Ensure sufficient storage capacity

### Gateway can't reach server

Test connectivity:

```bash
kubectl exec -n cxdb deployment/cxdb-gateway -- curl http://cxdb-server:9010/health
```

If this fails:
- Verify service exists: `kubectl get svc cxdb-server -n cxdb`
- Check network policies: `kubectl get networkpolicies -n cxdb`
- Ensure pods are in the same namespace

### OAuth errors

Common issues:
1. **Redirect URI mismatch:**
   - Verify `PUBLIC_BASE_URL` in ConfigMap matches browser URL
   - Check Google Console redirect URI matches exactly

2. **Domain not allowed:**
   - Verify `GOOGLE_ALLOWED_DOMAIN` in ConfigMap
   - Or set `GOOGLE_ALLOWED_EMAILS` in Secret

3. **Session errors:**
   - Check `SESSION_SECRET` is exactly 64 hex characters
   - Clear browser cookies

### TLS certificate errors

If using cert-manager:

```bash
# Check certificate status
kubectl get certificate -n cxdb
kubectl describe certificate cxdb-tls -n cxdb

# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager -f
```

Common issues:
- DNS not pointing to ingress
- HTTP-01 challenge blocked by firewall
- ClusterIssuer not configured

### High memory usage

Adjust compression level to trade speed for memory:

```yaml
# configmap.yaml
CXDB_COMPRESSION_LEVEL: "1"  # Lower = faster but larger files
```

Or increase memory limits:

```yaml
# statefulset.yaml
resources:
  limits:
    memory: 4Gi
```

## Security Hardening

### Network Policies

Restrict network access:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: cxdb-netpol
  namespace: cxdb
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: cxdb
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - port: 8080
      protocol: TCP
```

### Pod Security Standards

Enable restricted PSS:

```yaml
# namespace.yaml
metadata:
  labels:
    pod-security.kubernetes.io/enforce: restricted
```

### RBAC

Create a service account with minimal permissions (already configured in StatefulSet).

## Upgrade Process

### Rolling Update

Update image tag in `statefulset.yaml`:

```yaml
image: cxdb/cxdb:v0.2.0
```

Apply:

```bash
kubectl apply -f statefulset.yaml
```

The StatefulSet will:
1. Delete the old pod
2. Create a new pod with the updated image
3. Preserve data on the PVC

**Note:** There will be downtime during the upgrade (single replica limitation).

### Rollback

```bash
# View history
kubectl rollout history statefulset cxdb-server -n cxdb

# Rollback to previous version
kubectl rollout undo statefulset cxdb-server -n cxdb
```

## Clean Up

### Delete Deployment

```bash
kubectl delete -f ingress.yaml
kubectl delete -f statefulset.yaml
kubectl delete -f service.yaml
kubectl delete -f configmap.yaml
kubectl delete -f secret.yaml
```

### Delete Namespace (including PVC)

**Warning:** This deletes all data!

```bash
kubectl delete namespace cxdb
```

### Preserve Data

To keep the PVC for later:

```bash
# Delete everything except the PVC
kubectl delete statefulset cxdb-server -n cxdb
kubectl delete deployment cxdb-gateway -n cxdb
kubectl delete svc,ingress,configmap,secret -n cxdb -l app.kubernetes.io/name=cxdb

# The PVC remains
kubectl get pvc -n cxdb
```

## Next Steps

- [Getting Started Guide](../../docs/getting-started.md) - Create your first context
- [Architecture](../../docs/architecture.md) - Understand the system design
- [HTTP API Reference](../../docs/http-api.md) - API documentation
- [Docker Compose Deployment](../docker-compose/README.md) - Local deployment
- [Type Registry](../../docs/type-registry.md) - Define custom types
- [Renderers](../../docs/renderers.md) - Create custom visualizations

## Support

For issues and questions:
- GitHub Issues: https://github.com/strongdm/cxdb/issues
- Documentation: https://github.com/strongdm/cxdb/tree/main/docs
