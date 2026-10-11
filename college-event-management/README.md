
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

## Core modules

- User Management: student registration and sign-in, admin-provisioned access, account listing, and role assignment.
- Events: create, edit, publish, cancel, browse, and register for events. Event capacity is checked by the API.
- Payments and tickets: free registrations create tickets immediately. Paid registrations use Stripe Checkout, or an explicitly confirmed simulated payment in local demo mode.
- Attendance and certificates: administrators check in tickets using ticket codes and issue certificates to checked-in attendees; students can download their own PDF certificates.

## Stripe test mode

Set `STRIPE_SECRET_KEY` to a Stripe test-mode secret and configure a webhook endpoint at `/api/payments/webhook` for `checkout.session.completed` and `checkout.session.expired`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Stripe Checkout is used whenever configured. Never commit real secrets.

## Local payment demo

Set `PAYMENTS_MODE=demo` in `.env` to enable simulated paid registrations while running outside production. Students must confirm the displayed simulation; no money is charged. This mode is disabled in production and should not be used for real payments.

## Kaggle data

The API has an administrator-only CSV import endpoint at `POST /api/admin/import/events` (`Content-Type: text/csv`). It accepts event title/name, description, category/type, venue/location, start date/time, optional end date/time, capacity/seats, and `priceCents` columns. Import rows are validated and written to SQLite; they are not bundled with the application. Kaggle datasets vary, so map a selected dataset's columns to this format before importing it. Do not treat unrelated historical dataset rows as live campus events without reviewing dates and data rights.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/events`, `POST /api/events`, `PATCH /api/events/:eventId`
- `GET /api/me/registrations`, `POST /api/events/:eventId/registrations`
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
