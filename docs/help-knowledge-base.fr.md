# Base de connaissances de l’assistant FLOQQ

23 oct. 2026 · @Floqq

Ceci est la source unique à partir de laquelle l’assistant d’aide FLOQQ répond. Chaque règle reflète des décisions prises pour le pilote de BCN ; tout ce qui est marqué **TO DECIDE** n’est pas encore décidé et l’assistant ne doit jamais le promettre.

- Répondre dans la langue des passagers, sans termes techniques.
- Quand une règle change dans l’app, la mettre à jour ici le jour même, pour que l’assistant ne contredise jamais l’app.
- L’assistant répond dans la langue de l’app de l’utilisateur (EN, FR, ES) ; la version anglaise est la version de référence.

## Ce qu’est FLOQQ

FLOQQ met en relation des voyageurs qui atterrissent à l’aéroport de Barcelone (BCN) à peu près au même moment et qui vont dans des directions compatibles, pour qu’ils partagent un taxi normal de l’aéroport et divisent le prix de la course.

- FLOQQ ne possède et n’exploite aucun taxi et n’a pas de chauffeurs. Les passagers prennent ensemble le prochain taxi normal à la station.
- FLOQQ organise la mise en relation, le point de rencontre, le badge du groupe et le partage équitable du prix.
- FLOQQ facture des frais de plateforme de **2,49 € par passager**. Ils sont réservés sur la carte quand le passager réserve sa place dans un groupe, et prélevés avec sa part du taxi après le trajet. Le prix du taxi est à part.
- Périmètre du pilote : uniquement BCN, Terminal 1 et Terminal 2.

**Deux façons de l’utiliser**

1. **Avant l’atterrissage :** saisissez votre numéro de vol et votre destination avant de partir. FLOQQ cherche des voyageurs pendant que vous êtes en vol et vous donne le résultat à l’atterrissage.
2. **Déjà atterri :** ouvrez l’app à l’aéroport, choisissez votre destination et votre terminal, et rejoignez des voyageurs qui veulent partager maintenant.

**Le parcours dans l’app :** demander un trajet → recherche de votre correspondance → groupe trouvé (réservez votre place) → groupe confirmé → retrouvez votre groupe au point de rencontre → en route → trajet terminé.

## Compte et profil

- **Âge minimum : 18 ans.** La date de naissance est obligatoire à l’inscription. Les moins de 18 ans ne peuvent ni créer de compte ni demander de trajet.
- **Vérification de l’e-mail :** les nouveaux comptes doivent confirmer leur e-mail avant de demander un trajet. L’e-mail de vérification peut être renvoyé depuis l’écran d’attente ; vérifiez les spams.
- **Connexion :** e-mail et mot de passe, Apple ou Google.
- **Nom :** le prénom et le nom se modifient dans Profil. Les autres passagers ne voient jamais que le prénom.
- **Changement d’e-mail :** dans Profil. Un lien de confirmation est envoyé à la nouvelle adresse ; le changement ne s’applique qu’une fois confirmé, et l’ancien e-mail fonctionne jusque-là. Comptes Apple ou Google : l’e-mail est géré par Apple ou Google et ne peut pas être changé dans FLOQQ.
- **Changement de mot de passe :** Profil → **Modifier le mot de passe**, à tout moment. Saisir le mot de passe actuel, puis deux fois le nouveau (au moins 8 caractères, différent de l’actuel) et toucher **Enregistrer**. L’utilisateur reste connecté sur ce téléphone ; tous ses autres appareils sont déconnectés et un e-mail confirme le changement dans la langue du téléphone. Mot de passe actuel oublié : toucher **Mot de passe actuel oublié ?** sur cet écran pour recevoir un lien de réinitialisation par e-mail (ou **Mot de passe oublié ?** sur l’écran Se connecter). Après 5 mots de passe actuels incorrects, il faut attendre 15 minutes. Comptes Apple ou Google : pas de mot de passe FLOQQ ; Profil affiche « Connecté avec Apple/Google » et le mot de passe est géré par Apple ou Google.
- **Date de naissance :** l’utilisateur ne peut plus la modifier une fois saisie. Pour la corriger, il contacte le support (transfert à une personne).
- **Langue :** l’app suit la langue du téléphone (EN, FR, ES pris en charge ; les autres passent à l’anglais).
- **Moyen de paiement :** enregistré une fois (Apple Pay, Google Pay ou carte) dans Profil → Moyens de paiement, où il peut être remplacé.

## Demander un trajet

| Champ | Règle |
| --- | --- |
| Date d’arrivée | Obligatoire. |
| Numéro de vol | Facultatif. S’il est saisi, l’heure d’arrivée est remplie automatiquement à partir des données du vol et ne peut pas être modifiée. |
| Heure d’arrivée | Remplie à partir du vol, ou saisie par l’utilisateur (avec l’option « Maintenant ») quand il n’y a pas de numéro de vol. Les heures saisies sont toujours à l’heure de Barcelone. |
| Terminal | T1 ou T2. Défini automatiquement à partir de la compagnie quand un numéro de vol est donné (« Ce n'est pas correct ? » permet de le changer). Choix obligatoire sans numéro de vol. |
| Destination | Recherche d’adresse (Google). |
| Grand bagage (30 kg max.) | 0 ou 1. Compte comme bagage enregistré. |
| Bagage à main | 0, 1 ou 2. |
| Attente max. pour former le groupe | Minutes que le passager accepte d’attendre que les autres soient prêts. Pas l’attente du taxi. |
| Question bagage enregistré | Seulement sans numéro de vol : « Devez-vous encore récupérer un bagage enregistré ? » |

- **Un seul trajet actif à la fois.** Pour en réserver un autre, l’utilisateur consulte ou annule d’abord le trajet en cours.
- **Modifier :** possible tant que le trajet est en recherche ou que le groupe n’est pas encore confirmé (« Modifier » sur l’écran Recherche de votre correspondance). Une fois le groupe confirmé, le trajet ne peut plus être modifié : l’utilisateur annule et crée une nouvelle demande.
- Modifier un trajet qui faisait partie d’un groupe en formation le retire de ce groupe et relance la recherche avec les nouvelles informations.

## Comment fonctionne la mise en relation

FLOQQ cherche des correspondances **toutes les 5 minutes** ; il n’y a pas de délai maximum garanti, car une correspondance dépend de l’existence de voyageurs compatibles.

- **Taille du groupe :** 2 à 3 passagers par taxi.
- **Même terminal uniquement :** les passagers du T1 ne sont jamais groupés avec ceux du T2.
- **Équitable pour chacun :** les limites de chaque passager sont vérifiées (temps d’attente, détour, place pour les bagages), jamais une moyenne. Limites de détour : **TO DECIDE** (valeurs en attente de validation).
- **Heure où l’on est prêt** = quand un passager peut raisonnablement atteindre le point de rencontre, comptée à partir de l’arrivée de l’avion à la porte :

| Vol | Sans bagage enregistré | Avec bagage enregistré |
| --- | --- | --- |
| Origine Schengen | +15 min | +30 min |
| Origine hors Schengen (ex. Royaume-Uni, États-Unis) | +35 min | +50 min |

- Sans numéro de vol : prêt en 5 min environ, ou 15 min s’il reste un bagage enregistré à récupérer.
- **Heure de rencontre** = l’heure la plus tardive à laquelle un membre du groupe est prêt. Un groupe ne se forme que si personne n’attend plus longtemps que sa propre attente maximale.
- **Retards de vol :** les heures se mettent à jour automatiquement. Un groupe en formation est revérifié ; un groupe confirmé touché par un grand changement est examiné par FLOQQ.
- **Aucune correspondance :** si personne de compatible n’est trouvé avant l’heure d’arrivée plus l’attente maximale du passager, le trajet est marqué **Expiré - aucun covoiturage trouvé**. Aucun frais n’est prélevé et l’utilisateur peut créer une nouvelle demande.

## Groupe trouvé et réservation de votre place

- Quand une correspondance est trouvée, le passager voit le groupe (prénoms, avatars, quartier de chaque destination, jamais les adresses exactes), l’itinéraire prévu, le prix total estimé et sa part estimée.
- **« Réserver ma place »** réserve un montant sur le moyen de paiement enregistré : la part estimée du taxi, les frais de plateforme de 2,49 € et une marge au cas où le compteur monte plus haut. C’est un blocage temporaire, pas un prélèvement. Après le trajet, seuls la part réelle et les frais sont prélevés ; le reste est libéré.
- Une place ne compte comme réservée qu’une fois la réservation confirmée par le prestataire de paiement. Si un paiement échoue, le passager peut réessayer ou changer de carte ; il n’est pas possible de continuer sans payer.
- **« Pas pour moi »** refuse la correspondance : le passager quitte ce groupe et la recherche continue. Aucun frais n’est prélevé en refusant avant de réserver.
- **Délai de réponse :** une correspondance doit être acceptée dans un délai affiché sous forme de compte à rebours. Valeur : **TO DECIDE**. Si quelqu’un ne répond pas à temps, il est retiré et les autres sont remis en relation.
- Le groupe est **confirmé** une fois que chaque membre a réservé sa place. Ce n’est qu’alors que le point de rencontre et le badge deviennent disponibles.

## Retrouver votre groupe

- **Point de rencontre :** un repère dans le hall des arrivées public de votre terminal, après la récupération des bagages (par exemple le point d’information touristique ou un café). Les groupes qui se retrouvent à la même heure ont des points différents. La carte montre une photo, le chemin depuis la sortie des bagages, l’heure de rencontre et un bouton « Ouvrir dans Google Maps ». Un café fermé reste un point de rencontre valable : retrouvez-vous devant.
- **« Trouver mon groupe » :** sur l’écran Groupe confirmé. Avant l’atterrissage, il montre un aperçu ; après l’atterrissage, il lance le guidage.
- **Guidage par flèche :** indique le point de rencontre grâce à la position du téléphone, qui reste sur le téléphone. À l’intérieur, le GPS peut se tromper de 10 à 50 m, donc près du point l’app montre la photo et le chemin au lieu de la flèche.
- **« Je suis au point de rencontre » :** un seul appui indique au groupe que vous êtes arrivé. Un appui par erreur peut être annulé.
- **Badge :** chaque groupe reçoit une couleur, une forme et un numéro. « Afficher notre badge » l’affiche en plein écran ; levez le téléphone et cherchez le même badge.
- **Partage de position avec le groupe :** facultatif, désactivé par défaut. Seuls les membres du groupe le voient, seulement tant que l’écran de rencontre est ouvert, et il s’arrête automatiquement au début du trajet.
- **Discussion de groupe :** pas encore disponible. Pour vous retrouver, utilisez la photo et le chemin du point de rencontre, « Afficher notre badge » et « Je suis au point de rencontre ».
- **« J'ai trouvé mon groupe » :** chaque membre confirme. Quand tout le monde a confirmé, allez ensemble à la station de taxis et appuyez sur « Nous sommes dans le taxi ».
- **Quelqu’un manque :** après 10 minutes, les autres peuvent continuer à attendre ou partir sans lui (marqué absent, au moins 2 passagers doivent rester).

## Le trajet et les paiements

- **Deux montants distincts :** les frais FLOQQ de 2,49 € et la part du passager dans le prix du taxi. Les deux sont réservés ensemble en réservant la place et prélevés ensemble après le trajet.
- **Qui paie le chauffeur :** le passager dont l’arrêt est le dernier de l’itinéraire, puisqu’il est le seul encore dans le taxi quand le compteur s’arrête. Il est prévenu avant le trajet. Sa propre part va directement au taxi, donc FLOQQ ne lui prélève que les frais de 2,49 €.
- **Les parts des autres :** réservées sur leur carte quand ils ont réservé leur place, puis prélevées au montant exact après le trajet. La partie non utilisée du blocage est libérée.
- **Reçu :** à la fin, celui qui paie photographie le reçu du taxi dans l’app. L’app lit le total sur la photo ; celui qui paie ne le saisit jamais. Si la photo n’est pas claire ou ne correspond pas au trajet, l’équipe FLOQQ la vérifie à la main.
- **Partage équitable :** FLOQQ calcule chaque part à partir du total réel du reçu et de l’itinéraire : chaque portion du trajet est partagée par les passagers encore dans le taxi à ce moment-là. Personne ne paie les kilomètres après être descendu. Les passagers n’ont rien à faire pour cela.
- **Remboursement de celui qui paie :** il reçoit les parts des autres passagers via l’app.
- **Écran « En route » :** purement informatif. FLOQQ ne suit pas le taxi.
- **« Je suis arrivé(e) » :** chaque passager appuie dessus en descendant ; cela ouvre le récapitulatif Trajet terminé. Les montants affichent « En attente » tant que le reçu n’est pas traité.
- **Note :** facultative, de 1 à 5 étoiles ; en dessous de 5 étoiles, un court formulaire demande ce qui pourrait être mieux.

**TO DECIDE avant que l’assistant ne réponde en détail :** délai de contestation des montants du reçu, délai et solution de repli si celui qui paie n’envoie jamais le reçu, conditions exactes de la Garantie de paiement du trajet (si FLOQQ couvre une part qui ne peut pas être prélevée) et délai de versement à celui qui paie. La validation juridique du parcours de paiement en Espagne est en attente.

## Annulations, remboursements et retards

| Situation | Ce qui se passe |
| --- | --- |
| Annuler pendant la recherche | Gratuit. Trajet annulé, rien n’est prélevé. |
| Refuser une correspondance avant de réserver | Gratuit. La recherche continue. |
| Aucune correspondance à temps | Le trajet expire automatiquement. Rien n’est prélevé. |
| Annuler après avoir réservé sa place, avant que le groupe soit confirmé | Gratuit. Toute la réservation, frais compris, est libérée. Rien n’est prélevé. |
| Annuler après la confirmation du groupe, plus de 24 heures avant le trajet | Gratuit. Toute la réservation, frais compris, est libérée. |
| Annuler après la confirmation du groupe, moins de 24 heures avant le trajet | Les frais de 2,49 € sont prélevés ; le reste de la réservation est libéré. L’app l’affiche avant que l’utilisateur confirme. |
| Un autre membre annule ou ne vient pas | Le groupe est recalculé s’il reste au moins 2 personnes, sinon tout le monde repart en recherche. Effet sur les 2,49 € de ceux qui restent : **TO DECIDE** |
| Vol retardé | L’heure se met à jour automatiquement ; un groupe en formation est revérifié, un groupe confirmé est examiné par FLOQQ. |
| Terminal changé par la compagnie | Le passager repart dans une nouvelle recherche au bon terminal si le groupe n’est pas encore confirmé ; sinon FLOQQ examine la situation. |
| Le groupe ne s’est jamais retrouvé à l’aéroport | Le trajet est signalé à FLOQQ pour examen et aucun paiement de part de taxi n’est traité tant que ce n’est pas résolu. |

L’annulation se fait depuis « Mon trajet » ou l’écran Recherche de votre correspondance, toujours avec une étape de confirmation. L’assistant n’annule jamais un trajet lui-même (voir Règles de l’assistant).

## Sécurité, vie privée et données

- **Urgences :** en cas d’urgence, appelez d’abord le **112** (numéro d’urgence européen). L’assistant le dit immédiatement et n’essaie pas de gérer l’urgence lui-même.
- **Ce que voient les autres passagers :** prénom, avatar, quartier de la destination, statut du vol et statut de la rencontre. Jamais le nom de famille, l’e-mail, le téléphone, l’adresse exacte ou la date de naissance.
- **Position :** utilisée sur le téléphone pour le guidage par flèche. Partagée avec le groupe seulement si le passager l’active, seulement pendant la rencontre, jamais enregistrée.
- **Discussion de groupe :** pas encore disponible, il n’y a donc rien à signaler ou bloquer dans l’app. Les problèmes de sécurité avec un autre passager vont à l’équipe FLOQQ (transfert à une personne).
- **Les notes** ne sont jamais montrées aux autres passagers.
- **Suppression du compte :** comment la demander : **TO DECIDE**.
- **Paiements :** les données de carte sont gérées par Stripe ; FLOQQ ne voit ni n’enregistre jamais les numéros de carte complets.

## Dépannage

| Problème | Quoi dire à l’utilisateur |
| --- | --- |
| E-mail de vérification non reçu | Vérifier les spams, puis utiliser « Renvoyer l’e-mail de vérification ». Toujours rien → transfert à une personne. |
| Impossible de créer un trajet | Vérifier : e-mail confirmé, date de naissance saisie (18 ans et plus), aucun autre trajet actif, moyen de paiement enregistré. |
| Numéro de vol non reconnu | Vérifier le format (code de la compagnie + numéro, ex. VY1803) et la date. Sinon le laisser vide et saisir l’heure d’arrivée et le terminal à la main. |
| Mauvais terminal affiché | Appuyer sur « Ce n'est pas correct ? » sous le terminal pour le changer. |
| Recherche très longue | La mise en relation tourne toutes les 5 minutes et dépend de voyageurs compatibles. Une attente maximale plus longue aide. Le trajet expire gratuitement si personne n’est trouvé. |
| Paiement échoué | Réessayer, ou remplacer la carte dans Profil → Moyens de paiement. Prélevé mais place non réservée → transfert à une personne. |
| La flèche ne s’affiche pas | Activer la localisation pour FLOQQ dans les réglages du téléphone. À l’intérieur, près du point, l’app montre la photo et le chemin à la place. |
| La flèche indique la mauvaise direction | Faire un mouvement en forme de huit avec le téléphone pour calibrer la boussole, et le tenir à plat. |
| Impossible de trouver le groupe | Utiliser la photo et le chemin, « Afficher notre badge » et « Je suis au point de rencontre ». |
| Les montants affichent « En attente » | Normal tant que le reçu de celui qui paie n’est pas traité ; l’utilisateur est prévenu quand c’est définitif. |
| Les notifications n’arrivent pas | Autoriser les notifications pour FLOQQ dans les réglages du téléphone. |

## Règles de l’assistant

**L’assistant peut :**

- Expliquer comment fonctionne FLOQQ, uniquement à partir de cette base de connaissances.
- Consulter les informations de l’utilisateur connecté, en lecture seule : statut du trajet, statut du groupe, point de rencontre, statut du paiement et du remboursement.
- Guider l’utilisateur vers le bon écran ou le bon bouton pour qu’il fasse les choses lui-même.
- Créer une demande d’assistance pour l’équipe FLOQQ, avec la conversation et le trajet joints.

**L’assistant ne fait jamais :**

- Annuler, modifier, rembourser, prélever ou changer quoi que ce soit lui-même.
- Partager les informations d’un autre passager.
- Promettre un remboursement, une compensation ou quoi que ce soit marqué TO DECIDE.
- Inventer une réponse : si ce n’est pas dans cette base de connaissances ou dans les données de l’utilisateur, il le dit et propose une personne.

**Transférer à une personne quand :**

- l’utilisateur demande une personne ;
- il s’agit d’argent et quelque chose semble anormal (prélevé deux fois, prélevé sans place, mauvaise part, remboursement manquant) ;
- un problème de sécurité, du harcèlement ou un litige entre passagers ;
- une correction de date de naissance ou une suppression de compte ;
- l’assistant n’a pas pu résoudre le problème après deux tentatives.

**Toujours :** dire à l’utilisateur dès le début qu’il parle à un assistant IA, répondre dans la langue de son app et, en cas d’urgence, lui dire d’appeler d’abord le 112.

## Décisions à prendre avant le lancement

L’assistant considère chacun de ces points comme « pas encore décidé » et transfère à une personne tant qu’il n’est pas complété ci-dessus.

- [x] Règles de remboursement des frais de 2,49 € quand l’utilisateur annule (comme l’app le fait aujourd’hui ; voir le tableau des annulations)
- [ ] Effet d’une absence sur les frais des passagers qui restent
- [ ] Délai de réponse à une correspondance (minutes)
- [ ] Limites de détour par passager
- [ ] Délai de contestation des montants du reçu
- [ ] Délai et solution de repli quand celui qui paie n’envoie pas le reçu
- [ ] Conditions de la Garantie de paiement du trajet
- [ ] Délai de versement à celui qui paie
- [ ] Validation juridique du parcours de paiement en Espagne
- [ ] Procédure de suppression de compte
- [ ] Coordonnées du support et délai de réponse humain
