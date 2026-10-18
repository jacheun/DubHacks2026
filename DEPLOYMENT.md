# Deploy GroundworkAI

React and a lightweight API bridge run on Vercel. FastAPI + CPU YOLO run as one
long-lived Render web service. The selected model is bundled in the Docker image;
issues, scan records, and evidence images live on a persistent disk.

## 1. Publish the code

Deploy the same branch on both hosts. The selected `groundworkAI/models/best.pt`
is intentionally included (approximately 5 MB). All other `.pt` files, datasets,
`.env` secrets, and generated outputs remain ignored. Commit the new deployment
files and current integration changes, then push the branch. Do not publish `.env`.

## 2. Render backend

Create a Blueprint from this repository and select the branch containing
`render.yaml`. Review the paid 1 CPU / 2 GB service (`1c-2g`) and 5 GB persistent disk before
approving provisioning. The selected service has 2 GB RAM for CPU inference;
measure memory and latency before changing the plan.

Supply `MAPILLARY_TOKEN` when prompted. Docker installs CPU PyTorch and the Python
requirements, bundles the weights, and starts Uvicorn with one worker. Never enable
multiple workers or replicas with this SQLite/in-process scan implementation.

The disk mounts at `/var/data`; data is written under `/var/data/groundwork`.
Model updates require committing the replacement weights and redeploying. Local
SQLite data is not uploaded; the deployed app starts with an empty database.

After deploy, open `https://YOUR-BACKEND.onrender.com/api/health` and expect
`{"status":"ok","modelVersion":"..."}`. Keep the resulting public base URL.

## 3. Vercel frontend

In project Settings → Build and Deployment:

- Root Directory: `frontend`
- Framework: Vite
- Install Command: `npm ci` (or default)
- Build Command: `npm run build`
- Output Directory: `dist` (not `frontend/dist` when Root Directory is frontend)

Set `API_BACKEND_URL` in Vercel's server-side Environment Variables to the actual
Render origin, for example `https://your-service.onrender.com`. Select the required
Production/Preview environments and redeploy. This is not a `VITE_` variable and is
not exposed to the browser. Never put the Mapillary token in Vercel client code.

Ensure the deployment includes `frontend/api/[...path].js`. It proxies `/api/*`
requests and evidence images to Render. No cross-origin browser configuration is
needed. Vite's existing localhost proxy continues to handle local development.

If this branch is not your configured Production Branch, deploy it as a preview
first, or merge it into your Production Branch after review. Do not deploy an old
commit from main and expect unpushed branch changes to appear.

## 4. Smoke test

1. Open the Vercel URL followed by `/api/health`; it should return backend health.
2. Open the dashboard; pan/zoom to a neighborhood and let auto-scan start.
3. Check progress and any pending candidates, image evidence, and map locations.
4. Change a review status; refresh and confirm it persists.
5. Redeploy Render and confirm stored issues and images remain available.

A working scan may return no candidates. This checks deployment, not model accuracy.
The CPU service needs no Colab session or training dataset. Completed analyses are
cached. Scan jobs run in-process and stop on deploy/restart; the API marks them
interrupted and you can start a new scan without losing already saved issues.

## Local container test (requires Docker)

```sh
docker build -t groundwork-api .
docker run --rm -p 8000:8000 --env-file groundworkAI/.env \
  -v groundwork-data:/var/data groundwork-api
```

Do not run this on port 8000 while another local backend is listening there.

## Errors

- Vercel missing `public`: set Root Directory and Output Directory as above.
- `/api/*` gives 503: set `API_BACKEND_URL` in Vercel and redeploy.
- `/api/*` gives 502: check Render health, startup logs, and backend URL.
- Render health gives 503: ensure the selected `best.pt` was committed and bundled.
- Issues disappear after redeploy: verify the persistent disk and data path.


## Free demo: Vercel + Cloudflare Tunnel to your Mac

The same Vercel API bridge works with a temporary Cloudflare Quick Tunnel.
No Render service, Oracle VM, or GPU is needed. Run the backend locally and keep
both it and the tunnel running while demonstrating the app.

```sh
# Terminal 1, from the project root:
source .venv/bin/activate
python -m uvicorn api:app --app-dir groundworkAI --reload --port 8000

# Terminal 2, after installing cloudflared with Homebrew:
npm run tunnel
```

Use the HTTPS `trycloudflare.com` origin printed by cloudflared as Vercel's
`API_BACKEND_URL` environment value (no `/api` suffix). Select the applicable
Preview/Production environments and redeploy. Vercel must deploy this branch's
frontend with Root Directory `frontend` so its API bridge is included.

Test `https://YOUR-TUNNEL.trycloudflare.com/api/health`, then the Vercel site's
`/api/health`. Both should return `status: ok`. Use a normal browser, with no
client-side Mapillary tokens. Anyone with the tunnel URL can access this demo API.

Leave the Mac awake, lid open, and connected to the internet. To prevent idle
sleep while tunneling, run `caffeinate -i npm run tunnel` instead of `npm run tunnel`.
Stop with Control-C. The tunnel URL changes when you restart it; update Vercel's
environment variable and redeploy each time. A frontend redeploy alone does not
require restarting the tunnel. SQLite and evidence remain on your local disk.

Cloudflare Quick Tunnels are temporary development URLs without an uptime
commitment: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
