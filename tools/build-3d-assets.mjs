import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mkdir, writeFile } from 'node:fs/promises';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((value) => {
        this.result = value;
        this.onloadend?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((value) => {
        const base64 = Buffer.from(value).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
        this.onloadend?.({ target: this });
      });
    }
  };
}

const OUT = new URL('../assets/3d-src/', import.meta.url);
await mkdir(OUT, { recursive: true });

const materials = new Map();
function material(name, color, roughness = 0.7, metalness = 0.05, options = {}) {
  if (materials.has(name)) return materials.get(name);
  const mat = new THREE.MeshStandardMaterial({
    name,
    color,
    roughness,
    metalness,
    transparent: Boolean(options.transparent),
    opacity: options.opacity ?? 1,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: options.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: Boolean(options.vertexColors),
  });
  materials.set(name, mat);
  return mat;
}

const MAT = {
  grass: material('M_Grass', 0x294f3d, 0.96),
  asphalt: material('M_Asphalt', 0x1f2831, 0.92),
  taxi: material('M_Taxiway', 0x343e48, 0.88),
  concrete: material('M_Concrete', 0x68727c, 0.83),
  concreteDark: material('M_Concrete_Dark', 0x394550, 0.86),
  metal: material('M_Metal', 0x65717c, 0.34, 0.62),
  metalDark: material('M_Metal_Dark', 0x182635, 0.32, 0.68),
  white: material('M_White_Paint', 0xe8edf2, 0.42, 0.12),
  dark: material('M_Rubber_Dark', 0x0a1119, 0.86),
  yellow: material('M_Safety_Yellow', 0xe0ad2d, 0.58, 0.08),
  blue: material('M_Aviation_Blue', 0x3e82c4, 0.48, 0.18),
  red: material('M_Safety_Red', 0xc64b4b, 0.52, 0.12),
  purple: material('M_Service_Purple', 0x7e58c2, 0.48, 0.12),
  glass: material('M_Terminal_Glass', 0x72b5df, 0.12, 0.18, { transparent: true, opacity: 0.48, doubleSide: true }),
  warmGlass: material('M_Warm_Glass', 0xffbe67, 0.22, 0.08, { transparent: true, opacity: 0.72, emissive: 0xff9f32, emissiveIntensity: 0.85 }),
  runwayLight: material('M_Runway_Light', 0xdaf3ff, 0.18, 0.15, { emissive: 0x9ddcff, emissiveIntensity: 3.4 }),
  taxiLight: material('M_Taxi_Light', 0x65a8ff, 0.2, 0.15, { emissive: 0x3184ff, emissiveIntensity: 2.8 }),
  amberLight: material('M_Amber_Light', 0xffcf78, 0.2, 0.1, { emissive: 0xffa52f, emissiveIntensity: 2.7 }),
  invisible: material('M_Collider', 0x000000, 1, 0, { transparent: true, opacity: 0 }),
};

function mesh(name, geometry, mat, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const result = new THREE.Mesh(geometry, mat);
  result.name = name;
  result.position.set(...position);
  result.rotation.set(...rotation);
  result.scale.set(...scale);
  result.castShadow = !mat.transparent;
  result.receiveShadow = true;
  return result;
}

function box(parent, name, size, position, mat, rotation = [0, 0, 0]) {
  const item = mesh(name, new THREE.BoxGeometry(...size), mat, position, rotation);
  parent.add(item);
  return item;
}

function cylinder(parent, name, radiusTop, radiusBottom, height, position, mat, rotation = [0, 0, 0], segments = 28) {
  const item = mesh(name, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), mat, position, rotation);
  parent.add(item);
  return item;
}

function sphere(parent, name, radius, position, mat, scale = [1, 1, 1], segments = 22) {
  const item = mesh(name, new THREE.SphereGeometry(radius, segments, Math.max(10, segments / 2)), mat, position, [0, 0, 0], scale);
  parent.add(item);
  return item;
}

function transformedGeometry(geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const result = geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  result.applyMatrix4(matrix);
  return result;
}

function coloredGeometry(geometry, color, position, rotation, scale) {
  const result = transformedGeometry(geometry, position, rotation, scale);
  const value = new THREE.Color(color);
  const colors = new Float32Array(result.attributes.position.count * 3);
  for (let index = 0; index < result.attributes.position.count; index += 1) value.toArray(colors, index * 3);
  result.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return result;
}

function addCollider(parent, name, size, position) {
  const collider = box(parent, `COL_${name}`, size, position, MAT.invisible);
  collider.userData = { collision: true, shape: 'box', gameplayName: name };
  collider.visible = false;
}

function bakeUniformScale(root, factor) {
  root.traverse((node) => {
    if (node === root) return;
    node.position.multiplyScalar(factor);
    if (node.isMesh) {
      node.geometry = node.geometry.clone();
      node.geometry.scale(factor, factor, factor);
    }
  });
  root.updateMatrixWorld(true);
}

function addBoundsCollider(root, name, padding = 0) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3()).addScalar(padding * 2);
  const center = bounds.getCenter(new THREE.Vector3());
  addCollider(root, name, size.toArray(), center.toArray());
}

function markRuntime(root, assetType) {
  root.userData = {
    assetType,
    units: 'meters',
    upAxis: 'Y',
    forwardAxis: '+X',
    pipelineVersion: 2,
    lighting: 'hybrid-dynamic',
  };
}

function buildEnvironment() {
  const root = new THREE.Group();
  root.name = 'Airport_Environment';
  markRuntime(root, 'environment');

  box(root, 'Terrain_LOD0', [1780, 4, 1220], [750, -2, 500], MAT.grass);
  box(root, 'Perimeter_Road', [1460, 1.2, 18], [745, 0.7, 196], MAT.asphalt);
  box(root, 'Entrance_Road', [1380, 1.4, 72], [760, 0.8, 840], MAT.asphalt);
  box(root, 'Runway_09_27', [1160, 2.2, 38], [640, 1.1, 80], MAT.asphalt);
  box(root, 'Taxiway_Main', [1000, 1.7, 17], [650, 1.1, 160], MAT.taxi);
  box(root, 'Apron', [1220, 2.4, 82], [750, 1.2, 245], MAT.concrete);
  box(root, 'Terminal_Floor', [1180, 3, 490], [730, 1.5, 530], MAT.concrete);

  for (const x of [150, 300, 480, 660, 840, 1020, 1200]) {
    box(root, `Taxi_Connector_${x}`, [16, 1.6, 92], [x, 1.2, 205], MAT.taxi);
  }

  for (let x = 110; x < 1190; x += 58) {
    box(root, `Runway_Center_${x}`, [26, 0.45, 2.3], [x, 2.45, 80], MAT.white);
  }
  for (const x of [78, 92, 106, 1128, 1142, 1156]) {
    box(root, `Threshold_${x}`, [8, 0.48, 26], [x, 2.48, 80], MAT.white);
  }
  const runwayLights=[];
  for (const z of [58, 102]) {
    for (let x = 75; x <= 1205; x += 46) {
      runwayLights.push(transformedGeometry(new THREE.SphereGeometry(1.15,10,8),[x,3.2,z],[0,0,0],[1,.55,1]));
    }
  }
  root.add(mesh('Runway_Lights',mergeGeometries(runwayLights,false),MAT.runwayLight));
  const taxiLights=[];
  for (let x = 150; x <= 1150; x += 38) {
    taxiLights.push(transformedGeometry(new THREE.SphereGeometry(.8,8,8),[x,2.7,150],[0,0,0],[1,.5,1]));
  }
  root.add(mesh('Taxi_Lights',mergeGeometries(taxiLights,false),MAT.taxiLight));
  box(root, 'Taxi_Centerline', [1000, 0.35, 1.4], [650, 2.05, 160], MAT.yellow);

  const terminal = new THREE.Group();
  terminal.name = 'Terminal_Shell';
  root.add(terminal);
  box(terminal, 'Concourse_Core', [1180, 42, 42], [730, 23, 306], MAT.metalDark);
  box(terminal, 'Concourse_Roof', [1192, 5, 54], [730, 46.5, 306], MAT.metal);
  box(terminal, 'Concourse_Glass', [1168, 18, 2.2], [730, 22, 283.8], MAT.warmGlass);
  // 커튼월 멀리언: 통유리 한 장짜리 평면감을 깨는 분할 프레임.
  for (let mx = 156; mx <= 1304; mx += 41) box(terminal, `Mullion_V_${mx}`, [.8, 18.6, 2.6], [mx, 22, 283.8], MAT.metalDark);
  for (const my of [15.5, 28.5]) box(terminal, `Mullion_H_${my}`, [1168, .7, 2.6], [730, my, 283.8], MAT.metalDark);
  box(terminal, 'West_Wall', [8, 28, 490], [140, 15, 530], MAT.metalDark);
  box(terminal, 'South_Glass', [1180, 20, 3], [730, 12, 775], MAT.glass);
  box(terminal, 'Entrance_Canopy', [330, 4, 72], [600, 27, 808], MAT.glass);
  box(terminal, 'Entrance_Core', [260, 24, 20], [600, 13, 760], MAT.metalDark);
  addCollider(terminal, 'Terminal_Shell', [1050, 48, 52], [660, 24, 306]);

  const gateXs = [300, 480, 660, 840, 1020, 1200];
  gateXs.forEach((x, index) => {
    const bridge = new THREE.Group();
    bridge.name = `JetBridge_G${index + 1}`;
    bridge.position.set(x, 0, 0);
    terminal.add(bridge);
    box(bridge, 'Rotunda', [30, 16, 24], [0, 16, 286], MAT.metal);
    box(bridge, 'Rotunda_Trim_Top', [30.6, 1, 24.6], [0, 24, 286], MAT.metalDark);
    box(bridge, 'Rotunda_Trim_Base', [30.6, 1, 24.6], [0, 8, 286], MAT.metalDark);
    box(bridge, 'Tunnel', [16, 13, 58], [0, 14, 255], MAT.metal);
    box(bridge, 'Tunnel_Glass', [14, 7, 50], [0, 18, 255], MAT.glass);
    // 실제 탑승교의 자바라(아코디언) 주름 표현 — 얇은 링 밴드를 터널을 따라 반복.
    for (let rz = 232; rz <= 278; rz += 7.5) box(bridge, `Tunnel_Ridge_${rz}`, [16.5, 13.4, 1], [0, 14, rz], MAT.metalDark);
    cylinder(bridge, 'Support', 2.2, 2.8, 12, [0, 6, 254], MAT.metalDark);
    addCollider(bridge, `JetBridge_G${index + 1}`, [30, 20, 84], [0, 14, 260]);
    bridge.userData = { gateIndex: index, pivot: 'terminal-rotunda' };
  });

  // 래스터 바닥 위에 별도 표시되는 에어사이드 디테일 레이어.
  // 탑승교, 스탠드 유도선, 계류장 안전장비는 3D 런타임에서도 유지됨.
  const airside = new THREE.Group(); airside.name='Airside_Details'; root.add(airside);
  gateXs.forEach((x,index)=>{
    const stand = new THREE.Group(); stand.name=`Stand_Detail_G${index+1}`; airside.add(stand);
    box(stand,'Lead_In',[2, .35, 76],[0,2.7,0],MAT.yellow);
    box(stand,'Stop_Bar',[32,.4,2],[0,2.75,27],MAT.white);
    for(const z of [-24,-8,8]) box(stand,`Guide_${z}`,[18,.3,1.3],[0,2.7,z],MAT.white);
    box(stand,'Gate_Marker',[20,.55,13],[0,2.8,36],MAT.yellow);
    box(stand,'Gate_Label',[12,.4,8],[0,3.2,36],MAT.dark);
    stand.position.set(x,0,238);
    for(const [cx,cz] of [[-42,8],[42,8],[-42,34],[42,34]]) {
      cylinder(stand,`Cone_${cx}_${cz}`,1.05,.4,3.4,[cx,2,cz],MAT.yellow,[0,0,0],8);
      sphere(stand,`ConeCap_${cx}_${cz}`,.42,[cx,3.8,cz],MAT.red,[1,.55,1],8);
    }
  });
  for(let x=176;x<1180;x+=76){
    box(airside,`Apron_RoadDash_${x}`,[34,.3,1.3],[x,2.65,266],MAT.white);
    cylinder(airside,`Apron_Bollard_${x}`,1.1,1.3,6,[x,4,278],MAT.metal,[0,0,0],10);
  }

  // 동쪽 T2 콩코스·화물·운영 단지
  const east = new THREE.Group(); east.name='Terminal_East_Operations'; root.add(east);
  box(east,'Cargo_Building',[92,28,42],[1266,15,764],MAT.metalDark);
  box(east,'Cargo_Roof',[100,4,50],[1266,31,764],MAT.metal);
  box(east,'Ops_Building',[62,24,42],[1352,13,764],MAT.concreteDark);
  box(east,'Ops_Glass',[48,12,2],[1352,16,742],MAT.glass);
  box(east,'Cargo_Ramp',[210,1.5,22],[1315,1,790],MAT.asphalt);
  for(const x of [1228,1272,1316]) box(east,`Cargo_Door_${x}`,[20,14,2],[x,12,741],MAT.metal);

  const tower = new THREE.Group();
  tower.name = 'Control_Tower';
  tower.position.set(100, 0, 212);
  root.add(tower);
  box(tower, 'Tower_Base', [34, 10, 34], [0, 5, 0], MAT.concreteDark);
  cylinder(tower, 'Tower_Shaft', 7.5, 10.5, 72, [0, 42, 0], MAT.concrete, [0, 0, 0], 22);
  cylinder(tower, 'Tower_Deck', 20, 20, 4, [0, 78, 0], MAT.metalDark, [0, 0, 0], 22);
  cylinder(tower, 'Tower_Cab', 16, 14, 12, [0, 86, 0], MAT.glass, [0, 0, 0], 22);
  // 조종실 유리 사이의 얇은 멀리언 밴드 — 원통형 캡을 그냥 통유리로 두지 않음.
  for (const my of [82.5, 89.5]) cylinder(tower, `Tower_Cab_Band_${my}`, 16.2, 14.4, .8, [0, my, 0], MAT.metalDark, [0, 0, 0], 22);
  cylinder(tower, 'Tower_Roof', 18, 15, 4, [0, 94, 0], MAT.metalDark, [0, 0, 0], 22);
  cylinder(tower, 'Tower_Antenna', 0.8, 0.8, 18, [0, 105, 0], MAT.metal, [0, 0, 0], 10);
  sphere(tower, 'Tower_Beacon', 1.4, [0, 114, 0], MAT.red, [1, 1, 1], 10);
  addCollider(tower, 'Control_Tower', [36, 100, 36], [0, 50, 0]);

  for (const x of [230, 630, 1030]) {
    cylinder(root, `Apron_Light_Pole_${x}`, 0.7, 1.1, 38, [x, 19, 206], MAT.metal, [0, 0, 0], 8);
    box(root, `Apron_Light_Head_${x}`, [8, 2, 2.5], [x, 39, 204], MAT.amberLight);
  }

  addCollider(root, 'Runway', [1160, 3, 38], [640, 1.5, 80]);
  root.updateMatrixWorld(true);
  return root;
}

function flatGeometry(name, points) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  points.forEach(([x, z]) => positions.push(x, 0, z));
  const indices = [];
  for (let i = 1; i < points.length - 1; i += 1) indices.push(0, i, i + 1);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.name = name;
  return geometry;
}

function aircraftModel(name, scale, accent) {
  const root = new THREE.Group();
  root.name = name;
  root.userData = { variant: name.replace('Aircraft_', ''), pivot: 'ground-center', forward: '+X', lod: 0 };
  const lod0 = new THREE.Group();
  lod0.name = `${name}_LOD0`;
  lod0.userData = { lod: 0 };
  root.add(lod0);
  const fuselageMat = material(`${name}_Fuselage`, 0xe9eef2, 0.33, 0.18);
  const accentMat = material(`${name}_Accent`, accent, 0.42, 0.22);
  const s = scale;
  const fuselage = cylinder(lod0, 'Fuselage', 3.6 * s, 3.2 * s, 52 * s, [0, 8 * s, 0], fuselageMat, [0, 0, -Math.PI / 2], 24);
  fuselage.castShadow = true;
  sphere(lod0, 'Nose', 3.6 * s, [26 * s, 8 * s, 0], fuselageMat, [1.4, 1, 1], 20);
  sphere(lod0, 'Tail_Cone', 3.1 * s, [-26 * s, 8 * s, 0], fuselageMat, [1.25, 0.78, 0.78], 16);
  const wingLeft = flatGeometry('Wing_Left_Geometry', [[8*s,0],[-9*s,0],[-4*s,26*s],[2*s,26*s]]);
  const wingRight = flatGeometry('Wing_Right_Geometry', [[8*s,0],[2*s,-26*s],[-4*s,-26*s],[-9*s,0]]);
  lod0.add(mesh('Main_Wing_L', wingLeft, fuselageMat, [0, 8.2 * s, 0]));
  lod0.add(mesh('Main_Wing_R', wingRight, fuselageMat, [0, 8.2 * s, 0]));
  const tailLeft = flatGeometry('Tail_Left_Geometry', [[-14*s,0],[-25*s,0],[-23*s,10*s],[-18*s,10*s]]);
  const tailRight = flatGeometry('Tail_Right_Geometry', [[-14*s,0],[-18*s,-10*s],[-23*s,-10*s],[-25*s,0]]);
  lod0.add(mesh('Tailplane_L', tailLeft, fuselageMat, [0, 9 * s, 0]));
  lod0.add(mesh('Tailplane_R', tailRight, fuselageMat, [0, 9 * s, 0]));
  box(lod0, 'Vertical_Tail', [8*s, 11*s, 1.2*s], [-20*s, 14*s, 0], accentMat, [0, 0, -0.18]);
  // 실제 여객기의 식별력 높은 실루엣 요소: 상반각 윙렛과 엔진 파일런.
  box(lod0, 'Winglet_L', [3.2*s, 4.6*s, .9*s], [1.2*s, 8.2*s + 27*s * Math.tan(0), 27.5*s], accentMat, [0, 0, .1]);
  box(lod0, 'Winglet_R', [3.2*s, 4.6*s, .9*s], [1.2*s, 8.2*s + 27*s * Math.tan(0), -27.5*s], accentMat, [0, 0, -.1]);
  for (const z of [-12, 12]) {
    const side = z < 0 ? 'L' : 'R';
    cylinder(lod0, `Engine_${side}`, 2.5*s, 2.8*s, 8*s, [2*s, 5.2*s, z*s], MAT.metal, [0, 0, -Math.PI/2], 16);
    cylinder(lod0, `Engine_Inlet_${side}`, 2.15*s, 2.15*s, .9*s, [6.1*s, 5.2*s, z*s], MAT.dark, [0, 0, -Math.PI/2], 16);
    box(lod0, `Engine_Pylon_${side}`, [3.4*s, 3*s, 1*s], [2.6*s, 7.4*s, z*s], MAT.metalDark);
  }
  box(lod0, 'Cockpit_Glass', [4.5*s, 1.2*s, 5.2*s], [24*s, 10.5*s, 0], MAT.glass, [0, 0, -0.08]);
  box(lod0, 'Livery_Stripe', [30*s, .5*s, .8*s], [-3*s, 11.5*s, 0], accentMat);
  // 창문·도어·항법등: 활주로/게이트 근접 화면에서 항공기 스케일감 강화
  for (let x = -16; x <= 16; x += 3.4) {
    for (const z of [-3.25, 3.25]) box(lod0, `Cabin_Window_${x}_${z}`, [1.25*s, .75*s, .18*s], [x*s, 10.25*s, z*s], MAT.glass);
  }
  for (const x of [16, -15]) {
    box(lod0, `Door_${x}_L`, [2.4*s, 4.2*s, .22*s], [x*s, 8.7*s, -3.32*s], MAT.metal);
    box(lod0, `Door_${x}_R`, [2.4*s, 4.2*s, .22*s], [x*s, 8.7*s, 3.32*s], MAT.metal);
  }
  sphere(lod0, 'Nav_Light_Port', .52*s, [-2*s, 8.4*s, -26*s], MAT.red, [1, .5, 1], 8);
  sphere(lod0, 'Nav_Light_Starboard', .52*s, [-2*s, 8.4*s, 26*s], MAT.runwayLight, [1, .5, 1], 8);
  sphere(lod0, 'Anti_Collision_Beacon', .45*s, [0, 12.1*s, 0], MAT.red, [1, .5, 1], 8);
  for (const [id, x, z] of [['N',18,0],['ML',-4,-5],['MR',-4,5]]) {
    cylinder(lod0, `Gear_Strut_${id}`, .24*s, .3*s, 4.2*s, [x*s, 2.9*s, z*s], MAT.metal, [0,0,0], 8);
    cylinder(lod0, `Gear_Wheel_${id}`, .82*s, .82*s, .55*s, [x*s, .82*s, z*s], MAT.dark, [Math.PI/2,0,0], 10);
  }
  addCollider(root, name, [58*s, 19*s, 52*s], [0, 9.5*s, 0]);

  const lod1 = new THREE.Group();
  lod1.name = `${name}_LOD1`;
  lod1.userData = { lod: 1, screenCoverage: 0.06 };
  cylinder(lod1, 'Fuselage_Simple', 3.4*s, 3.1*s, 52*s, [0, 8*s, 0], fuselageMat, [0, 0, -Math.PI/2], 10);
  lod1.add(mesh('Wing_L_Simple', wingLeft.clone(), fuselageMat, [0, 8.1*s, 0]));
  lod1.add(mesh('Wing_R_Simple', wingRight.clone(), fuselageMat, [0, 8.1*s, 0]));
  lod1.visible = false;
  root.add(lod1);
  return root;
}

function buildAircraftFleet() {
  const root = new THREE.Group();
  root.name = 'Aircraft_Fleet';
  markRuntime(root, 'aircraft-library');
  root.add(aircraftModel('Aircraft_Regional', 0.78, 0x53a7e8));
  root.add(aircraftModel('Aircraft_Narrowbody', 1, 0xe27838));
  root.add(aircraftModel('Aircraft_Widebody', 1.38, 0x8a65d1));
  root.children.forEach((child) => { child.visible = false; });
  root.updateMatrixWorld(true);
  return root;
}

function wheel(parent, name, x, z, scale = 1) {
  return cylinder(parent, name, 2.4*scale, 2.4*scale, 1.6*scale, [x, 2.5*scale, z], MAT.dark, [Math.PI/2, 0, 0], 12);
}

function vehicleModel(name, bodySize, accentMat, options = {}) {
  const root = new THREE.Group();
  root.name = name;
  root.userData = { pivot: 'ground-center', forward: '+X', type: options.type, unitScale: 0.4 };
  box(root, 'Chassis', [bodySize[0], 3, bodySize[2]], [0, 3, 0], MAT.metalDark);
  box(root, 'Body', bodySize, [-2, bodySize[1]/2 + 4, 0], options.bodyMaterial || MAT.white);
  box(root, 'Cab', [9, 8, bodySize[2]*.92], [bodySize[0]/2 - 2, 8, 0], accentMat);
  box(root, 'Windshield', [1, 3.5, bodySize[2]*.72], [bodySize[0]/2 + 2.7, 10, 0], MAT.glass);
  for (const x of [-bodySize[0]*.28, bodySize[0]*.3]) {
    wheel(root, `Wheel_L_${x}`, x, -bodySize[2]*.52);
    wheel(root, `Wheel_R_${x}`, x, bodySize[2]*.52);
  }
  sphere(root, 'Beacon', 1, [bodySize[0]/2-4, bodySize[1]+8, 0], MAT.amberLight, [1, .65, 1], 8);
  addCollider(root, name, [bodySize[0]+2, bodySize[1]+7, bodySize[2]+2], [0, (bodySize[1]+7)/2, 0]);
  return root;
}

function buildVehicles() {
  const root = new THREE.Group();
  root.name = 'Ground_Service_Vehicles';
  markRuntime(root, 'vehicle-library');
  const fuel = vehicleModel('Vehicle_Fuel', [28, 9, 10], MAT.red, { type:'fuel' });
  cylinder(fuel, 'Fuel_Tank', 4.1, 4.1, 22, [-5, 13, 0], MAT.white, [0, 0, Math.PI/2], 18);
  const cater = vehicleModel('Vehicle_Catering', [24, 14, 11], MAT.blue, { type:'cater' });
  box(cater, 'Lift_Box', [20, 9, 10], [-5, 19, 0], MAT.white);
  const tug = vehicleModel('Vehicle_Tug', [15, 5, 11], MAT.yellow, { type:'tug', bodyMaterial:MAT.metalDark });
  box(tug, 'Tow_Hitch', [8, 1.5, 2], [-11, 3, 0], MAT.metal);
  const cart = new THREE.Group();
  cart.name='Vehicle_BaggageCart';
  cart.userData={pivot:'ground-center',forward:'+X',type:'cart',unitScale:.4};
  box(cart,'Cart_Chassis',[16,1.5,8],[0,2.3,0],MAT.metalDark);
  box(cart,'Cart_Deck',[14,1,7],[0,3.5,0],MAT.concreteDark);
  for(const z of [-3.6,3.6]) box(cart,`Cart_Rail_${z}`,[14,3,.5],[0,5,z],MAT.metal);
  wheel(cart,'Cart_Wheel_FL',5,-4); wheel(cart,'Cart_Wheel_FR',5,4);
  wheel(cart,'Cart_Wheel_RL',-5,-4); wheel(cart,'Cart_Wheel_RR',-5,4);
  box(cart,'Cart_Hitch',[7,1,1.4],[-10,2.5,0],MAT.yellow);
  addCollider(cart,'Vehicle_BaggageCart',[18,8,10],[-1,4,0]);
  bakeUniformScale(cart,.4);
  for(const vehicle of [fuel,cater,tug]) bakeUniformScale(vehicle,.4);
  root.add(fuel, cater, tug, cart);
  root.children.forEach((child) => { child.visible = false; });
  root.updateMatrixWorld(true);
  return root;
}

function personModel(name, shirt, pants, options = {}) {
  const root = new THREE.Group();
  root.name = name;
  root.userData = { pivot: 'feet', role: options.role || 'traveler', forward: '+Z', heightMeters: 1.82 };
  const parts = [
    coloredGeometry(new THREE.CylinderGeometry(.9,.9,6,8),pants,[-1.2,3,0]),
    coloredGeometry(new THREE.CylinderGeometry(.9,.9,6,8),pants,[1.2,3,0]),
    coloredGeometry(new THREE.CylinderGeometry(2.8,2.3,8,10),shirt,[0,10,0]),
    coloredGeometry(new THREE.SphereGeometry(2.2,12,8),0xd69d72,[0,16,0],[0,0,0],[1,1.08,1]),
    coloredGeometry(new THREE.CylinderGeometry(.7,.7,7,8),shirt,[-3,10,0],[0,0,-.12]),
    coloredGeometry(new THREE.CylinderGeometry(.7,.7,7,8),shirt,[3,10,0],[0,0,.12]),
  ];
  if(options.hat) parts.push(coloredGeometry(new THREE.CylinderGeometry(2.4,2.1,1.2,12),
    options.hatMaterial?.color?.getHex() || 0x24313f,[0,18.1,0]));
  const bodyMaterial=material(`${name}_Body`,0xffffff,.74,.02,{vertexColors:true});
  root.add(mesh('Body_Merged',mergeGeometries(parts,false),bodyMaterial));
  addCollider(root, name, [6, 18, 6], [0, 9, 0]);
  bakeUniformScale(root, .1);
  return root;
}

function buildProps() {
  const root = new THREE.Group();
  root.name = 'Terminal_Props';
  markRuntime(root, 'prop-library');
  const traveler = personModel('Person_Traveler', 0x4f83cc, 0x26364f, { role:'traveler' });
  const staff = personModel('Person_Staff', 0x7954c6, 0x293148, { role:'staff' });
  const ground = personModel('Person_Ground', 0xd77d2d, 0x30343a, { role:'ground', hat:true, hatMaterial:MAT.yellow });
  const crew = personModel('Person_Crew', 0xc43f62, 0x61233a, { role:'crew', hat:true, hatMaterial:MAT.red });
  const counter = new THREE.Group(); counter.name='Prop_Checkin_Counter';
  box(counter,'Desk',[58,12,16],[0,6,0],MAT.blue); box(counter,'Fascia',[56,3,1],[0,8,-8.4],MAT.dark);
  box(counter,'Desk_Top_Trim',[58.6,.7,16.6],[0,12.35,0],MAT.metal);
  box(counter,'Conveyor',[42,3,8],[0,8,5],MAT.metalDark);
  for(const x of [-19,0,19]) { box(counter,`Monitor_${x}`,[10,7,2],[x,16,-4],MAT.dark); box(counter,`Screen_${x}`,[8,4.5,.35],[x,16,-5.15],MAT.runwayLight); }
  const security = new THREE.Group(); security.name='Prop_Security_Gate';
  box(security,'Post_L',[5,22,6],[-18,11,0],MAT.metal); box(security,'Post_R',[5,22,6],[18,11,0],MAT.metal); box(security,'Header',[41,5,6],[0,21,0],MAT.metal);
  box(security,'Belt',[46,4,17],[0,4,-17],MAT.metalDark); box(security,'Xray',[17,16,15],[0,12,-17],MAT.dark);
  for(const x of [-10,0,10]) box(security,`Tray_${x}`,[7,1,5],[x,6,-17],MAT.yellow);
  const bench = new THREE.Group(); bench.name='Prop_Bench';
  box(bench,'Seat',[40,3,10],[0,8,0],MAT.metalDark); box(bench,'Back',[40,10,3],[0,13,4],MAT.metalDark);
  for(const x of [-13,0,13]) { box(bench,`Arm_${x}`,[1.2,8,8],[x,12,0],MAT.metal); box(bench,`Leg_${x}`,[2,7,2],[x,4,0],MAT.metal); }
  const board = new THREE.Group(); board.name='Prop_Departure_Board';
  box(board,'Screen',[70,34,4],[0,24,0],MAT.dark); box(board,'Header',[64,3,1],[0,34,-2.5],MAT.amberLight); cylinder(board,'Post',2,2,22,[0,11,0],MAT.metal);
  for(let y=14;y<=28;y+=7) box(board,`Flight_Row_${y}`,[58,1.1,.45],[0,y,-2.45],MAT.runwayLight);
  const cart = new THREE.Group(); cart.name='Prop_Luggage_Cart';
  box(cart,'Basket',[14,8,10],[0,7,0],MAT.metal); wheel(cart,'Wheel_A',-5,-6,.7); wheel(cart,'Wheel_B',5,-6,.7);
  const cafe = new THREE.Group(); cafe.name='Prop_Cafe';
  box(cafe,'Cafe_Base',[54,10,38],[0,5,0],MAT.concreteDark);
  box(cafe,'Cafe_Counter',[48,9,9],[0,12,-12],MAT.metal);
  box(cafe,'Cafe_Backbar',[44,20,5],[0,17,13],MAT.metalDark);
  box(cafe,'Cafe_Canopy',[58,4,42],[0,27,0],MAT.red);
  cylinder(cafe,'Cafe_Sign',7,7,2,[0,30,-20],MAT.amberLight,[Math.PI/2,0,0],16);
  for(const x of [-16,0,16]) { cylinder(cafe,`Cafe_Stool_${x}`,2.2,2.2,8,[x,5,-2],MAT.metalDark,[0,0,0],10); cylinder(cafe,`Cafe_Table_${x}`,5,5,1,[x,10,5],MAT.metal,[0,0,0],10); }
  for(const x of [-18,0,18]) sphere(cafe,`Cafe_Pendant_${x}`,1.4,[x,25,-5],MAT.amberLight,[1,.7,1],8);
  const snack = new THREE.Group(); snack.name='Prop_Snack';
  box(snack,'Snack_Base',[62,11,44],[0,5.5,0],MAT.concreteDark);
  box(snack,'Snack_Service_Counter',[56,10,10],[0,13,-14],MAT.metal);
  box(snack,'Snack_Menu_Board',[46,12,2],[0,26,13],MAT.dark);
  box(snack,'Snack_Canopy',[66,4,48],[0,29,0],MAT.red);
  for(const x of [-18,18]) { box(snack,`Snack_Booth_${x}`,[18,8,18],[x,6,6],MAT.red); box(snack,`Snack_Table_${x}`,[13,2,8],[x,11,6],MAT.metal); }
  const duty = new THREE.Group(); duty.name='Prop_Duty';
  box(duty,'Duty_Base',[66,15,46],[0,7.5,0],MAT.metalDark);
  box(duty,'Duty_Glass',[62,12,2],[0,15,-24],MAT.glass);
  box(duty,'Duty_Header',[66,6,6],[0,27,-21],MAT.purple);
  box(duty,'Duty_Display_Main',[40,11,12],[0,12,-4],MAT.metal);
  for(const x of [-24,24]) { box(duty,`Duty_Shelf_${x}`,[10,22,25],[x,13,7],MAT.metal); box(duty,`Duty_Light_${x}`,[11,2,26],[x,25,7],MAT.amberLight); }
  for(let x=-14;x<=14;x+=7) for(let z=-4;z<=10;z+=7) box(duty,`Duty_Product_${x}_${z}`,[3,6,3],[x,15,z],x%14===0?MAT.purple:MAT.yellow);
  const plant = new THREE.Group(); plant.name='Prop_Plant';
  cylinder(plant,'Pot',3.5,2.8,6,[0,3,0],MAT.concreteDark,[0,0,0],12); sphere(plant,'Foliage',6,[0,10,0],MAT.grass,[1,1.2,1],12);
  const info = new THREE.Group(); info.name='Prop_Info';
  box(info,'Info_Desk',[26,10,18],[0,5,0],MAT.blue); cylinder(info,'Info_Pole',1,1,13,[0,16,0],MAT.metal); sphere(info,'Info_Light',3,[0,23,0],MAT.runwayLight,[1,1,1],12);
  const art = new THREE.Group(); art.name='Prop_Art';
  cylinder(art,'Art_Plinth',7,8,5,[0,2.5,0],MAT.concreteDark,[0,0,0],16); box(art,'Art_A',[3,26,3],[0,18,0],MAT.metal,[0,0,.48]); box(art,'Art_B',[3,22,3],[0,20,0],MAT.blue,[0,0,-.62]);
  const kids = new THREE.Group(); kids.name='Prop_Kids';
  cylinder(kids,'Kids_Base',11,11,2,[0,1,0],MAT.blue,[0,0,0],20); sphere(kids,'Kids_A',4,[-5,5,0],MAT.yellow,[1,1,1],12); sphere(kids,'Kids_B',4,[5,5,0],MAT.red,[1,1,1],12);
  const rail = new THREE.Group(); rail.name='Prop_Queue_Rail';
  for(const x of [-22,22]) { cylinder(rail,`Rail_Post_${x}`,1.1,1.5,13,[x,6.5,0],MAT.metal,[0,0,0],10); sphere(rail,`Rail_Cap_${x}`,1.5,[x,13,0],MAT.metal,[1,.6,1],10); }
  box(rail,'Rail_Belt',[43,1.3,1.3],[0,10,0],MAT.red);
  const podium = new THREE.Group(); podium.name='Prop_Gate_Podium';
  box(podium,'Podium_Base',[16,10,14],[0,5,0],MAT.metalDark); box(podium,'Podium_Screen',[12,8,1],[0,14,-5],MAT.runwayLight); box(podium,'Podium_Header',[14,2,1],[0,19,-5],MAT.amberLight);
  box(podium,'Podium_Top_Trim',[16.6,.6,14.6],[0,10.3,0],MAT.metal);
  box(podium,'Podium_Screen_Frame',[12.6,8.6,.5],[0,14,-5.3],MAT.metalDark);
  const kiosk = new THREE.Group(); kiosk.name='Prop_Checkin_Kiosk';
  box(kiosk,'Kiosk_Base',[11,16,10],[0,8,0],MAT.metal); box(kiosk,'Kiosk_Screen',[8,7,1],[0,15,-4.8],MAT.runwayLight); box(kiosk,'Kiosk_Bag_Slot',[8,3,5],[0,4,5],MAT.dark);
  const palm = new THREE.Group(); palm.name='Prop_Palm';
  cylinder(palm,'Palm_Pot',5,4,7,[0,3.5,0],MAT.concreteDark,[0,0,0],14); cylinder(palm,'Palm_Trunk',1.6,2.4,25,[0,17,0],MAT.metal,[0,0,0],10);
  for(let i=0;i<7;i++) box(palm,`Palm_Leaf_${i}`,[3,1,21],[0,29,0],MAT.grass,[0,i*Math.PI*2/7,.35]);
  const apronSet = new THREE.Group(); apronSet.name='Prop_Apron_Service_Set';
  for(const [x,z] of [[-15,-10],[15,-10],[-15,10],[15,10]]) { cylinder(apronSet,`Cone_${x}_${z}`,1.8,.55,5,[x,2.5,z],MAT.yellow,[0,0,0],10); sphere(apronSet,`ConeTop_${x}_${z}`,.7,[x,5.3,z],MAT.red,[1,.6,1],8); }
  box(apronSet,'Chock_L',[7,2,3],[-4,1,0],MAT.yellow); box(apronSet,'Chock_R',[7,2,3],[4,1,0],MAT.yellow);
  const props=[counter,security,bench,board,cart,cafe,snack,duty,plant,info,art,kids,rail,podium,kiosk,palm,apronSet];
  for(const prop of props){ addBoundsCollider(prop,prop.name,1); bakeUniformScale(prop,.1); }
  root.add(traveler,staff,ground,crew,...props);
  root.children.forEach((child)=>{child.visible=false;});
  root.updateMatrixWorld(true);
  return root;
}

async function exportGLB(object, filename) {
  const scene = new THREE.Scene();
  scene.name = `${object.name}_Scene`;
  scene.add(object);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: true,
    trs: true,
    onlyVisible: false,
    includeCustomExtensions: true,
  });
  await writeFile(new URL(filename, OUT), Buffer.from(result));
}

await exportGLB(buildEnvironment(), 'airport-environment.glb');
await exportGLB(buildAircraftFleet(), 'aircraft-fleet.glb');
await exportGLB(buildVehicles(), 'ground-vehicles.glb');
await exportGLB(buildProps(), 'terminal-props.glb');

console.log('Generated GLB source assets in assets/3d-src');
