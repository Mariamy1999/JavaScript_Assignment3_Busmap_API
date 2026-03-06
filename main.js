// IIFE
(function(){

const API_URL = "https://halifax-transit-data.onrender.com/vehicles";
const REFRESH_INTERVAL = 7000;

let map;
let busLayer = null;

const busIcon = L.icon({
    iconUrl: "bus.png",
    iconSize: [30,30],
    iconAnchor: [15,15]
});


function createMap(){

    map = L.map("map").setView([44.6488, -63.5752], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
        attribution:"© OpenStreetMap"
    }).addTo(map);

}


function fetchTransitData(){

    fetch(API_URL)
    .then(res => res.json())
    .then(data => {

        console.log("RAW DATA:",data);

        const filtered = filterRoutes(data);

        const geojson = convertToGeoJSON(filtered);

        console.log("GEOJSON:",geojson);

        plotVehicles(geojson);

    });

}


function filterRoutes(data){

    return data.entity.filter(bus => {

        const route = bus.vehicle.trip.routeId;

        return route >=1 && route <=10;

    });

}


function convertToGeoJSON(buses){

    return {
        type:"FeatureCollection",

        features: buses.map(bus => ({

            type:"Feature",

            properties:{
                route: bus.vehicle.trip.routeId,
                bearing: bus.vehicle.position.bearing
            },

            geometry:{
                type:"Point",

                coordinates:[
                    bus.vehicle.position.longitude,
                    bus.vehicle.position.latitude
                ]
            }

        }))
    };

}


function plotVehicles(geojson){

    if(busLayer){
        map.removeLayer(busLayer);
    }

    busLayer = L.geoJSON(geojson,{

        pointToLayer:function(feature,latlng){

            return L.marker(latlng,{
                icon:busIcon,
                rotationAngle:feature.properties.bearing
            });

        },

        onEachFeature:function(feature,layer){

            layer.bindPopup(
                "Route: " + feature.properties.route
            );

        }

    }).addTo(map);

}


function startApp(){

    createMap();

    fetchTransitData();

    setInterval(fetchTransitData, REFRESH_INTERVAL);

}


startApp();

})();