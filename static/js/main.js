

const CENTER = [43.623454433187, 7.0469377950208605]
const INIT_ZOOM = 14
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
const NB_DAYS_PER_YEAR = 220
const COST_PER_KM = 0.25
const CO2_PER_KM = 0.120

const SortType = {
    SAFE : "safe",
    FAST : "fast"
}

const address_parts = ["shop", "tourism", "amenity", "road", "village", "town", "city"]

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
    sort : SortType.SAFE,
    selected : null,
    estimatesClosed : false
}

const markers = {
    [START]:null,
    [END]:null
}

const locationPickerCoords = {
    [START]:null,
    [END]:null
}


var map = null;
const PANES = {};
var geojsonLayers = [];

const TOP_PANE_ZINDEX = 440;
const LOW_PANE_ZINDEX = 430;

L.Control.Legend = L.Control.extend({
    onAdd : function (map) {
        let types  = types_order.map(type => ({
            color:typeColors[type],
            name: typeNames[type]}))
        let html = renderTemplate("#legend-template", {types});

        let res = $(html);

        $("button.toggle-legend", res).click(function(e) {
            let hidden = $(".legend-content").hasClass("hidden");
            $(this).text(hidden ? "-" : "+")
            $(".legend-content").toggleClass("hidden", !hidden);
            e.stopPropagation();
        });

        return res.get(0);
    }
});

L.Control.CurrentLocationButton = L.Control.extend({
    onAdd : function (map) {

        let res = $("<button class='btn btn-light btn-sm current-location' type='button' title='Centrer sur votre position actuelle'>" +
            "<img src='/static/img/current-location.svg'/>" +
            "</button>");

        res.click(function(e) {
            navigator.geolocation.getCurrentPosition(function(position) {
                map.setView([position.coords.latitude, position.coords.longitude], INIT_ZOOM+3);
            });
            e.stopPropagation();
        });

        return res.get(0);
    },
});

L.Control.ClearButton = L.Control.extend({
    onAdd : function (map) {

        let res = $('<button class="btn btn-light btn-sm reset" type="button" title="Supprimer l\'itinéraire">' +
            "<i class='bi bi-trash'" +
            "</button>");

        res.click(function(e) {
           reset();
           e.stopPropagation()
        });

        return res.get(0);
    },
});


function initMap() {

    let map = L.map('map',
    {
        // dragging: !L.Browser.mobile
    }).setView(CENTER, INIT_ZOOM);

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).setOpacity(0.7).addTo(map);


    for (let profile of ["route", "vtt"]) {
        for (let alternative of [1, 2, 3, 4]) {
            let id = profile + "-" + alternative;
            let pane = map.createPane(id);
            pane.style.zIndex = LOW_PANE_ZINDEX;
            PANES[id] = pane
        }
    }

    new L.Control.Legend({position: 'topright'}).addTo(map);
    new L.Control.CurrentLocationButton({position: 'topleft'}).addTo(map);
    new L.Control.ClearButton({position: 'topleft'}).addTo(map);

    map.on("click", onMapClick);
    return map;
}

function latlon2latLng(latlon) {
    return {lat:latlon.lat, lng:latlon.lon}
}
function latlng2latlon(latlng) {
    return {lat:latlng.lat, lon:latlng.lng}
}

function reset() {
    state.coords[START] = null
    state.coords[END] = null;
    stateUpdated();
}

function createOrUpdateMarker(end, latlon) {

    let latlng = latlon2latLng(latlon)

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

        const marker = L.marker(latlng, {
                icon,
                draggable: true,
                autoPan: true
            }).addTo(map);

        marker.on("dragend", function (e) {
            updateCoord(end, latlng2latlon(e.target.getLatLng()))
        });

        markers[end] = marker;

        // Move map if marker not visible
        if (!map.getBounds().contains(latlng)) {
            map.setView(latlng);
        }
    }

    markers[end].setLatLng(latlng);
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





function unsafeDistance(iti) {
    var res = 0;
    for (let path of iti.paths) {
        if (safe_types.indexOf(path.type) == -1) {
                res += path.length;
        }
    }
    return res;
}

function computeDrops(iti) {
    var positive=0;
    var negative=0;
    for (let path of iti.paths) {
        if (iti.paths.length >1) for (let i=0; i<path.coords.length -2; i++) {
           diff = path.coords[i+1].elevation -  path.coords[i].elevation;
           if (diff > 0) {
               positive += diff;
           } else {
               negative -= diff
           }
        }
    }
    return {
        positive:Math.round(positive),
        negative:Math.round(negative)}
}

function updateList() {

    var economy = 0;
    var carbon = 0;
    if (state.car_distance) {
        economy = Math.floor(2  * NB_DAYS_PER_YEAR * COST_PER_KM * state.car_distance / 1000)
        carbon = Math.floor(2 * NB_DAYS_PER_YEAR * CO2_PER_KM * state.car_distance / 1000)
    }

    let sortedIti = state.itineraries ? [...state.itineraries] : [];
    sortedIti.sortOn(function (iti) {
        return (state.sort === SortType.SAFE) ? (unsafeDistance(iti)) : iti.time;
    })

    let max_distance = Math.max(...sortedIti.map(iti => iti.length));

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
                    distance: iti.length *  iti.shares[key],
                    safe: safe_types.indexOf(key),
                    color: typeColors[key],
                    label : typeNames[key],
                    type:key,
                });
            }
        }

        shares.sortOn(share => types_order.indexOf(share.type))

        let gpx_params = {
            alt:iti.alternative,
            profile:iti.profile,
            ...encodeCoords()
        }
        let gpx_url = "/api/gpx?" + encodeParams(gpx_params);
        let kml_url = "/api/kml?" + encodeParams(gpx_params);
        let drops = computeDrops(iti);

        return {
            id:iti.id,
            time,
            shares,
            gpx_url,
            kml_url,
            drops,
            unsafe :(unsafeDistance(iti) /1000),
            distance: (iti.length/1000).toFixed(1)}
    });

    let data = {
        closed : state.estimatesClosed,
        itineraries:templateData,
        carbon, economy,
        max_distance,
        colors:typeColors};

    let html = renderTemplate("#itinerary-template", data)
    $("#list-placeholder").html(html);

    // Setup listeners
    $(".iti-item").on("mouseover", function () {
       highlightIti($(this).attr("data-iti-id"));
    });
    $(".iti-item").on("mouseout", function () {
       highlightIti(null);
    });
    $(".iti-item").on("click", function () {
        selectItinerary($(this).attr("data-iti-id"));
    });

    $(".close-estimates").click(function() {
        state.estimatesClosed = true;
        updateList();
    })

    highlightIti(null);

}

function renderTemplate(templateId, data) {
   let tmpl = $.templates(templateId);
   return tmpl.render(data);
}

function selectItinerary(id) {
    if (state.selected === id) {
        state.selected = null
    } else {
        state.selected = id;
    }
    highlightIti(id);
    updateUrl();
}

function cleanMap() {
    for (let layer of geojsonLayers) {
        map.removeLayer(layer);
    }
    geojsonLayers = [];
}

function highlightIti(over_id) {

    function isHighlighted(id) {
        return (id === over_id) || (id === state.selected) ;
    }

    // Highlight on map
    if (state.itineraries) for (let iti of state.itineraries) {
        let highlighted = (isHighlighted(iti.id) || (!state.selected && !over_id));

        // Highlight the panes containing the itinerary
        PANES[iti.id].style.opacity = highlighted ? 1: 0.25;
        PANES[iti.id].style.zIndex = highlighted ? TOP_PANE_ZINDEX : LOW_PANE_ZINDEX;
    }

    // Highlight on list
    $(".iti-item").each(function () {
        let iti_id = $(this).attr("data-iti-id");
        $(this).toggleClass("highlighted", isHighlighted(iti_id));
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

        function addPoly(poly) {

            poly.addTo(map);
            geojsonLayers.push(poly)

            //poly.bindTooltip(content, {sticky:true})
            poly.on('mouseover', function()  {
                highlightIti(iti.id);
            });
            poly.on('mouseout', function()  {
                highlightIti(null);
            })
            poly.on('click', function()  {
                selectItinerary(iti.id);
            })
        }

        const className = "iti-" + iti.id

        // Add dark line behind
        iti.paths.forEach(function (path) {

            const transpLine = L.geoJSON(
                toGeoJson(path),
                {   pane : iti.id,
                    style: {
                        weight: 20,
                        color: "rgba(0,0,0,0)",
                        className}
                });
            addPoly(transpLine);

            const blackLine = L.geoJSON(
                toGeoJson(path),
                {   pane:iti.id,
                    style: {
                        weight: 8,
                        color: "black",
                        className}
                });

            addPoly(blackLine);
        });

        const styleFn = function (js) {
            return {
                weight:4,
                color :typeColors[js.properties.type],
                className
            };
        }

        // Add thin line with color for path type
        iti.paths.forEach(function (path) {
            const poly = L.geoJSON(
                toGeoJson(path),
                {
                    style: styleFn,
                    pane: iti.id});

            addPoly(poly);
        });

    }

    if (state.itineraries) {

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
}

// Transform to state and update UI
function urlUpdated() {
    let urlParams = new URLSearchParams(window.location.search);
    state.vae = urlParams.get("vae") === "true";
    state.vtt = urlParams.get("profile") ? (urlParams.get("profile") === "vtt") : true;
    state.sort = urlParams.get("sort") || "safe";
    state.selected = window.location.hash.replace("#", "");

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
    highlightIti(null);

    for (let end of [START, END]) {
        if (state.coords[end]) {
            createOrUpdateMarker(end, state.coords[end]);
        } else {
            // Coord not set but marker here
            if (markers[end]) {
                map.removeLayer(markers[end]);
                markers[end] = null;
            }
        }
    }

    $("#map").toggleClass("clickable", ! (state.coords[START] && state.coords[END]))

    // Both marker setup ? => disable click on map
    if (state.coords[START] && state.coords[END]) {
        map.off("click", onMapClick);
    } else {
        map.on("click", onMapClick);
    }
}

// Fetch itinerary and Update both map and list from
function updateItineraryFromState() {
    let start = state.coords[START];
    let end = state.coords[END];

    // Only fetch itinerary when both marker are set
    if (!start|| !end) {
        state.itineraries = null;
        state.car_distance = null;
        updateList();
        updateMap();
        return;
    }

    let url = "/api/itineraries?" + encodeParams ({
        start : start.lat + "," + start.lon,
        end: end.lat + "," + end.lon,
        profile : (state.vtt ? "vtt" : "route")
    });

    $("body").addClass("loading");
    $("#map").addClass("loading");

    jQuery.getJSON(url, function (res) {
        state.itineraries = res.itineraries;
        state.car_distance = res.car_distance;

        let ids = state.itineraries.map(iti => iti.id);
        if (ids.indexOf(state.selected) === -1) {
            state.selected = null;
        }

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
      $(".sort-button").each(function () {
        let type = $(this).attr("data-sort");
        $(this).toggleClass("active", type === state.sort);
    })
}

function initAll() {
    map = initMap();

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
        updateUrl();
    });

    window.onpopstate = () => {
        urlUpdated();
    };

    setupAutocomplete();
}

function updateUrl() {

    let params = {
        profile: (state.vtt ? "vtt" : "route"),
        vae: state.vae,
        sort : state.sort,
        ...encodeCoords()
    }

    let url = "?" + encodeParams(params) + ((state.selected) ? ("#" + state.selected) : "");

    history.pushState(null, null, url);
}

function encodeCoords() {
    var res = {}
    for (let end of [START, END]) {
        if (state.coords[end]) {
            res[end] =
                state.coords[end].lat.toFixed(6) + "," +
                state.coords[end].lon.toFixed(6);
        }
    }
    return res
}

function encodeParams(params) {
    const searchParams = new URLSearchParams();
    Object.keys(params).forEach(key => searchParams.append(key, params[key]));
    return searchParams.toString();
}

function nominatim(q, callback) {
    let base = "https://nominatim.openstreetmap.org/search?";
    let bounds = map.getBounds();
    let bbox =
        bounds.getSouth() + "," +
        bounds.getWest() + "," +
        bounds.getNorth() + "," +
        bounds.getEast();

    let params={
        q,
        format:"jsonv2",
        countrycodes:"fr",
        "accept-language":"",
        addressdetails:1,
        dedupe:1,
        viewbox: bbox}
    $.getJSON(base + encodeParams(params), function (data) {
        let res = data.map(function (item) {
            let addr = item.address;
            var text = "";
            var parts = [];
            for(let part of address_parts) {
                if (addr[part]) {
                    parts.push(addr[part]);
                }
            }
            return {
                text : parts.join(", "),
                value : {
                    lat: parseFloat(item.lat),
                    lon: parseFloat(item.lon)
                }
            }
        });

        callback(res);
    });
}



function setupAutocomplete() {

    let debouncedNominatim = debounce(nominatim, 1000);


    for (let end of [START, END]) {

        let input = $('.location-input[data-end=' + end + ']');

        input.autoComplete({
            resolver: 'custom',
            events: {
                search: (q, cb) => {

                    let parent = $(".location-input-group[data-end="+end+"]");

                    parent.toggleClass("location-loading", true);

                    debouncedNominatim(q, function (data) {
                        cb(data);
                        parent.toggleClass("location-loading", false);
                    });
                }
            }
        });
    }

    $('.location-input').on("autocomplete.select", function(e, item) {
        let end = $(this).attr("id").split("-")[1];
        updateCoord(end, item.value);
    });

    $('.current-location[data-end]').on("click", function(e, item) {
        let end = $(this).attr("data-end");
        navigator.geolocation.getCurrentPosition(function(position) {
            let pos = {
                lat : position.coords.latitude,
                lon : position.coords.longitude
            }
            updateCoord(end, pos);
        });

    });


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

function debounce(func, wait) {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}