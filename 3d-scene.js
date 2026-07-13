import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/libs/meshopt_decoder.module.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';

const wrap = document.getElementById('canvasWrap');
const canvas = document.getElementById('world3d');
const getState = () => window.getSkyportRenderState?.();

if (!wrap || !canvas) throw new Error('3D world mount is missing');
const syncDebugLayer = () => wrap.classList.toggle('debug-3d-only',
  new URLSearchParams(location.search).has('debug3d') || location.hash === '#debug3d');
syncDebugLayer();
window.addEventListener('hashchange', syncDebugLayer);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
// 래스터 바닥에는 이미 접지 그림자가 베이크되어 있어, 동적 액터(항공기·차량)에 한해서만
// 그림자를 드리움. 저사양/모바일 GPU에서는 포스트프로세싱 렌더타깃과 합쳐 텍스처 메모리
// 압박(컨텍스트 로스 유발)이 커지므로 데스크톱에서만 활성화함.
const isMobileGpu = wrap.clientWidth < 760;
renderer.shadowMap.enabled = !isMobileGpu;
// r171+ 에서 PCFSoftShadowMap이 PCFShadowMap에 통합되어 소프트 필터링이 기본 적용됨.
renderer.shadowMap.type = THREE.PCFShadowMap;

// WebGL 컨텍스트 로스(저사양 GPU 메모리 압박·탭 백그라운드 복귀 등)에 대한 방어 코드.
// 처리하지 않으면 캔버스가 검게 비거나 깜빡이고, 3D가 담당하는 승객·승무원 등 동적
// 오브젝트가 영영 다시 그려지지 않는 상태로 멈춤.
let contextLost = false;
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  console.warn('[3D] WebGL 컨텍스트 손실 — 복구 대기 중');
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  console.warn('[3D] WebGL 컨텍스트 복구됨 — 씬 재구성');
  location.reload();
}, false);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x183041, 0.00042);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
const worldRoot = new THREE.Group();
worldRoot.name = 'Runtime_World';
scene.add(worldRoot);

const environmentRoot = new THREE.Group();
const staticPropsRoot = new THREE.Group();
const dynamicRoot = new THREE.Group();
worldRoot.add(environmentRoot, staticPropsRoot, dynamicRoot);

const hemi = new THREE.HemisphereLight(0xb9d8ef, 0x15281e, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe3ba, 2.2);
sun.position.set(-500, 900, 650);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -850;
sun.shadow.camera.right = 850;
sun.shadow.camera.top = 850;
sun.shadow.camera.bottom = -850;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 2600;
sun.shadow.bias = -0.00018;
scene.add(sun);
const ambient = new THREE.AmbientLight(0x7da0bc, 0.52);
scene.add(ambient);
// 그림자 반대쪽을 완전한 암부로 두지 않는 저강도 필 라이트 + 실루엣을 살려주는 림 라이트.
const fill = new THREE.DirectionalLight(0x4d6f95, 0.42);
fill.position.set(560, 420, -480);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xbfe0ff, 0.5);
rim.position.set(300, 260, -900);
scene.add(rim);
// 터미널 유리창 앞 웜톤 바운스광 — 참고 이미지의 야간 실내 온기 재현.
const glassBounce = new THREE.PointLight(0xffb35c, 60, 260, 1.8);
glassBounce.position.set(730, 30, 296);
scene.add(glassBounce);

// 절차적 황혼 하늘 그라디언트를 PMREM으로 구워 유리·금속·기체 표면에 반사를 부여함
// (핸드페인트 큐브맵/HDRI 없이 코드만으로 IBL 반사 재현).
function buildSkyEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color(0x0c1a2c) },
      uHorizon: { value: new THREE.Color(0x3f5c7a) },
      uGlow: { value: new THREE.Color(0xffb066) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 uTop, uHorizon, uGlow;
      void main(){
        float h = normalize(vPos).y;
        vec3 col = mix(uHorizon, uTop, smoothstep(-0.05, 0.55, h));
        float glow = smoothstep(0.4, -0.1, abs(h));
        col += uGlow * glow * 0.3;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyGeometry = new THREE.SphereGeometry(50, 24, 16);
  skyScene.add(new THREE.Mesh(skyGeometry, skyMat));
  const target = pmrem.fromScene(skyScene, 0.035);
  scene.environment = target.texture;
  skyGeometry.dispose();
  skyMat.dispose();
  pmrem.dispose();
}
buildSkyEnvironment();
const terminalLights = [
  [250, 650], [520, 650], [800, 650], [1080, 650],
  [300, 470], [670, 470], [1040, 470],
  [300, 335], [660, 335], [1020, 335],
].map(([x, z], index) => {
  const light = new THREE.PointLight(index < 4 ? 0xffc27b : 0xb5dcff, 145, 300, 1.65);
  light.position.set(x, 58, z);
  scene.add(light);
  return light;
});

// 참고 이미지 4번 같은 미니어처/디오라마 느낌을 위한 저비용 틸트시프트.
// 완전한 가우시안 대신 초점대에서 거리에 따라 커지는 단일 패스 8탭 블러로 근사함.
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.52 },
    uFocusRange: { value: 0.22 },
    uMaxBlur: { value: 3.2 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uFocus;
    uniform float uFocusRange;
    uniform float uMaxBlur;
    varying vec2 vUv;
    void main(){
      float dist = abs(vUv.y - uFocus);
      float blurAmt = clamp((dist - uFocusRange) / max(0.001, 0.62 - uFocusRange), 0.0, 1.0);
      blurAmt *= blurAmt;
      if (blurAmt < 0.015) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 px = (uMaxBlur * blurAmt) / uResolution;
      vec4 c = texture2D(tDiffuse, vUv) * 0.28;
      c += texture2D(tDiffuse, vUv + vec2(px.x, 0.0)) * 0.11;
      c += texture2D(tDiffuse, vUv - vec2(px.x, 0.0)) * 0.11;
      c += texture2D(tDiffuse, vUv + vec2(0.0, px.y)) * 0.11;
      c += texture2D(tDiffuse, vUv - vec2(0.0, px.y)) * 0.11;
      c += texture2D(tDiffuse, vUv + vec2(px.x, px.y)) * 0.07;
      c += texture2D(tDiffuse, vUv + vec2(-px.x, px.y)) * 0.07;
      c += texture2D(tDiffuse, vUv + vec2(px.x, -px.y)) * 0.07;
      c += texture2D(tDiffuse, vUv + vec2(-px.x, -px.y)) * 0.07;
      gl_FragColor = c;
    }
  `,
};

// 아주 옅은 필름 그레인으로 절차적 원시형 표면의 완전 평면적인 색상 블록감을 깨줌.
const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAmount: { value: 0.028 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAmount;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453 + uTime*13.7); }
    void main(){
      vec4 color = texture2D(tDiffuse, vUv);
      float n = (hash(vUv*vec2(900.0,640.0)) - 0.5) * uAmount;
      color.rgb += n;
      gl_FragColor = color;
    }
  `,
};

renderer.info.autoReset = false;
let composer = null, bloomPass = null, tiltShiftPass = null, grainPass = null, composerMobile = null;
function buildComposer(mobile) {
  if (composer) {
    for (const pass of composer.passes) pass.dispose?.();
    composer.dispose();
  }
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), mobile ? 0.4 : 0.58, 0.55, mobile ? 0.86 : 0.8);
  composer.addPass(bloomPass);
  if (mobile) {
    tiltShiftPass = null;
    grainPass = null;
  } else {
    tiltShiftPass = new ShaderPass(TiltShiftShader);
    composer.addPass(tiltShiftPass);
    grainPass = new ShaderPass(FilmGrainShader);
    composer.addPass(grainPass);
  }
  composer.addPass(new OutputPass());
  composerMobile = mobile;
}
buildComposer(wrap.clientWidth < 760);

// 터미널 유리 앞 은은한 웜톤 광선 — 참고 이미지 1번의 야간 실내 온기가 에이프런으로
// 새어나오는 분위기를 additive 블렌딩 스프라이트로 저비용 재현.
function buildLightShafts() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx2d = canvas.getContext('2d');
  const grad = ctx2d.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,200,140,.55)');
  grad.addColorStop(.5, 'rgba(255,170,90,.18)');
  grad.addColorStop(1, 'rgba(255,170,90,0)');
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const group = new THREE.Group();
  group.name = 'Terminal_Light_Shafts';
  for (const [x, z] of [[250,300],[430,300],[600,300],[790,300],[970,300],[1150,300]]) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, color: 0xffb066, transparent: true, opacity: .5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.position.set(x, 14, z);
    sprite.scale.set(70, 40, 1);
    group.add(sprite);
  }
  scene.add(group);
  return group;
}
const lightShafts = buildLightShafts();

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const loadGLB = (url) => new Promise((resolve, reject) => loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject));
function image(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// 표면이 완전히 균일해 보이지 않도록 러프니스에 미세한 알갱이감을 주는 절차적 노이즈 텍스처.
function roughnessNoiseTexture(base, variance, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  const img = ctx2d.createImageData(size, size);
  for (let i = 0; i < size*size; i += 1) {
    const v = Math.max(0, Math.min(255, Math.round((base + (Math.random()-.5)*variance) * 255)));
    img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
  }
  ctx2d.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

async function materialTiles() {
  const atlas = await image('./assets/airport-material-atlas.png');
  const sw = Math.floor(atlas.naturalWidth / 2);
  const sh = Math.floor(atlas.naturalHeight / 2);
  const defs = { grass:[0,0,10,7], asphalt:[1,0,8,2], concrete:[0,1,9,7], metal:[1,1,6,2] };
  const roughDefs = { grass:[.82,.16], asphalt:[.68,.28], concrete:[.7,.22], metal:[.42,.3] };
  const result = {};
  for (const [key, [cx, cy, rx, ry]] of Object.entries(defs)) {
    const tile = document.createElement('canvas');
    tile.width = 512; tile.height = 512;
    tile.getContext('2d').drawImage(atlas, cx*sw, cy*sh, sw, sh, 0, 0, 512, 512);
    const texture = new THREE.CanvasTexture(tile);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(rx, ry);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    result[key] = texture;
    const [rBase, rVar] = roughDefs[key];
    const roughMap = roughnessNoiseTexture(rBase, rVar);
    roughMap.repeat.set(rx*3, ry*3);
    result[`${key}Rough`] = roughMap;
  }
  return result;
}

function runtimeMeshSetup(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = false;
    node.receiveShadow = true;
    if (node.name.startsWith('COL_')) node.visible = false;
  });
}

function applyEnvironmentTextures(root, tiles) {
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const name = node.material.name;
    if (name === 'M_Grass') { node.material.map = tiles.grass; node.material.roughnessMap = tiles.grassRough; node.material.color.set(0xb8c9b4); }
    else if (name === 'M_Asphalt' || name === 'M_Taxiway') { node.material.map = tiles.asphalt; node.material.roughnessMap = tiles.asphaltRough; node.material.color.set(0xb8c0c8); }
    else if (name === 'M_Concrete' || name === 'M_Concrete_Dark') { node.material.map = tiles.concrete; node.material.roughnessMap = tiles.concreteRough; node.material.color.set(name.endsWith('Dark')?0x9aa5ae:0xe2e5e7); }
    else if (name === 'M_Metal' || name === 'M_Metal_Dark') { node.material.map = tiles.metal; node.material.roughnessMap = tiles.metalRough; node.material.color.set(name.endsWith('Dark')?0x8393a0:0xc8d1d8); }
    if (node.material.map) node.material.needsUpdate = true;
  });
}

const [environmentLibrary, aircraftLibrary, vehicleLibrary, propLibrary, tiles] = await Promise.all([
  loadGLB('./assets/3d/airport-environment.glb'),
  loadGLB('./assets/3d/aircraft-fleet.glb'),
  loadGLB('./assets/3d/ground-vehicles.glb'),
  loadGLB('./assets/3d/terminal-props.glb'),
  materialTiles(),
]);

applyEnvironmentTextures(environmentLibrary, tiles);
runtimeMeshSetup(environmentLibrary);
const rasterBackedMeshes = new Set([
  'Terrain_LOD0', 'Runway_09_27', 'Taxiway_Main', 'Apron', 'Terminal_Floor',
  'Perimeter_Road', 'Entrance_Road', 'Runway_Centerline', 'Threshold_09', 'Threshold_27',
  'Terminal_East_Operations', 'Control_Tower',
]);
environmentLibrary.traverse((node) => {
  if (rasterBackedMeshes.has(node.name) || node.name.startsWith('Taxi_Connector_') ||
      node.name.startsWith('Runway_Center_') || node.name.startsWith('Threshold_')) node.visible = false;
});
// 터미널 외피는 2D 단면을 유지하되, 게이트별 탑승교는 분리해 실제 3D 실루엣으로 렌더링함.
const terminalShell = environmentLibrary.getObjectByName('Terminal_Shell');
if (terminalShell) {
  for (const child of [...terminalShell.children]) {
    if (!child.name.startsWith('JetBridge_')) continue;
    terminalShell.remove(child);
    environmentLibrary.add(child);
  }
  terminalShell.visible = false;
}
environmentRoot.add(environmentLibrary);

function libraryClone(library, name, accent = null) {
  const source = library.getObjectByName(name);
  if (!source) return null;
  const clone = source.clone(true);
  clone.visible = true;
  clone.traverse((node) => {
    if (node.name.startsWith('COL_') || node.name.endsWith('_LOD1')) node.visible = false;
    if (!node.isMesh) return;
    node.castShadow = false;
    node.receiveShadow = true;
    if (accent && (/Accent$/.test(node.material?.name || '') || node.material?.vertexColors)) {
      node.material = node.material.clone();
      node.material.userData.runtimeClone = true;
      node.material.color.set(accent);
    }
  });
  return clone;
}

function disposeRuntimeMaterials(model) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) if (material?.userData.runtimeClone) material.dispose();
  });
}

function addStaticModel(name, x, z, scale = 1, rotation = 0, accent = null) {
  const model = libraryClone(propLibrary, name, accent);
  if (!model) return;
  model.position.set(x, .05, z);
  model.rotation.y = rotation;
  // 프롭 라이브러리는 GLB 패키징을 위해 컴팩트한 단위로 저장됨.
  // 월드 좌표계에서는 항공기·터미널과 같은 가독성 비율로 확장해 렌더링함.
  model.scale.setScalar(scale * 8.4);
  staticPropsRoot.add(model);
}
let propsSignature = '';
function rebuildStaticProps(state) {
  const signature = [
    state.S.up.counters,
    state.S.up.security,
    state.S.up.gates,
    state.S.up.checkinTech,
    state.S.up.securityTech,
    state.S.up.baggage,
    state.S.up.tower,
    state.S.decor.length,
    state.S.decor.map((item) => `${item.t}:${item.x}:${item.y}`).join('|'),
    state.planes.filter((plane) => plane.gate).map((plane) => `${plane.gate.idx}:${plane.state}`).join('|'),
  ].join(':');
  if (signature === propsSignature) return;
  propsSignature = signature;
  for (const model of staticPropsRoot.children) disposeRuntimeMaterials(model);
  staticPropsRoot.clear();
  const checkXs = [230,325,420,515,610,705];
  for (let i=0; i<state.S.up.counters; i+=1) {
    addStaticModel('Prop_Checkin_Counter', checkXs[i], 618, .72, 0);
    addStaticModel('Prop_Checkin_Kiosk', checkXs[i]+34, 600, .5, 0);
    for(let q=0;q<2;q+=1) addStaticModel('Prop_Queue_Rail', checkXs[i], 654+q*24, .58, Math.PI/2);
  }
  const secXs = [560,700,840,980,1120];
  for (let i=0; i<state.S.up.security; i+=1) {
    addStaticModel('Prop_Security_Gate', secXs[i], 470, .72, 0);
    for(let q=0;q<2;q+=1) addStaticModel('Prop_Queue_Rail', secXs[i], 510+q*26, .56, Math.PI/2);
  }
  const gateXs = [300,480,660,840,1020,1200];
  for (let i=0; i<state.S.up.gates; i+=1) {
    for (let row=0; row<4; row+=1) addStaticModel('Prop_Bench', gateXs[i], 320+row*19, .62, 0);
    addStaticModel('Prop_Gate_Podium', gateXs[i]-48, 350, .58, 0);
    addStaticModel('Prop_Apron_Service_Set', gateXs[i], 250, .68, 0);
  }
  addStaticModel('Prop_Departure_Board', 790, 576, .76, 0);
  for(const [x,z] of [[190,520],[430,545],[760,548],[1090,548],[1180,690],[340,720]]) addStaticModel('Prop_Palm',x,z,.68,0);
  const decorMap = {
    cafe:'Prop_Cafe', snack:'Prop_Snack', duty:'Prop_Duty', kids:'Prop_Kids',
    bench:'Prop_Bench', plant:'Prop_Plant', info:'Prop_Info', art:'Prop_Art',
  };
  for (const item of state.S.decor) {
    const scale=item.t==='duty'?1.16:['cafe','snack'].includes(item.t)?1.04:.78;
    addStaticModel(decorMap[item.t] || 'Prop_Art', item.x, item.y, scale, 0);
  }
  for(let i=0;i<state.S.up.checkinTech*2;i+=1) addStaticModel('Prop_Info',760+(i%4)*36,610+Math.floor(i/4)*22,.35,0);
  for(let i=0;i<state.S.up.securityTech;i+=1) addStaticModel('Prop_Security_Gate',secXs[Math.min(secXs.length-1,i+2)],438,.36,0);
  for(let i=0;i<state.S.up.baggage;i+=1) addStaticModel('Prop_Luggage_Cart',772+i*55,859,.44,0);

  // 참조 이미지처럼 체크인·보안·게이트에 항상 읽히는 승객 밀도 부여.
  const travelerColors=[0x5d8fdb,0xe26f62,0x4fa477,0xe0b84d,0x9d71d0,0x55b8b7,0xd9885f,0x6fa8dc,0xc75c9a,0x8fae4e];
  let crowdIndex=0;
  const addCrowd=(x,z,rotation=0)=>{
    const jx=(crowdIndex%3-1)*1.6, jz=(Math.floor(crowdIndex/3)%3-1)*1.4;
    addStaticModel('Person_Traveler',x+jx,z+jz,.7+((crowdIndex%5)*.03),rotation,travelerColors[crowdIndex%travelerColors.length]);
    crowdIndex+=1;
  };
  for(let lane=0;lane<state.S.up.counters;lane+=1) for(let row=0;row<5;row+=1)
    addCrowd(checkXs[lane]+(row%2?7:-7),670+row*13,Math.PI);
  for(let lane=0;lane<state.S.up.security;lane+=1) for(let row=0;row<4;row+=1)
    addCrowd(secXs[lane]+(row%2?5:-5),521+row*12,Math.PI);
  for(let gate=0;gate<state.S.up.gates;gate+=1) for(let row=0;row<3;row+=1)
    addCrowd(gateXs[gate]-46+row*20,365,0);
}

function syncObjects(items, records, create, update) {
  const alive = new Set(items);
  for (const [ref, record] of records) {
    if (alive.has(ref)) continue;
    disposeRuntimeMaterials(record.model);
    record.model.removeFromParent();
    records.delete(ref);
  }
  for (const item of items) {
    let record = records.get(item);
    if (!record) {
      const model = create(item);
      if (!model) continue;
      dynamicRoot.add(model);
      record = { model, lastX:item.x, lastY:item.y };
      records.set(item, record);
    }
    update(item, record);
  }
}

const planeRecords = new Map();
const vehicleRecords = new Map();
const cartRecords = new Map();
const personRecords = new Map();

function setDynamicShadow(model, enabled = true) {
  model.traverse((node) => {
    if (!node.isMesh || node.name.startsWith('COL_')) return;
    node.castShadow = enabled && !node.material?.transparent;
  });
}

function planeVariant(plane) {
  const short = plane.type?.short;
  return short === 'RJ' ? 'Aircraft_Regional' : short === 'WB' ? 'Aircraft_Widebody' : 'Aircraft_Narrowbody';
}

function syncPlanes(state) {
  syncObjects(state.planes, planeRecords,
    (plane) => {
      const model=libraryClone(aircraftLibrary, planeVariant(plane), plane.color);
      if(model) setDynamicShadow(model);
      return model;
    },
    (plane, record) => {
      record.model.position.set(plane.x, Math.max(0, plane.alt*62), plane.y);
      record.model.rotation.y = -plane.hdg;
      record.model.scale.setScalar(1.22);
      record.model.visible = true;
      const variant=planeVariant(plane);
      const lod0=record.model.getObjectByName(`${variant}_LOD0`);
      const lod1=record.model.getObjectByName(`${variant}_LOD1`);
      const useLow=state.cam.k<.82 || wrap.clientWidth<620;
      if(lod0) lod0.visible=!useLow;
      if(lod1) lod1.visible=useLow;
    });
}

function vehicleVariant(type) {
  return type === 'fuel' ? 'Vehicle_Fuel' : type === 'cater' ? 'Vehicle_Catering' : 'Vehicle_Tug';
}

function movingHeading(item, record) {
  let heading = record.heading || 0;
  const dx = item.x-record.lastX, dz = item.y-record.lastY;
  if (Math.abs(dx)+Math.abs(dz) > .05) heading = Math.atan2(dz, dx);
  record.lastX=item.x; record.lastY=item.y; record.heading=heading;
  return heading;
}

function syncVehicles(state) {
  syncObjects(state.vehicles, vehicleRecords,
    (item) => {
      const model=libraryClone(vehicleLibrary, vehicleVariant(item.type));
      if(model) setDynamicShadow(model);
      return model;
    },
    (item, record) => {
      record.model.position.set(item.x, .05, item.y);
      record.model.rotation.y = -(item.state==='attach' && item.plane ? item.plane.hdg : movingHeading(item, record));
    });
  syncObjects(state.carts, cartRecords,
    () => libraryClone(vehicleLibrary, 'Vehicle_BaggageCart'),
    (item, record) => {
      record.model.position.set(item.x, .05, item.y);
      record.model.rotation.y = -movingHeading(item, record);
      record.model.scale.setScalar(.78);
    });
}

function personVariant(item) {
  if (item.role === 'ground') return 'Person_Ground';
  if (item.role === 'crew' || item.role === 'pilot') return 'Person_Crew';
  if (item.role) return 'Person_Staff';
  return 'Person_Traveler';
}

function syncPeople(state, time) {
  const maxPeople = wrap.clientWidth < 760 ? 34 : 76;
  const people = [...(state.lobbyPeople || []), ...state.pax, ...state.walkers, ...state.staff]
    .filter((item) => item.delay == null || item.delay <= 0).slice(0,maxPeople);
  syncObjects(people, personRecords,
    (item) => libraryClone(propLibrary, personVariant(item), item.color),
    (item, record) => {
      const heading = movingHeading(item, record);
      record.model.position.set(item.x, item._moved ? .04+Math.sin(time*8+item.x)*.025 : .04, item.y);
      record.model.rotation.y = -heading + Math.PI/2;
      record.model.scale.setScalar(item.visualScale || 6.2);
    });
}

const rainCount = 720;
const rainPositions = new Float32Array(rainCount*3);
for (let i=0;i<rainCount;i+=1) {
  rainPositions[i*3]=Math.random()*1450-50;
  rainPositions[i*3+1]=Math.random()*400+30;
  rainPositions[i*3+2]=Math.random()*950-20;
}
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rainMaterial = new THREE.PointsMaterial({color:0x9ecbff,size:1.4,transparent:true,opacity:.55,depthWrite:false});
const rain = new THREE.Points(rainGeometry,rainMaterial);
rain.visible=false;
scene.add(rain);

function updateWeather(state, dt) {
  const type = state.weather.cur;
  const rainy = type==='rain' || type==='storm';
  rain.visible = rainy;
  if (rainy) {
    const pos=rain.geometry.attributes.position.array;
    for(let i=0;i<rainCount;i+=1){
      pos[i*3+1]-=dt*(type==='storm'?260:170);
      pos[i*3]+=dt*(type==='storm'?34:18);
      if(pos[i*3+1]<2) {
        pos[i*3]=Math.random()*1450-50;
        pos[i*3+1]=Math.random()*260+240;
        pos[i*3+2]=Math.random()*950-20;
      }
    }
    rain.geometry.attributes.position.needsUpdate=true;
  }
  scene.fog.density = type==='fog' ? .0021 : type==='storm' ? .00105 : type==='rain' ? .00072 : .00042;
  scene.fog.color.set(type==='fog'?0x9aaab5:type==='storm'?0x111d2c:0x183041);
}

const runwayMaterials=new Set();
environmentRoot.traverse((node)=>{
  if(node.isMesh && ['M_Runway_Light','M_Taxi_Light','M_Amber_Light','M_Warm_Glass'].includes(node.material?.name)) runwayMaterials.add(node.material);
});

function updateLighting(state) {
  const hour=(state.S.dayMin/60)%24;
  const daylight=Math.max(0,Math.sin((hour-5.5)/14*Math.PI));
  const night=1-daylight;
  sun.intensity=.24+daylight*2.45;
  hemi.intensity=.38+daylight*1.25;
  ambient.intensity=.28+daylight*.48;
  sun.color.set(daylight>.3?0xffe2bb:0x87a9d5);
  renderer.toneMappingExposure=.88+daylight*.36;
  for (const light of terminalLights) light.intensity = 92 + night * 115;
  for(const mat of runwayMaterials){
    if(mat.name==='M_Warm_Glass') mat.emissiveIntensity=.55+night*1.6;
    else mat.emissiveIntensity=1.15+night*4.2;
  }
  const shaftStrength=THREE.MathUtils.clamp((night-.15)/.5,0,1);
  lightShafts.visible=shaftStrength>0.02;
  for(const sprite of lightShafts.children) sprite.material.opacity=.5*shaftStrength;
}

function updateCamera(state) {
  const width=Math.max(1,wrap.clientWidth), height=Math.max(1,wrap.clientHeight);
  const aspect=width/height;
  const zoom=Math.max(.75,state.cam.k/1.1);
  const viewHeight=900/zoom;
  camera.left=-viewHeight*aspect/2;
  camera.right=viewHeight*aspect/2;
  camera.top=viewHeight/2;
  camera.bottom=-viewHeight/2;
  const panScreenX=(state.cam.tx+36)/Math.max(.1,state.cam.k);
  const panScreenY=(state.cam.ty+18)/Math.max(.1,state.cam.k);
  const offsetX=.5*(panScreenX/.83+panScreenY/.415);
  const offsetZ=.5*(panScreenY/.415-panScreenX/.83);
  const target=new THREE.Vector3(640-offsetX,0,430-offsetZ);
  camera.position.set(target.x+1020,target.y+1160,target.z+1020);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

let lastWidth=0,lastHeight=0,lastTime=performance.now(),lastPaint=0;
function resize() {
  const width=Math.max(1,wrap.clientWidth),height=Math.max(1,wrap.clientHeight);
  if(width===lastWidth&&height===lastHeight)return;
  lastWidth=width;lastHeight=height;
  const mobile=width<760;
  renderer.shadowMap.enabled=!mobile;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,mobile?1:1.45));
  renderer.setSize(width,height,false);
  if(mobile!==composerMobile) buildComposer(mobile);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width,height);
}

runtimeMeshSetup(aircraftLibrary);
runtimeMeshSetup(vehicleLibrary);
runtimeMeshSetup(propLibrary);
wrap.classList.add('three-ready');
canvas.dataset.runtime = 'ready';
window.skyport3DStats = { ready:true, renderer:'Three.js WebGL', assets:4 };
window.dispatchEvent(new CustomEvent('skyport:3d-ready'));

function render(now) {
  requestAnimationFrame(render);
  if(contextLost) return;
  const state=getState();
  if(!state)return;
  const frameDelay=wrap.clientWidth<760?40:30;
  if(now-lastPaint<frameDelay)return;
  lastPaint=now;
  resize();
  const dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;
  rebuildStaticProps(state);
  syncPlanes(state);
  syncVehicles(state);
  syncPeople(state,now/1000);
  updateWeather(state,dt);
  updateLighting(state);
  updateCamera(state);
  if(tiltShiftPass){
    tiltShiftPass.uniforms.uResolution.value.set(lastWidth,lastHeight);
    const zoom=Math.max(.75,state.cam.k/1.1);
    tiltShiftPass.uniforms.uFocusRange.value=THREE.MathUtils.clamp(.34/zoom,.14,.34);
  }
  if(grainPass) grainPass.uniforms.uTime.value=now/1000;
  renderer.info.reset();
  composer.render();
  const planeScreens=wrap.classList.contains('debug-3d-only')?[...planeRecords.entries()].map(([plane,record])=>{
    const projected=record.model.position.clone().project(camera);
    let visibleMeshes=0;
    record.model.traverse((node)=>{if(node.isMesh && node.visible) visibleMeshes+=1;});
    return {
      state:plane.state,
      world:[Math.round(plane.x),Math.round(plane.alt*95),Math.round(plane.y)],
      screen:[Math.round((projected.x+1)*lastWidth/2),Math.round((1-projected.y)*lastHeight/2)],
      visibleMeshes,
    };
  }):undefined;
  const stats = {
    calls:renderer.info.render.calls,
    triangles:renderer.info.render.triangles,
    planes:planeRecords.size,
    vehicles:vehicleRecords.size,
    people:personRecords.size,
    carts:cartRecords.size,
    ...(planeScreens?{planeScreens}:{}),
  };
  Object.assign(window.skyport3DStats, stats);
  canvas.dataset.stats = JSON.stringify(stats);
}
requestAnimationFrame(render);
