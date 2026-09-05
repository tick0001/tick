import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionContext } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';

interface Props {
  session: SessionContext;
}

/**
 * Sélecteur d'entité et de profil actifs.
 *
 * Chaque option est une habilitation, c'est-à-dire un couple entité + profil,
 * jamais l'un sans l'autre : le même utilisateur peut être technicien sur une
 * branche et simple demandeur sur une autre, et ses droits changent avec le
 * profil, pas seulement avec l'entité.
 */
export function ContextSwitcher({ session }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const bascule = useMutation({
    mutationFn: (valeur: string) => {
      const [entityId, profileId] = valeur.split(':').map(Number);

      return api.switchContext({
        entityId: entityId as number,
        profileId: profileId as number,
        includeSubEntities: true,
      });
    },
    onSuccess: (nouvelle) => {
      // Les données en cache viennent du périmètre précédent. Les invalider ne
      // suffit pas : le cache resterait affiché pendant le rechargement, et
      // continuerait de l'être si la nouvelle requête est refusée. On les
      // supprime, pour qu'il soit impossible de voir un instant les données
      // d'une entité que l'on vient de quitter.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      queryClient.setQueryData(['session'], nouvelle);
    },
  });

  const courant = `${String(session.entity.id)}:${String(session.profile.id)}`;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('session.changerContexte')}</span>
      <select
        value={courant}
        disabled={bascule.isPending || session.available.length < 2}
        onChange={(event) => {
          bascule.mutate(event.target.value);
        }}
        className="max-w-xs rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      >
        {session.available.map((habilitation) => (
          <option
            key={`${String(habilitation.entity.id)}:${String(habilitation.profile.id)}`}
            value={`${String(habilitation.entity.id)}:${String(habilitation.profile.id)}`}
          >
            {habilitation.entity.completeName} — {habilitation.profile.name}
          </option>
        ))}
      </select>
      {session.includeSubEntities && (
        <span
          title={t('session.sousEntites')}
          className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {t('session.badgeSousEntites')}
        </span>
      )}
    </label>
  );
}
