const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const [, key, rawValue = ""] = match;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

loadEnvFile();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "db.json");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "app_state";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const emptyState = {
  user: null,
  users: [],
  clients: [],
  projects: [],
  tasks: [],
  payments: [],
  deadlines: [],
  timeLogs: [],
  attachments: [],
  comments: [],
  activity: [],
  milestones: [],
  settings: {
    businessName: "ProjectFlow",
    invoicePrefix: "INV",
    defaultCurrency: "USD"
  }
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".pdf": "application/pdf"
};

function ensureDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyState, null, 2));
  }
  const uploadsDir = path.join(ROOT, "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }
}

async function readDb() {
  ensureDb();
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.main&select=data`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.message || "Could not read Supabase state");
    return { ...emptyState, ...(rows[0]?.data || {}) };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

async function writeDb(data, options = {}) {
  const preserveUsers = options.preserveUsers !== false;
  const current = await readDb();
  const { user: currentUser, ...currentData } = current;
  const { user: incomingUser, ...incomingData } = data;
  const nextState = {
    ...emptyState,
    ...currentData,
    ...incomingData,
    users: preserveUsers ? (current.users || []) : (data.users || []),
    user: null
  };
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({ id: "main", data: nextState })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Could not write Supabase state");
    }
    return;
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(nextState, null, 2));
}

async function publicState() {
  const { users, user, ...data } = await readDb();
  return data;
}

async function stateForUser(user) {
  const data = await publicState();
  if (user.role !== "client") {
    return { ...data, user };
  }

  const clientId = user.clientId;
  const projects = data.projects.filter((project) => project.clientId === clientId);
  const projectIds = projects.map((project) => project.id);
  return {
    user,
    clients: data.clients.filter((client) => client.id === clientId),
    projects,
    tasks: data.tasks.filter((task) => projectIds.includes(task.projectId)),
    payments: data.payments.filter((payment) => projectIds.includes(payment.projectId)),
    deadlines: data.deadlines.filter((deadline) => projectIds.includes(deadline.projectId)),
    comments: (data.comments || []).filter((comment) => projectIds.includes(comment.projectId)),
    activity: (data.activity || []).filter((entry) => projectIds.includes(entry.projectId)),
    timeLogs: data.timeLogs ? data.timeLogs.filter((log) => {
      const task = data.tasks.find(t => t.id === log.taskId);
      return task && projectIds.includes(task.projectId);
    }) : [],
    attachments: data.attachments ? data.attachments.filter((att) => {
      if (att.entityType === "project") return projectIds.includes(att.entityId);
      if (att.entityType === "task") {
        const task = data.tasks.find(t => t.id === att.entityId);
        return task && projectIds.includes(task.projectId);
      }
      return false;
    }) : [],
    milestones: data.milestones || [],
    settings: data.settings || emptyState.settings
  };
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return { passwordSalt: salt, passwordHash: hash };
}

function passwordMatches(user, password) {
  if (user.passwordHash && user.passwordSalt) {
    const hash = crypto.pbkdf2Sync(password, user.passwordSalt, 100000, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
  }

  return user.password === password;
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function appBaseUrl(request) {
  const host = request.headers.host || "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return `http://${host}`;
  }
  return APP_URL;
}

async function sendEmail(toOriginal, subject, html) {
  const to = process.env.RESEND_TEST_EMAIL || "a1drivegdrive@gmail.com";
  if (!RESEND_API_KEY) {
    return { ok: false, skipped: true, reason: "RESEND_API_KEY is not configured" };
  }
  if (!RESEND_FROM) {
    return { ok: false, skipped: true, reason: "RESEND_FROM is not configured with a verified sender address" };
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    })
  });
  const resendText = await resendResponse.text();
  let resendData = {};
  try {
    resendData = resendText ? JSON.parse(resendText) : {};
  } catch (error) {
    resendData = { message: resendText };
  }
  if (!resendResponse.ok) {
    return {
      ok: false,
      reason: resendData.message || resendData.error || "Email provider rejected the message"
    };
  }
  return { ok: true, id: resendData.id };
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000_000) { // Increased limit to 20MB for base64 uploads
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function serveStatic(request, response) {
  const urlPath = request.url === "/" ? "/index.html" : decodeURIComponent(request.url.split("?")[0]);
  const filePath = path.normalize(path.join(ROOT, urlPath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (request.url === "/api/state" && request.method === "GET") {
    sendJson(response, 200, await publicState());
    return;
  }

  if (request.url === "/api/state" && request.method === "POST") {
    try {
      const body = await readBody(request);
      await writeDb(JSON.parse(body));
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: "Invalid database payload" });
    }
    return;
  }

  if (request.url === "/api/signup" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = await readDb();
      const email = String(payload.email || "").trim().toLowerCase();
      const name = String(payload.name || "").trim();
      const password = String(payload.password || "");

      if (!name || !email || !password) {
        sendJson(response, 400, { error: "Name, email, and password are required" });
        return;
      }

      if (data.users.some((user) => user.email === email)) {
        sendJson(response, 409, { error: "An account already exists with that email" });
        return;
      }

      const newUser = { name, email, role: "admin" };
      data.users.push({ id: crypto.randomUUID(), ...newUser, ...createPasswordRecord(password) });
      data.user = null;
      await writeDb(data, { preserveUsers: false });
      sendJson(response, 200, await stateForUser(newUser));
    } catch (error) {
      sendJson(response, 400, { error: "Invalid signup payload" });
    }
    return;
  }

  if (request.url === "/api/login" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = await readDb();
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      const user = data.users.find((entry) => entry.email === email && passwordMatches(entry, password));

      if (!user) {
        sendJson(response, 401, { error: "No account found with that email and password" });
        return;
      }

      const loginUser = { name: user.name, email: user.email, role: user.role || "admin", clientId: user.clientId || null };
      sendJson(response, 200, await stateForUser(loginUser));
    } catch (error) {
      sendJson(response, 400, { error: "Invalid login payload" });
    }
    return;
  }

  if (request.url === "/api/logout" && request.method === "POST") {
    sendJson(response, 200, { user: null });
    return;
  }

  if (request.url === "/api/client-user" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = await readDb();
      const clientId = String(payload.clientId || "");
      const client = data.clients.find((entry) => entry.id === clientId);
      const email = String(payload.email || "").trim().toLowerCase();
      const name = String(payload.name || client?.name || "").trim();
      const password = String(payload.password || "");

      if (!client || !name || !email || !password) {
        sendJson(response, 400, { error: "Client, name, email, and password are required" });
        return;
      }

      if (data.users.some((user) => user.email === email)) {
        sendJson(response, 409, { error: "An account already exists with that email" });
        return;
      }

      data.users.push({ id: crypto.randomUUID(), name, email, role: "client", clientId, ...createPasswordRecord(password) });
      data.user = null;
      await writeDb(data, { preserveUsers: false });
      sendJson(response, 200, await publicState());
    } catch (error) {
      sendJson(response, 400, { error: "Invalid client user payload" });
    }
    return;
  }

  if (request.url === "/api/invite" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = await readDb();
      const clientId = String(payload.clientId || "");
      const client = data.clients.find((entry) => entry.id === clientId);
      const email = String(payload.email || client?.email || "").trim().toLowerCase();
      const name = String(payload.name || client?.name || "").trim();

      if (!client || !name || !email) {
        sendJson(response, 400, { error: "Client, name, and email are required" });
        return;
      }

      const token = createToken();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
      data.invites = data.invites || [];
      data.invites.push({ token, clientId, name, email, expiresAt, used: false });
      await writeDb(data);
      const inviteUrl = `${appBaseUrl(request)}?invite=${token}`;
      const emailResult = await sendEmail(email, "Your client portal invite", `
        <h2>Your client portal is ready</h2>
        <p>Open this invite link and set your password:</p>
        <p><a href="${inviteUrl}">${inviteUrl}</a></p>
        <p>This link expires in 7 days.</p>
      `);
      sendJson(response, 200, { ok: true, inviteUrl, email: emailResult });
    } catch (error) {
      sendJson(response, 400, { error: "Invalid invite payload" });
    }
    return;
  }

  if (request.url === "/api/accept-invite" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = await readDb();
      const token = String(payload.token || "");
      const password = String(payload.password || "");
      const invite = (data.invites || []).find((entry) => entry.token === token && !entry.used);

      if (!invite || new Date(invite.expiresAt) < new Date()) {
        sendJson(response, 400, { error: "Invite link is invalid or expired" });
        return;
      }
      if (!password) {
        sendJson(response, 400, { error: "Password is required" });
        return;
      }
      if (data.users.some((user) => user.email === invite.email)) {
        sendJson(response, 409, { error: "An account already exists with that email" });
        return;
      }

      data.users.push({ id: crypto.randomUUID(), name: invite.name, email: invite.email, role: "client", clientId: invite.clientId, ...createPasswordRecord(password) });
      invite.used = true;
      await writeDb(data, { preserveUsers: false });
      const loginUser = { name: invite.name, email: invite.email, role: "client", clientId: invite.clientId };
      sendJson(response, 200, await stateForUser(loginUser));
    } catch (error) {
      sendJson(response, 400, { error: "Invalid invite acceptance payload" });
    }
    return;
  }

  if (request.url === "/api/forgot-password" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = await readDb();
      const email = String(payload.email || "").trim().toLowerCase();
      const user = data.users.find((entry) => entry.email === email);

      if (!user) {
        sendJson(response, 200, { ok: true });
        return;
      }

      const token = createToken();
      data.passwordResets = data.passwordResets || [];
      data.passwordResets.push({ token, email, expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(), used: false });
      await writeDb(data);
      const resetUrl = `${appBaseUrl(request)}?reset=${token}`;
      const emailResult = await sendEmail(email, "Reset your ProjectFlow password", `
        <h2>Password reset</h2>
        <p>Use this link to set a new password:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>This link expires in 30 minutes.</p>
      `);
      sendJson(response, 200, { ok: true, resetUrl, email: emailResult });
    } catch (error) {
      sendJson(response, 400, { error: "Invalid forgot password payload" });
    }
    return;
  }

  if (request.url === "/api/reset-password" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = await readDb();
      const token = String(payload.token || "");
      const password = String(payload.password || "");
      const reset = (data.passwordResets || []).find((entry) => entry.token === token && !entry.used);

      if (!reset || new Date(reset.expiresAt) < new Date()) {
        sendJson(response, 400, { error: "Reset link is invalid or expired" });
        return;
      }
      if (!password) {
        sendJson(response, 400, { error: "Password is required" });
        return;
      }

      const user = data.users.find((entry) => entry.email === reset.email);
      if (!user) {
        sendJson(response, 400, { error: "Account not found" });
        return;
      }
      Object.assign(user, createPasswordRecord(password));
      delete user.password;
      reset.used = true;
      await writeDb(data, { preserveUsers: false });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: "Invalid reset password payload" });
    }
    return;
  }

  if (request.url === "/api/email" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const { to, subject, html } = payload;
      
      if (!to || !subject || !html) {
        sendJson(response, 400, { error: "Missing to, subject, or html" });
        return;
      }
      
      const emailResult = await sendEmail(to, subject, html);
      sendJson(response, 200, emailResult);
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: "Internal Server Error" });
    }
    return;
  }

  if (request.url === "/api/upload" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      
      const filename = payload.filename || crypto.randomUUID();
      const contentBase64 = payload.content;
      
      if (!contentBase64) {
        sendJson(response, 400, { error: "No content provided" });
        return;
      }

      // Handle data URI prefix if present e.g. "data:image/png;base64,iVBORw0K..."
      const base64Data = contentBase64.replace(/^data:.*,/, "");
      
      const buffer = Buffer.from(base64Data, "base64");
      
      // Ensure unique filename
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      const safeFilename = `${name}-${crypto.randomUUID().slice(0,8)}${ext}`;
      
      const filepath = path.join(ROOT, "uploads", safeFilename);
      fs.writeFileSync(filepath, buffer);
      
      sendJson(response, 200, { url: `/uploads/${safeFilename}`, filename: safeFilename });
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: "Failed to upload file" });
    }
    return;
  }

  serveStatic(request, response);
});

ensureDb();
server.listen(PORT, () => {
  console.log(`Client Project Tracker running at http://localhost:${PORT}`);
});
