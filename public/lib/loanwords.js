// 한국어에 외래어로 굳어 한국 학습자에게는 '이미 아는 말'인 영어 단어 (이메일·베이커리·이젤…)
// 구어 빈도로는 드물어 어려운 단어처럼 보이지만, 뜻이 한글 소리 그대로라 공부할 거리가 없다.
export const LOANWORDS = new Set(
  `email e-mail internet online offline website homepage blog login logout password wifi smartphone laptop
tablet keyboard mouse monitor printer scanner software hardware program update download upload app
computer camera video audio radio stereo speaker microphone headphone earphone battery charger cable
television channel drama sitcom comedy animation cartoon comic webtoon podcast playlist
coffee latte espresso cappuccino americano mocha cafe caffeine juice soda cola beer wine whiskey vodka
cocktail champagne pizza pasta spaghetti hamburger burger sandwich salad steak sausage bacon ham cheese
butter jam yogurt cereal toast bagel donut doughnut muffin cake cookie biscuit chocolate candy caramel
cream vanilla pudding jelly waffle pancake croissant brunch buffet menu dessert snack ketchup mayonnaise
sauce curry noodle ramen sushi tomato banana lemon orange melon kiwi mango pineapple cherry
bakery bakeries restaurant hotel motel resort lobby elevator escalator apartment villa condo studio
building tower terrace balcony garage sofa bed table chair desk cabinet shelf mirror curtain blind
carpet towel shampoo conditioner lotion perfume makeup lipstick mascara nail tissue toothbrush
shirt blouse jacket coat sweater cardigan hoodie jeans pants skirt dress necklace 
bracelet earring sneakers sandals boots slipper handbag wallet backpack
bus taxi truck subway train tram van jeep motorcycle bike bicycle scooter helicopter rocket
parking terminal ticket card visa passport tour guide
golf tennis soccer football baseball basketball volleyball badminton bowling skiing ski skate
skateboard surfing yoga pilates fitness gym marathon jogging racket goal team coach captain
ace mascot trophy medal olympic
piano guitar violin cello drum drums flute saxophone trumpet harmonica concert band orchestra
jazz hip pop ballad opera musical album idol fandom
hospital clinic vitamin allergy stress diet calorie protein insulin virus vaccine
office meeting project presentation marketing business manager boss leader partner member
schedule deadline report memo folder copy print scan fax signature
bank loan credit coupon discount sale event bonus point service tip
alarm snooze timer calendar diary notebook pen pencil marker tape sticker scissors
easel canvas palette sketch sketchbook crayon poster gallery museum studio
camping tent picnic barbecue hiking trekking cruise yacht boat
party birthday cake candle balloon gift card wedding honeymoon
message text chat emoji selfie photo filter profile follower hashtag
robot drone android sensor chip data server cloud network system platform
styling style design fashion trend brand model runway
interview audition casting celebrity drama director actor
dollar euro cent
`
    .split(/\s+/)
    .filter(Boolean),
);

// IPA 소리 → 자음 갈래 (한글 표기에서 같은 갈래로 적히는 소리끼리 묶는다)
const EN_SOUND = /tʃ|dʒ|[ʃʒszθðtdpbfvkɡgmŋnɹrlɚɝh]/g;
const EN_CLASS = Object.fromEntries(
  'tʃ:S dʒ:S ʃ:S ʒ:S s:S z:S θ:S ð:T t:T d:T p:P b:P f:P v:P k:K ɡ:K g:K m:M ŋ:G n:N ɹ:L r:L l:L ɚ:L ɝ:L h:H'
    .split(' ')
    .map((pair) => pair.split(':')),
);
// 한글 자모 → 같은 갈래 (첫소리 19개, 받침 27개)
const CHO = 'KKNTTLMPPSSxSSSKTPH'; // ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ (ㅇ은 소리 없음)
const JONG = ' K K KS N NS NH T L LK LM LP LS LT LP LH M P PS S S G S S K T P H'.split(' '); // [0] = 받침 없음

const squash = (s) => s.replace(/(.)\1+/g, '$1');

/** 영어 발음기호의 자음 뼈대 (예: /snuz/ → SNS) */
function enSkeleton(ipa) {
  return (String(ipa || '').match(EN_SOUND) || []).map((m) => EN_CLASS[m]).join('');
}

/** 한글 낱말의 자음 뼈대 (예: 스누즈 → SNS) */
function koSkeleton(ko) {
  let out = '';
  for (const ch of ko) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return '';
    const cho = CHO[Math.floor(code / 588)];
    if (cho !== 'x') out += cho;
    out += JONG[code % 28];
  }
  return out;
}

/**
 * 한국어 뜻이 영어 소리를 한글로 옮겨 적은 것뿐인가 (snooze → 스누즈, easel → 이젤, email → 이메일).
 * 그런 말은 외래어라 학습자가 이미 알거나, 뜻 풀이로서 쓸모가 없다.
 * 영어 끝의 r 은 한글에서 흔히 빠지므로(computer → 컴퓨터) 빠진 경우도 같다고 본다.
 */
export function isTransliteration(ipa, ko) {
  const first = String(ko || '')
    .split(/[,;·/(]/)[0]
    .replace(/\s+/g, '')
    .replace(/(하다|되다|하게|한|적인|의)$/, '');
  if (!first || first.length > 7 || !/^[가-힣]+$/.test(first)) return false;
  const en = squash(enSkeleton(ipa));
  if (en.length < 2) return false;
  const kr = squash(koSkeleton(first));
  return kr === en || kr === squash(en.replace(/L$/, '')) || kr === squash(en.replace(/L/g, ''));
}

/** 외래어로 굳은 단어인가 (목록에 있거나, 알고 있는 뜻이 소리 옮김뿐인 단어) */
export const isLoanword = (word, ipa = '', ko = '') => LOANWORDS.has(word) || isTransliteration(ipa, ko);
