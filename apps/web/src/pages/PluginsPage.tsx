import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PluginSettingValue,
  PluginSettingView,
  PluginState,
  PluginStatus,
} from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACTION_LIGNE,
  ACTION_LIGNE_DANGER,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  FieldError,
  Input,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';
import { cn } from '@/lib/utils';

const TONS: Record<PluginState, 'neutre' | 'info' | 'positif' | 'attention' | 'critique'> = {
  decouvert: 'neutre',
  installe: 'info',
  actif: 'positif',
  inactif: 'attention',
  erreur: 'critique',
};

/** i18next lit « : » comme un séparateur d'espace de noms : la clé ne peut pas le porter. */
function clePermission(permission: string): string {
  return `administration.extensions.permissions.${permission.replaceAll(':', '_')}`;
}

/**
 * Extensions.
 *
 * Les plugins se déposent sur le serveur ; l'écran ne les téléverse pas. Il dit
 * ce que chacun **demande** avant qu'on l'installe — c'est la raison d'être des
 * permissions déclarées —, pilote son cycle de vie, et affiche les réglages que
 * son manifeste déclare. Le plugin n'a aucun écran à dessiner pour cela.
 */
export function PluginsPage() {
  const { t } = useTranslation();
  const peutEcrire = usePeut('plugin', 'update');
  const peutSupprimer = usePeut('plugin', 'delete');
  const queryClient = useQueryClient();
  const [reglagesOuverts, setReglagesOuverts] = useState<string | null>(null);

  const liste = useQuery({ queryKey: ['plugins'], queryFn: api.plugins, retry: false });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['plugins'] });
  };

  const agir = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'install' | 'activate' | 'deactivate' }) =>
      api.pluginAction(id, action),
    onSuccess: rafraichir,
  });

  const desinstaller = useMutation({
    mutationFn: (id: string) => api.uninstallPlugin(id),
    onSuccess: rafraichir,
  });

  const interdit = liste.error instanceof ApiError && liste.error.status === 403;
  const occupe = agir.isPending || desinstaller.isPending;

  const actions = (plugin: PluginStatus) => {
    const bouton = (action: 'install' | 'activate' | 'deactivate', libelle: string) => (
      <Button
        key={action}
        taille="sm"
        variante={action === 'deactivate' ? 'secondaire' : 'primaire'}
        disabled={occupe || (action !== 'deactivate' && !plugin.compatible)}
        onClick={() => {
          agir.mutate({ id: plugin.id, action });
        }}
      >
        {libelle}
      </Button>
    );

    switch (plugin.state) {
      case 'decouvert':
        return [bouton('install', t('administration.extensions.installer'))];
      case 'installe':
      case 'inactif':
        return [bouton('activate', t('administration.extensions.activer'))];
      case 'actif':
        return [bouton('deactivate', t('administration.extensions.desactiver'))];
      case 'erreur':
        return [bouton('activate', t('administration.extensions.reactiver'))];
    }
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('administration.extensions.titre')}
        description={t('administration.extensions.description')}
      />

      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}

      {liste.data && liste.data.length === 0 && (
        <EmptyState title={t('administration.extensions.aucune')} />
      )}

      <div className="space-y-3">
        {(liste.data ?? []).map((plugin) => (
          <Card key={plugin.id}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{plugin.name}</h3>
                <span className="font-mono text-xs text-faint">{plugin.version}</span>
                <Badge ton={TONS[plugin.state]}>
                  {t(`administration.extensions.etats.${plugin.state}`)}
                </Badge>
              </div>

              {plugin.description && <p className="text-sm text-muted">{plugin.description}</p>}

              {!plugin.compatible && (
                <Notice ton="critique">
                  {t('administration.extensions.incompatible', { plage: plugin.sdkRange })}
                </Notice>
              )}

              <div className="space-y-1">
                <p className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                  {t('administration.extensions.demandes')}
                </p>
                {plugin.permissions.length === 0 ? (
                  <p className="text-xs text-muted">
                    {t('administration.extensions.aucuneDemande')}
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {plugin.permissions.map((permission) => (
                      <li key={permission}>
                        <Badge ton={permission === 'http:outbound' ? 'attention' : 'neutre'}>
                          {t(clePermission(permission), { defaultValue: permission })}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {plugin.lastError && (
                <Notice ton="critique">
                  {t('administration.extensions.derniereErreur')} : {plugin.lastError}
                </Notice>
              )}

              {(peutEcrire || peutSupprimer || plugin.hasSettings) && (
                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  {peutEcrire && actions(plugin)}
                  {plugin.hasSettings && plugin.state !== 'decouvert' && (
                    <button
                      type="button"
                      className={ACTION_LIGNE}
                      aria-expanded={reglagesOuverts === plugin.id}
                      onClick={() => {
                        setReglagesOuverts(reglagesOuverts === plugin.id ? null : plugin.id);
                      }}
                    >
                      {t('administration.extensions.reglages')}
                    </button>
                  )}
                  {peutSupprimer && plugin.state !== 'decouvert' && plugin.state !== 'actif' && (
                    <button
                      type="button"
                      className={cn(ACTION_LIGNE_DANGER, 'ml-auto')}
                      disabled={occupe}
                      onClick={() => {
                        if (
                          globalThis.confirm(
                            t('administration.extensions.confirmerDesinstallation', {
                              nom: plugin.name,
                            }),
                          )
                        ) {
                          desinstaller.mutate(plugin.id);
                        }
                      }}
                    >
                      {t('administration.extensions.desinstaller')}
                    </button>
                  )}
                </div>
              )}

              {reglagesOuverts === plugin.id && (
                <ReglagesPlugin pluginId={plugin.id} modifiable={peutEcrire} />
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      <FieldError>{agir.error?.message ?? desinstaller.error?.message}</FieldError>
    </section>
  );
}

/**
 * Les réglages d'un plugin, pour un niveau : l'instance, ou une entité.
 *
 * Seules les valeurs **touchées** partent au serveur. Un secret, que l'API ne
 * renvoie jamais, ne peut donc pas être effacé par un enregistrement qui n'y
 * touche pas : son champ reste vide, et vide veut dire « inchangé ».
 */
function ReglagesPlugin({ pluginId, modifiable }: { pluginId: string; modifiable: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [entite, setEntite] = useState<number | null>(null);
  const [saisie, setSaisie] = useState<Record<string, PluginSettingValue | null>>({});
  const [enregistre, setEnregistre] = useState(false);

  const entites = useQuery({ queryKey: ['entities'], queryFn: api.entities });
  const vue = useQuery({
    queryKey: ['plugin-settings', pluginId, entite],
    queryFn: () => api.pluginSettings(pluginId, entite),
  });

  const enregistrer = useMutation({
    mutationFn: () => api.savePluginSettings(pluginId, { entityId: entite, values: saisie }),
    onSuccess: async () => {
      setSaisie({});
      setEnregistre(true);
      await queryClient.invalidateQueries({ queryKey: ['plugin-settings', pluginId] });
    },
  });

  /** `undefined` : la valeur redevient celle du serveur, et ne partira pas. */
  const changer = (cle: string, valeur: PluginSettingValue | null | undefined): void => {
    setEnregistre(false);
    setSaisie((avant) => {
      const apres = { ...avant };

      if (valeur === undefined) delete apres[cle];
      else apres[cle] = valeur;

      return apres;
    });
  };

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (Object.keys(saisie).length > 0) enregistrer.mutate();
  };

  const aide = (reglage: PluginSettingView): string | undefined => {
    const origine = reglage.inherited;

    if (reglage.type === 'secret') {
      if (reglage.isSet) return t('administration.extensions.secretEnregistre');
      if (origine) {
        return t('administration.extensions.secretHeriteDe', { entite: origine.fromEntityName });
      }

      return t('administration.extensions.secretAbsent');
    }

    const lisible = (valeur: PluginSettingValue): string =>
      typeof valeur === 'boolean'
        ? t(valeur ? 'administration.extensions.oui' : 'administration.extensions.non')
        : String(valeur);

    const parts = [reglage.description];

    if (origine?.value !== null && origine?.value !== undefined) {
      parts.push(
        t('administration.extensions.heriteDe', {
          entite: origine.fromEntityName,
          valeur: lisible(origine.value),
        }),
      );
    } else if (reglage.default !== null) {
      parts.push(t('administration.extensions.parDefaut', { valeur: lisible(reglage.default) }));
    }

    return parts.filter(Boolean).join(' · ') || undefined;
  };

  const champ = (reglage: PluginSettingView) => {
    const touche = Object.hasOwn(saisie, reglage.key);
    const actuelle = touche ? saisie[reglage.key] : reglage.value;

    switch (reglage.type) {
      case 'secret':
        return (
          <Input
            type="password"
            autoComplete="new-password"
            disabled={!modifiable}
            value={typeof saisie[reglage.key] === 'string' ? (saisie[reglage.key] as string) : ''}
            onChange={(event) => {
              changer(reglage.key, event.target.value === '' ? undefined : event.target.value);
            }}
          />
        );

      case 'boolean':
      case 'enum': {
        const options =
          reglage.type === 'boolean'
            ? [
                { valeur: 'true', libelle: t('administration.extensions.oui') },
                { valeur: 'false', libelle: t('administration.extensions.non') },
              ]
            : (reglage.options ?? []).map((option) => ({ valeur: option, libelle: option }));

        return (
          <Select
            disabled={!modifiable}
            value={actuelle === null || actuelle === undefined ? '' : String(actuelle)}
            onChange={(event) => {
              const brute = event.target.value;

              if (brute === '') changer(reglage.key, reglage.isSet ? null : undefined);
              else changer(reglage.key, reglage.type === 'boolean' ? brute === 'true' : brute);
            }}
          >
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.valeur} value={option.valeur}>
                {option.libelle}
              </option>
            ))}
          </Select>
        );
      }

      default:
        return (
          <Input
            type={reglage.type === 'number' ? 'number' : 'text'}
            disabled={!modifiable}
            min={reglage.min ?? undefined}
            max={reglage.max ?? undefined}
            value={actuelle === null || actuelle === undefined ? '' : String(actuelle)}
            onChange={(event) => {
              const brute = event.target.value;

              if (brute === '') changer(reglage.key, reglage.isSet ? null : undefined);
              else changer(reglage.key, reglage.type === 'number' ? Number(brute) : brute);
            }}
          />
        );
    }
  };

  const reglages = vue.data?.settings ?? [];

  return (
    <form onSubmit={soumettre} className="space-y-4 rounded-lg border border-line p-4">
      <Field label={t('administration.extensions.niveau')} className="max-w-md">
        <Select
          value={entite === null ? '' : String(entite)}
          onChange={(event) => {
            setEntite(event.target.value === '' ? null : Number(event.target.value));
            setSaisie({});
            setEnregistre(false);
          }}
        >
          <option value="">{t('administration.extensions.instance')}</option>
          {[...(entites.data ?? [])]
            .sort((a, b) => a.completeName.localeCompare(b.completeName))
            .map((entiteListee) => (
              <option key={entiteListee.id} value={entiteListee.id}>
                {entiteListee.completeName}
              </option>
            ))}
        </Select>
      </Field>

      {vue.data && reglages.length === 0 && (
        <p className="text-sm text-muted">{t('administration.extensions.aucunReglageIci')}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {reglages.map((reglage) => (
          <div key={reglage.key} className="space-y-1">
            <Field label={reglage.label} hint={aide(reglage)}>
              {champ(reglage)}
            </Field>
            {modifiable && reglage.isSet && saisie[reglage.key] !== null && (
              <button
                type="button"
                className={ACTION_LIGNE}
                onClick={() => {
                  changer(reglage.key, null);
                }}
              >
                {t('administration.extensions.retirer')}
              </button>
            )}
          </div>
        ))}
      </div>

      {enregistre && <Notice ton="positif">{t('administration.extensions.enregistre')}</Notice>}
      <FieldError>{vue.error?.message ?? enregistrer.error?.message}</FieldError>

      {modifiable && reglages.length > 0 && (
        <div className="flex justify-end">
          <Button
            type="submit"
            variante="primaire"
            disabled={enregistrer.isPending || Object.keys(saisie).length === 0}
          >
            {t('administration.extensions.enregistrer')}
          </Button>
        </div>
      )}
    </form>
  );
}
