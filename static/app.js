const STORAGE_KEY = "organizaaps-data-v1";
const SEQ_KEY = "organizaaps-seq-v1";

const EVENT_LABELS = {
  prenatal_consult: "Consulta de pre-natal",
  puerperal_consult: "Consulta puerperal",
  blood_pressure: "Afericao de pressao arterial",
  anthropometry: "Peso e altura",
  pregnancy_home_visit: "Visita domiciliar na gestacao",
  puerperal_home_visit: "Visita domiciliar no puerperio",
  dtpa_vaccine: "Vacina dTpa",
  first_trimester_tests: "Testes do 1o trimestre",
  third_trimester_tests: "Testes do 3o trimestre",
  dental_visit: "Atividade de saude bucal",
  delivery: "Parto registrado",
};

const INDICATOR_DEFINITIONS = [
  ["A", "Captacao ate 12 semanas", 10, 1, "Primeira consulta ate 12 semanas."],
  ["B", "Sete consultas de pre-natal", 9, 7, "Pelo menos 7 consultas."],
  ["C", "Sete afericoes de PA", 9, 7, "Pelo menos 7 afericoes de pressao arterial."],
  ["D", "Sete registros de peso e altura", 9, 7, "Pelo menos 7 registros de peso e altura."],
  ["E", "Tres visitas ACS na gestacao", 9, 3, "Pelo menos 3 visitas domiciliares."],
  ["F", "dTpa apos 20 semanas", 9, 1, "Vacina dTpa a partir da 20a semana."],
  ["G", "Testes do 1o trimestre", 9, 1, "Testes do primeiro trimestre."],
  ["H", "Testes do 3o trimestre", 9, 1, "Testes do terceiro trimestre."],
  ["I", "Consulta puerperal", 9, 1, "Pelo menos uma consulta puerperal."],
  ["J", "Visita puerperal ACS", 9, 1, "Pelo menos uma visita no puerperio."],
  ["K", "Saude bucal na gestacao", 9, 1, "Pelo menos um registro de saude bucal."],
].map(([code, title, weight, target, description]) => ({ code, title, weight, target, description }));

const state = {
  selectedId: null,
  dashboard: null,
  patients: [],
};

const refs = {
  statsGrid: document.getElementById("statsGrid"),
  priorityList: document.getElementById("priorityList"),
  coverageList: document.getElementById("coverageList"),
  patientsList: document.getElementById("patientsList"),
  patientDetail: document.getElementById("patientDetail"),
  patientEmpty: document.getElementById("patientEmpty"),
  patientCountLabel: document.getElementById("patientCountLabel"),
  filtersForm: document.getElementById("filtersForm"),
  newPatientForm: document.getElementById("newPatientForm"),
  refreshButton: document.getElementById("refreshButton"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(`${value}T00:00:00`));
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
  setTimeout(() => node.remove(), 2400);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoToDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffDays(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

function coerceInt(value) {
  if (value === "" || value == null) return null;
  const num = Number.parseInt(value, 10);
  return Number.isNaN(num) ? null : num;
}

function normalizeRisk(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("alto")) return "Alto risco";
  if (text.includes("inter")) return "Risco intermediario";
  if (text.includes("baixo")) return "Baixo risco";
  return "Sem classificacao";
}

function normalizeStatus(value) {
  const text = String(value || "gestante").trim().toLowerCase();
  if (text === "puerpera" || text === "encerrado") return text;
  return "gestante";
}

function coerceBool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "sim", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function nextId() {
  const current = Number.parseInt(localStorage.getItem(SEQ_KEY) || "1", 10);
  localStorage.setItem(SEQ_KEY, String(current + 1));
  return current;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { patients: [], events: [] };
  } catch {
    return { patients: [], events: [] };
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function stageLabel(patient) {
  const status = normalizeStatus(patient.status);
  const weeks = patient.gestational_weeks;
  if (status === "puerpera") return "Puerperio";
  if (status === "encerrado") return "Acompanhamento encerrado";
  if (weeks == null) return patient.gestational_age_label || "Gestacao sem IG definida";
  if (weeks <= 13) return `${weeks} semanas - 1o trimestre`;
  if (weeks <= 27) return `${weeks} semanas - 2o trimestre`;
  return `${weeks} semanas - 3o trimestre`;
}

function recommendedIntervalDays(weeks, status) {
  if (status === "puerpera") return 7;
  if (weeks == null) return 30;
  if (weeks <= 28) return 30;
  if (weeks <= 36) return 14;
  return 7;
}

function countEvents(events, type) {
  return events.filter((event) => event.event_type === type).length;
}

function earliestEventDate(events, type) {
  const values = events
    .filter((event) => event.event_type === type)
    .map((event) => isoToDate(event.event_date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  return values[0] || null;
}

function latestEventDate(events, type) {
  const values = events
    .filter((event) => event.event_type === type)
    .map((event) => isoToDate(event.event_date))
    .filter(Boolean)
    .sort((a, b) => b - a);
  return values[0] || null;
}

function computeIndicatorResults(patient, events) {
  const status = normalizeStatus(patient.status);
  const weeks = patient.gestational_weeks;
  const dum = isoToDate(patient.dum);
  const birthDate = isoToDate(patient.actual_birth_date) || latestEventDate(events, "delivery");
  const firstConsult = earliestEventDate(events, "prenatal_consult");
  const prenatalConsults = countEvents(events, "prenatal_consult");
  const bloodPressure = countEvents(events, "blood_pressure");
  const anthropometry = countEvents(events, "anthropometry");
  const pregnancyVisits = countEvents(events, "pregnancy_home_visit");
  const hasDtpa = countEvents(events, "dtpa_vaccine") > 0;
  const hasT1Tests = countEvents(events, "first_trimester_tests") > 0;
  const hasT3Tests = countEvents(events, "third_trimester_tests") > 0;
  const puerperalConsults = countEvents(events, "puerperal_consult");
  const puerperalVisits = countEvents(events, "puerperal_home_visit");
  const dentalVisits = countEvents(events, "dental_visit");

  return INDICATOR_DEFINITIONS.map((definition) => {
    let state = "pending";
    let count = 0;

    if (definition.code === "A") {
      count = firstConsult ? 1 : 0;
      if (firstConsult && dum) {
        const limit = new Date(dum.getTime() + 84 * 86400000);
        state = firstConsult <= limit ? "completed" : "pending";
      }
    } else if (definition.code === "B") {
      count = prenatalConsults;
      state = count >= definition.target ? "completed" : "pending";
    } else if (definition.code === "C") {
      count = bloodPressure;
      state = count >= definition.target ? "completed" : "pending";
    } else if (definition.code === "D") {
      count = anthropometry;
      state = count >= definition.target ? "completed" : "pending";
    } else if (definition.code === "E") {
      count = pregnancyVisits;
      state = count >= definition.target ? "completed" : "pending";
    } else if (definition.code === "F") {
      count = hasDtpa ? 1 : 0;
      state = hasDtpa ? "completed" : weeks != null && weeks < 20 && status === "gestante" ? "upcoming" : "pending";
    } else if (definition.code === "G") {
      count = hasT1Tests ? 1 : 0;
      state = hasT1Tests ? "completed" : "pending";
    } else if (definition.code === "H") {
      count = hasT3Tests ? 1 : 0;
      state = hasT3Tests ? "completed" : weeks != null && weeks < 28 && status === "gestante" ? "upcoming" : "pending";
    } else if (definition.code === "I") {
      count = puerperalConsults;
      state = count >= definition.target ? "completed" : status === "gestante" && !birthDate ? "upcoming" : "pending";
    } else if (definition.code === "J") {
      count = puerperalVisits;
      state = count >= definition.target ? "completed" : status === "gestante" && !birthDate ? "upcoming" : "pending";
    } else if (definition.code === "K") {
      count = dentalVisits;
      state = count >= definition.target ? "completed" : "pending";
    }

    return { ...definition, count, state };
  });
}

function buildPriorities(patient, events, indicators) {
  const today = isoToDate(todayIso());
  const status = normalizeStatus(patient.status);
  const weeks = patient.gestational_weeks;
  const lastConsult = latestEventDate(events, "prenatal_consult") || isoToDate(patient.last_consultation_date);
  const priorities = [];

  if (lastConsult) {
    const daysSince = diffDays(today, lastConsult);
    const allowed = recommendedIntervalDays(weeks, status);
    if (["gestante", "puerpera"].includes(status) && daysSince > allowed) {
      priorities.push({
        level: daysSince > allowed + 7 ? "alta" : "media",
        title: "Consulta em atraso",
        detail: `Ultimo atendimento ha ${daysSince} dias. Intervalo sugerido: ${allowed} dias.`,
      });
    }
  } else if (["gestante", "puerpera"].includes(status)) {
    priorities.push({
      level: "alta",
      title: "Sem consulta registrada",
      detail: "Nao existe atendimento registrado.",
    });
  }

  indicators.forEach((indicator) => {
    if (indicator.state !== "pending") return;
    let level = "baixa";
    if (["F", "G", "H", "I", "J"].includes(indicator.code)) level = "alta";
    else if (["B", "C", "D", "K"].includes(indicator.code)) level = "media";
    priorities.push({ level, title: `Pendencia ${indicator.code}`, detail: indicator.title });
  });

  if (String(patient.risk_level || "").toLowerCase() === "alto risco" && !patient.high_risk_shared_care) {
    priorities.push({
      level: "alta",
      title: "Alto risco sem cuidado compartilhado",
      detail: "Marque o cuidado compartilhado.",
    });
  }

  const birthDate = isoToDate(patient.actual_birth_date) || latestEventDate(events, "delivery");
  if (birthDate) {
    const postpartumDays = diffDays(today, birthDate);
    if (postpartumDays >= 0 && postpartumDays <= 42) {
      if (!indicators.some((item) => item.code === "I" && item.state === "completed")) {
        priorities.push({
          level: postpartumDays > 20 ? "alta" : "media",
          title: "Consulta puerperal pendente",
          detail: `Ja se passaram ${postpartumDays} dias do parto.`,
        });
      }
      if (!indicators.some((item) => item.code === "J" && item.state === "completed")) {
        priorities.push({
          level: "media",
          title: "Visita puerperal pendente",
          detail: "Registre ao menos uma visita no puerperio.",
        });
      }
    }
  }

  priorities.sort((a, b) => ({ alta: 0, media: 1, baixa: 2 }[a.level] - { alta: 0, media: 1, baixa: 2 }[b.level]));
  return priorities.slice(0, 6);
}

function summarizePatient(patient, events) {
  const today = isoToDate(todayIso());
  const indicators = computeIndicatorResults(patient, events);
  const completedWeight = indicators.filter((item) => item.state === "completed").reduce((sum, item) => sum + item.weight, 0);
  const activeWeight = indicators.filter((item) => item.state !== "upcoming").reduce((sum, item) => sum + item.weight, 0) || 100;
  const priorities = buildPriorities(patient, events, indicators);
  const lastConsult =
    latestEventDate(events, "prenatal_consult") ||
    latestEventDate(events, "puerperal_consult") ||
    isoToDate(patient.last_consultation_date);

  return {
    stage_label: stageLabel(patient),
    indicator_results: indicators,
    journey_score: Number(((completedWeight / 100) * 100).toFixed(1)),
    current_score: Number(((completedWeight / activeWeight) * 100).toFixed(1)),
    priorities,
    days_since_last_consult: lastConsult ? diffDays(today, lastConsult) : null,
  };
}

function patientEvents(patientId) {
  return loadStore().events
    .filter((event) => event.patient_id === patientId)
    .sort((a, b) => `${b.event_date}-${b.id}`.localeCompare(`${a.event_date}-${a.id}`));
}

function listPatients(filters = {}) {
  const store = loadStore();
  let patients = [...store.patients];
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    patients = patients.filter((patient) =>
      [patient.name, patient.locality, patient.notes].some((value) => String(value || "").toLowerCase().includes(needle))
    );
  }
  if (filters.risk && filters.risk !== "all") {
    patients = patients.filter((patient) => patient.risk_level === normalizeRisk(filters.risk));
  }
  if (filters.status && filters.status !== "all") {
    patients = patients.filter((patient) => patient.status === normalizeStatus(filters.status));
  }

  return patients
    .map((patient) => {
      const summary = summarizePatient(patient, patientEvents(patient.id));
      return { ...patient, ...summary };
    })
    .sort((a, b) => {
      const weight = { "Alto risco": 0, "Risco intermediario": 1, "Baixo risco": 2, "Sem classificacao": 3 };
      return (weight[a.risk_level] ?? 9) - (weight[b.risk_level] ?? 9) || a.name.localeCompare(b.name, "pt-BR");
    });
}

function getPatient(patientId) {
  const patient = loadStore().patients.find((item) => item.id === patientId);
  if (!patient) return null;
  const events = patientEvents(patientId).map((event) => ({
    ...event,
    label: EVENT_LABELS[event.event_type] || event.event_type,
  }));
  return { ...patient, ...summarizePatient(patient, events), events };
}

function dashboardPayload(filters = {}) {
  const patients = listPatients(filters);
  const coverage = Object.fromEntries(
    INDICATOR_DEFINITIONS.map((definition) => [definition.code, { done: 0, total: 0, title: definition.title }])
  );
  const priorities = [];

  patients.forEach((patient) => {
    patient.priorities.forEach((item) => priorities.push({ ...item, patient_id: patient.id, patient_name: patient.name }));
    patient.indicator_results.forEach((indicator) => {
      if (indicator.state !== "upcoming") coverage[indicator.code].total += 1;
      if (indicator.state === "completed") coverage[indicator.code].done += 1;
    });
  });

  priorities.sort((a, b) => ({ alta: 0, media: 1, baixa: 2 }[a.level] - { alta: 0, media: 1, baixa: 2 }[b.level]));

  return {
    stats: {
      total_active: patients.length,
      high_risk: patients.filter((patient) => patient.risk_level === "Alto risco").length,
      puerperas: patients.filter((patient) => patient.status === "puerpera").length,
      average_journey_score: patients.length
        ? Number((patients.reduce((sum, patient) => sum + patient.journey_score, 0) / patients.length).toFixed(1))
        : 0,
      overdue_follow_ups: patients.filter((patient) => patient.days_since_last_consult != null && patient.days_since_last_consult > 30).length,
    },
    patients,
    priorities: priorities.slice(0, 10),
    coverage: Object.values(coverage),
  };
}

function createPatient(payload) {
  const store = loadStore();
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Nome obrigatorio.");
  const id = nextId();
  store.patients.push({
    id,
    name,
    locality: String(payload.locality || "").trim() || null,
    risk_level: normalizeRisk(payload.risk_level),
    status: normalizeStatus(payload.status),
    gestational_weeks: coerceInt(payload.gestational_weeks),
    gestational_age_label: null,
    dum: payload.dum || null,
    dpp: payload.dpp || null,
    actual_birth_date: null,
    last_consultation_date: null,
    last_professional: null,
    maternity_reference: String(payload.maternity_reference || "").trim() || null,
    high_risk_shared_care: false,
    active_search: false,
    notes: String(payload.notes || "").trim() || null,
  });
  saveStore(store);
  return id;
}

function updatePatient(patientId, payload) {
  const store = loadStore();
  const patient = store.patients.find((item) => item.id === patientId);
  if (!patient) throw new Error("Paciente nao encontrada.");
  Object.assign(patient, {
    name: payload.name !== undefined ? String(payload.name || "").trim() || patient.name : patient.name,
    locality: payload.locality !== undefined ? String(payload.locality || "").trim() || null : patient.locality,
    risk_level: payload.risk_level !== undefined ? normalizeRisk(payload.risk_level) : patient.risk_level,
    status: payload.status !== undefined ? normalizeStatus(payload.status) : patient.status,
    gestational_weeks: payload.gestational_weeks !== undefined ? coerceInt(payload.gestational_weeks) : patient.gestational_weeks,
    dum: payload.dum !== undefined ? payload.dum || null : patient.dum,
    dpp: payload.dpp !== undefined ? payload.dpp || null : patient.dpp,
    actual_birth_date: payload.actual_birth_date !== undefined ? payload.actual_birth_date || null : patient.actual_birth_date,
    last_consultation_date: payload.last_consultation_date !== undefined ? payload.last_consultation_date || null : patient.last_consultation_date,
    last_professional: payload.last_professional !== undefined ? String(payload.last_professional || "").trim() || null : patient.last_professional,
    maternity_reference:
      payload.maternity_reference !== undefined ? String(payload.maternity_reference || "").trim() || null : patient.maternity_reference,
    high_risk_shared_care:
      payload.high_risk_shared_care !== undefined ? coerceBool(payload.high_risk_shared_care) : patient.high_risk_shared_care,
    active_search: payload.active_search !== undefined ? coerceBool(payload.active_search) : patient.active_search,
    notes: payload.notes !== undefined ? String(payload.notes || "").trim() || null : patient.notes,
  });
  saveStore(store);
}

function registerQuickUpdate(patientId, payload) {
  const store = loadStore();
  const patient = store.patients.find((item) => item.id === patientId);
  if (!patient) throw new Error("Paciente nao encontrada.");
  if (!payload.event_date) throw new Error("Data obrigatoria.");

  const professional = String(payload.professional || "").trim() || null;
  const notes = String(payload.notes || "").trim() || null;

  [
    "prenatal_consult",
    "puerperal_consult",
    "blood_pressure",
    "anthropometry",
    "pregnancy_home_visit",
    "puerperal_home_visit",
    "dtpa_vaccine",
    "first_trimester_tests",
    "third_trimester_tests",
    "dental_visit",
    "delivery",
  ].forEach((eventType) => {
    if (!coerceBool(payload[eventType])) return;
    store.events.push({
      id: nextId(),
      patient_id: patientId,
      event_type: eventType,
      event_date: payload.event_date,
      professional,
      notes,
    });
  });

  updatePatient(patientId, {
    risk_level: payload.risk_level,
    status: payload.status,
    gestational_weeks: payload.gestational_weeks,
    actual_birth_date: coerceBool(payload.delivery) ? payload.event_date : payload.actual_birth_date,
    last_professional: professional,
    last_consultation_date:
      coerceBool(payload.prenatal_consult) || coerceBool(payload.puerperal_consult) ? payload.event_date : patient.last_consultation_date,
    notes: notes || patient.notes,
  });
  saveStore(store);
}

function currentFilters() {
  const data = new FormData(refs.filtersForm);
  return {
    search: data.get("search") || "",
    risk: data.get("risk") || "all",
    status: data.get("status") || "all",
  };
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
    ["Puerperas", stats.puerperas],
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
    refs.patientsList.innerHTML = `<p class="hint">Nenhuma usuaria.</p>`;
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
            <span class="pill pill-risk">${escapeHtml(patient.risk_level || "Sem classificacao")}</span>
            <span class="pill pill-status">${escapeHtml(patient.status || "gestante")}</span>
          </div>
          <p class="patient-meta">${escapeHtml(patient.stage_label || "Sem fase")} · ${patient.days_since_last_consult != null ? `${patient.days_since_last_consult}d` : "sem consulta"}</p>
        </article>
      `
    )
    .join("");
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
    : `<p class="hint">Sem pendencias.</p>`;

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
    : `<p class="hint">Sem historico.</p>`;

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
          <span class="pill pill-risk">${escapeHtml(patient.risk_level || "Sem classificacao")}</span>
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
              <option value="puerpera" ${patient.status === "puerpera" ? "selected" : ""}>Puerpera</option>
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
            <textarea class="wide" name="notes" rows="4" placeholder="Observacoes">${escapeHtml(patient.notes || "")}</textarea>
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
              <option value="puerpera" ${patient.status === "puerpera" ? "selected" : ""}>Puerpera</option>
            </select>
            <input name="gestational_weeks" type="number" min="1" max="45" value="${escapeHtml(patient.gestational_weeks || "")}" placeholder="IG semanas" />
            <input name="actual_birth_date" type="date" value="${escapeHtml(patient.actual_birth_date || "")}" />
            <div class="checkbox-grid wide">
              ${[
                ["prenatal_consult", "Consulta pre-natal"],
                ["puerperal_consult", "Consulta puerperal"],
                ["blood_pressure", "PA"],
                ["anthropometry", "Peso e altura"],
                ["pregnancy_home_visit", "Visita gestacao"],
                ["puerperal_home_visit", "Visita puerperio"],
                ["dtpa_vaccine", "dTpa"],
                ["first_trimester_tests", "Testes 1o tri"],
                ["third_trimester_tests", "Testes 3o tri"],
                ["dental_visit", "Saude bucal"],
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
            <textarea class="wide" name="notes" rows="4" placeholder="Observacoes"></textarea>
            <div class="wide form-actions"><button class="primary-button" type="submit">Registrar</button></div>
          </form>
        </section>
      </div>

      <section class="detail-card">
        <div class="section-head"><h2>Historico</h2></div>
        <div class="timeline">${timeline}</div>
      </section>
    </div>
  `;
}

function loadDashboardAndPatients() {
  state.dashboard = dashboardPayload(currentFilters());
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

  if (state.selectedId) renderDetail(getPatient(state.selectedId));
  else renderDetail(null);
}

refs.filtersForm.addEventListener("input", () => loadDashboardAndPatients());
refs.refreshButton.addEventListener("click", () => loadDashboardAndPatients());

refs.patientsList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-patient-id]");
  if (!card) return;
  state.selectedId = Number(card.dataset.patientId);
  renderPatients();
  renderDetail(getPatient(state.selectedId));
});

refs.newPatientForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const id = createPatient(formToJson(event.currentTarget));
    event.currentTarget.reset();
    state.selectedId = id;
    loadDashboardAndPatients();
    toast("Cadastrado.");
  } catch (error) {
    toast(error.message);
  }
});

refs.patientDetail.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const patientId = Number(form.dataset.patientId);
  if (!patientId) return;
  try {
    if (form.id === "profileForm") {
      updatePatient(patientId, formToJson(form));
      toast("Salvo.");
    } else {
      registerQuickUpdate(patientId, formToJson(form));
      toast("Registrado.");
    }
    loadDashboardAndPatients();
    renderDetail(getPatient(patientId));
  } catch (error) {
    toast(error.message);
  }
});

loadDashboardAndPatients();
