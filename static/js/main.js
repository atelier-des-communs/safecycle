


const START="start";
const END="end";

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

const address_parts = ["commercial", "shop", "tourism", "amenity", "highway", "road", "village", "town", "city"]

const typeColors = {
    [BIKE] : "#8efc95",
    [MEDIUM_TRAFFIC] : "#ffb84d",
    [DANGER] : "#ff5d5d",
    [PATH] : "#dc9364",
    [LOW_TRAFFIC] : "#96daff"
}
const typeNames = _.path_type

VIEW_SAFETY = 'safety'
VIEW_SLOPE = 'slope'

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
    estimatesClosed : false,
    view : VIEW_SAFETY,
    debug:false,
    best:false,
}

const markers = {
    [START]:null,
    [END]:null
}

const locationPickerCoords = {
    [START]:null,
    [END]:null
}

MAX_SLOPE = 15
MIN_SLOPE= -15
MAX_SLOPE_COLOR = [0, 100, 50]
MIN_SLOPE_COLOR = [250, 100, 50]
ZERO_SLOPE_COLOR = [100, 100, 50]


var map = null;
const PANES = {};

var geojsonLayers = [];

const TOP_PANE_ZINDEX = 440;
const LOW_PANE_ZINDEX = 430;

L.Control.Legend = L.Control.extend({
    onAdd : function (map) {
        let safety_types  = types_order.map(type => ({
            color: typeColors[type],
            name: typeNames[type]}))

        let slope_types  = [15, 12, 6, 0, -6, -12, -15].map(slope => ({
            color:slopeColor(slope),
            name: "" + slope + "%"}))

        let html = renderTemplate("#legend-template", {
            safety_types,
            slope_types
        });

        let res = $(html);

        $(".view-tab", res).click(function (e) {
            let view = $(this).attr("data-view");
            updateView(view);
            e.stopPropagation();
        });

        $(res).click(function(e) {
            $(this).toggleClass("collapsed");
            e.stopPropagation();
        });

        return res.get(0);
    }
});

L.Control.CurrentLocationButton = L.Control.extend({
    onAdd : function (map) {

        let res = $("<button class='btn btn-light btn-sm current-location' type='button'>" +
            "<img src='/static/img/current-location.svg'/>" +
            "</button>");
        res.attr("title", _.current_position)

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

        let res = $('<button class="btn btn-light btn-sm reset" type="button">' +
            "<i class='bi bi-trash'" +
            "</button>");
        res.attr("title", _.reset_route)

        res.click(function(e) {
           reset();
           e.stopPropagation()
        });

        return res.get(0);
    },
});

/**function slopeColor(slope) {

    if (slope > 20) {
        return "#172987";
    } else if (slope > 15) {
        return "#d42424";
    } else if (slope > 10) {
        return "#ec7409";
    } else if (slope > 4) {
        return "#f7ff16"
    } else if (slope < -15) {
        return "#e200fa";
    } else {
        return "white";
    }
}**/

function slopeColor(slope) {
    let otherColor, extreme;
    if (slope >= 0) {
        slope = Math.min(MAX_SLOPE, slope)
        otherColor = MAX_SLOPE_COLOR;
        extreme = MAX_SLOPE
    } else {
        slope = -Math.max(MIN_SLOPE, slope)
        otherColor = MIN_SLOPE_COLOR;
        extreme = -MIN_SLOPE
    }
    let color = [0, 0, 0]
    let color2 = "#ffffff";
    for (let i=0; i<3; i++) {
        color[i] = parseInt((otherColor[i] - ZERO_SLOPE_COLOR[i]) * (slope / extreme) + ZERO_SLOPE_COLOR[i])
    }
    return 'hsl(' + color[0] + ',' + color[1] + '%,' + color[2] + '%)'
}

function getOrCreatePane(id) {
    if (!(id in PANES)) {
        let pane = map.createPane(id);
        pane.style.zIndex = LOW_PANE_ZINDEX;
        PANES[id] = pane;
        console.log("created pane" + id)
    }
    return PANES[id];
}

function initMap() {

    let map = L.map('map',
    {
        // dragging: !L.Browser.mobile
    }).setView(CONFIG.center, CONFIG.init_zoom);

    let tileLayer = L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
                    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
                    minZoom: 0,
                    maxZoom: 20});

    tileLayer.
        setOpacity(0.5).
        addTo(map);

    map.attributionControl.setPrefix(
        '<a href="http://leafletjs.com" title="A JS library for interactive maps">Leaflet</a> | ' +
        '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> ');


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


const ELEVATION_PER_PIXEL = 2.5;

function updateList() {


    let placeholder = $("#list-placeholder");
    let full_width = placeholder.width() - 100;

    var economy = 0;
    var carbon = 0;
    if (state.car_distance) {
        economy = Math.floor(2  * NB_DAYS_PER_YEAR * COST_PER_KM * state.car_distance / 1000)
        carbon = Math.floor(2 * NB_DAYS_PER_YEAR * CO2_PER_KM * state.car_distance / 1000)
    }

    let sortedIti = state.itineraries ? [...state.itineraries] : [];
    sortedIti.sortOn(function (iti) {
        return (state.sort === SortType.SAFE) ? (iti.unsafe_score) : iti.time;
    })

    let max_distance = Math.max(...sortedIti.map(iti => iti.length));

    const templateData = sortedIti.map(function (iti) {

        var mins = Math.floor(iti.time / 60)

        let h = Math.floor(mins / 60);
        let m = Math.round(mins % 60);
        let time = (h > 0 ? h + "h " : "") + m + " m"

        const shares = [];

        for (let key in iti.shares) {
            const percentage = iti.shares[key] * 100;
            let distance = iti.length *  iti.shares[key]
            if (percentage > 0) {
                shares.push({
                    width : (distance / max_distance * full_width).toFixed(),
                    percentage : Math.round(percentage),
                    distance,
                    safe: safe_types.indexOf(key),
                    color: typeColors[key],
                    label : typeNames[key],
                    type:key,
                });
            }
        }

        let distance = 0;
        let slopes = [];
        let minElevation = Math.min(...iti.paths.map((path) => (path.coords.length === 0) ? 5000 : path.coords[0].elevation));
        let maxElevation = Math.max(...iti.paths.map((path) => (path.coords.length === 0) ? 0 : path.coords[0].elevation));

        let height = (maxElevation - minElevation) / ELEVATION_PER_PIXEL;

        function point(x, y) {
            return x.toFixed() + "," + (height - y).toFixed()
        }

        for (let path of iti.paths) {
            if (path.coords.length < 1) {continue}
            let coord1  = path.coords[0];
            let coord2 = path.coords[path.coords.length-1];
            let x1 = distance / max_distance * full_width;
            let x2 = (distance + path.length) / max_distance * full_width;
            distance += path.length;
            let y1 = (coord1.elevation - minElevation) / ELEVATION_PER_PIXEL;
            let y2 = (coord2.elevation - minElevation) / ELEVATION_PER_PIXEL;

            slopes.push({
                points: [point(x1, 0), point(x1, y1), point(x2, y2), point(x2, 0)].join(" "),
                color: slopeColor(path.slope)
            });
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
            height,
            width:full_width,
            time,
            shares,
            slopes,
            gpx_url,
            kml_url,
            drops,
            minElevation:minElevation.toFixed(),
            maxElevation:maxElevation.toFixed(),
            unsafe :(unsafeDistance(iti) /1000),
            distance: (iti.length/1000).toFixed(1)}
    });

    let data = {
        closed : state.estimatesClosed,
        itineraries:templateData,
        carbon, economy,
        max_distance,
        sort:state.sort,
        view:state.view,
        view_alt : state.view === VIEW_SAFETY ? VIEW_SLOPE : VIEW_SAFETY,
        sort_alt : state.sort === SortType.SAFE ? SortType.FAST : SortType.SAFE,
        _:_,
        colors:typeColors};

    let html = renderTemplate("#itinerary-template", data)
    placeholder.html(html);

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



    // On sorting change
    $(".sort-button").click(function() {
        state.sort = $(this).attr("data-sort");
        updateList();
        updateUrl();
    });


    // On view change
    $(".view-button").click(function() {
        updateView($(this).attr("data-view"));
    });



    highlightIti(null);

}

function renderTemplate(templateId, data) {
    $.views.settings.delimiters("[[", "]]");
   let tmpl = $.templates(templateId);
   return tmpl.render(data);
}


function scrollIntoViewIfNeeded(target) {
    if (target.getBoundingClientRect().bottom > window.innerHeight) {
        target.scrollIntoView(false);
    }

    if (target.getBoundingClientRect().top < 0) {
        target.scrollIntoView();
    }
}

function selectItinerary(id) {
    if (state.selected === id) {
        state.selected = null
    } else {
        state.selected = id;
    }
    highlightIti(id);
    scrollIntoViewIfNeeded($("[data-iti-id=" + id + "]").get(0));
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
        let pane = getOrCreatePane(iti.id);
        pane.style.opacity = highlighted ? 1: 0.25;
        pane.style.zIndex = highlighted ? TOP_PANE_ZINDEX : LOW_PANE_ZINDEX;
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
                slope : path.slope,
            },
            "geometry": {
                "type": "LineString",
                "coordinates": path.coords.map(coord => [coord.lon, coord.lat])
            }
        }
    }

    function drawIti(iti) {

        // Create pane if it does not exist yet
        getOrCreatePane(iti.id);

        function addPoly(poly, path) {

            if (state.debug) {
                let vals = {
                    ...path.tags,
                    ...path.costs,
                    "iti total cost" : iti.cost,
                    "iti total length" : iti.length,
                    "iti avg cost" : iti.cost / iti.length,
                };
                const content = Object.entries(vals).map(([k, v], _) => "<b>" + k + "</b> :" + v + "<br/>").join("\n");
                poly.bindTooltip(content, {sticky: true})
            }

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

        // Add dark line behind
        iti.paths.forEach(function (path) {

            const transpLine = L.geoJSON(
                toGeoJson(path),
                {
                    pane : iti.id,
                    style: {
                        weight: 20,
                        color: "rgba(0,0,0,0)"}
                });
            addPoly(transpLine, path);

            const blackLine = L.geoJSON(
                toGeoJson(path),
                {
                    pane:iti.id,
                    style: {
                        weight: 8,
                        color: "black"}
                });

            addPoly(blackLine, path);
        });

        const styleFn = function (js, view) {
            let color = (view === VIEW_SLOPE) ?
                slopeColor(js.properties.slope) :
                typeColors[js.properties.type];

            return {weight:4, color, className : "view-" + view}
        }

        // Add line both safety and slope colors, controlled by css class
        iti.paths.forEach(function (path) {
            addPoly(L.geoJSON(toGeoJson(path),
                {
                    style: (js) => styleFn(js, VIEW_SAFETY),
                    pane: iti.id}), path);

            addPoly(L.geoJSON(toGeoJson(path),
                {
                    style: (js) => styleFn(js, VIEW_SLOPE),
                    pane: iti.id}), path);
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
    state.debug = urlParams.get("debug") === "true";
    state.best = ! (urlParams.get("best") === "false");
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

function updateView(view) {
    state.view = view;
    $("body").toggleClass("view-slope", state.view === VIEW_SLOPE);
    $("body").toggleClass("view-safety", state.view === VIEW_SAFETY);
    $(".view-tab").each(function () {
        let tabView = $(this).attr("data-view");
        $(this).toggleClass("active", view == tabView);
    })
    updateList();
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
        mountain : (state.vtt),
        elec : (state.vae),
        best_only : state.best,
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
        stateUpdated();
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
        debug : state.debug ? "true" : null,
        best : state.best ? null : "false",
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
    Object.keys(params).forEach(key => {
        if (params[key] !== null) {
            searchParams.append(key, params[key])
        }
    });
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
        addressdetails:1,
        dedupe:1,
        viewbox: bbox};

    if (CONFIG.country) {
        params["countrycodes"] = CONFIG.country
    }

    $.getJSON(base + encodeParams(params), function (data) {
        let res = data.map(function (item) {
            let addr = item.address;

            console.log(addr)

            var parts = [];
            for(let part of address_parts) {
                if (addr[part]) {
                    parts.push(addr[part]);
                }
            }

            if (parts.length === 0) {
                return null;
            }

            let text = parts.join(", ");
            if ("postcode" in addr) {
                text += " [" + addr["postcode"] + "]"
            }

            return {
                text,
                value : {
                    lat: parseFloat(item.lat),
                    lon: parseFloat(item.lon)
                }
            }
        }).filter(item => item !== null);

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