import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactElement } from 'react';

import SlideInScreen from '../components/SlideInScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import FindingMatchScreen from '../screens/FindingMatchScreen';
import GroupDetailsScreen, { badgeOpenedKey } from '../screens/GroupDetailsScreen';
import HelpScreen from '../screens/HelpScreen';
import LoginScreen from '../screens/LoginScreen';
import MatchFoundScreen from '../screens/MatchFoundScreen';
import MyRideScreen from '../screens/MyRideScreen';
import NewRequestScreen from '../screens/NewRequestScreen';
import OnTheWayScreen from '../screens/OnTheWayScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RideCompletedScreen from '../screens/RideCompletedScreen';
import SignUpScreen from '../screens/SignUpScreen';
import WelcomeSplashScreen from '../screens/WelcomeSplashScreen';
import { FindGroupSample, makePreviewData, PREVIEW_GROUP_ID, PreviewData } from './fixtures';
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
  // Done before the screen opens: what the phone remembers that the screen reads.
  prepare?: () => Promise<void>;
  render: (nav: PreviewNav, data: PreviewData) => ReactElement;
};

const disabled = () => notifyPreviewAction();

// "Find your group" opens the badge by itself once per group, on arrival. The "Arrived" entry shows
// the screen after that; every other one is a first arrival, so "I'm at the meeting point" opens
// the badge as it would for real.
const badgeAlreadyShown = (shown: boolean) => () =>
  shown ? AsyncStorage.setItem(badgeOpenedKey(PREVIEW_GROUP_ID), 'yes') : AsyncStorage.removeItem(badgeOpenedKey(PREVIEW_GROUP_ID));

function findGroupEntry(id: string, state: string, sample: FindGroupSample, prepare = badgeAlreadyShown(false)): PreviewEntry {
  return {
    id,
    screen: 'Find your group',
    state,
    data: () => makePreviewData('meetup', { findGroup: sample }),
    prepare,
    render: (nav, data) => <GroupDetailsScreen request={data.request} onBack={nav.gallery} onRideStarted={() => nav.open('on-the-way')} />,
  };
}

const matchFound = (nav: PreviewNav, data: PreviewData) => (
  <MatchFoundScreen
    request={data.request}
    onBack={nav.gallery}
    onEdit={() => nav.open('new-request')}
    onOpenProfile={() => nav.open('profile')}
    onFindGroup={() => nav.open('find-group-before')}
    onLeft={() => nav.open('finding-searching')}
  />
);

const rideCompleted = (stars?: number) => (nav: PreviewNav, data: PreviewData) => (
  <RideCompletedScreen requestId={data.request.id} onDone={nav.gallery} initialStars={stars} />
);

const help = (requests: boolean) => (nav: PreviewNav) => (
  <SlideInScreen>
    <HelpScreen
      onBack={() => nav.open('profile')}
      onOpenMyRide={() => nav.open('group-confirmed')}
      onEditRide={() => nav.open('new-request')}
      onOpenPaymentMethods={() => nav.open('profile')}
      onShowBadge={() => nav.open('badge')}
      onNewRide={() => nav.open('new-request')}
      openRequestsOnStart={requests}
    />
  </SlideInScreen>
);

const profile = (editing: boolean) => (nav: PreviewNav) => (
  <ProfileScreen onBack={nav.gallery} onOpenHelp={() => nav.open('help')} onChangePassword={() => nav.open('change-password')} initialEditing={editing} />
);

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
    render: (nav) => <MyRideScreen onBack={nav.gallery} onCreateRequest={() => nav.open('new-request')} onOpenProfile={() => nav.open('profile')} />,
  },
  {
    id: 'match-found',
    screen: 'Match found',
    state: 'Offer - secure your spot',
    data: () => makePreviewData('offer'),
    render: matchFound,
  },
  {
    id: 'group-confirmed',
    screen: 'Group confirmed',
    data: () => makePreviewData('confirmed'),
    render: matchFound,
  },
  findGroupEntry('find-group-before', 'Before you land', 'beforeLanding'),
  findGroupEntry('find-group-permission', 'No location permission', 'permission'),
  findGroupEntry('find-group-far', 'Far away', 'far'),
  findGroupEntry('find-group-arrow', 'Arrow', 'arrow'),
  findGroupEntry('find-group-almost', 'Almost there', 'almostThere'),
  findGroupEntry('find-group-arrived', 'Arrived', 'arrived', badgeAlreadyShown(true)),
  // Arrived for the first time: the badge opens by itself.
  { ...findGroupEntry('badge', '', 'arrived'), screen: 'Badge', state: undefined },
  {
    id: 'on-the-way',
    screen: 'On the way',
    data: () => makePreviewData('onTheWay'),
    render: (nav, data) => (
      <OnTheWayScreen
        requestId={data.request.id}
        onBack={nav.gallery}
        onShowDetails={disabled}
        onArrived={() => nav.open('ride-completed-pending')}
      />
    ),
  },
  {
    id: 'ride-completed-pending',
    screen: 'Ride completed',
    state: 'Final amounts pending',
    data: () => makePreviewData('completed', { payment: 'pending' }),
    render: rideCompleted(),
  },
  {
    id: 'ride-completed-paid',
    screen: 'Ride completed',
    state: 'Paid',
    data: () => makePreviewData('completed', { payment: 'paid' }),
    render: rideCompleted(),
  },
  {
    id: 'ride-completed-rating',
    screen: 'Ride completed',
    state: 'Rating popup',
    data: () => makePreviewData('completed', { payment: 'paid' }),
    render: rideCompleted(2),
  },
  {
    id: 'profile',
    screen: 'Profile',
    data: () => makePreviewData('confirmed'),
    render: profile(false),
  },
  {
    id: 'edit-profile',
    screen: 'Edit profile',
    data: () => makePreviewData('confirmed'),
    render: profile(true),
  },
  {
    id: 'change-password',
    screen: 'Change password',
    data: () => makePreviewData('confirmed'),
    render: (nav) => (
      <SlideInScreen>
        <ChangePasswordScreen onBack={() => nav.open('profile')} />
      </SlideInScreen>
    ),
  },
  {
    id: 'help',
    screen: 'Help',
    state: 'FLOQQ Assistant',
    data: () => makePreviewData('confirmed'),
    render: help(false),
  },
  {
    id: 'help-requests',
    screen: 'Help',
    state: 'Your requests',
    data: () => makePreviewData('confirmed'),
    render: help(true),
  },
];
