import type { PreviewData } from './fixtures';

// The screen preview (see ScreenPreviewGallery.tsx) switch. While it is on, the app's Supabase
// client answers from the sample data here (previewClient.ts) and nothing reaches the server,
// Stripe, Google, the phone's location or camera. Off in every normal session; production builds
// can't turn it on at all (the gallery isn't in them).
//
// No imports besides types: the services check this switch, and it must stay cheap for them.

let data: PreviewData | null = null;

export function isPreviewMode(): boolean {
  return data !== null;
}

// The sample data of the screen being previewed. Only call while isPreviewMode().
export function previewData(): PreviewData {
  if (!data) throw new Error('previewData() outside the screen preview');
  return data;
}

export function startPreview(next: PreviewData) {
  data = next;
}

export function stopPreview() {
  data = null;
}

export const ACTION_DISABLED = 'Preview - action disabled';

// "Preview - action disabled" (or a more specific line), shown briefly over the previewed screen
// whenever it tried to save, send, pay or use a sensor.
type NoticeListener = (message: string) => void;
const noticeListeners = new Set<NoticeListener>();

export function notifyPreviewAction(message: string = ACTION_DISABLED) {
  noticeListeners.forEach((listener) => listener(message));
}

export function subscribePreviewNotices(listener: NoticeListener) {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}
