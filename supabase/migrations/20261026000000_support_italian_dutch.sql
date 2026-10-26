-- "Talk to a person": the passenger can also choose Italian or Dutch for the FLOQQ team. The app
-- itself stays in English, French and Spanish; this is only the language the team replies in.

alter table public.support_tickets drop constraint if exists support_tickets_language_check;
alter table public.support_tickets
  add constraint support_tickets_language_check check (language in ('en', 'fr', 'es', 'it', 'nl'));

alter table public.support_settings alter column team_languages set default array['en', 'fr', 'es', 'it', 'nl'];

-- Offer them right away (the admin can switch any language off again in Support settings).
update public.support_settings
set team_languages = team_languages
  || array(select l from unnest(array['it', 'nl']) as l where not (l = any (team_languages)))
where id = 1;
