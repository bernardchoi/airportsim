// 빌드 스텝이 없는 프로젝트이므로 버전 문자열 하나로 캐시를 관리하는 단순한 구조로 유지.
// 정적 자산을 바꿨다면 이 문자열만 올리면 다음 방문 시 자동으로 캐시가 교체됨.
const CACHE_NAME = 'skyport-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './3d-scene.js',
  './manifest.webmanifest',
  './vendor/three.module.js',
  './vendor/three.core.js',
  './vendor/loaders/GLTFLoader.js',
  './vendor/utils/BufferGeometryUtils.js',
  './vendor/utils/SkeletonUtils.js',
  './vendor/libs/meshopt_decoder.module.js',
  './vendor/postprocessing/EffectComposer.js',
  './vendor/postprocessing/RenderPass.js',
  './vendor/postprocessing/ShaderPass.js',
  './vendor/postprocessing/UnrealBloomPass.js',
  './vendor/postprocessing/OutputPass.js',
  './vendor/postprocessing/Pass.js',
  './vendor/postprocessing/MaskPass.js',
  './vendor/shaders/CopyShader.js',
  './vendor/shaders/LuminosityHighPassShader.js',
  './vendor/shaders/OutputShader.js',
  './assets/aircraft-sprite.png',
  './assets/airport-material-atlas.png',
  './assets/airport-world-base.png',
  './assets/service-vehicles.png',
  './assets/terminal-retail-sheet.png',
  './assets/3d/airport-environment.glb',
  './assets/3d/aircraft-fleet.glb',
  './assets/3d/ground-vehicles.glb',
  './assets/3d/terminal-props.glb',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
    }),
  );
});
