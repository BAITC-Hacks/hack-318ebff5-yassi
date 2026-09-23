import json
import tempfile
import threading
import secrets
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class RatingTests(unittest.TestCase):
    def test_confirmation_and_weights(self):
        task = {key: 'Мәлімет' for key, _, _ in server.FIELDS}
        self.assertEqual(server.rating(task)['score'], 0)
        task['confirmed'] = True
        self.assertEqual(server.rating(task)['score'], 100)
        task['data'] = '   '
        self.assertEqual(server.rating(task)['score'], 80)
        self.assertIn('Деректер мен материалдар', server.rating(task)['missing'])

    def test_levels(self):
        for keys, expected in [([], 'Алғашқы нұсқа'), (['context', 'data'], 'Жұмысқа жарамды'), (['context', 'data', 'result', 'success'], 'Дайын'), (['context', 'data', 'result', 'success', 'limits', 'users'], 'Басымдық берілген')]:
            self.assertEqual(server.rating(dict(confirmed=True, **{key:'x' for key in keys}))['level'], expected)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.cookie = ''
        self.http.auth_attempts = {}
        self.username = 'user_' + secrets.token_hex(5)
        self.business = self.call('register', dict(username=self.username, password='Test-password-123', name='Бизнес', role='business'))['user']
        self.business_cookie = self.cookie

    def student(self):
        self.cookie = ''
        return self.call('register', dict(username='student_' + secrets.token_hex(5), password='Test-password-123', name='Команда', role='student'))['user']

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=server.ROOT)
        cls.original_db = server.DB
        server.DB = Path(cls.temp.name) / 'test.db'
        server.initialize()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}/api/'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        server.DB = cls.original_db
        cls.temp.cleanup()

    def call(self, path, data=None, status=200):
        request = Request(self.base + path, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type':'application/json', 'Cookie': self.cookie})
        try:
            response = urlopen(request)
        except HTTPError as error:
            response = error
        with response:
            self.assertEqual(response.status, status)
            if response.headers.get('Set-Cookie'):
                self.cookie = response.headers['Set-Cookie'].split(';')[0]
            return json.load(response)

    def test_complete_workflow_and_persistence(self):
        answer = self.call('assist', {'description':'Клиенттердің сұрақтарына көп уақыт жұмсаймыз.'})
        self.assertGreaterEqual(len(answer['questions']), 3)
        self.assertEqual(answer['context'], 'Клиенттердің сұрақтарына көп уақыт жұмсаймыз.')
        draft = dict(title='Тест тапсырма', company='Тест ұйым', context=answer['context'], confirmed=False, published=True)
        self.call('tasks', draft, status=400)
        draft.update(confirmed=True)
        created = self.call('tasks', draft)
        self.assertEqual(created['score'], 20)
        student = self.student()
        self.call('proposals', dict(task_id=created['id'], team_id=student['team_id'], idea='Идея', plan='Жоспар', deadline='1 апта', link='javascript:alert(1)'), status=400)
        self.call('proposals', dict(task_id=created['id'], team_id=student['team_id'], idea='Идея', plan='Жоспар', deadline='1 апта', link='https://example.com/test'))
        state = self.call('state')
        proposal = next(p for p in state['proposals'] if p['task_id'] == created['id'])
        self.assertEqual(proposal['status'], 'pending')
        self.call('decision', {'id': proposal['id'], 'status':'accepted'}, status=403)
        self.cookie = self.business_cookie
        self.call('milestone', {'id': proposal['id']}, status=400)
        self.call('decision', {'id': proposal['id'], 'status':'accepted'})
        self.call('milestone', {'id': proposal['id']})
        self.call('milestone', {'id': proposal['id']})
        created.update({key:'Толық мәлімет' for key, _, _ in server.FIELDS})
        edited = self.call('tasks', created)
        self.assertEqual(edited['score'], 100)
        server.initialize()
        persisted = self.call('state')
        self.assertEqual(next(t for t in persisted['tasks'] if t['id']==created['id'])['score'], 100)
        self.assertEqual(next(p for p in persisted['proposals'] if p['id']==proposal['id'])['milestone'], 1)

    def test_draft_cannot_receive_proposals(self):
        draft = self.call('tasks', dict(title='Жоба', company='Ұйым', context='Әлі жарияланбаған жоба', confirmed=False, published=False))
        student = self.student()
        self.assertNotIn(draft['id'], [t['id'] for t in self.call('state')['tasks']])
        self.call('proposals', dict(task_id=draft['id'], team_id=student['team_id'], idea='Идея', plan='Жоспар', deadline='1 апта', link='https://example.com'), status=400)

    def test_assist_rejects_empty_input(self):
        self.call('assist', {'description':''}, status=400)

    def test_login_logout_and_private_password(self):
        self.assertNotIn('password', self.call('state')['user'])
        self.call('logout', {})
        self.assertIsNone(self.call('state')['user'])
        self.call('assist', {'description':'Маңызды тапсырма сипаттамасы'}, status=401)
        self.call('login', dict(username=self.username, password='wrong'), status=400)
        user = self.call('login', dict(username=self.username, password='Test-password-123'))['user']
        self.assertEqual(user['id'], self.business['id'])
        with server.connect() as db:
            stored = db.execute('SELECT password FROM users WHERE id=?', (user['id'],)).fetchone()[0]
            self.assertNotIn('Test-password-123', stored)

    def test_ownership_and_images(self):
        image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
        draft = dict(title='Суретті тапсырма', company='Ұйым', context='Суреті бар жаңа тапсырма', image=image, confirmed=True, published=True)
        created = self.call('tasks', draft)
        self.assertEqual(created['image'], image)
        self.call('profile', dict(name='Жаңа атау', bio='Сәлем!', avatar=image))
        self.assertEqual(self.call('state')['user']['avatar'], image)
        self.call('profile', dict(name='Атау', bio='', avatar='data:image/svg+xml;base64,PHN2Zz4='), status=400)
        self.call('tasks', {**created, 'image':'data:image/png;base64,YmFk'}, status=400)
        self.student()
        self.call('tasks', created, status=403)
        self.cookie = ''
        self.call('register', dict(username='other_' + secrets.token_hex(5), password='Test-password-123', name='Басқа бизнес', role='business'))
        self.call('tasks', created, status=403)
        seed = self.call('state')['tasks'][0]
        self.call('tasks', seed, status=403)

    def test_duplicate_username_and_wrong_team(self):
        self.call('register', dict(username=self.username, password='Test-password-123', name='Көшірме', role='business'), status=400)
        self.student()
        self.call('proposals', dict(task_id=1, team_id=1, idea='Идея', plan='Жоспар', deadline='1 күн', link='https://example.com'), status=403)


if __name__ == '__main__':
    unittest.main()
