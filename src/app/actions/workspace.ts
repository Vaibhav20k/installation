"use server";
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { session } from '@/server/session';
import { workspaceOf } from '@/server/workspace';
import { parseWorkspace, WORKSPACE_COOKIE } from '@/lib/workspace';
export async function selectWorkspace(value:string) {
 const {db,actor}=await session();
 const selected=parseWorkspace(value);
 const available=await workspaceOf(db,actor);
 if(!selected || !available.available.includes(selected))throw new Error('Workspace is unavailable.');
 (await cookies()).set(WORKSPACE_COOKIE,selected,{path:'/',sameSite:'lax',maxAge:31536000});
 redirect('/');
}
