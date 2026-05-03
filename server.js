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
  deadlines: []
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function ensureDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyState, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(data) {
  const current = readDb();
  const nextState = { ...emptyState, ...current, ...data, users: current.users || [] };
  fs.writeFileSync(DB_FILE, JSON.stringify(nextState, null, 2));
}

function publicState() {
  const { users, ...data } = readDb();
  if (!data.user) {
    return { ...emptyState, users: undefined };
  }

  if (data.user.role === "client") {
    const clientId = data.user.clientId;
    const projects = data.projects.filter((project) => project.clientId === clientId);
    const projectIds = projects.map((project) => project.id);
    return {
      user: data.user,
      clients: data.clients.filter((client) => client.id === clientId),
      projects,
      tasks: data.tasks.filter((task) => projectIds.includes(task.projectId)),
      payments: data.payments.filter((payment) => projectIds.includes(payment.projectId)),
      deadlines: data.deadlines.filter((deadline) => projectIds.includes(deadline.projectId))
    };
  }

  return data;
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
      if (body.length > 1_000_000) {
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

      data.users.push({ id: crypto.randomUUID(), name, email, role: "admin", ...createPasswordRecord(password) });
      data.user = { name, email, role: "admin" };
      fs.writeFileSync(DB_FILE, JSON.stringify({ ...emptyState, ...data }, null, 2));
      sendJson(response, 200, publicState());
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

      data.user = { name: user.name, email: user.email, role: user.role || "admin", clientId: user.clientId || null };
      fs.writeFileSync(DB_FILE, JSON.stringify({ ...emptyState, ...data }, null, 2));
      sendJson(response, 200, publicState());
    } catch (error) {
      sendJson(response, 400, { error: "Invalid login payload" });
    }
    return;
  }

  if (request.url === "/api/logout" && request.method === "POST") {
    const data = readDb();
    data.user = null;
    fs.writeFileSync(DB_FILE, JSON.stringify({ ...emptyState, ...data }, null, 2));
    sendJson(response, 200, publicState());
    return;
  }

  if (request.url === "/api/client-user" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const data = readDb();
      const currentUser = data.user || {};
      const clientId = String(payload.clientId || "");
      const client = data.clients.find((entry) => entry.id === clientId);
      const email = String(payload.email || "").trim().toLowerCase();
      const name = String(payload.name || client?.name || "").trim();
      const password = String(payload.password || "");

      if ((currentUser.role || "admin") !== "admin") {
        sendJson(response, 403, { error: "Only freelancer accounts can create client portal users" });
        return;
      }

      if (!client || !name || !email || !password) {
        sendJson(response, 400, { error: "Client, name, email, and password are required" });
        return;
      }

      if (data.users.some((user) => user.email === email)) {
        sendJson(response, 409, { error: "An account already exists with that email" });
        return;
      }

      data.users.push({ id: crypto.randomUUID(), name, email, role: "client", clientId, ...createPasswordRecord(password) });
      fs.writeFileSync(DB_FILE, JSON.stringify({ ...emptyState, ...data }, null, 2));
      sendJson(response, 200, publicState());
    } catch (error) {
      sendJson(response, 400, { error: "Invalid client user payload" });
    }
    return;
  }

  serveStatic(request, response);
});

ensureDb();
server.listen(PORT, () => {
  console.log(`Client Project Tracker running at http://localhost:${PORT}`);
});
