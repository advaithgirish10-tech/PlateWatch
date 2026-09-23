/* leaflet.markercluster extends the global L, so expose Leaflet before it is imported */
import L from "leaflet";
window.L = L;
export default L;
