import {randomUUID} from 'node:crypto';

const ranges=new Set([60,300,600,1800]);
const rate=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const unavailable=new Set(['starting','disabled','error','unmapped']);
export class NetworkHistory{
 constructor({now=Date.now,epoch=randomUUID()}={}){this.now=now;this.epoch=epoch;this.frames=[];this.sequence=0;this.lastSource=null;}
 capture(snapshot,at=this.now()){
  const last=this.frames.at(-1);if(last&&at<=last.at)return;
  const fresh=snapshot?.scope==='codex-proxy'&&Number.isFinite(snapshot.sampledAt)&&at-snapshot.sampledAt<=4500&&at>=snapshot.sampledAt-1000&&snapshot.sampledAt!==this.lastSource&&!unavailable.has(snapshot.status);
  const pair=row=>fresh?[rate(row?.receivedPerSecond),rate(row?.sentPerSecond)]:[null,null];
  const processes=new Map();
  for(const row of snapshot?.processes||[])if(typeof row.id==='string')processes.set(row.id,pair(row));
  this.frames.push({seq:++this.sequence,at,status:snapshot?.status||'starting',partial:snapshot?.status==='partial',total:pair(snapshot),processes});
  if(fresh)this.lastSource=snapshot.sampledAt;
  while(this.frames.length&&this.frames[0].at<at-1800000)this.frames.shift();
 }
 read({processId='',rangeSeconds=600,after=null,epoch=null}={}){
  if(!ranges.has(rangeSeconds)||typeof processId!=='string'||(processId&&!/^[\w.:-]{1,200}$/.test(processId))||after!==null&&(!Number.isSafeInteger(after)||after<0))throw Error('Invalid history query');
  const now=this.now(),reset=after===null||epoch!==this.epoch||after>this.sequence;
  const points=this.frames.filter(frame=>frame.at>=now-rangeSeconds*1000&&(reset||frame.seq>after)).map(frame=>{
   const values=processId?frame.processes.get(processId)||[null,null]:frame.total;
   return {seq:frame.seq,at:frame.at,receivedPerSecond:values[0],sentPerSecond:values[1],partial:frame.partial};
  });
  return {scope:'codex-proxy',epoch:this.epoch,serverNow:now,processId,rangeSeconds,intervalMs:1000,retentionSeconds:1800,seq:this.sequence,reset,status:this.frames.at(-1)?.status||'starting',points};
 }
}
