from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - optional in local SQLite mode
    psycopg = None
    dict_row = None


SQLITE_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_code TEXT,
    name TEXT NOT NULL,
    cpf TEXT,
    cns TEXT,
    birth_date TEXT,
    mother_name TEXT,
    locality TEXT,
    risk_level TEXT DEFAULT 'Sem classificacao',
    status TEXT DEFAULT 'gestante',
    gestational_weeks INTEGER,
    gestational_age_label TEXT,
    dum TEXT,
    dpp TEXT,
    actual_birth_date TEXT,
    last_consultation_date TEXT,
    last_professional TEXT,
    maternity_reference TEXT,
    high_risk_shared_care INTEGER DEFAULT 0,
    active_search INTEGER DEFAULT 0,
    source TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    professional TEXT,
    metadata_json TEXT,
    notes TEXT,
    source_event_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    imported_by_user_id INTEGER,
    total_rows INTEGER NOT NULL DEFAULT 0,
    inserted_patients INTEGER NOT NULL DEFAULT 0,
    updated_patients INTEGER NOT NULL DEFAULT 0,
    inserted_events INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    summary_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(imported_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS patient_source_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    source_system TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_hash TEXT,
    raw_snapshot_json TEXT,
    last_import_run_id INTEGER,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_system, source_key),
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY(last_import_run_id) REFERENCES import_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    patient_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    detail_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_patient_date
    ON events(patient_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_events_patient_type
    ON events(patient_id, event_type);

CREATE INDEX IF NOT EXISTS idx_patients_cpf
    ON patients(cpf);

CREATE INDEX IF NOT EXISTS idx_patients_cns
    ON patients(cns);

CREATE INDEX IF NOT EXISTS idx_patients_external_code
    ON patients(external_code);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
    ON sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_patient_source_links_patient
    ON patient_source_links(patient_id);

CREATE INDEX IF NOT EXISTS idx_import_runs_created_at
    ON import_runs(created_at DESC);
"""


POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS patients (
    id BIGSERIAL PRIMARY KEY,
    external_code TEXT,
    name TEXT NOT NULL,
    cpf TEXT,
    cns TEXT,
    birth_date TEXT,
    mother_name TEXT,
    locality TEXT,
    risk_level TEXT DEFAULT 'Sem classificacao',
    status TEXT DEFAULT 'gestante',
    gestational_weeks INTEGER,
    gestational_age_label TEXT,
    dum TEXT,
    dpp TEXT,
    actual_birth_date TEXT,
    last_consultation_date TEXT,
    last_professional TEXT,
    maternity_reference TEXT,
    high_risk_shared_care INTEGER DEFAULT 0,
    active_search INTEGER DEFAULT 0,
    source TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    professional TEXT,
    metadata_json TEXT,
    notes TEXT,
    source_event_key TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_runs (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    imported_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    inserted_patients INTEGER NOT NULL DEFAULT 0,
    updated_patients INTEGER NOT NULL DEFAULT 0,
    inserted_events INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    summary_json TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_source_links (
    id BIGSERIAL PRIMARY KEY,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    source_system TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_hash TEXT,
    raw_snapshot_json TEXT,
    last_import_run_id BIGINT REFERENCES import_runs(id) ON DELETE SET NULL,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_system, source_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    patient_id BIGINT REFERENCES patients(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id BIGINT,
    detail_json TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_patient_date
    ON events(patient_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_events_patient_type
    ON events(patient_id, event_type);

CREATE INDEX IF NOT EXISTS idx_patients_cpf
    ON patients(cpf);

CREATE INDEX IF NOT EXISTS idx_patients_cns
    ON patients(cns);

CREATE INDEX IF NOT EXISTS idx_patients_external_code
    ON patients(external_code);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
    ON sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_patient_source_links_patient
    ON patient_source_links(patient_id);

CREATE INDEX IF NOT EXISTS idx_import_runs_created_at
    ON import_runs(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source_event_key
    ON events(source_event_key);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_patients_updated_at ON patients;
CREATE TRIGGER trg_patients_updated_at
BEFORE UPDATE ON patients
FOR EACH ROW
EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION touch_updated_at();
"""


PATIENT_COLUMNS = {
    "cpf": "TEXT",
    "cns": "TEXT",
    "birth_date": "TEXT",
    "mother_name": "TEXT",
    "high_risk_shared_care": "INTEGER DEFAULT 0",
    "active_search": "INTEGER DEFAULT 0",
}

EVENT_COLUMNS = {
    "metadata_json": "TEXT",
    "source_event_key": "TEXT",
}


def _env_database_url() -> str | None:
    return os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")


def _is_database_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return value.startswith(("postgres://", "postgresql://"))


def _resolve_target(target: str | Path | None) -> str | Path:
    if target is None:
        return _env_database_url() or Path("data/monitor.db")
    return target


def is_postgres_target(target: str | Path | None) -> bool:
    resolved = _resolve_target(target)
    return _is_database_url(resolved)


def is_postgres_connection(connection: Any) -> bool:
    return bool(getattr(connection, "is_postgres", False)) or isinstance(connection, PostgresConnectionCompat)


def _translate_query(query: str) -> str:
    return query.replace("?", "%s").replace(" COLLATE NOCASE", "")


class CursorCompat:
    def __init__(self, cursor, *, lastrowid: int | None = None):
        self._cursor = cursor
        self.lastrowid = lastrowid
        self.rowcount = getattr(cursor, "rowcount", -1)

    def fetchone(self):
        try:
            return self._cursor.fetchone()
        except Exception:
            return None

    def fetchall(self):
        try:
            return self._cursor.fetchall()
        except Exception:
            return []


class PostgresConnectionCompat:
    is_postgres = True

    def __init__(self, dsn: str):
        if psycopg is None:  # pragma: no cover - exercised only when dependency missing
            raise RuntimeError("psycopg precisa estar instalado para usar Postgres/Supabase.")
        self._conn = psycopg.connect(
            dsn,
            row_factory=dict_row,
            prepare_threshold=None,
        )

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if exc_type:
                self.rollback()
            else:
                self.commit()
        finally:
            self.close()

    def execute(self, query: str, params: list | tuple | None = None) -> CursorCompat:
        cursor = self._conn.execute(_translate_query(query), params or ())
        return CursorCompat(cursor)

    def executescript(self, script: str) -> None:
        with self._conn.cursor() as cursor:
            cursor.execute(script)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


def connect(target: str | Path | None) -> sqlite3.Connection | PostgresConnectionCompat:
    resolved = _resolve_target(target)
    if _is_database_url(resolved):
        return PostgresConnectionCompat(str(resolved))

    path = Path(resolved)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def table_columns(connection: sqlite3.Connection | PostgresConnectionCompat, table_name: str) -> set[str]:
    if is_postgres_connection(connection):
        rows = connection.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            """,
            (table_name,),
        ).fetchall()
        return {row["column_name"] for row in rows}

    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row["name"] for row in rows}


def ensure_column(
    connection: sqlite3.Connection | PostgresConnectionCompat,
    table_name: str,
    column_name: str,
    definition: str,
) -> None:
    existing = table_columns(connection, table_name)
    if column_name in existing:
        return
    connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def initialize(target: str | Path | None) -> None:
    resolved = _resolve_target(target)
    if _is_database_url(resolved):
        with connect(resolved) as connection:
            connection.executescript(POSTGRES_SCHEMA)
            for column_name, definition in PATIENT_COLUMNS.items():
                ensure_column(connection, "patients", column_name, definition)
            for column_name, definition in EVENT_COLUMNS.items():
                ensure_column(connection, "events", column_name, definition)
            connection.commit()
        return

    db_path = Path(resolved)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as connection:
        connection.executescript(SQLITE_SCHEMA)
        for column_name, definition in PATIENT_COLUMNS.items():
            ensure_column(connection, "patients", column_name, definition)
        for column_name, definition in EVENT_COLUMNS.items():
            ensure_column(connection, "events", column_name, definition)
        connection.executescript(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source_event_key
                ON events(source_event_key);
            """
        )
        connection.executescript(
            """
            CREATE TRIGGER IF NOT EXISTS trg_patients_updated_at
            AFTER UPDATE ON patients
            FOR EACH ROW
            BEGIN
                UPDATE patients SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
            AFTER UPDATE ON users
            FOR EACH ROW
            BEGIN
                UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;
            """
        )
        connection.commit()


def rows_to_dicts(rows: list[sqlite3.Row] | list[dict]) -> list[dict]:
    return [dict(row) for row in rows]
