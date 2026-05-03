const API_BASE_URL = (window.APP_CONFIG?.API_BASE_URL || "").replace(/\/$/, "");
const API_URL = `${API_BASE_URL}/api/state`;
const USER_SESSION_KEY = "client-project-tracker-user";

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

let state = structuredClone(emptyState);
let selectedProjectId = null;
let editContext = null;
let paymentChartInstance = null;
let taskChartInstance = null;

const filters = {
  clientSearch: "",
  projectSearch: "",
  projectClientFilter: "",
  taskSearch: "",
  taskStatusFilter: "",
  paymentSearch: "",
  paymentStatusFilter: "",
  deadlineSearch: "",
  deadlinePriorityFilter: "",
  timelogSearch: "",
  timelogTaskFilter: ""
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function loadState() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("Database request failed");
    const data = await response.json();
    state = normalizeState(data);
    const savedUser = sessionStorage.getItem(USER_SESSION_KEY);
    if (savedUser) state.user = JSON.parse(savedUser);
  } catch (error) {
    alert("Could not connect to the database server. Start it with: node server.js");
    state = structuredClone(emptyState);
  }
}

function normalizeState(data) {
  const next = { ...structuredClone(emptyState), ...data };
  next.projects = next.projects.map((project) => ({ notes: "", ...project }));
  next.payments = next.payments.map((payment) => ({
    invoiceNumber: "",
    method: "Bank Transfer",
    paidAmount: payment.status === "Received" ? Number(payment.amount || 0) : 0,
    ...payment
  }));
  return next;
}

async function saveState() {
  try {
    const { users, user, ...payload } = state;
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    alert("Could not save to the database server.");
  }
}

async function postApi(url, payload) {
  const previousUser = state.user;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  state = normalizeState(data);
  if (Object.prototype.hasOwnProperty.call(data, "user")) {
    if (data.user) {
      sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(data.user));
    } else {
      sessionStorage.removeItem(USER_SESSION_KEY);
    }
  } else {
    state.user = previousUser;
  }
  return state;
}

function id() {
  return crypto.randomUUID();
}

function money(value, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function dateLabel(value) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function parseMarkdown(value) {
  if (!value) return "";
  try {
    return marked.parse(value);
  } catch(e) {
    return escapeHtml(value);
  }
}

function findClient(idValue) {
  return state.clients.find((client) => client.id === idValue);
}

function findProject(idValue) {
  return state.projects.find((project) => project.id === idValue);
}

function searchMatch(...values) {
  return values.join(" ").toLowerCase().includes(this.toLowerCase());
}

function paidAmount(payment) {
  return Number(payment.paidAmount ?? (payment.status === "Received" ? payment.amount : 0) ?? 0);
}

function balanceAmount(payment) {
  return Math.max(0, Number(payment.amount || 0) - paidAmount(payment));
}

function projectProgress(projectId) {
  const tasks = state.tasks.filter((task) => task.projectId === projectId);
  if (!tasks.length) return 0;
  const done = tasks.filter((task) => task.status === "Done").length;
  return Math.round((done / tasks.length) * 100);
}

function isPastDue(dateValue) {
  if (!dateValue) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${dateValue}T00:00:00`) < today;
}

function isTaskOverdue(task) {
  return task.status !== "Done" && isPastDue(task.dueDate);
}

function isPaymentOverdue(payment) {
  return payment.status !== "Received" && isPastDue(payment.date);
}

function isDeadlineOverdue(deadline) {
  return isPastDue(deadline.date);
}

function emptyMessage(title, detail = "Add a record using the form above.") {
  return `<div class="empty"><strong>${title}</strong><span>${detail}</span></div>`;
}

function setToday() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date());
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#clientPortalView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  render();
}

function showClientPortal() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.add("hidden");
  $("#clientPortalView").classList.remove("hidden");
  renderClientPortal();
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  $("#clientPortalView").classList.add("hidden");
}

function showDashboardForRole() {
  if (state.user?.role === "client") {
    showClientPortal();
  } else {
    showApp();
  }
}

function setAuthMode(mode) {
  const signup = mode === "signup";
  $("#loginForm").classList.toggle("hidden", signup);
  $("#signupForm").classList.toggle("hidden", !signup);
}

function switchTab(tabId) {
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabId));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== tabId));
  $("#pageTitle").textContent = tabId.charAt(0).toUpperCase() + tabId.slice(1);
}

function showProjectDetail(projectId) {
  selectedProjectId = projectId;
  $$(".nav-button").forEach((button) => button.classList.remove("active"));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== "projectDetail"));
  $("#pageTitle").textContent = "Project Detail";
  renderProjectDetail();
}

function optionList(items, placeholder) {
  if (!items.length) return `<option value="">${placeholder}</option>`;
  return `<option value="">${placeholder}</option>${items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
}

function render() {
  setToday();
  renderUserProfile();
  renderSelects();
  renderOverview();
  renderClients();
  renderProjects();
  renderProjectDetail();
  renderTasks();
  renderPayments();
  renderDeadlines();
  renderTimelogs();
}

function renderUserProfile() {
  const user = state.user || {};
  $("#userProfile").innerHTML = `
    <strong>${escapeHtml(user.name || "Signed in")}</strong>
    <span>${escapeHtml(user.email || "")}</span>
  `;
}

function renderSelects() {
  $("#projectClient").innerHTML = optionList(state.clients, "Choose client");
  $("#projectClientFilter").innerHTML = optionList(state.clients, "All clients");
  $("#projectClientFilter").value = filters.projectClientFilter;
  const projectOptions = optionList(state.projects, "Choose project");
  $("#taskProject").innerHTML = projectOptions;
  $("#paymentProject").innerHTML = projectOptions;
  $("#deadlineProject").innerHTML = projectOptions;
  const taskOptions = optionList(state.tasks.map(t => ({ id: t.id, name: t.title })), "Choose task");
  const timelogTaskEl = $("#timelogTask");
  if (timelogTaskEl) timelogTaskEl.innerHTML = taskOptions;
  const timelogTaskFilterEl = $("#timelogTaskFilter");
  if (timelogTaskFilterEl) {
    timelogTaskFilterEl.innerHTML = optionList(state.tasks.map(t => ({ id: t.id, name: t.title })), "All tasks");
    timelogTaskFilterEl.value = filters.timelogTaskFilter;
  }
}

function renderOverview() {
  const openTasks = state.tasks.filter((task) => task.status !== "Done");
  const received = state.payments.reduce((sum, payment) => sum + paidAmount(payment), 0);

  $("#clientCount").textContent = state.clients.length;
  $("#projectCount").textContent = state.projects.length;
  $("#taskCount").textContent = openTasks.length;
  $("#paymentTotal").textContent = money(received);

  renderCharts();

  $("#overviewProjects").innerHTML = state.projects.length
    ? state.projects.map(projectCard).join("")
    : emptyMessage("No projects yet", "Create a project after adding your first client.");

  const upcoming = [...state.deadlines].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  $("#overviewDeadlines").innerHTML = upcoming.length
    ? upcoming.map(deadlineCard).join("")
    : emptyMessage("No deadlines yet", "Add a deadline to keep project dates visible.");
}

function renderCharts() {
  const received = state.payments.reduce((sum, payment) => sum + paidAmount(payment), 0);
  const pending = state.payments.reduce((sum, payment) => sum + balanceAmount(payment), 0);
  const done = state.tasks.filter((task) => task.status === "Done").length;
  const inProgress = state.tasks.filter((task) => task.status === "In Progress").length;
  const pendingTasks = state.tasks.filter((task) => task.status === "Pending").length;

  $("#chartGrid").innerHTML = `
    <article class="chart-card">
      <h2>Payments</h2>
      <div style="position: relative; height:200px; width:100%">
        <canvas id="paymentChart"></canvas>
      </div>
    </article>
    <article class="chart-card">
      <h2>Task Status</h2>
      <div style="position: relative; height:200px; width:100%">
        <canvas id="taskChart"></canvas>
      </div>
    </article>
  `;

  if (paymentChartInstance) paymentChartInstance.destroy();
  if (taskChartInstance) taskChartInstance.destroy();

  const isDark = document.body.classList.contains("dark-theme");
  const textColor = isDark ? "#94a3b8" : "#64748b";

  Chart.defaults.color = textColor;
  
  const pCtx = document.getElementById("paymentChart");
  if (pCtx) {
    paymentChartInstance = new Chart(pCtx, {
      type: "bar",
      data: {
        labels: ["Received", "Balance"],
        datasets: [{
          label: "Amount",
          data: [received, pending],
          backgroundColor: ["#0284c7", "#b7791f"]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
  }

  const tCtx = document.getElementById("taskChart");
  if (tCtx) {
    taskChartInstance = new Chart(tCtx, {
      type: "doughnut",
      data: {
        labels: ["Done", "In Progress", "Pending"],
        datasets: [{
          data: [done, inProgress, pendingTasks],
          backgroundColor: ["#0284c7", "#2563eb", "#b7791f"]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }
}

function renderClients() {
  const query = filters.clientSearch;
  const clients = state.clients.filter((client) => !query || searchMatch.call(query, client.name, client.email, client.phone));

  $("#clientList").innerHTML = clients.length
    ? clients.map((client) => {
      const count = state.projects.filter((project) => project.clientId === client.id).length;
      return `
        <article class="item-card">
          <div class="item-row">
            <div>
              <h3>${escapeHtml(client.name)}</h3>
              <p>${escapeHtml(client.email)} ${client.phone ? `| ${escapeHtml(client.phone)}` : ""}</p>
            </div>
            <div class="mini-actions">
              <button type="button" data-create-client-user="${client.id}">Portal login</button>
              <button type="button" data-edit-client="${client.id}">Edit</button>
              <button type="button" data-delete-client="${client.id}">Delete</button>
            </div>
          </div>
          <div class="pill-row"><span class="pill blue">${count} projects</span></div>
        </article>
      `;
    }).join("")
    : emptyMessage("No clients found", "Try a different search or add a new client.");
}

function renderProjects() {
  const query = filters.projectSearch;
  const clientFilter = filters.projectClientFilter;
  const projects = state.projects.filter((project) => {
    const client = findClient(project.clientId);
    const matchesSearch = !query || searchMatch.call(query, project.name, project.notes, client?.name);
    const matchesClient = !clientFilter || project.clientId === clientFilter;
    return matchesSearch && matchesClient;
  });

  $("#projectList").innerHTML = projects.length
    ? projects.map(projectCard).join("")
    : emptyMessage("No projects found", "Adjust filters or create a new project.");
}

function projectCard(project) {
  const client = findClient(project.clientId);
  const progress = projectProgress(project.id);
  const currency = project.currency || "USD";
  const paid = state.payments
    .filter((payment) => payment.projectId === project.id)
    .reduce((sum, payment) => sum + paidAmount(payment), 0);

  return `
    <article class="item-card ${isPastDue(project.dueDate) && progress < 100 ? "overdue" : ""}">
      <div class="item-row">
        <div>
          <h3>${escapeHtml(project.name)}</h3>
          <p>${escapeHtml(client?.name || "No client")} | Due ${dateLabel(project.dueDate)} | ${money(paid, currency)} / ${money(project.budget, currency)}</p>
        </div>
        <div class="mini-actions">
          <button type="button" data-view-project="${project.id}">View</button>
          <button type="button" data-edit-project="${project.id}">Edit</button>
          <button type="button" data-delete-project="${project.id}">Delete</button>
        </div>
      </div>
      ${project.notes ? `<div class="note-text markdown-body">${parseMarkdown(project.notes)}</div>` : ""}
      <div class="progress-track" aria-label="${progress}% complete">
        <div class="progress-bar" style="width: ${progress}%"></div>
      </div>
      <div class="pill-row">
        <span class="pill green">${progress}% complete</span>
        <span class="pill blue">${state.tasks.filter((task) => task.projectId === project.id).length} tasks</span>
        ${isPastDue(project.dueDate) && progress < 100 ? `<span class="pill red">Overdue</span>` : ""}
      </div>
    </article>
  `;
}

function renderTasks() {
  const query = filters.taskSearch;
  const status = filters.taskStatusFilter;
  const tasks = state.tasks.filter((task) => {
    const project = findProject(task.projectId);
    return (!query || searchMatch.call(query, task.title, project?.name)) && (!status || task.status === status);
  });

  const pending = tasks.filter(t => t.status === "Pending");
  const inProgress = tasks.filter(t => t.status === "In Progress");
  const done = tasks.filter(t => t.status === "Done");

  const renderList = (list) => list.length ? list.map(taskCard).join("") : "";

  const pList = $("#kanbanPending");
  const iList = $("#kanbanInProgress");
  const dList = $("#kanbanDone");
  
  if (pList) pList.innerHTML = renderList(pending);
  if (iList) iList.innerHTML = renderList(inProgress);
  if (dList) dList.innerHTML = renderList(done);
}

function taskCard(task) {
  const project = findProject(task.projectId);
  const statusClass = task.status === "Done" ? "green" : task.status === "In Progress" ? "blue" : "amber";
  return `
    <article class="item-card kanban-card ${isTaskOverdue(task) ? "overdue" : ""}" draggable="true" data-task-id="${task.id}">
      <div class="item-row">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p>${escapeHtml(project?.name || "No project")} | Due ${dateLabel(task.dueDate)}</p>
        </div>
        <div class="mini-actions">
          <button type="button" data-edit-task="${task.id}">Edit</button>
          <button type="button" data-delete-task="${task.id}">Delete</button>
        </div>
      </div>
      <div class="pill-row">
        <span class="pill ${statusClass}">${task.status}</span>
        ${isTaskOverdue(task) ? `<span class="pill red">Overdue</span>` : ""}
      </div>
    </article>
  `;
}

function renderPayments() {
  const query = filters.paymentSearch;
  const status = filters.paymentStatusFilter;
  const payments = state.payments.filter((payment) => {
    const project = findProject(payment.projectId);
    return (!query || searchMatch.call(query, payment.invoiceNumber, payment.method, project?.name)) && (!status || payment.status === status);
  });

  $("#paymentList").innerHTML = payments.length
    ? payments.map(paymentCard).join("")
    : emptyMessage("No payments found", "Adjust filters or add a payment.");
}

function paymentCard(payment) {
  const project = findProject(payment.projectId);
  const currency = project?.currency || "USD";
  const statusClass = payment.status === "Received" ? "green" : payment.status === "Overdue" ? "red" : "amber";
  return `
    <article class="item-card ${isPaymentOverdue(payment) ? "overdue" : ""}">
      <div class="item-row">
        <div>
          <h3>${money(payment.amount, currency)}</h3>
          <p>${escapeHtml(project?.name || "No project")} | ${escapeHtml(payment.invoiceNumber || "No invoice")} | Due ${dateLabel(payment.date)}</p>
          <p>Paid ${money(paidAmount(payment), currency)} | Balance ${money(balanceAmount(payment), currency)} | ${escapeHtml(payment.method || "No method")}</p>
        </div>
        <div class="mini-actions">
          <button type="button" data-print-invoice="${payment.id}">Invoice</button>
          <button type="button" data-edit-payment="${payment.id}">Edit</button>
          <button type="button" data-cycle-payment="${payment.id}">Update status</button>
          <button type="button" data-delete-payment="${payment.id}">Delete</button>
        </div>
      </div>
      <div class="pill-row">
        <span class="pill ${statusClass}">${payment.status}</span>
        ${isPaymentOverdue(payment) ? `<span class="pill red">Overdue</span>` : ""}
      </div>
    </article>
  `;
}

function renderDeadlines() {
  const query = filters.deadlineSearch;
  const priority = filters.deadlinePriorityFilter;
  const deadlines = [...state.deadlines]
    .filter((deadline) => {
      const project = findProject(deadline.projectId);
      return (!query || searchMatch.call(query, deadline.title, project?.name)) && (!priority || deadline.priority === priority);
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  $("#deadlineList").innerHTML = deadlines.length
    ? deadlines.map(deadlineCard).join("")
    : emptyMessage("No deadlines found", "Adjust filters or add a deadline.");
}

function deadlineCard(deadline) {
  const project = findProject(deadline.projectId);
  const priorityClass = deadline.priority === "Critical" ? "red" : deadline.priority === "High" ? "amber" : "blue";
  return `
    <article class="item-card ${isDeadlineOverdue(deadline) ? "overdue" : ""}">
      <div class="item-row">
        <div>
          <h3>${escapeHtml(deadline.title)}</h3>
          <p>${escapeHtml(project?.name || "No project")} | ${dateLabel(deadline.date)}</p>
        </div>
        <div class="mini-actions">
          <button type="button" data-edit-deadline="${deadline.id}">Edit</button>
          <button type="button" data-delete-deadline="${deadline.id}">Delete</button>
        </div>
      </div>
      <div class="pill-row">
        <span class="pill ${priorityClass}">${deadline.priority}</span>
        ${isDeadlineOverdue(deadline) ? `<span class="pill red">Overdue</span>` : ""}
      </div>
    </article>
  `;
}

function renderTimelogs() {
  const query = filters.timelogSearch;
  const taskId = filters.timelogTaskFilter;
  const timelogs = [...state.timeLogs]
    .filter((log) => {
      const task = state.tasks.find(t => t.id === log.taskId);
      const project = findProject(task?.projectId);
      return (!query || searchMatch.call(query, log.notes, task?.title, project?.name)) && (!taskId || log.taskId === taskId);
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const listEl = $("#timelogList");
  if (listEl) {
    listEl.innerHTML = timelogs.length
      ? timelogs.map(timelogCard).join("")
      : emptyMessage("No time logs found", "Log time using the form above.");
  }
}

function timelogCard(log) {
  const task = state.tasks.find(t => t.id === log.taskId);
  const project = findProject(task?.projectId);
  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3>${log.hours} hours - ${escapeHtml(task?.title || "No task")}</h3>
          <p>${escapeHtml(project?.name || "No project")} | ${dateLabel(log.date)}</p>
        </div>
        <div class="mini-actions">
          <button type="button" data-delete-timelog="${log.id}">Delete</button>
        </div>
      </div>
      ${log.notes ? `<p class="note-text">${escapeHtml(log.notes)}</p>` : ""}
    </article>
  `;
}

function renderProjectDetail() {
  const container = $("#projectDetailContent");
  if (!container) return;
  const project = findProject(selectedProjectId);
  if (!project) {
    container.innerHTML = emptyMessage("Select a project", "Open a project from the Projects tab.");
    return;
  }

  const client = findClient(project.clientId);
  const progress = projectProgress(project.id);
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const payments = state.payments.filter((payment) => payment.projectId === project.id);
  const deadlines = state.deadlines.filter((deadline) => deadline.projectId === project.id);
  const projectAttachments = state.attachments.filter(att => att.entityType === 'project' && att.entityId === project.id);
  const received = payments.reduce((sum, payment) => sum + paidAmount(payment), 0);
  const pending = payments.reduce((sum, payment) => sum + balanceAmount(payment), 0);

  container.innerHTML = `
    <section class="detail-hero ${isPastDue(project.dueDate) && progress < 100 ? "overdue" : ""}">
      <div>
        <p class="eyebrow">${escapeHtml(client?.name || "No client")}</p>
        <h2>${escapeHtml(project.name)}</h2>
        <p class="muted">Due ${dateLabel(project.dueDate)} | Budget ${money(project.budget, project.currency)}</p>
        ${project.notes ? `<div class="note-text markdown-body" style="margin-top: 10px">${parseMarkdown(project.notes)}</div>` : ""}
      </div>
      <div class="mini-actions"><button type="button" data-edit-project="${project.id}">Edit project</button></div>
    </section>
    <div class="metric-grid detail-metrics">
      <article class="metric-card"><span>${progress}%</span><p>Complete</p></article>
      <article class="metric-card"><span>${tasks.length}</span><p>Total tasks</p></article>
      <article class="metric-card"><span>${money(received, project.currency)}</span><p>Received</p></article>
      <article class="metric-card"><span>${money(pending, project.currency)}</span><p>Balance</p></article>
    </div>
    <div class="progress-track detail-progress" aria-label="${progress}% complete"><div class="progress-bar" style="width: ${progress}%"></div></div>
    <div class="detail-grid">
      <section><div class="section-heading"><h2>Tasks</h2></div><div class="list-stack">${tasks.length ? tasks.map(taskCard).join("") : emptyMessage("No tasks", "Add tasks from the Tasks tab.")}</div></section>
      <section><div class="section-heading"><h2>Payments</h2></div><div class="list-stack">${payments.length ? payments.map(paymentCard).join("") : emptyMessage("No payments", "Add payments from the Payments tab.")}</div></section>
      <section><div class="section-heading"><h2>Deadlines</h2></div><div class="list-stack">${deadlines.length ? deadlines.map(deadlineCard).join("") : emptyMessage("No deadlines", "Add deadlines from the Deadlines tab.")}</div></section>
      <section>
        <div class="section-heading"><h2>Attachments</h2></div>
        <div class="attachment-list">
          ${projectAttachments.length ? projectAttachments.map(att => `<a href="${API_BASE_URL}${att.url}" target="_blank" class="attachment-pill">📎 ${escapeHtml(att.filename)}</a>`).join("") : emptyMessage("No attachments", "Upload files for this project.")}
        </div>
        <div style="margin-top: 14px">
          <input type="file" id="uploadAttachmentInput" data-entity="project" data-entity-id="${project.id}" style="display:none">
          <button class="secondary-button" type="button" onclick="document.getElementById('uploadAttachmentInput').click()">Upload File</button>
        </div>
      </section>
      <section>
        <div class="section-heading"><h2>Client</h2></div>
        <article class="item-card">
          <div class="item-row">
            <div><h3>${escapeHtml(client?.name || "No client selected")}</h3><p>${escapeHtml(client?.email || "")} ${client?.phone ? `| ${escapeHtml(client.phone)}` : ""}</p></div>
            ${client ? `<div class="mini-actions"><button type="button" data-edit-client="${client.id}">Edit client</button></div>` : ""}
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderClientPortal() {
  const client = findClient(state.user?.clientId);
  const projects = state.projects.filter((project) => project.clientId === state.user?.clientId);
  const projectIds = projects.map((project) => project.id);
  const tasks = state.tasks.filter((task) => projectIds.includes(task.projectId));
  const payments = state.payments.filter((payment) => projectIds.includes(payment.projectId));
  const deadlines = state.deadlines
    .filter((deadline) => projectIds.includes(deadline.projectId))
    .sort((a, b) => a.date.localeCompare(b.date));
  const openTasks = tasks.filter((task) => task.status !== "Done").length;
  const received = payments.reduce((sum, payment) => sum + paidAmount(payment), 0);
  const balance = payments.reduce((sum, payment) => sum + balanceAmount(payment), 0);

  $("#portalClientName").textContent = client?.name || "Client Portal";
  $("#portalUserEmail").textContent = state.user?.email || "";
  $("#portalSummary").innerHTML = `
    <article class="metric-card"><span>${projects.length}</span><p>Projects</p></article>
    <article class="metric-card"><span>${openTasks}</span><p>Open tasks</p></article>
    <article class="metric-card"><span>${money(received)}</span><p>Paid</p></article>
    <article class="metric-card"><span>${money(balance)}</span><p>Balance</p></article>
  `;
  $("#portalProjects").innerHTML = projects.length
    ? projects.map(portalProjectCard).join("")
    : emptyMessage("No projects yet", "Your freelancer has not shared projects with this company account.");
  $("#portalDeadlines").innerHTML = deadlines.length
    ? deadlines.map(portalDeadlineCard).join("")
    : emptyMessage("No deadlines", "Upcoming deadlines will appear here.");
  $("#portalTasks").innerHTML = tasks.length
    ? tasks.map(portalTaskCard).join("")
    : emptyMessage("No tasks", "Task progress will appear here.");
  $("#portalPayments").innerHTML = payments.length
    ? payments.map(portalPaymentCard).join("")
    : emptyMessage("No payments", "Invoice and payment status will appear here.");
}

function portalProjectCard(project) {
  const progress = projectProgress(project.id);
  const projectAttachments = state.attachments.filter(att => att.entityType === 'project' && att.entityId === project.id);
  const attachmentsHTML = projectAttachments.length 
    ? projectAttachments.map(att => `<a href="${API_BASE_URL}${att.url}" target="_blank" class="attachment-pill" style="margin-right:5px; font-size:12px;">📎 ${escapeHtml(att.filename)}</a>`).join("") 
    : "";

  return `
    <article class="item-card ${isPastDue(project.dueDate) && progress < 100 ? "overdue" : ""}">
      <div>
        <h3>${escapeHtml(project.name)}</h3>
        <p>Due ${dateLabel(project.dueDate)} | Budget ${money(project.budget)}</p>
      </div>
      ${project.notes ? `<div class="note-text markdown-body">${parseMarkdown(project.notes)}</div>` : ""}
      
      <div style="margin: 10px 0;">
        ${attachmentsHTML}
        <div style="margin-top: 10px;">
          <input type="file" id="portalUpload_${project.id}" class="portal-upload" data-entity="project" data-entity-id="${project.id}" style="display:none">
          <button class="ghost-button" type="button" onclick="document.getElementById('portalUpload_${project.id}').click()" style="padding:4px 8px; font-size:12px;">+ Upload File</button>
        </div>
      </div>

      <div class="progress-track"><div class="progress-bar" style="width: ${progress}%"></div></div>
      <div class="pill-row">
        <span class="pill green">${progress}% complete</span>
        ${isPastDue(project.dueDate) && progress < 100 ? `<span class="pill red">Overdue</span>` : ""}
      </div>
    </article>
  `;
}

function portalTaskCard(task) {
  const project = findProject(task.projectId);
  const statusClass = task.status === "Done" ? "green" : task.status === "In Progress" ? "blue" : "amber";
  const commentsHTML = (task.comments || []).map(c => `<div style="background:var(--bg); padding:8px; border-radius:4px; margin-bottom:5px; font-size:14px;"><strong style="color:var(--primary);">${escapeHtml(c.author)}:</strong> ${escapeHtml(c.text)}</div>`).join("");

  return `
    <article class="item-card ${isTaskOverdue(task) ? "overdue" : ""}">
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml(project?.name || "No project")} | Due ${dateLabel(task.dueDate)}</p>
      <div class="pill-row">
        <span class="pill ${statusClass}">${task.status}</span>
        ${isTaskOverdue(task) ? `<span class="pill red">Overdue</span>` : ""}
      </div>
      <div style="margin-top:15px; border-top:1px solid var(--border); padding-top:10px;">
        ${commentsHTML}
        <form class="comment-form" data-task-id="${task.id}" style="display:flex; gap:10px; margin-top:5px;">
          <input type="text" name="commentText" placeholder="Add a comment..." style="flex-grow:1; padding:6px; font-size:14px;" required>
          <button type="submit" class="secondary-button" style="padding:6px 12px; font-size:14px;">Post</button>
        </form>
      </div>
    </article>
  `;
}

function portalPaymentCard(payment) {
  const project = findProject(payment.projectId);
  const statusClass = payment.status === "Received" ? "green" : payment.status === "Overdue" ? "red" : "amber";
  return `
    <article class="item-card ${isPaymentOverdue(payment) ? "overdue" : ""}">
      <h3>${money(payment.amount)}</h3>
      <p>${escapeHtml(project?.name || "No project")} | ${escapeHtml(payment.invoiceNumber || "No invoice")} | Due ${dateLabel(payment.date)}</p>
      <p>Paid ${money(paidAmount(payment))} | Balance ${money(balanceAmount(payment))}</p>
      <div class="pill-row">
        <span class="pill ${statusClass}">${payment.status}</span>
        ${isPaymentOverdue(payment) ? `<span class="pill red">Overdue</span>` : ""}
      </div>
    </article>
  `;
}

function portalDeadlineCard(deadline) {
  const project = findProject(deadline.projectId);
  const priorityClass = deadline.priority === "Critical" ? "red" : deadline.priority === "High" ? "amber" : "blue";
  return `
    <article class="item-card ${isDeadlineOverdue(deadline) ? "overdue" : ""}">
      <h3>${escapeHtml(deadline.title)}</h3>
      <p>${escapeHtml(project?.name || "No project")} | ${dateLabel(deadline.date)}</p>
      <div class="pill-row">
        <span class="pill ${priorityClass}">${deadline.priority}</span>
        ${isDeadlineOverdue(deadline) ? `<span class="pill red">Overdue</span>` : ""}
      </div>
    </article>
  `;
}

function addClient(event) {
  event.preventDefault();
  state.clients.push({
    id: id(),
    name: $("#clientName").value.trim(),
    email: $("#clientEmail").value.trim(),
    phone: $("#clientPhone").value.trim()
  });
  event.target.reset();
  saveState();
  render();
}

function addProject(event) {
  event.preventDefault();
  state.projects.push({
    id: id(),
    name: $("#projectName").value.trim(),
    clientId: $("#projectClient").value,
    budget: Number($("#projectBudget").value || 0),
    dueDate: $("#projectDue").value,
    notes: $("#projectNotes").value.trim(),
    currency: $("#projectCurrency").value || "USD",
    taxRate: Number($("#projectTaxRate").value || 0)
  });
  event.target.reset();
  saveState();
  render();
}

function addTask(event) {
  event.preventDefault();
  state.tasks.push({
    id: id(),
    title: $("#taskTitle").value.trim(),
    projectId: $("#taskProject").value,
    status: $("#taskStatus").value,
    dueDate: $("#taskDue").value
  });
  event.target.reset();
  saveState();
  render();
}

function addPayment(event) {
  event.preventDefault();
  const amount = Number($("#paymentAmount").value);
  const paid = $("#paymentPaid").value
    ? Number($("#paymentPaid").value)
    : $("#paymentStatus").value === "Received"
      ? amount
      : 0;
  state.payments.push({
    id: id(),
    projectId: $("#paymentProject").value,
    invoiceNumber: $("#paymentInvoice").value.trim(),
    amount,
    paidAmount: paid,
    method: $("#paymentMethod").value,
    status: $("#paymentStatus").value,
    date: $("#paymentDate").value
  });
  event.target.reset();
  saveState();
  render();
}

function addDeadline(event) {
  event.preventDefault();
  state.deadlines.push({
    id: id(),
    title: $("#deadlineTitle").value.trim(),
    projectId: $("#deadlineProject").value,
    date: $("#deadlineDate").value,
    priority: $("#deadlinePriority").value
  });
  event.target.reset();
  saveState();
  render();
}

function addTimelog(event) {
  event.preventDefault();
  state.timeLogs.push({
    id: id(),
    taskId: $("#timelogTask").value,
    hours: Number($("#timelogHours").value || 0),
    notes: $("#timelogNotes").value.trim(),
    date: $("#timelogDate").value
  });
  event.target.reset();
  saveState();
  render();
}

function confirmDelete(label) {
  return confirm(`Delete this ${label}? This cannot be undone.`);
}

function deleteBy(collection, itemId) {
  state[collection] = state[collection].filter((item) => item.id !== itemId);
}

function cascadeDeleteClient(clientId) {
  if (!confirmDelete("client and its related projects")) return false;
  const projectIds = state.projects.filter((project) => project.clientId === clientId).map((project) => project.id);
  const taskIds = state.tasks.filter((task) => projectIds.includes(task.projectId)).map(t => t.id);
  
  if (projectIds.includes(selectedProjectId)) selectedProjectId = null;
  deleteBy("clients", clientId);
  state.projects = state.projects.filter((project) => project.clientId !== clientId);
  state.tasks = state.tasks.filter((task) => !projectIds.includes(task.projectId));
  state.payments = state.payments.filter((payment) => !projectIds.includes(payment.projectId));
  state.deadlines = state.deadlines.filter((deadline) => !projectIds.includes(deadline.projectId));
  state.timeLogs = state.timeLogs.filter((log) => !taskIds.includes(log.taskId));
  state.attachments = state.attachments.filter((att) => 
    !(att.entityType === 'project' && projectIds.includes(att.entityId)) &&
    !(att.entityType === 'task' && taskIds.includes(att.entityId))
  );
  return true;
}

function cascadeDeleteProject(projectId) {
  if (!confirmDelete("project and its related records")) return false;
  const taskIds = state.tasks.filter((task) => task.projectId === projectId).map(t => t.id);
  
  if (selectedProjectId === projectId) selectedProjectId = null;
  deleteBy("projects", projectId);
  state.tasks = state.tasks.filter((task) => task.projectId !== projectId);
  state.payments = state.payments.filter((payment) => payment.projectId !== projectId);
  state.deadlines = state.deadlines.filter((deadline) => deadline.projectId !== projectId);
  state.timeLogs = state.timeLogs.filter((log) => !taskIds.includes(log.taskId));
  state.attachments = state.attachments.filter((att) => 
    !(att.entityType === 'project' && att.entityId === projectId) &&
    !(att.entityType === 'task' && taskIds.includes(att.entityId))
  );
  return true;
}

function cascadeDeleteTask(taskId) {
  if (!confirmDelete("task and its time logs")) return false;
  deleteBy("tasks", taskId);
  state.timeLogs = state.timeLogs.filter((log) => log.taskId !== taskId);
  state.attachments = state.attachments.filter((att) => !(att.entityType === 'task' && att.entityId === taskId));
  return true;
}

function cycleStatus(collection, itemId, statuses) {
  const item = state[collection].find((entry) => entry.id === itemId);
  if (!item) return;
  const next = (statuses.indexOf(item.status) + 1) % statuses.length;
  item.status = statuses[next];
  if (collection === "payments" && item.status === "Received") item.paidAmount = Number(item.amount || 0);
}

function fieldHtml(field) {
  const value = escapeHtml(field.value ?? "");
  if (field.type === "select") {
    return `
      <label>${field.label}
        <select name="${field.name}" ${field.required ? "required" : ""}>
          ${field.options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (field.type === "textarea") {
    return `<label>${field.label}<textarea name="${field.name}" rows="4">${value}</textarea></label>`;
  }
  return `<label>${field.label}<input name="${field.name}" type="${field.type || "text"}" value="${value}" ${field.required ? "required" : ""}></label>`;
}

function openEdit(type, itemId) {
  const config = editConfig(type, itemId);
  if (!config) return;
  editContext = { type, itemId, collection: config.collection };
  $("#editTitle").textContent = config.title;
  $("#editFields").innerHTML = config.fields.map(fieldHtml).join("");
  $("#editModal").showModal();
}

function editConfig(type, itemId) {
  const projectOptions = state.projects.map((project) => ({ value: project.id, label: project.name }));
  const clientOptions = state.clients.map((client) => ({ value: client.id, label: client.name }));
  const statusOptions = ["Pending", "In Progress", "Done"].map((value) => ({ value, label: value }));
  const paymentStatusOptions = ["Pending", "Received", "Overdue"].map((value) => ({ value, label: value }));
  const methodOptions = ["Bank Transfer", "Cash", "Card", "UPI", "Other"].map((value) => ({ value, label: value }));
  const priorityOptions = ["Normal", "High", "Critical"].map((value) => ({ value, label: value }));

  if (type === "client") {
    const item = findClient(itemId);
    return item && {
      title: "Client",
      collection: "clients",
      fields: [
        { name: "name", label: "Client name", value: item.name, required: true },
        { name: "email", label: "Email", type: "email", value: item.email, required: true },
        { name: "phone", label: "Phone", value: item.phone }
      ]
    };
  }
  if (type === "project") {
    const item = findProject(itemId);
    return item && {
      title: "Project",
      collection: "projects",
      fields: [
        { name: "name", label: "Project name", value: item.name, required: true },
        { name: "clientId", label: "Client", type: "select", value: item.clientId, options: clientOptions, required: true },
        { name: "budget", label: "Budget", type: "number", value: item.budget },
        { name: "currency", label: "Currency", type: "select", value: item.currency || "USD", options: [{value:"USD",label:"USD"},{value:"EUR",label:"EUR"},{value:"GBP",label:"GBP"},{value:"AUD",label:"AUD"},{value:"INR",label:"INR"}] },
        { name: "taxRate", label: "Tax Rate (%)", type: "number", value: item.taxRate || 0 },
        { name: "dueDate", label: "Due date", type: "date", value: item.dueDate, required: true },
        { name: "notes", label: "Project notes", type: "textarea", value: item.notes }
      ]
    };
  }
  if (type === "task") {
    const item = state.tasks.find((task) => task.id === itemId);
    return item && {
      title: "Task",
      collection: "tasks",
      fields: [
        { name: "title", label: "Task title", value: item.title, required: true },
        { name: "projectId", label: "Project", type: "select", value: item.projectId, options: projectOptions, required: true },
        { name: "status", label: "Status", type: "select", value: item.status, options: statusOptions },
        { name: "dueDate", label: "Due date", type: "date", value: item.dueDate, required: true }
      ]
    };
  }
  if (type === "payment") {
    const item = state.payments.find((payment) => payment.id === itemId);
    return item && {
      title: "Payment",
      collection: "payments",
      fields: [
        { name: "projectId", label: "Project", type: "select", value: item.projectId, options: projectOptions, required: true },
        { name: "invoiceNumber", label: "Invoice number", value: item.invoiceNumber },
        { name: "amount", label: "Amount", type: "number", value: item.amount, required: true },
        { name: "paidAmount", label: "Paid amount", type: "number", value: paidAmount(item) },
        { name: "method", label: "Payment method", type: "select", value: item.method, options: methodOptions },
        { name: "status", label: "Status", type: "select", value: item.status, options: paymentStatusOptions },
        { name: "date", label: "Due date", type: "date", value: item.date, required: true }
      ]
    };
  }
  if (type === "deadline") {
    const item = state.deadlines.find((deadline) => deadline.id === itemId);
    return item && {
      title: "Deadline",
      collection: "deadlines",
      fields: [
        { name: "title", label: "Deadline title", value: item.title, required: true },
        { name: "projectId", label: "Project", type: "select", value: item.projectId, options: projectOptions, required: true },
        { name: "date", label: "Date", type: "date", value: item.date, required: true },
        { name: "priority", label: "Priority", type: "select", value: item.priority, options: priorityOptions }
      ]
    };
  }
  return null;
}

function saveEdit(event) {
  event.preventDefault();
  if (!editContext) return;
  const item = state[editContext.collection].find((entry) => entry.id === editContext.itemId);
  if (!item) return;
  const data = Object.fromEntries(new FormData(event.target).entries());
  if ("budget" in data) data.budget = Number(data.budget || 0);
  if ("amount" in data) data.amount = Number(data.amount || 0);
  if ("paidAmount" in data) data.paidAmount = Number(data.paidAmount || 0);
  if ("taxRate" in data) data.taxRate = Number(data.taxRate || 0);
  Object.assign(item, data);
  $("#editModal").close();
  editContext = null;
  saveState();
  render();
}

function createClientUser(clientId) {
  const client = findClient(clientId);
  if (!client) return;

  const name = prompt("Company user name", client.name);
  if (!name) return;
  const email = prompt("Company login email", client.email);
  if (!email) return;
  const password = prompt("Temporary password for company login");
  if (!password) return;

  postApi(`${API_BASE_URL}/api/client-user`, {
    clientId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password
  })
    .then(() => {
      postApi(`${API_BASE_URL}/api/email`, {
        to: email.trim().toLowerCase(),
        subject: "Your Client Portal Login Details",
        html: `<h2>Welcome to ProjectFlow</h2>
               <p>Your portal account has been created.</p>
               <p><strong>Login:</strong> ${email.trim().toLowerCase()}<br>
               <strong>Password:</strong> ${password}</p>
               <p>Log in at <a href="${window.location.origin}">${window.location.origin}</a></p>`
      }).catch(console.error);

      alert("Client portal login created and email sent.");
      render();
    })
    .catch((error) => alert(error.message));
}

function handleActions(event) {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.export) {
    exportCsv(button.dataset.export);
    return;
  }

  const actionMap = [
    ["viewProject", "viewProject"],
    ["createClientUser", "createClientUser"],
    ["editClient", "editClient"],
    ["editProject", "editProject"],
    ["editTask", "editTask"],
    ["editPayment", "editPayment"],
    ["editDeadline", "editDeadline"],
    ["deleteClient", "deleteClient"],
    ["deleteProject", "deleteProject"],
    ["deleteTask", "deleteTask"],
    ["deletePayment", "deletePayment"],
    ["deleteDeadline", "deleteDeadline"],
    ["deleteTimelog", "deleteTimelog"],
    ["cycleTask", "cycleTask"],
    ["cyclePayment", "cyclePayment"],
    ["printInvoice", "printInvoice"]
  ];

  const match = actionMap.find(([, datasetKey]) => button.dataset[datasetKey]);
  if (!match) return;

  const [action, datasetKey] = match;
  const itemId = button.dataset[datasetKey];
  let changed = true;

  if (action === "viewProject") {
    showProjectDetail(itemId);
    return;
  }
  if (action === "printInvoice") {
    const payment = state.payments.find(p => p.id === itemId);
    if (!payment) return;
    const project = findProject(payment.projectId);
    const client = findClient(project?.clientId);
    const currency = project?.currency || "USD";
    const taxRate = project?.taxRate || 0;
    
    const subtotal = payment.amount;
    const taxAmount = subtotal * (taxRate / 100);
    const grandTotal = subtotal + taxAmount;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1e293b; line-height: 1.6;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px;">
          <div>
            <h1 style="margin: 0; color: #2563eb; font-size: 32px; letter-spacing: 1px;">INVOICE</h1>
            <p style="margin: 5px 0 0 0; font-weight: bold;">Invoice #: ${escapeHtml(payment.invoiceNumber || "N/A")}</p>
            <p style="margin: 5px 0 0 0; color: #64748b;">Date: ${dateLabel(payment.date)}</p>
          </div>
          <div style="text-align: right;">
            <h2 style="margin: 0; font-size: 20px;">ProjectFlow Freelancer</h2>
            <p style="margin: 5px 0 0 0; color: #64748b;">${escapeHtml(state.user?.name || "")}</p>
            <p style="margin: 5px 0 0 0; color: #64748b;">${escapeHtml(state.user?.email || "")}</p>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 40px;">
          <div>
            <h3 style="margin: 0 0 10px 0; color: #64748b; font-size: 14px; text-transform: uppercase;">Bill To:</h3>
            <p style="margin: 0; font-size: 18px;"><strong>${escapeHtml(client?.name || "Client")}</strong></p>
            <p style="margin: 5px 0 0 0; color: #64748b;">${escapeHtml(client?.email || "")}</p>
          </div>
          <div style="text-align: right;">
            <h3 style="margin: 0 0 10px 0; color: #64748b; font-size: 14px; text-transform: uppercase;">Project:</h3>
            <p style="margin: 0; font-size: 18px;">${escapeHtml(project?.name || "Project")}</p>
          </div>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; color: #64748b;">Description</th>
              <th style="text-align: right; padding: 12px; border-bottom: 2px solid #e2e8f0; color: #64748b;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 16px 12px; border-bottom: 1px solid #f1f5f9;">Payment for ${escapeHtml(project?.name || "Project")}</td>
              <td style="text-align: right; padding: 16px 12px; border-bottom: 1px solid #f1f5f9;">${money(subtotal, currency)}</td>
            </tr>
            ${taxRate > 0 ? `
            <tr>
              <td style="text-align: right; padding: 16px 12px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Tax (${taxRate}%)</td>
              <td style="text-align: right; padding: 16px 12px; border-bottom: 1px solid #f1f5f9;">${money(taxAmount, currency)}</td>
            </tr>` : ""}
          </tbody>
        </table>
        <div style="text-align: right; border-top: 2px solid #e2e8f0; padding-top: 20px;">
          <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #0f172a;">Grand Total: ${money(grandTotal, currency)}</p>
          <p style="margin: 0; font-size: 16px; color: #64748b;">Paid: <span style="color: #10b981;">${money(paidAmount(payment), currency)}</span> | Balance Due: <span style="color: #ef4444;">${money(grandTotal - paidAmount(payment), currency)}</span></p>
        </div>
      </div>
    `;
    const recipients = [];
    if (client?.email) recipients.push(client.email);
    if (state.user?.email) recipients.push(state.user.email);
    
    if (recipients.length > 0) {
      postApi(`${API_BASE_URL}/api/email`, {
        to: recipients,
        subject: `Invoice ${payment.invoiceNumber || ""} from ProjectFlow`,
        html: html
      })
      .then(() => alert(`Invoice emailed securely to:\n${recipients.join("\n")}`))
      .catch((err) => alert("Failed to send email: " + err.message));
    } else {
      alert("Cannot send invoice: No email address found for the client or your freelancer profile.");
    }
    return;
  }

  if (action === "createClientUser") return createClientUser(itemId);
  if (action === "editClient") return openEdit("client", itemId);
  if (action === "editProject") return openEdit("project", itemId);
  if (action === "editTask") return openEdit("task", itemId);
  if (action === "editPayment") return openEdit("payment", itemId);
  if (action === "editDeadline") return openEdit("deadline", itemId);
  if (action === "deleteClient") changed = cascadeDeleteClient(itemId);
  if (action === "deleteProject") changed = cascadeDeleteProject(itemId);
  if (action === "deleteTask") changed = cascadeDeleteTask(itemId);
  if (action === "deletePayment") changed = confirmDelete("payment") && (deleteBy("payments", itemId), true);
  if (action === "deleteDeadline") changed = confirmDelete("deadline") && (deleteBy("deadlines", itemId), true);
  if (action === "deleteTimelog") changed = confirmDelete("time log") && (deleteBy("timeLogs", itemId), true);
  if (action === "cycleTask") cycleStatus("tasks", itemId, ["Pending", "In Progress", "Done"]);
  if (action === "cyclePayment") cycleStatus("payments", itemId, ["Pending", "Received", "Overdue"]);

  if (changed) {
    saveState();
    render();
  }
}

function exportCsv(type) {
  const rows = exportRows(type);
  if (!rows.length) {
    alert("No data to export.");
    return;
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${type}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportRows(type) {
  if (type === "clients") {
    return [["Name", "Email", "Phone"], ...state.clients.map((client) => [client.name, client.email, client.phone])];
  }
  if (type === "projects") {
    return [["Project", "Client", "Budget", "Due Date", "Notes"], ...state.projects.map((project) => [project.name, findClient(project.clientId)?.name, project.budget, project.dueDate, project.notes])];
  }
  if (type === "tasks") {
    return [["Task", "Project", "Status", "Due Date"], ...state.tasks.map((task) => [task.title, findProject(task.projectId)?.name, task.status, task.dueDate])];
  }
  if (type === "payments") {
    return [["Project", "Invoice", "Amount", "Paid", "Balance", "Method", "Status", "Due Date"], ...state.payments.map((payment) => [findProject(payment.projectId)?.name, payment.invoiceNumber, payment.amount, paidAmount(payment), balanceAmount(payment), payment.method, payment.status, payment.date])];
  }
  return [];
}

function handleFilterInput(event) {
  const key = event.target.dataset.filter;
  if (!key) return;
  filters[key] = event.target.value;
  render();
}

function logout() {
  postApi(`${API_BASE_URL}/api/logout`, {})
    .then(() => {
      state.user = null;
      sessionStorage.removeItem(USER_SESSION_KEY);
      showLogin();
    })
    .catch((error) => alert(error.message));
}

$("#loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const password = $("#loginPassword").value;
  postApi(`${API_BASE_URL}/api/login`, { email, password })
    .then((data) => {
      Object.assign(state, data);
      showDashboardForRole();
    })
    .catch((error) => alert(error.message));
});

$("#signupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#signupName").value.trim();
  const email = $("#signupEmail").value.trim().toLowerCase();
  const password = $("#signupPassword").value;
  postApi(`${API_BASE_URL}/api/signup`, { name, email, password })
    .then((data) => {
      Object.assign(state, data);
      event.target.reset();
      showDashboardForRole();
    })
    .catch((error) => alert(error.message));
});

$("#logoutButton").addEventListener("click", () => {
  logout();
});

$("#portalLogoutButton").addEventListener("click", () => {
  logout();
});

$("#showLogin").addEventListener("click", () => setAuthMode("login"));
$("#showSignup").addEventListener("click", () => setAuthMode("signup"));
$("#backToProjects").addEventListener("click", () => switchTab("projects"));
$("#clientForm").addEventListener("submit", addClient);
$("#projectForm").addEventListener("submit", addProject);
$("#taskForm").addEventListener("submit", addTask);
$("#paymentForm").addEventListener("submit", addPayment);
$("#deadlineForm").addEventListener("submit", addDeadline);
const timelogForm = $("#timelogForm");
if (timelogForm) timelogForm.addEventListener("submit", addTimelog);
function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const entityType = input.dataset.entity;
  const entityId = input.dataset.entityId;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    try {
      input.disabled = true;
      const res = await fetch(`${API_BASE_URL}/api/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content: base64 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      state.attachments.push({
        id: id(),
        entityType,
        entityId,
        filename: data.filename,
        url: data.url,
        date: new Date().toISOString().split("T")[0]
      });
      saveState();
      render();
    } catch(err) {
      alert("Failed to upload: " + err.message);
    } finally {
      input.disabled = false;
      input.value = "";
    }
  };
  reader.readAsDataURL(file);
}

$("#appView").addEventListener("click", handleActions);
$("#appView").addEventListener("input", handleFilterInput);
$("#appView").addEventListener("change", (e) => {
  if (e.target.id === "uploadAttachmentInput" || e.target.classList.contains("portal-upload")) {
    handleFileUpload(e.target);
  } else {
    handleFilterInput(e);
  }
});
$("#clientPortalView").addEventListener("change", (e) => {
  if (e.target.classList.contains("portal-upload")) {
    handleFileUpload(e.target);
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.classList.contains("comment-form")) {
    e.preventDefault();
    const taskId = e.target.dataset.taskId;
    const text = new FormData(e.target).get("commentText");
    const task = state.tasks.find(t => t.id === taskId);
    if (task && text) {
      task.comments = task.comments || [];
      task.comments.push({ author: state.user?.name || "Unknown", text, date: new Date().toISOString() });
      saveState();
      renderClientPortal();
    }
  }
});
$("#editForm").addEventListener("submit", saveEdit);
$("#cancelEdit").addEventListener("click", () => $("#editModal").close());
$("#closeEdit").addEventListener("click", () => $("#editModal").close());

// Drag and drop for Kanban board
document.addEventListener("dragstart", (e) => {
  if (e.target.classList && e.target.classList.contains("kanban-card")) {
    e.dataTransfer.setData("text/plain", e.target.dataset.taskId);
    e.target.style.opacity = "0.5";
  }
});
document.addEventListener("dragend", (e) => {
  if (e.target.classList && e.target.classList.contains("kanban-card")) {
    e.target.style.opacity = "1";
  }
});
document.addEventListener("dragover", (e) => {
  const column = e.target.closest(".kanban-column");
  if (column) {
    e.preventDefault(); // allow drop
    const list = column.querySelector(".kanban-list");
    if (list) list.classList.add("drag-over");
  }
});
document.addEventListener("dragleave", (e) => {
  const column = e.target.closest(".kanban-column");
  if (column) {
    const list = column.querySelector(".kanban-list");
    if (list) list.classList.remove("drag-over");
  }
});
document.addEventListener("drop", (e) => {
  const column = e.target.closest(".kanban-column");
  if (column) {
    e.preventDefault();
    const list = column.querySelector(".kanban-list");
    if (list) list.classList.remove("drag-over");
    
    const taskId = e.dataTransfer.getData("text/plain");
    const newStatus = column.dataset.status;
    
    if (taskId && newStatus) {
      const task = state.tasks.find(t => t.id === taskId);
      if (task && task.status !== newStatus) {
        task.status = newStatus;
        saveState();
        render();
      }
    }
  }
});

$$(".nav-button").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

const themeToggle = document.getElementById("themeToggle");
const currentTheme = localStorage.getItem("theme");
if (currentTheme === "dark") document.body.classList.add("dark-theme");
if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    const theme = document.body.classList.contains("dark-theme") ? "dark" : "light";
    localStorage.setItem("theme", theme);
    renderCharts();
  });
}

async function init() {
  await loadState();
  if (state.user) {
    showDashboardForRole();
  } else {
    showLogin();
  }

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
}

init();
