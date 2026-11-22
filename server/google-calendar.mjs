import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import {openCalendarVault} from './calendar-vault.mjs';
const SCOPES=['https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const hash=s=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const api='https://www.googleapis.com/calendar/v3';
const FULL_REFRESH_MS=10*60_000;
const UPDATE_OVERLAP_MS=60_000;
const eventKey=(connectionId,calendarId,eventId)=>`google:${connectionId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
class CalendarFailure extends Error {constructor(status,message){super(message);this.status=status;}}
const failure=(status,message)=>{throw new CalendarFailure(status,message);};
export function normalizeGoogleEvent(item,connectionId,calendar) {
  if(item.status==='cancelled')return null;
  const timestamp = part => {
    if (!part?.dateTime) return part?.date;
    // The list request asks for UTC. Never interpret an ambiguous upstream value in the host timezone.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(part.dateTime) || !Number.isFinite(Date.parse(part.dateTime)))
      failure(502,'Google 返回了无效事件时间，已保留上次同步');
    return new Date(part.dateTime).toISOString();
  };
  const start=timestamp(item.start), end=timestamp(item.end);
  if(!item.id||!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<Date.parse(start))throw new Error('Google 返回了无效事件，已保留上次同步');
  const text=v=>String(v||'').slice(0,12000);
  return {id:eventKey(connectionId,calendar.id,item.id),uid:text(item.iCalUID||item.id),title:text(item.summary||'未命名事件'),location:text(item.location),description:text(item.description),start,end,allDay:!!item.start.date,timezone:item.start.timeZone||calendar.timeZone||'UTC',calendar:text(calendar.summary||calendar.id),google:{connectionId,calendarId:calendar.id,eventId:item.id,updated:item.updated||'',originalStart:item.originalStartTime?.dateTime||item.originalStartTime?.date||null}};
}
export function createGoogleCalendarService({env=process.env,fetcher=fetch,now=Date.now,openVault=openCalendarVault,intervalMs=120000,accountFor=async()=>null}={}) {
  const origin=env.PUBLIC_ORIGIN||`http://127.0.0.1:${env.PORT||8787}`;
  const base=new URL(origin);if(base.pathname!=='/'||base.search||base.hash||base.username||base.password||(!['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&base.protocol!=='https:'))throw new Error('日历同步需要 HTTPS 或本机地址');
  const redirectUri=env.GOOGLE_REDIRECT_URI||`${base.origin}/api/calendar/google/callback`;
  if(new URL(redirectUri).href!==`${base.origin}/api/calendar/google/callback`)throw new Error('Google 回调地址必须属于本站');
  const configured=!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
  let vaultPromise,timer;const locks=new Map();
  const vault=()=>vaultPromise??=openVault(env.CALENDAR_DATA_DIR||resolve('.wayline-private'));
  const keyFor=(session,owner)=>hash(`${session}:${owner}`);
  const send=(response,status,payload)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(payload));};
  const cookie=(response,value,maxAge=2592000)=>response.setHeader('Set-Cookie',`wayline_calendar=${value}; Path=/api/calendar; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${base.protocol==='https:'?'; Secure':''}`);
  async function sessionFor(req,res,create=false) {
    const store=await vault(),token=/(?:^|;\s*)wayline_calendar=([A-Za-z0-9_-]+)/.exec(req.headers.cookie||'')?.[1];
    if(token){const id=hash(token);if(store.data.sessions[id]?.until>now())return id;}
    if(!create)return null;
    for(const [id,s]of Object.entries(store.data.sessions))if(s.until<=now()){delete store.data.sessions[id];for(const [k,c]of Object.entries(store.data.connections))if(c.session===id)delete store.data.connections[k];}
    if(Object.keys(store.data.sessions).length>=1000)failure(503,'日历连接暂时繁忙');
    const value=random(),id=hash(value);store.data.sessions[id]={until:now()+2592000000};await store.save();cookie(res,value);return id;
  }
  const ownerFrom=url=>{const owner=url.searchParams.get('owner')||'';if(!owner||owner.length>160||/[\u0000-\u001f]/.test(owner))failure(400,'请重新选择当前空间');return owner;};
  async function requireOwner(req, owner) {
    if (!owner.startsWith('google:')) return;
    const account = await accountFor(req);
    if (!account || !same(owner, 'google:' + account.id)) failure(401,'请先登录对应的 Wayline 账号');
    return account;
  }
  async function jsonBody(req){let text='';for await(const part of req){text+=part;if(text.length>16000)failure(413,'日历请求过大');}try{return JSON.parse(text||'{}');}catch{failure(400,'日历请求无效');}}
  const jsonFetch=async(url,options={})=>{
    const response=await fetcher(url,{...options,signal:AbortSignal.timeout(15000)});let body;try{body=await response.json();}catch{failure(502,'Google 日历暂时不可用');}
    if (!response.ok) {
      if (body?.error === 'invalid_grant' || response.status === 401)
        failure(401,'Google 授权已失效，请重新连接');
      const reasons = Array.isArray(body?.error?.errors) ? body.error.errors.map(item => item?.reason) : [];
      if (response.status === 429 || (response.status === 403 && reasons.some(reason =>
        ['rateLimitExceeded','userRateLimitExceeded','quotaExceeded','dailyLimitExceeded'].includes(reason))))
        failure(429,'Google 日历暂时达到查询额度，已保留上次结果，请稍后重试');
      if ((response.status === 400 || response.status === 410) && String(url).includes('updatedMin='))
        failure(409,'Google 日历需要完整刷新');
      if (response.status === 403) failure(403,'Google 日历权限不足，请重新授权');
      failure(502,'Google 日历暂时无法同步，已保留上次结果');
    }
    if(!body||typeof body!=='object'||Array.isArray(body))failure(502,'Google 日历结果不完整，已保留上次结果');
    return body;
  };
  async function tokenFor(connection) {
    if(connection.token.expiresAt>now()+60000)return connection.token.access;
    const data=await jsonFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:connection.token.refresh})});
    if(!data.access_token)failure(502,'Google 未返回有效授权');
    connection.token={access:data.access_token,refresh:data.refresh_token||connection.token.refresh,expiresAt:now()+Number(data.expires_in||3600)*1000};await(await vault()).save();return connection.token.access;
  }
  async function google(connection,path,params={}){const access=await tokenFor(connection);return jsonFetch(`${api}${path}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${access}`}});}
  async function calendarList(connection){const rows=[];let pageToken='';for(let i=0;i<20;i++){const page=await google(connection,'/users/me/calendarList',{maxResults:'250',...(pageToken?{pageToken}:{})});rows.push(...(page.items||[]).filter(c=>!c.deleted&&['owner','writer','reader'].includes(c.accessRole)));pageToken=page.nextPageToken||'';if(!pageToken)return rows.map(c=>({id:c.id,summary:c.summary||c.id,timeZone:c.timeZone||'UTC',primary:!!c.primary}));}failure(502,'日历列表过大，请稍后重试');}
  async function snapshot(connection,selected,startedAt,since) {
    const lower=startedAt-30*86400000, upper=startedAt+180*86400000;
    const from=new Date(lower).toISOString(), to=new Date(upper).toISOString();
    const rows=new Map(since ? connection.events
      .filter(event => Date.parse(event.end)>lower && Date.parse(event.start)<upper)
      .map(event => [event.id,event]) : []);
    const updatedMin=since ? new Date(since-UPDATE_OVERLAP_MS).toISOString() : '';
    for (const calendarId of selected) {
      const calendar=connection.calendars.find(item=>item.id===calendarId);
      if (!calendar) failure(400,'所选日历已不可用');
      let pageToken='', complete=false;
      for (let p=0;p<40;p++) {
        const page=await google(connection,`/calendars/${encodeURIComponent(calendarId)}/events`,{
          timeZone:'UTC',singleEvents:'true',showDeleted:'true',timeMin:from,timeMax:to,maxResults:'250',
          ...(updatedMin && {updatedMin}),...(pageToken && {pageToken}),
        });
        if (!Array.isArray(page.items)) failure(502,'Google 日历结果不完整，已保留上次结果');
        for (const item of page.items) {
          if (typeof item?.id !== 'string' || !item.id) failure(502,'Google 返回了没有标识的日程');
          const id=eventKey(connection.id,calendarId,item.id);
          const previous=rows.get(id);
          if (previous && Date.parse(previous.google.updated)>Date.parse(item.updated)) continue;
          if (item.status==='cancelled') { rows.delete(id); continue; }
          const event=normalizeGoogleEvent(item,connection.id,calendar);
          rows.set(id,event);
        }
        if (rows.size>5000) failure(422,'所选日历事件过多，请减少同步的日历');
        pageToken=page.nextPageToken||'';
        if (!pageToken) { complete=true; break; }
      }
      if (!complete) failure(502,'Google 日历未读取完整，已保留上次结果');
    }
    return [...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
  }

  function sync(key,selectedOverride,forceFull=false) {
    if (locks.has(key)) {
      const running=locks.get(key);
      return selectedOverride || forceFull ? running.catch(()=>{}).then(()=>sync(key,selectedOverride,forceFull)) : running;
    }
    const job=(async()=>{
      const store=await vault(), connection=store.data.connections[key];
      const selected=selectedOverride??connection?.selected;
      if (!connection?.token || !selected?.length) return;
      const startedAt=now();
      const cursor=!forceFull && !selectedOverride && connection.syncCursor &&
        startedAt-connection.lastFullSync < FULL_REFRESH_MS && connection.syncCursor<=startedAt
        ? connection.syncCursor : undefined;
      connection.lastAttempt=startedAt;
      try {
        let full=!cursor;
        let events;
        try { events=await snapshot(connection,selected,startedAt,cursor); }
        catch (error) {
          if (!cursor || error.status!==409) throw error;
          full=true;
          events=await snapshot(connection,selected,startedAt);
        }
        if (store.data.connections[key]!==connection) return;
        const previous={events:connection.events,selected:connection.selected,lastSync:connection.lastSync,
          error:connection.error,reconnect:connection.reconnect,syncCursor:connection.syncCursor,lastFullSync:connection.lastFullSync};
        Object.assign(connection,{events,selected,lastSync:now(),error:'',reconnect:false,syncCursor:startedAt,
          lastFullSync:full?startedAt:connection.lastFullSync});
        try { await store.save(); }
        catch { Object.assign(connection,previous); throw new Error('日历同步结果无法保存，请重试'); }
      } catch (error) {
        if (store.data.connections[key]===connection) {
          connection.error=error instanceof CalendarFailure ? error.message : '日历同步失败，已保留上次结果';
          connection.reconnect=error.status===401||error.status===403;
          await store.save();
        }
        throw error;
      }
    })();
    locks.set(key,job);
    job.finally(()=>locks.delete(key)).catch(()=>{});
    return job;
  }
  async function tick(){if(!configured)return;const store=await vault();for(const [key,c]of Object.entries(store.data.connections)){if(c.selected.length&&!c.reconnect&&store.data.sessions[c.session]?.until>now()&&now()-(c.lastAttempt||c.lastSync||0)>=intervalMs)await sync(key).catch(()=>{});}}
  function start(){if(configured&&!timer){timer=setInterval(()=>void tick().catch(()=>{}),Math.min(intervalMs,60000));timer.unref();}}
  const stop=()=>{clearInterval(timer);timer=undefined;};
  async function handle(req,res){const url=new URL(req.url,base);if(!url.pathname.startsWith('/api/calendar/google/'))return false;
    try{
      if(!configured){send(res,200,{configured:false,connected:false,events:[],error:'Google 日历连接尚未配置'});return true;}
      if(url.pathname==='/api/calendar/google/callback'){
        if (req.method !== 'GET') failure(405,'不支持的日历请求');
        const store=await vault(),session=await sessionFor(req,res),state=url.searchParams.get('state'),flow=store.data.flows[hash(state||'')];
        if(!session||!flow||!same(flow.session,session)||flow.until<=now())failure(400,'授权链接已过期，请返回日程重新连接');
        const account = await requireOwner(req, flow.owner);
        if (store.data.flows[hash(state)] !== flow) failure(400,'授权链接已使用，请返回日程重新连接');
        delete store.data.flows[hash(state)];await store.save();if(url.searchParams.has('error')){res.writeHead(303,{Location:'/?calendar=denied','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;}
        const code=url.searchParams.get('code');if(!code)failure(400,'Google 未返回授权码');
        const token=await jsonFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:flow.verifier,grant_type:'authorization_code',redirect_uri:redirectUri})});
        if(!token.access_token||!SCOPES.every(s=>(token.scope||'').split(' ').includes(s)))failure(403,'需要允许读取日历和事件，请重新连接');
        const key=keyFor(session,flow.owner),previous=store.data.connections[key];const refresh=token.refresh_token;
        if(!refresh)failure(401,'Google 未授予持续访问，请重新连接并确认授权');
        const connection={id:key,session,owner:flow.owner,token:{access:token.access_token,refresh,expiresAt:now()+Number(token.expires_in||3600)*1000},selected:[],calendars:[],events:[],lastSync:0,error:'',reconnect:false};
        connection.calendars=await calendarList(connection);const identity=connection.calendars.find(c=>c.primary)?.id;if(!identity)failure(403,'无法确认 Google 日历账号，请重新连接');
        if (account && (!account.email || !same(identity.toLowerCase(), account.email.toLowerCase())))
          failure(403,'请授权与 Wayline 登录一致的 Google 账号');
        connection.identity=identity;
        if(previous?.identity===identity){connection.selected=previous.selected.filter(id=>connection.calendars.some(c=>c.id===id));if (connection.selected.length === previous.selected.length) { connection.events=previous.events;connection.lastSync=previous.lastSync; }}
        store.data.connections[key]=connection;try{await store.save();}catch(error){if(previous)store.data.connections[key]=previous;else delete store.data.connections[key];throw error;}
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/?calendar=connected"><title>日历已连接</title><a href="/?calendar=connected">返回日程</a>');return true;
      }
      const owner=ownerFrom(url);
      const account = await requireOwner(req, owner);
      if(req.method==='POST'&&(req.headers.origin!==base.origin||!String(req.headers['content-type']||'').startsWith('application/json')))failure(403,'请从本站操作日历连接');
      const session=await sessionFor(req,res,req.method==='POST'&&url.pathname.endsWith('/connect')),store=await vault(),key=session?keyFor(session,owner):null,connection=key?store.data.connections[key]:null;
      const wrongIdentity = !!(connection && account && (!account.email || !same(connection.identity?.toLowerCase(), account.email.toLowerCase())));
      if(req.method==='GET'&&url.pathname.endsWith('/status')){
        if (wrongIdentity) {
          send(res, 200, {configured:true,connected:false,error:'请重新连接与 Wayline 登录一致的 Google 日历'});
          return true;
        }
        send(res,200,{configured:true,connected:!!connection,connectionId:connection?.id||null,calendars:connection?.calendars||[],selected:connection?.selected||[],events:connection?.events||[],lastSync:connection?.lastSync||null,error:connection?.error||'',needsReconnect:!!connection?.reconnect,pollSeconds:120,window:{pastDays:30,futureDays:180}});return true;
      }
      if(req.method!=='POST')failure(405,'不支持的日历请求');
      if(url.pathname.endsWith('/connect')){
        for(const [id,flow]of Object.entries(store.data.flows))if(flow.until<now())delete store.data.flows[id];
        if(Object.values(store.data.flows).filter(f=>f.session===session).length>=5)failure(429,'请稍后重试连接');
        const state=random(),verifier=random();store.data.flows[hash(state)]={session,owner,verifier,until:now()+600000};await store.save();
        const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');auth.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:SCOPES.join(' '),state,access_type:'offline',prompt:'consent',...(account?.email?{login_hint:account.email}:{}),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();send(res,200,{url:auth.href});return true;
      }
      if(wrongIdentity && !url.pathname.endsWith('/disconnect'))failure(403,'请重新连接与 Wayline 登录一致的 Google 日历');
      if(!connection)failure(401,'请先连接 Google 日历');
      if(url.pathname.endsWith('/select')){const body=await jsonBody(req);if(!Array.isArray(body?.calendarIds)||body.calendarIds.length<1||body.calendarIds.length>10||new Set(body.calendarIds).size!==body.calendarIds.length||body.calendarIds.some(id=>!connection.calendars.some(c=>c.id===id)))failure(400,'请选择 1 至 10 个可读取的日历');await sync(key,body.calendarIds);send(res,200,{ok:true});return true;}
      if(url.pathname.endsWith('/sync')){await sync(key,undefined,true);send(res,200,{ok:true});return true;}
      if(url.pathname.endsWith('/disconnect')){delete store.data.connections[key];try{await store.save();}catch(error){store.data.connections[key]=connection;throw error;}send(res,200,{ok:true});return true;}
      failure(404,'日历接口不存在');
    }catch(error){if(!res.headersSent){
      const message=error instanceof CalendarFailure?error.message:'日历连接暂时不可用，请稍后重试';
      if(url.pathname.endsWith('/callback')){
        const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
        res.writeHead(error.status||500,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
        res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>日历连接未完成 · Wayline</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#1d1d1f;background:#f5f5f7;margin:0;padding:12vh 24px}main{max-width:440px;margin:auto}h1{font-size:24px}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:12px;background:#1761d5;color:white;text-decoration:none}</style><main><h1>日历连接未完成</h1><p>${escape(message)}</p><a href="/?calendar=retry">返回日程重新连接</a></main></html>`);
      }else send(res,error.status||500,{error:message});
    }}
    return true;
  }
  return {handle,start,stop,tick,sync};
}
