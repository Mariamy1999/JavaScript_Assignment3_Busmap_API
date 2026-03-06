// IIFE
(() => {

function loadBusData(){

  fetch("https://halifax-transit-data.onrender.com/vehicles")
  .then(res => res.json())
  .then(data => {
      console.log(data);
  });

  const filteredBuses = data.entity.filter(bus => {
    const route = bus.vehicle.trip.routeId;
    return route >= 1 && route <= 10;
  });

  const geoJSON = {
    type: "FeatureCollection",
    features: filteredBuses.map(bus => ({
        type: "Feature",
        properties: {
            route: bus.vehicle.trip.routeId
        },
        geometry: {
            type: "Point",
            coordinates: [
                bus.vehicle.position.longitude,
                bus.vehicle.position.latitude
            ]
        }
    }))
  };

  L.geoJSON(geoJSON).addTo(map);

  const busIcon = L.icon({
    iconUrl: "bus.png",
    iconSize: [30, 30]
  });

  L.geoJSON(geoJSON, {
    pointToLayer: function(feature, latlng) {
        return L.marker(latlng, {icon: busIcon});
    }
  }).addTo(map);

  leaflet-rotatedmarker.js

  return L.marker(latlng, {
    icon: busIcon,
    rotationAngle: feature.properties.bearing
  });

  onEachFeature: function(feature, layer) {
    layer.bindPopup(
        "Route: " + feature.properties.route
    );
  }

  setInterval(() => {
    loadBusData();
  }, 7000);

}

loadBusData();



})()