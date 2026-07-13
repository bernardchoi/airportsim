import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const classicScripts = [...html.matchAll(/<script(?![^>]*\b(?:src|type)\s*=)[^>]*>([\s\S]*?)<\/script>/gi)];

for (const [index, match] of classicScripts.entries()) {
  try {
    new Function(match[1]);
  } catch (error) {
    throw new Error(`index.html 인라인 스크립트 ${index + 1} 구문 오류: ${error.message}`);
  }
}

function assertUnique(label, values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size) throw new Error(`${label} 중복: ${[...duplicates].join(', ')}`);
}

assertUnique('DOM id', [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
assertUnique('함수 선언', [...classicScripts.flatMap((match) => [...match[1].matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)])].map((match) => match[1]));

console.log(`소스 검증 완료: 인라인 스크립트 ${classicScripts.length}개, DOM id/함수 선언 중복 없음`);
