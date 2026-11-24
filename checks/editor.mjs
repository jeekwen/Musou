import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){return n(s==='three'?new URL('../vendor/three/three.module.js',import.meta.url).href:s,c);}});
const {newLevel,validate,brush,sample,blocked,playErrors,clone}=await import('../src/editor/level.js');
const {installLevel,startCustom}=await import('../src/editor/runtime.js');
const {MAPS}=await import('../src/world/maps/index.js');
const {loadMap,ground,walkIn,clampWalk}=await import('../src/world/map.js');
const {terrainMesh,objectMesh}=await import('../src/editor/mesh.js');
const {ST}=await import('../src/crowd/crowd.js');
const d=newLevel(64);
d.objects.push({id:'foes',type:'enemy',x:0,z:12,yaw:0,scale:1,count:10,hp:100,kit:'lubu'});
assert.deepEqual(validate(JSON.parse(JSON.stringify(d))),d);
assert.throws(()=>validate({...d,heights:[NaN]}));
assert.throws(()=>validate({...d,objects:[{...d.objects[0],count:301}]}));
assert.throws(()=>validate({...d,objectives:[{type:'reach',value:1,target:'missing'}]}));
brush(d,8,0,{tool:'raise',radius:8,strength:3},1);
assert(sample(d,8,0)>2.9);assert.equal(sample(d,-20,0),0);
brush(d,-8,0,{tool:'paint',radius:4,strength:1,surface:3});assert(blocked(d,-8,0));
installLevel(d);loadMap(MAPS.editor);
assert.equal(ground(8,0),sample(d,8,0));assert(walkIn(-8,0)<0);assert(walkIn(0,-16)>0);
const p=[...clampWalk(-8,0)];assert(walkIn(...p)>=-0.1);
const mesh=terrainMesh(d);assert(mesh.geometry.attributes.position.array.every(Number.isFinite));
assert.equal(mesh.geometry.attributes.position.count,d.heights.length);
assert.equal(playErrors(d).length,0);
const bad=clone(d);bad.spawn={x:-8,z:0,yaw:0};assert(playErrors(bad).length>0);
// Flow-field test: a wall blocks direct pursuit, routing must change the velocity.
const nav=newLevel(64);nav.objects=[{id:'wall',type:'wall',x:0,z:0,yaw:0,scale:3,count:1,hp:100,kit:'lubu'}];
installLevel(nav);loadMap(MAPS.editor);
function game(){return {frame:0,story:{},diff:{dmg:1},hero:{x:0,z:12,hp:100,kos:0},crowd:{N:1,st:new Uint8Array([ST.IDLE]),reset(){},setWaves(){},setAllies(){},spawnSquad(){},spawnAllies(){}},actors:{list:[],reset(){},spawn(){},get(){return this.list[0];}}};}
const g=game();let result=null;
const run=startCustom(g,nav,(win,reason)=>result={win,reason},()=>{});
const v=run.steer(0,-10,0,12,0,3);assert(Math.abs(v[0])>0.1,'route goes around the wall');
g.crowd.st[0]=ST.DEAD;run.step();assert.equal(result.win,true);
const survival=newLevel(64);survival.objectives=[{type:'survive',value:1}];const sg=game();let won=false;
const sim=startCustom(sg,survival,w=>won=w,()=>{});for(let i=0;i<59;i++)sim.step();assert(!won);sim.step();assert(won);
const dead=game();let lost=false;const death=startCustom(dead,survival,w=>lost=!w,()=>{});dead.hero.hp=0;death.step();assert(lost);
for(const type of ['reach','defeat','protect']){
  const level=newLevel(64),typeObject={reach:'zone',defeat:'boss',protect:'friend'}[type];
  level.objects=[{id:'target',type:typeObject,x:0,z:12,yaw:0,scale:1,count:1,hp:100,kit:'guanyu'}];
  level.objectives=[{type,value:1,target:'target'}];validate(level);
  const g=game();g.crowd.st[0]=ST.DEAD;g.actors.list=[{key:'target',role:type==='defeat'?'boss':'ally',x:0,z:12,dead:type==='defeat'}];let outcome;
  const r=startCustom(g,level,w=>outcome=w,()=>{});for(let i=0;i<60;i++)r.step();assert.equal(outcome,true,type);
}
const protectedLevel=newLevel(64);protectedLevel.objects=[{id:'friend',type:'friend',x:0,z:12,yaw:0,scale:1,count:1,hp:100,kit:'guanyu'}];protectedLevel.objectives=[{type:'protect',target:'friend',value:10}];
const pg=game();pg.actors.list=[{dead:true}];let failure=false;startCustom(pg,protectedLevel,w=>failure=!w,()=>{}).step();assert(failure);
console.log('PASS editor document validation, JSON round trip, terrain brush, shared render/collision, flow-field routing, clear/survive/reach/defeat/protect/death');

