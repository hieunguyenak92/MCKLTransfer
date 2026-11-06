// POSIX pax tar: one bounded read stream at a time, with UTF-8 paths and large sizes.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
function header(name, size, type = '0') {
  const out = Buffer.alloc(512);
  out.write(name, 0, 100, 'utf8');
  for (const [offset, width, value] of [[100,8,0o600],[108,8,0],[116,8,0],[124,12,size],[136,12,0]]) out.write(value.toString(8).padStart(width-1,'0')+'\0',offset,width,'ascii');
  out.fill(32,148,156); out.write(type,156,1); out.write('ustar\0',257,6); out.write('00',263,2);
  const sum = out.reduce((a,b)=>a+b,0); out.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8);
  return out;
}
function pax(key,value) {
  const body=` ${key}=${value}\n`; let length=Buffer.byteLength(body)+1;
  for (;;) { const next=Buffer.byteLength(body)+String(length).length; if(next===length) return Buffer.from(`${length}${body}`); length=next; }
}
export async function streamArchive({files,store,response,signal,authorize}) {
  const names=new Set();
  async function* entries() {
    for(const file of files) {
      signal.throwIfAborted(); authorize(file);
      const baseName=file.relativePath || file.name;
      let name=baseName;
      if (names.has(name)) {
        name=`${file.id}/${baseName}`;
        let suffix=2;
        while (names.has(name)) name=`${file.id}-${suffix++}/${baseName}`;
      }
      names.add(name);
      const metadata=Buffer.concat([pax('path',name),pax('size',String(file.size))]);
      yield header(`PaxHeaders/${file.id}`,metadata.length,'x'); yield metadata;
      if(metadata.length%512)yield Buffer.alloc(512-metadata.length%512);
      yield header(`file-${file.id}`,file.size <= 0o77777777777 ? file.size : 0);
      const opened=await store.open(file.id); let stream;
      try {
        if(opened.stat.size!==file.size)throw new Error('Archive source changed');
        stream=opened.handle.createReadStream({autoClose:false,highWaterMark:256*1024});
        for await(const chunk of stream){ signal.throwIfAborted(); authorize(file); yield chunk; }
      } finally { stream?.destroy(); await opened.handle.close().catch(()=>{}); }
      if(file.size%512)yield Buffer.alloc(512-file.size%512);
    }
    yield Buffer.alloc(1024);
  }
  await pipeline(Readable.from(entries()),response,{signal});
}
