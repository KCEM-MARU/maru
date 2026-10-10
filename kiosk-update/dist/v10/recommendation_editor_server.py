from __future__ import annotations
import csv, json, os, re, sys, threading, time, webbrowser, socket, traceback
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SERVER_VERSION = 'v63'
INSTANCE_ID = f'{os.getpid()}-{int(time.time()*1000)}'
PROGRAM_CANDIDATES = [
    ROOT / 'data' / 'kcem-crawled-programs.json',
    ROOT / 'data' / 'defaults' / 'kcem-crawled-programs.json',
    ROOT / 'data' / 'recommendation_seed' / 'kcem-crawled-programs.json',
]
PROGRAM_SOURCE = None
MIRROR_DIR = ROOT / 'data' / 'user-settings'
MIRROR_JSON = MIRROR_DIR / 'recommendation_master.json'
MIRROR_CSV = MIRROR_DIR / 'recommendation_master.csv'
LOCAL = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'MARU_Museum' / 'v10'
MASTER_JSON = LOCAL / 'recommendation_master.json'
MASTER_CSV = LOCAL / 'recommendation_master.csv'
PREFERRED_PORT = 8767

CRAFT_CATEGORIES = ['3D펜공예', '가죽공예', '교칠공예', '굿즈공예', '글라스아트', '금박공예', '금속공예', '나전·자개공예', '다도', '도자공예', '도자장식', '동화·공예', '드로잉', '레진공예', '마블링', '매듭공예', '맥간공예', '목공예', '민화공예', '발굴체험', '복합공예', '복합체험', '비누공예', '비즈공예', '새활용공예', '생활공예', '석고공예', '섬유공예', '슈링클스', '스노우볼', '승화전사', '예술·공예', '유리공예', '은공예', '음악·공예', '인형공예', '장신구', '재봉', '전각·도장공예', '전사공예', '전통공예', '전통먹거리', '전통문양', '전통문화공예', '전통장신구', '제스모나이트', '조명공예', '종이공예', '칠보공예', '캔버스공예', '커피박공예', '클릭커', '타일공예', '테라리움', '토이아트', '페인팅', '폴리머공예', '푸어링아트', '풍경장식', '한복·공예', '향공예', '향수공예', '환경공예']
CRAWLED_EXTRA_TAGS = ['공예파티', '단체', '단체교육', '문화예술교육', '발달장애 추천체험', '발달장애추천', '어린이', '원데이', '이수자교육', '전문과정', '전통', '전통 먹거리 교육', '전통교육', '정규 교육', '체험교육', '친환경', '환경교육', '힐링']

RESULT_TAGS = ['작은소품','실용품','장식작품']
PROCESS_TAGS = ['그리기','꾸미기','조립','조형','재료체험','정밀작업']
STYLE_TAGS = ['귀여움','전통','화려함','자연','현대적']
MATERIAL_TAGS = ['자개','레진','도자','커피박','목재','유리','종이','섬유','금속','플라스틱','한지','비즈','향','가죽','식물']

def ensure_dirs():
    LOCAL.mkdir(parents=True, exist_ok=True)
    MIRROR_DIR.mkdir(parents=True, exist_ok=True)

def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default

SAVE_LOCK = threading.RLock()

def atomic_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    # ThreadingHTTPServer can receive autosave + explicit save nearly together.
    # Use a per-write temp file so overlapping requests can never steal the same .tmp.
    tmp = path.with_name(path.name + f'.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp')
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists(): tmp.unlink()
        except OSError:
            pass

def normalize_tid(program):
    pid = str(program.get('id') or '')
    m = re.match(r'kcem-(\d+)-(\d+)$', pid)
    if m:
        return f'kcem-{m.group(1)}-{int(m.group(2)):05d}'
    idx = program.get('sourceIdx')
    source = str(program.get('sourceUrl') or '')
    mm = re.search(r'kcemuseum\.co\.kr/(\d+)', source)
    if idx and mm:
        return f'kcem-{mm.group(1)}-{int(idx):05d}'
    return pid

def clean_title(title):
    s = str(title or '').strip()
    while True:
        n = re.sub(r'^\s*\[[^\]]+\]\s*', '', s).strip()
        if n == s: break
        s = n
    return s

def resolve_cover(program, tid):
    candidates = []
    cover_dir = ROOT / 'assets' / 'programs' / 'cover'
    for ext in ('.png', '.jpg', '.jpeg', '.webp'):
        candidates.append(cover_dir / f'{tid}{ext}')
    raw = str(program.get('image') or '').strip().replace('\\', '/')
    if raw:
        candidates.append(ROOT / raw)
    for path in candidates:
        try:
            if path.is_file():
                rel = path.resolve().relative_to(ROOT.resolve()).as_posix()
                return rel, int(path.stat().st_mtime_ns)
        except Exception:
            continue
    return '', 0

def price_stars(price):
    try: p = int(price or 0)
    except: p = 0
    if p >= 50000: return 5
    if p >= 40000: return 4
    if p >= 30000: return 3
    if p >= 20000: return 2
    if p >= 10000: return 1
    return 0

def duration_guess(stars):
    return {1:30,2:60,3:60,4:90,5:90}.get(int(stars or 0), 60)

def infer_tags(p):
    text = ' '.join([str(p.get('title','')), str(p.get('craftField','')), ' '.join(p.get('recommendationTags') or [])]).lower()
    materials=[]
    mapping={
      '자개':['자개','나전'], '레진':['레진'], '도자':['도자','백자','도예'], '커피박':['커피박','커피찌꺼기'],
      '목재':['목공','나무','우드'], '유리':['유리','칠보'], '종이':['종이','페이퍼'], '슈링클스':['슈링클'], '한지':['한지'],
      '섬유':['섬유','규방','봉제','재봉','패브릭','실'], '금속':['금속','전각','도장'], '플라스틱':['플라스틱','리사이클'],
      '비즈':['비즈'], '향':['향수','향낭','향노리개','방향제'], '가죽':['가죽'], '식물':['테라리움','원예','식물','이끼']
    }
    for tag, kws in mapping.items():
        if any(k in text for k in kws): materials.append(tag)
    result=[]
    if any(k in text for k in ['키링','팔찌','목걸이','브로치','도장','id카드','노리개','클릭커','소품']): result.append('작은소품')
    if any(k in text for k in ['컵','텀블러','설거지','비누','접시','그릇','파우치','가방','생활']): result.append('실용품')
    if any(k in text for k in ['민화','액자','테라리움','장식','작품','화분','조형']): result.append('장식작품')
    proc=[]
    if any(k in text for k in ['민화','드로잉','그리기','페인팅','마블링']): proc += ['그리기','꾸미기']
    if any(k in text for k in ['키링','비즈','팔찌','조립','노리개','태슬']): proc.append('조립')
    if any(k in text for k in ['도자','조형','만들기','테라리움','커피박']): proc.append('조형')
    if materials: proc.append('재료체험')
    if any(k in text for k in ['자개','전각','칠보','규방','재봉','세공']): proc.append('정밀작업')
    style=[]
    if any(k in text for k in ['전통','민화','자개','나전','한지','규방','칠보','전각','노리개']): style.append('전통')
    if any(k in text for k in ['커피박','리사이클','새활용','테라리움','원예','자연']): style.append('자연')
    if any(k in text for k in ['레진','자개','칠보','비즈','쥬얼리','향수']): style.append('화려함')
    if any(k in text for k in ['곰돌이','고양이','거북이','키링','캐릭터']): style.append('귀여움')
    if any(k in text for k in ['레진','마블링','id카드','플라스틱','리사이클']): style.append('현대적')
    return {
      'resultTags': list(dict.fromkeys(result)), 'processTags': list(dict.fromkeys(proc)),
      'styleTags': list(dict.fromkeys(style)), 'materialTags': list(dict.fromkeys(materials))
    }

def default_record(p):
    stars=price_stars(p.get('priceValue'))
    tags=infer_tags(p)
    source_text=' '.join([str(p.get('category') or ''), *[str(x) for x in (p.get('sourceCategories') or [])]])
    recommend_enabled='단체교육' not in source_text
    return {
      'tid': normalize_tid(p),
      'recommendEnabled': recommend_enabled, 'recommendEnabledSource':'default' if recommend_enabled else 'inferred',
      'popularityScore': 0, 'popularityScoreSource':'default',
      'curatorPriority': 0, 'curatorPrioritySource':'default',
      'durationMinutes': duration_guess(stars), 'durationSource':'inferred',
      'craftCategories': [], 'craftCategoriesSource':'missing',
      'crawledExtraTags': [], 'crawledExtraTagsSource':'missing',
      'under4ParentSuitable':False, 'under4ParentSuitableSource':'missing',
      'ageBand':'', 'ageSource':'missing', 'experienceMinLevel':'', 'experienceSource':'missing',
      'precisionLevel':'', 'precisionSource':'missing', 'soloSuitable':True, 'soloSource':'default',
      'reservationRequired':False, 'reservationSource':'default', 'sameDayAvailable':True, 'sameDaySource':'default',
      'resultTags':tags['resultTags'], 'resultTagsSource':'inferred' if tags['resultTags'] else 'missing',
      'processTags':tags['processTags'], 'processTagsSource':'inferred' if tags['processTags'] else 'missing',
      'styleTags':tags['styleTags'], 'styleTagsSource':'inferred' if tags['styleTags'] else 'missing',
      'materialTags':tags['materialTags'], 'materialTagsSource':'inferred' if tags['materialTags'] else 'missing',
      'craftDescription': str(p.get('shortDescription') or p.get('description') or '').strip(),
      'craftDescriptionSource': 'crawled' if (p.get('shortDescription') or p.get('description')) else 'missing',
      'reviewStatus':'unreviewed', 'updatedAt':'', 'notes':''
    }

def load_programs():
    global PROGRAM_SOURCE
    PROGRAM_SOURCE = None
    d = None
    for candidate in PROGRAM_CANDIDATES:
        if not candidate.exists():
            continue
        loaded = load_json(candidate, None)
        if isinstance(loaded, dict) and isinstance(loaded.get('programs'), list) and loaded.get('programs'):
            d = loaded
            PROGRAM_SOURCE = candidate
            break
    if d is None:
        return []
    out=[]
    for p in d.get('programs',[]):
        q=dict(p); q['tid']=normalize_tid(p); q['displayTitle']=clean_title(p.get('title')); q['difficultyStars']=price_stars(p.get('priceValue'))
        q['coverPath'], q['coverVersion'] = resolve_cover(p, q['tid'])
        out.append(q)
    return out

def load_master():
    ensure_dirs()
    if not MASTER_JSON.exists() and MIRROR_JSON.exists():
        try: atomic_json(MASTER_JSON, load_json(MIRROR_JSON, {}))
        except: pass
    data=load_json(MASTER_JSON, {})
    if not isinstance(data, dict): data={}
    data.setdefault('schemaVersion',1); data.setdefault('revision',0); data.setdefault('records',{})
    return data

def save_master(master):
    ensure_dirs(); master['revision']=int(master.get('revision',0))+1; master['updatedAt']=time.strftime('%Y-%m-%dT%H:%M:%S')
    atomic_json(MASTER_JSON, master); atomic_json(MIRROR_JSON, master)
    write_csv(master, MASTER_CSV)
    try: write_csv(master, MIRROR_CSV)
    except: pass
    return master

def merged_records(master=None):
    master=master or load_master(); saved=master.get('records',{}); rows=[]
    for p in load_programs():
        d=default_record(p); d.update(saved.get(p['tid'],{})); rows.append({'program':p,'recommendation':d})
    return rows

def write_csv(master, path):
    rows=merged_records(master)
    cols=['tid','title','priceValue','craftField','difficultyStars','recommendEnabled','recommendEnabledSource','popularityScore','popularityScoreSource','curatorPriority','curatorPrioritySource','craftDescription','craftDescriptionSource','craftCategories','craftCategoriesSource','crawledExtraTags','crawledExtraTagsSource','preschoolSuitable','preschoolSuitableSource','under4ParentSuitable','under4ParentSuitableSource','priceOverride','priceOverrideSource','priceCrawled','priceCrawledText','girlsOnly','girlsOnlySource','precisionLevelSource','durationMinutes','durationSource','ageBand','ageSource','experienceMinLevel','experienceSource','precisionLevel','precisionSource','soloSuitable','soloSource','reservationRequired','reservationSource','sameDayAvailable','sameDaySource','resultTags','resultTagsSource','processTags','processTagsSource','styleTags','styleTagsSource','materialTags','materialTagsSource','reviewStatus','notes','updatedAt']
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=cols); w.writeheader()
        for x in rows:
            p,r=x['program'],x['recommendation']; row={k:r.get(k,'') for k in cols}; row.update({'tid':p['tid'],'title':p['displayTitle'],'priceValue':p.get('priceValue'),'craftField':p.get('craftField'),'difficultyStars':p.get('difficultyStars')})
            for k in ['craftCategories','resultTags','processTags','styleTags','materialTags']: row[k]='|'.join(r.get(k) or [])
            w.writerow(row)

def payload():
    m = load_master()
    rows = merged_records(m)
    cover_count = sum(1 for x in rows if x.get('program', {}).get('coverPath'))
    return {
        'ok': True,
        'serverVersion': SERVER_VERSION,
        'instanceId': INSTANCE_ID,
        'revision': m.get('revision', 0),
        'records': rows,
        'programCount': len(rows),
        'coverCount': cover_count,
        'programSource': str(PROGRAM_SOURCE) if PROGRAM_SOURCE else '',
        'tagCatalog': {
            'craftCategories': sorted(set(CRAFT_CATEGORIES + [str(t) for row in rows for t in row['recommendation'].get('craftCategories',[])])),
            'crawledExtraTags': sorted(set(CRAWLED_EXTRA_TAGS + [str(t) for row in rows for t in row['recommendation'].get('crawledExtraTags',[])])),
            'resultTags': RESULT_TAGS,
            'processTags': PROCESS_TAGS,
            'styleTags': STYLE_TAGS,
            'materialTags': list(dict.fromkeys(MATERIAL_TAGS + ['슈링클스'] + list(m.get('materials',{})))),
        },
        'storage': str(MASTER_JSON),
        'materials': m.get('materials',{}),
    }

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel=urlparse(path).path.lstrip('/')
        return str((ROOT / rel).resolve())
    def log_message(self, fmt, *args):
        pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def send_json(self,obj,status=200):
        raw=json.dumps(obj,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self):
        u=urlparse(self.path)
        try:
            if u.path in ('/api/recommendation/data', '/api/programs'):
                data = payload()
                print(f"[API] {u.path} -> {data['programCount']} programs / {data['coverCount']} covers")
                return self.send_json(data)
            if u.path=='/api/recommendation/export':
                data=payload(); data['master']=load_master(); return self.send_json(data)
            if u.path=='/api/recommendation/health':
                data = payload()
                return self.send_json({
                    'ok': True,
                    'serverVersion': SERVER_VERSION,
                    'instanceId': INSTANCE_ID,
                    'programCount': data['programCount'],
                    'coverCount': data['coverCount'],
                    'programSource': data['programSource'],
                    'storage': data['storage'],
                })
            if u.path=='/api/recommendation/open-storage':
                ensure_dirs()
                try: os.startfile(str(LOCAL))
                except Exception: pass
                return self.send_json({'ok':True,'path':str(LOCAL)})
            return super().do_GET()
        except Exception as e:
            traceback.print_exc()
            return self.send_json({'ok':False,'serverVersion':SERVER_VERSION,'error':str(e)},500)
    def do_POST(self):
        u=urlparse(self.path)
        try:
            n=int(self.headers.get('Content-Length','0')); body=json.loads(self.rfile.read(n) or b'{}')
            if u.path=='/api/recommendation/material':
                name=str(body.get('name','')).strip(); difficulty=int(body.get('difficulty',0))
                if not name or len(name)>40 or not 1<=difficulty<=5: raise ValueError('재료 이름과 난이도 1~5를 입력하세요')
                with SAVE_LOCK:
                    m=load_master(); m.setdefault('materials',{})[name]={'difficulty':difficulty}; save_master(m)
                return self.send_json({'ok':True,'revision':m['revision']})
            if u.path=='/api/recommendation/save':
                tid=str(body.get('tid','')); rec=body.get('recommendation') or {}
                if not tid: raise ValueError('tid required')
                price=rec.get('priceOverride')
                if price not in ('',None) and (isinstance(price,bool) or not isinstance(price,(int,float)) or price<0 or price>9007199254740991 or int(price)!=price): raise ValueError('가격은 0 이상의 정수로 입력하세요')
                with SAVE_LOCK:
                    m=load_master(); current=dict(m['records'].get(tid,{})); current.update(rec); current['tid']=tid; current['updatedAt']=time.strftime('%Y-%m-%dT%H:%M:%S')
                    m['records'][tid]=current; save_master(m)
                    persisted=load_json(MASTER_JSON,{})
                    stored=persisted.get('records',{}).get(tid)
                    if stored!=current:
                        raise RuntimeError('추천 데이터 디스크 저장 검증 실패')
                    return self.send_json({'ok':True,'revision':persisted['revision'],'saved':stored,'persisted':True})
            if u.path=='/api/recommendation/rebuild-csv':
                m=load_master(); write_csv(m,MASTER_CSV); return self.send_json({'ok':True,'path':str(MASTER_CSV)})
            self.send_json({'error':'not found'},404)
        except Exception as e:
            self.send_json({'ok':False,'error':str(e)},500)

class StrictThreadingHTTPServer(ThreadingHTTPServer):
    # v59: prevent concurrent listeners, but do not use SO_EXCLUSIVEADDRUSE.
    # SO_EXCLUSIVEADDRUSE can reject an immediate restart while Windows is still
    # retiring sockets after the previous process exits.
    allow_reuse_address = False

def create_server(port=PREFERRED_PORT):
    last_error = None
    for attempt in range(12):
        try:
            return StrictThreadingHTTPServer(('127.0.0.1', port), Handler)
        except OSError as e:
            last_error = e
            if getattr(e, 'winerror', None) == 10048 or getattr(e, 'errno', None) in (48, 98, 10048):
                if attempt == 0:
                    print(f'[INFO] Port {port} is retiring; retrying bind...')
                time.sleep(.5)
                continue
            raise
    raise RuntimeError(f'Port {port} is still in use after cleanup/retry.') from last_error

def main():
    try:
        os.chdir(ROOT); ensure_dirs(); m=load_master()
        try: write_csv(m,MASTER_CSV)
        except Exception as e: print('[WARN] Initial CSV build skipped:', e)
        port=PREFERRED_PORT
        server=create_server(port)
        url=f'http://127.0.0.1:{port}/recommendation_editor.html?v=63&instance={INSTANCE_ID}&ts={int(time.time())}'
        print('============================================================')
        print(' KCEM Recommendation Data Editor - v63')
        print('============================================================')
        print('URL   :',url)
        print('Port  :',port)
        print('Instance:', INSTANCE_ID)
        rows = load_programs()
        print('Root    :', ROOT)
        print('Programs:', len(rows))
        print('Covers  :', sum(1 for p in rows if p.get('coverPath')))
        print('Source  :', PROGRAM_SOURCE if PROGRAM_SOURCE else 'NOT FOUND')
        print('Master  :', MASTER_JSON)
        print('Program JSON candidates:')
        for candidate in PROGRAM_CANDIDATES:
            print('  ', '[OK]     ' if candidate.is_file() else '[MISSING]', candidate)
        if not rows:
            print('[WARN] No usable program JSON was loaded.')
        print('Keep this window open while editing.')
        print('Press Ctrl+C to stop.')
        print()
        try:
            (LOCAL / 'recommendation_editor_port.txt').write_text(str(port), encoding='utf-8')
        except Exception:
            pass
        if '--no-open' not in sys.argv: threading.Timer(.6, lambda:webbrowser.open(url)).start()
        try: server.serve_forever()
        except KeyboardInterrupt: pass
        return 0
    except Exception:
        print()
        print('[FATAL] Recommendation editor server could not start.')
        traceback.print_exc()
        return 1

if __name__=='__main__':
    raise SystemExit(main())
