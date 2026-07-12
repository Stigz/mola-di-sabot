# Mola di Sabot

A small planning app for the Mola di Sabot household: availability, work windows, tasks, hours, and simple Bauphase finance tracking.

## Architecture

- **Frontend:** React + TypeScript + Vite, currently deployed with GitHub Pages.
- **Finance source:** Google Sheets, so the Verein can maintain finance data without depending on the website.
- **Backend scaffold:** Go HTTP API, deployable to AWS Lambda behind API Gateway.
- **Data scaffold:** DynamoDB with a simple one-table layout.
- **Infrastructure:** Terraform for AWS resources.
- **Source and CI:** GitHub.

The frontend works locally with browser storage when no API URL is configured. When `VITE_API_BASE_URL` is set, planning reads and writes go to the Go API.

## Finanzen

The finance page uses a simple model:

- **Bauphase:** the whole amortisable container, currently `Mühle Täbu März-Juni 2026`.
- **Projekt:** a category inside the Bauphase, such as `Küche`, `Abwasser`, or `Hühnerhüsli`.
- **Aufgabe/Notiz:** the concrete work description on each row.

Money and work create provisional Anteile until the Verein accepts the rules. The Google Sheet keeps the editable source data in `Investitionen`, `Arbeit Wochen`, and `Bauphasen`.

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

The public frontend deploys to GitHub Pages. See [docs/deployment.md](docs/deployment.md).

