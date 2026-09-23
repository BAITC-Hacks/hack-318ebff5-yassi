"""Deterministic local assistant. Extracts explicitly labelled facts only."""
import re

LABELS = {
    'context': ['мәнмәтін', 'контекст'],
    'need': ['қажеттілік', 'мәселе'],
    'data': ['деректер', 'материалдар'],
    'result': ['нәтиже', 'күтілетін нәтиже'],
    'success': ['табыс критерийлері', 'критерий'],
    'limits': ['шектеулер', 'мерзім'],
    'users': ['пайдаланушылар', 'кімге арналған'],
    'contact': ['байланыс', 'байланыс ақпараты'],
    'interaction': ['өзара әрекеттесу форматы', 'кеңес форматы', 'өзара жұмыс форматы'],
}
QUESTIONS = {
    'context': ('Мәнмәтін', 'Қазір жұмыс үдерісі қалай ұйымдастырылған?'),
    'need': ('Қажеттілік немесе мәселе', 'Нақты қандай мәселені шешу қажет?'),
    'data': ('Деректер мен материалдар', 'Қандай деректер немесе мысалдар қолжетімді?'),
    'result': ('Күтілетін нәтиже', 'Команда жұмысының соңында қандай өнім не нәтиже күтесіз?'),
    'success': ('Табыс критерийлері', 'Нәтижені қандай өлшенетін көрсеткішпен қабылдайсыз?'),
    'limits': ('Шектеулер', 'Мерзім, технология және қолжетімділік шектеулері қандай?'),
    'users': ('Пайдаланушылар', 'Бұл шешімді кімдер қолданады?'),
    'contact': ('Байланыс ақпараты', 'Команда қандай байланыс арнасымен хабарласа алады?'),
    'interaction': ('Өзара әрекеттесу форматы', 'Қаншалықты жиі және қандай форматта кері байланыс бересіз?'),
}

def analyze(description):
    fields = {'context': description}
    for line in description.splitlines():
        match = re.match(r'^\s*([^:]+):\s*(.+)$', line)
        if not match:
            continue
        label, value = match[1].strip().casefold(), match[2].strip()
        for key, names in LABELS.items():
            if label in names:
                fields[key] = value
                break
    missing = [key for key in QUESTIONS if not fields.get(key)]
    questions = [dict(field=key, label=QUESTIONS[key][0], question=QUESTIONS[key][1]) for key in missing]
    for key in QUESTIONS:
        if len(questions) >= 3:
            break
        if key not in missing:
            questions.append(dict(field=key, label=QUESTIONS[key][0], question=f'«{QUESTIONS[key][0]}» бөлімі толық па? Қажет болса нақтылаңыз.'))
    return dict(fields=fields, questions=questions, missing=[QUESTIONS[key][0] for key in missing], recognized=[QUESTIONS[key][0] for key in fields], context=fields['context'])
