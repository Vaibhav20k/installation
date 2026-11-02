export interface PunchLocation {
    latitude: number;
    longitude: number;
    accuracy: number;
    capturedAt: string;
}
export function capturePunchLocation(): Promise<PunchLocation> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Location is unavailable on this device.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, capturedAt: new Date(p.timestamp).toISOString() }), () => reject(new Error('Allow location access to record your site punch. If location is unavailable, ask your supervisor to record a correction with a reason.')), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    });
}
