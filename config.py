import os
from dotenv import load_dotenv

load_dotenv()

basedir = os.path.abspath(os.path.dirname(__file__))


def _require_env(key: str) -> str:
    val = os.environ.get(key, '').strip()
    if not val:
        raise RuntimeError(
            f"\n\n❌  MISSING REQUIRED ENVIRONMENT VARIABLE: '{key}'\n"
            f"    .env file mein '{key}=' set karo.\n"
            f"    App tab tak start nahi hogi.\n"
        )
    return val


def _get_database_url() -> str:
    """
    DATABASE_URL fix karo:
    - Render PostgreSQL 'postgres://' deta hai
    - SQLAlchemy ko 'postgresql://' chahiye
    - Agar kuch nahi mila toh local SQLite use karo
    """
    url = os.environ.get('DATABASE_URL', '').strip()

    if not url:
        return f"sqlite:///{os.path.join(basedir, 'notes.db')}"

    # Render ka URL fix karo
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)

    return url


class Config:
    # ──────────────────────────────────────────────────────────
    # 🔐 SECRET KEY
    # ──────────────────────────────────────────────────────────
    SECRET_KEY = _require_env('SECRET_KEY')

    # ──────────────────────────────────────────────────────────
    # 🗄️  DATABASE — PostgreSQL (Render) ya SQLite (local)
    # ──────────────────────────────────────────────────────────
    SQLALCHEMY_DATABASE_URI = _get_database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Connection pool — PostgreSQL ke liye zaroori
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,    # Dead connections avoid karo
        'pool_recycle': 280,      # Render 300s timeout se pehle recycle
        'pool_size': 5,
        'max_overflow': 2,
    }

    # ──────────────────────────────────────────────────────────
    # 🛡️  SECURITY
    # ──────────────────────────────────────────────────────────
    WTF_CSRF_ENABLED = True
    RATELIMIT_HEADERS_ENABLED = True

    # ──────────────────────────────────────────────────────────
    # 📧  EMAIL  (Resend HTTP API)
    # ──────────────────────────────────────────────────────────
    # app.py ka _dispatch_email() ye key seedha os.environ se padhta hai,
    # yahan config me bhi rakha hai taaki startup pe hi missing key pakdi jaaye.
    RESEND_API_KEY       = _require_env('RESEND_API_KEY')
    MAIL_DEFAULT_SENDER  = os.environ.get('MAIL_DEFAULT_SENDER', 'noteprosupport@gmail.com')

    # Neeche wali SMTP settings ab actual email sending me use NAHI hoti
    # (Resend HTTP API port 443 pe direct call karta hai). Flask-Mail
    # extension sirf initialize hone ke liye rakha hai, isliye dummy/safe
    # defaults hi kaafi hain — inhe .env me set karne ki zaroorat nahi.
    MAIL_SERVER   = os.environ.get('MAIL_SERVER', 'smtp.resend.com')
    MAIL_PORT     = int(os.environ.get('MAIL_PORT', 587))
    MAIL_USE_TLS  = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
    MAIL_USE_SSL  = os.environ.get('MAIL_USE_SSL', 'False').lower() == 'true'
    MAIL_TIMEOUT  = int(os.environ.get('MAIL_TIMEOUT', 10))
    MAIL_USERNAME = 'resend'
    MAIL_PASSWORD = RESEND_API_KEY

    # ──────────────────────────────────────────────────────────
    # ⚡ RATE LIMITING
    # ──────────────────────────────────────────────────────────
    RATE_LIMIT_IP_WHITELIST = []
    ADMIN_RATE_LIMIT_ENFORCED_ENDPOINTS = [
        'login', 'register', 'verify_note_password',
        'forgot_password', 'reset_password', 'api_reset_note_password'
    ]

    # ──────────────────────────────────────────────────────────
    # 📁  FILE UPLOAD
    # ──────────────────────────────────────────────────────────
    UPLOAD_FOLDER = os.environ.get(
        'UPLOAD_FOLDER',
        os.path.join(basedir, 'static', 'profile_pics')
    )
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5 MB

    # ──────────────────────────────────────────────────────────
    # 🖥️  SESSION — SQLAlchemy backed
    # ──────────────────────────────────────────────────────────
    SESSION_TYPE            = 'sqlalchemy'
    SESSION_PERMANENT       = False
    SESSION_USE_SIGNER      = True
    SESSION_KEY_PREFIX      = 'notesaver:'
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    SESSION_COOKIE_SECURE   = os.environ.get('FLASK_ENV') == 'production'
