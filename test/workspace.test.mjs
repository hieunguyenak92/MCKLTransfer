import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server.mjs';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function fixture(t, options={}) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'mckl-workspace-'));
  const app=createApp({host:'127.0.0.1',port:0,shareDir:dir,shareCode:'123456',adminCode:'synthetic-workspace-admin-key',minFreeSpace:0,logger:{log(){},warn(){}},...options});
  await app.start();t.after(async()=>{await app.stop();await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=(route,cookie,method='GET',body,headers={})=>fetch(base+route,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
  async function auth(name,admin=false,extra={}){const r=await request('/api/auth',null,'POST',{code:admin?'synthetic-workspace-admin-key':'123456',deviceName:name,...extra});assert.equal(r.status,200);return {...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
  async function upload(peer,body=Buffer.from('private synthetic payload'),target={}){
    const r=await request('/api/uploads',peer.cookie,'POST',{name:'example.txt',size:body.length,sha256:hash(body),...target});assert.equal(r.status,201,await r.clone().text());const created=await r.json();
    if(body.length){const patch=await fetch(`${base}/api/uploads/${created.id}`,{method:'PATCH',headers:{cookie:peer.cookie,'upload-offset':'0','x-chunk-sha256':hash(body),...(target.clientId?{'upload-client':target.clientId}:{})},body});assert.equal(patch.status,204,await patch.text());}
    const complete=await request(`/api/uploads/${created.id}/complete`,peer.cookie,'POST',{},target.clientId?{'upload-client':target.clientId}:{});assert.equal(complete.status,201,await complete.clone().text());return complete.json();
  }
  return {app,base,dir,request,auth,upload};
}

test('approval and single-use invitations gate private APIs and pending config',async t=>{
  const f=await fixture(t,{requireApproval:true});const admin=await f.auth('Host',true);const pending=await f.auth('Pending');
  assert.equal(pending.approved,false);
  const config=await f.request('/api/config',pending.cookie).then(r=>r.json());
  assert.equal(config.status,'pending');assert.equal(config.deviceName,undefined);assert.equal(config.addresses,undefined);
  assert.equal((await f.request('/api/files',pending.cookie)).status,403);
  assert.equal((await f.request(`/api/devices/${pending.clientId}`,admin.cookie,'POST',{})).status,200);
  assert.equal((await f.request('/api/files',pending.cookie)).status,200);
  const invite=await f.request('/api/invites',admin.cookie,'POST',{ttlMs:60000}).then(r=>r.json());
  const accepted=await f.auth('Invited',false,{invite:invite.token,code:''});assert.equal(accepted.approved,false);
  assert.equal((await f.request('/api/auth',null,'POST',{invite:invite.token})).status,401);
});

test('private inbox isolates files, messages, history, download and batch',async t=>{
  const f=await fixture(t);const sender=await f.auth('Sender'),receiver=await f.auth('Receiver'),outsider=await f.auth('Outsider');
  const target={roomId:'inbox',recipientId:receiver.clientId};const file=await f.upload(sender,undefined,target);
  const chat=await f.request('/api/messages',sender.cookie,'POST',{text:'synthetic private text',...target});assert.equal(chat.status,201);
  for(const peer of [sender,receiver]){const list=await f.request('/api/files',peer.cookie).then(r=>r.json());assert.equal(list.files[0].id,file.id);assert.equal((await f.request('/api/history',peer.cookie).then(r=>r.json())).history.length,1);}
  assert.equal((await f.request('/api/files',outsider.cookie).then(r=>r.json())).files.length,0);
  assert.equal((await f.request('/api/messages',outsider.cookie).then(r=>r.json())).messages.length,0);
  assert.equal((await f.request('/api/history',outsider.cookie).then(r=>r.json())).history.length,0);
  assert.equal((await f.request(`/api/files/${file.id}/download`,outsider.cookie)).status,404);
  assert.equal((await f.request(`/api/batch?ids=${file.id}`,outsider.cookie)).status,404);
});

test('removing room membership blocks paused upload publication and future messages',async t=>{
  const f=await fixture(t);const admin=await f.auth('Host',true),sender=await f.auth('Sender');
  const room=await f.request('/api/rooms',admin.cookie,'POST',{name:'Private room',members:[sender.clientId]}).then(r=>r.json());
  const created=await f.request('/api/uploads',sender.cookie,'POST',{name:'empty.txt',size:0,sha256:hash(''),roomId:room.id}).then(r=>r.json());
  assert.equal((await f.request(`/api/rooms/${room.id}`,admin.cookie,'PATCH',{members:[]})).status,200);
  assert.equal((await f.request(`/api/uploads/${created.id}/complete`,sender.cookie,'POST',{})).status,403);
  assert.equal((await f.request('/api/messages',sender.cookie,'POST',{text:'denied',roomId:room.id})).status,403);
  assert.equal((await f.request('/api/files',admin.cookie).then(r=>r.json())).files.length,0);
  // Owners may still discard unpublished bytes even after room access ends.
  assert.equal((await f.request(`/api/uploads/${created.id}`,sender.cookie,'DELETE')).status,200);
});

test('completion retries return one object; leases exclude competing upload tabs',async t=>{
  const f=await fixture(t);const sender=await f.auth('Sender');const a='a'.repeat(32),b='b'.repeat(32);
  const created=await f.request('/api/uploads',sender.cookie,'POST',{name:'leased.txt',size:0,sha256:hash(''),clientId:a}).then(r=>r.json());
  assert.equal((await f.request(`/api/uploads/${created.id}/claim`,sender.cookie,'POST',{clientId:b})).status,409);
  assert.equal((await f.request(`/api/uploads/${created.id}`,sender.cookie,'DELETE',undefined,{'upload-client':b})).status,409);
  const first=await f.request(`/api/uploads/${created.id}/complete`,sender.cookie,'POST',{}, {'upload-client':a}).then(r=>r.json());
  const retry=await f.request(`/api/uploads/${created.id}/complete`,sender.cookie,'POST',{}, {'upload-client':a}).then(r=>r.json());assert.equal(first.id,retry.id);
  const status=await f.request(`/api/uploads/${created.id}`,sender.cookie).then(r=>r.json());assert.equal(status.state,'complete');assert.equal(status.file.hash,hash(''));
  assert.equal((await f.request('/api/files',sender.cookie).then(r=>r.json())).files.length,1);
});

test('file count and per-owner quotas cover zero bytes without blocking another device',async t=>{
  const f=await fixture(t,{maxFiles:3,maxOwnerFiles:1});const a=await f.auth('A'),b=await f.auth('B');await f.upload(a,Buffer.alloc(0));
  const denied=await f.request('/api/uploads',a.cookie,'POST',{name:'empty2',size:0,sha256:hash('')});assert.equal(denied.status,429);
  await f.upload(b,Buffer.alloc(0));
});

test('batch download streams a valid Unicode folder archive and search paginates',async t=>{
  const f=await fixture(t);const sender=await f.auth('Sender');const one=await f.upload(sender,Buffer.from('one'),{relativePath:'Thư mục/一.txt'});const two=await f.upload(sender,Buffer.from('two'),{relativePath:'Thư mục/二.txt'});
  const page=await f.request('/api/files?limit=1',sender.cookie).then(r=>r.json());assert.equal(page.files.length,1);assert.ok(page.nextCursor);
  const next=await f.request('/api/files?limit=1&after='+page.nextCursor,sender.cookie).then(r=>r.json());assert.equal(next.files.length,1);assert.notEqual(next.files[0].id,page.files[0].id);
  const found=await f.request('/api/files?q='+encodeURIComponent('一'),sender.cookie).then(r=>r.json());assert.equal(found.files[0].id,one.id);
  const response=await f.request(`/api/batch?ids=${one.id},${two.id}`,sender.cookie);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.includes(Buffer.from('Thư mục/一.txt')));
  const archive=path.join(f.dir,'fixture.tar');await writeFile(archive,bytes);const listed=spawnSync('tar',['-tf',archive],{encoding:'utf8'});
  if(listed.error?.code!=='ENOENT'){assert.equal(listed.status,0,listed.stderr);assert.match(listed.stdout,/一.txt/);assert.match(listed.stdout,/二.txt/);}
});

test('retention expiry removes file from authorized reads',async t=>{
  let time=Date.now();const f=await fixture(t,{now:()=>time});const sender=await f.auth('Sender');const file=await f.upload(sender,undefined,{retentionMs:1000});time+=1001;
  assert.equal((await f.request(`/api/files/${file.id}/download`,sender.cookie)).status,404);
  assert.equal((await f.request('/api/files',sender.cookie).then(r=>r.json())).files.length,0);
});
