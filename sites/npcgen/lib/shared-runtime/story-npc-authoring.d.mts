export function episodeNpcIds(episode:Record<string,unknown>):string[];
export function modelEpisodeSeed(id:string,ids:string[],allowed:string[],characterFree?:boolean):{id:string;planning:{schemaVersion:string;participantNpcIds:string[];characterFree:boolean}};
