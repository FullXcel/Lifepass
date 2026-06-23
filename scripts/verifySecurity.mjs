import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

if (exists('.env')) failures.push('.env 파일이 저장소 루트에 포함되어 있습니다. 실제 키는 커밋/ZIP에서 제거하세요.');
if (exists('node_modules')) failures.push('node_modules가 포함되어 있습니다. 배포 환경에서 npm ci로 새로 설치하세요.');
if (exists('dist')) failures.push('dist가 포함되어 있습니다. 빌드 산출물은 배포 단계에서 생성하세요.');
if (exists('.git')) failures.push('.git 디렉터리가 포함되어 있습니다. 제출용 ZIP에는 제거하세요.');
if (exists('__MACOSX')) failures.push('__MACOSX 메타데이터가 포함되어 있습니다.');

const envJs = read('server/config/env.js');
if (/if \(!config\.adminToken\) return true/.test(envJs)) {
  failures.push('관리자 토큰 누락 시 관리자 API를 허용하는 코드가 남아 있습니다.');
}
if (!/requireAdminToken/.test(envJs)) failures.push('LIFEPASS_REQUIRE_ADMIN_TOKEN 설정이 없습니다.');

const serverIndex = read('server/index.js');
if (!/includeDrafts'\) === 'true'/.test(serverIndex)) failures.push('/api/policies includeDrafts 기본값이 명시적으로 false가 아닙니다.');
if (!/includeDrafts && !requireAdmin/.test(serverIndex)) failures.push('검수 대기 정책 조회에 관리자 인증이 필요하지 않습니다.');

const sources = read('server/config/policySources.js');
if (/id: 'bokjiro-central-welfare'[\s\S]*?useBaseEndpoint: true/.test(sources)) {
  failures.push('복지로 중앙부처 상세조회가 목록 엔드포인트 재사용 방식으로 남아 있습니다.');
}

const app = read('src/App.jsx');
if (/return collectedPolicies\s*\n\s*\.filter/.test(app)) failures.push('검수 대기 정책이 사용자 추천 목록에 섞일 수 있습니다.');
if (/localStorage\.setItem\("lifepassAdminToken"/.test(app)) failures.push('관리자 토큰을 localStorage에 영구 저장하고 있습니다.');

if (failures.length) {
  console.error('❌ 보안/배포 검증 실패');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('✅ LifePass 보안/배포 사전검증 통과');
console.log('- 실제 .env 미포함');
console.log('- node_modules/dist/.git 미포함');
console.log('- 관리자 토큰 누락 시 관리자 API 차단');
console.log('- 검수 대기 정책은 관리자 인증 없이는 조회 불가');
console.log('- 사용자 추천은 승인 정책만 사용');
console.log('- 복지로 중앙부처 상세조회는 별도 상세 URL 설정을 사용');
