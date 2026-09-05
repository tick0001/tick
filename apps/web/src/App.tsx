import { useQuery } from '@tanstack/react-query';
import { healthSchema, type Health } from '@tick/contracts';

async function fetchHealth(): Promise<Health> {
  const response = await fetch('/api/health');
  if (!response.ok) throw new Error(`API injoignable (${response.status})`);
  return healthSchema.parse(await response.json());
}

export function App() {
  const { data, error, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Tick&amp;</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Outil de ticketing ITSM. Jalon J0 : fondations.
      </p>

      <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        {isPending && <span className="text-neutral-500">Interrogation de l&apos;API…</span>}
        {error && <span className="text-red-600 dark:text-red-400">{error.message}</span>}
        {data && (
          <span className="text-emerald-700 dark:text-emerald-400">
            API disponible — version {data.version}, active depuis {data.uptimeSeconds}&nbsp;s
          </span>
        )}
      </div>
    </main>
  );
}
