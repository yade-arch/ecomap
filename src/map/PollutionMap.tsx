// Native map (Android and iOS): an OpenStreetMap map drawn with Leaflet inside a WebView.
// It needs no Google Maps API key, so it works the same in Expo Go and in an installed app.
// The browser version lives in PollutionMap.web.tsx. Both take the same props, so a screen
// never needs to know which one it got.
import { type ComponentType, useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent } from 'react-native-webview';

// The library's class typings do not match React 19's JSX types yet; the runtime component is fine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WebView = RNWebView as unknown as ComponentType<any>;
type WebViewHandle = { injectJavaScript: (script: string) => void };

import { colors } from '@/ui/theme';

import { INITIAL_REGION, type PollutionMapProps } from './types';

const PIN_COLORS = {
  low: colors.low,
  medium: colors.medium,
  high: colors.high,
  cleaned: colors.cleaned,
  pending: colors.pending,
};

function buildHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { height: 100%; margin: 0; background: #e5e7eb; }
  .pin { width: 24px; height: 24px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.45); box-sizing: border-box; }
  .zone { width: 34px; height: 34px; border-radius: 50%; background: #F59E0B; border: 3px solid #fff; box-shadow: 0 1px 6px rgba(0,0,0,.45); box-sizing: border-box; color: #fff; font: 800 11px/28px system-ui, sans-serif; text-align: center; }
  .zone-tip { background: #92400E; color: #fff; border: 0; font: 700 11px system-ui, sans-serif; }
  .zone-tip:before { display: none; }
  .me { width: 16px; height: 16px; border-radius: 50%; background: #2563eb; border: 3px solid #fff; box-shadow: 0 0 0 5px rgba(37,99,235,.25); box-sizing: border-box; }
  .leaflet-control-attribution { font-size: 9px; }
</style></head>
<body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var COLORS = ${JSON.stringify(PIN_COLORS)};
  function send(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  var map = L.map('map', { zoomControl: false }).setView([${INITIAL_REGION.latitude}, ${INITIAL_REGION.longitude}], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  var zones = L.layerGroup().addTo(map);
  var layer = L.layerGroup().addTo(map);
  var me = null;
  map.on('click', function (e) { send({ type: 'mapPress', latitude: e.latlng.lat, longitude: e.latlng.lng }); });
  window.ecomap = function (m) {
    if (!m) return;
    if (m.type === 'markers') {
      layer.clearLayers();
      (m.markers || []).forEach(function (k) {
        var icon = L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12],
          html: '<div class="pin" style="background:' + (COLORS[k.kind] || '#999') + '"></div>' });
        L.marker([k.latitude, k.longitude], { icon: icon }).addTo(layer).on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          send({ type: 'markerPress', id: k.id });
        });
      });
    } else if (m.type === 'zones') {
      zones.clearLayers();
      (m.zones || []).forEach(function (z) {
        L.circle([z.latitude, z.longitude], { radius: z.radius, color: '#F59E0B', weight: 2, fillColor: '#FBBF24', fillOpacity: 0.18, dashArray: '6 6', interactive: false }).addTo(zones);
        var icon = L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="zone">&#9733;' + z.label + '</div>' });
        L.marker([z.latitude, z.longitude], { icon: icon, zIndexOffset: 1000 }).addTo(zones)
          .bindTooltip(z.title, { direction: 'top', offset: [0, -16], className: 'zone-tip' })
          .on('click', function (e) { L.DomEvent.stopPropagation(e); send({ type: 'zonePress', id: z.id }); });
      });
    } else if (m.type === 'focus') {
      map.flyTo([m.latitude, m.longitude], m.zoomedIn ? 16 : 12, { duration: 0.6 });
    } else if (m.type === 'user') {
      if (me) { map.removeLayer(me); me = null; }
      if (m.coords) {
        me = L.marker([m.coords.latitude, m.coords.longitude], { interactive: false,
          icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="me"></div>' }) }).addTo(map);
      }
    }
  };
  send({ type: 'ready' });
</script></body></html>`;
}

export default function PollutionMap({
  markers,
  focus,
  showsUserLocation,
  userLocation,
  onMarkerPress,
  onMapPress,
  zones,
  onZonePress,
}: PollutionMapProps) {
  const view = useRef<WebViewHandle>(null);
  const ready = useRef(false);
  const html = useMemo(buildHtml, []);

  // Keep the newest values where the message handler can reach them.
  const latest = useRef({ markers, userLocation, showsUserLocation, onMarkerPress, onMapPress, zones, onZonePress });
  latest.current = { markers, userLocation, showsUserLocation, onMarkerPress, onMapPress, zones, onZonePress };

  const post = (message: Record<string, unknown>) => {
    view.current?.injectJavaScript(`window.ecomap && window.ecomap(${JSON.stringify(message)}); true;`);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; id?: unknown; latitude?: unknown; longitude?: unknown } | null = null;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!message) return;
    if (message.type === 'ready') {
      ready.current = true;
      post({ type: 'markers', markers: latest.current.markers });
      post({ type: 'user', coords: latest.current.showsUserLocation ? latest.current.userLocation : null });
      post({ type: 'zones', zones: latest.current.zones ?? [] });
    } else if (message.type === 'markerPress' && typeof message.id === 'string') {
      latest.current.onMarkerPress(message.id);
    } else if (message.type === 'zonePress' && typeof message.id === 'string') {
      latest.current.onZonePress?.(message.id);
    } else if (message.type === 'mapPress' && typeof message.latitude === 'number' && typeof message.longitude === 'number') {
      latest.current.onMapPress?.({ latitude: message.latitude, longitude: message.longitude });
    }
  };

  useEffect(() => {
    if (ready.current) post({ type: 'markers', markers });
  }, [markers]);

  useEffect(() => {
    if (ready.current) post({ type: 'user', coords: showsUserLocation ? userLocation : null });
  }, [userLocation, showsUserLocation]);

  useEffect(() => {
    if (ready.current) post({ type: 'zones', zones: zones ?? [] });
  }, [zones]);

  useEffect(() => {
    if (ready.current && focus) post({ type: 'focus', ...focus });
  }, [focus]);

  return (
    <WebView
      ref={view}
      style={StyleSheet.absoluteFill}
      originWhitelist={['*']}
      // The base URL gives tile requests a Referer, which the OpenStreetMap tile servers require.
      source={{ html, baseUrl: 'https://ecomap.app/' }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      overScrollMode="never"
      bounces={false}
    />
  );
}
