"use client";
import { useFormStatus } from 'react-dom';
export function SignInButton({children}:{children:React.ReactNode}) {
 const {pending}=useFormStatus();
 return <button type="submit" disabled={pending} aria-busy={pending}>{children}{pending && <span role="status">Opening…</span>}</button>;
}
