import * as Location from 'expo-location';

import { LOCATION_SEND_DISTANCE_METERS, LOCATION_SEND_INTERVAL_MS } from '../constants';
import { Fix, shouldSendPosition } from './locationSharingRules';
import { supabase } from './supabase';

// "Find your group": live positions go from phone to phone over the group's private Supabase
// Realtime channel (broadcast - not stored anywhere), and presence tells who is sharing right now.
// Only members of the confirmed group can join it (see 20261009010000_find_your_group_sharing.sql).
// Positions must never be logged: no console output in this file may include a payload.

// 'reduced': iOS "approximate location" - off by kilometers, so it counts as not usable here.
export type LocationAccess = 'granted' | 'reduced' | 'denied' | 'unavailable';

function toAccess(permission: Location.LocationPermissionResponse): LocationAccess {
  if (permission.status !== 'granted') return 'denied';
  return permission.ios?.accuracy === 'reduced' ? 'reduced' : 'granted';
}

async function servicesEnabled(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return true;
  }
}

// What the app may use right now, without showing any system prompt.
export async function getLocationAccess(): Promise<LocationAccess> {
  if (!(await servicesEnabled())) return 'unavailable';
  return toAccess(await Location.getForegroundPermissionsAsync());
}

// Foreground ("when in use") only. Shows the system prompt if the passenger hasn't answered it yet.
export async function requestLocationAccess(): Promise<LocationAccess> {
  if (!(await servicesEnabled())) return 'unavailable';
  return toAccess(await Location.requestForegroundPermissionsAsync());
}

export type PeerPosition = Fix & {
  // When it reached this phone - what "last seen" counts from.
  receivedAt: number;
};

export type MeetupChannelStatus = 'joining' | 'joined' | 'rejected';

type Handlers = {
  onStatus: (status: MeetupChannelStatus) => void;
  onPosition: (requestId: string, position: PeerPosition) => void;
  // The ride ids of the members sharing right now.
  onSharing: (requestIds: string[]) => void;
  onOwnFix: (fix: Fix) => void;
};

export type MeetupChannel = {
  startSending: () => Promise<void>;
  stopSending: () => void;
  leave: () => void;
};

const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// Joins the group's channel: receiving starts right away, sending only after startSending().
export function joinMeetupChannel(groupId: string, myRequestId: string, handlers: Handlers): MeetupChannel {
  let joined = false;
  let sending = false;
  let watch: Location.LocationSubscription | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let latest: Fix | null = null;
  let lastSent: Fix | null = null;
  let lastSentAt = 0;

  const channel = supabase.channel(`meetup:${groupId}`, {
    config: { private: true, presence: { key: myRequestId } },
  });

  const sendIfDue = () => {
    if (!joined || !sending || !latest) return;
    const now = Date.now();
    const rule = { intervalMs: LOCATION_SEND_INTERVAL_MS, distanceMeters: LOCATION_SEND_DISTANCE_METERS };
    if (!shouldSendPosition(lastSent, lastSentAt, latest, now, rule)) return;
    lastSent = latest;
    lastSentAt = now;
    channel
      .send({
        type: 'broadcast',
        event: 'position',
        payload: { id: myRequestId, lat: latest.lat, lng: latest.lng, acc: latest.accuracy, t: latest.at },
      })
      .catch(() => {});
  };

  channel
    .on('broadcast', { event: 'position' }, ({ payload }) => {
      if (typeof payload?.id !== 'string' || payload.id === myRequestId) return;
      if (!isCoordinate(payload.lat) || !isCoordinate(payload.lng)) return;
      handlers.onPosition(payload.id, {
        lat: payload.lat,
        lng: payload.lng,
        accuracy: isCoordinate(payload.acc) ? payload.acc : null,
        at: isCoordinate(payload.t) ? payload.t : Date.now(),
        receivedAt: Date.now(),
      });
    })
    .on('presence', { event: 'sync' }, () => {
      handlers.onSharing(Object.keys(channel.presenceState()));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        joined = true;
        handlers.onStatus('joined');
        if (sending) {
          channel.track({ since: Date.now() }).catch(() => {});
          sendIfDue();
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        joined = false;
        handlers.onStatus('rejected');
      } else if (status === 'CLOSED') {
        joined = false;
      }
    });

  const stopSending = () => {
    if (!sending) return;
    sending = false;
    watch?.remove();
    watch = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    latest = null;
    lastSent = null;
    if (joined) channel.untrack().catch(() => {});
  };

  return {
    startSending: async () => {
      if (sending) return;
      sending = true;
      // The device is asked for a fix about every second; which of them go out is decided by
      // sendIfDue (the "time or distance" options behave differently on iOS and Android). The
      // heartbeat re-sends the last fix of a member who is standing still.
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
        (location) => {
          latest = {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            accuracy: location.coords.accuracy,
            at: location.timestamp,
          };
          handlers.onOwnFix(latest);
          sendIfDue();
        }
      );
      if (!sending) {
        // Stopped while the watch was still starting.
        subscription.remove();
        return;
      }
      watch = subscription;
      heartbeat = setInterval(sendIfDue, LOCATION_SEND_INTERVAL_MS);
      if (joined) channel.track({ since: Date.now() }).catch(() => {});
    },
    stopSending,
    leave: () => {
      stopSending();
      joined = false;
      supabase.removeChannel(channel);
    },
  };
}
