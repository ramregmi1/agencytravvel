// Himalayan Modernism style rules for this file:
// - Bold saffron accents on deep slate bases
// - Glass surfaces + crisp borders
// - Dramatic imagery, never "flat" gradients

import L from "leaflet";
import marker2x from "leaflet/dist/images/marker-icon-2x.png";
import marker from "leaflet/dist/images/marker-icon.png";
import shadow from "leaflet/dist/images/marker-shadow.png";

// Fix Leaflet marker icons in Vite builds
L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: marker,
  shadowUrl: shadow,
});
