"""AI Sana MVP. Python standard library only."""
import json
import os
import sqlite3
import hashlib
import time
import accounts
import profiles
import business_examples
import assistant_logic
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'sana.db'
FIELDS = [('context', 'Мәнмәтін және қажеттілік', 20), ('data', 'Деректер мен материалдар', 20), ('result', 'Күтілетін нәтиже', 15), ('success', 'Табыс критерийлері', 15), ('limits', 'Шектеулер', 10), ('users', 'Пайдаланушылар', 10), ('contact', 'Бизнеспен байланыс', 10)]
PROMPT = 'Бизнес сипаттамасындағы жетіспейтін мәліметтерді анықта. Кемінде 3 нақтылаушы сұрақ ұсын. Пайдаланушы айтпаған фактілерді қоспа. JSON: {questions: [{field, label, question}], mode: string}.'
QUESTIONS = {'context': 'Қазір қандай мәселе бар және нені өзгерту қажет?', 'data': 'Қандай деректер, мысалдар немесе материалдар қолжетімді?', 'result': 'Команда жұмысының соңында қандай нақты нәтиже күтесіз?', 'success': 'Нәтиженің сәттілігін қандай өлшенетін көрсеткішпен бағалайсыз?', 'limits': 'Мерзім, технология және қолжетімділік бойынша қандай шектеулер бар?', 'users': 'Бұл шешімді кімдер қолданады?', 'contact': 'Кіммен, қай арнада және қандай жиілікпен кеңесуге болады?'}

@contextmanager
def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        with db:
            yield db
    finally:
        db.close()

def rating(task):
    confirmed = bool(task.get('confirmed'))
    breakdown = [{'field': key, 'label': label, 'max': weight, 'points': weight if confirmed and str(task.get(key, '')).strip() and (key != 'context' or str(task.get('need', '')).strip()) and (key != 'contact' or str(task.get('interaction', '')).strip()) else 0} for key, label, weight in FIELDS]
    score = sum(row['points'] for row in breakdown)
    level = 'Бастапқы жоба' if score < 40 else 'Жұмысқа жарамды' if score < 70 else 'Дайын' if score < 90 else 'Басымдықты'
    return dict(score=score, level=level, breakdown=breakdown, missing=[row['label'] for row in breakdown if not row['points']])

def task_view(row):
    task = json.loads(row['body'])
    return {**task, 'id': row['id'], **rating(task)}

def initialize():
    with connect() as db:
        db.executescript('CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS proposals (id INTEGER PRIMARY KEY, task_id INTEGER REFERENCES tasks(id), team_id INTEGER REFERENCES teams(id), idea TEXT, plan TEXT, deadline TEXT, link TEXT, status TEXT DEFAULT "pending", milestone INTEGER DEFAULT 0);')
        accounts.initialize(db)
        if 'submitted' not in {r['name'] for r in db.execute('PRAGMA table_info(proposals)')}:
            db.execute('ALTER TABLE proposals ADD COLUMN submitted INTEGER DEFAULT 0')
            db.execute('UPDATE proposals SET submitted=1 WHERE milestone=1')
        if db.execute('SELECT COUNT(*) FROM tasks').fetchone()[0]:
            initialize_demo(db)
            return
        seeds = [
            ('Клиент сұрақтарына жауап беретін AI көмекші', 'Qamqor Store', 'Сауда', 'Клиенттердің қайталанатын сұрақтарына жауап беруге күніне 3 сағат кетеді.', 'Анонимдендірілген 500 сұрақ пен тауарлар каталогы.', 'Сұрақтарға жауап беретін веб-көмекші.', 'Тест сұрақтарының кемінде 80%-ына дұрыс жауап.', '2 апта. Тек анонимдендірілген деректер.', 'Дүкен клиенттері мен қолдау қызметі.', 'Айдана • demo@example.com • аптасына 2 кеңес'),
            ('Студенттердің оқу жоспарын жекелеу', 'Bilim Lab', 'Білім', 'Студенттер тақырыптарды меңгеру деңгейіне сай жаттығу таба алмайды.', '100 жасанды оқу профилі және тапсырмалар тізімі.', 'Жаттығу ұсынатын интерактивті прототип.', '20 сынақ профильге сәйкес ұсыныс.', '3 апта, қазақ тіліндегі интерфейс.', 'Студенттер және оқытушылар.', ''),
            ('Қаладағы қалдықтарды сұрыптау картасы', 'Taza Qala', 'Экология', 'Тұрғындар жақын орналасқан қабылдау орнын таба алмайды.', 'Қабылдау орындарының ашық тізімі.', 'Сүзгілері бар карта прототипі.', '', '', 'Қала тұрғындары.', 'Демо байланыс: demo@example.com'),
            ('Шағын бизнес шығындарын талдау', 'Esеп Finance', 'Қаржы', 'Ай сайынғы шығындарды қолмен топтастыру көп уақыт алады.', '', 'CSV шығындарын топтастыратын прототип.', '', '', 'Шағын бизнес иелері.', ''),
            ('Кездесуге жазылуды жеңілдету', 'Densaulyq', 'Денсаулық', 'Тіркеу бөліміндегі кезекті азайтқымыз келеді.', '', '', '', '', '', '')
        ]
        for title, company, category, *values in seeds:
            task = dict(title=title, company=company, category=category, confirmed=True, published=True, original=values[0])
            task.update({field[0]: value for field, value in zip(FIELDS, values)})
            db.execute('INSERT INTO tasks(body) VALUES (?)', (json.dumps(task, ensure_ascii=False),))
        teams = [('Qadam Team', 'AI, Сауда', 'Python, NLP, FastAPI'), ('Neural Nomads', 'Білім, AI', 'React, Python, ML'), ('Jasyl Tech', 'Экология', 'JavaScript, Maps, UX'), ('Data Jastar', 'Қаржы, Сауда', 'Python, SQL, Data analysis'), ('Densa Team', 'Денсаулық', 'Design, JavaScript, Python')]
        for name, interests, skills in teams:
            db.execute('INSERT INTO teams(body) VALUES (?)', (json.dumps(dict(name=name, interests=interests, skills=skills), ensure_ascii=False),))
        for task_id, team_id in [(1, 1), (1, 4), (2, 2), (3, 3), (5, 5)]:
            db.execute('INSERT INTO proposals(task_id,team_id,idea,plan,deadline,link) VALUES (?,?,?,?,?,?)', (task_id, team_id, 'Тапсырмаға арналған қарапайым әрі түсінікті веб-прототип ұсынамыз.', '1. Деректерді зерттеу\n2. Прототип құру\n3. Нәтижені тексеру', '14 күн', 'https://example.com/prototype'))
        initialize_demo(db)

def initialize_demo(db):
    for role in ('business', 'student'):
        username = 'sana_demo_' + role
        row = db.execute('SELECT id FROM users WHERE username=? AND demo=1', (username,)).fetchone()
        if row:
            continue
        profile = profiles.demo_profile(role)
        team_id = 1 if role == 'student' else None
        user_id = db.execute('INSERT INTO users(username,password,name,role,profile,completed,demo,team_id) VALUES (?,?,?,?,?,1,1,?)', (username, accounts.password_hash(accounts.secrets.token_urlsafe(32)), 'Демо бизнес' if role == 'business' else 'Демо студент', role, json.dumps(profile, ensure_ascii=False), team_id)).lastrowid
        if role == 'business':
            for task_row in db.execute('SELECT * FROM tasks').fetchall():
                task = json.loads(task_row['body'])
                if 'owner_id' not in task:
                    task.update(owner_id=user_id, demo=True, need=task.get('context', ''))
                    db.execute('UPDATE tasks SET body=? WHERE id=?', (json.dumps(task, ensure_ascii=False), task_row['id']))
        else:
            for team_row in db.execute('SELECT * FROM teams').fetchall():
                team = json.loads(team_row['body'])
                if 'owner_id' not in team:
                    team['demo'] = True
                    if team_row['id'] == team_id:
                        team['owner_id'] = user_id
                    db.execute('UPDATE teams SET body=? WHERE id=?', (json.dumps(team, ensure_ascii=False), team_row['id']))
    # Preserve previous user data while migrating the split context/need fields.
    for row in db.execute('SELECT * FROM tasks').fetchall():
        task = json.loads(row['body'])
        changed = False
        if 'need' not in task:
            task['need'] = task.get('context', '')
            changed = True
        if 'interaction' not in task:
            task['interaction'] = task.get('contact', '')
            changed = True
        if changed:
            db.execute('UPDATE tasks SET body=? WHERE id=?', (json.dumps(task, ensure_ascii=False), row['id']))
    business_examples.install(db)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'static'), **kwargs)

    def respond(self, payload, status=200, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path != '/api/state':
            return super().do_GET()
        with connect() as db:
            user = accounts.current_user(db, self)
            tasks = [task_view(r) for r in db.execute('SELECT * FROM tasks')]
            tasks = [t for t in tasks if t.get('published') or (user and t.get('owner_id') == user['id'])]
            teams = [{**json.loads(r['body']), 'id': r['id']} for r in db.execute('SELECT * FROM teams')]
            proposals = [dict(r) for r in db.execute('SELECT * FROM proposals')]
            for task in tasks:
                task['proposal_count'] = sum(1 for proposal in proposals if proposal['task_id'] == task['id'])
            for team in teams:
                team['points'] = sum(10 for p in proposals if p['team_id'] == team['id'] and p['milestone'])
            own_tasks = {t['id'] for t in tasks if user and t.get('owner_id') == user['id']}
            proposals = [p for p in proposals if user and (p['task_id'] in own_tasks or p['team_id'] == user['team_id'])]
        self.respond(dict(tasks=tasks, teams=teams, proposals=proposals, fields=FIELDS, aiMode='local-demo', user=user, profileFields=profiles.schema(user['role']) if user else []))

    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                return self.respond({'error': 'Басқа сайттан сұраныс қабылданбайды.'}, 403)
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.respond({'error': 'JSON сұранысы қажет.'}, 415)
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 6_000_000:
                raise ValueError('Сұраныс тым үлкен.')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('JSON объектісі қажет.')
            self.route(urlparse(self.path).path, payload)
        except (ValueError, TypeError, KeyError) as exc:
            self.respond({'error': str(exc) or 'Деректерді тексеріңіз.'}, 400)
        except sqlite3.IntegrityError:
            self.respond({'error': 'Тапсырма немесе команда табылмады.'}, 400)

    def route(self, path, p):
        if path == '/api/demo':
            if p.get('role') not in ('business', 'student'):
                raise ValueError('Демо рөлін таңдаңыз.')
            with connect() as db:
                row = db.execute('SELECT * FROM users WHERE username=? AND demo=1', ('sana_demo_' + p['role'],)).fetchone()
                cookie = accounts.new_session(db, row['id'])
            return self.respond({'user': accounts.public_user(row)}, cookie=cookie)
        if path in ('/api/register', '/api/login'):
            attempts = getattr(self.server, 'auth_attempts', {})
            self.server.auth_attempts = attempts
            now = time.time()
            recent = [stamp for stamp in attempts.get(self.client_address[0], []) if now - stamp < 60]
            attempts[self.client_address[0]] = recent
            if len(recent) >= 15:
                return self.respond({'error': 'Әрекет тым көп. Бір минуттан кейін қайталаңыз.'}, 429)
            recent.append(now)
            with connect() as db:
                user_id = accounts.register(db, p) if path == '/api/register' else accounts.login(db, p)
                row = db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
                if row['role'] == 'student' and row['team_id'] is None:
                    team_id = db.execute('INSERT INTO teams(body) VALUES (?)', (json.dumps(dict(name=row['name'], interests='Жаңа команда', skills='Профильде толықтырыңыз', owner_id=user_id), ensure_ascii=False),)).lastrowid
                    db.execute('UPDATE users SET team_id=? WHERE id=?', (team_id, user_id))
                user = accounts.public_user(db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone())
                cookie = accounts.new_session(db, user_id)
            return self.respond({'user': user}, cookie=cookie)
        if path == '/api/logout':
            with connect() as db:
                db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(accounts.token_from(self).encode()).hexdigest(),))
            return self.respond({'ok': True}, cookie='sana_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
        with connect() as db:
            user = accounts.current_user(db, self)
        if not user:
            return self.respond({'error': 'Алдымен аккаунтыңызға кіріңіз.'}, 401)
        if path == '/api/profile':
            name, bio = str(p.get('name', '')).strip(), str(p.get('bio', '')).strip()
            if not name or len(name) > 80 or len(bio) > 500:
                raise ValueError('Атау 1–80, сипаттама 0–500 таңба болуы керек.')
            if user['role'] == 'student' and not bio:
                raise ValueError('Өзіңіз жайлы қысқаша мәлімет енгізіңіз.')
            avatar = accounts.validate_image(p.get('avatar', user['avatar']))
            profile = profiles.validate(user['role'], p.get('profile', {}))
            with connect() as db:
                db.execute('UPDATE users SET name=?, bio=?, avatar=?, profile=?, completed=1 WHERE id=?', (name, bio, avatar, json.dumps(profile, ensure_ascii=False), user['id']))
                if user['team_id']:
                    team = dict(name=profile['team_name'], skills=profile['team_skills'], technologies=profile['team_technologies'], interests=profile['interests'], members=profile['members'], avatar=avatar, owner_id=user['id'], demo=bool(user['demo']))
                    db.execute('UPDATE teams SET body=? WHERE id=?', (json.dumps(team, ensure_ascii=False), user['team_id']))
            return self.respond({'ok': True})
        if not user['completed']:
            return self.respond({'error': 'Жалғастыру үшін алдымен профиліңізді толтырыңыз.'}, 403)
        if path in ('/api/tasks', '/api/decision', '/api/milestone') and user['role'] != 'business':
            return self.respond({'error': 'Бұл әрекет тек бизнес аккаунтына қолжетімді.'}, 403)
        if path == '/api/assist':
            description = str(p.get('description', '')).strip()
            if len(description) < 10:
                raise ValueError('Сипаттама кемінде 10 таңбадан тұруы керек.')
            analysis = assistant_logic.analyze(description)
            return self.respond(dict(mode='local-demo', **analysis, potential_score=rating({**analysis['fields'], 'confirmed': True})['score'], prompt=PROMPT))
        if path == '/api/tasks':
            allowed = ['title', 'company', 'category', 'original', 'need', 'interaction'] + [f[0] for f in FIELDS]
            task = {k: str(p.get(k, '')).strip() for k in allowed}
            task['owner_id'] = user['id']
            task['demo'] = bool(user['demo'])
            if not task['title'] or not task['company'] or len(task['context']) < 10:
                raise ValueError('Атауын, ұйымды және кемінде 10 таңбалы сипаттаманы толтырыңыз.')
            if any(len(v) > 10000 for v in task.values() if isinstance(v, str)):
                raise ValueError('Өрістің ұзындығы 10000 таңбадан аспауы керек.')
            task.update(confirmed=p.get('confirmed') is True, published=p.get('published') is True)
            task['image'] = accounts.validate_image(p.get('image', ''))
            if task['published'] and not task['confirmed']:
                raise ValueError('Жариялау алдында мәліметтерді растаңыз.')
            with connect() as db:
                if p.get('id'):
                    task_id = int(p['id'])
                    previous = db.execute('SELECT body FROM tasks WHERE id=?', (task_id,)).fetchone()
                    if not previous or json.loads(previous['body']).get('owner_id') != user['id']:
                        return self.respond({'error': 'Басқа пайдаланушының тапсырмасын өзгерте алмайсыз.'}, 403)
                    if json.loads(previous['body']).get('example_key'):
                        task['example_key'] = json.loads(previous['body'])['example_key']
                    cursor = db.execute('UPDATE tasks SET body=? WHERE id=?', (json.dumps(task, ensure_ascii=False), task_id))
                    if not cursor.rowcount:
                        raise ValueError('Тапсырма табылмады.')
                else:
                    task_id = db.execute('INSERT INTO tasks(body) VALUES (?)', (json.dumps(task, ensure_ascii=False),)).lastrowid
            return self.respond({**task, 'id': task_id, **rating(task)})
        if path == '/api/proposals':
            if user['role'] != 'student' or p.get('team_id') != user['team_id']:
                return self.respond({'error': 'Ұсынысты тек өз командаңыздың атынан жіберіңіз.'}, 403)
            values = [str(p.get(k, '')).strip() for k in ['idea', 'plan', 'deadline', 'link']]
            if not all(values[:3]) or any(len(v) > 10000 for v in values):
                raise ValueError('Идеяны, жоспарды және мерзімді толтырыңыз (ең көбі 10000 таңба).')
            link = urlparse(values[3])
            if values[3] and (link.scheme not in ('http', 'https') or not link.netloc):
                raise ValueError('Прототипке жарамды http немесе https сілтемесін енгізіңіз.')
            with connect() as db:
                row = db.execute('SELECT * FROM tasks WHERE id=?', (p['task_id'],)).fetchone()
                if not row or not json.loads(row['body']).get('published'):
                    raise ValueError('Тек жарияланған тапсырмаға ұсыныс жіберуге болады.')
                db.execute('INSERT INTO proposals(task_id,team_id,idea,plan,deadline,link) VALUES (?,?,?,?,?,?)', (p['task_id'], p['team_id'], *values))
            return self.respond({'ok': True})
        if path == '/api/submit-prototype':
            with connect() as db:
                row = db.execute('SELECT * FROM proposals WHERE id=?', (p['id'],)).fetchone()
                if not row or user['role'] != 'student' or row['team_id'] != user['team_id']:
                    return self.respond({'error': 'Тек өз жобаңызға прототип ұсына аласыз.'}, 403)
                if row['status'] != 'accepted':
                    raise ValueError('Алдымен бизнес командаңызды таңдауы керек.')
                link = str(p.get('link', '')).strip()
                parsed = urlparse(link)
                if parsed.scheme not in ('http', 'https') or not parsed.netloc or len(link) > 2000:
                    raise ValueError('Прототиптің http немесе https сілтемесін енгізіңіз.')
                if row['milestone']:
                    raise ValueError('Бұл кезең расталып қойған.')
                db.execute('UPDATE proposals SET submitted=1,link=? WHERE id=?', (link, p['id']))
            return self.respond({'ok': True})
        if path == '/api/decision':
            if p.get('status') not in ('accepted', 'rejected', 'pending'):
                raise ValueError('Мәртебе қате.')
            with connect() as db:
                if not self.owns_proposal(db, p['id'], user):
                    return self.respond({'error': 'Бұл ұсынысты басқаруға рұқсат жоқ.'}, 403)
                cursor = db.execute('UPDATE proposals SET status=? WHERE id=?', (p['status'], p['id']))
                if not cursor.rowcount:
                    raise ValueError('Ұсыныс табылмады.')
            return self.respond({'ok': True})
        if path == '/api/milestone':
            with connect() as db:
                if not self.owns_proposal(db, p['id'], user):
                    return self.respond({'error': 'Бұл кезеңді растауға рұқсат жоқ.'}, 403)
                row = db.execute('SELECT * FROM proposals WHERE id=?', (p['id'],)).fetchone()
                if not row or row['status'] != 'accepted':
                    raise ValueError('Алдымен команданы таңдаңыз.')
                if not row['submitted']:
                    raise ValueError('Алдымен студент прототипті ұсынуы керек.')
                db.execute('UPDATE proposals SET milestone=1 WHERE id=?', (p['id'],))
            return self.respond({'ok': True})
        self.respond({'error': 'Маршрут табылмады.'}, 404)

    def owns_proposal(self, db, proposal_id, user):
        row = db.execute('SELECT tasks.body FROM proposals JOIN tasks ON tasks.id=proposals.task_id WHERE proposals.id=?', (proposal_id,)).fetchone()
        return row and json.loads(row['body']).get('owner_id') == user['id']

if __name__ == '__main__':
    initialize()
    port = int(os.environ.get('PORT', '8000'))
    print(f'Sana Quest: http://localhost:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
