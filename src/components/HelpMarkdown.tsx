import { Linking, StyleSheet, Text, TextStyle, View } from 'react-native';

import { Inline, parseHelpMarkdown } from '../services/helpMarkdown';
import { baseText, colors, spacing } from '../theme/colors';

type Props = {
  text: string;
};

function Line({ parts, style }: { parts: Inline[]; style?: TextStyle }) {
  return (
    <Text style={[styles.text, style]} selectable>
      {parts.map((part, index) =>
        part.type === 'bold' ? (
          <Text key={index} style={styles.bold}>
            {part.text}
          </Text>
        ) : part.type === 'link' ? (
          <Text key={index} style={styles.link} onPress={() => Linking.openURL(part.url)} accessibilityRole="link">
            {part.text}
          </Text>
        ) : (
          part.text
        )
      )}
    </Text>
  );
}

// An assistant answer with its light formatting shown properly: paragraphs, bold, bullet lists,
// numbered steps and links - never the markdown symbols themselves.
export default function HelpMarkdown({ text }: Props) {
  const blocks = parseHelpMarkdown(text);
  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) =>
        block.type === 'paragraph' ? (
          <Line key={index} parts={block.inline} />
        ) : (
          <View key={index} style={styles.list}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.item}>
                <Text style={[styles.text, styles.marker]}>{block.type === 'numbered' ? `${itemIndex + 1}.` : '•'}</Text>
                <View style={styles.itemText}>
                  <Line parts={item} />
                </View>
              </View>
            ))}
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: {
    gap: spacing.x2,
  },
  text: {
    ...baseText.body,
  },
  bold: {
    fontWeight: '700',
  },
  link: {
    color: colors.info,
    textDecorationLine: 'underline',
  },
  list: {
    gap: spacing.x1,
  },
  item: {
    flexDirection: 'row',
    gap: spacing.x2,
  },
  marker: {
    minWidth: 18,
    color: colors.textSecondary,
  },
  itemText: {
    flex: 1,
  },
});
