"""Profile schema: private fields never enter the public task catalog."""
import re
from urllib.parse import urlparse
import accounts

COMMON = [('city', 'Қала', True)]
BUSINESS = [('position', 'Лауазым', True), ('contact_email', 'Байланыс электрондық поштасы', True), ('phone', 'Телефон нөмірі', False), ('company', 'Компания атауы', True), ('industry', 'Компания саласы', True), ('description', 'Компанияның қысқаша сипаттамасы', True), ('website', 'Сайт немесе әлеуметтік желі', False), ('channel', 'Байланыс тәсілі', True), ('consultation', 'Кеңес беру форматы', True), ('availability', 'Кездесуге қолайлы уақыт', True), ('feedback', 'Кері байланыс беру тәртібі', True)]
STUDENT = [('university', 'Оқу орны', True), ('specialty', 'Мамандық', True), ('year', 'Курс', True), ('skills', 'Жеке дағдылар', True), ('technologies', 'Қолданатын технологиялар', True), ('interests', 'Қызығушылық бағыттары', True), ('github', 'GitHub сілтемесі', False), ('portfolio', 'Портфолио сілтемесі', False), ('team_name', 'Команда атауы', True), ('members', 'Команда мүшелері', True), ('team_skills', 'Команданың дағдылары', True), ('team_technologies', 'Команданың технологиялары', True)]

def schema(role):
    return COMMON + (BUSINESS if role == 'business' else STUDENT)

def validate(role, payload):
    if not isinstance(payload, dict):
        raise ValueError('Профиль мәліметтерін дұрыс енгізіңіз.')
    result = {}
    for key, label, required in schema(role):
        value = str(payload.get(key, '')).strip()
        if required and not value:
            raise ValueError(f'«{label}» өрісін толтырыңыз.')
        if len(value) > 1000:
            raise ValueError(f'«{label}» өрісі тым ұзын (ең көбі 1000 таңба).')
        if value and key in ('website', 'github', 'portfolio'):
            url = urlparse(value)
            if url.scheme not in ('https', 'http') or not url.netloc:
                raise ValueError(f'«{label}»: http немесе https сілтемесін енгізіңіз.')
        if key == 'contact_email' and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Байланыс поштасын дұрыс енгізіңіз.')
        if key == 'consultation' and value not in ('Онлайн', 'Офлайн'):
            raise ValueError('Кеңес форматын таңдаңыз.')
        result[key] = value
    if role == 'business':
        result['logo'] = accounts.validate_image(payload.get('logo', ''))
    return result

def demo_profile(role):
    if role == 'business':
        return dict(city='Алматы', position='Жоба үйлестірушісі', contact_email='business@example.com', phone='', company='Демо бизнес', industry='Білім және технология', description='Хакатонға арналған синтетикалық ұйым.', website='', channel='Платформадағы ұсыныстар', consultation='Онлайн', availability='Жұмыс күндері 15:00–17:00', feedback='Аптасына бір рет демо шолу', logo='')
    return dict(city='Алматы', university='Демо оқу орны', specialty='Ақпараттық жүйелер', year='3', skills='Талдау, интерфейс әзірлеу', technologies='Python, JavaScript', interests='Білім, AI', github='', portfolio='', team_name='Qadam Team · демо', members='Демо қатысушы 1, Демо қатысушы 2', team_skills='Деректер талдауы, веб әзірлеу', team_technologies='Python, JavaScript')
