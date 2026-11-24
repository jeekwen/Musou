// Versioned, executable-code-free level documents. All distances are metres.
export const VERSION = 1;
export const SURFACES = [0x71834d, 0x9a805c, 0x777b80, 0x376d99, 0x564749];
export function newLevel(size = 128) {
  const n = size / 2 + 1;
  return { version: VERSION, id: crypto.randomUUID(), name: '未命名战场', size,
    heights: Array(n * n).fill(0), surfaces: Array(n * n).fill(0),
    hero: 'zhaoyun', spawn: { x: 0, z: -size / 4, yaw: 0 }, objects: [],
    objectives: [{ type: 'clear', value: 1 }], timeLimit: 300 };
}
export const clone = (v) => JSON.parse(JSON.stringify(v));
export function validate(d) {
  const fail = (message) => { throw new Error(message); };
  if (!d || d.version !== VERSION) fail('不支持的关卡版本');
  if (![64, 128, 192].includes(d.size)) fail('地图尺寸必须为 64、128 或 192 米');
  const count = (d.size / 2 + 1) ** 2, half = d.size / 2;
  if (!Array.isArray(d.heights) || d.heights.length !== count || !d.heights.every((v) => Number.isFinite(v) && v >= -12 && v <= 32)) fail('地形高度数据无效');
  if (!Array.isArray(d.surfaces) || d.surfaces.length !== count || !d.surfaces.every((v) => Number.isInteger(v) && v >= 0 && v < SURFACES.length)) fail('地表数据无效');
  const point = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= half - 4 && Math.abs(p.z) <= half - 4;
  if (typeof d.id !== 'string' || d.id.length > 80 || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 80) fail('关卡名称或 ID 无效');
  if (!['liubei','guanyu','zhangfei','zhaoyun','zhugeliang','huangzhong','lubu'].includes(d.hero) || !point(d.spawn) || !Number.isFinite(d.spawn.yaw)) fail('玩家配置无效');
  if (!Number.isFinite(d.timeLimit) || d.timeLimit < 10 || d.timeLimit > 3600) fail('限时应为 10～3600 秒');
  if (!Array.isArray(d.objects) || d.objects.length > 150) fail('物件最多 150 个');
  const ids = new Set(); let enemies = 0, allies = 0, bosses = 0;
  for (const o of d.objects) {
    if (!o || !point(o) || typeof o.id !== 'string' || ids.has(o.id)) fail('物件位置或 ID 无效');
    ids.add(o.id);
    if (!['wall','tree','rock','enemy','ally','boss','friend','zone'].includes(o.type)) fail('未知物件类型');
    if (!Number.isFinite(o.yaw) || !Number.isFinite(o.scale) || o.scale < 0.5 || o.scale > 3) fail('物件尺寸或朝向无效');
    if (!Number.isInteger(o.count) || o.count < 1 || o.count > 60 || !Number.isFinite(o.hp) || o.hp < 1 || o.hp > 20000) fail('单位属性无效');
    if (['boss','friend'].includes(o.type) && !['liubei','guanyu','zhangfei','zhaoyun','zhugeliang','huangzhong','lubu','caocao','zhangliao','xiahouyuan'].includes(o.kit)) fail('武将无效');
    if(o.type === 'enemy') enemies += o.count;
    if(o.type === 'ally') allies += o.count;
    if(o.type === 'boss' || o.type === 'friend') bosses++;
  }
  if(enemies > 300 || allies > 40 || bosses > 12) fail('容量上限：敌兵 300，友兵 40，武将合计 12');
  if (!Array.isArray(d.objectives) || !d.objectives.length || d.objectives.length > 20) fail('任务步骤应为 1～20 个');
  for (const q of d.objectives) {
    if (!q || !['clear','kos','survive','reach','defeat','protect'].includes(q.type)) fail('未知任务类型');
    if (!Number.isFinite(q.value) || q.value < 1 || q.value > 3600) fail('任务数值无效');
    if (['reach','defeat','protect'].includes(q.type) && !d.objects.some((o) => o.id === q.target && o.type === ({reach:'zone',defeat:'boss',protect:'friend'})[q.type])) fail('任务引用的区域或武将不存在');
  }
  return clone(d);
}
export function sample(d, x, z) {
  const n = d.size / 2 + 1, half = d.size / 2;
  const fx = Math.max(0, Math.min(n - 1.001, (x + half) / 2)), fz = Math.max(0, Math.min(n - 1.001, (z + half) / 2));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i;
  return (d.heights[k] * (1-u) + d.heights[k+1]*u)*(1-v) + (d.heights[k+n]*(1-u)+d.heights[k+n+1]*u)*v;
}
export function blocked(d, x, z, margin = 0) {
  const n = d.size/2+1, half=d.size/2;
  if(Math.abs(x)>half-3-margin || Math.abs(z)>half-3-margin) return true;
  const i=Math.max(0,Math.min(n-1,Math.round((x+half)/2))), j=Math.max(0,Math.min(n-1,Math.round((z+half)/2))), k=j*n+i;
  if(d.surfaces[k]>=3) return true;
  if (Math.max(Math.abs(d.heights[k]-d.heights[Math.min(k+1,d.heights.length-1)]), Math.abs(d.heights[k]-d.heights[Math.min(k+n,d.heights.length-1)]))>1.8) return true;
  return d.objects.some(o=>{
    if(!['wall','rock','tree'].includes(o.type)) return false;
    const dx=x-o.x,dz=z-o.z,c=Math.cos(o.yaw),s=Math.sin(o.yaw),lx=dx*c-dz*s,lz=dx*s+dz*c;
    return Math.abs(lx)<(o.type==='wall'?3: o.type==='rock'?1.8:0.65)*o.scale+margin && Math.abs(lz)<(o.type==='wall'?0.7:o.type==='rock'?1.5:0.65)*o.scale+margin;
  });
}
export function playErrors(d) {
  const errors=[];
  if(blocked(d,d.spawn.x,d.spawn.z,1)) errors.push('玩家出生点位于水域、障碍或陡坡');
  for(const o of d.objects) if(['enemy','ally','boss','friend','zone'].includes(o.type) && blocked(d,o.x,o.z,1)) errors.push('单位或区域位于不可通行位置：'+o.type+' '+o.id.slice(0,4));
  if(d.objectives.some(q=>q.type==='clear') && !d.objects.some(o=>['enemy','boss'].includes(o.type))) errors.push('清场任务需要至少一组敌军或敌将');
  if(!errors.length){
    const n=d.size/2+1,half=d.size/2,cell=p=>Math.round((p.z+half)/2)*n+Math.round((p.x+half)/2);
    const solid=Uint8Array.from(d.heights,(_,k)=>blocked(d,(k%n)*2-half,Math.floor(k/n)*2-half)?1:0);
    const seen=new Uint8Array(solid.length),queue=[cell(d.spawn)];seen[queue[0]]=1;
    for(let a=0;a<queue.length;a++){const k=queue[a],i=k%n,j=Math.floor(k/n);for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=i+di,z=j+dj,t=z*n+x;
      if(x<0||x>=n||z<0||z>=n||seen[t]||solid[t]||Math.abs(d.heights[t]-d.heights[k])>1.8)continue;
      seen[t]=1;queue.push(t);
    }}
    for(const o of d.objects)if(['enemy','ally','boss','friend','zone'].includes(o.type)&&!seen[cell(o)])errors.push('对象与玩家出生点之间没有可通行路线：'+o.type+' '+o.id.slice(0,4));
  }
  return errors;
}

// Brush uses a snapshot for smoothing; one gesture is one undo transaction.
export function brush(d, x, z, {tool, radius, strength, height, surface}, dt=1) {
  const n=d.size/2+1, half=d.size/2, old=tool==='smooth'?d.heights.slice():d.heights;
  for(let j=Math.max(0,Math.floor((z-radius+half)/2));j<=Math.min(n-1,Math.ceil((z+radius+half)/2));j++)
    for(let i=Math.max(0,Math.floor((x-radius+half)/2));i<=Math.min(n-1,Math.ceil((x+radius+half)/2));i++){
      const r=Math.hypot(i*2-half-x,j*2-half-z); if(r>radius) continue;
      const k=j*n+i,w=(1-r/radius)*strength*dt;
      if(tool==='paint') d.surfaces[k]=surface;
      else if(tool==='flatten') d.heights[k]+=(height-d.heights[k])*Math.min(1,w);
      else if(tool==='smooth') {
        let sum=0,c=0;for(let jj=Math.max(0,j-1);jj<=Math.min(n-1,j+1);jj++)for(let ii=Math.max(0,i-1);ii<=Math.min(n-1,i+1);ii++){sum+=old[jj*n+ii];c++;}
        d.heights[k]+=(sum/c-d.heights[k])*Math.min(1,w);
      } else d.heights[k]=Math.max(-12,Math.min(32,d.heights[k]+w*(tool==='lower'?-1:1)));
    }
}
