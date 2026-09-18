// '표현' 탭을 채우고, 기계 번역이 직역해 버리는 표현을 문장 옆에 짚어 주는 목록
// [표현, 한국어 뜻, 종류, 직역주의]  종류: pv 구동사 · id 관용 표현 · ln 연결·강조 표현 · co 자주 쓰는 표현
// 네 번째 값이 true 면 '직역하면 뜻이 달라지는 표현' — 문장 해석 아래에 뜻을 따로 보여 준다
// (예: "closed on a house" 를 무료 번역기는 '문을 닫았다'로 옮긴다)

const LIST = [
  ['give up', '포기하다', 'pv'], ['give in', '굴복하다, 항복하다', 'pv'], ['give back', '돌려주다', 'pv'],
  ['give away', '거저 주다; (비밀을) 드러내다', 'pv'], ['go on', '계속하다; (일이) 일어나다', 'pv'],
  ['go back', '돌아가다', 'pv'], ['go through', '(힘든 일을) 겪다', 'pv'], ['go away', '떠나다, 사라지다', 'pv'],
  ['go out', '외출하다; (불이) 꺼지다', 'pv'], ['go ahead', '(망설이지 말고) 진행하다', 'pv'],
  ['go wrong', '잘못되다', 'co'], ['come back', '돌아오다', 'pv'], ['come up with', '(생각을) 떠올리다, 제안하다', 'pv'],
  ['come across', '우연히 마주치다', 'pv'], ['come true', '실현되다', 'co'], ['come out', '나오다; 드러나다', 'pv'],
  ['come along', '함께 가다; 나타나다', 'pv'], ['come down to', '결국 ~의 문제가 되다', 'pv'],
  ['get up', '일어나다', 'pv'], ['get over', '극복하다, 회복하다', 'pv'], ['get back', '돌아오다; 되찾다', 'pv'],
  ['get along', '사이좋게 지내다', 'pv'], ['get through', '(어려움을) 헤쳐 나가다', 'pv'], ['get rid of', '없애다, 제거하다', 'id'],
  ['get used to', '~에 익숙해지다', 'id'], ['get out', '나가다, 벗어나다', 'pv'], ['get away with', '(잘못을) 벌받지 않고 넘어가다', 'pv'],
  ['look for', '찾다', 'pv'], ['look at', '보다, 살펴보다', 'pv'], ['look after', '돌보다', 'pv'], ['look up', '올려다보다; (사전 등에서) 찾아보다', 'pv'],
  ['look forward to', '~을 고대하다', 'id'], ['look back', '되돌아보다', 'pv'], ['look down on', '얕보다, 무시하다', 'pv'],
  ['look up to', '존경하다', 'pv'], ['look like', '~처럼 보이다', 'co'], ['take off', '벗다; 이륙하다; 급성장하다', 'pv'],
  ['take on', '(일·책임을) 맡다', 'pv'], ['take over', '인수하다, 넘겨받다', 'pv'], ['take care of', '~을 돌보다, 처리하다', 'id'],
  ['take a step', '한 걸음 내딛다', 'co'], ['take a breath', '숨을 한 번 쉬다', 'co'], ['take time', '시간이 걸리다', 'co'],
  ['take for granted', '당연하게 여기다', 'id'], ['take part in', '~에 참여하다', 'id'], ['make sense', '말이 되다, 이해가 되다', 'co'],
  ['make up', '지어내다; 화해하다; 구성하다', 'pv'], ['make up your mind', '결심하다', 'id'], ['make it', '해내다, 성공하다; 제시간에 가다', 'id'],
  ['make a difference', '변화를 가져오다, 중요하다', 'id'], ['make a living', '생계를 꾸리다', 'id'], ['make sure', '반드시 ~하다, 확인하다', 'co'],
  ['figure out', '알아내다, 이해하다', 'pv'], ['find out', '알아내다', 'pv'], ['point out', '지적하다', 'pv'], ['turn out', '(결과가) ~로 드러나다', 'pv'],
  ['turn around', '돌아서다; 호전시키다', 'pv'], ['turn down', '거절하다; (소리를) 줄이다', 'pv'], ['turn into', '~로 바뀌다', 'pv'],
  ['turn away', '외면하다, 돌려보내다', 'pv'], ['work out', '해결하다; 잘 풀리다; 운동하다', 'pv'], ['carry on', '계속하다', 'pv'],
  ['keep going', '계속 나아가다', 'co'], ['keep up with', '~을 따라잡다, 뒤처지지 않다', 'pv'], ['keep on', '계속 ~하다', 'pv'],
  ['hold on', '기다리다; 꽉 잡다', 'pv'], ['hold on to', '~을 놓지 않다, 고수하다', 'pv'], ['hold back', '억누르다, 망설이다', 'pv'],
  ['let go', '놓아주다, 내려놓다', 'id'], ['let go of', '~을 놓아 버리다', 'id'], ['let down', '실망시키다', 'pv'],
  ['put off', '미루다', 'pv'], ['put up with', '참다, 견디다', 'pv'], ['put on', '입다; (연기·태도를) 꾸미다', 'pv'], ['put away', '치우다; 저축하다', 'pv'],
  ['set up', '설립하다, 준비하다', 'pv'], ['set out', '출발하다; 착수하다', 'pv'], ['set aside', '따로 떼어 두다', 'pv'],
  ['run out of', '~이 바닥나다', 'pv'], ['run into', '우연히 만나다; (문제에) 부딪히다', 'pv'], ['run away', '도망가다', 'pv'],
  ['pick up', '집어 들다; 익히다; (차로) 데리러 가다', 'pv'], ['show up', '나타나다', 'pv'], ['show off', '과시하다', 'pv'],
  ['fall apart', '무너지다, 산산조각 나다', 'pv'], ['fall behind', '뒤처지다', 'pv'], ['fall asleep', '잠들다', 'co'], ['fall in love', '사랑에 빠지다', 'id'],
  ['break down', '고장 나다; (감정이) 무너지다', 'pv'], ['break up', '헤어지다', 'pv'], ['break through', '돌파하다', 'pv'],
  ['stand out', '눈에 띄다', 'pv'], ['stand up for', '~을 옹호하다', 'pv'], ['stand still', '가만히 서 있다, 정체되다', 'co'],
  ['sit down', '앉다', 'pv'], ['wake up', '잠에서 깨다; 깨닫다', 'pv'], ['grow up', '자라다, 성장하다', 'pv'],
  ['end up', '결국 ~하게 되다', 'pv'], ['catch up', '따라잡다', 'pv'], ['check in', '(안부를) 확인하다; 체크인하다', 'pv'],
  ['calm down', '진정하다', 'pv'], ['slow down', '속도를 늦추다', 'pv'], ['shut down', '문을 닫다; 마음을 닫다', 'pv'],
  ['back down', '물러서다, 주장을 굽히다', 'pv'], ['throw away', '버리다', 'pv'], ['walk away', '떠나다, 손을 떼다', 'pv'],
  ['move on', '(지난 일을 두고) 앞으로 나아가다', 'pv'], ['move forward', '앞으로 나아가다', 'pv'], ['reach out', '연락하다, 도움을 청하다', 'pv'],
  ['open up', '마음을 열다', 'pv'], ['speak up', '목소리를 내다', 'pv'], ['sign up', '가입하다, 등록하다', 'pv'], ['fill in', '채우다; 대신하다', 'pv'],
  ['cut off', '잘라 내다; 끊다', 'pv'], ['bring up', '(화제를) 꺼내다; 키우다', 'pv'], ['bring back', '되살리다, 도로 가져오다', 'pv'],
  ['call off', '취소하다', 'pv'], ['deal with', '다루다, 처리하다', 'pv'], ['depend on', '~에 달려 있다, 의지하다', 'pv'],
  ['care about', '~에 관심을 갖다, 신경 쓰다', 'pv'], ['think about', '~에 대해 생각하다', 'pv'], ['believe in', '~을 믿다(가치·존재)', 'pv'],
  ['focus on', '~에 집중하다', 'pv'], ['stick with', '~을 고수하다, 계속하다', 'pv'], ['stick to', '~을 지키다, 고수하다', 'pv'],
  ['belong to', '~에 속하다', 'pv'], ['pay attention to', '~에 주의를 기울이다', 'id'], ['pay off', '성과를 거두다; 빚을 갚다', 'pv'],
  ['used to', '(과거에) ~하곤 했다', 'co'], ['be about to', '막 ~하려던 참이다', 'co'], ['have to', '~해야 한다', 'co'],
  ['instead of', '~ 대신에', 'ln'], ['because of', '~ 때문에', 'ln'], ['in spite of', '~에도 불구하고', 'ln'], ['even though', '비록 ~이지만', 'ln'],
  ['as long as', '~하는 한', 'ln'], ['as soon as', '~하자마자', 'ln'], ['as if', '마치 ~인 것처럼', 'ln'], ['no matter', '~이든 상관없이', 'ln'],
  ['in fact', '사실은', 'ln'], ['at least', '적어도', 'ln'], ['at last', '마침내', 'ln'], ['at first', '처음에는', 'ln'], ['in the end', '결국', 'ln'],
  ['after all', '결국; 어쨌든', 'ln'], ['all of a sudden', '갑자기', 'ln'], ['for a while', '한동안', 'ln'], ['once again', '다시 한번', 'ln'],
  ['over and over', '되풀이해서', 'ln'], ['little by little', '조금씩', 'ln'], ['step by step', '한 걸음씩, 차근차근', 'ln'], ['day after day', '매일같이', 'ln'],
  ['one day', '어느 날', 'ln'], ['for good', '영원히', 'id'], ['on purpose', '일부러', 'id'], ['by accident', '우연히', 'id'],
  ['on time', '제시간에', 'co'], ['in time', '늦지 않게; 머지않아', 'co'], ['right away', '즉시', 'co'], ['from scratch', '처음부터', 'id'],
  ['the whole time', '그동안 내내', 'co'], ['every single', '하나하나 모든', 'co'], ['not anymore', '더 이상 ~아니다', 'co'],
  ['in the middle of', '~의 한가운데에, 한창 ~하는 중에', 'co'], ['out of nowhere', '난데없이', 'id'], ['more than ever', '그 어느 때보다', 'co'],
  ['on your own', '혼자 힘으로', 'id'], ['by yourself', '혼자서', 'co'], ['it turns out', '알고 보니', 'id'], ['what if', '만약 ~라면 어떨까', 'co'],
  ['the point is', '요점은 ~이다', 'co'], ['it is not about', '~의 문제가 아니다', 'co'], ['it takes time', '시간이 걸린다', 'co'],
  ['piece of cake', '아주 쉬운 일', 'id'], ['break the ice', '어색한 분위기를 깨다', 'id'], ['hit rock bottom', '바닥을 치다, 최악에 이르다', 'id'],
  ['on the other hand', '반면에', 'ln'], ['at the same time', '동시에', 'ln'], ['sooner or later', '조만간', 'ln'], ['once and for all', '완전히, 영원히', 'id'],
  ['make progress', '진전을 이루다', 'co'], ['pay the price', '대가를 치르다', 'id'], ['lose track of', '~을 놓치다, 잊어버리다', 'id'],
  ['lose sight of', '~을 보지 못하게 되다, 잊다', 'id'], ['keep in mind', '명심하다', 'id'], ['change your mind', '마음을 바꾸다', 'id'],
  ['do your best', '최선을 다하다', 'co'], ['give it a try', '한번 해 보다', 'id'], ['take a chance', '모험을 하다', 'id'], ['take a risk', '위험을 무릅쓰다', 'id'],
  ['in the long run', '장기적으로', 'id'], ['under pressure', '압박을 받는', 'co'], ['out of reach', '손이 닿지 않는', 'co'], ['behind the scenes', '막후에서', 'id'],
  /* ── 직역하면 뜻이 달라지는 표현 (문장 해석 아래에 따로 짚어 준다) ── */
  ['close on a house', '(집) 매매 계약을 최종 체결하다', 'id', true], ['close on a place', '(집) 매매 계약을 최종 체결하다', 'id', true],
  ['put down a deposit', '보증금·계약금을 걸다', 'id', true], ['take out a loan', '대출을 받다', 'id', true],
  ['settle down', '자리를 잡다, 정착하다; 진정하다', 'pv', true], ['make ends meet', '겨우 먹고살다', 'id', true],
  ['fall through', '(계획·거래가) 무산되다', 'pv', true], ['land a job', '일자리를 얻다', 'id', true],
  ['tie the knot', '결혼하다', 'id', true], ['get your act together', '정신 차리고 제대로 하다', 'id', true],
  ['have it all figured out', '모든 답을 다 알고 있다', 'id', true], ['catch a break', '운이 트이다, 한숨 돌리다', 'id', true],
  ['burn out', '지쳐 나가떨어지다', 'pv', true], ['keep up appearances', '겉으로는 멀쩡한 척하다', 'id', true],
  ['keep your head above water', '간신히 버티다', 'id', true], ['second-guess', '자꾸 의심하며 되짚다', 'id', true], ['second guess*', '자꾸 의심하며 되짚다', 'id', true],
  ['beat yourself up', '자책하다', 'id', true], ['hold it together', '무너지지 않고 버티다', 'id', true],
  ['fall into place', '제자리를 찾아가다, 술술 풀리다', 'id', true], ['cut out for', '~에 어울리는 사람이다', 'id', true],
  ['on paper', '서류상으로는, 겉보기에는', 'id', true], ['a far cry from', '~와는 거리가 먼', 'id', true],
  ['down the road', '나중에, 앞으로 (길을 따라 내려가다 아님)', 'id'], ['the bottom line', '결론은, 핵심은', 'id', true],
  ['off the rails', '완전히 엇나간', 'id', true], ['on your plate', '감당해야 할 일', 'id', true],
  ['play it safe', '안전하게 가다', 'id', true], ['burn bridges', '관계를 돌이킬 수 없게 끊다', 'id', true],
  ['cold feet', '막판에 겁이 나 망설임', 'id', true], ['second thoughts', '다시 드는 망설임', 'id', true],
  ['give it a shot', '한번 해 보다', 'id', true], ['touch base', '연락해 소식을 나누다', 'id', true],
  ['carve out time', '시간을 따로 내다', 'id', true], ['in a rut', '틀에 박혀 제자리걸음인', 'id', true],
  ['go through the motions', '마음 없이 시늉만 하다', 'id', true], ['on the fence', '결정을 못 하고 망설이는', 'id', true],
  ['sell yourself short', '자신을 과소평가하다', 'id', true], ['make peace with', '~을 받아들이다', 'id', true],
  ['move the needle', '눈에 띄는 변화를 만들다', 'id', true], ['do the math', '따져 보다, 계산해 보다', 'id', true],
  ['in the same boat', '같은 처지인', 'id', true], ['hit the ground running', '시작부터 전력으로 달리다', 'id', true],
  ['throw in the towel', '포기하다', 'id', true], ['pull yourself together', '마음을 추스르다', 'id', true],
  ['take stock of', '~을 찬찬히 점검하다', 'id', true], ['worth it', '그만한 가치가 있다', 'co', true],
  ['ahead of the curve', '남들보다 앞선', 'id', true], ['behind the curve', '남들보다 뒤처진', 'id', true],
  ['a leg up', '남보다 유리한 출발', 'id', true], ['get ahead', '앞서 나가다, 성공하다', 'pv', true],
  ['keep up with the joneses', '남들 사는 만큼 따라가려 애쓰다', 'id', true],
  ['the grass is greener', '남의 떡이 커 보인다', 'id', true], ['bite the bullet', '이를 악물고 해내다', 'id', true],
  ['call it a day', '오늘은 여기까지 하고 마치다', 'id', true], ['wing it', '준비 없이 즉흥으로 해내다', 'id', true],
  ['pull it off', '결국 해내다', 'id', true], ['in over your head', '감당 못 할 일에 빠진', 'id', true],
  ['run its course', '흐를 대로 흘러 끝나다', 'id', true], ['draw the line', '선을 긋다, 한계를 정하다', 'id', true],
  ['come to terms with', '(힘든 일을) 받아들이다', 'id', true], ['at a crossroads', '갈림길에 선', 'id', true],
  ['blow off steam', '쌓인 스트레스를 풀다', 'id', true], ['have your hands full', '눈코 뜰 새 없이 바쁘다', 'id', true],
  ['take a toll', '대가를 치르게 하다, 타격을 주다', 'id', true],
  ['put things in perspective', '일을 제대로 된 크기로 보다', 'id', true],
  ['a blessing in disguise', '전화위복', 'id', true], ['better off', '~하는 편이 더 낫다', 'co', true],
  ['have a point', '일리가 있다', 'co', true], ['set in stone', '확정된, 바꿀 수 없는', 'id', true],
  ['up in the air', '아직 정해지지 않은', 'id', true], ['behind closed doors', '남들 모르게', 'id', true],
  ['take the plunge', '큰맘 먹고 뛰어들다', 'id', true], ['running out of time', '시간이 얼마 없다', 'id', true],
];

const TYPE = { pv: '구동사', id: '관용 표현', ln: '연결·강조 표현', co: '자주 쓰는 표현' };

// 불규칙 동사 활용형
const IRREGULAR = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], have: ['has', 'had', 'having'], do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'], come: ['comes', 'came', 'coming'], get: ['gets', 'got', 'gotten', 'getting'],
  give: ['gives', 'gave', 'given', 'giving'], take: ['takes', 'took', 'taken', 'taking'], make: ['makes', 'made', 'making'],
  keep: ['keeps', 'kept', 'keeping'], find: ['finds', 'found', 'finding'], hold: ['holds', 'held', 'holding'],
  bring: ['brings', 'brought', 'bringing'], think: ['thinks', 'thought', 'thinking'], run: ['runs', 'ran', 'running'],
  put: ['puts', 'putting'], set: ['sets', 'setting'], let: ['lets', 'letting'], cut: ['cuts', 'cutting'],
  fall: ['falls', 'fell', 'fallen', 'falling'], break: ['breaks', 'broke', 'broken', 'breaking'], stand: ['stands', 'stood', 'standing'],
  show: ['shows', 'showed', 'shown', 'showing'], sit: ['sits', 'sat', 'sitting'], grow: ['grows', 'grew', 'grown', 'growing'],
  throw: ['throws', 'threw', 'thrown', 'throwing'], wake: ['wakes', 'woke', 'woken', 'waking'], speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  lose: ['loses', 'lost', 'losing'], pay: ['pays', 'paid', 'paying'], catch: ['catches', 'caught', 'catching'], stick: ['sticks', 'stuck', 'sticking'],
  hit: ['hits', 'hitting'], shut: ['shuts', 'shutting'], deal: ['deals', 'dealt', 'dealing'], stop: ['stops', 'stopped', 'stopping'],
  begin: ['begins', 'began', 'begun', 'beginning'], feel: ['feels', 'felt', 'feeling'], leave: ['leaves', 'left', 'leaving'],
};

function forms(verb) {
  if (IRREGULAR[verb]) return [verb, ...IRREGULAR[verb]];
  const out = [verb, verb + 's', verb + 'es', verb + 'ed', verb + 'd', verb + 'ing'];
  if (verb.endsWith('e')) out.push(verb.slice(0, -1) + 'ing');
  if (verb.endsWith('y')) out.push(verb.slice(0, -1) + 'ies', verb.slice(0, -1) + 'ied');
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PRONOUNS = '(?:it|them|him|her|me|us|you|this|that|everything|something|nothing)';

const DET = '(?:a|an|the|my|your|his|her|our|their|this|that)';
const isDet = (w) => w === 'a' || w === 'an' || w === 'the';

const MATCHERS = LIST.map(([phrase, ko, type, trap = false]) => {
  const words = phrase.split(' ');
  const [first, ...rest] = words;
  const pron = (w) =>
    isDet(w)
      ? DET // 'close on a house' 는 'closed on the house' 도 잡는다
      : w === 'your'
        ? '(?:my|your|his|her|our|their)'
        : w === 'yourself'
          ? '(?:myself|yourself|himself|herself|ourselves|themselves)'
          : esc(w);
  const verbHead = (type === 'pv' || type === 'id' || type === 'co') && !isDet(first);
  const head = verbHead ? `(?:${forms(first).map(esc).join('|')})` : pron(first);
  // 뒤쪽 낱말이 동사인 표현은 별표로 적는다 ('second guess*' → second guessed·guessing 도 잡는다)
  const word = (w) => (w.endsWith('*') ? `(?:${forms(w.slice(0, -1)).map(esc).join('|')})` : pron(w));
  // 구동사는 목적어 대명사가 사이에 끼는 경우도 허용 (give it up)
  const gap = type === 'pv' && rest.length === 1 ? `(?:\\s+${PRONOUNS})?` : '';
  const body = rest.map(word).join('\\s+');
  const re = new RegExp(`\\b${head}${gap}${body ? '\\s+' + body : ''}\\b`, 'i');
  return { phrase: phrase.replace(/\*/g, ''), ko, type, trap, re, len: words.length };
});

/** 문장들에서 표현을 찾아 [{ phrase, ko, note, i }] 로 돌려준다 (먼저 나온 문장 기준, 긴 표현 우선) */
export function findExpressions(sentences, max = 24) {
  const found = new Map();
  for (const s of sentences) {
    for (const m of MATCHERS) {
      if (found.has(m.phrase) || !m.re.test(s.en)) continue;
      found.set(m.phrase, { phrase: m.phrase, ko: m.ko, note: TYPE[m.type], i: s.i, len: m.len });
    }
  }
  // 짧은 표현이 긴 표현의 일부면(let go ⊂ let go of) 긴 쪽만 남긴다
  const list = [...found.values()];
  const kept = list.filter((e) => !list.some((o) => o !== e && o.len > e.len && o.phrase.includes(e.phrase) && o.i === e.i));
  // 너무 흔한 표현(have to 등)보다 구동사·관용 표현을 먼저
  const order = { '구동사': 0, '관용 표현': 1, '자주 쓰는 표현': 2, '연결·강조 표현': 3 };
  return kept
    .sort((a, b) => order[a.note] - order[b.note] || a.i - b.i)
    .slice(0, max)
    .map(({ len, ...e }) => e);
}

/**
 * 한 문장에서 '직역하면 뜻이 달라지는 표현'을 찾는다 (긴 표현 우선).
 * 무료 번역기가 통째로 직역해 버리는 자리를 문장 옆에 짚어 주는 용도.
 * @returns {{ phrase: string, ko: string }[]}
 */
export function findTraps(text, max = 2) {
  const hits = MATCHERS.filter((m) => m.trap && m.re.test(text));
  return hits
    .filter((m) => !hits.some((o) => o !== m && o.len > m.len && o.phrase.includes(m.phrase)))
    .sort((a, b) => b.len - a.len)
    .slice(0, max)
    .map((m) => ({ phrase: m.phrase, ko: m.ko }));
}
