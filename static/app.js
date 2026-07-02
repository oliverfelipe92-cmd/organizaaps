const state = {
  bootstrap: null,
  selectedId: null,
  dashboard: null,
  patients: [],
};

const DEFAULT_BOOTSTRAP = {
  needs_setup: false,
  user: null,
  roles: [
    { value: "admin", label: "Administrador" },
    { value: "nurse", label: "Enfermagem" },
    { value: "acs", label: "ACS" },
    { value: "viewer", label: "Somente leitura" },
  ],
  permissions: {
    can_manage_team: false,
    can_import: false,
    can_write: false,
  },
};

const refs = {
  authScreen: document.getElementById("authScreen"),
  authFeedback: document.getElementById("authFeedback"),
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
  territoryList: document.getElementById("territoryList"),
  professionalList: document.getElementById("professionalList"),
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
  return state.bootstrap?.permissions || DEFAULT_BOOTSTRAP.permissions;
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

function setAuthFeedback(message = "", tone = "error") {
  if (!refs.authFeedback) return;
  if (!message) {
    refs.authFeedback.hidden = true;
    refs.authFeedback.textContent = "";
    delete refs.authFeedback.dataset.tone;
    return;
  }
  refs.authFeedback.hidden = false;
  refs.authFeedback.dataset.tone = tone;
  refs.authFeedback.textContent = message;
}

function setFormBusy(form, busy, busyLabel) {
  const submitButton = form?.querySelector('button[type="submit"]');
  if (!submitButton) return;
  if (!submitButton.dataset.defaultLabel) {
    submitButton.dataset.defaultLabel = submitButton.textContent || "";
  }
  form.querySelectorAll("input, select, textarea, button").forEach((element) => {
    element.disabled = busy;
  });
  submitButton.textContent = busy ? busyLabel : submitButton.dataset.defaultLabel;
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
  setAuthFeedback("");
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
  renderBreakdowns();
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
    late_capture: 0,
    without_tests: 0,
    without_dental: 0,
    without_maternity: 0,
    high_risk_without_shared_care: 0,
    puerperas_without_7d_visit: 0,
    puerperas_without_42d_consult: 0,
  };
  const cards = [
    ["Ativas", stats.total_active],
    ["Alto risco", stats.high_risk],
    ["Puérperas", stats.puerperas],
    ["Score", `${stats.average_journey_score}%`],
    ["Atrasos", stats.overdue_follow_ups],
    ["Captação tardia", stats.late_capture],
    ["Sem testes", stats.without_tests],
    ["Sem odonto", stats.without_dental],
    ["Sem maternidade", stats.without_maternity],
    ["AR sem compartilhamento", stats.high_risk_without_shared_care],
    ["Sem visita 7d", stats.puerperas_without_7d_visit],
    ["Sem consulta 42d", stats.puerperas_without_42d_consult],
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

function renderBreakdowns() {
  const localityItems = state.dashboard?.breakdowns?.locality || [];
  const professionalItems = state.dashboard?.breakdowns?.professional || [];

  refs.territoryList.innerHTML = localityItems.length
    ? localityItems
        .map(
          ([label, total]) => `
            <article class="timeline-item compact-item">
              <div class="timeline-head">
                <strong>${escapeHtml(label)}</strong>
                <span class="pill pill-status">${escapeHtml(total)}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="hint">Sem distribuição territorial.</p>`;

  refs.professionalList.innerHTML = professionalItems.length
    ? professionalItems
        .map(
          ([label, total]) => `
            <article class="timeline-item compact-item">
              <div class="timeline-head">
                <strong>${escapeHtml(label)}</strong>
                <span class="pill pill-status">${escapeHtml(total)}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="hint">Sem distribuição por profissional.</p>`;
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
              <p class="patient-meta">${escapeHtml(patient.microarea || patient.locality || "Sem localidade")}</p>
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
          <p class="patient-meta">${escapeHtml(patient.last_professional || patient.locality || "Sem profissional")}</p>
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
            <p class="patient-meta">${escapeHtml(patient.stage_label || "Sem fase")} · ${escapeHtml(patient.microarea || patient.locality || "Sem localidade")}</p>
          </div>
          <span class="score-chip">${escapeHtml(patient.current_score)}%</span>
        </div>
        <div class="priority-pills">
          <span class="pill pill-risk">${escapeHtml(patient.risk_level || "Sem classificação")}</span>
          <span class="pill pill-status">${escapeHtml(patient.status)}</span>
          ${patient.age_years != null ? `<span class="pill pill-upcoming">${escapeHtml(patient.age_years)} anos</span>` : ""}
          ${patient.maternity_reference ? `<span class="pill pill-completed">${escapeHtml(patient.maternity_reference)}</span>` : ""}
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
            <input name="external_code" value="${escapeHtml(patient.external_code || "")}" placeholder="Numero de ordem / prontuario" />
            <input name="cpf" value="${escapeHtml(patient.cpf || "")}" placeholder="CPF" />
            <input name="cns" value="${escapeHtml(patient.cns || "")}" placeholder="CNS" />
            <input name="name" value="${escapeHtml(patient.name)}" placeholder="Nome" />
            <input name="birth_date" type="date" value="${escapeHtml(patient.birth_date || "")}" />
            <select name="sex">
              <option value="" ${!patient.sex ? "selected" : ""}>Sexo</option>
              <option value="F" ${patient.sex === "F" ? "selected" : ""}>Feminino</option>
              <option value="M" ${patient.sex === "M" ? "selected" : ""}>Masculino</option>
              <option value="Outro" ${patient.sex === "Outro" ? "selected" : ""}>Outro</option>
            </select>
            <input name="race_color" value="${escapeHtml(patient.race_color || "")}" placeholder="Raca/cor" />
            <input name="mother_name" value="${escapeHtml(patient.mother_name || "")}" placeholder="Nome da mae" />
            <input name="locality" value="${escapeHtml(patient.locality || "")}" placeholder="Localidade" />
            <input name="microarea" value="${escapeHtml(patient.microarea || "")}" placeholder="Microarea" />
            <input name="area_team" value="${escapeHtml(patient.area_team || "")}" placeholder="Equipe / area" />
            <input name="record_responsible" value="${escapeHtml(patient.record_responsible || "")}" placeholder="Responsavel pelo registro" />
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
            <input name="gestational_age_label" value="${escapeHtml(patient.gestational_age_label || "")}" placeholder="Estagio gestacional" />
            <input name="dum" type="date" value="${escapeHtml(patient.dum || "")}" />
            <input name="dpp" type="date" value="${escapeHtml(patient.dpp || "")}" />
            <input name="next_scheduled_visit" type="date" value="${escapeHtml(patient.next_scheduled_visit || "")}" />
            <input name="actual_birth_date" type="date" value="${escapeHtml(patient.actual_birth_date || "")}" />
            <input name="weight_kg" type="number" step="0.1" value="${escapeHtml(patient.weight_kg || "")}" placeholder="Peso (kg)" />
            <input name="height_cm" type="number" step="0.1" value="${escapeHtml(patient.height_cm || "")}" placeholder="Estatura (cm)" />
            <input name="bmi" type="number" step="0.1" value="${escapeHtml(patient.bmi || "")}" placeholder="IMC" />
            <input name="weight_gain_kg" type="number" step="0.1" value="${escapeHtml(patient.weight_gain_kg || "")}" placeholder="Ganho ponderal" />
            <input name="systolic_bp" type="number" value="${escapeHtml(patient.systolic_bp || "")}" placeholder="PAS" />
            <input name="diastolic_bp" type="number" value="${escapeHtml(patient.diastolic_bp || "")}" placeholder="PAD" />
            <input name="capillary_glucose" type="number" step="0.1" value="${escapeHtml(patient.capillary_glucose || "")}" placeholder="Glicemia capilar" />
            <input name="fetal_heartbeat" value="${escapeHtml(patient.fetal_heartbeat || "")}" placeholder="BCF" />
            <input name="uterine_height_cm" type="number" step="0.1" value="${escapeHtml(patient.uterine_height_cm || "")}" placeholder="Altura uterina (cm)" />
            <input name="first_trimester_ultrasound_weeks" type="number" step="0.1" value="${escapeHtml(patient.first_trimester_ultrasound_weeks || "")}" placeholder="IG por USG 1o tri" />
            <input name="vaccination_status" value="${escapeHtml(patient.vaccination_status || "")}" placeholder="Vacinacao" />
            <input name="rapid_tests_status" value="${escapeHtml(patient.rapid_tests_status || "")}" placeholder="Testes rapidos" />
            <input name="trimester_exams_status" value="${escapeHtml(patient.trimester_exams_status || "")}" placeholder="Exames do trimestre" />
            <input name="dental_evaluation_status" value="${escapeHtml(patient.dental_evaluation_status || "")}" placeholder="Avaliacao odontologica" />
            <input class="wide" name="maternity_reference" value="${escapeHtml(patient.maternity_reference || "")}" placeholder="Maternidade" />
            <input name="last_professional" value="${escapeHtml(patient.last_professional || "")}" placeholder="Profissional" />
            <input name="risk_factor_1" value="${escapeHtml(patient.risk_factor_1 || "")}" placeholder="Fator de risco 1" />
            <input name="risk_factor_2" value="${escapeHtml(patient.risk_factor_2 || "")}" placeholder="Fator de risco 2" />
            <input name="risk_factor_3" value="${escapeHtml(patient.risk_factor_3 || "")}" placeholder="Fator de risco 3" />
            <input name="hypertensive_disease_status" value="${escapeHtml(patient.hypertensive_disease_status || "")}" placeholder="Doenca hipertensiva" />
            <input name="preeclampsia_risk_factors" value="${escapeHtml(patient.preeclampsia_risk_factors || "")}" placeholder="Risco pre-eclampsia" />
            <input name="preeclampsia_prophylaxis" value="${escapeHtml(patient.preeclampsia_prophylaxis || "")}" placeholder="Profilaxia pre-eclampsia" />
            <input name="uti_status" value="${escapeHtml(patient.uti_status || "")}" placeholder="ITU diagnostico" />
            <input name="uti_treatment" value="${escapeHtml(patient.uti_treatment || "")}" placeholder="ITU tratamento" />
            <input name="uti_cure_control" value="${escapeHtml(patient.uti_cure_control || "")}" placeholder="ITU controle de cura" />
            <input name="gestational_diabetes_status" value="${escapeHtml(patient.gestational_diabetes_status || "")}" placeholder="Diabetes gestacional" />
            <input name="medications_in_use" value="${escapeHtml(patient.medications_in_use || "")}" placeholder="Medicacoes em uso" />
            <input name="urgent_care_last_year" type="number" value="${escapeHtml(patient.urgent_care_last_year || "")}" placeholder="Urgencia no ultimo ano" />
            <input name="hospitalizations_last_year" type="number" value="${escapeHtml(patient.hospitalizations_last_year || "")}" placeholder="Internacoes no ultimo ano" />
            <input name="reproductive_planning_status" value="${escapeHtml(patient.reproductive_planning_status || "")}" placeholder="Planejamento reprodutivo" />
            <input name="active_search_reason" value="${escapeHtml(patient.active_search_reason || "")}" placeholder="Motivo da busca ativa" />
            <input name="outcome" value="${escapeHtml(patient.outcome || "")}" placeholder="Desfecho" />
            <input name="delivery_type" value="${escapeHtml(patient.delivery_type || "")}" placeholder="Tipo de parto" />
            <input name="discharge_date" type="date" value="${escapeHtml(patient.discharge_date || "")}" />
            <input name="delivery_intercurrences" value="${escapeHtml(patient.delivery_intercurrences || "")}" placeholder="Intercorrencias do parto" />
            <input name="breastfeeding_status" value="${escapeHtml(patient.breastfeeding_status || "")}" placeholder="Aleitamento materno" />
            <input name="postpartum_reproductive_planning" value="${escapeHtml(patient.postpartum_reproductive_planning || "")}" placeholder="Planejamento pos-parto" />
            <label class="check-item">
              <input name="high_risk_shared_care" type="checkbox" ${patient.high_risk_shared_care ? "checked" : ""} />
              <span>Alto risco compartilhado</span>
            </label>
            <label class="check-item">
              <input name="active_search" type="checkbox" ${patient.active_search ? "checked" : ""} />
              <span>Busca ativa</span>
            </label>
            <label class="check-item">
              <input name="pregnancy_booklet_updated" type="checkbox" ${patient.pregnancy_booklet_updated ? "checked" : ""} />
              <span>Caderneta atualizada</span>
            </label>
            <label class="check-item">
              <input name="care_plan_defined" type="checkbox" ${patient.care_plan_defined ? "checked" : ""} />
              <span>Plano de cuidados elaborado</span>
            </label>
            <label class="check-item">
              <input name="care_plan_monitored" type="checkbox" ${patient.care_plan_monitored ? "checked" : ""} />
              <span>Plano de cuidados monitorado</span>
            </label>
            <label class="check-item">
              <input name="shared_care" type="checkbox" ${patient.shared_care ? "checked" : ""} />
              <span>Cuidado compartilhado</span>
            </label>
            <label class="check-item">
              <input name="maternity_linked" type="checkbox" ${patient.maternity_linked ? "checked" : ""} />
              <span>Maternidade vinculada</span>
            </label>
            <label class="check-item">
              <input name="maternity_risk_updated" type="checkbox" ${patient.maternity_risk_updated ? "checked" : ""} />
              <span>Maternidade atualizada pelo risco</span>
            </label>
            <label class="check-item">
              <input name="postpartum_home_visit_7d" type="checkbox" ${patient.postpartum_home_visit_7d ? "checked" : ""} />
              <span>Visita puerperal ate 7 dias</span>
            </label>
            <label class="check-item">
              <input name="postpartum_consult_7d" type="checkbox" ${patient.postpartum_consult_7d ? "checked" : ""} />
              <span>Consulta puerperal ate 7 dias</span>
            </label>
            <label class="check-item">
              <input name="postpartum_consult_42d" type="checkbox" ${patient.postpartum_consult_42d ? "checked" : ""} />
              <span>Consulta ate 42 dias</span>
            </label>
            <label class="check-item">
              <input name="postpartum_consult_after_42d" type="checkbox" ${patient.postpartum_consult_after_42d ? "checked" : ""} />
              <span>Consulta apos 42 dias</span>
            </label>
            <textarea class="wide" name="notes" rows="4" placeholder="Observações">${escapeHtml(patient.notes || "")}</textarea>
            <textarea class="wide" name="postpartum_intercurrences" rows="3" placeholder="Intercorrencias do puerperio">${escapeHtml(patient.postpartum_intercurrences || "")}</textarea>
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
    state.bootstrap = { ...DEFAULT_BOOTSTRAP };
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
  setAuthFeedback("");
  const payload = formToJson(event.currentTarget);
  setFormBusy(event.currentTarget, true, "Criando...");
  try {
    await apiJson("/api/setup", { method: "POST", body: payload });
    event.currentTarget.reset();
    await refreshBootstrap();
    toast("Administrador criado.");
  } catch (error) {
    setAuthFeedback(error.message || "Nao foi possivel criar o acesso.", "error");
  } finally {
    setFormBusy(event.currentTarget, false, "Criando...");
  }
});

refs.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthFeedback("");
  const payload = formToJson(event.currentTarget);
  setFormBusy(event.currentTarget, true, "Entrando...");
  try {
    await apiJson("/api/auth/login", { method: "POST", body: payload });
    event.currentTarget.reset();
    await refreshBootstrap();
    toast("Acesso liberado.");
  } catch (error) {
    setAuthFeedback(error.message || "Nao foi possivel entrar.", "error");
  } finally {
    setFormBusy(event.currentTarget, false, "Entrando...");
  }
});

refs.logoutButton.addEventListener("click", async () => {
  try {
    await apiJson("/api/auth/logout", { method: "POST" });
    state.bootstrap = { ...DEFAULT_BOOTSTRAP };
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

refs.setupForm.addEventListener("input", () => setAuthFeedback(""));
refs.loginForm.addEventListener("input", () => setAuthFeedback(""));

try {
  await refreshBootstrap();
} catch (error) {
  state.bootstrap = { ...DEFAULT_BOOTSTRAP };
  renderAuthState();
  setAuthFeedback("Nao foi possivel conectar ao sistema agora.", "error");
}
