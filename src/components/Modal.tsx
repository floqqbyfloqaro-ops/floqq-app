import { Modal as NativeModal, ModalProps } from 'react-native';

// The screen preview's PREVIEW label (src/preview/): a pop-up covers everything under it, so it
// carries its own. Only development builds and test builds with EXPO_PUBLIC_SCREEN_PREVIEW=true
// contain it - the condition is written out here so a production build drops the require.
const PreviewModalLabel =
  __DEV__ || process.env.EXPO_PUBLIC_SCREEN_PREVIEW === 'true'
    ? (require('../preview/PreviewOverlay') as typeof import('../preview/PreviewOverlay')).PreviewModalLabel
    : null;

// React Native's Modal; use this one in the passenger's screens.
export default function Modal({ children, ...props }: ModalProps) {
  return (
    <NativeModal {...props}>
      {children}
      {PreviewModalLabel ? <PreviewModalLabel /> : null}
    </NativeModal>
  );
}
