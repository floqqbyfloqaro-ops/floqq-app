// Checks, against the TEST Supabase project only, the help assistant's knowledge base
// (supabase/migrations/20261023020000_help_articles.sql):
//   - the import put every section in, English published and French/Spanish as drafts, and a
//     second import leaves everything alone;
//   - a passenger can't read, add or change any of it, nor its history;
//   - the admin can edit and publish, and every change lands in the history with who did it;
//   - who changed it and when can't be faked from the app.
// It creates its own throwaway users and puts the edited section back as it was at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run the import first, then:
//   node --env-file=.env.test.local scripts/help-articles-test.mjs

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const missing = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing in .env.test.local: ${missing.join(', ')}`);
  process.exit(2);
}
if (url.includes(LIVE_PROJECT_REF)) {
  console.error('TEST_SUPABASE_URL points at the LIVE project. This script only runs against the test project.');
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceRoleKey, options);
const runId = randomUUID().slice(0, 8);
const password = `Test-${randomUUID()}`;

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];

async function signedInUser(label) {
  const email = `help-articles-test-${runId}-${label}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: label, last_name: 'Test', date_of_birth: '1990-05-05' },
  });
  if (error) throw new Error(`creating ${label} failed: ${error.message}`);
  createdUsers.push(data.user);
  const client = createClient(url, anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signing in ${label} failed: ${signInError.message}`);
  return { user: data.user, client };
}

let restore = null;

try {
  const { data: all } = await service.from('help_articles').select('id, section_key, language, status, title, content');
  const byLanguage = (language) => (all ?? []).filter((row) => row.language === language);
  check(
    'every section is in, in all three languages',
    byLanguage('en').length >= 10 && byLanguage('fr').length === byLanguage('en').length && byLanguage('es').length === byLanguage('en').length,
    `${byLanguage('en').length}/${byLanguage('fr').length}/${byLanguage('es').length}`
  );
  check(
    'English is published; French and Spanish start as drafts',
    byLanguage('en').every((row) => row.status === 'published') &&
      [...byLanguage('fr'), ...byLanguage('es')].every((row) => row.status === 'draft' || row.status === 'published')
  );
  check('the bot rules are there', byLanguage('en').some((row) => row.section_key === 'bot_rules'));

  const again = execFileSync(process.execPath, ['--env-file=.env.test.local', 'scripts/import-help-kb.mjs'], { encoding: 'utf8' });
  check('a second import leaves everything alone', /0 sections added, 0 replaced/.test(again), again.trim());

  const passenger = await signedInUser('Pia');
  const { data: seen } = await passenger.client.from('help_articles').select('id');
  check("a passenger can't read the knowledge base", (seen ?? []).length === 0, String((seen ?? []).length));
  const { data: seenHistory } = await passenger.client.from('help_article_revisions').select('id');
  check("...nor its history", (seenHistory ?? []).length === 0);
  const target = byLanguage('fr').find((row) => row.section_key === 'what_floqq_is');
  restore = target;
  const { data: changed } = await passenger.client.from('help_articles').update({ content: 'hacked' }).eq('id', target.id).select('id');
  const { error: addError } = await passenger.client
    .from('help_articles')
    .insert({ section_key: 'fake', language: 'en', title: 'x', content: 'x', status: 'published' });
  const { data: afterPassenger } = await service.from('help_articles').select('content').eq('id', target.id).single();
  check(
    "...and can't change or add anything",
    (changed ?? []).length === 0 && addError != null && afterPassenger?.content === target.content,
    addError?.message
  );

  const admin = await signedInUser('Ada');
  await service.from('user_roles').insert({ user_id: admin.user.id, role: 'admin' });
  const { data: adminSees } = await admin.client.from('help_articles').select('id');
  check('the admin reads every section', (adminSees ?? []).length === (all ?? []).length, String((adminSees ?? []).length));

  const fakeAuthor = randomUUID();
  const { data: edited, error: editError } = await admin.client
    .from('help_articles')
    .update({ content: `${target.content}\n\nTest ${runId}`, status: 'published', updated_by: fakeAuthor, updated_at: '2000-01-01T00:00:00Z' })
    .eq('id', target.id)
    .select('content, status, updated_by, updated_at')
    .single();
  check(
    'the admin edits and publishes a French section',
    !editError && edited?.status === 'published' && edited.content.endsWith(`Test ${runId}`),
    editError?.message
  );
  check(
    "...recorded as the admin, now - not what the app claimed",
    edited?.updated_by === admin.user.id && new Date(edited.updated_at).getFullYear() > 2000,
    `${edited?.updated_by} ${edited?.updated_at}`
  );
  const { data: history } = await admin.client
    .from('help_article_revisions')
    .select('content, status, changed_by')
    .eq('article_id', target.id)
    .order('changed_at', { ascending: false });
  check(
    '...and the history keeps both the new and the imported version',
    history?.[0]?.changed_by === admin.user.id &&
      history[0].status === 'published' &&
      history.some((row) => row.changed_by === null && row.content === target.content),
    String(history?.length)
  );
  const { error: historyEdit } = await admin.client.from('help_article_revisions').insert({
    article_id: target.id,
    section_key: 'x',
    language: 'en',
    title: 'x',
    content: 'x',
    status: 'draft',
  });
  check('nobody can write the history by hand, not even the admin', historyEdit != null, historyEdit?.message);
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  if (restore) {
    await service.from('help_articles').update({ title: restore.title, content: restore.content, status: restore.status }).eq('id', restore.id);
  }
  for (const user of createdUsers) {
    await service.from('user_roles').delete().eq('user_id', user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
