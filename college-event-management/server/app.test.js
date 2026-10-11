import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";
import { createApp, initializeDatabase, provisionAdmin } from "./app.js";

let db;
let server;
let apiBase;
let studentCookie;
let adminCookie;
let eventId;
let ticketCode;

async function request(path, { cookie, ...options } = {}) {
  const headers = new Headers(options.headers ?? {});
  if (cookie) headers.set("Cookie", cookie);
  if (options.body && typeof options.body !== "string") {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

function cookieFrom(response) {
  return response.headers.getSetCookie().find((value) => value.startsWith("gather_session="))?.split(";")[0];
}

before(async () => {
  process.env.ADMIN_NAME = "Test administrator";
  process.env.ADMIN_EMAIL = "admin@example.test";
  process.env.ADMIN_PASSWORD = "test-password-strong";
  process.env.JWT_SECRET = "test-session-secret-with-adequate-randomness";
  process.env.PAYMENTS_MODE = "demo";
  db = new Database(":memory:");
  initializeDatabase(db);
  await provisionAdmin(db);
  server = createApp({ db }).listen(0, "127.0.0.1");
  await once(server, "listening");
  apiBase = `http://127.0.0.1:${server.address().port}`;
  const { response: adminResponse } = await request("/api/auth/login", {
    method: "POST",
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  adminCookie = cookieFrom(adminResponse);
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db?.close();
  delete process.env.ADMIN_NAME;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.JWT_SECRET;
  delete process.env.PAYMENTS_MODE;
});

test("requires authentication and assigns the student role at registration", async () => {
  const unauthenticated = await request("/api/events");
  assert.equal(unauthenticated.response.status, 401);

  const registered = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Student User", email: "student@example.test", password: "student-password" },
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.user.role, "student");
  studentCookie = cookieFrom(registered.response);
  assert.ok(studentCookie);
});

test("allows an administrator to create another administrator account", async () => {
  const created = await request("/api/admin/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: "Campus Admin 2",
      email: "admin2@example.test",
      password: "admin-password-strong",
    },
  });

  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.user.role, "admin");
  assert.equal(created.body.user.email, "admin2@example.test");
  assert.equal(created.body.generatedPassword, "admin-password-strong");

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "admin2@example.test", password: "admin-password-strong" },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.role, "admin");
  assert.ok(cookieFrom(login.response));
});

test("allows creating an administrator account from the registration flow", async () => {
  const adminSignup = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Admin Register", email: "admin-register@example.test", password: "admin-register-pass", role: "admin" },
  });

  assert.equal(adminSignup.response.status, 201, JSON.stringify(adminSignup.body));
  assert.equal(adminSignup.body.user.role, "admin");
  assert.equal(adminSignup.body.user.email, "admin-register@example.test");
});

test("imports reviewed CSV events and allows free tickets to be cancelled", async () => {
  const startsAt = new Date(Date.now() + 172_800_000).toISOString();
  const imported = await request("/api/admin/import/events", {
    method: "POST",
    cookie: adminCookie,
    headers: { "Content-Type": "text/csv" },
    body: `title,description,category,venue,startsAt,capacity,priceCents\nCSV campus event,Imported event,Arts,Studio,${startsAt},1,0`,
  });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.imported, 1);

  const events = await request("/api/events", { cookie: studentCookie });
  const event = events.body.events.find((record) => record.id === imported.body.eventIds[0]);
  assert.ok(event);

  const secondStudent = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Second Student", email: "second@example.test", password: "second-password" },
  });
  const secondStudentCookie = cookieFrom(secondStudent.response);
  const signups = await Promise.all([
    request(`/api/events/${event.id}/registrations`, { method: "POST", cookie: studentCookie }),
    request(`/api/events/${event.id}/registrations`, { method: "POST", cookie: secondStudentCookie }),
  ]);
  assert.deepEqual(signups.map(({ response }) => response.status).sort(), [201, 409]);
  const winnerIndex = signups.findIndex(({ response }) => response.status === 201);
  const winningCookie = winnerIndex === 0 ? studentCookie : secondStudentCookie;
  const registration = signups[winnerIndex];
  const cancelled = await request(`/api/me/registrations/${registration.body.registrationId}`, { method: "DELETE", cookie: winningCookie });
  assert.equal(cancelled.response.status, 204);

  const tickets = await request("/api/me/registrations", { cookie: winningCookie });
  const ticket = tickets.body.registrations.find((record) => record.id === registration.body.registrationId);
  assert.equal(ticket.status, "cancelled");
  assert.equal(ticket.paymentStatus, "free");
});

test("confirms paid event registration after an explicit demo payment", async () => {
  const created = await request("/api/events", {
    method: "POST",
    cookie: adminCookie,
    body: {
      title: "Paid demo event",
      description: "A simulated payment test",
      category: "Community",
      venue: "Innovation Hub",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      capacity: 20,
      priceCents: 2500,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));

  const student = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Paid Student", email: "paidstudent@example.test", password: "paid-student-pass" },
  });
  assert.equal(student.response.status, 201, JSON.stringify(student.body));
  const paidCookie = cookieFrom(student.response);

  const registration = await request(`/api/events/${created.body.event.id}/registrations`, {
    method: "POST",
    cookie: paidCookie,
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.body));
  assert.equal(registration.body.demoPayment, true);
  assert.equal(registration.body.status, "pending");

  const confirmation = await request(`/api/me/registrations/${registration.body.registrationId}/demo-payment/confirm`, {
    method: "POST",
    cookie: paidCookie,
  });
  assert.equal(confirmation.response.status, 200, JSON.stringify(confirmation.body));
  assert.equal(confirmation.body.status, "paid");

  const myRegistrations = await request("/api/me/registrations", { cookie: paidCookie });
  const myRegistration = myRegistrations.body.registrations.find((record) => record.id === registration.body.registrationId);
  assert.equal(myRegistration.paymentStatus, "paid");
  assert.equal(myRegistration.status, "registered");
});

test("enforces admin permissions and supports event registration through attendance and certificates", async () => {
  const forbidden = await request("/api/events", {
    method: "POST",
    cookie: studentCookie,
    body: { title: "Unauthorized", venue: "Quad", startsAt: new Date(Date.now() + 86_400_000).toISOString(), capacity: 10 },
  });
  assert.equal(forbidden.response.status, 403);

  const created = await request("/api/events", {
    method: "POST",
    cookie: adminCookie,
    body: {
      title: "Test campus event",
      description: "A test event",
      category: "Community",
      venue: "North Hall",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: null,
      capacity: 20,
      priceCents: 0,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  eventId = created.body.event.id;

  const registration = await request(`/api/events/${eventId}/registrations`, {
    method: "POST",
    cookie: studentCookie,
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.body));
  assert.equal(registration.body.status, "registered");

  const attendeeList = await request(`/api/events/${eventId}/registrations`, { cookie: adminCookie });
  assert.equal(attendeeList.response.status, 200);
  ticketCode = attendeeList.body.registrations[0].ticketCode;
  assert.ok(ticketCode);

  const checkIn = await request(`/api/events/${eventId}/check-ins`, {
    method: "POST",
    cookie: adminCookie,
    body: { ticketCode },
  });
  assert.equal(checkIn.response.status, 200);
  assert.equal(checkIn.body.status, "attended");

  const issue = await request(`/api/events/${eventId}/certificates`, { method: "POST", cookie: adminCookie });
  assert.deepEqual(issue.body, { issued: 1 });

  const certificate = await fetch(`${apiBase}/api/certificates/${registration.body.registrationId}.pdf`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(certificate.status, 200);
  assert.equal(certificate.headers.get("content-type"), "application/pdf");
  assert.equal((await certificate.arrayBuffer()).byteLength > 500, true);
});
