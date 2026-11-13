import {requireChatGPTUser} from '../chatgpt-auth';
import IntakeWorkspace from '../intake-workspace';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/transfers');return <IntakeWorkspace displayName={user.displayName}/>;}
