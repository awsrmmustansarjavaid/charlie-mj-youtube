(() => {
  // Lightweight language detection + native-language query data for the Target Feed.
  // Works for every language: non-Latin languages by Unicode script, Latin-script
  // languages by stop-word + diacritic scoring.
  if (globalThis.CMJ_LANG) return;

  const SCRIPT_RANGES = {
    Latn: /[A-Za-zÀ-ɏḀ-ỿ]/g,
    Cyrl: /[Ѐ-ԯ]/g,
    Arab: /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g,
    Deva: /[ऀ-ॿ]/g,
    Beng: /[ঀ-৿]/g,
    Guru: /[਀-੿]/g,
    Gujr: /[઀-૿]/g,
    Orya: /[଀-୿]/g,
    Taml: /[஀-௿]/g,
    Telu: /[ఀ-౿]/g,
    Knda: /[ಀ-೿]/g,
    Mlym: /[ഀ-ൿ]/g,
    Sinh: /[඀-෿]/g,
    Thai: /[฀-๿]/g,
    Laoo: /[຀-໿]/g,
    Tibt: /[ༀ-࿿]/g,
    Mymr: /[က-႟]/g,
    Geor: /[Ⴀ-ჿ]/g,
    Ethi: /[ሀ-፿]/g,
    Khmr: /[ក-៿]/g,
    Grek: /[Ͱ-Ͽἀ-῿]/g,
    Hebr: /[֐-׿]/g,
    Armn: /[԰-֏]/g,
    Hang: /[ᄀ-ᇿ㄰-㆏가-힯]/g,
    Kana: /[぀-ヿㇰ-ㇿ]/g,
    Hani: /[㐀-䶿一-鿿]/g
  };

  const LANG_SCRIPT = {
    ar: "Arab", fa: "Arab", ur: "Arab", ps: "Arab", sd: "Arab", ug: "Arab", ckb: "Arab",
    ru: "Cyrl", uk: "Cyrl", bg: "Cyrl", sr: "Cyrl", mk: "Cyrl", be: "Cyrl", kk: "Cyrl", ky: "Cyrl", mn: "Cyrl", tg: "Cyrl", tt: "Cyrl", ba: "Cyrl", cv: "Cyrl", os: "Cyrl", ce: "Cyrl",
    hi: "Deva", mr: "Deva", ne: "Deva", sa: "Deva", kok: "Deva", mai: "Deva",
    bn: "Beng", as: "Beng", gu: "Gujr", pa: "Guru", ta: "Taml", te: "Telu", kn: "Knda", ml: "Mlym", or: "Orya", si: "Sinh",
    th: "Thai", lo: "Laoo", km: "Khmr", my: "Mymr", ko: "Hang", ja: "Jpan", zh: "Hani", el: "Grek", he: "Hebr", yi: "Hebr", hy: "Armn", ka: "Geor", am: "Ethi", ti: "Ethi", bo: "Tibt"
  };

  // High-frequency words per Latin-script language (compared after accent stripping).
  const STOP = {
    en: "the and of to in is for with on you this that how what why new best from by are at your it be my we all not will can after before about",
    es: "el los las del que por con para una como mas pero muy sus esta este son hay todo",
    fr: "le les des une et du est pour dans que qui sur pas avec ce ces sont plus nous vous",
    de: "der die das und ist nicht mit ein eine von zu den auf fur dem auch wie sich aus nach",
    pt: "os as do da em uma que para com nao se por mais como dos das seu sua voce",
    it: "il lo gli di che un una per con non del della sono come piu nel alla questo",
    nl: "de het een van is dat niet op voor met zijn ook maar dit wordt naar",
    id: "yang dan di ini itu dengan untuk dari tidak pada ke akan ada juga adalah dalam karena",
    ms: "yang dan di ini itu dengan untuk dari tidak pada ke akan ada juga adalah dalam kerana",
    tr: "ve bir bu icin ile olan cok daha nasil neden bugun haber haberler son dakika gundem video",
    pl: "nie to jest na sie w z do ze jak po co ale tak jak czy",
    ro: "si in de la cu pe nu este un pentru care ce mai sunt din",
    sv: "och i att det som en ar pa av for med inte har till",
    da: "og i er det pa med for til ikke en der af",
    no: "og i er det pa med for til ikke en som av",
    fi: "ja on ei etta se oli han mutta kuin tama kun",
    cs: "je se na ze to v s z do ale jak jsou pro nebo",
    hu: "az es hogy nem egy is van meg de ez volt",
    vi: "va cua la co khong duoc cho mot nhung trong den nguoi",
    sw: "na ya wa kwa ni la za katika hii kuwa",
    tl: "ang ng sa mga na ay ako ko ito para ano"
  };
  const STOP_SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(" "))]));
  const FAMILY = { id: ["id", "ms"], ms: ["id", "ms"], da: ["da", "no"], no: ["da", "no"] };

  // Diacritic fingerprints (checked on the raw, accented text).
  const DIACRITICS = {
    tr: /[ğışİ]/i, pl: /[ąćęłńśźż]/i, ro: /[ășțşţ]/i, cs: /[ěřůťďň]/i, hu: /[őű]/i,
    vi: /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i,
    de: /[ß]/i, es: /[ñ¿¡]/i, pt: /[ãõ]/i, fr: /[œèêëàâùûîï]/i,
    sv: /[åäö]/i, da: /[åøæ]/i, no: /[åøæ]/i, fi: /[äö]/i
  };

  const tokens = text => String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2);

  function countMatches(text, re) { const m = text.match(re); return m ? m.length : 0; }

  function scriptCounts(text) {
    const counts = {};
    for (const [name, re] of Object.entries(SCRIPT_RANGES)) counts[name] = countMatches(text, new RegExp(re.source, "g"));
    return counts;
  }

  function latinScores(text) {
    const toks = tokens(text);
    const scores = {};
    for (const [lang, set] of Object.entries(STOP_SETS)) {
      let n = 0;
      for (const t of toks) if (set.has(t)) n++;
      if (DIACRITICS[lang]?.test(text)) n += 2;
      scores[lang] = n;
    }
    return scores;
  }

  /**
   * verdict(text, langCode) -> { match: true|false|null, reason }
   *   true  = text is (very likely) in that language
   *   false = text is clearly in another language/script
   *   null  = cannot tell (names, numbers, emoji only)
   */
  function verdict(rawText, langCode) {
    const code = String(langCode || "").toLowerCase();
    const text = String(rawText || "");
    const sc = scriptCounts(text);
    const total = Object.values(sc).reduce((a, b) => a + b, 0);
    if (total < 3) return { match: null, reason: "too little text" };
    const target = LANG_SCRIPT[code] || "Latn";

    if (target === "Latn") {
      const latinRatio = sc.Latn / total;
      if (latinRatio < 0.6) return { match: false, reason: "different script" };
      const scores = latinScores(text);
      const family = FAMILY[code] || [code];
      const own = Math.max(...family.map(l => scores[l] || 0));
      let bestOther = 0, bestOtherLang = "";
      for (const [lang, n] of Object.entries(scores)) {
        if (family.includes(lang)) continue;
        if (n > bestOther) { bestOther = n; bestOtherLang = lang; }
      }
      if (STOP_SETS[code]) {
        if (own >= 1 && own >= bestOther) return { match: true, reason: `${code} words` };
        if (bestOther >= 1 && bestOther > own) return { match: false, reason: `looks like ${bestOtherLang}` };
        return { match: null, reason: "no language words" };
      }
      // Language without a word list: reject only when it is clearly another known language.
      if (bestOther >= 2) return { match: false, reason: `looks like ${bestOtherLang}` };
      return { match: null, reason: "latin text" };
    }

    // Japanese / Chinese share Han characters; Kana decides.
    if (target === "Jpan") return sc.Kana + sc.Hani > 0 && sc.Kana > 0 ? { match: true, reason: "kana" } : { match: false, reason: "no kana" };
    if (target === "Hani") {
      if (sc.Kana > 0 || sc.Hang > 0) return { match: false, reason: "kana/hangul present" };
      return sc.Hani / total >= 0.4 ? { match: true, reason: "han" } : { match: false, reason: "not enough han" };
    }

    const own = sc[target] || 0;
    if (own / total < 0.4) return { match: false, reason: "different script" };
    let foreign = 0;
    for (const [name, n] of Object.entries(sc)) if (name !== target && name !== "Latn") foreign += n;
    if (foreign > own) return { match: false, reason: "other script dominates" };

    if (target === "Arab") {
      const arabicOnly = countMatches(text, /[يكةى]/g);          // ي ك ة ى
      const persoUrdu = countMatches(text, /[پچژگٹڈڑںےھہکی]/g); // پ چ ژ گ ٹ ڈ ڑ ں ے ھ ہ ک ی
      const urduOnly = countMatches(text, /[ٹڈڑںےھہ]/g);
      if (code === "ar") return persoUrdu > arabicOnly ? { match: false, reason: "Persian/Urdu letters" } : { match: true, reason: "arabic" };
      if (code === "ur") return persoUrdu >= arabicOnly && (persoUrdu > 0) ? { match: true, reason: "urdu" } : { match: false, reason: "arabic letters" };
      if (code === "fa") return persoUrdu > arabicOnly && urduOnly === 0 ? { match: true, reason: "persian" } : { match: false, reason: "not persian" };
      return { match: true, reason: "arabic script" };
    }
    if (target === "Cyrl") {
      const ukr = countMatches(text, /[іїєґІЇЄҐ]/g);
      const ruOnly = countMatches(text, /[ыэёъЫЭЁ]/g);
      if (code === "ru") return ukr > 0 ? { match: false, reason: "ukrainian letters" } : { match: true, reason: "cyrillic" };
      if (code === "uk") return ukr > 0 || ruOnly === 0 ? { match: true, reason: "ukrainian" } : { match: false, reason: "russian letters" };
      if (code === "bg") return ukr > 0 || countMatches(text, /[ыэё]/g) > 0 ? { match: false, reason: "not bulgarian" } : { match: true, reason: "cyrillic" };
    }
    return { match: true, reason: `${target} script` };
  }

  // Topic words in the native language, used to build native searches.
  const TOPICS = {
    en: "news|music|sports|recipes|travel|movies|gaming|technology",
    ar: "أخبار|موسيقى|رياضة|وصفات|سفر|أفلام|ألعاب|تقنية",
    tr: "haberler|müzik|spor|yemek tarifleri|gezi|film|oyun|teknoloji",
    fa: "اخبار|موسیقی|ورزش|دستور پخت|سفر|فیلم|بازی|فناوری",
    ur: "خبریں|موسیقی|کھیل|ترکیب|سفر|فلم|گیمز|ٹیکنالوجی",
    hi: "समाचार|संगीत|खेल|रेसिपी|यात्रा|फिल्म|गेम|तकनीक",
    bn: "খবর|গান|খেলা|রেসিপি|ভ্রমণ|সিনেমা|গেম|প্রযুক্তি",
    es: "noticias|música|deportes|recetas|viajes|películas|videojuegos|tecnología",
    fr: "actualités|musique|sport|recettes|voyage|films|jeux vidéo|technologie",
    de: "Nachrichten|Musik|Sport|Rezepte|Reisen|Filme|Spiele|Technik",
    pt: "notícias|música|esportes|receitas|viagem|filmes|jogos|tecnologia",
    it: "notizie|musica|sport|ricette|viaggi|film|videogiochi|tecnologia",
    ru: "новости|музыка|спорт|рецепты|путешествия|фильмы|игры|технологии",
    uk: "новини|музика|спорт|рецепти|подорожі|фільми|ігри|технології",
    id: "berita|musik|olahraga|resep|wisata|film|game|teknologi",
    ms: "berita|muzik|sukan|resipi|melancong|filem|permainan|teknologi",
    ja: "ニュース|音楽|スポーツ|レシピ|旅行|映画|ゲーム|テクノロジー",
    ko: "뉴스|음악|스포츠|레시피|여행|영화|게임|기술",
    zh: "新闻|音乐|体育|食谱|旅行|电影|游戏|科技",
    th: "ข่าว|เพลง|กีฬา|สูตรอาหาร|ท่องเที่ยว|หนัง|เกม|เทคโนโลยี",
    vi: "tin tức|nhạc|thể thao|công thức nấu ăn|du lịch|phim|game|công nghệ",
    nl: "nieuws|muziek|sport|recepten|reizen|films|games|technologie",
    pl: "wiadomości|muzyka|sport|przepisy|podróże|filmy|gry|technologia",
    el: "ειδήσεις|μουσική|αθλητικά|συνταγές|ταξίδια|ταινίες|παιχνίδια|τεχνολογία",
    he: "חדשות|מוזיקה|ספורט|מתכונים|טיולים|סרטים|משחקים|טכנולוגיה",
    tl: "balita|musika|palakasan|resipe|paglalakbay|pelikula|laro|teknolohiya",
    sw: "habari|muziki|michezo|mapishi|safari|filamu|michezo ya video|teknolojia",
    ta: "செய்திகள்|இசை|விளையாட்டு|சமையல்|பயணம்|திரைப்படம்|கேம்ஸ்|தொழில்நுட்பம்",
    te: "వార్తలు|సంగీతం|క్రీడలు|వంటలు|ప్రయాణం|సినిమా|గేమ్స్|సాంకేతికత",
    mr: "बातम्या|संगीत|क्रीडा|रेसिपी|प्रवास|चित्रपट|गेम|तंत्रज्ञान",
    ro: "știri|muzică|sport|rețete|călătorii|filme|jocuri|tehnologie",
    sv: "nyheter|musik|sport|recept|resor|filmer|spel|teknik",
    cs: "zprávy|hudba|sport|recepty|cestování|filmy|hry|technologie",
    hu: "hírek|zene|sport|receptek|utazás|filmek|játékok|technológia",
    ne: "समाचार|संगीत|खेलकुद|रेसिपी|यात्रा|चलचित्र|खेल|प्रविधि"
  };

  const topics = code => (TOPICS[String(code || "").toLowerCase()] || "").split("|").filter(Boolean);

  globalThis.CMJ_LANG = { verdict, topics, hasTopics: code => !!TOPICS[String(code || "").toLowerCase()], scriptOf: code => LANG_SCRIPT[String(code || "").toLowerCase()] || "Latn" };
})();
