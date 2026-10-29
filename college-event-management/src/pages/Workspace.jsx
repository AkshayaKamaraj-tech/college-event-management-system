import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  FileUp,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Pencil,
  Search,
  ShieldCheck,
  Ticket,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
import { apiRequest, downloadApiFile } from "../lib/api";
import "./workspace.css";

const modules = [
  { id: "users", title: "User management", short: "PEOPLE", icon: UserRoundCog, admin: true },
  { id: "events", title: "Events & registration", short: "EVENTS", icon: CalendarDays },
  { id: "payments", title: "Payments & tickets", short: "TICKETS", icon: CircleDollarSign },
  { id: "attendance", title: "Attendance & certificates", short: "ATTENDANCE", icon: BadgeCheck },
];

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "Date to be announced";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatMoney(cents, currency = "usd") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format((cents ?? 0) / 100);
}

function statusLabel(status) {
  return String(status ?? "unknown").replaceAll("_", " ");
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await apiRequest(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        body: form,
      });
      onAuthenticated(user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-art" aria-label="Gather campus event management">
        <div className="auth-brand"><span className="workspace-mark">g.</span> gather<span>.</span></div>
        <div className="auth-orbit orbit-one" />
        <div className="auth-orbit orbit-two" />
        <div className="auth-art-copy">
          <span className="auth-kicker">YOUR CAMPUS, IN MOTION</span>
          <h1>Make room<br />for what<br /><em>moves you.</em></h1>
          <p>One place for the people, events, and moments that make campus yours.</p>
        </div>
        <div className="auth-art-foot"><span>GATHER / CAMPUS COMMUNITY</span><span>01 — 04</span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="form-index">{mode === "login" ? "WELCOME BACK" : "FIND YOUR PEOPLE"}</span>
          <h2>{mode === "login" ? "Sign in to Gather" : "Create your account"}</h2>
          <p className="auth-subtitle">{mode === "login" ? "Your campus calendar is waiting." : "Join your campus community. Administrator access is managed by your campus team."}</p>
          <form className="auth-form" autoComplete="on" onSubmit={submit}>
            {mode === "register" && (
              <>
                <label>Full name<input autoComplete="name" required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              </>
            )}
            <label>Campus email<input type="email" name={mode === "login" ? "username" : "email"} autoComplete={mode === "login" ? "username" : "email"} required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Password<input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              {mode === "login" ? "Sign in" : "Create student account"}<ArrowRight size={16} />
            </button>
          </form>
          <p className="auth-switch">
            {mode === "login" ? "New to Gather?" : "Already have an account?"}
            <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
          <span className="auth-note"><ShieldCheck size={14} /> Private campus access</span>
        </div>
      </section>
    </main>
  );
}

function EventCard({ event, registration, busy, isAdmin, onRegister, onCheckEligibility, onCancelRegistration, onStatusChange, onViewRegistrations, onEdit }) {
  const [eligibility, setEligibility] = useState({ status: "unchecked", message: "" });

  async function checkEligibility() {
    setEligibility({ status: "checking", message: "" });
    try {
      const result = await onCheckEligibility(event);
      setEligibility({ status: "eligible", message: result.message, waitlist: result.canWaitlist });
    } catch (requestError) {
      setEligibility({ status: "ineligible", message: requestError.message });
    }
  }

  return (
    <article className="workspace-event-card">
      <div className={`event-art event-art-${event.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
        <span className="event-art-index">{formatDate(event.startsAt, { month: "short", day: "2-digit" })}</span>
        <CalendarDays size={23} strokeWidth={1.4} />
        <span className="event-art-category">{event.category}</span>
      </div>
      <div className="event-card-content">
        <div className="event-card-overline"><span>{formatDate(event.startsAt, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span><span>{event.status}</span></div>
        <h3>{event.title}</h3>
        <p className="event-description">{event.description || "A campus gathering. Make it yours."}</p>
        <div className="event-card-meta"><span>{event.venue}</span><span>{Math.max(0, event.capacity - event.registeredCount)} spots left</span></div>
        <div className="event-card-bottom">
          <strong>{event.priceCents === 0 ? "Free" : formatMoney(event.priceCents, event.currency)}</strong>
          {isAdmin ? (
            <div className="event-admin-actions">
              <select className="event-status-select" aria-label={`Set status for ${event.title}`} value={event.status} onChange={(change) => onStatusChange(event, change.target.value)}>
                <option value="draft">Draft</option><option value="published">Published</option><option value="cancelled">Cancelled</option>
              </select>
              <button className="text-button" onClick={() => onEdit(event)}><Pencil size={13} />Edit</button>
              <button className="text-button" onClick={() => onViewRegistrations(event)}><UsersRound size={13} />View registrations</button>
            </div>
          ) : registration ? (
            <div className="event-registration-actions">
              <span className={`status-pill status-${registration.status}`}><Check size={13} /> {statusLabel(registration.status)}</span>
              {registration.waitlist && <button className="text-button event-cancel-registration" disabled={busy} onClick={() => onCancelRegistration(registration)}>{busy ? <LoaderCircle className="spin" size={13} /> : null}Leave waitlist</button>}
              {registration.status === "registered" && registration.priceCents === 0 && <button className="text-button event-cancel-registration" disabled={busy} onClick={() => onCancelRegistration(registration)}>{busy ? <LoaderCircle className="spin" size={13} /> : null}Cancel registration</button>}
            </div>
          ) : event.status === "published" ? (
            <div className="event-registration-actions event-eligibility-actions">
              {eligibility.message && <p className={`eligibility-message eligibility-${eligibility.status}`} role={eligibility.status === "ineligible" ? "alert" : "status"}>{eligibility.message}</p>}
              <button className="text-button" disabled={busy || eligibility.status === "checking"} onClick={eligibility.status === "eligible" ? () => onRegister(event) : checkEligibility}>
                {busy || eligibility.status === "checking" ? <LoaderCircle className="spin" size={14} /> : null}
                {busy ? "Registering…" : eligibility.status === "checking" ? "Checking…" : eligibility.status === "eligible" ? eligibility.waitlist ? "Join waitlist" : "Register now" : "Check eligibility"}
                {!busy && eligibility.status !== "checking" ? <ArrowRight size={14} /> : null}
              </button>
            </div>
          ) : <span className="status-pill">{statusLabel(event.status)}</span>}
        </div>
      </div>
    </article>
  );
}

function EmptyPanel({ title, copy }) {
  return <div className="empty-panel"><span className="empty-panel-icon"><LayoutDashboard size={20} /></span><h3>{title}</h3><p>{copy}</p></div>;
}

function Workspace() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeModule, setActiveModule] = useState("events");
  const [events, setEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [users, setUsers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [attendees, setAttendees] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [search, setSearch] = useState("");
  const [loadedForUserId, setLoadedForUserId] = useState(null);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => {
    const paymentResult = new URLSearchParams(window.location.search).get("payment");
    if (!paymentResult) return "";
    window.history.replaceState({}, "", window.location.pathname);
    return paymentResult === "success"
      ? "Checkout complete. Your ticket will appear when payment is confirmed."
      : "Checkout was cancelled. No payment was completed.";
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [createdAdmin, setCreatedAdmin] = useState(null);
  const [ticketCode, setTicketCode] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [eventForm, setEventForm] = useState({ title: "", category: "", description: "", venue: "", startsAt: "", endsAt: "", capacity: "", price: "0" });
  const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    let mounted = true;
    apiRequest("/api/auth/me")
      .then(({ user: currentUser }) => { if (mounted) setUser(currentUser); })
      .catch((requestError) => { if (mounted && requestError.status !== 401) setError(requestError.message); })
      .finally(() => { if (mounted) setAuthReady(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let mounted = true;
    const requests = [
      apiRequest(`/api/events${user.role === "admin" ? "?status=all" : ""}`),
      apiRequest("/api/me/registrations"),
    ];
    if (user.role === "admin") requests.push(apiRequest("/api/users"), apiRequest("/api/admin/payments"));
    Promise.all(requests)
      .then((results) => {
        if (!mounted) return;
        setError("");
        setEvents(results[0].events);
        setRegistrations(results[1].registrations);
        if (user.role === "admin") {
          setUsers(results[2].users);
          setPayments(results[3].payments);
        }
        setSelectedEventId((current) => current || results[0].events[0]?.id || "");
      })
      .catch((requestError) => { if (mounted) setError(requestError.message); })
      .finally(() => { if (mounted) setLoadedForUserId(user.id); });
    return () => { mounted = false; };
  }, [user, refreshKey]);

  useEffect(() => {
    if (user?.role !== "admin" || activeModule !== "attendance" || !selectedEventId) return undefined;
    let mounted = true;
    apiRequest(`/api/events/${selectedEventId}/registrations`)
      .then(({ registrations: currentAttendees }) => { if (mounted) setAttendees(currentAttendees); })
      .catch((requestError) => { if (mounted) setError(requestError.message); });
    return () => { mounted = false; };
  }, [activeModule, selectedEventId, user, refreshKey]);

  async function runAction(key, action, successMessage) {
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(result?.notice ?? successMessage);
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyKey("");
    }
  }

  async function registerForEvent(event) {
    await runAction(`register-${event.id}`, async () => {
      const result = await apiRequest(`/api/events/${event.id}/registrations`, { method: "POST" });
      if (result.waitlisted) return { notice: result.notice };
      if (result.demoPayment) {
        const confirmed = window.confirm(`Simulate payment of ${formatMoney(result.amountCents, result.currency)}? This demo payment will not charge you.`);
        if (!confirmed) {
          await apiRequest(`/api/me/registrations/${result.registrationId}`, { method: "DELETE" });
          return { notice: "Demo payment cancelled. No ticket was created." };
        }
        await apiRequest(`/api/me/registrations/${result.registrationId}/demo-payment/confirm`, { method: "POST" });
        return { notice: "Demo payment confirmed. Your ticket is ready." };
      }
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
    }, event.priceCents > 0 ? "Opening secure checkout." : "Your ticket is confirmed.");
  }

  function browseEvents() {
    setShowEventForm(false);
    setEditingEventId(null);
    document.getElementById("event-browser")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleEventForm() {
    if (showEventForm) {
      setShowEventForm(false);
      setEditingEventId(null);
      return;
    }
    setEditingEventId(null);
    setEventForm({ title: "", category: "", description: "", venue: "", startsAt: "", endsAt: "", capacity: "", price: "0" });
    setShowEventForm(true);
  }

  function viewEventRegistrations(event) {
    setSelectedEventId(event.id);
    setActiveModule("attendance");
  }

  function editEvent(event) {
    const startsAt = new Date(event.startsAt);
    const endsAt = event.endsAt ? new Date(event.endsAt) : null;
    const asLocalInput = (date) => date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    setEventForm({
      title: event.title,
      category: event.category,
      description: event.description ?? "",
      venue: event.venue,
      startsAt: asLocalInput(startsAt),
      endsAt: asLocalInput(endsAt),
      capacity: String(event.capacity),
      price: (event.priceCents / 100).toFixed(2),
    });
    setEditingEventId(event.id);
    setShowEventForm(true);
    document.getElementById("event-browser")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveEvent(event) {
    event.preventDefault();
    const eventId = editingEventId;
    const actionKey = eventId ? `edit-event-${eventId}` : "create-event";
    await runAction(actionKey, async () => {
      await apiRequest(eventId ? `/api/events/${eventId}` : "/api/events", {
        method: eventId ? "PATCH" : "POST",
        body: {
          ...eventForm,
          startsAt: new Date(eventForm.startsAt).toISOString(),
          endsAt: eventForm.endsAt ? new Date(eventForm.endsAt).toISOString() : null,
          capacity: Number(eventForm.capacity),
          priceCents: Math.round(Number(eventForm.price || 0) * 100),
        },
      });
      setShowEventForm(false);
      setEditingEventId(null);
      setEventForm({ title: "", category: "", description: "", venue: "", startsAt: "", endsAt: "", capacity: "", price: "0" });
    }, eventId ? "Event updated." : "Event created.");
  }

  async function importEvents(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    await runAction("import", async () => {
      const csv = await file.text();
      await apiRequest("/api/admin/import/events", { method: "POST", headers: { "Content-Type": "text/csv" }, body: csv });
    }, "CSV events imported.");
    event.target.value = "";
  }

  async function createAdminAccount(event) {
    event.preventDefault();
    await runAction("create-admin", async () => {
      const result = await apiRequest("/api/admin/users", {
        method: "POST",
        body: { ...adminForm },
      });
      setCreatedAdmin({
        name: result.user.name,
        email: result.user.email,
        password: result.generatedPassword,
      });
      setShowAdminForm(false);
      setAdminForm({ name: "", email: "", password: "" });
    }, "Administrator account created.");
  }

  async function copyAdminInvite() {
    if (!createdAdmin) return;
    const invite = `Name: ${createdAdmin.name}\nEmail: ${createdAdmin.email}\nPassword: ${createdAdmin.password}\nRole: Admin`;
    try {
      await navigator.clipboard.writeText(invite);
      setNotice("Admin invitation copied to clipboard.");
    } catch {
      setNotice(`Admin invite ready: ${invite}`);
    }
  }

  async function updateRole(account, role) {
    await runAction(`role-${account.id}`, async () => {
      await apiRequest(`/api/users/${account.id}/role`, { method: "PATCH", body: { role } });
    }, "Account role updated.");
  }

  async function checkIn(event) {
    event.preventDefault();
    await runAction("check-in", async () => {
      await apiRequest(`/api/events/${selectedEventId}/check-ins`, { method: "POST", body: { ticketCode } });
      setTicketCode("");
    }, "Attendee checked in.");
  }

  async function logout() {
    try { await apiRequest("/api/auth/logout", { method: "POST" }); }
    finally {
      setUser(null);
      setActiveModule("events");
      setEvents([]);
      setRegistrations([]);
      setUsers([]);
      setPayments([]);
    }
  }

  if (!authReady) {
    return <main className="boot-screen"><LoaderCircle className="spin" size={22} /><span>Opening your campus space</span></main>;
  }
  if (!user) return <AuthScreen onAuthenticated={(currentUser) => { setError(""); setUser(currentUser); }} />;

  const active = modules.find((module) => module.id === activeModule) ?? modules[1];
  const loading = loadedForUserId !== user.id;
  const visibleModules = modules.filter((module) => !module.admin || user.role === "admin");
  const visibleEvents = events.filter((event) => `${event.title} ${event.category} ${event.venue}`.toLowerCase().includes(search.toLowerCase()));
  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const registrationByEvent = new Map(registrations.map((registration) => [registration.eventId, registration]));

  function changeModule(moduleId) {
    setActiveModule(moduleId);
    setMobileNavOpen(false);
    setError("");
  }

  return (
    <div className="workspace-shell">
      {mobileNavOpen && <button className="workspace-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`workspace-sidebar${mobileNavOpen ? " is-open" : ""}`}>
        <button className="workspace-brand" onClick={() => changeModule("events")}><span className="workspace-mark">g.</span><span>gather<span className="brand-period">.</span></span></button>
        <div className="workspace-school"><span className="school-live" />CAMPUS WORKSPACE</div>
        <div className="workspace-account"><span className="account-avatar">{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.role === "admin" ? "Administrator" : "Student account"}</small></span><ChevronDown size={15} /></div>
        <p className="workspace-nav-label">MANAGE YOUR CAMPUS</p>
        <nav className="workspace-nav" aria-label="Primary modules">
          {visibleModules.map(({ id, title, icon: Icon }, index) => (
            <button key={id} className={`workspace-nav-item${activeModule === id ? " is-active" : ""}`} onClick={() => changeModule(id)}>
              <Icon size={17} strokeWidth={1.8} /><span>{title}</span><small>0{index + 1}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom-line" />
        <div className="sidebar-foot"><span className="sidebar-foot-mark">g.</span><span>Campus, brought together.</span></div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar">
          <button className="workspace-mobile-toggle" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="workspace-crumb"><span>Gather</span><i>/</i><strong>{active.title}</strong></div>
          <div className="topbar-user"><span className="semester-status"><i />{user.role === "admin" ? "ADMIN SPACE" : "STUDENT SPACE"}</span><span className="topbar-divider" /><span className="topbar-name">{user.name}</span><button className="logout-button" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></div>
        </header>
        <div className="workspace-content">
          <section className="module-heading">
            <div><p className="module-kicker">{active.short} <span> / </span> CAMPUS OPERATIONS</p><h1>{active.title}</h1><p className="module-description">{activeModule === "users" ? "A thoughtful campus starts with the people in it." : activeModule === "events" ? "Create moments, bring people together, and keep every detail in one place." : activeModule === "payments" ? "Every registration, payment, and ticket, accounted for." : "Know who showed up. Celebrate what they made time for."}</p></div>
            <div className="module-date"><CalendarDays size={15} />{formatDate(new Date().toISOString(), { weekday: "long", month: "long", day: "numeric" })}</div>
          </section>

          {(error || notice) && <div className={`workspace-alert${error ? " alert-error" : " alert-success"}`} role={error ? "alert" : "status"}><span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message"><X size={15} /></button></div>}

          {activeModule === "users" && user.role === "admin" && (
            <section className="module-panel">
              <div className="panel-title-row">
                <div><p className="panel-overline">ACCESS & IDENTITY</p><h2>Campus accounts</h2></div>
                <div className="panel-actions">
                  <span className="panel-count">{users.length} accounts</span>
                  <button className="primary-button" onClick={() => setShowAdminForm((current) => !current)}>{showAdminForm ? <X size={15} /> : <ShieldCheck size={15} />}{showAdminForm ? "Close" : "Create admin"}</button>
                </div>
              </div>
              {showAdminForm && (
                <form className="event-create-form" onSubmit={createAdminAccount}>
                  <div className="form-grid">
                    <label>Full name<input required value={adminForm.name} onChange={(event) => setAdminForm({ ...adminForm, name: event.target.value })} /></label>
                    <label>Campus email<input type="email" required value={adminForm.email} onChange={(event) => setAdminForm({ ...adminForm, email: event.target.value })} /></label>
                    <label>Password<input type="password" required minLength={8} value={adminForm.password} onChange={(event) => setAdminForm({ ...adminForm, password: event.target.value })} /></label>
                  </div>
                  <div className="form-actions">
                    <button className="primary-button" disabled={busyKey === "create-admin"}>{busyKey === "create-admin" ? "Creating…" : "Create administrator"}<ArrowRight size={15} /></button>
                  </div>
                </form>
              )}
              {createdAdmin && (
                <div className="workspace-alert alert-success" role="status">
                  <span>
                    <strong>{createdAdmin.name}</strong> was created as an admin.<br />
                    Email: {createdAdmin.email}<br />
                    Password: {createdAdmin.password}
                  </span>
                  <button onClick={copyAdminInvite} aria-label="Copy admin invite">Copy invite</button>
                </div>
              )}
              {users.length === 0 ? <EmptyPanel title="No accounts yet" copy="Student and administrator accounts will appear here as people join." /> : (
                <div className="table-scroll"><table className="data-table"><thead><tr><th>ACCOUNT</th><th>EMAIL</th><th>ROLE</th><th>JOINED</th><th /></tr></thead><tbody>
                  {users.map((account) => <tr key={account.id}><td><div className="table-person"><span className="table-avatar">{account.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><strong>{account.name}</strong></div></td><td>{account.email}</td><td><span className={`role-label role-${account.role}`}>{account.role}</span></td><td>{formatDate(account.createdAt)}</td><td><select aria-label={`Change role for ${account.name}`} value={account.role} disabled={account.id === user.id || busyKey === `role-${account.id}`} onChange={(event) => updateRole(account, event.target.value)}><option value="student">Student</option><option value="admin">Admin</option></select></td></tr>)}
                </tbody></table></div>
              )}
            </section>
          )}

          {activeModule === "events" && (
            <>
              <section className="module-metrics">
                <article><span className="metric-icon metric-sage"><CalendarDays size={17} /></span><span><small>LISTED EVENTS</small><strong>{events.filter((event) => event.status === "published").length}</strong></span></article>
                <article><span className="metric-icon metric-rose"><Ticket size={17} /></span><span><small>YOUR TICKETS</small><strong>{registrations.filter((registration) => registration.status !== "cancelled").length}</strong></span></article>
                <article><span className="metric-icon metric-blue"><UsersRound size={17} /></span><span><small>ON YOUR CAMPUS</small><strong>{user.role === "admin" ? users.length : "—"}</strong></span></article>
              </section>
              <section id="event-browser" className="module-panel events-panel">
                <div className="panel-title-row"><div><p className="panel-overline">DISCOVER & ORGANIZE</p><h2>{user.role === "admin" ? "Campus events" : "Find your next thing"}</h2></div><div className="panel-actions">
                  <label className="workspace-search"><Search size={15} /><input placeholder="Search events" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                  <button className="outline-button" onClick={browseEvents}><Search size={15} />Browse events</button>
                  {user.role === "admin" && <><label className="outline-button import-button"><FileUp size={15} />Import CSV<input type="file" accept=".csv,text/csv" onChange={importEvents} /></label><button className="primary-button" onClick={toggleEventForm}>{showEventForm ? <X size={15} /> : <CalendarDays size={15} />}{showEventForm ? "Close" : "Create event"}</button></>}
                </div></div>
                {showEventForm && user.role === "admin" && <form className="event-create-form" onSubmit={saveEvent}>
                  <div className="form-grid"><label>Event name<input required value={eventForm.title} onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })} /></label><label>Category<input required value={eventForm.category} onChange={(event) => setEventForm({ ...eventForm, category: event.target.value })} /></label><label>Venue<input required value={eventForm.venue} onChange={(event) => setEventForm({ ...eventForm, venue: event.target.value })} /></label><label>Starts<input required type="datetime-local" value={eventForm.startsAt} onChange={(event) => setEventForm({ ...eventForm, startsAt: event.target.value })} /></label><label>Capacity<input required min="1" type="number" value={eventForm.capacity} onChange={(event) => setEventForm({ ...eventForm, capacity: event.target.value })} /></label><label>Ticket price<input min="0" step="0.01" type="number" value={eventForm.price} onChange={(event) => setEventForm({ ...eventForm, price: event.target.value })} /></label><label className="form-wide">Description<textarea rows="2" value={eventForm.description} onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })} /></label></div>
                  <div className="form-actions"><button type="button" className="outline-button" onClick={browseEvents}>Browse events</button><button className="primary-button" disabled={busyKey === (editingEventId ? `edit-event-${editingEventId}` : "create-event")}>{busyKey === (editingEventId ? `edit-event-${editingEventId}` : "create-event") ? "Saving…" : editingEventId ? "Save changes" : "Publish event"}<ArrowRight size={15} /></button></div>
                </form>}
                {loading ? <div className="loading-inline"><LoaderCircle className="spin" size={18} />Loading campus events</div> : visibleEvents.length ? <div className="workspace-event-grid">{visibleEvents.map((event) => <EventCard key={event.id} event={event} registration={registrationByEvent.get(event.id)} busy={busyKey === `register-${event.id}` || busyKey === `cancel-${registrationByEvent.get(event.id)?.id}`} isAdmin={user.role === "admin"} onCheckEligibility={(currentEvent) => apiRequest(`/api/events/${currentEvent.id}/eligibility`)} onRegister={registerForEvent} onCancelRegistration={(registration) => runAction(`cancel-${registration.id}`, () => apiRequest(registration.waitlist ? `/api/me/waitlist/${registration.id}` : `/api/me/registrations/${registration.id}`, { method: "DELETE" }), registration.waitlist ? "You have left the event waitlist." : "Registration cancelled.")} onEdit={editEvent} onViewRegistrations={viewEventRegistrations} onStatusChange={(currentEvent, status) => runAction(`status-${currentEvent.id}`, () => apiRequest(`/api/events/${currentEvent.id}`, { method: "PATCH", body: { status } }), "Event status updated.")} />)}</div> : <EmptyPanel title={search ? "No matching events" : "The calendar is open"} copy={search ? "Try a different name, category, or venue." : user.role === "admin" ? "Create an event or import reviewed event data from a Kaggle CSV." : "Your campus team has not published any events yet."} />}
              </section>
            </>
          )}

          {activeModule === "payments" && (
            <section className="module-panel"><div className="panel-title-row"><div><p className="panel-overline">TICKETS & TRANSACTIONS</p><h2>{user.role === "admin" ? "Payment ledger" : "Your tickets"}</h2></div><span className="panel-count">{user.role === "admin" ? payments.length : registrations.length} records</span></div>
              {user.role === "admin" ? payments.length === 0 ? <EmptyPanel title="No transactions yet" copy="Ticket payments will appear here as students register for events." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>STUDENT</th><th>EVENT</th><th>AMOUNT</th><th>STATUS</th><th>DATE</th><th /></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td><div className="table-person"><span className="table-avatar">{payment.student.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{payment.student.name}</strong><small>{payment.student.email}</small></span></div></td><td>{payment.event.title}</td><td>{formatMoney(payment.amountCents, payment.currency)}</td><td><span className={`status-pill status-${payment.status}`}>{statusLabel(payment.status)}</span></td><td>{formatDate(payment.createdAt)}</td><td>{payment.provider === "stripe" && payment.status === "paid" && <button className="table-action" disabled={busyKey === `refund-${payment.registrationId}`} onClick={() => runAction(`refund-${payment.registrationId}`, () => apiRequest(`/api/admin/registrations/${payment.registrationId}/refund`, { method: "POST" }), "Payment refunded and ticket cancelled.")}>Refund</button>}</td></tr>)}</tbody></table></div> : registrations.length === 0 ? <EmptyPanel title="Your ticket wallet is waiting" copy="When you register for an event, your ticket and payment status will show up here." /> : <div className="ticket-list">{registrations.map((registration) => <article className="ticket-row" key={registration.id}><span className="ticket-stamp"><Ticket size={19} /></span><div className="ticket-main"><span className="panel-overline">{registration.ticketCode}</span><h3>{registration.eventTitle}</h3><p>{formatDate(registration.startsAt, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} · {registration.venue}</p></div><span className={`status-pill status-${registration.paymentStatus}`}>{statusLabel(registration.paymentStatus)}</span><strong className="ticket-price">{formatMoney(registration.priceCents, registration.currency)}</strong>{registration.status === "registered" && registration.paymentStatus !== "pending" && <button className="table-action" onClick={() => downloadApiFile(`/api/me/registrations/${registration.id}/ticket.pdf`, `${registration.ticketCode}.pdf`).catch((downloadError) => setError(downloadError.message))}><ArrowDownToLine size={13} />Generate ticket</button>}{registration.status === "registered" && <button className="table-action" onClick={() => runAction(`cancel-${registration.id}`, () => apiRequest(`/api/me/registrations/${registration.id}`, { method: "DELETE" }), "Ticket cancelled.")}>Cancel</button>}</article>)}</div>}
            </section>
          )}

          {activeModule === "attendance" && (
            <section className="module-panel"><div className="panel-title-row"><div><p className="panel-overline">SHOW UP & SHINE</p><h2>{user.role === "admin" ? "Attendance desk" : "Your certificates"}</h2></div>{user.role === "admin" && <label className="event-picker"><span>EVENT</span><select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}><option value="">Choose an event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>}</div>
              {user.role === "admin" ? !selectedEvent ? <EmptyPanel title="Choose an event to begin" copy="Select an event to check in attendees and issue certificates." /> : <><div className="attendance-toolbar"><div><span className="panel-overline">CHECK-IN FOR</span><strong>{selectedEvent.title}</strong><small>{attendees.filter((attendee) => attendee.status === "attended").length} of {attendees.length} checked in</small></div><form className="check-in-form" onSubmit={checkIn}><label htmlFor="ticket-code">TICKET CODE</label><div><input id="ticket-code" autoComplete="off" value={ticketCode} onChange={(event) => setTicketCode(event.target.value.toUpperCase())} placeholder="Enter ticket code" required /><button className="primary-button" disabled={busyKey === "check-in"}>{busyKey === "check-in" ? "Checking…" : "Check in"}<ClipboardCheck size={15} /></button></div></form></div><div className="attendee-list">{attendees.length ? attendees.map((attendee) => <div className="attendee-row" key={attendee.id}><span className={`attendee-check${attendee.status === "attended" ? " is-checked" : ""}`}>{attendee.status === "attended" ? <Check size={14} /> : null}</span><span className="attendee-name"><strong>{attendee.name}</strong><small>{attendee.email}</small></span><code>{attendee.ticketCode}</code><span className={`status-pill status-${attendee.status}`}>{statusLabel(attendee.status)}</span>{attendee.status === "attended" && attendee.certificateId && <BadgeCheck size={16} className="certificate-issued" />}</div>) : <EmptyPanel title="No registrations for this event" copy="Ticket holders will appear here after registration." />}</div><div className="certificate-actions"><span><ShieldCheck size={16} />Certificates only go to checked-in attendees.</span><button className="primary-button" disabled={busyKey === "issue-certificates" || !attendees.some((attendee) => attendee.status === "attended")} onClick={() => runAction("issue-certificates", () => apiRequest(`/api/events/${selectedEventId}/certificates`, { method: "POST" }), "Certificates generated for attendees.")}>Generate certificates<ArrowRight size={15} /></button></div></> : registrations.length === 0 ? <EmptyPanel title="Your milestones will live here" copy="Attend an event and your certificate will be ready to download here." /> : <div className="certificate-list">{registrations.filter((registration) => registration.certificateId).map((registration) => <article className="certificate-row" key={registration.id}><span className="certificate-seal"><BadgeCheck size={21} /></span><div><span className="panel-overline">{registration.certificateNumber}</span><h3>{registration.eventTitle}</h3><p>Issued {formatDate(registration.startsAt)} · Attendance verified</p></div><button className="outline-button" onClick={() => downloadApiFile(`/api/certificates/${registration.id}.pdf`, `${registration.certificateNumber}.pdf`).catch((downloadError) => setError(downloadError.message))}><ArrowDownToLine size={15} />Download PDF</button></article>)}</div>}
            </section>
          )}

          <footer className="workspace-footer"><span>GATHER / CAMPUS OPERATIONS</span><span>Built around your campus community.</span></footer>
        </div>
      </main>
    </div>
  );
}

export default Workspace;
