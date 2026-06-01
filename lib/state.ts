interface DeviceState {
  latestReading: any;
  history: any[];
  lastSeen: number;
}

const states: Record<string, DeviceState> = {};

function getOrCreateState(deviceId: string): DeviceState {
  if (!states[deviceId]) {
    states[deviceId] = {
      latestReading: null,
      history: [],
      lastSeen: 0,
    };
  }
  return states[deviceId];
}

export function setLatest(reading: any) {
  const deviceId = reading?.device_id || 'building-01';
  const state = getOrCreateState(deviceId);
  state.latestReading = reading;
  state.lastSeen = Date.now();
  
  state.history.unshift(reading);
  if (state.history.length > 1200) state.history.pop();
}

export function getLatest(deviceId: string = 'building-01') {
  const state = states[deviceId];
  if (!state || !state.latestReading) return null;
  
  const online = Date.now() - state.lastSeen < 10000; // Online if seen in last 10s
  
  if (!online) return null; // Don't return stale data if offline
  
  return {
    ...state.latestReading,
    online: true,
    lastSeen: new Date(state.lastSeen).toISOString(),
  };
}

export function getHistory(deviceId: string = 'building-01') {
  const state = states[deviceId];
  return state ? state.history : [];
}

export function isOnline(deviceId: string = 'building-01') {
  const state = states[deviceId];
  return state ? (Date.now() - state.lastSeen < 10000) : false;
}

export function getActiveDevices(): string[] {
  const devices = Object.keys(states);
  if (devices.length === 0) {
    return ['building-01'];
  }
  return devices;
}
