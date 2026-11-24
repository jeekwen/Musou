import * as THREE from 'three';
import { newLevel, clone, validate, brush, sample, playErrors } from './level.js';
import { terrainMesh, objectMesh, disposeGroup } from './mesh.js';
import { listLevels, saveLevel, removeLevel } from './storage.js';
import { TASKS } from './runtime.js';
import { CHARS } from '../chars/index.js';

const TYPES={wall:'城墙',tree:'树木',rock:'岩石',enemy:'敌军小队',ally:'友军小队',boss:'敌方武将',friend:'友方武将',zone:'目标区域'};
const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Small local orbit/pan controller; the vendored Three distribution has no controls addon.
class EditorCamera {
  constructor(camera,canvas){
    this.target=new THREE.Vector3();this.enabled=true;let drag=null;
    const orbit=new THREE.Spherical(),offset=new THREE.Vector3(),right=new THREE.Vector3(),forward=new THREE.Vector3();
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{if(this.enabled && e.button!==0){drag={x:e.clientX,y:e.clientY,button:e.button};canvas.setPointerCapture(e.pointerId);}});
    canvas.addEventListener('pointermove',e=>{if(!this.enabled||!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
      offset.copy(camera.position).sub(this.target);orbit.setFromVector3(offset);
      if(drag.button===1){orbit.theta-=dx*0.006;orbit.phi=Math.max(0.08,Math.min(Math.PI*0.48,orbit.phi-dy*0.006));offset.setFromSpherical(orbit);}
      else {const scale=orbit.radius/Math.max(200,canvas.clientHeight);right.setFromMatrixColumn(camera.matrix,0);forward.crossVectors(new THREE.Vector3(0,1,0),right);this.target.addScaledVector(right,-dx*scale).addScaledVector(forward,-dy*scale);}
      camera.position.copy(this.target).add(offset);camera.lookAt(this.target);
    });
    const stop=()=>drag=null;canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
    canvas.addEventListener('wheel',e=>{if(!this.enabled)return;e.preventDefault();offset.copy(camera.position).sub(this.target);offset.multiplyScalar(Math.exp(e.deltaY*0.001));offset.clampLength(12,350);camera.position.copy(this.target).add(offset);},{passive:false});
    this.update=()=>camera.lookAt(this.target);
  }
}
export function createEditor(el, flow, play) {
  el.innerHTML=`<header><b>关卡编辑</b><input id="ed-name" maxlength="80" aria-label="关卡名称"><select id="ed-size"><option>64</option><option selected>128</option><option>192</option></select><button data-a="new">新建</button><button data-a="save">保存</button><select id="ed-saves" aria-label="已保存关卡"></select><button data-a="load">载入</button><button data-a="remove">删除存档</button><button data-a="export">导出</button><button data-a="import">导入</button><button data-a="undo">撤销</button><button data-a="redo">重做</button><button data-a="play" class="primary">▶ 试玩</button><button data-a="exit">返回标题</button><input id="ed-file" type="file" accept=".json,application/json" hidden></header>
    <aside class="ed-tools"><h3>地形工具</h3><div class="ed-grid">${[['select','选择 / 移动'],['raise','抬高'],['lower','降低'],['smooth','平滑'],['flatten','拉平'],['paint','绘制地表'],['spawn','玩家出生点']].map(([t,s])=>`<button data-tool="${t}">${s}</button>`).join('')}</div>
    <label>笔刷半径 <input id="ed-radius" type="range" min="2" max="24" value="8"><output id="ed-radius-out">8 m</output></label>
    <label>笔刷强度 <input id="ed-strength" type="range" min="0.2" max="5" value="1.5" step="0.1"></label>
    <label>拉平高度 <input id="ed-height" type="number" min="-12" max="32" value="0" step="0.5"></label>
    <label>地表 <select id="ed-surface"><option value="0">草地</option><option value="1">泥土 / 道路</option><option value="2">岩石</option><option value="3">水域（禁止通行）</option><option value="4">禁止通行</option></select></label>
    <h3>放置物件 / 单位</h3><div class="ed-grid">${Object.entries(TYPES).map(([t,s])=>`<button data-tool="${t}">${s}</button>`).join('')}</div><label><input id="ed-grid-toggle" type="checkbox" checked> 显示网格</label><p>左键：编辑 / 拖动物件<br>右键拖动：平移<br>中键拖动：旋转<br>滚轮：缩放<br>Ctrl+Z / Y：撤销 / 重做<br>Delete：删除选中物件</p></aside>
    <div class="ed-viewport"></div><aside class="ed-properties"><h3>战场配置</h3><label>试玩武将 <select id="ed-hero">${Object.values(CHARS).map(c=>`<option value="${c.id}">${c.name.zh}</option>`).join('')}</select></label><label>战场限时（秒）<input id="ed-time" type="number" min="10" max="3600"></label><h3>选中对象</h3><div id="ed-prop"></div><h3>任务步骤（依次执行）</h3><div id="ed-tasks"></div><button data-a="task">＋ 添加任务</button><h3>对象列表</h3><div id="ed-objects"></div></aside>
    <footer><span id="ed-message">准备就绪</span><span id="ed-dirty"></span></footer>`;
  const $=s=>el.querySelector(s),viewport=$('.ed-viewport');
  let d=newLevel(),selected=null,tool='select',undo=[],redo=[],active=false,dirty=false,renderer,scene,camera,controls,terrain,objects,grid,cursor;
  let gesture=null,drag=null,lastPoint=null,lastPaint=0,autosave=null,sessionLoaded=false;
  const ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const say=s=>{$('#ed-message').textContent=s;};
  const mark=()=>{dirty=true;$('#ed-dirty').textContent='● 未保存';clearTimeout(autosave);const snapshot=clone(d);autosave=setTimeout(()=>saveLevel({...snapshot,id:'__draft__',sourceId:snapshot.id}).catch(e=>say('草稿保存失败：'+e.message)),1000);};
  const remember=()=>{undo.push(clone(d));if(undo.length>40)undo.shift();redo=[];};
  function init(){
    if(renderer)return;
    scene=new THREE.Scene();scene.background=new THREE.Color(0x222d38);
    scene.add(new THREE.HemisphereLight(0xdceaff,0x6e654a,2.5));const light=new THREE.DirectionalLight(0xfff3d4,3);light.position.set(30,80,-30);scene.add(light);
    camera=new THREE.PerspectiveCamera(48,1,0.2,1000);camera.position.set(75,100,85);
    renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;viewport.append(renderer.domElement);
    controls=new EditorCamera(camera,renderer.domElement);
    cursor=new THREE.Mesh(new THREE.RingGeometry(0.96,1,48),new THREE.MeshBasicMaterial({color:0xffdf7e,side:THREE.DoubleSide,depthTest:false}));cursor.rotation.x=-Math.PI/2;cursor.renderOrder=10;scene.add(cursor);
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',up);renderer.domElement.addEventListener('lostpointercapture',up);
  }
  function rebuild(){
    if(terrain){scene.remove(terrain,objects,grid);disposeGroup(terrain);disposeGroup(objects);disposeGroup(grid);}
    terrain=terrainMesh(d);scene.add(terrain);objects=new THREE.Group();
    for(const o of [...d.objects,{...d.spawn,id:'spawn',type:'spawn',scale:1}]){const m=objectMesh(o,d,true);objects.add(m);if(o.id===selected){const box=new THREE.BoxHelper(m,0xffee77);objects.add(box);}}
    scene.add(objects);grid=new THREE.GridHelper(d.size,d.size/2,0xc3b896,0x6d776c);grid.position.y=0.04;grid.visible=$('#ed-grid-toggle').checked;scene.add(grid);
  }
  function sync(){
    $('#ed-name').value=d.name;$('#ed-size').value=d.size;$('#ed-hero').value=d.hero;$('#ed-time').value=d.timeLimit;
    const o=selected==='spawn'?d.spawn:d.objects.find(v=>v.id===selected);
    $('#ed-prop').innerHTML=o?`<p>${selected==='spawn'?'玩家出生点':TYPES[o.type]}</p>${[['x','位置 X',-d.size/2+4,d.size/2-4],['z','位置 Z',-d.size/2+4,d.size/2-4],['yaw','朝向（度）',-360,360],...(selected==='spawn'?[]:[['scale','尺寸 / 区域倍率',0.5,3],['count','小队人数',1,60],['hp','武将生命',1,20000]])].map(([k,t,min,max])=>`<label>${t}<input data-prop="${k}" type="number" min="${min}" max="${max}" step="${k==='count'||k==='hp'?1:0.1}" value="${k==='yaw'?Math.round(o[k]*180/Math.PI):o[k]}"></label>`).join('')}${['boss','friend'].includes(o.type)?`<label>武将<select data-prop="kit">${[...Object.keys(CHARS),'caocao','zhangliao','xiahouyuan'].map(id=>`<option ${id===o.kit?'selected':''}>${id}</option>`).join('')}</select></label>`:''}${selected!=='spawn'?'<button data-a="duplicate">复制物件</button><button data-a="delete">删除物件</button>':''}`:'点击地图中的对象，或从列表选择。';
    $('#ed-objects').innerHTML=d.objects.map((o,i)=>`<button data-select="${esc(o.id)}" class="${o.id===selected?'on':''}">${i+1}. ${TYPES[o.type]}${o.type==='enemy'||o.type==='ally'?' ×'+o.count:''}</button>`).join('');
    $('#ed-tasks').innerHTML=d.objectives.map((q,i)=>`<div class="ed-task"><b>步骤 ${i+1}</b><button data-task-remove="${i}" title="删除步骤">×</button><select data-task="${i}" data-key="type">${Object.entries(TASKS).map(([v,t])=>`<option value="${v}" ${v===q.type?'selected':''}>${t}</option>`).join('')}</select>${['reach','defeat','protect'].includes(q.type)?`<select data-task="${i}" data-key="target"><option value="">选择目标</option>${d.objects.filter(o=>o.type===({reach:'zone',defeat:'boss',protect:'friend'})[q.type]).map(o=>`<option value="${esc(o.id)}" ${q.target===o.id?'selected':''}>${TYPES[o.type]} ${d.objects.indexOf(o)+1}</option>`).join('')}</select>`:''}${['kos','survive','protect'].includes(q.type)?`<label>${q.type==='kos'?'击破人数':'持续秒数'}<input type="number" min="1" max="3600" data-task="${i}" data-key="value" value="${q.value}"></label>`:''}</div>`).join('');
  }
  function setTool(t){tool=t;el.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));say(`当前工具：${el.querySelector('[data-tool="'+t+'"]')?.textContent}。左键操作，右键平移。`);}
  function point(e){const rect=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);camera.updateMatrixWorld();ray.setFromCamera(mouse,camera);return ray.intersectObject(terrain)[0]?.point || ray.ray.intersectPlane(plane,new THREE.Vector3());}
  function apply(p,dt){brush(d,p.x,p.z,{tool,radius:+$('#ed-radius').value,strength:+$('#ed-strength').value,height:+$('#ed-height').value,surface:+$('#ed-surface').value},dt);rebuild();}
  function down(e){if(e.button!==0)return;const p=point(e);if(!p||Math.abs(p.x)>d.size/2-4||Math.abs(p.z)>d.size/2-4)return;renderer.domElement.setPointerCapture(e.pointerId);
    if(tool==='select'){
      const hits=ray.intersectObjects(objects.children,true);let hit=hits[0]?.object;while(hit && !hit.userData.id)hit=hit.parent;
      selected=hit?.userData.id || null;sync();rebuild();if(selected){remember();drag={dx:(selected==='spawn'?d.spawn:d.objects.find(o=>o.id===selected)).x-p.x,dz:(selected==='spawn'?d.spawn:d.objects.find(o=>o.id===selected)).z-p.z};}return;
    }
    remember();
    if(tool==='spawn'){d.spawn.x=p.x;d.spawn.z=p.z;selected='spawn';mark();rebuild();sync();return;}
    if(TYPES[tool]){const o={id:crypto.randomUUID(),type:tool,x:p.x,z:p.z,yaw:0,scale:1,count:tool==='enemy'?20:tool==='ally'?12:1,hp:tool==='boss'?1800:800,kit:tool==='boss'?'lubu':'guanyu'};d.objects.push(o);selected=o.id;mark();rebuild();sync();return;}
    gesture=true;lastPoint=p;lastPaint=performance.now();apply(p,0.3);mark();
  }
  function move(e){const p=point(e);if(!p)return;cursor.visible=!['select',...Object.keys(TYPES),'spawn'].includes(tool);cursor.position.set(p.x,p.y+0.15,p.z);cursor.scale.setScalar(+$('#ed-radius').value);
    if(drag){const o=selected==='spawn'?d.spawn:d.objects.find(o=>o.id===selected);if(o){o.x=Math.max(-d.size/2+4,Math.min(d.size/2-4,p.x+drag.dx));o.z=Math.max(-d.size/2+4,Math.min(d.size/2-4,p.z+drag.dz));rebuild();mark();}return;}
    if(gesture){lastPoint=p;const now=performance.now();if(now-lastPaint>35){apply(p,Math.min(0.15,(now-lastPaint)/1000)*3);lastPaint=now;mark();}}
  }
  function up(){if(gesture||drag){gesture=null;drag=null;lastPoint=null;sync();}}
  async function refreshSaves(){const levels=await listLevels();$('#ed-saves').innerHTML='<option value="">选择已保存关卡</option>'+levels.filter(v=>v.id!=='__draft__').map(v=>`<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');return levels;}
  function replace(data){d=data;selected=null;undo=[];redo=[];dirty=false;$('#ed-dirty').textContent='';rebuild();sync();}
  async function action(a){
    try{
      if(a==='undo'||a==='redo'){const from=a==='undo'?undo:redo,to=a==='undo'?redo:undo;if(!from.length)return;to.push(clone(d));d=from.pop();selected=null;mark();rebuild();sync();return;}
      if(a==='save'){const valid=validate(d);await saveLevel(valid);dirty=false;$('#ed-dirty').textContent='✓ 已保存';await refreshSaves();$('#ed-saves').value=d.id;say('已保存到当前浏览器。导出 JSON 可备份到文件。');}
      if(a==='new'){if(dirty&&!confirm('新建会替换当前未保存的编辑稿，继续？'))return;replace(newLevel(+$('#ed-size').value));mark();say('新建空白战场');}
      if(a==='load'){const id=$('#ed-saves').value;if(!id)return;if(dirty&&!confirm('载入会替换当前未保存的编辑稿，继续？'))return;const levels=await listLevels();const next=validate(levels.find(v=>v.id===id));clearTimeout(autosave);replace(next);say('关卡已载入');}
      if(a==='remove'){const id=$('#ed-saves').value;if(id&&confirm('删除选中的本地存档？')){await removeLevel(id);await refreshSaves();}}
      if(a==='export'){const data=validate(d),blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(d.name.replace(/[\\/:*?"<>|]/g,'_')||'level')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('已导出关卡文件');}
      if(a==='import')$('#ed-file').click();
      if(a==='play'){const data=validate(d),errors=playErrors(data);if(errors.length)throw new Error(errors.join('；'));await play(data);}
      if(a==='exit'){if(!dirty||confirm('当前修改尚未手动保存，仍返回标题？'))flow.go('title');}
      if(a==='task'){remember();d.objectives.push({type:'clear',value:1});mark();sync();}
      if(a==='delete'&&selected!=='spawn'){const refs=d.objectives.some(q=>q.target===selected);if(refs)throw new Error('该对象被任务引用，请先修改或删除相应任务');remember();d.objects=d.objects.filter(o=>o.id!==selected);selected=null;mark();rebuild();sync();}
      if(a==='duplicate'){const o=d.objects.find(o=>o.id===selected);if(o){remember();const c={...o,id:crypto.randomUUID(),x:Math.min(d.size/2-4,o.x+4)};d.objects.push(c);selected=c.id;mark();rebuild();sync();}}
    }catch(e){say('操作失败：'+e.message);}
  }
  el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.tool)setTool(b.dataset.tool);if(b.dataset.a)action(b.dataset.a);if(b.dataset.select){selected=b.dataset.select;setTool('select');rebuild();sync();}if(b.dataset.taskRemove!==undefined){if(d.objectives.length===1)return say('至少保留一个任务');remember();d.objectives.splice(+b.dataset.taskRemove,1);mark();sync();}});
  el.addEventListener('change',e=>{
    const t=e.target;
    if(t.id==='ed-file')return;
    if(t.id==='ed-grid-toggle'){if(grid)grid.visible=t.checked;return;}
    if(t.dataset.prop){const o=selected==='spawn'?d.spawn:d.objects.find(o=>o.id===selected);if(!o)return;const v=t.dataset.prop==='kit'?t.value:Number(t.value);if(typeof v==='number'&&(!Number.isFinite(v)||!t.checkValidity()))return say('属性超出允许范围');remember();o[t.dataset.prop]=t.dataset.prop==='yaw'?v*Math.PI/180:v;mark();rebuild();}
    if(t.dataset.task!==undefined){remember();const q=d.objectives[+t.dataset.task];q[t.dataset.key]=t.dataset.key==='value'?Number(t.value):t.value;if(t.dataset.key==='type'){q.value=1;delete q.target;}mark();sync();}
    if(['ed-name','ed-hero','ed-time'].includes(t.id)){if(!t.checkValidity())return;remember();if(t.id==='ed-name')d.name=t.value;if(t.id==='ed-hero')d.hero=t.value;if(t.id==='ed-time')d.timeLimit=Number(t.value);mark();}
  });
  $('#ed-radius').addEventListener('input',()=>$('#ed-radius-out').textContent=$('#ed-radius').value+' m');
  $('#ed-file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>3e6)throw new Error('文件超过 3 MB');const data=validate(JSON.parse(await f.text()));if(dirty&&!confirm('导入会替换当前编辑稿，继续？'))return;clearTimeout(autosave);replace({...data,id:crypto.randomUUID()});mark();say('导入成功，请保存');}catch(err){say('导入失败：'+err.message);}finally{e.target.value='';}});
  addEventListener('keydown',e=>{if(!active||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&['z','y','s'].includes(e.key.toLowerCase())){e.preventDefault();action(e.key.toLowerCase()==='s'?'save':e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');}if(e.key==='Delete')action('delete');});
  addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  return {
    enter(){active=true;init();controls.enabled=true;setTool(tool);rebuild();sync();refreshSaves().then(levels=>{if(!sessionLoaded){sessionLoaded=true;const draft=levels.find(v=>v.id==='__draft__');if(draft&&confirm('发现上次编辑草稿，是否恢复？')){try{replace(validate({...draft,id:draft.sourceId}));mark();say('已恢复上次草稿');}catch(e){say('草稿无法恢复：'+e.message);}}}}).catch(e=>say('无法读取本地存档：'+e.message));},
    exit(){active=false;up();if(controls)controls.enabled=false;},
    render(){if(!active||!renderer)return;const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();controls.update();renderer.render(scene,camera);},
    message:say,
  };
}
