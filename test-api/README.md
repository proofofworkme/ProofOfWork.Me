# Local Production API Proxy

Use this for local development when the app should read production ProofOfWork
data without exposing the raw Bitcoin node and without browser CORS issues.

The browser calls the local same-origin path:

```text
/test-api/api/*
```

Vite forwards those requests to:

```text
https://computer.proofofwork.me/api/*
```

Use the explicit production API dev mode:

```bash
npm run dev:prod-api
```

That runs Vite in `prod-api` mode, which sets:

```text
VITE_POW_API_BASE=/test-api
```

Useful checks while the dev server is running:

```bash
curl "http://localhost:5173/test-api/health"
curl "http://localhost:5173/test-api/api/v1/registry?network=livenet"
curl "http://localhost:5173/test-api/api/v1/log?network=livenet"
curl "http://localhost:5173/test-api/api/v1/token?network=livenet"
```

Direct production checks:

```bash
curl "https://computer.proofofwork.me/health"
curl "https://computer.proofofwork.me/api/v1/registry?network=livenet"
curl "https://computer.proofofwork.me/api/v1/log?network=livenet"
curl "https://computer.proofofwork.me/api/v1/token?network=livenet"
```
