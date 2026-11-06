/* UI for scoped hub sharing and explicitly accepted direct sessions. */
(() => {
  const peers = []; const rooms = []; const selected = new Set(); const directStates = new Map();
  let directClient; let directOwner; let nextCursor = null; let cursor = null; let refreshing; let pendingTimer; let inviteToken = '';
  try { inviteToken = new URLSearchParams(location.hash.slice(1)).get('invite') || ''; if (inviteToken) { history.replaceState(null, '', location.pathname + location.search); $('#codeInput').required = false; $('#codeInput').minLength = 0; } } catch { /* A copied URL can also be entered manually. */ }
  const target = () => ({ roomId: $('#roomSelect').value || 'shared', ...($('#recipientSelect').value ? {recipientId:$('#recipientSelect').value} : {}), retentionMs:Number($('#retentionSelect').value) || 0 });
  function option(value, text) { const el=document.createElement('option'); el.value=value; el.textContent=text; return el; }
  function action(text, handler) { const el=document.createElement('button'); el.type='button'; el.className='button'; el.textContent=text; el.onclick=()=>Promise.resolve().then(handler).catch(toast); return el; }
  function render() {
    const currentRoom=$('#roomSelect').value || 'shared'; const currentPeer=$('#recipientSelect').value;
    $('#roomSelect').replaceChildren(option('shared',t('scope.shared')),option('inbox',t('scope.inbox')),...rooms.filter(room=>room.id!=='shared' && room.id!=='inbox').map(room=>option(room.id,room.name)));
    $('#roomSelect').value=[...$('#roomSelect').options].some(o=>o.value===currentRoom)?currentRoom:'shared';
    const room=rooms.find(room=>room.id===$('#roomSelect').value);
    const available=peers.filter(peer=>peer.id!==state.clientId && (!room?.members || room.members.includes(peer.id) || state.config?.role==='admin'));
    $('#recipientSelect').replaceChildren(option('',t('scope.everyone')),...available.map(peer=>option(peer.id,peer.name)));
    if(available.some(peer=>peer.id===currentPeer))$('#recipientSelect').value=currentPeer;
    $('#sharingAdmin').classList.toggle('hidden',state.config?.role!=='admin');
    $('#roomMembers').replaceChildren();
    for(const peer of peers){const label=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.value=peer.id;label.append(box,document.createTextNode(peer.name));$('#roomMembers').append(label);}
    $('#roomAdminList').replaceChildren();
    for(const room of rooms.filter(room=>room.id!=='shared'&&room.id!=='inbox')){
      const row=document.createElement('div');row.className='direct-card';const name=document.createElement('strong');name.textContent=room.name;row.append(name);
      if(state.config?.role==='admin')for(const peer of peers){const label=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.checked=room.members.includes(peer.id);box.onchange=async()=>{box.disabled=true;try{const members=room.members.filter(id=>id!==peer.id);if(box.checked)members.push(peer.id);await api(`/api/rooms/${room.id}`,jsonOptions('PATCH',{members}));await refresh();}catch(error){box.checked=!box.checked;toast(error);}finally{box.disabled=false;}};label.append(box,document.createTextNode(peer.name));row.append(label);}
      $('#roomAdminList').append(row);
    }
    renderDirect();
  }
  async function refresh() {
    if(!state.authenticated || !state.config?.features?.sharing)return;
    if(refreshing)return refreshing;
    refreshing=(async()=>{const [p,r]=await Promise.all([api('/api/peers'),api('/api/rooms')]);peers.splice(0,peers.length,...p.peers);rooms.splice(0,rooms.length,...r.rooms);render();await loadHistory();})();
    try{await refreshing;}catch(error){if(state.authenticated)toast(error);}finally{refreshing=null;}
  }
  async function loadHistory(){if(!state.authenticated)return;const {history:items}=await api('/api/history');const list=$('#historyList');list.replaceChildren();for(const item of items){const row=document.createElement('div');row.className='history-item';row.textContent=`${t(`history.${item.type}`)} · ${item.name || ''} · ${formatBytes(item.size || 0)} · ${formatDate(item.createdAt || item.at || item.timestamp)}`;list.append(row);}}
  function renderDirect(){const list=$('#directList');list.replaceChildren();for(const item of directStates.values()){
    const row=document.createElement('div');row.className='direct-card';const title=document.createElement('strong');title.textContent=item.name || item.file?.name || t('direct.title');
    const status=document.createElement('p');status.textContent=`${t('direct.state.'+(item.phase || item.state || 'offered'))} · ${t('direct.route.'+(item.route || 'unknown'))}${Number.isFinite(item.transferred)?` · ${formatBytes(item.transferred)}`:''}`;
    row.append(title,status);if(item.error){const detail=document.createElement('p');detail.textContent=item.error.message || item.error;row.append(detail);}
    const buttons=document.createElement('div');buttons.className='button-row';
    if(item.incoming && (item.phase==='offered'||item.state==='offered'||!item.phase))buttons.append(action(t('direct.accept'),()=>directClient.accept(item.id)));
    if(item.sas || item.code){const code=document.createElement('div');code.className='direct-code';code.textContent=item.sas || item.code;row.append(code);buttons.append(action(t('direct.confirm'),()=>directClient.confirm(item.id)));}
    if(!['complete','completed','cancelled','rejected'].includes(item.phase || item.state))buttons.append(action(t('direct.cancel'),()=>directClient.cancel(item.id)));
    if(item.file instanceof File && ['failed','error','disconnected'].includes(item.phase || item.state))buttons.append(action(t('direct.fallback'),()=>{if(confirm(t('direct.fallbackConfirm'))){enqueueFiles([item.file]);void directClient.cancel(item.id);}}));
    row.append(buttons);list.append(row);
  }}
  async function connectDirect(){if(!window.isSecureContext || !globalThis.RTCPeerConnection || !state.config?.features?.direct)return;if(directClient&&directOwner===state.clientId)return;await directClient?.stop();const {createDirectClient}=await import('/direct.js');directOwner=state.clientId;directClient=createDirectClient({api,clientId:state.clientId,iceServers:state.config.iceServers || [],onOffer:item=>{directStates.set(item.id,{...item,incoming:true,phase:'offered'});renderDirect();},onUpdate:item=>{directStates.set(item.id,{...directStates.get(item.id),...item});renderDirect();},onComplete:item=>{directStates.set(item.id,{...directStates.get(item.id),...item,phase:'complete'});renderDirect();void loadHistory().catch(()=>{});},onFallback:item=>{directStates.set(item.id,{...directStates.get(item.id),...item,phase:'failed'});renderDirect();}});await directClient.start();}
  async function connected(){clearTimeout(pendingTimer);await refresh();await connectDirect().catch(toast);}
  function disconnected(){clearTimeout(pendingTimer);directClient?.stop();directClient=null;directOwner=null;directStates.clear();renderDirect();}
  function pending(){showAuth();setAuthError(localizedError('error.APPROVAL_REQUIRED'));pendingTimer=setTimeout(async()=>{try{await loadConfig();if(state.config.clientId&&state.config.approved!==false){await Promise.all([loadFiles(),loadMessages()]);showApp();connectEvents();}else if(state.config.clientId)pending();}catch{pending();}},3000);}
  function filesUrl(){const query=new URLSearchParams();if($('#searchInput').value)query.set('q',$('#searchInput').value);if($('#roomSelect').value)query.set('room',$('#roomSelect').value);if(cursor)query.set('after',cursor);return '/api/files'+(query.size?'?'+query:'');}
  function fileActions(file,row,actions){const box=document.createElement('input');box.type='checkbox';box.className='file-select';box.checked=selected.has(file.id);box.setAttribute('aria-label',t('files.select',{name:file.name}));box.onchange=()=>box.checked?selected.add(file.id):selected.delete(file.id);row.prepend(box);
    if(window.isSecureContext && typeof window.showSaveFilePicker==='function')actions.append(action(t('files.verifySave'),async()=>{
      const sink=await window.showSaveFilePicker({suggestedName:file.name}); const writer=await sink.createWritable();let reader;
      try{const {Sha256}=await import('/hash-worker.js');const hash=new Sha256();let bytes=0;const response=await request(`/api/files/${file.id}/download`);reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;hash.update(value);await writer.write(value);}if(bytes!==file.size||hash.hex()!==file.hash)throw localizedError('error.CHECKSUM_MISMATCH');await writer.close();await api(`/api/files/${file.id}/receipt`,jsonOptions('POST',{status:'saved'}));toast(t('files.savedVerified'));}catch(error){await reader?.cancel().catch(()=>{});await writer.abort().catch(()=>{});throw error;}
    }));
  }
  $('#folderButton').onclick=()=>$('#folderInput').click();$('#folderInput').onchange=event=>{enqueueFiles(event.target.files);event.target.value='';};
  $('#roomSelect').onchange=()=>{cursor=null;selected.clear();render();void loadFiles().catch(toast);void loadMessages().catch(toast);};
  $('#recipientSelect').onchange=()=>{};
  let searchTimer;$('#searchInput').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{cursor=null;void loadFiles().catch(toast);},250);};
  $('#moreFilesButton').onclick=()=>{cursor=nextCursor;void loadFiles().catch(toast);};
  $('#batchButton').onclick=()=>{if(!selected.size)return toast(t('files.selectFirst'));const a=document.createElement('a');a.href='/api/batch?ids='+[...selected].join(',');a.download='MCKLTransfer.tar';a.click();};
  $('#historyRefresh').onclick=()=>void loadHistory().catch(toast);
  $('#roomForm').onsubmit=async event=>{event.preventDefault();try{const members=[...$('#roomMembers').querySelectorAll('input:checked')].map(box=>box.value);await api('/api/rooms',jsonOptions('POST',{name:$('#roomName').value,members}));$('#roomName').value='';await refresh();}catch(error){toast(error);}};
  $('#inviteButton').onclick=async()=>{try{const invite=await api('/api/invites',jsonOptions('POST',{ttlMs:600000}));const origin=state.config.addresses?.[0]?.url || location.origin;const url=origin+'/#invite='+encodeURIComponent(invite.token);const output=$('#inviteOutput');output.replaceChildren();const text=document.createElement('p');text.textContent=t('invite.expires',{time:formatDate(invite.expiresAt)});output.append(text,action(t('common.copy'),()=>copyText(url)));const qr=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${qr.size+8} ${qr.size+8}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',t('invite.qr'));const bg=document.createElementNS(svg.namespaceURI,'rect');bg.setAttribute('width','100%');bg.setAttribute('height','100%');bg.setAttribute('fill','#fff');svg.append(bg);let d='';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))d+=`M${x+4},${y+4}h1v1h-1z `;const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);path.setAttribute('fill','#000');svg.append(path);output.append(svg);setTimeout(()=>output.replaceChildren(),Math.max(0,invite.expiresAt-Date.now()));}catch(error){toast(error);}};
  $('#directPickButton').onclick=()=>{if(!$('#recipientSelect').value)return toast(t('direct.chooseRecipient'));if(!window.isSecureContext||!globalThis.RTCPeerConnection)return toast(t('direct.unsupported'));$('#directInput').click();};
  $('#directInput').onchange=async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{await connectDirect();const controller=new AbortController();const hasher=new FileHasher(controller.signal);let sha;try{sha=await hasher.digest(file);}finally{hasher.close();}const result=await directClient.offer(file,$('#recipientSelect').value,sha);if(result?.id)directStates.set(result.id,{...directStates.get(result.id),file,name:file.name});renderDirect();}catch(error){toast(error);}};
  $('#benchmarkButton').onclick=async()=>{const button=$('#benchmarkButton');button.disabled=true;const output=$('#benchmarkResult');output.textContent=t('bench.running');let file;
    try{const size=16*1024*1024;const bytes=new Uint8Array(size);for(let i=0;i<size;i+=65536)crypto.getRandomValues(bytes.subarray(i,i+65536));const source=new File([bytes],'mckl-network-check.bin');const hasher=new FileHasher(new AbortController().signal);let hash;try{hash=await hasher.digest(source);}finally{hasher.close();}const start=performance.now();file=await api('/api/upload',{method:'POST',headers:{'x-file-name':source.name,'x-file-size':String(size),'x-file-sha256':hash},body:source});const uploadSeconds=(performance.now()-start)/1000;const down=performance.now();const response=await request(`/api/files/${file.id}/download`);const {Sha256}=await import('/hash-worker.js');const digest=new Sha256();let received=0;for await(const chunk of response.body){digest.update(chunk);received+=chunk.length;}if(received!==size||digest.hex()!==hash)throw localizedError('error.CHECKSUM_MISMATCH');const downloadSeconds=(performance.now()-down)/1000;output.textContent=t('bench.result',{up:(16/uploadSeconds).toFixed(1),down:(16/downloadSeconds).toFixed(1),path:location.hostname==='localhost'||location.hostname==='127.0.0.1'?'loopback':location.host});}
    catch(error){output.textContent=errorText(error);}finally{if(file)await api(`/api/files/${file.id}`,{method:'DELETE'}).catch(()=>{});button.disabled=false;void loadFiles().catch(()=>{});}
  };
  window.MCKLWorkspace={target,filesUrl,fileActions,filesLoaded(result){nextCursor=result.nextCursor;$('#moreFilesButton').classList.toggle('hidden',!nextCursor);},connected,disconnected,pending,refresh,render,refreshDirect(){void directClient?.refresh().catch(()=>{});},invite:()=>inviteToken,consumeInvite(){inviteToken='';}};
  if(inviteToken){$('#accessPanel p.muted').textContent=t('invite.join');$('#codeInput').placeholder=t('invite.optionalCode');}
  if(state.config?.approved===false)pending();else if(state.authenticated)void connected();
})();
