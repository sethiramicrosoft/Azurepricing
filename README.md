# Azure EA vs MCA-E Pricing Tool — Static Web App

Single-page tool for comparing Microsoft EA and MCA-E Azure pricing. Hosted on Azure Static Web Apps with a tiny Function proxy for the Azure Retail Prices API.

## Project layout
```
src/                       Static frontend (single file)
  index.html               The whole UI + JS
api/                       Azure Functions (Node 18)
  host.json
  package.json
  prices/
    function.json
    index.js               Proxy → https://prices.azure.com/api/retail/prices
staticwebapp.config.json   SWA routing + headers
```

## Local development
```powershell
npm install -g @azure/static-web-apps-cli
cd azure-pricing-swa
swa start src --api-location api
```
Open http://localhost:4280

## Deploy to Azure (one-time setup)
1. Push this folder to a new GitHub repo:
   ```powershell
   git init
   git add .
   git commit -m "Initial SWA"
   gh repo create azure-pricing-swa --public --source=. --push
   ```
2. In Azure Portal → Create resource → **Static Web App**
3. Plan: **Free**
4. Source: **GitHub** → pick your repo + `main` branch
5. Build presets: **Custom**
   - App location: `src`
   - API location: `api`
   - Output location: *(leave blank)*
6. Click **Create** — Azure injects a GitHub Actions workflow and deploys automatically (~3 min)

App is live at the URL shown on the SWA Overview page (e.g. `https://<name>.azurestaticapps.net`).

## Updates
`git push` to `main` — workflow redeploys automatically.

## Costs
**Free tier covers this**: 100 GB bandwidth/month, 0.5 GB storage, free SSL, custom domains.
