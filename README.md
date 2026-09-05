# STEPFLOW v3 실배포 버전

공부방 출결 + 공부시간 기록 + 장기/월간/주간/일간 플래닝 + 캘린더 + 중요 이벤트 + 인강 루틴 + 진행상황/로드맵 + 관리자 화면을 포함한 서버형 버전입니다.

## 계정
- 학생 1: `hy`
- 학생 2: `yjw`
- 관리자: `nyj5004`

요청대로 비밀번호 없이 아이디만 입력하면 해당 계정으로 접속합니다.
학생 계정은 본인 데이터만 접근할 수 있고 관리자 계정만 전체 학생 데이터를 조회할 수 있습니다.

## 데이터 저장
- 서버 데이터: `${DATA_DIR}/stepflow-state.json`
- 로그인 서명키: `${DATA_DIR}/stepflow-auth-secret.txt`
- 푸시알림 VAPID 키: `${DATA_DIR}/stepflow-vapid.json`

Railway에서는 반드시 Volume을 `/app/data`에 마운트하고 `DATA_DIR=/app/data`를 설정하세요.

## Railway 배포
1. GitHub에 새 저장소(예: `STEPFLOW`)를 만듭니다.
2. 이 폴더의 내용을 저장소 루트에 그대로 업로드하고 Commit 합니다.
3. Railway → New Project → Deploy from GitHub repo → STEPFLOW 저장소를 선택합니다.
4. Railway 프로젝트 캔버스에서 Volume을 추가하고 STEPFLOW 서비스에 연결합니다.
5. Volume Mount Path를 `/app/data`로 설정합니다.
6. 서비스 Variables에 `DATA_DIR=/app/data`를 추가합니다.
7. `PORT`는 Railway가 자동으로 주므로 직접 만들지 않습니다.
8. Deployment successful 이후 Settings/Networking에서 Generate Domain을 눌러 주소를 만듭니다.

## 관리자 모바일 출결 알림
관리자 `nyj5004`로 로그인 → 상단 `출결 알림 켜기`를 누릅니다.

- Android/Chrome: 알림 권한 허용 후 푸시 수신 가능
- iPhone/iPad: Safari에서 먼저 `공유 → 홈 화면에 추가`로 STEPFLOW를 홈 화면에 설치한 뒤, 홈 화면 앱으로 실행해서 `출결 알림 켜기`를 누르는 방식 권장
- 푸시 사용이 불가능한 환경에서도 관리자 화면의 `최근 알림`에는 입실/퇴실 기록이 서버에 계속 쌓입니다.

## 포함 기능
- 학생별 서버 데이터 완전 분리
- 입실/퇴실 기록 및 관리자 알림
- 공부 시작/종료 타이머와 공부 내용/집중도 기록
- 장기 → 월간 → 주간 → 일간 계획 연결
- 날짜 하나 선택 / 요일 반복 일간계획
- 주간 목표를 선택 요일에 자동 분배
- 수량/페이지/인강/시간/완료형 계획
- 부분 달성 및 남은 분량 이월
- 월간/주간 캘린더
- 모의고사/시험/수행평가/과제/상담 등의 중요 이벤트와 기간 일정
- 관리자 전체/학생별 중요 이벤트 등록
- 인강 반복 요일/시간 루틴
- 최근 공부 리듬, 과목별 진행도, 연속 공부일
- 기간형 장기/월간/주간 계획의 간트형 공부 로드맵
- PWA 홈 화면 설치 및 관리자 Web Push 지원

## 보안 참고
현재는 사용 요청에 따라 ID-only 로그인입니다. 아이디를 아는 사람은 해당 계정으로 로그인할 수 있으므로, 외부 공개 운영 시에는 관리자 PIN 또는 학생별 PIN 추가를 권장합니다.
