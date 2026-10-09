import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { logLocationSharing, SharingStopReason } from '../services/findGroup';
import {
  getLocationAccess,
  joinMeetupChannel,
  LocationAccess,
  MeetupChannel,
  MeetupChannelStatus,
  PeerPosition,
  requestLocationAccess,
} from '../services/locationSharing';
import { Fix } from '../services/locationSharingRules';

type Options = {
  groupId: string | null;
  myRequestId: string;
  // The meetup is running: the group is confirmed, its window is open and nothing ended it.
  active: boolean;
  // Why it isn't, once it stopped - recorded as the reason sharing ended.
  inactiveReason: Extract<SharingStopReason, 'timeout' | 'group_ended'>;
};

// "Find your group" live location sharing for the screen that mounts it. While the meetup is
// active and the app is in the foreground the phone is on the group's channel and receives the
// others' positions; it only sends its own after start(). Sharing ends by itself when the screen
// is left, the app goes to the background or the meetup stops being active - and resumes when the
// passenger comes back, unless they tapped "Stop sharing".
export function useLocationSharing({ groupId, myRequestId, active, inactiveReason }: Options) {
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [channel, setChannel] = useState<MeetupChannel | null>(null);
  const [channelStatus, setChannelStatus] = useState<MeetupChannelStatus>('joining');
  const [wantsSharing, setWantsSharing] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [myFix, setMyFix] = useState<Fix | null>(null);
  // Kept across re-joins: the last position of someone who stopped sharing is what "last seen"
  // counts from. In memory only.
  const [positions, setPositions] = useState<Record<string, PeerPosition>>({});
  const [sharingIds, setSharingIds] = useState<string[]>([]);

  // What is true right now, for the moment sharing stops and its reason has to be worked out.
  const latest = useRef({ appActive, active, inactiveReason, userStopped: false });
  latest.current.appActive = appActive;
  latest.current.active = active;
  latest.current.inactiveReason = inactiveReason;

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
      onOwnFix: setMyFix,
    });
    setChannel(joined);
    return () => {
      joined.leave();
      setChannel(null);
      setSharingIds([]);
    };
  }, [groupId, myRequestId, active, appActive]);

  useEffect(() => {
    if (!channel || !wantsSharing) return;
    let cancelled = false;
    let started = false;

    (async () => {
      const current = await getLocationAccess();
      if (cancelled) return;
      setAccess(current);
      if (current !== 'granted') {
        // Permission was taken away in the meantime (e.g. in Settings while in the background).
        setWantsSharing(false);
        return;
      }
      try {
        await channel.startSending();
      } catch {
        if (!cancelled) {
          setAccess('unavailable');
          setWantsSharing(false);
        }
        return;
      }
      if (cancelled) return;
      started = true;
      setIsSharing(true);
      logLocationSharing(myRequestId, 'location_sharing_started');
    })();

    return () => {
      cancelled = true;
      channel.stopSending();
      setIsSharing(false);
      setMyFix(null);
      if (!started) return;
      const now = latest.current;
      const reason: SharingStopReason = now.userStopped
        ? 'user'
        : !now.active
          ? now.inactiveReason
          : !now.appActive
            ? 'background'
            : 'left_screen';
      logLocationSharing(myRequestId, 'location_sharing_stopped', reason);
    };
  }, [channel, wantsSharing, myRequestId]);

  // Asks for the permission if needed, then starts sharing. Returns what was granted.
  const start = useCallback(async () => {
    const granted = await requestLocationAccess();
    setAccess(granted);
    if (granted === 'granted') {
      latest.current.userStopped = false;
      setWantsSharing(true);
    }
    return granted;
  }, []);

  const stop = useCallback(() => {
    latest.current.userStopped = true;
    setWantsSharing(false);
  }, []);

  return { access, channelStatus, isSharing, myFix, positions, sharingIds, start, stop };
}
