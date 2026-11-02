'use client';
import { useRouter } from 'next/navigation';
import { createPreventiveProject, advancePreventiveProject, saveDesignation, assignDesignation } from '@/app/actions/operations';
import { useAction } from '@/components/ui/useAction';
import { ResultNotice } from '@/components/ui/ResultNotice';
export function CreatePreventive({ complaintId, people }: {
    complaintId: string;
    people: {
        id: string;
        name: string;
    }[];
}) { const router = useRouter(); const a = useAction(createPreventiveProject, { refresh: false, onSuccess: d => router.push(`/preventive-actions/${(d as {
        id: string;
    }).id}`) }); return <details><summary>Create preventive action project</summary><form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ complaintId, ownerId: f.get('owner'), deadline: f.get('deadline'), description: f.get('description'), steps: String(f.get('steps')).split('\n').map(s => s.trim()).filter(Boolean) }); }}><label className="field">Preventive action<textarea name="description" required minLength={3}/></label><label className="field">Owner<select name="owner">{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Deadline<input type="date" name="deadline" required/></label><label className="field">Steps (one per line)<textarea name="steps" required minLength={3}/></label><button disabled={a.pending}>Create action project</button><ResultNotice result={a.result}/></form></details>; }
export function ProgressPreventive({ id, version, state, steps }: {
    id: string;
    version: number;
    state: string;
    steps: {
        text: string;
        done: boolean;
    }[];
}) { const a = useAction(advancePreventiveProject); const next = ({ open: 'in_progress', in_progress: 'done', done: 'verified' } as Record<string, string>)[state]; if (!next)
    return null; return <form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ id, version, state: next, comment: f.get('comment'), completedSteps: f.getAll('steps').map(Number) }); }}>{state === 'in_progress' && <fieldset><legend>Confirm completed steps</legend>{steps.map((s, i) => <label className="check" key={i}><input name="steps" type="checkbox" value={i} required/>{s.text}</label>)}</fieldset>}<label className="field">Evidence / comment<textarea name="comment" required minLength={3}/></label><button className="primary" disabled={a.pending}>Mark {next.replaceAll('_', ' ')}</button><ResultNotice result={a.result}/></form>; }
export function DesignationForms({ people, designations }: {
    people: {
        id: string;
        name: string;
    }[];
    designations: {
        code: string;
        name: string;
    }[];
}) { const save = useAction(saveDesignation), assign = useAction(assignDesignation); return <details><summary>Staff designation master</summary><form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save.run({ code: f.get('code'), name: f.get('name') }); }}><label className="field">Code<input name="code" pattern="[a-z][a-z0-9_]+" required/></label><label className="field">Name<input name="name" required minLength={2}/></label><button disabled={save.pending}>Save designation</button><ResultNotice result={save.result}/></form><form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); assign.run({ employeeId: f.get('employee'), code: f.get('code') }); }}><label className="field">Employee<select name="employee">{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Designation<select name="code">{designations.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label><button disabled={assign.pending}>Assign designation</button><ResultNotice result={assign.result}/></form></details>; }
