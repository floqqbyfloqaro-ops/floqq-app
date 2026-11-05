import type { ReactElement } from 'react';

import FindingMatchScreen from '../screens/FindingMatchScreen';
import LoginScreen from '../screens/LoginScreen';
import MatchFoundScreen from '../screens/MatchFoundScreen';
import MyRideScreen from '../screens/MyRideScreen';
import NewRequestScreen from '../screens/NewRequestScreen';
import SignUpScreen from '../screens/SignUpScreen';
import WelcomeSplashScreen from '../screens/WelcomeSplashScreen';
import { makePreviewData, PreviewData } from './fixtures';
import { notifyPreviewAction } from './previewMode';

// What a previewed screen's buttons can do: open another entry, or go back to the gallery.
export type PreviewNav = {
  open: (id: string) => void;
  gallery: () => void;
};

export type PreviewEntry = {
  id: string;
  // The screen, and which of its states this entry shows.
  screen: string;
  state?: string;
  data: () => PreviewData;
  render: (nav: PreviewNav, data: PreviewData) => ReactElement;
};

const disabled = () => notifyPreviewAction();

// Every screen of the passenger's journey, in order. Each one is the real screen component,
// filled from the sample data in fixtures.ts.
export const PREVIEW_ENTRIES: PreviewEntry[] = [
  {
    id: 'splash',
    screen: 'Splash',
    data: () => makePreviewData('searching'),
    render: () => <WelcomeSplashScreen />,
  },
  {
    id: 'login',
    screen: 'Login',
    data: () => makePreviewData('searching'),
    render: (nav) => <LoginScreen onSwitchToSignUp={() => nav.open('signup')} onForgotPassword={disabled} />,
  },
  {
    id: 'signup',
    screen: 'Sign-up',
    state: 'Your details',
    data: () => makePreviewData('searching'),
    render: (nav) => <SignUpScreen onSwitchToLogin={() => nav.open('login')} />,
  },
  {
    id: 'signup-avatar',
    screen: 'Sign-up',
    state: 'Choose your avatar',
    data: () => makePreviewData('searching'),
    render: (nav) => <SignUpScreen initialStep="avatar" onSwitchToLogin={() => nav.open('login')} />,
  },
  {
    id: 'new-request',
    screen: 'New ride request',
    data: () => makePreviewData('searching'),
    render: (nav) => <NewRequestScreen onSubmitted={() => nav.open('finding-searching')} onCancel={nav.gallery} />,
  },
  {
    id: 'finding-searching',
    screen: 'Finding your match',
    state: 'Searching',
    data: () => makePreviewData('searching'),
    render: (nav, data) => (
      <FindingMatchScreen
        request={data.request}
        onBack={nav.gallery}
        onEdit={() => nav.open('new-request')}
        onCancelled={() => nav.open('finding-expired')}
      />
    ),
  },
  {
    id: 'finding-expired',
    screen: 'Finding your match',
    state: 'Expired - no match',
    data: () => makePreviewData('expired'),
    // "No match found" is shown on My ride, once the search has ended.
    render: (nav) => <MyRideScreen onBack={nav.gallery} onCreateRequest={() => nav.open('new-request')} onOpenProfile={disabled} />,
  },
  {
    id: 'match-found',
    screen: 'Match found',
    state: 'Offer - secure your spot',
    data: () => makePreviewData('offer'),
    render: (nav, data) => (
      <MatchFoundScreen
        request={data.request}
        onBack={nav.gallery}
        onEdit={() => nav.open('new-request')}
        onOpenProfile={disabled}
        onFindGroup={disabled}
        onLeft={() => nav.open('finding-searching')}
      />
    ),
  },
  {
    id: 'group-confirmed',
    screen: 'Group confirmed',
    data: () => makePreviewData('confirmed'),
    render: (nav, data) => (
      <MatchFoundScreen
        request={data.request}
        onBack={nav.gallery}
        onEdit={() => nav.open('new-request')}
        onOpenProfile={disabled}
        onFindGroup={disabled}
        onLeft={() => nav.open('finding-searching')}
      />
    ),
  },
];
