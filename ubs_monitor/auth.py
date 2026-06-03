from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta


PBKDF2_ITERATIONS = 390_000
SESSION_TTL_DAYS = 7


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def utcnow() -> datetime:
    return datetime.now(UTC)


def hash_password(password: str, *, salt: str | None = None) -> str:
    if len(password or "") < 8:
        raise ValueError("A senha precisa ter pelo menos 8 caracteres.")

    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored_value: str | None) -> bool:
    if not stored_value:
        return False
    try:
        algorithm, iterations_text, salt, expected = stored_value.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iterations_text)
    except ValueError:
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        (password or "").encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(digest, expected)


def session_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_expiry() -> str:
    return (utcnow() + timedelta(days=SESSION_TTL_DAYS)).isoformat()
