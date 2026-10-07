/* twin3d.js — Three.js 3D Digital Twin. Units: 1 unit = 100 mm. Ground y=-1, press table top y=0.1.
   Ram group is built at stroke=50 mm and shifted up by (stroke-50)/100 -> die, ram, rod, piston, sensor magnet all move together. */
const Twin3D = (() => {
  let R,S,C,O,box,ray,last=0,sel=null,cur=null,labels=[],pick=[],paths={},pipes={},spool={x:0,t:0},st={on:false,ext:true,spd:1};
  const V=(x,y,z)=>new THREE.Vector3(x,y,z);
  const M=(c,m=.35,r=.45,o={})=>new THREE.MeshStandardMaterial({color:c,metalness:m,roughness:r,...o});
  const mat={steel:M(0x9aa1ab),dark:M(0x3a3f47),blue:M(0x1f5fd0),orange:M(0xe08a1e,.1,.6),chrome:M(0xe3e8ee,.7,.2),grey:M(0x70757f),green:M(0x3b8f5a),
    glass:M(0x9bb4d8,.3,.4,{transparent:true,opacity:.35,depthWrite:false}),barrel:M(0x2a62d0,.3,.3,{transparent:true,opacity:.4,side:THREE.DoubleSide,depthWrite:false})};
  function add(g,m,x,y,z,p){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;(p||S).add(o);return o;}
  const bx=(w,h,d,m,x,y,z,p)=>add(new THREE.BoxGeometry(w,h,d),m,x,y,z,p);
  function cy(r,h,m,x,y,z,p,ax){const o=add(new THREE.CylinderGeometry(r,r,h,32),m,x,y,z,p);if(ax==='x')o.rotation.z=Math.PI/2;if(ax==='z')o.rotation.x=Math.PI/2;return o;}
  /* Pipe = cylinders per segment + sphere elbows + flange rings at both ends (physically connected 3D tube) */
  function pipe(pts,r,m,id){const g=new THREE.Group();S.add(g);
    for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],L=a.distanceTo(b),o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,L,16),m);
      o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(V(0,1,0),b.clone().sub(a).normalize());g.add(o);}
    pts.forEach((p,i)=>{const s=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),m);s.position.copy(p);g.add(s);
      if(i===0||i===pts.length-1){const q=pts[i?i-1:1],f=new THREE.Mesh(new THREE.CylinderGeometry(r*1.6,r*1.6,.1,20),mat.chrome);
        f.position.copy(p);f.quaternion.setFromUnitVectors(V(0,1,0),p.clone().sub(q).normalize());g.add(f);}});
    pipes[id]=m;return g;}
  /* Particle path: points travel along the real pipe polyline */
  function mkPath(id,pts,color){let cum=[0];for(let i=0;i<pts.length-1;i++)cum.push(cum[i]+pts[i].distanceTo(pts[i+1]));
    const len=cum[cum.length-1],n=Math.max(4,Math.round(len*3)),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));
    const p=new THREE.Points(g,new THREE.PointsMaterial({color,size:.2,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));p.frustumCulled=false;p.visible=false;S.add(p);
    paths[id]={pts,cum,len,n,u:0,p,sg:0};}
  function place(P){const a=P.p.geometry.attributes.position;for(let k=0;k<P.n;k++){const s=((((P.u+k/P.n)%1)+1)%1)*P.len;let i=0;while(i<P.cum.length-2&&P.cum[i+1]<s)i++;
      const f=(s-P.cum[i])/(P.cum[i+1]-P.cum[i]||1),A=P.pts[i],B=P.pts[i+1];a.setXYZ(k,A.x+(B.x-A.x)*f,A.y+(B.y-A.y)*f,A.z+(B.z-A.z)*f);}a.needsUpdate=true;}
  function label(t,x,y,z,sensor){const d=document.createElement('div');d.className='t3lbl';d.textContent=t;box.appendChild(d);labels.push({d,p:V(x,y,z)});}
  const sensor=(m,key)=>{m.userData.sensor=key;pick.push(m);};

  function build(){
    S.add(new THREE.HemisphereLight(0xcfe0ff,0x20242c,1.0));S.add(new THREE.AmbientLight(0xffffff,.35));
    const L=new THREE.DirectionalLight(0xffffff,1.2);L.position.set(10,20,14);L.castShadow=true;L.shadow.mapSize.set(2048,2048);
    Object.assign(L.shadow.camera,{left:-16,right:16,top:16,bottom:-16,near:1,far:60});S.add(L);
    const gr=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.ShadowMaterial({opacity:.4}));gr.rotation.x=-Math.PI/2;gr.position.y=-1.001;gr.receiveShadow=true;S.add(gr);
    const grid=new THREE.GridHelper(60,60,0x2a3445,0x1c2431);grid.position.y=-1;S.add(grid);
    // --- frame ---
    bx(6,.7,2.4,mat.grey,0,-.65,0);bx(3.2,.4,1.8,mat.steel,0,-.1,0);
    [-2.2,2.2].forEach(x=>{cy(.2,5.3,mat.chrome,x,2.35,0);cy(.3,.2,mat.dark,x,5.1,0);});
    bx(5.6,.6,1.8,mat.steel,0,5.3,0);cy(.9,.1,mat.dark,0,5.65,0);
    // --- lower die (fixed to bed): base plate + extruded block with trapezoidal V/U cavity + side clamps + bolts ---
    bx(3.2,.12,1.7,mat.dark,0,.16,0);
    const dp=new THREE.Shape();[[-1.2,0],[1.2,0],[1.2,.8],[.85,.8],[.4,.35],[-.4,.35],[-.85,.8],[-1.2,.8]].forEach((p,i)=>i?dp.lineTo(...p):dp.moveTo(...p));
    const dg=new THREE.ExtrudeGeometry(dp,{depth:1.3,bevelEnabled:false});dg.translate(0,0,-.65);add(dg,M(0x3b3f46,.5,.5),0,.22,0);   // cavity floor y=.57, top y=1.02
    [-1.38,1.38].forEach(x=>bx(.3,.75,1.5,M(0x2c3036,.5,.5),x,.595,0));
    [[-1.45,.24,-.62],[-1.45,.24,.62],[1.45,.24,-.62],[1.45,.24,.62],[-1.38,.98,-.5],[-1.38,.98,.5],[1.38,.98,-.5],[1.38,.98,.5]].forEach(p=>cy(.06,.05,M(0x111111),...p));
    // sheet workpiece: orange strip that lies across the cavity, then is formed into it by the punch (geometry rebuilt by sheetGeo)
    parts.wp=new THREE.Mesh(sheetGeo(0),M(0xf0a020,.1,.5,{emissive:0x000000}));parts.wp.castShadow=parts.wp.receiveShadow=true;S.add(parts.wp);parts.b=-1;
    // --- ram mount under crosshead (centre axis x=0,z=0) + blue ram column that follows the moving ram ---
    bx(3.4,.5,1.4,M(0x7d8590),0,4.75,0);bx(1.4,.5,1.5,M(0x9aa1ab),0,4.75,0);cy(.46,.08,mat.dark,0,4.46,0);
    [[-1.5,-.5],[-1.5,.5],[1.5,-.5],[1.5,.5]].forEach(p=>cy(.07,.05,M(0x111111),p[0],5.02+.0,p[1]));
    parts.sleeve=cy(.38,1,M(0x1f4fd8,.6,.25),0,4,0);
    // --- cylinder barrel (fixed, translucent so piston is visible) ---
    cy(.55,3.6,mat.barrel,0,7.4,0);cy(.62,.14,mat.dark,0,9.2,0);cy(.62,.14,mat.dark,0,5.65,0);
    [[8.95],[5.85]].forEach(([y])=>cy(.15,.3,mat.chrome,.6,y,0,null,'x'));
    // --- moving ram group (built at stroke 50) ---
    const G=parts.ram=new THREE.Group();S.add(G);
    const pg=new THREE.Shape();[[-.7,.45],[.7,.45],[.3,0],[-.3,0]].forEach((p,i)=>i?pg.lineTo(...p):pg.moveTo(...p));
    const pgg=new THREE.ExtrudeGeometry(pg,{depth:1.1,bevelEnabled:false});pgg.translate(0,0,-.55);add(pgg,M(0x5b6068,.5,.4),0,.66,0,G);   // wedge punch, tip at y=.66 (stroke 50)
    bx(2.6,.4,1.4,mat.grey,0,1.31,0,G);cy(.5,.2,mat.dark,0,1.61,0,G);cy(.25,4.69,mat.chrome,0,3.855,0,G);
    [[-1.1,-.5],[1.1,-.5],[-1.1,.5],[1.1,.5]].forEach(p=>cy(.07,.05,M(0x111111),p[0],1.53,p[1],G));cy(.52,.3,mat.chrome,0,6.2,0,G);
    const mag=add(new THREE.TorusGeometry(.14,.05,8,16),M(0x68d391,.2,.3,{emissive:0x1a6b3a}),-1.1,1.31,.8,G);mag.rotation.x=Math.PI/2;sensor(mag,'Position sensor');bx(.3,.1,.2,mat.dark,-1.2,1.31,.75,G);
    // position sensor rod (fixed on crosshead)
    cy(.04,4,mat.chrome,-1.1,3,.8);bx(.25,.25,.25,mat.dark,-1.1,4.9,.8);
    // --- reservoir, motor, pump, filter ---
    bx(3.4,1.8,2.2,mat.grey,7.2,-.1,0);bx(.25,1,.05,mat.glass,8.6,-.2,1.12);bx(.14,.6,.04,mat.orange,8.6,-.4,1.14);cy(.12,.3,mat.dark,8.2,.95,.8);
    cy(.55,1.5,mat.blue,7.85,1.35,0,null,'x');for(let i=0;i<6;i++)cy(.58,.05,mat.blue,7.25+i*.22,1.35,0,null,'x');
    bx(.5,.35,.5,mat.dark,7.85,2.0,0);cy(.5,.3,mat.dark,8.75,1.35,0,null,'x');bx(1.2,.1,1,mat.dark,7.85,.85,0);
    cy(.4,.7,mat.green,6.6,1.35,0,null,'x');cy(.45,.1,mat.chrome,6.22,1.35,0,null,'x');cy(.45,.1,mat.chrome,6.98,1.35,0,null,'x');bx(.9,.3,.9,mat.dark,6.6,.95,0);
    cy(.14,.3,mat.chrome,6.6,1.8,0);cy(.14,.3,mat.chrome,6.6,1.35,.5,null,'z');
    parts.cpl=cy(.12,.28,mat.chrome,7.04,1.35,0,null,'x');bx(.05,.14,.26,mat.dark,7.04,1.35,0);
    cy(.22,.8,mat.blue,5.9,1.2,.9);cy(.26,.1,mat.chrome,5.9,1.65,.9);
    // --- 4/3 DCV ---
    bx(1.6,.7,.7,mat.glass,4.4,4,0);const eg=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6,.7,.7)),new THREE.LineBasicMaterial({color:0xffffff}));eg.position.set(4.4,4,0);S.add(eg);
    cy(.12,1.5,mat.dark,4.4,4,0,null,'x');cy(.12,4.65,mat.dark,4.4,1.325,-.5);
    const sg=parts.spool=new THREE.Group();sg.position.set(4.4,4,0);S.add(sg);cy(.08,1.5,mat.chrome,0,0,0,sg,'x');[-.4,0,.4].forEach(x=>cy(.2,.26,mat.chrome,x,0,0,sg,'x'));
    parts.y1=bx(.4,.5,.5,M(0x1f5fd0),3.35,4,0);parts.y2=bx(.4,.5,.5,M(0x1f5fd0),5.45,4,0);
    parts.l1=add(new THREE.SphereGeometry(.07),M(0x333333,0,1,{emissive:0}),3.35,4.3,0);parts.l2=add(new THREE.SphereGeometry(.07),M(0x333333,0,1,{emissive:0}),5.45,4.3,0);
    [[3.9,4.35],[4.9,4.35],[3.9,3.65],[4.9,3.65]].forEach(([x,y])=>cy(.16,.14,mat.chrome,x,y,0));
    // --- pipes (same polylines drive the fluid particles) ---
    const pr=M(0x2a6fe8,.5,.3,{transparent:true,opacity:.5,depthWrite:false}),rt=M(0x39475f,.5,.3,{transparent:true,opacity:.55,depthWrite:false}),sc=M(0x9aa0a8,.4,.4,{transparent:true,opacity:.5,depthWrite:false});
    pipes.A=pr.clone();pipes.B=rt.clone();
    const sct=[V(6.6,.55,.8),V(6.6,1.35,.8),V(6.6,1.35,.5)],pP=[V(6.6,1.8,0),V(6.6,2.4,0),V(3.9,2.4,0),V(3.9,3.65,0)],
      lA=[V(4.9,4.35,0),V(4.9,8.95,0),V(.6,8.95,0)],lB=[V(3.9,4.35,0),V(3.9,5.85,0),V(.6,5.85,0)],ret=[V(4.9,3.65,0),V(4.9,3.2,0),V(4.9,3.2,.9),V(5.9,3.2,.9),V(5.9,1.7,.9)];
    pipe(sct,.13,sc,'s');pipe(pP,.09,pr,'p');pipe(lA,.09,pipes.A,'A');pipe(lB,.09,pipes.B,'B');pipe(ret,.09,rt,'r');
    const W=0x9ff4ff,Y=0xfff2b0;
    mkPath('sct',sct,W);mkPath('pP',pP,W);mkPath('pa',[V(3.9,3.65,0),V(3.9,3.9,0),V(4.9,3.9,0),V(4.9,4.35,0)],W);mkPath('pb',[V(3.9,3.65,0),V(3.9,4.35,0)],W);
    mkPath('A',lA,W);mkPath('B',lB,W);mkPath('bt',[V(3.9,4.35,0),V(3.9,4.1,0),V(4.9,4.1,0),V(4.9,3.65,0)],Y);mkPath('at',[V(4.9,4.35,0),V(4.9,3.65,0)],Y);mkPath('ret',ret,Y);
    // --- sensors ---
    const gc=document.createElement('canvas');gc.width=gc.height=128;const x=gc.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,128,128);x.strokeStyle='#000';x.lineWidth=2;
    for(let i=0;i<=10;i++){const a=(-135+i*27)*Math.PI/180;x.beginPath();x.moveTo(64+Math.sin(a)*50,64-Math.cos(a)*50);x.lineTo(64+Math.sin(a)*58,64-Math.cos(a)*58);x.stroke();}
    const gg=new THREE.Group();gg.position.set(5.2,2.85,0);S.add(gg);cy(.26,.1,mat.chrome,0,0,0,gg,'z');cy(.04,.45,mat.dark,0,-.35,0,gg);
    const face=new THREE.Mesh(new THREE.CircleGeometry(.23,32),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(gc)}));face.position.z=.055;gg.add(face);
    parts.needle=new THREE.Group();parts.needle.position.z=.07;gg.add(parts.needle);add(new THREE.BoxGeometry(.015,.2,.01),new THREE.MeshBasicMaterial({color:0xcc2222}),0,.1,0,parts.needle);sensor(face,'Pressure gauge');
    cy(.12,.4,M(0x1f5fd0),5.8,2.6,0);const ps=add(new THREE.SphereGeometry(.11),M(0xf6ad55,.2,.3,{emissive:0x6b3a00}),5.8,2.85,0);sensor(ps,'Pressure sensor');
    const fs=bx(.45,.4,.4,M(0x4fd1c5,.3,.4,{emissive:0x0b3b36}),4.4,2.4,0);sensor(fs,'Flow sensor');
    [['PUMP',6.6,2.05,0],['MOTOR',7.85,2.3,0],['RESERVOIR',7.2,1,1.1],['4/3 DCV',4.4,4.75,0],['CYLINDER',0,9.7,0],['PRESSURE SENSOR',5.8,3.05,0],['FLOW SENSOR',4.4,2.75,0],['RETURN FILTER',5.9,1.95,.9],
     ['P',3.9,3.4,0],['T',4.9,3.4,0],['A',5.15,4.6,0],['B',3.65,4.6,0],['POSITION SENSOR',-1.1,.9,.8]].forEach(a=>label(...a));
  }
  const parts={};
  /* Sheet strip lying across the V cavity; b=0 flat, b=1 fully formed into the cavity (extruded along z) */
  function sheetGeo(b){const xs=[-1.1,-.85,-.4,.4,.85,1.1],yf=x=>{const a=Math.abs(x),f=a>=.85?1.05:a<=.4?.6:.6+(a-.4);return 1.05+(f-1.05)*b;};
    const sh=new THREE.Shape();xs.forEach((x,i)=>i?sh.lineTo(x,yf(x)+.03):sh.moveTo(x,yf(x)+.03));xs.slice().reverse().forEach(x=>sh.lineTo(x,yf(x)-.03));
    const g=new THREE.ExtrudeGeometry(sh,{depth:1.1,bevelEnabled:false});g.translate(0,0,-.55);return g;}
  const bOf=sk=>Math.min(1,Math.max(0,(1.08-(.66+(sk-50)/100))/.43));        // forming depth from punch-tip height
  let cumB=[],cumN=0;
  function formedMax(t){if(typeof D==='undefined'||!D.length)return 0;                // plastic: sheet stays formed after punch retracts
    if(cumN!==D.length){let m=0;cumB=D.map(r=>(m=Math.max(m,bOf(r.stroke))));cumN=D.length;}
    let m=0;for(let i=0;i<D.length&&D[i].t<=t;i++)m=cumB[i];return m;}
  const VIEWS={FRONT:[3.3,3.6,26],BACK:[3.3,3.6,-26],LEFT:[-26,3.6,0],RIGHT:[32,3.6,0],TOP:[3.3,34,.01],BOTTOM:[3.3,-30,.01],ISOMETRIC:[17,11,21]};
  let goal=null;
  function view(n){goal=V(...(VIEWS[n]||VIEWS.ISOMETRIC));O.target.set(3.3,3.6,0);}
  function init(){
    box=document.getElementById('view3d');if(!window.THREE||!box){if(box)box.innerHTML='<p class="bad" style="padding:20px">Three.js could not be loaded (internet needed for CDN).</p>';return;}
    R=new THREE.WebGLRenderer({antialias:true});R.shadowMap.enabled=true;R.setPixelRatio(Math.min(2,devicePixelRatio));box.prepend(R.domElement);
    S=new THREE.Scene();S.background=new THREE.Color(0x0f151d);C=new THREE.PerspectiveCamera(40,1,.1,200);C.position.set(...VIEWS.ISOMETRIC);
    O=new THREE.OrbitControls(C,R.domElement);O.target.set(3.3,3.6,0);O.enableDamping=true;   // left=rotate, wheel=zoom, right=pan
    ray=new THREE.Raycaster();build();
    document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
    let dn;R.domElement.onpointerdown=e=>dn=[e.clientX,e.clientY];
    R.domElement.onpointerup=e=>{if(!dn||Math.hypot(e.clientX-dn[0],e.clientY-dn[1])>4)return;const r=R.domElement.getBoundingClientRect();
      ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},C);const h=ray.intersectObjects(pick)[0];sel=h?h.object.userData.sensor:null;info();};
    new ResizeObserver(resize).observe(box);resize();requestAnimationFrame(loop);
  }
  function resize(){if(!R)return;const w=box.clientWidth,h=box.clientHeight;if(w&&h){R.setSize(w,h,false);C.aspect=w/h;C.updateProjectionMatrix();}}
  function info(){const e=document.getElementById('sInfo');if(!sel||!cur){e.hidden=true;return;}const d=cur;
    const m={'Pressure sensor':[d.pbar.toFixed(1),'bar'],'Pressure gauge':[d.pbar.toFixed(1),'bar'],'Flow sensor':[d.qlpm.toFixed(1),'L/min'],'Position sensor':[d.stroke.toFixed(1),'mm']}[sel];
    e.hidden=false;e.innerHTML=`<b>${sel}</b><br>${m[0]} ${m[1]}`;}
  /* Called by app.js with the interpolated CSV sample (d.dir: +1 extend / -1 retract, d.flowOn, d.dcv) */
  function update(d){
    cur=d;if(!R)return;
    const sk=Math.min(300,Math.max(48,d.stroke)),up=(sk-50)/100;parts.ram.position.y=up;
    // blue ram column spans from the fixed mount (y=4.46) down to the collar on the moving ram plate
    const bot=1.71+up,h=Math.max(.02,4.46-bot);parts.sleeve.scale.y=h;parts.sleeve.position.y=4.46-h/2;parts.sleeve.geometry.parameters;
    const b=Math.max(bOf(sk),formedMax(d.t));if(Math.abs(b-parts.b)>.004){parts.wp.geometry.dispose();parts.wp.geometry=sheetGeo(b);parts.b=b;}
    const g=Math.min(1,d.pbar/((typeof gaugeMax!=='undefined'&&gaugeMax.pbar)||350));parts.wp.material.emissive.setRGB(g*.7,g*.25,0);   // glow ~ pressing force
    parts.needle.rotation.z=-(-135+Math.min(1,d.pbar/((typeof gaugeMax!=='undefined'&&gaugeMax.pbar)||350))*270)*Math.PI/180;
    st.on=d.flowOn;st.ext=d.dir>0;st.spd=1.5*(.3+.7*Math.sqrt(Math.min(1,Math.abs(d.qlpm)/((typeof gaugeMax!=='undefined'&&gaugeMax.qlpm/1.1)||100))));
    spool.t=!d.flowOn?0:(st.ext?.3:-.3);
    parts.l1.material.emissive.setHex(spool.t>0?0x00ff55:0);parts.l2.material.emissive.setHex(spool.t<0?0x00ff55:0);
    pipes.A.color.setHex(d.flowOn?(st.ext?0x2a6fe8:0x39475f):0x39475f);pipes.B.color.setHex(d.flowOn?(st.ext?0x39475f:0x2a6fe8):0x39475f);
    const e=st.ext,s={sct:1,pP:1,pa:e?1:0,pb:e?0:1,A:e?1:-1,B:e?-1:1,bt:e?1:0,at:e?0:1,ret:1};
    for(const k in paths){paths[k].sg=d.flowOn?s[k]:0;paths[k].p.visible=!!paths[k].sg;}
    document.getElementById('tDcv').textContent='4/3 DCV: '+d.dcv;
    if(sel)info();
  }
  function loop(now){requestAnimationFrame(loop);const dt=Math.min(.05,(now-last)/1000);last=now;if(!R||!box.clientWidth)return;
    const run=typeof T!=='undefined'&&T.playing;
    for(const k in paths){const P=paths[k];if(P.sg&&run){P.u+=P.sg*st.spd*dt/P.len*1.2;}if(P.sg)place(P);}
    spool.x+=(spool.t-spool.x)*Math.min(1,dt*10);parts.spool.position.x=4.4+spool.x;
    if(run&&st.on)parts.cpl.rotation.x+=dt*12;
    if(goal){C.position.lerp(goal,.12);if(C.position.distanceTo(goal)<.05)goal=null;}
    O.update();R.render(S,C);
    const w=box.clientWidth,h=box.clientHeight;labels.forEach(l=>{const p=l.p.clone().project(C);const v=p.z<1;l.d.style.display=v?'block':'none';l.d.style.left=(p.x+1)/2*w+'px';l.d.style.top=(1-p.y)/2*h+'px';});
  }
  return {init,update,resize,view};
})();
