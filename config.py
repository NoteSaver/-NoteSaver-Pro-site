import os
from dotenv import load_dotenv

# .env ko config.py khud load karta hai — is tarah _require_env()
# hamesha .env padh chuka hota hai, chahe app.py mein load_dotenv()
# pehle call ho ya na ho.
load_dotenv()

basedir = os.path.abspath(os.path.dirname(__file__))


def _require_env(key: str) -> str:
    """
    Startup pe clear error deta hai agar koi required secret .env mein missing ho.
    App tab tak start nahi hogi jab tak value set na ho.
    """
    val = os.environ.get(key, '').strip()
    if not val:
        raise RuntimeError(
            f"\n\n❌  MISSING REQUIRED ENVIRONMENT VARIABLE: '{key}'\n"
            f"    .env file mein '{key}=' set karo.\n"
            f"    App tab tak start nahi hogi.\n"
        )
    return val


class Config:
    # ──────────────────────────────────────────────────────────
    # 🔐 SECRET KEY
    # ──────────────────────────────────────────────────────────
    # Generate karo:  python -c "import secrets; print(secrets.token_hex(32))"
    SECRET_KEY = _require_env('SECRET_KEY')

    # ──────────────────────────────────────────────────────────
    # 🗄️  DATABASE
    # ──────────────────────────────────────────────────────────
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:////tmp/notes.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ──────────────────────────────────────────────────────────
    # 🛡️  SECURITY
    # ──────────────────────────────────────────────────────────
    WTF_CSRF_ENABLED = True
    RATELIMIT_HEADERS_ENABLED = True

    # ──────────────────────────────────────────────────────────
    # 📧  EMAIL  (Flask-Mail)
    # Port 465 + SSL = Render pe kaam karta hai (587/TLS blocked hai)
    # ──────────────────────────────────────────────────────────
    MAIL_SERVER  = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT    = int(os.environ.get('MAIL_PORT', 465))       # 587 → 465
    MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'False').lower() == 'true'  # False
    MAIL_USE_SSL = os.environ.get('MAIL_USE_SSL', 'True').lower()  == 'true'  # True
    MAIL_TIMEOUT = int(os.environ.get('MAIL_TIMEOUT', 10))     # 10s max — worker timeout se bachao

    # Username aur password MUST be in .env — no hardcoded fallback.
    MAIL_USERNAME       = _require_env('MAIL_USERNAME')
    MAIL_PASSWORD       = _require_env('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER') or MAIL_USERNAME

    # ──────────────────────────────────────────────────────────
    # ⚡ RATE LIMITING
    # ──────────────────────────────────────────────────────────
    RATE_LIMIT_IP_WHITELIST = []
    ADMIN_RATE_LIMIT_ENFORCED_ENDPOINTS = [
        'login', 'register', 'verify_note_password',
        'forgot_password', 'reset_password', 'api_reset_note_password'
    ]
