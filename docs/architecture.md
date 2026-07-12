# Architecture

## Chosen Hosting Split

The current public frontend is deployed with GitHub Pages at `/mola-di-sabot/`. Cloudflare Pages remains a good later option, and the AWS backend scaffold is still available for private app services.

The project shape is:

- GitHub Pages for the public React frontend.
- Google Sheets as the shared, non-technical finance source of truth.
- AWS Lambda, API Gateway, DynamoDB, and Cognito for future private app services.
- Terraform for AWS infrastructure.
- GitHub for repository hosting, CI, and deployment workflows.

This keeps the visible website cheap and simple while avoiding a finance setup that depends on Codex or one maintainer.

## App Shape

The visible app has three working areas:

- Calendar: month and week views with simple full-day availability per resident. The backend still stores morning/afternoon so future split days or imports can be represented.
- Tasks: simple work packages with estimates and planned dates.
- Hours: per-person hour entries tied to tasks or general work.

The finance view exists as a hidden direct route at `/mola-di-sabot/finanzen`. It is intentionally not shown in the main navigation.

The frontend can run in browser-local mode without an API. Setting `VITE_API_BASE_URL` moves reads and writes for the planning data to the Go backend.

## Finance Model

Finance is deliberately sheet-first and simple:

- `Bauphase` is the amortisable whole, for example `Mühle Täbu März-Juni 2026`.
- `Material / Position` keeps separate rows for purchases such as `Küche`, `Poschi`, and `Bauhaus Einkauf`.
- `Aufgabe` is only a sublist explaining the work rows.
- Work value is calculated once at Bauphase level, not per project or per task.
- Money and work produce provisional Anteile until the Verein accepts the rules.

The linked Google Sheet keeps the existing `Investitionen` and `Arbeit Wochen` tabs and adds one `Bauphasen` tab. Existing rows are tagged with Bauphase, while material and task labels remain simple helper fields.

Current finance defaults:

- `1 Bauphase`: `Mühle Täbu März-Juni 2026`.
- `8` hours per day.
- `25 CHF` per hour.
- `60` months amortisation.
- Work total from the current sheet: `49.5` days / `396` hours / `9'900 CHF` at the default rule.
- Material total from the current sheet: `3'126 CHF`, with `Poschi` still politically/legally open.

## Data Model

DynamoDB uses one table with `PK` and `SK` keys:

- `RESIDENTS` stores resident profiles.
- `AVAIL#YYYY-MM-DD` stores availability cells.
- `TASKS` stores task records.
- `HOURS#YYYY-MM-DD` stores hour entries.

This is deliberately compact for six people and keeps AWS costs low.

## Routing

GitHub Pages deploy copies `index.html` to `404.html`, so the hidden direct route `/mola-di-sabot/finanzen` loads the app and selects the finance view.
