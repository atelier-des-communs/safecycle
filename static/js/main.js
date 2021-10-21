

const CENTER = [43.623454433187, 7.0469377950208605]

const START="start";
const END="end"

const state = {
    coords : {
        [START]:null,
        [END]:null
    },
    vtt:true
}

const markers = {
    [START]:null,
    [END]:null
}

const itiGroups = {};

const map = L.map('map').setView(CENTER, 16);

const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).setOpacity(0.7).addTo(map);


function updateCoords(end, latlng) {
    state.coords[end] = {
        lat:latlng.lat,
        lon:latlng.lng};
    updateItinerary();
}



function addMarker(end, latlng) {
    const icon = new L.Icon({
      iconUrl: '/static/img/markers/marker-' + (end === START ? "green" : "red") + '.png',
      shadowUrl: '/static/img/markers/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    const marker = L.marker(
        latlng, {
                icon,
                draggable: true,
                autoPan: true}).
        addTo(map);

    marker.on("dragend", function(e) {
        updateCoords(end, e.target.getLatLng());
    });

    updateCoords(end, latlng)
    markers[end] = marker;

    // Disable click
    if (end === END) {
        map.off("click", onMapClick)
    }
    updateItinerary();
}

function onMapClick(e) {
    var end = null;
    if (!state.coords[START]) {
        end = START;
    } else if (!state.coords[END]) {
        end = END;
    } else {
        return;
    }
    addMarker(end, e.latlng)
}


map.on("click", onMapClick);


const BIKE = "bike"
const MEDIUM_TRAFFIC = "medium_traffic"
const DANGER = "danger"
const PATH = "path"
const LOW_TRAFFIC = "low_traffic"

const safe_types = [BIKE, LOW_TRAFFIC, PATH];
const types_order = [PATH, BIKE, LOW_TRAFFIC, MEDIUM_TRAFFIC, DANGER]

const typeColors = {
    [BIKE] : "#8efc95",
    [MEDIUM_TRAFFIC] : "#ffb84d",
    [DANGER] : "#ff5d5d",
    [PATH] : "#dc9364",
    [LOW_TRAFFIC] : "#96daff"
}
const typeNames = {
    [BIKE] : "protégé",
    [MEDIUM_TRAFFIC] : "traffic moyen",
    [DANGER] : "danger",
    [PATH] : "chemin",
    [LOW_TRAFFIC] : "traffic faible"
}

function updateList(itineraries) {
    const tmpl = $.templates("#itinerary-template");
    itineraries = itineraries.map(function (iti) {

        var mins = Math.floor(iti.time / 60)
        let h = Math.floor(mins / 60);
        let m = Math.round(mins % 60);
        let time = (h > 0 ? h + "h " : "") + m + " m"

        const shares = [];
        var safety = 0;
        for (const key in iti.shares) {
            const percentage = iti.shares[key] * 100;
            if (percentage > 0) {
                shares.push({
                    percentage : Math.round(percentage),
                    safe: safe_types.indexOf(key),
                    color: typeColors[key],
                    label : typeNames[key]
                });
                if (safe_types.indexOf(key) !== -1) {
                    safety += percentage;
                }
            }
        }

        return {
            colors:typeColors,
            id:iti.id,
            time,
            shares,
            safety : Math.round(safety),
            distance: (iti.length/1000).toFixed(1)}
    });
    console.log(itineraries)
    const html = tmpl.render({itineraries});
    $("#list-placeholder").html(html);
}

function cleanMap() {
    Object.entries(itiGroups).forEach(([key, groupLayer]) => {
        map.removeLayer(groupLayer)
        delete itiGroups[key];
    });
}

function updateMap(itineraries) {

    cleanMap();

    function toGeoJson(path) {
        return  {
            "type": "Feature",
            "properties": {
                tags: path.tags,
                type: path.type,
            },
            "geometry": {
                "type": "LineString",
                "coordinates": path.coords.map(coord => [coord.lon, coord.lat])
            }
        }
    }

    function highlightIti(highlight_id) {
        for (const id in itiGroups)
        itiGroups[id].eachLayer(function(layer) {
            layer.setStyle({opacity: (highlight_id && highlight_id !== id) ? 0.2 : 1 });
        });
    }

    function drawIti(iti) {

        const polys = []


        function setupHover(path, poly) {
            const content =  Object.entries(path.tags).
                map(([k, v], _) => "<h1>" + k + "</h1> :" + v + "<br/>").
                join("\n");

            poly.bindTooltip(content, {sticky:true})
            poly.on('mouseover', function()  {
                highlightIti(iti.id);
            });
            poly.on('mouseout', function()  {
                highlightIti(null);
            })
        }

        const className = "iti-" + iti.id

        // Add dark line behind
        iti.paths.forEach(function (path) {

            const transpLine = L.geoJSON(
                toGeoJson(path),
                {style: {
                        weight: 20,
                        color: "rgba(0,0,0,0)",
                        className}
                });

            const blackLine = L.geoJSON(
                toGeoJson(path),
                {style: {
                        weight: 8,
                        color: "black",
                        className}
                });

            setupHover(path, transpLine);
            setupHover(path, blackLine);
            polys.push(transpLine, blackLine);
        });

        const styleFn = function (js) {
            return {
                weight:4,
                color :typeColors[js.properties.type],
                className
            };
        }

        // Add thin line with color for security
        iti.paths.forEach(function (path) {
            const poly = L.geoJSON(
                toGeoJson(path),
                {style: styleFn});

            setupHover(path, poly);
            polys.push(poly);
        });

        itiGroups[iti.id] = L.layerGroup(polys).addTo(map);
    }

    itineraries.forEach(drawIti);

}

function updateItinerary() {

    let start = state.coords[START];
    let end = state.coords[END];

    if (!start|| !end) {
        return
    }

    let url = "/api/itineraries?" +
        "start=" + start.lat + "," + start.lon +
        "&end=" + end.lat + "," + end.lon +
        "&profile=" + (state.vtt ? "vtt" : "route");

    $("body").addClass("loading");
    $("#map").addClass("loading");

    jQuery.getJSON(url, function (itineraries) {
        updateMap(itineraries)
        updateList(itineraries);
    }).fail(function () {
        alert("Aucun itinéraire trouvé")
    }).always(function () {
        $("body").removeClass("loading");
        $("#map").removeClass("loading");
    });
}

function initFromState() {
    $("#vtt-switch").prop('checked', state.vtt);
}

$(document).ready(function () {

    initFromState();

    $("#vtt-switch").on('change', function() {
        state.vtt = this.checked;
        updateItinerary();
    });

})

