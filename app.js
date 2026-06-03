// Core data source. Keeping this as a relative path makes the app work on
// GitHub Pages as long as the CSV sits beside index.html.
const CSV_FILE = "golfbox_iceland_clubs.csv";

// Theme remains browser-local; account data and course progress live in Firestore.
const THEME_STORAGE_KEY = "icelandGolfCourses.theme.v1";
const FIREBASE_SDK_VERSION = "12.7.0";
const PRODUCTION_APP_URL = "https://golfkortari.snorribjarkason.com/";

const AUTH_NOTICE_TIMEOUT_MS = 5200;
const PROFILE_FIELD_LIMITS = {
  displayName: 80,
  bio: 500,
  phoneNumber: 40,
  location: 120,
};
const COURSE_NOTE_MAX_LENGTH = 500;

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
  played: {},
  userData: {},
  courseDataDocIds: new Set(),
  activeFilter: "all",
  searchTerm: "",
  skippedLocations: [],
  activeRatingCourseKey: null,
  hasFitInitialBounds: false,
  firebase: {
    configured: false,
    ready: false,
    initError: null,
    app: null,
    auth: null,
    db: null,
    authApi: null,
    firestoreApi: null,
  },
  authUser: null,
  profile: null,
  authMode: "login",
  authNoticeTimer: null,
  isProfileLoading: false,
  isCourseDataLoading: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  applyInitialTheme();
  applyInitialSidebarState();
  updateAuthUi();
  initializeFirebaseServices();

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
  elements.totalCourses = document.getElementById("totalCourses");
  elements.playedCourses = document.getElementById("playedCourses");
  elements.completionPercent = document.getElementById("completionPercent");
  elements.courseSearch = document.getElementById("courseSearch");
  elements.filterButtons = Array.from(document.querySelectorAll(".filter-button"));
  elements.timelineCount = document.getElementById("timelineCount");
  elements.timelineList = document.getElementById("timelineList");
  elements.footerTotal = document.getElementById("footerTotal");
  elements.lastUpdated = document.getElementById("lastUpdated");
  elements.loadingOverlay = document.getElementById("loadingOverlay");
  elements.loadingTitle = document.getElementById("loadingTitle");
  elements.loadingText = document.getElementById("loadingText");
  elements.loadingProgress = document.getElementById("loadingProgress");
  elements.accountAvatar = document.getElementById("accountAvatar");
  elements.accountName = document.getElementById("accountName");
  elements.accountEmail = document.getElementById("accountEmail");
  elements.guestAccountActions = document.getElementById("guestAccountActions");
  elements.userAccountActions = document.getElementById("userAccountActions");
  elements.openLogin = document.getElementById("openLogin");
  elements.openRegister = document.getElementById("openRegister");
  elements.openProfile = document.getElementById("openProfile");
  elements.signOutButton = document.getElementById("signOutButton");
  elements.verificationPanel = document.getElementById("verificationPanel");
  elements.verificationText = document.getElementById("verificationText");
  elements.resendVerification = document.getElementById("resendVerification");
  elements.refreshVerification = document.getElementById("refreshVerification");
  elements.accountNotice = document.getElementById("accountNotice");
  elements.authModal = document.getElementById("authModal");
  elements.authForm = document.getElementById("authForm");
  elements.authEyebrow = document.getElementById("authEyebrow");
  elements.authTitle = document.getElementById("authTitle");
  elements.authClose = document.getElementById("authClose");
  elements.authDisplayNameField = document.getElementById("authDisplayNameField");
  elements.authDisplayName = document.getElementById("authDisplayName");
  elements.authEmail = document.getElementById("authEmail");
  elements.authPassword = document.getElementById("authPassword");
  elements.authMessage = document.getElementById("authMessage");
  elements.authSubmit = document.getElementById("authSubmit");
  elements.googleSignIn = document.getElementById("googleSignIn");
  elements.switchAuthMode = document.getElementById("switchAuthMode");
  elements.forgotPassword = document.getElementById("forgotPassword");
  elements.profilePage = document.getElementById("profilePage");
  elements.profileForm = document.getElementById("profileForm");
  elements.profileAvatar = document.getElementById("profileAvatar");
  elements.profileTitle = document.getElementById("profileTitle");
  elements.profileSubtitle = document.getElementById("profileSubtitle");
  elements.profileClose = document.getElementById("profileClose");
  elements.profileDisplayName = document.getElementById("profileDisplayName");
  elements.profileEmail = document.getElementById("profileEmail");
  elements.profileBio = document.getElementById("profileBio");
  elements.profilePhone = document.getElementById("profilePhone");
  elements.profileLocation = document.getElementById("profileLocation");
  elements.profileCreatedAt = document.getElementById("profileCreatedAt");
  elements.profileUpdatedAt = document.getElementById("profileUpdatedAt");
  elements.profileMessage = document.getElementById("profileMessage");
  elements.profileCancel = document.getElementById("profileCancel");
  elements.profileSave = document.getElementById("profileSave");
  elements.ratingModal = document.getElementById("ratingModal");
  elements.ratingForm = document.getElementById("ratingForm");
  elements.ratingCourseName = document.getElementById("ratingCourseName");
  elements.modalPlayedDate = document.getElementById("modalPlayedDate");
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
      layer.setPopupContent(buildCourseDetailContent(course));
      layer.openPopup();
      window.setTimeout(() => bindCourseDetailControls(layer.getPopup()?.getElement()), 0);
      return;
    }

    if (layer?.getAllChildMarkers) {
      const childMarkers = layer.getAllChildMarkers();
      if (childMarkers.length === 1) {
        const childCourse = state.courses.find(
          (item) => item.key === childMarkers[0].options.courseKey,
        );
        if (childCourse) {
          childMarkers[0].setPopupContent(buildCourseDetailContent(childCourse));
          childMarkers[0].openPopup();
          window.setTimeout(() => bindCourseDetailControls(childMarkers[0].getPopup()?.getElement()), 0);
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

  elements.openLogin.addEventListener("click", () => navigateToRoute("login"));
  elements.openRegister.addEventListener("click", () => navigateToRoute("register"));
  elements.openProfile.addEventListener("click", () => navigateToRoute("profile"));
  elements.signOutButton.addEventListener("click", signOutUser);
  elements.resendVerification.addEventListener("click", resendVerificationEmail);
  elements.refreshVerification.addEventListener("click", refreshVerificationStatus);
  elements.authClose.addEventListener("click", closeAuthModal);
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.googleSignIn.addEventListener("click", signInWithGoogle);
  elements.switchAuthMode.addEventListener("click", toggleAuthMode);
  elements.forgotPassword.addEventListener("click", sendPasswordReset);
  elements.authModal.addEventListener("click", (event) => {
    if (event.target === elements.authModal) {
      closeAuthModal();
    }
  });
  elements.profileClose.addEventListener("click", closeProfilePage);
  elements.profileCancel.addEventListener("click", closeProfilePage);
  elements.profileForm.addEventListener("submit", saveProfile);
  window.addEventListener("hashchange", handleRouteChange);

  elements.ratingCancel.addEventListener("click", closeRatingModal);
  elements.ratingModal.addEventListener("click", (event) => {
    if (event.target === elements.ratingModal) {
      closeRatingModal();
    }
  });
  elements.ratingForm.addEventListener("submit", saveRatingModal);
  handleRouteChange();
}

async function initializeFirebaseServices() {
  try {
    const configModule = await import("./firebase-config.js");
    const firebaseConfig = configModule.firebaseConfig;

    if (!isFirebaseConfigComplete(firebaseConfig)) {
      state.firebase.ready = true;
      state.firebase.configured = false;
      updateAuthUi();
      return;
    }

    const sdkBaseUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    const [appApi, authApi, firestoreApi] = await Promise.all([
      import(`${sdkBaseUrl}/firebase-app.js`),
      import(`${sdkBaseUrl}/firebase-auth.js`),
      import(`${sdkBaseUrl}/firebase-firestore.js`),
    ]);

    const firebaseApp = appApi.initializeApp(firebaseConfig);
    const auth = authApi.getAuth(firebaseApp);
    const db = firestoreApi.getFirestore(firebaseApp);

    try {
      await authApi.setPersistence(auth, authApi.browserLocalPersistence);
    } catch (error) {
      console.warn("Could not set Firebase auth persistence.", error);
    }

    state.firebase = {
      configured: true,
      ready: true,
      initError: null,
      app: firebaseApp,
      auth,
      db,
      authApi,
      firestoreApi,
    };

    authApi.onAuthStateChanged(auth, handleAuthStateChanged);
    updateAuthUi();
  } catch (error) {
    state.firebase.ready = true;
    state.firebase.configured = false;
    state.firebase.initError = error;
    console.warn("Firebase failed to initialize.", error);
    updateAuthUi();
  }
}

function isFirebaseConfigComplete(firebaseConfig) {
  const requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
  return requiredKeys.every((key) => {
    const value = cleanCell(firebaseConfig?.[key]);
    return value && !value.startsWith("YOUR_");
  });
}

async function handleAuthStateChanged(user) {
  state.authUser = user;
  state.profile = null;
  resetCourseProgressState();
  updateAuthUi();
  refreshCourseDetailViews();

  if (!canUsePrivateFeatures()) {
    state.isProfileLoading = false;
    state.isCourseDataLoading = false;
    if (currentRoute() === "profile") {
      closeProfilePage(false);
    }
    updateAuthUi();
    renderVisibleMarkers();
    return;
  }

  try {
    await Promise.all([loadUserProfile(), loadUserCourseData()]);
  } catch (error) {
    console.warn("Could not load account data.", error);
    setAccountNotice("Could not load your account data.", "error");
  } finally {
    updateAuthUi();
    renderVisibleMarkers();
    refreshCourseDetailViews();
    if (currentRoute() === "profile") {
      openProfilePage(false);
    }
  }
}

async function loadUserProfile() {
  if (!canUsePrivateFeatures()) {
    return null;
  }

  const { doc, getDoc, setDoc, serverTimestamp } = state.firebase.firestoreApi;
  const profileRef = doc(state.firebase.db, "users", state.authUser.uid);
  state.isProfileLoading = true;
  renderProfileForm();

  try {
    const snapshot = await getDoc(profileRef);
    if (snapshot.exists()) {
      state.profile = profileFromSnapshot(snapshot);
      return state.profile;
    }

    const profile = buildDefaultProfile(state.authUser, serverTimestamp);
    await setDoc(profileRef, profile);

    const createdSnapshot = await getDoc(profileRef);
    state.profile = createdSnapshot.exists()
      ? profileFromSnapshot(createdSnapshot)
      : {
          ...profile,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
    return state.profile;
  } finally {
    state.isProfileLoading = false;
    renderProfileForm();
  }
}

function buildDefaultProfile(user, serverTimestamp) {
  const timestamp = serverTimestamp();
  return {
    displayName: cleanProfileString(user.displayName || emailName(user.email), PROFILE_FIELD_LIMITS.displayName),
    email: cleanCell(user.email),
    photoURL: googlePhotoUrlForUser(user),
    bio: "",
    phoneNumber: "",
    location: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function profileFromSnapshot(snapshot) {
  const data = snapshot.data() || {};
  return {
    displayName: cleanProfileString(
      data.displayName || state.authUser?.displayName || emailName(state.authUser?.email),
      PROFILE_FIELD_LIMITS.displayName,
    ),
    email: cleanCell(data.email || state.authUser?.email),
    photoURL: cleanCell(data.photoURL || googlePhotoUrlForUser(state.authUser)),
    bio: cleanProfileString(data.bio, PROFILE_FIELD_LIMITS.bio),
    phoneNumber: cleanProfileString(data.phoneNumber, PROFILE_FIELD_LIMITS.phoneNumber),
    location: cleanProfileString(data.location, PROFILE_FIELD_LIMITS.location),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

async function loadUserCourseData() {
  if (!canUsePrivateFeatures()) {
    resetCourseProgressState();
    return;
  }

  const { collection, getDocs } = state.firebase.firestoreApi;
  state.isCourseDataLoading = true;

  try {
    const courseDataRef = collection(
      state.firebase.db,
      "users",
      state.authUser.uid,
      "courseData",
    );
    const snapshot = await getDocs(courseDataRef);
    const played = {};
    const userData = {};
    const docIds = new Set();

    snapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const courseKey = cleanCell(data.courseKey || decodeCourseDocId(docSnapshot.id));
      if (!courseKey) {
        return;
      }

      docIds.add(courseDataDocId(courseKey));
      if (data.played === true) {
        played[courseKey] = true;
      }

      userData[courseKey] = {
        rating: normalizeCourseMetric(data.rating),
        condition: normalizeCourseMetric(data.condition),
        weather: normalizeCourseMetric(data.weather),
        wishlist: data.wishlist === true,
        playedDate: normalizePlayedDate(data.playedDate),
        note: cleanCourseNote(data.note),
      };
    });

    state.played = played;
    state.userData = userData;
    state.courseDataDocIds = docIds;
  } finally {
    state.isCourseDataLoading = false;
  }
}

function resetCourseProgressState() {
  state.played = {};
  state.userData = {};
  state.courseDataDocIds = new Set();
}

async function persistCourseData(courseKey) {
  if (!canUsePrivateFeatures()) {
    return;
  }

  const { deleteDoc, doc, serverTimestamp, setDoc } = state.firebase.firestoreApi;
  const docId = courseDataDocId(courseKey);
  const courseDataRef = doc(
    state.firebase.db,
    "users",
    state.authUser.uid,
    "courseData",
    docId,
  );
  const userData = getCourseUserData(courseKey);
  const hasPlayed = isCoursePlayed(courseKey);
  const hasDetails = Boolean(
    userData.rating ||
      userData.condition ||
      userData.weather ||
      userData.wishlist ||
      userData.playedDate ||
      userData.note,
  );

  if (!hasPlayed && !hasDetails) {
    await deleteDoc(courseDataRef);
    state.courseDataDocIds.delete(docId);
    return;
  }

  const payload = {
    courseKey,
    played: hasPlayed,
    rating: userData.rating,
    condition: userData.condition,
    weather: userData.weather,
    wishlist: userData.wishlist,
    playedDate: userData.playedDate,
    note: userData.note,
    updatedAt: serverTimestamp(),
  };

  if (!state.courseDataDocIds.has(docId)) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(courseDataRef, payload, { merge: true });
  state.courseDataDocIds.add(docId);
}

function courseDataDocId(courseKey) {
  return encodeURIComponent(courseKey);
}

function decodeCourseDocId(docId) {
  try {
    return decodeURIComponent(docId);
  } catch {
    return docId;
  }
}

function normalizeCourseMetric(value) {
  const text = cleanCell(value);
  return /^(10|[1-9])$/.test(text) ? text : "";
}

function normalizePlayedDate(value) {
  const text = cleanCell(value);
  if (!text) {
    return "";
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T00:00:00`).getTime())
    ? text
    : "";
}

function cleanCourseNote(value) {
  return cleanCell(value).slice(0, COURSE_NOTE_MAX_LENGTH);
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "on";
}

function updateAuthUi() {
  const user = state.authUser;
  const isSignedIn = Boolean(user);
  const isVerified = isVerifiedUser(user);
  const accountName = isSignedIn
    ? user.displayName || emailName(user.email) || "Account"
    : "Guest";
  const accountEmail = isSignedIn
    ? cleanCell(user.email)
    : state.firebase.ready && state.firebase.configured
      ? "Sign in to save"
      : "Map access only";

  elements.accountName.textContent = accountName;
  elements.accountEmail.textContent = accountEmail;
  renderAvatar(elements.accountAvatar, user, accountName);

  elements.guestAccountActions.classList.toggle("is-hidden", isSignedIn);
  elements.userAccountActions.classList.toggle("is-hidden", !isSignedIn);
  elements.verificationPanel.classList.toggle("is-hidden", !isSignedIn || isVerified);

  const authUnavailable = !state.firebase.ready || !state.firebase.configured;
  elements.openLogin.disabled = authUnavailable;
  elements.openRegister.disabled = authUnavailable;
  elements.googleSignIn.disabled = authUnavailable;
  elements.authSubmit.disabled = authUnavailable;
  elements.forgotPassword.disabled = authUnavailable;
  elements.openProfile.disabled = !canUsePrivateFeatures();
  elements.resendVerification.disabled = authUnavailable || !isSignedIn || isVerified;
  elements.refreshVerification.disabled = authUnavailable || !isSignedIn || isVerified;

  renderDefaultAccountNotice();
  renderProfileForm();
}

function renderDefaultAccountNotice() {
  if (elements.accountNotice.dataset.manual === "true") {
    return;
  }

  let message = "";
  let tone = "info";

  if (state.firebase.initError) {
    message = "Account services failed to load.";
    tone = "error";
  } else if (!state.firebase.ready) {
    message = "Loading account services.";
  } else if (!state.firebase.configured) {
    message = "Add Firebase config to enable accounts.";
  } else if (state.authUser && !isVerifiedUser(state.authUser)) {
    message = "Verify your email to save progress.";
    tone = "warning";
  }

  elements.accountNotice.textContent = message;
  elements.accountNotice.dataset.tone = tone;
}

function setAccountNotice(message, tone = "info", timeout = AUTH_NOTICE_TIMEOUT_MS) {
  window.clearTimeout(state.authNoticeTimer);
  elements.accountNotice.dataset.manual = message ? "true" : "false";
  elements.accountNotice.dataset.tone = tone;
  elements.accountNotice.textContent = message;

  if (message && timeout > 0) {
    state.authNoticeTimer = window.setTimeout(() => {
      elements.accountNotice.dataset.manual = "false";
      renderDefaultAccountNotice();
    }, timeout);
  }
}

function isVerifiedUser(user = state.authUser) {
  return Boolean(user?.emailVerified);
}

function canUsePrivateFeatures() {
  return Boolean(
    state.firebase.ready &&
      state.firebase.configured &&
      state.authUser &&
      isVerifiedUser(state.authUser),
  );
}

function requireVerifiedUser(action = "continue") {
  if (canUsePrivateFeatures()) {
    return true;
  }

  if (!state.firebase.ready || !state.firebase.configured) {
    setAccountNotice("Add Firebase config before using account features.", "warning");
    return false;
  }

  if (!state.authUser) {
    setAccountNotice(`Sign in to ${action}.`, "warning");
    openAuthModal("login");
    return false;
  }

  setAccountNotice(`Verify your email to ${action}.`, "warning");
  return false;
}

function navigateToRoute(route) {
  const nextHash = `#${route}`;
  if (window.location.hash === nextHash) {
    handleRouteChange();
  } else {
    window.location.hash = route;
  }
}

function currentRoute() {
  return window.location.hash.replace(/^#\/?/, "");
}

function handleRouteChange() {
  const route = currentRoute();
  if (route === "login" || route === "register") {
    closeProfilePage(false);
    openAuthModal(route, false);
    return;
  }

  if (route === "profile") {
    closeAuthModal(false);
    openProfilePage(false);
    return;
  }

  closeAuthModal(false);
  closeProfilePage(false);
}

function clearRouteIfActive(routes) {
  if (!routes.includes(currentRoute())) {
    return;
  }

  window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
}

function openAuthModal(mode = "login", shouldUpdateRoute = true) {
  if (shouldUpdateRoute) {
    navigateToRoute(mode);
    return;
  }

  state.authMode = mode;
  renderAuthMode();
  elements.authModal.classList.remove("is-hidden");
  elements.authEmail.focus();
}

function closeAuthModal(shouldClearRoute = true) {
  elements.authModal.classList.add("is-hidden");
  elements.authMessage.textContent = "";
  elements.authMessage.dataset.tone = "info";
  if (shouldClearRoute) {
    clearRouteIfActive(["login", "register"]);
  }
}

function renderAuthMode() {
  const isRegister = state.authMode === "register";
  elements.authEyebrow.textContent = isRegister ? "New account" : "Account";
  elements.authTitle.textContent = isRegister ? "Register" : "Sign in";
  elements.authSubmit.textContent = isRegister ? "Register" : "Sign in";
  elements.switchAuthMode.textContent = isRegister ? "Sign in instead" : "Create account";
  elements.authDisplayNameField.classList.toggle("is-hidden", !isRegister);
  elements.authPassword.autocomplete = isRegister ? "new-password" : "current-password";
  elements.authMessage.textContent = "";
  elements.authMessage.dataset.tone = "info";
}

function toggleAuthMode() {
  navigateToRoute(state.authMode === "register" ? "login" : "register");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.firebase.configured) {
    setAuthMessage("Add Firebase config before signing in.", "warning");
    return;
  }

  const email = cleanCell(elements.authEmail.value);
  const password = elements.authPassword.value;

  if (!email || !password) {
    setAuthMessage("Email and password are required.", "warning");
    return;
  }

  setAuthBusy(true);
  try {
    if (state.authMode === "register") {
      await registerWithEmail(email, password);
    } else {
      await loginWithEmail(email, password);
    }
  } catch (error) {
    setAuthMessage(authErrorMessage(error), "error");
  } finally {
    setAuthBusy(false);
  }
}

async function registerWithEmail(email, password) {
  const { createUserWithEmailAndPassword, updateProfile } = state.firebase.authApi;
  const displayName = cleanProfileString(
    elements.authDisplayName.value || emailName(email),
    PROFILE_FIELD_LIMITS.displayName,
  );
  const credential = await createUserWithEmailAndPassword(state.firebase.auth, email, password);

  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }

  await sendVerificationEmail(credential.user);
  setAuthMessage("Verification email sent.", "success");
  setAccountNotice("Verification email sent.", "success");
}

async function sendVerificationEmail(user) {
  const actionSettings = emailActionSettings();
  console.info("Sending Firebase verification email.", {
    email: user.email,
    actionUrl: actionSettings.url,
  });
  await state.firebase.authApi.sendEmailVerification(user, actionSettings);
}

async function loginWithEmail(email, password) {
  const { signInWithEmailAndPassword } = state.firebase.authApi;
  const credential = await signInWithEmailAndPassword(state.firebase.auth, email, password);
  if (credential.user.emailVerified) {
    closeAuthModal();
    setAccountNotice("Signed in.", "success");
    return;
  }

  closeAuthModal();
  setAccountNotice("Verify your email to save progress.", "warning");
}

async function signInWithGoogle() {
  if (!state.firebase.configured) {
    setAuthMessage("Add Firebase config before signing in.", "warning");
    return;
  }

  const { GoogleAuthProvider, signInWithPopup } = state.firebase.authApi;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  setAuthBusy(true);
  try {
    await signInWithPopup(state.firebase.auth, provider);
    closeAuthModal();
    setAccountNotice("Signed in with Google.", "success");
  } catch (error) {
    setAuthMessage(authErrorMessage(error), "error");
  } finally {
    setAuthBusy(false);
  }
}

async function sendPasswordReset() {
  if (!state.firebase.configured) {
    setAuthMessage("Add Firebase config before resetting passwords.", "warning");
    return;
  }

  const email = cleanCell(elements.authEmail.value);
  if (!email) {
    setAuthMessage("Enter your email first.", "warning");
    elements.authEmail.focus();
    return;
  }

  setAuthBusy(true);
  try {
    await state.firebase.authApi.sendPasswordResetEmail(
      state.firebase.auth,
      email,
      emailActionSettings(),
    );
    setAuthMessage("If that account exists, a reset email was sent.", "success");
  } catch (error) {
    setAuthMessage(authErrorMessage(error), "error");
  } finally {
    setAuthBusy(false);
  }
}

async function resendVerificationEmail() {
  if (!state.authUser || isVerifiedUser(state.authUser)) {
    return;
  }

  try {
    await sendVerificationEmail(state.authUser);
    setAccountNotice("Verification email sent.", "success");
  } catch (error) {
    setAccountNotice(authErrorMessage(error), "error");
  }
}

async function refreshVerificationStatus() {
  if (!state.authUser) {
    return;
  }

  try {
    await state.firebase.authApi.reload(state.authUser);
    state.authUser = state.firebase.auth.currentUser;
    if (canUsePrivateFeatures()) {
      await Promise.all([loadUserProfile(), loadUserCourseData()]);
      setAccountNotice("Email verified.", "success");
    } else {
      setAccountNotice("Email is not verified yet.", "warning");
    }
  } catch (error) {
    setAccountNotice(authErrorMessage(error), "error");
  } finally {
    updateAuthUi();
    refreshCourseDetailViews();
  }
}

async function signOutUser() {
  if (!state.firebase.configured) {
    return;
  }

  try {
    await state.firebase.authApi.signOut(state.firebase.auth);
    state.profile = null;
    closeProfilePage();
    setAccountNotice("Signed out.", "success");
  } catch (error) {
    setAccountNotice(authErrorMessage(error), "error");
  }
}

function setAuthBusy(isBusy) {
  [
    elements.authDisplayName,
    elements.authEmail,
    elements.authPassword,
    elements.authSubmit,
    elements.googleSignIn,
    elements.switchAuthMode,
    elements.forgotPassword,
  ].forEach((element) => {
    element.disabled = isBusy || (!state.firebase.configured && element !== elements.switchAuthMode);
  });
}

function setAuthMessage(message, tone = "info") {
  elements.authMessage.textContent = message;
  elements.authMessage.dataset.tone = tone;
}

function emailActionSettings() {
  const origin = window.location.origin;
  const pathname = window.location.pathname || "/";
  const isHttpOrigin = origin.startsWith("http://") || origin.startsWith("https://");
  const baseUrl = isHttpOrigin ? `${origin}${pathname}` : PRODUCTION_APP_URL;

  return {
    url: `${baseUrl}#login`,
    handleCodeInApp: false,
  };
}

function openProfilePage(shouldUpdateRoute = true) {
  if (shouldUpdateRoute) {
    navigateToRoute("profile");
    return;
  }

  if (!requireVerifiedUser("open your profile")) {
    closeProfilePage(false);
    return;
  }

  elements.profilePage.classList.remove("is-hidden");
  renderProfileForm();
  if (!state.profile && !state.isProfileLoading) {
    loadUserProfile().catch((error) => {
      console.warn("Could not load profile.", error);
      setProfileMessage("Could not load your profile.", "error");
    });
  }
}

function closeProfilePage(shouldClearRoute = true) {
  elements.profilePage.classList.add("is-hidden");
  elements.profileMessage.textContent = "";
  elements.profileMessage.dataset.tone = "info";
  if (shouldClearRoute) {
    clearRouteIfActive(["profile"]);
  }
}

function renderProfileForm() {
  if (!elements.profileForm) {
    return;
  }

  const user = state.authUser;
  const profile = state.profile || {};
  const displayName = profile.displayName || user?.displayName || emailName(user?.email);
  const email = profile.email || user?.email || "";
  const photoName = displayName || email || "Profile";

  renderAvatar(elements.profileAvatar, user, photoName);
  elements.profileTitle.textContent = displayName || "My profile";
  elements.profileSubtitle.textContent = email;
  elements.profileDisplayName.value = displayName || "";
  elements.profileEmail.value = email;
  elements.profileBio.value = profile.bio || "";
  elements.profilePhone.value = profile.phoneNumber || "";
  elements.profileLocation.value = profile.location || "";
  elements.profileCreatedAt.textContent = formatProfileDate(profile.createdAt);
  elements.profileUpdatedAt.textContent = formatProfileDate(profile.updatedAt);
  elements.profileSave.disabled = !canUsePrivateFeatures() || state.isProfileLoading;

  if (state.isProfileLoading) {
    setProfileMessage("Loading profile.", "info");
  } else if (elements.profileMessage.textContent === "Loading profile.") {
    setProfileMessage("", "info");
  }
}

async function saveProfile(event) {
  event.preventDefault();
  if (!requireVerifiedUser("save your profile")) {
    return;
  }

  const { doc, getDoc, setDoc, serverTimestamp } = state.firebase.firestoreApi;
  const { updateProfile } = state.firebase.authApi;
  const profileRef = doc(state.firebase.db, "users", state.authUser.uid);
  const payload = {
    displayName: cleanProfileString(elements.profileDisplayName.value, PROFILE_FIELD_LIMITS.displayName),
    email: cleanCell(state.authUser.email),
    photoURL: googlePhotoUrlForUser(state.authUser),
    bio: cleanProfileString(elements.profileBio.value, PROFILE_FIELD_LIMITS.bio),
    phoneNumber: cleanProfileString(elements.profilePhone.value, PROFILE_FIELD_LIMITS.phoneNumber),
    location: cleanProfileString(elements.profileLocation.value, PROFILE_FIELD_LIMITS.location),
    updatedAt: serverTimestamp(),
  };

  if (!state.profile?.createdAt) {
    payload.createdAt = serverTimestamp();
  }

  elements.profileSave.disabled = true;
  setProfileMessage("Saving profile.", "info");

  try {
    await updateProfile(state.authUser, { displayName: payload.displayName });
    await setDoc(profileRef, payload, { merge: true });

    const snapshot = await getDoc(profileRef);
    state.profile = snapshot.exists() ? profileFromSnapshot(snapshot) : state.profile;
    setProfileMessage("Profile saved.", "success");
    updateAuthUi();
  } catch (error) {
    setProfileMessage(authErrorMessage(error), "error");
  } finally {
    elements.profileSave.disabled = !canUsePrivateFeatures();
  }
}

function setProfileMessage(message, tone = "info") {
  elements.profileMessage.textContent = message;
  elements.profileMessage.dataset.tone = tone;
}

function renderAvatar(element, user, fallbackName) {
  const photoUrl = googlePhotoUrlForUser(user);
  const safePhotoUrl = safeHttpUrl(photoUrl);
  element.style.backgroundImage = safePhotoUrl ? `url("${safePhotoUrl}")` : "";
  element.textContent = safePhotoUrl ? "" : initialsForName(fallbackName);
}

function googlePhotoUrlForUser(user) {
  if (!user) {
    return "";
  }

  const googleProvider = user.providerData?.find((provider) => provider.providerId === "google.com");
  return cleanCell(googleProvider?.photoURL || user.photoURL);
}

function initialsForName(value) {
  const words = cleanCell(value).split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "G";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function emailName(email) {
  return cleanCell(email).split("@")[0] || "";
}

function cleanProfileString(value, maxLength) {
  return cleanCell(value).slice(0, maxLength);
}

function formatProfileDate(value) {
  let date = null;
  if (value?.toDate) {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else if (value) {
    const parsed = new Date(value);
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (!date) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPlayedDate(value) {
  const normalized = normalizePlayedDate(value);
  if (!normalized) {
    return "Not dated";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(`${normalized}T00:00:00`));
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Sign-in was cancelled.";
  }

  if (code === "auth/weak-password") {
    return "Use a stronger password.";
  }

  if (code === "auth/email-already-in-use") {
    return "That email is already registered.";
  }

  if (code === "auth/invalid-email") {
    return "Enter a valid email address.";
  }

  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  ) {
    return "Could not sign in with that email and password.";
  }

  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "You do not have permission to make that change.";
  }

  return error?.message || "Something went wrong.";
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
  const wishlist = getCourseUserData(course.key).wishlist;

  return {
    radius: 8,
    weight: 3,
    opacity: 1,
    fillOpacity: 0.88,
    color: played ? "#0f6f41" : wishlist ? "#8a6812" : "#a72f29",
    fillColor: played ? "#28b96d" : wishlist ? "#d89b28" : "#ef5b53",
    className: `course-marker ${played ? "is-played" : "is-unplayed"} ${wishlist ? "is-wishlist" : ""}`,
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
  const userData = getCourseUserData(course.key);
  const matchesFilter =
    state.activeFilter === "all" ||
    (state.activeFilter === "played" && played) ||
    (state.activeFilter === "unplayed" && !played) ||
    (state.activeFilter === "wishlist" && userData.wishlist);
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
    closeButton.addEventListener("click", () => state.map?.closePopup());
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

  const wishlistButton = panelElement.querySelector("[data-action='toggle-wishlist']");
  if (wishlistButton && wishlistButton.dataset.controlsBound !== "true") {
    wishlistButton.dataset.controlsBound = "true";
    wishlistButton.addEventListener("click", () => {
      const currentData = getCourseUserData(wishlistButton.dataset.courseKey);
      updateCourseUserData(wishlistButton.dataset.courseKey, {
        wishlist: !currentData.wishlist,
      });
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

async function toggleCoursePlayed(course) {
  if (!requireVerifiedUser("save progress")) {
    return;
  }

  const nextPlayed = !isCoursePlayed(course.key);
  const previousPlayed = { ...state.played };
  const previousUserData = { ...state.userData };

  if (nextPlayed) {
    state.played[course.key] = true;
  } else {
    delete state.played[course.key];
  }

  updateMarkerAppearance(course);
  updateStats();
  updateTimeline();

  if (courseMatchesCurrentView(course)) {
    state.markerCluster.refreshClusters();
  } else {
    renderVisibleMarkers();
  }

  if (nextPlayed) {
    openRatingModal(course);
  }

  try {
    await persistCourseData(course.key);
  } catch (error) {
    state.played = previousPlayed;
    state.userData = previousUserData;
    updateMarkerAppearance(course);
    updateStats();
    updateTimeline();
    renderVisibleMarkers();
    setAccountNotice(authErrorMessage(error), "error");
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
    markerElement.classList.toggle("is-wishlist", getCourseUserData(course.key).wishlist);
  }
}

function refreshCourseDetailViews() {
  state.markers.forEach((marker, courseKey) => {
    const course = state.courses.find((item) => item.key === courseKey);
    if (!course) {
      return;
    }

    marker.setPopupContent(buildCourseDetailContent(course));
    if (marker.getPopup()?.isOpen()) {
      bindCourseDetailControls(marker.getPopup().getElement());
    }
  });
}

async function updateCourseUserData(courseKey, updates) {
  if (!requireVerifiedUser("save course notes")) {
    return;
  }

  const previousUserData = { ...state.userData };
  const previousPlayed = { ...state.played };

  state.userData[courseKey] = {
    ...getCourseUserData(courseKey),
    ...normalizeCourseUserData(updates),
  };

  const course = state.courses.find((item) => item.key === courseKey);
  const marker = state.markers.get(courseKey);
  if (course && marker) {
    updateMarkerAppearance(course);
  }
  updateTimeline();
  const shouldRefreshFilteredMarkers =
    state.activeFilter === "wishlist" &&
    Object.prototype.hasOwnProperty.call(updates, "wishlist");
  if (shouldRefreshFilteredMarkers) {
    renderVisibleMarkers();
  }

  try {
    await persistCourseData(courseKey);
  } catch (error) {
    state.userData = previousUserData;
    state.played = previousPlayed;
    updateTimeline();
    if (course && marker) {
      updateMarkerAppearance(course);
    }
    if (shouldRefreshFilteredMarkers) {
      renderVisibleMarkers();
    }
    setAccountNotice(authErrorMessage(error), "error");
  }
}

function getCourseUserData(courseKey) {
  return {
    rating: "",
    condition: "",
    weather: "",
    wishlist: false,
    playedDate: "",
    note: "",
    ...(state.userData[courseKey] || {}),
  };
}

function normalizeCourseUserData(updates) {
  const normalized = {};
  ["rating", "condition", "weather"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      normalized[key] = normalizeCourseMetric(updates[key]);
    }
  });
  if (Object.prototype.hasOwnProperty.call(updates, "wishlist")) {
    normalized.wishlist = normalizeBoolean(updates.wishlist);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "playedDate")) {
    normalized.playedDate = normalizePlayedDate(updates.playedDate);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "note")) {
    normalized.note = cleanCourseNote(updates.note);
  }
  return normalized;
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
  elements.modalPlayedDate.value = userData.playedDate;
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

async function saveRatingModal(event) {
  event.preventDefault();

  if (!state.activeRatingCourseKey || !requireVerifiedUser("save course notes")) {
    closeRatingModal();
    return;
  }

  await updateCourseUserData(state.activeRatingCourseKey, {
    playedDate: elements.modalPlayedDate.value,
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
  updateTimeline();
}

function updateTimeline() {
  if (!elements.timelineList || !elements.timelineCount) {
    return;
  }

  const items = state.courses
    .map((course) => ({
      course,
      userData: getCourseUserData(course.key),
    }))
    .filter((item) => isCoursePlayed(item.course.key) && item.userData.playedDate)
    .sort((a, b) => b.userData.playedDate.localeCompare(a.userData.playedDate));

  elements.timelineCount.textContent = String(items.length);

  if (!items.length) {
    elements.timelineList.innerHTML = '<li class="empty-timeline">No played dates yet</li>';
    return;
  }

  elements.timelineList.innerHTML = items
    .slice(0, 8)
    .map(
      ({ course, userData }) => `
        <li class="timeline-item">
          <time datetime="${escapeAttribute(userData.playedDate)}">${escapeHtml(formatPlayedDate(userData.playedDate))}</time>
          <strong>${escapeHtml(course.courseName)}</strong>
          <span>${escapeHtml(displayValue(course.clubName))}</span>
        </li>
      `,
    )
    .join("");
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
  const wishlistLabel = userData.wishlist ? "Remove wishlist" : "Add wishlist";
  const canSave = canUsePrivateFeatures();
  const lockedMarkup = canSave
    ? ""
    : '<p class="detail-lock">Sign in and verify email to save personal progress.</p>';
  const lockedAttribute = canSave ? "" : 'aria-disabled="true"';
  const selectDisabledAttribute = canSave ? "" : "disabled";
  const fieldDisabledAttribute = canSave ? "" : "disabled";

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
        class="detail-play-toggle ${played ? "is-played" : "is-unplayed"} ${canSave ? "" : "is-locked"}"
        type="button"
        data-action="toggle-played"
        data-course-key="${courseKeyAttribute}"
        ${lockedAttribute}
      >
        <span class="play-toggle-icon" aria-hidden="true"></span>
        <span>${toggleLabel}</span>
      </button>

      <button
        class="detail-wishlist-toggle ${userData.wishlist ? "is-active" : ""} ${canSave ? "" : "is-locked"}"
        type="button"
        data-action="toggle-wishlist"
        data-course-key="${courseKeyAttribute}"
        ${lockedAttribute}
      >
        <span class="wishlist-toggle-icon" aria-hidden="true"></span>
        <span>${wishlistLabel}</span>
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
        ${lockedMarkup}
        <div class="detail-field-grid">
          <label class="detail-field">
            <span class="detail-label">My rating</span>
            <select data-user-field="rating" data-course-key="${courseKeyAttribute}" ${selectDisabledAttribute}>
              ${numberOptionMarkup("Not rated", userData.rating)}
            </select>
          </label>

          <label class="detail-field">
            <span class="detail-label">Course condition</span>
            <select data-user-field="condition" data-course-key="${courseKeyAttribute}" ${selectDisabledAttribute}>
              ${numberOptionMarkup("Not recorded", userData.condition)}
            </select>
          </label>

          <label class="detail-field">
            <span class="detail-label">Weather condition</span>
            <select data-user-field="weather" data-course-key="${courseKeyAttribute}" ${selectDisabledAttribute}>
              ${numberOptionMarkup("Not recorded", userData.weather)}
            </select>
          </label>

          <label class="detail-field">
            <span class="detail-label">Played date</span>
            <input
              type="date"
              data-user-field="playedDate"
              data-course-key="${courseKeyAttribute}"
              value="${escapeAttribute(userData.playedDate)}"
              ${fieldDisabledAttribute}
            />
          </label>

          <label class="detail-field is-full">
            <span class="detail-label">Private note</span>
            <textarea
              data-user-field="note"
              data-course-key="${courseKeyAttribute}"
              maxlength="${COURSE_NOTE_MAX_LENGTH}"
              rows="4"
              ${fieldDisabledAttribute}
            >${escapeHtml(userData.note)}</textarea>
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
