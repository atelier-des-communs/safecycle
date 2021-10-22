

const CENTER = [43.623454433187, 7.0469377950208605]

const START="start";
const END="end";
const VAE_SPEEDUP = 0.8;

const BIKE = "bike"
const MEDIUM_TRAFFIC = "medium_traffic"
const DANGER = "danger"
const PATH = "path"
const LOW_TRAFFIC = "low_traffic"

const safe_types = [BIKE, LOW_TRAFFIC, PATH];
const types_order = [PATH, BIKE, LOW_TRAFFIC, MEDIUM_TRAFFIC, DANGER]

const SortType = {
    SAFE : "safe",
    FAST : "fast"
}

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

const state = {
    coords : {
        [START]:null,
        [END]:null
    },
    vtt:true,
    vae:true,
    itineraries:null,
    sort : SortType.SAFE
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

function latlon2latLng(latlon) {
    return {lat:latlon.lat, lng:latlon.lon}
}
function latlng2latlon(latlng) {
    return {lat:latlng.lat, lon:latlng.lng}
}

function createOrUpdateMarker(end, latlon) {

    // Create if not done already
    if (!markers[end]) {
        const icon = new L.Icon({
            iconUrl: '/static/img/markers/marker-' + (end === START ? "green" : "red") + '.png',
            shadowUrl: '/static/img/markers/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        const marker = L.marker(latlon2latLng(latlon), {
                icon,
                draggable: true,
                autoPan: true
            }).addTo(map);

        marker.on("dragend", function (e) {
            updateCoord(end, latlng2latlon(e.target.getLatLng()))
        });

        markers[end] = marker;
    }

    markers[end].setLatLng(latlon2latLng(latlon));
}

function updateCoord(end, latlon) {
    state.coords[end] = latlon;
    stateUpdated();
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
    updateCoord(end, latlng2latlon(e.latlng))
}


map.on("click", onMapClick);


function unsafeDistance(iti) {
    res = 0;
    for (let path of iti.paths) {
        if (safe_types.indexOf(path.type) == -1) {
                res += path.length;
        }
    }
    return res;
}

function updateList() {
    if (!state.itineraries) {
        return;
    }
    const tmpl = $.templates("#itinerary-template");

    let sortedIti = [...state.itineraries]
    sortedIti.sortOn(function (iti) {
        return (state.sort === SortType.SAFE) ? (unsafeDistance(iti)) : iti.time;
    })

    const templateData = sortedIti.map(function (iti) {

        var mins = Math.floor(iti.time / 60)

        if (state.vae) {
            mins = mins * VAE_SPEEDUP;
        }

        let h = Math.floor(mins / 60);
        let m = Math.round(mins % 60);
        let time = (h > 0 ? h + "h " : "") + m + " m"

        const shares = [];

        for (const key in iti.shares) {
            const percentage = iti.shares[key] * 100;
            if (percentage > 0) {
                shares.push({
                    percentage : Math.round(percentage),
                    safe: safe_types.indexOf(key),
                    color: typeColors[key],
                    label : typeNames[key]
                });

            }
        }

        return {
            id:iti.id,
            time,
            shares,
            unsafe :(unsafeDistance(iti) /1000),
            distance: (iti.length/1000).toFixed(1)}
    });

    const html = tmpl.render({
        itineraries:templateData,
        colors:typeColors});

    $("#list-placeholder").html(html);


    // Setup listeners
    $(".iti-item").on("mouseover", function () {
       highlightIti($(this).attr("data-iti-id"));
    });

}

function cleanMap() {
    Object.entries(itiGroups).forEach(([key, groupLayer]) => {
        map.removeLayer(groupLayer)
        delete itiGroups[key];
    });
}

function highlightIti(highlight_id) {
    for (let iti of state.itineraries) {
        // Highlight on map
        itiGroups[iti.id].eachLayer(function (layer) {
            layer.setStyle({opacity: (highlight_id && highlight_id !== iti.id) ? 0.2 : 1});
        });
    }

    $(".iti-item").each(function () {
        let iti_id = $(this).attr("data-iti-id");
        if (iti_id === highlight_id) {
            $(this).addClass("highlighted");
        } else {
            $(this).removeClass("highlighted");
        }
    })
}

function updateMap() {

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

    function drawIti(iti) {

        const polys = []


        function setupHover(path, poly) {
            const content =  Object.entries(path.tags).
                map(([k, v], _) => "<h1>" + k + "</h1> :" + v + "<br/>").
                join("\n");

            //poly.bindTooltip(content, {sticky:true})
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
    state.itineraries.forEach(drawIti);

    let minLat = Math.min(state.coords[START].lat, state.coords[END].lat);
    let maxLat = Math.max(state.coords[START].lat, state.coords[END].lat);
    let minLon = Math.min(state.coords[START].lon, state.coords[END].lon);
    let maxLon = Math.max(state.coords[START].lon, state.coords[END].lon);
    map.fitBounds([
        [minLat, minLon],
        [maxLat, maxLon]
    ]);
}

// Transform to state and update UI
function urlUpdated() {
    let urlParams = new URLSearchParams(window.location.search);
    state.vae = urlParams.get("vae") === "true";
    state.vtt = urlParams.get("profile") === "vtt";
    state.sort = urlParams.get("sort") || "safe";
    for (let end of [START, END]) {
        if (urlParams.has(end)) {
            let [lat, lon] = urlParams.get(end).split(",");
            state.coords[end] = {
                lat : parseFloat(lat),
                lon: parseFloat(lon)
            }
        }
    }
    stateUpdatedNoUrl();
}

function stateUpdated() {
    stateUpdatedNoUrl();
    updateUrl();
}

function stateUpdatedNoUrl() {

    updateSwitchesFromState();
    updateItineraryFromState();

    for (let end of [START, END]) {
        if (state.coords[end]) {
            createOrUpdateMarker(end, state.coords[end]);
        }
    }

    // Both marker setup ? => disable click on map
    if (state.coords[START] && state.coords[END]) {
        map.off("click", onMapClick);
    }
}

// Fetch itinerary and Update both map and list from
function updateItineraryFromState() {
    let start = state.coords[START];
    let end = state.coords[END];

    // Only fetch itinerary when both marker are set
    if (!start|| !end) {
        return
    }

    let url = "/api/itineraries?" + encodeParams ({
        start : start.lat + "," + start.lon,
        end: end.lat + "," + end.lon,
        profile : (state.vtt ? "vtt" : "route")
    });

    $("body").addClass("loading");
    $("#map").addClass("loading");

    jQuery.getJSON(url, function (itineraries) {
        state.itineraries = itineraries;
        updateMap();
        updateList();

    }).fail(function () {
        alert("Aucun itinéraire trouvé");

    }).always(function () {
        $("body").removeClass("loading");
        $("#map").removeClass("loading");
    });
}

function updateSwitchesFromState() {
    $("#vtt-switch").prop('checked', state.vtt);
    $("#vae-switch").prop('checked', state.vae);

    $("input[name=sort]").each(function () {
        let type = $(this).val();
        $(this).prop("checked", type === state.sort);
    })
}

function initAll() {

    urlUpdated();

    $("#vtt-switch").on('change', function() {
        state.vtt = this.checked;
        stateUpdated();
    });

    $("#vae-switch").on('change', function() {
        state.vae = this.checked;
        updateList();
        updateUrl();
    });

    // On sorting change
    $("input[name=sort]").on('change', function() {
        if (this.checked) {
            state.sort = $(this).val();
        }
        updateList();
    });

    window.onpopstate = () => {
        urlUpdated();
    };
}

function updateUrl() {

    const params = {
        profile: (state.vtt ? "vtt" : "route"),
        vae: state.vae,
        sort : state.sort,
    }

    for (let end of [START, END]) {
        if (state.coords[end]) {
            params[end] =
                state.coords[end].lat.toFixed(6) + "," +
                state.coords[end].lon.toFixed(6);
        }
    }

    history.pushState(null, null, "?" + encodeParams(params));
}

function encodeParams(params) {
    const searchParams = new URLSearchParams();
    Object.keys(params).forEach(key => searchParams.append(key, params[key]));
    return searchParams.toString();
}

$(document).ready(function () {
    initAll();
})

Array.prototype.sortOn = function(f){
    this.sort(function(a, b){
        let va = f(a);
        let vb = f(b)
        if(va < vb){
            return -1;
        }else if(va > vb){
            return 1;
        }
        return 0;
    });
}
