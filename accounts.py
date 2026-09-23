"""Local accounts, password hashing, sessions and image validation."""
import base64
import hashlib
import hmac
import re
import secrets
import time
from http.cookies import SimpleCookie


def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
            bio TEXT DEFAULT '', avatar TEXT DEFAULT '', team_id INTEGER REFERENCES teams(id)
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER
        );
    ''')


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()
    return salt + ':' + digest


def public_user(row):
    return {key: row[key] for key in ['id', 'username', 'name', 'role', 'bio', 'avatar', 'team_id']}


def token_from(handler):
    cookie = SimpleCookie()
    try:
        cookie.load(handler.headers.get('Cookie', ''))
        return cookie['sana_session'].value if 'sana_session' in cookie else ''
    except Exception:
        return ''


def current_user(db, handler):
    token = hashlib.sha256(token_from(handler).encode()).hexdigest()
    row = db.execute('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?', (token, int(time.time()))).fetchone()
    return public_user(row) if row else None


def new_session(db, user_id):
    token = secrets.token_urlsafe(32)
    db.execute('DELETE FROM sessions WHERE expires<=?', (int(time.time()),))
    db.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + 7 * 86400))
    return f'sana_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'


def validate_image(value):
    if not value:
        return ''
    if not isinstance(value, str) or len(value) > 2_800_000:
        raise ValueError('Сурет көлемі 2 МБ-тан аспауы керек.')
    match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', value)
    if not match:
        raise ValueError('PNG, JPEG немесе WebP суретін таңдаңыз.')
    try:
        raw = base64.b64decode(match[2], validate=True)
    except ValueError:
        raise ValueError('Сурет деректері қате.')
    valid = (match[1] == 'png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (match[1] == 'jpeg' and raw.startswith(b'\xff\xd8\xff')) or (match[1] == 'webp' and raw.startswith(b'RIFF') and raw[8:12] == b'WEBP')
    if not valid or len(raw) > 2 * 1024 * 1024:
        raise ValueError('Сурет форматы немесе көлемі жарамсыз.')
    return value


def register(db, payload):
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))
    name = str(payload.get('name', '')).strip()
    role = payload.get('role')
    if not re.fullmatch(r'[a-z0-9_.]{3,30}', username):
        raise ValueError('Логин: 3–30 латын әрпі, сан, нүкте немесе төменгі сызық.')
    if not 8 <= len(password) <= 128:
        raise ValueError('Құпиясөз 8–128 таңбадан тұруы керек.')
    if not name or len(name) > 80 or role not in ('business', 'student'):
        raise ValueError('Атыңызды және аккаунт түрін дұрыс көрсетіңіз.')
    if db.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone():
        raise ValueError('Бұл логин бос емес. Басқа логин таңдаңыз.')
    return db.execute('INSERT INTO users(username,password,name,role) VALUES (?,?,?,?)', (username, password_hash(password), name, role)).lastrowid


def login(db, payload):
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))
    if len(password) > 128:
        raise ValueError('Логин немесе құпиясөз қате.')
    row = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
    stored = row['password'] if row else password_hash('invalid', '0' * 32)
    candidate = password_hash(password, stored.split(':')[0])
    if not row or not hmac.compare_digest(candidate, stored):
        raise ValueError('Логин немесе құпиясөз қате.')
    return row['id']
