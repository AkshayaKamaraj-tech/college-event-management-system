import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import jwt from "jsonwebtoken";
import PDFDocument from "pdfkit";
import { parse } from "csv-parse/sync";
import Stripe from "stripe";

const cookieName = "gather_session";
const sessionLifetime = "7d";

export async function initializeDatabase(db) {
  if (!db.isPostgres) {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student', 'admin')) DEFAULT 'student',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Campus',
      venue TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'cancelled')) DEFAULT 'published',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      ticket_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'registered', 'cancelled', 'attended')),
      registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_in_at TEXT,
      UNIQUE (event_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS event_waitlist (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('waiting', 'cancelled')) DEFAULT 'waiting',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (event_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id),
      provider TEXT NOT NULL,
      provider_reference TEXT,
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id),
      certificate_number TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS events_status_date_idx ON events(status, starts_at);
    CREATE INDEX IF NOT EXISTS registrations_user_idx ON registrations(user_id, registered_at);
    CREATE INDEX IF NOT EXISTS registrations_event_status_idx ON registrations(event_id, status);
    CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status);
  `
    .replace("email TEXT NOT NULL UNIQUE COLLATE NOCASE,", db.isPostgres ? "email TEXT NOT NULL, " : "email TEXT NOT NULL UNIQUE COLLATE NOCASE,")
    .replaceAll("DEFAULT CURRENT_TIMESTAMP", db.isPostgres ? "DEFAULT CURRENT_TIMESTAMP::TEXT" : "DEFAULT CURRENT_TIMESTAMP"));
  if (db.isPostgres) await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));");
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
}

function sessionSecret() {
  const secret = process.env.JWT_SECRET ?? process.env.JMT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET or JMT_SECRET must be configured in production.");
  }
  return secret || "development-only-change-this-session-secret";
}

function setSessionCookie(res, user) {
  const token = jwt.sign({ sub: user.id }, sessionSecret(), { expiresIn: sessionLifetime });
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function requireAuth(db) {
  return async (req, res, next) => {
    try {
      const token = req.cookies[cookieName];
      if (!token) return res.status(401).json({ error: "Sign in to continue." });
      const claims = jwt.verify(token, sessionSecret());
      const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(claims.sub);
      if (!user) return res.status(401).json({ error: "Your account is no longer available." });
      req.user = publicUser(user);
      next();
    } catch {
      res.clearCookie(cookieName, { path: "/" });
      return res.status(401).json({ error: "Your session has expired. Sign in again." });
    }
  };
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access is required." });
  next();
}

function parseEventInput(body, { partial = false } = {}) {
  const input = {};
  const textFields = ["title", "description", "category", "venue", "startsAt", "endsAt", "status"];
  for (const field of textFields) {
    if (body[field] !== undefined) input[field] = body[field] == null ? "" : String(body[field]).trim();
  }
  for (const field of ["capacity", "priceCents"]) {
    if (body[field] !== undefined) input[field] = Number(body[field]);
  }
  if (!partial) {
    input.title ??= "";
    input.description ??= "";
    input.category ??= "Campus";
    input.venue ??= "";
    input.startsAt ??= "";
    input.capacity ??= 0;
    input.priceCents ??= 0;
    input.status ??= "published";
  }
  const errors = [];
  if (input.title !== undefined && !input.title) errors.push("Event title is required.");
  if (input.venue !== undefined && !input.venue) errors.push("Venue is required.");
  if (input.startsAt !== undefined && Number.isNaN(Date.parse(input.startsAt))) errors.push("A valid start date is required.");
  if (input.endsAt && Number.isNaN(Date.parse(input.endsAt))) errors.push("End date must be a valid date.");
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) errors.push("Event end time must be after the start time.");
  if (input.capacity !== undefined && (!Number.isInteger(input.capacity) || input.capacity < 1)) errors.push("Capacity must be a positive whole number.");
  if (input.priceCents !== undefined && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) errors.push("Price must be a non-negative whole number of cents.");
  if (input.status !== undefined && !["draft", "published", "cancelled"].includes(input.status)) errors.push("Invalid event status.");
  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.status = 400;
    throw error;
  }
  return input;
}

function eventRecord(row, attendeeCounts = new Map()) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    venue: row.venue,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    registeredCount: attendeeCounts.get(row.id) ?? row.registered_count ?? 0,
    priceCents: row.price_cents,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
  };
}

const eventSelect = `
  SELECT e.*,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status IN ('pending', 'registered', 'attended')) AS registered_count
  FROM events e
`;

function registrationRecord(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    venue: row.venue,
    startsAt: row.starts_at,
    priceCents: row.price_cents,
    currency: row.currency,
    ticketCode: row.ticket_code,
    status: row.status,
    registeredAt: row.registered_at,
    checkedInAt: row.checked_in_at,
    paymentStatus: row.price_cents === 0 ? "free" : row.payment_status ?? "pending",
    certificateId: row.certificate_id ?? null,
    certificateNumber: row.certificate_number ?? null,
  };
}

function normalizeHeader(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueFor(record, aliases) {
  for (const alias of aliases) {
    const value = record[alias];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

async function sendRegistrationEmail({ to, name, eventTitle, startsAt, venue, waitlisted = false }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return;
  const subject = waitlisted ? `Waitlist update: ${eventTitle}` : `Registration confirmed: ${eventTitle}`;
  const text = waitlisted
    ? `Hi ${name},\n\nYou have been added to the waitlist for ${eventTitle}. We will notify you if a place becomes available.`
    : `Hi ${name},\n\nYour registration for ${eventTitle} is confirmed.\nWhen: ${new Date(startsAt).toLocaleString()}\nWhere: ${venue}`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok) console.error(`Registration email delivery failed (${response.status}).`);
  } catch (error) {
    console.error("Registration email delivery failed.", error);
  }
}

const localTransactionQueues = new WeakMap();

function runTransaction(db, callback) {
  if (db.isPostgres) return db.transaction(callback);
  return async () => {
    const previous = localTransactionQueues.get(db) ?? Promise.resolve();
    const current = previous.then(callback);
    localTransactionQueues.set(db, current.catch(() => {}));
    return current;
  };
}

export function createApp({ db, stripeClient = null }) {
  const app = express();
  const auth = requireAuth(db);
  const stripe = stripeClient ?? (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null);
  const demoPaymentsEnabled = process.env.PAYMENTS_MODE === "demo" && process.env.NODE_ENV !== "production";

  app.disable("x-powered-by");

  app.post("/api/payments/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send("Payment webhook is not configured.");
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      return res.status(400).send(`Webhook signature error: ${error.message}`);
    }
    try {
      if (stripeEvent.type === "checkout.session.completed") {
        const checkout = stripeEvent.data.object;
        const registrationId = checkout.metadata?.registrationId;
        if (registrationId && checkout.payment_status === "paid") {
          const completePayment = runTransaction(db, async () => {
            await db.prepare("UPDATE registrations SET status = 'registered' WHERE id = ? AND status = 'pending'").run(registrationId);
            await db.prepare(`
              INSERT INTO payments (id, registration_id, provider, provider_reference, amount_cents, currency, status)
              VALUES (?, ?, 'stripe', ?, ?, ?, 'paid')
              ON CONFLICT(registration_id) DO UPDATE SET provider_reference = excluded.provider_reference, status = 'paid', updated_at = CURRENT_TIMESTAMP
            `).run(randomUUID(), registrationId, checkout.payment_intent ?? checkout.id, checkout.amount_total ?? 0, checkout.currency ?? "usd");
          });
          await completePayment();
          const confirmed = await db.prepare(`
            SELECT u.email, u.name, e.title, e.starts_at AS "startsAt", e.venue
            FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
            WHERE r.id = ? AND r.status = 'registered'
          `).get(registrationId);
          if (confirmed) await sendRegistrationEmail({ to: confirmed.email, name: confirmed.name, eventTitle: confirmed.title, startsAt: confirmed.startsAt, venue: confirmed.venue });
        }
      } else if (stripeEvent.type === "checkout.session.expired") {
        const registrationId = stripeEvent.data.object.metadata?.registrationId;
        if (registrationId) {
          await db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(registrationId);
          await db.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE registration_id = ?").run(registrationId);
        }
      }
    } catch {
      return res.status(500).send("Could not record payment event.");
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => res.json({ status: "ok" }));

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const name = String(req.body.name ?? "").trim();
      const email = String(req.body.email ?? "").trim().toLowerCase();
      const password = String(req.body.password ?? "");
      const requestedRole = String(req.body.role ?? "student").trim().toLowerCase();
      const role = process.env.NODE_ENV === "production" ? "student" : requestedRole;
      if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter a name between 2 and 100 characters." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
      if (!['student', 'admin'].includes(requestedRole)) return res.status(400).json({ error: "Account type must be student or admin." });
      const user = { id: randomUUID(), name, email, passwordHash: await bcrypt.hash(password, 12), role };
      await db.prepare("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)").run(user.id, user.name, user.email, user.passwordHash, user.role);
      const saved = publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").get(user.id));
      setSessionCookie(res, saved);
      res.status(201).json({ user: saved });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
      next(error);
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const email = String(req.body.email ?? "").trim().toLowerCase();
      const password = String(req.body.password ?? "");
      const row = await db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(email);
      if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
      const user = publicUser(row);
      setSessionCookie(res, user);
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", async (_req, res) => {
    res.clearCookie(cookieName, { path: "/" });
    res.status(204).end();
  });

  app.get("/api/auth/me", auth, async (req, res) => res.json({ user: req.user }));

  app.get("/api/events", auth, async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const statusFilter = req.user.role === "admin" && req.query.status === "all" ? "" : "published";
    const rows = await db.prepare(`${eventSelect}
      WHERE (? = '' OR e.status = ?) AND (? = '' OR e.category = ?)
        AND (? = '' OR e.title LIKE ? OR e.description LIKE ? OR e.venue LIKE ?)
      ORDER BY e.starts_at ASC
    `).all(statusFilter, statusFilter, category, category, search, `%${search}%`, `%${search}%`, `%${search}%`);
    res.json({ events: rows.map((row) => eventRecord(row)) });
  });

  app.get("/api/events/:eventId/eligibility", auth, async (req, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Only students can check registration eligibility." });
    const event = await db.prepare(`${eventSelect} WHERE e.id = ?`).get(req.params.eventId);
    if (!event || event.status !== "published") return res.status(409).json({ error: "This event is not available for registration." });
    if (Date.parse(event.starts_at) <= Date.now()) return res.status(409).json({ error: "Registration for this event has closed." });
    const existingRegistration = await db.prepare("SELECT id FROM registrations WHERE event_id = ? AND user_id = ?").get(event.id, req.user.id);
    if (existingRegistration) return res.status(409).json({ error: "You already have a registration for this event." });
    const existingWaitlistEntry = await db.prepare("SELECT id FROM event_waitlist WHERE event_id = ? AND user_id = ? AND status = 'waiting'").get(event.id, req.user.id);
    if (existingWaitlistEntry) return res.status(409).json({ error: "You are already on the waitlist for this event." });
    if (event.price_cents > 0 && !stripe && !demoPaymentsEnabled) {
      return res.status(503).json({ error: "Online payment is not configured. Contact an administrator." });
    }
    const isFull = event.registered_count >= event.capacity;
    res.json(isFull
      ? { eligible: true, canRegister: false, canWaitlist: true, message: "You are eligible to join the waitlist. This event is currently full." }
      : { eligible: true, canRegister: true, canWaitlist: false, message: "You are eligible to register for this event." });
  });

  app.post("/api/events", auth, requireAdmin, async (req, res, next) => {
    try {
      const event = parseEventInput(req.body);
      const id = randomUUID();
      await db.prepare(`INSERT INTO events
        (id, title, description, category, venue, starts_at, ends_at, capacity, price_cents, currency, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, event.title, event.description, event.category, event.venue, event.startsAt, event.endsAt || null, event.capacity, event.priceCents, String(req.body.currency ?? "usd").toLowerCase(), event.status, req.user.id);
      res.status(201).json({ event: eventRecord(await db.prepare(`${eventSelect} WHERE e.id = ?`).get(id)) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/events/:eventId", auth, requireAdmin, async (req, res, next) => {
    try {
      const existing = await db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.eventId);
      if (!existing) return res.status(404).json({ error: "Event not found." });
      const input = parseEventInput(req.body, { partial: true });
      const updated = {
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        category: input.category ?? existing.category,
        venue: input.venue ?? existing.venue,
        startsAt: input.startsAt ?? existing.starts_at,
        endsAt: input.endsAt ?? existing.ends_at,
        capacity: input.capacity ?? existing.capacity,
        priceCents: input.priceCents ?? existing.price_cents,
        status: input.status ?? existing.status,
      };
      const activeCount = (await db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status IN ('pending', 'registered', 'attended')").get(existing.id)).count;
      if (updated.capacity < activeCount) return res.status(400).json({ error: "Capacity cannot be lower than existing tickets." });
      await db.prepare(`UPDATE events SET title = ?, description = ?, category = ?, venue = ?, starts_at = ?, ends_at = ?, capacity = ?, price_cents = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(updated.title, updated.description, updated.category, updated.venue, updated.startsAt, updated.endsAt || null, updated.capacity, updated.priceCents, updated.status, existing.id);
      res.json({ event: eventRecord(await db.prepare(`${eventSelect} WHERE e.id = ?`).get(existing.id)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/import/events", auth, requireAdmin, express.text({ type: ["text/csv", "application/csv"], limit: "5mb" }), async (req, res, next) => {
    try {
      const records = parse(req.body, { columns: (headers) => headers.map(normalizeHeader), skip_empty_lines: true, trim: true, bom: true });
      const imported = [];
      const insert = db.prepare(`INSERT INTO events
        (id, title, description, category, venue, starts_at, ends_at, capacity, price_cents, currency, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const transaction = runTransaction(db, async () => {
        for (const [index, record] of records.entries()) {
          const event = {
            title: valueFor(record, ["title", "eventname", "name"]),
            description: valueFor(record, ["description", "details", "summary"]),
            category: valueFor(record, ["category", "type", "eventtype"]) || "Campus",
            venue: valueFor(record, ["venue", "location", "place"]),
            startsAt: valueFor(record, ["startsat", "startdatetime", "startdate", "eventdate", "date"]),
            endsAt: valueFor(record, ["endsat", "enddatetime", "enddate"]),
            capacity: Number(valueFor(record, ["capacity", "seats", "maxattendees"]) || 100),
            priceCents: Math.round(Number(valueFor(record, ["pricecents", "priceincents", "ticketpricecents"]) || 0)),
            status: "published",
          };
          const price = valueFor(record, ["price", "ticketprice"]);
          if (price && !valueFor(record, ["pricecents", "priceincents", "ticketpricecents"])) {
            event.priceCents = Math.round(Number(price) * 100);
          }
          if (Number.isNaN(event.priceCents)) event.priceCents = 0;
          try {
            const parsed = parseEventInput(event);
            const id = randomUUID();
            await insert.run(id, parsed.title, parsed.description, parsed.category, parsed.venue, parsed.startsAt, parsed.endsAt || null, parsed.capacity, parsed.priceCents, "usd", parsed.status, req.user.id);
            imported.push(id);
          } catch (error) {
            throw new Error(`CSV row ${index + 2}: ${error.message}`, { cause: error });
          }
        }
      });
      await transaction();
      res.status(201).json({ imported: imported.length, eventIds: imported });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/me/registrations", auth, async (req, res) => {
    const rows = await db.prepare(`
      SELECT r.*, e.title AS event_title, e.venue, e.starts_at, e.price_cents, e.currency,
        p.status AS payment_status, c.id AS certificate_id, c.certificate_number
      FROM registrations r JOIN events e ON e.id = r.event_id
      LEFT JOIN payments p ON p.registration_id = r.id
      LEFT JOIN certificates c ON c.registration_id = r.id
      WHERE r.user_id = ? ORDER BY e.starts_at ASC
    `).all(req.user.id);
    const waitlistRows = await db.prepare(`
      SELECT w.id, w.event_id, w.created_at, e.title AS event_title, e.venue, e.starts_at, e.price_cents, e.currency
      FROM event_waitlist w JOIN events e ON e.id = w.event_id
      WHERE w.user_id = ? AND w.status = 'waiting'
    `).all(req.user.id);
    const waitlistRegistrations = waitlistRows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      venue: row.venue,
      startsAt: row.starts_at,
      priceCents: row.price_cents,
      currency: row.currency,
      ticketCode: null,
      status: "waitlisted",
      registeredAt: row.created_at,
      paymentStatus: "waitlist",
      waitlist: true,
      certificateId: null,
      certificateNumber: null,
    }));
    res.json({ registrations: [...rows.map(registrationRecord), ...waitlistRegistrations].sort((first, second) => first.startsAt.localeCompare(second.startsAt)) });
  });

  app.get("/api/me/registrations/:registrationId/ticket.pdf", auth, async (req, res) => {
    const ticket = await db.prepare(`
      SELECT r.id, r.ticket_code, r.status, p.status AS payment_status, u.id AS user_id, u.name,
        e.title, e.starts_at, e.venue, e.price_cents, e.currency
      FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
      LEFT JOIN payments p ON p.registration_id = r.id
      WHERE r.id = ?
    `).get(req.params.registrationId);
    if (!ticket) return res.status(404).json({ error: "Ticket not found." });
    if (ticket.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "This ticket belongs to another student." });
    if (ticket.status === "cancelled" || (ticket.price_cents > 0 && ticket.payment_status !== "paid")) {
      return res.status(409).json({ error: "A ticket is available after registration and payment are confirmed." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${ticket.ticket_code}.pdf"`);
    const pdf = new PDFDocument({ size: "A4", margin: 54 });
    pdf.pipe(res);
    pdf.rect(30, 30, 535, 782).lineWidth(2).strokeColor("#28624f").stroke();
    pdf.fillColor("#28624f").font("Helvetica-Bold").fontSize(13).text("GATHER  /  CAMPUS COMMUNITY", 54, 78);
    pdf.fillColor("#25302b").fontSize(32).text("Event ticket", 54, 145);
    pdf.fillColor("#6f7e74").font("Helvetica").fontSize(12).text("ADMIT ONE", 54, 205);
    pdf.fillColor("#25302b").font("Helvetica-Bold").fontSize(22).text(ticket.title, 54, 239, { width: 485 });
    pdf.fillColor("#6f7e74").font("Helvetica").fontSize(13).text(`Attendee: ${ticket.name}`, 54, 305);
    pdf.text(`When: ${new Date(ticket.starts_at).toLocaleString()}`, 54, 334);
    pdf.text(`Where: ${ticket.venue}`, 54, 363);
    pdf.text(`Paid: ${new Intl.NumberFormat(undefined, { style: "currency", currency: ticket.currency.toUpperCase() }).format(ticket.price_cents / 100)}`, 54, 392);
    pdf.fillColor("#28624f").font("Helvetica-Bold").fontSize(19).text(ticket.ticket_code, 54, 478);
    pdf.fillColor("#829087").font("Helvetica").fontSize(10).text("Present this ticket code at event check-in.", 54, 510);
    pdf.end();
  });

  app.post("/api/events/:eventId/registrations", auth, async (req, res, next) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Only students can register for events." });
    let registrationId;
    try {
      const event = await runTransaction(db, async () => {
        const currentEvent = await db.prepare(`${eventSelect} WHERE e.id = ? AND e.status = 'published'${db.isPostgres ? " FOR UPDATE OF e" : ""}`).get(req.params.eventId);
        if (!currentEvent) throw Object.assign(new Error("This event is not available for registration."), { status: 404 });
        if (Date.parse(currentEvent.starts_at) <= Date.now()) throw Object.assign(new Error("Registration for this event has closed."), { status: 409 });
        const existingRegistration = await db.prepare("SELECT id FROM registrations WHERE event_id = ? AND user_id = ?").get(currentEvent.id, req.user.id);
        if (existingRegistration) throw Object.assign(new Error("You already have a registration for this event."), { status: 409 });
        const existingWaitlistEntry = await db.prepare("SELECT id FROM event_waitlist WHERE event_id = ? AND user_id = ? AND status = 'waiting'").get(currentEvent.id, req.user.id);
        if (existingWaitlistEntry) throw Object.assign(new Error("You are already on the waitlist for this event."), { status: 409 });
        if (currentEvent.registered_count >= currentEvent.capacity) {
          const waitlistId = await db.prepare(`INSERT INTO event_waitlist (id, event_id, user_id) VALUES (?, ?, ?)
            ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'waiting', created_at = CURRENT_TIMESTAMP
            RETURNING id`).get(randomUUID(), currentEvent.id, req.user.id).id;
          return { ...currentEvent, waitlisted: true, waitlistId };
        }
        if (currentEvent.price_cents > 0 && !stripe && !demoPaymentsEnabled) throw Object.assign(new Error("Online payment is not configured. Contact an administrator."), { status: 503 });
        registrationId = randomUUID();
        const ticketCode = randomBytes(8).toString("hex").toUpperCase();
        await db.prepare("INSERT INTO registrations (id, event_id, user_id, ticket_code, status) VALUES (?, ?, ?, ?, ?)")
          .run(registrationId, currentEvent.id, req.user.id, ticketCode, currentEvent.price_cents > 0 ? "pending" : "registered");
        if (currentEvent.price_cents === 0) {
          await db.prepare(`INSERT INTO payments (id, registration_id, provider, amount_cents, currency, status) VALUES (?, ?, 'none', 0, ?, 'paid')`)
            .run(randomUUID(), registrationId, currentEvent.currency);
        }
        return currentEvent;
      })();
      if (event.waitlisted) {
        await sendRegistrationEmail({ to: req.user.email, name: req.user.name, eventTitle: event.title, startsAt: event.starts_at, venue: event.venue, waitlisted: true });
        return res.status(201).json({ waitlisted: true, waitlistId: event.waitlistId, status: "waitlisted", notice: "You have been added to the event waitlist." });
      }
      if (event.price_cents === 0) {
        await sendRegistrationEmail({ to: req.user.email, name: req.user.name, eventTitle: event.title, startsAt: event.starts_at, venue: event.venue });
        return res.status(201).json({ registrationId, status: "registered" });
      }
      if (!stripe && demoPaymentsEnabled) {
        await db.prepare(`INSERT INTO payments (id, registration_id, provider, amount_cents, currency, status) VALUES (?, ?, 'demo', ?, ?, 'pending')`)
          .run(randomUUID(), registrationId, event.price_cents, event.currency);
        return res.status(201).json({ registrationId, status: "pending", demoPayment: true, amountCents: event.price_cents, currency: event.currency });
      }
      const checkout = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: registrationId,
        metadata: { registrationId },
        line_items: [{ quantity: 1, price_data: { currency: event.currency, unit_amount: event.price_cents, product_data: { name: event.title, description: event.venue } } }],
        success_url: `${req.protocol}://${req.get("host")}/?payment=success`,
        cancel_url: `${req.protocol}://${req.get("host")}/?payment=cancelled`,
      });
      await db.prepare(`INSERT INTO payments (id, registration_id, provider, provider_reference, amount_cents, currency, status) VALUES (?, ?, 'stripe', ?, ?, ?, 'pending')`)
        .run(randomUUID(), registrationId, checkout.id, event.price_cents, event.currency);
      res.status(201).json({ registrationId, status: "pending", checkoutUrl: checkout.url });
    } catch (error) {
      if (registrationId) {
        await db.prepare("DELETE FROM payments WHERE registration_id = ?").run(registrationId);
        await db.prepare("DELETE FROM registrations WHERE id = ? AND status = 'pending'").run(registrationId);
      }
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") return res.status(409).json({ error: "You already have a ticket for this event." });
      next(error);
    }
  });

  app.post("/api/me/registrations/:registrationId/demo-payment/confirm", auth, async (req, res) => {
    if (!demoPaymentsEnabled) return res.status(404).json({ error: "Demo payments are not enabled." });
    const result = await runTransaction(db, async () => {
      const registration = await db.prepare(`
        SELECT r.id, r.status, e.starts_at, p.provider, p.status AS payment_status
        FROM registrations r
        JOIN events e ON e.id = r.event_id
        JOIN payments p ON p.registration_id = r.id
        WHERE r.id = ? AND r.user_id = ?
      `).get(req.params.registrationId, req.user.id);
      if (!registration) return { status: 404, error: "Registration not found." };
      if (registration.provider !== "demo" || registration.status !== "pending" || registration.payment_status !== "pending") {
        return { status: 409, error: "This demo payment is no longer pending." };
      }
      if (Date.parse(registration.starts_at) <= Date.now()) return { status: 409, error: "This event has already started." };
      await db.prepare("UPDATE registrations SET status = 'registered' WHERE id = ?").run(registration.id);
      await db.prepare("UPDATE payments SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE registration_id = ?").run(registration.id);
      return { status: 200 };
    })();
    if (result.error) return res.status(result.status).json({ error: result.error });
    const confirmed = await db.prepare(`
      SELECT u.email, u.name, e.title, e.starts_at AS "startsAt", e.venue
      FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
      WHERE r.id = ?
    `).get(req.params.registrationId);
    if (confirmed) await sendRegistrationEmail({ to: confirmed.email, name: confirmed.name, eventTitle: confirmed.title, startsAt: confirmed.startsAt, venue: confirmed.venue });
    res.json({ status: "paid" });
  });

  app.delete("/api/me/waitlist/:waitlistId", auth, async (req, res) => {
    const entry = await db.prepare(`SELECT w.id, e.starts_at FROM event_waitlist w JOIN events e ON e.id = w.event_id
      WHERE w.id = ? AND w.user_id = ? AND w.status = 'waiting'`).get(req.params.waitlistId, req.user.id);
    if (!entry) return res.status(404).json({ error: "Waitlist entry not found." });
    if (Date.parse(entry.starts_at) <= Date.now()) return res.status(409).json({ error: "This event has already started. Please contact the event's point of contact (POC) for help." });
    await db.prepare("UPDATE event_waitlist SET status = 'cancelled' WHERE id = ?").run(entry.id);
    res.status(204).end();
  });

  app.delete("/api/me/registrations/:registrationId", auth, async (req, res) => {
    const registration = await db.prepare(`
      SELECT r.id, r.status, e.starts_at, p.status AS payment_status, p.provider
      FROM registrations r JOIN events e ON e.id = r.event_id
      LEFT JOIN payments p ON p.registration_id = r.id
      WHERE r.id = ? AND r.user_id = ?
    `).get(req.params.registrationId, req.user.id);
    if (!registration) return res.status(404).json({ error: "Ticket not found." });
    if (Date.parse(registration.starts_at) <= Date.now()) return res.status(409).json({ error: "This event has already started. Please contact the event's point of contact (POC) for help." });
    const pendingDemoPayment = registration.status === "pending" && registration.provider === "demo" && registration.payment_status === "pending";
    if (registration.status !== "registered" && !pendingDemoPayment) return res.status(409).json({ error: "This ticket is no longer active." });
    if (registration.provider === "stripe" && registration.payment_status === "paid") return res.status(409).json({ error: "Paid tickets must be refunded by an administrator." });
    await db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").run(registration.id);
    await db.prepare("UPDATE payments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE registration_id = ? AND provider IN ('none', 'demo')").run(registration.id);
    res.status(204).end();
  });

  app.post("/api/admin/users", auth, requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name ?? "").trim();
      const email = String(req.body.email ?? "").trim().toLowerCase();
      const password = String(req.body.password ?? "");

      if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter a name between 2 and 100 characters." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

      const existing = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email);
      if (existing) return res.status(409).json({ error: "An account with that email already exists." });

      const user = {
        id: randomUUID(),
        name,
        email,
        passwordHash: await bcrypt.hash(password, 12),
      };

      await db.prepare("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')")
        .run(user.id, user.name, user.email, user.passwordHash);

      const saved = publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").get(user.id));
      res.status(201).json({ user: saved, generatedPassword: password });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
      next(error);
    }
  });

  app.get("/api/users", auth, requireAdmin, async (_req, res) => {
    const users = (await db.prepare("SELECT * FROM users ORDER BY created_at DESC").all()).map(publicUser);
    res.json({ users });
  });

  app.patch("/api/users/:userId/role", auth, requireAdmin, async (req, res) => {
    const role = req.body.role;
    if (!["student", "admin"].includes(role)) return res.status(400).json({ error: "Role must be student or admin." });
    if (req.params.userId === req.user.id && role !== "admin") return res.status(400).json({ error: "You cannot remove your own administrator role." });
    const result = await db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.params.userId);
    if (!result.changes) return res.status(404).json({ error: "User not found." });
    res.json({ user: publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId)) });
  });

  app.get("/api/admin/payments", auth, requireAdmin, async (_req, res) => {
    const payments = await db.prepare(`
      SELECT p.id, p.registration_id, p.provider, p.provider_reference, p.amount_cents, p.currency, p.status, p.created_at,
        r.ticket_code, r.user_id, u.name AS student_name, u.email AS student_email,
        e.id AS event_id, e.title AS event_title
      FROM payments p JOIN registrations r ON r.id = p.registration_id
      JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
      ORDER BY p.created_at DESC
    `).all();
    res.json({ payments: payments.map((payment) => ({
      id: payment.id,
      registrationId: payment.registration_id,
      provider: payment.provider,
      amountCents: payment.amount_cents,
      currency: payment.currency,
      status: payment.provider === "none" && payment.status === "paid" ? "free" : payment.status,
      createdAt: payment.created_at,
      ticketCode: payment.ticket_code,
      student: { id: payment.user_id, name: payment.student_name, email: payment.student_email },
      event: { id: payment.event_id, title: payment.event_title },
    })) });
  });

  app.post("/api/admin/registrations/:registrationId/refund", auth, requireAdmin, async (req, res, next) => {
    try {
      const row = await db.prepare(`
        SELECT p.id AS payment_id, p.provider, p.provider_reference, p.status AS payment_status,
          r.id AS registration_id, r.status AS registration_status
        FROM payments p JOIN registrations r ON r.id = p.registration_id
        WHERE r.id = ?
      `).get(req.params.registrationId);
      if (!row) return res.status(404).json({ error: "Payment not found." });
      if (row.payment_status !== "paid" || row.provider !== "stripe") return res.status(409).json({ error: "Only completed Stripe payments can be refunded." });
      if (row.registration_status === "attended") return res.status(409).json({ error: "Tickets cannot be refunded after check-in." });
      if (row.provider === "stripe") {
        if (!stripe) return res.status(503).json({ error: "Stripe is not configured." });
        await stripe.refunds.create({ payment_intent: row.provider_reference });
      }
      const refund = runTransaction(db, async () => {
        await db.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.payment_id);
        await db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").run(row.registration_id);
      });
      await refund();
      res.json({ status: "refunded" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events/:eventId/registrations", auth, requireAdmin, async (req, res) => {
    const event = await db.prepare("SELECT id FROM events WHERE id = ?").get(req.params.eventId);
    if (!event) return res.status(404).json({ error: "Event not found." });
    const rows = await db.prepare(`
      SELECT r.*, u.name, u.email, e.title AS event_title, e.venue, e.starts_at, e.price_cents, e.currency,
        p.status AS payment_status, c.id AS certificate_id, c.certificate_number
      FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
      LEFT JOIN payments p ON p.registration_id = r.id
      LEFT JOIN certificates c ON c.registration_id = r.id
      WHERE r.event_id = ? ORDER BY r.registered_at ASC
    `).all(req.params.eventId);
    res.json({ registrations: rows.map((row) => ({ ...registrationRecord(row), name: row.name, email: row.email })) });
  });

  app.post("/api/events/:eventId/check-ins", auth, requireAdmin, async (req, res) => {
    const ticketCode = String(req.body.ticketCode ?? "").trim().toUpperCase();
    if (!ticketCode) return res.status(400).json({ error: "Enter a ticket code." });
    const result = await db.prepare(`UPDATE registrations SET status = 'attended', checked_in_at = CURRENT_TIMESTAMP
      WHERE event_id = ? AND ticket_code = ? AND status = 'registered'`).run(req.params.eventId, ticketCode);
    if (!result.changes) return res.status(404).json({ error: "No active ticket matched that code." });
    const registration = await db.prepare("SELECT id, user_id FROM registrations WHERE event_id = ? AND ticket_code = ?").get(req.params.eventId, ticketCode);
    res.json({ registrationId: registration.id, userId: registration.user_id, status: "attended" });
  });

  app.post("/api/events/:eventId/certificates", auth, requireAdmin, async (req, res) => {
    const event = await db.prepare("SELECT id FROM events WHERE id = ?").get(req.params.eventId);
    if (!event) return res.status(404).json({ error: "Event not found." });
    const attended = await db.prepare("SELECT id FROM registrations WHERE event_id = ? AND status = 'attended'").all(event.id);
    const issue = db.prepare("INSERT INTO certificates (id, registration_id, certificate_number) VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
    const transaction = runTransaction(db, async () => {
      for (const registration of attended) await issue.run(randomUUID(), registration.id, `GTH-${randomBytes(5).toString("hex").toUpperCase()}`);
    });
    await transaction();
    const count = (await db.prepare("SELECT COUNT(*) AS count FROM certificates WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = ?)").get(event.id)).count;
    res.json({ issued: count });
  });

  app.get("/api/certificates/:registrationId.pdf", auth, async (req, res) => {
    const certificate = await db.prepare(`
      SELECT c.certificate_number, c.issued_at, u.id AS user_id, u.name, e.title, e.starts_at, e.venue
      FROM certificates c JOIN registrations r ON r.id = c.registration_id
      JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
      WHERE r.id = ?
    `).get(req.params.registrationId);
    if (!certificate) return res.status(404).json({ error: "Certificate not found. Certificates are issued after attendance is recorded." });
    if (certificate.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "This certificate belongs to another student." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${certificate.certificate_number}.pdf"`);
    const pdf = new PDFDocument({ size: "A4", layout: "landscape", margin: 60 });
    pdf.pipe(res);
    pdf.rect(28, 28, 786, 538).lineWidth(2).strokeColor("#28624f").stroke();
    pdf.fillColor("#28624f").fontSize(13).font("Helvetica-Bold").text("GATHER  /  CAMPUS COMMUNITY", 0, 86, { align: "center" });
    pdf.fillColor("#25302b").font("Times-Bold").fontSize(39).text("Certificate of Attendance", 0, 157, { align: "center" });
    pdf.fillColor("#6f7e74").font("Helvetica").fontSize(15).text("This certifies that", 0, 225, { align: "center" });
    pdf.fillColor("#28624f").font("Times-Bold").fontSize(32).text(certificate.name, 0, 260, { align: "center" });
    pdf.fillColor("#6f7e74").font("Helvetica").fontSize(14).text("attended", 0, 314, { align: "center" });
    pdf.fillColor("#25302b").font("Helvetica-Bold").fontSize(20).text(certificate.title, 80, 342, { align: "center", width: 676 });
    pdf.fillColor("#6f7e74").font("Helvetica").fontSize(11).text(`${certificate.venue}  ·  ${new Date(certificate.starts_at).toLocaleDateString()}`, 0, 382, { align: "center" });
    pdf.fillColor("#829087").fontSize(9).text(`Certificate ${certificate.certificate_number}  ·  Issued ${new Date(certificate.issued_at).toLocaleDateString()}`, 0, 478, { align: "center" });
    pdf.end();
  });

  app.use(express.static(path.resolve("dist")));
  app.use(async (req, res, next) => {
    if (req.method === "GET" && req.path !== "/api" && !req.path.startsWith("/api/")) {
      return res.sendFile(path.resolve("dist", "index.html"), (error) => error && next());
    }
    return res.status(404).json({ error: "API route not found." });
  });
  app.use((error, _req, res, _next) => {
    void _next;
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") return res.status(409).json({ error: "That record already exists." });
    if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: "The server could not complete that request." });
  });

  return app;
}

export async function provisionAdmin(db) {
  const email = String(process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD ?? "");
  if (!email || !password || await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email)) return;
  const id = randomUUID();
  const name = String(process.env.ADMIN_NAME ?? "Campus administrator").trim();
  await db.prepare("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')")
    .run(id, name, email, await bcrypt.hash(password, 12));
}
