import { clone } from './level.js';
import { MAPS } from '../world/maps/index.js';
import { TERRAIN, walkIn } from '../world/map.js';
import { ST } from '../crowd/crowd.js';
import { emit } from '../core/events.js';
export function installLevel(data) {
  const d=clone(data), h=d.size/2;
  MAPS.editor={id:'editor',name:{zh:d.name,en:'Custom battlefield'},grid:[-h,-h,h,h],
    pieces:[{id:'field',rect:[-h,-h,h,h],h:0,rise:0}],zones:[{id:'field',name:{zh:d.name,en:'Custom'},x:0,z:0,w:d.size,d:d.size}],
    route:[[d.spawn.x,-h+6],[d.spawn.x,h-6]],spawn:{story:d.spawn,free:d.spawn},editorLevel:d,
    fog:[100,450],post:{rays:0,nearBlur:0,farBlur:0,bloom:0.25,exposure:1.1},hq:null};
  return d;
}
export const TASKS={clear:'消灭全部敌军',kos:'累计击破',survive:'坚持生存',reach:'到达目标区域',defeat:'击败指定武将',protect:'保护友军武将'};
export function startCustom(game,d,end,status) {
  game.crowd.reset();game.crowd.setWaves(false);game.crowd.setAllies(false);game.actors.reset();
  for(const o of d.objects){
    const common={x:o.x,z:o.z,n:o.count,face:o.yaw,cols:Math.ceil(Math.sqrt(o.count))};
    if(o.type==='enemy')game.crowd.spawnSquad({...common,charge:true});
    if(o.type==='ally')game.crowd.spawnAllies(common);
    if(o.type==='boss'||o.type==='friend')game.actors.spawn(o.id,{kit:o.kit,role:o.type==='boss'?'boss':'ally',at:[o.x,o.z],yaw:o.yaw,hp:o.hp,invuln:false});
  }
  let frame=0,index=0,begin=0,done=false;
  const label=()=>{const q=d.objectives[index];return `${index+1}/${d.objectives.length} ${TASKS[q.type]}${['kos','survive','protect'].includes(q.type)?' '+q.value+(q.type==='kos'?' 人':' 秒'):''}`;};
  const finish=(win,reason)=>{if(done)return;done=true;end(win,reason);};
  const announce=()=>emit('story:objective',{zh:label(),en:'Custom battlefield'});
  announce();
  const fields=new Map();
  // Shared BFS flow fields: one per destination cell, cached for 30 simulation frames.
  function field(tx,tz){
    const g=TERRAIN,n=g.nx,cell=(x,z)=>Math.max(0,Math.min(g.h.length-1,Math.round((z-g.z0)/2)*n+Math.round((x-g.x0)/2)));
    let target=cell(tx,tz);
    if(g.in[target]<0){let best=Infinity;for(let k=0;k<g.in.length;k++)if(g.in[k]>0.8){const dist=((k%n)*2+g.x0-tx)**2+(Math.floor(k/n)*2+g.z0-tz)**2;if(dist<best){best=dist;target=k;}}}
    if(fields.has(target))return fields.get(target);
    const dist=new Int32Array(g.h.length).fill(-1),queue=new Int32Array(g.h.length);let a=0,b=0;queue[b++]=target;dist[target]=0;
    while(a<b){const k=queue[a++],i=k%n,j=Math.floor(k/n);for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=i+di,z=j+dj,t=z*n+x;if(x<0||x>=n||z<0||z>=g.nz||dist[t]>=0||g.in[t]<0.8||Math.abs(g.h[t]-g.h[k])>1.8)continue;
      dist[t]=dist[k]+1;queue[b++]=t;
    }}
    const result={dist,cell};fields.set(target,result);return result;
  }
  return {
    steer(x,z,tx,tz,vx,vz){
      const speed=Math.hypot(vx,vz);if(speed<0.1||Math.hypot(tx-x,tz-z)<4)return [vx,vz];
      let clear=true;const distance=Math.hypot(tx-x,tz-z);for(let s=1;s<=Math.ceil(distance);s++){const t=s/Math.ceil(distance);if(walkIn(x+(tx-x)*t,z+(tz-z)*t)<0.7){clear=false;break;}}
      if(clear)return [vx,vz];
      const g=TERRAIN,n=g.nx,{dist,cell}=field(tx,tz),k=cell(x,z),i=k%n,j=Math.floor(k/n);let best=k;
      for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=i+di,zz=j+dj,t=zz*n+xx;if(xx>=0&&xx<n&&zz>=0&&zz<g.nz&&dist[t]>=0&&(dist[best]<0||dist[t]<dist[best]))best=t;}
      if(best===k)return [0,0];
      const dx=(best%n)*2+g.x0-x,dz=Math.floor(best/n)*2+g.z0-z,r=Math.hypot(dx,dz)||1;return [dx/r*speed,dz/r*speed];
    },
    step(){
      if(done)return;
      frame++;if(frame%30===0)fields.clear();
      if(game.hero.dead || game.hero.hp<=0)return finish(false,'玩家阵亡');
      if(frame>=d.timeLimit*60)return finish(false,'战场时间耗尽');
      const q=d.objectives[index],target=d.objects.find(o=>o.id===q.target),a=target&&game.actors.get(target.id);
      game.story.target=target ? {x:a?.x ?? target.x,z:a?.z ?? target.z} : null;
      if(q.type==='protect' && a && !a.dead && frame%60===0){
        let pressure=0;const c=game.crowd;
        for(let i=0;i<c.N;i++)if(c.st[i]>=ST.IDLE && c.st[i]<=ST.ATTACK && Math.hypot(c.x[i]-a.x,c.z[i]-a.z)<6)pressure++;
        for(const boss of game.actors.list)if(boss.role==='boss'&&!boss.dead&&Math.hypot(boss.x-a.x,boss.z-a.z)<8)pressure+=5;
        if(pressure)game.actors.hurt(a,pressure*6*game.diff.dmg,false,false);
      }
      let complete=false;
      if(q.type==='clear')complete=!Array.from(game.crowd.st.slice(0,game.crowd.N)).some(s=>s!==ST.OFF&&s!==ST.DEAD)&&!game.actors.list.some(a=>a.role==='boss'&&!a.dead);
      if(q.type==='kos')complete=game.hero.kos>=q.value;
      if(q.type==='survive')complete=frame-begin>=q.value*60;
      if(q.type==='reach')complete=Math.hypot(game.hero.x-target.x,game.hero.z-target.z)<=5*target.scale;
      if(q.type==='defeat')complete=!!a?.dead;
      if(q.type==='protect'){if(!a||a.dead)return finish(false,'保护目标阵亡');complete=frame-begin>=q.value*60;}
      if(complete){index++;begin=frame;if(index===d.objectives.length)return finish(true,'全部任务完成');announce();}
      status(`${label()}　｜　剩余 ${Math.ceil(d.timeLimit-frame/60)} 秒　｜　击破 ${game.hero.kos}`);
    }
  };
}
