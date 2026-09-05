const API_BASE = '/api/gamble';
const DISCORD_URL = 'https://discord.gg/XuCvYmbU6n';
let account = null;
let activeMines = null;
let crashTimer = null;

const games = [
  {id:'mines',name:'MINES',icon:'💎',desc:'Reveal safe tiles and cash out before a mine.'},
  {id:'plinko',name:'PLINKO',icon:'🔮',desc:'Drop a ball into weighted multiplier slots.'},
  {id:'dice',name:'DICE',icon:'🎲',desc:'Pick high or low and roll 1–100.'},
  {id:'roulette',name:'ROULETTE',icon:'🎡',desc:'Red, black or green.'},
  {id:'coinflip',name:'COINFLIP',icon:'🪙',desc:'Heads or tails.'},
  {id:'crash',name:'CRASH',icon:'🚀',desc:'Ride the multiplier and cash out in time.'}
];
const cases = [
  {id:'daily',name:'DAILY BONUS',icon:'🎁',cooldown:'24h',desc:'Daily role-gated case'},
  {id:'weekly',name:'WEEKLY BONUS',icon:'🧰',cooldown:'7d',desc:'Weekly role-gated case'},
  {id:'monthly',name:'MONTHLY BONUS',icon:'👑',cooldown:'30d',desc:'Monthly role-gated case'},
  {id:'tier1',name:'TIER 1',icon:'🟦',cooldown:'—',desc:'Starter case'},
  {id:'tier2',name:'TIER 2',icon:'🟩',cooldown:'—',desc:'Better rewards'},
  {id:'tier3',name:'TIER 3',icon:'🟨',cooldown:'—',desc:'Better rewards'},
  {id:'tier4',name:'TIER 4',icon:'🟧',cooldown:'—',desc:'Better rewards'},
  {id:'tier5',name:'TIER 5',icon:'🟥',cooldown:'—',desc:'High rewards'}
];

function $(id){return document.getElementById(id)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function money(n){return Number(n||0).toLocaleString()}
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').classList.remove('show'),2600)}
function openDiscord(){window.open(DISCORD_URL,'_blank','noopener,noreferrer')}
async function api(path,opts={}){
  const r=await fetch(API_BASE+path,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
  let data={}; try{data=await r.json()}catch{}
  if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`); return data;
}
function renderGames(){ $('gameGrid').innerHTML=games.map(g=>`<div class="game"><div class="game-icon">${g.icon}</div><h3>${g.name}</h3><p>${g.desc}</p><button class="btn purple" onclick="openGame('${g.id}')">PLAY →</button></div>`).join('') }
function renderCases(){ $('caseGrid').innerHTML=cases.map(c=>`<div class="case" id="case-${c.id}"><div class="case-icon">${c.icon}</div><h3>${c.name}</h3><p>${c.desc}</p><button class="btn" onclick="openCase('${c.id}')">OPEN</button></div>`).join('') }
function renderAccount(){
  if(!account){$('accountLocked').hidden=false;$('accountContent').hidden=true;return}
  $('accountLocked').hidden=true;$('accountContent').hidden=false;
  $('growId').textContent=account.growId||'Unknown';$('avatar').textContent=(account.growId||'?').charAt(0).toUpperCase();
  $('level').textContent=money(account.level);$('balance').textContent=money(account.balance);$('xp').textContent=money(account.xp);$('nextXp').textContent=money(account.nextLevelXp);
  $('xpBar').style.width=Math.min(100,Math.max(0,(account.xp/Math.max(1,account.nextLevelXp))*100))+'%';
  $('discordState').textContent='Discord: '+(account.discordLinked?'linked':'not linked');
  $('rolePill').textContent=account.hasRequiredRole?'ROLE OK':'ROLE REQUIRED';$('rolePill').style.background=account.hasRequiredRole?'#16a34a':'#7f1d1d';
}
async function loadAccount(){try{const d=await api('/account');account=d.account||null;renderAccount();if(account)loadHistory()}catch(e){toast(e.message)}}
async function completeLink(){const code=$('linkCode').value.trim();if(!/^\d{6}$/.test(code))return toast('Enter the 6-digit code from /gamble link');try{const d=await api('/link/complete',{method:'POST',body:JSON.stringify({code})});account=d.account;renderAccount();toast('Account linked successfully!')}catch(e){toast(e.message)}}
async function openCase(id){try{const d=await api('/cases/open',{method:'POST',body:JSON.stringify({caseId:id})});account=d.account;renderAccount();toast(`Case reward: +${money(d.reward)} credits`);loadHistory()}catch(e){toast(e.message)}}
function openModal(title,body){$('modalTitle').textContent=title;$('modalBody').innerHTML=body;$('modal').classList.add('open')}
function closeModal(){if(crashTimer){clearInterval(crashTimer);crashTimer=null}$('modal').classList.remove('open');activeMines=null}
function wagerControl(max=0){return `<label class="small">Wager</label><input class="input" id="wager" type="number" min="1" max="${max||''}" step="1" placeholder="Credits">`}
function openGame(id){
 if(!account)return toast('Link your GTPS account first');
 if(!account.hasRequiredRole)return toast('Required Discord role is missing');
 if(id==='dice')return openModal('DICE',`${wagerControl()}<div class="game-controls"><button class="btn purple" onclick="playSimple('dice','low')">LOW (1–49)</button><button class="btn purple" onclick="playSimple('dice','high')">HIGH (51–100)</button></div><div class="small">Server roll decides the result. Exact odds/payouts are configured server-side.</div><div id="gameResult"></div>`);
 if(id==='coinflip')return openModal('COINFLIP',`${wagerControl()}<div class="game-controls"><button class="btn purple" onclick="playSimple('coinflip','heads')">HEADS</button><button class="btn purple" onclick="playSimple('coinflip','tails')">TAILS</button></div><div id="gameResult"></div>`);
 if(id==='roulette')return openModal('ROULETTE',`${wagerControl()}<div class="game-controls"><button class="btn purple" onclick="playSimple('roulette','red')">🔴 RED</button><button class="btn purple" onclick="playSimple('roulette','black')">⚫ BLACK</button><button class="btn" onclick="playSimple('roulette','green')">🟢 GREEN</button></div><div id="gameResult"></div>`);
 if(id==='plinko')return openModal('PLINKO',`${wagerControl()}<label class="small">Risk</label><select class="input" id="risk"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select><button class="btn purple" style="width:100%;margin-top:10px" onclick="playSimple('plinko',$('risk').value)">DROP BALL</button><div id="gameResult"></div>`);
 if(id==='mines')return openModal('MINES',`${wagerControl()}<label class="small">Mines</label><select class="input" id="mineCount"><option>3</option><option selected>5</option><option>7</option><option>10</option></select><button class="btn purple" style="width:100%;margin-top:10px" onclick="startMines()">START</button><div id="mineBoard"></div><div id="gameResult"></div>`);
 if(id==='crash')return openModal('CRASH',`${wagerControl()}<button class="btn purple" style="width:100%;margin-top:10px" onclick="startCrash()">START ROUND</button><div id="crashDisplay" class="result">1.00×</div><button id="cashoutBtn" class="btn" style="width:100%;margin-top:10px" disabled onclick="cashoutCrash()">CASH OUT</button><div id="gameResult"></div>`);
}
async function playSimple(game,choice){const w=Number($('wager')?.value);if(!Number.isInteger(w)||w<1)return toast('Enter a valid wager');try{const d=await api('/play',{method:'POST',body:JSON.stringify({game,wager:w,choice})});account=d.account;renderAccount();$('gameResult').innerHTML=`<div class="result">${esc(d.message)}<br><b>${d.delta>=0?'+':''}${money(d.delta)} credits</b></div>`;loadHistory()}catch(e){toast(e.message)}}
async function startMines(){const w=Number($('wager')?.value), mines=Number($('mineCount').value);if(!Number.isInteger(w)||w<1)return toast('Enter a valid wager');try{const d=await api('/mines/start',{method:'POST',body:JSON.stringify({wager:w,mines})});activeMines=d.game;renderMineBoard();account=d.account;renderAccount()}catch(e){toast(e.message)}}
function renderMineBoard(){const b=$('mineBoard');b.innerHTML=`<div class="board">${activeMines.tiles.map((_,i)=>`<button class="cell" onclick="revealMine(${i})">?</button>`).join('')}</div><button class="btn" style="width:100%;margin-top:10px" onclick="cashoutMines()">CASH OUT</button>`}
async function revealMine(index){if(!activeMines)return;try{const d=await api('/mines/reveal',{method:'POST',body:JSON.stringify({gameId:activeMines.id,index})});account=d.account;renderAccount();if(d.mine||d.finished){document.querySelectorAll('.cell').forEach((x,i)=>{x.classList.add(d.mines.includes(i)?'mine':'safe');x.textContent=d.mines.includes(i)?'💣':'💎';x.disabled=true});$('gameResult').innerHTML=`<div class="result">${esc(d.message)}</div>`;activeMines=null}else{const btn=document.querySelectorAll('.cell')[index];btn.classList.add('safe');btn.textContent='💎';btn.disabled=true;activeMines=d.game;$('gameResult').innerHTML=`<div class="result">Multiplier ${Number(d.multiplier).toFixed(2)}× • potential ${money(d.potential)} credits</div>`}loadHistory()}catch(e){toast(e.message)}}
async function cashoutMines(){if(!activeMines)return;try{const d=await api('/mines/cashout',{method:'POST',body:JSON.stringify({gameId:activeMines.id})});account=d.account;renderAccount();$('gameResult').innerHTML=`<div class="result">Cashed out at ${Number(d.multiplier).toFixed(2)}× • +${money(d.delta)} credits</div>`;activeMines=null;loadHistory()}catch(e){toast(e.message)}}
async function startCrash(){const w=Number($('wager')?.value);if(!Number.isInteger(w)||w<1)return toast('Enter a valid wager');try{const d=await api('/crash/start',{method:'POST',body:JSON.stringify({wager:w})});account=d.account;renderAccount();$('cashoutBtn').disabled=false;const started=Date.now(),rate=d.rate;crashTimer=setInterval(()=>{const m=1+((Date.now()-started)/1000)*rate;$('crashDisplay').textContent=m.toFixed(2)+'×'},50)}catch(e){toast(e.message)}}
async function cashoutCrash(){try{const d=await api('/crash/cashout',{method:'POST'});if(crashTimer){clearInterval(crashTimer);crashTimer=null}$('cashoutBtn').disabled=true;account=d.account;renderAccount();$('gameResult').innerHTML=`<div class="result">${esc(d.message)}<br><b>${d.delta>=0?'+':''}${money(d.delta)} credits</b></div>`;loadHistory()}catch(e){toast(e.message)}}
async function requestCashout(){const amount=Number($('cashoutAmount').value);if(!Number.isInteger(amount)||amount<1)return toast('Enter a valid amount');try{const d=await api('/cashout',{method:'POST',body:JSON.stringify({amount})});account=d.account;renderAccount();$('cashoutAmount').value='';toast('Cashout request created');loadHistory()}catch(e){toast(e.message)}}
async function loadHistory(){try{const d=await api('/history');$('history').innerHTML=(d.items||[]).map(x=>`<div class="history-row"><span>${esc(x.label)}</span><span class="${x.delta>=0?'win':'loss'}">${x.delta>=0?'+':''}${money(x.delta)}</span></div>`).join('')||'<div class="muted">No activity yet.</div>'}catch(e){console.error(e)}}

document.addEventListener('DOMContentLoaded',()=>{renderGames();renderCases();loadAccount();setInterval(loadAccount,15000)});
$('modal')?.addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
