// Push notification texts, sent in each phone's language (push_tokens.locale). These are the
// server-side counterpart of the app's src/i18n/locales/*.json (the Edge Functions can't import
// the app's files) - keep the wording in line with the app's "payments" texts.

export type PushLocale = 'en' | 'es' | 'fr';

export type PushMessageKey =
  | 'holdOpen'
  | 'holdOpenShareIncreased'
  | 'holdReminder'
  | 'holdFailed'
  | 'removedDeadline'
  | 'groupDissolved'
  | 'payerAssigned'
  | 'payerSetupReminder'
  | 'ridePaid'
  | 'captureFailed'
  | 'reimbursementSent'
  | 'reimbursementWaiting';

export type PushParams = {
  amount?: string;
  time?: string;
  total?: string;
  share?: string;
  fee?: string;
  released?: string;
};

type Template = { title: string; body: string };

const MESSAGES: Record<PushLocale, Record<PushMessageKey, Template>> = {
  en: {
    holdOpen: {
      title: 'Your group is confirmed!',
      body: 'Reserve your seat (€{{amount}}) before {{time}}.',
    },
    holdOpenShareIncreased: {
      title: 'Your group changed',
      body: 'Please reserve the new amount (€{{amount}}) before {{time}}.',
    },
    holdReminder: {
      title: 'Reserve your seat',
      body: 'Your seat will be released at {{time}} unless you reserve it.',
    },
    holdFailed: {
      title: 'Your card couldn’t be reserved',
      body: 'Fix it before {{time}} to keep your seat.',
    },
    removedDeadline: {
      title: 'Your seat was released',
      body: 'It wasn’t reserved in time. We’re looking for a new match.',
    },
    groupDissolved: {
      title: 'Your group was dissolved',
      body: 'Any reservation on your card was released. We’re looking for a new match.',
    },
    payerAssigned: {
      title: 'You’re paying the taxi',
      body: 'You get off last, so you pay the taxi and get the others’ shares back automatically. Set up your payout in FLOQQ.',
    },
    payerSetupReminder: {
      title: 'Set up your payout',
      body: 'Your ride is soon. Finish your payout setup in FLOQQ so we can send you the others’ shares.',
    },
    ridePaid: {
      title: 'Your ride is paid',
      body: 'Taxi €{{total}} - your share €{{share}} + €{{fee}} FLOQQ fee - paid. €{{released}} released.',
    },
    captureFailed: {
      title: 'We couldn’t charge your card',
      body: 'Your share of the taxi couldn’t be charged. FLOQQ will contact you.',
    },
    reimbursementSent: {
      title: 'Your money is on its way',
      body: '€{{amount}} on its way to you.',
    },
    reimbursementWaiting: {
      title: 'Your money is waiting for you',
      body: 'Finish your payout setup in FLOQQ and we’ll send you €{{amount}}.',
    },
  },
  es: {
    holdOpen: {
      title: '¡Tu grupo está confirmado!',
      body: 'Reserva tu plaza ({{amount}} €) antes de {{time}}.',
    },
    holdOpenShareIncreased: {
      title: 'Tu grupo ha cambiado',
      body: 'Reserva el nuevo importe ({{amount}} €) antes de {{time}}.',
    },
    holdReminder: {
      title: 'Reserva tu plaza',
      body: 'Tu plaza se liberará a las {{time}} si no la reservas.',
    },
    holdFailed: {
      title: 'No hemos podido reservar el importe en tu tarjeta',
      body: 'Soluciónalo antes de {{time}} para mantener tu plaza.',
    },
    removedDeadline: {
      title: 'Tu plaza se ha liberado',
      body: 'No se reservó a tiempo. Estamos buscando un nuevo grupo para ti.',
    },
    groupDissolved: {
      title: 'Tu grupo se ha disuelto',
      body: 'Cualquier reserva en tu tarjeta se ha liberado. Estamos buscando un nuevo grupo para ti.',
    },
    payerAssigned: {
      title: 'Tú pagas el taxi',
      body: 'Eres el último en bajar, así que pagas el taxi y recibes automáticamente la parte de los demás. Configura tu cobro en FLOQQ.',
    },
    payerSetupReminder: {
      title: 'Configura tu cobro',
      body: 'Tu viaje es pronto. Termina de configurar tu cobro en FLOQQ para que podamos enviarte la parte de los demás.',
    },
    ridePaid: {
      title: 'Tu viaje está pagado',
      body: 'Taxi {{total}} € - tu parte {{share}} € + {{fee}} € de tarifa FLOQQ - pagado. {{released}} € liberados.',
    },
    captureFailed: {
      title: 'No hemos podido cobrar tu tarjeta',
      body: 'No se ha podido cobrar tu parte del taxi. FLOQQ se pondrá en contacto contigo.',
    },
    reimbursementSent: {
      title: 'Tu dinero está en camino',
      body: '{{amount}} € en camino hacia ti.',
    },
    reimbursementWaiting: {
      title: 'Tu dinero te está esperando',
      body: 'Termina de configurar tu cobro en FLOQQ y te enviaremos {{amount}} €.',
    },
  },
  fr: {
    holdOpen: {
      title: 'Votre groupe est confirmé !',
      body: 'Réservez votre place ({{amount}} €) avant {{time}}.',
    },
    holdOpenShareIncreased: {
      title: 'Votre groupe a changé',
      body: 'Veuillez réserver le nouveau montant ({{amount}} €) avant {{time}}.',
    },
    holdReminder: {
      title: 'Réservez votre place',
      body: 'Votre place sera libérée à {{time}} si vous ne la réservez pas.',
    },
    holdFailed: {
      title: 'Impossible de réserver le montant sur votre carte',
      body: 'Corrigez-le avant {{time}} pour garder votre place.',
    },
    removedDeadline: {
      title: 'Votre place a été libérée',
      body: 'Elle n’a pas été réservée à temps. Nous cherchons un nouveau groupe pour vous.',
    },
    groupDissolved: {
      title: 'Votre groupe a été dissous',
      body: 'Toute réservation sur votre carte a été libérée. Nous cherchons un nouveau groupe pour vous.',
    },
    payerAssigned: {
      title: 'C’est vous qui payez le taxi',
      body: 'Vous descendez en dernier : vous payez le taxi et récupérez automatiquement la part des autres. Configurez votre versement dans FLOQQ.',
    },
    payerSetupReminder: {
      title: 'Configurez votre versement',
      body: 'Votre trajet approche. Terminez la configuration de votre versement dans FLOQQ pour que nous puissions vous envoyer la part des autres.',
    },
    ridePaid: {
      title: 'Votre trajet est payé',
      body: 'Taxi {{total}} € - votre part {{share}} € + {{fee}} € de frais FLOQQ - payé. {{released}} € libérés.',
    },
    captureFailed: {
      title: 'Impossible de débiter votre carte',
      body: 'Votre part du taxi n’a pas pu être débitée. FLOQQ vous contactera.',
    },
    reimbursementSent: {
      title: 'Votre argent est en route',
      body: '{{amount}} € en route vers vous.',
    },
    reimbursementWaiting: {
      title: 'Votre argent vous attend',
      body: 'Terminez la configuration de votre versement dans FLOQQ et nous vous enverrons {{amount}} €.',
    },
  },
};

// Rides are all at Barcelona-El Prat, so times are shown in Barcelona time (same as the admin
// dashboard, see src/utils/formatDateTime.ts).
const TIME_ZONE = 'Europe/Madrid';

export function formatPushTime(iso: string, locale: PushLocale): string {
  return new Date(iso).toLocaleTimeString(locale, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
}

export function renderPushMessage(key: PushMessageKey, locale: PushLocale, params: PushParams): Template {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES.en[key];
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, name: keyof PushParams) => params[name] ?? '');
  return { title: fill(template.title), body: fill(template.body) };
}
