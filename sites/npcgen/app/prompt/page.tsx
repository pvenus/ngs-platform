import {requireChatGPTUser} from '../chatgpt-auth';
import PromptWorkspace from './workspace';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/prompt');return <PromptWorkspace displayName={user.displayName}/>;}
