// Core data source. Keeping this as a relative path makes the app work on
// GitHub Pages as long as the CSV sits beside index.html.
const CSV_FILE = "golfbox_iceland_clubs.csv";

// localStorage keys are versioned so future data shape changes can migrate
// cleanly without breaking existing users.
const PLAYED_STORAGE_KEY = "icelandGolfCourses.played.v1";
const USER_DATA_STORAGE_KEY = "icelandGolfCourses.userData.v1";
const THEME_STORAGE_KEY = "icelandGolfCourses.theme.v1";

// The GolfBox CSV contract. These names are also used to normalize the raw
// rows so every field from the file can be represented in the interface.
const CSV_COLUMNS = [
  "club_name",
  "club_number_gsi",
  "course_name",
  "location",
  "address",
  "postal_code",
  "town",
  "email",
  "phone",
  "website",
  "holes",
  "par",
  "latitude",
  "longitude",
  "source_url",
  "scraped_at",
];

// Broad coordinate bounds for validating CSV results in Iceland.
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
  activeFilter: "all",
  searchTerm: "",
  skippedLocations: [],
  activeRatingCourseKey: null,
  activeDetailCourseKey: null,
  hasFitInitialBounds: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  applyInitialTheme();
  applyInitialSidebarState();

  try {
    assertDependencies();
    initializeMap();
    bindUiEvents();
    updateLoading("Loading course CSV", 8);

    const rawRows = await loadCoursesFromCsv();
    state.courses = normalizeCourses(rawRows);
    updateStats();
    updateFooter();

    resolveCourseLocations();
    hideLoading("Courses loaded");
  } catch (error) {
    console.error("Failed to initialize the golf tracker:", error);
    showFatalError(error);
  }
}

function cacheElements() {
  elements.appShell = document.getElementById("appShell");
  elements.sidebarToggle = document.getElementById("sidebarToggle");
  elements.sidebarToggleLabel = elements.sidebarToggle.querySelector(".sidebar-toggle-label");
  if (!elements.sidebarToggleLabel) {
    elements.sidebarToggleLabel = document.createElement("span");
    elements.sidebarToggleLabel.className = "sidebar-toggle-label";
    elements.sidebarToggle.prepend(elements.sidebarToggleLabel);
  }
  elements.themeToggle = document.getElementById("themeToggle");
  elements.courseDetailPanel = document.getElementById("courseDetailPanel") || createCourseDetailPanel();
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
    zoomToBoundsOnClick: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 13,
    iconCreateFunction: createClusterIcon,
  });

  state.map.addLayer(state.markerCluster);
  state.markerCluster.on("click", (event) => {
    const layer = event.layer;
    const courseKey = layer?.options?.courseKey;
    const course = state.courses.find((item) => item.key === courseKey);
    if (course) {
      openCourseDetails(course);
      return;
    }

    if (layer?.getAllChildMarkers) {
      const childMarkers = layer.getAllChildMarkers();
      if (childMarkers.length === 1) {
        const childCourse = state.courses.find(
          (item) => item.key === childMarkers[0].options.courseKey,
        );
        if (childCourse) {
          childMarkers[0].openPopup();
          openCourseDetails(childCourse);
        }
        return;
      }

      if (state.map.getZoom() >= state.map.getMaxZoom() - 1 && layer.spiderfy) {
        layer.spiderfy();
      } else if (layer.getBounds) {
        state.map.fitBounds(layer.getBounds().pad(0.18), { maxZoom: 13 });
      }
    }
  });
}

function createCourseDetailPanel() {
  const panel = document.createElement("section");
  panel.className = "course-detail-panel is-hidden";
  panel.id = "courseDetailPanel";
  panel.setAttribute("aria-label", "Course details");
  panel.setAttribute("aria-hidden", "true");
  elements.appShell.append(panel);
  return panel;
}

function bindUiEvents() {
  state.map.on("popupopen", (event) => {
    bindCourseDetailControls(event.popup.getElement());
  });

  populateRatingOptions();
  updateSidebarToggleLabel();
  const mobileLayoutQuery = window.matchMedia?.("(max-width: 760px)");
  mobileLayoutQuery?.addEventListener?.("change", handleSidebarLayoutChange);

  elements.sidebarToggle.addEventListener("click", () => {
    const isCollapsed = elements.appShell.classList.toggle("sidebar-collapsed");
    elements.sidebarToggle.setAttribute("aria-expanded", String(!isCollapsed));
    updateSidebarToggleLabel();

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

function applyInitialSidebarState() {
  if (isMobileLayout()) {
    elements.appShell.classList.add("sidebar-collapsed");
    elements.sidebarToggle.setAttribute("aria-expanded", "false");
  }
}

function handleSidebarLayoutChange(event) {
  elements.appShell.classList.toggle("sidebar-collapsed", event.matches);
  elements.sidebarToggle.setAttribute("aria-expanded", String(!event.matches));
  updateSidebarToggleLabel();
  window.setTimeout(() => state.map?.invalidateSize(), 240);
}

function updateSidebarToggleLabel() {
  const isCollapsed = elements.appShell.classList.contains("sidebar-collapsed");
  const isMobile = isMobileLayout();

  elements.sidebarToggleLabel.textContent = isMobile
    ? ""
    : isCollapsed
      ? "Show panel"
      : "Hide panel";
  elements.sidebarToggle.setAttribute(
    "aria-label",
    isCollapsed ? "Show course controls" : "Hide course controls",
  );
}

function isMobileLayout() {
  return window.matchMedia?.("(max-width: 760px)")?.matches ?? false;
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

async function loadCoursesFromCsv() {
  const response = await fetch(CSV_FILE);
  if (!response.ok) {
    throw new Error(`Could not load ${CSV_FILE}: HTTP ${response.status}`);
  }

  return parseCsv(await response.text());
}

function parseCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) {
    return [];
  }

  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows
    .filter((row) => row.some((cell) => cleanCell(cell)))
    .map((row) =>
      headers.reduce((record, header, index) => {
        record[header] = cleanCell(row[index]);
        return record;
      }, {}),
    );
}

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function normalizeCourses(rows) {
  const normalizedRows = rows.map((row) => {
    const normalized = {};
    CSV_COLUMNS.forEach((column) => {
      normalized[column] = readCsvCell(row, column);
    });

    return normalized;
  });

  const courseNameCounts = normalizedRows.reduce((counts, normalized) => {
    const courseName = displayCourseName(normalized);
    counts.set(courseName, (counts.get(courseName) || 0) + 1);
    return counts;
  }, new Map());

  const courses = normalizedRows.map((normalized, index) => {
    const courseName = displayCourseName(normalized);
    const csvCoordinates = parseCsvCoordinates(normalized.latitude, normalized.longitude);

    return {
      key: courseKey(courseName, normalized, courseNameCounts.get(courseName), index),
      rowIndex: index,
      raw: normalized,
      courseName,
      clubName: normalized.club_name,
      clubNumber: normalized.club_number_gsi,
      location: displayLocation(normalized),
      address: normalized.address,
      postalCode: normalized.postal_code,
      town: normalized.town,
      email: normalized.email,
      phone: normalized.phone,
      website: normalized.website,
      holes: normalized.holes,
      par: normalized.par,
      csvLat: csvCoordinates?.lat ?? null,
      csvLng: csvCoordinates?.lng ?? null,
      coordinateOffset: { lat: 0, lng: 0 },
      coordinateGroupSize: 1,
      searchText: [
        courseName,
        normalized.club_name,
        normalized.club_number_gsi,
        normalized.location,
        normalized.address,
        normalized.postal_code,
        normalized.town,
        normalized.email,
        normalized.phone,
        normalized.website,
      ]
        .join(" ")
        .toLowerCase(),
      lat: null,
      lng: null,
      hasLocation: false,
    };
  });

  assignCoordinateOffsets(courses);
  return courses;
}

function displayCourseName(normalized) {
  return cleanCell(normalized.course_name) || cleanCell(normalized.club_name) || "Unnamed course";
}

function courseKey(courseName, normalized, courseNameCount, index) {
  if (courseNameCount === 1 && courseName !== "Unnamed course") {
    return courseName;
  }

  const clubIdentifier = normalized.club_number_gsi || normalized.club_name || `row-${index + 1}`;
  const courseIdentifier = normalized.course_name || courseName || "course";
  return `${clubIdentifier}::${courseIdentifier}::${index + 1}`;
}

function formatCourseLocation(normalized) {
  const townLine = [normalized.postal_code, normalized.town].filter(Boolean).join(" ");
  return [normalized.address, townLine].filter(Boolean).join(", ");
}

function displayLocation(normalized) {
  return cleanCell(normalized.location) || formatCourseLocation(normalized);
}

function assignCoordinateOffsets(courses) {
  const groups = new Map();

  courses.forEach((course) => {
    if (!isValidIcelandCoordinate(course.csvLat, course.csvLng)) {
      return;
    }

    const key = coordinateGroupKey(course.csvLat, course.csvLng);
    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(course);
  });

  groups.forEach((group) => {
    if (group.length < 2) {
      return;
    }

    const radiusMeters = Math.min(230, 70 + group.length * 18);
    const degreesPerMeter = 1 / 111320;

    group.forEach((course, index) => {
      const angle = -Math.PI / 2 + (index / group.length) * Math.PI * 2;
      const lngScale = Math.max(Math.cos((course.csvLat * Math.PI) / 180), 0.2);

      course.coordinateOffset = {
        lat: Math.sin(angle) * radiusMeters * degreesPerMeter,
        lng: (Math.cos(angle) * radiusMeters * degreesPerMeter) / lngScale,
      };
      course.coordinateGroupSize = group.length;
    });
  });
}

function coordinateGroupKey(lat, lng) {
  return `${lat.toFixed(7)}|${lng.toFixed(7)}`;
}

function resolveCourseLocations() {
  try {
    state.skippedLocations = [];
    state.markerCluster.clearLayers();
    updateLoading("Plotting course coordinates", 72);

    const visibleMarkers = [];
    state.courses.forEach((course) => {
      const coords = coordinatesForCourseLocation(course);

      if (coords) {
        course.lat = coords.lat;
        course.lng = coords.lng;
        course.hasLocation = true;
        const marker = createCourseMarker(course);
        if (marker && courseMatchesCurrentView(course)) {
          visibleMarkers.push(marker);
        }
        return;
      }

      course.hasLocation = false;
      state.skippedLocations.push({
        course: course.courseName,
        club: course.clubName,
        location: course.location || "Missing",
        reason: course.location
          ? "Coordinates are missing or invalid."
          : "Coordinates and address are missing.",
      });
    });

    state.markerCluster.addLayers(visibleMarkers);
    state.markerCluster.refreshClusters();

    if (state.skippedLocations.length) {
      console.groupCollapsed(
        `${state.skippedLocations.length} courses were not mapped because coordinates are missing or invalid`,
      );
      console.table(state.skippedLocations);
      console.groupEnd();
    }

    fitMapToMappedCourses();
    updateFooter();
    updateLoading("Coordinates resolved", 100);
  } catch (error) {
    console.error("Location resolution failed:", error);
  }
}

function coordinatesForCourseLocation(course) {
  if (isValidIcelandCoordinate(course.csvLat, course.csvLng)) {
    return offsetCoordinates(
      {
        lat: course.csvLat,
        lng: course.csvLng,
      },
      course.coordinateOffset,
    );
  }

  return null;
}

function offsetCoordinates(coords, offset) {
  if (!offset) {
    return coords;
  }

  const adjusted = {
    lat: coords.lat + offset.lat,
    lng: coords.lng + offset.lng,
  };

  return isValidIcelandCoordinate(adjusted.lat, adjusted.lng) ? adjusted : coords;
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
  marker.bindPopup(buildCourseDetailContent(course), popupOptions());

  marker.on("mouseover", () => {
    marker.setStyle({ radius: 10, weight: 4, fillOpacity: 0.98 });
    marker.getElement()?.classList.add("is-hovered");
    marker.bringToFront();
  });
  marker.on("mouseout", () => {
    marker.setStyle(markerStyle(course));
    marker.getElement()?.classList.remove("is-hovered");
  });
  marker.on("click", () => {
    marker.setPopupContent(buildCourseDetailContent(course));
    marker.openPopup();
    window.setTimeout(() => bindCourseDetailControls(marker.getPopup()?.getElement()), 0);
    openCourseDetails(course);
  });

  state.markers.set(course.key, marker);
  return marker;
}

function popupOptions() {
  return {
    minWidth: 300,
    maxWidth: 380,
    autoPanPaddingTopLeft: isMobileLayout() ? [18, 72] : [430, 24],
    autoPanPaddingBottomRight: [18, 18],
    className: "course-popup-shell",
  };
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

function bindCourseDetailControls(panelElement) {
  if (!panelElement) {
    return;
  }

  const closeButton = panelElement.querySelector("[data-action='close-details']");
  if (closeButton && closeButton.dataset.controlsBound !== "true") {
    closeButton.dataset.controlsBound = "true";
    closeButton.addEventListener("click", closeCourseDetails);
  }

  const toggleButton = panelElement.querySelector("[data-action='toggle-played']");
  if (toggleButton && toggleButton.dataset.controlsBound !== "true") {
    toggleButton.dataset.controlsBound = "true";
    toggleButton.addEventListener("click", () => {
      const course = state.courses.find((item) => item.key === toggleButton.dataset.courseKey);
      if (course) {
        toggleCoursePlayed(course);
      }
    });
  }

  panelElement.querySelectorAll("[data-user-field]").forEach((field) => {
    if (field.dataset.controlsBound === "true") {
      return;
    }

    field.dataset.controlsBound = "true";
    field.addEventListener("change", () => {
      updateCourseUserData(field.dataset.courseKey, {
        [field.dataset.userField]: field.value,
      });
    });
  });
}

function openCourseDetails(course) {
  state.activeDetailCourseKey = course.key;
  renderCourseDetails(course);
  elements.courseDetailPanel.classList.remove("is-hidden");
  elements.courseDetailPanel.setAttribute("aria-hidden", "false");

  if (isMobileLayout()) {
    elements.appShell.classList.add("sidebar-collapsed");
    elements.sidebarToggle.setAttribute("aria-expanded", "false");
    updateSidebarToggleLabel();
  }
}

function renderCourseDetails(course) {
  elements.courseDetailPanel.innerHTML = buildCourseDetailContent(course);
  bindCourseDetailControls(elements.courseDetailPanel);
}

function closeCourseDetails() {
  state.activeDetailCourseKey = null;
  elements.courseDetailPanel.classList.add("is-hidden");
  elements.courseDetailPanel.setAttribute("aria-hidden", "true");
  elements.courseDetailPanel.innerHTML = "";
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

  if (courseMatchesCurrentView(course)) {
    state.markerCluster.refreshClusters();
  } else {
    renderVisibleMarkers();
  }

  if (state.activeDetailCourseKey === course.key) {
    renderCourseDetails(course);
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
  marker.setPopupContent(buildCourseDetailContent(course));
  if (marker.getPopup()?.isOpen()) {
    bindCourseDetailControls(marker.getPopup().getElement());
  }

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
  if (course && state.activeDetailCourseKey === courseKey) {
    renderCourseDetails(course);
  }

  const marker = state.markers.get(courseKey);
  if (course && marker) {
    marker.setPopupContent(buildCourseDetailContent(course));
    if (marker.getPopup()?.isOpen()) {
      bindCourseDetailControls(marker.getPopup().getElement());
    }
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
    console.warn("No courses were mapped because no valid coordinates or address matches were found.");
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

function buildCourseDetailContent(course) {
  const played = isCoursePlayed(course.key);
  const userData = getCourseUserData(course.key);
  const courseKeyAttribute = escapeAttribute(course.key);
  const toggleLabel = played ? "Mark unplayed" : "Mark played";

  return `
    <article class="course-detail">
      <header class="course-detail-hero">
        <button class="detail-close" type="button" data-action="close-details" aria-label="Close course details">
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </button>
        <div class="course-detail-heading">
          <p class="course-detail-eyebrow">${escapeHtml(displayValue(course.clubName))}</p>
          <h2>${escapeHtml(course.courseName)}</h2>
          <p class="course-detail-location">${escapeHtml(displayValue(course.location))}</p>
        </div>
        <span class="course-detail-status ${played ? "is-played" : "is-unplayed"}">
          ${played ? "Played" : "Not played"}
        </span>
      </header>

      <section class="detail-metrics" aria-label="Course summary">
        ${metricMarkup("Club #", course.clubNumber)}
        ${metricMarkup("Holes", course.holes)}
        ${metricMarkup("Par", course.par)}
      </section>

      <button
        class="detail-play-toggle ${played ? "is-played" : "is-unplayed"}"
        type="button"
        data-action="toggle-played"
        data-course-key="${courseKeyAttribute}"
      >
        <span class="play-toggle-icon" aria-hidden="true"></span>
        <span>${toggleLabel}</span>
      </button>

      <section class="detail-section" aria-label="Contact details">
        <header class="detail-section-header">
          <h3>Contact</h3>
        </header>
        <div class="detail-list">
          ${contactDetailListMarkup(course)}
        </div>
      </section>

      <section class="detail-section detail-notes" aria-label="Personal course notes">
        <header class="detail-section-header">
          <h3>My Notes</h3>
        </header>
        <div class="detail-field-grid">
          <label class="detail-field">
            <span class="detail-label">My rating</span>
            <select data-user-field="rating" data-course-key="${courseKeyAttribute}">
              ${numberOptionMarkup("Not rated", userData.rating)}
            </select>
          </label>

          <label class="detail-field">
            <span class="detail-label">Course condition</span>
            <select data-user-field="condition" data-course-key="${courseKeyAttribute}">
              ${numberOptionMarkup("Not recorded", userData.condition)}
            </select>
          </label>

          <label class="detail-field">
            <span class="detail-label">Weather condition</span>
            <select data-user-field="weather" data-course-key="${courseKeyAttribute}">
              ${numberOptionMarkup("Not recorded", userData.weather)}
            </select>
          </label>
        </div>
      </section>
    </article>
  `;
}

function metricMarkup(label, value) {
  return `
    <div class="detail-metric">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong class="metric-value">${escapeHtml(displayValue(value))}</strong>
    </div>
  `;
}

function contactDetailListMarkup(course) {
  const details = [
    optionalDetailMarkup("Address", cleanCell(course.address) || cleanCell(course.location)),
    optionalDetailMarkup("Postal Code", course.postalCode),
    optionalDetailMarkup("Town", course.town),
    optionalDetailMarkup("Email", course.email),
    optionalDetailMarkup("Phone", course.phone),
    websiteDetailMarkup(course.website),
  ].filter(Boolean);

  return details.length
    ? details.join("")
    : '<p class="empty-detail">Not available</p>';
}

function optionalDetailMarkup(label, value) {
  return cleanCell(value) ? detailMarkup(label, value) : "";
}

function websiteDetailMarkup(value) {
  const safeUrl = safeHttpUrl(value);
  if (!safeUrl) {
    return "";
  }

  return `
    <div class="detail is-full">
      <span class="detail-label">Website</span>
      <span class="detail-value">${linkMarkup(value, websiteDisplayLabel(value))}</span>
    </div>
  `;
}

function linkMarkup(value, label = value) {
  const safeUrl = safeHttpUrl(value);
  return safeUrl
    ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(displayValue(value));
}

function websiteDisplayLabel(value) {
  const safeUrl = safeHttpUrl(value);
  if (!safeUrl) {
    return displayValue(value);
  }

  try {
    return new URL(safeUrl).hostname.replace(/^www\./, "");
  } catch {
    return displayValue(value);
  }
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

function parseCsvCoordinates(latitude, longitude) {
  const lat = parseFiniteNumber(latitude);
  const lng = parseFiniteNumber(longitude);

  return isValidIcelandCoordinate(lat, lng) ? { lat, lng } : null;
}

function parseFiniteNumber(value) {
  const number = Number.parseFloat(cleanCell(value));
  return Number.isFinite(number) ? number : null;
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
