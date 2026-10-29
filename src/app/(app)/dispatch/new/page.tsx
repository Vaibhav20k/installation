import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { dispatchableOrders } from "@/server/queries/dispatch";
import { Notice, PageHeader } from "@/components/ui/Notice";
import { NewDispatchForm } from "@/components/dispatch/NewDispatchForm";

export const metadata = { title: "Ready for dispatch" };

export default async function NewDispatch({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const data = await dispatchableOrders(db, actor);
  if (!data.canCreate) return <Notice tone="warn" title="Not permitted">Marking an order ready for dispatch is done by Factory / Dispatch.</Notice>;
  return (
    <div className="stack flow-page">
      <Link href="/dispatch" className="small back-link"><CaretLeft size={14} aria-hidden /> Dispatch</Link>
      <PageHeader title="Ready for dispatch" subtitle="Choose the order and what is going on this truck. Each dispatch runs its own installation cycle." />
      <section className="plate"><NewDispatchForm orders={data.orders} types={data.types} factories={data.factories} initialOrder={sp.order} /></section>
    </div>
  );
}
