// The pure rules behind the help assistant's actions (help-chat): what a cancel card says will
// happen - the same as the app's own cancel screens - the fixed texts after a decision, and when a
// resolved conversation reopens. No imports, so a plain Node test (helpActions.test.ts) runs it.

export type HelpLanguage = 'en' | 'fr' | 'es';

// What cancelling the ride does to the passenger's money, exactly as the app's cancel screens work
// it out: still searching (FindingMatchScreen - nothing to pay); a seat reserved more than 24 hours
// before the ride (free, the whole reservation released); a seat reserved within 24 hours (the
// FLOQQ fee is kept, the rest released); nothing reserved (nothing charged) - CancelConfirmedRide.
export type CancelConsequence =
  | { kind: 'searching' }
  | { kind: 'free'; releasedCents: number }
  | { kind: 'fee_kept'; feeCents: number; releasedCents: number }
  | { kind: 'no_charge' };

export type CancelFacts = {
  groupId: string | null;
  payment: { status: string; holdCents: number; feeCents: number; freeCancelUntil: string | null } | null;
};

export function cancelConsequence(facts: CancelFacts, nowMs: number): CancelConsequence {
  if (!facts.groupId) return { kind: 'searching' };
  const payment = facts.payment;
  if (payment?.status !== 'HOLD_PLACED') return { kind: 'no_charge' };
  const free = payment.freeCancelUntil != null && nowMs < Date.parse(payment.freeCancelUntil);
  if (free) return { kind: 'free', releasedCents: payment.holdCents };
  return { kind: 'fee_kept', feeCents: payment.feeCents, releasedCents: payment.holdCents - payment.feeCents };
}

const euros = (cents: number, language: HelpLanguage) =>
  language === 'en' ? `€${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2).replace('.', ',')} €`;

// After the passenger tapped a card's button: what the assistant says, in the conversation's
// language. (The card itself is drawn by the app from its own texts.)
export function cancelDoneText(consequence: CancelConsequence, language: HelpLanguage): string {
  const done = { en: 'Done - your ride is cancelled.', fr: 'C’est fait : votre trajet est annulé.', es: 'Hecho: tu trayecto está cancelado.' }[language];
  const after = (() => {
    switch (consequence.kind) {
      case 'searching':
        return { en: 'Nothing was charged. You can request a new ride whenever you like.', fr: 'Rien n’a été débité. Vous pouvez demander un nouveau trajet quand vous voulez.', es: 'No se ha cobrado nada. Puedes pedir un nuevo trayecto cuando quieras.' }[language];
      case 'no_charge':
        return { en: 'Nothing was reserved on your card, so nothing is charged.', fr: 'Rien n’était réservé sur votre carte : rien n’est débité.', es: 'No había nada reservado en tu tarjeta, así que no se cobra nada.' }[language];
      case 'free': {
        const amount = euros(consequence.releasedCents, language);
        return { en: `It was more than 24 hours before the ride, so it’s free: your whole reservation of ${amount} is released.`, fr: `C’était plus de 24 heures avant le trajet, donc c’est gratuit : toute votre réservation de ${amount} est libérée.`, es: `Faltaban más de 24 horas para el trayecto, así que es gratis: se libera toda tu reserva de ${amount}.` }[language];
      }
      case 'fee_kept': {
        const fee = euros(consequence.feeCents, language);
        const released = euros(consequence.releasedCents, language);
        return { en: `The ${fee} FLOQQ fee is kept and the remaining ${released} is released from your card.`, fr: `Les frais FLOQQ de ${fee} sont conservés et les ${released} restants sont libérés sur votre carte.`, es: `Se mantiene la tarifa de FLOQQ de ${fee} y se liberan los ${released} restantes de tu tarjeta.` }[language];
      }
    }
  })();
  return `${done} ${after}`;
}

export const ACTION_TEXTS: Record<HelpLanguage, { kept: string; cancelFailed: string; cancelSettling: string; resent: string; resendFailed: string; resendKept: string }> = {
  en: {
    kept: 'OK - your ride stays as it is.',
    cancelFailed: 'I couldn’t cancel it - your ride may have changed in the meantime. Open My Ride to see where it stands.',
    cancelSettling: 'This ride is being settled right now, so it can’t be cancelled any more.',
    resent: 'Done - the confirmation email is on its way to {email}. It can take a minute; check your spam folder too.',
    resendFailed: 'I couldn’t send it right now - please wait a minute and try again.',
    resendKept: 'OK, I won’t send it.',
  },
  fr: {
    kept: 'D’accord, votre trajet reste comme il est.',
    cancelFailed: 'Je n’ai pas pu l’annuler : votre trajet a peut-être changé entre-temps. Ouvrez Mon trajet pour voir où il en est.',
    cancelSettling: 'Ce trajet est en cours de règlement, il ne peut plus être annulé.',
    resent: 'C’est fait : l’e-mail de confirmation part vers {email}. Cela peut prendre une minute ; regardez aussi dans vos spams.',
    resendFailed: 'Je n’ai pas pu l’envoyer pour l’instant : attendez une minute et réessayez.',
    resendKept: 'D’accord, je ne l’envoie pas.',
  },
  es: {
    kept: 'Vale, tu trayecto se queda como está.',
    cancelFailed: 'No he podido cancelarlo: puede que tu trayecto haya cambiado mientras tanto. Abre Mi trayecto para ver cómo está.',
    cancelSettling: 'Este trayecto se está liquidando ahora mismo, así que ya no se puede cancelar.',
    resent: 'Hecho: el correo de confirmación va de camino a {email}. Puede tardar un minuto; revisa también la carpeta de spam.',
    resendFailed: 'No he podido enviarlo ahora: espera un minuto y vuelve a intentarlo.',
    resendKept: 'Vale, no lo envío.',
  },
};

// "Oh, one more thing" within this long of the closing: the same conversation carries on.
export const REOPEN_WITHIN_MINUTES = 10;

export function canReopen(state: string, closedAt: string | null, nowMs: number): boolean {
  if (state !== 'resolved_by_assistant' || !closedAt) return false;
  return nowMs - Date.parse(closedAt) < REOPEN_WITHIN_MINUTES * 60_000;
}
