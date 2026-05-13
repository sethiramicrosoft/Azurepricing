# Azure Pricing Tool — Architecture & Handover

## 1. What this app does
A **single-page web app** that compares **Microsoft EA pricing vs MCA-E retail pricing** for Azure SKUs. Users either upload a usage CSV/XLSX or paste product names; the app calls the public **Azure Retail Prices API** to fetch MCA-E rates in the chosen currency, then renders a side-by-side comparison with deltas, tier breakdowns, RI/SP handling, etc.

There is no database. All state lives in the browser. The only server-side component is a thin **HTTP proxy** to the Retail Prices API to avoid browser CORS errors.

---

## 2. Hosting model — Azure Static Web Apps (SWA)

Azure Static Web Apps gives us:
- **Static asset CDN** for the frontend (`src/index.html`)
- **Managed Functions runtime** for the API (`api/`) — wired to the same hostname as the static site
- **Free TLS, custom domains, automatic CI/CD** from the connected Git repo

Single deployed resource: the SWA at `lively-pond-04a6d3e00.7.azurestaticapps.net`.

```
                         ┌───────────────────────────────┐
   Browser (anyone) ───► │  Azure Static Web App         │
                         │  ─────────────────────────── │
                         │  /            → src/index.html│  (static, CDN)
                         │  /api/prices  → Managed Func  │  (Node 18, anonymous)
                         └─────────────┬─────────────────┘
                                       │ outbound HTTPS
                                       ▼
                         https://prices.azure.com/api/retail/prices
```

---

## 3. Repository layout

```
azure-pricing-swa/
├── src/
│   └── index.html                      ← entire frontend (vanilla JS, ~1450 lines, single file SPA)
├── api/
│   ├── host.json                       ← Functions host config (extension bundle v4)
│   ├── package.json                    ← Node 18+
│   └── prices/
│       ├── function.json               ← HTTP trigger binding, route = "prices"
│       └── index.js                    ← the proxy implementation
├── staticwebapp.config.json            ← SWA routing/headers config
├── .github/workflows/
│   └── azure-static-web-apps-...yml    ← GitHub Actions deployment (current CI/CD)
├── .gitignore
└── README.md
```

---

## 4. Frontend (`src/index.html`)

- **Single self-contained HTML file**: HTML, CSS, and vanilla JavaScript inlined. No bundler, no framework, no build step.
- Uses `SheetJS` (CDN) to parse XLSX in-browser.
- Uses native `fetch` to stream large CSVs.
- All comparisons, tier math, currency conversion, and CSV export run **client-side**.
- The only server call it makes is to `/api/prices` (the proxy below).

Key call site (in `src/index.html`):
```js
const PROXY = `${window.location.origin}/api/prices`;
const url = `${PROXY}?currencyCode=${ccy}&$filter=${encodeURIComponent(filter)}`;
```

---

## 5. The Functions proxy (`api/prices/`)

### Why we need it
The browser cannot call `https://prices.azure.com/api/retail/prices` directly because the Microsoft endpoint does not return permissive CORS headers. We host a tiny passthrough on the SWA's same origin so the browser sees a same-origin call.

### `function.json` — HTTP trigger binding
```json
{
  "bindings": [
    { "authLevel": "anonymous", "type": "httpTrigger", "direction": "in",
      "name": "req", "methods": ["get"], "route": "prices" },
    { "type": "http", "direction": "out", "name": "res" }
  ]
}
```
- `authLevel: anonymous` — public read-only proxy; no key required.
- `route: prices` — exposes `GET /api/prices`.
- SWA automatically prefixes `/api`, so the public path is `https://<host>/api/prices`.

### `index.js` — what the proxy does
1. Picks up four query params from the caller: `currencyCode`, `$filter`, `$skip`, `$top`.
2. Optionally accepts a `next` query param — if present, treats it as a full pagination URL returned by a previous call (the Retail API's `NextPageLink`).
3. Builds the upstream URL (`https://prices.azure.com/api/retail/prices?...`).
4. `fetch` with a 30-second `AbortSignal.timeout` (Functions default is 230 s — we fail fast instead).
5. Returns the upstream body verbatim with `Content-Type: application/json` and `Cache-Control: no-store`.
6. On any upstream error, returns HTTP **502** with a small JSON error envelope.

The proxy **does not** transform the payload — the frontend handles all parsing.

### `host.json` — Functions host config
Standard SWA-managed Functions setup: extension bundle `[4.*, 5.0.0)`, App Insights sampling enabled (Requests excluded to keep noise down).

### `package.json`
Declares Node 18 as the runtime. No npm dependencies — proxy uses the built-in global `fetch` and `AbortSignal.timeout` (Node 18+).

---

## 6. SWA routing & headers (`staticwebapp.config.json`)

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "/*.{js,css,png,jpg,svg,ico,webp}"]
  },
  "globalHeaders": {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  },
  "mimeTypes": { ".json": "application/json" }
}
```

- **navigationFallback** → SPA-style: any unknown route serves `/index.html`, except `/api/*` (must hit the Function) and static asset extensions.
- **globalHeaders** → forces no-cache (we want users to always get the latest HTML after a deploy) and basic content-type sniffing protection.

---

## 7. Current CI/CD — GitHub Actions (today)

`.github/workflows/azure-static-web-apps-lively-pond-04a6d3e00.yml`:

- Trigger: push or PR to `main`
- Action: `Azure/static-web-apps-deploy@v1`
- Inputs:
  - `app_location: ./src`
  - `api_location: api`
  - `output_location: ""` (no build step — files are deployed as-is)
  - Auth: GitHub repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN_LIVELY_POND_04A6D3E00` (the SWA deployment token, generated by Azure when the SWA was linked to GitHub)

Equivalent **Azure DevOps Pipelines** YAML (for the engineer doing the ADO setup):

```yaml
trigger:
  branches:
    include: [ main ]

pool:
  vmImage: 'ubuntu-latest'

steps:
- checkout: self
  submodules: true

- task: AzureStaticWebApp@0
  inputs:
    app_location: '/src'
    api_location: '/api'
    output_location: ''
    azure_static_web_apps_api_token: $(SWA_DEPLOYMENT_TOKEN)
```

Where `SWA_DEPLOYMENT_TOKEN` is a **secret pipeline variable** holding the SWA deployment token. Get it from the Azure Portal → your Static Web App → **Manage deployment token**.

Important: a SWA can have **only one active deployment source** (GitHub OR ADO, not both). If you want to keep GitHub as the live deploy source, ADO can still host a code mirror — just don't re-link the SWA to ADO. If you want ADO to deploy instead, switch the SWA's Deployment Configuration in the portal.

---

## 8. Local development

Frontend only:
```bash
# any static server works
cd src && python -m http.server 8000
# but /api/prices won't work unless you run SWA CLI
```

Full stack with SWA CLI (recommended):
```bash
npm install -g @azure/static-web-apps-cli
swa start ./src --api-location ./api
# serves http://localhost:4280 with the proxy wired up
```

---

## 9. Operational notes

- **Cost**: SWA Free tier covers everything we use. No paid Azure resources.
- **Secrets**: none in the repo. The proxy is anonymous; the SWA deploy token only lives as a CI secret.
- **Telemetry**: App Insights sampling is enabled in `host.json` but no AI resource is currently provisioned — wire one up if you want to monitor proxy errors.
- **Scaling**: Retail Prices API is rate-limited; the frontend already paces calls. Don't put a cache layer in the proxy without coordinating — the frontend assumes fresh data per request.
- **Disclaimer banner**: The frontend renders a sticky legal disclaimer at the bottom of every page. It is **mandatory** — do not remove it.

---

## 10. TL;DR for whoever's setting up ADO

1. Mirror this repo into Azure DevOps (`git remote add ado <url>; git push ado main`).
2. The application code is platform-neutral — no GitHub-specific dependencies in `src/` or `api/`.
3. To deploy from ADO: create a pipeline with the YAML in §7, store the SWA deployment token as a secret variable, and (in the Azure Portal) switch the SWA's deployment source from GitHub to Azure DevOps.
4. If you only want a code mirror and keep GitHub deploying, just leave the GitHub Actions workflow file alone — ADO ignores it.
