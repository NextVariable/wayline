import {it,expect,vi} from 'vitest';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error Server ESM exercised directly.
import {createGoogleCalendarService,normalizeGoogleEvent} from '../../server/google-calendar.mjs';
// @ts-expect-error Server ESM exercised directly.
import {openCalendarVault} from '../../server/calendar-vault.mjs';
const scope='https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly';
function response(){return {status:200,headers:{} as Record<string,any>,body:'',headersSent:false,setHeader(k:string,v:any){this.headers[k]=v;},writeHead(status:number,headers:object={}){this.status=status;Object.assign(this.headers,headers);this.headersSent=true;},end(value=''){this.body=value;}};}
const normal=(id='event',location='上海虹桥站')=>({id,iCalUID:id,summary:'客户会议',location,updated:'2026-10-29T01:00:00Z',start:{dateTime:'2026-10-30T09:00:00+08:00'},end:{dateTime:'2026-10-30T10:00:00+08:00'}});
function setup(accountFor?: (request: {headers: {cookie?: string}}) => Promise<{id:string}|null>){
 let clock=Date.parse('2026-10-29T01:00:00Z'),pages:any[][]=[[normal()]],failurePage=-1,revoked=false,nullErrorBody=false,failSave=false;
 const store={data:{sessions:{},connections:{},flows:{}} as any,save:vi.fn(async()=>{if(failSave)throw new Error('disk');})};
 const fetcher=vi.fn(async(input:string,options:any={})=>{const url=new URL(input);const result=(data:any,status=200)=>({ok:status===200,status,json:async()=>data});
 if(url.hostname==='oauth2.googleapis.com'){if(nullErrorBody)return {ok:false,status:500,json:async()=>null};if(revoked)return result({error:'invalid_grant'},400);return result({access_token:'PRIVATE_ACCESS',refresh_token:'PRIVATE_REFRESH',expires_in:3600,scope});}
 if(url.pathname.endsWith('/calendarList'))return result({items:[{id:'primary@test',summary:'工作日历',primary:true,accessRole:'owner',timeZone:'Asia/Shanghai'},{id:'other@test',summary:'其他日历',accessRole:'reader'}]});
 const page=Number(url.searchParams.get('pageToken')||0);if(page===failurePage)return result({},503);return result({items:pages[page]||[],...(page+1<pages.length?{nextPageToken:String(page+1)}:{})});
 });
 const service=createGoogleCalendarService({env:{GOOGLE_CLIENT_ID:'test-id',GOOGLE_CLIENT_SECRET:'test-secret',PUBLIC_ORIGIN:'http://127.0.0.1:8787'},fetcher,now:()=>clock,openVault:async()=>store,accountFor});
 const call=async(path:string,method='GET',body:any=undefined,cookie='',origin='http://127.0.0.1:8787')=>{const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]) as any;req.url='/api/calendar/google/'+path;req.method=method;req.headers={cookie,...(method==='POST'?{origin,'content-type':'application/json'}:{})};const res=response();await service.handle(req,res);return {...res,json:()=>JSON.parse(res.body)};};
 const authorize=async(owner='guest')=>{const connected=await call('connect?owner='+owner,'POST',{},'');const cookie=connected.headers['Set-Cookie'].split(';')[0];const auth=new URL(connected.json().url);const callback=await call('callback?state='+auth.searchParams.get('state')+'&code=code','GET',undefined,cookie);expect(callback.status).toBe(200);expect(callback.body).toContain('calendar=connected');return {cookie,auth};};
 return {store,fetcher,service,call,authorize,setPages:(value:any[][])=>{pages=value;},failPage:(value:number)=>{failurePage=value;},advance:(ms:number)=>{clock+=ms;},revoke:()=>{revoked=true;},nullErrorBody:()=>{nullErrorBody=true;},failSave:(value:boolean)=>{failSave=value;}};
}
it('uses browser-bound state, PKCE and only read permissions; rejects state replay',async()=>{
 const s=setup();const {cookie,auth}=await s.authorize();expect(auth.searchParams.get('access_type')).toBe('offline');expect(auth.searchParams.get('scope')).toBe(scope);expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
 expect((await s.call('callback?state='+auth.searchParams.get('state')+'&code=x','GET',undefined,cookie)).status).toBe(400);
 const tokenRequest=s.fetcher.mock.calls.find(([url])=>url.includes('oauth2'))!;expect(new URLSearchParams((tokenRequest as any)[1].body).get('code_verifier')).toBeTruthy();
});
it('does not accept an OAuth callback from another browser',async()=>{
 const s=setup();const start=await s.call('connect?owner=guest','POST',{});const auth=new URL(start.json().url);const bad=await s.call('callback?state='+auth.searchParams.get('state')+'&code=x');expect(bad.status).toBe(400);expect(s.fetcher).not.toHaveBeenCalled();
});
it('keeps credentials out of responses and isolates owners and browser sessions',async()=>{
 const s=setup();const {cookie}=await s.authorize();const result=await s.call('status?owner=guest','GET',undefined,cookie);expect(result.json().connected).toBe(true);expect(result.body).not.toMatch(/PRIVATE_ACCESS|PRIVATE_REFRESH|test-secret/);expect(result.headers['Cache-Control']).toBe('no-store');
 expect((await s.call('status?owner=other','GET',undefined,cookie)).json().connected).toBe(false);expect((await s.call('status?owner=guest')).json().connected).toBe(false);
});
it('requires the matching signed-in account to read or authorize an account calendar',async()=>{
 let user:string|null='owner';
 const s=setup(async()=>user?{id:user}:null);
 const {cookie}=await s.authorize('google:owner');
 expect((await s.call('status?owner=google:owner','GET',undefined,cookie)).json().connected).toBe(true);
 user='other';
 expect((await s.call('status?owner=google:owner','GET',undefined,cookie)).status).toBe(401);
 user=null;
 expect((await s.call('connect?owner=google:owner','POST',{},cookie)).status).toBe(401);
});
it('rejects cross-origin mutations and unknown calendar selections',async()=>{
 const s=setup();expect((await s.call('connect?owner=guest','POST',{},'','https://evil.test')).status).toBe(403);const {cookie}=await s.authorize();expect((await s.call('select?owner=guest','POST',{calendarIds:['unknown']},cookie)).status).toBe(400);
});
it('commits all pages together, then automatically reflects moves and cancellations',async()=>{
 const s=setup();s.setPages([[normal('a')],[normal('b')]]);const {cookie}=await s.authorize();expect((await s.call('select?owner=guest','POST',{calendarIds:['primary@test']},cookie)).status).toBe(200);let state=(await s.call('status?owner=guest','GET',undefined,cookie)).json();expect(state.events).toHaveLength(2);
 s.setPages([[{...normal('a','上海国家会展中心'),start:{dateTime:'2026-11-01T09:00:00+08:00'},end:{dateTime:'2026-11-01T10:00:00+08:00'}},{id:'b',status:'cancelled'}]]);s.advance(120001);await s.service.tick();state=(await s.call('status?owner=guest','GET',undefined,cookie)).json();expect(state.events).toHaveLength(1);expect(state.events[0].location).toBe('上海国家会展中心');expect(state.events[0].start).toBe('2026-11-01T01:00:00.000Z');
});
it('retains the old snapshot and selection when any page fails',async()=>{
 const s=setup();const {cookie}=await s.authorize();await s.call('select?owner=guest','POST',{calendarIds:['primary@test']},cookie);const before=(await s.call('status?owner=guest','GET',undefined,cookie)).json();s.setPages([[normal('new')],[normal('other')]]);s.failPage(1);expect((await s.call('sync?owner=guest','POST',{},cookie)).status).toBe(502);const after=(await s.call('status?owner=guest','GET',undefined,cookie)).json();expect(after.events).toEqual(before.events);expect(after.lastSync).toBe(before.lastSync);expect(after.error).toContain('保留');
});
it('refreshes expired access and reports revoked permission without deleting cached events',async()=>{
 const s=setup();const {cookie}=await s.authorize();await s.call('select?owner=guest','POST',{calendarIds:['primary@test']},cookie);s.advance(3600001);await s.service.tick();expect(s.fetcher.mock.calls.filter(([u])=>u.includes('oauth2')).length).toBe(2);s.revoke();s.advance(3600001);await s.service.tick();const state=(await s.call('status?owner=guest','GET',undefined,cookie)).json();expect(state.needsReconnect).toBe(true);expect(state.events).toHaveLength(1);
});
it('reports a clean 502 when Google answers an error with a non-object body',async()=>{
 const s=setup();const {cookie}=await s.authorize();s.advance(3600001);s.nullErrorBody();const res=await s.call('select?owner=guest','POST',{calendarIds:['primary@test']},cookie);expect(res.status).toBe(502);expect(res.json().error).toBeTruthy();
});
it('stops background access on disconnect and cannot resurrect in a later tick',async()=>{
 const s=setup();const {cookie}=await s.authorize();await s.call('select?owner=guest','POST',{calendarIds:['primary@test']},cookie);await s.call('disconnect?owner=guest','POST',{},cookie);const count=s.fetcher.mock.calls.length;s.advance(3600001);await s.service.tick();expect(s.fetcher.mock.calls.length).toBe(count);expect((await s.call('status?owner=guest','GET',undefined,cookie)).json().connected).toBe(false);
});
it('rolls back a disconnect whose durable write fails',async()=>{
 const s=setup();const {cookie}=await s.authorize();s.failSave(true);expect((await s.call('disconnect?owner=guest','POST',{},cookie)).status).toBe(500);expect((await s.call('status?owner=guest','GET',undefined,cookie)).json().connected).toBe(true);
});
it('never starts authorization or a vault when Google is not configured',async()=>{
 const openVault=vi.fn();const service=createGoogleCalendarService({env:{},openVault});const req={url:'/api/calendar/google/status?owner=guest',method:'GET',headers:{}};const res=response();await service.handle(req,res);expect(JSON.parse(res.body).configured).toBe(false);expect(openVault).not.toHaveBeenCalled();
});
it('encrypts persistent credentials and detects tampering',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wayline-calendar-'));try{const vault=await openCalendarVault(dir);vault.data.connections.x={token:'PRIVATE_REFRESH'};await vault.save();const raw=await readFile(join(dir,'calendar.enc'),'utf8');expect(raw).not.toContain('PRIVATE_REFRESH');expect((await stat(join(dir,'calendar.key'))).mode&0o777).toBe(0o600);expect((await openCalendarVault(dir)).data.connections.x.token).toBe('PRIVATE_REFRESH');const data=JSON.parse(raw);data.body='bad';await writeFile(join(dir,'calendar.enc'),JSON.stringify(data));await expect(openCalendarVault(dir)).rejects.toThrow('解密');}finally{await rm(dir,{recursive:true,force:true});}
});
it('keeps original IDs stable across rescheduling and recurring-instance updates',()=>{
 const calendar={id:'work',summary:'工作'};const a=normalizeGoogleEvent({...normal('r_1'),recurringEventId:'r',originalStartTime:{dateTime:'2026-10-30T01:00:00Z'}},'account',calendar);const b=normalizeGoogleEvent({...normal('r_1'),start:{dateTime:'2026-11-01T01:00:00Z'},end:{dateTime:'2026-11-01T02:00:00Z'},originalStartTime:{dateTime:'2026-10-30T01:00:00Z'}},'account',calendar);expect(a.id).toBe(b.id);expect(b.google.originalStart).toBe('2026-10-30T01:00:00Z');
});

it('runs the background timer even when no browser requests a refresh',async()=>{
 vi.useFakeTimers();const s=setup();try{const {cookie}=await s.authorize();await s.call('select?owner=guest','POST',{calendarIds:['primary@test']},cookie);s.setPages([[normal('new')]]);s.advance(120001);s.service.start();await vi.advanceTimersByTimeAsync(60001);const state=(await s.call('status?owner=guest','GET',undefined,cookie)).json();expect(state.events[0].google.eventId).toBe('new');}finally{s.service.stop();vi.useRealTimers();}
});
it('expires an unused OAuth authorization link without contacting Google',async()=>{
 const s=setup();const start=await s.call('connect?owner=guest','POST',{});const cookie=start.headers['Set-Cookie'].split(';')[0];const state=new URL(start.json().url).searchParams.get('state');s.advance(600001);expect((await s.call('callback?state='+state+'&code=x','GET',undefined,cookie)).status).toBe(400);expect(s.fetcher).not.toHaveBeenCalled();
});
it('shows a recovery page for an expired callback without echoing its authorization code',async()=>{
 const s=setup();const result=await s.call('callback?state=missing&code=PRIVATE_AUTHORIZATION_CODE');
 expect(result.status).toBe(400);expect(result.headers['Content-Type']).toContain('text/html');
 expect(result.body).toContain('返回日程重新连接');expect(result.body).toContain('href="/?calendar=retry"');
 expect(result.body).not.toContain('PRIVATE_AUTHORIZATION_CODE');expect(result.headers['Referrer-Policy']).toBe('no-referrer');
});
