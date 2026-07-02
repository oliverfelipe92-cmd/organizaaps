from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any


EVENT_LABELS = {
    "prenatal_consult": "Consulta de pre-natal",
    "puerperal_consult": "Consulta puerperal",
    "blood_pressure": "Afericao de pressao arterial",
    "anthropometry": "Peso e altura",
    "pregnancy_home_visit": "Visita domiciliar na gestacao",
    "puerperal_home_visit": "Visita domiciliar no puerperio",
    "dtpa_vaccine": "Vacina dTpa",
    "first_trimester_tests": "Testes do 1o trimestre",
    "third_trimester_tests": "Testes do 3o trimestre",
    "dental_visit": "Atividade em saude bucal",
    "delivery": "Parto registrado",
}


@dataclass(frozen=True)
class IndicatorDefinition:
    code: str
    title: str
    weight: int
    target: int
    description: str


INDICATOR_DEFINITIONS = [
    IndicatorDefinition(
        code="A",
        title="Captação até 12 semanas",
        weight=10,
        target=1,
        description="Primeira consulta de pre-natal realizada por medico ou enfermeiro ate a 12a semana.",
    ),
    IndicatorDefinition(
        code="B",
        title="Sete consultas de pre-natal",
        weight=9,
        target=7,
        description="Pelo menos 7 consultas de pre-natal registradas durante a gestacao.",
    ),
    IndicatorDefinition(
        code="C",
        title="Sete afericoes de PA",
        weight=9,
        target=7,
        description="Pelo menos 7 afericoes de pressao arterial registradas durante a gestacao.",
    ),
    IndicatorDefinition(
        code="D",
        title="Sete registros de peso e altura",
        weight=9,
        target=7,
        description="Pelo menos 7 registros simultaneos de peso e altura durante a gestacao.",
    ),
    IndicatorDefinition(
        code="E",
        title="Tres visitas ACS na gestacao",
        weight=9,
        target=3,
        description="Pelo menos 3 visitas domiciliares ACS/TACS apos a primeira consulta do pre-natal.",
    ),
    IndicatorDefinition(
        code="F",
        title="dTpa apos 20 semanas",
        weight=9,
        target=1,
        description="Vacina dTpa registrada a partir da 20a semana de cada gestacao.",
    ),
    IndicatorDefinition(
        code="G",
        title="Testes do 1o trimestre",
        weight=9,
        target=1,
        description="Testes ou exames para sifilis, HIV e hepatites B e C no primeiro trimestre.",
    ),
    IndicatorDefinition(
        code="H",
        title="Testes do 3o trimestre",
        weight=9,
        target=1,
        description="Testes ou exames para sifilis e HIV no terceiro trimestre.",
    ),
    IndicatorDefinition(
        code="I",
        title="Consulta puerperal",
        weight=9,
        target=1,
        description="Pelo menos uma consulta puerperal ate 42 dias apos o parto.",
    ),
    IndicatorDefinition(
        code="J",
        title="Visita puerperal ACS",
        weight=9,
        target=1,
        description="Pelo menos uma visita domiciliar ACS/TACS durante o puerperio.",
    ),
    IndicatorDefinition(
        code="K",
        title="Saude bucal na gestacao",
        weight=9,
        target=1,
        description="Pelo menos uma atividade de saude bucal durante a gestacao.",
    ),
]


def iso_to_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def stage_label(patient: dict[str, Any]) -> str:
    status = (patient.get("status") or "gestante").lower()
    weeks = patient.get("gestational_weeks")
    if status == "puerpera":
        return "Puerperio"
    if status == "encerrado":
        return "Acompanhamento encerrado"
    if weeks is None:
        return patient.get("gestational_age_label") or "Gestacao sem IG definida"
    if weeks <= 13:
        return f"{weeks} semanas - 1o trimestre"
    if weeks <= 27:
        return f"{weeks} semanas - 2o trimestre"
    return f"{weeks} semanas - 3o trimestre"


def recommended_interval_days(gestational_weeks: int | None, status: str) -> int:
    if status == "puerpera":
        return 7
    if gestational_weeks is None:
        return 30
    if gestational_weeks <= 28:
        return 30
    if gestational_weeks <= 36:
        return 14
    return 7


def count_events(events: list[dict[str, Any]], event_type: str) -> int:
    return sum(1 for event in events if event["event_type"] == event_type)


def earliest_event_date(events: list[dict[str, Any]], event_type: str) -> date | None:
    values = [
        iso_to_date(event["event_date"])
        for event in events
        if event["event_type"] == event_type and iso_to_date(event["event_date"])
    ]
    return min(values) if values else None


def latest_event_date(events: list[dict[str, Any]], event_type: str) -> date | None:
    values = [
        iso_to_date(event["event_date"])
        for event in events
        if event["event_type"] == event_type and iso_to_date(event["event_date"])
    ]
    return max(values) if values else None


def compute_indicator_results(patient: dict[str, Any], events: list[dict[str, Any]], today: date | None = None) -> list[dict[str, Any]]:
    today = today or date.today()
    status = (patient.get("status") or "gestante").lower()
    weeks = patient.get("gestational_weeks")
    dum = iso_to_date(patient.get("dum"))
    birth_date = iso_to_date(patient.get("actual_birth_date")) or latest_event_date(events, "delivery")
    results: list[dict[str, Any]] = []

    first_consult = earliest_event_date(events, "prenatal_consult")
    prenatal_consults = count_events(events, "prenatal_consult")
    blood_pressure = count_events(events, "blood_pressure")
    anthropometry = count_events(events, "anthropometry")
    pregnancy_visits = count_events(events, "pregnancy_home_visit")
    has_dtpa = count_events(events, "dtpa_vaccine") > 0
    has_t1_tests = count_events(events, "first_trimester_tests") > 0
    has_t3_tests = count_events(events, "third_trimester_tests") > 0
    puerperal_consults = count_events(events, "puerperal_consult")
    puerperal_visits = count_events(events, "puerperal_home_visit")
    dental_visits = count_events(events, "dental_visit")

    for definition in INDICATOR_DEFINITIONS:
        state = "pending"
        count = 0

        if definition.code == "A":
            count = 1 if first_consult else 0
            if first_consult and dum and first_consult <= dum + timedelta(weeks=12):
                state = "completed"
            elif status == "puerpera" and first_consult and dum and first_consult > dum + timedelta(weeks=12):
                state = "pending"
            elif not first_consult:
                state = "pending"
        elif definition.code == "B":
            count = prenatal_consults
            state = "completed" if count >= definition.target else "pending"
        elif definition.code == "C":
            count = blood_pressure
            state = "completed" if count >= definition.target else "pending"
        elif definition.code == "D":
            count = anthropometry
            state = "completed" if count >= definition.target else "pending"
        elif definition.code == "E":
            count = pregnancy_visits
            state = "completed" if count >= definition.target else "pending"
        elif definition.code == "F":
            count = 1 if has_dtpa else 0
            if has_dtpa:
                state = "completed"
            elif weeks is not None and weeks < 20 and status == "gestante":
                state = "upcoming"
            else:
                state = "pending"
        elif definition.code == "G":
            count = 1 if has_t1_tests else 0
            if has_t1_tests:
                state = "completed"
            else:
                state = "pending"
        elif definition.code == "H":
            count = 1 if has_t3_tests else 0
            if has_t3_tests:
                state = "completed"
            elif weeks is not None and weeks < 28 and status == "gestante":
                state = "upcoming"
            else:
                state = "pending"
        elif definition.code == "I":
            count = puerperal_consults
            if count >= definition.target:
                state = "completed"
            elif status == "gestante" and not birth_date:
                state = "upcoming"
            else:
                state = "pending"
        elif definition.code == "J":
            count = puerperal_visits
            if count >= definition.target:
                state = "completed"
            elif status == "gestante" and not birth_date:
                state = "upcoming"
            else:
                state = "pending"
        elif definition.code == "K":
            count = dental_visits
            state = "completed" if count >= definition.target else "pending"

        results.append(
            {
                "code": definition.code,
                "title": definition.title,
                "weight": definition.weight,
                "target": definition.target,
                "count": count,
                "description": definition.description,
                "state": state,
            }
        )

    return results


def build_priorities(patient: dict[str, Any], events: list[dict[str, Any]], indicators: list[dict[str, Any]], today: date | None = None) -> list[dict[str, Any]]:
    today = today or date.today()
    status = (patient.get("status") or "gestante").lower()
    weeks = patient.get("gestational_weeks")
    latest_consult = latest_event_date(events, "prenatal_consult") or iso_to_date(patient.get("last_consultation_date"))
    priorities: list[dict[str, Any]] = []

    if latest_consult:
        days_since = (today - latest_consult).days
        allowed = recommended_interval_days(weeks, status)
        if status in {"gestante", "puerpera"} and days_since > allowed:
            priorities.append(
                {
                    "level": "alta" if days_since > allowed + 7 else "media",
                    "title": "Consulta em atraso",
                    "detail": f"Ultimo atendimento ha {days_since} dias. Intervalo sugerido: {allowed} dias.",
                }
            )
    elif status in {"gestante", "puerpera"}:
        priorities.append(
            {
                "level": "alta",
                "title": "Sem consulta registrada",
                "detail": "Nao existe atendimento registrado no sistema para esta gestante/puérpera.",
            }
        )

    for indicator in indicators:
        if indicator["state"] == "pending":
            if indicator["code"] in {"F", "G", "H", "I", "J"}:
                level = "alta"
            elif indicator["code"] in {"B", "C", "D", "K"}:
                level = "media"
            else:
                level = "baixa"
            priorities.append(
                {
                    "level": level,
                    "title": f"Pendencia {indicator['code']}",
                    "detail": indicator["title"],
                }
            )

    if (patient.get("risk_level") or "").lower() == "alto risco" and not (
        patient.get("high_risk_shared_care") or patient.get("shared_care")
    ):
        priorities.append(
            {
                "level": "alta",
                "title": "Alto risco sem cuidado compartilhado",
                "detail": "Marque o acompanhamento compartilhado com pre-natal de alto risco quando aplicavel.",
            }
        )

    birth_date = iso_to_date(patient.get("actual_birth_date")) or latest_event_date(events, "delivery")
    if birth_date:
        postpartum_days = (today - birth_date).days
        if 0 <= postpartum_days <= 42:
            if not any(item["code"] == "I" and item["state"] == "completed" for item in indicators):
                priorities.append(
                    {
                        "level": "alta" if postpartum_days > 20 else "media",
                        "title": "Consulta puerperal pendente",
                        "detail": f"Ja se passaram {postpartum_days} dias do parto/registro de puerpério.",
                    }
                )
            if not any(item["code"] == "J" and item["state"] == "completed" for item in indicators):
                priorities.append(
                    {
                        "level": "media",
                        "title": "Visita domiciliar puerperal pendente",
                        "detail": "Registre ao menos uma visita do ACS/TACS no puerpério.",
                    }
                )

    priorities.sort(key=lambda item: {"alta": 0, "media": 1, "baixa": 2}.get(item["level"], 3))
    return priorities[:6]


def summarize_patient(patient: dict[str, Any], events: list[dict[str, Any]], today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    indicators = compute_indicator_results(patient, events, today=today)
    completed_weight = sum(item["weight"] for item in indicators if item["state"] == "completed")
    active_weight = sum(item["weight"] for item in indicators if item["state"] != "upcoming") or 100
    priorities = build_priorities(patient, events, indicators, today=today)
    last_consult = latest_event_date(events, "prenatal_consult") or latest_event_date(events, "puerperal_consult")
    birth_date = iso_to_date(patient.get("actual_birth_date")) or latest_event_date(events, "delivery")
    birth_date_value = iso_to_date(patient.get("birth_date"))
    if not last_consult:
        last_consult = iso_to_date(patient.get("last_consultation_date"))

    days_since_last_consult = (today - last_consult).days if last_consult else None
    postpartum_days = (today - birth_date).days if birth_date else None
    age_years = None
    if birth_date_value:
        age_years = today.year - birth_date_value.year - (
            (today.month, today.day) < (birth_date_value.month, birth_date_value.day)
        )

    return {
        "stage_label": stage_label(patient),
        "indicator_results": indicators,
        "journey_score": round((completed_weight / 100) * 100, 1),
        "current_score": round((completed_weight / active_weight) * 100, 1),
        "priorities": priorities,
        "days_since_last_consult": days_since_last_consult,
        "postpartum_days": postpartum_days,
        "age_years": age_years,
    }
