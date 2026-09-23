import json
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
        task['need'] = 'Қажеттілік'
        task['interaction'] = 'Онлайн, аптасына бір рет'
        self.assertEqual(server.rating(task)['score'], 0)
        task['confirmed'] = True
        self.assertEqual(server.rating(task)['score'], 100)
        task['data'] = '   '
        self.assertEqual(server.rating(task)['score'], 80)
        self.assertIn('Деректер мен материалдар', server.rating(task)['missing'])

    def test_levels(self):
        for keys, expected in [([], 'Бастапқы жоба'), (['context', 'data'], 'Жұмысқа жарамды'), (['context', 'data', 'result', 'success'], 'Дайын'), (['context', 'data', 'result', 'success', 'limits', 'users'], 'Басымдықты')]:
            self.assertEqual(server.rating(dict(confirmed=True, need='Мәселе', **{key:'x' for key in keys}))['level'], expected)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.cookie = ''
        self.http.auth_attempts = {}
        self.username = 'user_' + secrets.token_hex(5)
        self.email = self.username + '@example.com'
        self.business = self.register(self.email, 'business')
        self.complete_profile('business')
        self.business_cookie = self.cookie

    def register(self, email, role):
        return self.call('register', dict(email=email, password='Test-password-123', password_confirm='Test-password-123', name='Тест пайдаланушы', role=role))['user']

    def complete_profile(self, role):
        self.call('profile', dict(name='Тест пайдаланушы', bio='Тест сипаттама', profile=server.profiles.demo_profile(role)))

    def student(self):
        self.cookie = ''
        user = self.register('student_' + secrets.token_hex(5) + '@example.com', 'student')
        self.complete_profile('student')
        return user

    @classmethod
    def setUpClass(cls):
        cls.original_db = server.DB
        cls.test_path = server.ROOT / ('.sana-test-' + secrets.token_hex(8) + '.db')
        server.DB = cls.test_path
        server.initialize()
        class QuietHandler(server.Handler):
            def log_message(self, *args):
                pass
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}/api/'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        server.DB = cls.original_db
        cls.test_path.unlink()

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
        draft = dict(title='Тест тапсырма', company='Тест ұйым', context=answer['context'], need='Қолдау қызметін автоматтандыру', confirmed=False, published=True)
        self.call('tasks', draft, status=400)
        draft.update(confirmed=True)
        created = self.call('tasks', draft)
        self.assertEqual(created['score'], 20)
        student = self.student()
        student_cookie = self.cookie
        self.call('proposals', dict(task_id=created['id'], team_id=student['team_id'], idea='Идея', plan='Жоспар', deadline='1 апта', link='javascript:alert(1)'), status=400)
        self.call('proposals', dict(task_id=created['id'], team_id=student['team_id'], idea='Идея', plan='Жоспар', deadline='1 апта', link='https://example.com/test'))
        state = self.call('state')
        proposal = next(p for p in state['proposals'] if p['task_id'] == created['id'])
        self.assertEqual(proposal['status'], 'pending')
        self.call('decision', {'id': proposal['id'], 'status':'accepted'}, status=403)
        self.cookie = self.business_cookie
        self.call('milestone', {'id': proposal['id']}, status=400)
        self.call('decision', {'id': proposal['id'], 'status':'accepted'})
        self.call('milestone', {'id': proposal['id']}, status=400)
        self.cookie = student_cookie
        self.call('submit-prototype', {'id': proposal['id'], 'link':'https://example.com/prototype'})
        self.cookie = self.business_cookie
        self.call('milestone', {'id': proposal['id']})
        self.call('milestone', {'id': proposal['id']})
        created.update({key:'Толық мәлімет' for key, _, _ in server.FIELDS})
        created['interaction'] = 'Онлайн, аптасына бір рет'
        edited = self.call('tasks', created)
        self.assertEqual(edited['score'], 100)
        server.initialize()
        persisted = self.call('state')
        self.assertEqual(next(t for t in persisted['tasks'] if t['id']==created['id'])['score'], 100)
        self.assertEqual(next(p for p in persisted['proposals'] if p['id']==proposal['id'])['milestone'], 1)
        self.assertEqual(next(t for t in persisted['teams'] if t['id']==student['team_id'])['points'], 10)

    def test_draft_cannot_receive_proposals(self):
        draft = self.call('tasks', dict(title='Жоба', company='Ұйым', context='Әлі жарияланбаған жоба', confirmed=False, published=False))
        student = self.student()
        self.assertNotIn(draft['id'], [t['id'] for t in self.call('state')['tasks']])
        self.call('proposals', dict(task_id=draft['id'], team_id=student['team_id'], idea='Идея', plan='Жоспар', deadline='1 апта', link='https://example.com'), status=400)

    def test_assist_rejects_empty_input(self):
        self.call('assist', {'description':''}, status=400)

    def test_assistant_extracts_only_explicit_facts(self):
        description = 'Кіріс пен шығысты есептеу керек.\nДеректер: 100 жасанды CSV жазбасы\nНәтиже: Есеп панелі'
        result = self.call('assist', {'description': description})
        self.assertEqual(result['fields']['data'], '100 жасанды CSV жазбасы')
        self.assertEqual(result['fields']['result'], 'Есеп панелі')
        self.assertNotIn('contact', result['fields'])
        self.assertNotIn('data', [q['field'] for q in result['questions']])
        self.assertGreaterEqual(len(result['questions']), 3)
        self.assertEqual(result['potential_score'], 35)

    def test_business_examples_are_idempotent_and_editable(self):
        self.call('demo', {'role': 'business'})
        examples = [t for t in self.call('state')['tasks'] if t.get('example_key')]
        self.assertEqual(len(examples), 5)
        self.assertEqual({t['category'] for t in examples}, {'Қаржы', 'Салық және комиссия', 'Субсидиялар', 'Экспорт', 'Импорт'})
        example = examples[0]
        example['title'] = 'Өңделген қаржы кейсі'
        self.call('tasks', example)
        server.initialize()
        after = [t for t in self.call('state')['tasks'] if t.get('example_key')]
        self.assertEqual(len(after), 5)
        self.assertEqual(next(t for t in after if t['id']==example['id'])['title'], 'Өңделген қаржы кейсі')

    def test_initial_draft_is_saved_before_clarification(self):
        draft = self.call('tasks', dict(title='Кіріс шығыс', company='Тест', context='Кіріс пен шығысты бірге есептегім келеді.', confirmed=False, published=False))
        self.assertEqual(draft['score'], 0)
        self.assertIn(draft['id'], [t['id'] for t in self.call('state')['tasks']])
        analysis = self.call('assist', {'description': draft['context']})
        self.assertGreaterEqual(len(analysis['questions']), 3)
        self.cookie = ''
        self.assertNotIn(draft['id'], [t['id'] for t in self.call('state')['tasks']])

    def test_login_logout_and_private_password(self):
        self.assertNotIn('password', self.call('state')['user'])
        self.call('logout', {})
        self.assertIsNone(self.call('state')['user'])
        self.call('assist', {'description':'Маңызды тапсырма сипаттамасы'}, status=401)
        self.call('login', dict(email=self.email, password='wrong'), status=400)
        user = self.call('login', dict(email=self.email, password='Test-password-123'))['user']
        self.assertEqual(user['id'], self.business['id'])
        with server.connect() as db:
            stored = db.execute('SELECT password FROM users WHERE id=?', (user['id'],)).fetchone()[0]
            self.assertNotIn('Test-password-123', stored)

    def test_ownership_and_images(self):
        image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
        draft = dict(title='Суретті тапсырма', company='Ұйым', context='Суреті бар жаңа тапсырма', image=image, confirmed=True, published=True)
        created = self.call('tasks', draft)
        self.assertEqual(created['image'], image)
        self.call('profile', dict(name='Жаңа атау', bio='Сәлем!', avatar=image, profile=server.profiles.demo_profile('business')))
        self.assertEqual(self.call('state')['user']['avatar'], image)
        self.call('profile', dict(name='Атау', bio='', avatar='data:image/svg+xml;base64,PHN2Zz4='), status=400)
        self.call('tasks', {**created, 'image':'data:image/png;base64,YmFk'}, status=400)
        self.student()
        self.call('tasks', created, status=403)
        self.cookie = ''
        self.register('other_' + secrets.token_hex(5) + '@example.com', 'business')
        self.complete_profile('business')
        self.call('tasks', created, status=403)
        seed = self.call('state')['tasks'][0]
        self.call('tasks', seed, status=403)

    def test_duplicate_username_and_wrong_team(self):
        self.call('register', dict(email=self.email, password='Test-password-123', password_confirm='Test-password-123', name='Көшірме', role='business'), status=400)
        self.student()
        self.call('proposals', dict(task_id=1, team_id=1, idea='Идея', plan='Жоспар', deadline='1 күн', link='https://example.com'), status=403)

    def test_onboarding_validation_and_private_profile(self):
        email = 'new_' + secrets.token_hex(5) + '@example.com'
        self.call('register', dict(email=email, password='Test-password-123', password_confirm='different', name='Аты', role='business'), status=400)
        user = self.register(email, 'business')
        self.assertFalse(user['completed'])
        self.call('tasks', dict(title='Жоба'), status=403)
        self.call('profile', dict(name='Аты', profile={}), status=400)
        profile = server.profiles.demo_profile('business')
        profile['contact_email'] = 'private-contact@example.com'
        self.call('profile', dict(name='Аты', profile=profile))
        self.assertTrue(self.call('state')['user']['completed'])
        self.call('tasks', dict(title='Жеке жоба', company='Компания', context='Жұмыс үдерісін жақсарту', need='Нақты мәселе', confirmed=True, published=True))
        self.cookie = ''
        public = self.call('state')
        self.assertNotIn('private-contact@example.com', json.dumps(public))
        self.assertIsNone(public['user'])

    def test_demo_workflow_optional_link_and_rating_independence(self):
        business = self.call('demo', {'role':'business'})['user']
        self.assertTrue(business['demo'])
        self.assertGreaterEqual(len(self.call('state')['proposals']), 5)
        task = self.call('tasks', dict(title='Демо сценарий', company='Демо ұйым', context='Жұмыс үдерісін жақсарту', need='Жауап беру уақыты ұзақ', confirmed=True, published=True))
        self.assertEqual(task['score'], 20)
        self.assertTrue(task['demo'])
        self.complete_profile('business')
        self.assertEqual(next(t for t in self.call('state')['tasks'] if t['id']==task['id'])['score'], 20)
        student = self.call('demo', {'role':'student'})['user']
        self.call('proposals', dict(task_id=task['id'], team_id=student['team_id'], idea='Идея', plan='Жоспар', deadline='1 күн', link=''))
        proposal = next(p for p in self.call('state')['proposals'] if p['task_id']==task['id'])
        self.call('demo', {'role':'business'})
        self.call('decision', {'id':proposal['id'], 'status':'accepted'})
        self.call('demo', {'role':'student'})
        self.assertEqual(next(p for p in self.call('state')['proposals'] if p['id']==proposal['id'])['status'], 'accepted')
        self.call('submit-prototype', {'id':proposal['id'], 'link':'https://example.com/demo'})
        self.call('demo', {'role':'business'})
        self.call('milestone', {'id':proposal['id']})
        before = next(t for t in self.call('state')['teams'] if t['id']==student['team_id'])['points']
        self.call('milestone', {'id':proposal['id']})
        after = next(t for t in self.call('state')['teams'] if t['id']==student['team_id'])['points']
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()
