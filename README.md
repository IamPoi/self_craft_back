# Selfcraft Backend API

Node.js + Express + MariaDB 백엔드 API 서버

## 🚀 시작하기

### 1. 패키지 설치
```bash
cd backend
npm install
```

### 2. 환경설정
`.env` 파일에서 DB 비밀번호 설정:
```env
DB_PASSWORD=실제비밀번호입력
```

### 3. 서버 실행
```bash
# 개발 모드 (nodemon)
npm run dev

# 프로덕션 모드
npm start
```

## 📊 API 엔드포인트

### 🔐 인증 API (`/api/auth`)
- `POST /guest` - 게스트 사용자 생성
- `POST /google` - 구글 로그인/회원가입
- `POST /migrate-guest` - 게스트 → 구글 계정 전환
- `GET /verify` - 토큰 검증

### 👤 사용자 API (`/api/users`)
- `GET /me` - 사용자 정보 조회
- `PUT /me` - 사용자 정보 수정
- `GET /stats` - 사용자 통계
- `POST /add-exp` - 경험치 추가
- `GET /ranking` - 랭킹 조회

### ⏱️ 타이머 로그 API (`/api/work-logs`)
- `POST /start` - 타이머 시작
- `POST /stop/:work_id` - 타이머 종료
- `GET /active` - 진행 중인 세션 조회
- `GET /` - 작업 로그 목록
- `GET /:work_id` - 특정 로그 조회
- `PUT /:work_id` - 로그 수정
- `DELETE /:work_id` - 로그 삭제
- `GET /stats/category` - 카테고리별 통계

### 🏆 뱃지 API (`/api/badges`)
- `GET /` - 뱃지 목록 조회
- `POST /` - 뱃지 추가
- `GET /:badge_id` - 뱃지 상세
- `PUT /:badge_id` - 뱃지 수정
- `DELETE /:badge_id` - 뱃지 삭제
- `GET /stats/summary` - 뱃지 통계
- `POST /check-auto-badges` - 자동 뱃지 체크

## 🗄️ 데이터베이스

### 연결 정보
- Host: `svc.sel5.cloudtype.app`
- Port: `31767`
- Database: `self_craft`
- User: `ckddbs12`

### 테이블 구조
- `user` - 사용자 정보
- `work_log` - 타이머 작업 로그
- `badge` - 사용자 뱃지
- `guest_temp_log` - 게스트 임시 로그 (선택)
- `daily_goal` - 일일 목표 (선택)

## 🔒 인증

JWT 토큰 기반 인증 사용:
```
Authorization: Bearer <token>
```

## 📝 사용 예시

### 게스트 사용자 생성
```bash
curl -X POST http://localhost:3000/api/auth/guest
```

### 타이머 시작
```bash
curl -X POST http://localhost:3000/api/work-logs/start \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"category": "STUDY", "title": "React 학습"}'
```

### 사용자 통계 조회
```bash
curl -X GET http://localhost:3000/api/users/stats \
  -H "Authorization: Bearer <token>"
```

## 🛠️ 개발 팁

1. **API 테스트**: Postman이나 curl 사용
2. **로그 확인**: 서버 콘솔에서 실시간 로그 확인
3. **DB 확인**: HeidiSQL, phpMyAdmin 등 GUI 도구 사용
4. **에러 처리**: 모든 API는 `{ success: true/false }` 형태로 응답

## 🚨 주의사항

1. **JWT_SECRET**: 프로덕션에서 반드시 변경
2. **CORS**: 필요에 따라 cors 설정 수정
3. **비밀번호**: .env 파일은 Git에 커밋하지 않기
4. **포트**: 3000번 포트가 사용 중이면 PORT 환경변수 변경