import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const assetDir = resolve('assets/3d');
const files = (await readdir(assetDir)).filter((file) => file.endsWith('.glb')).sort();
const failures = [];
const reports = [];

function fail(file, message) { failures.push(`${file}: ${message}`); }
function extent(node) {
  const bounds = getBounds(node);
  return bounds.max.map((value, index) => value - bounds.min[index]);
}
function inRange(value, min, max) { return value >= min && value <= max; }

for (const file of files) {
  const document = await io.read(resolve(assetDir, file));
  const nodes = document.getRoot().listNodes();
  const names = new Set(nodes.map((node) => node.getName()));
  const colliders = nodes.filter((node) => node.getName().startsWith('COL_'));

  const expectedRoot = {
    'aircraft-fleet.glb': 'Aircraft_Fleet',
    'airport-environment.glb': 'Airport_Environment',
    'ground-vehicles.glb': 'Ground_Service_Vehicles',
    'terminal-props.glb': 'Terminal_Props',
  }[file];
  if (!names.has(expectedRoot)) fail(file, `missing root ${expectedRoot}`);
  const stableRoots = {
    'aircraft-fleet.glb': ['Aircraft_Fleet', 'Aircraft_Regional', 'Aircraft_Narrowbody', 'Aircraft_Widebody'],
    'airport-environment.glb': ['Airport_Environment', 'Terminal_Shell', 'Control_Tower'],
    'ground-vehicles.glb': ['Ground_Service_Vehicles', 'Vehicle_Fuel', 'Vehicle_Catering', 'Vehicle_Tug', 'Vehicle_BaggageCart'],
    'terminal-props.glb': ['Terminal_Props', 'Person_Traveler', 'Person_Staff', 'Person_Ground', 'Person_Crew'],
  }[file];
  const badRootScales = nodes.filter((node) => stableRoots.includes(node.getName()) &&
    node.getScale().some((value) => Math.abs(value - 1) > 1e-5));
  if (badRootScales.length) fail(file, `non-unit gameplay root scales: ${badRootScales.map((node) => node.getName()).join(', ')}`);

  if (file === 'aircraft-fleet.glb') {
    for (const name of ['Aircraft_Regional', 'Aircraft_Narrowbody', 'Aircraft_Widebody']) {
      const node = nodes.find((item) => item.getName() === name);
      if (!node) { fail(file, `missing ${name}`); continue; }
      const [length, height, span] = extent(node);
      if (!inRange(length, 35, 95) || !inRange(height, 8, 30) || !inRange(span, 30, 80)) {
        fail(file, `${name} implausible bounds ${extent(node).map((v) => v.toFixed(2)).join('x')}`);
      }
    }
    if (nodes.filter((node) => node.getName().endsWith('_LOD0')).length !== 3) fail(file, 'expected three LOD0 groups');
    if (nodes.filter((node) => node.getName().endsWith('_LOD1')).length !== 3) fail(file, 'expected three LOD1 groups');
    if (colliders.length !== 3) fail(file, `expected 3 colliders, found ${colliders.length}`);
  }

  if (file === 'ground-vehicles.glb') {
    for (const name of ['Vehicle_Fuel', 'Vehicle_Catering', 'Vehicle_Tug', 'Vehicle_BaggageCart']) {
      const node = nodes.find((item) => item.getName() === name);
      if (!node) { fail(file, `missing ${name}`); continue; }
      const dimensions = extent(node);
      if (Math.max(...dimensions) > 15 || dimensions[1] > 10) fail(file, `${name} oversized ${dimensions.map((v) => v.toFixed(2)).join('x')}`);
    }
    if (colliders.length !== 4) fail(file, `expected 4 colliders, found ${colliders.length}`);
  }

  if (file === 'terminal-props.glb') {
    for (const name of ['Person_Traveler', 'Person_Staff', 'Person_Ground', 'Person_Crew']) {
      const node = nodes.find((item) => item.getName() === name);
      if (!node) { fail(file, `missing ${name}`); continue; }
      const height = extent(node)[1];
      if (!inRange(height, 1.7, 2.1)) fail(file, `${name} invalid height ${height.toFixed(2)}m`);
    }
    for (const name of ['Prop_Checkin_Counter', 'Prop_Security_Gate', 'Prop_Bench', 'Prop_Cafe', 'Prop_Duty', 'Prop_Queue_Rail', 'Prop_Gate_Podium', 'Prop_Palm', 'Prop_Apron_Service_Set']) {
      const node = nodes.find((item) => item.getName() === name);
      if (!node) { fail(file, `missing ${name}`); continue; }
      if (Math.max(...extent(node)) > 8) fail(file, `${name} oversized ${extent(node).map((v) => v.toFixed(2)).join('x')}`);
    }
    if (colliders.length !== 21) fail(file, `expected 21 colliders, found ${colliders.length}`);
  }

  if (file === 'airport-environment.glb' && colliders.length < 9) {
    fail(file, `expected at least 9 colliders, found ${colliders.length}`);
  }

  reports.push(`${file}: ${nodes.length} nodes, ${document.getRoot().listMaterials().length} materials, ${colliders.length} colliders`);
}

console.log(reports.join('\n'));
if (failures.length) {
  console.error(`\n3D validation failed:\n${failures.map((item) => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\n3D asset validation passed');
}
