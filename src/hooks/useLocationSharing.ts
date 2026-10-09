import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { logLocationSharing, SharingStopReason } from '../services/findGroup';
import { joinMeetupChannel, MeetupChannel, MeetupChannelStatus, PeerPosition } from '../services/locationSharing';
import { Fix } from '../services/locationSharingRules';

type Options = {
  groupId: string | null;
  myRequestId: string;
  // The meetup is running: the group is confirmed, its window is open and nothing ended it.
  active: boolean;
  // Why it isn't, once it stopped - recorded as the reason sharing ended.
  inactiveReason: Extract<SharingStopReason, 'timeout' | 'group_ended'>;
  // The phone's own position (useOwnLocation), and whether the app may read it at all. The
  // position is only ever sent on after start().
  fix: Fix | null;
  hasLocation: boolean;
};

// "Find your group" live location sharing with the group, for the screen that mounts it - a
// separate opt-in from the passenger's own guidance. While the meetup is active and the app is in
// the foreground the phone is on the group's channel and receives the others' positions; it only
// sends its own after start(). Sharing ends by itself when the screen is left, the app goes to
// the background or the meetup stops being active - and resumes when the passenger comes back,
// unless they tapped "Stop sharing".
export function useLocationSharing({ groupId, myRequestId, active, inactiveReason, fix, hasLocation }: Options) {
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [channel, setChannel] = useState<MeetupChannel | null>(null);
  const [channelStatus, setChannelStatus] = useState<MeetupChannelStatus>('joining');
  const [wantsSharing, setWantsSharing] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  // Kept across re-joins: the last position of someone who stopped sharing is what "last seen"
  // counts from. In memory only.
  const [positions, setPositions] = useState<Record<string, PeerPosition>>({});
  const [sharingIds, setSharingIds] = useState<string[]>([]);

  // What is true right now, for the moment sharing stops and its reason has to be worked out.
  const latest = useRef({ appActive, active, inactiveReason, hasLocation, userStopped: false });
  latest.current.appActive = appActive;
  latest.current.active = active;
  latest.current.inactiveReason = inactiveReason;
  latest.current.hasLocation = hasLocation;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!groupId || !active || !appActive) return;
    setChannelStatus('joining');
    const joined = joinMeetupChannel(groupId, myRequestId, {
      onStatus: setChannelStatus,
      onPosition: (requestId, position) => setPositions((current) => ({ ...current, [requestId]: position })),
      onSharing: setSharingIds,
    });
    setChannel(joined);
    return () => {
      joined.leave();
      setChannel(null);
      setSharingIds([]);
    };
  }, [groupId, myRequestId, active, appActive]);

  useEffect(() => {
    if (!channel || !wantsSharing || !hasLocation) return;

    channel.startSending();
    setIsSharing(true);
    logLocationSharing(myRequestId, 'location_sharing_started');

    return () => {
      channel.stopSending();
      setIsSharing(false);
      const now = latest.current;
      const reason: SharingStopReason = now.userStopped
        ? 'user'
        : !now.active
          ? now.inactiveReason
          : !now.appActive
            ? 'background'
            : !now.hasLocation
              ? 'permission'
              : 'left_screen';
      logLocationSharing(myRequestId, 'location_sharing_stopped', reason);
    };
  }, [channel, wantsSharing, hasLocation, myRequestId]);

  // Every position the phone reads goes to the channel, which decides what is actually sent.
  useEffect(() => {
    if (channel && isSharing && fix) channel.pushFix(fix);
  }, [channel, isSharing, fix]);

  // The caller makes sure the app may read the location before calling this.
  const start = useCallback(() => {
    latest.current.userStopped = false;
    setWantsSharing(true);
  }, []);

  const stop = useCallback(() => {
    latest.current.userStopped = true;
    setWantsSharing(false);
  }, []);

  return { channelStatus, isSharing, positions, sharingIds, start, stop };
}
