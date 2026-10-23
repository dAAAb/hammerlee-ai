/**
 * Prewritten, nonpartisan civic-information exhibit.
 * The seed reproduces the topic order and hand-written wording; no live chat,
 * identity inference, personalisation, or candidate endorsement takes place.
 * Retain old version tables whenever shared links must replay identically.
 */
import { BRAND } from './branding.js';

export const VERSION = 2;

export const TOPICS = Object.freeze([
  { id: 'ai', title: 'AI 與城市生活', color: '#b8a2ec' },
  { id: 'health', title: '就醫與照護', color: '#efaab8' },
  { id: 'mobility', title: '日常交通', color: '#91c6e9' },
  { id: 'accessibility', title: '安心步行', color: '#ead093' },
  { id: 'resilience', title: '防汛與韌性', color: '#8ac9c5' },
  { id: 'housing', title: '居住生活', color: '#d0b1dd' },
  { id: 'spaces', title: '公園與公共空間', color: '#a4c99c' },
  { id: 'transparency', title: '看得懂的市政', color: '#eeb39a' },
].map(Object.freeze));

const guide = (text, sticker) => ({ role: 'guide', text, ...(sticker ? { sticker } : {}) });
const visitor = (text) => ({ role: 'visitor', text });

// Each topic has four complete, independently written five-message variants.
// Messages describe questions and possible trade-offs, not announced promises,
// attributed quotes, verified local service levels, or existing project claims.
const VARIANTS = {
  ai: [
    [
      guide('聊到 AI 城市，你會希望它先幫忙什麼？'),
      visitor('辦事情少跑一趟，我就很開心了。'),
      guide('可以先想想：申辦流程能否更清楚？資料又該怎麼保護？'),
      visitor('方便很棒，但我也想保留真人服務。'),
      guide('科技好用，也要讓每個人跟得上。', 'spark'),
    ],
    [
      guide('城市用上 AI，不妨先從日常的小麻煩聊起。'),
      visitor('像是等公車時，能不能知道還要多久？'),
      guide('這類資訊服務要看資料準不準，也要考慮更新和維護。'),
      visitor('那我不用手機，也看得到資訊嗎？'),
      guide('這就是好問題：便利要照顧到不同使用方式。', 'thumb'),
    ],
    [
      guide('如果有 AI 幫忙回答市政問題，你最在意什麼？'),
      visitor('我希望它講白話，別回答錯了還很肯定。'),
      guide('可以檢視回答有沒有來源，不確定時能否轉給服務人員。'),
      visitor('對呀，重要的事還是要查清楚。'),
      guide('讓工具幫忙，也讓人安心核對。', 'spark'),
    ],
    [
      guide('提到科技發展，除了新技術，還有什麼值得關心？'),
      visitor('附近的人能不能學到新技能？'),
      guide('可以一起看學習機會、工作需求，還有投入的公共成本。'),
      visitor('有一步一步的教學，我也想試試看。'),
      guide('從一個小問題開始，就很好。', 'sun'),
    ],
  ],
  health: [
    [
      guide('說到就醫，除了醫院遠近，你還在意什麼？'),
      visitor('看完診後，回家怎麼照顧也很重要。'),
      guide('可以留意轉介資訊、在地照護資源，與交通是否接得上。'),
      visitor('如果家人能一起看懂，就比較安心。'),
      guide('把每一段照護路程都想清楚。', 'heart'),
    ],
    [
      guide('如果要討論醫療服務，先從哪一件日常小事開始？'),
      visitor('我想知道，有問題時該到哪裡問。'),
      guide('服務資訊是否清楚、更新是否及時，都值得一起檢查。'),
      visitor('電話、紙本和網路都有，就更容易找。'),
      guide('找到資訊，也是安心的一步。', 'sun'),
    ],
    [
      guide('家人需要照護時，安排生活往往要想很多。'),
      visitor('照顧的人也需要喘口氣呀。'),
      guide('討論照護政策時，可以一起看服務量能、人力和申請條件。'),
      visitor('我也想知道，等候期間可以找誰協助。'),
      guide('照顧需要幫忙的人，也看見照顧者。', 'heart'),
    ],
    [
      guide('更容易就醫，可以從很多方向討論。'),
      visitor('是多一棟醫院，就一定比較方便嗎？'),
      guide('還要一起看專業人力、科別需求，以及交通與轉診安排。'),
      visitor('原來要把整段就醫過程都算進去。'),
      guide('每一段路，都值得被好好考慮。', 'thumb'),
    ],
  ],
  mobility: [
    [
      guide('一趟順利的出門，從家門口就開始了。'),
      visitor('我希望走到站牌的路也好走。'),
      guide('討論交通時，可以把步行、候車和轉乘一起看。'),
      visitor('如果轉車不用急著跑，就舒服多了。'),
      guide('把整趟旅程接起來。', 'train'),
    ],
    [
      guide('交通建設的選擇，你會先問什麼？'),
      visitor('誰會用得到？要等多久？'),
      guide('還能比較建設成本、維護費用，以及施工期間的影響。'),
      visitor('原來不只看路線圖，也要看使用情境。'),
      guide('多問幾個問題，選擇才更清楚。', 'spark'),
    ],
    [
      guide('等車時，哪一種小改善會讓你比較輕鬆？'),
      visitor('有地方坐，也能看清楚車子何時來。'),
      guide('候車空間可以一起檢視座位、遮蔭、照明與資訊。'),
      visitor('下雨天也要記得想進去。'),
      guide('晴天雨天，都把出門的人放在心上。', 'sun'),
    ],
    [
      guide('聊交通，也別忘了不同時間出門的人。'),
      visitor('對呀，有人一大早上班，有人晚上才回家。'),
      guide('可以比較不同時段的需求、班次安排和營運資源。'),
      visitor('也看看住得比較遠的人，怎麼回家。'),
      guide('把各種日常，都放進討論裡。', 'home'),
    ],
  ],
  accessibility: [
    [
      guide('一條舒服的人行道，你會注意哪些地方？'),
      visitor('路面平不平，走一走能不能休息。'),
      guide('也可以看看通行空間、路口視線和穿越時間。'),
      visitor('推輪椅或娃娃車的人，也需要好好走。'),
      guide('一步一步，看看路怎麼更友善。', 'heart'),
    ],
    [
      guide('出門買菜的那段路，其實藏著不少城市細節。'),
      visitor('有些地方有階差，拿著東西就更要小心。'),
      guide('改善前可以記錄位置，再確認排水、通行和維護需求。'),
      visitor('修好了以後，也要持續檢查才安心。'),
      guide('好走的路，也需要好好照顧。', 'thumb'),
    ],
    [
      guide('如果一起檢查路口，你會先看哪裡？'),
      visitor('轉彎的車看不看得到我？'),
      guide('可以觀察視線、號誌和轉彎動線，再討論改善方法。'),
      visitor('讓人與車都能清楚知道怎麼走，很重要。'),
      guide('慢慢看，把每個人的路想清楚。', 'sun'),
    ],
    [
      guide('友善步行，不只是把人行道鋪好。'),
      visitor('是不是還要找得到入口和方向？'),
      guide('是呀，可以一起看標示、照明、休息點與無障礙動線。'),
      visitor('字大一點、方向清楚一點，我會更放心。'),
      guide('小地方想周到，出門就更從容。', 'heart'),
    ],
  ],
  resilience: [
    [
      guide('聊到雨季，城市有哪些準備值得關心？'),
      visitor('排水要通，警報也要看得懂。'),
      guide('可以一起檢視排水維護、風險資訊和應變分工。'),
      visitor('我也想知道，平常去哪裡看最新公告。'),
      guide('提早認識資訊，遇到狀況更有方向。', 'spark'),
    ],
    [
      guide('防汛工程之外，還有哪些事可以一起討論？'),
      visitor('如果道路封閉，訊息要傳得到大家。'),
      guide('資訊可用不同管道傳達，也要清楚標示更新時間。'),
      visitor('這樣才不會把舊消息當成最新消息。'),
      guide('清楚、及時，也是城市準備的一部分。', 'thumb'),
    ],
    [
      guide('城市面對大雨時，公共空間也值得一起思考。'),
      visitor('公園和排水，原來也能放在一起討論？'),
      guide('可以評估透水與滯洪設計，但仍要看地點、容量和維護。'),
      visitor('所以要依每個地方的條件來規劃。'),
      guide('看見地方的不同，才能把問題問完整。', 'tree'),
    ],
    [
      guide('一項防災規劃，完成之後還有哪些事？'),
      visitor('設備要維護，大家也要知道怎麼配合。'),
      guide('可以關心演練、責任分工，以及資訊是否容易取得。'),
      visitor('平時說清楚，需要時才找得到。'),
      guide('把日常準備，慢慢做紮實。', 'home'),
    ],
  ],
  housing: [
    [
      guide('聊居住，你會先想起房子，還是附近的生活？'),
      visitor('兩個都重要，買菜、搭車也要方便。'),
      guide('討論住宅規劃時，可以一起看負擔、地點和生活機能。'),
      visitor('也要想想，之後的管理與維修怎麼辦。'),
      guide('住得安心，是很多細節加起來的。', 'home'),
    ],
    [
      guide('不同的人，對一個家的需要可能不太一樣。'),
      visitor('有的人獨居，有的人要照顧一家大小。'),
      guide('可以比較居住空間、可負擔程度和附近支持資源。'),
      visitor('討論時，多聽幾種生活經驗很有幫助。'),
      guide('每一種生活，都值得被看見。', 'heart'),
    ],
    [
      guide('看到住宅政策，你會想查哪些資訊？'),
      visitor('我想看申請條件和費用寫得清不清楚。'),
      guide('還可以查看地點、時程，以及後續管理方式。'),
      visitor('如果資料更新，也希望能很容易找到。'),
      guide('把條件看明白，再理解各種選擇。', 'spark'),
    ],
    [
      guide('熟悉的老社區，要怎麼討論居住改善？'),
      visitor('我在意安全，也捨不得熟悉的鄰居。'),
      guide('可以一起比較修繕、無障礙改善與更新方案的條件。'),
      visitor('費用、時間和居民意願，都要好好說。'),
      guide('讓生活經驗，有機會進入討論。', 'home'),
    ],
  ],
  spaces: [
    [
      guide('你心裡舒服的公園，是什麼樣子？'),
      visitor('有樹蔭，可以坐著聊聊天。'),
      guide('規劃時可以一起看遮蔭、座椅、廁所和通行動線。'),
      visitor('小朋友能玩，大人也能休息。'),
      guide('留一個地方，裝下不同的日常。', 'tree'),
    ],
    [
      guide('一個公共空間好不好用，誰最知道？'),
      visitor('常來散步的人，應該有很多觀察。'),
      guide('也可以邀請不同年齡、不同需求的使用者一起看看。'),
      visitor('平常比較少出門的人，也可以聽聽看。'),
      guide('多一種聲音，多看見一種需要。', 'heart'),
    ],
    [
      guide('公園新設施很吸睛，還有什麼不能漏掉？'),
      visitor('乾不乾淨，壞了有沒有人修。'),
      guide('可以查看維護安排、使用規則和問題通報方式。'),
      visitor('這樣過一陣子，大家也還是用得舒服。'),
      guide('照顧空間，也是照顧每天來的人。', 'sun'),
    ],
    [
      guide('社區裡的一小塊空間，也有很多可能。'),
      visitor('可以運動，也可以安靜坐一會兒。'),
      guide('規劃時要考慮活動需求，也要照顧附近住戶的感受。'),
      visitor('時間、聲音和動線，可以一起商量。'),
      guide('把空間用得好，也把彼此放在心上。', 'tree'),
    ],
  ],
  transparency: [
    [
      guide('看一項市政計畫，你會先找哪些資料？'),
      visitor('要做什麼、花多少錢、什麼時候完成。'),
      guide('還可以看進度、責任單位，以及變更原因有沒有公開。'),
      visitor('如果能用白話整理，我就比較看得懂。'),
      guide('資訊說清楚，討論才有共同的起點。', 'spark'),
    ],
    [
      guide('一項工程寫著「進行中」，你還會想知道什麼？'),
      visitor('目前做到哪裡？接下來做什麼？'),
      guide('可以留意是否有更新日期、階段目標和進度說明。'),
      visitor('如果延期了，也想知道原因和新安排。'),
      guide('問得具體，資訊就更容易比較。', 'thumb'),
    ],
    [
      guide('如果想分享對社區的觀察，你希望怎麼參與？'),
      visitor('不一定要上網，也能把想法說出來。'),
      guide('可以看看是否有不同參與管道，以及意見如何被回應。'),
      visitor('有收到、有處理，也希望能查得到。'),
      guide('讓參與有入口，讓回應有方向。', 'heart'),
    ],
    [
      guide('看到很吸引人的城市構想，可以先怎麼了解？'),
      visitor('先看看資料出處，還有要怎麼做到。'),
      guide('再比較預算、人力、時間，以及可能影響到的人。'),
      visitor('把好處和限制一起看，才比較完整。'),
      guide('帶著好奇，也帶著自己的判斷。', 'sun'),
    ],
  ],
};

// Version 1 is retained verbatim for previously shared links.
const INTRO_V1 = [
  { role: 'system', text: '這是預先編寫的市政資訊互動展示，不是真人即時聊天。' },
  guide('你好，我是虛擬的城市小幫手。一起慢慢看看城市生活吧！'),
  { role: 'system', text: '「你」的對話也是示範腳本，不代表你的意見；內容不替任何候選人背書。' },
  visitor('那就邊滑邊看，從生活的小事聊起。'),
];

const INTRO_V2 = [
  { role: 'system', text: `${BRAND.subtitle}。${BRAND.disclosure}` },
  guide('你好，歡迎來到「川伯，聊聊」。一起看看未來新北的市政議題。'),
  { role: 'system', text: '「你」的回覆也是示範腳本，不代表你的意見；內容用於認識議題，並非政見承諾。' },
  visitor('那就邊滑邊看，從生活的小事聊起。'),
];

const ENDING = [
  guide('八個話題都聊到了。謝謝你一起看看城市的日常！', 'heart'),
  visitor('原來一個小問題，背後也有很多值得了解的事。'),
  guide('這枚城市探索徽章，記下了這次展示的對話組合。', 'badge'),
  { role: 'system', text: '展示結束。你可以分享這段預寫對話、重新探索，或往上回看。' },
];

function freezeScript(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeScript(child);
  }
  return Object.freeze(value);
}

// These snapshots intentionally share unchanged neutral topic wording. Add new
// tables for future editorial changes; never edit V1 wording or seed mapping.
const SCRIPTS = Object.freeze({
  1: freezeScript({ intro: INTRO_V1, variants: VARIANTS, ending: ENDING }),
  2: freezeScript({ intro: INTRO_V2, variants: VARIANTS, ending: ENDING }),
});

// 8! topic orders × 4 choices for each of 8 topics.
// This counts script combinations, not a claim of globally allocated identities.
export const COMBINATION_COUNT = 40_320 * (4 ** 8);

/** Accept only a complete 128-bit hexadecimal seed, canonicalised to lowercase. */
export function normalizeSeed(input) {
  if (typeof input !== 'string') return null;
  const seed = input.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(seed) ? seed : null;
}

/** Random session identifier; never derived from visitor or device information. */
export function newSeed() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// sfc32: a small reproducible PRNG. This drives presentation choices only;
// it is not used for security, identity verification, or uniqueness guarantees.
function seededRandom(seed) {
  let a = Number.parseInt(seed.slice(0, 8), 16) >>> 0;
  let b = Number.parseInt(seed.slice(8, 16), 16) >>> 0;
  let c = Number.parseInt(seed.slice(16, 24), 16) >>> 0;
  let d = Number.parseInt(seed.slice(24, 32), 16) >>> 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11));
    c = (c + t) | 0;
    return (t >>> 0) / 4_294_967_296;
  };
  for (let index = 0; index < 16; index += 1) next();
  return next;
}

/**
 * Build exactly 48 messages. topicOrder contains IDs; variantIndices maps
 * each topic ID to its zero-based wording variant. The same version + seed
 * always gives the same script, independently of scrolling speed.
 */
export function createConversation(seedHex = newSeed(), version = VERSION) {
  const seed = normalizeSeed(seedHex);
  if (!seed) throw new TypeError('Conversation seed must contain exactly 32 hexadecimal characters.');
  if (!Number.isInteger(version) || !Object.hasOwn(SCRIPTS, version)) {
    throw new RangeError('Unsupported conversation version. Expected version 1 or 2.');
  }
  const script = SCRIPTS[version];

  const random = seededRandom(seed);
  const topicOrder = TOPICS.map(({ id }) => id);
  for (let index = topicOrder.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [topicOrder[index], topicOrder[other]] = [topicOrder[other], topicOrder[index]];
  }

  const variantIndices = {};
  const messages = script.intro.map((message, index) => ({
    ...message, id: `v${version}-intro-${index}`, topic: 'intro',
  }));

  for (const topic of topicOrder) {
    const variantIndex = Math.floor(random() * script.variants[topic].length);
    variantIndices[topic] = variantIndex;
    messages.push(...script.variants[topic][variantIndex].map((message, index) => ({
      ...message,
      id: `v${version}-${topic}-${variantIndex}-${index}`,
      topic,
    })));
  }

  messages.push(...script.ending.map((message, index) => ({
    ...message, id: `v${version}-ending-${index}`, topic: 'ending',
  })));

  return { seed, version, messages, topicOrder, variantIndices, combinationCount: COMBINATION_COUNT };
}
