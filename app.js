import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    query,
    orderBy,
    serverTimestamp,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    limit,
    where,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

/* -------------------------------------------------------------------------- */
/* Site settings                                                              */
/* -------------------------------------------------------------------------- */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const LOGO_PATH = 'assets/pimincgames-logo.svg';
const VISITOR_RATING_KEY = 'pimincgames-visitor-rating-id';

// Keep game names and IDs here. Add artwork to assets/games/ and set image to
// its path, for example: image: 'assets/games/pimening.png'.
// Set link to a playable build or project page URL when one exists.
const games = [
    {
        id: 'pimening',
        name: 'The Pimening',
        desc: "Explore various unique mazes and environments, meet different characters, and discover what a good game looks like.",
        status: 'In development',
        glyph: '✦',
        style: '',
        image: '',
        link: ''
    },
    {
        id: 'cookie-clicker-deluxe',
        name: 'Cookie Clicker But Budget Deluxe',
        desc: 'A simple but good Cookie Clicker-style game with more than meets the eye.',
        status: 'Demo',
        glyph: '⌁',
        style: 'neon',
        image: '',
        link: ''
    },
    {
        id: 'piano-boss-remastered',
        name: 'Piano Boss Fight Remastered',
        desc: 'A retro endless survival boss fight adventure against a sentient piano-try to see how long you will last!',
        status: 'Experiment',
        glyph: '☾',
        style: 'aura',
        image: '',
        link: ''
    }
];

let auth = null;
let db = null;
let user = null;
let profile = null;
let firebaseReady = false;
let isCurrentUserStaff = false;

/* -------------------------------------------------------------------------- */
/* Firebase and authentication                                                */
/* -------------------------------------------------------------------------- */

const hasFirebaseConfig = Boolean(
    firebaseConfig?.apiKey && !firebaseConfig.apiKey.includes('PASTE_')
);

if (hasFirebaseConfig) {
    try {
        const firebaseApp = initializeApp(firebaseConfig);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);
        firebaseReady = true;

        onAuthStateChanged(auth, async (signedInUser) => {
            user = signedInUser;
            profile = user ? await ensureProfile(user) : null;
            isCurrentUserStaff = user ? await isStaff(user.uid) : false;
            renderAuthCorner();
            await renderAccount();

            if (document.body.dataset.page === 'community') await loadPosts();
            if (document.body.dataset.page === 'game') await renderGameDetail();
            if (document.body.dataset.page === 'profile') await renderPublicProfile();
        });
    } catch (error) {
        console.error('Firebase initialization failed:', error);
    }
}

function setStatus(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.className = `status${isError ? ' error' : ''}`;
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function formatDate(timestamp) {
    if (!timestamp?.toDate) return 'Just now';
    return timestamp.toDate().toLocaleString();
}

function displayName(sourceProfile = profile, sourceUser = user) {
    return sourceProfile?.displayName || sourceUser?.displayName || 'Member';
}

function avatarURL(sourceProfile = profile, sourceUser = user) {
    return sourceProfile?.photoURL || sourceUser?.photoURL || '';
}

function avatarHTML(name, photoURL) {
    const safeName = escapeHTML(name || 'Member');
    const image = photoURL
        ? `<img src="${escapeHTML(photoURL)}" alt="${safeName}'s profile picture" loading="lazy">`
        : safeName.slice(0, 1).toUpperCase();
    return `<span class="avatar">${image}</span>`;
}

function getVisitorId() {
    let visitorId = localStorage.getItem(VISITOR_RATING_KEY);
    if (!visitorId) {
        visitorId = globalThis.crypto?.randomUUID
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(VISITOR_RATING_KEY, visitorId);
    }
    return visitorId;
}

async function isStaff(uid = user?.uid) {
    if (!db || !uid) return false;
    try {
        const staffDoc = await getDoc(doc(db, 'staff', uid));
        return staffDoc.exists() && staffDoc.data().active === true;
    } catch (error) {
        console.warn('Unable to check staff role:', error);
        return false;
    }
}

async function hasRatedEveryGame(uid) {
    if (!db || !uid) return false;
    try {
        const snapshots = await Promise.all(
            games.map((game) => getDoc(doc(db, 'games', game.id, 'ratings', uid)))
        );
        return snapshots.every((snapshot) => snapshot.exists());
    } catch (error) {
        console.warn('Unable to check Critic achievement:', error);
        return false;
    }
}

async function getBadges(uid, userProfile) {
    const earned = new Set(Array.isArray(userProfile?.earnedBadges) ? userProfile.earnedBadges : []);
    if (await isStaff(uid)) earned.add('staff');
    if (await hasRatedEveryGame(uid)) earned.add('critic');
    return [...earned];
}

function badgeHTML(badge) {
    const badgeDetails = {
        staff: { label: 'Staff', icon: '🛡️' },
        critic: { label: 'Critic', icon: '★' }
    };
    const details = badgeDetails[badge];
    if (!details) return `<span class="profile-badge">${escapeHTML(badge)}</span>`;
    return `<span class="profile-badge badge-${badge}" title="${details.label}">${details.icon} ${details.label}</span>`;
}

async function ensureProfile(authUser) {
    if (!db || !authUser) return null;

    const profileRef = doc(db, 'profiles', authUser.uid);
    try {
        const snapshot = await getDoc(profileRef);
        if (!snapshot.exists()) {
            const creationDate = authUser.metadata?.creationTime
                ? new Date(authUser.metadata.creationTime)
                : new Date();
            const newProfile = {
                uid: authUser.uid,
                displayName: authUser.displayName || 'Member',
                photoURL: authUser.photoURL || '',
                bio: '',
                createdAt: Timestamp.fromDate(creationDate),
                updatedAt: serverTimestamp(),
                earnedBadges: [],
                selectedBadge: ''
            };
            await setDoc(profileRef, newProfile);
            return { ...newProfile, updatedAt: null };
        }

        const existingProfile = snapshot.data();
        const updates = {};
        if (!existingProfile.displayName && authUser.displayName) {
            updates.displayName = authUser.displayName;
        }
        if (typeof existingProfile.photoURL !== 'string') {
            updates.photoURL = authUser.photoURL || '';
        }
        if (typeof existingProfile.selectedBadge !== 'string') updates.selectedBadge = '';
        if (typeof existingProfile.bio !== 'string') updates.bio = '';

        if (Object.keys(updates).length) {
            updates.updatedAt = serverTimestamp();
            await updateDoc(profileRef, updates);
            return { ...existingProfile, ...updates };
        }
        return existingProfile;
    } catch (error) {
        console.error('Could not create or read profile:', error);
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* Shared navigation, logo, and theme                                         */
/* -------------------------------------------------------------------------- */

function applyLogo() {
    $$('.brand').forEach((brand) => {
        if (brand.dataset.logoReady === 'true') return;
        const label = brand.textContent.includes('PimIncGames') ? 'PimIncGames' : 'PimIncGames';
        brand.innerHTML = `<img class="site-logo" src="${LOGO_PATH}" alt="" aria-hidden="true"><span>${label}</span>`;
        brand.dataset.logoReady = 'true';
        const image = $('.site-logo', brand);
        image?.addEventListener('error', () => {
            image.remove();
            if (!$('.site-logo-fallback', brand)) {
                const fallback = document.createElement('span');
                fallback.className = 'site-logo-fallback';
                fallback.textContent = '◈';
                brand.prepend(fallback);
            }
        }, { once: true });
    });
}

function initializeTheme() {
    const root = document.documentElement;
    const toggle = $('#themeToggle');
    const label = $('#themeLabel');
    if (!toggle || !label) return;

    if (localStorage.getItem('pimincgames-theme') === 'light') {
        root.dataset.theme = 'light';
    }

    const updateLabel = () => {
        const lightMode = root.dataset.theme === 'light';
        label.textContent = lightMode ? 'Dark' : 'Light';
        toggle.firstChild.textContent = lightMode ? '☾ ' : '☼ ';
    };

    updateLabel();
    toggle.addEventListener('click', () => {
        root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('pimincgames-theme', root.dataset.theme);
        updateLabel();
    });
}

function renderAuthCorner() {
    const corner = $('#authCorner');
    if (!corner) return;

    if (!user) {
        corner.innerHTML = '<a class="btn" href="account.html">Sign in</a>';
        return;
    }

    const name = displayName();
    const badge = profile?.selectedBadge ? badgeHTML(profile.selectedBadge) : '';
    corner.innerHTML = `
        <a class="user-chip" href="profile.html?id=${encodeURIComponent(user.uid)}">
            ${avatarHTML(name, avatarURL())}
            <span class="user-name">${escapeHTML(name)}</span>
            ${badge}
        </a>`;
}

/* -------------------------------------------------------------------------- */
/* Account and editable profile                                               */
/* -------------------------------------------------------------------------- */

async function renderAccount() {
    const panel = $('#accountState');
    if (!panel) return;

    if (!firebaseReady) {
        panel.innerHTML = '<h2>Connect accounts</h2><p class="muted">Check firebase-config.js to finish connecting Firebase.</p>';
        return;
    }

    if (!user) {
        panel.innerHTML = `
            <h2>Welcome</h2>
            <p class="muted">Use Google to sign in. PimIncGames never asks for your Google password.</p>
            <button class="btn primary" id="login" type="button">G &nbsp; Continue with Google</button>
            <div id="authStatus" class="status" aria-live="polite"></div>`;
        $('#login')?.addEventListener('click', async () => {
            try {
                await signInWithPopup(auth, new GoogleAuthProvider());
            } catch (error) {
                setStatus('authStatus', error.message, true);
            }
        });
        return;
    }

    profile = profile || await ensureProfile(user);
    const name = displayName();
    const photo = avatarURL();
    const earnedBadges = await getBadges(user.uid, profile);
    const createdLabel = profile?.createdAt?.toDate
        ? profile.createdAt.toDate().toLocaleDateString()
        : (user.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : 'Unknown');
    const selectedBadge = profile?.selectedBadge || '';

    panel.innerHTML = `
        <div class="account-heading">
            ${avatarHTML(name, photo)}
            <div>
                <h2>Hi, ${escapeHTML(name)}!</h2>
                <p class="muted">${escapeHTML(user.email || '')}</p>
            </div>
        </div>
        <form id="profileForm" class="form">
            <label>Display name
                <input class="input" id="profileName" maxlength="40" required value="${escapeHTML(name)}">
            </label>
            <label>Profile picture path or URL
                <input class="input" id="profilePhoto" maxlength="500" value="${escapeHTML(photo)}" placeholder="assets/avatars/my-picture.png">
            </label>
            <p class="muted form-hint">For a local image, add it to your website repository and enter its path, such as assets/avatars/my-picture.png.</p>
            <label>About me
                <textarea class="input" id="profileBio" maxlength="300" placeholder="A little about you…">${escapeHTML(profile?.bio || '')}</textarea>
            </label>
            <label>Badge displayed beside your name
                <select class="input" id="selectedBadge">
                    <option value="" ${selectedBadge === '' ? 'selected' : ''}>No selected badge</option>
                    ${earnedBadges.map((badge) => `<option value="${escapeHTML(badge)}" ${selectedBadge === badge ? 'selected' : ''}>${escapeHTML(badgeLabel(badge))}</option>`).join('')}
                </select>
            </label>
            <button class="btn primary" type="submit">Save profile</button>
            <div id="profileStatus" class="status" aria-live="polite"></div>
        </form>
        <div class="account-meta muted">Member since ${escapeHTML(createdLabel)}</div>
        <section class="badge-section">
            <h3>Your badges</h3>
            <div class="badge-list">${earnedBadges.length ? earnedBadges.map(badgeHTML).join('') : '<span class="muted">No badges yet. Rate every game to earn Critic.</span>'}</div>
        </section>
        <div class="actions account-actions">
            <a class="btn" href="profile.html?id=${encodeURIComponent(user.uid)}">View public profile →</a>
            <button class="btn" id="logout" type="button">Sign out</button>
        </div>`;

    $('#profileForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const displayNameValue = $('#profileName').value.trim();
        const photoURL = $('#profilePhoto').value.trim();
        const bio = $('#profileBio').value.trim();
        const chosenBadge = $('#selectedBadge').value;

        if (!displayNameValue) {
            setStatus('profileStatus', 'Please enter a display name.', true);
            return;
        }
        if (chosenBadge && !earnedBadges.includes(chosenBadge)) {
            setStatus('profileStatus', 'You can only select a badge you have earned.', true);
            return;
        }

        try {
            const authPhotoURL = /^https?:\/\//i.test(photoURL)
                ? photoURL
                : (user.photoURL || null);
            await updateProfile(user, {
                displayName: displayNameValue,
                photoURL: authPhotoURL
            });
            await setDoc(doc(db, 'profiles', user.uid), {
                uid: user.uid,
                displayName: displayNameValue,
                photoURL,
                bio,
                selectedBadge: chosenBadge,
                updatedAt: serverTimestamp()
            }, { merge: true });

            profile = await getUserProfile(user.uid);
            renderAuthCorner();
            setStatus('profileStatus', 'Profile saved.');
        } catch (error) {
            setStatus('profileStatus', error.message, true);
        }
    });

    $('#logout')?.addEventListener('click', async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Sign-out failed:', error);
        }
    });
}

function badgeLabel(badge) {
    return ({ staff: 'Staff', critic: 'Critic' })[badge] || badge;
}

async function getUserProfile(uid) {
    if (!db || !uid) return null;
    try {
        const snapshot = await getDoc(doc(db, 'profiles', uid));
        return snapshot.exists() ? snapshot.data() : null;
    } catch (error) {
        console.warn('Could not load user profile:', error);
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* Game images, game cards, ratings, and written reviews                      */
/* -------------------------------------------------------------------------- */

function gameArtwork(game, large = false) {
    const inlineSize = large ? 'height:230px;font-size:5rem' : '';
    if (game.image) {
        return `<div class="art ${escapeHTML(game.style)} game-art-image" style="${inlineSize};background-image:url('${escapeHTML(game.image)}')" role="img" aria-label="${escapeHTML(game.name)}"></div>`;
    }
    return `<div class="art ${escapeHTML(game.style)}" style="${inlineSize}">${escapeHTML(game.glyph)}</div>`;
}

async function getRatingSummary(gameId) {
    if (!db) {
        return { memberAverage: 0, memberCount: 0, reviewAverage: 0, reviewCount: 0, visitorAverage: 0, visitorCount: 0, mine: 0, visitorMine: 0 };
    }

    const [memberSnapshot, visitorSnapshot, reviewSnapshot] = await Promise.all([
        getDocs(collection(db, 'games', gameId, 'ratings')),
        getDocs(collection(db, 'games', gameId, 'visitorRatings')),
        getDocs(collection(db, 'games', gameId, 'reviews'))
    ]);

    let memberTotal = 0;
    let memberCount = 0;
    let mine = 0;
    memberSnapshot.forEach((ratingDoc) => {
        const value = Number(ratingDoc.data().value) || 0;
        memberTotal += value;
        memberCount += 1;
        if (user && ratingDoc.id === user.uid) mine = value;
    });

    let reviewTotal = 0;
    let reviewCount = 0;
    reviewSnapshot.forEach((reviewDoc) => {
        const value = Number(reviewDoc.data().value) || 0;
        reviewTotal += value;
        reviewCount += 1;
    });

    let visitorTotal = 0;
    let visitorCount = 0;
    let visitorMine = 0;
    const visitorId = getVisitorId();
    visitorSnapshot.forEach((ratingDoc) => {
        const value = Number(ratingDoc.data().value) || 0;
        visitorTotal += value;
        visitorCount += 1;
        if (ratingDoc.id === visitorId) visitorMine = value;
    });

    return {
        memberAverage: memberCount ? memberTotal / memberCount : 0,
        memberCount,
        reviewAverage: reviewCount ? reviewTotal / reviewCount : 0,
        reviewCount,
        visitorAverage: visitorCount ? visitorTotal / visitorCount : 0,
        visitorCount,
        mine,
        visitorMine
    };
}

async function getGameReviews(gameId) {
    if (!db) return [];
    try {
        const snapshot = await getDocs(query(
            collection(db, 'games', gameId, 'reviews'),
            orderBy('createdAt', 'desc'),
            limit(100)
        ));
        return snapshot.docs.map((reviewDoc) => ({ id: reviewDoc.id, ...reviewDoc.data() }));
    } catch (error) {
        console.warn('Could not load written reviews:', error);
        return [];
    }
}

function gameCard(game, rating = { memberAverage: 0, memberCount: 0, reviewAverage: 0, reviewCount: 0, visitorAverage: 0, visitorCount: 0 }) {
    const gameURL = `game.html?id=${encodeURIComponent(game.id)}`;
    return `
        <article class="card">
            <a href="${gameURL}" aria-label="View ${escapeHTML(game.name)}">${gameArtwork(game)}</a>
            <div class="eyebrow">${escapeHTML(game.status)}</div>
            <h3><a href="${gameURL}">${escapeHTML(game.name)}</a></h3>
            <p>${escapeHTML(game.desc)}</p>
            <div class="game-rating-lines">
                <span class="stars">Verified ratings: ${rating.memberCount ? rating.memberAverage.toFixed(1) + ' ★' : '—'} <span class="muted">(${rating.memberCount})</span></span>
                <span class="verified-badge">Verified reviews: ${rating.reviewCount ? rating.reviewAverage.toFixed(1) + ' ★' : '—'} <span class="muted">(${rating.reviewCount})</span></span>
                <span class="visitor-stars">Visitor ratings: ${rating.visitorCount ? rating.visitorAverage.toFixed(1) + ' ★' : '—'} <span class="muted">(${rating.visitorCount})</span></span>
            </div>
            <div class="cardfoot"><a class="btn" href="${gameURL}">Details →</a></div>
        </article>`;
}

async function renderGameLists() {
    for (const containerId of ['featuredGames', 'allGames']) {
        const container = $(`#${containerId}`);
        if (!container) continue;

        container.innerHTML = games.map((game) => gameCard(game)).join('');
        if (!db) continue;

        try {
            const ratings = await Promise.all(games.map((game) => getRatingSummary(game.id)));
            container.innerHTML = games.map((game, index) => gameCard(game, ratings[index])).join('');
        } catch (error) {
            console.warn('Could not load game ratings:', error);
        }
    }
}

function renderReview(review, game, showOwnerActions = true) {
    const safeName = escapeHTML(review.displayName || 'Member');
    const profileLink = `profile.html?id=${encodeURIComponent(review.uid || '')}`;
    const ownReview = user && review.uid === user.uid;
    return `
        <article class="review-card">
            <div class="review-header">
                <a class="review-author" href="${profileLink}">
                    ${avatarHTML(review.displayName || 'Member', review.photoURL)}
                    <span>${safeName}</span>
                </a>
                ${review.selectedBadge ? badgeHTML(review.selectedBadge) : ''}
                <span class="verified-badge" title="Written by a signed-in account">✓ Verified review</span>
            </div>
            <div class="review-stars" aria-label="${escapeHTML(review.value)} out of 5 stars">${'★'.repeat(Math.floor(Number(review.value) || 0))}${Number(review.value) % 1 ? '⯪' : ''} <span>${escapeHTML(review.value)} / 5</span></div>
            <p class="postbody">${escapeHTML(review.body)}</p>
            <div class="review-meta muted">${escapeHTML(formatDate(review.createdAt))}${review.editedAt ? ' · Edited' : ''}</div>
            ${showOwnerActions && ownReview ? `<div class="review-actions"><button class="btn" type="button" data-edit-review="${escapeHTML(game.id)}">Edit</button><button class="btn" type="button" data-delete-review="${escapeHTML(game.id)}">Delete</button></div>` : ''}
        </article>`;
}

async function submitMemberRating(game, value) {
    if (!user) return;
    await setDoc(doc(db, 'games', game.id, 'ratings', user.uid), {
        uid: user.uid,
        value,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

async function submitVisitorRating(game, value) {
    const visitorId = getVisitorId();
    await setDoc(doc(db, 'games', game.id, 'visitorRatings', visitorId), {
        clientId: visitorId,
        value,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

async function renderGameDetail() {
    const container = $('#gameDetail');
    if (!container) return;

    const requestedId = new URLSearchParams(location.search).get('id');
    const game = games.find((item) => item.id === requestedId) || games[0];
    const [summary, reviews] = await Promise.all([
        getRatingSummary(game.id),
        getGameReviews(game.id)
    ]);
    const ownReview = reviews.find((review) => user && review.uid === user.uid);
    const average = (Number(summary.memberAverage) + Number(summary.visitorAverage)) / 2;
    const hasRatings = summary.memberCount + summary.visitorCount > 0;

    container.innerHTML = `
        ${gameArtwork(game, true)}
        <div class="eyebrow">${escapeHTML(game.status)}</div>
        <h1>${escapeHTML(game.name)}<span class="gradient">.</span></h1>
        <p class="lead">${escapeHTML(game.desc)}</p>
        ${game.link ? `<p><a class="btn primary" href="${escapeHTML(game.link)}" target="_blank" rel="noopener noreferrer">Play / visit game →</a></p>` : ''}

        <section class="panel ratings-panel">
            <h2>Ratings</h2>
            <div class="rating-summary-grid">
                <div><span class="muted">Verified member ratings</span><strong>${summary.memberCount ? summary.memberAverage.toFixed(1) + ' ★' : '—'}</strong><small>${summary.memberCount} rating(s)</small></div>
                <div><span class="muted">Verified written reviews</span><strong>${summary.reviewCount ? summary.reviewAverage.toFixed(1) + ' ★' : '—'}</strong><small>${summary.reviewCount} review(s)</small></div>
                <div><span class="muted">Visitor ratings</span><strong>${summary.visitorCount ? summary.visitorAverage.toFixed(1) + ' ★' : '—'}</strong><small>${summary.visitorCount} rating(s)</small></div>
            </div>
            <p class="muted">${user ? 'Your rating is linked to your signed-in account.' : 'You can rate without signing in. Visitor ratings are unverified and do not include a written review.'}</p>
            <div class="star-picker" id="stars" aria-label="Rate this game">
                ${[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((value) => {
                    const selected = user ? summary.mine >= value : summary.visitorMine >= value;
                    return `<button class="starbtn ${selected ? 'selected' : ''}" data-v="${value}" title="${value} stars" type="button">${selected ? '★' : '☆'}<small>${value}</small></button>`;
                }).join('')}
            </div>
            <div id="ratingStatus" class="status" aria-live="polite">${user && summary.mine ? `Your verified rating: ${summary.mine} / 5` : (!user && summary.visitorMine ? `Your visitor rating: ${summary.visitorMine} / 5` : '')}</div>
        </section>

        <section class="section review-section">
            <h2>Written reviews <span class="muted">(${reviews.length})</span></h2>
            ${user ? `
                <form id="reviewForm" class="form panel">
                    <h3>${ownReview ? 'Update your review' : 'Write a review'}</h3>
                    <label>Your rating
                        <select class="input" id="reviewRating" required>
                            ${[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((value) => `<option value="${value}" ${Number(ownReview?.value) === value ? 'selected' : ''}>${value} / 5 stars</option>`).join('')}
                        </select>
                    </label>
                    <label>Review text
                        <textarea class="input" id="reviewBody" maxlength="2000" required placeholder="What did you think of this game?">${escapeHTML(ownReview?.body || '')}</textarea>
                    </label>
                    <button class="btn primary" type="submit">${ownReview ? 'Save review' : 'Publish review'}</button>
                    <div id="reviewStatus" class="status" aria-live="polite"></div>
                </form>` : '<p class="muted">Sign in to write a verified review. Visitors can leave a star rating only.</p>'}
            <div id="reviewList" class="review-list">
                ${reviews.length ? reviews.map((review) => renderReview(review, game)).join('') : '<div class="panel muted">No written reviews yet.</div>'}
            </div>
        </section>
        <a class="btn" href="games.html">← All games</a>`;

    $$('#stars button', container).forEach((button) => {
        button.addEventListener('click', async () => {
            if (!firebaseReady) {
                setStatus('ratingStatus', 'Ratings need Firebase to be connected.', true);
                return;
            }
            try {
                const value = Number(button.dataset.v);
                if (user) await submitMemberRating(game, value);
                else await submitVisitorRating(game, value);
                await renderGameDetail();
                await renderGameLists();
            } catch (error) {
                setStatus('ratingStatus', `Could not save rating: ${error.message}`, true);
            }
        });
    });

    $('#reviewForm', container)?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!user) return;
        const body = $('#reviewBody', container).value.trim();
        const value = Number($('#reviewRating', container).value);
        if (!body) {
            setStatus('reviewStatus', 'Please write a review first.', true);
            return;
        }

        try {
            const reviewRef = doc(db, 'games', game.id, 'reviews', user.uid);
            const oldReview = await getDoc(reviewRef);
            await setDoc(reviewRef, {
                uid: user.uid,
                displayName: displayName(),
                photoURL: avatarURL(),
                selectedBadge: profile?.selectedBadge || '',
                body: body.slice(0, 2000),
                value,
                createdAt: oldReview.exists() ? oldReview.data().createdAt : serverTimestamp(),
                updatedAt: serverTimestamp(),
                editedAt: oldReview.exists() ? serverTimestamp() : null
            }, { merge: true });
            await submitMemberRating(game, value);
            profile = await getUserProfile(user.uid);
            await renderGameDetail();
            await renderGameLists();
        } catch (error) {
            setStatus('reviewStatus', `Could not save review: ${error.message}`, true);
        }
    });

    $('#reviewList', container)?.addEventListener('click', async (event) => {
        const editButton = event.target.closest('[data-edit-review]');
        const deleteButton = event.target.closest('[data-delete-review]');
        if (!user || (!editButton && !deleteButton)) return;

        if (editButton) {
            $('#reviewBody', container)?.focus();
            $('#reviewBody', container)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        if (deleteButton && confirm('Delete your written review? Your star rating will remain.')) {
            try {
                await deleteDoc(doc(db, 'games', game.id, 'reviews', user.uid));
                await renderGameDetail();
            } catch (error) {
                alert(`Could not delete review: ${error.message}`);
            }
        }
    });
}

/* -------------------------------------------------------------------------- */
/* Community posts and replies                                                */
/* -------------------------------------------------------------------------- */

function authorLink(uid) {
    return `profile.html?id=${encodeURIComponent(uid || '')}`;
}

async function deletePost(postId) {
    const postRef = doc(db, 'posts', postId);
    const snapshot = await getDoc(postRef);
    if (!snapshot.exists()) throw new Error('This post no longer exists.');
    if (snapshot.data().uid !== user?.uid && !(await isStaff())) {
        throw new Error('You do not have permission to delete this post.');
    }
    if (!confirm('Delete this post and its replies? This cannot be undone.')) return;
    const commentsSnapshot = await getDocs(collection(db, 'posts', postId, 'comments'));
    await Promise.all(commentsSnapshot.docs.map((commentDoc) => deleteDoc(commentDoc.ref)));
    await deleteDoc(postRef);
}

async function deleteReply(postId, replyId) {
    if (!confirm('Delete this reply? This cannot be undone.')) return;
    await deleteDoc(doc(db, 'posts', postId, 'comments', replyId));
}

async function loadReplies(postId, staffMember) {
    const target = $(`#comments-${CSS.escape(postId)}`);
    if (!target || !db) return;

    const snapshot = await getDocs(query(
        collection(db, 'posts', postId, 'comments'),
        orderBy('createdAt', 'asc'),
        limit(50)
    ));

    target.innerHTML = snapshot.empty
        ? '<p class="muted reply-empty">No replies yet.</p>'
        : snapshot.docs.map((replyDoc) => {
            const reply = replyDoc.data();
            const ownsReply = Boolean(user && reply.uid === user.uid);
            const canDelete = ownsReply || staffMember;
            const badge = reply.selectedBadge ? badgeHTML(reply.selectedBadge) : '';
            return `
                <div class="reply-item" data-reply-id="${replyDoc.id}">
                    <div class="reply-content">
                        <div class="reply-author-line">
                            <a href="${authorLink(reply.uid)}">${escapeHTML(reply.displayName || 'Member')}</a>
                            ${badge}
                            <span class="muted">${escapeHTML(formatDate(reply.createdAt))}${reply.editedAt ? ' · Edited' : ''}</span>
                        </div>
                        <p class="postbody reply-body">${escapeHTML(reply.body)}</p>
                    </div>
                    ${canDelete ? `<div class="reply-actions">${ownsReply ? '<button class="btn btn-small" type="button" data-edit-reply>Edit</button>' : ''}<button class="btn btn-small" type="button" data-delete-reply>Delete</button></div>` : ''}
                </div>`;
        }).join('');

    target.querySelectorAll('[data-edit-reply]').forEach((button) => {
        button.addEventListener('click', async () => {
            const item = button.closest('[data-reply-id]');
            const replyRef = doc(db, 'posts', postId, 'comments', item.dataset.replyId);
            const replySnapshot = await getDoc(replyRef);
            if (!replySnapshot.exists() || replySnapshot.data().uid !== user?.uid) return;
            const newBody = prompt('Edit your reply:', replySnapshot.data().body);
            if (newBody === null) return;
            if (!newBody.trim()) return alert('A reply cannot be empty.');
            try {
                await updateDoc(replyRef, { body: newBody.trim().slice(0, 1000), editedAt: serverTimestamp() });
                await loadReplies(postId, staffMember);
            } catch (error) {
                alert(`Could not edit reply: ${error.message}`);
            }
        });
    });

    target.querySelectorAll('[data-delete-reply]').forEach((button) => {
        button.addEventListener('click', async () => {
            const item = button.closest('[data-reply-id]');
            try {
                await deleteReply(postId, item.dataset.replyId);
                await loadReplies(postId, staffMember);
            } catch (error) {
                alert(`Could not delete reply: ${error.message}`);
            }
        });
    });
}

async function loadPosts() {
    const feed = $('#postFeed');
    if (!feed) return;

    if (!firebaseReady) {
        feed.innerHTML = '<div class="panel">Connect Firebase to enable shared community posts.</div>';
        return;
    }

    try {
        const snapshot = await getDocs(query(
            collection(db, 'posts'),
            orderBy('createdAt', 'desc'),
            limit(50)
        ));
        if (snapshot.empty) {
            feed.innerHTML = '<div class="panel">No posts yet. Start the first discussion!</div>';
            return;
        }

        const staffMember = await isStaff();
        feed.innerHTML = snapshot.docs.map((postDoc) => {
            const post = postDoc.data();
            const ownsPost = Boolean(user && post.uid === user.uid);
            const canDelete = ownsPost || staffMember;
            const selectedBadge = post.selectedBadge ? badgeHTML(post.selectedBadge) : '';
            return `
                <article class="post" data-post-id="${postDoc.id}">
                    <div class="post-header">
                        <a class="post-author" href="${authorLink(post.uid)}">
                            ${avatarHTML(post.displayName || 'Member', post.photoURL)}
                            <span>${escapeHTML(post.displayName || 'Member')}</span>
                        </a>
                        ${selectedBadge}
                        <span class="muted post-date">${escapeHTML(formatDate(post.createdAt))}${post.editedAt ? ' · Edited' : ''}</span>
                    </div>
                    <h3 class="post-title">${escapeHTML(post.title)}</h3>
                    <div class="postbody">${escapeHTML(post.body)}</div>
                    ${ownsPost || canDelete ? `
                        <div class="post-actions">
                            ${ownsPost ? '<button class="btn btn-small" type="button" data-edit-post>Edit</button>' : ''}
                            ${canDelete ? `<button class="btn btn-small" type="button" data-delete-post>${ownsPost ? 'Delete' : 'Staff delete'}</button>` : ''}
                        </div>` : ''}
                    <div class="replies" id="comments-${postDoc.id}"><p class="muted">Loading replies…</p></div>
                    <form class="reply-form" data-post-id="${postDoc.id}">
                        <input class="input" name="reply" maxlength="1000" required placeholder="${user ? 'Write a reply…' : 'Sign in to reply'}" ${user ? '' : 'disabled'}>
                        <button class="btn" type="submit" ${user ? '' : 'disabled'}>Reply</button>
                    </form>
                    <div class="status" id="replyStatus-${postDoc.id}" aria-live="polite"></div>
                </article>`;
        }).join('');

        for (const postDoc of snapshot.docs) await loadReplies(postDoc.id, staffMember);

        feed.querySelectorAll('[data-edit-post]').forEach((button) => {
            button.addEventListener('click', async () => {
                const article = button.closest('[data-post-id]');
                const postRef = doc(db, 'posts', article.dataset.postId);
                const postSnapshot = await getDoc(postRef);
                if (!postSnapshot.exists() || postSnapshot.data().uid !== user?.uid) return;
                const post = postSnapshot.data();
                const title = prompt('Edit post title:', post.title);
                if (title === null) return;
                const body = prompt('Edit post message:', post.body);
                if (body === null) return;
                if (!title.trim() || !body.trim()) return alert('Title and message cannot be empty.');
                try {
                    await updateDoc(postRef, {
                        title: title.trim().slice(0, 100),
                        body: body.trim().slice(0, 3000),
                        editedAt: serverTimestamp()
                    });
                    await loadPosts();
                } catch (error) {
                    alert(`Could not edit post: ${error.message}`);
                }
            });
        });

        feed.querySelectorAll('[data-delete-post]').forEach((button) => {
            button.addEventListener('click', async () => {
                const article = button.closest('[data-post-id]');
                try {
                    await deletePost(article.dataset.postId);
                    await loadPosts();
                } catch (error) {
                    alert(`Could not delete post: ${error.message}`);
                }
            });
        });

        feed.querySelectorAll('[data-post-id]').forEach((article) => {
            const form = $('.reply-form', article);
            form?.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!user) return;
                const body = form.elements.reply.value.trim();
                if (!body) return;
                try {
                    await addDoc(collection(db, 'posts', article.dataset.postId, 'comments'), {
                        uid: user.uid,
                        displayName: displayName(),
                        photoURL: avatarURL(),
                        selectedBadge: profile?.selectedBadge || '',
                        body: body.slice(0, 1000),
                        createdAt: serverTimestamp()
                    });
                    form.reset();
                    await loadReplies(article.dataset.postId, staffMember);
                } catch (error) {
                    setStatus(`replyStatus-${article.dataset.postId}`, error.message, true);
                }
            });
        });
    } catch (error) {
        console.error('Community feed error:', error);
        feed.innerHTML = '<div class="panel">Could not load community posts. Check your Firestore rules and Firebase setup.</div>';
    }
}

async function publishPost(event) {
    event.preventDefault();
    if (!firebaseReady) {
        setStatus('postStatus', 'Connect Firebase before posting.', true);
        return;
    }
    if (!user) {
        setStatus('postStatus', 'Sign in before posting.', true);
        return;
    }

    const title = $('#postTitle')?.value.trim() || '';
    const body = $('#postBody')?.value.trim() || '';
    if (!title || !body) {
        setStatus('postStatus', 'Please enter a title and a message.', true);
        return;
    }

    try {
        await addDoc(collection(db, 'posts'), {
            uid: user.uid,
            displayName: displayName(),
            photoURL: avatarURL(),
            selectedBadge: profile?.selectedBadge || '',
            title: title.slice(0, 100),
            body: body.slice(0, 3000),
            createdAt: serverTimestamp()
        });
        $('#postTitle').value = '';
        $('#postBody').value = '';
        setStatus('postStatus', 'Post published.');
        await loadPosts();
    } catch (error) {
        setStatus('postStatus', error.message, true);
    }
}

/* -------------------------------------------------------------------------- */
/* Public profiles                                                            */
/* -------------------------------------------------------------------------- */

async function renderPublicProfile() {
    const container = $('#publicProfile');
    if (!container) return;

    const uid = new URLSearchParams(location.search).get('id');
    if (!uid) {
        container.innerHTML = '<div class="panel">No profile was specified.</div>';
        return;
    }

    container.innerHTML = '<div class="panel">Loading profile…</div>';
    try {
        const publicProfile = await getUserProfile(uid);
        if (!publicProfile) {
            container.innerHTML = '<div class="panel">Profile not found. The user may not have created a profile yet.</div>';
            return;
        }

        const badges = await getBadges(uid, publicProfile);
        const selectedBadge = publicProfile.selectedBadge && badges.includes(publicProfile.selectedBadge)
            ? publicProfile.selectedBadge
            : '';
        const postSnapshot = await getDocs(query(collection(db, 'posts'), where('uid', '==', uid), limit(100)));
        const userPosts = postSnapshot.docs.map((item) => item.data())
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        const reviewResults = await Promise.all(games.map(async (game) => {
            const reviewSnapshot = await getDoc(doc(db, 'games', game.id, 'reviews', uid));
            return reviewSnapshot.exists() ? { ...reviewSnapshot.data(), game } : null;
        }));
        const reviews = reviewResults.filter(Boolean);
        const createdAt = publicProfile.createdAt?.toDate
            ? publicProfile.createdAt.toDate().toLocaleDateString()
            : 'Unknown';

        container.innerHTML = `
            <section class="panel public-profile-card">
                <div class="public-profile-top">
                    ${avatarHTML(publicProfile.displayName || 'Member', publicProfile.photoURL)}
                    <div>
                        <h1>${escapeHTML(publicProfile.displayName || 'Member')}</h1>
                        ${selectedBadge ? badgeHTML(selectedBadge) : ''}
                        <p class="muted">Member since ${escapeHTML(createdAt)}</p>
                    </div>
                </div>
                <p class="profile-bio">${escapeHTML(publicProfile.bio || 'This member has not added a bio yet.')}</p>
                <h3>Badges</h3>
                <div class="badge-list">${badges.length ? badges.map(badgeHTML).join('') : '<span class="muted">No badges earned yet.</span>'}</div>
            </section>
            <section class="section">
                <h2>Game reviews <span class="muted">(${reviews.length})</span></h2>
                <div class="review-list">${reviews.length ? reviews.map((review) => renderReview(review, review.game, false)).join('') : '<div class="panel muted">No written reviews yet.</div>'}</div>
            </section>
            <section class="section">
                <h2>Community posts <span class="muted">(${userPosts.length})</span></h2>
                ${userPosts.length ? userPosts.map((post) => `
                    <article class="post">
                        <h3>${escapeHTML(post.title)}</h3>
                        <p class="postbody">${escapeHTML(post.body)}</p>
                        <div class="muted">${escapeHTML(formatDate(post.createdAt))}${post.editedAt ? ' · Edited' : ''}</div>
                    </article>`).join('') : '<div class="panel muted">No community posts yet.</div>'}
            </section>`;
    } catch (error) {
        console.error('Public profile error:', error);
        container.innerHTML = '<div class="panel">Could not load this profile. Check your Firestore rules.</div>';
    }
}

/* -------------------------------------------------------------------------- */
/* Start page-level features                                                  */
/* -------------------------------------------------------------------------- */

initializeTheme();
applyLogo();
if ($('#year')) $('#year').textContent = new Date().getFullYear();
document.querySelector(`[data-nav="${document.body.dataset.page}"]`)?.classList.add('active');
$('#postForm')?.addEventListener('submit', publishPost);

renderAuthCorner();
renderAccount();
renderGameLists();
if (document.body.dataset.page === 'game') renderGameDetail();
if (document.body.dataset.page === 'community') loadPosts();
if (document.body.dataset.page === 'profile') renderPublicProfile();
