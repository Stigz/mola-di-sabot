# Mola di Sabot

A small planning app for the Mola di Sabot household: availability, work windows, tasks, and hours.

## Architecture

- **Frontend:** React + TypeScript + Vite, hosted on Cloudflare Pages.
- **Backend:** Go HTTP API, deployable to AWS Lambda behind API Gateway.
- **Data:** DynamoDB with a simple one-table layout.
- **Infrastructure:** Terraform for AWS resources.
- **Source and CI:** GitHub.

The frontend works locally with browser storage when no API URL is configured. When `VITE_API_BASE_URL` is set, it talks to the Go API.

## Local Development

Install dependencies:

```sh
npm install
cd backend && go mod download
```

Run the frontend:

```sh
npm run dev
```

Run the backend locally:

```sh
npm run backend:dev
```

Build everything:

```sh
npm run build
npm run backend:test
npm run lambda:build
```

## Deployment

Use Cloudflare Pages for the frontend and AWS for the backend. See [docs/deployment.md](docs/deployment.md).

