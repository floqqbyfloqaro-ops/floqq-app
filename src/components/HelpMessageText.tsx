import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
};

// An assistant answer as text: **bold** is shown bold, everything else as it was written.
export default function HelpMessageText({ text, style }: Props) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style} selectable>
      {parts.map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <Text key={index} style={styles.bold}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  bold: {
    fontWeight: '700',
  },
});
