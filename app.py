from __future__ import annotations

import argparse
import cgi
import json
import mimetypes
import os
import re
from datetime import UTC, datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ubs_monitor.auth import (
    SESSION_TTL_DAYS,
    hash_password,
    normalize_email,
    session_expiry,
    session_token,
    token_hash,
    utcnow,
    verify_password,
)
from ubs_monitor.db import connect, initialize, is_postgres_connection
from ubs_monitor.importer import import_records
from ubs_monitor.indicators import EVENT_LABELS, INDICATOR_DEFINITIONS, summarize_patient


ROOT = Path(__file__).parent
STATIC_DIR = ROOT / "static"
DB_TARGET = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL") or Path(
    os.environ.get("DATABASE_PATH", str(ROOT / "data" / "monitor.db"))
)
SESSION_COOKIE = "organizaaps_session"
USER_ROLES = ("admin", "nurse", "acs", "viewer")
ROLE_LABELS = {
    "admin": "Administrador",
    "nurse": "Enfermagem",
    "acs": "ACS",
    "viewer": "Somente leitura",
}
WRITE_ROLES = {"admin", "nurse", "acs"}
TEAM_ADMIN_ROLES = {"admin"}
IMPORT_ROLES = {"admin", "nurse"}


def ensure_database() -> None:
    initialize(DB_TARGET)


def read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def read_multipart_form(handler: BaseHTTPRequestHandler) -> cgi.FieldStorage:
    return cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": handler.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": handler.headers.get("Content-Length", "0"),
        },
    )


def request_is_secure(handler: BaseHTTPRequestHandler) -> bool:
    forwarded_proto = (handler.headers.get("X-Forwarded-Proto") or "").lower()
    return forwarded_proto == "https"


def send_json(
    handler: BaseHTTPRequestHandler,
    payload: dict | list,
    *,
    status: int = 200,
    headers: dict[str, str] | None = None,
) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(body)


def send_error_json(handler: BaseHTTPRequestHandler, message: str, *, status: int = 400) -> None:
    send_json(handler, {"error": message}, status=status)


def cookie_header(token: str, *, secure: bool) -> str:
    parts = [
        f"{SESSION_COOKIE}={token}",
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        f"Max-Age={SESSION_TTL_DAYS * 24 * 60 * 60}",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie_header(*, secure: bool) -> str:
    parts = [
        f"{SESSION_COOKIE}=",
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        "Max-Age=0",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def parse_cookies(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    raw = handler.headers.get("Cookie") or ""
    cookie = SimpleCookie()
    cookie.load(raw)
    return {key: morsel.value for key, morsel in cookie.items()}


def coerce_int(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def coerce_bool(value) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    text = str(value).strip().lower()
    return 1 if text in {"1", "true", "sim", "yes", "on"} else 0


def normalize_status(value: str | None) -> str:
    text = (value or "gestante").strip().lower()
    if text in {"puerpera", "encerrado"}:
        return text
    return "gestante"


def normalize_risk(value: str | None) -> str:
    text = (value or "").strip().lower()
    if "alto" in text:
        return "Alto risco"
    if "inter" in text:
        return "Risco intermediario"
    if "baixo" in text:
        return "Baixo risco"
    return "Sem classificacao"


def serialize_user(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "full_name": row["full_name"],
        "email": row["email"],
        "role": row["role"],
        "role_label": ROLE_LABELS.get(row["role"], row["role"]),
        "is_active": bool(row.get("is_active", 1)),
    }


def user_count(connection) -> int:
    return connection.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]


def create_user(connection, *, full_name: str, email: str, password: str, role: str = "admin") -> int:
    clean_name = (full_name or "").strip()
    clean_email = normalize_email(email)
    if not clean_name:
        raise ValueError("Nome completo obrigatorio.")
    if not clean_email or "@" not in clean_email:
        raise ValueError("E-mail invalido.")
    if role not in USER_ROLES:
        raise ValueError("Perfil invalido.")
    password_hash = hash_password(password)
    if is_postgres_connection(connection):
        user_id = connection.execute(
            """
            INSERT INTO users (full_name, email, password_hash, role)
            VALUES (?, ?, ?, ?)
            RETURNING id
            """,
            (clean_name, clean_email, password_hash, role),
        ).fetchone()["id"]
    else:
        user_id = connection.execute(
            """
            INSERT INTO users (full_name, email, password_hash, role)
            VALUES (?, ?, ?, ?)
            """,
            (clean_name, clean_email, password_hash, role),
        ).lastrowid
    connection.commit()
    return user_id


def create_session(connection, user_id: int) -> str:
    token = session_token()
    connection.execute(
        """
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES (?, ?, ?)
        """,
        (user_id, token_hash(token), session_expiry()),
    )
    connection.commit()
    return token


def destroy_session(connection, token: str | None) -> None:
    if not token:
        return
    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
    connection.commit()


def current_user(connection, handler: BaseHTTPRequestHandler) -> dict | None:
    cookies = parse_cookies(handler)
    token = cookies.get(SESSION_COOKIE)
    if not token:
        return None

    session_row = connection.execute(
        """
        SELECT sessions.id AS session_id, sessions.user_id, sessions.expires_at,
               users.id AS user_id_value, users.full_name, users.email, users.role, users.is_active
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
        """,
        (token_hash(token),),
    ).fetchone()
    if not session_row:
        return None

    session_data = dict(session_row)
    try:
        expires_at = datetime.fromisoformat(session_data["expires_at"])
    except ValueError:
        destroy_session(connection, token)
        return None

    if expires_at <= utcnow() or not session_data["is_active"]:
        destroy_session(connection, token)
        return None

    connection.execute(
        "UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
        (session_data["session_id"],),
    )
    connection.commit()
    return {
        "id": session_data["user_id_value"],
        "full_name": session_data["full_name"],
        "email": session_data["email"],
        "role": session_data["role"],
        "role_label": ROLE_LABELS.get(session_data["role"], session_data["role"]),
        "is_active": session_data["is_active"],
    }


def has_any_role(user: dict | None, allowed_roles: set[str]) -> bool:
    return bool(user and user.get("role") in allowed_roles)


def require_roles(handler: BaseHTTPRequestHandler, user: dict | None, allowed_roles: set[str]) -> bool:
    if has_any_role(user, allowed_roles):
        return True
    send_error_json(handler, "Permissao insuficiente para esta acao.", status=403)
    return False


def log_action(
    connection,
    *,
    user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    patient_id: int | None = None,
    detail: dict | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO audit_log (user_id, patient_id, action, entity_type, entity_id, detail_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            patient_id,
            action,
            entity_type,
            entity_id,
            json.dumps(detail or {}, ensure_ascii=False) if detail else None,
        ),
    )
    connection.commit()


def serialize_event(row: dict) -> dict:
    metadata = {}
    if row.get("metadata_json"):
        try:
            metadata = json.loads(row["metadata_json"])
        except json.JSONDecodeError:
            metadata = {}
    return {
        "id": row["id"],
        "event_type": row["event_type"],
        "event_date": row["event_date"],
        "professional": row.get("professional"),
        "notes": row.get("notes"),
        "label": EVENT_LABELS.get(row["event_type"], row["event_type"]),
        "metadata": metadata,
    }


def fetch_events(connection, patient_id: int) -> list[dict]:
    rows = connection.execute(
        "SELECT * FROM events WHERE patient_id = ? ORDER BY event_date DESC, id DESC",
        (patient_id,),
    ).fetchall()
    return [serialize_event(dict(row)) for row in rows]


def list_patients(connection, search: str = "", risk: str = "", status: str = "") -> list[dict]:
    query = "SELECT * FROM patients WHERE 1=1"
    params: list = []

    if search:
        comparator = "ILIKE" if is_postgres_connection(connection) else "LIKE"
        query += f" AND (name {comparator} ? OR locality {comparator} ? OR notes {comparator} ?)"
        needle = f"%{search}%"
        params.extend([needle, needle, needle])

    if risk and risk != "all":
        query += " AND risk_level = ?"
        params.append(normalize_risk(risk))

    if status and status != "all":
        query += " AND status = ?"
        params.append(normalize_status(status))

    query += " ORDER BY CASE risk_level WHEN 'Alto risco' THEN 0 WHEN 'Risco intermediario' THEN 1 ELSE 2 END, LOWER(name)"
    rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def patient_payload(connection, patient_id: int) -> dict | None:
    row = connection.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not row:
        return None
    patient = dict(row)
    events = fetch_events(connection, patient_id)
    summary = summarize_patient(patient, events)
    return {
        **patient,
        **summary,
        "events": events,
    }


def dashboard_payload(connection, search: str = "", risk: str = "", status: str = "") -> dict:
    patients = list_patients(connection, search=search, risk=risk, status=status)
    details = []
    priorities = []
    coverage = {definition.code: {"done": 0, "total": 0, "title": definition.title} for definition in INDICATOR_DEFINITIONS}

    for patient in patients:
        events = fetch_events(connection, patient["id"])
        summary = summarize_patient(patient, events)
        detail = {
            **patient,
            **summary,
        }
        details.append(detail)
        priorities.extend(
            [
                {
                    **item,
                    "patient_id": patient["id"],
                    "patient_name": patient["name"],
                }
                for item in summary["priorities"]
            ]
        )
        for indicator in summary["indicator_results"]:
            if indicator["state"] != "upcoming":
                coverage[indicator["code"]]["total"] += 1
            if indicator["state"] == "completed":
                coverage[indicator["code"]]["done"] += 1

    total = len(details)
    high_risk = sum(1 for patient in details if patient["risk_level"] == "Alto risco")
    puerperas = sum(1 for patient in details if patient["status"] == "puerpera")
    overdue = sum(1 for patient in details if patient["days_since_last_consult"] and patient["days_since_last_consult"] > 30)
    avg_journey = round(sum(patient["journey_score"] for patient in details) / total, 1) if total else 0

    priorities.sort(key=lambda item: {"alta": 0, "media": 1, "baixa": 2}.get(item["level"], 3))

    summaries = [
        {
            "id": patient["id"],
            "name": patient["name"],
            "locality": patient.get("locality"),
            "risk_level": patient.get("risk_level"),
            "status": patient.get("status"),
            "stage_label": patient.get("stage_label"),
            "last_consultation_date": patient.get("last_consultation_date"),
            "journey_score": patient.get("journey_score"),
            "current_score": patient.get("current_score"),
            "days_since_last_consult": patient.get("days_since_last_consult"),
            "priority_count": len(patient.get("priorities", [])),
        }
        for patient in details
    ]

    return {
        "stats": {
            "total_active": total,
            "high_risk": high_risk,
            "puerperas": puerperas,
            "average_journey_score": avg_journey,
            "overdue_follow_ups": overdue,
        },
        "patients": summaries,
        "priorities": priorities[:10],
        "coverage": list(coverage.values()),
    }


def create_patient(connection, payload: dict) -> int:
    name = (payload.get("name") or "").strip()
    if not name:
        raise ValueError("Nome da usuaria e obrigatorio.")

    locality = (payload.get("locality") or "").strip() or None
    risk_level = normalize_risk(payload.get("risk_level"))
    status = normalize_status(payload.get("status"))
    weeks = coerce_int(payload.get("gestational_weeks"))
    notes = (payload.get("notes") or "").strip() or None
    dum = (payload.get("dum") or "").strip() or None
    dpp = (payload.get("dpp") or "").strip() or None
    actual_birth_date = (payload.get("actual_birth_date") or "").strip() or None

    if actual_birth_date:
        status = "puerpera"

    params = (
        name,
        locality,
        risk_level,
        status,
        weeks,
        dum,
        dpp,
        actual_birth_date,
        (payload.get("maternity_reference") or "").strip() or None,
        notes,
        "cadastro_manual",
    )
    if is_postgres_connection(connection):
        patient_id = connection.execute(
            """
            INSERT INTO patients (
                name, locality, risk_level, status, gestational_weeks,
                dum, dpp, actual_birth_date, maternity_reference, notes, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            params,
        ).fetchone()["id"]
    else:
        patient_id = connection.execute(
            """
            INSERT INTO patients (
                name, locality, risk_level, status, gestational_weeks,
                dum, dpp, actual_birth_date, maternity_reference, notes, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            params,
        ).lastrowid
    connection.commit()
    return patient_id


def update_patient(connection, patient_id: int, payload: dict) -> None:
    allowed = {
        "name": (payload.get("name") or "").strip() or None,
        "locality": (payload.get("locality") or "").strip() or None,
        "risk_level": normalize_risk(payload.get("risk_level")),
        "status": normalize_status(payload.get("status")),
        "gestational_weeks": coerce_int(payload.get("gestational_weeks")),
        "gestational_age_label": (payload.get("gestational_age_label") or "").strip() or None,
        "dum": (payload.get("dum") or "").strip() or None,
        "dpp": (payload.get("dpp") or "").strip() or None,
        "actual_birth_date": (payload.get("actual_birth_date") or "").strip() or None,
        "last_consultation_date": (payload.get("last_consultation_date") or "").strip() or None,
        "last_professional": (payload.get("last_professional") or "").strip() or None,
        "maternity_reference": (payload.get("maternity_reference") or "").strip() or None,
        "high_risk_shared_care": coerce_bool(payload.get("high_risk_shared_care")),
        "active_search": coerce_bool(payload.get("active_search")),
        "notes": (payload.get("notes") or "").strip() or None,
    }

    set_parts = []
    values = []
    for field, value in allowed.items():
        if field in payload:
            set_parts.append(f"{field} = ?")
            values.append(value)

    if "actual_birth_date" in payload and allowed["actual_birth_date"]:
        set_parts.append("status = ?")
        values.append("puerpera")

    if not set_parts:
        return

    values.append(patient_id)
    connection.execute(
        f"UPDATE patients SET {', '.join(set_parts)} WHERE id = ?",
        values,
    )
    connection.commit()


def register_quick_update(connection, patient_id: int, payload: dict) -> None:
    event_date = (payload.get("event_date") or "").strip()
    if not event_date:
        raise ValueError("A data do registro rapido e obrigatoria.")

    professional = (payload.get("professional") or "").strip() or None
    notes = (payload.get("notes") or "").strip() or None
    metadata_json = json.dumps({"source": "registro_rapido"}, ensure_ascii=False)

    event_fields = {
        "prenatal_consult": payload.get("prenatal_consult"),
        "puerperal_consult": payload.get("puerperal_consult"),
        "blood_pressure": payload.get("blood_pressure"),
        "anthropometry": payload.get("anthropometry"),
        "pregnancy_home_visit": payload.get("pregnancy_home_visit"),
        "puerperal_home_visit": payload.get("puerperal_home_visit"),
        "dtpa_vaccine": payload.get("dtpa_vaccine"),
        "first_trimester_tests": payload.get("first_trimester_tests"),
        "third_trimester_tests": payload.get("third_trimester_tests"),
        "dental_visit": payload.get("dental_visit"),
        "delivery": payload.get("delivery"),
    }

    inserted_any = False
    for event_type, enabled in event_fields.items():
        if coerce_bool(enabled):
            connection.execute(
                """
                INSERT INTO events (patient_id, event_type, event_date, professional, metadata_json, notes)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (patient_id, event_type, event_date, professional, metadata_json, notes),
            )
            inserted_any = True

    patient_update = {}
    if "gestational_weeks" in payload:
        patient_update["gestational_weeks"] = coerce_int(payload.get("gestational_weeks"))
    if "risk_level" in payload:
        patient_update["risk_level"] = normalize_risk(payload.get("risk_level"))
    if "status" in payload:
        patient_update["status"] = normalize_status(payload.get("status"))
    if "actual_birth_date" in payload:
        patient_update["actual_birth_date"] = (payload.get("actual_birth_date") or "").strip() or None
    if professional:
        patient_update["last_professional"] = professional
    if inserted_any and (coerce_bool(payload.get("prenatal_consult")) or coerce_bool(payload.get("puerperal_consult"))):
        patient_update["last_consultation_date"] = event_date
    if coerce_bool(payload.get("delivery")) and not patient_update.get("actual_birth_date"):
        patient_update["actual_birth_date"] = event_date
        patient_update["status"] = "puerpera"
    if notes:
        patient_update["notes"] = notes

    if patient_update:
        update_patient(connection, patient_id, patient_update)
    else:
        connection.commit()


def list_users_payload(connection) -> list[dict]:
    rows = connection.execute(
        """
        SELECT id, full_name, email, role, is_active, created_at, updated_at
        FROM users
        ORDER BY is_active DESC, LOWER(full_name)
        """
    ).fetchall()
    return [
        {
            "id": row["id"],
            "full_name": row["full_name"],
            "email": row["email"],
            "role": row["role"],
            "role_label": ROLE_LABELS.get(row["role"], row["role"]),
            "is_active": bool(row["is_active"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def update_user_profile(connection, user_id: int, payload: dict) -> None:
    row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise ValueError("Usuario nao encontrado.")

    updates = {}
    if "full_name" in payload:
        full_name = (payload.get("full_name") or "").strip()
        if not full_name:
            raise ValueError("Nome completo obrigatorio.")
        updates["full_name"] = full_name
    if "email" in payload:
        email = normalize_email(payload.get("email"))
        if not email or "@" not in email:
            raise ValueError("E-mail invalido.")
        existing = connection.execute(
            "SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1",
            (email, user_id),
        ).fetchone()
        if existing:
            raise ValueError("Ja existe outra conta com esse e-mail.")
        updates["email"] = email
    if "role" in payload:
        role = payload.get("role")
        if role not in USER_ROLES:
            raise ValueError("Perfil invalido.")
        updates["role"] = role
    if "is_active" in payload:
        updates["is_active"] = coerce_bool(payload.get("is_active"))
    if "password" in payload:
        password = payload.get("password") or ""
        if password:
            updates["password_hash"] = hash_password(password)

    if not updates:
        return

    values = list(updates.values())
    values.append(user_id)
    connection.execute(
        f"UPDATE users SET {', '.join(f'{field} = ?' for field in updates)} WHERE id = ?",
        values,
    )
    connection.commit()


def list_import_runs(connection) -> list[dict]:
    rows = connection.execute(
        """
        SELECT import_runs.*, users.full_name AS imported_by_name
        FROM import_runs
        LEFT JOIN users ON users.id = import_runs.imported_by_user_id
        ORDER BY import_runs.created_at DESC, import_runs.id DESC
        LIMIT 12
        """
    ).fetchall()
    payload = []
    for row in rows:
        item = dict(row)
        summary = {}
        if item.get("summary_json"):
            try:
                summary = json.loads(item["summary_json"])
            except json.JSONDecodeError:
                summary = {}
        payload.append(
            {
                "id": item["id"],
                "filename": item["filename"],
                "source_kind": item["source_kind"],
                "created_at": item["created_at"],
                "imported_by_name": item.get("imported_by_name"),
                "total_rows": item["total_rows"],
                "inserted_patients": item["inserted_patients"],
                "updated_patients": item["updated_patients"],
                "inserted_events": item["inserted_events"],
                "skipped_rows": item["skipped_rows"],
                "status": item["status"],
                "summary": summary,
            }
        )
    return payload


class UBSRequestHandler(BaseHTTPRequestHandler):
    server_version = "OrganizaAPS/2.0"

    def with_user(self) -> tuple[dict | None, object]:
        connection = connect(DB_TARGET)
        return current_user(connection, self), connection

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/bootstrap":
            with connect(DB_TARGET) as connection:
                user = serialize_user(current_user(connection, self))
                payload = {
                    "needs_setup": user_count(connection) == 0,
                    "user": user,
                    "roles": [{"value": role, "label": ROLE_LABELS[role]} for role in USER_ROLES],
                    "permissions": {
                        "can_manage_team": has_any_role(user, TEAM_ADMIN_ROLES),
                        "can_import": has_any_role(user, IMPORT_ROLES),
                        "can_write": has_any_role(user, WRITE_ROLES),
                    },
                }
            send_json(self, payload)
            return

        if path == "/api/health":
            send_json(self, {"ok": True, "timestamp": utcnow().isoformat()})
            return

        if path.startswith("/api/"):
            with connect(DB_TARGET) as connection:
                user = current_user(connection, self)
                if not user:
                    send_error_json(self, "Sessao expirada. Entre novamente.", status=401)
                    return

                if path == "/api/dashboard":
                    payload = dashboard_payload(
                        connection,
                        search=(query.get("search", [""])[0] or "").strip(),
                        risk=(query.get("risk", [""])[0] or "").strip(),
                        status=(query.get("status", [""])[0] or "").strip(),
                    )
                    send_json(self, payload)
                    return

                if path == "/api/patients":
                    patients = list_patients(
                        connection,
                        search=(query.get("search", [""])[0] or "").strip(),
                        risk=(query.get("risk", [""])[0] or "").strip(),
                        status=(query.get("status", [""])[0] or "").strip(),
                    )
                    payload = []
                    for patient in patients:
                        summary = summarize_patient(patient, fetch_events(connection, patient["id"]))
                        payload.append(
                            {
                                "id": patient["id"],
                                "name": patient["name"],
                                "locality": patient.get("locality"),
                                "risk_level": patient.get("risk_level"),
                                "status": patient.get("status"),
                                "stage_label": summary["stage_label"],
                                "journey_score": summary["journey_score"],
                                "current_score": summary["current_score"],
                                "days_since_last_consult": summary["days_since_last_consult"],
                                "priority_count": len(summary["priorities"]),
                            }
                        )
                    send_json(self, payload)
                    return

                match = re.fullmatch(r"/api/patients/(\d+)", path)
                if match:
                    patient_id = int(match.group(1))
                    payload = patient_payload(connection, patient_id)
                    if not payload:
                        send_error_json(self, "Paciente nao encontrada.", status=404)
                        return
                    send_json(self, payload)
                    return

                if path == "/api/imports":
                    send_json(self, list_import_runs(connection))
                    return

                if path == "/api/users":
                    if not require_roles(self, user, TEAM_ADMIN_ROLES):
                        return
                    send_json(self, list_users_payload(connection))
                    return

                if path == "/api/references":
                    send_json(self, {"definitions": [definition.__dict__ for definition in INDICATOR_DEFINITIONS]})
                    return

            send_error_json(self, "Rota nao encontrada.", status=404)
            return

        self.serve_static(path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/setup":
            try:
                payload = read_json_body(self)
            except json.JSONDecodeError:
                send_error_json(self, "JSON invalido.", status=400)
                return

            with connect(DB_TARGET) as connection:
                if user_count(connection):
                    send_error_json(self, "A configuracao inicial ja foi concluida.", status=409)
                    return
                try:
                    user_id = create_user(
                        connection,
                        full_name=payload.get("full_name"),
                        email=payload.get("email"),
                        password=payload.get("password"),
                        role="admin",
                    )
                    token = create_session(connection, user_id)
                except ValueError as exc:
                    send_error_json(self, str(exc), status=400)
                    return
                user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

            send_json(
                self,
                {"ok": True, "user": serialize_user(dict(user))},
                status=HTTPStatus.CREATED,
                headers={"Set-Cookie": cookie_header(token, secure=request_is_secure(self))},
            )
            return

        if path == "/api/auth/login":
            try:
                payload = read_json_body(self)
            except json.JSONDecodeError:
                send_error_json(self, "JSON invalido.", status=400)
                return

            clean_email = normalize_email(payload.get("email"))
            password = payload.get("password") or ""
            with connect(DB_TARGET) as connection:
                row = connection.execute(
                    "SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1",
                    (clean_email,),
                ).fetchone()
                if not row or not verify_password(password, row["password_hash"]):
                    send_error_json(self, "Credenciais invalidas.", status=401)
                    return
                token = create_session(connection, row["id"])
                user = serialize_user(dict(row))

            send_json(
                self,
                {"ok": True, "user": user},
                headers={"Set-Cookie": cookie_header(token, secure=request_is_secure(self))},
            )
            return

        if path == "/api/auth/logout":
            with connect(DB_TARGET) as connection:
                destroy_session(connection, parse_cookies(self).get(SESSION_COOKIE))
            send_json(
                self,
                {"ok": True},
                headers={"Set-Cookie": clear_cookie_header(secure=request_is_secure(self))},
            )
            return

        with connect(DB_TARGET) as connection:
            user = current_user(connection, self)
            if not user:
                send_error_json(self, "Sessao expirada. Entre novamente.", status=401)
                return

            if path == "/api/patients":
                if not require_roles(self, user, WRITE_ROLES):
                    return
                try:
                    payload = read_json_body(self)
                    patient_id = create_patient(connection, payload)
                except json.JSONDecodeError:
                    send_error_json(self, "JSON invalido.", status=400)
                    return
                except ValueError as exc:
                    send_error_json(self, str(exc), status=400)
                    return
                log_action(
                    connection,
                    user_id=user["id"],
                    action="create",
                    entity_type="patient",
                    entity_id=patient_id,
                    patient_id=patient_id,
                    detail={"source": "cadastro_manual"},
                )
                send_json(self, {"patient_id": patient_id}, status=HTTPStatus.CREATED)
                return

            match_profile = re.fullmatch(r"/api/patients/(\d+)/profile", path)
            if match_profile:
                if not require_roles(self, user, WRITE_ROLES):
                    return
                patient_id = int(match_profile.group(1))
                try:
                    payload = read_json_body(self)
                except json.JSONDecodeError:
                    send_error_json(self, "JSON invalido.", status=400)
                    return
                update_patient(connection, patient_id, payload)
                log_action(
                    connection,
                    user_id=user["id"],
                    action="update_profile",
                    entity_type="patient",
                    entity_id=patient_id,
                    patient_id=patient_id,
                )
                send_json(self, {"ok": True})
                return

            match_quick = re.fullmatch(r"/api/patients/(\d+)/quick-update", path)
            if match_quick:
                if not require_roles(self, user, WRITE_ROLES):
                    return
                patient_id = int(match_quick.group(1))
                try:
                    payload = read_json_body(self)
                    register_quick_update(connection, patient_id, payload)
                except json.JSONDecodeError:
                    send_error_json(self, "JSON invalido.", status=400)
                    return
                except ValueError as exc:
                    send_error_json(self, str(exc), status=400)
                    return
                log_action(
                    connection,
                    user_id=user["id"],
                    action="quick_update",
                    entity_type="event_batch",
                    entity_id=patient_id,
                    patient_id=patient_id,
                )
                send_json(self, {"ok": True})
                return

            if path == "/api/users":
                if not require_roles(self, user, TEAM_ADMIN_ROLES):
                    return
                try:
                    payload = read_json_body(self)
                    new_user_id = create_user(
                        connection,
                        full_name=payload.get("full_name"),
                        email=payload.get("email"),
                        password=payload.get("password"),
                        role=payload.get("role") or "viewer",
                    )
                except json.JSONDecodeError:
                    send_error_json(self, "JSON invalido.", status=400)
                    return
                except ValueError as exc:
                    send_error_json(self, str(exc), status=400)
                    return
                log_action(
                    connection,
                    user_id=user["id"],
                    action="create_user",
                    entity_type="user",
                    entity_id=new_user_id,
                )
                send_json(self, {"user_id": new_user_id}, status=HTTPStatus.CREATED)
                return

            match_user = re.fullmatch(r"/api/users/(\d+)", path)
            if match_user:
                if not require_roles(self, user, TEAM_ADMIN_ROLES):
                    return
                target_user_id = int(match_user.group(1))
                try:
                    payload = read_json_body(self)
                    if target_user_id == user["id"] and payload.get("is_active") in (False, 0, "0", "false", "False"):
                        raise ValueError("Nao e permitido desativar a propria conta.")
                    update_user_profile(connection, target_user_id, payload)
                except json.JSONDecodeError:
                    send_error_json(self, "JSON invalido.", status=400)
                    return
                except ValueError as exc:
                    send_error_json(self, str(exc), status=400)
                    return
                log_action(
                    connection,
                    user_id=user["id"],
                    action="update_user",
                    entity_type="user",
                    entity_id=target_user_id,
                )
                send_json(self, {"ok": True})
                return

            if path == "/api/imports/pec":
                if not require_roles(self, user, IMPORT_ROLES):
                    return
                try:
                    form = read_multipart_form(self)
                except Exception:
                    send_error_json(self, "Nao foi possivel ler o upload.", status=400)
                    return

                uploaded = form["file"] if "file" in form else None
                if uploaded is None or not getattr(uploaded, "filename", ""):
                    send_error_json(self, "Selecione um arquivo para importar.", status=400)
                    return

                file_bytes = uploaded.file.read()
                if not file_bytes:
                    send_error_json(self, "O arquivo enviado esta vazio.", status=400)
                    return

                try:
                    summary = import_records(
                        connection,
                        filename=uploaded.filename,
                        file_bytes=file_bytes,
                        imported_by_user_id=user["id"],
                        source_kind_hint=form.getfirst("source_kind"),
                    )
                except ValueError as exc:
                    send_error_json(self, str(exc), status=400)
                    return

                log_action(
                    connection,
                    user_id=user["id"],
                    action="import",
                    entity_type="import_run",
                    entity_id=summary["run_id"],
                    detail=summary,
                )
                send_json(self, summary, status=HTTPStatus.CREATED)
                return

        send_error_json(self, "Rota nao encontrada.", status=404)

    def serve_static(self, raw_path: str) -> None:
        relative = raw_path.lstrip("/") or "index.html"
        safe_path = (STATIC_DIR / relative).resolve()

        if not str(safe_path).startswith(str(STATIC_DIR.resolve())) or not safe_path.exists() or safe_path.is_dir():
            safe_path = STATIC_DIR / "index.html"

        body = safe_path.read_bytes()
        content_type, _ = mimetypes.guess_type(safe_path.name)
        self.send_response(200)
        self.send_header("Content-Type", content_type or "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="OrganizaAPS - monitor compartilhado de gestantes e puerperas")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8765")))
    args = parser.parse_args()

    ensure_database()
    server = ThreadingHTTPServer((args.host, args.port), UBSRequestHandler)
    print(f"OrganizaAPS disponivel em http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
