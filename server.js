const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "db.json");

const emptyState = {
  user: null,
  users: [],
  clients: [],
  projects: [],
  tasks: [],
  payments: [],
  deadlines: [],
  timeLogs: [],
  attachments: []
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

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(data) {
  const current = readDb();
  const { user: currentUser, ...currentData } = current;
  const { user: incomingUser, ...incomingData } = data;
  const nextState = { ...emptyState, ...currentData, ...incomingData, users: current.users || [], user: null };
  fs.writeFileSync(DB_FILE, JSON.stringify(nextState, null, 2));
}

function publicState() {
  const { users, user, ...data } = readDb();
  return data;
}

function stateForUser(user) {
  const data = publicState();
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
    }) : []
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
    sendJson(response, 200, publicState());
    return;
  }

  if (request.url === "/api/state" && request.method === "POST") {
    try {
      const body = await readBody(request);
      writeDb(JSON.parse(body));
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
      const data = readDb();
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
      fs.writeFileSync(DB_FILE, JSON.stringify({ ...emptyState, ...data }, null, 2));
      sendJson(response, 200, stateForUser(newUser));
    } catch (error) {
      sendJson(response, 400, { error: "Invalid signup payload" });
    }
    return;
  }

  if (request.url === "/api/login" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = readDb();
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      const user = data.users.find((entry) => entry.email === email && passwordMatches(entry, password));

      if (!user) {
        sendJson(response, 401, { error: "No account found with that email and password" });
        return;
      }

      const loginUser = { name: user.name, email: user.email, role: user.role || "admin", clientId: user.clientId || null };
      sendJson(response, 200, stateForUser(loginUser));
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
      const data = readDb();
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
      fs.writeFileSync(DB_FILE, JSON.stringify({ ...emptyState, ...data }, null, 2));
      sendJson(response, 200, publicState());
    } catch (error) {
      sendJson(response, 400, { error: "Invalid client user payload" });
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
      
      const RESEND_API_KEY = "re_bE2qCdns_Go7GE2h6fdQCU8TgkZ3VJw3u";
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "Project Tracker <onboarding@resend.dev>",
          to: Array.isArray(to) ? to : [to],
          subject: subject,
          html: html
        })
      });
      
      const resendData = await resendResponse.json();
      
      if (!resendResponse.ok) {
        console.error("Resend Error:", resendData);
        sendJson(response, 400, { error: "Failed to send email: " + (resendData.message || "Unknown error") });
        return;
      }
      
      console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject}`);
      sendJson(response, 200, { ok: true, id: resendData.id });
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
