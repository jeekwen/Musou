import * as THREE from 'three';
import { SURFACES, sample } from './level.js';
export function terrainMesh(d) {
  const n=d.size/2+1, positions=[], colors=[], indices=[];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const k=j*n+i,c=new THREE.Color(SURFACES[d.surfaces[k]]);
    positions.push(i*2-d.size/2,d.heights[k],j*2-d.size/2); colors.push(c.r,c.g,c.b);
    if(i<n-1 && j<n-1) indices.push(k,k+n,k+1,k+1,k+n,k+n+1);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,flatShading:true,side:THREE.DoubleSide}));
  m.receiveShadow=true;m.name='editor-terrain'; return m;
}
export function objectMesh(o,d,preview=false) {
  const root=new THREE.Group(), mat=(c)=>new THREE.MeshStandardMaterial({color:c,roughness:0.85});
  const add=(g,c,y=0)=>{const m=new THREE.Mesh(g,mat(c));m.position.y=y;m.castShadow=true;root.add(m);return m;};
  if(o.type==='wall') add(new THREE.BoxGeometry(6,3,1.4),0x8f887c,1.5);
  if(o.type==='rock') add(new THREE.DodecahedronGeometry(1.9,0),0x85817c,1);
  if(o.type==='tree'){add(new THREE.CylinderGeometry(0.35,0.6,5,6),0x68503b,2.5);add(new THREE.ConeGeometry(2.8,6,7),0x365b35,6);}
  if(preview && !['wall','rock','tree'].includes(o.type)) {
    const color={enemy:0xdb604d,ally:0x4bb6ce,boss:0xc7467c,friend:0x70dd9b,zone:0xe2c35f,spawn:0xffffff}[o.type];
    if(o.type==='zone') {const m=add(new THREE.CylinderGeometry(5,5,0.12,40),color,0.15);m.material.transparent=true;m.material.opacity=0.4;}
    else {add(new THREE.CylinderGeometry(0.8,1.1,1.8,6),color,0.9);add(new THREE.ConeGeometry(1.1,1.5,4),color,2.6);}
  }
  root.position.set(o.x,sample(d,o.x,o.z),o.z);root.rotation.y=o.yaw || 0;root.scale.setScalar(o.scale || 1);root.userData.id=o.id;return root;
}
export function disposeGroup(root){root.traverse(o=>{o.geometry?.dispose();for(const m of [].concat(o.material||[]))m.dispose();});}
