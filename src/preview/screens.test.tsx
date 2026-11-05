import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../i18n';
import i18n from '../i18n';
import { PREVIEW_ENTRIES } from './entries';
import { startPreview, stopPreview } from './previewMode';

// Every screen of the screen preview gallery opens with its sample data, in every language, and
// nothing it does reaches the network. Run with `npm run test:screens`.

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const nav = { open: () => {}, gallery: () => {} };

async function renderEntry(entry: (typeof PREVIEW_ENTRIES)[number]) {
  const data = entry.data();
  startPreview(data);
  await entry.prepare?.();
  await act(async () => {
    render(<SafeAreaProvider initialMetrics={METRICS}>{entry.render(nav, data)}</SafeAreaProvider>);
  });
  // The screen loads its sample data.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('screen preview', () => {
  afterEach(() => {
    stopPreview();
  });

  for (const language of ['en', 'fr', 'es']) {
    describe(language, () => {
      for (const entry of PREVIEW_ENTRIES) {
        it(`opens ${[entry.screen, entry.state].filter(Boolean).join(' - ')}`, async () => {
          await i18n.changeLanguage(language);
          await renderEntry(entry);
          expect(screen.toJSON()).not.toBeNull();
        });
      }
    });
  }

  it('never reaches the network', () => {
    // Set up in jestSetup.js.
    const { networkCalls } = globalThis as unknown as { networkCalls: ReturnType<typeof jest.fn> };
    expect(networkCalls).not.toHaveBeenCalled();
  });
});
