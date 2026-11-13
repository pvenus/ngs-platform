import { requireChatGPTUser } from './chatgpt-auth';
import CatalogHome from './catalog/home';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');return <CatalogHome displayName={user.displayName}/>;}
