import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchHelpArticles, groupBySection, HELP_LANGUAGES, HelpArticle } from '../services/helpArticles';
import { baseText, colors, radii, spacing } from '../theme/colors';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import Skeleton from './Skeleton';

type Props = {
  onOpen: (article: HelpArticle) => void;
  // Changes after an edit, so the list reloads when the admin comes back.
  refreshKey?: number;
};

// Admin dashboard, "Help" tab: the help assistant's knowledge base, section by section, with each
// language's version and whether it is live. Tapping a language opens that version's editor.
// French and Spanish start as drafts - the assistant uses only published versions.
export default function AdminHelpArticles({ onOpen, refreshKey }: Props) {
  const { t } = useTranslation();
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await fetchHelpArticles();
    setIsLoading(false);
    if (error) {
      console.warn('fetchHelpArticles failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setArticles(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (isLoading) {
    return (
      <View accessible accessibilityLabel={t('admin.loading')}>
        {[0, 1, 2].map((i) => (
          <Card key={i} style={styles.row}>
            <Skeleton width={180} height={18} style={styles.skeletonGap} />
            <Skeleton width={220} height={14} />
          </Card>
        ))}
      </View>
    );
  }

  if (loadFailed) {
    return <ErrorNotice message={t('adminHelp.loadError')} onRetry={load} retryLabel={t('common.retry')} />;
  }

  const sections = groupBySection(articles);
  const drafts = articles.filter((article) => article.status === 'draft').length;

  return (
    <View>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t('adminHelp.articlesTitle')}
      </Text>
      <Text style={styles.intro}>{t('adminHelp.articlesIntro')}</Text>
      {drafts > 0 ? <Text style={styles.drafts}>{t('adminHelp.draftsWaiting', { count: drafts })}</Text> : null}
      {sections.length === 0 ? <Text style={styles.emptyText}>{t('adminHelp.empty')}</Text> : null}
      {sections.map((section) => {
        const title = section.byLanguage.en?.title ?? section.sectionKey;
        return (
          <Card key={section.sectionKey} style={styles.row}>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.languages}>
              {HELP_LANGUAGES.map((language) => {
                const article = section.byLanguage[language];
                const languageLabel = t(`adminHelp.language.${language}`);
                if (!article) {
                  return (
                    <View key={language} style={[styles.chip, styles.chipMissing]}>
                      <Text style={styles.chipText}>
                        {languageLabel} · {t('adminHelp.missing')}
                      </Text>
                    </View>
                  );
                }
                const statusLabel = t(article.status === 'published' ? 'adminHelp.published' : 'adminHelp.draft');
                return (
                  <Pressable
                    key={language}
                    onPress={() => onOpen(article)}
                    style={[styles.chip, article.status === 'published' ? styles.chipPublished : styles.chipDraft]}
                    accessibilityRole="button"
                    accessibilityLabel={t('adminHelp.openVersion', { section: title, language: languageLabel, status: statusLabel })}
                  >
                    <Text style={styles.chipText}>
                      {languageLabel} · {statusLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  intro: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.x3,
  },
  drafts: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginBottom: spacing.x3,
  },
  emptyText: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  row: {
    marginBottom: spacing.x3,
  },
  skeletonGap: {
    marginBottom: spacing.x2,
  },
  title: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x2,
  },
  languages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
  },
  chip: {
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  chipPublished: {
    borderColor: colors.success,
  },
  chipDraft: {
    borderColor: colors.warning,
  },
  chipMissing: {
    borderColor: colors.borderSubtle,
  },
  chipText: {
    ...baseText.bodySmall,
    fontWeight: '600',
  },
});
