import { DEFAULT_LOCALE, LOCALES, negotiateLocale, resources, type Traductions } from '@tick/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'tick.locale';

/**
 * Les ressources vivent dans `@tick/i18n`, partagé avec l'API et, demain, avec
 * les plugins : une clé de traduction doit désigner la même chose partout.
 */
await i18next.use(initReactI18next).init({
  lng: negotiateLocale(localStorage.getItem(STORAGE_KEY), navigator.language),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...LOCALES],
  resources: Object.fromEntries(
    Object.entries(resources).map(([langue, traductions]) => [
      langue,
      { translation: traductions },
    ]),
  ),
  interpolation: { escapeValue: false },
});

export function changeLocale(locale: string): void {
  void i18next.changeLanguage(locale);
  localStorage.setItem(STORAGE_KEY, locale);
}

/** Typage des clés : `t('entites.titre')` est vérifié à la compilation. */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Traductions };
  }
}

export default i18next;
