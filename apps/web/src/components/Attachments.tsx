import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';

function taille(octets: number): string {
  if (octets < 1024) return `${String(octets)} o`;
  if (octets < 1024 * 1024) return `${String(Math.round(octets / 1024))} Ko`;

  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Pièces jointes d'un objet.
 *
 * Le téléchargement passe par l'API et non par un lien statique : le contenu
 * est servi après vérification du périmètre, et jamais depuis un chemin
 * devinable.
 */
export function Attachments({ itemType, itemId }: { itemType: string; itemId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const champ = useRef<HTMLInputElement>(null);

  const pieces = useQuery({
    queryKey: ['attachments', itemType, itemId],
    queryFn: () => api.attachments(itemType, itemId),
    retry: false,
  });

  const rafraichir = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['attachments', itemType, itemId] });

  const envoyer = useMutation({
    mutationFn: (fichier: File) => api.upload(itemType, itemId, fichier),
    onSuccess: async () => {
      if (champ.current) champ.current.value = '';
      await rafraichir();
    },
  });

  const retirer = useMutation({
    mutationFn: (id: number) => api.deleteAttachment(id),
    onSuccess: rafraichir,
  });

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="text-sm font-semibold">{t('pieces.titre')}</h3>

      {pieces.data && pieces.data.length === 0 && (
        <p className="text-sm text-neutral-500">{t('pieces.aucune')}</p>
      )}

      <ul className="space-y-1">
        {(pieces.data ?? []).map((piece) => (
          <li key={piece.id} className="flex items-center gap-2 text-sm">
            <a
              href={`/api/documents/${String(piece.id)}/content`}
              className="underline-offset-2 hover:underline"
            >
              {piece.name}
            </a>
            <span className="text-xs text-neutral-500">
              {taille(piece.size)}
              {piece.uploadedBy ? ` · ${piece.uploadedBy}` : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                retirer.mutate(piece.id);
              }}
              className="ml-auto text-xs text-neutral-400 hover:text-red-600"
              title={t('pieces.supprimer')}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input
          ref={champ}
          type="file"
          onChange={(event) => {
            const fichier = event.target.files?.[0];

            if (fichier) envoyer.mutate(fichier);
          }}
          className="text-xs file:mr-2 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-2 file:py-1 file:text-xs dark:file:border-neutral-700"
        />
        {envoyer.isPending && (
          <span className="text-xs text-neutral-500">{t('commun.chargement')}</span>
        )}
      </div>

      {envoyer.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{envoyer.error.message}</p>
      )}
    </section>
  );
}
