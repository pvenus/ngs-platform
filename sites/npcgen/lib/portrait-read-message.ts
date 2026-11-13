export function portraitReadMessage(status:number,fallback:string){return status===401?'로그인 상태를 확인한 뒤 다시 열어주세요.':status===403?'현재 계정은 이 포트레이트를 조회할 수 없습니다.':fallback+' 잠시 후 목록을 다시 열어주세요.';}
