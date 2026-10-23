(() => {
  const safeMessage = (message) => { try { if (!globalThis.chrome?.runtime?.id) return Promise.resolve(null); const r=chrome.runtime.sendMessage(message); return r && typeof r.then === "function" ? r.catch(()=>null) : Promise.resolve(r); } catch (_) { return Promise.resolve(null); } };
  if (globalThis.__CMJ_INTELLIGENCE__) return;
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const list = x => Array.isArray(x) ? x : [];
  const flat = profile => Object.values(profile?.categories || {}).flat().filter(Boolean);
  const categoryTerms = {
    news: ['news','breaking news','headline','current affairs'], politics: ['politics','political','election','government','parliament'],
    music: ['music','song','songs','official audio','lyrics','album'], movies: ['movie','film','cinema','trailer'], drama: ['drama','series','episode','soap'],
    shorts: ['shorts'], memes: ['meme','memes'], comedy: ['comedy','funny','stand up'], celebrity: ['celebrity','gossip','star'], sports: ['football','soccer','cricket','nba','nfl','sports'],
    gaming: ['gaming','gameplay','minecraft','fortnite','valorant','playstation','xbox'], reactions: ['reaction','reacts','reacting'], podcasts: ['podcast'], entertainment: ['entertainment'],
    clickbait: ['shocking','you won’t believe','you wont believe','gone wrong','must watch','insane','crazy'], live: ['live stream','livestream']
  };
  function metadata(card) {
    const q = sel => card?.querySelector(sel)?.innerText || card?.querySelector(sel)?.textContent || '';
    const title = q('#video-title, a#video-title, h3');
    const channel = q('ytd-channel-name,#channel-name');
    const desc = q('#description, yt-formatted-string');
    const meta = q('#metadata-line');
    const href = card?.querySelector('a#thumbnail,a#video-title,a[href*="/watch?v="]')?.href || '';
    let id=''; try { id=new URL(href,location.origin).searchParams.get('v') || ''; } catch(_){ }
    return {title,channel,description:desc,metadata:meta,id,text:[title,channel,desc,meta].join(' ')};
  }
  function scoreTerms(text, terms, cap=10) { const t=norm(text); return [...new Set(list(terms).map(norm).filter(x=>x && t.includes(x)))].slice(0,cap); }
  function languageScore(text, settings, learning=false) {
    const codes = learning ? [...list(settings?.contentLanguages), settings?.learningLanguage] : list(settings?.contentLanguages);
    const terms = [...codes, ...(learning ? list(settings?.learningLanguageKeywords) : [])];
    const hits=scoreTerms(text,terms,8); return {score: Math.min(25,hits.length*8),hits};
  }
  function distraction(text, isShort) {
    const t=norm(text), hits=[];
    for (const [cat,terms] of Object.entries(categoryTerms)) if ((isShort && cat==='shorts') || terms.some(x=>t.includes(norm(x)))) hits.push(cat);
    return [...new Set(hits)];
  }
  function libraryBoost(meta, library) {
    let score=0, reasons=[]; const n=norm(meta.channel), id=meta.id;
    for(const c of list(library?.channels)) if(c?.trusted && (norm(c.title)===n || norm(c.name)===n || c.id===id || (c.url && meta.channel && c.url.toLowerCase().includes(n)))) {score+=20; reasons.push('trusted channel');}
    for(const v of list(library?.videos)) if(v?.id===id || v?.videoId===id) {score+=25; reasons.push(v.favorite?'favorite video':'library video');}
    return {score,reasons};
  }
  function nicheScore(meta, settings, profile) {
    const terms=flat(profile); const titleHits=scoreTerms(meta.title,terms,8), channelHits=scoreTerms(meta.channel,terms,5), descHits=scoreTerms(meta.description,terms,8), textHits=scoreTerms(meta.text,terms,10);
    let score=titleHits.length*8 + channelHits.length*4 + descHits.length*3 + textHits.length*2;
    const intersection = new Set([...titleHits,...channelHits,...descHits].map(norm));
    if(intersection.size>=2) score+=15;
    return {score:Math.min(90,score), hits:[...new Set([...titleHits,...channelHits,...descHits])].slice(0,12)};
  }
  function techScore(meta, settings, profile) {
    const terms=flat(profile); const titleHits=scoreTerms(meta.title,terms,8), channelHits=scoreTerms(meta.channel,terms,5), descHits=scoreTerms(meta.description,terms,8), textHits=scoreTerms(meta.text,terms,10);
    let score=titleHits.length*8 + channelHits.length*4 + descHits.length*3 + textHits.length*2;
    const intersection = new Set([...titleHits,...channelHits,...descHits].map(norm));
    if(intersection.size>=2) score+=15;
    return {score:Math.min(90,score), hits:[...new Set([...titleHits,...channelHits,...descHits])].slice(0,12)};
  }
  function languageModeScore(meta, mode) {
    const code = String(mode.learningLanguage || "").toLowerCase();
    const signal = languageSignalCache[code] || {};
    const signalTerms = [...list(signal.strong), ...list(signal.common)].slice(0, 80);
    const signalHits = scoreTerms(meta.text, signalTerms, 12);
    const ls=languageScore(meta.text,{...mode, learningLanguageKeywords:[...list(mode.learningLanguageKeywords), ...signalTerms]},true); const goalTerms={listening:['listening','speaking','pronunciation','conversation'],vocabulary:['vocabulary','words'],grammar:['grammar'],culture:['culture','traditions','travel'],news:['news'],children:['kids','children'],reading:['reading','story','book'],pronunciation:['pronunciation','accent']};
    let goal=0; const hits=[]; for(const g of list(mode.goals)){for(const t of (goalTerms[g]||[])){if(norm(meta.text).includes(norm(t))){goal+=4;hits.push(t);}}}
    return {score:Math.min(95,ls.score + Math.min(30,signalHits.length*4) + goal),hits:[...ls.hits,...signalHits,...new Set(hits)]};
  }
  const languageSignalCache = {};
  const profileCache = { technology: {categories:{Topics:['technology','software','AI','cloud','programming','Linux','open source'],Formats:['tutorial','guide','review','tips']}}, devops: {categories:{core:['Linux','Docker','Kubernetes','Terraform','Ansible','AWS','Azure','GCP','CI/CD','Git','GitHub','GitLab','Jenkins','ArgoCD','Helm','Prometheus','Grafana','Observability','Infrastructure as Code','SRE','Cloud Infrastructure','Python','Bash','Nginx','PostgreSQL','Redis','Networking','DevSecOps']}} };
  async function loadProfiles(){
    try {
      const ids=['devops','frontend-developer','backend-developer','full-stack-developer','network-engineer','cybersecurity','cloud-engineer','data-engineer','graphic-designer','ui-ux-designer','database-engineer','ai-ml-engineer','student','researcher','custom'];
      const loaded=await Promise.all(ids.map(id=>safeMessage({type:'READ_DATABASE',path:`database/tech/${id}.json`}).then(r=>r?.ok?r.data:null)));
      loaded.forEach((data,i)=>{ if(data) profileCache[ids[i]]=data; });
      const nicheIds=['technology','photography','travel','cooking','personal-finance','fitness','books','science','history','cars','gaming','music','fashion','entrepreneurship','custom'];
      const nicheLoaded=await Promise.all(nicheIds.map(id=>safeMessage({type:'READ_DATABASE',path:`database/niches/${id}.json`}).then(r=>r?.ok?r.data:null)));
      nicheLoaded.forEach((data,i)=>{ if(data) profileCache[`niche:${nicheIds[i]}`]=data; });
      const codes = ['en','tr','ur','ar','de','es','fr','it','pt','ru','ja','ko','zh'];
      await Promise.all(codes.map(code=>safeMessage({type:'READ_DATABASE',path:`database/languages/signals/${code}.json`}).then(r=>{ if(r?.ok) languageSignalCache[code]=r.data; })));
    } catch(_){}
  }
  loadProfiles();
  function classify(card, settings) {
    if (!settings?.intelligenceEnabled) return null;
    const activeMode = String(settings.activeMode || "general");
    const modes = [activeMode];
    const meta=metadata(card), isShort=!!card?.querySelector('a[href^="/shorts/"], ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]');
    let best={mode:'general',relevance:0,distraction:0,action:'show',reasons:[],hits:{}};
    const dHits=distraction(meta.text,isShort); let dScore=Math.min(100,dHits.length*20 + (isShort?20:0));
    if(settings.distraction?.enabled){ for(const h of dHits){ const a=settings.distraction.categories?.[h]; if(a==='hide') dScore+=15; if(a==='deprioritize') dScore+=8; } dScore=Math.min(100,dScore); }
    for(const mode of modes){ const cfg=settings.modeSettings?.[mode]||{}; if(cfg.enabled===false) continue; let r=0,h=[];
      if(mode==='general') {
        const gm=settings.generalMode||{};
        const lang=gm.languageInfluence!==false ? languageScore(meta.text,settings,false) : {score:0,hits:[]};
        const lib=gm.libraryInfluence!==false ? libraryBoost(meta,settings.youtubeLibrary) : {score:0,reasons:[]};
        const topic=gm.topicInfluence!==false ? scoreTerms(meta.title,['how to','tutorial','guide','explained','review','news','technology','learning','education','documentary'],8) : [];
        const channel=gm.channelInfluence!==false ? scoreTerms(meta.channel,['official','academy','education','learning','news','technology'],5) : [];
        r=40+lang.score+lib.score+topic.length*4+channel.length*3; h=[...lang.hits,...topic,...channel,...lib.reasons];
      } else if(mode==='tech') { let profile=profileCache[settings.modeSettings?.tech?.profileId||'devops'] || profileCache.devops; const t=techScore(meta,settings,profile); const l=languageScore(meta.text,cfg); r=t.score+l.score; h=[...t.hits,...l.hits]; }
      else if(mode==='niches'){ let profile=profileCache[`niche:${settings.modeSettings?.niches?.profileId||'technology'}`] || profileCache.technology; const t=nicheScore(meta,settings,profile); const l=languageScore(meta.text,cfg); r=t.score+l.score; h=[...t.hits,...l.hits]; }
      else if(mode==='languageLearning'){ const effective={...cfg, learningLanguage:cfg.learningLanguage || settings.targetLanguage || settings.language || 'en'}; const l=languageModeScore(meta,effective); r=l.score; h=l.hits; }
      else if(mode==='productivity'){ r=50; if(isShort) r-=25; const p=scoreTerms(meta.text,['tutorial','course','guide','how to','explained','documentation','learning'],6); r+=p.length*8; h=p; }
      else if(mode==='custom'){ const p=scoreTerms(meta.text,list(cfg.rules),10); r=Math.min(100,p.length*15); h=p; }
      const lib=libraryBoost(meta,settings.youtubeLibrary); r=Math.min(120,r+lib.score); h.push(...lib.reasons);
      if(r>best.relevance){best={mode,relevance:r,distraction:dScore,action:'show',reasons:[],hits:{[mode]:h.slice(0,15)}};}
    }
    best.distraction=dScore; best.relevance=Math.round(best.relevance);
    const cfg=settings.modeSettings?.[best.mode]||{};
    if(settings.distraction?.enabled && dScore>=Number(settings.distraction.threshold||60)) {
      const hide = dHits.some(x=>settings.distraction.categories?.[x]==='hide');
      if(hide || settings.distraction.action==='hide') best.action='hide'; else best.action='deprioritize';
      best.reasons.push(`distraction: ${dHits.slice(0,5).join(', ')}`);
    } else if(best.relevance < Number(cfg.deprioritizeThreshold||0)) best.action='hide';
    else if(best.relevance < Number(cfg.showThreshold||0)) best.action='deprioritize';
    best.reasons.push(`${best.mode} relevance ${best.relevance}`);
    if(best.distraction) best.reasons.push(`distraction ${best.distraction}`);
    return { ...best, metadata: meta };
  }
  globalThis.__CMJ_INTELLIGENCE__ = { classify, metadata };
})();
