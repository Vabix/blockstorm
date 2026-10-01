import './style.css';
import { createScene } from './scene';
import { connectSession, createRoom } from './network';
import { DISASTERS, type Disaster, type GameScene, type GameSession, type GameState } from './types';
import { PLAYER_COLORS } from './simulation';

const app = document.querySelector<HTMLDivElement>('#app')!;
const randomName = () => `Gracz${Math.floor(100 + Math.random() * 900)}`;
let storedName = localStorage.getItem('blockstorm-name') || randomName();
let color = localStorage.getItem('blockstorm-color') || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
let scene: GameScene | undefined;
let session: GameSession | undefined;
let state: GameState | undefined;
let playerId = localStorage.getItem('blockstorm-player') || `player-${crypto.randomUUID()}`;
let host = false;
let muted = localStorage.getItem('blockstorm-muted') !== 'false';
let currentUrl = location.href;
let inviteDialogOpen = false;
let statusText = '';
let showFriends = false;
let preferredRoom: { roomId: string; secret: string; host: boolean } | undefined;
let landingScene: GameScene | undefined;
let currentDisaster: Disaster = 'tornado';
let toastTimer: number | undefined;
let activeRoom: { roomId: string; secret: string } | undefined;

localStorage.setItem('blockstorm-player', playerId);
document.documentElement.dataset.muted = String(muted);

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icons: Record<string,string> = {
logo:'<path d="M13 2 3 14h7l-1 8 12-14h-8l1-6Z"/>',home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',game:'<rect x="2.5" y="6" width="19" height="12" rx="4"/><path d="M7 12h5m-2.5-2.5v5M17 11h.01M19 13h.01"/>',discover:'<circle cx="12" cy="12" r="9"/><path d="m15.7 8.3-2.4 5-5 2.4 2.4-5z"/>',people:'<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',plus:'<path d="M12 5v14m-7-7h14"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',close:'<path d="m18 6-12 12M6 6l12 12"/>',sound:'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/>',mute:'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m17 9 5 6m0-6-5 6"/>',settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m19.4 15 .1.1 1.4 1.1-1.5 2.6-1.7-.7a8 8 0 0 1-1.4.8l-.3 1.9h-3l-.3-1.9a8 8 0 0 1-1.5-.8l-1.7.7-1.5-2.6L7.4 15a8 8 0 0 1 0-1.8L6 12l1.5-2.6 1.7.7a8 8 0 0 1 1.4-.8L11 7.4h3l.3 1.9a8 8 0 0 1 1.5.8l1.7-.7L19 12l-1.4 1.2a8 8 0 0 1-.2 1.8Z" transform="translate(-.7 -1)"/>',spark:'<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',tornado:'<path d="M3 5h18M5 9h14m-11 4h8m-6 4h4m-4 3h4"/>',wave:'<path d="M2 17c4-8 7 8 11 0s7 8 11 0M2 10c4-8 7 8 11 0s7 8 11 0"/>',quake:'<path d="m13 2-3 8h7l-6 12 2-9H6l7-11Z"/>',meteor:'<path d="M12 2 10.4 8.4 4 10l6.4 1.6L12 18l1.6-6.4L20 10l-6.4-1.6L12 2Z"/><path d="m19 17 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" transform="translate(-1 -3)"/>'
};
function icon(name:string,size=18){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||''}</svg>`}
function toast(text:string){const el=document.getElementById('toast');if(el){el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>el.classList.remove('visible'),2400)}}
function readHash(): {roomId:string;secret:string}|undefined {
  const raw = location.hash.slice(1); if(!raw) return;
  try { const p = new URLSearchParams(raw);const roomId=p.get('room'),secret=p.get('key');if(roomId&&secret&&/^[\w-]{16,64}$/.test(roomId)&&/^[\w-]{43}$/.test(secret))return{roomId,secret}; } catch { /* Ignore invalid shared links. */ }
}
function shell(content:string, active='home') {
  return `<div class="app-shell"><aside class="sidebar">
    <a class="brand" href="#" aria-label="Blockstorm"><span class="brand-icon">${icon('logo',25)}</span><span class="brand-name">block<span>storm</span><i>.</i></span></a>
    <span class="nav-caption">ODKRYWAJ</span><button class="nav-link ${active==='home'?'active':''}" data-action="home">${icon('home')}<span>Strona główna</span></button>
    <button class="nav-link ${active==='games'?'active':''}" data-action="play">${icon('game')}<span>Gry</span><span class="new-dot"></span></button>
    <button class="nav-link" data-action="friends">${icon('people')}<span>Znajomi</span><span class="nav-count">${state?.players.filter(p=>p.id!==playerId).length||'+'}</span></button>
    <div class="sidebar-rule"></div><span class="nav-caption">OSTATNIO GRANE</span>
    <button class="recent-game" data-action="play"><span class="recent-thumb">🚨</span><span><strong>Don't Press the Button</strong><small>Nowa gra · survival</small></span></button>
    <div class="sidebar-bottom"><div class="online-indicator"><span></span> Jesteś w grze <strong id="online-count">${state?.players.length||1}</strong></div><button class="profile" data-action="name"><span class="avatar-dot" style="--player-color:${color}">${escapeHtml(storedName.slice(0,1).toUpperCase())}</span><span class="profile-name"><strong>${escapeHtml(storedName)}</strong><small>Gracz</small></span><span class="profile-edit">•••</span></button></div>
  </aside><div class="app-main"><header class="topbar"><div class="breadcrumbs"><span>Odkrywaj</span><span class="crumb-slash">/</span><strong>${active==='friends'?'Znajomi':'Gry'}</strong></div><div class="topbar-right"><span class="platform-pill"><span class="platform-dot"></span> PLATFORM ONLINE</span><button class="icon-button" data-action="sound" title="Dźwięk" aria-label="${muted?'Włącz':'Wycisz'} dźwięk">${icon(muted?'mute':'sound')}</button><button class="upgrade-button" data-action="share">${icon('people',16)} <span>Zaproś znajomego</span></button></div></header>${content}</div></div><div id="toast" role="status"></div>`;
}

function cardSvg(type:Disaster){const colors={tornado:['#cbbaff','#413285','#130c2b'],earthquake:['#ffd29a','#7f4828','#2d1a14'],tsunami:['#9fe9ff','#196b9b','#0c2637'],meteors:['#ffaf9b','#873335','#271519']}[type];return `<div class="game-tile-art art-${type}" style="--tint:${colors[0]};--deep:${colors[1]};--night:${colors[2]}"><div class="tile-stars">✳ &nbsp;· &nbsp; ⋆ &nbsp;· &nbsp;✳</div><div class="tile-art-shape"></div><span class="art-label">${type==='tornado'?'F5':type==='earthquake'?'RÓW':type==='tsunami'?'WAVE':'FALL'}</span><span class="art-player">◼</span></div>`}
function renderLanding() {
  document.body.classList.remove('playing');
  const disasters:Disaster[]=['tornado','earthquake','tsunami','meteors'];
  app.innerHTML=shell(`<main class="hub">
    <div class="hub-eyebrow"><span class="live-dot"></span> NOWA GRA &nbsp;·&nbsp; PREMIERA</div>
    <div class="hub-title-row"><div><h1>Nie naciskaj<span class="title-soft">…</span><br/><span>albo naciskaj.</span></h1><p class="hub-description">Przeżyjesz wielką katastrofę? Zaproś znajomych i sprawdźcie, kto ucieknie ostatni.</p></div><div class="player-count"><span class="count-avatars"><i></i><i></i><i></i><i></i></span><strong id="landing-count">1</strong><span>gotowy do zabawy</span></div></div>
    <section class="featured-game" aria-label="Główna gra">
      <div class="featured-scene-wrap" id="preview-canvas"><div class="preview-shimmer"></div></div><div class="scene-vignette"></div>
      <div class="featured-top"><span class="featured-tag"><span class="live-dot"></span> TRYB SURVIVAL</span><span class="featured-mode">WERSJA TESTOWA &nbsp;·&nbsp; #01</span></div>
      <div class="featured-center" id="preview-copy"><span class="press-badge">GŁÓWNA GRA TESTOWA</span><span class="featured-title">Don't Press<br/>the Button<span class="title-period">.</span></span><span class="featured-subtitle">Jedna wyspa. Jeden przycisk. Zero bezpiecznych miejsc.</span></div>
      <div class="featured-bottom"><div class="world-status"><span class="world-avatar">▰</span><span><strong>Blockstorm Originals</strong><small>Własna wyspa · wielu graczy</small></span></div><button class="start-game" data-action="play"><span>${icon('game',18)} <b>ZAGRAJ TERAZ</b></span>${icon('arrow',17)}</button></div>
    </section>
    <div class="play-strip"><span class="play-strip-mark">${icon('spark')}</span><span><strong>Grajcie razem, gdziekolwiek jesteście.</strong><small>Utwórz pokój i wyślij link. Kolega dołącza prosto z przeglądarki.</small></span><button data-action="create" class="strip-button">Utwórz pokój <span>${icon('arrow',15)}</span></button></div>
    <section class="disasters-section"><div class="section-heading"><div><div class="section-eyebrow">CO NA WAS CZEKA</div><h2>Cztery sposoby na kłopoty</h2></div><span class="world-badge">${icon('game',14)}&nbsp; 01 &nbsp;/&nbsp; 04</span></div><div class="disaster-grid">${disasters.map((d,i)=>`<button class="disaster-card" data-disaster="${d}" data-action="${d==='tornado'?'play':'preview-disaster'}">${cardSvg(d)}<span class="card-info"><span class="card-kicker">KATASTROFA 0${i+1}</span><strong>${DISASTERS[d].name}</strong><small>${d==='tornado'?'Nie daj się porwać.':d==='earthquake'?'Ziemia pęka pod nogami.':d==='tsunami'?'Uciekaj na wysokość.':'Uważaj na strefy uderzenia.'}</small></span><span class="card-launch">${icon('arrow',16)}</span></button>`).join('')}</div></section>
    <footer class="hub-footer"><span>BLOCKSTORM ORIGINALS <i>®</i></span><span>STWORZONE DO WSPÓLNEJ ZABAWY <span class="footer-lime">✳</span></span><a href="https://github.com/Vabix/blockstorm" target="_blank" rel="noopener noreferrer">OTWARTY KOD ↗</a></footer>
  </main><div id="game-view" class="game-view hidden"></div><div id="modal-root"></div>`, 'home');
  attachShellHandlers();
  preferredRoom=undefined;
  if(!landingScene){const preview=document.getElementById('preview-canvas');if(preview){try {landingScene=createScene(preview,{preview:true,onInput:()=>{},onPress:()=>{}});landingScene.setMuted(muted);}catch(error){console.error('Preview renderer:',error);preview.innerHTML='<div class="preview-fallback"><span>▰ BLOCKSTORM ISLAND</span><strong>W obliczu żywiołu wszyscy są równi.</strong></div>';} }}
}

function renderPlay() {
  document.body.classList.add('playing'); landingScene?.dispose();landingScene=undefined;
  app.innerHTML=shell(`<main class="play-layout"><section class="game-stage"><div class="game-hud top-hud"><div class="round-chip"><span class="live-dot" id="phase-dot"></span><span id="phase-label">ŁĄCZENIE Z WYSPĄ</span><b id="round-label">ROZGRYWKA #01</b></div><div class="hud-players" id="hud-players">1 GRACZ</div></div><div id="world" class="world-canvas"></div><div class="game-hud bottom-hud"><div class="hazard-left"><span class="hazard-icon">${icon('tornado',17)}</span><span><small>NASTĘPNA KATASTROFA</small><strong id="hazard-name">CZEKAJ NA GOSPODARZA</strong></span></div><div class="hazard-timer"><span id="hazard-time">--:--</span><span class="timer-progress"><i id="timer-bar"></i></span></div></div><div class="warning-overlay hidden" id="warning-overlay"><span>OSTRZEŻENIE</span><strong id="warning-name">TORNADO NADCIĄGA</strong><small id="warning-instruction">Szukaj schronienia!</small></div><div class="game-hint" id="game-hint"><kbd>W A S D</kbd> RUCH <kbd>SPACJA</kbd> SKOK <kbd>E</kbd> PRZYCISK</div></section><aside class="game-sidebar"><div class="room-card"><div class="room-label"><span class="live-dot"></span> TWOJE LOBBY <span id="room-members">01 / 08</span></div><div class="room-code-row"><div><small>KOD POKOJU</small><strong id="room-code">ŁĄCZENIE…</strong></div><button class="icon-button copy-room" data-action="share" title="Udostępnij pokój">${icon('copy')}</button></div><button class="invite-link" data-action="share">${icon('link',15)} UDOSTĘPNIJ LINK ZAPROSZENIA ${icon('arrow',13)}</button><div class="lobby-divider"></div><div class="roster-heading"><strong>GRACZE</strong><span id="players-count">01 / 08</span></div><div id="player-roster" class="player-roster"><div class="player-item"><span class="avatar-dot" style="--player-color:${color}">${escapeHtml(storedName[0].toUpperCase())}</span><span>${escapeHtml(storedName)}</span><span class="host-crown">GOSPODARZ</span></div></div><div class="invite-empty" id="invite-empty">${icon('people',20)}<span>Wyślij link znajomemu, żeby<br/>dołączył do Waszego lobby.</span></div></div><button class="giant-button-card" id="press-card" data-action="press" disabled><span class="button-ping"></span><span class="button-callout">TROCHĘ RYZYKUJESZ</span><span class="button-statement">NIE<br/>NACISKAJ.</span><span class="button-action" id="button-action">CZEKAM NA POZOSTAŁYCH GRACZY<span>→</span></span></button><button class="back-home" data-action="home">← Wróć na stronę główną</button></aside></main><div class="game-alert" id="game-alert"></div><div id="modal-root"></div>`, 'games');
  attachShellHandlers();
  const world=document.getElementById('world')!;
  scene=createScene(world,{onInput:input=>session?.sendInput(input),onPress:()=>session?.pressButton()});scene.setMuted(muted);
  if(preferredRoom){const{roomId,secret,host:isHost}=preferredRoom;preferredRoom=undefined;startSession(roomId,secret,isHost);}
  else connectOnline();
}

async function connectOnline(){
  const requested=readHash();
  if(requested){host=false;await startSession(requested.roomId,requested.secret,false);return;}
  const room=createRoom();host=true;history.replaceState(null,'',`${location.pathname}${location.search}#room=${room.roomId}&key=${room.secret}`);await startSession(room.roomId,room.secret,true);
}

async function startSession(roomId:string,secret:string,isHost:boolean){
  if(!document.getElementById('world'))return;
  session?.close();host=isHost;activeRoom={roomId,secret};const me=playerId;
  if(isHost){const inviteUrl=`${location.origin}${location.pathname}#room=${roomId}&key=${secret}`;history.replaceState(null,'',inviteUrl);}
  updateLocalStatus(isHost?'Tworzenie prywatnego pokoju…':'Dołączanie do pokoju…',false);
  try{
    const connected=await connectSession({roomId,secret,playerId:me,name:storedName,color,host:isHost,onState:next=>{if(me!==playerId||!document.getElementById('world'))return;state=next;scene?.setState(next,playerId);updateGame(next);},onStatus:updateLocalStatus});
    if(me!==playerId){connected.close();return;}session=connected;
  }catch(error){if(me!==playerId)return;updateLocalStatus(error instanceof Error?error.message:'Nie udało się połączyć z pokojem.',false);setConnectionError(error instanceof Error?error.message:'Nie udało się połączyć z pokojem.');}
}

function updateLocalStatus(message:string,connected:boolean){statusText=message;const label=document.getElementById('phase-label');if(label&&(!state||!connected))label.textContent=message.toLocaleUpperCase('pl-PL');document.querySelectorAll<HTMLElement>('.sidebar .online-indicator').forEach(e=>e.title=message);const dot=document.getElementById('phase-dot');if(dot){dot.classList.toggle('offline',!connected);dot.classList.toggle('connecting',connected&&!state);}}

function updateGame(next:GameState){
 const mine=next.players.find(p=>p.id===playerId);const others=next.players.filter(p=>p.id!==playerId);
 const hostId=next.hostId===playerId?'GOSPODARZ':'';
 const profileName=document.querySelector('.profile-name strong');if(profileName)profileName.textContent=storedName;const profileAvatar=document.querySelector<HTMLElement>('.profile .avatar-dot');if(profileAvatar){profileAvatar.textContent=storedName.slice(0,1).toUpperCase();profileAvatar.style.setProperty('--player-color',color);}
 const room=next.roomId.slice(0,7).toUpperCase();const count=next.players.length;
 const set=(id:string,value:string)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
 set('online-count',String(count));set('room-members',`${String(count).padStart(2,'0')} / 08`);set('players-count',`${String(count).padStart(2,'0')} / 08`);set('room-code',room);set('hud-players',`${count} ${count===1?'GRACZ':count<5?'GRACZY':'GRACZY'}`);set('round-label',`ROZGRYWKA #${String(Math.max(1,next.round)).padStart(2,'0')}`);
 const phaseNames={waiting:'LOBBY • CZEKA NA PRZYCISK',warning:`ALARM • ${DISASTERS[next.disaster].name}`,disaster:`KATASTROFA • ${DISASTERS[next.disaster].name}`,results:'KONIEC RUNY • GRATULACJE OCALAŁYM'};
 set('phase-label',phaseNames[next.phase]);set('hazard-name',next.phase==='waiting'?'NACIŚNIJ PRZYCISK':DISASTERS[next.disaster].name);set('button-action',next.phase==='waiting'?'TO JEST TEN PRZYCISK':'CZEKAJ NA NASTĘPNĄ RUNDĘ →');
 const press=document.getElementById('press-card') as HTMLButtonElement|null;if(press){press.disabled=next.phase!=='waiting';press.classList.toggle('armed',next.phase==='waiting');}
 const warning=document.getElementById('warning-overlay');const showing=next.phase==='warning'||next.phase==='disaster';warning?.classList.toggle('hidden',!showing);if(showing){set('warning-name',next.phase==='warning'?`${DISASTERS[next.disaster].name} NADCIĄGA`:`${DISASTERS[next.disaster].name} ATAKUJE`);set('warning-instruction',next.phase==='warning'?`Start za ${Math.max(1,Math.ceil((next.phaseEndsAt-Date.now())/1000))} sek. — ${DISASTERS[next.disaster].instruction}`:DISASTERS[next.disaster].instruction);}
 const countdown=document.getElementById('hazard-time');const deadline=next.phase==='waiting'?null:next.phaseEndsAt;if(countdown)countdown.textContent=deadline===null?'GOTÓW':`${Math.max(0,Math.ceil((deadline-Date.now())/1000))}s`;
 const progress=document.getElementById('timer-bar') as HTMLElement|null;if(progress&&deadline!==null){const total=next.phase==='warning'?5:next.phase==='disaster'?DISASTERS[next.disaster].duration/1000:6;const left=Math.max(0,(deadline-Date.now())/1000);progress.style.width=`${Math.min(100,Math.max(0,100-left/total*100))}%`;}
 const roster=document.getElementById('player-roster');if(roster){roster.innerHTML=next.players.map(p=>`<div class="player-item ${p.id===playerId?'self-player':''} ${!p.alive?'dead-player':''}"><span class="avatar-dot" style="--player-color:${p.color}">${escapeHtml(p.name[0].toUpperCase())}</span><span class="roster-name">${escapeHtml(p.name)} ${p.id===playerId?'<small>(Ty)</small>':''}</span><span class="roster-score">${!p.alive&&next.phase==='disaster'?'☠':`✦ ${p.score}`}</span><span class="host-crown ${p.id===next.hostId?'visible':''}">${p.id===next.hostId?'GOSPODARZ':''}</span></div>`).join('');}
 const inviteEmpty=document.getElementById('invite-empty');inviteEmpty?.classList.toggle('hidden',count>1);const gameDot=document.getElementById('phase-dot');gameDot?.classList.toggle('offline',false);
 if(mine&&!mine.alive&&next.phase==='disaster'){const alert=document.getElementById('game-alert');if(alert){alert.innerHTML=`<span>✦</span> Odpadasz! Wynik: <strong>${mine.score} ${mine.score===1?'przetrwana runda':'przetrwane rundy'}</strong>`;alert.classList.add('show');window.setTimeout(()=>alert.classList.remove('show'),2200);}}
}

function setConnectionError(message:string){const action=document.getElementById('button-action');if(action)action.innerHTML='POŁĄCZENIE NIEUDANE <span>↻</span>';const phase=document.getElementById('phase-label');if(phase){phase.textContent='POŁĄCZENIE NIEUDANE';phase.classList.add('error-text');}const card=document.getElementById('room-code');if(card){card.textContent='OFFLINE';card.title=message;}const cardButton=document.getElementById('press-card')as HTMLButtonElement|null;if(cardButton)cardButton.disabled=true;let alert=document.getElementById('connection-error');if(!alert){alert=document.createElement('div');alert.id='connection-error';alert.className='connection-error';document.querySelector('.game-stage')?.append(alert);}alert.innerHTML=`<span>${icon('close',15)}</span><div><strong>Nie udało się uruchomić trybu online</strong><small>${escapeHtml(message)}</small><small>Spróbuj odświeżyć stronę lub sprawdź połączenie. Gra online wymaga szyfrowanego dostępu do publicznego serwera pokoi.</small></div><button data-action="retry" class="retry-button">Spróbuj ponownie</button>`;}

function showShare(){const modal=document.getElementById('modal-root');if(!modal)return;if(!state?.roomId){toast('Pokój jeszcze się łączy. Spróbuj za chwilę.');return;}
 const hash=location.hash;const link=location.origin+location.pathname+hash;modal.innerHTML=`<div class="modal-backdrop" data-action="dismiss-modal"><div class="modal invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button class="modal-close icon-button" data-action="dismiss-modal" aria-label="Zamknij">${icon('close')}</button><span class="modal-kicker">NIECH ZAPANUJE CHAOS</span><h2 id="invite-title">Twoi znajomi.<br/>Wasze przetrwanie.</h2><p>Wyślij link i wejdźcie razem na wyspę. Znajomy nie potrzebuje konta.</p><div class="share-field"><span>${escapeHtml(link.replace(location.origin,''))}</span><button data-action="copy">${icon('copy',16)} KOPIUJ</button></div><div class="invite-tip">${icon('spark',16)} Link zawiera klucz szyfrujący dostęp do prywatnego pokoju. Udostępniaj go tylko swoim znajomym.</div></div></div>`;modal.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target===e.currentTarget)modal.innerHTML='';});modal.querySelector('.modal-close')?.addEventListener('click',()=>modal.innerHTML='');modal.querySelector('[data-action="copy"]')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(link);toast('Link zaproszenia skopiowany!');modal.innerHTML='';}catch{const field=modal.querySelector('.share-field span');if(field){const selection=window.getSelection();selection?.selectAllChildren(field);toast('Zaznaczony link — naciśnij Ctrl+C');}}});
}

function showNameDialog(){const modal=document.getElementById('modal-root');if(!modal)return;modal.innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><button class="modal-close icon-button" data-action="dismiss">${icon('close')}</button><span class="modal-kicker">TWÓJ AVATAR</span><h2>Jak Cię wołają?</h2><label class="form-label">PSEUDONIM <input id="name-input" class="name-input" maxlength="18" value="${escapeHtml(storedName)}" placeholder="Twój nick" /></label><span class="form-label color-label">WYBIERZ KOLOR</span><div class="color-picker">${PLAYER_COLORS.map(value=>`<button class="color-option ${value===color?'selected':''}" style="--swatch:${value}" data-color="${value}" aria-label="Kolor ${value}"></button>`).join('')}</div><button class="save-profile" data-action="save-name">Zapisz profil <span>→</span></button></div></div>`;modal.querySelector('[data-action="dismiss"]')?.addEventListener('click',()=>modal.innerHTML='');modal.querySelectorAll<HTMLElement>('[data-color]').forEach(button=>button.addEventListener('click',()=>{color=button.dataset.color||color;modal.querySelectorAll('.color-option').forEach(b=>b.classList.remove('selected'));button.classList.add('selected');}));modal.querySelector('[data-action="save-name"]')?.addEventListener('click',()=>{storedName=(modal.querySelector<HTMLInputElement>('#name-input')?.value||'').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18)||randomName();localStorage.setItem('blockstorm-name',storedName);localStorage.setItem('blockstorm-color',color);modal.innerHTML='';if(session){session.updateProfile(storedName,color);if(state)updateGame(state);}else if(document.getElementById('world')&&activeRoom){preferredRoom={...activeRoom,host};scene?.dispose();scene=undefined;renderPlay();}else if(document.getElementById('world'))renderPlay();else renderLanding();});}

function showJoinDialog(){const modal=document.getElementById('modal-root');if(!modal)return;modal.innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><button class="modal-close icon-button" data-action="dismiss">${icon('close')}</button><span class="modal-kicker">MAMY MIEJSCE NA WAS</span><h2>Wklej zaproszenie.</h2><p>Wpisz link od znajomego, żeby trafić prosto na jego wyspę.</p><label class="form-label">LINK DO POKOJU <input id="join-input" class="name-input" placeholder="https://...#room=…&key=…" /></label><button class="save-profile" data-action="join-room">Dołącz do znajomego <span>→</span></button></div></div>`;modal.querySelector('[data-action="dismiss"]')?.addEventListener('click',()=>modal.innerHTML='');modal.querySelector('[data-action="join-room"]')?.addEventListener('click',()=>{const input=modal.querySelector<HTMLInputElement>('#join-input');try{const url=new URL(input?.value||'');const raw=new URLSearchParams(url.hash.slice(1));const roomId=raw.get('room'),secret=raw.get('key');if(!roomId||!secret)throw new Error();history.replaceState(null,'',`${location.pathname}${location.search}#room=${roomId}&key=${secret}`);modal.innerHTML='';renderPlay();}catch{if(input){input.classList.add('input-error');input.placeholder='Nieprawidłowy link — spróbuj ponownie';}}});}

function action(action:string){
 switch(action){case'home':scene?.dispose();scene=undefined;session?.close();session=undefined;state=undefined;activeRoom=undefined;history.replaceState(null,'',location.pathname+location.search);renderLanding();break;case'play':case'create':case'preview-disaster':if(document.getElementById('world'))break;history.replaceState(null,'',location.pathname+location.search);renderPlay();break;case'friends':showJoinDialog();break;case'share':showShare();break;case'copy':break;case'press':if(state?.phase==='waiting')session?.pressButton();break;case'sound':muted=!muted;localStorage.setItem('blockstorm-muted',String(muted));scene?.setMuted(muted);document.querySelector<HTMLButtonElement>('[data-action="sound"]')!.innerHTML=icon(muted?'mute':'sound');document.querySelector<HTMLButtonElement>('[data-action="sound"]')!.setAttribute('aria-label',muted?'Włącz dźwięk':'Wycisz dźwięk');break;case'name':showNameDialog();break;case'dismiss-modal':{const modal=document.getElementById('modal-root');if(modal)modal.innerHTML='';break;}case'retry':{document.getElementById('connection-error')?.remove();if(activeRoom)startSession(activeRoom.roomId,activeRoom.secret,host);else connectOnline();break;}}
}
function attachShellHandlers(){app.querySelectorAll<HTMLElement>('[data-action]').forEach(el=>el.addEventListener('click',()=>action(el.dataset.action||'')));}
window.addEventListener('keydown',e=>{if(e.key==='Escape'){const modal=document.getElementById('modal-root');if(modal)modal.innerHTML='';}});
window.addEventListener('pagehide',()=>{scene?.dispose();landingScene?.dispose();session?.close();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)updateGame(state);});

const invite=readHash();if(invite){renderPlay();}else renderLanding();
