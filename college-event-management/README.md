
# Gather

Campus event management for students and administrators. The application uses React, an Express API, and SQLite. The database starts empty; accounts, events, registrations, payments, attendance, and certificates are stored by the API.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev:full
```

Open the Vite URL printed by the command. The development server proxies `/api` requests to the API on port 3001. The default database path is `server/data/campus.sqlite`.

Set `JWT_SECRET` to a long random value before exposing the API beyond local development. Set both `ADMIN_EMAIL` and `ADMIN_PASSWORD` to provision the first administrator on server startup. The administrator password is hashed before it is stored. New registrations always receive the student role; administrators can promote existing accounts from User Management.

## Deploy a shareable app on Render

This project uses SQLite, so deploy it as one Render web service with a persistent disk. The included `render.yaml` configures the service, builds the Vite app, serves the app and API from the same URL, and stores the database at `/var/data/campus.sqlite`. A persistent disk requires a paid Render web service; Render's free web services do not preserve local database files.

1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint**, connect the repository, and select `render.yaml`.
3. Enter the first administrator's email and a strong password when Render asks for `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Render generates `JWT_SECRET` for you.
4. Create the service and wait for its first deploy to finish. Share its `onrender.com` URL with your friend.

Keep the generated `JWT_SECRET` and administrator password private. Set Stripe and email environment variables in Render only if you want those optional features enabled. The default deployment uses free event registration and keeps simulated payments disabled.

## Core modules

- User Management: student registration and sign-in, admin-provisioned access, account listing, and role assignment.
- Events: organizers can create, edit, publish, cancel, and review registrations. Students check eligibility before registering; the API revalidates event status, timing, capacity, payment setup, and duplicate registrations at submission. Full events accept waitlist entries.
- Payments and tickets: free registrations create tickets immediately. Paid registrations use Stripe Checkout, or an explicitly confirmed simulated payment in local demo mode.
- Attendance and certificates: administrators check in tickets using ticket codes and issue certificates to checked-in attendees; students can download their own PDF certificates.

## Stripe test mode

Set `STRIPE_SECRET_KEY` to a Stripe test-mode secret and configure a webhook endpoint at `/api/payments/webhook` for `checkout.session.completed` and `checkout.session.expired`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Stripe Checkout is used whenever configured. Never commit real secrets.

## Registration email confirmations

To send confirmation and waitlist emails, set `RESEND_API_KEY` and `EMAIL_FROM` in `.env`. Without these values, the module still displays in-app confirmations but does not send email.

## Local payment demo

Set `PAYMENTS_MODE=demo` in `.env` to enable simulated paid registrations while running outside production. Students must confirm the displayed simulation; no money is charged. This mode is disabled in production and should not be used for real payments.

## Kaggle data

The API has an administrator-only CSV import endpoint at `POST /api/admin/import/events` (`Content-Type: text/csv`). It accepts event title/name, description, category/type, venue/location, start date/time, optional end date/time, capacity/seats, and `priceCents` columns. Import rows are validated and written to SQLite; they are not bundled with the application. Kaggle datasets vary, so map a selected dataset's columns to this format before importing it. Do not treat unrelated historical dataset rows as live campus events without reviewing dates and data rights.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/events`, `GET /api/events/:eventId/eligibility`, `POST /api/events`, `PATCH /api/events/:eventId`
- `GET /api/me/registrations`, `POST /api/events/:eventId/registrations`
- `DELETE /api/me/waitlist/:waitlistId`
- `GET /api/users`, `PATCH /api/users/:userId/role`
- `GET /api/events/:eventId/registrations`, `POST /api/events/:eventId/check-ins`
- `POST /api/events/:eventId/certificates`, `GET /api/certificates/:registrationId.pdf`

Authenticated requests use an HTTP-only session cookie. All non-health API routes require a session; administrative routes require the admin role.

## Checks

```powershell
npm test
npm run lint
npm run build
```

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
