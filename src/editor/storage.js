const open = () => new Promise((resolve,reject)=>{
  const r=indexedDB.open('voxel-musou-levels',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('levels',{keyPath:'id'});
  r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
});
async function transaction(mode, action) {
  const db=await open();
  try { return await new Promise((resolve,reject)=>{
    const t=db.transaction('levels',mode),r=action(t.objectStore('levels'));
    t.oncomplete=()=>resolve(r.result); t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error || new Error('保存已取消'));
  }); } finally {db.close();}
}
export const listLevels=()=>transaction('readonly',s=>s.getAll());
export const saveLevel=(d)=>transaction('readwrite',s=>s.put(d));
export const removeLevel=(id)=>transaction('readwrite',s=>s.delete(id));
