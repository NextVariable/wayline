import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
/** Single-process, atomic encrypted store. Never put this directory under the web root. */
export async function openCalendarVault(directory) {
  const dir=resolve(directory);await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
  const keyFile=resolve(dir,'calendar.key'),file=resolve(dir,'calendar.enc');let key;
  try{key=await readFile(keyFile);}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);try{await writeFile(keyFile,key,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;key=await readFile(keyFile);}}
  if(key.length!==32)throw new Error('日历凭证存储密钥无效');await chmod(keyFile,0o600);
  let data={sessions:{},connections:{},flows:{}};
  try{const envelope=JSON.parse(await readFile(file,'utf8'));const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.body,'base64')),decipher.final()]).toString('utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('日历存储无法解密，请保留原文件并检查密钥');}
  let writes=Promise.resolve();
  return {data,save(){const snapshot=JSON.stringify(data);const task=writes.then(async()=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(snapshot),cipher.final()]);const tmp=resolve(dir,`calendar-${randomBytes(8).toString('hex')}.tmp`);await writeFile(tmp,JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')}),{mode:0o600});await rename(tmp,file);});writes=task.catch(()=>{});return task;}};
}
