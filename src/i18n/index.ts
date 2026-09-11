import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
};

const supportedLanguages = Object.keys(resources);
const deviceLanguage = getLocales()[0]?.languageCode ?? 'en';
const initialLanguage = supportedLanguages.includes(deviceLanguage) ? deviceLanguage : 'en';

i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
