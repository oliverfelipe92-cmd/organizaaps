const state = {
  bootstrap: null,
  selectedId: null,
  dashboard: null,
  patients: [],
};

const refs = {
  authScreen: document.getElementById("authScreen"),
  setupCard: document.getElementById("setupCard"),
  loginCard: document.getElementById("loginCard"),
  setupForm: document.getElementById("setupForm"),
  loginForm: document.getElementById("loginForm"),
  appShell: document.getElementById("appShell"),
  userLabel: document.getElementById("userLabel"),
  logoutButton: document.getElementById("logoutButton"),
  refreshButton: document.getElementById("refreshButton"),
  teamSection: document.getElementById("teamSection"),
  teamList: document.getElementById("teamList"),
  teamForm: document.getElementById("teamForm"),
  importForm: document.getElementById("importForm"),
  importRunsList: document.getElementById("importRunsList"),
  statsGrid: document.getElementById("statsGrid"),
  priorityList: document.getElementById("priorityList"),
  coverageList: document.getElementById("coverageList"),
  patientsList: document.getElementById("patientsList"),
  patientDetail: document.getElementById("patientDetail"),
  patientEmpty: document.getElementById("patientEmpty"),
  patientCountLabel: document.getElementById("patientCountLabel"),
  filtersForm: document.getElementById("filtersForm"),
  newPatientForm: document.getElementById("newPatientForm"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value, withTime = false) {
  if (!value) return "Sem data";
  const options = withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" };
  return new Intl.DateTimeFormat("pt-BR", options).format(new Date(value));
}

function formToJson(form) {
  const payload = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    payload[key] = value;
  }
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    payload[input.name] = input.checked;
  });
  return payload;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentUser() {
  return state.bootstrap?.user || null;
}

function permissions() {
  return state.bootstrap?.permissions || {
    can_manage_team: false,
    can_import: false,
    can_write: false,
  };
}

function roleOptions(selectedRole) {
  const roles = state.bootstrap?.roles || [];
  return roles
    .map(
      (role) => `
        <option value="${escapeHtml(role.value)}" ${selectedRole === role.value ? "selected" : ""}>
          ${escapeHtml(role.label)}
        </option>
      `
    )
    .join("");
}

function currentFilters() {
  const data = new FormData(refs.filtersForm);
  return new URLSearchParams({
    search: data.get("search") || "",
    risk: data.get("risk") || "all",
    status: data.get("status") || "all",
  });
}

async function apiJson(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: { ...(options.headers || {}) },
    credentials: "same-origin",
  };

  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, init);
  let payload = {};
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    payload = await response.json();
  }
  if (!response.ok) {
    const error = new Error(payload.error || "Falha na requisição.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function refreshBootstrap() {
  state.bootstrap = await apiJson("/api/bootstrap");
  renderAuthState();
  if (state.bootstrap.user) {
    await loadAppData();
  }
}

function renderAuthState() {
  const needsSetup = Boolean(state.bootstrap?.needs_setup);
  const user = currentUser();
  const perms = permissions();

  refs.setupCard.hidden = !needsSetup;
  refs.loginCard.hidden = needsSetup || Boolean(user);
  refs.authScreen.hidden = Boolean(user);
  refs.appShell.hidden = !user;
  refs.userLabel.hidden = !user;
  refs.logoutButton.hidden = !user;
  refs.refreshButton.hidden = !user;
  refs.teamSection.hidden = !user || !perms.can_manage_team;
  refs.importForm.querySelectorAll("input, select, button").forEach((element) => {
    element.disabled = !perms.can_import;
  });
  refs.newPatientForm.querySelectorAll("input, select, textarea, button").forEach((element) => {
    element.disabled = !perms.can_write;
  });

  refs.userLabel.textContent = user ? `${user.full_name} · ${user.role_label || user.role}` : "";
  if (refs.teamForm) {
    const roleSelect = refs.teamForm.querySelector('select[name="role"]');
    if (roleSelect && state.bootstrap?.roles?.length) {
      roleSelect.innerHTML = roleOptions(roleSelect.value || "nurse");
    }
  }
}

async function loadDashboardAndPatients() {
  state.dashboard = await apiJson(`/api/dashboard?${currentFilters().toString()}`);
  state.patients = state.dashboard.patients;

  if (state.selectedId && !state.patients.find((patient) => patient.id === state.selectedId)) {
    state.selectedId = null;
  }
  if (!state.selectedId && state.patients.length) {
    state.selectedId = state.patients[0].id;
  }

  renderStats();
  renderPriorities();
  renderCoverage();
  renderPatients();

  if (state.selectedId) {
    await renderSelectedPatient();
  } else {
    renderDetail(null);
  }
}

async function loadImports() {
  const runs = await apiJson("/api/imports");
  renderImports(runs);
}

async function loadTeam() {
  if (!permissions().can_manage_team) {
    refs.teamList.innerHTML = `<p class="hint">Sem permissão para gestão da equipe.</p>`;
    return;
  }
  const users = await apiJson("/api/users");
  renderTeam(users);
}

async function loadAppData() {
  try {
    const tasks = [loadDashboardAndPatients(), loadImports()];
    if (permissions().can_manage_team) {
      tasks.push(loadTeam());
    }
    await Promise.all(tasks);
  } catch (error) {
    handleApiError(error);
  }
}

async function fetchPatient(patientId) {
  return apiJson(`/api/patients/${patientId}`);
}

function renderStats() {
  const stats = state.dashboard?.stats || {
    total_active: 0,
    high_risk: 0,
    puerperas: 0,
    average_journey_score: 0,
    overdue_follow_ups: 0,
  };
  const cards = [
    ["Ativas", stats.total_active],
    ["Alto risco", stats.high_risk],
    ["Puérperas", stats.puerperas],
    ["Score", `${stats.average_journey_score}%`],
    ["Atrasos", stats.overdue_follow_ups],
  ];
  refs.statsGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderPriorities() {
  const items = state.dashboard?.priorities || [];
  refs.priorityList.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="priority-card">
              <div class="meta-row">
                <strong>${escapeHtml(item.patient_name)}</strong>
                <span class="pill pill-${escapeHtml(item.level)}">${escapeHtml(item.level)}</span>
              </div>
              <p>${escapeHtml(item.title)}</p>
            </article>
          `
        )
        .join("")
    : `<p class="hint">Sem itens.</p>`;
}

function renderCoverage() {
  const items = state.dashboard?.coverage || [];
  if (!items.length || !state.dashboard?.stats?.total_active) {
    refs.coverageList.innerHTML = `<p class="hint">Sem dados.</p>`;
    return;
  }
  refs.coverageList.innerHTML = items
    .map((item) => {
      const total = item.total || 0;
      const percent = total ? Math.round((item.done / total) * 100) : 0;
      return `
        <div class="coverage-row">
          <div class="meta-row">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="muted-inline">${item.done}/${item.total}</span>
          </div>
          <div class="coverage-track">
            <div class="coverage-bar" style="width:${percent}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderPatients() {
  refs.patientCountLabel.textContent = `${state.patients.length}`;
  if (!state.patients.length) {
    refs.patientsList.innerHTML = `<p class="hint">Nenhuma usuária.</p>`;
    return;
  }
  refs.patientsList.innerHTML = state.patients
    .map(
      (patient) => `
        <article class="patient-card ${state.selectedId === patient.id ? "active" : ""}" data-patient-id="${patient.id}">
          <div class="patient-card-head">
            <div>
              <h3>${escapeHtml(patient.name)}</h3>
              <p class="patient-meta">${escapeHtml(patient.locality || "Sem localidade")}</p>
            </div>
            <span class="score-chip">${escapeHtml(patient.current_score)}%</span>
          </div>
          <div class="priority-pills">
            <span class="pill pill-risk">${escapeHtml(patient.risk_level || "Sem classificação")}</span>
            <span class="pill pill-status">${escapeHtml(patient.status || "gestante")}</span>
          </div>
          <p class="patient-meta">${escapeHtml(patient.stage_label || "Sem fase")} · ${
            patient.days_since_last_consult != null ? `${patient.days_since_last_consult}d` : "sem consulta"
          }</p>
        </article>
      `
    )
    .join("");
}

function renderImports(runs) {
  refs.importRunsList.innerHTML = runs.length
    ? runs
        .map(
          (run) => `
            <article class="timeline-item">
              <div class="timeline-head">
                <strong>${escapeHtml(run.filename)}</strong>
                <span class="muted-inline">${formatDate(run.created_at, true)}</span>
              </div>
              <p>${escapeHtml(run.source_kind)} · ${escapeHtml(run.imported_by_name || "Equipe")}</p>
              <p>
                ${run.total_rows} linhas · ${run.inserted_patients} novas · ${run.updated_patients} atualizadas ·
                ${run.inserted_events} eventos · ${run.skipped_rows} sem mudança
              </p>
            </article>
          `
        )
        .join("")
    : `<p class="hint">Nenhuma importação ainda.</p>`;
}

function renderTeam(users) {
  refs.teamList.innerHTML = users.length
    ? users
        .map(
          (user) => `
            <form class="team-card" data-user-id="${user.id}">
              <div class="meta-row">
                <div>
                  <strong>${escapeHtml(user.full_name)}</strong>
                  <p class="patient-meta">${escapeHtml(user.email)}</p>
                </div>
                <span class="pill ${user.is_active ? "pill-status" : "pill-pending"}">
                  ${user.is_active ? "ativo" : "inativo"}
                </span>
              </div>
              <div class="team-grid">
                <select name="role">${roleOptions(user.role)}</select>
                <select name="is_active">
                  <option value="true" ${user.is_active ? "selected" : ""}>Ativo</option>
                  <option value="false" ${!user.is_active ? "selected" : ""}>Inativo</option>
                </select>
                <input name="password" type="password" placeholder="Nova senha opcional" />
                <button class="ghost-button" type="submit">Salvar acesso</button>
              </div>
            </form>
          `
        )
        .join("")
    : `<p class="hint">Nenhum usuário cadastrado.</p>`;
}

function indicatorCard(indicator) {
  const tone = indicator.state === "completed" ? "completed" : indicator.state === "upcoming" ? "upcoming" : "pending";
  const label = indicator.state === "completed" ? "feito" : indicator.state === "upcoming" ? "depois" : "pendente";
  return `
    <article class="indicator-card" data-state="${escapeHtml(indicator.state)}">
      <div class="meta-row">
        <strong>${escapeHtml(indicator.code)}</strong>
        <span class="pill pill-${tone}">${escapeHtml(label)}</span>
      </div>
      <div class="indicator-meta">${escapeHtml(indicator.title)}</div>
      <div class="indicator-meta">${escapeHtml(indicator.count)} / ${escapeHtml(indicator.target)}</div>
    </article>
  `;
}

function renderDetail(patient) {
  if (!patient) {
    refs.patientEmpty.hidden = false;
    refs.patientDetail.innerHTML = "";
    return;
  }
  refs.patientEmpty.hidden = true;

  const priorities = patient.priorities.length
    ? patient.priorities
        .map(
          (item) => `
            <article class="priority-card">
              <div class="meta-row">
                <strong>${escapeHtml(item.title)}</strong>
                <span class="pill pill-${escapeHtml(item.level)}">${escapeHtml(item.level)}</span>
              </div>
              <p>${escapeHtml(item.detail)}</p>
            </article>
          `
        )
        .join("")
    : `<p class="hint">Sem pendências.</p>`;

  const timeline = patient.events.length
    ? patient.events
        .map(
          (event) => `
            <article class="timeline-item">
              <div class="timeline-head">
                <strong>${escapeHtml(event.label)}</strong>
                <span class="muted-inline">${formatDate(event.event_date)}</span>
              </div>
              ${event.professional ? `<p>${escapeHtml(event.professional)}</p>` : ""}
              ${event.notes ? `<p>${escapeHtml(event.notes)}</p>` : ""}
            </article>
          `
        )
        .join("")
    : `<p class="hint">Sem histórico.</p>`;

  refs.patientDetail.innerHTML = `
    <div class="detail-shell">
      <section class="detail-card detail-summary">
        <div class="detail-head">
          <div>
            <h2 class="detail-title">${escapeHtml(patient.name)}</h2>
            <p class="patient-meta">${escapeHtml(patient.stage_label || "Sem fase")} · ${escapeHtml(patient.locality || "Sem localidade")}</p>
          </div>
          <span class="score-chip">${escapeHtml(patient.current_score)}%</span>
        </div>
        <div class="priority-pills">
          <span class="pill pill-risk">${escapeHtml(patient.risk_level || "Sem classificação")}</span>
          <span class="pill pill-status">${escapeHtml(patient.status)}</span>
          <span class="muted-inline">${patient.days_since_last_consult != null ? `${patient.days_since_last_consult} dias` : "sem consulta"}</span>
        </div>
      </section>

      <section class="detail-card">
        <div class="section-head"><h2>Alertas</h2></div>
        <div class="stack-list">${priorities}</div>
      </section>

      <section class="detail-card">
        <div class="section-head"><h2>Indicadores</h2></div>
        <div class="indicator-grid">${patient.indicator_results.map(indicatorCard).join("")}</div>
      </section>

      <div class="detail-grid">
        <section class="detail-card">
          <div class="section-head"><h2>Perfil</h2></div>
          <form id="profileForm" class="form-grid" data-patient-id="${patient.id}">
            <input name="name" value="${escapeHtml(patient.name)}" placeholder="Nome" />
            <input name="locality" value="${escapeHtml(patient.locality || "")}" placeholder="Localidade" />
            <select name="risk_level">
              <option ${patient.risk_level === "Baixo risco" ? "selected" : ""}>Baixo risco</option>
              <option ${patient.risk_level === "Risco intermediario" ? "selected" : ""}>Risco intermediario</option>
              <option ${patient.risk_level === "Alto risco" ? "selected" : ""}>Alto risco</option>
            </select>
            <select name="status">
              <option value="gestante" ${patient.status === "gestante" ? "selected" : ""}>Gestante</option>
              <option value="puerpera" ${patient.status === "puerpera" ? "selected" : ""}>Puérpera</option>
              <option value="encerrado" ${patient.status === "encerrado" ? "selected" : ""}>Encerrado</option>
            </select>
            <input name="gestational_weeks" type="number" min="1" max="45" value="${escapeHtml(patient.gestational_weeks || "")}" placeholder="IG semanas" />
            <input name="dum" type="date" value="${escapeHtml(patient.dum || "")}" />
            <input name="dpp" type="date" value="${escapeHtml(patient.dpp || "")}" />
            <input name="actual_birth_date" type="date" value="${escapeHtml(patient.actual_birth_date || "")}" />
            <input class="wide" name="maternity_reference" value="${escapeHtml(patient.maternity_reference || "")}" placeholder="Maternidade" />
            <input name="last_professional" value="${escapeHtml(patient.last_professional || "")}" placeholder="Profissional" />
            <label class="check-item">
              <input name="high_risk_shared_care" type="checkbox" ${patient.high_risk_shared_care ? "checked" : ""} />
              <span>Alto risco compartilhado</span>
            </label>
            <label class="check-item">
              <input name="active_search" type="checkbox" ${patient.active_search ? "checked" : ""} />
              <span>Busca ativa</span>
            </label>
            <textarea class="wide" name="notes" rows="4" placeholder="Observações">${escapeHtml(patient.notes || "")}</textarea>
            <div class="wide form-actions"><button class="primary-button" type="submit">Salvar</button></div>
          </form>
        </section>

        <section class="detail-card">
          <div class="section-head"><h2>Atendimento</h2></div>
          <form id="quickUpdateForm" class="form-grid" data-patient-id="${patient.id}">
            <input name="event_date" type="date" value="${todayIso()}" required />
            <input name="professional" value="${escapeHtml(patient.last_professional || "")}" placeholder="Profissional" />
            <select name="risk_level">
              <option ${patient.risk_level === "Baixo risco" ? "selected" : ""}>Baixo risco</option>
              <option ${patient.risk_level === "Risco intermediario" ? "selected" : ""}>Risco intermediario</option>
              <option ${patient.risk_level === "Alto risco" ? "selected" : ""}>Alto risco</option>
            </select>
            <select name="status">
              <option value="gestante" ${patient.status === "gestante" ? "selected" : ""}>Gestante</option>
              <option value="puerpera" ${patient.status === "puerpera" ? "selected" : ""}>Puérpera</option>
            </select>
            <input name="gestational_weeks" type="number" min="1" max="45" value="${escapeHtml(patient.gestational_weeks || "")}" placeholder="IG semanas" />
            <input name="actual_birth_date" type="date" value="${escapeHtml(patient.actual_birth_date || "")}" />
            <div class="checkbox-grid wide">
              ${[
                ["prenatal_consult", "Consulta pré-natal"],
                ["puerperal_consult", "Consulta puerperal"],
                ["blood_pressure", "PA"],
                ["anthropometry", "Peso e altura"],
                ["pregnancy_home_visit", "Visita gestação"],
                ["puerperal_home_visit", "Visita puerpério"],
                ["dtpa_vaccine", "dTpa"],
                ["first_trimester_tests", "Testes 1º tri"],
                ["third_trimester_tests", "Testes 3º tri"],
                ["dental_visit", "Saúde bucal"],
                ["delivery", "Parto"],
              ]
                .map(
                  ([name, label]) => `
                    <label class="check-item">
                      <input name="${name}" type="checkbox" />
                      <span>${label}</span>
                    </label>
                  `
                )
                .join("")}
            </div>
            <textarea class="wide" name="notes" rows="4" placeholder="Observações"></textarea>
            <div class="wide form-actions"><button class="primary-button" type="submit">Registrar</button></div>
          </form>
        </section>
      </div>

      <section class="detail-card">
        <div class="section-head"><h2>Histórico</h2></div>
        <div class="timeline">${timeline}</div>
      </section>
    </div>
  `;
}

async function renderSelectedPatient() {
  if (!state.selectedId) {
    renderDetail(null);
    return;
  }
  try {
    const patient = await fetchPatient(state.selectedId);
    renderDetail(patient);
    applyWritePermissionsToDetail();
  } catch (error) {
    handleApiError(error);
  }
}

function handleApiError(error) {
  if (error?.status === 401) {
    toast("Sessão expirada. Entre novamente.");
    state.bootstrap = { needs_setup: false, user: null };
    state.selectedId = null;
    renderAuthState();
    return;
  }
  toast(error.message || "Falha inesperada.");
}

function applyWritePermissionsToDetail() {
  const canWrite = permissions().can_write;
  refs.patientDetail.querySelectorAll("input, select, textarea, button").forEach((element) => {
    element.disabled = !canWrite;
  });
}

refs.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await apiJson("/api/setup", { method: "POST", body: formToJson(event.currentTarget) });
    event.currentTarget.reset();
    await refreshBootstrap();
    toast("Administrador criado.");
  } catch (error) {
    handleApiError(error);
  }
});

refs.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await apiJson("/api/auth/login", { method: "POST", body: formToJson(event.currentTarget) });
    event.currentTarget.reset();
    await refreshBootstrap();
    toast("Acesso liberado.");
  } catch (error) {
    handleApiError(error);
  }
});

refs.logoutButton.addEventListener("click", async () => {
  try {
    await apiJson("/api/auth/logout", { method: "POST" });
    state.bootstrap = { needs_setup: false, user: null };
    state.selectedId = null;
    renderAuthState();
    toast("Sessão encerrada.");
  } catch (error) {
    handleApiError(error);
  }
});

refs.refreshButton.addEventListener("click", async () => {
  await loadAppData();
});

refs.filtersForm.addEventListener("input", async () => {
  await loadDashboardAndPatients();
});

refs.patientsList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-patient-id]");
  if (!card) return;
  state.selectedId = Number(card.dataset.patientId);
  renderPatients();
  await renderSelectedPatient();
});

refs.newPatientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!permissions().can_write) return;
  try {
    const { patient_id } = await apiJson("/api/patients", {
      method: "POST",
      body: formToJson(event.currentTarget),
    });
    event.currentTarget.reset();
    state.selectedId = patient_id;
    await loadDashboardAndPatients();
    toast("Cadastro realizado.");
  } catch (error) {
    handleApiError(error);
  }
});

refs.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!permissions().can_import) return;
  const formData = new FormData(event.currentTarget);
  try {
    const summary = await apiJson("/api/imports/pec", {
      method: "POST",
      body: formData,
    });
    event.currentTarget.reset();
    await loadAppData();
    toast(
      `Importação concluída: ${summary.inserted_patients} novas, ${summary.updated_patients} atualizadas, ${summary.skipped_rows} sem mudança.`
    );
  } catch (error) {
    handleApiError(error);
  }
});

refs.teamForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!permissions().can_manage_team) return;
  try {
    await apiJson("/api/users", {
      method: "POST",
      body: formToJson(event.currentTarget),
    });
    event.currentTarget.reset();
    await loadTeam();
    toast("Usuário criado.");
  } catch (error) {
    handleApiError(error);
  }
});

refs.teamList.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (!permissions().can_manage_team) return;
  const userId = Number(form.dataset.userId);
  if (!userId) return;
  try {
    const payload = formToJson(form);
    await apiJson(`/api/users/${userId}`, {
      method: "POST",
      body: payload,
    });
    await loadTeam();
    toast("Acesso atualizado.");
  } catch (error) {
    handleApiError(error);
  }
});

refs.patientDetail.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (!permissions().can_write) return;
  const patientId = Number(form.dataset.patientId);
  if (!patientId) return;
  try {
    if (form.id === "profileForm") {
      await apiJson(`/api/patients/${patientId}/profile`, {
        method: "POST",
        body: formToJson(form),
      });
      toast("Perfil salvo.");
    } else {
      await apiJson(`/api/patients/${patientId}/quick-update`, {
        method: "POST",
        body: formToJson(form),
      });
      toast("Atendimento registrado.");
    }
    state.selectedId = patientId;
    await loadDashboardAndPatients();
    applyWritePermissionsToDetail();
  } catch (error) {
    handleApiError(error);
  }
});

await refreshBootstrap();
