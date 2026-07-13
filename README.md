# 스카이포트 타이쿤 (Skyport Tycoon)

브라우저에서 바로 플레이하는 공항 관제·운영 시뮬레이션 게임입니다. 활주로 착륙 허가부터 게이트 배정, 지상 조업, 터미널 확장·꾸미기까지 공항 운영 전반을 관리합니다.

빌드 스텝이나 프레임워크 없이 순수 HTML/CSS/JS로 동작하며, 별도 백엔드 없이 정적 파일만으로 완결됩니다.

## 실행 방법

Node.js 없이도 정적 파일 서버만 있으면 바로 실행됩니다.

```bash
python3 -m http.server 8741
```

이후 브라우저에서 `http://localhost:8741` 접속. (Claude Code에서 작업 중이라면 `.claude/launch.json`에 등록된 `airport` 설정으로 동일하게 띄울 수 있습니다.)

## 주요 특징

- **2D + 3D 하이브리드 렌더링** — 손으로 그린 벡터 캐릭터·스프라이트를 그리는 2D 캔버스(`#cv`) 위에, Three.js로 구동되는 3D WebGL 레이어(`#world3d`, `3d-scene.js`)를 겹쳐 터미널 외관·탑승교·항공기·차량·군중에 실제 입체감을 부여합니다.
- **절차적 3D 에셋** — 모든 3D 모델은 핸드모델링 없이 `tools/build-3d-assets.mjs`에서 Box/Cylinder/Sphere 원시 지오메트리로 코드 생성 후 GLB로 내보냅니다.
- **포스트프로세싱 파이프라인** — Bloom, 틸트시프트(DoF), 필름 그레인, PMREM 환경맵 반사, 절차적 러프니스 노이즈까지 코드만으로 구현된 렌더링 품질 업그레이드가 적용되어 있습니다.
- **터치/모바일 지원** — 한 손가락 팬, 두 손가락 핀치줌, 좁은 화면 전용 레이아웃·터치 타깃 크기 조정, 모바일 프레임 스로틀링까지 지원해 실제 스마트폰에서도 플레이 가능합니다.
- **PWA** — `manifest.webmanifest` + `sw.js` 서비스워커로 홈 화면 설치와 오프라인 실행을 지원합니다.

## 3D 에셋 빌드

3D 모델(`assets/3d-src/*.glb`, `assets/3d/*.glb`)이나 앱 아이콘(`assets/icons/*.png`)을 수정한 뒤에는 아래 스크립트로 재생성합니다.

```bash
npm install

npm run build:3d      # tools/build-3d-assets.mjs 실행 → gltf-transform으로 압축 최적화
npm run validate:3d   # 생성된 GLB의 노드/머티리얼/콜라이더 무결성 검사
npm run inspect:3d    # 각 GLB의 상세 정보 출력
npm run build:icons   # assets/icons/icon-source.svg → PWA용 PNG 아이콘 세트 생성
```

## 프로젝트 구조

```
index.html                게임 UI, 2D 캔버스 렌더러, 게임 로직 전체
3d-scene.js                Three.js 3D 레이어 (포스트프로세싱, 조명, 동적 오브젝트 동기화)
sw.js / manifest.webmanifest  PWA 서비스워커·매니페스트
tools/
  build-3d-assets.mjs       절차적 3D 에셋 생성 스크립트
  validate-3d-assets.mjs    GLB 무결성 검증
  gen-icons.mjs             SVG → PWA 아이콘 PNG 래스터화
assets/
  3d-src/, 3d/               GLB 3D 모델 (원본 / 최적화본)
  icons/                     PWA 아이콘 소스(SVG)·출력(PNG)
  *.png                      2D 캔버스용 스프라이트·머티리얼 아틀라스
vendor/                     오프라인 importmap용으로 로컬 복사해 둔 Three.js 코어·로더·포스트프로세싱 모듈
design/                     레퍼런스 컨셉 이미지
```

## 기술 스택

순수 ES 모듈만 사용하며 프론트엔드 빌드 도구(webpack/vite 등)가 없습니다. `vendor/`에 Three.js 관련 모듈을 직접 복사해 두고 브라우저 네이티브 `<script type="importmap">`으로 해석합니다. `node_modules`(Three.js, `@gltf-transform/cli`, `sharp`)는 오직 `tools/` 아래의 오프라인 빌드 스크립트에서만 사용되고, 실제 게임 런타임에는 관여하지 않습니다.

## 라이선스

[LICENSE](./LICENSE) (Apache License 2.0) 참고.
