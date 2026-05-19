// Core data source. Keeping this as a relative path makes the app work on
// GitHub Pages as long as the CSV sits beside index.html.
const CSV_FILE = "iceland_golf_courses.csv";

// localStorage keys are versioned so future data shape changes can migrate
// cleanly without breaking existing users.
const PLAYED_STORAGE_KEY = "icelandGolfCourses.played.v1";
const USER_DATA_STORAGE_KEY = "icelandGolfCourses.userData.v1";
const LOCATION_CACHE_STORAGE_KEY = "icelandGolfCourses.locationCache.v1";
const THEME_STORAGE_KEY = "icelandGolfCourses.theme.v1";

// Public Nominatim geocoding is used only for the provided Location address.
// Results are cached so repeated visits do not geocode the same address again.
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_DELAY_MS = 1100;
const NOMINATIM_TIMEOUT_MS = 9000;

// The CSV contract requested for the app. These names are also used in the
// popup so every field from the file is represented in the interface.
const CSV_COLUMNS = [
  "Course Name",
  "Club Name",
  "Location",
  "Holes",
  "Par",
  "Course Rating (Men)",
  "Slope Rating (Men)",
  "Course Rating (Women)",
  "Slope Rating (Women)",
  "Source URL",
];

// Broad coordinate bounds for validating geocoder results in Iceland.
const ICELAND_LIMITS = {
  minLat: 63.0,
  maxLat: 67.0,
  minLng: -25.5,
  maxLng: -13.0,
};

// Shared mutable state. The app stays small enough that a lightweight state
// object is clearer than adding a framework.
const state = {
  map: null,
  markerCluster: null,
  courses: [],
  markers: new Map(),
  played: readJsonStorage(PLAYED_STORAGE_KEY, {}),
  userData: readJsonStorage(USER_DATA_STORAGE_KEY, {}),
  locationCache: readJsonStorage(LOCATION_CACHE_STORAGE_KEY, {}),
  activeFilter: "all",
  searchTerm: "",
  skippedLocations: [],
  lastGeocodeAt: 0,
  activeRatingCourseKey: null,
  hasFitInitialBounds: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  applyInitialTheme();

  try {
    assertDependencies();
    initializeMap();
    bindUiEvents();
    updateLoading("Loading course CSV", 8);

    const rawRows = await loadCoursesFromCsv();
    state.courses = normalizeAndDedupeCourses(rawRows);
    updateStats();
    updateFooter();

    hideLoading("Courses loaded");
    resolveCourseLocations();
  } catch (error) {
    console.error("Failed to initialize the golf tracker:", error);
    showFatalError(error);
  }
}

function cacheElements() {
  elements.appShell = document.getElementById("appShell");
  elements.sidebarToggle = document.getElementById("sidebarToggle");
  elements.themeToggle = document.getElementById("themeToggle");
  elements.totalCourses = document.getElementById("totalCourses");
  elements.playedCourses = document.getElementById("playedCourses");
  elements.completionPercent = document.getElementById("completionPercent");
  elements.courseSearch = document.getElementById("courseSearch");
  elements.filterButtons = Array.from(document.querySelectorAll(".filter-button"));
  elements.footerTotal = document.getElementById("footerTotal");
  elements.lastUpdated = document.getElementById("lastUpdated");
  elements.loadingOverlay = document.getElementById("loadingOverlay");
  elements.loadingTitle = document.getElementById("loadingTitle");
  elements.loadingText = document.getElementById("loadingText");
  elements.loadingProgress = document.getElementById("loadingProgress");
  elements.ratingModal = document.getElementById("ratingModal");
  elements.ratingForm = document.getElementById("ratingForm");
  elements.ratingCourseName = document.getElementById("ratingCourseName");
  elements.modalRating = document.getElementById("modalRating");
  elements.modalCondition = document.getElementById("modalCondition");
  elements.modalWeather = document.getElementById("modalWeather");
  elements.ratingCancel = document.getElementById("ratingCancel");
}

function assertDependencies() {
  if (!window.L) {
    throw new Error("Leaflet failed to load. Check the Leaflet CDN link.");
  }

  if (!window.Papa) {
    throw new Error("PapaParse failed to load. Check the PapaParse CDN link.");
  }

  if (!window.L.markerClusterGroup) {
    throw new Error(
      "Leaflet.markercluster failed to load. Check the markercluster CDN link.",
    );
  }
}

function initializeMap() {
  state.map = L.map("map", {
    zoomControl: false,
    worldCopyJump: false,
  }).setView([64.9, -18.9], 6);

  L.control.zoom({ position: "bottomright" }).addTo(state.map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.map);

  // The cluster icon includes completion context so the map remains useful
  // when many nearby courses are grouped together.
  state.markerCluster = L.markerClusterGroup({
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    disableClusteringAtZoom: 13,
    iconCreateFunction: createClusterIcon,
  });

  state.map.addLayer(state.markerCluster);
}

function bindUiEvents() {
  state.map.on("popupopen", (event) => {
    bindPopupControls(event.popup.getElement());
  });

  populateRatingOptions();

  elements.sidebarToggle.addEventListener("click", () => {
    const isCollapsed = elements.appShell.classList.toggle("sidebar-collapsed");
    elements.sidebarToggle.setAttribute("aria-expanded", String(!isCollapsed));
    elements.sidebarToggle.textContent = isCollapsed ? "Show panel" : "Hide panel";

    // Leaflet needs an explicit size refresh after layout changes.
    window.setTimeout(() => state.map?.invalidateSize(), 240);
  });

  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  });

  elements.courseSearch.addEventListener("input", (event) => {
    state.searchTerm = event.target.value.trim().toLowerCase();
    renderVisibleMarkers();
  });

  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveFilter(button.dataset.filter);
    });
  });

  elements.ratingCancel.addEventListener("click", closeRatingModal);
  elements.ratingModal.addEventListener("click", (event) => {
    if (event.target === elements.ratingModal) {
      closeRatingModal();
    }
  });
  elements.ratingForm.addEventListener("submit", saveRatingModal);
}

function applyInitialTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  setTheme(savedTheme || "dark", false);
}

function setTheme(theme, shouldPersist = true) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));

  if (shouldPersist) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

function loadCoursesFromCsv() {
  return new Promise((resolve, reject) => {
    Papa.parse(CSV_FILE, {
      download: true,
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (result) => {
        if (result.errors.length) {
          console.warn("CSV parsing warnings:", result.errors);
        }

        resolve(result.data);
      },
      error: (error) => reject(error),
    });
  });
}

function normalizeAndDedupeCourses(rows) {
  const seenCourseNames = new Set();
  const courses = [];

  rows.forEach((row, index) => {
    const normalized = {};
    CSV_COLUMNS.forEach((column) => {
      normalized[column] = readCsvCell(row, column);
    });

    const courseName = normalized["Course Name"];
    if (!courseName) {
      console.warn("Skipping CSV row without a course name:", row);
      return;
    }

    // The requested unique key is the course name. If the CSV ever contains
    // duplicates, the first row wins and a second marker is not created.
    if (seenCourseNames.has(courseName)) {
      console.warn(`Skipping duplicate course marker for "${courseName}".`);
      return;
    }

    seenCourseNames.add(courseName);

    courses.push({
      key: courseName,
      rowIndex: index,
      raw: normalized,
      courseName,
      clubName: normalized["Club Name"],
      location: normalized.Location,
      holes: normalized["Holes"],
      par: normalized["Par"],
      ratingMen: normalized["Course Rating (Men)"],
      slopeMen: normalized["Slope Rating (Men)"],
      ratingWomen: normalized["Course Rating (Women)"],
      slopeWomen: normalized["Slope Rating (Women)"],
      sourceUrl: normalized["Source URL"],
      searchText: `${courseName} ${normalized["Club Name"]} ${normalized.Location}`.toLowerCase(),
      lat: null,
      lng: null,
      hasLocation: false,
    });
  });

  return courses;
}

async function resolveCourseLocations() {
  try {
    state.skippedLocations = [];
    updateLoading("Reading course locations", 24);

    for (const [index, course] of state.courses.entries()) {
      const progress = 24 + (index / Math.max(state.courses.length, 1)) * 56;
      updateLoading(
        `Resolving ${index + 1} of ${state.courses.length}`,
        progress,
        course.courseName,
      );

      const coords = await coordinatesForCourseLocation(course);

      if (coords) {
        course.lat = coords.lat;
        course.lng = coords.lng;
        course.hasLocation = true;
        createCourseMarker(course);
        addMarkerIfVisible(course);
        continue;
      }

      course.hasLocation = false;
      state.skippedLocations.push({
        course: course.courseName,
        club: course.clubName,
        location: course.location || "Missing",
        reason: course.location
          ? "Address could not be geocoded in Iceland."
          : "Location address is missing.",
      });
    }

    if (state.skippedLocations.length) {
      console.groupCollapsed(
        `${state.skippedLocations.length} courses were not mapped because Location is missing or could not be geocoded`,
      );
      console.table(state.skippedLocations);
      console.groupEnd();
    }

    fitMapToMappedCourses();
    updateFooter();
    updateLoading("Locations resolved", 100);
  } catch (error) {
    console.error("Location resolution failed:", error);
  }
}

async function coordinatesForCourseLocation(course) {
  const location = cleanCell(course.location);
  if (!location) {
    return null;
  }

  const embeddedCoordinates = parseEmbeddedCoordinates(location);
  if (embeddedCoordinates) {
    return embeddedCoordinates;
  }

  const cacheKey = locationCacheKey(course);
  const cached = state.locationCache[cacheKey];
  if (cached && isValidIcelandCoordinate(cached.lat, cached.lng)) {
    return cached;
  }

  const result = await geocodeAddress(location);
  if (!result) {
    return null;
  }

  state.locationCache[cacheKey] = result;
  writeJsonStorage(LOCATION_CACHE_STORAGE_KEY, state.locationCache);
  return result;
}

function parseEmbeddedCoordinates(value) {
  const candidates = coordinateCandidates(value);
  return candidates.find((coords) => isValidIcelandCoordinate(coords.lat, coords.lng)) || null;
}

async function geocodeAddress(location) {
  await waitForNominatimSlot();

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  const params = new URLSearchParams({
    q: location,
    format: "jsonv2",
    limit: "1",
    addressdetails: "0",
    countrycodes: "is",
  });

  try {
    const response = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned HTTP ${response.status}`);
    }

    const results = await response.json();
    const match = results
      .map((item) => ({
        lat: Number.parseFloat(item.lat),
        lng: Number.parseFloat(item.lon),
      }))
      .find((coords) => isValidIcelandCoordinate(coords.lat, coords.lng));

    return match || null;
  } catch (error) {
    console.warn(`Could not geocode Location address "${location}".`, error);
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function waitForNominatimSlot() {
  const elapsed = Date.now() - state.lastGeocodeAt;
  if (elapsed < NOMINATIM_DELAY_MS) {
    await delay(NOMINATIM_DELAY_MS - elapsed);
  }

  state.lastGeocodeAt = Date.now();
}

function locationCacheKey(course) {
  return `${course.key}|${cleanCell(course.location).toLowerCase()}`;
}

function coordinateCandidates(value) {
  const decodedValue = safeDecodeURIComponent(value);
  const candidates = [];
  const numberPattern = "[-+]?\\d{1,3}(?:\\.\\d+)?";
  const pairPattern = new RegExp(`(${numberPattern})\\s*[,;\\s]\\s*(${numberPattern})`, "g");
  const googlePattern = new RegExp(`!3d(${numberPattern})!4d(${numberPattern})`, "g");
  let match = pairPattern.exec(decodedValue);

  while (match) {
    const first = Number.parseFloat(match[1]);
    const second = Number.parseFloat(match[2]);

    candidates.push({ lat: first, lng: second });
    candidates.push({ lat: second, lng: first });

    match = pairPattern.exec(decodedValue);
  }

  match = googlePattern.exec(decodedValue);
  while (match) {
    candidates.push({
      lat: Number.parseFloat(match[1]),
      lng: Number.parseFloat(match[2]),
    });
    match = googlePattern.exec(decodedValue);
  }

  // This also supports common map URLs such as OpenStreetMap #map=15/lat/lng
  // and Google URLs that encode latitude/longitude as adjacent numeric values.
  const numbers = decodedValue
    .match(new RegExp(numberPattern, "g"))
    ?.map((number) => Number.parseFloat(number));

  numbers?.forEach((first, index) => {
    const second = numbers[index + 1];
    if (Number.isFinite(second)) {
      candidates.push({ lat: first, lng: second });
      candidates.push({ lat: second, lng: first });
    }
  });

  return candidates;
}

function createCourseMarkers() {
  state.markers.clear();

  state.courses.forEach((course) => {
    createCourseMarker(course);
  });
}

function createCourseMarker(course) {
  if (!course.hasLocation || state.markers.has(course.key)) {
    return null;
  }

  const marker = L.circleMarker([course.lat, course.lng], markerStyle(course));
  marker.options.courseKey = course.key;

  marker.bindTooltip(course.courseName, {
    direction: "top",
    offset: [0, -10],
    opacity: 0.95,
    className: "course-tooltip",
  });

  marker.bindPopup(buildPopupContent(course), {
    minWidth: 280,
    maxWidth: 360,
    autoPanPadding: [24, 24],
    className: "course-popup-shell",
  });

  marker.on("mouseover", () => {
    marker.setStyle({ radius: 10, weight: 4, fillOpacity: 0.98 });
    marker.getElement()?.classList.add("is-hovered");
    marker.bringToFront();
  });
  marker.on("mouseout", () => {
    marker.setStyle(markerStyle(course));
    marker.getElement()?.classList.remove("is-hovered");
  });

  state.markers.set(course.key, marker);
  return marker;
}

function addMarkerIfVisible(course) {
  const marker = state.markers.get(course.key);
  if (!marker || !courseMatchesCurrentView(course)) {
    return;
  }

  state.markerCluster.addLayer(marker);
  state.markerCluster.refreshClusters();
}

function markerStyle(course) {
  const played = isCoursePlayed(course.key);

  return {
    radius: 8,
    weight: 3,
    opacity: 1,
    fillOpacity: 0.88,
    color: played ? "#0f6f41" : "#a72f29",
    fillColor: played ? "#28b96d" : "#ef5b53",
    className: `course-marker ${played ? "is-played" : "is-unplayed"}`,
  };
}

function renderVisibleMarkers() {
  if (!state.markerCluster) {
    return;
  }

  state.markerCluster.clearLayers();

  const visibleMarkers = state.courses
    .filter((course) => course.hasLocation)
    .filter(courseMatchesCurrentView)
    .map((course) => state.markers.get(course.key))
    .filter(Boolean);

  state.markerCluster.addLayers(visibleMarkers);
  state.markerCluster.refreshClusters();
  updateStats();
}

function courseMatchesCurrentView(course) {
  const played = isCoursePlayed(course.key);
  const matchesFilter =
    state.activeFilter === "all" ||
    (state.activeFilter === "played" && played) ||
    (state.activeFilter === "unplayed" && !played);
  const matchesSearch = !state.searchTerm || course.searchText.includes(state.searchTerm);

  return matchesFilter && matchesSearch;
}

function createClusterIcon(cluster) {
  const childMarkers = cluster.getAllChildMarkers();
  const playedCount = childMarkers.filter((marker) => isCoursePlayed(marker.options.courseKey)).length;
  const totalCount = childMarkers.length;
  const statusClass =
    playedCount === 0 ? "is-unplayed" : playedCount === totalCount ? "is-played" : "is-mixed";

  return L.divIcon({
    html: `<div><strong>${totalCount}</strong><span>${playedCount}/${totalCount}</span></div>`,
    className: `course-cluster ${statusClass}`,
    iconSize: L.point(48, 48),
  });
}

function bindPopupControls(popupElement) {
  if (!popupElement) {
    return;
  }

  const toggleButton = popupElement.querySelector("[data-action='toggle-played']");
  toggleButton?.addEventListener("click", () => {
    const course = state.courses.find((item) => item.key === toggleButton.dataset.courseKey);
    if (course) {
      toggleCoursePlayed(course);
    }
  });

  popupElement.querySelectorAll("[data-user-field]").forEach((field) => {
    field.addEventListener("change", () => {
      updateCourseUserData(field.dataset.courseKey, {
        [field.dataset.userField]: field.value,
      });
    });
  });
}

function toggleCoursePlayed(course) {
  const nextPlayed = !isCoursePlayed(course.key);

  if (nextPlayed) {
    state.played[course.key] = true;
  } else {
    delete state.played[course.key];
  }

  writeJsonStorage(PLAYED_STORAGE_KEY, state.played);
  updateMarkerAppearance(course);
  updateStats();

  const marker = state.markers.get(course.key);
  if (courseMatchesCurrentView(course)) {
    state.markerCluster.refreshClusters();
    marker?.openPopup();
    window.setTimeout(() => bindPopupControls(marker?.getPopup()?.getElement()), 0);
  } else {
    renderVisibleMarkers();
  }

  if (nextPlayed) {
    openRatingModal(course);
  }
}

function updateMarkerAppearance(course) {
  const marker = state.markers.get(course.key);
  if (!marker) {
    return;
  }

  marker.setStyle(markerStyle(course));
  marker.setPopupContent(buildPopupContent(course));

  const markerElement = marker.getElement();
  if (markerElement) {
    markerElement.classList.toggle("is-played", isCoursePlayed(course.key));
    markerElement.classList.toggle("is-unplayed", !isCoursePlayed(course.key));
  }
}

function updateCourseUserData(courseKey, updates) {
  state.userData[courseKey] = {
    ...getCourseUserData(courseKey),
    ...updates,
  };

  writeJsonStorage(USER_DATA_STORAGE_KEY, state.userData);

  const course = state.courses.find((item) => item.key === courseKey);
  const marker = state.markers.get(courseKey);
  if (course && marker) {
    marker.setPopupContent(buildPopupContent(course));
    window.setTimeout(() => bindPopupControls(marker.getPopup()?.getElement()), 0);
  }
}

function getCourseUserData(courseKey) {
  return {
    rating: "",
    condition: "",
    weather: "",
    ...(state.userData[courseKey] || {}),
  };
}

function populateRatingOptions() {
  const options = numberOptionMarkup("Not recorded");
  elements.modalRating.innerHTML = options;
  elements.modalCondition.innerHTML = options;
  elements.modalWeather.innerHTML = options;
}

function openRatingModal(course) {
  const userData = getCourseUserData(course.key);

  state.activeRatingCourseKey = course.key;
  elements.ratingCourseName.textContent = `${course.courseName} · ${course.clubName}`;
  elements.modalRating.value = userData.rating;
  elements.modalCondition.value = userData.condition;
  elements.modalWeather.value = userData.weather;
  elements.ratingModal.classList.remove("is-hidden");
  elements.modalRating.focus();
}

function closeRatingModal() {
  elements.ratingModal.classList.add("is-hidden");
  state.activeRatingCourseKey = null;
}

function saveRatingModal(event) {
  event.preventDefault();

  if (!state.activeRatingCourseKey) {
    closeRatingModal();
    return;
  }

  updateCourseUserData(state.activeRatingCourseKey, {
    rating: elements.modalRating.value,
    condition: elements.modalCondition.value,
    weather: elements.modalWeather.value,
  });
  closeRatingModal();
}

function setActiveFilter(filter) {
  state.activeFilter = filter;

  elements.filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === filter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  renderVisibleMarkers();
}

function fitMapToMappedCourses() {
  const latLngs = state.courses
    .filter((course) => course.hasLocation && Number.isFinite(course.lat) && Number.isFinite(course.lng))
    .map((course) => L.latLng(course.lat, course.lng));

  if (!latLngs.length) {
    console.warn("No courses were mapped because no Location addresses could be resolved.");
    return;
  }

  state.map.fitBounds(L.latLngBounds(latLngs).pad(0.16), {
    animate: true,
    maxZoom: 8,
  });
}

function updateStats() {
  const total = state.courses.length;
  const played = state.courses.filter((course) => isCoursePlayed(course.key)).length;
  const percent = total ? Math.round((played / total) * 100) : 0;

  elements.totalCourses.textContent = String(total);
  elements.playedCourses.textContent = String(played);
  elements.completionPercent.textContent = `${percent}%`;
}

function updateFooter() {
  elements.footerTotal.textContent = String(state.courses.length);
  elements.lastUpdated.textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}

function buildPopupContent(course) {
  const played = isCoursePlayed(course.key);
  const userData = getCourseUserData(course.key);
  const safeUrl = safeHttpUrl(course.sourceUrl);
  const sourceMarkup = safeUrl
    ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(course.sourceUrl)}</a>`
    : "Not available";
  const courseKeyAttribute = escapeAttribute(course.key);

  return `
    <article class="course-popup">
      <header class="popup-header">
        <div>
          <h3>${escapeHtml(course.courseName)}</h3>
          <p class="popup-club">${escapeHtml(displayValue(course.clubName))}</p>
        </div>
        <span class="status-pill ${played ? "is-played" : "is-unplayed"}">
          ${played ? "Played" : "Not played"}
        </span>
      </header>

      <button
        class="played-toggle-popup ${played ? "is-played" : "is-unplayed"}"
        type="button"
        data-action="toggle-played"
        data-course-key="${courseKeyAttribute}"
      >
        ${played ? "Mark unplayed" : "Mark played"}
      </button>

      <section class="popup-card popup-grid" aria-label="Course details">
        ${detailMarkup("Holes", course.holes)}
        ${detailMarkup("Par", course.par)}
        ${detailMarkup("Location", course.location)}
        ${detailMarkup("Played status", played ? "Played" : "Not played")}
      </section>

      <section class="popup-card popup-grid" aria-label="Course ratings">
        ${detailMarkup("Course Rating (Men)", course.ratingMen)}
        ${detailMarkup("Slope Rating (Men)", course.slopeMen)}
        ${detailMarkup("Course Rating (Women)", course.ratingWomen)}
        ${detailMarkup("Slope Rating (Women)", course.slopeWomen)}
      </section>

      <section class="popup-card popup-grid" aria-label="Source">
        ${detailMarkup("Course Name", course.courseName)}
        ${detailMarkup("Club Name", course.clubName)}
        <div class="detail is-full">
          <span class="detail-label">Source URL</span>
          <span class="detail-value">${sourceMarkup}</span>
        </div>
      </section>

      <section class="popup-card personal-card" aria-label="Personal course notes">
        <label class="popup-field">
          <span class="detail-label">My rating</span>
          <select data-user-field="rating" data-course-key="${courseKeyAttribute}">
            ${numberOptionMarkup("Not rated", userData.rating)}
          </select>
        </label>

        <label class="popup-field">
          <span class="detail-label">Course condition</span>
          <select data-user-field="condition" data-course-key="${courseKeyAttribute}">
            ${numberOptionMarkup("Not recorded", userData.condition)}
          </select>
        </label>

        <label class="popup-field">
          <span class="detail-label">Weather condition</span>
          <select data-user-field="weather" data-course-key="${courseKeyAttribute}">
            ${numberOptionMarkup("Not recorded", userData.weather)}
          </select>
        </label>
      </section>
    </article>
  `;
}

function detailMarkup(label, value) {
  return `
    <div class="detail">
      <span class="detail-label">${escapeHtml(label)}</span>
      <span class="detail-value">${escapeHtml(displayValue(value))}</span>
    </div>
  `;
}

function optionMarkup(value, label, selectedValue) {
  return `
    <option value="${escapeAttribute(value)}" ${value === selectedValue ? "selected" : ""}>
      ${escapeHtml(label)}
    </option>
  `;
}

function numberOptionMarkup(emptyLabel, selectedValue = "") {
  const options = [optionMarkup("", emptyLabel, selectedValue)];

  for (let value = 1; value <= 10; value += 1) {
    options.push(optionMarkup(String(value), String(value), selectedValue));
  }

  return options.join("");
}

function showFatalError(error) {
  elements.loadingOverlay.classList.remove("is-hidden");
  elements.loadingTitle.textContent = "Unable to load courses";
  elements.loadingText.textContent = error.message || "Check the console for details.";
  elements.loadingProgress.style.width = "100%";
}

function updateLoading(title, percent, detail = "") {
  elements.loadingTitle.textContent = title;
  elements.loadingText.textContent = detail;
  elements.loadingProgress.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
}

function hideLoading(message = "Ready") {
  updateLoading(message, 100);
  window.setTimeout(() => {
    elements.loadingOverlay.classList.add("is-hidden");
  }, 260);
}

function isCoursePlayed(courseKey) {
  return state.played[courseKey] === true;
}

function cleanCell(value) {
  return String(value ?? "").trim();
}

function readCsvCell(row, preferredColumnName) {
  if (Object.prototype.hasOwnProperty.call(row, preferredColumnName)) {
    return cleanCell(row[preferredColumnName]);
  }

  const matchingKey = Object.keys(row).find(
    (key) => key.trim().toLowerCase() === preferredColumnName.toLowerCase(),
  );

  return matchingKey ? cleanCell(row[matchingKey]) : "";
}

function displayValue(value) {
  return cleanCell(value) || "Not available";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Could not read localStorage key "${key}".`, error);
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Could not write localStorage key "${key}".`, error);
  }
}

function isValidIcelandCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= ICELAND_LIMITS.minLat &&
    lat <= ICELAND_LIMITS.maxLat &&
    lng >= ICELAND_LIMITS.minLng &&
    lng <= ICELAND_LIMITS.maxLng
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
