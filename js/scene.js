import * as THREE from 'three';
import { EffectComposer } from './../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './../vendor/addons/postprocessing/OutputPass.js';

const isMobile = matchMedia('(max-width:760px)').matches || /Mobi|Android/i.test(navigator.userAgent);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('gl');

function hasGL(){try{const c=document.createElement('canvas');return !!(c.getContext('webgl2')||c.getContext('webgl'))}catch(e){return false}}
if(!hasGL()){document.documentElement.classList.add('nogl');throw new Error('no webgl')}

const renderer = new THREE.WebGLRenderer({canvas, antialias:!isMobile, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile?1.5:2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x3a4258);
scene.fog = new THREE.FogExp2(FOG, 0.0021);
const camera = new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 1, 3000);

// ---------- sky ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500,32,16), new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
 uniforms:{bp:{value:0}},
 vertexShader:`varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`varying vec3 v;uniform float bp;void main(){float h=v.y;
 vec3 top=vec3(.035,.07,.14),mid=vec3(.22,.25,.38),hor=vec3(1.,.55,.25);
 vec3 c=mix(hor,mid,smoothstep(-.02,.12,h));c=mix(c,top,smoothstep(.12,.6,h));
 float sun=pow(max(dot(v,normalize(vec3(-.6,.06,-.8))),0.),180.);c+=vec3(1.,.7,.4)*sun*1.5;
 vec3 b=vec3(.04,.12,.25);gl_FragColor=vec4(mix(c,b,bp),1.);}`}));
scene.add(sky);

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0x9fb4e0, 0x5a4a36, 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb27a, 2.6);
sun.position.set(-260,110,-300); sun.castShadow = true;
const sm = isMobile?1024:2048; sun.shadow.mapSize.set(sm,sm);
Object.assign(sun.shadow.camera,{left:-260,right:260,top:260,bottom:-260,near:10,far:900}); sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.6;
scene.add(sun);

// ---------- material registry (for blueprint morph) ----------
const solids = []; const lineGroup = new THREE.Group(); scene.add(lineGroup);
const lineMat = new THREE.LineBasicMaterial({color:0x7fc4ff, transparent:true, opacity:0, fog:false, depthWrite:false});
function M(p){const m=new THREE.MeshStandardMaterial(p);solids.push(m);return m}
function add(mesh,{edges=true,shadow=true,receive=true,thr=30}={}){mesh.castShadow=shadow;mesh.receiveShadow=receive;scene.add(mesh);
 if(edges){const e=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,thr),lineMat);e.matrixAutoUpdate=false;mesh.updateMatrixWorld();e.matrix.copy(mesh.matrixWorld);lineGroup.add(e)}return mesh}

// ---------- terrain ----------
function hash(x,y){const h=Math.sin(x*127.1+y*311.7)*43758.5453;return h-Math.floor(h)}
function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
 const a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
function fbm(x,y){let s=0,a=1,f=1;for(let i=0;i<5;i++){s+=a*noise(x*f,y*f);a*=.5;f*=2}return s}
const TS=1400, seg=isMobile?120:200;
const tg = new THREE.PlaneGeometry(TS,TS,seg,seg); tg.rotateX(-Math.PI/2);
const tp=tg.attributes.position, tcol=[];
const cA=new THREE.Color(0x6f7d4a),cB=new THREE.Color(0x8f8656),cC=new THREE.Color(0xa89878),tmp=new THREE.Color();
function groundH(x,z){const r=Math.hypot(x*.85,z);const k=THREE.MathUtils.smoothstep(r,230,480);return Math.pow(fbm(x*.0045+3,z*.0045+7)/1.9,1.6)*150*k - 0.4}
for(let i=0;i<tp.count;i++){const x=tp.getX(i),z=tp.getZ(i);const h=groundH(x,z);tp.setY(i,h);
 const n=noise(x*.03,z*.03);tmp.copy(cA).lerp(cB,n).lerp(cC,THREE.MathUtils.clamp(h/120,0,1)*.7);tcol.push(tmp.r,tmp.g,tmp.b)}
tg.setAttribute('color',new THREE.Float32BufferAttribute(tcol,3)); tg.computeVertexNormals();
add(new THREE.Mesh(tg,M({vertexColors:true,roughness:1})),{edges:false,shadow:false});
// blueprint grid
const grid=new THREE.GridHelper(900,90,0x7fc4ff,0x2c6aa0);grid.material.transparent=true;grid.material.opacity=0;grid.material.fog=false;grid.position.y=0.05;scene.add(grid);

// ---------- roads ----------
const asphalt=M({color:0x2b2e33,roughness:.92}), concrete=M({color:0xb9b4aa,roughness:.85}), paint=M({color:0xf2f2ee,roughness:.6,emissive:0x222222}), paintY=M({color:0xf0b429,roughness:.6,emissive:0x2a1c00});
const UP=new THREE.Vector3(0,1,0);
function frame(curve,t){const p=curve.getPointAt(t),tan=curve.getTangentAt(t);const side=new THREE.Vector3().crossVectors(tan,UP).normalize();return{p,tan,side}}
function strip(curve,a,b,{t0=0,t1=1,n=200,dy=0,vert=null}={},out){out=out||{pos:[],idx:[]};const base=out.pos.length/3;
 for(let i=0;i<=n;i++){const t=t0+(t1-t0)*i/n;const {p,side}=frame(curve,t);
  if(vert){const q=p.clone().addScaledVector(side,a);out.pos.push(q.x,q.y+vert[0],q.z,q.x,q.y+vert[1],q.z)}
  else{const q1=p.clone().addScaledVector(side,a),q2=p.clone().addScaledVector(side,b);out.pos.push(q1.x,q1.y+dy,q1.z,q2.x,q2.y+dy,q2.z)}
  if(i<n){const k=base+i*2;out.idx.push(k,k+1,k+2,k+1,k+3,k+2)}}return out}
function geo(o){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(o.pos,3));g.setIndex(o.idx);g.computeVertexNormals();return g}
function dashes(curve,off,len,{dash=6,gap=8,w=.35}={},out){const L=curve.getLength();for(let s=0;s<L-dash;s+=dash+gap)strip(curve,off-w/2,off+w/2,{t0:s/L,t1:(s+dash)/L,n:2,dy:.06},out);return out}
const pierGeo=new THREE.CylinderGeometry(1.1,1.4,1,14);const pierCap=new THREE.BoxGeometry(1,1,1);
const roads=[];
function road(pts,{w=11,lanes=2,elevatedEdge=true,median=false,closed=false,dash=true}={}){
 const curve=new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p)),closed,'centripetal');const L=curve.getLength();const n=Math.max(40,Math.round(L/2));
 add(new THREE.Mesh(geo(strip(curve,-w/2,w/2,{n})),asphalt),{thr:80});
 const pm=dash?dashes(curve,0,L,{},{pos:[],idx:[]}):{pos:[],idx:[]};
 strip(curve,-w/2+.6,-w/2+.9,{n,dy:.06},pm);strip(curve,w/2-.9,w/2-.6,{n,dy:.06},pm);
 if(lanes>2){dashes(curve,-w/4,L,{},pm);dashes(curve,w/4,L,{},pm)}
 add(new THREE.Mesh(geo(pm),median?paintY:paint),{edges:false,shadow:false});
 // elevated: girders, barriers, piers
 let maxY=0;pts.forEach(p=>maxY=Math.max(maxY,p[1]));
 if(maxY>1.5){const sk={pos:[],idx:[]};strip(curve,-w/2,0,{n,vert:[-1.6,0]},sk);strip(curve,w/2,0,{n,vert:[-1.6,0]},sk);
  strip(curve,-w/2,0,{n,vert:[0,1.0]},sk);strip(curve,w/2,0,{n,vert:[0,1.0]},sk);
  const sg=geo(sk);const ms=new THREE.Mesh(sg,new THREE.MeshStandardMaterial({color:0xc9c3b8,roughness:.8,side:THREE.DoubleSide}));solids.push(ms.material);add(ms,{thr:80});
  for(let s=10;s<L;s+=22){const {p}=frame(curve,s/L);if(p.y>3){const h=p.y-1.6;const pr=new THREE.Mesh(pierGeo,concrete);pr.scale.set(1,h,1);pr.position.set(p.x,h/2,p.z);add(pr);
   const cap=new THREE.Mesh(pierCap,concrete);const {side}=frame(curve,s/L);cap.scale.set(w*.85,1.2,2.2);cap.position.set(p.x,p.y-2.2,p.z);cap.lookAt(p.x+side.z,p.y-2.2,p.z-side.x);add(cap)}}}
 roads.push({curve,L,w,lanes});return curve}

// main highway E-W (two carriageways)
const hwN=road([[-700,0,-9],[-200,0,-9],[0,0,-9],[200,0,-9],[700,0,-9]],{w:14,lanes:3});
const hwS=road([[700,0,9],[200,0,9],[0,0,9],[-200,0,9],[-700,0,9]],{w:14,lanes:3});
// median barrier
add(new THREE.Mesh(new THREE.BoxGeometry(1400,1,.6),concrete).translateY(.5));
// cross road N-S on bridge
const cross=road([[0,0,-700],[0,0,-190],[0,4,-110],[0,10,-40],[0,10,40],[0,4,110],[0,0,190],[0,0,700]],{w:16,lanes:3});
// loop ramps
function loop(cx,cz,r,a0,a1,y0,y1){const p=[];const N=16;for(let i=0;i<=N;i++){const t=i/N,a=a0+(a1-a0)*t;const e=t*t*(3-2*t);p.push([cx+r*Math.cos(a),y0+(y1-y0)*e,cz+r*Math.sin(a)])}return p}
road(loop(42,42,30,-Math.PI/2+.25,Math.PI-.15,0,10).map(p=>[p[0],p[1],p[2]]),{w:8});
road(loop(-42,-42,30,Math.PI/2+.25,2*Math.PI-.15,0,10),{w:8});
road([[150,0,16],[90,0,22],[40,3,60],[14,7,95],[9,9,60]],{w:8});
road([[-150,0,-16],[-90,0,-22],[-40,3,-60],[-14,7,-95],[-9,9,-60]],{w:8});
// roundabout + local roads
const RB=new THREE.Vector3(-170,0,130);
const ring=new THREE.Mesh(new THREE.RingGeometry(14,26,64).rotateX(-Math.PI/2),asphalt);ring.position.copy(RB).setY(.02);add(ring,{thr:80});
const isl=new THREE.Mesh(new THREE.CylinderGeometry(14,14,.8,48),M({color:0x55703a,roughness:1}));isl.position.copy(RB).setY(.4);add(isl);
const curb=new THREE.Mesh(new THREE.TorusGeometry(14,.4,6,64).rotateX(Math.PI/2),concrete);curb.position.copy(RB).setY(.5);add(curb,{edges:false});
const ringPaint=new THREE.Mesh(new THREE.RingGeometry(19.8,20.2,64).rotateX(-Math.PI/2),paint);ringPaint.position.copy(RB).setY(.07);scene.add(ringPaint);
road([[-170,0,16],[-170,0,104]],{w:10});road([[-170,0,156],[-170,0,500]],{w:10});
road([[-500,0,130],[-196,0,130]],{w:10});road([[-144,0,130],[60,0,150],[300,0,260]],{w:10});
const rbCurve=new THREE.CatmullRomCurve3(Array.from({length:24},(_,i)=>{const a=i/24*Math.PI*2;return new THREE.Vector3(RB.x+20*Math.cos(a),.3,RB.z+20*Math.sin(a))}),true);
roads.push({curve:rbCurve,L:rbCurve.getLength(),w:6,lanes:1,ring:true});
// site road to construction
road([[120,0,-16],[125,0,-60],[140,0,-90]],{w:9,dash:false});

// ---------- trees (instanced) ----------
{const n=isMobile?350:750;const g=new THREE.ConeGeometry(2.4,7,7);g.translate(0,3.5,0);const tr=new THREE.InstancedMesh(g,M({color:0x3d5228,roughness:1,flatShading:true}),n);
 const o=new THREE.Object3D();let k=0;let guard=0;while(k<n&&guard++<20000){const x=(Math.random()-.5)*900,z=(Math.random()-.5)*900;
  if(Math.abs(z)<30||Math.abs(x)<30||Math.hypot(x-42,z-42)<45||Math.hypot(x+42,z+42)<45||Math.hypot(x-RB.x,z-RB.z)<40||(x>80&&x<230&&z<-30&&z>-170)||Math.abs(z-130)<14&&x<-140||Math.abs(x+170)<14&&z>0)continue;
  const s=.6+Math.random()*1.1;o.position.set(x,groundH(x,z),z);o.scale.set(s,s*(.8+Math.random()*.6),s);o.rotation.y=Math.random()*6;o.updateMatrix();tr.setMatrixAt(k++,o.matrix)}
 tr.count=k;tr.castShadow=true;tr.receiveShadow=true;scene.add(tr)}
// olive tree on roundabout island
{const t=new THREE.Mesh(new THREE.IcosahedronGeometry(6,1),M({color:0x6f8a4e,flatShading:true,roughness:1}));t.position.copy(RB).setY(8);t.scale.set(1,.7,1);add(t,{edges:false});
 const tk=new THREE.Mesh(new THREE.CylinderGeometry(.6,.9,6),M({color:0x5a4632}));tk.position.copy(RB).setY(3.5);add(tk,{edges:false})}

// ---------- construction site ----------
const SITE=new THREE.Vector3(160,0,-110);
{const dirt=new THREE.Mesh(new THREE.PlaneGeometry(120,110).rotateX(-Math.PI/2),M({color:0x8a7558,roughness:1}));dirt.position.copy(SITE).setY(.04);add(dirt,{edges:false,shadow:false});
 const colG=new THREE.BoxGeometry(1.1,1,1.1),slabG=new THREE.BoxGeometry(1,1,1);const cm=M({color:0xc4beb2,roughness:.9});
 const NX=6,NZ=4,SP=8,FH=4.2,FL=11;
 for(let f=0;f<FL;f++){const done=f<9;
  for(let i=0;i<NX;i++)for(let j=0;j<NZ;j++){if(!done&&(i+j)%2)continue;const c=new THREE.Mesh(colG,cm);c.scale.y=FH;c.position.set(SITE.x-20+i*SP,f*FH+FH/2,SITE.z-12+j*SP);add(c,{thr:80})}
  if(f<9){const s=new THREE.Mesh(slabG,cm);s.scale.set(NX*SP-4,.45,NZ*SP-4);s.position.set(SITE.x-20+(NX-1)*SP/2,(f+1)*FH,SITE.z-12+(NZ-1)*SP/2);add(s)}}
 // rebar starters
 const rb=new THREE.InstancedMesh(new THREE.BoxGeometry(.12,2.2,.12),M({color:0x6b4a32}),NX*NZ*4);const o=new THREE.Object3D();let k=0;
 for(let i=0;i<NX;i++)for(let j=0;j<NZ;j++)for(let q=0;q<4;q++){o.position.set(SITE.x-20+i*SP+(q%2-.5)*.6,9*FH+1.1+ (((i+j)%2)?0:2*FH),SITE.z-12+j*SP+((q>>1)-.5)*.6);o.updateMatrix();rb.setMatrixAt(k++,o.matrix)}scene.add(rb);
 // scaffolding frame
 const sc=new THREE.Mesh(new THREE.BoxGeometry(NX*SP+2,9*FH,NZ*SP+2),new THREE.MeshStandardMaterial({color:0xd8d2c4,wireframe:true,transparent:true,opacity:.35}));
 sc.position.set(SITE.x-20+(NX-1)*SP/2,9*FH/2,SITE.z-12+(NZ-1)*SP/2);/*no scaffold*/
 // material stacks
 for(let i=0;i<6;i++){const b=new THREE.Mesh(new THREE.BoxGeometry(6,1,2),M({color:i%2?0x7a5a3a:0x8f8f8f}));b.position.set(SITE.x+30,.5+i%3,SITE.z+30-i*3);add(b,{edges:false})}}
// tower crane
const crane=new THREE.Group();scene.add(crane);const jib=new THREE.Group();
{const ye=M({color:0xf0a81c,roughness:.6,metalness:.2});const H=72;crane.position.set(SITE.x+26,0,SITE.z-18);
 function lattice(len,w,axis){const g=new THREE.Group();const bar=new THREE.BoxGeometry(.35,.35,.35);
  const n=Math.round(len/w);for(let c=0;c<4;c++){const m=new THREE.Mesh(bar,ye);const ox=(c%2-.5)*w,oz=((c>>1)-.5)*w;
   if(axis==='y'){m.scale.set(1,len/.35,1);m.position.set(ox,len/2,oz)}else{m.scale.set(len/.35,1,1);m.position.set(len/2,ox,oz)}g.add(m)}
  for(let i=0;i<n;i++){const d=new THREE.Mesh(bar,ye);const L=Math.hypot(w,w);
   if(axis==='y'){d.scale.set(1,L/.35,1);d.position.set(0,i*w+w/2,(i%2-.5)*w);d.rotation.x=(i%2?1:-1)*Math.PI/4; const d2=d.clone();d2.position.set((i%2-.5)*w,i*w+w/2,0);d2.rotation.set(0,0,(i%2?1:-1)*Math.PI/4);g.add(d2)}
   else{d.scale.set(L/.35,1,1);d.position.set(i*w+w/2,0,(i%2-.5)*w);d.rotation.y=(i%2?1:-1)*Math.PI/4}g.add(d)}
  g.traverse(o=>{if(o.isMesh){o.castShadow=true}});return g}
 crane.add(lattice(H,2.4,'y'));
 jib.position.y=H;crane.add(jib);
 const j1=lattice(60,2.2,'x');j1.position.set(0,1.2,0);jib.add(j1);
 const j2=lattice(18,2.2,'x');j2.rotation.y=Math.PI;j2.position.set(0,1.2,0);jib.add(j2);
 const cw=new THREE.Mesh(new THREE.BoxGeometry(5,3,3.5),M({color:0x9a9a9a}));cw.position.set(-15,0,0);cw.castShadow=true;jib.add(cw);
 const cab=new THREE.Mesh(new THREE.BoxGeometry(3,3,3),ye);cab.position.set(2.5,-1,1.6);jib.add(cab);
 const top=new THREE.Mesh(new THREE.ConeGeometry(1.8,8,4),ye);top.position.y=6;jib.add(top);
 const cable=new THREE.Mesh(new THREE.BoxGeometry(.08,30,.08),M({color:0x222222}));cable.position.set(40,-15,0);jib.add(cable);
 const load=new THREE.Mesh(new THREE.BoxGeometry(5,1,1.2),M({color:0x6b4a32}));load.position.set(40,-30.5,0);load.castShadow=true;jib.add(load);
 const warn=new THREE.Mesh(new THREE.SphereGeometry(.5,8,8),new THREE.MeshBasicMaterial({color:0xff3b2f}));warn.position.set(60,1.8,0);jib.add(warn);
 const warn2=warn.clone();warn2.position.set(0,10,0);jib.add(warn2)}

// ---------- street lights ----------
{const pos=[];for(let x=-600;x<=600;x+=40){pos.push([x,0]);}
 const pole=new THREE.InstancedMesh(new THREE.CylinderGeometry(.18,.25,10,6).translate(0,5,0),M({color:0x777b80}),pos.length);
 const bulb=new THREE.InstancedMesh(new THREE.SphereGeometry(.6,8,6).translate(0,10,0),new THREE.MeshBasicMaterial({color:0xffd9a0}),pos.length);
 const o=new THREE.Object3D();pos.forEach((p,i)=>{o.position.set(p[0],0,p[1]);o.updateMatrix();pole.setMatrixAt(i,o.matrix);bulb.setMatrixAt(i,o.matrix)});scene.add(pole,bulb)}

// ---------- cars ----------
const carN=isMobile?60:140;
const bodyG=new THREE.BoxGeometry(4.4,1.5,2);bodyG.translate(0,1.05,0);
const cabG=new THREE.BoxGeometry(2.4,1,1.8);cabG.translate(-.3,2.2,0);
const headG=new THREE.BoxGeometry(.2,.35,1.7);headG.translate(2.25,1.1,0);
const tailG=new THREE.BoxGeometry(.2,.35,1.7);tailG.translate(-2.25,1.1,0);
const cars=new THREE.InstancedMesh(bodyG,M({roughness:.35,metalness:.6}),carN);
const cabs=new THREE.InstancedMesh(cabG,M({color:0x1a2230,roughness:.15,metalness:.8}),carN);
const heads=new THREE.InstancedMesh(headG,new THREE.MeshBasicMaterial({color:0xfff4d6}),carN);
const tails=new THREE.InstancedMesh(tailG,new THREE.MeshBasicMaterial({color:0xff2a1a}),carN);
cars.castShadow=true;scene.add(cars,cabs,heads,tails);
const palette=[0xe8e8e8,0x1c1c1c,0x8a96a3,0xb3202a,0x23436e,0xd9d2c3,0x3c3f44];
const carData=[];const lanePick=[];
roads.forEach((r,ri)=>{const lanes=r.ring?[0]:(r.lanes>2?[-r.w/4-1,r.w/4+1,0].slice(0,2):[r.w/4,-r.w/4]);lanes.forEach(off=>{const wgt=Math.ceil(r.L/60);for(let i=0;i<wgt;i++)lanePick.push([ri,off])})});
for(let i=0;i<carN;i++){const [ri,off]=lanePick[Math.floor(Math.random()*lanePick.length)];const r=roads[ri];
 carData.push({r,off,dir:(r.lanes>2||r.ring)?1:(off>0?1:-1),t:Math.random(),v:(r.ring?10:18+Math.random()*12)/r.L});cars.setColorAt(i,new THREE.Color(palette[i%palette.length]))}
const co=new THREE.Object3D(),side=new THREE.Vector3();
function updCars(dt){for(let i=0;i<carN;i++){const c=carData[i];c.t=(c.t+c.v*dt*c.dir+1)%1;const {p,tan,side:s}=frame(c.r.curve,c.t);
 co.position.copy(p).addScaledVector(s,c.r.lanes>2?c.off:-c.off*0+c.off);const d=tan.clone().multiplyScalar(c.dir);co.rotation.set(0,Math.atan2(-d.z,d.x),0);co.rotation.z=Math.asin(THREE.MathUtils.clamp(d.y,-1,1));co.updateMatrix();
 cars.setMatrixAt(i,co.matrix);cabs.setMatrixAt(i,co.matrix);heads.setMatrixAt(i,co.matrix);tails.setMatrixAt(i,co.matrix)}
 cars.instanceMatrix.needsUpdate=cabs.instanceMatrix.needsUpdate=heads.instanceMatrix.needsUpdate=tails.instanceMatrix.needsUpdate=true}
updCars(0);

// ---------- post ----------
let composer=null;
if(!isMobile){composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
 composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.55,.5,.88));composer.addPass(new OutputPass())}

// ---------- camera story ----------
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const shots={
 hero:{p:V(250,120,260),t:V(-10,0,0),orbit:1},
 pain:{p:V(-120,230,330),t:V(0,0,0)},
 services:{p:V(-310,70,230),t:V(-150,0,120)},
 roads:{p:V(70,22,95),t:V(0,8,0)},
 construction:{p:V(70,45,-10),t:V(160,25,-110)},
 supervision:{p:V(215,95,-40),t:V(150,20,-110)},
 management:{p:V(1,520,40),t:V(0,0,0)},
 why:{p:V(-260,120,-200),t:V(0,0,0)},
 process:{p:V(0,360,240),t:V(0,0,-10),bp:1},
 cta:{p:V(300,60,120),t:V(0,10,0)},
 contact:{p:V(-200,90,330),t:V(-60,0,60)}};
const anchors=[...document.querySelectorAll('[data-cam]')];
let cur={p:shots.hero.p.clone(),t:shots.hero.t.clone()},bp=1,bpTarget=0,intro=0;
const mouse={x:0,y:0,sx:0,sy:0};
addEventListener('pointermove',e=>{mouse.x=e.clientX/innerWidth-.5;mouse.y=e.clientY/innerHeight-.5});
function targetShot(time){const mid=scrollY+innerHeight*.5;let a=anchors[0],b=anchors[0],f=0;
 for(let i=0;i<anchors.length;i++){const el=anchors[i];const c=el.offsetTop+el.offsetHeight*.5;if(c<=mid){a=el;b=anchors[i+1]||el;const cb=b.offsetTop+b.offsetHeight*.5;f=cb>c?THREE.MathUtils.clamp((mid-c)/(cb-c),0,1):0}}
 if(mid<anchors[0].offsetTop+anchors[0].offsetHeight*.5){a=b=anchors[0];f=0}
 const sa=shotFor(a,time),sb=shotFor(b,time);const e=f*f*(3-2*f);
 return{p:sa.p.clone().lerp(sb.p,e),t:sa.t.clone().lerp(sb.t,e),bp:THREE.MathUtils.lerp(sa.bp||0,sb.bp||0,e)}}
function shotFor(el,time){const s=shots[el.dataset.cam];if(s.orbit){const a=time*.04;const r=Math.hypot(s.p.x,s.p.z);return{p:V(Math.cos(a+.8)*r,s.p.y,Math.sin(a+.8)*r),t:s.t}}return s}
window.__hram={setBP:v=>{bpTarget=v}};

function applyBP(v){const solid=1-v;
 for(const m of solids){m.transparent=v>.01;m.opacity=Math.max(solid,.02);m.depthWrite=v<.6}
 lineMat.opacity=v*.9;grid.material.opacity=v*.5;sky.material.uniforms.bp.value=v;
 scene.fog.color.copy(FOG).lerp(new THREE.Color(0x0a2240),v);
 const showSolid=v<.98;cars.visible=cabs.visible=heads.visible=tails.visible=showSolid;}

function setOffset(){if(innerWidth>1080)camera.setViewOffset(innerWidth,innerHeight,innerWidth*.2,0,innerWidth,innerHeight);else camera.clearViewOffset()}
// ---------- loop ----------
const clock=new THREE.Clock();const T0=performance.now();let running=true,last=0;
document.addEventListener('visibilitychange',()=>{running=!document.hidden;if(running){clock.getDelta();requestAnimationFrame(tick)}});
function render(){composer?composer.render():renderer.render(scene,camera)}
function tick(){if(!running)return;const dt=Math.min(clock.getDelta(),.05);const time=clock.elapsedTime;
 intro=Math.min(1,(performance.now()-T0)/3200);
 const ts=targetShot(time);const k=1-Math.pow(.0015,dt);cur.p.lerp(ts.p,k);cur.t.lerp(ts.t,k);
 mouse.sx+=(mouse.x-mouse.sx)*k;mouse.sy+=(mouse.y-mouse.sy)*k;
 setOffset();camera.position.copy(cur.p).add(V(-mouse.sx*30,mouse.sy*18,0));camera.lookAt(cur.t);
 const introBP=1-THREE.MathUtils.smoothstep(intro,.25,1);const want=Math.max(introBP,ts.bp,bpTarget);bp+=(want-bp)*Math.min(1,dt*4);applyBP(bp);
 jib.rotation.y=time*.12;updCars(dt);render();requestAnimationFrame(tick)}

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer&&composer.setSize(innerWidth,innerHeight)});

if(reduced){intro=1;bp=0;applyBP(0);const ts=targetShot(0);camera.position.copy(ts.p);camera.lookAt(ts.t);render();
 addEventListener('scroll',()=>{const ts=targetShot(0);camera.position.copy(ts.p);camera.lookAt(ts.t);applyBP(ts.bp);render()},{passive:true})}
else requestAnimationFrame(tick);
document.documentElement.classList.add('gl-ready');
