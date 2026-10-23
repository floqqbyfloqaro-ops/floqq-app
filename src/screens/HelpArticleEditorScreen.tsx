import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import StatusPill from '../components/StatusPill';
import { fetchHelpArticleRevisions, HelpArticle, HelpArticleRevision, updateHelpArticle } from '../services/helpArticles';
import { baseText, colors, overlays, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';

type Props = {
  article: HelpArticle;
  onBack: () => void;
};

// Admin: one section of the help assistant's knowledge base in one language. The admin edits the
// title and the text (markdown), saves, and publishes a draft translation once it reads right -
// the assistant only uses published versions. Every saved version is kept: "Restore" puts an
// older one back in the fields, to save again.
export default function HelpArticleEditorScreen({ article: initial, onBack }: Props) {
  const { t } = useTranslation();
  const [article, setArticle] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [revisions, setRevisions] = useState<HelpArticleRevision[]>([]);
  const [isSaving, setIsSaving] = useState<'save' | 'publish' | 'unpublish' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRevisions = useCallback(async () => {
    const { data, error } = await fetchHelpArticleRevisions(initial.id);
    if (error) console.warn('fetchHelpArticleRevisions failed', error);
    setRevisions(data ?? []);
  }, [initial.id]);

  useEffect(() => {
    loadRevisions();
  }, [loadRevisions]);

  const hasChanges = title.trim() !== article.title || content.trim() !== article.content;
  const isEnglish = article.language === 'en';

  const save = async (action: 'save' | 'publish' | 'unpublish') => {
    setErrorMessage(null);
    setNotice(null);
    if (!title.trim() || !content.trim()) {
      setErrorMessage(t('adminHelp.emptyError'));
      return;
    }
    setIsSaving(action);
    const { data, error } = await updateHelpArticle(article.id, {
      title: title.trim(),
      content: content.trim(),
      ...(action === 'publish' ? { status: 'published' as const } : action === 'unpublish' ? { status: 'draft' as const } : {}),
    });
    setIsSaving(null);
    if (error || !data) {
      console.warn('updateHelpArticle failed', error);
      setErrorMessage(t('adminHelp.saveError'));
      return;
    }
    setArticle(data);
    setTitle(data.title);
    setContent(data.content);
    setNotice(t(action === 'publish' ? 'adminHelp.publishedNotice' : action === 'unpublish' ? 'adminHelp.unpublishedNotice' : 'adminHelp.savedNotice'));
    loadRevisions();
  };

  const restore = (revision: HelpArticleRevision) => {
    setTitle(revision.title);
    setContent(revision.content);
    setNotice(t('adminHelp.restoredNotice'));
  };

  const statusLabel = t(article.status === 'published' ? 'adminHelp.published' : 'adminHelp.draft');

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimMedium}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
        >
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>
        <Text style={styles.code}>
          {t(`adminHelp.language.${article.language}`)} · {article.section_key}
        </Text>
        <Text style={styles.title} accessibilityRole="header">
          {article.title}
        </Text>
        <StatusPill status={article.status === 'published' ? 'Group Confirmed' : 'Searching'} label={statusLabel} />
        <Text style={styles.hint}>
          {t('adminHelp.lastChanged', { date: formatBarcelonaDateTime(article.updated_at) })}
        </Text>
        {article.status === 'draft' ? <Text style={styles.warning}>{t('adminHelp.draftExplainer')}</Text> : null}

        {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

        <Card style={styles.card}>
          <Text style={styles.label}>{t('adminHelp.titleLabel')}</Text>
          <AuthTextInput
            variant="card"
            value={title}
            onChangeText={setTitle}
            accessibilityLabel={t('adminHelp.titleLabel')}
            maxLength={200}
          />
          <Text style={styles.label}>{t('adminHelp.contentLabel')}</Text>
          <AuthTextInput
            variant="card"
            value={content}
            onChangeText={setContent}
            accessibilityLabel={t('adminHelp.contentLabel')}
            multiline
            maxLength={20000}
            style={styles.contentInput}
            textAlignVertical="top"
          />
          <Text style={styles.hint}>{t('adminHelp.markdownHint')}</Text>

          <View style={styles.actions}>
            <PrimaryButton label={t('adminHelp.save')} onPress={() => save('save')} loading={isSaving === 'save'} disabled={!hasChanges || isSaving != null} />
            {article.status === 'draft' ? (
              <SecondaryButton
                label={t('adminHelp.publish')}
                onPress={() => save('publish')}
                loading={isSaving === 'publish'}
                disabled={isSaving != null}
              />
            ) : !isEnglish ? (
              // The English master stays live: it is what every language falls back to.
              <SecondaryButton
                label={t('adminHelp.unpublish')}
                onPress={() => save('unpublish')}
                loading={isSaving === 'unpublish'}
                disabled={isSaving != null}
              />
            ) : null}
          </View>
          {notice ? (
            <Text style={styles.saved} accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminHelp.historyTitle')}</Text>
          {revisions.length === 0 ? <Text style={styles.hint}>{t('adminHelp.historyEmpty')}</Text> : null}
          {revisions.map((revision, index) => (
            <View key={revision.id} style={styles.revision}>
              <Text style={styles.revisionMeta}>
                {formatBarcelonaDateTime(revision.changed_at)} ·{' '}
                {revision.changed_by ? t('adminHelp.byAdmin') : t('adminHelp.byImport')} ·{' '}
                {t(revision.status === 'published' ? 'adminHelp.published' : 'adminHelp.draft')}
                {index === 0 ? ` · ${t('adminHelp.current')}` : ''}
              </Text>
              <Text style={styles.revisionPreview} numberOfLines={3}>
                {revision.title} — {revision.content}
              </Text>
              {index > 0 ? (
                <Pressable
                  onPress={() => restore(revision)}
                  accessibilityRole="button"
                  accessibilityLabel={t('adminHelp.restoreLabel', { date: formatBarcelonaDateTime(revision.changed_at) })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.restore}>{t('adminHelp.restore')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x12,
  },
  backText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginBottom: spacing.x3,
  },
  code: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x3,
  },
  card: {
    marginTop: spacing.x4,
  },
  cardTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  label: {
    ...baseText.label,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  contentInput: {
    minHeight: 280,
    paddingVertical: spacing.x3,
  },
  hint: {
    ...baseText.caption,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  warning: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginTop: spacing.x2,
  },
  actions: {
    gap: spacing.x2,
    marginTop: spacing.x3,
  },
  saved: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
  revision: {
    paddingVertical: spacing.x3,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  revisionMeta: {
    ...baseText.caption,
    color: colors.info,
    marginBottom: spacing.x1,
  },
  revisionPreview: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
  },
  restore: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginTop: spacing.x2,
  },
});
