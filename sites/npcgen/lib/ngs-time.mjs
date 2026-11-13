// A build timestamp is displayed in UTC on both the server and client.
export function formatBuildTimeUtc(value) {
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return '시각 확인 불가';
 return date.toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
}
