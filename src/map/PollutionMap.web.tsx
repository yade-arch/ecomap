// Browser version of the map (used by `npx expo start --web` and by the moderation site).
// react-native-maps has no web build, so this draws an OpenStreetMap map with Leaflet inside
// an isolated iframe and talks to it with postMessage.
import { createElement, useEffect, useMemo, useRef } from 'react';

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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { height: 100%; margin: 0; }
  .pin { width: 22px; height: 22px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.45); box-sizing: border-box; }
  .me { width: 14px; height: 14px; border-radius: 50%; background: #2563eb; border: 3px solid #fff; box-shadow: 0 0 0 4px rgba(37,99,235,.25); box-sizing: border-box; }
</style></head>
<body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var COLORS = ${JSON.stringify(PIN_COLORS)};
  var map = L.map('map', { zoomControl: true }).setView([${INITIAL_REGION.latitude}, ${INITIAL_REGION.longitude}], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  var layer = L.layerGroup().addTo(map);
  var me = null;
  function send(message) { parent.postMessage(Object.assign({ source: 'ecomap-map' }, message), '*'); }
  map.on('click', function () { send({ type: 'mapPress' }); });
  window.addEventListener('message', function (event) {
    var m = event.data || {};
    if (m.target !== 'ecomap-map') return;
    if (m.type === 'markers') {
      layer.clearLayers();
      (m.markers || []).forEach(function (k) {
        var icon = L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
          html: '<div class="pin" style="background:' + (COLORS[k.kind] || '#999') + '"></div>' });
        L.marker([k.latitude, k.longitude], { icon: icon }).addTo(layer).on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          send({ type: 'markerPress', id: k.id });
        });
      });
    } else if (m.type === 'focus') {
      map.flyTo([m.latitude, m.longitude], m.zoomedIn ? 16 : 12, { duration: 0.6 });
    } else if (m.type === 'user') {
      if (me) { map.removeLayer(me); me = null; }
      if (m.coords) {
        me = L.marker([m.coords.latitude, m.coords.longitude], { interactive: false,
          icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="me"></div>' }) }).addTo(map);
      }
    }
  });
  send({ type: 'ready' });
</script></body></html>`;
}

export default function PollutionMap({ markers, focus, userLocation, onMarkerPress, onMapPress }: PollutionMapProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const ready = useRef(false);
  const html = useMemo(buildHtml, []);

  // Keep the newest values where the message handler can reach them without re-subscribing.
  const latest = useRef({ markers, userLocation, onMarkerPress, onMapPress });
  latest.current = { markers, userLocation, onMarkerPress, onMapPress };

  const post = (message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ target: 'ecomap-map', ...message }, '*');
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.source !== 'ecomap-map' || event.source !== frame.current?.contentWindow) return;
      if (message.type === 'ready') {
        ready.current = true;
        post({ type: 'markers', markers: latest.current.markers });
        post({ type: 'user', coords: latest.current.userLocation });
      } else if (message.type === 'markerPress' && typeof message.id === 'string') {
        latest.current.onMarkerPress(message.id);
      } else if (message.type === 'mapPress') {
        latest.current.onMapPress?.();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (ready.current) post({ type: 'markers', markers });
  }, [markers]);

  useEffect(() => {
    if (ready.current) post({ type: 'user', coords: userLocation });
  }, [userLocation]);

  useEffect(() => {
    if (ready.current && focus) post({ type: 'focus', ...focus });
  }, [focus]);

  return createElement('iframe', {
    ref: frame,
    title: 'EcoMap',
    srcDoc: html,
    style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 },
  });
}
