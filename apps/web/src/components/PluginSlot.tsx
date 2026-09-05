import type { SlotContext, SlotName } from '@tick/plugin-sdk/client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { entriesFor, subscribeToSlots, type LoadedSlotEntry } from '@/lib/plugins';

interface Props {
  name: SlotName;
  context: SlotContext;
  className?: string;
}

/**
 * Point d'extension d'interface.
 *
 * Le contenu d'un plugin est rendu dans un élément que React possède mais ne
 * touche plus : le plugin y écrit du DOM directement. React ne doit pas
 * réconcilier ces enfants, d'où l'élément dédié par entrée.
 */
function PluginSlotEntry({ entry, context }: { entry: LoadedSlotEntry; context: SlotContext }) {
  const conteneur = useRef<HTMLSpanElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const element = conteneur.current;
    if (!element) return;

    let nettoyage: (() => void) | void;
    let demonte = false;

    const rendre = async (): Promise<void> => {
      try {
        const resultat = await entry.render(element, context);

        if (demonte) {
          resultat?.();

          return;
        }

        nettoyage = resultat;
      } catch (cause) {
        // Une extension défaillante ne doit pas casser la page qui l'accueille.
        console.error(`Plugin « ${entry.pluginId} » : rendu impossible.`, cause);
        setErreur(entry.pluginId);
      }
    };

    void rendre();

    return () => {
      demonte = true;
      nettoyage?.();
      element.replaceChildren();
    };
  }, [entry, context]);

  if (erreur) return null;

  return <span ref={conteneur} data-plugin={entry.pluginId} />;
}

export function PluginSlot({ name, context, className }: Props) {
  const entrees = useSyncExternalStore(
    subscribeToSlots,
    () => entriesFor(name),
    () => entriesFor(name),
  );

  if (entrees.length === 0) return null;

  return (
    <span className={className}>
      {entrees.map((entry) => (
        <PluginSlotEntry key={`${entry.pluginId}:${entry.id}`} entry={entry} context={context} />
      ))}
    </span>
  );
}
